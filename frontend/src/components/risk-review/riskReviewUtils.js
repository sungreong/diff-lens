export const riskSeverityRank = { HIGH: 0, MEDIUM: 1, LOW: 2 }

export const promptStyleOptions = [
  { key: 'detailed', label: '자세하게', description: '상세한 분석과 모든 맥락 정보 포함', icon: 'list' },
  { key: 'balanced', label: '균형잡힌', description: '적절한 상세도와 간결함의 균형', icon: 'scale' },
  { key: 'concise', label: '핵심만', description: '빠른 검토를 위한 핵심 정보만', icon: 'zap' },
]

export const riskPromptStageMeta = [
  {
    key: 'collecting',
    label: '대상 파일 정리',
    description: '리스크가 감지된 파일과 심각도를 묶고 있습니다.',
  },
  {
    key: 'diffs',
    label: '근거 묶기',
    description: 'diff, 위치, AI 메모를 검토 요청에 넣을 형태로 정리합니다.',
  },
  {
    key: 'requesting',
    label: 'AI 생성 요청',
    description: '선택한 스타일로 검토 요청 프롬프트를 생성합니다.',
  },
  {
    key: 'finalizing',
    label: '결과 정리',
    description: '복사하거나 내려받을 수 있는 문서로 마무리합니다.',
  },
]

export const riskReviewChecklist = [
  '실제 위험 여부 판단 (오탐 가능성)',
  '문제 발생 조건 및 시나리오 식별',
  '구체적인 수정 방안 제안',
  '테스트 케이스 제안',
]

export const extractRiskFromAiSummary = (aiSummary, filePath = '') => {
  if (!aiSummary) return null

  const riskMatch = aiSummary.match(/잠재적 리스크[^:]*:\s*(.+?)(?=\n\n|\n-|\n##|$)/is)
  if (!riskMatch) return null

  const riskContent = riskMatch[1].trim()
  if (
    !riskContent ||
    riskContent.toLowerCase() === '없음' ||
    riskContent.toLowerCase() === 'none' ||
    riskContent.length < 3
  ) {
    return null
  }

  const highKeywords = ['무한 루프', '재귀', '메모리 누수', 'SQL Injection', 'XSS', '보안', '인증', '취약점']
  const mediumKeywords = ['DB 락', '동시성', '예외 처리', '타임아웃', '커넥션', '누락', '에러', '오류']
  let severity = 'LOW'
  if (highKeywords.some(keyword => riskContent.includes(keyword))) severity = 'HIGH'
  else if (mediumKeywords.some(keyword => riskContent.includes(keyword))) severity = 'MEDIUM'

  const locationMatches = riskContent.match(/(?:라인|Line|line)\s*(\d+)|`([^`]+)`|(\w+\(\))/g) || []
  const location = locationMatches.length > 0 ? locationMatches.join(', ') : '위치 미상'
  const riskType = riskContent.split(/[,\.\n]/)[0].trim().slice(0, 50)

  return {
    filePath,
    riskType,
    severity,
    location,
    originalContent: riskContent,
  }
}

export const formatDuration = (seconds) => {
  if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) return ''
  const value = Math.max(0, Number(seconds))
  if (value < 60) return `${value < 10 ? value.toFixed(1) : Math.round(value)}초`
  const minutes = Math.floor(value / 60)
  const rest = Math.round(value % 60)
  return `${minutes}분 ${rest}초`
}

export const stableHash = (value = '') => {
  let hash = 0
  const text = String(value)
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}

export const buildRiskReviewStorageKey = ({ filesWithRisks, baseCommit, targetCommit }) => {
  const signature = JSON.stringify({
    baseCommit: baseCommit || '',
    targetCommit: targetCommit || '',
    files: filesWithRisks.map(file => ({
      path: file.path,
      severity: file.risk?.severity,
      riskType: file.risk?.riskType,
      location: file.risk?.location,
    })),
  })
  return `diff-lens:risk-review:${stableHash(signature)}`
}

export const riskCounts = (filesWithRisks = []) => ({
  high: filesWithRisks.filter(file => file.risk?.severity === 'HIGH').length,
  medium: filesWithRisks.filter(file => file.risk?.severity === 'MEDIUM').length,
  low: filesWithRisks.filter(file => file.risk?.severity === 'LOW').length,
})

export const buildRiskFilesPayload = (filesWithRisks = []) => (
  filesWithRisks.map(file => ({
    file_path: file.path,
    risk_type: file.risk.riskType,
    severity: file.risk.severity,
    location: file.risk.location,
    original_content: file.risk.originalContent,
    diff: file.diff || '',
  }))
)

export const buildLocalReviewPrompt = ({ filesWithRisks, baseCommit, targetCommit }) => {
  if (!filesWithRisks.length) return ''

  const date = new Date().toLocaleDateString('ko-KR')
  let prompt = '# 코드 리스크 검토 요청\n\n'
  prompt += '다음 파일들에서 잠재적 리스크가 감지되었습니다. 각 항목을 검토해주세요.\n\n'
  prompt += `- **분석 일시**: ${date}\n`
  prompt += `- **분석 범위**: ${baseCommit?.slice(0, 8) || ''} -> ${targetCommit?.slice(0, 8) || 'HEAD'}\n`
  prompt += `- **리스크 감지 파일**: ${filesWithRisks.length}개\n\n`
  prompt += '---\n\n'

  filesWithRisks.forEach((file, idx) => {
    const { risk, path, diff } = file
    const ext = path.split('.').pop() || ''
    prompt += `## ${idx + 1}. \`${path}\` [${risk.severity}]\n\n`
    prompt += `**위치**: ${risk.location}\n`
    prompt += `**감지된 리스크**: ${risk.originalContent}\n\n`
    if (diff) {
      const diffPreview = diff.length > 1500 ? `${diff.slice(0, 1500)}\n... (이하 생략)` : diff
      prompt += `**변경 내용 (Diff)**:\n\`\`\`${ext}\n${diffPreview}\n\`\`\`\n\n`
    }
    prompt += '**검토 요청**:\n'
    prompt += `- 이 코드가 실제로 "${risk.riskType}"를 유발하는지 확인해주세요\n`
    prompt += '- 문제가 있다면 구체적인 개선 방안을 제안해주세요\n'
    prompt += '- 테스트 케이스가 필요하다면 제안해주세요\n\n'
    prompt += '---\n\n'
  })

  prompt += '## 검토 체크리스트\n\n'
  prompt += '각 파일에 대해 아래 항목을 확인해주세요:\n\n'
  riskReviewChecklist.forEach(item => {
    prompt += `- [ ] ${item}\n`
  })
  return prompt
}

