import { useState, useEffect, useRef } from 'react'
import { GitCompareArrows, Settings as SettingsIcon, Clock } from 'lucide-react'
import SettingsModal from './components/SettingsModal'
import Dashboard from './components/Dashboard'

const API_URL = import.meta.env.VITE_API_URL || '/api'

const defaultSettings = {
  id: null,
  name: 'Default',
  gitUrl: '',
  gitToken: '',
  projectId: '',
  repoName: '',
  langfuseSecretKey: '',
  langfusePublicKey: '',
  langfuseHost: 'https://cloud.langfuse.com',
  openaiApiKey: '',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiModel: 'gpt-4o-mini',
}

const fetchWithTimeout = async (url, options = {}, timeoutMs = 6000) => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      cache: options.cache || 'no-store',
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

function App() {
  const [showSettings, setShowSettings] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState('git')
  const [backendError, setBackendError] = useState(false)
  const [backendRetrying, setBackendRetrying] = useState(false)
  const [backendRetryCount, setBackendRetryCount] = useState(0)
  const [backendErrorMessage, setBackendErrorMessage] = useState('')
  const [settings, setSettings] = useState(defaultSettings)
  const [configStatus, setConfigStatus] = useState(null)
  const backendRetryTimerRef = useRef(null)

  const resetClientSession = () => {
    setSettings(defaultSettings)
    setConfigStatus(null)
  }

  const markBackendDisconnected = (message) => {
    resetClientSession()
    setBackendError(true)
    setBackendErrorMessage(message || 'API 서버가 아직 응답하지 않습니다.')
  }

  // Load active profile from backend on mount
  useEffect(() => {
    refreshSettings({ silent: true })

    return () => {
      if (backendRetryTimerRef.current) {
        clearInterval(backendRetryTimerRef.current)
        backendRetryTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!backendError) {
      if (backendRetryTimerRef.current) {
        clearInterval(backendRetryTimerRef.current)
        backendRetryTimerRef.current = null
      }
      return
    }

    if (backendRetryTimerRef.current) return
    backendRetryTimerRef.current = setInterval(() => {
      refreshSettings({ silent: true, autoRetry: true })
    }, 5000)

    return () => {
      if (backendRetryTimerRef.current) {
        clearInterval(backendRetryTimerRef.current)
        backendRetryTimerRef.current = null
      }
    }
  }, [backendError])

  const fetchConfigStatus = async () => {
    try {
      const res = await fetchWithTimeout(`${API_URL}/config/status`)
      if (res.ok) {
        const data = await res.json()
        setConfigStatus(data)
        return data
      }
      throw new Error(`config/status ${res.status}`)
    } catch (e) {
      console.error('Failed to fetch config status', e)
      throw e
    }
  }

  const fetchActiveProfile = async () => {
    try {
      const res = await fetchWithTimeout(`${API_URL}/profiles/active`)
      console.log('fetchActiveProfile response:', res.status, res.ok)
      
      if (res.ok) {
        setBackendError(false)
        setBackendRetrying(false)
        setBackendErrorMessage('')
        setBackendRetryCount(0)
        const data = await res.json()
        console.log('Active profile data:', data)
        
        if (data) {
          // Find active configurations
          const activeRepo = data.repositories?.find(r => r.is_active) || {}
          const activeLLM = data.llm_configs?.find(l => l.is_active) || {}
          const activeTracing = data.tracing_configs?.find(t => t.is_active) || {}

          setSettings({
            id: data.id,
            name: data.name,
            
            // Git Config
            repoId: activeRepo.id,
            repoName: activeRepo.name || '',
            gitUrl: activeRepo.git_url || '',
            gitToken: activeRepo.git_token || '',
            projectId: activeRepo.project_id || '',
            branch: activeRepo.branch || 'main',
            commitLimit: activeRepo.commit_limit || 100,
            
            // LLM Config
            llmConfigId: activeLLM.id,
            openaiApiKey: activeLLM.openai_api_key || '',
            openaiBaseUrl: activeLLM.openai_base_url || 'https://api.openai.com/v1',
            openaiModel: activeLLM.openai_model || 'gpt-4o-mini',
            
            // Tracing Config
            tracingConfigId: activeTracing.id,
            langfuseSecretKey: activeTracing.langfuse_secret_key || '',
            langfusePublicKey: activeTracing.langfuse_public_key || '',
            langfuseHost: activeTracing.langfuse_host || 'https://cloud.langfuse.com',
          })
        } else {
          console.log('No active profile found')
          setSettings(defaultSettings)
        }
        return true
      } else {
        const errorText = await res.text()
        console.error('Failed to fetch profile:', res.status, errorText)
        markBackendDisconnected(`profiles/active ${res.status}`)
        return false
      }
    } catch (e) {
      console.error('Failed to fetch active profile:', e)
      markBackendDisconnected(e.name === 'AbortError' ? 'API 서버 응답 시간이 초과되었습니다.' : e.message)
      return false
    }
  }

  const refreshSettings = async ({ silent = false, autoRetry = false } = {}) => {
    if (!silent) setBackendRetrying(true)
    if (autoRetry) setBackendRetryCount(count => count + 1)

    try {
      const profileOk = await fetchActiveProfile()
      if (!profileOk) return false
      await fetchConfigStatus()
      setBackendError(false)
      setBackendRetrying(false)
      return true
    } catch (e) {
      markBackendDisconnected(e.name === 'AbortError' ? 'API 서버 응답 시간이 초과되었습니다.' : e.message)
      return false
    } finally {
      if (!autoRetry) setBackendRetrying(false)
    }
  }

  const openSettings = (tab = 'git') => {
    setSettingsInitialTab(tab)
    setShowSettings(true)
  }

  const handleSaveSettings = () => {
    refreshSettings()
    setShowSettings(false)
  }

  const handleCloseSettings = () => {
    refreshSettings()
    setShowSettings(false)
  }

  const isConfigured = (settings.gitUrl && settings.gitToken && settings.projectId) || (configStatus?.configured)

  return (
    <div className="app-shell">
      {/* Backend Error Banner */}
      {backendError && (
        <div className="flex flex-col gap-3 border-b border-red-500/20 bg-red-500/10 px-6 py-3 md:flex-row md:items-center md:justify-between">
           <div className="flex min-w-0 flex-wrap items-center gap-2 text-red-300">
              <span className="text-lg">⚠️</span>
              <span className="font-medium">Backend 연결 대기 중</span>
              <span className="min-w-0 truncate text-sm opacity-75">
                - {backendErrorMessage || `Cannot connect to API server at ${API_URL}`}
              </span>
              <span className="rounded-full border border-red-400/20 px-2 py-0.5 text-xs font-bold text-red-200">
                5초마다 자동 재시도{backendRetryCount > 0 ? ` · ${backendRetryCount}회` : ''}
              </span>
           </div>
           <button 
             onClick={() => refreshSettings()}
             disabled={backendRetrying}
             className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-red-500/20 px-3 py-1 text-sm font-medium text-red-200 transition-colors hover:bg-red-500/30 disabled:opacity-60"
           >
             {backendRetrying && <Clock size={14} className="animate-spin" />}
             Retry Connection
           </button>
        </div>
      )}

      {/* Header */}
      <header className="app-header sticky top-0 z-50 px-4 md:px-6 lg:px-8 py-4">
        <div className="max-w-full xl:max-w-[1600px] 2xl:max-w-[1800px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="brand-mark" aria-hidden="true">
              <GitCompareArrows size={22} strokeWidth={2.6} />
            </div>
            <div>
              <p className="brand-kicker text-[10px] font-bold text-primary/80">Git Commit Diff</p>
              <h1 className="text-xl md:text-2xl font-bold text-stone-100 tracking-tight">
                Git Diff Lens
              </h1>
            </div>
          </div>
          <button
            onClick={() => openSettings('git')}
            className="px-4 py-2 rounded-full bg-stone-950/45 hover:bg-primary/15 text-stone-100 border border-primary/20 hover:border-primary/45 transition-all duration-200 flex items-center gap-2 shadow-lg shadow-black/20"
          >
            <SettingsIcon className="h-5 w-5" strokeWidth={2.4} />
            Settings
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-full xl:max-w-[1600px] 2xl:max-w-[1800px] mx-auto px-4 md:px-6 lg:px-8 py-6 md:py-8">
        {!isConfigured ? (
          <div className="glass hero-panel rounded-[2rem] p-8 md:p-12 text-left animate-rise-in">
            <p className="eyebrow text-xs font-bold text-primary mb-4">Git repository setup</p>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-stone-50 mb-4">Git diff를 볼 저장소를 먼저 연결해 주세요.</h2>
            <p className="text-stone-300 max-w-2xl mb-8">
              GitLab 프로젝트를 연결하면 Base와 Target 커밋의 스냅샷 차이를 파일 단위로 보고, 필요할 때 AI 분석까지 이어갈 수 있습니다.
            </p>
            <button
              onClick={() => openSettings('git')}
              className="px-6 py-3 rounded-full bg-primary text-stone-950 font-bold hover:bg-[#ffc35c] transition-all shadow-xl shadow-primary/20"
            >
              Git 설정 열기
            </button>
          </div>
        ) : (
          <Dashboard settings={settings} onOpenSettings={openSettings} onSettingsRefresh={refreshSettings} />
        )}
      </main>

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          settings={settings}
          initialTab={settingsInitialTab}
          onChanged={refreshSettings}
          onSave={handleSaveSettings}
          onClose={handleCloseSettings}
        />
      )}
    </div>
  )
}

export default App
