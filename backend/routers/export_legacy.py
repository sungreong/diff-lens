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


@router.get("/api/export/summary-types", response_model=ExportSummaryTypesResponse)
def get_export_summary_types():
    """
    사용 가능한 요약 타입 목록 조회
    """
    from src.export_agents import BatchSummaryAgent
    types = BatchSummaryAgent.get_available_types()
    return ExportSummaryTypesResponse(types=types)


@router.post("/api/export/extract-fields")
async def extract_fields(request: FieldExtractionRequest):
    """
    파일별 KEY/VALUE 필드 추출
    
    사용자가 정의한 스키마(KEY, 설명)에 따라 각 파일의 AI 분석 결과에서
    해당 정보를 추출합니다.
    """
    from src.export_agents import FileFieldExtractorAgent, get_export_llm, create_tracing_context
    
    logger.info(f"[Export] Field extraction for {len(request.files)} files, schema: {[s.key for s in request.schema]}")
    cache_key = _ai_request_cache_key(
        "export_extract_fields",
        request,
        model_config={
            "model": request.openai_model or "gpt-4o-mini",
            "base_url": request.openai_base_url or os.getenv("OPENAI_BASE_URL") or "",
            "temperature": 0.3,
            "api_key_present": bool(request.openai_api_key or os.getenv("OPENAI_API_KEY")),
        },
        extra={"endpoint": "/api/export/extract-fields"},
    )
    cached = get_cached_payload(cache_key)
    if cached:
        return _cached_response_payload(cached, cache_key)
    
    # LLM 생성
    api_key = request.openai_api_key or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=400, detail="OpenAI API key required")
    
    llm = get_export_llm(
        openai_api_key=api_key,
        openai_base_url=request.openai_base_url or os.getenv("OPENAI_BASE_URL"),
        openai_model=request.openai_model or "gpt-4o-mini"
    )
    
    # Tracing context (optional)
    tracing_context = None
    if request.langfuse_public_key and request.langfuse_secret_key:
        tracing_context = create_tracing_context(
            langfuse_public_key=request.langfuse_public_key,
            langfuse_secret_key=request.langfuse_secret_key,
            langfuse_host=request.langfuse_host,
            session_id="export-field-extraction",
            tags=["export", "field-extraction"]
        )
    
    # 에이전트 생성 및 실행
    agent = FileFieldExtractorAgent(llm, None, tracing_context)
    
    # 파일 정보를 딕셔너리로 변환
    files_dict = [f.model_dump() for f in request.files]
    schema_dict = [s.model_dump() for s in request.schema]
    
    # 배치 추출 실행
    results = await agent.extract_batch(files_dict, schema_dict, concurrency=3)
    
    response_payload = {
        "success": True,
        "results": results,
        "total_files": len(results),
        "schema_keys": [s.key for s in request.schema]
    }
    set_cached_payload(cache_key, "export_extract_fields", response_payload)
    return _cacheable_response_payload(response_payload, cache_key)


@router.post("/api/export/batch-summary")
async def batch_summary(request: BatchSummaryRequest):
    """
    배치 점진적 요약 (Map-Reduce 패턴)
    
    파일들을 배치 단위로 나누어 요약하고, 점진적으로 최종 요약을 생성합니다.
    """
    from src.export_agents import BatchSummaryAgent, get_export_llm, create_tracing_context
    
    logger.info(f"[Export] Batch summary: {len(request.files)} files, type={request.summary_type}, batch_size={request.batch_size}")
    cache_key = _ai_request_cache_key(
        "export_batch_summary",
        request,
        model_config={
            "model": request.openai_model or "gpt-4o-mini",
            "base_url": request.openai_base_url or os.getenv("OPENAI_BASE_URL") or "",
            "temperature": 0.3,
            "api_key_present": bool(request.openai_api_key or os.getenv("OPENAI_API_KEY")),
        },
        extra={"endpoint": "/api/export/batch-summary"},
    )
    cached = get_cached_payload(cache_key)
    if cached:
        return _cached_response_payload(cached, cache_key)
    
    # LLM 생성
    api_key = request.openai_api_key or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=400, detail="OpenAI API key required")
    
    llm = get_export_llm(
        openai_api_key=api_key,
        openai_base_url=request.openai_base_url or os.getenv("OPENAI_BASE_URL"),
        openai_model=request.openai_model or "gpt-4o-mini"
    )
    
    # Tracing context
    tracing_context = None
    if request.langfuse_public_key and request.langfuse_secret_key:
        tracing_context = create_tracing_context(
            langfuse_public_key=request.langfuse_public_key,
            langfuse_secret_key=request.langfuse_secret_key,
            langfuse_host=request.langfuse_host,
            session_id=f"export-batch-summary-{request.summary_type}",
            tags=["export", "batch-summary", request.summary_type]
        )
    
    # 에이전트 생성
    agent = BatchSummaryAgent(llm, None, tracing_context)
    
    # 파일 정보를 딕셔너리로 변환
    files_dict = [f.model_dump() for f in request.files]
    
    # 커스텀 그룹 변환
    custom_groups = None
    if request.custom_groups:
        custom_groups = [g.model_dump() for g in request.custom_groups]
    
    # run_in_executor로 동기 함수 실행
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        _executor,
        lambda: agent.run(
            files=files_dict,
            summary_type=request.summary_type,
            batch_size=request.batch_size,
            custom_groups=custom_groups
        )
    )
    
    response_payload = {
        "success": True,
        **result
    }
    set_cached_payload(cache_key, "export_batch_summary", response_payload)
    return _cacheable_response_payload(response_payload, cache_key)


