from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlmodel import Session

from routers.compare_v2 import merge_check_v2, preview_compare_v2
from routers.legacy_git import _analyze_history_impl, preview_changes
from src import GitLabClient
from src.agents import CategoryAgent, SummaryGeneratorAgent, create_tracing_context, get_llm
from src.analysis_cache import (
    build_analysis_cache_key,
    claim_inflight,
    get_cached_payload,
    resolve_inflight,
    set_cached_payload,
    update_inflight_progress,
    wait_for_inflight_payload,
)
from src.analysis_graph import run_compare_graph_stream
from src.analysis_services import normalize_analysis_sort, run_standard_analysis, sort_file_changes_for_analysis
from src.api_shared import (
    _ai_request_cache_key,
    _cacheable_response_payload,
    _generate_local_risk_review_payload,
    _parse_sse_json_events,
    _resolve_legacy_analysis_runtime,
    _risk_review_cache_key,
    _risk_review_run_cache_key,
    job_runner,
    logger,
    resolve_compare_v2_runtime,
)
from src.database import engine
from src.export_job_handlers import (
    run_export_batch_summary_job,
    run_export_batch_summary_stream_job,
    run_export_custom_group_job,
    run_export_extract_fields_job,
    run_export_flat_summary_job,
    run_export_flat_summary_stream_job,
)
from src.merge_plan_jobs import merge_plan_v1_job_cache_identity, run_merge_plan_v1_job
from src.models import AnalyzeRequest, CompareV2Request, HistoryAnalysisRequest, MergePlanRequest, PreviewRequest, RiskReviewRequest, RiskReviewRunRequest

_job_handlers_registered = False


