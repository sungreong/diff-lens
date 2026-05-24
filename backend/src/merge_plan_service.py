"""Deterministic merge-plan simulation for multiple release candidates."""

from __future__ import annotations

import logging
from typing import Any, Callable, Dict, List, Optional

from fastapi import HTTPException

from .git_client import GitLabClient
from .git_merge_dry_run import GitDryRunWorkspace, project_clone_url
from .models import MergePlanCandidate, MergePlanRequest

logger = logging.getLogger("diff-lens.merge_plan")

ProgressCallback = Optional[Callable[..., None]]


def merge_plan_result_is_cacheable(result: Dict[str, Any]) -> bool:
    if result.get("status") == "unknown":
        return False
    diagnostics = result.get("diagnostics") or {}
    if diagnostics.get("ref_drift"):
        return False
    all_results = (result.get("individual_results") or []) + (result.get("sequential_results") or [])
    return not any(item.get("status") == "unknown" for item in all_results)


class MergePlanService:
    """Run individual and ordered dry-run merges in disposable git workspaces."""

    def __init__(self, client: GitLabClient, project_id: str):
        self.client = client
        self.project_id = project_id

    def run(self, request: MergePlanRequest, progress: ProgressCallback = None) -> Dict[str, Any]:
        candidates = self._normalized_candidates(request.candidates)
        if not request.target_ref:
            raise HTTPException(status_code=400, detail="target_ref가 필요합니다.")
        if not candidates:
            raise HTTPException(status_code=400, detail="candidate가 최소 1개 필요합니다.")

        project = self.client.get_project(self.project_id)
        clone_url = project_clone_url(project)

        self._progress(progress, "resolving_refs", "대상과 후보 ref를 SHA로 잠급니다.", 1, 5)
        target_resolved = self.client.resolve_ref(self.project_id, request.target_ref)
        resolved_candidates = [
            self._resolve_candidate(candidate, index)
            for index, candidate in enumerate(candidates)
        ]

        drift = self._ref_drift(request, target_resolved, resolved_candidates, candidates)
        if drift and request.fail_on_ref_drift:
            return self._drift_result(target_resolved, resolved_candidates, drift)

        individual_results, sequential_results, sequential_commands = self._run_dry_run_checks(
            clone_url,
            request,
            target_resolved,
            resolved_candidates,
            progress,
        )

        summary_counts = self._summary_counts(individual_results, sequential_results)
        first_blocker = self._first_blocker(sequential_results, individual_results)
        status = self._overall_status(summary_counts)
        result = {
            "schema_version": "merge_plan.1",
            "status": status,
            "target_resolved": target_resolved,
            "candidates": resolved_candidates,
            "individual_results": individual_results,
            "sequential_results": sequential_results,
            "summary_counts": summary_counts,
            "first_blocker": first_blocker,
            "ai_review": None,
            "git_commands": self._collect_git_commands(individual_results, sequential_results, sequential_commands),
            "diagnostics": {
                "method": "git_dry_run_merge_plan",
                "dry_run_only": True,
                "remote_mutation": False,
                "ref_drift": drift,
                "cacheable": status != "unknown" and not drift,
            },
        }
        result["diagnostics"]["cacheable"] = merge_plan_result_is_cacheable(result)
        self._progress(progress, "merge_plan_done", "통합 머지 플랜 dry-run이 완료되었습니다.", 5, 5)
        return result

    def _normalized_candidates(self, candidates: List[MergePlanCandidate]) -> List[MergePlanCandidate]:
        normalized = []
        seen_ids = set()
        for index, candidate in enumerate(candidates or [], 1):
            ref = (candidate.ref or "").strip()
            if not ref:
                continue
            candidate_id = (candidate.id or f"candidate-{index}").strip()
            if candidate_id in seen_ids:
                candidate_id = f"{candidate_id}-{index}"
            seen_ids.add(candidate_id)
            normalized.append(candidate.model_copy(update={
                "id": candidate_id,
                "ref": ref,
                "label": (candidate.label or ref).strip(),
                "sha": (candidate.sha or "").strip() or None,
            }))
        return normalized

    def _resolve_candidate(self, candidate: MergePlanCandidate, index: int) -> Dict[str, Any]:
        resolved = self.client.resolve_ref(self.project_id, candidate.ref)
        return {
            "id": candidate.id,
            "label": candidate.label or candidate.ref,
            "ref": candidate.ref,
            "requested_sha": candidate.sha,
            "order": index + 1,
            "resolved": resolved,
            "sha": resolved.get("sha"),
            "short_sha": resolved.get("short_sha") or (resolved.get("sha") or "")[:8],
        }

    def _ref_drift(
        self,
        request: MergePlanRequest,
        target_resolved: Dict[str, Any],
        candidates: List[Dict[str, Any]],
        requested_candidates: List[MergePlanCandidate],
    ) -> List[Dict[str, Any]]:
        drift = []
        if request.target_sha and request.target_sha != target_resolved.get("sha"):
            drift.append({
                "side": "target",
                "ref": request.target_ref,
                "expected_sha": request.target_sha,
                "current_sha": target_resolved.get("sha"),
                "current_short_sha": target_resolved.get("short_sha"),
            })
        by_id = {candidate.id: candidate.sha for candidate in requested_candidates or []}
        for candidate in candidates:
            expected = by_id.get(candidate["id"])
            if expected and expected != candidate.get("sha"):
                drift.append({
                    "side": "candidate",
                    "id": candidate["id"],
                    "ref": candidate["ref"],
                    "expected_sha": expected,
                    "current_sha": candidate.get("sha"),
                    "current_short_sha": candidate.get("short_sha"),
                })
        return drift

    def _drift_result(
        self,
        target_resolved: Dict[str, Any],
        candidates: List[Dict[str, Any]],
        drift: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        return {
            "schema_version": "merge_plan.1",
            "status": "unknown",
            "target_resolved": target_resolved,
            "candidates": candidates,
            "individual_results": [],
            "sequential_results": [],
            "summary_counts": {
                "individual": {"total": len(candidates), "clean": 0, "conflicts": 0, "unknown": 0},
                "sequential": {"total": len(candidates), "clean": 0, "blocked": 0, "unknown": 0, "not_run": len(candidates)},
            },
            "first_blocker": {
                "status": "unknown",
                "reason": "ref_drift",
                "message": "선택한 ref의 SHA가 실행 시점에 변경되어 시뮬레이션을 중단했습니다.",
            },
            "ai_review": None,
            "git_commands": [],
            "diagnostics": {
                "method": "git_dry_run_merge_plan",
                "dry_run_only": True,
                "remote_mutation": False,
                "ref_drift": drift,
                "cacheable": False,
            },
        }

    def _local_candidate_ref(self, index: int) -> str:
        return f"refs/diff-lens/candidate-{index + 1}"

    def _run_dry_run_checks(
        self,
        clone_url: str,
        request: MergePlanRequest,
        target_resolved: Dict[str, Any],
        candidates: List[Dict[str, Any]],
        progress: ProgressCallback,
    ) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
        local_target = "refs/diff-lens/target"
        individual_results: List[Dict[str, Any]] = []
        sequential_results: List[Dict[str, Any]] = []
        command_log: List[Dict[str, Any]] = []
        try:
            with GitDryRunWorkspace(clone_url, self.client.git_token, prefix="diff-lens-merge-plan-") as workspace:
                command_log = workspace.command_log
                target_start = len(workspace.command_log)
                target_ok, target_fetch = workspace.fetch_ref(request.target_ref, target_resolved.get("sha"), local_target)
                target_fetch_info = {
                    "ok": target_ok,
                    "result": target_fetch,
                    "commands": workspace.command_slice(target_start),
                }
                if not target_ok:
                    individual_results = self._target_fetch_failed_individual_results(
                        request,
                        target_resolved,
                        candidates,
                        target_fetch_info,
                    )
                    sequential_results = self._target_fetch_failed_sequential_results(candidates, target_fetch_info)
                    return individual_results, sequential_results, workspace.command_slice()

                candidate_fetches = {}
                for index, candidate in enumerate(candidates):
                    fetch_start = len(workspace.command_log)
                    resolved = candidate["resolved"]
                    source_ok, source_fetch = workspace.fetch_ref(
                        candidate["ref"],
                        resolved.get("sha"),
                        self._local_candidate_ref(index),
                    )
                    candidate_fetches[candidate["id"]] = {
                        "ok": source_ok,
                        "result": source_fetch,
                        "commands": workspace.command_slice(fetch_start),
                        "local_ref": self._local_candidate_ref(index),
                    }

                individual_results = self._run_individual_checks_in_workspace(
                    workspace,
                    request,
                    target_resolved,
                    candidates,
                    local_target,
                    target_fetch_info,
                    candidate_fetches,
                    progress,
                )
                if len(candidates) == 1:
                    sequential_results = self._sequential_from_single_individual(individual_results[0], candidates[0])
                    return individual_results, sequential_results, workspace.command_slice()

                sequential_results = self._run_sequential_checks_in_workspace(
                    workspace,
                    candidates,
                    local_target,
                    target_fetch_info,
                    candidate_fetches,
                    progress,
                )
                return individual_results, sequential_results, workspace.command_slice()
        except Exception as exc:
            logger.exception("Merge plan dry-run workspace failed")
            if not individual_results:
                individual_results = [
                    self._individual_unknown_result(
                        request,
                        target_resolved,
                        candidate,
                        message=f"개별 dry-run 중 오류가 발생했습니다: {exc}",
                        git_commands=list(command_log),
                    )
                    for candidate in candidates
                ]
            if not sequential_results:
                sequential_results = [{
                    "status": "unknown",
                    "candidate_id": None,
                    "candidate_label": None,
                    "candidate_ref": None,
                    "message": f"순차 dry-run 중 오류가 발생했습니다: {exc}",
                    "conflict_files": [],
                    "git_commands": list(command_log),
                    "diagnostics": {},
                }]
            return individual_results, sequential_results, list(command_log)

    def _sequential_from_single_individual(
        self,
        individual: Dict[str, Any],
        candidate: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        status = individual.get("status")
        if status == "clean":
            return [self._sequential_result(
                candidate,
                status="clean",
                message="단일 후보라 개별 dry-run 결과를 순차 결과로 재사용했습니다.",
                merge_base_sha=individual.get("merge_base_sha"),
                before_head=individual.get("target_sha"),
                git_commands=[],
                diagnostics={
                    "reused_individual_result": True,
                    **(individual.get("diagnostics") or {}),
                },
            )]
        if status == "conflicts":
            return [self._sequential_result(
                candidate,
                status="blocked",
                message="단일 후보 개별 dry-run에서 충돌이 발생해 순차 결과도 blocker로 표시했습니다.",
                merge_base_sha=individual.get("merge_base_sha"),
                before_head=individual.get("target_sha"),
                conflict_files=individual.get("conflict_files") or [],
                conflict_details=individual.get("conflict_details") or [],
                git_commands=[],
                diagnostics={
                    "reused_individual_result": True,
                    **(individual.get("diagnostics") or {}),
                },
            )]
        return [self._sequential_result(
            candidate,
            status="unknown",
            message=individual.get("message") or "단일 후보 dry-run 결과를 확인할 수 없습니다.",
            merge_base_sha=individual.get("merge_base_sha"),
            before_head=individual.get("target_sha"),
            git_commands=[],
            diagnostics={
                "reused_individual_result": True,
                **(individual.get("diagnostics") or {}),
            },
        )]

    def _target_fetch_failed_individual_results(
        self,
        request: MergePlanRequest,
        target_resolved: Dict[str, Any],
        candidates: List[Dict[str, Any]],
        target_fetch_info: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        return [
            self._individual_unknown_result(
                request,
                target_resolved,
                candidate,
                message="대상 ref fetch에 실패해 충돌 여부를 확정할 수 없습니다.",
                git_commands=target_fetch_info.get("commands") or [],
                diagnostics={"target_fetch": target_fetch_info.get("result")},
            )
            for candidate in candidates
        ]

    def _target_fetch_failed_sequential_results(
        self,
        candidates: List[Dict[str, Any]],
        target_fetch_info: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        if not candidates:
            return []
        first, *remaining = candidates
        results = [
            self._sequential_result(
                first,
                status="unknown",
                message="대상 ref fetch에 실패해 순차 시뮬레이션을 시작하지 못했습니다.",
                diagnostics={"target_fetch": target_fetch_info.get("result")},
                git_commands=target_fetch_info.get("commands") or [],
            )
        ]
        results.extend(
            self._sequential_result(
                candidate,
                status="not_run_after_unknown",
                message="대상 ref를 확인할 수 없어 실행하지 않았습니다.",
            )
            for candidate in remaining
        )
        return results

    def _individual_unknown_result(
        self,
        request: MergePlanRequest,
        target_resolved: Dict[str, Any],
        candidate: Dict[str, Any],
        *,
        message: str,
        git_commands: Optional[List[Dict[str, Any]]] = None,
        diagnostics: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        resolved = candidate["resolved"]
        return {
            "status": "unknown",
            "mergeable": None,
            "has_conflicts": None,
            "conflict_files": [],
            "method": "git_dry_run_merge",
            "message": message,
            "target_ref": request.target_ref,
            "source_ref": candidate["ref"],
            "target_sha": target_resolved.get("sha"),
            "source_sha": resolved.get("sha"),
            "git_commands": git_commands or [],
            "diagnostics": diagnostics or {},
            "candidate_id": candidate["id"],
            "candidate_label": candidate["label"],
            "candidate_ref": candidate["ref"],
            "candidate_sha": resolved.get("sha"),
            "candidate_resolved": resolved,
            "target_resolved": target_resolved,
        }

    def _run_individual_checks_in_workspace(
        self,
        workspace: GitDryRunWorkspace,
        request: MergePlanRequest,
        target_resolved: Dict[str, Any],
        candidates: List[Dict[str, Any]],
        local_target: str,
        target_fetch_info: Dict[str, Any],
        candidate_fetches: Dict[str, Dict[str, Any]],
        progress: ProgressCallback,
    ) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        total = max(1, len(candidates))
        for index, candidate in enumerate(candidates, 1):
            self._progress(
                progress,
                "individual_checks",
                f"{candidate['label']} 후보를 대상에 단독으로 붙여봅니다.",
                index,
                total,
                candidate_id=candidate["id"],
            )
            fetch_info = candidate_fetches.get(candidate["id"]) or {}
            if not fetch_info.get("ok"):
                results.append(self._individual_unknown_result(
                    request,
                    target_resolved,
                    candidate,
                    message="후보 ref fetch에 실패해 충돌 여부를 확정할 수 없습니다.",
                    git_commands=fetch_info.get("commands") or [],
                    diagnostics={
                        "target_fetch": target_fetch_info.get("result"),
                        "source_fetch": fetch_info.get("result"),
                    },
                ))
                continue

            command_start = len(workspace.command_log)
            try:
                result = self._local_individual_merge_result(
                    workspace,
                    request,
                    target_resolved,
                    candidate,
                    local_target,
                    fetch_info["local_ref"],
                    target_fetch_info.get("result"),
                    fetch_info.get("result"),
                    command_start,
                )
            except Exception as exc:
                logger.exception("Individual merge plan check failed")
                result = self._individual_unknown_result(
                    request,
                    target_resolved,
                    candidate,
                    message=f"개별 dry-run 중 오류가 발생했습니다: {exc}",
                    git_commands=workspace.command_slice(command_start),
                    diagnostics={
                        "target_fetch": target_fetch_info.get("result"),
                        "source_fetch": fetch_info.get("result"),
                    },
                )
            results.append(result)
        return results

    def _local_individual_merge_result(
        self,
        workspace: GitDryRunWorkspace,
        request: MergePlanRequest,
        target_resolved: Dict[str, Any],
        candidate: Dict[str, Any],
        local_target: str,
        local_source: str,
        target_fetch: Optional[str],
        source_fetch: Optional[str],
        command_start: int,
    ) -> Dict[str, Any]:
        resolved = candidate["resolved"]
        merge_base_sha = workspace.merge_base(local_target, local_source)
        cleanup_error = None
        try:
            workspace.checkout_detached(local_target)
            merge_result = workspace.merge_no_commit(local_source)
        finally:
            try:
                workspace.abort_merge()
            except Exception as exc:
                cleanup_error = workspace.redact(str(exc))

        status = merge_result["status"]
        if status == "clean":
            message = "임시 merge dry-run에서 충돌이 발견되지 않았습니다."
        elif status == "conflicts":
            message = "임시 merge dry-run에서 충돌이 발견되었습니다."
        else:
            message = "git merge dry-run이 실패했지만 충돌 파일을 확인하지 못했습니다."
        diagnostics = {
            "target_fetch": target_fetch,
            "source_fetch": source_fetch,
            **(merge_result.get("diagnostics") or {}),
        }
        if cleanup_error:
            diagnostics["cleanup_error"] = cleanup_error
        return {
            **merge_result,
            "method": "git_dry_run_merge",
            "message": message,
            "target_ref": request.target_ref,
            "source_ref": candidate["ref"],
            "target_sha": target_resolved.get("sha"),
            "source_sha": resolved.get("sha"),
            "merge_base_sha": merge_base_sha,
            "git_commands": workspace.command_slice(command_start),
            "diagnostics": diagnostics,
            "candidate_id": candidate["id"],
            "candidate_label": candidate["label"],
            "candidate_ref": candidate["ref"],
            "candidate_sha": resolved.get("sha"),
            "candidate_resolved": resolved,
            "target_resolved": target_resolved,
        }

    def _run_sequential_checks_in_workspace(
        self,
        workspace: GitDryRunWorkspace,
        candidates: List[Dict[str, Any]],
        local_target: str,
        target_fetch_info: Dict[str, Any],
        candidate_fetches: Dict[str, Dict[str, Any]],
        progress: ProgressCallback,
    ) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        stopped_reason = None
        workspace.checkout_detached(local_target)
        for index, candidate in enumerate(candidates):
            command_start = len(workspace.command_log)
            fetch_info = candidate_fetches.get(candidate["id"]) or {}
            local_source = fetch_info.get("local_ref") or self._local_candidate_ref(index)
            self._progress(
                progress,
                "sequential_checks",
                f"{index + 1}번째 후보 {candidate['label']}를 누적 상태에 붙여봅니다.",
                index + 1,
                max(1, len(candidates)),
                candidate_id=candidate["id"],
            )
            before_head = workspace.rev_parse("HEAD")
            if not fetch_info.get("ok"):
                results.append(self._sequential_result(
                    candidate,
                    status="unknown",
                    message="후보 ref fetch에 실패해 이후 순차 시뮬레이션을 중단했습니다.",
                    before_head=before_head,
                    git_commands=(fetch_info.get("commands") or []) + workspace.command_slice(command_start),
                    diagnostics={
                        "target_fetch": target_fetch_info.get("result"),
                        "source_fetch": fetch_info.get("result"),
                    },
                ))
                stopped_reason = "unknown"
                break

            merge_base_sha = workspace.merge_base("HEAD", local_source)
            merge_result = workspace.merge_no_commit(local_source)
            if merge_result["status"] == "clean":
                after_head = workspace.commit_if_needed(f"Diff Lens dry-run merge {candidate['label']}")
                results.append(self._sequential_result(
                    candidate,
                    status="clean",
                    message="누적 dry-run에서 충돌 없이 병합되었습니다.",
                    before_head=before_head,
                    after_head=after_head,
                    merge_base_sha=merge_base_sha,
                    git_commands=workspace.command_slice(command_start),
                    diagnostics={
                        "target_fetch": target_fetch_info.get("result"),
                        "source_fetch": fetch_info.get("result"),
                        **(merge_result.get("diagnostics") or {}),
                    },
                ))
                continue

            if merge_result["status"] == "conflicts":
                results.append(self._sequential_result(
                    candidate,
                    status="blocked",
                    message="이 후보를 누적 상태에 붙이는 단계에서 충돌이 발생했습니다.",
                    before_head=before_head,
                    merge_base_sha=merge_base_sha,
                    conflict_files=merge_result.get("conflict_files") or [],
                    conflict_details=merge_result.get("conflict_details") or [],
                    git_commands=workspace.command_slice(command_start),
                    diagnostics={
                        "target_fetch": target_fetch_info.get("result"),
                        "source_fetch": fetch_info.get("result"),
                        **(merge_result.get("diagnostics") or {}),
                    },
                ))
                stopped_reason = "blocker"
                break

            results.append(self._sequential_result(
                candidate,
                status="unknown",
                message="git merge dry-run이 실패했지만 충돌 파일을 확인하지 못했습니다.",
                before_head=before_head,
                merge_base_sha=merge_base_sha,
                git_commands=workspace.command_slice(command_start),
                diagnostics={
                    "target_fetch": target_fetch_info.get("result"),
                    "source_fetch": fetch_info.get("result"),
                    **(merge_result.get("diagnostics") or {}),
                },
            ))
            stopped_reason = "unknown"
            break

        if stopped_reason:
            return self._mark_remaining(
                candidates,
                start_index=len([r for r in results if r.get("candidate_id")]),
                status="not_run_after_blocker" if stopped_reason == "blocker" else "not_run_after_unknown",
                message="앞선 후보에서 충돌이 발생해 실행하지 않았습니다." if stopped_reason == "blocker" else "앞선 단계가 확인 불가라 실행하지 않았습니다.",
                prior_results=results,
            )
        return results

    def _sequential_result(
        self,
        candidate: Dict[str, Any],
        *,
        status: str,
        message: str,
        before_head: Optional[str] = None,
        after_head: Optional[str] = None,
        merge_base_sha: Optional[str] = None,
        conflict_files: Optional[List[str]] = None,
        conflict_details: Optional[List[Dict[str, Any]]] = None,
        git_commands: Optional[List[Dict[str, Any]]] = None,
        diagnostics: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return {
            "status": status,
            "candidate_id": candidate["id"],
            "candidate_label": candidate["label"],
            "candidate_ref": candidate["ref"],
            "candidate_sha": candidate.get("sha"),
            "order": candidate.get("order"),
            "message": message,
            "mergeable": status == "clean" if status in {"clean", "blocked"} else None,
            "has_conflicts": status == "blocked",
            "conflict_files": conflict_files or [],
            "conflict_details": conflict_details or [],
            "merge_base_sha": merge_base_sha,
            "before_head_sha": before_head,
            "virtual_head_sha": after_head,
            "git_commands": git_commands or [],
            "diagnostics": diagnostics or {},
        }

    def _mark_remaining(
        self,
        candidates: List[Dict[str, Any]],
        *,
        start_index: int,
        status: str,
        message: str,
        prior_results: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        results = list(prior_results)
        for candidate in candidates[start_index:]:
            if any(result.get("candidate_id") == candidate["id"] for result in results):
                continue
            results.append(self._sequential_result(candidate, status=status, message=message))
        return results

    def _summary_counts(self, individual_results: List[Dict[str, Any]], sequential_results: List[Dict[str, Any]]) -> Dict[str, Any]:
        def count(items: List[Dict[str, Any]], statuses: List[str]) -> Dict[str, int]:
            return {status: sum(1 for item in items if item.get("status") == status) for status in statuses}

        individual = count(individual_results, ["clean", "conflicts", "unknown"])
        sequential = count(sequential_results, ["clean", "blocked", "unknown", "not_run_after_blocker", "not_run_after_unknown"])
        return {
            "individual": {"total": len(individual_results), **individual},
            "sequential": {
                "total": len(sequential_results),
                "not_run": sequential["not_run_after_blocker"] + sequential["not_run_after_unknown"],
                **sequential,
            },
        }

    def _first_blocker(self, sequential_results: List[Dict[str, Any]], individual_results: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        for item in sequential_results:
            if item.get("status") in {"blocked", "unknown"}:
                return item
        for item in individual_results:
            if item.get("status") in {"conflicts", "unknown"}:
                return item
        return None

    def _overall_status(self, summary_counts: Dict[str, Any]) -> str:
        individual = summary_counts.get("individual") or {}
        sequential = summary_counts.get("sequential") or {}
        if individual.get("conflicts") or sequential.get("blocked"):
            return "conflicts"
        if individual.get("unknown") or sequential.get("unknown") or sequential.get("not_run_after_unknown"):
            return "unknown"
        return "clean"

    def _collect_git_commands(
        self,
        individual_results: List[Dict[str, Any]],
        sequential_results: List[Dict[str, Any]],
        sequential_commands: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        if sequential_commands:
            return sequential_commands
        commands: List[Dict[str, Any]] = []
        for item in individual_results:
            commands.extend(item.get("git_commands") or [])
        if not commands:
            for item in sequential_results:
                commands.extend(item.get("git_commands") or [])
        return commands

    def _progress(self, progress: ProgressCallback, phase: str, message: str, current: int, total: int, **extra: Any) -> None:
        if not progress:
            return
        progress(phase=phase, message=message, current=current, total=total, **extra)
