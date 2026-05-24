"""Reusable export summary templates."""

FLAT_SUMMARY_TEMPLATES = {
    "risk_classification": {
        "name": "위험도 분류표",
        "icon": "⚠️",
        "description": "변경 위험도를 상/중/하로 분류하여 테이블로 출력",
        "category": {
            "name": "위험도",
            "values": ["상", "중", "하"]
        },
        "columns": [
            {"name": "분석 요약", "description": "해당 위험도로 분류한 이유 요약"},
            {"name": "해당 파일", "description": "이 위험도에 해당하는 파일 목록"},
            {"name": "권장 조치", "description": "배포 전 필요한 조치"}
        ],
        "map_prompt": "각 파일의 변경 내용을 분석하여 위험도(상/중/하)를 판단하세요. 상: 시스템 장애 가능, 중: 기능 영향 있음, 하: 영향 미미",
        "final_prompt": "수집된 분석을 바탕으로 위험도별(상/중/하) 하나의 요약 행으로 정리하세요. 각 위험도에 해당하는 파일들을 그룹화하고 공통된 분석 요약을 작성하세요."
    },
    "change_type": {
        "name": "변경 유형 분류",
        "icon": "📦",
        "description": "변경 유형별로 분류하여 테이블로 출력",
        "category": {
            "name": "변경유형",
            "values": ["기능추가", "버그수정", "리팩토링", "설정변경"]
        },
        "columns": [
            {"name": "변경 내용 요약", "description": "해당 유형의 변경 내용 통합 요약"},
            {"name": "해당 파일", "description": "이 유형에 해당하는 파일 목록"},
            {"name": "테스트 범위", "description": "필요한 테스트 범위"}
        ],
        "map_prompt": "각 파일의 변경 내용을 분석하여 변경 유형(기능추가/버그수정/리팩토링/설정변경)으로 분류하세요.",
        "final_prompt": "수집된 분석을 바탕으로 변경 유형별 하나의 요약 행으로 정리하세요. 해당 유형이 없으면 '-'로 표시하세요."
    },
    "impact_scope": {
        "name": "영향 범위 분석",
        "icon": "🎯",
        "description": "영향 범위별로 분류하여 테이블로 출력",
        "category": {
            "name": "영향범위",
            "values": ["핵심시스템", "부가기능", "UI/UX", "인프라"]
        },
        "columns": [
            {"name": "영향 요약", "description": "해당 범위에 미치는 영향 요약"},
            {"name": "해당 파일", "description": "이 범위에 해당하는 파일 목록"},
            {"name": "관련 담당자", "description": "확인이 필요한 담당자/팀"}
        ],
        "map_prompt": "각 파일의 변경이 영향을 미치는 범위(핵심시스템/부가기능/UI/인프라)를 분석하세요.",
        "final_prompt": "수집된 분석을 바탕으로 영향 범위별 하나의 요약 행으로 정리하세요."
    },
    "release_notes_flat": {
        "name": "릴리즈 노트 초안",
        "icon": "📝",
        "description": "릴리즈 노트 형식으로 테이블 출력",
        "category": {
            "name": "구분",
            "values": ["신규기능", "개선사항", "버그수정", "주의사항"]
        },
        "columns": [
            {"name": "내용", "description": "해당 구분의 내용 요약"},
            {"name": "대상 사용자", "description": "영향 받는 사용자 그룹"},
            {"name": "참고", "description": "버전 정보나 추가 참고 사항"}
        ],
        "map_prompt": "각 파일의 변경을 사용자 관점에서 분석하여 신규기능/개선사항/버그수정/주의사항으로 분류하세요.",
        "final_prompt": "수집된 분석을 릴리즈 노트 형식으로 정리하세요. 각 구분별로 사용자가 이해할 수 있는 언어로 요약하세요."
    },
    "approval_checklist": {
        "name": "승인 체크리스트",
        "icon": "✅",
        "description": "배포 승인을 위한 체크리스트 테이블",
        "category": {
            "name": "체크항목",
            "values": ["코드리뷰", "테스트", "성능검증", "보안검토"]
        },
        "columns": [
            {"name": "상태", "description": "완료/진행중/미진행 상태"},
            {"name": "결과 요약", "description": "해당 항목의 결과 요약"},
            {"name": "담당자", "description": "담당자 (공백 가능)"}
        ],
        "map_prompt": "각 파일의 변경에 대해 코드리뷰/테스트/성능검증/보안검토 관점에서 필요한 사항을 분석하세요.",
        "final_prompt": "수집된 분석을 바탕으로 각 체크항목별 상태와 결과를 정리하세요. 초기 상태는 '미진행'으로 설정하세요."
    }
}
