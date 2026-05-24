"""Temporary git workspaces for safe dry-run merge checks."""

from __future__ import annotations

import base64
import hashlib
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException

from .git_conflict_evidence import collect_conflict_evidence


_CACHE_LOCKS_GUARD = threading.Lock()
_CACHE_LOCKS: Dict[str, threading.Lock] = {}


def _cache_lock(cache_dir: Path) -> threading.Lock:
    key = str(cache_dir)
    with _CACHE_LOCKS_GUARD:
        lock = _CACHE_LOCKS.get(key)
        if not lock:
            lock = threading.Lock()
            _CACHE_LOCKS[key] = lock
        return lock


def project_clone_url(project: Any) -> str:
    clone_url = getattr(project, "http_url_to_repo", None) or getattr(project, "web_url", None)
    if not clone_url:
        raise HTTPException(status_code=400, detail="Git clone URL을 찾을 수 없습니다.")
    if not clone_url.endswith(".git"):
        clone_url = clone_url.rstrip("/") + ".git"
    return clone_url


class GitDryRunWorkspace:
    """Own a disposable local repository used only for dry-run merge checks."""

    def __init__(
        self,
        clone_url: str,
        git_token: str,
        *,
        fetch_depth: int = 200,
        timeout_seconds: int = 120,
        prefix: str = "diff-lens-merge-",
    ):
        self.clone_url = clone_url
        self.git_token = git_token or ""
        self.fetch_depth = max(1, int(fetch_depth or 1))
        self.timeout_seconds = max(1, int(timeout_seconds or 1))
        self.workdir = tempfile.mkdtemp(prefix=prefix)
        self.basic_auth = base64.b64encode(f"oauth2:{self.git_token}".encode("utf-8")).decode("ascii")
        self._setup_done = False
        self.cache_dir = self._object_cache_dir()
        self.command_log: List[Dict[str, Any]] = []

    def __enter__(self) -> "GitDryRunWorkspace":
        self.setup()
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        self.cleanup()

    def cleanup(self) -> None:
        shutil.rmtree(self.workdir, ignore_errors=True)

    def redact(self, text: str) -> str:
        if not text:
            return ""
        redacted = text.replace(self.clone_url, "<repo-url>")
        if self.git_token:
            redacted = redacted.replace(self.git_token, "<redacted-token>")
        if self.basic_auth:
            redacted = redacted.replace(self.basic_auth, "<redacted-basic-auth>")
        return redacted

    def command_slice(self, start: int = 0) -> List[Dict[str, Any]]:
        return [dict(entry) for entry in self.command_log[start:]]

    def _display_command(self, args: List[str]) -> str:
        redacted_args = [self.redact(str(arg)) for arg in args]
        return "git " + " ".join(shlex.quote(arg) for arg in redacted_args)

    def _run_git_in(
        self,
        args: List[str],
        *,
        cwd: str,
        check: bool = False,
        scope: str = "temporary_worktree",
        log: bool = True,
    ) -> subprocess.CompletedProcess:
        entry = {
            "command": self._display_command(args),
            "scope": scope,
            "mutates_remote": False,
        }
        started = time.perf_counter()
        try:
            result = subprocess.run(
                ["git", *args],
                cwd=cwd,
                text=True,
                capture_output=True,
                timeout=self.timeout_seconds,
            )
        except subprocess.TimeoutExpired:
            entry["returncode"] = "timeout"
            entry["duration_seconds"] = round(time.perf_counter() - started, 3)
            if log:
                self.command_log.append(entry)
            raise
        entry["returncode"] = result.returncode
        entry["duration_seconds"] = round(time.perf_counter() - started, 3)
        if log:
            self.command_log.append(entry)
        if check and result.returncode != 0:
            raise RuntimeError(self.redact((result.stderr or result.stdout or "").strip()))
        return result

    def run_git(self, args: List[str], check: bool = False) -> subprocess.CompletedProcess:
        return self._run_git_in(args, cwd=self.workdir, check=check)

    def setup(self) -> None:
        if self._setup_done:
            return
        self.run_git(["init", "-q"], check=True)
        self.run_git(["remote", "add", "origin", self.clone_url], check=True)
        self.run_git(["config", "advice.detachedHead", "false"], check=True)
        self.run_git(["config", "user.email", "diff-lens@example.local"], check=True)
        self.run_git(["config", "user.name", "Diff Lens Dry Run"], check=True)
        self._attach_object_cache()
        self._setup_done = True

    def _object_cache_dir(self) -> Optional[Path]:
        if os.getenv("GIT_DRY_RUN_OBJECT_CACHE", "1").lower() in {"0", "false", "no"}:
            return None
        cache_root = os.getenv("GIT_DRY_RUN_CACHE_DIR")
        if cache_root:
            root = Path(cache_root)
        else:
            root = Path(__file__).resolve().parents[1] / "data" / "git-object-cache"
        token_hash = hashlib.sha256((self.git_token or "").encode("utf-8")).hexdigest()
        cache_key = hashlib.sha256(f"{self.clone_url}\n{token_hash}".encode("utf-8")).hexdigest()
        return root / cache_key

    def _attach_object_cache(self) -> None:
        if not self.cache_dir:
            return
        objects_dir = self.cache_dir / "objects"
        if not objects_dir.exists():
            return
        info_dir = Path(self.workdir) / ".git" / "objects" / "info"
        info_dir.mkdir(parents=True, exist_ok=True)
        (info_dir / "alternates").write_text(str(objects_dir), encoding="utf-8")

    def _ensure_object_cache(self) -> None:
        if not self.cache_dir:
            return
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        if not (self.cache_dir / "HEAD").exists():
            self._run_git_in(["init", "--bare", "-q"], cwd=str(self.cache_dir), scope="object_cache")
            self._run_git_in(["remote", "add", "origin", self.clone_url], cwd=str(self.cache_dir), scope="object_cache")
        else:
            remotes = self._run_git_in(["remote"], cwd=str(self.cache_dir), scope="object_cache", log=False)
            if "origin" not in (remotes.stdout or "").split():
                self._run_git_in(["remote", "add", "origin", self.clone_url], cwd=str(self.cache_dir), scope="object_cache")

    def _cache_refspec(self, refspec: str) -> Tuple[str, str]:
        source, _, dest = refspec.partition(":")
        if not dest:
            digest = hashlib.sha256(source.encode("utf-8")).hexdigest()
            dest = f"refs/diff-lens-cache/{digest}"
        cache_dest = f"refs/diff-lens-cache/{hashlib.sha256(dest.encode('utf-8')).hexdigest()}"
        return f"{source}:{cache_dest}", cache_dest

    def _fetch_from_object_cache(self, refspec: str, local_ref: str) -> Tuple[bool, str]:
        if not self.cache_dir:
            return False, ""
        lock = _cache_lock(self.cache_dir)
        with lock:
            self._ensure_object_cache()
            cache_refspec, cache_ref = self._cache_refspec(refspec)
            cache_fetch = self._run_git_in(
                self.auth_fetch_args(cache_refspec),
                cwd=str(self.cache_dir),
                scope="object_cache",
            )
            if cache_fetch.returncode != 0:
                return False, self.redact((cache_fetch.stderr or cache_fetch.stdout or "").strip())
            self._attach_object_cache()
            local_fetch = self.run_git(["fetch", "--no-tags", str(self.cache_dir), f"{cache_ref}:{local_ref}"])
            if local_fetch.returncode != 0:
                return False, self.redact((local_fetch.stderr or local_fetch.stdout or "").strip())
            return True, f"object-cache:{cache_ref}"

    def auth_fetch_args(self, refspec: str) -> List[str]:
        return [
            "-c",
            f"http.extraHeader=Authorization: Basic {self.basic_auth}",
            "fetch",
            "--no-tags",
            f"--depth={self.fetch_depth}",
            "origin",
            refspec,
        ]

    @staticmethod
    def candidate_refspecs(ref: str, sha: Optional[str], local_ref: str) -> List[str]:
        refspecs = []
        for value in [ref, sha]:
            value = (value or "").strip()
            if not value:
                continue
            refspecs.extend([
                f"{value}:{local_ref}",
                f"refs/heads/{value}:{local_ref}",
                f"refs/tags/{value}:{local_ref}",
            ])
        deduped = []
        seen = set()
        for refspec in refspecs:
            if refspec not in seen:
                deduped.append(refspec)
                seen.add(refspec)
        return deduped

    def rev_parse(self, rev: str = "HEAD") -> Optional[str]:
        result = self.run_git(["rev-parse", rev])
        return result.stdout.strip() if result.returncode == 0 else None

    def fetch_ref(self, ref: str, sha: Optional[str], local_ref: str) -> Tuple[bool, str]:
        self.setup()
        expected_sha = (sha or "").strip().lower()
        errors = []
        for refspec in self.candidate_refspecs(ref, sha, local_ref):
            cache_ok, cache_result = self._fetch_from_object_cache(refspec, local_ref)
            if not cache_ok:
                if cache_result:
                    errors.append(cache_result[-500:])
                result = self.run_git(self.auth_fetch_args(refspec))
                if result.returncode != 0:
                    errors.append(self.redact((result.stderr or result.stdout or "").strip())[-500:])
                    continue
                fetch_result = refspec
            else:
                fetch_result = cache_result
            fetched_sha = (self.rev_parse(local_ref) or "").lower()
            if expected_sha and fetched_sha and fetched_sha != expected_sha:
                errors.append(f"{refspec} fetched {fetched_sha[:12]}, expected {expected_sha[:12]}")
                continue
            return True, fetch_result
        return False, " | ".join(errors[-3:])

    def checkout_detached(self, local_ref: str) -> None:
        self.run_git(["checkout", "-q", "--detach", local_ref], check=True)

    def abort_merge(self) -> None:
        result = self.run_git(["merge", "--abort"])
        if result.returncode == 0:
            return
        output = (result.stderr or result.stdout or "").lower()
        if "no merge to abort" in output or "there is no merge" in output:
            return
        raise RuntimeError(self.redact((result.stderr or result.stdout or "").strip()))

    def merge_base(self, left_ref: str, right_ref: str) -> Optional[str]:
        merge_base = self.run_git(["merge-base", left_ref, right_ref])
        return merge_base.stdout.strip() if merge_base.returncode == 0 else None

    def merge_no_commit(self, local_source: str) -> Dict[str, Any]:
        merge = self.run_git(["merge", "--no-commit", "--no-ff", local_source])
        merge_output = self.redact("\n".join([merge.stdout or "", merge.stderr or ""]).strip())
        if merge.returncode == 0:
            return {
                "status": "clean",
                "mergeable": True,
                "has_conflicts": False,
                "conflict_files": [],
                "diagnostics": {"merge_output": merge_output[-3000:] if merge_output else ""},
            }

        unmerged = self.run_git(["diff", "--name-only", "--diff-filter=U"])
        conflict_files = [
            line.strip()
            for line in (unmerged.stdout or "").splitlines()
            if line.strip()
        ]
        if conflict_files or "CONFLICT" in merge_output:
            conflict_details = collect_conflict_evidence(
                run_git=self.run_git,
                workdir=self.workdir,
                conflict_files=conflict_files,
                redact=self.redact,
            )
            return {
                "status": "conflicts",
                "mergeable": False,
                "has_conflicts": True,
                "conflict_files": conflict_files,
                "conflict_details": conflict_details,
                "diagnostics": {"merge_output": merge_output[-3000:]},
            }

        return {
            "status": "unknown",
            "mergeable": None,
            "has_conflicts": None,
            "conflict_files": [],
            "diagnostics": {"merge_output": merge_output[-3000:]},
        }

    def commit_if_needed(self, message: str) -> Optional[str]:
        status = self.run_git(["status", "--porcelain"])
        if status.returncode != 0 or not (status.stdout or "").strip():
            return self.rev_parse("HEAD")
        commit = self.run_git(["commit", "-q", "-m", message])
        if commit.returncode != 0:
            raise RuntimeError(self.redact((commit.stderr or commit.stdout or "").strip()))
        return self.rev_parse("HEAD")


