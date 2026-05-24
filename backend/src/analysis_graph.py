"""LangGraph-backed v2 compare analysis orchestration.

The public surface of this module is an async SSE-friendly event generator.
It keeps direct Git diff files as ground truth and emits inferred impact
candidate files as a separate result stream.
"""
import asyncio
import hashlib
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple, TypedDict

try:
    from langgraph.graph import END, StateGraph
except Exception:  # pragma: no cover - dependency is pinned for app runtime.
    END = None
    StateGraph = None

from .agents import FileAnalyzerAgent
from .analysis_impact import (
    IMPACT_HARD_MAX_FILES,
    TREE_MAX_ITEMS,
    _safe_ref_prefix,
    discover_impact_candidates,
    extract_impact_seeds,
    redact_secret_like_values,
)
from .analysis_cache import (
    build_analysis_cache_key,
    build_payload_cache_key,
    claim_inflight,
    get_cached_payload,
    llm_fingerprint,
    resolve_inflight,
    set_cached_payload,
    stable_hash,
    update_inflight_progress,
    wait_for_inflight_payload,
)
from .diff_triage import DiffTriageService
from .git_repository_agent import GitRepositoryAgent, compare_strategy_to_straight
from .git_client import GitLabClient
from .models import CompareV2Request, FileChange
from .prompt_registry import build_string_chain, merge_prompt_configs


SCHEMA_VERSION = "2.0"
DIRECT_ANALYSIS_CONCURRENCY = int(os.getenv("AI_FILE_CONCURRENCY", "3"))
IMPACT_ANALYSIS_CONCURRENCY = int(os.getenv("AI_IMPACT_CONCURRENCY", "4"))


class CompareGraphState(TypedDict, total=False):
    request: CompareV2Request
    baseline_resolved: Dict[str, Any]
    candidate_resolved: Dict[str, Any]
    commits: List[Dict[str, Any]]
    direct_files: List[FileChange]
    impact_candidates: List[Dict[str, Any]]
    summary: str


COMPARE_GRAPH_STEPS = [
    "resolve_refs",
    "fetch_compare",
    "triage_changed_files",
    "analyze_changed_files",
    "discover_impact_candidates",
    "analyze_impact_files",
    "summarize_release_risk",
]


def build_compare_graph():
    """Expose the v2 analysis topology as a LangGraph StateGraph."""
    if StateGraph is None:
        return None

    def passthrough(state: CompareGraphState) -> CompareGraphState:
        return state

    graph = StateGraph(CompareGraphState)
    for node in COMPARE_GRAPH_STEPS:
        graph.add_node(node, passthrough)

    graph.set_entry_point(COMPARE_GRAPH_STEPS[0])
    for source, target in zip(COMPARE_GRAPH_STEPS, COMPARE_GRAPH_STEPS[1:]):
        graph.add_edge(source, target)
    graph.add_edge(COMPARE_GRAPH_STEPS[-1], END)
    return graph.compile()


COMPARE_GRAPH = build_compare_graph()

def annotate_compare_origin(files: List[FileChange], compare_strategy: str) -> List[FileChange]:
    """Attach pre-deploy meaning to raw Git file statuses."""
    for file in files:
        if compare_strategy == "branch_delta":
            file.compare_origin = "candidate_delta"
            file.compare_origin_label = "브랜치 작업분"
            file.deployment_risk_flag = None
            continue

        if file.status == "deleted":
            file.compare_origin = "baseline_only"
            file.compare_origin_label = "기준 버전에만 있음"
            file.deployment_risk_flag = "candidate_missing_baseline_change"
        elif file.status == "added":
            file.compare_origin = "candidate_only"
            file.compare_origin_label = "개발 후보에만 있음"
            file.deployment_risk_flag = None
        elif file.status == "renamed":
            file.compare_origin = "moved_between_versions"
            file.compare_origin_label = "기준/후보 간 경로 변경"
            file.deployment_risk_flag = None
        elif file.status == "history_only":
            file.compare_origin = "history_only"
            file.compare_origin_label = "커밋 이력만 있음"
            file.deployment_risk_flag = None
        else:
            file.compare_origin = "changed_between_versions"
            file.compare_origin_label = "기준/후보 간 내용 변경"
            file.deployment_risk_flag = None
    return files


