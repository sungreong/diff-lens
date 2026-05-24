const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const formatJobDuration = (startedAt) => {
  if (!startedAt) return ''
  const seconds = Math.max(0, Math.round(Date.now() / 1000 - startedAt))
  if (seconds < 60) return `${seconds}초`
  return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`
}

export async function runBackgroundJob(endpoint, body, onProgress) {
  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`HTTP ${response.status}: ${errText}`)
  }

  const started = await response.json()
  if (started.status === 'completed') {
    onProgress?.({
      message: started.cache_hit ? '캐시 결과를 불러왔습니다.' : '작업이 완료되었습니다.',
      percent: 100,
      cacheHit: started.cache_hit,
      cacheKey: started.cache_key,
      hits: started.result?.cache_hits,
    })
    return started.result
  }
  if (!started.job_id) throw new Error('Job id가 없는 응답입니다.')

  let currentJob = started
  while (true) {
    const progress = currentJob.progress || {}
    onProgress?.({
      message: progress.message || currentJob.message || '백그라운드 작업 진행 중...',
      percent: progress.percent || 0,
      current: progress.current,
      total: progress.total,
      jobId: currentJob.job_id,
      phase: progress.phase || currentJob.phase,
      elapsed: formatJobDuration(currentJob.started_at || currentJob.created_at),
      cacheKey: currentJob.cache_key,
    })
    if (currentJob.status === 'completed') return currentJob.result
    if (['failed', 'cancelled', 'interrupted'].includes(currentJob.status)) {
      throw new Error(currentJob.error?.message || currentJob.message || '작업이 중단되었습니다.')
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
    const statusRes = await fetch(`${API_URL}/api/jobs/${currentJob.job_id}`)
    if (!statusRes.ok) throw new Error('작업 상태를 확인하지 못했습니다.')
    currentJob = await statusRes.json()
  }
}

/**
 * EXPORT 추가 분석 모달 컴포넌트
 * 
 * 기능:
 * 1. 파일별 분석: KEY/VALUE 스키마로 정보 추출 → Excel 다운로드
 * 2. 요약: 배치 점진적 요약 (Map-Reduce) → JSON 다운로드
 */
