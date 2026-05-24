"""Small Git diff parsing helpers shared by clients and agents."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple


def count_diff_changes(diff_text: str) -> Tuple[int, int]:
    """Count additions and deletions from diff text."""
    additions = 0
    deletions = 0

    if not diff_text:
        return 0, 0

    for line in diff_text.split("\n"):
        if line.startswith("@@") or line.startswith("---") or line.startswith("+++"):
            continue
        if line.startswith("+") and not line.startswith("+++"):
            additions += 1
        elif line.startswith("-") and not line.startswith("---"):
            deletions += 1

    return additions, deletions


HUNK_RE = re.compile(
    r"@@ -(?P<old_start>\d+)(?:,(?P<old_count>\d+))? "
    r"\+(?P<new_start>\d+)(?:,(?P<new_count>\d+))? @@(?P<header>.*)"
)


def build_diff_evidence(diff_text: str, max_hunks: int = 5) -> Tuple[List[Dict[str, Any]], int]:
    """Build compact, hunk-based evidence without sending/storing full files."""
    if not diff_text:
        return [], 0

    hunks = []
    current = None
    for line in diff_text.splitlines():
        match = HUNK_RE.match(line)
        if match:
            if current:
                hunks.append(current)
            current = {
                "hunk_index": len(hunks) + 1,
                "header": line,
                "old_start": int(match.group("old_start")),
                "new_start": int(match.group("new_start")),
                "line_hint": f"-{match.group('old_start')} +{match.group('new_start')}",
                "quote": "",
            }
            continue

        if current and (line.startswith("+") or line.startswith("-")) and not line.startswith(("+++", "---")):
            if len(current["quote"]) < 500:
                current["quote"] += line[:180] + "\n"

    if current:
        hunks.append(current)

    selected = []
    scored = []
    for hunk in hunks:
        text = hunk.get("quote", "")
        score = 0
        if re.search(r"\b(def|class|function|const|let|var)\b|=>", text):
            score += 4
        if re.search(r"HTTPException|raise|except|try:|catch|error|validation|permission|auth|token", text, re.I):
            score += 4
        if re.search(r"SELECT|INSERT|UPDATE|DELETE|session\.|db\.|migration|schema", text, re.I):
            score += 4
        if re.search(r"@app\.|@router\.|route|endpoint|api", text, re.I):
            score += 3
        if len(text.splitlines()) > 12:
            score += 1
        scored.append((score, hunk))

    for _, hunk in sorted(scored, key=lambda item: item[0], reverse=True)[:max_hunks]:
        hunk["quote"] = hunk.get("quote", "").strip()
        selected.append(hunk)

    selected.sort(key=lambda h: h["hunk_index"])
    return selected, max(0, len(hunks) - len(selected))


def content_summary(content: Optional[str], path: str, ref_label: str) -> str:
    if content is None:
        return f"{ref_label} 기준 `{path}` 내용을 가져오지 못했거나 파일이 존재하지 않습니다."
    lines = content.splitlines()
    return f"{ref_label} 기준 `{path}` 파일 존재 ({len(lines)} lines, {len(content)} chars)."