def compare_origin_counts(files: List[FileChange]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for file in files:
        key = file.compare_origin or "unknown"
        counts[key] = counts.get(key, 0) + 1
    return counts


def build_run_manifest(
    request: CompareV2Request,
    run_id: str,
    baseline_ref: str,
    candidate_ref: str,
    baseline_resolved: Dict[str, Any],
    candidate_resolved: Dict[str, Any],
    straight: bool,
    raw_file_count: int = 0,
    scoped_file_count: int = 0,
    analysis_file_count: int = 0,
    skipped_reasons: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "run_id": run_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "comparison_type": request.comparison_type,
        "compare_strategy": request.compare_strategy,
        "straight": straight,
        "baseline_ref": baseline_ref,
        "candidate_ref": candidate_ref,
        "baseline_sha": baseline_resolved.get("sha"),
        "candidate_sha": candidate_resolved.get("sha"),
        "baseline_type": baseline_resolved.get("type"),
        "candidate_type": candidate_resolved.get("type"),
        "ref_lock": {
            "baseline_sha": request.baseline_sha,
            "candidate_sha": request.candidate_sha,
            "enforced": bool(request.fail_on_ref_drift),
            "locked": bool(request.baseline_sha and request.candidate_sha),
        },
        "analysis_scope": {
            "raw_file_count": raw_file_count,
            "scoped_file_count": scoped_file_count,
            "analysis_file_count": analysis_file_count,
            "file_status_filter": request.file_status_filter or "all",
            "max_files": request.max_files,
            "analysis_sort": request.analysis_sort,
            "include_impact": request.include_impact,
        },
        "limits": {
            "impact_max_files": min(request.impact_max_files or 15, IMPACT_HARD_MAX_FILES),
            "impact_hard_max_files": IMPACT_HARD_MAX_FILES,
            "tree_max_items": TREE_MAX_ITEMS,
            "context_depth": request.context_depth,
        },
        "merge_check": _merge_check_manifest(request.merge_check_context),
        "skipped_reasons": skipped_reasons or [],
    }


def _merge_check_manifest(merge_check_context: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not merge_check_context:
        return None
    return {
        "status": merge_check_context.get("status"),
        "has_conflicts": merge_check_context.get("has_conflicts"),
        "conflict_count": len(merge_check_context.get("conflict_files") or []),
        "method": merge_check_context.get("method"),
        "message": merge_check_context.get("message"),
    }


def _model_dump(obj: Any) -> Dict[str, Any]:
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    if hasattr(obj, "dict"):
        return obj.dict()
    return dict(obj)


def _event(run_id: str, phase: str, node: str, event: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "run_id": run_id,
        "phase": phase,
        "node": node,
        "event": event,
        "payload": payload or {},
    }


def _merge_check_prompt_context(merge_check_context: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not merge_check_context:
        return None
    conflict_files = merge_check_context.get("conflict_files") or []
    diagnostics = merge_check_context.get("diagnostics") or {}
    return {
        "status": merge_check_context.get("status"),
        "mergeable": merge_check_context.get("mergeable"),
        "has_conflicts": merge_check_context.get("has_conflicts"),
        "message": merge_check_context.get("message"),
        "target_ref": merge_check_context.get("target_ref"),
        "source_ref": merge_check_context.get("source_ref"),
        "target_sha": (merge_check_context.get("target_sha") or "")[:12],
        "source_sha": (merge_check_context.get("source_sha") or "")[:12],
        "merge_base_sha": (merge_check_context.get("merge_base_sha") or "")[:12],
        "conflict_files": conflict_files[:30],
        "conflict_count": len(conflict_files),
        "diagnostic_codes": sorted(diagnostics.keys())[:10],
    }


async def _analyze_direct_file(
    file: FileChange,
    llm: Any,
    prompts: Dict[str, Any],
    tracing_context: Optional[Dict[str, Any]],
    semaphore: asyncio.Semaphore,
    cache_context: Optional[Dict[str, Any]] = None,
) -> Tuple[FileChange, bool]:
    async with semaphore:
        cache_key = None
        owns_cache_key = False
        if cache_context:
            cache_key = build_analysis_cache_key(
                namespace="compare_v2_direct_file",
                repo_identity={
                    **cache_context.get("repo_identity", {}),
                    "file_path": file.path,
                },
                request_scope={
                    **cache_context.get("request_scope", {}),
                    "agent": "file_analyzer",
                    "file_path": file.path,
                    "old_path": file.old_path,
                },
                model_config=cache_context.get("model_config", {}),
                prompts={
                    "file_analyzer": (prompts or {}).get("file_analyzer", {}),
                    "diff_consolidator": (prompts or {}).get("diff_consolidator", {}),
                },
                commit_ids=file.commit_ids or [],
                files=[file],
            )
            cached_file = get_cached_payload(cache_key)
            if cached_file:
                file.ai_summary = cached_file.get("summary", "")
                return file, True

            owns_cache_key, cache_event = claim_inflight(cache_key)
            if not owns_cache_key:
                waited_file = await wait_for_inflight_payload(cache_key, cache_event, timeout=300)
                if waited_file:
                    file.ai_summary = waited_file.get("summary", "")
                    return file, True

        agent = FileAnalyzerAgent(llm, prompts, tracing_context)
        try:
            file.ai_summary = await agent.arun(file)
        except Exception as exc:
            file.ai_summary = f"분석 중 오류: {exc}"
        else:
            if cache_key:
                set_cached_payload(cache_key, "compare_v2_direct_file", {
                    "summary": file.ai_summary,
                    "file_path": file.path,
                })
        finally:
            if owns_cache_key and cache_key:
                resolve_inflight(cache_key)
        return file, False


async def _analyze_impact_candidate(
    candidate: Dict[str, Any],
    direct_files: List[FileChange],
    llm: Any,
    prompts: Dict[str, Any],
    semaphore: asyncio.Semaphore,
    cache_context: Optional[Dict[str, Any]] = None,
) -> Tuple[Dict[str, Any], bool]:
    if not llm:
        candidate["ai_summary"] = (
            "LLM 설정이 없어 휴리스틱 근거만 표시합니다. "
            "이 파일은 직접 변경은 아니며 영향 후보로만 봐야 합니다."
        )
        return candidate, False

    async with semaphore:
        changed_context = []
        for file in direct_files[:8]:
            changed_context.append({
                "path": file.path,
                "status": file.status,
                "risk_verdict": file.risk_verdict,
                "diff_excerpt": redact_secret_like_values(file.diff or "")[:1200],
            })
        cache_key = None
        owns_cache_key = False
        if cache_context:
            cache_key = build_payload_cache_key(
                "compare_v2_impact_file",
                {
                    "candidate": candidate,
                    "changed_context": changed_context,
                    "request_scope": cache_context.get("request_scope", {}),
                    "repo_identity": cache_context.get("repo_identity", {}),
                    "model_config": cache_context.get("model_config", {}),
                    "prompts_hash": stable_hash({
                        "impact_candidate_analyzer": (prompts or {}).get("impact_candidate_analyzer", {}),
                    }),
                },
            )
            cached_candidate = get_cached_payload(cache_key)
            if cached_candidate:
                candidate["ai_summary"] = cached_candidate.get("ai_summary", "")
                return candidate, True

            owns_cache_key, cache_event = claim_inflight(cache_key)
            if not owns_cache_key:
                waited_candidate = await wait_for_inflight_payload(cache_key, cache_event, timeout=300)
                if waited_candidate:
                    candidate["ai_summary"] = waited_candidate.get("ai_summary", "")
                    return candidate, True

        chain = build_string_chain(
            llm,
            prompts,
            "impact_candidate_analyzer",
            system_default="너는 배포 전 코드 변경 영향도를 보수적으로 검토하는 시니어 엔지니어다.",
            user_default="""
다음 파일은 Git diff에 직접 변경된 파일이 아니라 AI 영향 후보입니다.
확정 사실처럼 말하지 말고, 근거와 확인 항목 중심으로 한국어로 짧게 분석하세요.

영향 후보:
{candidate}

직접 변경 파일 일부:
{changed_context}
""".strip(),
        )
        try:
            candidate["ai_summary"] = await chain.ainvoke({
                "candidate": candidate,
                "changed_context": changed_context,
            })
        except Exception as exc:
            candidate["ai_summary"] = f"영향 후보 분석 중 오류: {exc}"
        else:
            if cache_key:
                set_cached_payload(cache_key, "compare_v2_impact_file", {
                    "ai_summary": candidate.get("ai_summary", ""),
                    "path": candidate.get("path"),
                })
        finally:
            if owns_cache_key and cache_key:
                resolve_inflight(cache_key)
        return candidate, False


async def _summarize_release_risk(
    request: CompareV2Request,
    commits: List[Dict[str, Any]],
    direct_files: List[FileChange],
    impact_candidates: List[Dict[str, Any]],
    baseline_resolved: Dict[str, Any],
    candidate_resolved: Dict[str, Any],
    llm: Any,
    prompts: Dict[str, Any],
) -> str:
    high_risk = [
        file.path for file in direct_files
        if file.risk_verdict == "문제 가능성 있음" or any(
            area in {"database", "api", "security", "config"} for area in file.impact_areas
        )
    ][:10]
    hotfix_note = (
        "배포 상태 차이 모드이므로 기준 버전에만 있고 개발 후보에 빠진 변경도 diff에 드러날 수 있습니다."
        if compare_strategy_to_straight(request.compare_strategy)
        else "브랜치 작업분 모드이므로 기준 버전에만 있는 hotfix 누락은 별도 확인이 필요합니다."
    )
    baseline_only_count = sum(1 for file in direct_files if file.compare_origin == "baseline_only")
    merge_check_context = _merge_check_prompt_context(request.merge_check_context)
    merge_check_note = ""
    if merge_check_context:
        if merge_check_context.get("status") == "conflicts":
            merge_check_note = (
                f"- dry-run 충돌: {merge_check_context.get('conflict_count', 0)}개 파일 "
                f"({', '.join(merge_check_context.get('conflict_files') or []) or '파일 목록 없음'})\n"
            )
        elif merge_check_context.get("status") == "unknown":
            merge_check_note = f"- dry-run 확인 불가: {merge_check_context.get('message') or '원인 미상'}\n"
        elif merge_check_context.get("status") == "clean":
            merge_check_note = "- dry-run 결과: 텍스트 병합 충돌은 발견되지 않았습니다. 테스트 통과를 의미하지는 않습니다.\n"

    if not llm:
        return (
            f"배포 전 점검 요약\n\n"
            f"- 기준: {baseline_resolved.get('name')} ({baseline_resolved.get('short_sha')})\n"
            f"- 후보: {candidate_resolved.get('name')} ({candidate_resolved.get('short_sha')})\n"
            f"- 직접 변경 파일: {len(direct_files)}개, 커밋: {len(commits)}개\n"
            f"- 기준 버전에만 있는 파일/변경 후보: {baseline_only_count}개\n"
            f"- 고위험 후보 파일: {', '.join(high_risk) if high_risk else '명시적 고위험 패턴 없음'}\n"
            f"- AI 영향 후보: {len(impact_candidates)}개\n"
            f"{merge_check_note}"
            f"- 확인 메모: {hotfix_note}"
        )

    payload = {
        "comparison_type": request.comparison_type,
        "compare_strategy": request.compare_strategy,
        "baseline": baseline_resolved,
        "candidate": candidate_resolved,
        "commit_count": len(commits),
        "direct_files": [
            {
                "path": file.path,
                "status": file.status,
                "compare_origin": file.compare_origin,
                "compare_origin_label": file.compare_origin_label,
                "deployment_risk_flag": file.deployment_risk_flag,
                "additions": file.additions,
                "deletions": file.deletions,
                "risk_verdict": file.risk_verdict,
                "risk_reason": file.risk_reason,
                "impact_areas": file.impact_areas,
                "recommended_checks": file.recommended_checks[:3],
            }
            for file in direct_files[:25]
        ],
        "impact_candidates": impact_candidates[:15],
        "merge_check": merge_check_context,
        "hotfix_semantics": hotfix_note,
    }
    chain = build_string_chain(
        llm,
        prompts,
        "release_risk_summarizer",
        system_default="너는 배포 승인 전 위험을 요약하는 릴리즈 엔지니어다. 과장 없이 근거 기반으로 답한다.",
        user_default="""
아래 비교 결과를 바탕으로 배포 전 요약을 한국어 Markdown으로 작성하세요.
반드시 섹션은 '고위험 변경', '누락 가능 hotfix/상태 차이', 'AI 영향 후보', '권장 확인 항목' 순서로 둡니다.
직접 변경 파일과 AI 영향 후보의 확실성 차이를 분명히 표시하세요.
merge_check가 있으면 실제 merge가 아니라 dry-run 결과임을 밝히고, 충돌/확인 불가 상태에서 사용자가 다음에 물어볼 질문과 확인 순서를 제안하세요.

비교 결과:
{payload}
""".strip(),
    )
    try:
        return await chain.ainvoke({"payload": payload})
    except Exception as exc:
        return f"배포 전 요약 생성 중 오류: {exc}"


def _triage_files(request: CompareV2Request, file_changes: List[FileChange]):
    return DiffTriageService().triage(request, file_changes)


def build_v2_cache_identity(
    request: CompareV2Request,
    baseline_resolved: Dict[str, Any],
    candidate_resolved: Dict[str, Any],
    files: List[FileChange],
    model_config: Any,
    prompts: Optional[Dict[str, Any]] = None,
    repo_identity: Optional[Dict[str, Any]] = None,
) -> str:
    if isinstance(model_config, str):
        model_config = {"model": model_config, "base_url": "", "temperature": 0.3}
    prompts = prompts or {}
    file_sig = [
        {
            "path": file.path,
            "old_path": file.old_path,
            "status": file.status,
            "compare_origin": file.compare_origin,
            "additions": file.additions,
            "deletions": file.deletions,
            "diff_hash": hashlib.sha256((file.diff or "").encode("utf-8")).hexdigest(),
            "commit_ids": file.commit_ids or [],
        }
        for file in files
    ]
    payload = repr({
        "namespace": "compare-v2",
        "repo_identity": repo_identity or {},
        "baseline_sha": baseline_resolved.get("sha"),
        "candidate_sha": candidate_resolved.get("sha"),
        "compare_strategy": request.compare_strategy,
        "include_impact": request.include_impact,
        "impact_max_files": min(request.impact_max_files or 15, IMPACT_HARD_MAX_FILES),
        "context_depth": request.context_depth,
        "analysis_mode": request.analysis_mode,
        "file_status_filter": request.file_status_filter or "all",
        "analysis_sort": request.analysis_sort,
        "merge_check_context": _merge_check_manifest(request.merge_check_context),
        "model_config": model_config,
        "prompts_hash": stable_hash(prompts or {}),
        "files": file_sig,
    })
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


async def run_compare_graph_stream(
    request: CompareV2Request,
    client: GitLabClient,
    project_id: str,
    llm: Any = None,
    prompts: Optional[Dict[str, Any]] = None,
    tracing_context: Optional[Dict[str, Any]] = None,
    model_name: str = "gpt-4o-mini",
):
    """Yield v2 compare analysis events as dictionaries ready for SSE encoding."""
    run_id = uuid.uuid4().hex
    prompts = merge_prompt_configs(prompts)
    started = time.monotonic()
    baseline_ref = request.effective_baseline_ref()
    candidate_ref = request.effective_candidate_ref()
    owns_result_cache = False
    result_cache_key = None

    try:
        if not baseline_ref or not candidate_ref:
            yield _event(run_id, "error", "resolve_refs", "error", {
                "message": "baseline_ref와 candidate_ref가 필요합니다.",
            })
            return

        yield _event(run_id, "resolving_refs", "resolve_refs", "start", {
            "message": "기준/개발 ref를 고정 SHA로 해석하는 중...",
            "baseline_ref": baseline_ref,
            "candidate_ref": candidate_ref,
        })
        git_agent = GitRepositoryAgent(client, project_id)
        ref_pair = await asyncio.to_thread(git_agent.resolve_pair, request)
        baseline_resolved = ref_pair.baseline
        candidate_resolved = ref_pair.candidate
        ref_drift = ref_pair.drift
        if ref_drift and request.fail_on_ref_drift:
            yield _event(run_id, "error", "resolve_refs", "ref_drift_detected", {
                "message": "변경표를 만든 뒤 선택한 버전이 움직였습니다. 최신 기준으로 변경표를 다시 만든 다음 분석하세요.",
                "code": "ref_drift_detected",
                "mismatches": ref_drift,
                "baseline": baseline_resolved,
                "candidate": candidate_resolved,
            })
            return
        yield _event(run_id, "refs_resolved", "resolve_refs", "refs_resolved", {
            "baseline": baseline_resolved,
            "candidate": candidate_resolved,
            "ref_lock": {
                "locked": bool(request.baseline_sha and request.candidate_sha),
                "enforced": bool(request.fail_on_ref_drift),
            },
        })

        straight = compare_strategy_to_straight(request.compare_strategy)
        yield _event(run_id, "fetch", "fetch_compare", "start", {
            "message": "GitLab compare 결과를 가져오는 중...",
            "compare_strategy": request.compare_strategy,
            "straight": straight,
        })
        snapshot = await asyncio.to_thread(git_agent.compare_resolved, request, ref_pair)
        commits = snapshot.commits
        file_changes = snapshot.files
        annotate_compare_origin(file_changes, request.compare_strategy)
        triage = _triage_files(request, file_changes)
        file_changes = triage.files
        raw_file_count = triage.raw_file_count
        scoped_file_count = triage.scoped_file_count
        sort_key = triage.sort_key
        total_additions = sum(f.additions for f in file_changes)
        total_deletions = sum(f.deletions for f in file_changes)
        model_config = {
            **llm_fingerprint(llm, {"model": model_name, "base_url": ""}),
            "api_key_present": bool(llm),
        }
        repo_identity = {
            "project_id": project_id,
            "git_url": getattr(client, "git_url", ""),
        }
        cache_key = build_v2_cache_identity(
            request,
            baseline_resolved,
            candidate_resolved,
            file_changes,
            model_config,
            prompts,
            repo_identity=repo_identity,
        )
        result_cache_key = f"compare_v2:{cache_key}"
        origin_counts = compare_origin_counts(file_changes)
        run_manifest = build_run_manifest(
            request,
            run_id,
            baseline_ref,
            candidate_ref,
            baseline_resolved,
            candidate_resolved,
            straight,
            raw_file_count=raw_file_count,
            scoped_file_count=scoped_file_count,
            analysis_file_count=len(file_changes),
            skipped_reasons=triage.skipped_reasons,
        )
        yield _event(run_id, "fetch_done", "fetch_compare", "compare_fetched", {
            "message": f"직접 변경 파일 {len(file_changes)}개 준비",
            "commits": len(commits),
            "raw_file_count": raw_file_count,
            "scope_file_count": scoped_file_count,
            "file_count": len(file_changes),
            "total_additions": total_additions,
            "total_deletions": total_deletions,
            "analysis_sort": sort_key,
            "cache_key": cache_key[-16:],
            "direct_origin_counts": origin_counts,
            "triage_coverage": triage.coverage,
            "skipped_reasons": triage.skipped_reasons,
            "run_manifest": run_manifest,
        })

        cached_result = get_cached_payload(result_cache_key)
        if cached_result:
            cache_hits = cached_result.pop("_cache_hits", 1)
            cached_result.update({
                "run_id": run_id,
                "cache_hit": True,
                "cache_hits": cache_hits,
                "cache_key": cache_key[-16:],
                "elapsed_seconds": round(time.monotonic() - started, 2),
            })
            yield _event(run_id, "cache_hit", "analysis_cache", "cache_hit", {
                "message": "동일한 배포 전 AI 분석 결과를 캐시에서 재사용합니다.",
                "cache_key": cache_key[-16:],
                "cache_hits": cache_hits,
            })
            yield _event(run_id, "complete", "analysis_cache", "complete", cached_result)
            return

        owns_result_cache, result_cache_event = claim_inflight(result_cache_key)
        if not owns_result_cache:
            yield _event(run_id, "cache_wait", "analysis_cache", "cache_wait", {
                "message": "동일 조건의 배포 전 AI 분석이 이미 진행 중입니다. 완료 결과를 기다립니다.",
                "cache_key": cache_key[-16:],
            })
            waited_result = await wait_for_inflight_payload(result_cache_key, result_cache_event, timeout=900)
            if waited_result:
                cache_hits = waited_result.pop("_cache_hits", 1)
                waited_result.update({
                    "run_id": run_id,
                    "cache_hit": True,
                    "cache_waited": True,
                    "cache_hits": cache_hits,
                    "cache_key": cache_key[-16:],
                    "elapsed_seconds": round(time.monotonic() - started, 2),
                })
                yield _event(run_id, "cache_hit", "analysis_cache", "cache_hit", {
                    "message": "진행 중이던 동일 분석 결과를 재사용합니다.",
                    "cache_key": cache_key[-16:],
                    "cache_hits": cache_hits,
                })
                yield _event(run_id, "complete", "analysis_cache", "complete", waited_result)
                return
            yield _event(run_id, "cache_wait_timeout", "analysis_cache", "cache_wait_timeout", {
                "message": "기존 분석 대기가 길어져 현재 요청에서 이어서 진행합니다.",
                "cache_key": cache_key[-16:],
            })

        analysis_cache_context = {
            "repo_identity": {
                "project_id": project_id,
                "git_url": getattr(client, "git_url", ""),
                "baseline_sha": baseline_resolved.get("sha"),
                "candidate_sha": candidate_resolved.get("sha"),
                "baseline_ref": baseline_ref,
                "candidate_ref": candidate_ref,
            },
            "request_scope": {
                "comparison_type": request.comparison_type,
                "compare_strategy": request.compare_strategy,
                "analysis_mode": request.analysis_mode,
                "file_status_filter": request.file_status_filter or "all",
                "analysis_sort": sort_key,
                "context_depth": request.context_depth,
                "include_impact": request.include_impact,
                "impact_max_files": min(request.impact_max_files or 15, IMPACT_HARD_MAX_FILES),
                "merge_check_context": _merge_check_manifest(request.merge_check_context),
            },
            "model_config": model_config,
        }
        direct_cache_hits: Dict[str, bool] = {}
        update_inflight_progress(result_cache_key, {
            "phase": "compare_v2_ready",
            "message": f"직접 변경 파일 {len(file_changes)}개 준비",
            "current": 0,
            "total": len(file_changes),
            "cache_key": cache_key[-16:],
        })

        if request.analysis_mode != "git" and file_changes and llm:
            semaphore = asyncio.Semaphore(DIRECT_ANALYSIS_CONCURRENCY)
            tasks = [
                asyncio.create_task(_analyze_direct_file(file, llm, prompts, tracing_context, semaphore, analysis_cache_context))
                for file in file_changes
            ]
            completed = 0
            for task in asyncio.as_completed(tasks):
                file, cache_hit = await task
                completed += 1
                direct_cache_hits[file.path] = cache_hit
                file_payload = _model_dump(file)
                file_payload["cache_hit"] = cache_hit
                update_inflight_progress(result_cache_key, {
                    "phase": "compare_v2_direct_files",
                    "message": f"직접 변경 파일 분석 중: {completed}/{len(file_changes)}",
                    "current": completed,
                    "total": len(file_changes),
                    "file": file.path,
                    "last_cache_hit": cache_hit,
                    "cache_key": cache_key[-16:],
                })
                yield _event(run_id, "analyzing", "analyze_changed_files", "direct_file_done", {
                    "current": completed,
                    "total": len(file_changes),
                    "file": file_payload,
                    "cache_hit": cache_hit,
                })
        elif request.analysis_mode != "git" and file_changes:
            for idx, file in enumerate(file_changes, 1):
                file.ai_summary = "LLM 설정이 없어 Git 근거와 휴리스틱 필드만 표시합니다."
                yield _event(run_id, "analyzing", "analyze_changed_files", "direct_file_done", {
                    "current": idx,
                    "total": len(file_changes),
                    "file": _model_dump(file),
                })

        impact_candidates: List[Dict[str, Any]] = []
        impact_diagnostics: Dict[str, Any] = {"skipped_reasons": [], "skipped_counts": {}}
        if request.include_impact:
            yield _event(run_id, "discovering_impact", "discover_impact_candidates", "start", {
                "message": "변경 diff 기반으로 AI 영향 후보를 찾는 중...",
                "impact_max_files": min(request.impact_max_files or 15, IMPACT_HARD_MAX_FILES),
            })
            impact_candidates = await asyncio.to_thread(
                discover_impact_candidates,
                client,
                project_id,
                candidate_resolved["sha"],
                file_changes,
                request.impact_max_files,
                request.context_depth,
                impact_diagnostics,
            )
            yield _event(run_id, "impact_discovery_done", "discover_impact_candidates", "impact_discovery_done", {
                "diagnostics": impact_diagnostics,
            })
            for candidate in impact_candidates:
                yield _event(run_id, "impact_candidate", "discover_impact_candidates", "impact_candidate_found", {
                    "candidate": candidate,
                })

        if impact_candidates:
            semaphore = asyncio.Semaphore(IMPACT_ANALYSIS_CONCURRENCY)
            tasks = [
                asyncio.create_task(_analyze_impact_candidate(candidate, file_changes, llm, prompts, semaphore, analysis_cache_context))
                for candidate in impact_candidates
            ]
            completed = 0
            for task in asyncio.as_completed(tasks):
                candidate, cache_hit = await task
                completed += 1
                candidate["cache_hit"] = cache_hit
                update_inflight_progress(result_cache_key, {
                    "phase": "compare_v2_impact_files",
                    "message": f"영향 후보 분석 중: {completed}/{len(impact_candidates)}",
                    "current": completed,
                    "total": len(impact_candidates),
                    "file": candidate.get("path"),
                    "last_cache_hit": cache_hit,
                    "cache_key": cache_key[-16:],
                })
                yield _event(run_id, "analyzing_impact", "analyze_impact_files", "impact_file_done", {
                    "current": completed,
                    "total": len(impact_candidates),
                    "candidate": candidate,
                    "cache_hit": cache_hit,
                })

        update_inflight_progress(result_cache_key, {
            "phase": "compare_v2_summary",
            "message": "배포 전 요약 생성 중...",
            "current": len(file_changes),
            "total": len(file_changes),
            "cache_key": cache_key[-16:],
        })
        summary = await _summarize_release_risk(
            request,
            commits,
            file_changes,
            impact_candidates,
            baseline_resolved,
            candidate_resolved,
            llm,
            prompts,
        )
        yield _event(run_id, "summarizing", "summarize_release_risk", "summary_done", {
            "summary": summary,
        })

        result = {
            "schema_version": SCHEMA_VERSION,
            "run_id": run_id,
            "phase": "complete",
            "event": "complete",
            "mode": request.analysis_mode,
            "comparison_type": request.comparison_type,
            "compare_strategy": request.compare_strategy,
            "straight": straight,
            "baseline_ref": baseline_ref,
            "candidate_ref": candidate_ref,
            "baseline_resolved": baseline_resolved,
            "candidate_resolved": candidate_resolved,
            "files": [{**_model_dump(file), "cache_hit": direct_cache_hits.get(file.path, False)} for file in file_changes],
            "direct_files": [{**_model_dump(file), "cache_hit": direct_cache_hits.get(file.path, False)} for file in file_changes],
            "direct_origin_counts": origin_counts,
            "impact_candidates": impact_candidates,
            "impact_diagnostics": impact_diagnostics,
            "skipped_reasons": [
                *triage.skipped_reasons,
                *impact_diagnostics.get("skipped_reasons", []),
            ],
            "run_manifest": {
                **run_manifest,
                "skipped_reasons": [
                    *triage.skipped_reasons,
                    *impact_diagnostics.get("skipped_reasons", []),
                ],
            },
            "triage_coverage": triage.coverage,
            "summary": summary,
            "commit_count": len(commits),
            "total_additions": total_additions,
            "total_deletions": total_deletions,
            "raw_file_count": raw_file_count,
            "scope_file_count": scoped_file_count,
            "analysis_file_count": len(file_changes),
            "file_status_filter": request.file_status_filter or "all",
            "max_files": request.max_files,
            "analysis_sort": sort_key,
            "cache_hit": False,
            "cache_key": cache_key[-16:],
            "merge_check_context": _merge_check_manifest(request.merge_check_context),
            "elapsed_seconds": round(time.monotonic() - started, 2),
        }
        analysis_error_count = sum(
            1 for file in file_changes
            if (file.ai_summary or "").startswith("분석 중 오류")
        )
        impact_error_count = sum(
            1 for candidate in impact_candidates
            if (candidate.get("ai_summary") or "").startswith("영향 후보 분석 중 오류")
        )
        summary_error = summary.startswith("배포 전 요약 생성 중 오류")
        if not (analysis_error_count or impact_error_count or summary_error):
            set_cached_payload(result_cache_key, "compare_v2", result)
        if owns_result_cache:
            resolve_inflight(result_cache_key)
        yield _event(run_id, "complete", "summarize_release_risk", "complete", result)
    except asyncio.CancelledError:
        if owns_result_cache and result_cache_key:
            resolve_inflight(result_cache_key)
        raise
    except Exception as exc:
        if owns_result_cache and result_cache_key:
            resolve_inflight(result_cache_key)
        yield _event(run_id, "error", "compare_graph", "error", {
            "message": str(exc),
            "type": exc.__class__.__name__,
            "baseline_ref": _safe_ref_prefix(baseline_ref or ""),
            "candidate_ref": _safe_ref_prefix(candidate_ref or ""),
        })
