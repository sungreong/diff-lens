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

@router.get("/file-content")
def get_file_content(
    project_id: str,
    file_path: str,
    ref: str,
    git_url: Optional[str] = None,
    git_token: Optional[str] = None,
    session: Session = Depends(get_session)
):
    """
    Fetch raw file content from GitLab at a specific ref.
    """
    # Resolve credentials if not provided
    if not git_url or not git_token:
        # Try to find from environment
        git_url = git_url or os.getenv("GIT_URL")
        git_token = git_token or os.getenv("GIT_TOKEN")
        
    client = GitLabClient(git_url, git_token)
    content = client.get_file_content(project_id, file_path, ref)
    
    if content is None:
        raise HTTPException(status_code=404, detail="File content not found or error fetching from GitLab")
        
    return {"content": content}

@router.post("/preview", response_model=PreviewResult)
def preview_changes(request: PreviewRequest):
    """
    Preview file count without running AI analysis.
    """
    client = GitLabClient(
        request.git_url or os.getenv("GIT_URL"), 
        request.git_token or os.getenv("GIT_TOKEN")
    )
    commits, file_changes = client.fetch_changes(
        request.project_id or os.getenv("Repo_ID") or os.getenv("PROJECT_ID"),
        request.base_commit,
        request.target_commit,
        request.author_filter
    )
    
    return PreviewResult(
        file_count=len(file_changes),
        commit_count=len(commits),
        total_additions=sum(f.additions for f in file_changes),
        total_deletions=sum(f.deletions for f in file_changes),
        files=file_changes
    )


@router.post("/test-connection", response_model=ConnectionTestResult)
def test_connection(credentials: GitCredentials):
    """
    Test GitLab connection and project access.
    """
    try:
        url = credentials.git_url or os.getenv("GIT_URL")
        token = credentials.git_token or os.getenv("GIT_TOKEN")
        pid = credentials.project_id or os.getenv("Repo_ID") or os.getenv("PROJECT_ID")
        
        client = GitLabClient(url, token)
        project = client.get_project(pid)
        try:
            client.fetch_commits(pid, limit=1, ref_name=credentials.branch or project.default_branch)
        except HTTPException as commit_error:
            return ConnectionTestResult(
                success=False,
                message=f"프로젝트는 찾았지만 커밋 읽기 권한 확인에 실패했습니다: {commit_error.detail}",
                project_name=project.name,
                default_branch=project.default_branch
            )
        return ConnectionTestResult(
            success=True,
            message="연결 성공!",
            project_name=project.name,
            default_branch=project.default_branch
        )
    except Exception as e:
        return ConnectionTestResult(
            success=False,
            message=f"연결 실패: {str(e)}"
        )


@router.post("/commits", response_model=List[CommitInfo])
def get_commits(credentials: GitCredentials):
    """
    Fetch recent commit history from the project.
    """
    url = credentials.git_url or os.getenv("GIT_URL")
    token = credentials.git_token or os.getenv("GIT_TOKEN")
    pid = credentials.project_id or os.getenv("Repo_ID") or os.getenv("PROJECT_ID")
    
    client = GitLabClient(url, token)
    limit = credentials.limit or 100
    commits = client.fetch_commits(pid, limit=limit, ref_name=credentials.branch)
    return commits


@router.post("/authors", response_model=List[AuthorInfo])
def get_authors(credentials: GitCredentials):
    """
    Fetch unique authors from recent commits.
    """
    url = credentials.git_url or os.getenv("GIT_URL")
    token = credentials.git_token or os.getenv("GIT_TOKEN")
    pid = credentials.project_id or os.getenv("Repo_ID") or os.getenv("PROJECT_ID")

    client = GitLabClient(url, token)
    authors = client.fetch_authors(pid, ref_name=credentials.branch)
    return authors


@router.post("/analyze-history", response_model=FileHistoryAnalysis)
def analyze_history(request: HistoryAnalysisRequest):
    return _analyze_history_impl(request)


