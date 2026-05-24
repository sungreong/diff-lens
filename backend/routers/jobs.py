from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select
from sqlalchemy.orm import selectinload

from src import GitLabClient, AnalysisPipeline, HistoryAnalyzerAgent
from src.agents import (
    CategoryAgent,
    FileAnalyzerAgent,
    SummaryGeneratorAgent,
    create_tracing_context,
    get_llm,
)
from src.analysis_cache import (
    build_analysis_cache_key,
    cache_stats,
    claim_inflight,
    get_cached_payload,
    get_inflight_progress,
    llm_fingerprint,
    resolve_inflight,
    set_cached_payload,
    update_inflight_progress,
    wait_for_inflight_payload,
)
from src.analysis_graph import (
    annotate_compare_origin,
    build_run_manifest,
    compare_origin_counts,
    compare_strategy_to_straight,
    run_compare_graph_stream,
)
from src.analysis_services import (
    normalize_analysis_sort,
    run_history_batch_analysis,
    run_standard_analysis,
    sort_file_changes_for_analysis,
)
from src.api_shared import (
    _ai_request_cache_key,
    _cacheable_response_payload,
    _cached_response_payload,
    _executor,
    _generate_local_risk_review_payload,
    _history_job_cache_key,
    _parse_sse_json_events,
    _resolve_legacy_analysis_runtime,
    _risk_review_cache_key,
    _risk_review_run_cache_key,
    _sanitize_for_ai_cache,
    get_prompts_for_profile,
    job_runner,
    logger,
    resolve_compare_v2_runtime,
)
from src.database import engine, get_session
from src.diff_triage import DiffTriageService
from src.git_client import count_diff_changes
from src.git_repository_agent import GitRepositoryAgent, RefDriftDetected
from src.job_store import get_job, list_jobs
from src.models import (
    AnalyzeRequest,
    AnalyzeResponse,
    AuthorInfo,
    CommitAnalysis,
    CommitInfo,
    CompareV2PreviewResult,
    CompareV2Request,
    ConnectionTestResult,
    FileHistoryAnalysis,
    GitCredentials,
    GitRefListResponse,
    GitRepository,
    HistoryAnalysisRequest,
    LangfuseTestResult,
    LLMConfig,
    LLMTestResult,
    MergeCheckResult,
    MergePlanRequest,
    PreviewRequest,
    PreviewResult,
    Profile,
    ProfileRead,
    PromptConfig as DbPromptConfig,
    RefBookmark,
    RefBookmarkCreate,
    RefBookmarkUpdate,
    RiskReviewRequest,
    RiskReviewResponse,
    RiskReviewRunRequest,
    TracingConfig,
)
from schemas import (
    BatchSummaryRequest,
    CustomGroupRequest,
    ExportSummaryTypesResponse,
    FieldExtractionRequest,
    FlatSummaryRequest,
)

router = APIRouter()

from src.job_handlers import (
    _compare_v2_git_job_cache_identity,
    _compare_v2_job_cache_identity,
    _job_response,
    _merge_plan_v1_job_cache_identity,
)
from src.job_queue import job_event_stream
from src.export_job_handlers import export_job_cache_key

@router.post("/api/jobs/compare-v2")
async def start_compare_v2_job(request: CompareV2Request, session: Session = Depends(get_session)):
    cache_key, has_stable_cache_key = _compare_v2_job_cache_identity(request, session)
    cached = get_cached_payload(cache_key) if has_stable_cache_key else None
    if cached:
        return {
            "schema_version": "job.1",
            "job_id": None,
            "job_type": "compare_v2",
            "status": "completed",
            "cache_hit": True,
            "cache_key": cache_key[-16:],
            "result": _cached_response_payload(cached, cache_key),
        }
    job = await job_runner.enqueue_or_reuse(
        job_type="compare_v2",
        cache_key=cache_key,
        cache_namespace="job:compare_v2",
        request_payload=request.model_dump(),
        stored_request_payload=_sanitize_for_ai_cache(request),
        reuse_completed=has_stable_cache_key,
        cache_on_complete=has_stable_cache_key,
    )
    return _job_response(job)


@router.post("/api/jobs/preview")
async def start_legacy_preview_job(request: PreviewRequest):
    has_stable_cache_key = bool(request.base_commit and request.target_commit)
    cache_key = _ai_request_cache_key(
        "job_legacy_preview" if has_stable_cache_key else "job_legacy_preview_pending",
        request,
        extra={"job_version": 1},
    )
    cached = get_cached_payload(cache_key) if has_stable_cache_key else None
    if cached:
        return {
            "schema_version": "job.1",
            "job_id": None,
            "job_type": "legacy_preview",
            "status": "completed",
            "cache_hit": True,
            "cache_key": cache_key[-16:],
            "result": _cached_response_payload(cached, cache_key),
        }
    job = await job_runner.enqueue_or_reuse(
        job_type="legacy_preview",
        cache_key=cache_key,
        cache_namespace="job:legacy_preview",
        request_payload=request.model_dump(),
        stored_request_payload=_sanitize_for_ai_cache(request),
        reuse_completed=has_stable_cache_key,
        cache_on_complete=has_stable_cache_key,
    )
    return _job_response(job)


