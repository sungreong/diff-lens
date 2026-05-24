import sys
import subprocess
from types import SimpleNamespace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.analysis_graph import (
    annotate_compare_origin,
    build_v2_cache_identity,
    compare_strategy_to_straight,
    discover_impact_candidates,
    extract_impact_seeds,
    run_compare_graph_stream,
)
from src.git_client import GitLabClient, _global_compare_cache, _global_cache_lock
from src.git_repository_agent import GitRepositoryAgent, RefDriftDetected
from src.diff_triage import DiffTriageService, score_file_for_triage
from src.models import CompareV2Request, FileChange


def test_compare_strategy_maps_to_gitlab_straight():
    assert compare_strategy_to_straight("deployment_state") is True
    assert compare_strategy_to_straight("branch_delta") is False


def test_compare_origin_annotation_marks_baseline_only_hotfix_candidates():
    files = [
        FileChange(path="src/hotfix.py", status="deleted", additions=0, deletions=8),
        FileChange(path="src/new_feature.py", status="added", additions=12, deletions=0),
        FileChange(path="src/shared.py", status="modified", additions=2, deletions=1),
    ]

    annotate_compare_origin(files, "deployment_state")

    assert files[0].compare_origin == "baseline_only"
    assert files[0].deployment_risk_flag == "candidate_missing_baseline_change"
    assert files[1].compare_origin == "candidate_only"
    assert files[2].compare_origin == "changed_between_versions"

    annotate_compare_origin(files, "branch_delta")
    assert {file.compare_origin for file in files} == {"candidate_delta"}


def test_compare_cache_key_keeps_straight_semantics_separate():
    client = GitLabClient.__new__(GitLabClient)
    client.git_url = "https://gitlab.example.test"

    class Project:
        id = "project-1"

        def __init__(self):
            self.calls = []

        def repository_compare(self, base, target, **kwargs):
            self.calls.append((base, target, kwargs))
            return {"commits": [], "diffs": [], "straight": kwargs.get("straight")}

    project = Project()
    base = "a" * 40
    target = "b" * 40

    with _global_cache_lock:
        _global_compare_cache.clear()

    assert client._get_compare(project, "project-1", base, target, straight=True)["straight"] is True
    assert client._get_compare(project, "project-1", base, target, straight=False)["straight"] is False
    assert client._get_compare(project, "project-1", base, target, straight=True)["straight"] is True
    assert len(project.calls) == 2


def test_impact_seed_extraction_and_candidate_limit():
    changed = [
        FileChange(
            path="src/api/users.ts",
            status="modified",
            additions=4,
            deletions=1,
            diff=(
                "+export function getUser() {}\n"
                "+const route = '/api/users'\n"
                "+import { UserCard } from '../components/UserCard'\n"
                "+const SAFE_CONFIG_FLAG = true\n"
            ),
        )
    ]
    seeds = extract_impact_seeds(changed)

    assert "getUser" in seeds["symbols"]
    assert "/api/users" in seeds["routes"]
    assert "SAFE_CONFIG_FLAG" in seeds["configs"]

    class FakeClient:
        def get_repository_tree(self, project_id, ref, recursive=True, max_items=3000):
            return [
                {"type": "blob", "path": "src/components/UserCard.tsx"},
                {"type": "blob", "path": "src/api/users.test.ts"},
                {"type": "blob", "path": ".env.production"},
            ]

        def get_file_content(self, project_id, file_path, ref):
            if file_path.endswith("UserCard.tsx"):
                return "import { getUser } from '../api/users'\n"
            return "describe('/api/users', () => {})\n"

    candidates = discover_impact_candidates(
        FakeClient(),
        "project-1",
        "c" * 40,
        changed,
        impact_max_files=1,
    )

    assert len(candidates) == 1
    assert candidates[0]["file_path"] in {"src/components/UserCard.tsx", "src/api/users.test.ts"}
    assert ".env.production" not in [candidate["file_path"] for candidate in candidates]
    assert candidates[0]["reason_codes"]
    assert candidates[0]["confidence_score"] > 0


