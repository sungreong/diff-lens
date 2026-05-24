"""Deterministic Git domain agent used by v2 compare workflows.

This component is intentionally not an LLM agent. It owns GitLab/ref/compare and
dry-run merge semantics so preview, streaming analysis, and merge checks do not
silently drift apart.
"""
from dataclasses import dataclass
from typing import Any, Dict, List

from .git_client import GitLabClient
from .models import CompareV2Request, FileChange


def compare_strategy_to_straight(compare_strategy: str) -> bool:
    """Map UI strategy to GitLab compare semantics."""
    return compare_strategy != "branch_delta"


def find_ref_drift_mismatches(
    request: CompareV2Request,
    baseline_resolved: Dict[str, Any],
    candidate_resolved: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """Return preview SHA lock mismatches without deciding whether to fail."""
    mismatches: List[Dict[str, Any]] = []
    if request.baseline_sha and request.baseline_sha != baseline_resolved.get("sha"):
        mismatches.append({
            "side": "baseline",
            "ref": request.effective_baseline_ref(),
            "expected_sha": request.baseline_sha,
            "current_sha": baseline_resolved.get("sha"),
            "current_short_sha": baseline_resolved.get("short_sha"),
        })
    if request.candidate_sha and request.candidate_sha != candidate_resolved.get("sha"):
        mismatches.append({
            "side": "candidate",
            "ref": request.effective_candidate_ref(),
            "expected_sha": request.candidate_sha,
            "current_sha": candidate_resolved.get("sha"),
            "current_short_sha": candidate_resolved.get("short_sha"),
        })
    return mismatches


@dataclass(frozen=True)
class ResolvedRefPair:
    baseline_ref: str
    candidate_ref: str
    baseline: Dict[str, Any]
    candidate: Dict[str, Any]
    drift: List[Dict[str, Any]]


@dataclass(frozen=True)
class GitCompareSnapshot:
    ref_pair: ResolvedRefPair
    straight: bool
    commits: List[Dict[str, Any]]
    files: List[FileChange]

    @property
    def total_additions(self) -> int:
        return sum(file.additions for file in self.files)

    @property
    def total_deletions(self) -> int:
        return sum(file.deletions for file in self.files)


class GitRepositoryAgent:
    """Reusable deterministic Git owner for compare, refs, and dry-run checks."""

    def __init__(self, client: GitLabClient, project_id: str):
        self.client = client
        self.project_id = project_id

    def resolve_pair(self, request: CompareV2Request) -> ResolvedRefPair:
        baseline_ref = request.effective_baseline_ref()
        candidate_ref = request.effective_candidate_ref()
        if not baseline_ref or not candidate_ref:
            raise ValueError("baseline_ref와 candidate_ref가 필요합니다.")

        baseline = self.client.resolve_ref(self.project_id, baseline_ref)
        candidate = self.client.resolve_ref(self.project_id, candidate_ref)
        return ResolvedRefPair(
            baseline_ref=baseline_ref,
            candidate_ref=candidate_ref,
            baseline=baseline,
            candidate=candidate,
            drift=find_ref_drift_mismatches(request, baseline, candidate),
        )

    def compare(self, request: CompareV2Request, *, include_file_evidence: bool = True) -> GitCompareSnapshot:
        ref_pair = self.resolve_pair(request)
        if ref_pair.drift and request.fail_on_ref_drift:
            raise RefDriftDetected(ref_pair)
        return self.compare_resolved(request, ref_pair, include_file_evidence=include_file_evidence)

    def compare_resolved(
        self,
        request: CompareV2Request,
        ref_pair: ResolvedRefPair,
        *,
        include_file_evidence: bool = True,
    ) -> GitCompareSnapshot:
        straight = compare_strategy_to_straight(request.compare_strategy)
        commits, files = self.client.fetch_changes(
            self.project_id,
            ref_pair.baseline["sha"],
            ref_pair.candidate["sha"],
            request.author_filter,
            straight=straight,
            include_file_evidence=include_file_evidence,
        )
        return GitCompareSnapshot(
            ref_pair=ref_pair,
            straight=straight,
            commits=commits,
            files=files,
        )

    def dry_run_merge_check(self, request: CompareV2Request) -> Dict[str, Any]:
        ref_pair = self.resolve_pair(request)
        if ref_pair.drift and request.fail_on_ref_drift:
            return {
                "status": "unknown",
                "mergeable": None,
                "has_conflicts": None,
                "conflict_files": [],
                "message": "변경표를 만든 뒤 선택한 버전이 움직여 충돌 체크를 중단했습니다. 최신 기준으로 변경표를 다시 만든 다음 확인하세요.",
                "target_ref": ref_pair.baseline_ref,
                "source_ref": ref_pair.candidate_ref,
                "target_sha": ref_pair.baseline["sha"],
                "source_sha": ref_pair.candidate["sha"],
                "target_resolved": ref_pair.baseline,
                "source_resolved": ref_pair.candidate,
                "diagnostics": {"ref_drift": ref_pair.drift},
            }

        result = self.client.check_merge_conflicts(
            project_id=self.project_id,
            target_ref=ref_pair.baseline_ref,
            source_ref=ref_pair.candidate_ref,
            target_sha=ref_pair.baseline["sha"],
            source_sha=ref_pair.candidate["sha"],
        )
        result["target_resolved"] = ref_pair.baseline
        result["source_resolved"] = ref_pair.candidate
        return result


class RefDriftDetected(Exception):
    """Raised when preview-locked SHAs no longer match current refs."""

    def __init__(self, ref_pair: ResolvedRefPair):
        super().__init__("ref_drift_detected")
        self.ref_pair = ref_pair
