"""Process-wide GitLab caches and cache helper functions."""

from __future__ import annotations

import logging
import os
import re
import threading
import time
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

_global_commit_cache = {}  # (project_id, commit_id) -> commit object
_global_diff_cache = {}  # (project_id, commit_id) -> diff list
_global_project_cache = {}  # (git_url, project_id) -> (project, timestamp)
_global_compare_cache = {}  # (project_id, base, target) -> (result, timestamp)
_global_ref_list_cache = {}  # (git_url, token_hash, project_id, limits, ref) -> (refs, timestamp)
_global_file_content_cache = {}  # (git_url, project_id, file_path, ref) -> content or None
_global_gitlab_client_cache = {}  # (git_url, token_hash) -> (gitlab client, timestamp)
_global_cache_lock = threading.RLock()

PROJECT_CACHE_TTL = 300
COMPARE_MUTABLE_CACHE_TTL = int(os.getenv("GIT_COMPARE_MUTABLE_TTL", "60"))
COMPARE_IMMUTABLE_CACHE_TTL = int(os.getenv("GIT_COMPARE_IMMUTABLE_TTL", "86400"))
REF_LIST_CACHE_TTL = int(os.getenv("GIT_REF_LIST_CACHE_TTL", "60"))
GITLAB_CLIENT_CACHE_TTL = 600
COMMIT_REF_RE = re.compile(r"^[0-9a-f]{7,40}$", re.IGNORECASE)


def is_cache_valid(timestamp: float, ttl: int) -> bool:
    """Check if cached item is still valid based on TTL."""
    return (time.time() - timestamp) < ttl


def looks_like_commit_ref(ref: Optional[str]) -> bool:
    """Return True for short/full Git SHA refs."""
    return bool(ref and COMMIT_REF_RE.match(str(ref).strip()))


def compare_cache_ttl(base: str, target: str) -> int:
    return (
        COMPARE_IMMUTABLE_CACHE_TTL
        if looks_like_commit_ref(base) and looks_like_commit_ref(target)
        else COMPARE_MUTABLE_CACHE_TTL
    )


def configure_gitlab_session(gl) -> None:
    """Tune python-gitlab's underlying requests session for reuse."""
    try:
        from requests.adapters import HTTPAdapter
        from urllib3.util.retry import Retry

        retry_kwargs = {
            "total": 3,
            "connect": 3,
            "read": 2,
            "status": 3,
            "backoff_factor": 0.25,
            "status_forcelist": (429, 500, 502, 503, 504),
            "raise_on_status": False,
        }
        try:
            retry = Retry(allowed_methods=frozenset(["HEAD", "GET", "OPTIONS"]), **retry_kwargs)
        except TypeError:
            retry = Retry(method_whitelist=frozenset(["HEAD", "GET", "OPTIONS"]), **retry_kwargs)

        adapter = HTTPAdapter(
            pool_connections=24,
            pool_maxsize=48,
            max_retries=retry,
            pool_block=True,
        )
        if hasattr(gl, "session"):
            gl.session.mount("https://", adapter)
            gl.session.mount("http://", adapter)
    except Exception as exc:
        logger.debug(f"GitLab session pool tuning skipped: {exc}")


def gitlab_cache_stats() -> Dict[str, Any]:
    with _global_cache_lock:
        return {
            "gitlab_clients": len(_global_gitlab_client_cache),
            "projects": len(_global_project_cache),
            "compares": len(_global_compare_cache),
            "ref_lists": len(_global_ref_list_cache),
            "commits": len(_global_commit_cache),
            "commit_diffs": len(_global_diff_cache),
            "file_contents": len(_global_file_content_cache),
            "client_ttl_seconds": GITLAB_CLIENT_CACHE_TTL,
            "project_ttl_seconds": PROJECT_CACHE_TTL,
            "ref_list_ttl_seconds": REF_LIST_CACHE_TTL,
            "compare_mutable_ttl_seconds": COMPARE_MUTABLE_CACHE_TTL,
            "compare_immutable_ttl_seconds": COMPARE_IMMUTABLE_CACHE_TTL,
        }