@router.post("/api/export/custom-group")
async def custom_group_export(request: CustomGroupRequest):
    """
    커스텀 그룹별 정보 추출
    
    사용자가 정의한 그룹별로 파일 분석 결과에서 정보를 추출하고
    FLAT한 구조로 반환합니다.
    """
    from src.export_agents import CustomGroupExportAgent, get_export_llm, create_tracing_context
    
    logger.info(f"[Export] Custom group export: {len(request.files)} files, groups={[g.name for g in request.groups]}")
    cache_key = _ai_request_cache_key(
        "export_custom_group",
        request,
        model_config={
            "model": request.openai_model or "gpt-4o-mini",
            "base_url": request.openai_base_url or os.getenv("OPENAI_BASE_URL") or "",
            "temperature": 0.3,
            "api_key_present": bool(request.openai_api_key or os.getenv("OPENAI_API_KEY")),
        },
        extra={"endpoint": "/api/export/custom-group"},
    )
    cached = get_cached_payload(cache_key)
    if cached:
        return _cached_response_payload(cached, cache_key)
    
    # LLM 생성
    api_key = request.openai_api_key or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=400, detail="OpenAI API key required")
    
    llm = get_export_llm(
        openai_api_key=api_key,
        openai_base_url=request.openai_base_url or os.getenv("OPENAI_BASE_URL"),
        openai_model=request.openai_model or "gpt-4o-mini"
    )
    
    # Tracing context
    tracing_context = None
    if request.langfuse_public_key and request.langfuse_secret_key:
        tracing_context = create_tracing_context(
            langfuse_public_key=request.langfuse_public_key,
            langfuse_secret_key=request.langfuse_secret_key,
            langfuse_host=request.langfuse_host,
            session_id="export-custom-group",
            tags=["export", "custom-group"]
        )
    
    # 에이전트 생성
    agent = CustomGroupExportAgent(llm, None, tracing_context)
    
    # 데이터 변환
    files_dict = [f.model_dump() for f in request.files]
    groups_dict = [g.model_dump() for g in request.groups]
    
    # run_in_executor로 동기 함수 실행
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        _executor,
        lambda: agent.run(files=files_dict, groups=groups_dict)
    )
    
    response_payload = {
        "success": True,
        "groups": result,
        "total_files": len(request.files),
        "group_names": [g.name for g in request.groups]
    }
    set_cached_payload(cache_key, "export_custom_group", response_payload)
    return _cacheable_response_payload(response_payload, cache_key)


@router.get("/api/export/flat-templates")
async def get_flat_templates():
    """
    사용 가능한 FLAT 템플릿 목록 반환
    """
    from src.export_agents import FLAT_SUMMARY_TEMPLATES
    
    return {
        "templates": {
            key: {
                "name": val["name"],
                "icon": val["icon"],
                "description": val["description"],
                "category": val["category"],
                "columns": val["columns"]
            }
            for key, val in FLAT_SUMMARY_TEMPLATES.items()
        }
    }


