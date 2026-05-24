import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("TRANSFORMERS_NO_TORCH", "1")

from src.models import RiskFileInfo, RiskReviewRequest, RiskReviewRunRequest


def _risk_file(**overrides):
    data = {
        "file_path": "src/auth/session.py",
        "risk_type": "예외 처리 누락",
        "severity": "HIGH",
        "location": "line 42",
        "original_content": "토큰 검증 실패 시 예외 처리가 누락될 수 있음",
        "diff": "+ validate_token(token)\n+ return session\n",
    }
    data.update(overrides)
    return RiskFileInfo(**data)


def _isolate_job_and_result_cache(tmp_path, monkeypatch):
    from src import analysis_cache, job_store

    monkeypatch.setattr(job_store, "JOB_DB_PATH", str(tmp_path / "jobs.db"))
    monkeypatch.setattr(job_store, "_initialized", False)

    monkeypatch.setattr(analysis_cache, "CACHE_DB_PATH", str(tmp_path / "analysis-cache.db"))
    monkeypatch.setattr(analysis_cache, "_initialized", False)
    analysis_cache._inflight_events.clear()
    analysis_cache._inflight_started_at.clear()
    analysis_cache._inflight_progress.clear()
    return analysis_cache, job_store


def test_risk_prompt_cache_key_is_stable_and_payload_sensitive():
    import main

    base_request = RiskReviewRequest(
        files=[_risk_file()],
        base_commit="a" * 40,
        target_commit="b" * 40,
        checklist=["실제 위험 여부 판단"],
        style="balanced",
        openai_api_key="sk-secret-one",
        langfuse_secret_key="lf-secret-one",
    )
    different_secret = base_request.model_copy(update={
        "openai_api_key": "sk-secret-two",
        "langfuse_secret_key": "lf-secret-two",
    })

    base_key = main._risk_review_cache_key(base_request)
    assert base_key == main._risk_review_cache_key(different_secret)

    assert base_key != main._risk_review_cache_key(base_request.model_copy(update={"style": "detailed"}))
    assert base_key != main._risk_review_cache_key(base_request.model_copy(update={"target_commit": "c" * 40}))
    assert base_key != main._risk_review_cache_key(base_request.model_copy(update={"files": [_risk_file(diff="+ changed\n")]}))


def test_risk_review_run_cache_key_hides_secret_values_but_tracks_model_config(monkeypatch):
    import main

    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_MODEL", raising=False)
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)

    base_request = RiskReviewRunRequest(
        prompt="검토 요청 본문",
        files=[_risk_file()],
        base_commit="a" * 40,
        target_commit="b" * 40,
        style="balanced",
        openai_api_key="sk-secret-one",
        openai_base_url="https://llm.example.test/v1",
        openai_model="gpt-4o-mini",
    )
    different_secret = base_request.model_copy(update={"openai_api_key": "sk-secret-two"})
    no_secret = base_request.model_copy(update={"openai_api_key": None})

    base_key = main._risk_review_run_cache_key(base_request)
    assert base_key == main._risk_review_run_cache_key(different_secret)
    assert base_key != main._risk_review_run_cache_key(no_secret)
    assert base_key != main._risk_review_run_cache_key(base_request.model_copy(update={"openai_model": "gpt-4.1-mini"}))
    assert base_key != main._risk_review_run_cache_key(base_request.model_copy(update={"prompt": "다른 검토 요청"}))


def test_ai_cache_sanitizer_replaces_secret_values_with_presence_flags():
    import main

    sanitized = main._sanitize_for_ai_cache({
        "openai_api_key": "sk-real-secret",
        "langfuse_secret_key": "lf-real-secret",
        "langfuse_public_key": "",
        "nested": [{"git_token": "git-secret"}],
    })

    assert sanitized["openai_api_key"] is True
    assert sanitized["langfuse_secret_key"] is True
    assert sanitized["langfuse_public_key"] is False
    assert sanitized["nested"][0]["git_token"] is True
    assert "real-secret" not in str(sanitized)


def test_job_runner_caches_success_but_not_failed_jobs(tmp_path, monkeypatch):
    analysis_cache, job_store = _isolate_job_and_result_cache(tmp_path, monkeypatch)

    from src.job_queue import JobRunner

    async def ok_handler(ctx, payload):
        await ctx.update(phase="review_done", message="done", current=1, total=1)
        return {"review_result": "ok"}

    async def fail_handler(ctx, payload):
        raise RuntimeError("llm failed")

    async def run_jobs():
        runner = JobRunner(concurrency=1)
        runner.register("risk_review_run", ok_handler, timeout_seconds=3)
        runner.register("risk_review_fail", fail_handler, timeout_seconds=3)

        completed = await runner.enqueue_or_reuse(
            job_type="risk_review_run",
            cache_key="risk-review-success",
            cache_namespace="risk_review_run",
            request_payload={"prompt": "ok"},
        )
        await runner._tasks[completed["job_id"]]

        failed = await runner.enqueue_or_reuse(
            job_type="risk_review_fail",
            cache_key="risk-review-fail",
            cache_namespace="risk_review_run",
            request_payload={"prompt": "fail"},
        )
        await runner._tasks[failed["job_id"]]
        return completed["job_id"], failed["job_id"]

    completed_id, failed_id = asyncio.run(run_jobs())

    assert job_store.get_job(completed_id)["status"] == "completed"
    assert analysis_cache.get_cached_payload("risk-review-success")["review_result"] == "ok"
    assert job_store.get_job(failed_id)["status"] == "failed"
    assert analysis_cache.get_cached_payload("risk-review-fail") is None


def test_job_runner_reuses_same_cache_key_for_active_and_completed_jobs(tmp_path, monkeypatch):
    analysis_cache, job_store = _isolate_job_and_result_cache(tmp_path, monkeypatch)

    from src.job_queue import JobRunner

    async def slow_handler(ctx, payload):
        await asyncio.sleep(0.05)
        return {"review_result": "reused"}

    async def run_jobs():
        runner = JobRunner(concurrency=1)
        runner.register("risk_review_run", slow_handler, timeout_seconds=3)

        first = await runner.enqueue_or_reuse(
            job_type="risk_review_run",
            cache_key="risk-review-reuse",
            cache_namespace="risk_review_run",
            request_payload={"prompt": "same"},
        )
        second = await runner.enqueue_or_reuse(
            job_type="risk_review_run",
            cache_key="risk-review-reuse",
            cache_namespace="risk_review_run",
            request_payload={"prompt": "same"},
        )
        await runner._tasks[first["job_id"]]
        third = await runner.enqueue_or_reuse(
            job_type="risk_review_run",
            cache_key="risk-review-reuse",
            cache_namespace="risk_review_run",
            request_payload={"prompt": "same"},
        )
        return first, second, third

    first, second, third = asyncio.run(run_jobs())

    assert second["job_id"] == first["job_id"]
    assert third["job_id"] == first["job_id"]
    assert third["status"] == "completed"
    assert job_store.get_job(first["job_id"])["result"] == {"review_result": "reused"}
    assert analysis_cache.get_cached_payload("risk-review-reuse")["review_result"] == "reused"
