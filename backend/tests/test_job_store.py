import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_job_store_reuses_active_and_completed_jobs(tmp_path, monkeypatch):
    from src import job_store

    monkeypatch.setattr(job_store, "JOB_DB_PATH", str(tmp_path / "jobs.db"))
    monkeypatch.setattr(job_store, "_initialized", False)

    first, created = job_store.create_or_reuse_job(
        job_type="risk_prompt",
        cache_key="risk:key",
        cache_namespace="risk_review_prompt",
        request_payload={"files": []},
    )
    assert created is True
    assert first["status"] == "queued"

    second, created = job_store.create_or_reuse_job(
        job_type="risk_prompt",
        cache_key="risk:key",
        cache_namespace="risk_review_prompt",
        request_payload={"files": []},
    )
    assert created is False
    assert second["job_id"] == first["job_id"]

    job_store.complete_job(first["job_id"], {"ok": True})
    completed, created = job_store.create_or_reuse_job(
        job_type="risk_prompt",
        cache_key="risk:key",
        cache_namespace="risk_review_prompt",
        request_payload={"files": []},
    )
    assert created is False
    assert completed["status"] == "completed"
    assert completed["result"] == {"ok": True}


def test_job_store_marks_stale_running_interrupted(tmp_path, monkeypatch):
    from src import job_store

    monkeypatch.setattr(job_store, "JOB_DB_PATH", str(tmp_path / "jobs.db"))
    monkeypatch.setattr(job_store, "_initialized", False)

    job = job_store.create_job(
        job_type="compare_v2",
        cache_key="compare:key",
        cache_namespace="job:compare_v2",
        request_payload={"repo_id": 1},
    )
    job_store.mark_started(job["job_id"])

    interrupted = job_store.mark_stale_running_jobs_interrupted(stale_after_seconds=0)
    assert interrupted == 1
    updated = job_store.get_job(job["job_id"])
    assert updated["status"] == "interrupted"
    assert updated["error"]["retryable"] is True