def test_v2_cache_identity_includes_resolved_sha_and_strategy():
    files = [
        FileChange(path="src/app.py", status="modified", additions=1, deletions=0),
    ]
    base_ref = {"sha": "a" * 40}
    candidate_ref = {"sha": "b" * 40}
    request = CompareV2Request(
        baseline_ref="prod",
        candidate_ref="dev",
        compare_strategy="deployment_state",
        include_impact=True,
        impact_max_files=15,
    )

    cache_key = build_v2_cache_identity(request, base_ref, candidate_ref, files, "gpt-4o-mini")
    request.compare_strategy = "branch_delta"
    strategy_key = build_v2_cache_identity(request, base_ref, candidate_ref, files, "gpt-4o-mini")
    request.compare_strategy = "deployment_state"
    sha_key = build_v2_cache_identity(request, base_ref, {"sha": "c" * 40}, files, "gpt-4o-mini")

    assert cache_key != strategy_key
    assert cache_key != sha_key


def test_git_repository_agent_resolves_and_fetches_compare_with_locked_shas():
    class FakeClient:
        def __init__(self):
            self.fetch_args = None

        def resolve_ref(self, project_id, ref):
            sha = ("a" if ref == "main" else "b") * 40
            return {
                "name": ref,
                "ref": ref,
                "type": "branch",
                "sha": sha,
                "full_sha": sha,
                "short_sha": sha[:8],
            }

        def fetch_changes(self, project_id, base, target, author_filter, straight=True, include_file_evidence=True):
            self.fetch_args = (project_id, base, target, author_filter, straight, include_file_evidence)
            return [{"id": "commit-1"}], [
                FileChange(path="src/api/users.py", status="modified", additions=3, deletions=1)
            ]

    request = CompareV2Request(
        baseline_ref="main",
        candidate_ref="dev",
        compare_strategy="deployment_state",
        author_filter="alice",
    )
    client = FakeClient()
    snapshot = GitRepositoryAgent(client, "project-1").compare(request)

    assert snapshot.ref_pair.baseline["sha"] == "a" * 40
    assert snapshot.ref_pair.candidate["sha"] == "b" * 40
    assert snapshot.straight is True
    assert client.fetch_args == ("project-1", "a" * 40, "b" * 40, "alice", True, True)
    assert snapshot.files[0].path == "src/api/users.py"


def test_git_repository_agent_raises_on_ref_drift_before_fetch():
    class DriftClient:
        def resolve_ref(self, project_id, ref):
            sha = ("a" if ref == "main" else "c") * 40
            return {
                "name": ref,
                "ref": ref,
                "type": "branch",
                "sha": sha,
                "full_sha": sha,
                "short_sha": sha[:8],
            }

        def fetch_changes(self, *args, **kwargs):
            raise AssertionError("fetch_changes should not run after drift")

    request = CompareV2Request(
        baseline_ref="main",
        candidate_ref="dev",
        baseline_sha="a" * 40,
        candidate_sha="b" * 40,
        fail_on_ref_drift=True,
    )

    try:
        GitRepositoryAgent(DriftClient(), "project-1").compare(request)
        assert False, "RefDriftDetected was not raised"
    except RefDriftDetected as exc:
        assert exc.ref_pair.drift[0]["side"] == "candidate"
        assert exc.ref_pair.drift[0]["expected_sha"] == "b" * 40


def test_diff_triage_adds_reason_codes_and_coverage():
    files = [
        FileChange(
            path="src/auth/token_controller.py",
            status="modified",
            additions=40,
            deletions=10,
            commit_ids=["1", "2"],
        ),
        FileChange(path="docs/readme.md", status="modified", additions=2, deletions=0),
        FileChange(path="tests/test_auth.py", status="added", additions=20, deletions=0),
    ]
    files[0].compare_origin = "baseline_only"
    request = CompareV2Request(
        baseline_ref="main",
        candidate_ref="dev",
        analysis_sort="risk",
        max_files=2,
    )

    result = DiffTriageService().triage(request, files)

    assert result.raw_file_count == 3
    assert result.scoped_file_count == 3
    assert result.analysis_file_count == 2
    assert result.files[0].path == "src/auth/token_controller.py"
    assert "security_surface" in result.files[0].triage_reason_codes
    assert "baseline_only_change" in result.files[0].triage_reason_codes
    assert result.coverage["analysis_coverage_ratio"] == round(2 / 3, 4)
    assert result.skipped_reasons[0]["code"] == "max_files_limit"