@router.post("/api/export/flat-summary")
async def flat_summary(request: FlatSummaryRequest):
    """
    FLAT 모드 요약 (카테고리당 1행 출력)
    
    Map-Reduce 패턴으로 파일들을 분석한 후,
    카테고리별로 통합하여 FLAT 테이블 형태로 반환합니다.
    """
    from src.export_agents import BatchSummaryAgent, get_export_llm, create_tracing_context
    
    logger.info(f"[Export FLAT] {len(request.files)} files, template={request.template_type}")
    cache_key = _ai_request_cache_key(
        "export_flat_summary",
        request,
        model_config={
            "model": request.openai_model or "gpt-4o-mini",
            "base_url": request.openai_base_url or os.getenv("OPENAI_BASE_URL") or "",
            "temperature": 0.3,
            "api_key_present": bool(request.openai_api_key or os.getenv("OPENAI_API_KEY")),
        },
        extra={"endpoint": "/api/export/flat-summary"},
    )
    cached = get_cached_payload(cache_key)
    if cached:
        return _cached_response_payload(cached, cache_key)
    
    # LLM 생성
    api_key = request.openai_api_key or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=400, detail="OpenAI API key required")
    
    llm = get_export_llm(
        openai_api_key=api_key,
        openai_base_url=request.openai_base_url or os.getenv("OPENAI_BASE_URL"),
        openai_model=request.openai_model or "gpt-4o-mini"
    )
    
    # Tracing context
    tracing_context = None
    if request.langfuse_public_key and request.langfuse_secret_key:
        tracing_context = create_tracing_context(
            langfuse_public_key=request.langfuse_public_key,
            langfuse_secret_key=request.langfuse_secret_key,
            langfuse_host=request.langfuse_host,
            session_id="export-flat-summary",
            tags=["export", "flat"]
        )
    
    # 에이전트 생성
    agent = BatchSummaryAgent(llm, None, tracing_context)
    
    # 데이터 변환
    files_dict = [f.model_dump() for f in request.files]
    
    # run_in_executor로 동기 함수 실행
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        _executor,
        lambda: agent.run_flat(
            files=files_dict,
            template_type=request.template_type,
            batch_size=request.batch_size,
            custom_config=request.custom_config
        )
    )
    
    response_payload = {
        "success": True,
        **result
    }
    set_cached_payload(cache_key, "export_flat_summary", response_payload)
    return _cacheable_response_payload(response_payload, cache_key)

@router.post("/api/export/flat-summary-stream")
def export_flat_summary_stream(request: FlatSummaryRequest):
    """
    Map-Reduce 방식으로 Flat Summary 생성 (서버 전송 이벤트 스트리밍)
    Process: Start -> Map (Batches) -> Aggregating -> Result
    """
    from src.export_agents import BatchSummaryAgent, get_export_llm, create_tracing_context
    import json
    
    logger.info(f"[Export FLAT Stream] {len(request.files)} files, template={request.template_type}")
    cache_key = _ai_request_cache_key(
        "export_flat_summary_stream",
        request,
        model_config={
            "model": request.openai_model or "gpt-4o-mini",
            "base_url": request.openai_base_url or os.getenv("OPENAI_BASE_URL") or "",
            "temperature": 0.3,
            "api_key_present": bool(request.openai_api_key or os.getenv("OPENAI_API_KEY")),
        },
        extra={"endpoint": "/api/export/flat-summary-stream"},
    )
    cached = get_cached_payload(cache_key)
    if cached:
        def cached_event_stream():
            yield f"data: {json.dumps({'type': 'cache_hit', 'message': '동일 조건 Export AI 결과를 캐시에서 재사용합니다.', 'cache_key': cache_key[-16:], 'cache_hits': cached.get('_cache_hits', 1)}, ensure_ascii=False)}\n\n"
            for event in cached.get("events", []):
                yield f"data: {json.dumps({**event, 'cache_hit': True, 'cache_key': cache_key[-16:]}, ensure_ascii=False)}\n\n"
        return StreamingResponse(cached_event_stream(), media_type="text/event-stream")
    
    # LLM 생성
    api_key = request.openai_api_key or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=400, detail="OpenAI API key required")
    
    llm = get_export_llm(
        openai_api_key=api_key,
        openai_base_url=request.openai_base_url or os.getenv("OPENAI_BASE_URL"),
        openai_model=request.openai_model or "gpt-4o-mini"
    )
    
    # Tracing context
    tracing_context = None
    if request.langfuse_public_key and request.langfuse_secret_key:
        tracing_context = create_tracing_context(
            langfuse_public_key=request.langfuse_public_key,
            langfuse_secret_key=request.langfuse_secret_key,
            langfuse_host=request.langfuse_host,
            session_id="export-flat-summary-stream",
            tags=["export", "flat", "stream"]
        )
    
    # 에이전트 생성
    agent = BatchSummaryAgent(llm, None, tracing_context)
    files_dict = [f.model_dump() for f in request.files]
    custom_config_dict = (
        request.custom_config.model_dump()
        if hasattr(request.custom_config, "model_dump")
        else request.custom_config
    ) if request.custom_config else None

    def event_stream():
        events = []
        had_error = False
        try:
            # 동기 제너레이터를 순회하며 SSE 포맷으로 변환
            # StreamingResponse는 이를 별도 스레드에서 실행하므로 블로킹 문제 없음
            for event in agent.run_flat_generator(
                files=files_dict,
                template_type=request.template_type,
                batch_size=request.batch_size,
                custom_config=custom_config_dict
            ):
                events.append(event)
                if event.get("type") == "error":
                    had_error = True
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            if events and not had_error:
                set_cached_payload(cache_key, "export_flat_summary_stream", {"events": events})
        except Exception as e:
            logger.error(f"Stream error: {e}")
            error_event = {"type": "error", "message": str(e)}
            yield f"data: {json.dumps(error_event, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")



