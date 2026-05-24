const AI_RESULT_SECTIONS = [
  'Before',
  'After',
  '요약',
  '결론',
  '변경 내용',
  '추가된 내용',
  '삭제된 내용',
  '변경 목적',
  '근거',
  '근거 요약',
  '문제 여부',
  '판정',
  '심각도',
  '리스크 유형',
  '잠재적 리스크',
  '위험',
  '재현 조건',
  '영향 범위',
  '수정 제안',
  '최소 침습 수정안',
  '회귀 위험',
  '검증 권고',
  '검증 테스트',
  '테스트',
  '추가 점검',
  '권장 확인',
  '검토 포인트',
  '운영 확인',
  '배포 리스크',
  '오탐 가능성',
  '남은 불확실성',
  '남은 확인 사항',
]

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const sectionPattern = AI_RESULT_SECTIONS.map(escapeRegExp).join('|')

export const normalizeAiResultMarkdown = (markdown = '') => {
  if (!markdown) return ''

  return String(markdown)
    .replace(/\r\n/g, '\n')
    .replace(new RegExp(`(^|\\n)\\s*(?:[-*]\\s*)?\\*\\*(${sectionPattern})\\s*[:：]\\*\\*\\s*`, 'g'), '\n\n### $2\n\n')
    .replace(new RegExp(`(^|\\n)\\s*(?:[-*]\\s*)?\\*\\*(${sectionPattern})\\*\\*\\s*[:：]\\s*`, 'g'), '\n\n### $2\n\n')
    .replace(new RegExp(`(^|\\n)\\s*(?:[-*]\\s*)?(${sectionPattern})\\s*[:：]\\s*`, 'g'), '\n\n### $2\n\n')
    .replace(new RegExp(`(^|\\n)\\s*(${sectionPattern})\\s*$`, 'gm'), '\n\n### $2\n\n')
    .replace(/(^|\n)\s*(\d+)\.\s+(`?[^`\n]{1,180}`?\s*\[(?:CRITICAL|HIGH|MEDIUM|LOW|Critical|High|Medium|Low)\])/g, '\n\n## $2. $3')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export const aiSummaryPreviewText = (markdown = '', maxLength = 160) => {
  const normalized = normalizeAiResultMarkdown(markdown)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_`>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized || normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength).trim()}...`
}
