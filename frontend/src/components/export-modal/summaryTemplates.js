export const PREDEFINED_SUMMARY_TYPES = {
  risk_analysis: {
    name: "시스템 위험성 분석",
    icon: "⚠️",
    description: "잠재적 리스크, 시스템 영향도, 보안 취약점 분석",
    groups: [
      { 
        name: "잠재적 리스크", 
        description: "코드 변경으로 인해 발생할 수 있는 위험 요소",
        keys: [
          { name: "리스크 유형", description: "어떤 종류의 리스크인지 (기술적/비즈니스/보안)" },
          { name: "심각도", description: "HIGH/MEDIUM/LOW 중 하나" },
          { name: "영향 범위", description: "어떤 시스템이나 기능에 영향을 미치는지" },
          { name: "발생 조건", description: "어떤 상황에서 리스크가 발생하는지" }
        ]
      },
      { 
        name: "시스템 영향도",
        description: "시스템 전반에 미치는 영향",
        keys: [
          { name: "영향 받는 시스템", description: "변경으로 영향을 받는 시스템 목록" },
          { name: "의존성", description: "연관된 의존성 정보" },
          { name: "복구 난이도", description: "문제 발생 시 복구하기 어려운 정도" }
        ]
      },
      { 
        name: "보안 취약점",
        description: "보안 관점에서의 위험 요소",
        keys: [
          { name: "취약점 유형", description: "보안 취약점의 종류" },
          { name: "공격 벡터", description: "잠재적 공격 경로" },
          { name: "권장 조치", description: "보안을 위해 필요한 조치" }
        ]
      }
    ]
  },
  improvement: {
    name: "개선 사항 도출",
    icon: "🛠️",
    description: "코드 품질, 성능 최적화, 유지보수성 개선 포인트",
    groups: [
      { 
        name: "코드 품질", 
        keys: [
          { name: "개선 포인트", description: "개선이 필요한 구체적인 부분" },
          { name: "현재 문제점", description: "현재 코드의 문제점" },
          { name: "권장 수정", description: "어떻게 수정하면 좋을지" }
        ]
      },
      { 
        name: "성능 최적화", 
        keys: [
          { name: "병목 지점", description: "성능 저하가 발생하는 부분" },
          { name: "최적화 방안", description: "성능 개선 방법" },
          { name: "예상 효과", description: "최적화 시 기대되는 효과" }
        ]
      },
      { 
        name: "유지보수성", 
        keys: [
          { name: "리팩토링 대상", description: "리팩토링이 필요한 코드" },
          { name: "이유", description: "왜 리팩토링이 필요한지" },
          { name: "우선순위", description: "HIGH/MEDIUM/LOW 중 하나" }
        ]
      }
    ]
  },
  change_reason: {
    name: "변경 사유 요약",
    icon: "📋",
    description: "비즈니스/기술 요구사항 관점의 변경 사유 정리",
    groups: [
      { 
        name: "비즈니스 요구사항", 
        keys: [
          { name: "요구사항", description: "변경을 요청한 비즈니스 요구사항" },
          { name: "배경", description: "요구사항의 배경" },
          { name: "기대 효과", description: "요구사항 달성 시 기대 효과" }
        ]
      },
      { 
        name: "기술적 변경", 
        keys: [
          { name: "변경 내용", description: "구체적인 기술 변경 사항" },
          { name: "기술적 이유", description: "왜 이 변경이 필요한지" },
          { name: "대안 검토", description: "검토한 다른 대안" }
        ]
      }
    ]
  },
  release_notes: {
    name: "릴리즈 노트 초안",
    icon: "📝",
    description: "사용자/운영자 관점의 변경 사항 요약",
    groups: [
      { 
        name: "신규 기능", 
        keys: [
          { name: "기능명", description: "새로 추가된 기능 이름" },
          { name: "설명", description: "기능에 대한 간단한 설명" },
          { name: "사용 방법", description: "사용자가 기능을 어떻게 사용하는지" }
        ]
      },
      { 
        name: "버그 수정", 
        keys: [
          { name: "수정 내용", description: "수정된 버그 설명" },
          { name: "영향 범위", description: "수정으로 인해 영향 받는 범위" }
        ]
      },
      { 
        name: "주의사항", 
        keys: [
          { name: "변경점", description: "사용자가 주의해야 할 변경 사항" },
          { name: "마이그레이션", description: "마이그레이션 필요 여부 및 방법" }
        ]
      }
    ]
  },
  dependency_impact: {
    name: "의존성 영향 분석",
    icon: "🔗",
    description: "모듈/시스템 의존성 영향 분석",
    groups: [
      { 
        name: "직접 영향", 
        keys: [
          { name: "영향 받는 모듈", description: "직접 영향 받는 모듈 목록" },
          { name: "변경 유형", description: "어떤 종류의 변경인지" },
          { name: "테스트 필요", description: "추가 테스트가 필요한지" }
        ]
      },
      { 
        name: "간접 영향", 
        keys: [
          { name: "연관 시스템", description: "간접적으로 영향 받는 시스템" },
          { name: "위험도", description: "HIGH/MEDIUM/LOW 중 하나" },
          { name: "확인 사항", description: "확인해야 할 내용" }
        ]
      }
    ]
  }
}

