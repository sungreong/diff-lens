import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.git_client import GitLabClient
from src.merge_plan_review_agent import fallback_merge_plan_review
from src.merge_plan_service import MergePlanService, merge_plan_result_is_cacheable
from src.models import MergePlanCandidate, MergePlanRequest


def _git(args, cwd):
    return subprocess.run(["git", *args], cwd=cwd, check=True, text=True, capture_output=True)


def _bare_rev(bare, ref):
    return subprocess.run(
        ["git", "--git-dir", str(bare), "rev-parse", f"refs/heads/{ref}"],
        check=True,
        text=True,
        capture_output=True,
    ).stdout.strip()


def _client_for_bare_repo(bare):
    client = GitLabClient.__new__(GitLabClient)
    client.git_url = "file://local"
    client.git_token = "local-token"
    client.get_project = lambda project_id: SimpleNamespace(http_url_to_repo=str(bare))

    def resolve_ref(project_id, ref):
        sha = _bare_rev(bare, ref)
        return {
            "name": ref,
            "ref": ref,
            "type": "branch",
            "sha": sha,
            "full_sha": sha,
            "short_sha": sha[:8],
            "title": ref,
        }

    client.resolve_ref = resolve_ref
    return client


def test_merge_plan_detects_candidate_to_candidate_sequential_conflict(tmp_path):
    work = tmp_path / "work"
    bare = tmp_path / "repo.git"
    work.mkdir()
    _git(["init", "-q"], work)
    _git(["config", "user.email", "test@example.com"], work)
    _git(["config", "user.name", "Test User"], work)
    (work / "app.txt").write_text("base\n", encoding="utf-8")
    _git(["add", "app.txt"], work)
    _git(["commit", "-q", "-m", "base"], work)
    _git(["checkout", "-q", "-b", "target"], work)
    _git(["checkout", "-q", "master"], work)
    _git(["checkout", "-q", "-b", "candidate-a"], work)
    (work / "app.txt").write_text("candidate A\n", encoding="utf-8")
    _git(["commit", "-q", "-am", "candidate A"], work)
    _git(["checkout", "-q", "master"], work)
    _git(["checkout", "-q", "-b", "candidate-b"], work)
    (work / "app.txt").write_text("candidate B\n", encoding="utf-8")
    _git(["commit", "-q", "-am", "candidate B"], work)
    subprocess.run(["git", "clone", "--bare", str(work), str(bare)], check=True, text=True, capture_output=True)

    request = MergePlanRequest(
        git_url="file://local",
        git_token="local-token",
        project_id="project-1",
        target_ref="target",
        target_sha=_bare_rev(bare, "target"),
        include_ai_review=False,
        candidates=[
            MergePlanCandidate(id="a", label="A", ref="candidate-a", sha=_bare_rev(bare, "candidate-a")),
            MergePlanCandidate(id="b", label="B", ref="candidate-b", sha=_bare_rev(bare, "candidate-b")),
        ],
    )
    client = _client_for_bare_repo(bare)
    result = MergePlanService(client, "project-1").run(request)

    assert result["status"] == "conflicts"
    assert [item["status"] for item in result["individual_results"]] == ["clean", "clean"]
    assert [item["status"] for item in result["sequential_results"]] == ["clean", "blocked"]
    assert result["first_blocker"]["candidate_id"] == "b"
    assert "app.txt" in result["first_blocker"]["conflict_files"]
    conflict_details = result["first_blocker"]["conflict_details"]
    assert conflict_details[0]["file_path"] == "app.txt"
    assert conflict_details[0]["conflict_marker_blocks"]
    assert conflict_details[0]["unmerged_index"]["text"]
    assert conflict_details[0]["diff_variants"]["ours"]["text"] or conflict_details[0]["diff_variants"]["theirs"]["text"]
    assert conflict_details[0]["stages"]["ours"]["available"] is True
    assert conflict_details[0]["stages"]["theirs"]["available"] is True
    review = fallback_merge_plan_review(result)
    assert review["file_reviews"][0]["file_path"] == "app.txt"
    assert review["file_reviews"][0]["resolution_plan"]
    assert review["file_reviews"][0]["decision"] == "combine"
    assert review["file_reviews"][0]["base_side_label"] == "대상 C + 앞선 후보 1~1까지 누적된 상태"
    assert review["file_reviews"][0]["incoming_side_label"] == "2번째 후보 B"
    assert review["file_reviews"][0]["recommended_action"]
    assert review["file_reviews"][0]["conflict_regions"][0]["ours_preview"]
    assert review["file_reviews"][0]["conflict_regions"][0]["theirs_preview"]
    commands = [entry["command"] for entry in result["git_commands"]]
    assert any("git merge --no-commit --no-ff" in command for command in commands)
    assert any("git diff --name-only --diff-filter=U" in command for command in commands)
    assert not any("git push" in command for command in commands)
    assert not any("local-token" in command for command in commands)
    assert merge_plan_result_is_cacheable(result) is True
    assert _bare_rev(bare, "target") == request.target_sha