@router.post("/api/jobs/compare-preview-v2")
async def start_compare_preview_v2_job(request: CompareV2Request, session: Session = Depends(get_session)):
    cache_key, has_stable_cache_key = _compare_v2_git_job_cache_identity("job_compare_preview_v2", request, session, job_version=2)
    cached = get_cached_payload(cache_key) if has_stable_cache_key else None
    if cached:
        return {
            "schema_version": "job.1",
            "job_id": None,
            "job_type": "compare_preview_v2",
            "status": "completed",
            "cache_hit": True,
            "cache_key": cache_key[-16:],
            "result": _cached_response_payload(cached, cache_key),
        }
    job = await job_runner.enqueue_or_reuse(
        job_type="compare_preview_v2",
        cache_key=cache_key,
        cache_namespace="job:compare_preview_v2",
        request_payload=request.model_dump(),
        stored_request_payload=_sanitize_for_ai_cache(request),
        reuse_completed=has_stable_cache_key,
        cache_on_complete=has_stable_cache_key,
    )
    return _job_response(job)


@router.post("/api/jobs/merge-check-v2")
async def start_merge_check_v2_job(request: CompareV2Request, session: Session = Depends(get_session)):
    cache_key, has_stable_cache_key = _compare_v2_git_job_cache_identity("job_merge_check_v2", request, session)
    cached = get_cached_payload(cache_key) if has_stable_cache_key else None
    if cached:
        return {
            "schema_version": "job.1",
            "job_id": None,
            "job_type": "merge_check_v2",
            "status": "completed",
            "cache_hit": True,
            "cache_key": cache_key[-16:],
            "result": _cached_response_payload(cached, cache_key),
        }
    job = await job_runner.enqueue_or_reuse(
        job_type="merge_check_v2",
        cache_key=cache_key,
        cache_namespace="job:merge_check_v2",
        request_payload=request.model_dump(),
        stored_request_payload=_sanitize_for_ai_cache(request),
        reuse_completed=has_stable_cache_key,
        cache_on_complete=has_stable_cache_key,
    )
    return _job_response(job)


@router.post("/api/jobs/merge-plan-v1")
async def start_merge_plan_v1_job(request: MergePlanRequest, session: Session = Depends(get_session)):
    cache_key, has_stable_cache_key = _merge_plan_v1_job_cache_identity(request, session)
    force_refresh = bool(request.force_refresh)
    cached = get_cached_payload(cache_key) if has_stable_cache_key and not force_refresh else None
    if cached:
        return {
            "schema_version": "job.1",
            "job_id": None,
            "job_type": "merge_plan_v1",
            "status": "completed",
            "cache_hit": True,
            "cache_key": cache_key[-16:],
            "result": _cached_response_payload(cached, cache_key),
        }
    runtime_payload = {
        **request.model_dump(),
        "_job_cache_key": cache_key if has_stable_cache_key and not force_refresh else None,
        "_force_refresh": force_refresh,
    }
    job = await job_runner.enqueue_or_reuse(
        job_type="merge_plan_v1",
        cache_key=cache_key,
        cache_namespace="job:merge_plan_v1",
        request_payload=runtime_payload,
        stored_request_payload=_sanitize_for_ai_cache(request),
        reuse_completed=False,
        cache_on_complete=False,
    )
    return _job_response(job)


