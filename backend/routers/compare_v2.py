from __future__ import annotations

import asyncio
import json
import os
import time
from datetime import datetime, timezone
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

@router.post("/api/v2/compare/refs", response_model=GitRefListResponse)
def get_compare_refs(credentials: GitCredentials):
    """Fetch branch/tag/recent commit refs for v2 comparison pickers."""
    url = credentials.git_url or os.getenv("GIT_URL")
    token = credentials.git_token or os.getenv("GIT_TOKEN")
    pid = credentials.project_id or os.getenv("Repo_ID") or os.getenv("PROJECT_ID")

    if not (url and token and pid):
        raise HTTPException(status_code=400, detail="Git configuration missing")

    client = GitLabClient(url, token)
    refs = client.list_refs(
        pid,
        branch_limit=credentials.limit or 100,
        tag_limit=50,
        commit_limit=min(credentials.limit or 50, 100),
        commit_ref=credentials.branch,
    )
    return refs


@router.post("/api/v2/compare/preview", response_model=CompareV2PreviewResult)
def preview_compare_v2(request: CompareV2Request, session: Session = Depends(get_session)):
    """Preview v2 compare semantics without running AI analysis."""
    runtime = resolve_compare_v2_runtime(request, session)
    git_url = runtime["git_url"]
    git_token = runtime["git_token"]
    project_id = runtime["project_id"]
    if not (git_url and git_token and project_id):
        raise HTTPException(status_code=400, detail="Git configuration missing")

    baseline_ref = request.effective_baseline_ref()
    candidate_ref = request.effective_candidate_ref()
    if not baseline_ref or not candidate_ref:
        raise HTTPException(status_code=400, detail="baseline_ref와 candidate_ref가 필요합니다.")

    client = GitLabClient(git_url, git_token)
    git_agent = GitRepositoryAgent(client, project_id)
    try:
        snapshot = git_agent.compare(request, include_file_evidence=False)
    except RefDriftDetected as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "ref_drift_detected",
                "message": "변경표를 만든 뒤 선택한 버전이 움직였습니다. 최신 기준으로 변경표를 다시 만든 다음 분석하세요.",
                "mismatches": exc.ref_pair.drift,
                "baseline": exc.ref_pair.baseline,
                "candidate": exc.ref_pair.candidate,
            },
        )
    baseline_resolved = snapshot.ref_pair.baseline
    candidate_resolved = snapshot.ref_pair.candidate
    straight = snapshot.straight
    commits = snapshot.commits
    file_changes = snapshot.files
    annotate_compare_origin(file_changes, request.compare_strategy)
    try:
        triage = DiffTriageService().triage(request, file_changes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    file_changes = triage.files
    origin_counts = compare_origin_counts(file_changes)
    preview_run_id = f"preview_{int(time.time() * 1000)}"
    run_manifest = build_run_manifest(
        request,
        preview_run_id,
        baseline_ref,
        candidate_ref,
        baseline_resolved,
        candidate_resolved,
        straight,
        raw_file_count=triage.raw_file_count,
        scoped_file_count=triage.scoped_file_count,
        analysis_file_count=triage.analysis_file_count,
        skipped_reasons=triage.skipped_reasons,
    )

    return CompareV2PreviewResult(
        comparison_type=request.comparison_type,
        compare_strategy=request.compare_strategy,
        baseline_ref=baseline_ref,
        candidate_ref=candidate_ref,
        baseline_resolved=baseline_resolved,
        candidate_resolved=candidate_resolved,
        file_count=len(file_changes),
        commit_count=len(commits),
        total_additions=sum(f.additions for f in file_changes),
        total_deletions=sum(f.deletions for f in file_changes),
        files=file_changes,
        include_impact=request.include_impact,
        impact_max_files=min(request.impact_max_files or 15, 30),
        direct_origin_counts=origin_counts,
        run_manifest=run_manifest,
        triage_coverage=triage.coverage,
        skipped_reasons=triage.skipped_reasons,
    )


@router.post("/api/v2/compare/merge-check", response_model=MergeCheckResult)
def merge_check_v2(request: CompareV2Request, session: Session = Depends(get_session)):
    """Dry-run merge candidate into baseline before opening/performing a merge."""
    runtime = resolve_compare_v2_runtime(request, session)
    git_url = runtime["git_url"]
    git_token = runtime["git_token"]
    project_id = runtime["project_id"]
    if not (git_url and git_token and project_id):
        raise HTTPException(status_code=400, detail="Git configuration missing")

    baseline_ref = request.effective_baseline_ref()
    candidate_ref = request.effective_candidate_ref()
    if not baseline_ref or not candidate_ref:
        raise HTTPException(status_code=400, detail="baseline_ref와 candidate_ref가 필요합니다.")

    client = GitLabClient(git_url, git_token)
    result = GitRepositoryAgent(client, project_id).dry_run_merge_check(request)
    return MergeCheckResult(**result)


@router.get("/api/v2/ref-bookmarks", response_model=List[RefBookmark])
def list_ref_bookmarks(
    repo_id: Optional[int] = None,
    project_id: Optional[str] = None,
    session: Session = Depends(get_session),
):
    """List saved important refs for a repository."""
    statement = select(RefBookmark)
    if repo_id:
        statement = statement.where(RefBookmark.repo_id == repo_id)
    elif project_id:
        statement = statement.where(RefBookmark.project_id == project_id)
    return session.exec(statement).all()


@router.post("/api/v2/ref-bookmarks", response_model=RefBookmark)
def create_ref_bookmark(bookmark: RefBookmarkCreate, session: Session = Depends(get_session)):
    """Save a branch/tag/commit as an important reusable comparison point."""
    data = bookmark.model_dump()
    repo = None
    if bookmark.repo_id:
        repo = session.get(GitRepository, bookmark.repo_id)
        if repo:
            data["repo_id"] = repo.id
            data["profile_id"] = data.get("profile_id") or repo.profile_id
            data["git_url"] = data.get("git_url") or repo.git_url
            data["project_id"] = data.get("project_id") or repo.project_id

    statement = select(RefBookmark).where(RefBookmark.ref == bookmark.ref)
    if bookmark.repo_id:
        statement = statement.where(RefBookmark.repo_id == bookmark.repo_id)
    elif bookmark.project_id:
        statement = statement.where(RefBookmark.project_id == bookmark.project_id)
    if bookmark.sha:
        statement = statement.where(RefBookmark.sha == bookmark.sha)
    existing = session.exec(statement).first()

    if existing:
        for key, value in data.items():
            if value is not None and hasattr(existing, key):
                setattr(existing, key, value)
        existing.updated_at = datetime.now(timezone.utc).isoformat()
        session.add(existing)
        session.commit()
        session.refresh(existing)
        return existing

    row = RefBookmark(**data)
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.patch("/api/v2/ref-bookmarks/{bookmark_id}", response_model=RefBookmark)
def update_ref_bookmark(bookmark_id: int, update: RefBookmarkUpdate, session: Session = Depends(get_session)):
    row = session.get(RefBookmark, bookmark_id)
    if not row:
        raise HTTPException(status_code=404, detail="Bookmark not found")
    for key, value in update.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    row.updated_at = datetime.now(timezone.utc).isoformat()
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.delete("/api/v2/ref-bookmarks/{bookmark_id}")
def delete_ref_bookmark(bookmark_id: int, session: Session = Depends(get_session)):
    row = session.get(RefBookmark, bookmark_id)
    if not row:
        raise HTTPException(status_code=404, detail="Bookmark not found")
    session.delete(row)
    session.commit()
    return {"success": True}


@router.post("/api/v2/compare/analyze-stream")
async def analyze_compare_v2_stream(request: CompareV2Request, session: Session = Depends(get_session)):
    """LangGraph-backed streaming analysis for pre-deploy comparisons."""
    runtime = resolve_compare_v2_runtime(request, session)
    git_url = runtime["git_url"]
    git_token = runtime["git_token"]
    project_id = runtime["project_id"]
    if not (git_url and git_token and project_id):
        async def missing_config():
            yield f"data: {json.dumps({'schema_version': '2.0', 'phase': 'error', 'event': 'error', 'message': 'Git Configuration Missing'})}\n\n"
        return StreamingResponse(missing_config(), media_type="text/event-stream")

    tracing_context = create_tracing_context(
        langfuse_public_key=runtime["langfuse_public_key"],
        langfuse_secret_key=runtime["langfuse_secret_key"],
        langfuse_host=runtime["langfuse_host"],
        session_id=f"compare_v2_{(request.effective_baseline_ref() or '')[:8]}_{(request.effective_candidate_ref() or '')[:8]}",
        tags=["diff-lens", "compare-v2", request.comparison_type, request.compare_strategy],
    )

    llm = get_llm(
        openai_api_key=runtime["openai_api_key"],
        openai_base_url=runtime["openai_base_url"],
        model=runtime["openai_model"],
        langfuse_public_key=runtime["langfuse_public_key"],
        langfuse_secret_key=runtime["langfuse_secret_key"],
        langfuse_host=runtime["langfuse_host"],
    )
    client = GitLabClient(git_url, git_token)

    async def generate():
        async for event in run_compare_graph_stream(
            request=request,
            client=client,
            project_id=project_id,
            llm=llm,
            prompts=runtime["prompts"],
            tracing_context=tracing_context,
            model_name=runtime["openai_model"],
        ):
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


_job_handlers_registered = False

