"""AI-assisted review for merge-plan dry-run results."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from langchain_openai import ChatOpenAI

from .agents import BaseAgent
from .langfuse_utils import LangfuseTracingContext

logger = logging.getLogger("diff-lens.merge_plan_review")


def _dedupe_conflict_details(result: Dict[str, Any]) -> List[Dict[str, Any]]:
    details: Dict[str, Dict[str, Any]] = {}
    for item in (result.get("individual_results") or []) + (result.get("sequential_results") or []):
        candidate = {
            "candidate_id": item.get("candidate_id"),
            "candidate_label": item.get("candidate_label"),
            "candidate_ref": item.get("candidate_ref"),
            "order": item.get("order"),
            "status": item.get("status"),
            "mode": "sequential" if item.get("order") else "individual",
        }
        for detail in item.get("conflict_details") or []:
            path = detail.get("file_path")
            if not path:
                continue
            current = details.get(path)
            prefer_current = (
                not current
                or (
                    candidate["mode"] == "sequential"
                    and item.get("status") in {"blocked", "conflicts"}
                    and not any(seen.get("mode") == "sequential" for seen in current.get("seen_in", []))
                )
            )
            if prefer_current:
                previous_seen = current.get("seen_in", []) if current else []
                details[path] = {**detail, "seen_in": previous_seen}
            merged = details[path]
            merged.setdefault("seen_in", []).append(candidate)
    return list(details.values())


def _text_of(value: Any) -> str:
    if not value:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return str(value.get("text") or "")
    return str(value)


def _meaningful_lines(lines: List[str], limit: int = 5) -> List[str]:
    picked = [line.rstrip() for line in lines if line.strip()]
    return picked[:limit]


def _short_code(lines: List[str], limit: int = 5) -> str:
    picked = _meaningful_lines(lines, limit=limit)
    if not picked:
        return "(빈 변경)"
    text = "\n".join(picked)
    return text[:700] + ("..." if len(text) > 700 else "")


def _inline_code_hint(lines: List[str]) -> str:
    for line in lines:
        stripped = line.strip()
        if stripped:
            return f"`{stripped[:90]}{'...' if len(stripped) > 90 else ''}`"
    return "빈 변경"


def _split_conflict_marker(block: Dict[str, Any]) -> Dict[str, Any]:
    ours: List[str] = []
    theirs: List[str] = []
    side: Optional[str] = None
    for line in _text_of(block).splitlines():
        stripped = line.lstrip()
        if stripped.startswith("<<<<<<<"):
            side = "ours"
            continue
        if stripped.startswith("======="):
            side = "theirs"
            continue
        if stripped.startswith(">>>>>>>"):
            side = None
            continue
        if side == "ours":
            ours.append(line)
        elif side == "theirs":
            theirs.append(line)
    return {
        "start_line": block.get("start_line"),
        "end_line": block.get("end_line"),
        "ours_lines": ours,
        "theirs_lines": theirs,
    }


def _merge_context(detail: Dict[str, Any]) -> Dict[str, str]:
    seen = detail.get("seen_in") or []
    primary = next((item for item in seen if item.get("mode") == "sequential" and item.get("status") in {"blocked", "conflicts"}), None)
    primary = primary or (seen[0] if seen else {})
    candidate = primary.get("candidate_label") or primary.get("candidate_ref") or "현재 후보"
    order = primary.get("order")
    if primary.get("mode") == "sequential":
        if order and order > 1:
            base_label = f"대상 C + 앞선 후보 1~{order - 1}까지 누적된 상태"
        else:
            base_label = "대상 C 현재 상태"
        if order and str(candidate).replace(" ", "") == f"후보{order}":
            incoming_label = f"{order}번째 후보"
        else:
            incoming_label = f"{order}번째 후보 {candidate}" if order else f"현재 후보 {candidate}"
        summary = f"순차 dry-run에서 {incoming_label}를 {base_label}에 붙이는 순간 충돌했습니다."
    else:
        base_label = "대상 C 현재 상태"
        incoming_label = f"후보 {candidate}"
        summary = f"개별 dry-run에서 {incoming_label}를 {base_label}에 붙이는 순간 충돌했습니다."
    return {
        "base_side_label": base_label,
        "incoming_side_label": incoming_label,
        "merge_context_summary": summary,
    }


def _domain_hints(ours_text: str, theirs_text: str) -> List[str]:
    combined = f"{ours_text}\n{theirs_text}"
    hints: List[str] = []
    if "file_content" in combined and ("max_page_limit" in combined or "PDF_VLM_MIN_CHARS_PER_BATCH" in combined):
        hints.append("빈 텍스트 보호 로직과 페이지/최소 글자 수 검증은 서로 다른 guard라 단순 선택보다 순서 있게 병합하는 쪽이 안전합니다.")
    if "return " in ours_text and "return " in theirs_text:
        hints.append("양쪽 모두 return 경로를 바꾸므로 먼저 실행될 guard가 뒤쪽 후보 로직을 막지 않는지 확인해야 합니다.")
    if "os.getenv" in combined:
        hints.append("후보 쪽 환경변수 기본값이 운영 설정과 맞는지 확인해야 합니다.")
    return hints


def _region_decision(block: Dict[str, Any]) -> Dict[str, Any]:
    split = _split_conflict_marker(block)
    ours_lines = split["ours_lines"]
    theirs_lines = split["theirs_lines"]
    ours_text = "\n".join(ours_lines)
    theirs_text = "\n".join(theirs_lines)
    has_ours = bool(ours_text.strip())
    has_theirs = bool(theirs_text.strip())
    line_range = f"{split.get('start_line') or '?'}-{split.get('end_line') or '?'}"

    if has_ours and has_theirs:
        decision = "combine"
        decision_label = "양쪽 변경 합치기"
        recommended_action = (
            f"lines {line_range}에서는 단순 선택을 피하고, "
            f"기준 쪽의 {_inline_code_hint(ours_lines)}와 들어오는 후보 쪽의 {_inline_code_hint(theirs_lines)}를 같은 제어 흐름 안에 통합하세요."
        )
        confidence = "medium"
    elif has_theirs:
        decision = "accept_theirs"
        decision_label = "들어오는 후보 적용"
        recommended_action = f"lines {line_range}에서는 기준 쪽 변경이 비어 있거나 삭제에 가까우므로 들어오는 후보 쪽 변경을 적용한 뒤 주변 흐름만 검증하세요."
        confidence = "medium"
    elif has_ours:
        decision = "keep_ours"
        decision_label = "기준 쪽 유지"
        recommended_action = f"lines {line_range}에서는 들어오는 후보 쪽 실질 변경이 없어 보이므로 기준 쪽 로직을 유지하고 marker를 제거하세요."
        confidence = "medium"
    else:
        decision = "manual_review"
        decision_label = "수동 판단 필요"
        recommended_action = f"lines {line_range}에서 양쪽 변경을 충분히 읽을 수 없어 담당자 확인이 필요합니다."
        confidence = "low"

    hints = _domain_hints(ours_text, theirs_text)
    return {
        "line_range": line_range,
        "decision": decision,
        "decision_label": decision_label,
        "confidence": confidence,
        "recommended_action": recommended_action,
        "ours_preview": _short_code(ours_lines),
        "theirs_preview": _short_code(theirs_lines),
        "base_side_preview": _short_code(ours_lines),
        "incoming_side_preview": _short_code(theirs_lines),
        "rationale": hints or [
            "같은 라인 범위에서 기준 쪽과 들어오는 후보 쪽이 서로 다른 최종 내용을 만들고 있습니다.",
        ],
    }


def _decision_for_detail(detail: Dict[str, Any]) -> Dict[str, Any]:
    context = _merge_context(detail)
    blocks = detail.get("conflict_marker_blocks") or []
    regions = [_region_decision(block) for block in blocks[:6]]
    if not regions:
        return {
            **context,
            "decision": "manual_review",
            "decision_label": "수동 판단 필요",
            "confidence": "low",
            "recommended_action": "충돌 파일명은 확인됐지만 marker/diff 근거가 부족합니다. 캐시 무시로 다시 실행해 상세 근거를 수집하세요.",
            "implementation_steps": [
                "캐시 무시로 통합 머지 플랜을 다시 실행합니다.",
                "새 결과의 conflict marker와 기준 쪽/들어오는 후보 쪽 diff를 확인합니다.",
                "담당자와 보존할 동작을 정한 뒤 같은 순서로 dry-run을 재실행합니다.",
            ],
            "conflict_regions": [],
            "suggested_final_shape": "",
        }

    decisions = {region["decision"] for region in regions}
    if "manual_review" in decisions:
        overall = ("manual_review", "수동 판단 필요", "low")
    elif "combine" in decisions:
        overall = ("combine", "양쪽 변경 합치기", "medium")
    elif decisions == {"accept_theirs"}:
        overall = ("accept_theirs", "들어오는 후보 적용", "medium")
    elif decisions == {"keep_ours"}:
        overall = ("keep_ours", "기준 쪽 유지", "medium")
    else:
        overall = ("manual_review", "영역별로 다르게 처리", "medium")

    first = regions[0]
    implementation_steps = [
        f"{detail.get('file_path')}의 conflict marker를 열고 {first['line_range']} 영역부터 처리합니다.",
        first["recommended_action"],
        "marker를 제거한 뒤 중복 조건, 조기 return, 예외 처리 순서가 의도대로 이어지는지 읽습니다.",
        "파일 단위 테스트 또는 관련 workflow smoke test를 실행하고 같은 후보 순서로 dry-run을 다시 실행합니다.",
    ]
    suggested_final_shape = ""
    if overall[0] == "combine":
        suggested_final_shape = (
            "병합 초안 방향:\n"
            "1. 기준 쪽 블록에서 기존 보호/호환성 로직을 먼저 보존합니다.\n"
            "2. 이어서 들어오는 후보 쪽 블록의 신규 검증/처리 로직을 삽입합니다.\n"
            "3. 두 블록이 모두 return을 만들면 더 좁은 실패 조건이 먼저 평가되도록 순서를 정리합니다."
        )

    return {
        **context,
        "decision": overall[0],
        "decision_label": overall[1],
        "confidence": overall[2],
        "recommended_action": first["recommended_action"],
        "implementation_steps": implementation_steps,
        "conflict_regions": regions,
        "suggested_final_shape": suggested_final_shape,
    }


def _enrich_file_reviews(parsed_reviews: List[Dict[str, Any]], fallback_reviews: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    defaults = {review.get("file_path"): review for review in fallback_reviews}
    enriched: List[Dict[str, Any]] = []
    for review in parsed_reviews or []:
        if not isinstance(review, dict):
            continue
        default = defaults.get(review.get("file_path")) or {}
        merged = {**default, **review}
        for key in [
            "base_side_label",
            "incoming_side_label",
            "merge_context_summary",
            "decision",
            "decision_label",
            "confidence",
            "recommended_action",
            "implementation_steps",
            "conflict_regions",
            "suggested_final_shape",
        ]:
            if key not in merged and key in default:
                merged[key] = default[key]
        enriched.append(merged)
    return enriched or fallback_reviews


def _fallback_file_reviews(conflict_details: List[Dict[str, Any]], conflict_files: List[str]) -> List[Dict[str, Any]]:
    file_reviews = []
    detail_by_path = {detail.get("file_path"): detail for detail in conflict_details}
    for file_path in conflict_files[:12]:
        detail = detail_by_path.get(file_path) or {}
        decision = _decision_for_detail(detail)
        has_markers = bool(detail.get("conflict_marker_blocks"))
        has_diff = bool((detail.get("combined_diff") or {}).get("text"))
        has_variant_diff = any(
            bool((detail.get("diff_variants") or {}).get(name, {}).get("text"))
            for name in ["base", "ours", "theirs"]
        )
        evidence = []
        if has_markers:
            evidence.append("임시 worktree 파일에 conflict marker가 남아 있습니다.")
        if has_diff:
            evidence.append("git diff --cc 결과가 있어 기준 쪽/들어오는 후보 쪽 변경 위치를 대조할 수 있습니다.")
        if has_variant_diff:
            evidence.append("git diff --base/--ours/--theirs 근거가 있어 공통 조상, 기준 쪽, 들어오는 후보 쪽을 비교할 수 있습니다.")
        if detail.get("seen_in"):
            labels = [
                item.get("candidate_label") or item.get("candidate_ref")
                for item in detail.get("seen_in") or []
                if item.get("candidate_label") or item.get("candidate_ref")
            ]
            if labels:
                evidence.append(f"관련 후보: {', '.join(dict.fromkeys(labels))}")
        file_reviews.append({
            "file_path": file_path,
            "why_conflict": (
                f"{decision['merge_context_summary']} "
                f"이 파일의 기본 판단은 '{decision['decision_label']}'입니다."
            ),
            "base_side_label": decision["base_side_label"],
            "incoming_side_label": decision["incoming_side_label"],
            "merge_context_summary": decision["merge_context_summary"],
            "decision": decision["decision"],
            "decision_label": decision["decision_label"],
            "confidence": decision["confidence"],
            "recommended_action": decision["recommended_action"],
            "resolution_plan": decision["implementation_steps"],
            "implementation_steps": decision["implementation_steps"],
            "conflict_regions": decision["conflict_regions"],
            "suggested_final_shape": decision["suggested_final_shape"],
            "checks": [
                "conflict marker가 완전히 제거되었는지 확인합니다.",
                "양쪽 후보가 기대한 입력/출력 계약이 깨지지 않았는지 확인합니다.",
            ],
            "evidence": evidence or ["충돌 파일 목록은 확인됐지만 상세 diff 근거는 제한적으로 수집됐습니다."],
        })
    return file_reviews


def fallback_merge_plan_review(result: Dict[str, Any]) -> Dict[str, Any]:
    status = result.get("status")
    first_blocker = result.get("first_blocker") or {}
    individual = (result.get("summary_counts") or {}).get("individual") or {}
    sequential = (result.get("summary_counts") or {}).get("sequential") or {}
    conflict_files = []
    for item in (result.get("individual_results") or []) + (result.get("sequential_results") or []):
        conflict_files.extend(item.get("conflict_files") or [])
    conflict_files = list(dict.fromkeys(conflict_files))
    conflict_details = _dedupe_conflict_details(result)

    if status == "conflicts":
        headline = "순차 머지 전에 충돌 해결 순서를 정해야 합니다."
        next_actions = [
            "first_blocker 후보의 충돌 파일을 기준으로 담당자를 먼저 정합니다.",
            "개별 충돌과 순차 충돌을 분리해서, 대상 C와의 충돌인지 후보끼리의 충돌인지 확인합니다.",
            "충돌 파일 수정 뒤 같은 후보 순서로 dry-run을 다시 실행합니다.",
        ]
    elif status == "unknown":
        headline = "충돌 여부를 확정하지 못한 단계가 있습니다."
        next_actions = [
            "ref drift, fetch 실패, timeout 여부를 diagnostics에서 먼저 확인합니다.",
            "대상과 후보를 최신 SHA로 다시 잠근 뒤 재실행합니다.",
            "확인 불가 상태에서는 배포 가능으로 해석하지 않습니다.",
        ]
    else:
        headline = "텍스트 병합 충돌은 발견되지 않았습니다."
        next_actions = [
            "이 결과는 테스트 통과를 의미하지 않으므로 통합 테스트와 smoke test를 별도로 실행합니다.",
            "후보 순서가 실제 릴리즈 순서와 같은지 확인합니다.",
            "대상 브랜치가 움직이면 SHA를 다시 잠그고 재실행합니다.",
        ]

    return {
        "mode": "deterministic_fallback",
        "headline": headline,
        "summary": (
            f"개별 clean {individual.get('clean', 0)}개, 개별 충돌 {individual.get('conflicts', 0)}개, "
            f"순차 clean {sequential.get('clean', 0)}개, 순차 blocker {sequential.get('blocked', 0)}개입니다."
        ),
        "first_blocker": first_blocker or None,
        "conflict_files": conflict_files[:20],
        "conflict_details": conflict_details[:8],
        "file_reviews": _fallback_file_reviews(conflict_details, conflict_files),
        "next_actions": next_actions,
        "questions": [
            "충돌 파일의 기준 C 변경과 후보 변경 중 어느 쪽이 반드시 보존되어야 하나요?",
            "후보 순서를 바꾸면 충돌이 줄어드는지 별도 시뮬레이션이 필요한가요?",
            "충돌 해결 후 반드시 실행해야 할 테스트 범위는 무엇인가요?",
        ],
    }


class MergePlanReviewAgent(BaseAgent):
    """Review merge-plan dry-run evidence without claiming deploy safety."""

    def __init__(
        self,
        llm: ChatOpenAI,
        prompts: Optional[Dict] = None,
        tracing_context: Optional[LangfuseTracingContext] = None,
    ):
        super().__init__(llm, prompts, tracing_context)

    def run(self, result: Dict[str, Any], style: str = "balanced") -> Dict[str, Any]:
        payload = self._compact_payload(result)
        fallback = fallback_merge_plan_review(result)
        chain = self._build_string_chain(
            "merge_plan_reviewer",
            system_default=(
                "당신은 릴리즈 통합 머지 리뷰어입니다. dry-run merge 결과만 근거로 "
                "충돌 원인 추정, 처리 순서, 확인 질문을 한국어로 작성합니다. "
                "파일별 리뷰에서는 combined diff, conflict marker, base/ours/theirs stage 중 실제로 제공된 근거를 인용하되, "
                "사용자에게는 ours/theirs 대신 '기준 쪽'과 '들어오는 후보 쪽'이라고 설명해 "
                "어떤 변경을 보존하거나 합쳐야 하는지 실행 가능한 수준으로 제안하세요. "
                "테스트 통과나 배포 가능을 단정하지 마세요."
            ),
            user_default=(
                "## 리뷰 스타일\n{style}\n\n"
                "## dry-run 결과 JSON\n{payload}\n\n"
                "다음 JSON 형식으로만 답하세요:\n"
                "{{\"headline\":\"...\",\"summary\":\"...\",\"first_blocker_note\":\"...\"," 
                "\"file_reviews\":[{{\"file_path\":\"...\",\"why_conflict\":\"...\"," 
                "\"base_side_label\":\"대상 C 또는 대상 C + 앞선 후보들\","
                "\"incoming_side_label\":\"현재 붙이는 후보\","
                "\"merge_context_summary\":\"...\"," 
                "\"decision\":\"combine|keep_ours|accept_theirs|manual_review\","
                "\"decision_label\":\"...\",\"confidence\":\"high|medium|low\","
                "\"recommended_action\":\"...\",\"implementation_steps\":[\"...\"],"
                "\"conflict_regions\":[{{\"line_range\":\"...\",\"decision\":\"...\",\"recommended_action\":\"...\","
                "\"base_side_preview\":\"...\",\"incoming_side_preview\":\"...\",\"rationale\":[\"...\"]}}],"
                "\"suggested_final_shape\":\"...\",\"resolution_plan\":[\"...\"],\"checks\":[\"...\"],\"evidence\":[\"...\"]}}],"
                "\"next_actions\":[\"...\"],\"questions\":[\"...\"],\"risk_notes\":[\"...\"]}}\n\n"
                "file_reviews는 conflict_details의 combined_diff, conflict_marker_blocks, base/ours/theirs stage 근거를 사용하되 "
                "설명 문장에는 기준 쪽/들어오는 후보 쪽 용어를 쓰세요. "
                "파일 단위로 작성하세요. 각 파일마다 why_conflict는 구체적인 충돌 영역/역할을 설명하고, "
                "decision_label과 recommended_action에는 릴리즈 담당자가 바로 실행할 판단을 쓰세요. "
                "둘 다 보존해야 하면 combine, 현재 기준만 남기면 keep_ours, 후보만 적용하면 accept_theirs, "
                "근거가 부족하면 manual_review로 표시하세요. implementation_steps는 최소 4개 단계, "
                "checks는 최소 2개 검증 항목, evidence는 실제 근거 문장 최소 2개를 넣으세요. "
                "근거가 부족하면 추측하지 말고 어떤 근거가 없어서 확인이 필요한지 쓰세요."
            ),
        )
        try:
            content = chain.invoke(
                {
                    "style": style or "balanced",
                    "payload": json.dumps(payload, ensure_ascii=False),
                },
                config=self._get_config(
                    trace_name="merge_plan_review",
                    metadata={
                        "status": result.get("status"),
                        "candidate_count": len(result.get("candidates") or []),
                        "style": style,
                    },
                ),
            )
            parsed = json.loads(str(content).strip())
            return {
                "mode": "llm",
                "headline": parsed.get("headline") or fallback["headline"],
                "summary": parsed.get("summary") or fallback["summary"],
                "first_blocker": result.get("first_blocker"),
                "first_blocker_note": parsed.get("first_blocker_note") or "",
                "conflict_files": fallback["conflict_files"],
                "conflict_details": fallback["conflict_details"],
                "file_reviews": _enrich_file_reviews(parsed.get("file_reviews") or [], fallback["file_reviews"]),
                "next_actions": parsed.get("next_actions") or fallback["next_actions"],
                "questions": parsed.get("questions") or fallback["questions"],
                "risk_notes": parsed.get("risk_notes") or [],
            }
        except Exception as exc:
            logger.warning("Merge plan AI review failed, using fallback: %s", exc)
            fallback["mode"] = "fallback_after_llm_error"
            fallback["error"] = str(exc)
            return fallback

    def _compact_payload(self, result: Dict[str, Any]) -> Dict[str, Any]:
        def compact_item(item: Dict[str, Any]) -> Dict[str, Any]:
            return {
                "candidate_id": item.get("candidate_id"),
                "candidate_label": item.get("candidate_label"),
                "candidate_ref": item.get("candidate_ref"),
                "status": item.get("status"),
                "message": item.get("message"),
                "conflict_files": (item.get("conflict_files") or [])[:20],
                "conflict_details": [
                    {
                        "file_path": detail.get("file_path"),
                        "status": detail.get("status"),
                        "combined_diff": detail.get("combined_diff"),
                        "diff_variants": detail.get("diff_variants"),
                        "unmerged_index": detail.get("unmerged_index"),
                        "conflict_marker_blocks": detail.get("conflict_marker_blocks"),
                        "stages": detail.get("stages"),
                    }
                    for detail in (item.get("conflict_details") or [])[:6]
                ],
                "merge_base_sha": (item.get("merge_base_sha") or "")[:12],
            }

        return {
            "status": result.get("status"),
            "target": result.get("target_resolved"),
            "candidates": [
                {
                    "id": candidate.get("id"),
                    "label": candidate.get("label"),
                    "ref": candidate.get("ref"),
                    "sha": (candidate.get("sha") or "")[:12],
                    "order": candidate.get("order"),
                }
                for candidate in result.get("candidates") or []
            ],
            "summary_counts": result.get("summary_counts"),
            "first_blocker": compact_item(result.get("first_blocker") or {}) if result.get("first_blocker") else None,
            "individual_results": [compact_item(item) for item in result.get("individual_results") or []],
            "sequential_results": [compact_item(item) for item in result.get("sequential_results") or []],
        }