@router.post("/api/jobs/analyze")
async def start_legacy_analyze_job(request: AnalyzeRequest):
    try:
        runtime = await asyncio.to_thread(_resolve_legacy_analysis_runtime, request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    cache_key = _ai_request_cache_key(
        "job_legacy_analyze",
        request,
        model_config={
            "model": runtime["openai_model"],
            "base_url": runtime["openai_base_url"] or "",
            "api_key_present": bool(runtime["openai_api_key"]),
        },
        extra={
            "analysis_mode": request.analysis_mode,
            "project_id": runtime["project_id"],
            "resolved_target_commit": request.target_commit or "",
            "repo_branch": request.branch or "",
            "prompts": runtime["prompts"],
            "job_version": 2,
        },
    )
    cached = get_cached_payload(cache_key)
    if cached:
        return {
            "schema_version": "job.1",
            "job_id": None,
            "job_type": "legacy_analyze",
            "status": "completed",
            "cache_hit": True,
            "cache_key": cache_key[-16:],
            "result": _cached_response_payload(cached, cache_key),
        }
    job = await job_runner.enqueue_or_reuse(
        job_type="legacy_analyze",
        cache_key=cache_key,
        cache_namespace="job:legacy_analyze",
        request_payload=request.model_dump(),
        stored_request_payload=_sanitize_for_ai_cache(request),
    )
    return _job_response(job)


@router.post("/api/jobs/risk-prompt")
async def start_risk_prompt_job(request: RiskReviewRequest):
    cache_key = _risk_review_cache_key(request)
    cached = get_cached_payload(cache_key)
    if cached:
        return {
            "schema_version": "job.1",
            "job_id": None,
            "job_type": "risk_prompt",
            "status": "completed",
            "cache_hit": True,
            "cache_key": cache_key[-16:],
            "result": _cached_response_payload(cached, cache_key),
        }
    job = await job_runner.enqueue_or_reuse(
        job_type="risk_prompt",
        cache_key=cache_key,
        cache_namespace="risk_review_prompt",
        request_payload=request.model_dump(),
        stored_request_payload=_sanitize_for_ai_cache(request),
    )
    return _job_response(job)


@router.post("/api/jobs/risk-review-run")
async def start_risk_review_run_job(request: RiskReviewRunRequest):
    cache_key = _risk_review_run_cache_key(request)
    cached = get_cached_payload(cache_key)
    if cached:
        return {
            "schema_version": "job.1",
            "job_id": None,
            "job_type": "risk_review_run",
            "status": "completed",
            "cache_hit": True,
            "cache_key": cache_key[-16:],
            "result": _cached_response_payload(cached, cache_key),
        }
    job = await job_runner.enqueue_or_reuse(
        job_type="risk_review_run",
        cache_key=cache_key,
        cache_namespace="risk_review_run",
        request_payload=request.model_dump(),
        stored_request_payload=_sanitize_for_ai_cache(request),
    )
    return _job_response(job)


@router.post("/api/jobs/history")
async def start_history_job(request: HistoryAnalysisRequest):
    cache_key = _history_job_cache_key(request)
    cached = get_cached_payload(cache_key)
    if cached:
        return {
            "schema_version": "job.1",
            "job_id": None,
            "job_type": "history",
            "status": "completed",
            "cache_hit": True,
            "cache_key": cache_key[-16:],
            "result": _cached_response_payload(cached, cache_key),
        }
    job = await job_runner.enqueue_or_reuse(
        job_type="history",
        cache_key=cache_key,
        cache_namespace="job:history",
        request_payload=request.model_dump(),
        stored_request_payload=_sanitize_for_ai_cache(request),
    )
    return _job_response(job)


async def _start_export_job(job_type: str, cache_namespace: str, request: Any, endpoint: str) -> Dict[str, Any]:
    cache_key = export_job_cache_key(cache_namespace, request, endpoint=endpoint)
    cached = get_cached_payload(cache_key)
    if cached:
        return {
            "schema_version": "job.1",
            "job_id": None,
            "job_type": job_type,
            "status": "completed",
            "cache_hit": True,
            "cache_key": cache_key[-16:],
            "result": _cached_response_payload(cached, cache_key),
        }
    job = await job_runner.enqueue_or_reuse(
        job_type=job_type,
        cache_key=cache_key,
        cache_namespace=cache_namespace,
        request_payload=request.model_dump(),
        stored_request_payload=_sanitize_for_ai_cache(request),
    )
    return _job_response(job)


@router.post("/api/jobs/export/extract-fields")
async def start_export_extract_fields_job(request: FieldExtractionRequest):
    return await _start_export_job(
        "export_extract_fields",
        "export_extract_fields",
        request,
        "/api/export/extract-fields",
    )


@router.post("/api/jobs/export/batch-summary")
async def start_export_batch_summary_job(request: BatchSummaryRequest):
    return await _start_export_job(
        "export_batch_summary",
        "export_batch_summary",
        request,
        "/api/export/batch-summary",
    )


@router.post("/api/jobs/export/custom-group")
async def start_export_custom_group_job(request: CustomGroupRequest):
    return await _start_export_job(
        "export_custom_group",
        "export_custom_group",
        request,
        "/api/export/custom-group",
    )


@router.post("/api/jobs/export/flat-summary")
async def start_export_flat_summary_job(request: FlatSummaryRequest):
    return await _start_export_job(
        "export_flat_summary",
        "export_flat_summary",
        request,
        "/api/export/flat-summary",
    )


@router.post("/api/jobs/export/batch-summary-stream")
async def start_export_batch_summary_stream_job(request: BatchSummaryRequest):
    return await _start_export_job(
        "export_batch_summary_stream",
        "export_batch_summary_stream",
        request,
        "/api/export/batch-summary-stream",
    )


@router.post("/api/jobs/export/flat-summary-stream")
async def start_export_flat_summary_stream_job(request: FlatSummaryRequest):
    return await _start_export_job(
        "export_flat_summary_stream",
        "export_flat_summary_stream",
        request,
        "/api/export/flat-summary-stream",
    )


@router.get("/api/jobs")
def get_jobs(status: Optional[str] = None, limit: int = 20):
    return {
        "schema_version": "job.1",
        "jobs": [_job_response(job) for job in list_jobs(status=status, limit=limit)],
        "runner": {
            "active_tasks": job_runner.snapshot_task_count(),
            "concurrency": job_runner.concurrency,
        },
    }


@router.get("/api/jobs/{job_id}/events")
async def stream_job_events(job_id: str):
    async def generate():
        async for event in job_event_stream(job_id):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/api/jobs/{job_id}")
def get_job_status(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_response(job)


@router.post("/api/jobs/{job_id}/cancel")
async def cancel_job_status(job_id: str):
    job = await job_runner.cancel(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_response(job)