export const FLAT_TEMPLATES = {   risk_classification: {     name: "위험도 분류표",     icon: "⚠️",     description: "상/중/하 위험도로 분류",     category: { name: "위험도", values: ["상", "중", "하"] },     columns: [       { name: "분석 요약", description: "해당 위험도로 분류한 이유 요약" },       { name: "해당 파일", description: "이 위험도에 해당하는 파일 목록" },       { name: "권장 조치", description: "배포 전 필요한 조치" }     ]   },   change_type: {     name: "변경 유형 분류",     icon: "📦",     description: "기능추가/버그수정/리팩토링/설정변경",     category: { name: "변경유형", values: ["기능추가", "버그수정", "리팩토링", "설정변경"] },     columns: [       { name: "변경 내용 요약", description: "해당 유형의 변경 내용 요약" },       { name: "해당 파일", description: "이 유형에 해당하는 파일 목록" },       { name: "테스트 범위", description: "테스트가 필요한 범위" }     ]   },   impact_scope: {     name: "영향 범위 분석",     icon: "🎯",     description: "핵심시스템/부가기능/UI/인프라",     category: { name: "영향범위", values: ["핵심시스템", "부가기능", "UI/UX", "인프라"] },     columns: [       { name: "영향 요약", description: "해당 영역에 미치는 영향 요약" },       { name: "해당 파일", description: "이 영역에 해당하는 파일 목록" },       { name: "관련 담당자", description: "확인이 필요한 담당자/팀" }     ]   },   release_notes_flat: {     name: "릴리즈 노트 초안",     icon: "📝",     description: "신규기능/개선사항/버그수정/주의사항",     category: { name: "구분", values: ["신규기능", "개선사항", "버그수정", "주의사항"] },     columns: [       { name: "내용", description: "사용자에게 안내할 내용" },       { name: "대상 사용자", description: "이 변경의 대상 사용자" },       { name: "참고", description: "추가 참고사항" }     ]   },   approval_checklist: {     name: "승인 체크리스트",     icon: "✅",     description: "코드리뷰/테스트/성능검증/보안검토",     category: { name: "체크항목", values: ["코드리뷰", "테스트", "성능검증", "보안검토"] },     columns: [       { name: "상태", description: "진행/완료/미진행 상태" },       { name: "결과 요약", description: "검토 결과 요약" },       { name: "담당자", description: "담당자 또는 리뷰어" }     ]   } } // FLAT 템플릿 선택 시 편집 가능 상태 초기화