def test_ref_bookmark_create_and_update_refresh_timestamps(tmp_path):
    from sqlmodel import SQLModel, Session, create_engine

    from routers.compare_v2 import create_ref_bookmark, update_ref_bookmark
    from src.models import RefBookmarkCreate, RefBookmarkUpdate

    engine = create_engine(
        f"sqlite:///{tmp_path / 'bookmarks.db'}",
        connect_args={"check_same_thread": False},
    )
    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        created = create_ref_bookmark(
            RefBookmarkCreate(
                label="Production",
                ref="prod",
                project_id="project-1",
                sha="a" * 40,
            ),
            session,
        )
        refreshed = create_ref_bookmark(
            RefBookmarkCreate(
                label="Production locked",
                ref="prod",
                project_id="project-1",
                sha="a" * 40,
            ),
            session,
        )
        updated = update_ref_bookmark(
            refreshed.id,
            RefBookmarkUpdate(note="release baseline", color="teal"),
            session,
        )

    assert refreshed.id == created.id
    assert refreshed.label == "Production locked"
    assert refreshed.updated_at
    assert updated.note == "release baseline"
    assert updated.color == "teal"
    assert updated.updated_at


def test_triage_score_is_explainable_for_plain_file():
    file = FileChange(path="src/plain.py", status="modified", additions=1, deletions=1)
    score, reasons = score_file_for_triage(file)

    assert score > 0
    assert reasons == ["plain_diff"]


async def _collect_graph_events(request, client):
    events = []
    async for event in run_compare_graph_stream(
        request=request,
        client=client,
        project_id="project-1",
        llm=None,
        prompts={},
        tracing_context=None,
    ):
        events.append(event)
    return events


def test_ref_drift_guard_stops_analysis_when_preview_sha_moved():
    class DriftClient:
        def resolve_ref(self, project_id, ref):
            sha = "b" * 40 if ref == "dev" else "a" * 40
            if ref == "dev":
                sha = "c" * 40
            return {
                "name": ref,
                "ref": ref,
                "type": "branch",
                "sha": sha,
                "full_sha": sha,
                "short_sha": sha[:8],
            }

        def fetch_changes(self, *args, **kwargs):
            raise AssertionError("fetch_changes should not run after ref drift")

    request = CompareV2Request(
        baseline_ref="prod",
        candidate_ref="dev",
        baseline_sha="a" * 40,
        candidate_sha="b" * 40,
        fail_on_ref_drift=True,
    )

    import asyncio

    events = asyncio.run(_collect_graph_events(request, DriftClient()))
    assert events[-1]["phase"] == "error"
    assert events[-1]["event"] == "ref_drift_detected"
    assert events[-1]["payload"]["mismatches"][0]["side"] == "candidate"


def test_merge_conflict_dry_run_detects_conflicted_file(tmp_path):
    work = tmp_path / "work"
    bare = tmp_path / "repo.git"

    def git(args, cwd=work):
        return subprocess.run(["git", *args], cwd=cwd, check=True, text=True, capture_output=True)

    work.mkdir()
    git(["init", "-q"])
    git(["config", "user.email", "test@example.com"])
    git(["config", "user.name", "Test User"])
    (work / "app.txt").write_text("base\n", encoding="utf-8")
    git(["add", "app.txt"])
    git(["commit", "-q", "-m", "base"])
    git(["checkout", "-q", "-b", "prod"])
    (work / "app.txt").write_text("prod hotfix\n", encoding="utf-8")
    git(["commit", "-q", "-am", "prod hotfix"])
    git(["checkout", "-q", "master"])
    git(["checkout", "-q", "-b", "dev"])
    (work / "app.txt").write_text("dev change\n", encoding="utf-8")
    git(["commit", "-q", "-am", "dev change"])
    subprocess.run(["git", "clone", "--bare", str(work), str(bare)], check=True, text=True, capture_output=True)

    def bare_rev(ref):
        return subprocess.run(
            ["git", "--git-dir", str(bare), "rev-parse", f"refs/heads/{ref}"],
            check=True,
            text=True,
            capture_output=True,
        ).stdout.strip()

    prod_before = bare_rev("prod")
    dev_before = bare_rev("dev")

    client = GitLabClient.__new__(GitLabClient)
    client.git_url = "file://local"
    client.git_token = "local-token"
    client.get_project = lambda project_id: SimpleNamespace(http_url_to_repo=str(bare))

    result = client.check_merge_conflicts("project-1", target_ref="prod", source_ref="dev")

    assert result["status"] == "conflicts"
    assert result["has_conflicts"] is True
    assert "app.txt" in result["conflict_files"]
    assert bare_rev("prod") == prod_before
    assert bare_rev("dev") == dev_before
