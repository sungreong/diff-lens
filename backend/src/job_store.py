"""Persistent DB-backed job state for long running analysis tasks."""

import json
import os
import sqlite3
import threading
import time
import uuid
from contextlib import closing
from typing import Any, Dict, List, Optional, Tuple

from .analysis_cache import CACHE_DB_PATH
from .sqlite_config import get_optimized_connection


JOB_DB_PATH = os.environ.get("ANALYSIS_JOB_DB_PATH", CACHE_DB_PATH)
TERMINAL_STATUSES = {"completed", "failed", "cancelled", "interrupted"}
ACTIVE_STATUSES = {"queued", "running"}

_lock = threading.RLock()
_initialized = False


def _connect() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(JOB_DB_PATH), exist_ok=True)
    conn = get_optimized_connection(JOB_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _json_dump(value: Any) -> str:
    return json.dumps(value or {}, ensure_ascii=False, sort_keys=True)


def _json_load(value: Optional[str], fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except Exception:
        return fallback


def _row_to_job(row: sqlite3.Row) -> Dict[str, Any]:
    data = dict(row)
    data["request"] = _json_load(data.pop("request_json", None), {})
    data["result"] = _json_load(data.pop("result_json", None), None)
    data["error"] = _json_load(data.pop("error_json", None), None)
    data["progress"] = {
        "phase": data.get("phase"),
        "message": data.get("message"),
        "current": data.get("progress_current"),
        "total": data.get("progress_total"),
        "percent": data.get("progress_percent"),
    }
    extra = _json_load(data.pop("progress_extra_json", None), {})
    data["progress"].update(extra or {})
    return data


def ensure_job_store_initialized() -> None:
    global _initialized
    if _initialized:
        return
    with _lock:
        if _initialized:
            return
        with closing(_connect()) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS analysis_jobs (
                    job_id TEXT PRIMARY KEY,
                    job_type TEXT NOT NULL,
                    cache_key TEXT NOT NULL,
                    cache_namespace TEXT NOT NULL,
                    status TEXT NOT NULL,
                    phase TEXT,
                    message TEXT,
                    progress_current INTEGER NOT NULL DEFAULT 0,
                    progress_total INTEGER NOT NULL DEFAULT 0,
                    progress_percent REAL NOT NULL DEFAULT 0,
                    progress_extra_json TEXT,
                    request_json TEXT NOT NULL,
                    result_json TEXT,
                    error_json TEXT,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    started_at REAL,
                    completed_at REAL,
                    heartbeat_at REAL,
                    attempt_count INTEGER NOT NULL DEFAULT 0,
                    max_attempts INTEGER NOT NULL DEFAULT 1,
                    cancel_requested INTEGER NOT NULL DEFAULT 0
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_analysis_jobs_cache_key ON analysis_jobs(cache_key)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_analysis_jobs_status ON analysis_jobs(status)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_analysis_jobs_updated ON analysis_jobs(updated_at)")
            conn.commit()
        _initialized = True


def mark_stale_running_jobs_interrupted(stale_after_seconds: int = 120) -> int:
    ensure_job_store_initialized()
    cutoff = time.time() - stale_after_seconds
    now = time.time()
    with _lock:
        with closing(_connect()) as conn:
            cursor = conn.execute(
                """
                UPDATE analysis_jobs
                SET status = 'interrupted',
                    phase = 'interrupted',
                    message = '백엔드 프로세스가 재시작되어 실행 중이던 내부 작업이 중단되었습니다. 다시 실행할 수 있습니다.',
                    updated_at = ?,
                    completed_at = ?,
                    error_json = ?
                WHERE status IN ('queued', 'running')
                  AND COALESCE(heartbeat_at, updated_at, started_at, created_at) < ?
                """,
                (
                    now,
                    now,
                    _json_dump({
                        "type": "Interrupted",
                        "message": "Backend process restarted or heartbeat became stale.",
                        "retryable": True,
                    }),
                    cutoff,
                ),
            )
            conn.commit()
            return int(cursor.rowcount or 0)


def create_job(
    *,
    job_type: str,
    cache_key: str,
    cache_namespace: str,
    request_payload: Dict[str, Any],
    max_attempts: int = 1,
) -> Dict[str, Any]:
    ensure_job_store_initialized()
    now = time.time()
    job_id = uuid.uuid4().hex
    with _lock:
        with closing(_connect()) as conn:
            conn.execute(
                """
                INSERT INTO analysis_jobs (
                    job_id, job_type, cache_key, cache_namespace, status,
                    phase, message, request_json, created_at, updated_at,
                    heartbeat_at, max_attempts
                )
                VALUES (?, ?, ?, ?, 'queued', 'queued', ?, ?, ?, ?, ?, ?)
                """,
                (
                    job_id,
                    job_type,
                    cache_key,
                    cache_namespace,
                    "작업 대기열에 등록되었습니다.",
                    _json_dump(request_payload),
                    now,
                    now,
                    now,
                    max_attempts,
                ),
            )
            conn.commit()
    return get_job(job_id)


def get_latest_reusable_job(cache_key: str, *, include_completed: bool = True) -> Optional[Dict[str, Any]]:
    ensure_job_store_initialized()
    statuses = "('queued', 'running', 'completed')" if include_completed else "('queued', 'running')"
    with _lock:
        with closing(_connect()) as conn:
            row = conn.execute(
                f"""
                SELECT * FROM analysis_jobs
                WHERE cache_key = ?
                  AND status IN {statuses}
                ORDER BY updated_at DESC
                LIMIT 1
                """,
                (cache_key,),
            ).fetchone()
            return _row_to_job(row) if row else None


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    ensure_job_store_initialized()
    with _lock:
        with closing(_connect()) as conn:
            row = conn.execute("SELECT * FROM analysis_jobs WHERE job_id = ?", (job_id,)).fetchone()
            return _row_to_job(row) if row else None


def list_jobs(status: Optional[str] = None, limit: int = 20) -> List[Dict[str, Any]]:
    ensure_job_store_initialized()
    limit = max(1, min(limit, 100))
    with _lock:
        with closing(_connect()) as conn:
            if status:
                rows = conn.execute(
                    "SELECT * FROM analysis_jobs WHERE status = ? ORDER BY updated_at DESC LIMIT ?",
                    (status, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM analysis_jobs ORDER BY updated_at DESC LIMIT ?",
                    (limit,),
                ).fetchall()
            return [_row_to_job(row) for row in rows]


def list_queued_jobs(limit: int = 50) -> List[Dict[str, Any]]:
    ensure_job_store_initialized()
    with _lock:
        with closing(_connect()) as conn:
            rows = conn.execute(
                "SELECT * FROM analysis_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?",
                (max(1, min(limit, 200)),),
            ).fetchall()
            return [_row_to_job(row) for row in rows]


def mark_started(job_id: str) -> None:
    ensure_job_store_initialized()
    now = time.time()
    with _lock:
        with closing(_connect()) as conn:
            conn.execute(
                """
                UPDATE analysis_jobs
                SET status = 'running',
                    phase = 'starting',
                    message = '백엔드 작업을 시작했습니다.',
                    started_at = COALESCE(started_at, ?),
                    updated_at = ?,
                    heartbeat_at = ?,
                    attempt_count = attempt_count + 1
                WHERE job_id = ? AND status = 'queued'
                """,
                (now, now, now, job_id),
            )
            conn.commit()


def update_progress(
    job_id: str,
    *,
    phase: Optional[str] = None,
    message: Optional[str] = None,
    current: Optional[int] = None,
    total: Optional[int] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> None:
    ensure_job_store_initialized()
    now = time.time()
    job = get_job(job_id)
    if not job:
        return
    next_current = int(current if current is not None else (job.get("progress_current") or 0))
    next_total = int(total if total is not None else (job.get("progress_total") or 0))
    percent = round((next_current / next_total) * 100, 1) if next_total else 0
    with _lock:
        with closing(_connect()) as conn:
            conn.execute(
                """
                UPDATE analysis_jobs
                SET phase = COALESCE(?, phase),
                    message = COALESCE(?, message),
                    progress_current = ?,
                    progress_total = ?,
                    progress_percent = ?,
                    progress_extra_json = ?,
                    updated_at = ?,
                    heartbeat_at = ?
                WHERE job_id = ? AND status IN ('queued', 'running')
                """,
                (
                    phase,
                    message,
                    next_current,
                    next_total,
                    percent,
                    _json_dump(extra or {}),
                    now,
                    now,
                    job_id,
                ),
            )
            conn.commit()


def complete_job(job_id: str, result: Dict[str, Any]) -> None:
    ensure_job_store_initialized()
    now = time.time()
    with _lock:
        with closing(_connect()) as conn:
            conn.execute(
                """
                UPDATE analysis_jobs
                SET status = 'completed',
                    phase = 'complete',
                    message = '작업이 완료되었습니다.',
                    progress_percent = 100,
                    result_json = ?,
                    error_json = NULL,
                    updated_at = ?,
                    completed_at = ?,
                    heartbeat_at = ?
                WHERE job_id = ?
                """,
                (_json_dump(result), now, now, now, job_id),
            )
            conn.commit()


def fail_job(job_id: str, error: Dict[str, Any]) -> None:
    ensure_job_store_initialized()
    now = time.time()
    with _lock:
        with closing(_connect()) as conn:
            conn.execute(
                """
                UPDATE analysis_jobs
                SET status = 'failed',
                    phase = 'failed',
                    message = ?,
                    error_json = ?,
                    updated_at = ?,
                    completed_at = ?,
                    heartbeat_at = ?
                WHERE job_id = ?
                """,
                (error.get("message") or "작업이 실패했습니다.", _json_dump(error), now, now, now, job_id),
            )
            conn.commit()


def cancel_job(job_id: str, message: str = "사용자가 작업 취소를 요청했습니다.") -> None:
    ensure_job_store_initialized()
    now = time.time()
    with _lock:
        with closing(_connect()) as conn:
            conn.execute(
                """
                UPDATE analysis_jobs
                SET status = 'cancelled',
                    phase = 'cancelled',
                    message = ?,
                    updated_at = ?,
                    completed_at = ?,
                    heartbeat_at = ?
                WHERE job_id = ? AND status IN ('queued', 'running')
                """,
                (message, now, now, now, job_id),
            )
            conn.commit()


def request_cancel(job_id: str) -> Optional[Dict[str, Any]]:
    ensure_job_store_initialized()
    now = time.time()
    with _lock:
        with closing(_connect()) as conn:
            conn.execute(
                """
                UPDATE analysis_jobs
                SET cancel_requested = 1,
                    message = '취소 요청을 받았습니다. 현재 단계가 끝나는 대로 중단합니다.',
                    updated_at = ?
                WHERE job_id = ? AND status IN ('queued', 'running')
                """,
                (now, job_id),
            )
            conn.commit()
    return get_job(job_id)


def is_cancel_requested(job_id: str) -> bool:
    job = get_job(job_id)
    return bool(job and job.get("cancel_requested"))


def create_or_reuse_job(
    *,
    job_type: str,
    cache_key: str,
    cache_namespace: str,
    request_payload: Dict[str, Any],
    max_attempts: int = 1,
    reuse_completed: bool = True,
) -> Tuple[Dict[str, Any], bool]:
    reusable = get_latest_reusable_job(cache_key, include_completed=reuse_completed)
    if reusable:
        return reusable, False
    return create_job(
        job_type=job_type,
        cache_key=cache_key,
        cache_namespace=cache_namespace,
        request_payload=request_payload,
        max_attempts=max_attempts,
    ), True