def _analyze_history_impl(request: HistoryAnalysisRequest, progress_callback=None):
    """
    Perform deep history analysis for a specific file across a commit range.
    """
    # 1. Config Setup
    environment_config = {
        "git_url": os.getenv("GIT_URL"),
        "git_token": os.getenv("GIT_TOKEN"),
        "project_id": os.getenv("Repo_ID") or os.getenv("PROJECT_ID"),
        "openai_api_key": os.getenv("OPENAI_API_KEY"),
        "langfuse_public_key": os.getenv("LANGFUSE_PUBLIC_KEY"),
        "langfuse_secret_key": os.getenv("LANGFUSE_SECRET_KEY"),
        "langfuse_host": os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com")
    }
    
    # Request config overrides environment
    git_url = request.git_url or environment_config["git_url"]
    git_token = request.git_token or environment_config["git_token"]
    project_id = request.project_id or environment_config["project_id"]
    
    if not (git_url and git_token and project_id):
        raise HTTPException(status_code=400, detail="Git configuration missing")

    # LLM Setup
    llm = get_llm(
        openai_api_key=request.openai_api_key or environment_config["openai_api_key"],
        openai_base_url=request.openai_base_url,
        model=request.openai_model or "gpt-4o-mini",
        langfuse_public_key=request.langfuse_public_key or environment_config["langfuse_public_key"],
        langfuse_secret_key=request.langfuse_secret_key or environment_config["langfuse_secret_key"],
        langfuse_host=request.langfuse_host or environment_config["langfuse_host"]
    )
    
    # Tracing
    tracing_context = create_tracing_context(
        langfuse_public_key=request.langfuse_public_key or environment_config["langfuse_public_key"],
        langfuse_secret_key=request.langfuse_secret_key or environment_config["langfuse_secret_key"],
        langfuse_host=request.langfuse_host or environment_config["langfuse_host"],
        session_id=f"history_{request.file_path}_{request.base_commit[:8]}",
        tags=["diff-lens", "deep-history"]
    )
    
    # 2. Fetch Commits accurately using comparison
    client = GitLabClient(git_url, git_token)
    try:
        if progress_callback:
            progress_callback(
                phase="history_resolving_range",
                message="커밋 범위와 파일 경로를 확인하고 있습니다.",
                current=0,
                total=3,
                file=request.file_path,
            )
        project = client.get_project(project_id)
        # Use target_commit if provided, otherwise default to branch or default_branch
        target = request.target_commit or request.branch or project.default_branch
        
        # Determine comparison base: strictly use base_commit as requested
        comp_base = request.base_commit
            
        logger.info(f"[DeepHistory] Comparing {comp_base[:8]}...{target}")
        comparison = project.repository_compare(comp_base, target)
        commits_in_range = sorted(
            comparison.get("commits", []),
            key=lambda c: c.get("committed_date") or c.get("created_at") or ""
        )
        compare_diffs = comparison.get("diffs", [])
        if progress_callback:
            progress_callback(
                phase="history_range_ready",
                message=f"분석 범위에서 {len(commits_in_range)}개 커밋을 찾았습니다.",
                current=1,
                total=max(len(commits_in_range) + 3, 3),
                file=request.file_path,
                commit_count=len(commits_in_range),
            )
        
        if not commits_in_range:
            logger.warning(f"[DeepHistory] No commits found between {request.base_commit} and {target}")
            
    except Exception as e:
        logger.error(f"[DeepHistory] Comparison failed: {e}")
        raise HTTPException(status_code=400, detail=f"커밋 범위를 가져오는데 실패했습니다: {str(e)}")

    # 3. Analyze History
    agent = HistoryAnalyzerAgent(llm, None, tracing_context)
    history_results = []
    path_aliases = {request.file_path}
    for d in compare_diffs:
        if d.get("new_path") == request.file_path or d.get("old_path") == request.file_path:
            if d.get("new_path"):
                path_aliases.add(d.get("new_path"))
            if d.get("old_path"):
                path_aliases.add(d.get("old_path"))
    before_path = next((d.get("old_path") for d in compare_diffs if d.get("new_path") == request.file_path and d.get("old_path")), request.file_path)
    before_content = client.get_file_content(project_id, before_path, request.base_commit)
    after_content = client.get_file_content(project_id, request.file_path, target)
    before_summary = (
        f"Base 기준 `{before_path}` 파일 존재 ({len(before_content.splitlines())} lines, {len(before_content)} chars)."
        if before_content is not None else
        f"Base 기준 `{before_path}` 내용을 가져오지 못했거나 파일이 존재하지 않습니다."
    )
    after_summary = (
        f"Target 기준 `{request.file_path}` 파일 존재 ({len(after_content.splitlines())} lines, {len(after_content)} chars)."
        if after_content is not None else
        f"Target 기준 `{request.file_path}` 내용을 가져오지 못했거나 파일이 존재하지 않습니다."
    )

    history_cache_key = _ai_request_cache_key(
        "history_single_file",
        {
            "git_url": git_url,
            "project_id": project_id,
            "file_path": request.file_path,
            "base_commit": request.base_commit,
            "target": target,
            "commits": [
                {
                    "id": c.get("id"),
                    "short_id": c.get("short_id"),
                    "title": c.get("title"),
                    "author_name": c.get("author_name"),
                    "created_at": c.get("created_at"),
                    "committed_date": c.get("committed_date"),
                }
                for c in commits_in_range
            ],
            "compare_diffs": compare_diffs,
            "before_summary": before_summary,
            "after_summary": after_summary,
        },
        model_config={
            **llm_fingerprint(llm, {"model": request.openai_model or "gpt-4o-mini", "base_url": request.openai_base_url or ""}),
            "api_key_present": bool(llm),
        },
        extra={"agent": "HistoryAnalyzerAgent"},
    )
    cached_history = get_cached_payload(history_cache_key)
    if cached_history:
        logger.info(f"[DeepHistory] Cache HIT {history_cache_key[-16:]}")
        if progress_callback:
            progress_callback(
                phase="history_cache_hit",
                message="동일 조건의 커밋 흐름 분석을 캐시에서 불러왔습니다.",
                current=1,
                total=1,
                file=request.file_path,
                cache_hit=True,
            )
        return FileHistoryAnalysis(**_cached_response_payload(cached_history, history_cache_key))

    owns_history_cache, history_cache_event = claim_inflight(history_cache_key)
    if not owns_history_cache:
        waited_history = asyncio.run(wait_for_inflight_payload(history_cache_key, history_cache_event, timeout=600))
        if waited_history:
            logger.info(f"[DeepHistory] Cache WAIT/HIT {history_cache_key[-16:]}")
            if progress_callback:
                progress_callback(
                    phase="history_cache_wait_hit",
                    message="이미 실행 중이던 커밋 흐름 분석 결과를 재사용했습니다.",
                    current=1,
                    total=1,
                    file=request.file_path,
                    cache_hit=True,
                    cache_waited=True,
                )
            return FileHistoryAnalysis(**_cached_response_payload(waited_history, history_cache_key, waited=True))
    
    logger.info(f"[DeepHistory] Analyzing {request.file_path} across {len(commits_in_range)} commits")
    
    try:
        total_steps = max(len(commits_in_range) + 3, 3)
        for index, commit in enumerate(commits_in_range, 1):
            if progress_callback:
                progress_callback(
                    phase="history_commit_fetching",
                    message=f"{commit.get('short_id') or commit.get('id', '')[:8]} 커밋의 파일 diff를 가져오고 있습니다.",
                    current=min(index + 1, total_steps - 1),
                    total=total_steps,
                    file=request.file_path,
                    commit=commit.get("short_id") or commit.get("id"),
                    commit_index=index,
                    commit_count=len(commits_in_range),
                )
            diff_data = client.get_file_diff_in_commit(project_id, commit['id'], request.file_path, path_aliases=list(path_aliases))
            
            if diff_data:
                diff_text = diff_data.get('diff', '')
                additions, deletions = count_diff_changes(diff_text)
                evidence_pack = agent.build_evidence_pack(diff_text)
                
                # Analyze
                logger.info(f"[DeepHistory] Analyzing commit {commit['short_id']}...")
                if progress_callback:
                    progress_callback(
                        phase="history_commit_analyzing",
                        message=f"{commit.get('short_id') or commit.get('id', '')[:8]} 커밋 변경 내용을 AI가 요약하고 있습니다.",
                        current=min(index + 1, total_steps - 1),
                        total=total_steps,
                        file=request.file_path,
                        commit=commit.get("short_id") or commit.get("id"),
                        commit_index=index,
                        commit_count=len(commits_in_range),
                    )
                commit_info = {
                    "id": commit['id'],
                    "full_sha": commit['id'],
                    "message": commit['title'],
                    "author": commit['author_name'],
                    "date": commit['created_at']
                }
                analysis = agent.analyze_commit(request.file_path, commit_info, diff_text)
                
                history_results.append(CommitAnalysis(
                    commit_id=commit['id'],
                    short_id=commit['short_id'],
                    message=commit['title'],
                    author=commit['author_name'],
                    date=commit['created_at'],
                    diff_stat=f"+{additions}/-{deletions}",
                    analysis=analysis,
                    confidence=evidence_pack['confidence'],
                    evidence_level=evidence_pack['evidence_level'],
                    omitted_hunks=evidence_pack['omitted_hunks'],
                    warnings=evidence_pack['warnings'],
                    change_evidence=evidence_pack['change_evidence'],
                    risk_verdict="불확실",
                    risk_reason="커밋 단위 diff 근거는 있으나 테스트 실행 증거가 없어 안전 여부를 단정하지 않습니다."
                ))
                
        if not history_results:
            response = FileHistoryAnalysis(
                file_path=request.file_path,
                commits_analyzed=0,
                history=[],
                final_summary="지정된 범위에서 이 파일의 변경 사항을 찾을 수 없습니다.",
                before_summary=before_summary,
                after_summary=after_summary,
                risk_verdict="불확실",
                risk_reason="커밋별 diff 증거가 없어 안전 여부를 단정할 수 없습니다.",
                confidence="low",
                recommended_checks=["base/target commit과 파일 경로가 올바른지 확인", "rename 또는 삭제 여부 확인"]
            )
            set_cached_payload(history_cache_key, "history_single_file", response.model_dump())
            return FileHistoryAnalysis(**_cacheable_response_payload(response.model_dump(), history_cache_key))

        # 4. Final Summary
        logger.info(f"[DeepHistory] Generating final summary...")
        if progress_callback:
            progress_callback(
                phase="history_summarizing",
                message=f"{len(history_results)}개 커밋 분석 결과를 하나의 흐름으로 정리하고 있습니다.",
                current=max(total_steps - 1, 1),
                total=total_steps,
                file=request.file_path,
                commit_count=len(commits_in_range),
                analyzed_count=len(history_results),
            )
        # Convert Pydantic models to dict for agent
        history_dicts = [h.model_dump() for h in history_results]
        final_summary = agent.summarize_history(request.file_path, history_dicts)
        
        response = FileHistoryAnalysis(
            file_path=request.file_path,
            commits_analyzed=len(history_results),
            history=history_results,
            final_summary=final_summary,
            before_summary=before_summary,
            after_summary=after_summary,
            risk_verdict="불확실",
            risk_reason="테스트 실행 증거가 없으므로 최종 안전 여부는 불확실합니다.",
            confidence="medium" if history_results else "low",
            recommended_checks=[
                "변경 파일의 단위/통합 테스트 실행",
                "증빙 hunk와 실제 base/target 파일 내용을 대조",
                "운영 영향이 있는 경우 롤백/모니터링 항목 확인"
            ]
        )
        set_cached_payload(history_cache_key, "history_single_file", response.model_dump())
        return FileHistoryAnalysis(**_cacheable_response_payload(response.model_dump(), history_cache_key))
    finally:
        if owns_history_cache:
            resolve_inflight(history_cache_key)


