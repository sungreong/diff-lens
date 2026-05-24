"""Impact candidate discovery helpers for compare analysis."""

from __future__ import annotations

import os
import re
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from .git_client import GitLabClient
from .models import FileChange

IMPACT_HARD_MAX_FILES = 30
TREE_MAX_ITEMS = int(os.getenv("GIT_TREE_MAX_ITEMS", "3000"))

CODE_EXTENSIONS = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".vue", ".svelte", ".java", ".kt",
    ".go", ".rs", ".rb", ".php", ".cs", ".css", ".scss", ".sass", ".less",
    ".json", ".yaml", ".yml", ".toml", ".ini", ".sql", ".graphql", ".gql",
}
CONFIG_NAMES = {
    "dockerfile", "docker-compose.yml", "package.json", "pnpm-lock.yaml",
    "yarn.lock", "requirements.txt", "pyproject.toml", "pom.xml", "build.gradle",
    "gradle.properties", "vite.config.js", "vite.config.ts", "webpack.config.js",
}
SENSITIVE_PATH_RE = re.compile(
    r"(^|/)(\.env($|\.)|.*\.(pem|key|p12|pfx|crt|cer)$|.*secret.*|.*credential.*)",
    re.IGNORECASE,
)
SECRET_VALUE_RE = re.compile(
    r"(?i)(api[_-]?key|token|secret|password|passwd|private[_-]?key)\s*[:=]\s*['\"]?[^'\"\s,;]+"
)


def _safe_ref_prefix(ref: str) -> str:
    return (ref or "")[:12]


def _is_sensitive_path(path: str) -> bool:
    return bool(SENSITIVE_PATH_RE.search(path.replace("\\", "/")))


def redact_secret_like_values(text: Optional[str]) -> str:
    if not text:
        return ""
    return SECRET_VALUE_RE.sub(lambda m: f"{m.group(1)}=<redacted>", text)


def _path_extension(path: str) -> str:
    lower = path.lower()
    if "/" in lower:
        filename = lower.rsplit("/", 1)[-1]
    else:
        filename = lower
    if filename in CONFIG_NAMES:
        return filename
    if "." not in filename:
        return ""
    return "." + filename.rsplit(".", 1)[-1]


def _is_searchable_file(path: str) -> bool:
    if not path or _is_sensitive_path(path):
        return False
    extension = _path_extension(path)
    return extension in CODE_EXTENSIONS or extension in CONFIG_NAMES


def _line_snippets(content: str, seeds: Iterable[str], limit: int = 3) -> List[Dict[str, Any]]:
    snippets = []
    safe_content = redact_secret_like_values(content)
    seed_list = [s for s in seeds if len(s) >= 3]
    for line_no, line in enumerate(safe_content.splitlines(), 1):
        matched = next((seed for seed in seed_list if seed in line), None)
        if not matched:
            continue
        snippets.append({
            "type": "content_match",
            "line": line_no,
            "match": matched,
            "snippet": line.strip()[:240],
        })
        if len(snippets) >= limit:
            break
    return snippets


def extract_impact_seeds(files: List[FileChange]) -> Dict[str, Set[str]]:
    """Extract bounded, non-secret search seeds from changed file paths and diffs."""
    seeds: Dict[str, Set[str]] = {
        "paths": set(),
        "symbols": set(),
        "imports": set(),
        "routes": set(),
        "configs": set(),
        "tests": set(),
    }

    import_patterns = [
        re.compile(r"\bfrom\s+([A-Za-z0-9_./@-]+)\s+import\b"),
        re.compile(r"\bimport\s+([A-Za-z0-9_./@-]+)"),
        re.compile(r"\bfrom\s+['\"]([^'\"]+)['\"]"),
        re.compile(r"\brequire\(['\"]([^'\"]+)['\"]\)"),
    ]
    symbol_pattern = re.compile(
        r"\b(?:def|class|function|interface|type|const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)"
    )
    export_pattern = re.compile(
        r"\bexport\s+(?:default\s+)?(?:class|function|const|interface|type)?\s*([A-Za-z_][A-Za-z0-9_]*)?"
    )
    route_pattern = re.compile(r"['\"](/(?:api/)?[A-Za-z0-9_{}:./-]{2,})['\"]")
    config_pattern = re.compile(r"\b([A-Z][A-Z0-9_]{3,})\b")

    for file in files:
        path = file.path or ""
        if not path:
            continue
        normalized = path.replace("\\", "/")
        seeds["paths"].add(normalized)
        filename = normalized.rsplit("/", 1)[-1]
        stem = filename.rsplit(".", 1)[0]
        if len(stem) >= 3:
            seeds["symbols"].add(stem)
            seeds["tests"].add(stem)

        if _is_sensitive_path(path):
            continue

        diff = redact_secret_like_values(file.diff or "")
        diff = "\n".join(line for line in diff.splitlines() if line.startswith(("+", "-")) and not line.startswith(("+++", "---")))
        diff = diff[:12000]
        for pattern in import_patterns:
            for match in pattern.findall(diff):
                if isinstance(match, tuple):
                    match = next((m for m in match if m), "")
                if 3 <= len(match) <= 120 and not match.startswith("."):
                    seeds["imports"].add(match)
                    seeds["symbols"].add(match.rsplit("/", 1)[-1].rsplit(".", 1)[-1])
        for match in symbol_pattern.findall(diff):
            if 3 <= len(match) <= 80:
                seeds["symbols"].add(match)
        for match in export_pattern.findall(diff):
            if match and 3 <= len(match) <= 80:
                seeds["symbols"].add(match)
        for match in route_pattern.findall(diff):
            if len(match) <= 160:
                seeds["routes"].add(match)
        for match in config_pattern.findall(diff):
            if not any(secret in match.lower() for secret in ["secret", "token", "password", "key"]):
                seeds["configs"].add(match)

    for key, values in seeds.items():
        seeds[key] = {value for value in values if value and len(value) >= 3}
    return seeds