export const buildRiskListMarkdown = ({ filesWithRisks, baseCommit, targetCommit }) => {
  const date = new Date().toLocaleDateString('ko-KR')
  const counts = riskCounts(filesWithRisks)
  let md = '# 잠재적 리스크 파일 목록\n\n'
  md += `- **분석 일시**: ${date}\n`
  md += `- **분석 범위**: ${baseCommit?.slice(0, 8) || 'N/A'} -> ${targetCommit?.slice(0, 8) || 'HEAD'}\n`
  md += `- **리스크 감지 파일**: ${filesWithRisks.length}개\n\n`
  md += `**심각도 분포**: HIGH ${counts.high}개 | MEDIUM ${counts.medium}개 | LOW ${counts.low}개\n\n`
  md += '| # | 심각도 | 파일 경로 | 리스크 유형 | 위치 |\n'
  md += '|---|--------|-----------|------------|------|\n'
  filesWithRisks.forEach((file, idx) => {
    const riskType = file.risk.riskType.replace(/\|/g, '\\|').slice(0, 40)
    const location = file.risk.location.replace(/\|/g, '\\|').slice(0, 30)
    md += `| ${idx + 1} | ${file.risk.severity} | \`${file.path}\` | ${riskType} | ${location} |\n`
  })
  return md
}

export const downloadMarkdown = (content, filename) => {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export const buildJobProgress = (event) => {
  const progressInfo = event.progress || {}
  return {
    current: progressInfo.current ?? progressInfo.progress_current ?? 0,
    total: progressInfo.total ?? progressInfo.progress_total ?? 0,
    elapsed_seconds: progressInfo.elapsed_seconds ?? event.elapsed_seconds ?? 0,
    message: progressInfo.message || event.message || '백엔드 작업 상태를 확인하고 있습니다.',
  }
}

export const isTerminalJobStatus = (status) => ['completed', 'failed', 'cancelled', 'interrupted'].includes(status)
