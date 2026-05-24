"""
SemanticDiff AI Lite - FastAPI Backend
"""
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.agents import llm_client_stats
from src.analysis_cache import cache_stats
from src.api_shared import (
    _ai_request_cache_key,
    _risk_review_cache_key,
    _risk_review_run_cache_key,
    _sanitize_for_ai_cache,
    job_runner,
    logger,
    resolve_compare_v2_runtime,
)
from src.database import create_db_and_tables
from src.git_client import gitlab_cache_stats
from src.job_handlers import register_job_handlers
from src.job_store import ensure_job_store_initialized, mark_stale_running_jobs_interrupted
from src.log_buffer import install_log_buffer
from src.merge_plan_jobs import merge_plan_v1_job_cache_identity

load_dotenv()

app = FastAPI(
    title="SemanticDiff AI Lite",
    description="Analyze Git changes and generate AI summaries",
    version="0.1.0",
)

install_log_buffer(capacity=int(os.getenv("LOG_BUFFER_CAPACITY", "800")))

origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _merge_plan_v1_job_cache_identity(request, session):
    return merge_plan_v1_job_cache_identity(
        request,
        session,
        resolve_runtime=resolve_compare_v2_runtime,
        build_cache_key=_ai_request_cache_key,
    )


@app.get("/config/status")
def get_config_status():
    """Return status of environment variables and services."""
    from src.langfuse_utils import check_langfuse_status

    langfuse_status = check_langfuse_status()
    return {
        "configured": bool(os.getenv("GIT_URL") and os.getenv("GIT_TOKEN") and (os.getenv("Repo_ID") or os.getenv("PROJECT_ID"))),
        "git": bool(os.getenv("GIT_URL")),
        "openai": bool(os.getenv("OPENAI_API_KEY")),
        "langfuse": langfuse_status["fully_configured"],
        "langfuse_connection": langfuse_status["connection_test"],
    }


@app.get("/cache/stats")
def get_cache_stats():
    """Return lightweight cache/client reuse diagnostics."""
    return {
        "analysis_cache": cache_stats(),
        "gitlab": gitlab_cache_stats(),
        "llm": llm_client_stats(),
    }


@app.get("/config/langfuse")
def get_langfuse_status():
    """Return detailed Langfuse configuration and connection status."""
    from src.langfuse_utils import check_langfuse_status

    status = check_langfuse_status()
    status["env_vars"] = {
        "LANGFUSE_PUBLIC_KEY": "***" + os.getenv("LANGFUSE_PUBLIC_KEY", "")[-4:] if os.getenv("LANGFUSE_PUBLIC_KEY") else None,
        "LANGFUSE_SECRET_KEY": "***" + os.getenv("LANGFUSE_SECRET_KEY", "")[-4:] if os.getenv("LANGFUSE_SECRET_KEY") else None,
        "LANGFUSE_HOST": os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com"),
    }
    return status


@app.on_event("startup")
async def on_startup():
    create_db_and_tables()
    ensure_job_store_initialized()
    interrupted = mark_stale_running_jobs_interrupted(stale_after_seconds=0)
    if interrupted:
        logger.info("Marked %s stale analysis jobs as interrupted", interrupted)
    register_job_handlers()


@app.get("/")
def read_root():
    return {"message": "SemanticDiff AI Backend is running", "version": "0.1.0"}


@app.get("/health")
def health_check():
    return {"status": "healthy"}


from routers.debug import router as debug_router
from routers.settings import router as settings_router
from routers.profiles import router as profiles_router
from routers.legacy_analysis import router as legacy_analysis_router
from routers.compare_v2 import router as compare_v2_router
from routers.jobs import router as jobs_router
from routers.legacy_git import router as legacy_git_router
from routers.export_legacy import router as export_legacy_router

app.include_router(debug_router, prefix="/api")
app.include_router(settings_router, prefix="/api")
app.include_router(profiles_router)
app.include_router(legacy_analysis_router)
app.include_router(compare_v2_router)
app.include_router(jobs_router)
app.include_router(legacy_git_router)
app.include_router(export_legacy_router)
