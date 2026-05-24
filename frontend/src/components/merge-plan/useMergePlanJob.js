import { useCallback, useRef, useState } from 'react'

const closeEventSource = (ref) => {
  if (ref.current) {
    ref.current.close()
    ref.current = null
  }
}

const buildProgress = (job) => {
  const progress = job?.progress || {}
  return {
    status: job?.status || 'running',
    phase: progress.phase || job?.phase || 'merge_plan_prepare',
    message: progress.message || job?.message || '통합 머지 플랜 작업 상태를 확인하고 있습니다.',
    current: progress.current ?? 0,
    total: progress.total ?? 0,
    candidateId: progress.candidate_id || null,
    elapsedSeconds: progress.elapsed_seconds || 0,
  }
}

export const useMergePlanJob = ({ apiUrl, notifyJobComplete, showJobNotice }) => {
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [activeJob, setActiveJob] = useState(null)
  const eventSourceRef = useRef(null)
  const progressTimerRef = useRef(null)

  const stopProgressTimer = useCallback(() => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current)
      progressTimerRef.current = null
    }
  }, [])

  const startProgressTimer = useCallback(() => {
    stopProgressTimer()
    const startedAt = Date.now()
    progressTimerRef.current = setInterval(() => {
      setProgress(prev => {
        if (!prev || prev.status !== 'running') return prev
        return {
          ...prev,
          elapsedSeconds: (Date.now() - (prev.startedAt || startedAt)) / 1000,
          startedAt: prev.startedAt || startedAt,
        }
      })
    }, 500)
  }, [stopProgressTimer])

  const applyCompletion = useCallback((job) => {
    closeEventSource(eventSourceRef)
    stopProgressTimer()
    setLoading(false)
    setActiveJob(job)
    setResult(job.result || null)
    setProgress(prev => ({
      ...(prev || {}),
      status: 'completed',
      phase: 'merge_plan_done',
      message: job.cache_hit || job.result?.cache_hit ? '캐시된 통합 머지 플랜 결과를 불러왔습니다.' : '통합 머지 플랜 결과가 준비되었습니다.',
      current: prev?.total || 5,
      total: prev?.total || 5,
    }))
    notifyJobComplete?.(
      '통합 머지 플랜 완료',
      job.result?.status === 'conflicts' ? '충돌 후보가 발견되었습니다.' : 'dry-run 결과가 준비되었습니다.'
    )
  }, [notifyJobComplete, stopProgressTimer])

  const handleFailure = useCallback((job, fallbackMessage) => {
    closeEventSource(eventSourceRef)
    stopProgressTimer()
    setLoading(false)
    setActiveJob(job || null)
    const message = job?.error?.message || job?.message || fallbackMessage || '통합 머지 플랜 작업이 실패했습니다.'
    setError(message)
    setProgress(prev => ({
      ...(prev || {}),
      status: 'failed',
      phase: job?.phase || prev?.phase || 'failed',
      message,
    }))
    showJobNotice?.(message, 'error')
  }, [showJobNotice, stopProgressTimer])

  const attachJob = useCallback((jobId) => {
    if (!jobId) return
    closeEventSource(eventSourceRef)
    const source = new EventSource(`${apiUrl}/api/jobs/${jobId}/events`)
    eventSourceRef.current = source
    source.onmessage = (event) => {
      try {
        const job = JSON.parse(event.data)
        setActiveJob(job)
        if (job.status === 'completed' && job.result) {
          applyCompletion(job)
          return
        }
        if (['failed', 'cancelled', 'interrupted'].includes(job.status)) {
          handleFailure(job)
          return
        }
        setProgress(prev => ({
          ...(prev || {}),
          ...buildProgress(job),
          status: 'running',
          startedAt: prev?.startedAt || Date.now(),
        }))
      } catch (err) {
        console.warn('Merge plan job event parse failed:', err)
      }
    }
    source.onerror = () => {
      source.close()
      eventSourceRef.current = null
    }
  }, [apiUrl, applyCompletion, handleFailure])

  const startMergePlan = useCallback(async (payload) => {
    setLoading(true)
    setResult(null)
    setError(null)
    setProgress({
      status: 'running',
      phase: 'merge_plan_prepare',
      message: '통합 머지 플랜 작업을 시작합니다.',
      current: 0,
      total: 5,
      startedAt: Date.now(),
      elapsedSeconds: 0,
    })
    startProgressTimer()

    try {
      const response = await fetch(`${apiUrl}/api/jobs/merge-plan-v1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || data.message || '통합 머지 플랜 작업 시작 실패')
      if (data.status === 'completed' && data.result) {
        applyCompletion(data)
        return data.result
      }
      if (!data.job_id) throw new Error('Job id가 없는 응답입니다.')
      setActiveJob(data)
      setProgress(prev => ({
        ...(prev || {}),
        ...buildProgress(data),
        status: 'running',
        startedAt: prev?.startedAt || Date.now(),
      }))
      attachJob(data.job_id)
      return null
    } catch (err) {
      handleFailure(null, err.message)
      return null
    }
  }, [apiUrl, applyCompletion, attachJob, handleFailure, startProgressTimer])

  const cancel = useCallback(async () => {
    const jobId = activeJob?.job_id
    if (jobId) {
      await fetch(`${apiUrl}/api/jobs/${jobId}/cancel`, { method: 'POST' }).catch(() => {})
    }
    closeEventSource(eventSourceRef)
    stopProgressTimer()
    setLoading(false)
    setProgress(prev => prev ? { ...prev, status: 'cancelled', message: '사용자가 작업 취소를 요청했습니다.' } : prev)
  }, [activeJob?.job_id, apiUrl, stopProgressTimer])

  return {
    loading,
    progress,
    result,
    error,
    activeJob,
    startMergePlan,
    cancel,
  }
}
