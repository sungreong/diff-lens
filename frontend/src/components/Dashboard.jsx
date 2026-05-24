import { Fragment, Suspense, lazy, useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Eye, Code, X, FileText, BarChart3, Clock, User, ChevronRight, ChevronUp, ChevronDown, BookOpen, Folder, FolderOpen, Search, Upload, Download, GitCompareArrows, ShieldCheck, GitBranch, Sparkles, Star, GitMerge, AlertTriangle } from 'lucide-react'
import { aiSummaryPreviewText } from './aiMarkdownUtils'
import { useRiskReviewJobs } from './risk-review/useRiskReviewJobs'
import { extractRiskFromAiSummary, riskSeverityRank } from './risk-review/riskReviewUtils'
import RefPicker, { DarkOptionMenu } from './ref-picker/RefPicker'
import { DashboardProvider } from './dashboard/DashboardContext'
import DashboardNotice from './dashboard/DashboardNotice'
import DashboardControlPanel from './dashboard/DashboardControlPanel'
import DashboardProgressPanels from './dashboard/DashboardProgressPanels'
import DashboardOverlays from './dashboard/DashboardOverlays'
import { createDashboardPrimaryActions } from './dashboard/dashboardPrimaryActions'
import { createDashboardAnalysisActions } from './dashboard/dashboardAnalysisActions'
import { useDashboardRefOptions } from './dashboard/useDashboardRefOptions'
import { useGitReportMetrics } from './dashboard/useGitReportMetrics'
import { useDashboardFileFilters } from './dashboard/useDashboardFileFilters'
import { useDashboardDebugLogs } from './dashboard/useDashboardDebugLogs'
import { createDashboardHistoryActions } from './dashboard/dashboardHistoryActions'
import { downloadXlsx } from '../utils/xlsxExport'
import {
  FileTreeNode,
  analysisModeDetails,
  analysisModeOptions,
  analysisSortOptions,
  buildCommitRefOptions,
  buildFileTree,
  buildMergeCheckContext,
  compareStrategyOptions,
  comparisonPurposeOptions,
  formatDate,
  formatDuration,
  formatRelatedCommits,
  getAnalysisLimitLabel,
  getAnalysisSortOption,
  getAnalysisStatusLabel,
  getChangeSizeClass,
  getChangeSizeLabel,
  getCommitAuthor,
  getCommitDateValue,
  getCommitKey,
  getCommitShort,
  getCommitTime,
  getCommitTitle,
  getDateRangeOptions,
  getDirectoryPath,
  getFileName,
  getFileStatusClass,
  getFileStatusLabel,
  getHeatmapCellStyle,
  getHeatmapMetricValue,
  getLastTouchInfo,
  getMergeCheckAiQuestions,
  getNetDiffFiles,
  getRepoHost,
  getRepoStateLabel,
  getXlsxHeatStyle,
  impactScopeOptions,
  mergeCheckMethodLabel,
  mergeCheckSteps,
  normalizeRefValue,
  previewMatchesSelection,
  refLockMatchesSelection,
  sortFilesForAnalysis,
} from './dashboard/dashboardUtils'
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const DashboardGitReportPanel = lazy(() => import('./dashboard/DashboardGitReportPanel'))
const DashboardResultsPanel = lazy(() => import('./dashboard/DashboardResultsPanel'))

