import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildJobProgress,
  buildLocalReviewPrompt,
  buildRiskFilesPayload,
  buildRiskListMarkdown,
  buildRiskReviewStorageKey,
  downloadMarkdown,
  isTerminalJobStatus,
  riskReviewChecklist,
} from './riskReviewUtils'

const emptyProgress = null

const closeEventSource = (ref) => {
  if (ref.current) {
    ref.current.close()
    ref.current = null
  }
}

const cacheInfoFromResult = (data, result) => {
  const cacheKey = result?.cache_key || data?.cache_key
  if (!cacheKey && !data?.cache_hit && !result?.cache_hit) return null
  return {
    cacheKey,
    hits: result?.cache_hits ?? null,
    waited: Boolean(result?.cache_waited),
    hit: Boolean(data?.cache_hit || result?.cache_hit),
  }
}

export const useRiskReviewJobs = ({
  apiUrl,
  filesWithRisks,
  baseCommit,
  targetCommit,
  settings,
  showJobNotice,
  notifyJobComplete,
}) => {
  const [riskReviewModalOpen, setRiskReviewModalOpen] = useState(false)
  const [generatedPrompt, setGeneratedPrompt] = useState('')
  const [riskPromptCacheInfo, setRiskPromptCacheInfo] = useState(null)
  const [reviewRunResult, setReviewRunResult] = useState('')
  const [reviewRunCacheInfo, setReviewRunCacheInfo] = useState(null)
  const [promptStyle, setPromptStyle] = useState('balanced')
  const [loadingRiskPrompt, setLoadingRiskPrompt] = useState(false)
  const [riskPromptProgress, setRiskPromptProgress] = useState(emptyProgress)
  const [activeRiskPromptJob, setActiveRiskPromptJob] = useState(null)
  const [loadingReviewRun, setLoadingReviewRun] = useState(false)
  const [reviewRunProgress, setReviewRunProgress] = useState(emptyProgress)
  const [activeReviewRunJob, setActiveReviewRunJob] = useState(null)
  const [hydratedStorageKey, setHydratedStorageKey] = useState('')

  const riskPromptJobEventSourceRef = useRef(null)
  const reviewRunJobEventSourceRef = useRef(null)
  const riskPromptAbortController = useRef(null)
  const reviewRunAbortController = useRef(null)
  const riskPromptProgressIntervalRef = useRef(null)
  const reviewRunProgressIntervalRef = useRef(null)
  const riskPromptProgressTimersRef = useRef([])
  const restoredStorageKeyRef = useRef('')

  const storageKey = useMemo(
    () => buildRiskReviewStorageKey({ filesWithRisks, baseCommit, targetCommit }),
    [filesWithRisks, baseCommit, targetCommit]
  )

  const clearRiskPromptProgressTimers = useCallback(() => {
    if (riskPromptProgressIntervalRef.current) {
      clearInterval(riskPromptProgressIntervalRef.current)
      riskPromptProgressIntervalRef.current = null
    }
    riskPromptProgressTimersRef.current.forEach(timer => clearTimeout(timer))
    riskPromptProgressTimersRef.current = []
  }, [])

  const clearReviewRunProgressTimer = useCallback(() => {
    if (reviewRunProgressIntervalRef.current) {
      clearInterval(reviewRunProgressIntervalRef.current)
      reviewRunProgressIntervalRef.current = null
    }
  }, [])

  const startReviewRunProgressTimer = useCallback(() => {
    clearReviewRunProgressTimer()
    reviewRunProgressIntervalRef.current = setInterval(() => {
      setReviewRunProgress(prev => {
        if (!prev || prev.status !== 'running') return prev
        const startedAt = prev.startedAt || Date.now()
        return {
          ...prev,
          elapsedSeconds: (Date.now() - startedAt) / 1000,
        }
      })
    }, 500)
  }, [clearReviewRunProgressTimer])

  const startRiskPromptProgress = useCallback(() => {
    clearRiskPromptProgressTimers()
    const startedAt = Date.now()
    const totalFiles = filesWithRisks.length

    setRiskPromptProgress({
      status: 'running',
      stage: 'collecting',
      current: totalFiles > 0 ? 1 : 0,
      total: totalFiles,
      startedAt,
      elapsedSeconds: 0,
      message: '리스크 파일 목록을 정리하고 있습니다.',
    })

    riskPromptProgressIntervalRef.current = setInterval(() => {
      setRiskPromptProgress(prev => {
        if (!prev || prev.status !== 'running') return prev
        return {
          ...prev,
          elapsedSeconds: (Date.now() - prev.startedAt) / 1000,
        }
      })
    }, 500)

    const schedule = [
      { delay: 700, stage: 'diffs', ratio: 0.35, message: '파일별 diff와 리스크 위치를 프롬프트 근거로 묶고 있습니다.' },
      { delay: 1800, stage: 'requesting', ratio: 0.7, message: '검토자가 바로 읽을 수 있는 질문과 체크리스트를 만들고 있습니다.' },
      { delay: 4200, stage: 'finalizing', ratio: 0.9, message: '생성 결과를 문서 형태로 정리하고 있습니다.' },
    ]

    riskPromptProgressTimersRef.current = schedule.map(step => setTimeout(() => {
      setRiskPromptProgress(prev => {
        if (!prev || prev.status !== 'running') return prev
        const nextCurrent = totalFiles > 0
          ? Math.max(prev.current, Math.min(totalFiles, Math.ceil(totalFiles * step.ratio)))
          : 0
        return {
          ...prev,
          stage: step.stage,
          current: nextCurrent,
          message: step.message,
          elapsedSeconds: (Date.now() - prev.startedAt) / 1000,
        }
      })
    }, step.delay))
  }, [clearRiskPromptProgressTimers, filesWithRisks.length])

  const finishRiskPromptProgress = useCallback((status, message) => {
    clearRiskPromptProgressTimers()
    setRiskPromptProgress(prev => {
      if (!prev) return prev
      return {
        ...prev,
        status,
        stage: status === 'done' ? 'finalizing' : prev.stage,
        current: status === 'done' ? prev.total : prev.current,
        elapsedSeconds: (Date.now() - prev.startedAt) / 1000,
        message,
      }
    })
  }, [clearRiskPromptProgressTimers])

  const applyRiskPromptCompletion = useCallback((data) => {
    const result = data?.result || {}
    if (result.generated_prompt) {
      setGeneratedPrompt(result.generated_prompt)
      setRiskPromptCacheInfo(cacheInfoFromResult(data, result))
    }
    setLoadingRiskPrompt(false)
    closeEventSource(riskPromptJobEventSourceRef)
    setActiveRiskPromptJob(data)
    finishRiskPromptProgress(
      'done',
      result.cache_hit || data?.cache_hit
        ? '캐시된 검토 요청 프롬프트를 불러왔습니다.'
        : '검토 요청 프롬프트가 준비되었습니다.'
    )
    notifyJobComplete?.(
      'AI 검토 요청 준비 완료',
      result.cache_hit || data?.cache_hit ? '캐시된 프롬프트를 바로 불러왔습니다.' : '검토 요청 프롬프트가 준비되었습니다.'
    )
  }, [finishRiskPromptProgress, notifyJobComplete])

  const applyReviewRunCompletion = useCallback((data) => {
    const result = data?.result || {}
    closeEventSource(reviewRunJobEventSourceRef)
    clearReviewRunProgressTimer()
    setLoadingReviewRun(false)
    setActiveReviewRunJob(data)
    setReviewRunResult(result.review_result || '')
    setReviewRunCacheInfo(cacheInfoFromResult(data, result) || {
      cacheKey: result.cache_key || data?.cache_key,
      hits: null,
      waited: false,
      hit: false,
    })
    setReviewRunProgress(prev => ({
      ...(prev || {}),
      status: 'done',
      stage: 'review_done',
      current: prev?.total || 3,
      total: prev?.total || 3,
      elapsedSeconds: prev?.startedAt ? (Date.now() - prev.startedAt) / 1000 : prev?.elapsedSeconds || 0,
      message: result.cache_hit || data?.cache_hit ? '캐시된 AI 검토 결과를 불러왔습니다.' : 'AI 검토 결과가 준비되었습니다.',
    }))
    notifyJobComplete?.(
      'AI 검토 완료',
      result.cache_hit || data?.cache_hit ? '캐시된 검토 결과를 불러왔습니다.' : '검토 결과가 준비되었습니다.'
    )
  }, [clearReviewRunProgressTimer, notifyJobComplete])

  const handleRiskPromptJobFailure = useCallback((data) => {
    closeEventSource(riskPromptJobEventSourceRef)
    setLoadingRiskPrompt(false)
    setActiveRiskPromptJob(data)
    const message = data?.error?.message || data?.message || '프롬프트 생성 작업이 중단되었습니다.'
    setGeneratedPrompt(buildLocalReviewPrompt({ filesWithRisks, baseCommit, targetCommit }))
    finishRiskPromptProgress('done', `${message} 로컬 템플릿으로 대신 만들었습니다.`)
  }, [baseCommit, filesWithRisks, finishRiskPromptProgress, targetCommit])

  const handleReviewRunFailure = useCallback((data) => {
    closeEventSource(reviewRunJobEventSourceRef)
    clearReviewRunProgressTimer()
    setLoadingReviewRun(false)
    setActiveReviewRunJob(data)
    const message = data?.error?.message || data?.message || 'AI 검토 실행 작업이 중단되었습니다.'
    setReviewRunResult(`AI 검토 실행 실패\n\n${message}`)
    setReviewRunProgress(prev => prev ? {
      ...prev,
      status: data?.status || 'failed',
      message,
    } : {
      status: data?.status || 'failed',
      message,
      elapsedSeconds: 0,
      current: 0,
      total: 3,
    })
  }, [clearReviewRunProgressTimer])

  const attachRiskPromptJob = useCallback((jobId) => {
    if (!jobId) return
    closeEventSource(riskPromptJobEventSourceRef)
    const source = new EventSource(`${apiUrl}/api/jobs/${jobId}/events`)
    riskPromptJobEventSourceRef.current = source
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        setActiveRiskPromptJob(data)
        const jobProgress = buildJobProgress(data)
        setRiskPromptProgress(prev => ({
          ...(prev || {
            status: 'running',
            startedAt: Date.now(),
            total: filesWithRisks.length,
          }),
          status: data.status === 'completed' ? 'done' : 'running',
          stage: data.progress?.phase || prev?.stage || 'requesting',
          current: jobProgress.current || prev?.current || 0,
          total: jobProgress.total || prev?.total || filesWithRisks.length,
          elapsedSeconds: jobProgress.elapsed_seconds || prev?.elapsedSeconds || 0,
          message: jobProgress.message,
          cacheKey: data.cache_key,
        }))
        if (data.status === 'completed') applyRiskPromptCompletion(data)
        else if (['failed', 'cancelled', 'interrupted'].includes(data.status)) handleRiskPromptJobFailure(data)
      } catch (error) {
        console.warn('Risk prompt job event parse failed:', error)
      }
    }
    source.onerror = () => {
      setRiskPromptProgress(prev => prev ? {
        ...prev,
        message: '백엔드 작업은 계속 진행 중입니다. 상태 연결을 다시 확인하고 있습니다.',
      } : prev)
    }
  }, [apiUrl, applyRiskPromptCompletion, filesWithRisks.length, handleRiskPromptJobFailure])

  const attachReviewRunJob = useCallback((jobId) => {
    if (!jobId) return
    closeEventSource(reviewRunJobEventSourceRef)
    const source = new EventSource(`${apiUrl}/api/jobs/${jobId}/events`)
    reviewRunJobEventSourceRef.current = source
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        setActiveReviewRunJob(data)
        const jobProgress = buildJobProgress(data)
        setReviewRunProgress(prev => ({
          ...(prev || {
            status: 'running',
            startedAt: Date.now(),
            total: 3,
          }),
          status: data.status === 'completed' ? 'done' : data.status,
          stage: data.progress?.phase || prev?.stage || 'review_llm',
          current: jobProgress.current || prev?.current || 0,
          total: jobProgress.total || prev?.total || 3,
          elapsedSeconds: jobProgress.elapsed_seconds || prev?.elapsedSeconds || 0,
          message: jobProgress.message,
          cacheKey: data.cache_key,
          model: data.progress?.model || prev?.model,
        }))
        if (data.status === 'completed') applyReviewRunCompletion(data)
        else if (['failed', 'cancelled', 'interrupted'].includes(data.status)) handleReviewRunFailure(data)
      } catch (error) {
        console.warn('Risk review run job event parse failed:', error)
      }
    }
    source.onerror = () => {
      setReviewRunProgress(prev => prev ? {
        ...prev,
        message: 'AI 검토 작업은 백엔드에서 계속 진행 중입니다. 상태 연결을 다시 확인하고 있습니다.',
      } : prev)
    }
  }, [apiUrl, applyReviewRunCompletion, handleReviewRunFailure])

  const restoreJobSnapshot = useCallback(async (jobId, kind) => {
    if (!jobId) return
    try {
      const response = await fetch(`${apiUrl}/api/jobs/${jobId}`)
      if (!response.ok) return
      const data = await response.json()
      if (kind === 'prompt') {
        setActiveRiskPromptJob(data)
        if (data.status === 'completed') applyRiskPromptCompletion(data)
        else if (['queued', 'running'].includes(data.status)) attachRiskPromptJob(jobId)
        else if (isTerminalJobStatus(data.status)) handleRiskPromptJobFailure(data)
      } else {
        setActiveReviewRunJob(data)
        if (data.status === 'completed') applyReviewRunCompletion(data)
        else if (['queued', 'running'].includes(data.status)) attachReviewRunJob(jobId)
        else if (isTerminalJobStatus(data.status)) handleReviewRunFailure(data)
      }
    } catch (error) {
      console.warn('Risk review job restore failed:', error)
    }
  }, [
    apiUrl,
    applyReviewRunCompletion,
    applyRiskPromptCompletion,
    attachReviewRunJob,
    attachRiskPromptJob,
    handleReviewRunFailure,
    handleRiskPromptJobFailure,
  ])

  useEffect(() => {
    if (!storageKey || restoredStorageKeyRef.current === storageKey) return
    restoredStorageKeyRef.current = storageKey
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null')
      if (!saved) return
      setGeneratedPrompt(saved.generatedPrompt || '')
      setRiskPromptCacheInfo(saved.riskPromptCacheInfo || null)
      setReviewRunResult(saved.reviewRunResult || '')
      setReviewRunCacheInfo(saved.reviewRunCacheInfo || null)
      setPromptStyle(saved.promptStyle || 'balanced')
      setRiskPromptProgress(saved.riskPromptProgress || null)
      setReviewRunProgress(saved.reviewRunProgress || null)
      setActiveRiskPromptJob(saved.activeRiskPromptJob || null)
      setActiveReviewRunJob(saved.activeReviewRunJob || null)
      if (['queued', 'running'].includes(saved.activeRiskPromptJob?.status)) {
        setLoadingRiskPrompt(true)
        restoreJobSnapshot(saved.activeRiskPromptJob.job_id, 'prompt')
      }
      if (['queued', 'running'].includes(saved.activeReviewRunJob?.status)) {
        setLoadingReviewRun(true)
        startReviewRunProgressTimer()
        restoreJobSnapshot(saved.activeReviewRunJob.job_id, 'review')
      }
    } catch (error) {
      console.warn('Risk review state restore failed:', error)
    } finally {
      setHydratedStorageKey(storageKey)
    }
  }, [restoreJobSnapshot, startReviewRunProgressTimer, storageKey])

  useEffect(() => {
    if (!storageKey) return
    if (hydratedStorageKey !== storageKey) return
    const payload = {
      generatedPrompt,
      riskPromptCacheInfo,
      reviewRunResult,
      reviewRunCacheInfo,
      promptStyle,
      riskPromptProgress,
      reviewRunProgress,
      activeRiskPromptJob,
      activeReviewRunJob,
      savedAt: Date.now(),
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(payload))
    } catch (error) {
      console.warn('Risk review state persist failed:', error)
    }
  }, [
    activeReviewRunJob,
    activeRiskPromptJob,
    generatedPrompt,
    promptStyle,
    reviewRunCacheInfo,
    reviewRunProgress,
    reviewRunResult,
    riskPromptCacheInfo,
    riskPromptProgress,
    hydratedStorageKey,
    storageKey,
  ])

  useEffect(() => {
    return () => {
      closeEventSource(riskPromptJobEventSourceRef)
      closeEventSource(reviewRunJobEventSourceRef)
      clearRiskPromptProgressTimers()
      clearReviewRunProgressTimer()
      riskPromptAbortController.current?.abort()
      reviewRunAbortController.current?.abort()
    }
  }, [clearReviewRunProgressTimer, clearRiskPromptProgressTimers])

  const openRiskReviewModal = useCallback(() => {
    setRiskReviewModalOpen(true)
    if (['queued', 'running'].includes(activeRiskPromptJob?.status) && !riskPromptJobEventSourceRef.current) {
      restoreJobSnapshot(activeRiskPromptJob.job_id, 'prompt')
    }
    if (['queued', 'running'].includes(activeReviewRunJob?.status) && !reviewRunJobEventSourceRef.current) {
      restoreJobSnapshot(activeReviewRunJob.job_id, 'review')
    }
  }, [activeReviewRunJob, activeRiskPromptJob, restoreJobSnapshot])

  const closeRiskReviewModal = useCallback(() => {
    setRiskReviewModalOpen(false)
  }, [])

  const resetRiskReview = useCallback(() => {
    setGeneratedPrompt('')
    setRiskPromptCacheInfo(null)
    setReviewRunResult('')
    setReviewRunCacheInfo(null)
    setRiskPromptProgress(null)
    setReviewRunProgress(null)
    setActiveRiskPromptJob(null)
    setActiveReviewRunJob(null)
    setLoadingRiskPrompt(false)
    setLoadingReviewRun(false)
    closeEventSource(riskPromptJobEventSourceRef)
    closeEventSource(reviewRunJobEventSourceRef)
    clearRiskPromptProgressTimers()
    clearReviewRunProgressTimer()
  }, [clearReviewRunProgressTimer, clearRiskPromptProgressTimers])

  const triggerRiskPromptGeneration = useCallback(async () => {
    setLoadingRiskPrompt(true)
    setRiskPromptCacheInfo(null)
    setReviewRunResult('')
    setReviewRunCacheInfo(null)
    setReviewRunProgress(null)
    startRiskPromptProgress()
    let jobStarted = false
    riskPromptAbortController.current = new AbortController()

    try {
      const requestBody = {
        files: buildRiskFilesPayload(filesWithRisks),
        base_commit: baseCommit || '',
        target_commit: targetCommit || '',
        checklist: riskReviewChecklist,
        style: promptStyle,
        openai_api_key: settings.openaiApiKey || null,
        openai_base_url: settings.openaiBaseUrl || null,
        openai_model: settings.openaiModel || null,
        langfuse_public_key: settings.langfusePublicKey || null,
        langfuse_secret_key: settings.langfuseSecretKey || null,
        langfuse_host: settings.langfuseHost || null,
      }

      const response = await fetch(`${apiUrl}/api/jobs/risk-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: riskPromptAbortController.current.signal,
      })

      if (!response.ok) {
        throw new Error(await response.text())
      }

      const data = await response.json()
      if (data.status === 'completed' && data.result) {
        applyRiskPromptCompletion(data)
      } else if (data.job_id) {
        jobStarted = true
        setActiveRiskPromptJob(data)
        setRiskPromptCacheInfo({
          cacheKey: data.cache_key,
          hits: null,
          waited: false,
          hit: Boolean(data.cache_hit),
        })
        attachRiskPromptJob(data.job_id)
      } else {
        throw new Error('Job id가 없는 응답입니다.')
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        finishRiskPromptProgress('cancelled', '요청이 취소되었습니다.')
        return
      }
      console.error('Risk prompt generation failed:', error)
      setGeneratedPrompt(buildLocalReviewPrompt({ filesWithRisks, baseCommit, targetCommit }))
      finishRiskPromptProgress('done', '서버 응답 실패로 로컬에서 프롬프트를 만들었습니다.')
    } finally {
      if (!jobStarted) setLoadingRiskPrompt(false)
      riskPromptAbortController.current = null
    }
  }, [
    apiUrl,
    applyRiskPromptCompletion,
    attachRiskPromptJob,
    baseCommit,
    filesWithRisks,
    finishRiskPromptProgress,
    promptStyle,
    settings,
    startRiskPromptProgress,
    targetCommit,
  ])

  const triggerRiskReviewExecution = useCallback(async () => {
    if (!generatedPrompt.trim()) {
      setReviewRunResult('실행할 검토 요청 프롬프트가 없습니다.')
      return
    }

    setLoadingReviewRun(true)
    setReviewRunResult('')
    setReviewRunCacheInfo(null)
    setReviewRunProgress({
      status: 'running',
      stage: 'review_prepare',
      current: 0,
      total: 3,
      startedAt: Date.now(),
      elapsedSeconds: 0,
      message: '검토 프롬프트를 AI 실행 작업으로 등록하고 있습니다.',
    })
    startReviewRunProgressTimer()
    let jobStarted = false
    reviewRunAbortController.current = new AbortController()

    try {
      const requestBody = {
        prompt: generatedPrompt,
        files: buildRiskFilesPayload(filesWithRisks),
        base_commit: baseCommit || '',
        target_commit: targetCommit || '',
        style: promptStyle,
        openai_api_key: settings.openaiApiKey || null,
        openai_base_url: settings.openaiBaseUrl || null,
        openai_model: settings.openaiModel || null,
        langfuse_public_key: settings.langfusePublicKey || null,
        langfuse_secret_key: settings.langfuseSecretKey || null,
        langfuse_host: settings.langfuseHost || null,
      }

      const response = await fetch(`${apiUrl}/api/jobs/risk-review-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: reviewRunAbortController.current.signal,
      })

      if (!response.ok) {
        throw new Error(await response.text())
      }

      const data = await response.json()
      if (data.status === 'completed' && data.result) {
        applyReviewRunCompletion(data)
      } else if (data.job_id) {
        jobStarted = true
        setActiveReviewRunJob(data)
        setReviewRunCacheInfo({
          cacheKey: data.cache_key,
          hits: null,
          waited: false,
          hit: Boolean(data.cache_hit),
        })
        attachReviewRunJob(data.job_id)
      } else {
        throw new Error('Job id가 없는 응답입니다.')
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        clearReviewRunProgressTimer()
        setReviewRunProgress(prev => prev ? { ...prev, status: 'cancelled', message: '요청이 취소되었습니다.' } : prev)
        return
      }
      console.error('Risk review execution failed:', error)
      clearReviewRunProgressTimer()
      const message = error.message || 'AI 검토 실행 요청이 실패했습니다.'
      setReviewRunResult(`AI 검토 실행 실패\n\n${message}`)
      setReviewRunProgress(prev => prev ? { ...prev, status: 'failed', message } : prev)
    } finally {
      if (!jobStarted) setLoadingReviewRun(false)
      reviewRunAbortController.current = null
    }
  }, [
    apiUrl,
    applyReviewRunCompletion,
    attachReviewRunJob,
    baseCommit,
    clearReviewRunProgressTimer,
    filesWithRisks,
    generatedPrompt,
    promptStyle,
    settings,
    startReviewRunProgressTimer,
    targetCommit,
  ])

  const cancelRiskPromptJob = useCallback(async () => {
    riskPromptAbortController.current?.abort()
    const jobId = activeRiskPromptJob?.job_id
    if (jobId) {
      await fetch(`${apiUrl}/api/jobs/${jobId}/cancel`, { method: 'POST' }).catch(() => {})
    }
    closeEventSource(riskPromptJobEventSourceRef)
    setLoadingRiskPrompt(false)
    finishRiskPromptProgress('cancelled', '프롬프트 생성 작업을 취소했습니다.')
  }, [activeRiskPromptJob?.job_id, apiUrl, finishRiskPromptProgress])

  const cancelReviewRunJob = useCallback(async () => {
    reviewRunAbortController.current?.abort()
    const jobId = activeReviewRunJob?.job_id
    if (jobId) {
      await fetch(`${apiUrl}/api/jobs/${jobId}/cancel`, { method: 'POST' }).catch(() => {})
    }
    closeEventSource(reviewRunJobEventSourceRef)
    clearReviewRunProgressTimer()
    setLoadingReviewRun(false)
    setReviewRunProgress(prev => prev ? { ...prev, status: 'cancelled', message: 'AI 검토 실행을 취소했습니다.' } : prev)
  }, [activeReviewRunJob?.job_id, apiUrl, clearReviewRunProgressTimer])

  const copyPromptToClipboard = useCallback(() => {
    if (!generatedPrompt) return
    navigator.clipboard.writeText(generatedPrompt)
      .then(() => showJobNotice?.('AI 검토 요청 프롬프트가 클립보드에 복사되었습니다.', 'success'))
      .catch(() => showJobNotice?.('클립보드 복사 권한이 없어 복사하지 못했습니다.', 'error'))
  }, [generatedPrompt, showJobNotice])

  const downloadRiskReviewPrompt = useCallback(() => {
    if (!generatedPrompt) return
    downloadMarkdown(generatedPrompt, `risk-review-request-${baseCommit?.slice(0, 8) || 'latest'}.md`)
  }, [baseCommit, generatedPrompt])

  const copyRiskListAsMarkdown = useCallback(() => {
    const md = buildRiskListMarkdown({ filesWithRisks, baseCommit, targetCommit })
    navigator.clipboard.writeText(md)
      .then(() => showJobNotice?.('리스크 파일 목록이 마크다운 테이블로 복사되었습니다.', 'success'))
      .catch(() => showJobNotice?.('클립보드 복사 권한이 없어 목록을 복사하지 못했습니다.', 'error'))
  }, [baseCommit, filesWithRisks, showJobNotice, targetCommit])

  const copyReviewRunResultToClipboard = useCallback(() => {
    if (!reviewRunResult) return
    navigator.clipboard.writeText(reviewRunResult)
      .then(() => showJobNotice?.('AI 검토 결과가 클립보드에 복사되었습니다.', 'success'))
      .catch(() => showJobNotice?.('클립보드 복사 권한이 없어 결과를 복사하지 못했습니다.', 'error'))
  }, [reviewRunResult, showJobNotice])

  const downloadReviewRunResult = useCallback(() => {
    if (!reviewRunResult) return
    downloadMarkdown(reviewRunResult, `risk-review-result-${baseCommit?.slice(0, 8) || 'latest'}.md`)
  }, [baseCommit, reviewRunResult])

  const status = useMemo(() => {
    if (loadingReviewRun || reviewRunProgress?.status === 'running') return 'review_running'
    if (reviewRunResult && reviewRunProgress?.status === 'done') return 'review_done'
    if (loadingRiskPrompt || riskPromptProgress?.status === 'running') return 'prompt_running'
    if (generatedPrompt) return 'prompt_ready'
    return 'ready'
  }, [generatedPrompt, loadingReviewRun, loadingRiskPrompt, reviewRunProgress?.status, reviewRunResult, riskPromptProgress?.status])

  const hasCacheHit = Boolean(riskPromptCacheInfo?.hit || riskPromptCacheInfo?.hits || reviewRunCacheInfo?.hit || reviewRunCacheInfo?.hits)

  return {
    state: {
      riskReviewModalOpen,
      generatedPrompt,
      riskPromptCacheInfo,
      reviewRunResult,
      reviewRunCacheInfo,
      promptStyle,
      loadingRiskPrompt,
      riskPromptProgress,
      activeRiskPromptJob,
      loadingReviewRun,
      reviewRunProgress,
      activeReviewRunJob,
      status,
      hasCacheHit,
    },
    actions: {
      setPromptStyle,
      setGeneratedPrompt,
      openRiskReviewModal,
      closeRiskReviewModal,
      resetRiskReview,
      triggerRiskPromptGeneration,
      triggerRiskReviewExecution,
      cancelRiskPromptJob,
      cancelReviewRunJob,
      copyPromptToClipboard,
      downloadRiskReviewPrompt,
      copyRiskListAsMarkdown,
      copyReviewRunResultToClipboard,
      downloadReviewRunResult,
    },
  }
}
