"""Bounded evidence extracted from a temporary git conflict state."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Dict, List


MAX_TEXT_CHARS = 5000
MAX_BLOCKS_PER_FILE = 3
CONFLICT_CONTEXT_LINES = 3


def _truncate_text(text: str, limit: int = MAX_TEXT_CHARS) -> Dict[str, Any]:
    text = text or ""
    truncated = len(text) > limit
    return {
        "text": text[:limit],
        "truncated": truncated,
        "original_chars": len(text),
    }


def _safe_read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return ""


def _extract_conflict_blocks(text: str) -> List[Dict[str, Any]]:
    if not text:
        return []
    lines = text.splitlines()
    blocks: List[Dict[str, Any]] = []
    index = 0
    while index < len(lines) and len(blocks) < MAX_BLOCKS_PER_FILE:
        if not lines[index].startswith("<<<<<<<"):
            index += 1
            continue
        start = index
        end = index
        while end < len(lines) and not lines[end].startswith(">>>>>>>"):
            end += 1
        if end < len(lines):
            end += 1
        window_start = max(0, start - CONFLICT_CONTEXT_LINES)
        window_end = min(len(lines), end + CONFLICT_CONTEXT_LINES)
        snippet = "\n".join(lines[window_start:window_end])
        blocks.append({
            "start_line": start + 1,
            "end_line": end,
            "context_start_line": window_start + 1,
            "context_end_line": window_end,
            **_truncate_text(snippet, 2200),
        })
        index = end
    return blocks


def _show_stage(run_git: Callable[[List[str]], Any], stage: int, file_path: str, redact: Callable[[str], str]) -> Dict[str, Any]:
    result = run_git(["show", f":{stage}:{file_path}"])
    output = redact(result.stdout or "")
    if result.returncode != 0:
        return {"available": False, "stage": stage, "text": "", "truncated": False, "original_chars": 0}
    return {"available": True, "stage": stage, **_truncate_text(output, 3500)}


def _diff_variant(run_git: Callable[[List[str]], Any], flag: str, file_path: str, redact: Callable[[str], str]) -> Dict[str, Any]:
    result = run_git(["diff", flag, "--", file_path])
    return {
        "available": result.returncode == 0 and bool((result.stdout or "").strip()),
        **_truncate_text(redact(result.stdout or ""), 5000),
    }


def collect_conflict_evidence(
    *,
    run_git: Callable[[List[str]], Any],
    workdir: str,
    conflict_files: List[str],
    redact: Callable[[str], str],
    max_files: int = 8,
) -> List[Dict[str, Any]]:
    evidence = []
    for file_path in (conflict_files or [])[:max_files]:
        status = run_git(["status", "--porcelain", "--", file_path])
        unmerged = run_git(["ls-files", "-u", "--", file_path])
        combined_diff = run_git(["diff", "--cc", "--", file_path])
        conflicted_text = redact(_safe_read(Path(workdir) / file_path))
        evidence.append({
            "file_path": file_path,
            "status": redact(status.stdout or "").strip(),
            "unmerged_index": _truncate_text(redact(unmerged.stdout or ""), 3000),
            "combined_diff": _truncate_text(redact(combined_diff.stdout or ""), 5000),
            "diff_variants": {
                "base": _diff_variant(run_git, "--base", file_path, redact),
                "ours": _diff_variant(run_git, "--ours", file_path, redact),
                "theirs": _diff_variant(run_git, "--theirs", file_path, redact),
            },
            "conflict_marker_blocks": _extract_conflict_blocks(conflicted_text),
            "stages": {
                "base": _show_stage(run_git, 1, file_path, redact),
                "ours": _show_stage(run_git, 2, file_path, redact),
                "theirs": _show_stage(run_git, 3, file_path, redact),
            },
        })
    return evidence
