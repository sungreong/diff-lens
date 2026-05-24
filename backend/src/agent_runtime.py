"""Shared LLM runtime, cache, and tracing helpers for agents."""

from __future__ import annotations

import hashlib
import logging
import os
import threading
import time
from typing import Any, Dict, List, Optional

from langchain_community.cache import SQLiteCache
from langchain_core.globals import set_llm_cache
from langchain_openai import ChatOpenAI

from .langfuse_utils import LangfuseTracingContext

logger = logging.getLogger("diff-lens.agents")

CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
CACHE_DB_PATH = os.path.join(CACHE_DIR, ".langchain_cache.db")
os.makedirs(CACHE_DIR, exist_ok=True)

_cache_initialized = False
_llm_instance_cache = {}
_llm_http_client_cache = {}
_llm_cache_lock = threading.RLock()
_LLM_INSTANCE_TTL = 600


def _get_shared_http_clients(openai_base_url: Optional[str]) -> Dict[str, Any]:
    """Return shared httpx clients for ChatOpenAI when supported."""
    try:
        import httpx
    except Exception:
        return {}

    key = openai_base_url or "__default__"
    with _llm_cache_lock:
        cached = _llm_http_client_cache.get(key)
        if cached:
            clients, _created_at = cached
            return clients

        limits = httpx.Limits(
            max_connections=40,
            max_keepalive_connections=20,
            keepalive_expiry=120,
        )
        timeout = httpx.Timeout(connect=10.0, read=60.0, write=30.0, pool=10.0)
        try:
            clients = {
                "http_client": httpx.Client(http2=True, limits=limits, timeout=timeout),
                "http_async_client": httpx.AsyncClient(http2=True, limits=limits, timeout=timeout),
            }
        except Exception:
            clients = {
                "http_client": httpx.Client(http2=False, limits=limits, timeout=timeout),
                "http_async_client": httpx.AsyncClient(http2=False, limits=limits, timeout=timeout),
            }
        _llm_http_client_cache[key] = (clients, time.time())
        return clients


def _init_cache():
    """Initialize SQLite cache if not already done."""
    global _cache_initialized
    if not _cache_initialized:
        try:
            cache = SQLiteCache(database_path=CACHE_DB_PATH)
            set_llm_cache(cache)
            try:
                from .sqlite_config import configure_sqlite_engine
                if hasattr(cache, "engine"):
                    configure_sqlite_engine(cache.engine)
                    logger.info(f"LLM cache initialized with SQLite optimizations at {CACHE_DB_PATH}")
                else:
                    logger.info(f"LLM cache initialized at {CACHE_DB_PATH} (optimizations not applied)")
            except Exception as opt_e:
                logger.warning(f"Cache optimization partial: {opt_e}")

            _cache_initialized = True
        except Exception as e:
            logger.warning(f"Failed to initialize LLM cache: {e}")


def get_llm(
    model: str = "gpt-4o-mini",
    temperature: float = 0.3,
    openai_api_key: Optional[str] = None,
    openai_base_url: Optional[str] = None,
    langfuse_public_key: Optional[str] = None,
    langfuse_secret_key: Optional[str] = None,
    langfuse_host: Optional[str] = None,
    enable_cache: bool = True,
) -> Optional[ChatOpenAI]:
    """Get LangChain LLM instance with optional overrides."""
    api_key = openai_api_key or os.getenv("OPENAI_API_KEY")
    if not api_key or api_key == "your_openai_api_key_here":
        return None

    if enable_cache:
        _init_cache()

    api_key_hash = hashlib.sha256(api_key.encode("utf-8")).hexdigest()
    instance_key = (
        model,
        openai_base_url or "",
        api_key_hash,
        float(temperature),
    )
    with _llm_cache_lock:
        cached = _llm_instance_cache.get(instance_key)
        if cached:
            llm, created_at = cached
            if (time.time() - created_at) < _LLM_INSTANCE_TTL:
                return llm

        kwargs = {
            "model": model,
            "base_url": openai_base_url,
            "temperature": temperature,
            "api_key": api_key,
            "max_retries": 2,
            "timeout": 60,
        }
        kwargs.update(_get_shared_http_clients(openai_base_url))
        try:
            llm = ChatOpenAI(**kwargs)
        except Exception as exc:
            if "http_client" not in kwargs and "http_async_client" not in kwargs:
                raise
            logger.warning(f"ChatOpenAI shared HTTP client fallback: {exc}")
            kwargs.pop("http_client", None)
            kwargs.pop("http_async_client", None)
            llm = ChatOpenAI(**kwargs)
        _llm_instance_cache[instance_key] = (llm, time.time())
        return llm


def llm_client_stats() -> Dict[str, Any]:
    with _llm_cache_lock:
        return {
            "llm_instances": len(_llm_instance_cache),
            "http_client_pools": len(_llm_http_client_cache),
            "ttl_seconds": _LLM_INSTANCE_TTL,
            "http_client_pool_lifetime": "process",
            "langchain_cache_initialized": _cache_initialized,
        }


def create_tracing_context(
    langfuse_public_key: Optional[str] = None,
    langfuse_secret_key: Optional[str] = None,
    langfuse_host: Optional[str] = None,
    session_id: Optional[str] = None,
    tags: Optional[List[str]] = None,
) -> LangfuseTracingContext:
    """Create a Langfuse tracing context for monitoring agent calls."""
    ctx = LangfuseTracingContext(
        public_key=langfuse_public_key,
        secret_key=langfuse_secret_key,
        host=langfuse_host,
        session_id=session_id,
        tags=tags,
    )
    if ctx.is_enabled:
        logger.info(f"Langfuse tracing enabled (session={session_id}, host={ctx.host})")
    else:
        logger.warning("Langfuse tracing NOT enabled - check LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY")
    return ctx
