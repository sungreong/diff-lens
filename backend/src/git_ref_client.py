"""Ref picker and ref resolution methods for GitLabClient."""

from __future__ import annotations

import copy
import hashlib
import logging
import time
from typing import Any, Dict, List, Optional

import gitlab
from fastapi import HTTPException

from .git_client_cache import (
    REF_LIST_CACHE_TTL,
    _global_cache_lock,
    _global_ref_list_cache,
    is_cache_valid,
)

logger = logging.getLogger(__name__)


class GitRefClientMixin:
    def get_branches(self, project_id: str) -> List[str]:
        """Fetch all branches for a project."""
        try:
            project = self.get_project(project_id)
            branches = project.branches.list(all=True)
            return [b.name for b in branches]
        except Exception as e:
            print(f"DEBUG: Error fetching branches: {e}")
            return ["main", "master"]

    def get_tags(self, project_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        """Fetch recent tags with resolved commit metadata."""
        try:
            project = self.get_project(project_id)
            tags = project.tags.list(per_page=min(limit, 100), get_all=False)
            result = []
            for tag in tags[:limit]:
                commit = getattr(tag, "commit", {}) or {}
                sha = commit.get("id", "")
                result.append({
                    "name": tag.name,
                    "type": "tag",
                    "sha": sha,
                    "full_sha": sha,
                    "short_sha": commit.get("short_id") or sha[:8],
                    "title": commit.get("title") or getattr(tag, "message", "") or tag.name,
                    "created_at": commit.get("created_at") or getattr(tag, "created_at", ""),
                })
            return result
        except Exception as e:
            logger.warning(f"Failed to fetch tags: {e}")
            return []

    def list_refs(
        self,
        project_id: str,
        branch_limit: int = 100,
        tag_limit: int = 50,
        commit_limit: int = 50,
        commit_ref: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Return branches, tags, and recent commits for ref pickers."""
        token_hash = hashlib.sha256((self.git_token or "").encode("utf-8")).hexdigest()
        cache_key = (
            self.git_url,
            token_hash,
            project_id,
            int(branch_limit or 0),
            int(tag_limit or 0),
            int(commit_limit or 0),
            commit_ref or "",
        )
        with _global_cache_lock:
            cached = _global_ref_list_cache.get(cache_key)
            if cached:
                refs, timestamp = cached
                if is_cache_valid(timestamp, REF_LIST_CACHE_TTL):
                    logger.info("Ref list cache HIT for project %s ref=%s", project_id, commit_ref or "")
                    return copy.deepcopy(refs)

        project = self.get_project(project_id)
        branches = []
        tags = []
        commits = []

        try:
            for branch in project.branches.list(per_page=min(branch_limit, 100), get_all=False):
                commit = getattr(branch, "commit", {}) or {}
                sha = commit.get("id", "")
                branches.append({
                    "name": branch.name,
                    "type": "branch",
                    "sha": sha,
                    "full_sha": sha,
                    "short_sha": commit.get("short_id") or sha[:8],
                    "title": commit.get("title") or branch.name,
                    "created_at": commit.get("created_at") or commit.get("committed_date", ""),
                    "protected": getattr(branch, "protected", False),
                })
        except Exception as e:
            logger.warning(f"Failed to list branches: {e}")

        try:
            tags = self.get_tags(project_id, limit=tag_limit)
        except Exception as e:
            logger.warning(f"Failed to list tags: {e}")

        try:
            commits = self.fetch_commits(
                project_id,
                limit=commit_limit,
                ref_name=commit_ref or getattr(project, "default_branch", None),
            )
            for commit in commits:
                commit["type"] = "commit"
                commit["sha"] = commit.get("full_sha") or commit.get("id", "")
        except Exception as e:
            logger.warning(f"Failed to list commits for refs: {e}")

        result = {
            "default_branch": getattr(project, "default_branch", None),
            "branches": branches,
            "tags": tags,
            "commits": commits,
        }
        with _global_cache_lock:
            _global_ref_list_cache[cache_key] = (copy.deepcopy(result), time.time())
        return result

    def resolve_ref(self, project_id: str, ref: str) -> Dict[str, Any]:
        """Resolve a branch, tag, or SHA-like ref into immutable commit metadata."""
        ref = (ref or "").strip()
        if not ref:
            raise HTTPException(status_code=400, detail="비교할 ref가 비어 있습니다.")

        project = self.get_project(project_id)

        def from_commit_data(ref_type: str, name: str, commit_data: Dict[str, Any]) -> Dict[str, Any]:
            sha = commit_data.get("id") or commit_data.get("sha") or ""
            short_sha = commit_data.get("short_id") or sha[:8]
            return {
                "name": name,
                "ref": ref,
                "type": ref_type,
                "sha": sha,
                "full_sha": sha,
                "short_sha": short_sha,
                "title": commit_data.get("title") or commit_data.get("message") or name,
                "author_name": commit_data.get("author_name") or "",
                "author_email": commit_data.get("author_email") or "",
                "created_at": commit_data.get("created_at") or commit_data.get("committed_date") or "",
                "web_url": commit_data.get("web_url") or "",
            }

        try:
            branch = project.branches.get(ref)
            commit = getattr(branch, "commit", {}) or {}
            if commit.get("id"):
                return from_commit_data("branch", branch.name, commit)
        except Exception:
            pass

        try:
            tag = project.tags.get(ref)
            commit = getattr(tag, "commit", {}) or {}
            if commit.get("id"):
                resolved = from_commit_data("tag", tag.name, commit)
                resolved["tag_message"] = getattr(tag, "message", "") or ""
                return resolved
        except Exception:
            pass

        try:
            commit = project.commits.get(ref)
            commit_data = {
                "id": getattr(commit, "id", ""),
                "short_id": getattr(commit, "short_id", ""),
                "title": getattr(commit, "title", ""),
                "message": getattr(commit, "message", ""),
                "author_name": getattr(commit, "author_name", ""),
                "author_email": getattr(commit, "author_email", ""),
                "created_at": getattr(commit, "created_at", ""),
                "committed_date": getattr(commit, "committed_date", ""),
                "web_url": getattr(commit, "web_url", ""),
            }
            return from_commit_data("commit", commit_data.get("short_id") or ref, commit_data)
        except gitlab.exceptions.GitlabGetError as e:
            raise HTTPException(status_code=400, detail=f"ref를 해석할 수 없습니다: {ref} ({e})")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"ref 해석 실패: {ref} ({e})")

    def get_repository_tree(
        self,
        project_id: str,
        ref: str,
        recursive: bool = True,
        max_items: int = 3000,
    ) -> List[Dict[str, Any]]:
        """Fetch a bounded repository tree snapshot at a resolved ref."""
        project = self.get_project(project_id)
        try:
            iterator = project.repository_tree(
                ref=ref,
                recursive=recursive,
                per_page=100,
                iterator=True,
            )
            items = []
            for item in iterator:
                items.append(item)
                if len(items) >= max_items:
                    break
            return items
        except TypeError:
            tree = project.repository_tree(
                ref=ref,
                recursive=recursive,
                per_page=100,
                get_all=True,
            )
            return tree[:max_items]
