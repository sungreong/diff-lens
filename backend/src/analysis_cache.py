"""
Deterministic analysis result cache.

This cache sits above LangChain's prompt cache and stores completed Diff Lens
analysis payloads. It prevents repeat runs with the same repo/range, prompt
configuration, model configuration, and file diff fingerprint from calling the
LLM again.
"""

import hashlib
import asyncio
import json
import os
import sqlite3
import threading
import time
from contextlib import closing
from typing import Any, Dict, Iterable, List, Optional

from .sqlite_config import get_optimized_connection


CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
CACHE_DB_PATH = os.path.join(CACHE_DIR, "analysis_result_cache.db")

_lock = threading.RLock()
_initialized = False
_inflight_events: Dict[str, threading.Event] = {}
_inflight_started_at: Dict[str, float] = {}
_inflight_progress: Dict[str, Dict[str, Any]] = {}
_INFLIGHT_STALE_SECONDS = 3600


def _normalize(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        value = value.model_dump()
    if isinstance(value, dict):
        return {str(k): _normalize(value[k]) for k in sorted(value.keys(), key=str)}
    if isinstance(value, set):
        normalized_items = [_normalize(item) for item in value]
        return sorted(normalized_items, key=lambda item: json.dumps(item, ensure_ascii=False, sort_keys=True))
    if isinstance(value, (list, tuple)):
        return [_normalize(item) for item in value]
    if isinstance(value, bytes):
        return hashlib.sha256(value).hexdigest()
    return value


def stable_json(value: Any) -> str:
    return json.dumps(_normalize(value), ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def stable_hash(value: Any) -> str:
    return hashlib.sha256(stable_json(value).encode("utf-8")).hexdigest()


def _connect() -> sqlite3.Connection:
    os.makedirs(CACHE_DIR, exist_ok=True)
    return get_optimized_connection(CACHE_DB_PATH)


def _ensure_initialized() -> None:
    global _initialized
    if _initialized:
        return
    with _lock:
        if _initialized:
            return
        with closing(_connect()) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS analysis_result_cache (
                    cache_key TEXT PRIMARY KEY,
                    namespace TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    hits INTEGER NOT NULL DEFAULT 0
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_analysis_result_cache_namespace "
                "ON analysis_result_cache(namespace)"
            )
            conn.commit()
        _initialized = True


def get_cached_payload(cache_key: str) -> Optional[Dict[str, Any]]:
    _ensure_initialized()
    with _lock:
        with closing(_connect()) as conn:
            row = conn.execute(
                "SELECT payload_json, hits FROM analysis_result_cache WHERE cache_key = ?",
                (cache_key,),
            ).fetchone()
            if not row:
                return None
            conn.execute(
                "UPDATE analysis_result_cache SET hits = hits + 1, updated_at = ? WHERE cache_key = ?",
                (time.time(), cache_key),
            )
            conn.commit()
            payload = json.loads(row[0])
            payload["_cache_hits"] = int(row[1]) + 1
            return payload


def set_cached_payload(cache_key: str, namespace: str, payload: Dict[str, Any]) -> None:
    _ensure_initialized()
    payload_to_store = dict(payload)
    payload_to_store.pop("_cache_hits", None)
    payload_json = json.dumps(payload_to_store, ensure_ascii=False, sort_keys=True)
    now = time.time()
    with _lock:
        with closing(_connect()) as conn:
            conn.execute(
                """
                INSERT INTO analysis_result_cache
                    (cache_key, namespace, payload_json, created_at, updated_at, hits)
                VALUES (?, ?, ?, ?, ?, 0)
                ON CONFLICT(cache_key) DO UPDATE SET
                    namespace = excluded.namespace,
                    payload_json = excluded.payload_json,
                    updated_at = excluded.updated_at
                """,
                (cache_key, namespace, payload_json, now, now),
            )
            conn.commit()


def claim_inflight(cache_key: str) -> tuple[bool, threading.Event]:
    """Claim ownership for computing a cache key.

    Returns (True, event) for the caller that should compute the payload.
    Returns (False, event) for callers that should wait for the owner.
    """
    with _lock:
        now = time.time()
        stale_keys = [
            key for key, started_at in _inflight_started_at.items()
            if (now - started_at) > _INFLIGHT_STALE_SECONDS
        ]
        for key in stale_keys:
            stale_event = _inflight_events.pop(key, None)
            _inflight_started_at.pop(key, None)
            _inflight_progress.pop(key, None)
            if stale_event:
                stale_event.set()
        existing = _inflight_events.get(cache_key)
        if existing:
            return False, existing
        event = threading.Event()
        _inflight_events[cache_key] = event
        _inflight_started_at[cache_key] = now
        _inflight_progress[cache_key] = {
            "phase": "claimed",
            "current": 0,
            "total": 0,
            "percent": 0,
            "started_at": now,
            "updated_at": now,
        }
        return True, event


def resolve_inflight(cache_key: str) -> None:
    with _lock:
        event = _inflight_events.pop(cache_key, None)
        _inflight_started_at.pop(cache_key, None)
        _inflight_progress.pop(cache_key, None)
        if event:
            event.set()


def update_inflight_progress(cache_key: Optional[str], progress: Dict[str, Any]) -> None:
    if not cache_key:
        return
    with _lock:
        now = time.time()
        previous = dict(_inflight_progress.get(cache_key) or {})
        started_at = previous.get("started_at") or _inflight_started_at.get(cache_key) or now
        merged = {
            **previous,
            **progress,
            "started_at": started_at,
            "updated_at": now,
        }
        current = merged.get("current")
        total = merged.get("total")
        if total:
            try:
                merged["percent"] = round((float(current or 0) / float(total)) * 100, 1)
            except Exception:
                merged["percent"] = 0
        _inflight_progress[cache_key] = merged


def get_inflight_progress(cache_key: str) -> Optional[Dict[str, Any]]:
    with _lock:
        progress = _inflight_progress.get(cache_key)
        return dict(progress) if progress else None


async def wait_for_inflight_payload(
    cache_key: str,
    event: threading.Event,
    timeout: float = 300.0,
) -> Optional[Dict[str, Any]]:
    completed = await asyncio.to_thread(event.wait, timeout)
    if not completed:
        return None
    return get_cached_payload(cache_key)


def cache_stats() -> Dict[str, Any]:
    _ensure_initialized()
    with _lock:
        with closing(_connect()) as conn:
            rows = conn.execute(
                """
                SELECT namespace, COUNT(*) AS entries, COALESCE(SUM(hits), 0) AS hits,
                       MIN(created_at) AS oldest, MAX(updated_at) AS newest
                FROM analysis_result_cache
                GROUP BY namespace
                ORDER BY namespace
                """
            ).fetchall()
            total = conn.execute(
                "SELECT COUNT(*), COALESCE(SUM(hits), 0) FROM analysis_result_cache"
            ).fetchone()
        return {
            "db_path": CACHE_DB_PATH,
            "total_entries": int(total[0] or 0),
            "total_hits": int(total[1] or 0),
            "inflight": len(_inflight_events),
            "inflight_progress": len(_inflight_progress),
            "inflight_stale_seconds": _INFLIGHT_STALE_SECONDS,
            "namespaces": [
                {
                    "namespace": row[0],
                    "entries": int(row[1] or 0),
                    "hits": int(row[2] or 0),
                    "oldest": row[3],
                    "newest": row[4],
                }
                for row in rows
            ],
        }


def file_fingerprint(file_change: Any) -> Dict[str, Any]:
    diff = getattr(file_change, "diff", None) or ""
    related_commits = getattr(file_change, "related_commits", []) or []
    return {
        "path": getattr(file_change, "path", ""),
        "old_path": getattr(file_change, "old_path", None),
        "status": getattr(file_change, "status", ""),
        "additions": getattr(file_change, "additions", 0),
        "deletions": getattr(file_change, "deletions", 0),
        "diff_hash": hashlib.sha256(diff.encode("utf-8")).hexdigest(),
        "commit_ids": getattr(file_change, "commit_ids", []) or [],
        "related_commit_ids": [
            c.get("full_sha") or c.get("id") or c.get("short_sha")
            for c in related_commits
        ],
        "before": getattr(file_change, "before_summary", None),
        "after": getattr(file_change, "after_summary", None),
        "evidence_hash": stable_hash(getattr(file_change, "change_evidence", []) or []),
    }


def llm_fingerprint(llm: Any = None, fallback: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    fallback = fallback or {}
    return {
        "model": (
            getattr(llm, "model_name", None)
            or getattr(llm, "model", None)
            or fallback.get("model")
            or "gpt-4o-mini"
        ),
        "base_url": (
            str(getattr(llm, "openai_api_base", None) or getattr(llm, "base_url", None) or fallback.get("base_url") or "")
        ),
        "temperature": (
            getattr(llm, "temperature", None)
            if getattr(llm, "temperature", None) is not None
            else fallback.get("temperature", 0.3)
        ),
    }


def build_analysis_cache_key(
    *,
    namespace: str,
    repo_identity: Dict[str, Any],
    request_scope: Dict[str, Any],
    model_config: Dict[str, Any],
    prompts: Dict[str, Any],
    commit_ids: Iterable[str],
    files: List[Any],
) -> str:
    payload = {
        "namespace": namespace,
        "repo": repo_identity,
        "request_scope": request_scope,
        "model_config": model_config,
        "prompts_hash": stable_hash(prompts or {}),
        "commit_ids": list(commit_ids),
        "files": [file_fingerprint(file) for file in files],
    }
    return f"{namespace}:{stable_hash(payload)}"


def build_payload_cache_key(namespace: str, payload: Dict[str, Any]) -> str:
    """Build a deterministic cache key for non-file LLM payloads.

    Use this for AI endpoints whose input is already a structured request
    rather than a list of FileChange objects.
    """
    return f"{namespace}:{stable_hash({'namespace': namespace, 'payload': payload})}"