def _score_tree_path(
    path: str,
    seeds: Dict[str, Set[str]],
    changed_paths: Set[str],
) -> Tuple[int, List[str], List[Dict[str, Any]], List[str]]:
    normalized = path.replace("\\", "/")
    lower_path = normalized.lower()
    filename = lower_path.rsplit("/", 1)[-1]
    stem = filename.rsplit(".", 1)[0]
    score = 0
    reason_codes: List[str] = []
    evidence: List[Dict[str, Any]] = []
    source_changed_files: List[str] = []

    for changed in changed_paths:
        changed_norm = changed.replace("\\", "/")
        changed_stem = changed_norm.rsplit("/", 1)[-1].rsplit(".", 1)[0].lower()
        if normalized == changed_norm:
            continue
        if changed_stem and changed_stem in lower_path:
            score += 34
            reason_codes.append("path_name_match")
            evidence.append({"type": "path_match", "changed_file": changed_norm, "match": changed_stem})
            source_changed_files.append(changed_norm)
        if changed_norm.split("/", 1)[0] == normalized.split("/", 1)[0] and "/" in normalized:
            score += 6
            reason_codes.append("same_top_level_area")
            source_changed_files.append(changed_norm)
        if ("test" in lower_path or ".spec." in lower_path or ".test." in lower_path) and changed_stem:
            if changed_stem in lower_path:
                score += 28
                reason_codes.append("test_target_match")

    for symbol in seeds["symbols"]:
        symbol_lower = symbol.lower()
        if symbol_lower and symbol_lower in lower_path:
            score += 20
            reason_codes.append("symbol_path_match")
            evidence.append({"type": "symbol_path_match", "match": symbol})
    for import_path in seeds["imports"]:
        import_lower = import_path.lower().replace(".", "/")
        tail = import_lower.rsplit("/", 1)[-1]
        if tail and tail in lower_path:
            score += 18
            reason_codes.append("import_path_match")
            evidence.append({"type": "import_path_match", "match": import_path})

    if any(marker in lower_path for marker in ["/routes/", "/router", "/api/", "controller", "endpoint"]):
        if seeds["routes"]:
            score += 14
            reason_codes.append("route_surface")
    if any(marker in lower_path for marker in ["schema", "model", "migration", "repository", "store"]):
        score += 10
        reason_codes.append("data_contract_surface")
    if any(marker in filename for marker in ["config", "settings", ".env.example"]) or filename in CONFIG_NAMES:
        if seeds["configs"]:
            score += 16
            reason_codes.append("config_surface")

    return score, sorted(set(reason_codes)), evidence, sorted(set(source_changed_files))


