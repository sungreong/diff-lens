"""Deterministic file triage for compare workflows."""
from dataclasses import dataclass, field
from typing import Any, Dict, List, Tuple

from .analysis_services import normalize_analysis_sort, sort_file_changes_for_analysis
from .models import CompareV2Request, FileChange


ALLOWED_FILE_STATUS_FILTERS = {"added", "modified", "deleted", "renamed", "history_only"}


@dataclass(frozen=True)
class DiffTriageResult:
    files: List[FileChange]
    raw_file_count: int
    scoped_file_count: int
    analysis_file_count: int
    sort_key: str
    coverage: Dict[str, Any] = field(default_factory=dict)
    skipped_reasons: List[Dict[str, Any]] = field(default_factory=list)


class DiffTriageService:
    """Score, filter, sort, and cap direct Git diff files before LLM work."""

    def triage(self, request: CompareV2Request, file_changes: List[FileChange]) -> DiffTriageResult:
        raw_file_count = len(file_changes)
        for file in file_changes:
            score, reason_codes = score_file_for_triage(file)
            file.triage_score = score
            file.triage_reason_codes = reason_codes

        filtered_files = list(file_changes)
        skipped_reasons: List[Dict[str, Any]] = []
        status_filter = (request.file_status_filter or "all").lower()
        if status_filter != "all":
            if status_filter not in ALLOWED_FILE_STATUS_FILTERS:
                raise ValueError(f"지원하지 않는 파일 상태 필터입니다: {status_filter}")
            before_filter = len(filtered_files)
            filtered_files = [file for file in filtered_files if file.status == status_filter]
            skipped = before_filter - len(filtered_files)
            if skipped:
                skipped_reasons.append({
                    "code": "file_status_filter",
                    "message": f"{status_filter} 상태가 아닌 파일 {skipped}개를 제외했습니다.",
                    "skipped_count": skipped,
                })

        scoped_file_count = len(filtered_files)
        sort_key = normalize_analysis_sort(request.analysis_sort)
        filtered_files = sort_file_changes_for_analysis(filtered_files, sort_key)

        max_files = int(request.max_files or 0)
        if max_files > 0 and len(filtered_files) > max_files:
            skipped_reasons.append({
                "code": "max_files_limit",
                "message": f"분석 상한 {max_files}개를 넘어 {len(filtered_files) - max_files}개 파일을 제외했습니다.",
                "skipped_count": len(filtered_files) - max_files,
            })
            filtered_files = filtered_files[:max_files]

        coverage = build_triage_coverage(
            raw_file_count=raw_file_count,
            scoped_file_count=scoped_file_count,
            analysis_file_count=len(filtered_files),
            sort_key=sort_key,
            status_filter=status_filter,
            max_files=max_files,
            files=filtered_files,
            skipped_reasons=skipped_reasons,
        )
        return DiffTriageResult(
            files=filtered_files,
            raw_file_count=raw_file_count,
            scoped_file_count=scoped_file_count,
            analysis_file_count=len(filtered_files),
            sort_key=sort_key,
            coverage=coverage,
            skipped_reasons=skipped_reasons,
        )


def score_file_for_triage(file: FileChange) -> Tuple[int, List[str]]:
    path = (file.path or "").lower()
    status = (file.status or "").lower()
    changes = (file.additions or 0) + (file.deletions or 0)
    score = min(changes, 180)
    reason_codes: List[str] = []

    if changes >= 500:
        score += 60
        reason_codes.append("large_diff")
    elif changes >= 120:
        score += 30
        reason_codes.append("medium_diff")

    if status == "deleted":
        score += 35
        reason_codes.append("deleted_file")
    elif status == "renamed":
        score += 22
        reason_codes.append("renamed_file")
    elif status == "added":
        score += 10
        reason_codes.append("new_file")

    if getattr(file, "compare_origin", None) == "baseline_only":
        score += 70
        reason_codes.append("baseline_only_change")
    elif getattr(file, "compare_origin", None) == "candidate_only":
        score += 20
        reason_codes.append("candidate_only_change")

    if any(token in path for token in ["auth", "permission", "security", "token", "secret", "credential"]):
        score += 85
        reason_codes.append("security_surface")
    if any(token in path for token in ["api", "router", "route", "endpoint", "controller"]):
        score += 45
        reason_codes.append("api_surface")
    if any(token in path for token in ["schema", "migration", "model", "database", "sql", "db"]):
        score += 45
        reason_codes.append("data_contract_surface")
    if any(token in path for token in ["config", ".env", "docker", "compose", "requirements", "package.json", "lock"]):
        score += 38
        reason_codes.append("config_surface")
    if any(token in path for token in ["test", "spec", "__test__"]):
        score -= 10
        reason_codes.append("test_surface")

    commit_count = len(file.commit_ids or [])
    if commit_count >= 5:
        score += 32
        reason_codes.append("commit_hotspot")
    elif commit_count >= 2:
        score += 16
        reason_codes.append("multi_commit_touch")

    if file.has_history_only:
        score -= 35
        reason_codes.append("history_only")

    if not reason_codes:
        reason_codes.append("plain_diff")
    return max(score, 0), sorted(set(reason_codes))


def build_triage_coverage(
    raw_file_count: int,
    scoped_file_count: int,
    analysis_file_count: int,
    sort_key: str,
    status_filter: str,
    max_files: int,
    files: List[FileChange],
    skipped_reasons: List[Dict[str, Any]],
) -> Dict[str, Any]:
    reason_counts: Dict[str, int] = {}
    for file in files:
        for reason in file.triage_reason_codes:
            reason_counts[reason] = reason_counts.get(reason, 0) + 1

    denominator = scoped_file_count or raw_file_count or 1
    return {
        "raw_file_count": raw_file_count,
        "scoped_file_count": scoped_file_count,
        "analysis_file_count": analysis_file_count,
        "analysis_coverage_ratio": round(analysis_file_count / denominator, 4),
        "analysis_sort": sort_key,
        "file_status_filter": status_filter,
        "max_files": max_files,
        "triage_reason_counts": reason_counts,
        "skipped_reasons": skipped_reasons,
    }
