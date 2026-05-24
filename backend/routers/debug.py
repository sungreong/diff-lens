"""Debug support endpoints for the local developer console."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Dict, List

from fastapi import APIRouter, Query

from src.log_buffer import get_recent_runtime_logs, redact_log_text


router = APIRouter(prefix="/debug", tags=["debug"])

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = BACKEND_DIR.parent

LOG_SOURCES: Dict[str, Path | None] = {
    "runtime": None,
    "backend_err": BACKEND_DIR / "uvicorn-dev.err.log",
    "backend_out": BACKEND_DIR / "uvicorn-dev.out.log",
    "git_client": BACKEND_DIR / "git_client_debug.log",
    "root_git_client": PROJECT_DIR / "git_client_debug.log",
}


def _safe_line_count(lines: int) -> int:
    return max(20, min(lines, 500))


def _tail_file(path: Path, limit: int) -> List[str]:
    if not path.exists() or not path.is_file():
        return []
    try:
        return path.read_text(encoding="utf-8", errors="replace").splitlines()[-limit:]
    except OSError as exc:
        return [f"Could not read {path.name}: {exc}"]


def _file_records(source: str, path: Path, limit: int) -> List[Dict[str, str]]:
    lines = _tail_file(path, limit)
    return [
        {
            "timestamp": "",
            "level": "LOG",
            "logger": source,
            "message": redact_log_text(line),
            "source": source,
        }
        for line in lines
    ]


@router.get("/logs")
def get_debug_logs(
    source: str = Query("runtime", description="runtime, backend_err, backend_out, git_client, root_git_client, all"),
    lines: int = Query(200, ge=20, le=500),
    level: str = Query("ALL", description="Runtime log level filter"),
):
    """Return sanitized recent logs for troubleshooting.

    This is intentionally a whitelist-only endpoint. It never accepts arbitrary
    paths and redacts common token/key/password patterns before returning text.
    """
    limit = _safe_line_count(lines)
    known_sources = list(LOG_SOURCES.keys()) + ["all"]
    selected = source if source in known_sources else "runtime"

    if selected == "runtime":
        records = get_recent_runtime_logs(limit=limit, level=level)
    elif selected == "all":
        records = get_recent_runtime_logs(limit=max(20, limit // 2), level=level)
        per_file_limit = max(10, limit // max(1, len(LOG_SOURCES) - 1))
        for name, path in LOG_SOURCES.items():
            if path is not None:
                records.extend(_file_records(name, path, per_file_limit))
        records = records[-limit:]
    else:
        path = LOG_SOURCES[selected]
        records = _file_records(selected, path, limit) if path is not None else []

    return {
        "source": selected,
        "available_sources": [
            {
                "key": key,
                "label": key.replace("_", " "),
                "exists": True if path is None else path.exists(),
            }
            for key, path in LOG_SOURCES.items()
        ] + [{"key": "all", "label": "all sources", "exists": True}],
        "line_count": len(records),
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "records": records,
    }
