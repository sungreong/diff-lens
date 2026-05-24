import json
import asyncio
import time
import os
from typing import List, AsyncGenerator
from .agents import FileAnalyzerAgent, HistoryAnalyzerAgent
from .analysis_cache import (
    build_analysis_cache_key,
    claim_inflight,
    get_cached_payload,
    llm_fingerprint,
    resolve_inflight,
    set_cached_payload,
    update_inflight_progress,
    wait_for_inflight_payload,
)
from .git_client import count_diff_changes

VALID_ANALYSIS_SORTS = {"changes", "deletions", "additions", "commits", "recent", "risk", "path"}


def _commit_ids_for_cache(commits):
    return [
        c.get("full_sha") or c.get("id") or c.get("short_sha") or ""
        for c in commits
    ]


def _request_repo_identity(request, project_id=None):
    return {
        "git_url": getattr(request, "git_url", None) or "",
        "project_id": project_id or getattr(request, "project_id", None) or getattr(request, "repo_id", None) or "",
        "base_commit": getattr(request, "base_commit", None) or "",
        "target_commit": getattr(request, "target_commit", None) or "HEAD",
    }


def normalize_analysis_sort(value):
    sort_key = (value or "changes").lower()
    return sort_key if sort_key in VALID_ANALYSIS_SORTS else "changes"


def file_risk_priority(file_change) -> int:
    path = (getattr(file_change, "path", "") or "").lower()
    score = 0
    if any(token in path for token in ["auth", "permission", "security", "token", "secret", "credential"]):
        score += 80
    if any(token in path for token in ["api", "router", "route", "endpoint", "controller"]):
        score += 45
    if any(token in path for token in ["schema", "migration", "model", "database", "sql", "db"]):
        score += 45
    if any(token in path for token in ["config", ".env", "docker", "compose", "requirements", "package.json", "lock"]):
        score += 35
    if any(token in path for token in ["test", "spec"]):
        score -= 10
    score += min((getattr(file_change, "deletions", 0) or 0), 120)
    score += min((len(getattr(file_change, "commit_ids", []) or [])) * 8, 80)
    return score


def file_latest_touch(file_change) -> str:
    return (
        getattr(file_change, "last_touched_at", None)
        or max([
            c.get("committed_date") or c.get("created_at") or c.get("date") or ""
            for c in (getattr(file_change, "related_commits", []) or [])
        ] or [""])
    )


def sort_file_changes_for_analysis(file_changes: List, sort_key: str) -> List:
    sort_key = normalize_analysis_sort(sort_key)
    if sort_key == "path":
        key_fn = lambda f: (getattr(f, "path", "") or "")
        return sorted(file_changes, key=key_fn)
    if sort_key == "deletions":
        key_fn = lambda f: (getattr(f, "has_history_only", False), -(getattr(f, "deletions", 0) or 0), -((getattr(f, "additions", 0) or 0) + (getattr(f, "deletions", 0) or 0)), getattr(f, "path", ""))
    elif sort_key == "additions":
        key_fn = lambda f: (getattr(f, "has_history_only", False), -(getattr(f, "additions", 0) or 0), -((getattr(f, "additions", 0) or 0) + (getattr(f, "deletions", 0) or 0)), getattr(f, "path", ""))
    elif sort_key == "commits":
        key_fn = lambda f: (getattr(f, "has_history_only", False), -(len(getattr(f, "commit_ids", []) or [])), -((getattr(f, "additions", 0) or 0) + (getattr(f, "deletions", 0) or 0)), getattr(f, "path", ""))
    elif sort_key == "recent":
        key_fn = lambda f: (getattr(f, "has_history_only", False), file_latest_touch(f), (getattr(f, "additions", 0) or 0) + (getattr(f, "deletions", 0) or 0), getattr(f, "path", ""))
        return sorted(file_changes, key=key_fn, reverse=True)
    elif sort_key == "risk":
        key_fn = lambda f: (getattr(f, "has_history_only", False), -file_risk_priority(f), -((getattr(f, "additions", 0) or 0) + (getattr(f, "deletions", 0) or 0)), getattr(f, "path", ""))
    else:
        key_fn = lambda f: (getattr(f, "has_history_only", False), -((getattr(f, "additions", 0) or 0) + (getattr(f, "deletions", 0) or 0)), getattr(f, "path", ""))
    return sorted(file_changes, key=key_fn)

