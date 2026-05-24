"""Export summary template catalog and normalization helpers."""

from __future__ import annotations

from typing import Any, Dict, Optional


# ============================================================================

PREDEFINED_SUMMARY_TYPES = {
    "risk_analysis": {
        "name": "시스템 위험성 분석",
        "icon": "⚠️",
        "description": "잠재적 리스크, 시스템 영향도, 보안 취약점 분석",
        "groups": [
            {"name": "잠재적 리스크", "keys": ["리스크 유형", "심각도", "영향 범위", "발생 조건"]},
            {"name": "시스템 영향도", "keys": ["영향 받는 시스템", "의존성", "복구 난이도"]},
            {"name": "보안 취약점", "keys": ["취약점 유형", "공격 벡터", "권장 조치"]}
        ]
    },
    "improvement": {
        "name": "개선 사항 도출",
        "icon": "🛠️",
        "description": "코드 품질, 성능 최적화, 유지보수성 개선 포인트",
        "groups": [
            {"name": "코드 품질", "keys": ["개선 포인트", "현재 문제점", "권장 수정"]},
            {"name": "성능 최적화", "keys": ["병목 지점", "최적화 방안", "예상 효과"]},
            {"name": "유지보수성", "keys": ["리팩토링 대상", "이유", "우선순위"]}
        ]
    },
    "change_reason": {
        "name": "변경 사유 요약",
        "icon": "📋",
        "description": "비즈니스/기술 요구사항 관점의 변경 사유 정리",
        "groups": [
            {"name": "비즈니스 요구사항", "keys": ["요구사항", "배경", "기대 효과"]},
            {"name": "기술적 변경", "keys": ["변경 내용", "기술적 이유", "대안 검토"]}
        ]
    },
    "release_notes": {
        "name": "릴리즈 노트 초안",
        "icon": "📝",
        "description": "사용자/운영자 관점의 변경 사항 요약",
        "groups": [
            {"name": "신규 기능", "keys": ["기능명", "설명", "사용 방법"]},
            {"name": "버그 수정", "keys": ["수정 내용", "영향 범위"]},
            {"name": "주의사항", "keys": ["변경점", "마이그레이션 필요 여부"]}
        ]
    },
    "dependency_impact": {
        "name": "의존성 영향 분석",
        "icon": "🔗",
        "description": "모듈/시스템 의존성 영향 분석",
        "groups": [
            {"name": "직접 영향", "keys": ["영향 받는 모듈", "변경 유형", "테스트 필요"]},
            {"name": "간접 영향", "keys": ["연관 시스템", "위험도", "확인 사항"]}
        ]
    }
}


def _normalize_flat_template(key: str, config: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize YAML and legacy in-code flat template shapes."""
    columns = []
    for column in config.get("columns", []):
        if isinstance(column, str):
            columns.append({"name": column, "description": ""})
        else:
            columns.append(column)

    return {
        "name": config.get("name", key),
        "icon": config.get("icon", ""),
        "description": config.get("description", ""),
        "category": config.get("category", {}),
        "columns": columns,
        "map_prompt": config.get("map_prompt") or config.get("map_instruction", ""),
        "final_prompt": config.get("final_prompt") or config.get("final_instruction", ""),
    }


def _flat_templates_from_prompt_config(prompts: Optional[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    config = (prompts or {}).get("export_flat_summary", {})
    templates = config.get("templates", {}) if isinstance(config, dict) else {}
    return {
        key: _normalize_flat_template(key, value)
        for key, value in templates.items()
        if isinstance(value, dict)
    }


# ============================================================================
# FileFieldExtractorAgent - 파일별 KEY/VALUE 추출
# ============================================================================