def check_merge_conflicts(
    *,
    clone_url: str,
    git_token: str,
    target_ref: str,
    source_ref: str,
    target_sha: Optional[str] = None,
    source_sha: Optional[str] = None,
    fetch_depth: int = 200,
    timeout_seconds: int = 120,
) -> Dict[str, Any]:
    target_ref = (target_ref or target_sha or "").strip()
    source_ref = (source_ref or source_sha or "").strip()
    if not target_ref or not source_ref:
        raise HTTPException(status_code=400, detail="target_ref와 source_ref가 필요합니다.")

    local_target = "refs/diff-lens/target"
    local_source = "refs/diff-lens/source"
    command_log: List[Dict[str, Any]] = []

    try:
        with GitDryRunWorkspace(
            clone_url,
            git_token,
            fetch_depth=fetch_depth,
            timeout_seconds=timeout_seconds,
        ) as workspace:
            command_log = workspace.command_log
            target_ok, target_fetch = workspace.fetch_ref(target_ref, target_sha, local_target)
            source_ok, source_fetch = workspace.fetch_ref(source_ref, source_sha, local_source)
            if not target_ok or not source_ok:
                return {
                    "status": "unknown",
                    "mergeable": None,
                    "has_conflicts": None,
                    "conflict_files": [],
                    "method": "git_dry_run_merge",
                    "message": "임시 git fetch에 실패해 충돌 여부를 확정할 수 없습니다.",
                    "target_ref": target_ref,
                    "source_ref": source_ref,
                    "target_sha": target_sha,
                    "source_sha": source_sha,
                    "git_commands": workspace.command_slice(),
                    "diagnostics": {
                        "target_fetch": target_fetch if target_ok else workspace.redact(target_fetch),
                        "source_fetch": source_fetch if source_ok else workspace.redact(source_fetch),
                    },
                }

            merge_base_sha = workspace.merge_base(local_target, local_source)
            workspace.checkout_detached(local_target)
            result = workspace.merge_no_commit(local_source)
            status = result["status"]
            if status == "clean":
                message = "임시 merge dry-run에서 충돌이 발견되지 않았습니다."
            elif status == "conflicts":
                message = "임시 merge dry-run에서 충돌이 발견되었습니다."
            else:
                message = "git merge dry-run이 실패했지만 충돌 파일을 확인하지 못했습니다."
            diagnostics = {
                "target_fetch": target_fetch,
                "source_fetch": source_fetch,
                **(result.get("diagnostics") or {}),
            }
            return {
                **result,
                "method": "git_dry_run_merge",
                "message": message,
                "target_ref": target_ref,
                "source_ref": source_ref,
                "target_sha": target_sha,
                "source_sha": source_sha,
                "merge_base_sha": merge_base_sha,
                "git_commands": workspace.command_slice(),
                "diagnostics": diagnostics,
            }
    except subprocess.TimeoutExpired:
        return {
            "status": "unknown",
            "mergeable": None,
            "has_conflicts": None,
            "conflict_files": [],
            "method": "git_dry_run_merge",
            "message": f"충돌 체크가 {timeout_seconds}초 제한을 초과했습니다.",
            "target_ref": target_ref,
            "source_ref": source_ref,
            "target_sha": target_sha,
            "source_sha": source_sha,
            "git_commands": list(command_log),
        }
    except Exception as exc:
        redacted = str(exc).replace(git_token or "", "<redacted-token>")
        return {
            "status": "unknown",
            "mergeable": None,
            "has_conflicts": None,
            "conflict_files": [],
            "method": "git_dry_run_merge",
            "message": f"충돌 체크 중 오류가 발생했습니다: {redacted}",
            "target_ref": target_ref,
            "source_ref": source_ref,
            "target_sha": target_sha,
            "source_sha": source_sha,
            "git_commands": list(command_log),
        }