async def run_history_batch_analysis(
    file_changes: List,
    request,
    llm,
    prompts,
    tracing_context,
    client,
    project_id: str
) -> AsyncGenerator[str, None]:
    """
    Executes batch deep history analysis for all target files.
    Yields SSE data strings.
    """
    yield f"data: {json.dumps({'phase': 'analyzing', 'message': '심층 히스토리 분석 시작 (시간이 다소 소요됩니다)...'})}\n\n"
    
    history_agent = HistoryAnalyzerAgent(llm, prompts, tracing_context)
    
    # Use max_files parameter
    limit = getattr(request, 'max_files', 0)
    target_files = file_changes[:limit] if limit > 0 else file_changes
    total_targets = len(target_files)
    
    for file_idx, file in enumerate(target_files):
        yield f"data: {json.dumps({'phase': 'analyzing', 'current': file_idx + 1, 'total': total_targets, 'message': f'[{file.path}] 히스토리 추적 중...'})}\n\n"
        
        owns_history_key = False
        history_cache_key = None
        try:
            history_cache_key = build_analysis_cache_key(
                namespace="history_file",
                repo_identity={**_request_repo_identity(request, project_id), "file_path": file.path},
                request_scope={
                    "analysis_mode": "history",
                    "file_path": file.path,
                    "old_path": getattr(file, "old_path", None),
                },
                model_config=llm_fingerprint(llm),
                prompts=prompts or {},
                commit_ids=_commit_ids_for_cache(getattr(file, "related_commits", []) or []),
                files=[file],
            )
            cached_history = get_cached_payload(history_cache_key)
            if cached_history:
                cached_history["phase"] = "history_file_result"
                cached_history["cache_hit"] = True
                cached_history["cache_hits"] = cached_history.pop("_cache_hits", 1)
                yield f"data: {json.dumps(cached_history)}\n\n"
                continue

            owns_history_key, history_event = claim_inflight(history_cache_key)
            if not owns_history_key:
                waiting_payload = await wait_for_inflight_payload(history_cache_key, history_event, timeout=600)
                if waiting_payload:
                    waiting_payload["phase"] = "history_file_result"
                    waiting_payload["cache_hit"] = True
                    waiting_payload["cache_waited"] = True
                    waiting_payload["cache_hits"] = waiting_payload.pop("_cache_hits", 1)
                    yield f"data: {json.dumps(waiting_payload)}\n\n"
                    continue

            # 1. Collect per-commit diffs
            file_history_results = []
            
            commits_to_analyze = sorted(
                file.related_commits,
                key=lambda c: c.get('committed_date') or c.get('created_at') or ''
            )
            path_aliases = [file.path]
            if getattr(file, "old_path", None):
                path_aliases.append(file.old_path)
            
            for c_info in commits_to_analyze:
                # Fetch diff for this file in this commit
                commit_sha = c_info.get('full_sha') or c_info.get('id')
                diff_data = client.get_file_diff_in_commit(project_id, commit_sha, file.path, path_aliases=path_aliases)
                if diff_data:
                    diff_text = diff_data.get('diff', '')
                    # Calculate diff stats
                    adds, dels = count_diff_changes(diff_text)
                    diff_stat = f"+{adds}/-{dels}"
                    evidence_pack = history_agent.build_evidence_pack(diff_text)
                    
                    # Analyze single commit
                    commit_for_agent = {
                        'id': commit_sha,
                        'full_sha': commit_sha,
                        'message': c_info.get('message') or c_info.get('title'),
                        'author': c_info.get('author_name') or c_info.get('author'),
                        'date': c_info.get('committed_date') or c_info.get('created_at')
                    }
                    analysis = history_agent.analyze_commit(file.path, commit_for_agent, diff_text)
                    
                    file_history_results.append({
                        'commit_id': commit_sha,
                        'short_id': c_info.get('short_sha') or commit_sha[:8],
                        'message': c_info.get('title'),
                        'author': c_info.get('author_name') or c_info.get('author'),
                        'date': diff_data.get('created_at') or c_info.get('created_at'),
                        'diff_stat': diff_stat,
                        'analysis': analysis,
                        'confidence': evidence_pack['confidence'],
                        'evidence_level': evidence_pack['evidence_level'],
                        'omitted_hunks': evidence_pack['omitted_hunks'],
                        'warnings': evidence_pack['warnings'],
                        'change_evidence': evidence_pack['change_evidence'],
                        'risk_verdict': '불확실',
                        'risk_reason': '커밋 단위 분석은 diff 근거를 제공하지만 테스트 실행 증거가 없어 안전 여부를 단정하지 않습니다.'
                    })
            
            # 2. Generate Final Summary
            history_dicts = file_history_results
            final_summary = history_agent.summarize_history(file.path, history_dicts)
            
            # 3. Yield Result
            result_payload = {
                'phase': 'history_file_result',
                'file_path': file.path,
                'summary': final_summary,
                'commit_count': len(file_history_results),
                'contributors': list(set(r['author'] for r in file_history_results)),
                'full_analysis': {
                    'file_path': file.path,
                    'final_summary': final_summary,
                    'history': file_history_results,
                    'commits_analyzed': len(file_history_results),
                    'before_summary': getattr(file, 'before_summary', None),
                    'after_summary': getattr(file, 'after_summary', None),
                    'risk_verdict': getattr(file, 'risk_verdict', '불확실'),
                    'risk_reason': getattr(file, 'risk_reason', None),
                    'confidence': getattr(file, 'confidence', 'low'),
                    'recommended_checks': getattr(file, 'recommended_checks', [])
                }
            }
            cache_payload_written = False
            try:
                set_cached_payload(history_cache_key, "history_file", result_payload)
                cache_payload_written = True
            finally:
                if owns_history_key or cache_payload_written:
                    resolve_inflight(history_cache_key)
            yield f"data: {json.dumps(result_payload)}\n\n"
            
        except asyncio.CancelledError:
            if owns_history_key and history_cache_key:
                resolve_inflight(history_cache_key)
            raise
        except Exception as e:
            if owns_history_key and history_cache_key:
                resolve_inflight(history_cache_key)
            print(f"Error analyzing history for {file.path}: {e}")
            yield f"data: {json.dumps({'phase': 'error', 'message': f'{file.path} 분석 실패: {str(e)}'})}\n\n"


