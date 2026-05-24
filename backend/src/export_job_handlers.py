"""Background job handlers for export AI workloads."""

import asyncio
import os
from typing import Any, Dict, Optional

from schemas import BatchSummaryRequest, CustomGroupRequest, FieldExtractionRequest, FlatSummaryRequest

from .analysis_cache import build_payload_cache_key, stable_hash


SECRET_FIELDS = {
    "openai_api_key",
    "git_token",
    "langfuse_secret_key",
    "langfuse_public_key",
}


def sanitize_for_job_cache(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        value = value.model_dump()
    if isinstance(value, dict):
        return {
            str(key): bool(item) if key in SECRET_FIELDS else sanitize_for_job_cache(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [sanitize_for_job_cache(item) for item in value]
    if isinstance(value, tuple):
        return [sanitize_for_job_cache(item) for item in value]
    return value


def export_job_cache_key(namespace: str, request: Any, *, endpoint: str) -> str:
    model = getattr(request, "openai_model", None) or os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    base_url = getattr(request, "openai_base_url", None) or os.getenv("OPENAI_BASE_URL") or ""
    api_key = getattr(request, "openai_api_key", None) or os.getenv("OPENAI_API_KEY")
    payload = {
        "request": sanitize_for_job_cache(request),
        "model_config": {
            "model": model,
            "base_url": base_url,
            "temperature": 0.3,
            "api_key_present": bool(api_key),
        },
        "extra": {
            "endpoint": endpoint,
            "job_version": 1,
        },
    }
    return build_payload_cache_key(namespace, payload)


def _get_export_runtime(request: Any, *, session_id: str, tags: list[str]):
    from .export_agents import create_tracing_context, get_export_llm

    api_key = getattr(request, "openai_api_key", None) or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OpenAI API key required")
    llm = get_export_llm(
        openai_api_key=api_key,
        openai_base_url=getattr(request, "openai_base_url", None) or os.getenv("OPENAI_BASE_URL"),
        openai_model=getattr(request, "openai_model", None) or "gpt-4o-mini",
    )
    tracing_context = None
    if getattr(request, "langfuse_public_key", None) and getattr(request, "langfuse_secret_key", None):
        tracing_context = create_tracing_context(
            langfuse_public_key=request.langfuse_public_key,
            langfuse_secret_key=request.langfuse_secret_key,
            langfuse_host=getattr(request, "langfuse_host", None),
            session_id=session_id,
            tags=tags,
        )
    return llm, tracing_context


def _files_payload(request: Any) -> list[Dict[str, Any]]:
    return [file.model_dump() for file in request.files]


async def _collect_generator_events(ctx, generator_factory, *, total_batches: int, progress_phase: str, thinking_phase: Optional[str] = None) -> tuple[list[Dict[str, Any]], Optional[Dict[str, Any]]]:
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    sentinel = object()

    def _worker() -> None:
        try:
            for item in generator_factory():
                loop.call_soon_threadsafe(queue.put_nowait, item)
        except Exception as exc:
            loop.call_soon_threadsafe(queue.put_nowait, exc)
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, sentinel)

    worker_task = asyncio.create_task(asyncio.to_thread(_worker))
    events: list[Dict[str, Any]] = []
    final_data: Optional[Dict[str, Any]] = None

    while True:
        await ctx.raise_if_cancelled()
        item = await queue.get()
        if item is sentinel:
            break
        if isinstance(item, Exception):
            await worker_task
            raise item
        event = item
        events.append(event)
        if event.get("type") == "progress":
            await ctx.update(
                phase=progress_phase,
                message=event.get("message") or "요약 진행 중입니다.",
                current=event.get("completed_batches") or 0,
                total=event.get("total_batches") or total_batches,
            )
        elif event.get("type") == "thinking" and thinking_phase:
            await ctx.update(
                phase=thinking_phase,
                message=event.get("message") or "요약 내용을 정리하고 있습니다.",
                current=event.get("completed_batches") or 0,
                total=event.get("total_batches") or total_batches,
            )
        elif event.get("type") == "result":
            final_data = event.get("data")

    await worker_task
    return events, final_data


async def run_export_extract_fields_job(ctx, payload: Dict[str, Any]) -> Dict[str, Any]:
    from .export_agents import FileFieldExtractorAgent

    request = FieldExtractionRequest(**payload)
    await ctx.update(
        phase="export_extract_prepare",
        message=f"{len(request.files)}개 파일의 추출 필드를 준비하고 있습니다.",
        current=0,
        total=len(request.files),
    )
    await ctx.raise_if_cancelled()
    llm, tracing_context = _get_export_runtime(
        request,
        session_id="export-field-extraction-job",
        tags=["export", "job", "field-extraction"],
    )
    agent = FileFieldExtractorAgent(llm, None, tracing_context)
    results = await agent.extract_batch(
        _files_payload(request),
        [schema.model_dump() for schema in request.schema],
        concurrency=3,
    )
    await ctx.update(
        phase="export_extract_done",
        message="파일별 필드 추출이 완료되었습니다.",
        current=len(request.files),
        total=len(request.files),
    )
    return {
        "success": True,
        "results": results,
        "total_files": len(results),
        "schema_keys": [schema.key for schema in request.schema],
    }


async def run_export_batch_summary_job(ctx, payload: Dict[str, Any]) -> Dict[str, Any]:
    from .export_agents import BatchSummaryAgent

    request = BatchSummaryRequest(**payload)
    await ctx.update(
        phase="export_batch_prepare",
        message=f"{len(request.files)}개 파일의 요약 배치를 준비하고 있습니다.",
        current=0,
        total=len(request.files),
    )
    await ctx.raise_if_cancelled()
    llm, tracing_context = _get_export_runtime(
        request,
        session_id=f"export-batch-summary-job-{request.summary_type}",
        tags=["export", "job", "batch-summary", request.summary_type],
    )
    agent = BatchSummaryAgent(llm, None, tracing_context)
    files = _files_payload(request)
    custom_groups = [group.model_dump() for group in request.custom_groups] if request.custom_groups else None
    result = await asyncio.to_thread(
        agent.run,
        files=files,
        summary_type=request.summary_type,
        batch_size=request.batch_size,
        custom_groups=custom_groups,
    )
    await ctx.update(
        phase="export_batch_done",
        message="배치 요약이 완료되었습니다.",
        current=len(request.files),
        total=len(request.files),
    )
    return {"success": True, **result}


async def run_export_custom_group_job(ctx, payload: Dict[str, Any]) -> Dict[str, Any]:
    from .export_agents import CustomGroupExportAgent

    request = CustomGroupRequest(**payload)
    await ctx.update(
        phase="export_custom_group_prepare",
        message=f"{len(request.files)}개 파일을 사용자 그룹 기준으로 추출하고 있습니다.",
        current=0,
        total=len(request.files),
    )
    await ctx.raise_if_cancelled()
    llm, tracing_context = _get_export_runtime(
        request,
        session_id="export-custom-group-job",
        tags=["export", "job", "custom-group"],
    )
    agent = CustomGroupExportAgent(llm, None, tracing_context)
    result = await asyncio.to_thread(
        agent.run,
        files=_files_payload(request),
        groups=[group.model_dump() for group in request.groups],
    )
    await ctx.update(
        phase="export_custom_group_done",
        message="사용자 그룹 추출이 완료되었습니다.",
        current=len(request.files),
        total=len(request.files),
    )
    return {
        "success": True,
        "groups": result,
        "total_files": len(request.files),
        "group_names": [group.name for group in request.groups],
    }


async def run_export_flat_summary_job(ctx, payload: Dict[str, Any]) -> Dict[str, Any]:
    from .export_agents import BatchSummaryAgent

    request = FlatSummaryRequest(**payload)
    await ctx.update(
        phase="export_flat_prepare",
        message=f"{len(request.files)}개 파일의 FLAT 요약을 준비하고 있습니다.",
        current=0,
        total=len(request.files),
    )
    await ctx.raise_if_cancelled()
    llm, tracing_context = _get_export_runtime(
        request,
        session_id="export-flat-summary-job",
        tags=["export", "job", "flat"],
    )
    agent = BatchSummaryAgent(llm, None, tracing_context)
    result = await asyncio.to_thread(
        agent.run_flat,
        files=_files_payload(request),
        template_type=request.template_type,
        batch_size=request.batch_size,
        custom_config=request.custom_config,
    )
    await ctx.update(
        phase="export_flat_done",
        message="FLAT 요약이 완료되었습니다.",
        current=len(request.files),
        total=len(request.files),
    )
    return {"success": True, **result}


async def run_export_batch_summary_stream_job(ctx, payload: Dict[str, Any]) -> Dict[str, Any]:
    from .export_agents import BatchSummaryAgent

    request = BatchSummaryRequest(**payload)
    llm, tracing_context = _get_export_runtime(
        request,
        session_id="export-batch-summary-stream-job",
        tags=["export", "job", "batch", "stream"],
    )
    agent = BatchSummaryAgent(llm, None, tracing_context)
    files = _files_payload(request)
    custom_groups = [group.model_dump() for group in request.custom_groups] if request.custom_groups else None
    total_batches = max(1, (len(files) + max(request.batch_size, 1) - 1) // max(request.batch_size, 1))
    await ctx.update(phase="export_batch_stream", message="배치 요약 스트림을 시작합니다.", current=0, total=total_batches)
    events, final_data = await _collect_generator_events(
        ctx,
        lambda: agent.run_generator(
            files=files,
            summary_type=request.summary_type,
            batch_size=request.batch_size,
            custom_groups=custom_groups,
        ),
        total_batches=total_batches,
        progress_phase="export_batch_stream",
        thinking_phase="export_batch_thinking",
    )
    await ctx.update(phase="export_batch_done", message="배치 요약이 완료되었습니다.", current=total_batches, total=total_batches)
    return {
        "success": True,
        "events": events,
        "data": final_data,
        "event_hash": stable_hash(events),
    }


async def run_export_flat_summary_stream_job(ctx, payload: Dict[str, Any]) -> Dict[str, Any]:
    from .export_agents import BatchSummaryAgent

    request = FlatSummaryRequest(**payload)
    llm, tracing_context = _get_export_runtime(
        request,
        session_id="export-flat-summary-stream-job",
        tags=["export", "job", "flat", "stream"],
    )
    agent = BatchSummaryAgent(llm, None, tracing_context)
    files = _files_payload(request)
    total_batches = max(1, (len(files) + max(request.batch_size, 1) - 1) // max(request.batch_size, 1))
    await ctx.update(phase="export_flat_stream", message="FLAT 요약 스트림을 시작합니다.", current=0, total=total_batches)
    events, final_data = await _collect_generator_events(
        ctx,
        lambda: agent.run_flat_generator(
            files=files,
            template_type=request.template_type,
            batch_size=request.batch_size,
            custom_config=request.custom_config,
        ),
        total_batches=total_batches,
        progress_phase="export_flat_stream",
    )
    await ctx.update(phase="export_flat_done", message="FLAT 요약이 완료되었습니다.", current=total_batches, total=total_batches)
    return {
        "success": True,
        "events": events,
        "data": final_data,
        "event_hash": stable_hash(events),
    }