def discover_impact_candidates(
    client: GitLabClient,
    project_id: str,
    candidate_ref: str,
    direct_files: List[FileChange],
    impact_max_files: int,
    context_depth: int = 1,
    diagnostics: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Discover likely consumers/adjacent files without full-repo RAG."""
    diagnostics = diagnostics if diagnostics is not None else {}
    diagnostics.setdefault("skipped_reasons", [])
    skipped_counts = diagnostics.setdefault("skipped_counts", {})
    diagnostics["impact_max_files"] = max(0, min(int(impact_max_files or 15), IMPACT_HARD_MAX_FILES))
    diagnostics["tree_max_items"] = TREE_MAX_ITEMS
    diagnostics["context_depth"] = context_depth

    max_files = max(0, min(int(impact_max_files or 15), IMPACT_HARD_MAX_FILES))
    if max_files == 0 or not direct_files:
        diagnostics["skipped_reasons"].append({
            "code": "impact_disabled_or_empty",
            "message": "영향 후보 분석 대상이 없거나 impact_max_files가 0입니다.",
        })
        return []

    seeds = extract_impact_seeds(direct_files)
    changed_paths = {file.path for file in direct_files if file.path}
    changed_paths.update(file.old_path for file in direct_files if file.old_path)

    try:
        tree = client.get_repository_tree(project_id, candidate_ref, recursive=True, max_items=TREE_MAX_ITEMS)
    except Exception as exc:
        diagnostics["skipped_reasons"].append({
            "code": "repository_tree_fetch_failed",
            "message": str(exc),
        })
        tree = []
    diagnostics["tree_items_seen"] = len(tree)
    if len(tree) >= TREE_MAX_ITEMS:
        diagnostics["skipped_reasons"].append({
            "code": "repository_tree_limited",
            "message": f"repository tree 조회가 {TREE_MAX_ITEMS}개 항목에서 제한되었습니다.",
        })

    scored: List[Dict[str, Any]] = []
    for item in tree:
        if item.get("type") not in {None, "blob"}:
            skipped_counts["non_blob"] = skipped_counts.get("non_blob", 0) + 1
            continue
        path = item.get("path") or item.get("name")
        if _is_sensitive_path(path):
            skipped_counts["sensitive_path"] = skipped_counts.get("sensitive_path", 0) + 1
            continue
        if not _is_searchable_file(path):
            skipped_counts["unsupported_file_type"] = skipped_counts.get("unsupported_file_type", 0) + 1
            continue
        if path in changed_paths:
            skipped_counts["direct_changed_file"] = skipped_counts.get("direct_changed_file", 0) + 1
            continue

        score, reason_codes, evidence, source_files = _score_tree_path(path, seeds, changed_paths)
        if score <= 0:
            continue

        scored.append({
            "file_path": path,
            "path": path,
            "status": "impact_candidate",
            "reason_codes": reason_codes,
            "evidence": evidence,
            "source_changed_files": source_files[:5],
            "confidence_score": min(0.95, round(score / 100, 2)),
            "recommended_checks": _recommended_checks_for_reasons(reason_codes),
            "_score": score,
        })

    scored.sort(key=lambda c: (-c["_score"], c["file_path"]))
    content_probe = scored[: max(max_files * max(context_depth, 1), max_files)]
    symbol_seeds = set().union(seeds["symbols"], seeds["imports"], seeds["routes"], seeds["configs"])
    for candidate in content_probe:
        if candidate["_score"] >= 75 and len(candidate.get("evidence", [])) >= 2:
            continue
        content = client.get_file_content(project_id, candidate["file_path"], candidate_ref)
        if not content:
            skipped_counts["content_unavailable"] = skipped_counts.get("content_unavailable", 0) + 1
            continue
        snippets = _line_snippets(content[:60000], symbol_seeds)
        if snippets:
            candidate["evidence"].extend(snippets)
            candidate["reason_codes"] = sorted(set(candidate["reason_codes"] + ["content_seed_match"]))
            candidate["_score"] += min(30, len(snippets) * 12)
            candidate["confidence_score"] = min(0.95, round(candidate["_score"] / 100, 2))

    scored.sort(key=lambda c: (-c["_score"], c["file_path"]))
    final_candidates = []
    for candidate in scored[:max_files]:
        candidate.pop("_score", None)
        final_candidates.append(candidate)
    diagnostics["candidate_count"] = len(final_candidates)
    diagnostics["scored_candidate_count"] = len(scored)
    return final_candidates


def _recommended_checks_for_reasons(reason_codes: Iterable[str]) -> List[str]:
    reasons = set(reason_codes)
    checks = ["직접 변경 파일과 함께 빌드/테스트 대상에 포함되는지 확인"]
    if "test_target_match" in reasons:
        checks.append("연결된 테스트가 여전히 같은 계약을 검증하는지 확인")
    if "route_surface" in reasons:
        checks.append("관련 API/라우트의 성공 및 실패 응답을 수동 또는 통합 테스트로 확인")
    if "data_contract_surface" in reasons:
        checks.append("스키마, 모델, 저장소 계층의 데이터 계약 변경 여부 확인")
    if "config_surface" in reasons:
        checks.append("배포 환경 변수와 설정 기본값이 기준/후보 버전에서 일치하는지 확인")
    return checks