async def run_standard_analysis(
    file_changes: List,
    request,
    llm,
    prompts,
    tracing_context,
    progress_key=None,
) -> AsyncGenerator[str, None]:
    """
    Executes standard file analysis (concurrent batch).
    Yields SSE data strings.
    """
    file_agent = FileAnalyzerAgent(llm, prompts, tracing_context)
    
    # Use max_files parameter
    limit = getattr(request, 'max_files', 0)
    if limit > 0:
        files_to_analyze = file_changes[:limit]
    else:
        files_to_analyze = file_changes
    
    total_to_analyze = len(files_to_analyze)
    max_concurrency = max(1, int(os.getenv("AI_FILE_CONCURRENCY", "5")))
    completed = 0
    cache_completed = 0
    file_durations = []
    analysis_started_at = time.perf_counter()

    update_inflight_progress(progress_key, {
        "phase": "analyzing",
        "message": "파일별 AI 분석 준비 중...",
        "current": 0,
        "total": total_to_analyze,
        "cache_completed_count": 0,
        "elapsed_seconds": 0,
        "average_seconds": None,
        "estimated_remaining_seconds": None,
        "concurrency": max_concurrency,
    })

    yield f"data: {json.dumps({'phase': 'analyzing', 'current': 0, 'total': total_to_analyze, 'message': f'동시 분석 준비 중 (최대 {max_concurrency}개 파일 병렬)'})}\n\n"

    semaphore = asyncio.Semaphore(max_concurrency)

    async def analyze_file(file):
        async with semaphore:
            owns_file_key = False
            cache_payload_written = False
            analysis_failed = False
            file_started_at = time.perf_counter()
            file_cache_key = build_analysis_cache_key(
                namespace="file_ai",
                repo_identity={**_request_repo_identity(request), "file_path": file.path},
                request_scope={
                    "agent": "file_analyzer",
                    "file_path": file.path,
                    "old_path": getattr(file, "old_path", None),
                },
                model_config=llm_fingerprint(llm),
                prompts={
                    "file_analyzer": (prompts or {}).get("file_analyzer", {}),
                    "diff_consolidator": (prompts or {}).get("diff_consolidator", {}),
                },
                commit_ids=getattr(file, "commit_ids", []) or [],
                files=[file],
            )
            cached_file = get_cached_payload(file_cache_key)
            if cached_file:
                file.ai_summary = cached_file.get("summary", "")
                return file, True, time.perf_counter() - file_started_at

            owns_file_key, file_event = claim_inflight(file_cache_key)
            if not owns_file_key:
                waited_file = await wait_for_inflight_payload(file_cache_key, file_event, timeout=300)
                if waited_file:
                    file.ai_summary = waited_file.get("summary", "")
                    return file, True, time.perf_counter() - file_started_at

            try:
                file.ai_summary = await file_agent.arun(file)
            except asyncio.CancelledError:
                if owns_file_key:
                    resolve_inflight(file_cache_key)
                raise
            except Exception as e:
                analysis_failed = True
                file.ai_summary = f"분석 중 오류: {str(e)[:50]}"
            if not analysis_failed:
                try:
                    set_cached_payload(
                        file_cache_key,
                        "file_ai",
                        {
                            "summary": file.ai_summary,
                            "file_path": file.path,
                        },
                    )
                    cache_payload_written = True
                finally:
                    if owns_file_key or cache_payload_written:
                        resolve_inflight(file_cache_key)
            elif owns_file_key:
                resolve_inflight(file_cache_key)
            return file, False, time.perf_counter() - file_started_at

    tasks = [asyncio.create_task(analyze_file(file)) for file in files_to_analyze]
    try:
        for completed_task in asyncio.as_completed(tasks):
            file, cache_hit, duration_seconds = await completed_task
            completed += 1
            if cache_hit:
                cache_completed += 1
            file_durations.append(duration_seconds)
            elapsed_seconds = time.perf_counter() - analysis_started_at
            average_seconds = sum(file_durations) / len(file_durations) if file_durations else None
            estimated_remaining_seconds = (
                max(total_to_analyze - completed, 0) * average_seconds
                if average_seconds is not None
                else None
            )
            payload = {
                'phase': 'file_done',
                'current': completed,
                'total': total_to_analyze,
                'file': file.path,
                'summary': file.ai_summary or '',
                'cache_hit': cache_hit,
                'duration_seconds': round(duration_seconds, 2),
                'elapsed_seconds': round(elapsed_seconds, 2),
                'average_seconds': round(average_seconds, 2) if average_seconds is not None else None,
                'estimated_remaining_seconds': round(estimated_remaining_seconds, 2) if estimated_remaining_seconds is not None else None,
                'cache_completed_count': cache_completed,
                'concurrency': max_concurrency,
                # Enhanced fields for filtering/display
                'commit_count': len(file.commit_ids),
                'commit_ids': file.commit_ids,
                'status': file.status,
                # Diff stats for immediate display
                'additions': file.additions,
                'deletions': file.deletions,
                'diff': file.diff,
                'before_summary': getattr(file, 'before_summary', None),
                'after_summary': getattr(file, 'after_summary', None),
                'change_evidence': getattr(file, 'change_evidence', []),
                'risk_verdict': getattr(file, 'risk_verdict', '불확실'),
                'risk_reason': getattr(file, 'risk_reason', None),
                'confidence': getattr(file, 'confidence', 'low'),
                'uncertainty_reason': getattr(file, 'uncertainty_reason', None),
                'recommended_checks': getattr(file, 'recommended_checks', []),
                'evidence_level': getattr(file, 'evidence_level', 'unknown'),
                'omitted_hunks': getattr(file, 'omitted_hunks', 0),
                'analysis_warnings': getattr(file, 'analysis_warnings', [])
            }
            update_inflight_progress(progress_key, {
                "phase": "analyzing",
                "message": f"파일 분석 중: {completed}/{total_to_analyze}",
                "current": completed,
                "total": total_to_analyze,
                "file": file.path,
                "duration_seconds": payload["duration_seconds"],
                "elapsed_seconds": payload["elapsed_seconds"],
                "average_seconds": payload["average_seconds"],
                "estimated_remaining_seconds": payload["estimated_remaining_seconds"],
                "cache_completed_count": cache_completed,
                "last_cache_hit": cache_hit,
                "concurrency": max_concurrency,
            })
            yield f"data: {json.dumps(payload)}\n\n"
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
