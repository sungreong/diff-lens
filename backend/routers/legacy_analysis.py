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

@router.post("/analyze", response_model=AnalyzeResponse)
def analyze_diff(request: AnalyzeRequest, session: Session = Depends(get_session)):
    """
    Analyze git changes from base_commit to HEAD.
    """
    # Resolve Configs
    git_url = request.git_url or os.getenv("GIT_URL")
    git_token = request.git_token or os.getenv("GIT_TOKEN")
    project_id = request.project_id or os.getenv("Repo_ID") or os.getenv("PROJECT_ID")
    
    profile_id = None
    if request.repo_id:
        repo = session.get(GitRepository, request.repo_id)
        if repo:
            git_url = repo.git_url
            git_token = repo.git_token
            project_id = repo.project_id
            profile_id = repo.profile_id
            
            if repo.branch and not request.target_commit:
                request.target_commit = repo.branch
    
    # Fallback to active profile if no profile identified
    if not profile_id:
        active = session.exec(select(Profile).where(Profile.is_active == True)).first()
        if active:
            profile_id = active.id
            
    if not git_url or not git_token or not project_id:
        raise HTTPException(status_code=400, detail="Missing Git Configuration (ID or fields)")

    # Resolve AI/Tracing
    openai_api_key = request.openai_api_key or os.getenv("OPENAI_API_KEY")
    openai_base_url = request.openai_base_url or os.getenv("OPENAI_BASE_URL")
    openai_model = request.openai_model or os.getenv("OPENAI_MODEL")
    if request.llm_config_id:
        llm = session.get(LLMConfig, request.llm_config_id)
        if llm:
            openai_api_key = llm.openai_api_key
            openai_base_url = llm.openai_base_url
            openai_model = llm.openai_model

    langfuse_public_key = request.langfuse_public_key or os.getenv("LANGFUSE_PUBLIC_KEY")
    langfuse_secret_key = request.langfuse_secret_key or os.getenv("LANGFUSE_SECRET_KEY")
    langfuse_host = request.langfuse_host or os.getenv("LANGFUSE_HOST")
    if request.tracing_config_id:
        tracing = session.get(TracingConfig, request.tracing_config_id)
        if tracing:
            langfuse_public_key = tracing.langfuse_public_key
            langfuse_secret_key = tracing.langfuse_secret_key
            langfuse_host = tracing.langfuse_host
    
    # Fetch Prompts
    prompts = get_prompts_for_profile(session, profile_id)
    
    # Fetch changes from GitLab
    client = GitLabClient(git_url, git_token)
    commits, file_changes = client.fetch_changes(
        project_id,
        request.base_commit,
        request.target_commit,
        request.author_filter
    )

    raw_file_count = len(file_changes)
    status_filter = (request.file_status_filter or "all").lower()
    if status_filter != "all":
        allowed_statuses = {"added", "modified", "deleted", "renamed"}
        if status_filter not in allowed_statuses:
            raise HTTPException(status_code=400, detail=f"Unsupported file status filter: {status_filter}")
        file_changes = [f for f in file_changes if f.status == status_filter]

    scoped_file_count = len(file_changes)
    sort_key = normalize_analysis_sort(request.analysis_sort)
    file_changes = sort_file_changes_for_analysis(file_changes, sort_key)
    if request.max_files and request.max_files > 0:
        file_changes = file_changes[:request.max_files]

    if not file_changes:
        return AnalyzeResponse(
            summary="선택한 범위에 해당하는 변경 파일이 없습니다.",
            file_changes=[],
            total_files=0,
            total_additions=0,
            total_deletions=0
        )

    legacy_cache_key = build_analysis_cache_key(
        namespace=f"analysis:legacy:{request.analysis_mode or 'full'}",
        repo_identity={
            "git_url": git_url,
            "project_id": project_id,
            "base_commit": request.base_commit,
            "target_commit": request.target_commit or "HEAD",
        },
        request_scope={
            "analysis_mode": request.analysis_mode or "full",
            "author_filter": request.author_filter or "",
            "file_status_filter": status_filter,
            "max_files": request.max_files or 0,
            "analysis_sort": sort_key,
        },
        model_config={
            "model": openai_model or "gpt-4o-mini",
            "base_url": openai_base_url or "",
            "temperature": 0.3,
            "api_key_present": bool(openai_api_key),
        },
        prompts=prompts,
        commit_ids=[
            c.get("full_sha") or c.get("id") or c.get("short_id") or ""
            for c in commits
        ],
        files=file_changes,
    )
    cached_legacy = get_cached_payload(legacy_cache_key)
    if cached_legacy:
        return AnalyzeResponse(**_cached_response_payload(cached_legacy, legacy_cache_key))

    owns_legacy_cache, legacy_cache_event = claim_inflight(legacy_cache_key)
    if not owns_legacy_cache:
        if legacy_cache_event.wait(300):
            waited_legacy = get_cached_payload(legacy_cache_key)
            if waited_legacy:
                return AnalyzeResponse(**_cached_response_payload(waited_legacy, legacy_cache_key, waited=True))
        owns_legacy_cache, _legacy_cache_event = claim_inflight(legacy_cache_key)
    
    # Run AI analysis pipeline
    try:
        pipeline = AnalysisPipeline(
            openai_api_key=openai_api_key,
            openai_base_url=openai_base_url,
            openai_model=openai_model or "gpt-4o-mini",
            langfuse_public_key=langfuse_public_key,
            langfuse_secret_key=langfuse_secret_key,
            langfuse_host=langfuse_host,
            prompts=prompts
        )
        summary = pipeline.analyze(commits, file_changes)
        
        # Calculate totals
        total_additions = sum(f.additions for f in file_changes)
        total_deletions = sum(f.deletions for f in file_changes)
        response_payload = {
            "summary": summary,
            "file_changes": [f.model_dump() for f in file_changes],
            "total_files": len(file_changes),
            "total_additions": total_additions,
            "total_deletions": total_deletions,
        }
        if not summary.startswith("⚠️ OpenAI API key not configured"):
            set_cached_payload(legacy_cache_key, f"analysis:legacy:{request.analysis_mode or 'full'}", response_payload)
        return AnalyzeResponse(**_cacheable_response_payload(response_payload, legacy_cache_key))
    finally:
        if owns_legacy_cache:
            resolve_inflight(legacy_cache_key)


