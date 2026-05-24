"""Job glue for merge-plan dry-run analysis."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Callable, Dict, Tuple

from fastapi import HTTPException
from sqlmodel import Session

from .git_client import GitLabClient
from .merge_plan_review_agent import MergePlanReviewAgent, fallback_merge_plan_review
from .merge_plan_service import MergePlanService, merge_plan_result_is_cacheable
from .models import MergePlanRequest

logger = logging.getLogger("diff-lens.merge_plan_job")


def merge_plan_v1_job_cache_identity(
    request: MergePlanRequest,
    session: Session,
    *,
    resolve_runtime: Callable[[MergePlanRequest, Session], Dict[str, Any]],
    build_cache_key: Callable[..., str],
) -> Tuple[str, bool]:
    runtime = resolve_runtime(request, session)
    project_id = runtime["project_id"]
    if not (runtime["git_url"] and runtime["git_token"] and project_id):
        raise HTTPException(status_code=400, detail="Git Configuration Missing")

    candidate_locks = [
        {
            "id": candidate.id,
            "ref": candidate.ref,
            "sha": candidate.sha,
            "order": index + 1,
        }
        for index, candidate in enumerate(request.candidates or [])
    ]
    has_sha_lock = bool(request.target_sha and candidate_locks and all(item.get("sha") for item in candidate_locks))
    return build_cache_key(
        "job_merge_plan_v1" if has_sha_lock else "job_merge_plan_v1_pending",
        {
            **request.model_dump(exclude={"force_refresh"}),
            "target_ref": request.target_ref,
            "candidate_locks": candidate_locks,
        },
        model_config={
            "model": runtime["openai_model"] if request.include_ai_review else "",
            "base_url": (runtime["openai_base_url"] or "") if request.include_ai_review else "",
            "api_key_present": bool(runtime["openai_api_key"]) if request.include_ai_review else False,
        },
        extra={
            "project_id": project_id,
            "target_sha": request.target_sha if has_sha_lock else None,
            "candidate_shas": [item.get("sha") for item in candidate_locks] if has_sha_lock else [],
            "candidate_order": [item.get("id") for item in candidate_locks],
            "include_ai_review": bool(request.include_ai_review),
            "review_style": request.review_style or "balanced",
            "prompts": runtime["prompts"].get("merge_plan_reviewer") if request.include_ai_review else None,
            "job_version": 5,
        },
    ), has_sha_lock


async def run_merge_plan_v1_job(
    ctx: Any,
    payload: Dict[str, Any],
    *,
    engine: Any,
    resolve_runtime: Callable[[MergePlanRequest, Session], Dict[str, Any]],
    create_tracing_context: Callable[..., Any],
    get_llm: Callable[..., Any],
    set_cached_payload: Callable[[str, str, Dict[str, Any]], Any],
) -> Dict[str, Any]:
    request = MergePlanRequest(**payload)
    cache_key = payload.get("_job_cache_key")
    await ctx.update(phase="merge_plan_prepare", message="통합 머지 플랜 dry-run을 준비합니다.", current=0, total=5)
    with Session(engine) as session:
        runtime = resolve_runtime(request, session)
    git_url = runtime["git_url"]
    git_token = runtime["git_token"]
    project_id = runtime["project_id"]
    if not (git_url and git_token and project_id):
        raise ValueError("Git Configuration Missing")

    loop = asyncio.get_running_loop()

    def _progress_callback(**progress: Any) -> None:
        future = asyncio.run_coroutine_threadsafe(ctx.update(**progress), loop)
        try:
            future.result(timeout=5)
        except Exception as exc:
            logger.warning("Merge plan progress update failed: %s", exc)

    def _run_plan() -> Dict[str, Any]:
        client = GitLabClient(git_url, git_token)
        return MergePlanService(client, project_id).run(request, progress=_progress_callback)

    result = await asyncio.to_thread(_run_plan)
    await ctx.raise_if_cancelled()

    if request.include_ai_review:
        await ctx.update(phase="merge_plan_review", message="AI가 충돌 원인과 다음 확인 순서를 정리합니다.", current=4, total=5)
        tracing_context = create_tracing_context(
            langfuse_public_key=runtime["langfuse_public_key"],
            langfuse_secret_key=runtime["langfuse_secret_key"],
            langfuse_host=runtime["langfuse_host"],
            session_id=f"merge_plan_v1_{int(time.time())}",
            tags=["diff-lens", "job", "merge-plan-v1", result.get("status", "unknown")],
        )
        llm = get_llm(
            openai_api_key=runtime["openai_api_key"],
            openai_base_url=runtime["openai_base_url"],
            model=runtime["openai_model"],
            langfuse_public_key=runtime["langfuse_public_key"],
            langfuse_secret_key=runtime["langfuse_secret_key"],
            langfuse_host=runtime["langfuse_host"],
        )
        try:
            if llm:
                result["ai_review"] = await asyncio.to_thread(
                    MergePlanReviewAgent(llm, runtime["prompts"], tracing_context).run,
                    result,
                    request.review_style or "balanced",
                )
            else:
                result["ai_review"] = fallback_merge_plan_review(result)
        finally:
            if tracing_context:
                tracing_context.flush()
    else:
        result["ai_review"] = fallback_merge_plan_review(result)

    result.setdefault("diagnostics", {})["cacheable"] = merge_plan_result_is_cacheable(result)
    if cache_key and merge_plan_result_is_cacheable(result):
        await asyncio.to_thread(set_cached_payload, cache_key, "job:merge_plan_v1", result)

    await ctx.update(
        phase="merge_plan_done",
        message="통합 머지 플랜 검토가 완료되었습니다.",
        current=5,
        total=5,
    )
    return result