function Dashboard({ settings, onOpenSettings, onSettingsRefresh }) {
  const [baseCommit, setBaseCommit] = useState('')
  const [targetCommit, setTargetCommit] = useState('')  // Target commit (optional)
  const [authorFilter, setAuthorFilter] = useState([])  // Array for multi-select
  const [authorSearch, setAuthorSearch] = useState('') // Search filter for authors
  const [dateFilter, setDateFilter] = useState('')  // Days ago filter
  const [comparisonPurpose, setComparisonPurpose] = useState('commit')
  const [baselineRef, setBaselineRef] = useState('')
  const [candidateRef, setCandidateRef] = useState(settings.branch || '')
  const [candidateSourceRef, setCandidateSourceRef] = useState(settings.branch || '')
  const [baselineSourceRef, setBaselineSourceRef] = useState('')
  const [compareStrategy, setCompareStrategy] = useState('deployment_state')
  const [includeImpact, setIncludeImpact] = useState(true)
  const [impactMaxFiles, setImpactMaxFiles] = useState(15)
  const [contextDepth, setContextDepth] = useState(1)
  const [resolvedRefs, setResolvedRefs] = useState(null)
  const [compareRefs, setCompareRefs] = useState({ default_branch: null, branches: [], tags: [], commits: [] })
  const [loadingRefs, setLoadingRefs] = useState(false)
  const [refScopedCommits, setRefScopedCommits] = useState({ candidate: [], baseline: [] })
  const [loadingRefScopedCommits, setLoadingRefScopedCommits] = useState({ candidate: false, baseline: false })
  const [repoBranchDraft, setRepoBranchDraft] = useState(settings.branch || '')
  const [savingRepoBranch, setSavingRepoBranch] = useState(false)
  const [repoBranchError, setRepoBranchError] = useState('')
  const [refBookmarks, setRefBookmarks] = useState([])
  const [loadingBookmarks, setLoadingBookmarks] = useState(false)
  const [bookmarkError, setBookmarkError] = useState(null)
  const [mergeCheck, setMergeCheck] = useState(null)
  const [loadingMergeCheck, setLoadingMergeCheck] = useState(false)
  const [mergeCheckProgress, setMergeCheckProgress] = useState(null)
  const mergeCheckTimersRef = useRef([])
  const mergeCheckRunSeqRef = useRef(0)
  const [analysisMode, setAnalysisMode] = useState('git')  // 'git', 'quick', 'full', or 'history'
  const activeAnalysisModeRef = useRef('git')
  const [maxFiles, setMaxFiles] = useState(20)  // 0 = all files, otherwise limit to top N
  const [analysisStatusFilter, setAnalysisStatusFilter] = useState('all') // File status scope for AI analysis
  const [analysisSort, setAnalysisSort] = useState('changes') // Ordering for AI target selection
  const [statusFilter, setStatusFilter] = useState('all') // 'all', 'added', 'modified', 'deleted', 'renamed'
  const [riskFilter, setRiskFilter] = useState('all') // all, risk, HIGH, MEDIUM, LOW, none
  const [sortBy, setSortBy] = useState('none') // 'none', 'commits', 'changes'
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [deepAnalysisResults, setDeepAnalysisResults] = useState([]) // New state for batch results
  const [error, setError] = useState(null)
  const [jobNotice, setJobNotice] = useState(null)
  const [activeAnalysisJob, setActiveAnalysisJob] = useState(null)
  const [progress, setProgress] = useState(null)
  const [selectedFileForDiff, setSelectedFileForDiff] = useState(null) // { path, diff }
  const diffModalScrollStateRef = useRef({})
  
  // Deep History Analysis State
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false)
  const [selectedHistoryFile, setSelectedHistoryFile] = useState(null)
  const [historyAnalysis, setHistoryAnalysis] = useState(null)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [activeHistoryJob, setActiveHistoryJob] = useState(null)
  const [historyJobProgress, setHistoryJobProgress] = useState(null)
  
  // Full Code View State for Modal
  const [modalViewMode, setModalViewMode] = useState('diff') // 'diff' or 'full'
  const [fullCodeContent, setFullCodeContent] = useState(null)
  const [loadingFullCode, setLoadingFullCode] = useState(false)
  
  // Commit and Author lists
  const [commits, setCommits] = useState([])
  const [authors, setAuthors] = useState([])
  const [loadingCommits, setLoadingCommits] = useState(false)
  const [repoStatus, setRepoStatus] = useState({ state: 'idle', message: '연결 상태를 아직 확인하지 않았습니다.' })
  const [commitLoadError, setCommitLoadError] = useState(null)
  const isPreDeploy = comparisonPurpose === 'pre_deploy'
  const isMergePlan = comparisonPurpose === 'merge_plan'

  const handleComparisonPurposeChange = (purpose) => {
    clearMergeCheckProgressTimers()
    setComparisonPurpose(purpose)
    setError(null)
    setResult(null)
    setGitReport(null)
    setGitReportError(null)
    setPreview(null)
    setResolvedRefs(null)
    setMergeCheck(null)
    setMergeCheckProgress(null)
    if (purpose === 'pre_deploy') {
      setCandidateRef(prev => prev || settings.branch || compareRefs.default_branch || '')
      setBaselineRef(prev => prev || compareRefs.default_branch || 'main')
      setCandidateSourceRef(prev => prev || settings.branch || compareRefs.default_branch || '')
      setBaselineSourceRef(prev => prev || compareRefs.default_branch || 'main')
      setCompareStrategy(prev => prev || 'deployment_state')
    } else if (purpose === 'merge_plan') {
      setAnalysisMode('git')
    }
  }

  // Preview state must be declared before preview-derived memo hooks.
  const [preview, setPreview] = useState(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const previewTimerRef = useRef(null)
  const previewRunSeqRef = useRef(0)

  const clearMergeCheckProgressTimers = () => {
    mergeCheckTimersRef.current.forEach(timer => clearTimeout(timer))
    mergeCheckTimersRef.current = []
  }

  const startMergeCheckProgress = () => {
    clearMergeCheckProgressTimers()
    const runSeq = mergeCheckRunSeqRef.current + 1
    mergeCheckRunSeqRef.current = runSeq
    const startedAt = Date.now()
    setMergeCheckProgress({
      runSeq,
      status: 'running',
      activeStep: 'resolving_refs',
      startedAt,
      elapsedSeconds: 0,
      message: '개발/기준 버전의 실제 커밋을 확인하고 있습니다.',
    })

    const schedule = [
      { delay: 700, activeStep: 'preparing_workspace', message: '임시 병합 작업공간을 준비하고 있습니다.' },
      { delay: 1700, activeStep: 'fetching_refs', message: 'GitLab에서 비교 대상 코드를 가져오고 있습니다.' },
      { delay: 4200, activeStep: 'running_dry_merge', message: '실제 병합 없이 충돌 여부를 확인하고 있습니다.' },
      { delay: 8000, activeStep: 'collecting_conflicts', message: '충돌 파일과 결과 메시지를 정리하고 있습니다.' },
    ]

    mergeCheckTimersRef.current = schedule.map(({ delay, activeStep, message }) => (
      setTimeout(() => {
        if (mergeCheckRunSeqRef.current !== runSeq) return
        setMergeCheckProgress(prev => {
          if (!prev || prev.status !== 'running' || prev.runSeq !== runSeq) return prev
          return {
            ...prev,
            activeStep,
            message,
            elapsedSeconds: (Date.now() - startedAt) / 1000,
          }
        })
      }, delay)
    ))

    return runSeq
  }

  const finishMergeCheckProgress = (runSeq, status, message) => {
    clearMergeCheckProgressTimers()
    if (mergeCheckRunSeqRef.current !== runSeq) return
    setMergeCheckProgress(prev => ({
      ...(prev || { runSeq, startedAt: Date.now() }),
      status,
      activeStep: status === 'failed' ? (prev?.activeStep || 'collecting_conflicts') : 'collecting_conflicts',
      message,
      elapsedSeconds: ((Date.now() - (prev?.startedAt || Date.now())) / 1000),
    }))
  }
  
  // Filtering & Tree View State
  const [filterQuery, setFilterQuery] = useState('')
  const [selectedPath, setSelectedPath] = useState(null) // Filter by specific folder/tree
  const [expandedFolders, setExpandedFolders] = useState({}) // Tree expansion state
  const aiMemoPanelRef = useRef(null)
  
  // Export Modal State
  const [exportModalOpen, setExportModalOpen] = useState(false)

  const handleModeChange = (mode) => {
    setAnalysisMode(mode)
    setError(null)
    if (mode !== 'git' && maxFiles === 0) {
      setMaxFiles(20)
    }
    if (mode !== 'git') {
      setGitReport(null)
      setGitReportError(null)
      setExpandedGitRows(new Set())
    }
  }

  // Filter Logic & Tree Memoization
  const { filesWithRiskMeta, riskCounts, filteredFiles, fileTree, toggleFolder } = useDashboardFileFilters({ buildFileTree, extractRiskFromAiSummary, filterQuery, result, riskFilter, selectedPath, setExpandedFolders, setSelectedPath })




  
  // Expand root folders by default
  useEffect(() => {
      if (fileTree && Object.keys(expandedFolders).length === 0) {
          const defaults = {};
          // Expand top-level
          Object.values(fileTree.children).forEach(c => {
             defaults[c.path] = true; 
          });
          setExpandedFolders(defaults);
      }
  }, [fileTree]);

  const {
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
  } = useDashboardDebugLogs(API_URL)

  const closeJobEventSource = (ref) => {
    if (ref.current) {
      ref.current.close()
      ref.current = null
    }
  }

  const showJobNotice = useCallback((message, tone = 'success') => {
    setJobNotice({ message, tone, id: Date.now() })
    window.setTimeout(() => {
      setJobNotice(prev => (prev?.message === message ? null : prev))
    }, 5200)
  }, [])

  const notifyJobComplete = useCallback((title, body) => {
    showJobNotice(body || title, 'success')
    if ('Notification' in window && window.Notification?.permission === 'granted') {
      try {
        new window.Notification(title, { body })
      } catch (e) {
        console.warn('Notification failed:', e)
      }
    }
  }, [showJobNotice])

  const buildJobProgress = (event) => {
    const progressInfo = event.progress || {}
    const startedAt = event.started_at || event.created_at
    const current = progressInfo.current ?? progressInfo.progress_current ?? 0
    const total = progressInfo.total ?? progressInfo.progress_total ?? 0
    const jobPhase = progressInfo.phase || event.phase
    const visiblePhase = ['fetch', 'fetch_done', 'categorizing', 'summarizing', 'cache_hit', 'cache_wait', 'cache_wait_timeout', 'cancelled'].includes(jobPhase)
      ? jobPhase
      : total
        ? 'analyzing'
        : (event.status === 'completed' ? 'complete' : 'job_progress')
    return {
      schema_version: 'job.1',
      phase: visiblePhase,
      job_phase: jobPhase,
      job_status: event.status,
      job_id: event.job_id,
      cache_key: event.cache_key,
      message: progressInfo.message || event.message || '백엔드 작업 상태를 확인하고 있습니다.',
      current,
      total,
      percent: progressInfo.percent ?? (total ? Math.round((current / total) * 100) : 0),
      file: progressInfo.file,
      cache_hit: progressInfo.cache_hit,
      cache_hits: progressInfo.cache_hits,
      node: progressInfo.node,
      event: progressInfo.event,
      elapsed_seconds: startedAt ? (Date.now() / 1000) - startedAt : undefined,
      duration_seconds: progressInfo.duration_seconds,
      average_seconds: progressInfo.average_seconds,
      estimated_remaining_seconds: progressInfo.estimated_remaining_seconds,
      cache_completed_count: progressInfo.cache_completed_count,
      concurrency: progressInfo.concurrency,
      raw_file_count: progressInfo.raw_file_count,
      scope_file_count: progressInfo.scope_file_count,
      analysis_sort: progressInfo.analysis_sort,
      commits: progressInfo.commits,
    }
  }

  const waitForJobResult = async (startedJob, { onProgress } = {}) => {
    if (startedJob?.status === 'completed') {
      return startedJob.result
    }
    if (!startedJob?.job_id) {
      throw new Error('Job id가 없는 응답입니다.')
    }

    let currentJob = startedJob
    while (true) {
      onProgress?.(currentJob)
      if (currentJob.status === 'completed') return currentJob.result
      if (['failed', 'cancelled', 'interrupted'].includes(currentJob.status)) {
        throw new Error(currentJob.error?.message || currentJob.message || '백그라운드 작업이 중단되었습니다.')
      }
      await new Promise(resolve => setTimeout(resolve, 1000))
      const statusRes = await fetch(`${API_URL}/api/jobs/${currentJob.job_id}`)
      if (!statusRes.ok) {
        throw new Error('작업 상태를 확인하지 못했습니다.')
      }
      currentJob = await statusRes.json()
    }
  }

  const persistAnalysisJob = (jobId) => {
    try {
      if (jobId) {
        localStorage.setItem(analysisJobStorageKey, JSON.stringify({ jobId, savedAt: Date.now() }))
      } else {
        localStorage.removeItem(analysisJobStorageKey)
      }
    } catch (e) {
      console.warn('analysis job persistence failed:', e)
    }
  }

  // Filter commits by date only (for Base selection)
  const { baseCommitList, previewPrioritizedFiles, previewScopeFileCount, previewAnalysisFileCount, baseCommitIndex, targetCommitList, authorsInRange, visibleAuthorChips, refOptionGroups, knownBranchNames, primaryRefOptionGroups, candidateCommitOptions, baselineCommitOptions, repoBranchOptions } = useDashboardRefOptions({ analysisSort, analysisStatusFilter, authorFilter, authorSearch, authors, baseCommit, buildCommitRefOptions, commits, compareRefs, dateFilter, maxFiles, preview, refBookmarks, refScopedCommits, settings, sortFilesForAnalysis, targetCommit })




  // Get base commit index for filtering target

  // Filter commits for Target: must be after base, filtered by author

  // Compute authors from commits in the selected range (base to target)


  // Git report state
  const [gitReport, setGitReport] = useState(null)
  const [loadingGitReport, setLoadingGitReport] = useState(false)
  const [gitReportError, setGitReportError] = useState(null)
  const gitReportRef = useRef(null)
  const [expandedGitRows, setExpandedGitRows] = useState(new Set())
  const [gitReportView, setGitReportView] = useState('table')
  const [gitHeatmapMetric, setGitHeatmapMetric] = useState('split')
  const [gitTableQuery, setGitTableQuery] = useState('')
  const [gitTableStatus, setGitTableStatus] = useState('all')
  const [gitTableSort, setGitTableSort] = useState('changes')
  const analysisAbortController = useRef(null)
  const historyAbortController = useRef(null)
  const analysisJobEventSourceRef = useRef(null)
  const historyJobEventSourceRef = useRef(null)
  const repoIdentity = useMemo(() => [
    settings.repoId || '',
    settings.gitUrl || '',
    settings.projectId || '',
    settings.branch || '',
    settings.gitToken || '',
  ].join('|'), [settings.repoId, settings.gitUrl, settings.projectId, settings.branch, settings.gitToken])
  const repoIdentityRef = useRef(repoIdentity)
  const previousRepoIdentityRef = useRef(null)
  repoIdentityRef.current = repoIdentity
  const analysisJobStorageKey = useMemo(() => `diff-lens:analysis-job:${repoIdentity}`, [repoIdentity])







  const { filteredGitReportFiles, gitReportDensity, gitReportHeatmap } = useGitReportMetrics({ formatDate, getCommitAuthor, getCommitDateValue, getCommitKey, getCommitShort, getCommitTime, getCommitTitle, getDirectoryPath, getFileName, getFileStatusLabel, getHeatmapMetricValue, getLastTouchInfo, gitHeatmapMetric, gitReport, gitTableQuery, gitTableSort, gitTableStatus })



  useEffect(() => {
    if (previousRepoIdentityRef.current === null) {
      previousRepoIdentityRef.current = repoIdentity
      return
    }
    if (previousRepoIdentityRef.current === repoIdentity) return
    previousRepoIdentityRef.current = repoIdentity

    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current)
      previewTimerRef.current = null
    }
    if (analysisAbortController.current) {
      analysisAbortController.current.abort()
      analysisAbortController.current = null
    }
    if (historyAbortController.current) {
      historyAbortController.current.abort()
      historyAbortController.current = null
    }
    closeJobEventSource(analysisJobEventSourceRef)
    closeJobEventSource(historyJobEventSourceRef)
    setActiveAnalysisJob(null)
    setActiveHistoryJob(null)

    setBaseCommit('')
    setTargetCommit('')
    setBaselineRef('')
    setCandidateRef(settings.branch || '')
    setCandidateSourceRef(settings.branch || '')
    setBaselineSourceRef('')
    setCompareStrategy('deployment_state')
    setIncludeImpact(true)
    setImpactMaxFiles(15)
    setContextDepth(1)
    setResolvedRefs(null)
    setCompareRefs({ default_branch: null, branches: [], tags: [], commits: [] })
    setRefBookmarks([])
    setBookmarkError(null)
    setMergeCheck(null)
    clearMergeCheckProgressTimers()
    setMergeCheckProgress(null)
    setAuthorFilter([])
    setAuthorSearch('')
    setDateFilter('')
    setMaxFiles(20)
    setAnalysisStatusFilter('all')
    setAnalysisSort('changes')
    setStatusFilter('all')
    setSortBy('none')
    setFilterQuery('')
    setSelectedPath(null)
    setExpandedFolders({})
    setPreview(null)
    setGitReport(null)
    setGitReportError(null)
    setExpandedGitRows(new Set())
    setGitReportView('table')
    setGitHeatmapMetric('split')
    setGitTableQuery('')
    setGitTableStatus('all')
    setGitTableSort('changes')
    setResult(null)
    setDeepAnalysisResults([])
    setProgress(null)
    setError(null)
    setSelectedFileForDiff(null)
    setFullCodeContent(null)
    setLoadingFullCode(false)
    setHistoryDrawerOpen(false)
    setSelectedHistoryFile(null)
    setHistoryAnalysis(null)
    setLoadingHistory(false)
    setActiveHistoryJob(null)
    setHistoryJobProgress(null)
    setLoading(false)
    setLoadingPreview(false)
    setLoadingGitReport(false)
    setCommits([])
    setAuthors([])
    setCommitLoadError(null)
    setDebugLogs([])
    setShowDebugLog(false)
    setExportModalOpen(false)
    setRepoStatus({ state: 'idle', message: '새 저장소 기준으로 커밋 목록을 다시 불러오는 중입니다.' })
  }, [repoIdentity])

  useEffect(() => {
    setRepoBranchDraft(settings.branch || compareRefs.default_branch || 'main')
    setRepoBranchError('')
  }, [settings.branch, settings.repoId, compareRefs.default_branch])

  useEffect(() => {
    if (!candidateRef && settings.branch) {
      setCandidateRef(settings.branch)
    }
    if (!candidateSourceRef && settings.branch) {
      setCandidateSourceRef(settings.branch)
    }
  }, [candidateRef, candidateSourceRef, settings.branch])

  useEffect(() => {
    if (comparisonPurpose !== 'pre_deploy') return
    if (!baselineRef && compareRefs.default_branch) {
      setBaselineRef(compareRefs.default_branch)
    }
    if (!baselineSourceRef && compareRefs.default_branch) {
      setBaselineSourceRef(compareRefs.default_branch)
    }
    if (!candidateRef && (settings.branch || compareRefs.default_branch)) {
      setCandidateRef(settings.branch || compareRefs.default_branch)
    }
    if (!candidateSourceRef && (settings.branch || compareRefs.default_branch)) {
      setCandidateSourceRef(settings.branch || compareRefs.default_branch)
    }
  }, [
    comparisonPurpose,
    baselineRef,
    baselineSourceRef,
    candidateRef,
    candidateSourceRef,
    compareRefs.default_branch,
    settings.branch,
  ])

  useEffect(() => {
    const canFetch =
      isPreDeploy &&
      settings.gitUrl &&
      settings.gitToken &&
      settings.projectId &&
      knownBranchNames.size > 0

    if (!canFetch) {
      setRefScopedCommits({ candidate: [], baseline: [] })
      setLoadingRefScopedCommits({ candidate: false, baseline: false })
      return undefined
    }

    let cancelled = false
    const controller = new AbortController()
    const limit = Math.min(Math.max(Number(settings.commitLimit) || 50, 20), 80)

    const clearSide = (side) => {
      setRefScopedCommits(prev => ((prev[side] || []).length ? { ...prev, [side]: [] } : prev))
      setLoadingRefScopedCommits(prev => (prev[side] ? { ...prev, [side]: false } : prev))
    }

    const fetchBranchCommits = async (side, ref) => {
      const cleanRef = (ref || '').trim()
      if (!cleanRef || !knownBranchNames.has(cleanRef)) {
        clearSide(side)
        return
      }

      setLoadingRefScopedCommits(prev => ({ ...prev, [side]: true }))
      try {
        const res = await fetch(`${API_URL}/commits`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            git_url: settings.gitUrl,
            git_token: settings.gitToken,
            project_id: settings.projectId,
            branch: cleanRef,
            limit,
          }),
        })
        if (!res.ok) {
          const text = await res.text()
          throw new Error(text || `커밋 목록 실패 (${res.status})`)
        }
        const data = await res.json()
        if (!cancelled) {
          setRefScopedCommits(prev => ({ ...prev, [side]: Array.isArray(data) ? data : [] }))
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.warn(`Failed to load commits for ${side} ref ${cleanRef}:`, err)
        }
        if (!cancelled) {
          setRefScopedCommits(prev => ({ ...prev, [side]: [] }))
        }
      } finally {
        if (!cancelled) {
          setLoadingRefScopedCommits(prev => ({ ...prev, [side]: false }))
        }
      }
    }

    fetchBranchCommits('candidate', candidateSourceRef)
    fetchBranchCommits('baseline', baselineSourceRef)

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [
    isPreDeploy,
    candidateSourceRef,
    baselineSourceRef,
    knownBranchNames,
    settings.gitUrl,
    settings.gitToken,
    settings.projectId,
    settings.commitLimit,
  ])

  const toggleGitRowDetails = (rowKey) => {
    setExpandedGitRows(prev => {
      const next = new Set(prev)
      if (next.has(rowKey)) {
        next.delete(rowKey)
      } else {
        next.add(rowKey)
      }
      return next
    })
  }

  // Fetch preview when filters change (Debounced to prevent race conditions)
  useEffect(() => {
    if (isMergePlan) {
      previewRunSeqRef.current += 1
      setLoadingPreview(false)
      setPreview(null)
      setGitReport(null)
      return undefined
    }
    const missingSelection = isPreDeploy ? (!baselineRef || !candidateRef) : !baseCommit
    if (missingSelection || !settings.gitUrl || !settings.gitToken || !settings.projectId) {
      previewRunSeqRef.current += 1
      setLoadingPreview(false)
      setPreview(null)
      setGitReport(null)
      return
    }

    // Set loading immediately for better UI response
    setLoadingPreview(true)

    if (previewTimerRef.current) clearTimeout(previewTimerRef.current)
    
    previewTimerRef.current = setTimeout(() => {
      fetchPreview()
    }, 400) // 400ms debounce

    return () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current)
    }
  }, [isMergePlan, isPreDeploy, baseCommit, targetCommit, baselineRef, candidateRef, compareStrategy, includeImpact, impactMaxFiles, contextDepth, authorFilter])

  useEffect(() => {
    previewRunSeqRef.current += 1
    setPreview(null)
    setGitReport(null)
    setGitReportError(null)
    setResolvedRefs(null)
    setMergeCheck(null)
    clearMergeCheckProgressTimers()
    setMergeCheckProgress(null)
  }, [comparisonPurpose, baseCommit, targetCommit, baselineRef, candidateRef, compareStrategy, authorFilter, settings.gitUrl, settings.gitToken, settings.projectId, settings.branch])

  useEffect(() => {
    if (loading) return
    setResult(null)
    setDeepAnalysisResults([])
    setProgress(null)
  }, [analysisMode, maxFiles, analysisStatusFilter, analysisSort])

  useEffect(() => {
    activeAnalysisModeRef.current = analysisMode
  }, [analysisMode])

  useEffect(() => {
    if (!gitReport) return
    requestAnimationFrame(() => {
      gitReportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [gitReport])

  const { buildCompareV2Payload, fetchPreview, saveActiveRepoBranch, testActiveRepository, fetchCommitsAndAuthors, fetchRefBookmarks, saveRefBookmark, applyRefBookmark, deleteRefBookmark, runMergeCheck, previewMergeConflictUi, clearMergeConflictPreview, openGitReport, downloadGitReportXlsx, downloadGitHeatmapXlsx, downloadAsExcel, downloadAsMarkdown } = createDashboardPrimaryActions({ API_URL, URLSearchParams, addLog, analysisMode, analysisSort, analysisStatusFilter, authorFilter, baseCommit, baselineRef, buildMergeCheckContext, candidateRef, candidateSourceRef, clearMergeCheckProgressTimers, compareStrategy, contextDepth, downloadXlsx, finishMergeCheckProgress, formatDate, formatRelatedCommits, getCommitAuthor, getCommitDateValue, getCommitKey, getCommitShort, getCommitTime, getCommitTitle, getFileStatusLabel, getLastTouchInfo, getNetDiffFiles, getXlsxHeatStyle, gitReport, impactMaxFiles, includeImpact, isPreDeploy, knownBranchNames, maxFiles, mergeCheck, onSettingsRefresh, preview, previewMatchesSelection, previewRunSeqRef, refLockMatchesSelection, repoIdentityRef, resolvedRefs, result, setAuthors, setBaselineRef, setBaselineSourceRef, setBookmarkError, setCandidateRef, setCandidateSourceRef, setCommitLoadError, setCommits, setCompareRefs, setDeepAnalysisResults, setError, setExpandedGitRows, setGitHeatmapMetric, setGitReport, setGitReportError, setGitReportView, setLoadingBookmarks, setLoadingCommits, setLoadingGitReport, setLoadingMergeCheck, setLoadingPreview, setLoadingRefs, setMergeCheck, setMergeCheckProgress, setPreview, setProgress, setRefBookmarks, setRepoBranchDraft, setRepoBranchError, setRepoStatus, setResolvedRefs, setResult, setSavingRepoBranch, settings, startMergeCheckProgress, targetCommit, waitForJobResult })


  // Fetch commits and authors when settings are configured
  useEffect(() => {
    if (settings.gitUrl && settings.gitToken && settings.projectId) {
      testActiveRepository()
      fetchCommitsAndAuthors()
    } else {
      setRepoStatus({ state: 'missing', message: 'Git URL, token, project ID 설정이 필요합니다.' })
      setCommitLoadError(null)
      setCommits([])
      setAuthors([])
      setCompareRefs({ default_branch: null, branches: [], tags: [], commits: [] })
      setRefBookmarks([])
      setBookmarkError(null)
      setMergeCheck(null)
      setLoadingRefs(false)
    }
  }, [settings.repoId, settings.gitUrl, settings.gitToken, settings.projectId, settings.branch])





  useEffect(() => {
    if (settings.gitUrl && settings.gitToken && settings.projectId) {
      fetchRefBookmarks()
    }
  }, [settings.repoId, settings.projectId, settings.gitUrl, settings.gitToken])










  // Download as Excel (CSV format - opens in Excel)

  // Download as Markdown

  // ========== 리스크 검토 기능 ==========
  const filesWithRisks = useMemo(() => {
    if (!result?.files) return []

    return result.files
      .map(f => {
        const risk = extractRiskFromAiSummary(f.ai_summary, f.path)
        if (!risk) return null
        return { ...f, risk }
      })
      .filter(Boolean)
      .sort((a, b) => riskSeverityRank[a.risk.severity] - riskSeverityRank[b.risk.severity])
  }, [result?.files])

  const focusFileInAiMemo = (file) => {
    if (!file?.path) return
    setSelectedPath(null)
    setFilterQuery(file.path)
    setRiskFilter('all')
    setStatusFilter('all')
    setSortBy('none')
    requestAnimationFrame(() => {
      aiMemoPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const { state: riskReviewState, actions: riskReviewActions } = useRiskReviewJobs({
    apiUrl: API_URL,
    filesWithRisks,
    baseCommit,
    targetCommit,
    settings,
    showJobNotice,
    notifyJobComplete,
  })
  // 심층 분석 Drawer 닫기 (진행 중인 요청 취소)
  const { closeHistoryDrawer, attachHistoryJob, handleDeepAnalysis } = createDashboardHistoryActions({ API_URL, AbortController, baseCommit, closeJobEventSource, commits, historyAbortController, historyJobEventSourceRef, notifyJobComplete, setActiveHistoryJob, setHistoryAnalysis, setHistoryDrawerOpen, setHistoryJobProgress, setLoadingHistory, setSelectedHistoryFile, settings, targetCommit })


  // Handle Deep History Analysis

  // Progress state for streaming
  const { attachAnalysisJob, cancelAnalysis, handleAnalyze, startPreDeployAiAnalysis, explainMergeCheckWithAi, upsertImpactCandidate, processCompareV2Data, processData } = createDashboardAnalysisActions({ API_URL, AbortController, TextDecoder, activeAnalysisJob, activeAnalysisModeRef, addLog, analysisAbortController, analysisJobEventSourceRef, analysisMode, analysisSort, analysisStatusFilter, authorFilter, baseCommit, baselineRef, buildCompareV2Payload, buildJobProgress, candidateRef, closeJobEventSource, compareStrategy, gitReport, isPreDeploy, maxFiles, mergeCheck, notifyJobComplete, openGitReport, persistAnalysisJob, preview, previewMatchesSelection, repoStatus, resolvedRefs, setActiveAnalysisJob, setAnalysisMode, setDebugLogs, setDeepAnalysisResults, setError, setGitReport, setGitReportError, setLoading, setProgress, setResolvedRefs, setResult, settings, showJobNotice, targetCommit })
  
  // 분석 취소 함수







  useEffect(() => {
    let cancelled = false
    const raw = (() => {
      try {
        return localStorage.getItem(analysisJobStorageKey)
      } catch {
        return null
      }
    })()
    if (!raw) return
    const saved = (() => {
      try {
        return JSON.parse(raw)
      } catch {
        return null
      }
    })()
    if (!saved?.jobId) return

    fetch(`${API_URL}/api/jobs/${saved.jobId}`)
      .then(res => (res.ok ? res.json() : null))
      .then(job => {
        if (cancelled || !job) return
        if (job.status === 'completed' && job.result) {
          processData(job.result)
          persistAnalysisJob(null)
          showJobNotice('이전에 완료된 백그라운드 분석 결과를 불러왔습니다.', 'success')
          return
        }
        if (['queued', 'running'].includes(job.status)) {
          setActiveAnalysisJob(job)
          setLoading(true)
          setProgress(buildJobProgress(job))
          attachAnalysisJob(saved.jobId)
          showJobNotice('진행 중이던 백그라운드 분석에 다시 연결했습니다.', 'success')
        } else {
          persistAnalysisJob(null)
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [analysisJobStorageKey])

  useEffect(() => {
    return () => {
      closeJobEventSource(analysisJobEventSourceRef)
      closeJobEventSource(historyJobEventSourceRef)
    }
  }, [])

  const activePurposeDetail = comparisonPurposeOptions.find(option => option.key === comparisonPurpose) || comparisonPurposeOptions[0]
  const effectiveBaseLabel = isPreDeploy ? baselineRef : baseCommit
  const effectiveTargetLabel = isPreDeploy ? candidateRef : (targetCommit || 'HEAD')
  const hasSelectedRange = isPreDeploy ? Boolean(baselineRef && candidateRef) : Boolean(baseCommit)
  const hasFinalOutput = Boolean(gitReport || result)
  const baselineOnlyResultFiles = (result?.files || []).filter(file => file.compare_origin === 'baseline_only')
  const baselineOnlyGitReportFiles = (gitReport?.files || []).filter(file => file.compare_origin === 'baseline_only')
  const runManifest = result?.run_manifest || gitReport?.run_manifest || preview?.run_manifest || null
  const mergeCheckActiveStepIndex = mergeCheckProgress
    ? Math.max(0, mergeCheckSteps.findIndex(step => step.key === mergeCheckProgress.activeStep))
    : -1
  const isMergeCheckRunning = mergeCheckProgress?.status === 'running'
  const isMergeCheckRefDrift = Boolean(mergeCheck?.diagnostics?.ref_drift?.length)
  const isMergeCheckDemo = Boolean(mergeCheck?.is_demo)
  const shouldOfferMergeCheckAi = Boolean(
    mergeCheck &&
    !isMergeCheckRunning &&
    ['conflicts', 'unknown'].includes(mergeCheck.status)
  )
  const mergeCheckAiQuestions = getMergeCheckAiQuestions(mergeCheck)
  const mergeCheckTitle = isMergeCheckRunning
    ? '충돌 체크 진행 중'
    : isMergeCheckDemo
      ? '병합 충돌 발견 예시'
      : isMergeCheckRefDrift
      ? '선택한 버전이 바뀜'
      : mergeCheck?.status === 'clean'
        ? '병합 충돌 없음'
        : mergeCheck?.status === 'conflicts'
          ? '병합 충돌 발견'
          : '충돌 여부 확인 불가'
  const mergeCheckMessage = isMergeCheckRefDrift
    ? '변경표를 만든 뒤 브랜치가 움직였거나 선택값이 바뀌었습니다. 최신 기준으로 변경표를 다시 만든 다음 확인해 주세요.'
    : isMergeCheckDemo
      ? '실제 Git 작업 없이 충돌 상태 UI만 미리 보여주는 예시입니다.'
    : (isMergeCheckRunning ? mergeCheckProgress.message : (mergeCheck?.message || mergeCheckProgress?.message))
  const selectedModeDetail = analysisModeDetails[analysisMode] || analysisModeDetails.git
  const resultAnalysisCount = result?.analysis_file_count ?? result?.files?.length ?? 0
  const resultScopeCount = result?.scope_file_count ?? resultAnalysisCount
  const resultRawCount = result?.raw_file_count ?? resultScopeCount
  const resultExcludedCount = Math.max(resultScopeCount - resultAnalysisCount, 0)
  const resultScopeExcludedCount = Math.max(resultRawCount - resultScopeCount, 0)
  const resultSortOption = getAnalysisSortOption(result?.analysis_sort || analysisSort)
  const analysisCostHint = analysisMode === 'history'
    ? '커밋별 상세 분석은 파일 수와 커밋 수에 비례해 오래 걸립니다.'
    : analysisMode === 'full'
      ? '파일 메모 캐시가 있으면 재사용하고, 선택 범위 요약만 새로 생성합니다.'
      : analysisMode === 'quick'
        ? '이미 분석한 파일 메모는 캐시에서 바로 재사용합니다.'
        : 'Git 변경표는 AI를 사용하지 않습니다.'
  const workflowSteps = [
    {
      label: '저장소 확인',
      helper: settings.repoName || getRepoHost(settings.gitUrl),
      active: repoStatus.state !== 'connected',
      done: repoStatus.state === 'connected',
    },
    {
      label: isPreDeploy ? '개발/기준 버전 선택' : 'Base/Target 선택',
      helper: hasSelectedRange
        ? (isPreDeploy ? `${effectiveTargetLabel.slice(0, 18)} → ${effectiveBaseLabel.slice(0, 18)}` : `${effectiveBaseLabel.slice(0, 18)} → ${effectiveTargetLabel.slice(0, 18)}`)
        : (isPreDeploy ? '개발 후보와 배포 기준을 고르세요' : '비교 시작점을 고르세요'),
      active: repoStatus.state === 'connected' && !hasSelectedRange,
      done: hasSelectedRange,
    },
    {
      label: selectedModeDetail.step,
      helper: hasFinalOutput ? '결과 준비 완료' : selectedModeDetail.result,
      active: hasSelectedRange && !hasFinalOutput,
      done: hasFinalOutput,
    },
  ]
  const primaryActionDisabledReason = repoStatus.state === 'checking'
    ? '저장소 연결을 확인하는 중입니다.'
    : ['disconnected', 'missing', 'warning'].includes(repoStatus.state)
      ? '저장소 연결 정보를 먼저 확인해 주세요.'
      : !hasSelectedRange
        ? (isPreDeploy ? '개발 버전과 기준 버전을 선택하면 배포 전 점검을 만들 수 있습니다.' : 'Base 커밋을 선택하면 변경표를 만들 수 있습니다.')
        : analysisMode !== 'git' && previewScopeFileCount === 0
          ? '현재 AI 파일 범위에 맞는 변경 파일이 없습니다.'
          : null
  const primaryActionLabel = selectedModeDetail.action
  const primaryLoadingLabel = selectedModeDetail.loading
  const isPreDeployGitReport = gitReport?.comparison_type === 'pre_deploy'
  const preDeployAiResultReady = Boolean(isPreDeployGitReport && result?.comparison_type === 'pre_deploy' && (result.files?.length || result.impact_candidates?.length || result.summary))
  const preDeployAiRunning = Boolean(isPreDeployGitReport && loading && (activeAnalysisModeRef.current || analysisMode) !== 'git')
  const preDeployAiStatus = preDeployAiRunning
    ? 'running'
    : preDeployAiResultReady
      ? 'complete'
      : isPreDeployGitReport
        ? 'ready'
        : 'idle'
  const preDeployAiDirectCount = result?.analysis_file_count ?? result?.files?.length ?? gitReport?.file_count ?? 0
  const preDeployAiImpactCount = result?.impact_candidates?.length ?? 0
  const preDeployAiSummaryText = typeof result?.summary === 'string' ? result.summary.replace(/[#*_`>-]/g, '').trim() : ''
  const preDeployAiCanRun = Boolean(isPreDeployGitReport && hasSelectedRange && !loading && repoStatus.state === 'connected')
  const mergeCheckBadge = loadingMergeCheck || isMergeCheckRunning
    ? { label: 'dry-run 진행 중', className: 'border-primary/30 bg-primary/10 text-primary' }
    : mergeCheck?.status === 'conflicts'
      ? { label: `dry-run 충돌 ${mergeCheck.conflict_count || ''}`, className: 'border-[#d7653d]/35 bg-[#d7653d]/10 text-[#ff9b78]' }
      : mergeCheck?.status === 'clean'
        ? { label: 'dry-run 충돌 없음', className: 'border-[#79b8c5]/35 bg-[#79b8c5]/10 text-[#b8edf5]' }
        : { label: 'dry-run 미실행', className: 'border-stone-700 bg-stone-950/35 text-stone-500' }
  const dashboardContextValue = { API_URL, AlertTriangle, BarChart3, BookOpen, ChevronDown, ChevronRight, ChevronUp, Clock, Code, DarkOptionMenu, Download, Eye, FileText, FileTreeNode, Folder, FolderOpen, Fragment, GitBranch, GitCompareArrows, GitMerge, RefPicker, Search, ShieldCheck, Sparkles, Star, Upload, User, X, activeAnalysisJob, activeAnalysisModeRef, activeHistoryJob, activePurposeDetail, addLog, aiMemoPanelRef, aiSummaryPreviewText, analysisAbortController, analysisCostHint, analysisJobEventSourceRef, analysisJobStorageKey, analysisMode, analysisModeDetails, analysisModeOptions, analysisSort, analysisSortOptions, analysisStatusFilter, applyRefBookmark, attachAnalysisJob, attachHistoryJob, authorFilter, authorSearch, authors, authorsInRange, backendLogAutoRefresh, backendLogSource, backendLogSources, backendLogs, backendLogsError, backendLogsLoading, baseCommit, baseCommitIndex, baseCommitList, baselineCommitOptions, baselineOnlyGitReportFiles, baselineOnlyResultFiles, baselineRef, baselineSourceRef, bookmarkError, buildCommitRefOptions, buildCompareV2Payload, buildFileTree, buildJobProgress, cancelAnalysis, candidateCommitOptions, candidateRef, candidateSourceRef, clearMergeCheckProgressTimers, clearMergeConflictPreview, closeHistoryDrawer, closeJobEventSource, commitLoadError, commits, compareRefs, compareStrategy, compareStrategyOptions, comparisonPurpose, comparisonPurposeOptions, contextDepth, dateFilter, debugLogTab, debugLogVisibleRef, debugLogs, deepAnalysisResults, deleteRefBookmark, diffModalScrollStateRef, downloadAsExcel, downloadAsMarkdown, downloadGitHeatmapXlsx, downloadGitReportXlsx, downloadXlsx, effectiveBaseLabel, effectiveTargetLabel, error, expandedFolders, expandedGitRows, explainMergeCheckWithAi, exportModalOpen, extractRiskFromAiSummary, fetchBackendLogs, fetchCommitsAndAuthors, fetchPreview, fetchRefBookmarks, fileTree, filesWithRiskMeta, filesWithRisks, filterQuery, filteredFiles, filteredGitReportFiles, finishMergeCheckProgress, focusFileInAiMemo, formatDate, formatDuration, formatRelatedCommits, fullCodeContent, getAnalysisLimitLabel, getAnalysisSortOption, getAnalysisStatusLabel, getChangeSizeClass, getChangeSizeLabel, getCommitAuthor, getCommitDateValue, getCommitKey, getCommitShort, getCommitTime, getCommitTitle, getDateRangeOptions, getDirectoryPath, getFileName, getFileStatusClass, getFileStatusLabel, getHeatmapCellStyle, getHeatmapMetricValue, getLastTouchInfo, getNetDiffFiles, getRepoHost, getRepoStateLabel, getXlsxHeatStyle, gitHeatmapMetric, gitReport, gitReportDensity, gitReportError, gitReportHeatmap, gitReportRef, gitReportView, gitTableQuery, gitTableSort, gitTableStatus, handleAnalyze, handleComparisonPurposeChange, handleDeepAnalysis, handleModeChange, hasFinalOutput, hasSelectedRange, historyAbortController, historyAnalysis, historyDrawerOpen, historyJobEventSourceRef, historyJobProgress, impactMaxFiles, impactScopeOptions, includeImpact, isMergeCheckDemo, isMergeCheckRefDrift, isMergeCheckRunning, isMergePlan, isPreDeploy, isPreDeployGitReport, jobNotice, knownBranchNames, loading, loadingBookmarks, loadingCommits, loadingFullCode, loadingGitReport, loadingHistory, loadingMergeCheck, loadingPreview, loadingRefScopedCommits, loadingRefs, maxFiles, mergeCheck, mergeCheckActiveStepIndex, mergeCheckAiQuestions, mergeCheckBadge, mergeCheckMessage, mergeCheckMethodLabel, mergeCheckProgress, mergeCheckRunSeqRef, mergeCheckSteps, mergeCheckTimersRef, mergeCheckTitle, modalViewMode, normalizeRefValue, notifyJobComplete, onOpenSettings, openGitReport, persistAnalysisJob, preDeployAiCanRun, preDeployAiDirectCount, preDeployAiImpactCount, preDeployAiResultReady, preDeployAiRunning, preDeployAiStatus, preDeployAiSummaryText, preview, previewAnalysisFileCount, previewMatchesSelection, previewMergeConflictUi, previewPrioritizedFiles, previewRunSeqRef, previewScopeFileCount, previewTimerRef, previousRepoIdentityRef, primaryActionDisabledReason, primaryActionLabel, primaryLoadingLabel, primaryRefOptionGroups, processCompareV2Data, processData, progress, refBookmarks, refLockMatchesSelection, refOptionGroups, refScopedCommits, repoBranchDraft, repoBranchError, repoBranchOptions, repoIdentity, repoIdentityRef, repoStatus, resolvedRefs, result, resultAnalysisCount, resultExcludedCount, resultRawCount, resultScopeCount, resultScopeExcludedCount, resultSortOption, riskCounts, riskFilter, riskReviewActions, riskReviewState, riskSeverityRank, runManifest, runMergeCheck, saveActiveRepoBranch, saveRefBookmark, savingRepoBranch, selectedFileForDiff, selectedHistoryFile, selectedModeDetail, selectedPath, setActiveAnalysisJob, setActiveHistoryJob, setAnalysisMode, setAnalysisSort, setAnalysisStatusFilter, setAuthorFilter, setAuthorSearch, setAuthors, setBackendLogAutoRefresh, setBackendLogSource, setBackendLogSources, setBackendLogs, setBackendLogsError, setBackendLogsLoading, setBaseCommit, setBaselineRef, setBaselineSourceRef, setBookmarkError, setCandidateRef, setCandidateSourceRef, setCommitLoadError, setCommits, setCompareRefs, setCompareStrategy, setComparisonPurpose, setContextDepth, setDateFilter, setDebugLogTab, setDebugLogs, setDeepAnalysisResults, setError, setExpandedFolders, setExpandedGitRows, setExportModalOpen, setFilterQuery, setFullCodeContent, setGitHeatmapMetric, setGitReport, setGitReportError, setGitReportView, setGitTableQuery, setGitTableSort, setGitTableStatus, setHistoryAnalysis, setHistoryDrawerOpen, setHistoryJobProgress, setImpactMaxFiles, setIncludeImpact, setJobNotice, setLoading, setLoadingBookmarks, setLoadingCommits, setLoadingFullCode, setLoadingGitReport, setLoadingHistory, setLoadingMergeCheck, setLoadingPreview, setLoadingRefScopedCommits, setLoadingRefs, setMaxFiles, setMergeCheck, setMergeCheckProgress, setModalViewMode, setPreview, setProgress, setRefBookmarks, setRefScopedCommits, setRepoBranchDraft, setRepoBranchError, setRepoStatus, setResolvedRefs, setResult, setRiskFilter, setSavingRepoBranch, setSelectedFileForDiff, setSelectedHistoryFile, setSelectedPath, setShowDebugLog, setSortBy, setStatusFilter, setTargetCommit, settings, shouldOfferMergeCheckAi, showDebugLog, showJobNotice, sortBy, sortFilesForAnalysis, startMergeCheckProgress, startPreDeployAiAnalysis, statusFilter, targetCommit, targetCommitList, testActiveRepository, toggleFolder, toggleGitRowDetails, upsertImpactCandidate, useCallback, useEffect, useMemo, useRef, useRiskReviewJobs, useState, visibleAuthorChips, waitForJobResult, workflowSteps }
  return (
    <DashboardProvider value={dashboardContextValue}>
      <div className="warm-scope space-y-6 animate-rise-in">
        <DashboardNotice />
        <DashboardControlPanel />
        <DashboardProgressPanels />
        {gitReport && (
          <Suspense fallback={null}>
            <DashboardGitReportPanel />
          </Suspense>
        )}
        {result && (
          <Suspense fallback={null}>
            <DashboardResultsPanel />
          </Suspense>
        )}
        <DashboardOverlays />
      </div>
    </DashboardProvider>
  )
}

export default Dashboard