def test_merge_plan_marks_remaining_after_first_sequential_blocker(tmp_path):
    work = tmp_path / "work"
    bare = tmp_path / "repo.git"
    work.mkdir()
    _git(["init", "-q"], work)
    _git(["config", "user.email", "test@example.com"], work)
    _git(["config", "user.name", "Test User"], work)
    (work / "app.txt").write_text("base\n", encoding="utf-8")
    _git(["add", "app.txt"], work)
    _git(["commit", "-q", "-m", "base"], work)
    _git(["checkout", "-q", "-b", "target"], work)
    (work / "app.txt").write_text("target\n", encoding="utf-8")
    _git(["commit", "-q", "-am", "target"], work)
    _git(["checkout", "-q", "master"], work)
    _git(["checkout", "-q", "-b", "candidate-a"], work)
    (work / "app.txt").write_text("candidate A\n", encoding="utf-8")
    _git(["commit", "-q", "-am", "candidate A"], work)
    _git(["checkout", "-q", "master"], work)
    _git(["checkout", "-q", "-b", "candidate-b"], work)
    (work / "other.txt").write_text("candidate B\n", encoding="utf-8")
    _git(["add", "other.txt"], work)
    _git(["commit", "-q", "-m", "candidate B"], work)
    subprocess.run(["git", "clone", "--bare", str(work), str(bare)], check=True, text=True, capture_output=True)

    request = MergePlanRequest(
        git_url="file://local",
        git_token="local-token",
        project_id="project-1",
        target_ref="target",
        target_sha=_bare_rev(bare, "target"),
        include_ai_review=False,
        candidates=[
            MergePlanCandidate(id="a", label="A", ref="candidate-a", sha=_bare_rev(bare, "candidate-a")),
            MergePlanCandidate(id="b", label="B", ref="candidate-b", sha=_bare_rev(bare, "candidate-b")),
        ],
    )
    result = MergePlanService(_client_for_bare_repo(bare), "project-1").run(request)

    assert [item["status"] for item in result["sequential_results"]] == ["blocked", "not_run_after_blocker"]
    assert result["summary_counts"]["sequential"]["not_run"] == 1


def test_merge_plan_ref_drift_stops_before_dry_run():
    class DriftClient:
        git_token = "token"

        def get_project(self, project_id):
            return SimpleNamespace(http_url_to_repo="https://gitlab.example.test/repo.git")

        def resolve_ref(self, project_id, ref):
            sha = "c" * 40 if ref == "target" else "b" * 40
            return {"name": ref, "ref": ref, "type": "branch", "sha": sha, "short_sha": sha[:8]}

    request = MergePlanRequest(
        git_url="https://gitlab.example.test",
        git_token="token",
        project_id="project-1",
        target_ref="target",
        target_sha="a" * 40,
        candidates=[MergePlanCandidate(id="b", label="B", ref="candidate-b", sha="b" * 40)],
    )
    result = MergePlanService(DriftClient(), "project-1").run(request)

    assert result["status"] == "unknown"
    assert result["first_blocker"]["reason"] == "ref_drift"
    assert result["diagnostics"]["cacheable"] is False
    assert merge_plan_result_is_cacheable(result) is False


def test_merge_plan_cache_key_tracks_candidate_order_and_sha(monkeypatch):
    import main

    runtime = {
        "git_url": "https://gitlab.example.test",
        "git_token": "token",
        "project_id": "project-1",
        "openai_model": "gpt-4o-mini",
        "openai_base_url": "https://api.openai.com/v1",
        "openai_api_key": "sk-secret",
        "prompts": {"merge_plan_reviewer": {"version": "v1"}},
    }
    monkeypatch.setattr(main, "resolve_compare_v2_runtime", lambda request, session: runtime)

    class SessionStub:
        pass

    base = MergePlanRequest(
        git_url=runtime["git_url"],
        git_token=runtime["git_token"],
        project_id=runtime["project_id"],
        target_ref="release",
        target_sha="a" * 40,
        candidates=[
            MergePlanCandidate(id="a", label="A", ref="feature-a", sha="b" * 40),
            MergePlanCandidate(id="b", label="B", ref="feature-b", sha="c" * 40),
        ],
    )
    key, stable = main._merge_plan_v1_job_cache_identity(base, SessionStub())
    reordered = base.model_copy(update={"candidates": list(reversed(base.candidates))})
    changed_sha = base.model_copy(update={
        "candidates": [
            MergePlanCandidate(id="a", label="A", ref="feature-a", sha="d" * 40),
            base.candidates[1],
        ]
    })

    assert stable is True
    assert key != main._merge_plan_v1_job_cache_identity(reordered, SessionStub())[0]
    assert key != main._merge_plan_v1_job_cache_identity(changed_sha, SessionStub())[0]
