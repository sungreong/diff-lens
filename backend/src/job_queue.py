"""FastAPI-process job runner backed by persistent job rows."""

import asyncio
import logging
import os
from typing import Any, Awaitable, Callable, Dict, Optional

from .analysis_cache import set_cached_payload
from .job_store import (
    TERMINAL_STATUSES,
    cancel_job,
    complete_job,
    create_or_reuse_job,
    fail_job,
    get_job,
    is_cancel_requested,
    list_queued_jobs,
    mark_started,
    request_cancel,
    update_progress,
)

logger = logging.getLogger("diff-lens.job_queue")

JobHandler = Callable[["JobContext", Dict[str, Any]], Awaitable[Dict[str, Any]]]


class JobCancelled(Exception):
    """Raised by cooperative job handlers when cancellation is requested."""


class JobContext:
    def __init__(self, job_id: str):
        self.job_id = job_id

    async def update(
        self,
        *,
        phase: Optional[str] = None,
        message: Optional[str] = None,
        current: Optional[int] = None,
        total: Optional[int] = None,
        **extra: Any,
    ) -> None:
        await asyncio.to_thread(
            update_progress,
            self.job_id,
            phase=phase,
            message=message,
            current=current,
            total=total,
            extra=extra,
        )

    async def raise_if_cancelled(self) -> None:
        if await asyncio.to_thread(is_cancel_requested, self.job_id):
            raise JobCancelled("작업 취소 요청을 받아 중단했습니다.")


class JobRunner:
    def __init__(self, concurrency: Optional[int] = None):
        self.concurrency = concurrency or max(1, int(os.getenv("JOB_WORKER_CONCURRENCY", "2")))
        self._semaphore = asyncio.Semaphore(self.concurrency)
        self._handlers: Dict[str, JobHandler] = {}
        self._timeouts: Dict[str, float] = {}
        self._tasks: Dict[str, asyncio.Task] = {}
        self._runtime_payloads: Dict[str, Dict[str, Any]] = {}

    def register(self, job_type: str, handler: JobHandler, *, timeout_seconds: float) -> None:
        self._handlers[job_type] = handler
        self._timeouts[job_type] = timeout_seconds

    def snapshot_task_count(self) -> int:
        return len([task for task in self._tasks.values() if not task.done()])

    async def enqueue_or_reuse(
        self,
        *,
        job_type: str,
        cache_key: str,
        cache_namespace: str,
        request_payload: Dict[str, Any],
        stored_request_payload: Optional[Dict[str, Any]] = None,
        reuse_completed: bool = True,
        cache_on_complete: bool = True,
    ) -> Dict[str, Any]:
        job, created = await asyncio.to_thread(
            create_or_reuse_job,
            job_type=job_type,
            cache_key=cache_key,
            cache_namespace=cache_namespace,
            request_payload=stored_request_payload or request_payload,
            reuse_completed=reuse_completed,
        )
        if job.get("status") == "completed":
            return job
        self._runtime_payloads[job["job_id"]] = request_payload
        if not cache_on_complete:
            self._runtime_payloads.setdefault("__no_result_cache__", {})[job["job_id"]] = True
        self.ensure_running(job)
        return get_job(job["job_id"]) or job

    def ensure_running(self, job: Dict[str, Any]) -> None:
        job_id = job["job_id"]
        if job.get("status") not in {"queued", "running"}:
            return
        existing = self._tasks.get(job_id)
        if existing and not existing.done():
            return
        self._tasks[job_id] = asyncio.create_task(self._run(job_id))

    async def start_pending_jobs(self) -> None:
        for job in await asyncio.to_thread(list_queued_jobs):
            if job.get("job_type") in self._handlers:
                self.ensure_running(job)

    async def cancel(self, job_id: str) -> Optional[Dict[str, Any]]:
        job = await asyncio.to_thread(request_cancel, job_id)
        task = self._tasks.get(job_id)
        if job and job.get("status") == "queued":
            await asyncio.to_thread(cancel_job, job_id)
        if task and not task.done():
            task.cancel()
        return await asyncio.to_thread(get_job, job_id)

    async def _run(self, job_id: str) -> None:
        job = await asyncio.to_thread(get_job, job_id)
        if not job:
            return
        job_type = job.get("job_type")
        handler = self._handlers.get(job_type)
        if not handler:
            await asyncio.to_thread(
                fail_job,
                job_id,
                {
                    "type": "UnknownJobType",
                    "message": f"등록되지 않은 job_type입니다: {job_type}",
                    "retryable": False,
                },
            )
            return

        await asyncio.to_thread(mark_started, job_id)
        context = JobContext(job_id)
        payload = self._runtime_payloads.get(job_id) or job.get("request") or {}
        timeout = self._timeouts.get(job_type, 900)
        try:
            async with self._semaphore:
                await context.raise_if_cancelled()
                result = await asyncio.wait_for(handler(context, payload), timeout=timeout)
                await context.raise_if_cancelled()
                await asyncio.to_thread(complete_job, job_id, result)
                no_result_cache = self._runtime_payloads.get("__no_result_cache__", {})
                if job.get("cache_key") and not no_result_cache.get(job_id):
                    await asyncio.to_thread(
                        set_cached_payload,
                        job["cache_key"],
                        job.get("cache_namespace") or f"job:{job_type}",
                        result,
                    )
        except JobCancelled as exc:
            await asyncio.to_thread(cancel_job, job_id, str(exc))
        except asyncio.CancelledError:
            await asyncio.to_thread(cancel_job, job_id)
        except asyncio.TimeoutError:
            await asyncio.to_thread(
                fail_job,
                job_id,
                {
                    "type": "TimeoutError",
                    "message": f"작업 제한 시간({int(timeout)}초)을 초과했습니다.",
                    "retryable": True,
                    "timeout_seconds": timeout,
                },
            )
        except Exception as exc:
            logger.exception("Job failed: %s", job_id)
            await asyncio.to_thread(
                fail_job,
                job_id,
                {
                    "type": exc.__class__.__name__,
                    "message": str(exc),
                    "retryable": True,
                },
            )
        finally:
            self._runtime_payloads.pop(job_id, None)
            no_result_cache = self._runtime_payloads.get("__no_result_cache__")
            if no_result_cache is not None:
                no_result_cache.pop(job_id, None)


async def job_event_stream(job_id: str):
    """Yield normalized job snapshots until the job reaches a terminal state."""
    last_updated = None
    while True:
        job = await asyncio.to_thread(get_job, job_id)
        if not job:
            yield {
                "schema_version": "job.1",
                "phase": "job_error",
                "event": "error",
                "job_id": job_id,
                "status": "missing",
                "message": "작업을 찾을 수 없습니다.",
            }
            return
        updated = job.get("updated_at")
        if updated != last_updated or job.get("status") in TERMINAL_STATUSES:
            last_updated = updated
            event = "complete" if job.get("status") == "completed" else job.get("status")
            yield {
                "schema_version": "job.1",
                "phase": "job_complete" if job.get("status") == "completed" else "job_progress",
                "event": event,
                "job_id": job_id,
                "job_type": job.get("job_type"),
                "status": job.get("status"),
                "cache_key": (job.get("cache_key") or "")[-16:],
                "message": job.get("message"),
                "progress": job.get("progress") or {},
                "result": job.get("result"),
                "error": job.get("error"),
                "created_at": job.get("created_at"),
                "started_at": job.get("started_at"),
                "completed_at": job.get("completed_at"),
                "updated_at": job.get("updated_at"),
            }
        if job.get("status") in TERMINAL_STATUSES:
            return
        await asyncio.sleep(1)