@router.post("/api/export/batch-summary-stream")
def export_batch_summary_stream(request: BatchSummaryRequest):
    """
    계층적 JSON 요약 생성 (서버 전송 이벤트 스트리밍)
    Process: Start -> Map (Batches) -> Reduce -> Result
    """
    from src.export_agents import BatchSummaryAgent, get_export_llm, create_tracing_context
    import json
    
    logger.info(f"[Export Batch Stream] {len(request.files)} files, type={request.summary_type}")
    cache_key = _ai_request_cache_key(
        "export_batch_summary_stream",
        request,
        model_config={
            "model": request.openai_model or "gpt-4o-mini",
            "base_url": request.openai_base_url or os.getenv("OPENAI_BASE_URL") or "",
            "temperature": 0.3,
            "api_key_present": bool(request.openai_api_key or os.getenv("OPENAI_API_KEY")),
        },
        extra={"endpoint": "/api/export/batch-summary-stream"},
    )
    cached = get_cached_payload(cache_key)
    if cached:
        def cached_event_stream():
            yield f"data: {json.dumps({'type': 'cache_hit', 'message': '동일 조건 Export AI 결과를 캐시에서 재사용합니다.', 'cache_key': cache_key[-16:], 'cache_hits': cached.get('_cache_hits', 1)}, ensure_ascii=False)}\n\n"
            for event in cached.get("events", []):
                yield f"data: {json.dumps({**event, 'cache_hit': True, 'cache_key': cache_key[-16:]}, ensure_ascii=False)}\n\n"
        return StreamingResponse(cached_event_stream(), media_type="text/event-stream")
    
    # LLM 생성
    api_key = request.openai_api_key or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=400, detail="OpenAI API key required")
    
    llm = get_export_llm(
        openai_api_key=api_key,
        openai_base_url=request.openai_base_url or os.getenv("OPENAI_BASE_URL"),
        openai_model=request.openai_model or "gpt-4o-mini"
    )
    
    # Tracing context
    tracing_context = None
    if request.langfuse_public_key and request.langfuse_secret_key:
        tracing_context = create_tracing_context(
            langfuse_public_key=request.langfuse_public_key,
            langfuse_secret_key=request.langfuse_secret_key,
            langfuse_host=request.langfuse_host,
            session_id="export-batch-summary-stream",
            tags=["export", "batch", "stream"]
        )
    
    # 에이전트 생성
    agent = BatchSummaryAgent(llm, None, tracing_context)
    files_dict = [f.model_dump() for f in request.files]
    custom_groups_dict = [g.model_dump() for g in request.custom_groups] if request.custom_groups else None

    def event_stream():
        events = []
        had_error = False
        try:
            for event in agent.run_generator(
                files=files_dict,
                summary_type=request.summary_type,
                batch_size=request.batch_size,
                custom_groups=custom_groups_dict
            ):
                events.append(event)
                if event.get("type") == "error":
                    had_error = True
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            if events and not had_error:
                set_cached_payload(cache_key, "export_batch_summary_stream", {"events": events})
        except Exception as e:
            logger.error(f"Stream error: {e}")
            error_event = {"type": "error", "message": str(e)}
            yield f"data: {json.dumps(error_event, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
