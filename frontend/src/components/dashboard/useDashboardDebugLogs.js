import { useCallback, useEffect, useRef, useState } from 'react'

export function useDashboardDebugLogs(apiUrl) {
  const [debugLogs, setDebugLogs] = useState([])
  const [showDebugLog, setShowDebugLog] = useState(false)
  const [debugLogTab, setDebugLogTab] = useState('frontend')
  const [backendLogSource, setBackendLogSource] = useState('runtime')
  const [backendLogs, setBackendLogs] = useState([])
  const [backendLogSources, setBackendLogSources] = useState([])
  const [backendLogsLoading, setBackendLogsLoading] = useState(false)
  const [backendLogsError, setBackendLogsError] = useState('')
  const [backendLogAutoRefresh, setBackendLogAutoRefresh] = useState(false)
  const debugLogVisibleRef = useRef(false)

  useEffect(() => {
    debugLogVisibleRef.current = showDebugLog
  }, [showDebugLog])

  const addLog = (msg) => {
    const important = /error|failed|fail|complete|완료|실패|취소|stopped/i.test(msg)
    if (!debugLogVisibleRef.current && !important) return
    const time = new Date().toLocaleTimeString()
    setDebugLogs(prev => [`[${time}] ${msg}`, ...prev].slice(0, 50))
  }

  const fetchBackendLogs = useCallback(async () => {
    setBackendLogsLoading(true)
    setBackendLogsError('')
    try {
      const response = await fetch(`${apiUrl}/api/debug/logs?source=${encodeURIComponent(backendLogSource)}&lines=220`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      setBackendLogs(data.records || [])
      setBackendLogSources(data.available_sources || [])
    } catch (e) {
      setBackendLogsError(e.message || '백엔드 로그를 불러오지 못했습니다.')
    } finally {
      setBackendLogsLoading(false)
    }
  }, [apiUrl, backendLogSource])

  useEffect(() => {
    if (!showDebugLog || debugLogTab !== 'backend') return
    fetchBackendLogs()
    if (!backendLogAutoRefresh) return
    const timer = window.setInterval(fetchBackendLogs, 5000)
    return () => window.clearInterval(timer)
  }, [showDebugLog, debugLogTab, backendLogAutoRefresh, fetchBackendLogs])

  return {
    addLog,
    backendLogAutoRefresh,
    backendLogSource,
    backendLogSources,
    backendLogs,
    backendLogsError,
    backendLogsLoading,
    debugLogTab,
    debugLogVisibleRef,
    debugLogs,
    fetchBackendLogs,
    setBackendLogAutoRefresh,
    setBackendLogSource,
    setBackendLogSources,
    setBackendLogs,
    setBackendLogsError,
    setBackendLogsLoading,
    setDebugLogTab,
    setDebugLogs,
    setShowDebugLog,
    showDebugLog,
  }
}