from fastapi.responses import StreamingResponse
from src.agents import FileAnalyzerAgent, CategoryAgent, SummaryGeneratorAgent, get_llm, create_tracing_context
import json


@router.post("/analyze-stream")
async def analyze_stream(request: AnalyzeRequest, session: Session = Depends(get_session)):
    """
    Streaming analyze endpoint - sends progress updates via SSE.
    """
    # Resolve Configs (Same logic)
    git_url = request.git_url or os.getenv("GIT_URL")
    git_token = request.git_token or os.getenv("GIT_TOKEN")
    project_id = request.project_id or os.getenv("Repo_ID") or os.getenv("PROJECT_ID")
    
    profile_id = None
    if request.repo_id:
        repo = session.get(GitRepository, request.repo_id)
        if repo:
            git_url = repo.git_url
            git_token = repo.git_token
            project_id = repo.project_id
            profile_id = repo.profile_id
            
            if repo.branch and not request.target_commit:
                request.target_commit = repo.branch

    # Fallback to active
    if not profile_id:
        active = session.exec(select(Profile).where(Profile.is_active == True)).first()
        if active:
            profile_id = active.id

    openai_api_key = request.openai_api_key or os.getenv("OPENAI_API_KEY")
    openai_base_url = request.openai_base_url or os.getenv("OPENAI_BASE_URL")
    openai_model = request.openai_model or os.getenv("OPENAI_MODEL")
    if request.llm_config_id:
        llm = session.get(LLMConfig, request.llm_config_id)
        if llm:
            openai_api_key = llm.openai_api_key
            openai_base_url = llm.openai_base_url
            openai_model = llm.openai_model

    langfuse_public_key = request.langfuse_public_key or os.getenv("LANGFUSE_PUBLIC_KEY")
    langfuse_secret_key = request.langfuse_secret_key or os.getenv("LANGFUSE_SECRET_KEY")
    langfuse_host = request.langfuse_host or os.getenv("LANGFUSE_HOST")
    if request.tracing_config_id:
        tracing = session.get(TracingConfig, request.tracing_config_id)
        if tracing:
            langfuse_public_key = tracing.langfuse_public_key
            langfuse_secret_key = tracing.langfuse_secret_key
            langfuse_host = tracing.langfuse_host
            
    # Fetch Prompts
    prompts = get_prompts_for_profile(session, profile_id)
    
    # Create tracing context for Langfuse monitoring
    tracing_context = create_tracing_context(
        langfuse_public_key=langfuse_public_key,
        langfuse_secret_key=langfuse_secret_key,
        langfuse_host=langfuse_host,
        session_id=f"stream_{request.base_commit[:8]}",
        tags=["diff-lens", "stream-analysis"]
    )

    async def generate():
        if not git_url or not git_token:
             yield f"data: {json.dumps({'phase': 'error', 'message': 'Git Configuration Missing'})}\n\n"
             return

        # Phase 1: Fetch changes
        yield f"data: {json.dumps({'phase': 'fetch', 'message': 'GitLab에서 변경사항 가져오는 중...'})}\n\n"
        
        client = GitLabClient(git_url, git_token)
        
        # Run sync blocking function in thread pool to avoid blocking event loop
        loop = asyncio.get_event_loop()
        commits, file_changes = await loop.run_in_executor(
            _executor,
            lambda: client.fetch_changes(
                project_id,
                request.base_commit,
                request.target_commit,
                request.author_filter
            )
        )

        raw_file_count = len(file_changes)
        status_filter = (request.file_status_filter or "all").lower()
        if status_filter != "all":
            allowed_statuses = {"added", "modified", "deleted", "renamed"}
            if status_filter not in allowed_statuses:
                yield f"data: {json.dumps({'phase': 'error', 'message': f'지원하지 않는 파일 상태 필터입니다: {status_filter}'})}\n\n"
                return
            file_changes = [f for f in file_changes if f.status == status_filter]

        scoped_file_count = len(file_changes)
        sort_key = normalize_analysis_sort(request.analysis_sort)
        file_changes = sort_file_changes_for_analysis(file_changes, sort_key)
        if request.max_files and request.max_files > 0:
            file_changes = file_changes[:request.max_files]
        
        total_files = len(file_changes)
        yield f"data: {json.dumps({'phase': 'fetch_done', 'message': f'분석 대상 {total_files}개 파일 준비', 'total': total_files, 'commits': len(commits), 'raw_file_count': raw_file_count, 'scope_file_count': scoped_file_count, 'file_status_filter': status_filter, 'max_files': request.max_files, 'analysis_sort': sort_key})}\n\n"

        if total_files == 0:
            result = {
                'phase': 'complete',
                'mode': request.analysis_mode,
                'files': [],
                'summary': '선택한 범위에 해당하는 변경 파일이 없습니다.',
                'commit_count': len(commits),
                'total_additions': 0,
                'total_deletions': 0,
                'raw_file_count': raw_file_count,
                'scope_file_count': scoped_file_count,
                'analysis_file_count': 0,
                'file_status_filter': status_filter,
                'max_files': request.max_files,
                'analysis_sort': sort_key,
            }
            yield f"data: {json.dumps(result)}\n\n"
            return

        cacheable_mode = request.analysis_mode in ["quick", "full"]
        analysis_cache_key = None
        owns_analysis_key = False
        if cacheable_mode:
            commit_ids = [
                c.get("full_sha") or c.get("id") or c.get("short_id") or ""
                for c in commits
            ]
            analysis_cache_key = build_analysis_cache_key(
                namespace=f"analysis:{request.analysis_mode}",
                repo_identity={
                    "git_url": git_url,
                    "project_id": project_id,
                    "base_commit": request.base_commit,
                    "target_commit": request.target_commit or "HEAD",
                },
                request_scope={
                    "analysis_mode": request.analysis_mode,
                    "author_filter": request.author_filter or "",
                    "file_status_filter": status_filter,
                    "max_files": request.max_files or 0,
                    "analysis_sort": sort_key,
                },
                model_config={
                    "model": openai_model or "gpt-4o-mini",
                    "base_url": openai_base_url or "",
                    "temperature": 0.3,
                    "api_key_present": bool(openai_api_key),
                },
                prompts=prompts,
                commit_ids=commit_ids,
                files=file_changes,
            )
            cached_result = get_cached_payload(analysis_cache_key)
            if cached_result:
                cached_result["phase"] = "complete"
                cached_result["cache_hit"] = True
                cached_result["cache_key"] = analysis_cache_key[-16:]
                cached_result["cache_hits"] = cached_result.pop("_cache_hits", 1)
                yield f"data: {json.dumps({'phase': 'cache_hit', 'message': '동일 조건 분석 결과를 캐시에서 재사용합니다.', 'cache_key': analysis_cache_key[-16:], 'cache_hits': cached_result['cache_hits']})}\n\n"
                yield f"data: {json.dumps(cached_result)}\n\n"
                return

            owns_analysis_key, analysis_event = claim_inflight(analysis_cache_key)
            if not owns_analysis_key:
                yield f"data: {json.dumps({'phase': 'cache_wait', 'message': '동일 조건 분석이 이미 진행 중입니다. 완료 결과를 기다립니다.', 'cache_key': analysis_cache_key[-16:]})}\n\n"
                wait_started_at = time.monotonic()
                wait_continue_reason = "timeout"
                while (time.monotonic() - wait_started_at) < 900:
                    progress_snapshot = get_inflight_progress(analysis_cache_key)
                    if progress_snapshot:
                        yield f"data: {json.dumps({**progress_snapshot, 'phase': 'cache_wait_progress', 'message': '동일 조건 분석이 진행 중입니다. 현재 진행률을 이어서 표시합니다.', 'cache_key': analysis_cache_key[-16:]})}\n\n"

                    completed = await asyncio.to_thread(analysis_event.wait, 2.0)
                    if not completed:
                        continue

                    waited_result = get_cached_payload(analysis_cache_key)
                    if waited_result:
                        waited_result["phase"] = "complete"
                        waited_result["cache_hit"] = True
                        waited_result["cache_waited"] = True
                        waited_result["cache_key"] = analysis_cache_key[-16:]
                        waited_result["cache_hits"] = waited_result.pop("_cache_hits", 1)
                        yield f"data: {json.dumps({'phase': 'cache_hit', 'message': '진행 중이던 동일 조건 분석 결과를 재사용합니다.', 'cache_key': analysis_cache_key[-16:], 'cache_hits': waited_result['cache_hits']})}\n\n"
                        yield f"data: {json.dumps(waited_result)}\n\n"
                        return

                    yield f"data: {json.dumps({'phase': 'cache_wait_timeout', 'message': '기존 분석이 완료됐지만 결과 캐시가 없어 현재 요청에서 이어서 진행합니다.', 'cache_key': analysis_cache_key[-16:]})}\n\n"
                    wait_continue_reason = "released_without_cache"
                    owns_analysis_key, _analysis_event = claim_inflight(analysis_cache_key)
                    break
                if wait_continue_reason == "timeout":
                    yield f"data: {json.dumps({'phase': 'cache_wait_timeout', 'message': '기존 분석 대기가 길어져 현재 요청에서 계속 진행합니다.', 'cache_key': analysis_cache_key[-16:]})}\n\n"
                    owns_analysis_key, _analysis_event = claim_inflight(analysis_cache_key)

            if owns_analysis_key:
                update_inflight_progress(analysis_cache_key, {
                    "phase": "fetch_done",
                    "message": f"분석 대상 {total_files}개 파일 준비",
                    "current": 0,
                    "total": total_files,
                    "elapsed_seconds": 0,
                    "average_seconds": None,
                    "estimated_remaining_seconds": None,
                    "cache_completed_count": 0,
                    "analysis_mode": request.analysis_mode,
                })
        
        # Phase 2: Analyze files
        llm = get_llm(
            openai_api_key=openai_api_key,
            openai_base_url=openai_base_url,
            model=openai_model or "gpt-4o-mini",
            langfuse_public_key=langfuse_public_key,
            langfuse_secret_key=langfuse_secret_key,
            langfuse_host=langfuse_host
        )

        if request.analysis_mode == 'history':
             # --- HISTORY MODE ---
             async for chunk in run_history_batch_analysis(
                 file_changes, request, llm, prompts, tracing_context, client, project_id
             ):
                 yield chunk

        else:
            # --- STANDARD MODE ---
            if llm:
                try:
                    async for chunk in run_standard_analysis(
                        file_changes, request, llm, prompts, tracing_context, progress_key=analysis_cache_key
                    ):
                        yield chunk
                except asyncio.CancelledError:
                    if analysis_cache_key:
                        update_inflight_progress(analysis_cache_key, {
                            "phase": "cancelled",
                            "message": "사용자 요청 취소로 분석 스트림이 중단되었습니다. 다시 실행하면 완료된 파일 캐시를 재사용합니다.",
                        })
                        if owns_analysis_key:
                            resolve_inflight(analysis_cache_key)
                    raise
        
        # Quick mode: Skip categorization and summary
        # Quick mode or History mode: Skip categorization and summary (History mode does its own deep analysis later)
        if request.analysis_mode in ["quick", "history"]:
            yield f"data: {json.dumps({'phase': 'skipping', 'message': '빠른 모드: 요약 생성 건너뜀'})}\n\n"
            summary = "📋 빠른 모드에서는 파일별 분석만 수행됩니다."
            categories = {}
        else:
            # Phase 3: Categorize (full mode only)
            if analysis_cache_key:
                progress_snapshot = get_inflight_progress(analysis_cache_key) or {}
                update_inflight_progress(analysis_cache_key, {
                    **progress_snapshot,
                    "phase": "categorizing",
                    "message": "파일 분류 중...",
                    "current": progress_snapshot.get("current", total_files),
                    "total": progress_snapshot.get("total", total_files),
                })
            yield f"data: {json.dumps({'phase': 'categorizing', 'message': '파일 분류 중...'})}\n\n"
            
            if llm:
                category_agent = CategoryAgent(llm, prompts)
                categories = category_agent.run(file_changes)
            else:
                categories = {}
            
            # Phase 4: Generate summary (full mode only)
            if analysis_cache_key:
                progress_snapshot = get_inflight_progress(analysis_cache_key) or {}
                update_inflight_progress(analysis_cache_key, {
                    **progress_snapshot,
                    "phase": "summarizing",
                    "message": "최종 요약 생성 중...",
                    "current": progress_snapshot.get("current", total_files),
                    "total": progress_snapshot.get("total", total_files),
                })
            yield f"data: {json.dumps({'phase': 'summarizing', 'message': '최종 요약 생성 중...'})}\n\n"
            
            if llm:
                summary_agent = SummaryGeneratorAgent(llm, prompts, tracing_context)
                summary = await summary_agent.arun(commits, file_changes, categories)
            else:
                summary = "⚠️ OpenAI API key not configured."
        
        # Set default message for files not analyzed (beyond max_files limit)
        # Cleanup for unanalyzed files is handled in service or skipped
        # limit is defined in service functions, not here.

        
        # Final result
        total_additions = sum(f.additions for f in file_changes)
        total_deletions = sum(f.deletions for f in file_changes)
        
        analysis_error_count = sum(
            1
            for f in file_changes
            if (getattr(f, "ai_summary", "") or "").startswith("분석 중 오류")
        )

        result = {
            'phase': 'complete',
            'mode': request.analysis_mode,
            'files': [f.model_dump() for f in file_changes],
            'summary': summary,
            'commit_count': len(commits),
            'total_additions': total_additions,
            'total_deletions': total_deletions,
            'raw_file_count': raw_file_count,
            'scope_file_count': scoped_file_count,
            'analysis_file_count': len(file_changes),
            'file_status_filter': status_filter,
            'max_files': request.max_files,
            'analysis_sort': sort_key,
            'cache_hit': False,
            'cache_key': analysis_cache_key[-16:] if analysis_cache_key else None,
            'analysis_error_count': analysis_error_count,
            'cache_write_skipped_reason': 'analysis_errors' if analysis_error_count else None,
        }
        if analysis_cache_key:
            cache_payload_written = False
            try:
                if analysis_error_count == 0:
                    set_cached_payload(
                        analysis_cache_key,
                        namespace=f"analysis:{request.analysis_mode}",
                        payload=result,
                    )
                    cache_payload_written = True
            finally:
                if owns_analysis_key or cache_payload_written:
                    resolve_inflight(analysis_cache_key)
        yield f"data: {json.dumps(result)}\n\n"
    
    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

