"""
GitLab API Client for fetching commits and diffs
"""
import gitlab
import logging
import time
import re
import hashlib
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional, List, Tuple, Dict, Any
from fastapi import HTTPException

from .git_client_cache import (
    COMPARE_IMMUTABLE_CACHE_TTL,
    GITLAB_CLIENT_CACHE_TTL,
    PROJECT_CACHE_TTL,
    _global_cache_lock,
    _global_commit_cache,
    _global_compare_cache,
    _global_diff_cache,
    _global_file_content_cache,
    _global_gitlab_client_cache,
    _global_project_cache,
    compare_cache_ttl,
    configure_gitlab_session,
    gitlab_cache_stats,
    is_cache_valid,
)
from .git_diff_utils import build_diff_evidence, content_summary, count_diff_changes
from .git_merge_dry_run import check_merge_conflicts, project_clone_url
from .git_ref_client import GitRefClientMixin
from .models import FileChange

# Configure file-based logging for debugging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('git_client_debug.log', mode='a', encoding='utf-8'),
        logging.StreamHandler()  # Also print to console
    ]
)
logger = logging.getLogger(__name__)

class GitLabClient(GitRefClientMixin):
    """Client for interacting with GitLab API"""
    
    def __init__(self, git_url: str, git_token: str):
        # Basic cleanup: remove trailing slashes and common API paths
        clean_url = git_url.strip().rstrip('/')
        
        # Smart detection: if the URL looks like a project URL (contains path after host)
        if clean_url.startswith('http'):
            from urllib.parse import urlparse
            url_obj = urlparse(clean_url)
            # If there's a path and it's not just the API entry point
            if url_obj.path and url_obj.path not in ['', '/', '/api/v4', '/api/v4/']:
                # It might be a project URL. Let's extract just the base (scheme + netloc)
                clean_url = f"{url_obj.scheme}://{url_obj.netloc}"
                logger.debug(f"Extracted Base URL '{clean_url}' from Project URL '{git_url}'")
        
        if '/api/v4' in clean_url:
            clean_url = clean_url.split('/api/v4')[0]
        
        self.git_url = clean_url  # Store for cache key
        self.git_token = git_token
        token_hash = hashlib.sha256(git_token.encode("utf-8")).hexdigest()
        client_key = (clean_url, token_hash)
        with _global_cache_lock:
            cached = _global_gitlab_client_cache.get(client_key)
            if cached:
                cached_client, timestamp = cached
                if is_cache_valid(timestamp, GITLAB_CLIENT_CACHE_TTL):
                    self.gl = cached_client
                    logger.debug(f"GitLab client cache HIT for '{clean_url}'")
                    return

        try:
            self.gl = gitlab.Gitlab(
                clean_url,
                private_token=git_token,
                timeout=30,
                retry_transient_errors=True,
            )
        except TypeError:
            self.gl = gitlab.Gitlab(clean_url, private_token=git_token, timeout=30)
        configure_gitlab_session(self.gl)
        # Authenticate once per cached client. Reusing this object keeps the
        # underlying requests session and TLS connection pool warm.
        try:
            self.gl.auth()
        except Exception as e:
            # Auth may fail for some instances, but we log the warning
            logger.warning(f"GitLab Auth Warning: {e}")
        with _global_cache_lock:
            _global_gitlab_client_cache[client_key] = (self.gl, time.time())

    def _get_commit(self, project, commit_id):
        """Cached retrieval of commit object using global cache."""
        cache_key = (self.git_url, project.id, commit_id)
        if cache_key not in _global_commit_cache:
            _global_commit_cache[cache_key] = project.commits.get(commit_id)
        return _global_commit_cache[cache_key]

    def _get_diff(self, commit, project_id):
        """Cached retrieval of commit diffs using global cache."""
        cache_key = (self.git_url, project_id, commit.id)
        if cache_key not in _global_diff_cache:
            # Use get_all=True to ensure all diffs are fetched if they are paginated
            _global_diff_cache[cache_key] = list(commit.diff(get_all=True))
        return _global_diff_cache[cache_key]

    def _get_compare(
        self,
        project,
        project_id: str,
        base: str,
        target: str,
        straight: Optional[bool] = None,
    ) -> Dict[str, Any]:
        """Cached GitLab repository compare result.

        Preview and analysis usually request the same A -> B range back-to-back.
        SHA-to-SHA comparisons are immutable and can live much longer than
        moving refs such as HEAD or branch names.
        """
        cache_key = (self.git_url, project_id, base, target, straight)
        ttl = compare_cache_ttl(base, target)
        cache_kind = "immutable" if ttl == COMPARE_IMMUTABLE_CACHE_TTL else "mutable"
        with _global_cache_lock:
            cached = _global_compare_cache.get(cache_key)
            if cached:
                result, timestamp = cached
                if is_cache_valid(timestamp, ttl):
                    logger.info(
                        f"Compare cache HIT ({cache_kind}, ttl={ttl}s) "
                        f"for {base[:8]}..{target[:8]} straight={straight}"
                    )
                    return result

        compare_kwargs = {}
        if straight is not None:
            compare_kwargs["straight"] = bool(straight)

        try:
            result = project.repository_compare(base, target, **compare_kwargs)
        except TypeError:
            # Older python-gitlab versions do not expose the straight keyword.
            # Keep legacy behavior instead of failing hard for existing installs.
            if compare_kwargs:
                logger.warning(
                    "python-gitlab repository_compare does not accept straight; "
                    "falling back to default compare semantics"
                )
                result = project.repository_compare(base, target)
            else:
                raise
        with _global_cache_lock:
            _global_compare_cache[cache_key] = (result, time.time())
        logger.info(
            f"Compare cache STORE ({cache_kind}, ttl={ttl}s) "
            f"for {base[:8]}..{target[:8]} straight={straight}"
        )
        return result

    def get_project(self, project_id: str):
        """Get project by ID or path with caching."""
        # pid extraction logic...
        pid = project_id.strip().rstrip('/')
        if pid.startswith('http'):
            from urllib.parse import urlparse
            path = urlparse(pid).path.lstrip('/')
            if '/-/' in path:
                path = path.split('/-/')[0]
            pid = path
        
        cache_key = (self.git_url, pid)
        if cache_key in _global_project_cache:
            cached_project, timestamp = _global_project_cache[cache_key]
            if is_cache_valid(timestamp, PROJECT_CACHE_TTL):
                logger.debug(f"Project cache HIT for '{pid}'")
                return cached_project

        try:
            logger.info(f"Fetching project '{pid}' from '{self.gl.url}'")
            project = self.gl.projects.get(pid, lazy=False)
            _global_project_cache[cache_key] = (project, time.time())
            return project
        except gitlab.exceptions.GitlabGetError as err:
            logger.error(f"GitLab Project Get Error: {err}")
            raise HTTPException(status_code=404, detail=f"프로젝트를 찾을 수 없습니다: {err}")
        except gitlab.exceptions.GitlabParsingError as err:
            logger.error(f"GitLab Parsing Error: {err}")
            raise HTTPException(
                status_code=400, 
                detail=f"GitLab API 응답 파싱 실패. GitLab URL('{self.gl.url}')이 정확한지 확인해 주세요. (에러: {err})"
            )

    def check_merge_conflicts(
        self,
        project_id: str,
        target_ref: str,
        source_ref: str,
        target_sha: Optional[str] = None,
        source_sha: Optional[str] = None,
        fetch_depth: int = 200,
        timeout_seconds: int = 120,
    ) -> Dict[str, Any]:
        """Dry-run merge source into target using a temporary git repository.

        GitLab compare cannot reliably answer whether a future merge will
        conflict. This method fetches only the two requested refs into a temp
        repository and runs a no-commit merge. Failures that are not actual
        unmerged paths are returned as unknown rather than clean.
        """
        project = self.get_project(project_id)
        return check_merge_conflicts(
            clone_url=project_clone_url(project),
            git_token=self.git_token,
            target_ref=target_ref,
            source_ref=source_ref,
            target_sha=target_sha,
            source_sha=source_sha,
            fetch_depth=fetch_depth,
            timeout_seconds=timeout_seconds,
        )

    def _format_commit_info(self, commit: dict) -> Dict[str, str]:
        """Normalize GitLab commit dictionaries while preserving full SHA."""
        full_sha = commit.get('id', '')
        short_sha = commit.get('short_id') or full_sha[:8]
        return {
            "id": short_sha,  # Backward-compatible display id
            "full_sha": full_sha,
            "short_sha": short_sha,
            "title": commit.get('title', 'No title'),
            "message": commit.get('message') or commit.get('title', 'No title'),
            "author": commit.get('author_name', 'Unknown'),
            "author_name": commit.get('author_name', 'Unknown'),
            "author_email": commit.get('author_email', ''),
            "created_at": commit.get('created_at', ''),
            "committed_date": commit.get('committed_date') or commit.get('created_at', '')
        }

    def _sort_commits_oldest_first(self, commits: List[dict]) -> List[dict]:
        """Sort commits chronologically without relying on GitLab API order."""
        return sorted(
            commits,
            key=lambda c: c.get("committed_date") or c.get("created_at") or ""
        )

    def _build_last_touch_fields(self, related_commits: List[Dict[str, str]]) -> Dict[str, Optional[str]]:
        """Return the latest commit author that touched a file in the selected range."""
        if not related_commits:
            return {
                "last_touched_by": None,
                "last_touched_email": None,
                "last_touched_commit": None,
                "last_touched_commit_short": None,
                "last_touched_at": None,
            }

        latest = max(
            related_commits,
            key=lambda c: c.get("committed_date") or c.get("created_at") or ""
        )
        return {
            "last_touched_by": latest.get("author_name") or latest.get("author") or "Unknown",
            "last_touched_email": latest.get("author_email") or "",
            "last_touched_commit": latest.get("full_sha") or latest.get("id") or "",
            "last_touched_commit_short": latest.get("short_sha") or latest.get("short_id") or latest.get("id") or "",
            "last_touched_at": latest.get("committed_date") or latest.get("created_at") or "",
        }

    def _build_file_evidence_fields(
        self,
        project_id: str,
        base_commit: str,
        target_commit: str,
        path: str,
        old_path: Optional[str],
        status: str,
        diff_text: Optional[str],
        related_commits: List[Dict[str, str]],
        has_history_only: bool = False
    ) -> Dict[str, Any]:
        """Create conservative before/after proof metadata for a file change."""
        before_path = old_path or path
        after_path = path
        before_content = None if status == "added" else self.get_file_content(project_id, before_path, base_commit)
        after_content = None if status == "deleted" else self.get_file_content(project_id, after_path, target_commit)
        evidence, omitted_hunks = build_diff_evidence(diff_text or "")

        warnings = []
        if omitted_hunks:
            warnings.append(f"large_diff_hunks_omitted:{omitted_hunks}")
        if has_history_only:
            warnings.append("history_only_net_diff_empty")

        risk_keywords = re.compile(
            r"auth|token|password|permission|role|security|delete|migration|schema|"
            r"session\.|db\.|timeout|retry|exception|raise|HTTPException",
            re.I
        )
        if not diff_text:
            risk_verdict = "불확실"
            risk_reason = "최종 diff 증거가 없어서 안전 여부를 단정할 수 없습니다."
            confidence = "low"
            evidence_level = "commit_metadata_only" if related_commits else "none"
        elif omitted_hunks:
            risk_verdict = "불확실"
            risk_reason = "대용량 diff 일부가 생략되어 전체 안전 여부를 단정할 수 없습니다."
            confidence = "medium"
            evidence_level = "partial_diff"
        elif risk_keywords.search(diff_text):
            risk_verdict = "문제 가능성 있음"
            risk_reason = "권한, 예외, DB, 스키마, 삭제 또는 운영 안정성 관련 변경 패턴이 diff에서 확인되었습니다."
            confidence = "medium"
            evidence_level = "diff"
        else:
            risk_verdict = "불확실"
            risk_reason = "직접적인 고위험 패턴은 보이지 않지만, 실행/테스트 증거가 없어 문제 없음으로 단정하지 않습니다."
            confidence = "medium"
            evidence_level = "diff"

        recommended_checks = [
            "변경된 파일의 단위/통합 테스트 실행",
            "관련 기능의 주요 성공/실패 경로 수동 확인"
        ]
        if risk_verdict == "문제 가능성 있음":
            recommended_checks.append("권한, 데이터 정합성, 예외 처리, 롤백 시나리오를 추가 검토")
        if omitted_hunks:
            recommended_checks.append("생략된 diff hunk를 포함해 전체 변경 내용 재검토")

        return {
            "before_summary": content_summary(before_content, before_path, "Base"),
            "after_summary": content_summary(after_content, after_path, "Target"),
            "change_evidence": evidence,
            "risk_verdict": risk_verdict,
            "risk_reason": risk_reason,
            "confidence": confidence,
            "uncertainty_reason": None if risk_verdict == "문제 가능성 있음" else risk_reason,
            "recommended_checks": recommended_checks,
            "evidence_level": evidence_level,
            "omitted_hunks": omitted_hunks,
            "analysis_warnings": warnings
        }
    
    def fetch_changes(
        self, 
        project_id: str, 
        base_commit: str, 
        target_commit: Optional[str] = None,
        author_filter: Optional[str] = None,
        straight: Optional[bool] = None,
        include_file_evidence: bool = True,
    ) -> Tuple[List[dict], List[FileChange]]:
        """
        Fetch commits and diffs from base_commit to target_commit (or HEAD).
        Returns (commits, file_changes)
        
        Enhanced to:
        - Track history-only files (changed in commits but no net diff)
        - Attach related commit messages to each file
        """
        project = self.get_project(project_id)
        
        # Use target_commit if provided, otherwise use default branch (HEAD)
        target = target_commit if target_commit else project.default_branch
        
        # Determine comparison base: strictly use base_commit as requested
        comp_base = base_commit

        try:
            comparison = self._get_compare(project, project_id, comp_base, target, straight=straight)
        except gitlab.exceptions.GitlabGetError as e:
            raise HTTPException(status_code=400, detail=f"Invalid commit or comparison failed: {e}")
        
        commits = self._sort_commits_oldest_first(comparison.get("commits", []))
        diffs = comparison.get("diffs", [])
        
        # Build commit message lookup
        commit_info_map = {}
        for c in commits:
            commit_info_map[c['id']] = self._format_commit_info(c)
        range_commits = list(commits)
        range_commit_info_map = dict(commit_info_map)
        
        def get_commit_diff_cached(commit_id):
            """Get commit diff with caching to reduce API calls"""
            try:
                # Use shared class-level cache
                commit_obj = self._get_commit(project, commit_id)
                return self._get_diff(commit_obj, project_id)
            except Exception as e:
                logger.warning(f"Failed to fetch commit diff for {commit_id}: {e}")
                return []

        def prefetch_commit_diffs(commits_to_prefetch: List[dict]) -> None:
            """Warm commit diff cache before building file-level maps.

            GitLab compare returns the final net diff in one call, but heatmap,
            author filtering, history-only detection, and last-touch metadata need
            each commit's diff. Fetch them concurrently so large ranges do not
            crawl one commit at a time.
            """
            commit_ids = [
                c.get("id")
                for c in commits_to_prefetch
                if c.get("id")
            ]
            if not commit_ids:
                return

            missing_ids = [
                commit_id for commit_id in commit_ids
                if (self.git_url, project_id, commit_id) not in _global_diff_cache
            ]
            if not missing_ids:
                logger.info(f"Commit diff cache warm: {len(commit_ids)} commits already cached")
                return

            worker_count = max(1, min(len(missing_ids), int(os.getenv("GIT_DIFF_PREFETCH_WORKERS", "6"))))
            started = time.perf_counter()
            logger.info(
                f"Prefetching {len(missing_ids)}/{len(commit_ids)} commit diffs "
                f"with {worker_count} workers"
            )

            if worker_count == 1:
                for commit_id in missing_ids:
                    get_commit_diff_cached(commit_id)
            else:
                with ThreadPoolExecutor(max_workers=worker_count) as executor:
                    futures = [executor.submit(get_commit_diff_cached, commit_id) for commit_id in missing_ids]
                    for future in as_completed(futures):
                        future.result()

            logger.info(
                f"Commit diff prefetch complete in {time.perf_counter() - started:.2f}s"
            )

        def prefetch_file_contents(content_requests: List[Tuple[str, str]]) -> None:
            """Warm raw file content cache for before/after evidence fields."""
            if os.getenv("GIT_PREFETCH_FILE_CONTENTS", "1").lower() in {"0", "false", "no"}:
                return

            unique_requests = []
            seen_requests = set()
            for file_path, ref in content_requests:
                if not file_path or not ref:
                    continue
                cache_key = (self.git_url, project_id, file_path, ref)
                if cache_key in _global_file_content_cache or cache_key in seen_requests:
                    continue
                seen_requests.add(cache_key)
                unique_requests.append((file_path, ref))

            if not unique_requests:
                return

            worker_count = max(1, min(len(unique_requests), int(os.getenv("GIT_FILE_CONTENT_WORKERS", "8"))))
            started = time.perf_counter()
            logger.info(
                f"Prefetching {len(unique_requests)} file contents "
                f"with {worker_count} workers"
            )

            if worker_count == 1:
                for file_path, ref in unique_requests:
                    self.get_file_content(project_id, file_path, ref)
            else:
                with ThreadPoolExecutor(max_workers=worker_count) as executor:
                    futures = [
                        executor.submit(self.get_file_content, project_id, file_path, ref)
                        for file_path, ref in unique_requests
                    ]
                    for future in as_completed(futures):
                        future.result()

            logger.info(
                f"File content prefetch complete in {time.perf_counter() - started:.2f}s"
            )

        # Keep full-range touch history for "last touched by" even when author filtering
        # narrows the visible file list.
        prefetch_commit_diffs(range_commits)
        range_files_in_commits = {}
        for c in range_commits:
            for diff_item in get_commit_diff_cached(c['id']):
                for path_key in ['new_path', 'old_path']:
                    path = diff_item.get(path_key)
                    if not path:
                        continue
                    if path not in range_files_in_commits:
                        range_files_in_commits[path] = []
                    if c['id'] not in range_files_in_commits[path]:
                        range_files_in_commits[path].append(c['id'])

        def build_last_touch_for_path(path: str, fallback_related_commits: List[Dict[str, str]]):
            commit_ids_for_path = range_files_in_commits.get(path, [])
            commits_for_last_touch = [
                range_commit_info_map[cid] for cid in commit_ids_for_path
                if cid in range_commit_info_map
            ]
            if not commits_for_last_touch:
                commits_for_last_touch = fallback_related_commits
            return self._build_last_touch_fields(commits_for_last_touch)
        
        # DEBUG: Log all files in original diffs (BEFORE any filtering)
        original_diff_paths = [d.get("new_path") or d.get("old_path") for d in diffs]
        logger.info(f"BEFORE Filter - Total diffs: {len(diffs)}, Files: {original_diff_paths}")
        
        # Filter by author if specified (supports comma-separated multiple authors)
        if author_filter:
            author_list = [a.strip().lower() for a in author_filter.split(',')]
            filtered_commits = [
                c for c in commits
                if any(
                    author in c.get("author_name", "").lower() or 
                    author in c.get("author_email", "").lower()
                    for author in author_list
                )
            ]
            
            # Identify files touched by these specific commits
            touched_files = set()
            for c in filtered_commits:
                for diff_item in get_commit_diff_cached(c['id']):
                    if diff_item.get('new_path'):
                        touched_files.add(diff_item.get('new_path'))
                    if diff_item.get('old_path'):
                        touched_files.add(diff_item.get('old_path'))
            
            commits = filtered_commits
            commits = self._sort_commits_oldest_first(commits)
            commit_info_map = {c['id']: self._format_commit_info(c) for c in commits}
            # Filter diffs to only include files touched by the filtered commits
            diffs = [
                d for d in diffs 
                if d.get("new_path") in touched_files or d.get("old_path") in touched_files
            ]
            
            # Debug log to verify filtering
            logger.info(f"Author filter '{author_filter}' applied. Commits: {len(commits)}, touched_files: {list(touched_files)}")
        else:
            # If no author filter, we use the original comparison's commits and diffs
            pass
        
        # Track ALL files touched in ANY commit (for history-only detection)
        # Also aggregate diff content per file from individual commits when author filter is active
        all_files_in_commits = {}  # path -> list of commit ids
        commit_file_stats = {}  # path -> per-commit additions/deletions for matrix export
        aggregated_diff_content = {}  # path -> list of unique diff texts
        seen_diff_hashes = {}  # path -> set of diff hashes (to prevent duplicates)
        
        for c in commits:
            commit_diffs = get_commit_diff_cached(c['id'])
            for diff_item in commit_diffs:
                primary_path = diff_item.get('new_path') or diff_item.get('old_path')
                diff_text_item = diff_item.get('diff', '')
                if primary_path:
                    additions_for_commit, deletions_for_commit = count_diff_changes(diff_text_item)
                    stat = {
                        "commit_id": c.get("id"),
                        "short_sha": c.get("short_id") or c.get("id", "")[:8],
                        "title": c.get("title") or c.get("message", "").split("\n", 1)[0],
                        "author_name": c.get("author_name"),
                        "author_email": c.get("author_email"),
                        "committed_date": c.get("committed_date") or c.get("created_at"),
                        "status": self._determine_status(diff_item),
                        "additions": additions_for_commit,
                        "deletions": deletions_for_commit,
                    }
                    paths_for_stat = {primary_path}
                    old_path_for_stat = diff_item.get('old_path')
                    if old_path_for_stat and old_path_for_stat != primary_path:
                        paths_for_stat.add(old_path_for_stat)
                    for stat_path in paths_for_stat:
                        commit_file_stats.setdefault(stat_path, []).append(stat)

                for path_key in ['new_path', 'old_path']:
                    path = diff_item.get(path_key)
                    if path:
                        if path not in all_files_in_commits:
                            all_files_in_commits[path] = []
                        if c['id'] not in all_files_in_commits[path]:
                            all_files_in_commits[path].append(c['id'])
                        
                        # Aggregate diff content for fallback (ALWAYS, not just when author_filter)
                        # This enables fallback when comparison API returns empty diff
                        new_path = diff_item.get('new_path')
                        if new_path:
                            if new_path not in aggregated_diff_content:
                                aggregated_diff_content[new_path] = []
                                seen_diff_hashes[new_path] = set()
                            
                            if diff_text_item:
                                # Use a stable digest to detect duplicate hunks.
                                diff_hash = hashlib.sha256(diff_text_item.encode("utf-8", errors="ignore")).hexdigest()
                                if diff_hash not in seen_diff_hashes[new_path]:
                                    seen_diff_hashes[new_path].add(diff_hash)
                                    aggregated_diff_content[new_path].append(diff_text_item)

        if include_file_evidence:
            content_prefetch_requests = []
            for d in diffs:
                status = self._determine_status(d)
                path = d.get("new_path") or d.get("old_path")
                if not path:
                    continue
                before_path = d.get("old_path") if d.get("renamed_file") else path
                if status != "added":
                    content_prefetch_requests.append((before_path, base_commit))
                if status != "deleted":
                    content_prefetch_requests.append((path, target))

            for path in all_files_in_commits:
                content_prefetch_requests.append((path, base_commit))
                content_prefetch_requests.append((path, target))

            prefetch_file_contents(content_prefetch_requests)
        
        # Process diffs into FileChange objects (files with actual net changes)
        file_changes_map = {}
        final_diff_paths = set()
        
        # Debug: Log the number of diffs from comparison API
        print(f"DEBUG: Comparison API returned {len(diffs)} diffs")
        if author_filter:
            print(f"DEBUG: Author filter active. touched_files count: {len(aggregated_diff_content)}")
        
        for d in diffs:
            status = self._determine_status(d)
            diff_text = d.get("diff", "")
            path = d.get("new_path") or d.get("old_path")
            
            # FALLBACK: If comparison API returns empty diff, use aggregated commit diffs
            if not diff_text and path in aggregated_diff_content:
                diff_text = "\n".join(aggregated_diff_content[path])
                logger.info(f"File '{path}' - Using aggregated commit diffs (comparison API returned empty)")
            elif not diff_text:
                logger.warning(f"File '{path}' has EMPTY diff and no aggregated fallback available")
            
            additions, deletions = count_diff_changes(diff_text)
            final_diff_paths.add(path)
            
            # Debug: Log each file's diff stats
            if additions == 0 and deletions == 0 and diff_text:
                print(f"DEBUG: File {path} has diff_text but 0 additions/deletions. diff_text[:100]: {diff_text[:100]}")
            
            # Get related commits for this file
            related_commit_ids = all_files_in_commits.get(path, [])
            related_commits = [
                commit_info_map[cid] for cid in related_commit_ids 
                if cid in commit_info_map
            ]
            
            evidence_fields = self._build_file_evidence_fields(
                project_id=project_id,
                base_commit=base_commit,
                target_commit=target,
                path=path,
                old_path=d.get("old_path") if d.get("renamed_file") else None,
                status=status,
                diff_text=diff_text,
                related_commits=related_commits,
                has_history_only=False
            ) if include_file_evidence else {}
            last_touch_fields = build_last_touch_for_path(path, related_commits)
            
            file_changes_map[path] = FileChange(
                path=path,
                old_path=d.get("old_path") if d.get("renamed_file") else None,
                status=status,
                additions=additions,
                deletions=deletions,
                diff=diff_text if diff_text else None,
                commit_ids=related_commit_ids,
                related_commits=related_commits,
                commit_file_stats=commit_file_stats.get(path, []),
                has_history_only=False,
                **last_touch_fields,
                **evidence_fields
            )
        
        # Handle files touched by author but not in Net Diff (author filter only).
        # These files were modified in commits but have NO net change between Base and Target.
        # Show them with status='history_only' and +0/-0 (consistent with Net Diff logic).
        if author_filter:
            for path in aggregated_diff_content:
                if path not in final_diff_paths:
                    # This file was touched by the author but has no net change (Base == Target for this file).
                    related_commit_ids = all_files_in_commits.get(path, [])
                    related_commits = [
                        commit_info_map[cid] for cid in related_commit_ids 
                        if cid in commit_info_map
                    ]
                    
                    evidence_fields = self._build_file_evidence_fields(
                        project_id=project_id,
                        base_commit=base_commit,
                        target_commit=target,
                        path=path,
                        old_path=None,
                        status="history_only",
                        diff_text=None,
                        related_commits=related_commits,
                        has_history_only=True
                    ) if include_file_evidence else {}
                    last_touch_fields = build_last_touch_for_path(path, related_commits)
                    
                    file_changes_map[path] = FileChange(
                        path=path,
                        status="history_only",  # No net change between Base and Target
                        additions=0,
                        deletions=0,
                        diff=None,  # No net diff
                        commit_ids=related_commit_ids,
                        related_commits=related_commits,
                        commit_file_stats=commit_file_stats.get(path, []),
                        has_history_only=True,
                        **last_touch_fields,
                        **evidence_fields
                    )
                    final_diff_paths.add(path)
                    print(f"DEBUG: Added author-touched file {path} as history_only (no net diff)")
        
        # Detect history-only files (touched in commits but no net change in final diff)
        for path, commit_ids in all_files_in_commits.items():
            if path not in final_diff_paths:
                # This file was changed in commits but has no net diff
                related_commits = [
                    commit_info_map[cid] for cid in commit_ids 
                    if cid in commit_info_map
                ]
                evidence_fields = self._build_file_evidence_fields(
                    project_id=project_id,
                    base_commit=base_commit,
                    target_commit=target,
                    path=path,
                    old_path=None,
                    status="history_only",
                    diff_text=None,
                    related_commits=related_commits,
                    has_history_only=True
                ) if include_file_evidence else {}
                last_touch_fields = build_last_touch_for_path(path, related_commits)
                file_changes_map[path] = FileChange(
                    path=path,
                    status="history_only",
                    additions=0,
                    deletions=0,
                    diff=None,
                    commit_ids=commit_ids,
                    related_commits=related_commits,
                    commit_file_stats=commit_file_stats.get(path, []),
                    has_history_only=True,
                    **last_touch_fields,
                    **evidence_fields
                )

        file_changes = list(file_changes_map.values())
        
        # Sort by changes (most changed first), history-only at end
        file_changes.sort(key=lambda f: (f.has_history_only, -(f.additions + f.deletions)))
        
        return commits, file_changes
    
    def _determine_status(self, diff: dict) -> str:
        """Determine file change status from diff metadata"""
        if diff.get("new_file"):
            return "added"
        elif diff.get("deleted_file"):
            return "deleted"
        elif diff.get("renamed_file"):
            return "renamed"
        return "modified"
    
    def fetch_commits(self, project_id: str, limit: int = 100, ref_name: Optional[str] = None) -> List[dict]:
        """
        Fetch recent commits from the project.
        """
        try:
            project = self.get_project(project_id)
            
            # Use iteration for limits > 100 (GitLab default max per_page is usually 100)
            # We set per_page to min(limit, 100) to be efficient
            per_page = min(limit, 100)
            
            # Using lazy=True returns a generator object which handles pagination automatically
            commits_iter = project.commits.list(per_page=per_page, get_all=False, iterator=True, ref_name=ref_name)
            
            result = []
            count = 0
            
            for c in commits_iter:
                if count >= limit:
                    break
                try:
                    result.append({
                        "id": c.id,
                        "short_id": c.short_id,
                        "title": c.title,
                        "author_name": c.author_name,
                        "author_email": c.author_email,
                        "created_at": c.created_at
                    })
                    count += 1
                except Exception as e:
                    print(f"DEBUG: Error processing commit: {e}")
                    continue
                    
            return result
        except HTTPException:
            raise
        except gitlab.exceptions.GitlabGetError as e:
            print(f"DEBUG: fetch_commits GitlabGetError: {e}")
            raise HTTPException(status_code=400, detail=f"Failed to fetch commits: {e}")
        except gitlab.exceptions.GitlabAuthenticationError as e:
            print(f"DEBUG: fetch_commits AuthenticationError: {e}")
            raise HTTPException(status_code=401, detail=f"Authentication failed: {e}")
        except Exception as e:
            print(f"DEBUG: fetch_commits Unexpected Error: {e}")
            raise HTTPException(status_code=500, detail=f"Unexpected error fetching commits: {str(e)}")
    
    def fetch_authors(self, project_id: str, per_page: int = 100, ref_name: Optional[str] = None) -> List[dict]:
        """
        Fetch unique authors from recent commits.
        """
        try:
            project = self.get_project(project_id)
            kwargs = {'per_page': per_page, 'get_all': False}
            if ref_name:
                kwargs['ref_name'] = ref_name
                
            commits = project.commits.list(**kwargs)
            authors = {}
            for c in commits:
                try:
                    key = c.author_email.lower()
                    if key not in authors:
                        authors[key] = {
                            "name": c.author_name,
                            "email": c.author_email
                        }
                except Exception as e:
                    print(f"DEBUG: Error processing author from commit: {e}")
                    continue
            return list(authors.values())
        except HTTPException:
            raise
        except gitlab.exceptions.GitlabGetError as e:
            print(f"DEBUG: fetch_authors GitlabGetError: {e}")
            raise HTTPException(status_code=400, detail=f"Failed to fetch authors: {e}")
        except gitlab.exceptions.GitlabAuthenticationError as e:
            print(f"DEBUG: fetch_authors AuthenticationError: {e}")
            raise HTTPException(status_code=401, detail=f"Authentication failed: {e}")
        except Exception as e:
            print(f"DEBUG: fetch_authors Unexpected Error: {e}")
            raise HTTPException(status_code=500, detail=f"Unexpected error fetching authors: {str(e)}")

    def get_file_diff_in_commit(
        self,
        project_id: str,
        commit_id: str,
        file_path: str,
        path_aliases: Optional[List[str]] = None
    ) -> Optional[dict]:
        """Fetch diff for a specific file in a specific commit"""
        try:
            project = self.get_project(project_id)
            # Use cached methods
            commit = self._get_commit(project, commit_id)
            diffs = self._get_diff(commit, project_id)
            aliases = set(path_aliases or [])
            aliases.add(file_path)
            
            for d in diffs:
                # Check both new_path and old_path to handle renames
                if d.get('new_path') in aliases or d.get('old_path') in aliases:
                    # Enrich with commit info
                    d['commit_id'] = commit.id
                    d['full_sha'] = commit.id
                    d['short_sha'] = getattr(commit, 'short_id', commit.id[:8])
                    d['commit_message'] = commit.title
                    d['author_name'] = commit.author_name
                    d['author_email'] = getattr(commit, 'author_email', '')
                    d['created_at'] = commit.created_at
                    return d
            return None
        except Exception as e:
            logger.warning(f"Error fetching file diff in commit {commit_id} for {file_path}: {e}")
            return None

    def get_file_content(self, project_id: str, file_path: str, ref: str) -> Optional[str]:
        """Fetch raw file content at a specific ref (branch or commit)"""
        cache_key = (self.git_url, project_id, file_path, ref)
        if cache_key in _global_file_content_cache:
            return _global_file_content_cache[cache_key]

        try:
            project = self.get_project(project_id)
            f = project.files.get(file_path=file_path, ref=ref)
            content = f.decode().decode('utf-8')
            _global_file_content_cache[cache_key] = content
            return content
        except Exception as e:
            logger.debug(f"Error fetching file content for {file_path} @ {ref}: {e}")
            _global_file_content_cache[cache_key] = None
            return None