@router.post("/branches", response_model=List[str])
def get_branches(credentials: GitCredentials):
    """
    Fetch available branches from the project.
    """
    url = credentials.git_url or os.getenv("GIT_URL")
    token = credentials.git_token or os.getenv("GIT_TOKEN")
    pid = credentials.project_id or os.getenv("Repo_ID") or os.getenv("PROJECT_ID")

    client = GitLabClient(url, token)
    branches = client.get_branches(pid)
    return branches


@router.post("/generate-risk-prompt", response_model=RiskReviewResponse)
async def generate_risk_prompt(request: RiskReviewRequest):
    """
    Generate AI review request prompt from risk files.
    Builds a deterministic review prompt from already detected risk evidence.
    Cached via Diff Lens result cache for faster repeated queries.
    """
    logger.info(f"[RiskPrompt] Generating prompt for {len(request.files)} risk files")

    cache_key = _risk_review_cache_key(request)
    cached = get_cached_payload(cache_key)
    if cached:
        logger.info(f"[RiskPrompt] Cache HIT {cache_key[-16:]}")
        return RiskReviewResponse(**_cached_response_payload(cached, cache_key))

    owns_cache_key, cache_event = claim_inflight(cache_key)
    if not owns_cache_key:
        waited = await wait_for_inflight_payload(cache_key, cache_event, timeout=300)
        if waited:
            logger.info(f"[RiskPrompt] Cache WAIT/HIT {cache_key[-16:]}")
            return RiskReviewResponse(**_cached_response_payload(waited, cache_key, waited=True))

    try:
        response_payload = _generate_local_risk_review_payload(request)
        set_cached_payload(cache_key, "risk_review_prompt", response_payload)
        return RiskReviewResponse(**_cacheable_response_payload(response_payload, cache_key))
    finally:
        if owns_cache_key:
            resolve_inflight(cache_key)


# ============================================================================
# EXPORT 추가 분석 API 엔드포인트
# ============================================================================

from schemas import (
    FieldExtractionRequest, CustomGroupRequest,
    ExportSummaryTypesResponse
)

