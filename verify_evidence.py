import os
import sys
import types
import importlib.util
from unittest.mock import MagicMock

ROOT = os.path.abspath(os.path.dirname(__file__))
SRC_DIR = os.path.join(ROOT, "backend", "src")

# Load git_client directly so this focused test does not import LLM/Torch stacks
# through src.__init__.
src_pkg = types.ModuleType("src")
src_pkg.__path__ = [SRC_DIR]
sys.modules.setdefault("src", src_pkg)

models_stub = types.ModuleType("src.models")


class FileChange:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


models_stub.FileChange = FileChange
sys.modules.setdefault("src.models", models_stub)

spec = importlib.util.spec_from_file_location("src.git_client", os.path.join(SRC_DIR, "git_client.py"))
git_client = importlib.util.module_from_spec(spec)
sys.modules["src.git_client"] = git_client
spec.loader.exec_module(git_client)

GitLabClient = git_client.GitLabClient
build_diff_evidence = git_client.build_diff_evidence


def test_get_file_diff_in_commit_passes_project_id():
    client = GitLabClient.__new__(GitLabClient)
    client.git_url = "https://gitlab.example.com"
    project = MagicMock()
    project.id = "project-1"
    commit = MagicMock()
    commit.id = "abcdef1234567890"
    commit.short_id = "abcdef12"
    commit.title = "Update API"
    commit.author_name = "Tester"
    commit.author_email = "tester@example.com"
    commit.created_at = "2026-04-25T00:00:00Z"

    client.get_project = MagicMock(return_value=project)
    client._get_commit = MagicMock(return_value=commit)
    client._get_diff = MagicMock(return_value=[
        {
            "new_path": "backend/main.py",
            "old_path": "backend/main.py",
            "diff": "@@ -1 +1 @@\n-old\n+new",
        }
    ])

    result = client.get_file_diff_in_commit("project-1", "abcdef1234567890", "backend/main.py")

    assert result is not None
    assert result["full_sha"] == "abcdef1234567890"
    client._get_diff.assert_called_once_with(commit, "project-1")
    print("PASS: get_file_diff_in_commit calls _get_diff(commit, project_id) and preserves full SHA")


def test_get_file_content_uses_cache():
    client = GitLabClient.__new__(GitLabClient)
    client.git_url = "https://gitlab-cache.example.com"
    project = MagicMock()
    file_obj = MagicMock()
    file_obj.decode.return_value = b"line1\nline2\n"
    project.files.get.return_value = file_obj
    client.get_project = MagicMock(return_value=project)

    first = client.get_file_content("project-1", "backend/main.py", "abc123")
    second = client.get_file_content("project-1", "backend/main.py", "abc123")

    assert first == "line1\nline2\n"
    assert second == first
    project.files.get.assert_called_once_with(file_path="backend/main.py", ref="abc123")
    print("PASS: get_file_content caches repeated file/ref lookups")


def test_build_diff_evidence_uses_hunks():
    diff = "\n".join([
        "@@ -10,3 +10,4 @@ def handler():",
        "-return old_value",
        "+return new_value",
        "+raise HTTPException(status_code=400)",
        "@@ -80,2 +81,2 @@ def helper():",
        "-x = 1",
        "+x = 2",
    ])

    evidence, omitted = build_diff_evidence(diff, max_hunks=1)

    assert len(evidence) == 1
    assert omitted == 1
    assert "HTTPException" in evidence[0]["quote"]
    print("PASS: build_diff_evidence selects important hunks and reports omissions")


if __name__ == "__main__":
    test_get_file_diff_in_commit_passes_project_id()
    test_get_file_content_uses_cache()
    test_build_diff_evidence_uses_hunks()