def _job_response(job: Dict[str, Any], *, cache_hit: bool = False, result: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    payload = {
        "schema_version": "job.1",
        "job_id": job.get("job_id"),
        "job_type": job.get("job_type"),
        "status": job.get("status"),
        "phase": job.get("phase"),
        "message": job.get("message"),
        "cache_hit": cache_hit,
        "cache_key": (job.get("cache_key") or "")[-16:],
        "progress": job.get("progress") or {},
        "error": job.get("error"),
        "created_at": job.get("created_at"),
        "updated_at": job.get("updated_at"),
        "started_at": job.get("started_at"),
        "completed_at": job.get("completed_at"),
    }
    if result is not None:
        payload["result"] = result
    elif job.get("status") == "completed":
        payload["result"] = job.get("result")
    return payload


def _compare_v2_has_sha_lock(request: CompareV2Request) -> bool:
    return bool(request.baseline_sha and request.candidate_sha)


def _compare_v2_job_cache_identity(request: CompareV2Request, session: Session) -> tuple[str, bool]:
    runtime = resolve_compare_v2_runtime(request, session)
    project_id = runtime["project_id"]
    if not (runtime["git_url"] and runtime["git_token"] and project_id):
        raise HTTPException(status_code=400, detail="Git Configuration Missing")

    has_sha_lock = _compare_v2_has_sha_lock(request)
    namespace = "job_compare_v2" if has_sha_lock else "job_compare_v2_pending"
    return _ai_request_cache_key(
        namespace,
        {
            **request.model_dump(),
            "baseline_ref": request.effective_baseline_ref(),
            "candidate_ref": request.effective_candidate_ref(),
        },
        model_config={
            "model": runtime["openai_model"],
            "base_url": runtime["openai_base_url"] or "",
            "api_key_present": bool(runtime["openai_api_key"]),
        },
        extra={
            "project_id": project_id,
            "baseline_sha": request.baseline_sha if has_sha_lock else None,
            "candidate_sha": request.candidate_sha if has_sha_lock else None,
            "compare_strategy": request.compare_strategy,
            "prompts": runtime["prompts"],
            "job_version": 1,
        },
    ), has_sha_lock


def _compare_v2_git_job_cache_identity(namespace: str, request: CompareV2Request, session: Session, *, job_version: int = 1) -> tuple[str, bool]:
    runtime = resolve_compare_v2_runtime(request, session)
    project_id = runtime["project_id"]
    if not (runtime["git_url"] and runtime["git_token"] and project_id):
        raise HTTPException(status_code=400, detail="Git Configuration Missing")

    has_sha_lock = _compare_v2_has_sha_lock(request)
    effective_namespace = namespace if has_sha_lock else f"{namespace}_pending"
    return _ai_request_cache_key(
        effective_namespace,
        {
            **request.model_dump(),
            "baseline_ref": request.effective_baseline_ref(),
            "candidate_ref": request.effective_candidate_ref(),
        },
        extra={
            "project_id": project_id,
            "baseline_sha": request.baseline_sha if has_sha_lock else None,
            "candidate_sha": request.candidate_sha if has_sha_lock else None,
            "compare_strategy": request.compare_strategy,
            "job_version": job_version,
        },
    ), has_sha_lock


def _merge_plan_v1_job_cache_identity(request: MergePlanRequest, session: Session) -> tuple[str, bool]:
    return merge_plan_v1_job_cache_identity(
        request,
        session,
        resolve_runtime=resolve_compare_v2_runtime,
        build_cache_key=_ai_request_cache_key,
    )


async def _run_compare_v2_job(ctx, payload: Dict[str, Any]) -> Dict[str, Any]:
    request = CompareV2Request(**payload)
    with Session(engine) as session:
        runtime = resolve_compare_v2_runtime(request, session)
    git_url = runtime["git_url"]
    git_token = runtime["git_token"]
    project_id = runtime["project_id"]
    if not (git_url and git_token and project_id):
        raise ValueError("Git Configuration Missing")

    tracing_context = create_tracing_context(
        langfuse_public_key=runtime["langfuse_public_key"],
        langfuse_secret_key=runtime["langfuse_secret_key"],
        langfuse_host=runtime["langfuse_host"],
        session_id=f"job_compare_v2_{int(time.time())}",
        tags=["diff-lens", "job", "compare-v2", request.comparison_type, request.compare_strategy],
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
    final_result = None
    await ctx.update(phase="starting", message="배포 전 AI 분석 작업을 준비하고 있습니다.", current=0, total=0)
    async for event in run_compare_graph_stream(
        request=request,
        client=client,
        project_id=project_id,
        llm=llm,
        prompts=runtime["prompts"],
        tracing_context=tracing_context,
        model_name=runtime["openai_model"],
    ):
        await ctx.raise_if_cancelled()
        payload_data = event.get("payload") or {}
        event_name = event.get("event") or event.get("phase")
        current = payload_data.get("current")
        total = payload_data.get("total") or payload_data.get("file_count")
        message = payload_data.get("message") or event_name
        file_value = payload_data.get("file")
        if isinstance(file_value, dict):
            file_value = file_value.get("path")
        if event_name == "compare_fetched":
            current = 0
        if event_name == "complete":
            final_result = payload_data
        await ctx.update(
            phase=event.get("phase") or event_name,
            message=message,
            current=current,
            total=total,
            node=event.get("node"),
            event=event_name,
            file=file_value,
            cache_hit=payload_data.get("cache_hit"),
            cache_hits=payload_data.get("cache_hits"),
        )
    if final_result is None:
        raise RuntimeError("Compare v2 job finished without a complete result.")
    return final_result


async def _run_compare_preview_v2_job(ctx, payload: Dict[str, Any]) -> Dict[str, Any]:
    request = CompareV2Request(**payload)
    await ctx.update(phase="preview_prepare", message="기준/개발 버전의 변경표를 준비합니다.", current=0, total=3)

    def _build_preview() -> Dict[str, Any]:
        with Session(engine) as session:
            result = preview_compare_v2(request, session)
            return result.model_dump() if hasattr(result, "model_dump") else dict(result)

    await ctx.update(phase="preview_compare", message="Git compare 결과를 가져오고 있습니다.", current=1, total=3)
    result = await asyncio.to_thread(_build_preview)
    await ctx.update(
        phase="preview_done",
        message=f"변경표 준비 완료: {result.get('file_count', 0)}개 파일",
        current=3,
        total=3,
    )
    return result


async def _run_merge_check_v2_job(ctx, payload: Dict[str, Any]) -> Dict[str, Any]:
    request = CompareV2Request(**payload)
    await ctx.update(phase="merge_check_prepare", message="dry-run 충돌 확인을 준비합니다.", current=0, total=5)

    def _check_merge() -> Dict[str, Any]:
        with Session(engine) as session:
            result = merge_check_v2(request, session)
            return result.model_dump() if hasattr(result, "model_dump") else dict(result)

    await ctx.update(phase="merge_check_refs", message="기준/개발 ref를 확인합니다.", current=1, total=5)
    await ctx.update(phase="merge_check_workspace", message="임시 병합 작업공간을 준비합니다.", current=2, total=5)
    result = await asyncio.to_thread(_check_merge)
    await ctx.update(
        phase="merge_check_done",
        message=result.get("message") or "dry-run 충돌 확인이 완료되었습니다.",
        current=5,
        total=5,
    )
    return result


async def _run_merge_plan_v1_job(ctx, payload: Dict[str, Any]) -> Dict[str, Any]:
    return await run_merge_plan_v1_job(
        ctx,
        payload,
        engine=engine,
        resolve_runtime=resolve_compare_v2_runtime,
        create_tracing_context=create_tracing_context,
        get_llm=get_llm,
        set_cached_payload=set_cached_payload,
    )


async def _run_legacy_preview_job(ctx, payload: Dict[str, Any]) -> Dict[str, Any]:
    request = PreviewRequest(**payload)
    await ctx.update(phase="preview_prepare", message="커밋 변경표를 준비합니다.", current=0, total=2)
    result = await asyncio.to_thread(preview_changes, request)
    data = result.model_dump() if hasattr(result, "model_dump") else dict(result)
    await ctx.update(
        phase="preview_done",
        message=f"변경표 준비 완료: {data.get('file_count', 0)}개 파일",
        current=2,
        total=2,
    )
    return data


async def _run_risk_prompt_job(ctx, payload: Dict[str, Any]) -> Dict[str, Any]:
    request = RiskReviewRequest(**payload)
    total = len(request.files)
    await ctx.update(phase="collecting", message="리스크 파일 목록을 정리하고 있습니다.", current=0, total=total)
    await asyncio.sleep(0)
    await ctx.raise_if_cancelled()
    await ctx.update(phase="diffs", message="diff와 리스크 근거를 검토 요청 문서로 묶고 있습니다.", current=max(1, total // 2), total=total)
    result = _generate_local_risk_review_payload(request, cache_key=_risk_review_cache_key(request))
    await ctx.update(phase="finalizing", message="검토 요청 프롬프트가 준비되었습니다.", current=total, total=total)
    return result


async def _run_risk_review_run_job(ctx, payload: Dict[str, Any]) -> Dict[str, Any]:
    request = RiskReviewRunRequest(**payload)
    prompt = (request.prompt or "").strip()
    if not prompt:
        raise ValueError("실행할 검토 요청 프롬프트가 비어 있습니다.")

    total = max(3, len(request.files) or 3)
    cache_key = _risk_review_run_cache_key(request)
    await ctx.update(
        phase="review_prepare",
        message="검토 프롬프트와 리스크 파일 근거를 AI 입력으로 준비합니다.",
        current=1,
        total=total,
        file_count=len(request.files),
    )
    await ctx.raise_if_cancelled()

    model = request.openai_model or os.getenv("OPENAI_MODEL") or os.getenv("OPENAI_API_MODEL") or "gpt-4o-mini"
    llm = get_llm(
        model=model,
        temperature=0.1,
        openai_api_key=request.openai_api_key,
        openai_base_url=request.openai_base_url,
        langfuse_public_key=request.langfuse_public_key,
        langfuse_secret_key=request.langfuse_secret_key,
        langfuse_host=request.langfuse_host,
        enable_cache=True,
    )
    if not llm:
        raise ValueError("OpenAI API key가 설정되어 있지 않아 앱 안에서 AI 검토를 실행할 수 없습니다.")

    await ctx.update(
        phase="review_llm",
        message="AI가 검토 요청 프롬프트를 실행하고 있습니다.",
        current=max(2, total // 2),
        total=total,
        model=model,
    )
    await ctx.raise_if_cancelled()

    def _invoke_review() -> str:
        response = llm.invoke(prompt)
        content = getattr(response, "content", response)
        if isinstance(content, list):
            parts = []
            for item in content:
                if isinstance(item, dict):
                    parts.append(str(item.get("text") or item.get("content") or item))
                else:
                    parts.append(str(item))
            return "\n".join(parts).strip()
        return str(content).strip()

    review_result = await asyncio.to_thread(_invoke_review)
    await ctx.raise_if_cancelled()
    if not review_result:
        raise ValueError("AI 검토 결과가 비어 있습니다.")

    await ctx.update(
        phase="review_done",
        message="AI 검토 결과를 정리했습니다.",
        current=total,
        total=total,
        model=model,
    )
    return _cacheable_response_payload(
        {
            "review_result": review_result,
            "file_count": len(request.files),
            "generation_mode": "llm",
            "model": model,
            "prompt_chars": len(prompt),
        },
        cache_key,
    )


async def _run_history_job(ctx, payload: Dict[str, Any]) -> Dict[str, Any]:
    request = HistoryAnalysisRequest(**payload)
    await ctx.update(phase="history_queued", message=f"{request.file_path} 커밋 흐름 분석을 준비합니다.", current=0, total=3, file=request.file_path)
    await ctx.raise_if_cancelled()
    loop = asyncio.get_running_loop()

    def _progress_callback(**progress):
        future = asyncio.run_coroutine_threadsafe(ctx.update(**progress), loop)
        try:
            future.result(timeout=5)
        except Exception as exc:
            logger.warning("History job progress update failed: %s", exc)

    response = await asyncio.to_thread(_analyze_history_impl, request, _progress_callback)
    commits_analyzed = getattr(response, "commits_analyzed", None) or 0
    await ctx.update(
        phase="complete",
        message=f"커밋 흐름 분석이 완료되었습니다. {commits_analyzed}개 커밋을 정리했습니다.",
        current=commits_analyzed,
        total=commits_analyzed,
        file=request.file_path,
    )
    return response.model_dump() if hasattr(response, "model_dump") else dict(response)


def _resolve_legacy_analysis_runtime(request: AnalyzeRequest) -> Dict[str, Any]:
    with Session(engine) as session:
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
        if request.branch and not request.target_commit:
            request.target_commit = request.branch

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

        prompts = get_prompts_for_profile(session, profile_id)

    if not git_url or not git_token or not project_id:
        raise ValueError("Missing Git Configuration (ID or fields)")

    return {
        "git_url": git_url,
        "git_token": git_token,
        "project_id": project_id,
        "profile_id": profile_id,
        "openai_api_key": openai_api_key,
        "openai_base_url": openai_base_url,
        "openai_model": openai_model or "gpt-4o-mini",
        "langfuse_public_key": langfuse_public_key,
        "langfuse_secret_key": langfuse_secret_key,
        "langfuse_host": langfuse_host,
        "prompts": prompts,
    }


def _parse_sse_json_events(chunk: str) -> List[Dict[str, Any]]:
    events: List[Dict[str, Any]] = []
    for line in chunk.splitlines():
        line = line.strip()
        if not line.startswith("data:"):
            continue
        try:
            events.append(json.loads(line[5:].strip()))
        except Exception:
            logger.debug("Failed to parse SSE event from legacy analysis job: %s", line)
    return events


async def _run_legacy_analyze_job(ctx, payload: Dict[str, Any]) -> Dict[str, Any]:
    request = AnalyzeRequest(**payload)
    await ctx.update(
        phase="fetch",
        message="GitLab에서 변경사항을 가져올 준비를 합니다.",
        current=0,
        total=request.max_files or 0,
    )
    await ctx.raise_if_cancelled()

    runtime = await asyncio.to_thread(_resolve_legacy_analysis_runtime, request)
    tracing_context = create_tracing_context(
        langfuse_public_key=runtime["langfuse_public_key"],
        langfuse_secret_key=runtime["langfuse_secret_key"],
        langfuse_host=runtime["langfuse_host"],
        session_id=f"job_{(request.base_commit or 'base')[:8]}",
        tags=["diff-lens", "job-analysis", request.analysis_mode or "full"],
    )
    analysis_cache_key = None
    owns_analysis_key = False

    try:
        await ctx.update(phase="fetch", message="GitLab에서 변경 파일과 커밋 범위를 가져오고 있습니다.", current=0, total=0)
        client = GitLabClient(runtime["git_url"], runtime["git_token"])
        commits, file_changes = await asyncio.to_thread(
            client.fetch_changes,
            runtime["project_id"],
            request.base_commit,
            request.target_commit,
            request.author_filter,
        )

        raw_file_count = len(file_changes)
        status_filter = (request.file_status_filter or "all").lower()
        if status_filter != "all":
            allowed_statuses = {"added", "modified", "deleted", "renamed"}
            if status_filter not in allowed_statuses:
                raise ValueError(f"Unsupported file status filter: {status_filter}")
            file_changes = [f for f in file_changes if f.status == status_filter]

        scoped_file_count = len(file_changes)
        sort_key = normalize_analysis_sort(request.analysis_sort)
        file_changes = sort_file_changes_for_analysis(file_changes, sort_key)
        if request.max_files and request.max_files > 0:
            file_changes = file_changes[:request.max_files]

        total_files = len(file_changes)
        await ctx.update(
            phase="fetch_done",
            message=f"분석 대상 {total_files}개 파일을 준비했습니다.",
            current=0,
            total=total_files,
            commits=len(commits),
            raw_file_count=raw_file_count,
            scope_file_count=scoped_file_count,
            file_status_filter=status_filter,
            max_files=request.max_files,
            analysis_sort=sort_key,
        )
        await ctx.raise_if_cancelled()

        if total_files == 0:
            return {
                "phase": "complete",
                "mode": request.analysis_mode,
                "files": [],
                "summary": "선택한 범위에 해당하는 변경 파일이 없습니다.",
                "commit_count": len(commits),
                "total_additions": 0,
                "total_deletions": 0,
                "raw_file_count": raw_file_count,
                "scope_file_count": scoped_file_count,
                "analysis_file_count": 0,
                "file_status_filter": status_filter,
                "max_files": request.max_files,
                "analysis_sort": sort_key,
            }

        if request.analysis_mode in ["quick", "full"]:
            commit_ids = [
                c.get("full_sha") or c.get("id") or c.get("short_id") or ""
                for c in commits
            ]
            analysis_cache_key = build_analysis_cache_key(
                namespace=f"analysis:{request.analysis_mode}",
                repo_identity={
                    "git_url": runtime["git_url"],
                    "project_id": runtime["project_id"],
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
                    "model": runtime["openai_model"],
                    "base_url": runtime["openai_base_url"] or "",
                    "temperature": 0.3,
                    "api_key_present": bool(runtime["openai_api_key"]),
                },
                prompts=runtime["prompts"],
                commit_ids=commit_ids,
                files=file_changes,
            )
            cached_result = get_cached_payload(analysis_cache_key)
            if cached_result:
                cached_result["phase"] = "complete"
                cached_result["cache_hit"] = True
                cached_result["cache_key"] = analysis_cache_key[-16:]
                cached_result["cache_hits"] = cached_result.pop("_cache_hits", 1)
                await ctx.update(
                    phase="cache_hit",
                    message="동일 조건 분석 결과를 캐시에서 재사용합니다.",
                    current=total_files,
                    total=total_files,
                    cache_key=analysis_cache_key[-16:],
                    cache_hits=cached_result["cache_hits"],
                )
                return cached_result

            owns_analysis_key, analysis_event = claim_inflight(analysis_cache_key)
            if not owns_analysis_key:
                await ctx.update(
                    phase="cache_wait",
                    message="동일 조건 분석이 이미 진행 중입니다. 완료 결과를 기다립니다.",
                    current=0,
                    total=total_files,
                    cache_key=analysis_cache_key[-16:],
                )
                waited = await wait_for_inflight_payload(analysis_cache_key, analysis_event, timeout=900)
                if waited:
                    waited["phase"] = "complete"
                    waited["cache_hit"] = True
                    waited["cache_waited"] = True
                    waited["cache_key"] = analysis_cache_key[-16:]
                    waited["cache_hits"] = waited.pop("_cache_hits", 1)
                    return waited
                owns_analysis_key, _analysis_event = claim_inflight(analysis_cache_key)

            if owns_analysis_key:
                update_inflight_progress(analysis_cache_key, {
                    "phase": "fetch_done",
                    "message": f"분석 대상 {total_files}개 파일 준비",
                    "current": 0,
                    "total": total_files,
                    "analysis_mode": request.analysis_mode,
                })

        llm = get_llm(
            openai_api_key=runtime["openai_api_key"],
            openai_base_url=runtime["openai_base_url"],
            model=runtime["openai_model"],
            langfuse_public_key=runtime["langfuse_public_key"],
            langfuse_secret_key=runtime["langfuse_secret_key"],
            langfuse_host=runtime["langfuse_host"],
        )

        if llm:
            async for chunk in run_standard_analysis(
                file_changes,
                request,
                llm,
                runtime["prompts"],
                tracing_context,
                progress_key=analysis_cache_key,
            ):
                for event in _parse_sse_json_events(chunk):
                    phase = event.get("phase") or "analyzing"
                    if phase in {"analyzing", "file_done"}:
                        await ctx.update(
                            phase=phase,
                            message=(
                                f"{event.get('current', 0)}/{event.get('total', total_files)} 파일 분석 완료"
                                if phase == "file_done"
                                else event.get("message", "파일별 AI 분석 중...")
                            ),
                            current=event.get("current", 0),
                            total=event.get("total", total_files),
                            file=event.get("file"),
                            elapsed_seconds=event.get("elapsed_seconds"),
                            duration_seconds=event.get("duration_seconds"),
                            average_seconds=event.get("average_seconds"),
                            estimated_remaining_seconds=event.get("estimated_remaining_seconds"),
                            cache_completed_count=event.get("cache_completed_count"),
                            concurrency=event.get("concurrency"),
                        )
                await ctx.raise_if_cancelled()
        else:
            await ctx.update(
                phase="analyzing",
                message="OpenAI API key가 없어 파일별 AI 메모를 건너뜁니다.",
                current=total_files,
                total=total_files,
            )

        if request.analysis_mode in ["quick", "history"]:
            summary = "📋 빠른 모드에서는 파일별 분석만 수행됩니다."
            categories = {}
        else:
            await ctx.update(
                phase="categorizing",
                message="파일 변경 유형을 분류하고 있습니다.",
                current=total_files,
                total=total_files,
            )
            categories = await asyncio.to_thread(CategoryAgent(llm, runtime["prompts"]).run, file_changes) if llm else {}
            await ctx.raise_if_cancelled()

            await ctx.update(
                phase="summarizing",
                message="선택 범위 요약을 생성하고 있습니다.",
                current=total_files,
                total=total_files,
            )
            if llm:
                summary_agent = SummaryGeneratorAgent(llm, runtime["prompts"], tracing_context)
                summary = await summary_agent.arun(commits, file_changes, categories)
            else:
                summary = "⚠️ OpenAI API key not configured."

        total_additions = sum(f.additions for f in file_changes)
        total_deletions = sum(f.deletions for f in file_changes)
        analysis_error_count = sum(
            1
            for f in file_changes
            if (getattr(f, "ai_summary", "") or "").startswith("분석 중 오류")
        )
        result = {
            "phase": "complete",
            "mode": request.analysis_mode,
            "files": [f.model_dump() for f in file_changes],
            "summary": summary,
            "commit_count": len(commits),
            "total_additions": total_additions,
            "total_deletions": total_deletions,
            "raw_file_count": raw_file_count,
            "scope_file_count": scoped_file_count,
            "analysis_file_count": len(file_changes),
            "file_status_filter": status_filter,
            "max_files": request.max_files,
            "analysis_sort": sort_key,
            "cache_hit": False,
            "cache_key": analysis_cache_key[-16:] if analysis_cache_key else None,
            "analysis_error_count": analysis_error_count,
            "cache_write_skipped_reason": "analysis_errors" if analysis_error_count else None,
        }
        if analysis_cache_key and owns_analysis_key and analysis_error_count == 0 and llm:
            set_cached_payload(analysis_cache_key, f"analysis:{request.analysis_mode}", result)

        await ctx.update(
            phase="legacy_analyze_done",
            message="커밋 비교 AI 분석이 완료되었습니다.",
            current=total_files,
            total=total_files,
        )
        return result
    finally:
        if owns_analysis_key and analysis_cache_key:
            resolve_inflight(analysis_cache_key)
        if tracing_context:
            tracing_context.flush()


def register_job_handlers() -> None:
    global _job_handlers_registered
    if _job_handlers_registered:
        return
    job_runner.register("compare_v2", _run_compare_v2_job, timeout_seconds=float(os.getenv("JOB_TIMEOUT_COMPARE_V2", "1800")))
    job_runner.register("compare_preview_v2", _run_compare_preview_v2_job, timeout_seconds=float(os.getenv("JOB_TIMEOUT_COMPARE_PREVIEW_V2", "900")))
    job_runner.register("merge_check_v2", _run_merge_check_v2_job, timeout_seconds=float(os.getenv("JOB_TIMEOUT_MERGE_CHECK_V2", "600")))
    job_runner.register("merge_plan_v1", _run_merge_plan_v1_job, timeout_seconds=float(os.getenv("JOB_TIMEOUT_MERGE_PLAN_V1", "1200")))
    job_runner.register("legacy_preview", _run_legacy_preview_job, timeout_seconds=float(os.getenv("JOB_TIMEOUT_PREVIEW", "900")))
    job_runner.register("legacy_analyze", _run_legacy_analyze_job, timeout_seconds=float(os.getenv("JOB_TIMEOUT_ANALYZE", "1800")))
    job_runner.register("risk_prompt", _run_risk_prompt_job, timeout_seconds=float(os.getenv("JOB_TIMEOUT_RISK_PROMPT", "120")))
    job_runner.register("risk_review_run", _run_risk_review_run_job, timeout_seconds=float(os.getenv("JOB_TIMEOUT_RISK_REVIEW_RUN", "600")))
    job_runner.register("history", _run_history_job, timeout_seconds=float(os.getenv("JOB_TIMEOUT_HISTORY", "900")))
    job_runner.register("export_extract_fields", run_export_extract_fields_job, timeout_seconds=float(os.getenv("JOB_TIMEOUT_EXPORT_EXTRACT", "600")))
    job_runner.register("export_batch_summary", run_export_batch_summary_job, timeout_seconds=float(os.getenv("JOB_TIMEOUT_EXPORT_BATCH", "1200")))
    job_runner.register("export_custom_group", run_export_custom_group_job, timeout_seconds=float(os.getenv("JOB_TIMEOUT_EXPORT_CUSTOM", "1200")))
    job_runner.register("export_flat_summary", run_export_flat_summary_job, timeout_seconds=float(os.getenv("JOB_TIMEOUT_EXPORT_FLAT", "1200")))
    job_runner.register("export_batch_summary_stream", run_export_batch_summary_stream_job, timeout_seconds=float(os.getenv("JOB_TIMEOUT_EXPORT_BATCH_STREAM", "1200")))
    job_runner.register("export_flat_summary_stream", run_export_flat_summary_stream_job, timeout_seconds=float(os.getenv("JOB_TIMEOUT_EXPORT_FLAT_STREAM", "1200")))
    _job_handlers_registered = True
