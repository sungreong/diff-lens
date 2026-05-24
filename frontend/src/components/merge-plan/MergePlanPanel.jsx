import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, ChevronRight, Clock, GitMerge, Plus, ShieldCheck, Terminal, Trash2, X } from 'lucide-react'
import { DarkOptionMenu } from '../ref-picker/RefPicker'
import { useMergePlanJob } from './useMergePlanJob'
import MergePlanReviewPanel from './MergePlanReviewPanel'
import {
  buildMergePlanPayload,
  buildResolvedPreview,
  candidateResultStatusLabel,
  collectConflictFiles,
  findRefOption,
  formatShortSha,
  mergePlanStages,
  mergePlanStatusMeta,
} from './mergePlanUtils'

const newCandidate = (index, ref = '') => ({
  id: `candidate-${Date.now()}-${index}`,
  label: ref ? `후보 ${index}` : '',
  ref,
})

const COMMAND_GUIDE_STORAGE_KEY = 'diff-lens:merge-plan-command-guide-open'

const initialCommandGuideOpen = () => {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(COMMAND_GUIDE_STORAGE_KEY) === 'true'
}

const StatusPill = ({ status }) => {
  const meta = mergePlanStatusMeta[status] || mergePlanStatusMeta.unknown
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-black ${meta.className}`}>
      {meta.label}
    </span>
  )
}

const normalizeRefKey = (value) => String(value || '').trim().toLowerCase()

const getCandidateKey = (candidate, optionGroups = []) => {
  const option = findRefOption(optionGroups, candidate.ref)
  return normalizeRefKey(option?.sha || option?.raw?.sha || option?.raw?.full_sha || candidate.ref)
}

const getCandidateDisplayName = (item) => {
  const ref = item.candidate_ref || ''
  const label = item.candidate_label || ''
  if (ref && (!label || /^후보\s*\d+$/i.test(label))) return ref
  return label || ref || '대상'
}

const CollapsibleSection = ({ title, eyebrow, count, open, onToggle, children, className = '' }) => (
  <section className={`rounded-2xl border border-primary/10 bg-stone-950/25 ${className}`}>
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left"
    >
      <div className="flex min-w-0 items-center gap-2">
        {open ? <ChevronDown size={16} className="shrink-0 text-primary" /> : <ChevronRight size={16} className="shrink-0 text-stone-500" />}
        <div className="min-w-0">
          {eyebrow && <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-500">{eyebrow}</p>}
          <h3 className="truncate text-sm font-black text-stone-50">{title}</h3>
        </div>
      </div>
      {count !== undefined && (
        <span className="shrink-0 rounded-full border border-primary/15 bg-primary/10 px-2 py-1 text-[10px] font-black text-primary">
          {count}
        </span>
      )}
    </button>
    {open && <div className="border-t border-primary/10 px-4 pb-4 pt-3">{children}</div>}
  </section>
)

const LockedRef = ({ option, value, accentClass = 'text-primary' }) => {
  const preview = buildResolvedPreview(option, value)
  return preview ? (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border border-primary/10 bg-stone-950/35 px-2 py-1 text-[11px] text-stone-400">
      <ShieldCheck size={12} className={accentClass} />
      <span className={`font-mono ${accentClass}`}>{preview.short_sha}</span>
      <span className="min-w-0 truncate" title={preview.title}>{preview.title}</span>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-1 text-[11px] font-bold text-amber-200">
      SHA 미잠금
    </span>
  )
}

const ResultRow = ({ item, mode }) => {
  const statusLabel = candidateResultStatusLabel(item.status)
  const isProblem = ['conflict', 'blocked', 'unknown'].includes(statusLabel)
  const displayName = getCandidateDisplayName(item)
  return (
    <div className={`grid gap-3 rounded-xl border px-3 py-3 md:grid-cols-[120px_minmax(0,1fr)_130px] md:items-center ${
      isProblem ? 'border-[#d7653d]/20 bg-[#d7653d]/10' : 'border-primary/10 bg-stone-950/25'
      }`}>
      <div className="min-w-0">
        <p className="truncate text-xs font-black text-stone-100" title={displayName}>
          {displayName}
        </p>
        <p className="mt-1 truncate font-mono text-[11px] text-stone-500" title={item.candidate_ref}>
          {formatShortSha(item.candidate_sha)}
          {item.candidate_ref && displayName !== item.candidate_ref ? ` · ${item.candidate_ref}` : ''}
        </p>
      </div>
      <div className="min-w-0">
        <p className="text-xs leading-5 text-stone-400">{item.message || '-'}</p>
        {(item.conflict_files || []).length > 0 && (
          <p className="mt-1 truncate font-mono text-[11px] text-[#ffb59e]" title={(item.conflict_files || []).join(', ')}>
            {(item.conflict_files || []).slice(0, 4).join(', ')}
          </p>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 md:justify-end">
        <span className="rounded-full border border-primary/10 bg-stone-950/30 px-2 py-1 text-[10px] font-bold uppercase text-stone-500">
          {mode}
        </span>
        <span className={`rounded-full border px-2 py-1 text-[10px] font-black ${
          isProblem
            ? 'border-[#d7653d]/30 text-[#ff9b78]'
            : 'border-[#79b8c5]/25 text-[#b8edf5]'
        }`}>
          {statusLabel}
        </span>
      </div>
    </div>
  )
}

const commandPreviewGroups = [
  {
    phase: 'resolving_refs',
    title: 'ref 가져오기/SHA 확인',
    detail: '대상 C와 후보 ref를 임시 로컬 ref로 fetch하고 실행 시점 SHA를 검증합니다.',
    commands: [
      'git init -q',
      'git remote add origin <repo-url>',
      'git fetch --no-tags --depth=200 origin <target>:refs/diff-lens/target',
      'git rev-parse refs/diff-lens/target',
    ],
  },
  {
    phase: 'individual_checks',
    title: '개별 dry-run',
    detail: '각 후보를 대상 C에 단독으로 붙여보고 충돌 파일을 확인합니다.',
    commands: [
      'git checkout -q --detach refs/diff-lens/target',
      'git merge-base refs/diff-lens/target refs/diff-lens/source',
      'git merge --no-commit --no-ff refs/diff-lens/source',
      'git diff --name-only --diff-filter=U',
    ],
  },
  {
    phase: 'sequential_checks',
    title: '순차 dry-run',
    detail: '후보 순서대로 clean 결과를 임시 로컬 커밋으로 누적한 뒤 다음 후보를 이어 붙입니다.',
    commands: [
      'git merge-base HEAD refs/diff-lens/candidate-N',
      'git merge --no-commit --no-ff refs/diff-lens/candidate-N',
      'git status --porcelain',
      'git commit -q -m "Diff Lens dry-run merge <candidate>"',
    ],
  },
]

const CommandPreviewPanel = ({ phase, candidateCount, open, onToggle }) => (
  <div className="mt-4 rounded-2xl border border-[#79b8c5]/15 bg-black/15">
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full flex-col gap-2 px-3 py-3 text-left md:flex-row md:items-center md:justify-between"
    >
      <div className="flex min-w-0 items-center gap-2">
        {open ? <ChevronDown size={16} className="shrink-0 text-[#79b8c5]" /> : <ChevronRight size={16} className="shrink-0 text-stone-500" />}
        <Terminal size={15} className="text-[#79b8c5]" />
        <div className="min-w-0">
          <h4 className="text-xs font-black text-stone-100">실행 명령어 흐름</h4>
          <p className="mt-1 text-[11px] leading-5 text-stone-500">
            아래는 dry-run에서 쓰는 대표 명령입니다. 완료 후 실제 실행 로그가 이 영역 아래에 표시됩니다.
          </p>
        </div>
      </div>
      <span className="shrink-0 rounded-full border border-primary/15 bg-primary/10 px-2 py-1 text-[10px] font-black text-primary">
        후보 {candidateCount}개 기준
      </span>
    </button>
    {open && <div className="border-t border-[#79b8c5]/10 px-3 pb-3 pt-3">
    <div className="grid min-w-0 gap-2 xl:grid-cols-3">
      {commandPreviewGroups.map(group => {
        const active = group.phase === phase
        return (
          <div
            key={group.phase}
            className={`min-w-0 rounded-xl border p-3 ${
              active
                ? 'border-primary/35 bg-primary/10'
                : 'border-primary/10 bg-stone-950/25'
            }`}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="truncate text-xs font-black text-stone-100">{group.title}</p>
              {active && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-black text-primary">진행 중</span>}
            </div>
            <p className="mb-2 text-[11px] leading-5 text-stone-500">{group.detail}</p>
            <div className="space-y-1">
              {group.commands.map(command => (
                <code key={command} className="block min-w-0 break-all rounded-lg border border-primary/10 bg-black/25 px-2 py-1.5 font-mono text-[10px] leading-4 text-[#f3dfaf]">
                  {command}
                </code>
              ))}
            </div>
          </div>
        )
      })}
    </div>
    <div className="mt-2 rounded-xl border border-emerald-400/15 bg-emerald-950/10 px-3 py-2 text-[11px] leading-5 text-emerald-100/80">
      실행하지 않는 명령: <code className="text-emerald-100">git push</code>, 원격 merge API, 원격 브랜치 commit. 순차 단계의 commit은 임시 작업공간 안에서만 생성됩니다.
    </div>
    </div>}
  </div>
)

const candidateLabelText = (candidate, index) => {
  const label = candidate.label || candidate.ref || `후보 ${index + 1}`
  if (candidate.ref && label !== candidate.ref) return `${label} · ${candidate.ref}`
  return label
}

const progressOrder = {
  merge_plan_prepare: 0,
  resolving_refs: 1,
  individual_checks: 2,
  sequential_checks: 3,
  merge_plan_review: 4,
  merge_plan_done: 5,
}

const buildCandidateQueueItems = ({ candidates, progress, result, phase }) => {
  const resultKey = phase === 'individual_checks' ? 'individual_results' : 'sequential_results'
  const resultMap = new Map((result?.[resultKey] || []).map(item => [item.candidate_id, item]))
  const phaseRank = progressOrder[progress?.phase] ?? -1
  const targetRank = progressOrder[phase] ?? -1
  const currentById = progress?.candidateId
    ? candidates.findIndex(candidate => candidate.id === progress.candidateId)
    : -1
  const currentIndex = progress?.phase === phase
    ? (currentById >= 0 ? currentById : 0)
    : -1

  return candidates.map((candidate, index) => {
    const resolved = resultMap.get(candidate.id)
    if (resolved) {
      const label = candidateResultStatusLabel(resolved.status)
      return { candidate, index, state: ['conflict', 'blocked', 'unknown'].includes(label) ? 'problem' : 'done', label }
    }
    if (progress?.status === 'completed' || phaseRank > targetRank) {
      return { candidate, index, state: 'done', label: '완료' }
    }
    if (phaseRank < targetRank) {
      return { candidate, index, state: 'pending', label: '대기' }
    }
    if (index < currentIndex) return { candidate, index, state: 'done', label: '완료' }
    if (index === currentIndex) return { candidate, index, state: 'running', label: '진행 중' }
    return { candidate, index, state: 'pending', label: '대기' }
  })
}

const CandidateProgressQueue = ({ candidates, progress, result }) => {
  const activeCandidates = candidates.filter(candidate => candidate.ref?.trim())
  if (!progress || activeCandidates.length <= 1) return null

  const individualItems = buildCandidateQueueItems({
    candidates: activeCandidates,
    progress,
    result,
    phase: 'individual_checks',
  })
  const sequentialItems = buildCandidateQueueItems({
    candidates: activeCandidates,
    progress,
    result,
    phase: 'sequential_checks',
  })
  const currentPhaseLabel = progress.phase === 'sequential_checks' ? '순차 dry-run' : '개별 dry-run'
  const currentCandidateIndex = progress?.candidateId
    ? activeCandidates.findIndex(candidate => candidate.id === progress.candidateId)
    : -1
  const currentDone = currentCandidateIndex >= 0
    ? Math.max(0, currentCandidateIndex)
    : 0
  const showCount = ['individual_checks', 'sequential_checks'].includes(progress.phase)

  const renderTrack = (title, items) => (
    <div className="min-w-0 rounded-xl border border-primary/10 bg-stone-950/25 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="truncate text-xs font-black text-stone-100">{title}</p>
        <span className="rounded-full border border-primary/15 px-2 py-0.5 text-[10px] font-black text-stone-500">
          {items.filter(item => item.state === 'done' || item.state === 'problem').length}/{items.length}
        </span>
      </div>
      <div className="space-y-1.5">
        {items.map(({ candidate, index, state, label }) => (
          <div
            key={`${title}-${candidate.id}`}
            className={`grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)_4rem] items-center gap-2 rounded-lg border px-2 py-2 text-[11px] ${
              state === 'running'
                ? 'border-primary/35 bg-primary/10 text-primary'
                : state === 'problem'
                  ? 'border-[#d7653d]/30 bg-[#d7653d]/10 text-[#ffb59e]'
                  : state === 'done'
                    ? 'border-[#79b8c5]/15 bg-[#79b8c5]/5 text-[#b8edf5]'
                    : 'border-primary/10 bg-black/15 text-stone-500'
            }`}
          >
            <span className="grid h-5 w-5 place-items-center rounded-full bg-black/20 font-mono font-black">{index + 1}</span>
            <span className="min-w-0 truncate font-bold text-stone-200" title={candidateLabelText(candidate, index)}>
              {candidateLabelText(candidate, index)}
            </span>
            <span className="justify-self-end rounded-full border border-current/20 px-1.5 py-0.5 font-black">
              {label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className="mt-4 rounded-2xl border border-primary/10 bg-black/10 p-3">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-black text-stone-100">후보별 처리 큐</p>
          <p className="mt-1 text-[11px] leading-5 text-stone-500">
            후보를 화면 순서대로 하나씩 확인합니다. 현재 단계의 진행 후보와 완료 범위를 표시합니다.
          </p>
        </div>
        {showCount && (
          <span className="shrink-0 rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-[10px] font-black text-primary">
            {currentPhaseLabel} {currentDone}/{activeCandidates.length} 완료
          </span>
        )}
      </div>
      <div className="grid gap-2 xl:grid-cols-2">
        {renderTrack('개별 확인', individualItems)}
        {renderTrack('순차 확인', sequentialItems)}
      </div>
    </div>
  )
}

const GitCommandLog = ({ result }) => {
  const commands = result?.git_commands || [
    ...(result?.individual_results || []).flatMap(item => item.git_commands || []),
    ...(result?.sequential_results || []).flatMap(item => item.git_commands || []),
  ]
  if (!commands.length) return null

  return (
    <details className="rounded-2xl border border-[#79b8c5]/20 bg-stone-950/35 p-4">
      <summary className="cursor-pointer select-none text-sm font-black text-stone-50 marker:text-primary">
        사용한 Git 명령어 {commands.length}개
      </summary>
      <div className="mt-3 rounded-xl border border-primary/10 bg-black/25 p-3">
        <p className="mb-3 text-xs leading-5 text-stone-400">
          모두 임시 로컬 작업공간에서 실행됩니다. 원격 merge, commit, push는 호출하지 않습니다.
          순차 clean 단계의 <code className="mx-1 text-primary">git commit</code>은 다음 후보를 이어 붙이기 위한 로컬 임시 커밋입니다.
        </p>
        <div className="max-h-72 space-y-1 overflow-y-auto pr-1 custom-scrollbar">
          {commands.map((entry, index) => {
            const command = typeof entry === 'string' ? entry : entry.command
            const returncode = typeof entry === 'string' ? null : entry.returncode
            return (
              <div key={`${command}-${index}`} className="grid min-w-0 gap-2 rounded-lg border border-primary/10 bg-stone-950/45 px-3 py-2 text-[11px] sm:grid-cols-[3rem_minmax(0,1fr)_4rem]">
                <span className="font-mono text-stone-500">#{index + 1}</span>
                <code className="min-w-0 break-all font-mono leading-5 text-[#f3dfaf]">{command}</code>
                <span className={`justify-self-start rounded-full border px-2 py-0.5 font-mono text-[10px] sm:justify-self-end ${
                  returncode === 0
                    ? 'border-[#79b8c5]/25 text-[#b8edf5]'
                    : returncode === null
                      ? 'border-stone-700 text-stone-500'
                      : 'border-[#d7653d]/30 text-[#ff9b78]'
                }`}>
                  {returncode === null ? '-' : returncode}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </details>
  )
}

const MergePlanPanel = ({
  apiUrl,
  settings,
  optionGroups,
  loadingRefs,
  repoStatus,
  defaultTargetRef,
  defaultCandidateRef,
  showJobNotice,
  notifyJobComplete,
}) => {
  const [targetRef, setTargetRef] = useState(defaultTargetRef || '')
  const [candidates, setCandidates] = useState([newCandidate(1, defaultCandidateRef || '')])
  const [includeAiReview, setIncludeAiReview] = useState(true)
  const [reviewStyle, setReviewStyle] = useState('balanced')
  const [forceRefresh, setForceRefresh] = useState(false)
  const [localError, setLocalError] = useState('')
  const [commandGuideOpen, setCommandGuideOpen] = useState(initialCommandGuideOpen)
  const [individualResultsOpen, setIndividualResultsOpen] = useState(true)
  const [sequentialResultsOpen, setSequentialResultsOpen] = useState(true)

  const targetOption = useMemo(() => findRefOption(optionGroups, targetRef), [optionGroups, targetRef])
  const lockedCandidateCount = candidates.filter(candidate => findRefOption(optionGroups, candidate.ref)?.sha).length
  const targetKey = normalizeRefKey(targetOption?.sha || targetOption?.raw?.sha || targetOption?.raw?.full_sha || targetRef)
  const candidateIssues = useMemo(() => {
    const issues = {}
    const seen = new Map()
    candidates.forEach(candidate => {
      if (!candidate.ref?.trim()) return
      const key = getCandidateKey(candidate, optionGroups)
      if (!key) return
      if (targetKey && key === targetKey) {
        issues[candidate.id] = '대상 C와 같은 ref/SHA입니다.'
      }
      if (seen.has(key)) {
        const firstId = seen.get(key)
        issues[candidate.id] = '다른 후보와 같은 ref/SHA입니다.'
        issues[firstId] = issues[firstId] || '다른 후보와 같은 ref/SHA입니다.'
      } else {
        seen.set(key, candidate.id)
      }
    })
    return issues
  }, [candidates, optionGroups, targetKey])
  const hasCandidateIssues = Object.keys(candidateIssues).length > 0
  const canRun = Boolean(
    repoStatus.state === 'connected' &&
    targetRef.trim() &&
    candidates.some(candidate => candidate.ref?.trim()) &&
    !hasCandidateIssues
  )

  const {
    loading,
    progress,
    result,
    error,
    startMergePlan,
    cancel,
  } = useMergePlanJob({ apiUrl, notifyJobComplete, showJobNotice })

  useEffect(() => {
    if (!targetRef && defaultTargetRef) setTargetRef(defaultTargetRef)
  }, [defaultTargetRef, targetRef])

  useEffect(() => {
    setCandidates(prev => {
      if (prev.some(candidate => candidate.ref)) return prev
      return [newCandidate(1, defaultCandidateRef || '')]
    })
  }, [defaultCandidateRef])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(COMMAND_GUIDE_STORAGE_KEY, String(commandGuideOpen))
  }, [commandGuideOpen])

  const addCandidate = () => {
    setCandidates(prev => [...prev, newCandidate(prev.length + 1)])
  }

  const updateCandidate = (id, patch) => {
    setCandidates(prev => prev.map(candidate => (
      candidate.id === id ? { ...candidate, ...patch } : candidate
    )))
  }

  const moveCandidate = (id, direction) => {
    setCandidates(prev => {
      const index = prev.findIndex(candidate => candidate.id === id)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev
      const next = [...prev]
      const [item] = next.splice(index, 1)
      next.splice(nextIndex, 0, item)
      return next
    })
  }

  const removeCandidate = (id) => {
    setCandidates(prev => prev.length > 1 ? prev.filter(candidate => candidate.id !== id) : prev)
  }

  const startPlan = (forceRefreshOverride = forceRefresh) => {
    if (!canRun) {
      setLocalError(hasCandidateIssues ? '후보는 서로 다른 ref/SHA여야 하며, 대상 C와 같은 ref/SHA는 후보로 넣을 수 없습니다.' : '대상 C와 후보를 최소 1개 선택하세요.')
      return
    }
    setLocalError('')
    const payload = buildMergePlanPayload({
      settings,
      targetRef,
      targetOption,
      candidates,
      optionGroups,
      includeAiReview,
      reviewStyle,
      forceRefresh: forceRefreshOverride,
    })
    startMergePlan(payload)
  }

  const runPlan = () => startPlan(forceRefresh)
  const rerunWithoutCache = () => {
    setForceRefresh(true)
    startPlan(true)
  }

  const progressIndex = progress
    ? Math.max(0, mergePlanStages.findIndex(stage => stage.key === progress.phase))
    : -1
  const visibleError = localError || error
  const validationMessage = hasCandidateIssues ? '중복 후보 또는 대상과 같은 후보가 있습니다. 각 후보는 서로 다른 ref/SHA여야 합니다.' : ''
  const resultStatus = loading ? 'running' : result?.status
  const conflictFiles = collectConflictFiles(result)
  const statusMeta = resultStatus ? (mergePlanStatusMeta[resultStatus] || mergePlanStatusMeta.unknown) : null

  return (
    <div className="merge-plan-panel space-y-4">
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <section className="order-2 min-w-0 rounded-2xl border border-[#79b8c5]/15 bg-stone-950/25 p-4 xl:order-2">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-black text-stone-50">대상 C</h3>
              <p className="mt-1 text-xs text-stone-500">후보들이 들어갈 릴리즈 기준 브랜치 또는 커밋입니다.</p>
            </div>
            <div className="max-w-full min-w-0 sm:max-w-full">
              <LockedRef option={targetOption} value={targetRef} accentClass="text-[#79b8c5]" />
            </div>
          </div>
          <DarkOptionMenu
            value={targetRef}
            onChange={setTargetRef}
            optionGroups={optionGroups}
            loading={loadingRefs}
            placeholder="release, main, prod, commit SHA"
            accentClass="text-[#79b8c5]"
            searchPlaceholder="대상 브랜치, 태그, 커밋 검색"
            menuClassName="min-w-full"
          />
          <div className="mt-2 field-surface flex h-[42px] items-center gap-2 rounded-xl border px-3">
            <input
              value={targetRef}
              onChange={(event) => setTargetRef(event.target.value)}
              placeholder="직접 입력"
              className="min-w-0 flex-1 bg-transparent text-sm text-stone-100 placeholder-stone-500 outline-none"
            />
          </div>
        </section>

        <section className="order-1 min-w-0 rounded-2xl border border-primary/15 bg-stone-950/25 p-4 xl:order-1">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-black text-stone-50">후보군 A, B, ...</h3>
              <p className="mt-1 text-xs text-stone-500">왼쪽 후보군을 오른쪽 대상 C에 넣는 순서로 시뮬레이션합니다.</p>
            </div>
            <span className="status-pill px-2 py-1 text-[11px]">
              SHA 잠금 {lockedCandidateCount}/{candidates.length}
            </span>
          </div>

          <div className="space-y-2">
            {candidates.map((candidate, index) => {
              const option = findRefOption(optionGroups, candidate.ref)
              return (
                <div key={candidate.id} className="min-w-0 rounded-xl border border-primary/10 bg-stone-950/30 p-3">
                  <div className="mb-2 grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-black text-primary">
                        {index + 1}
                      </span>
                      <input
                        value={candidate.label}
                        onChange={(event) => updateCandidate(candidate.id, { label: event.target.value })}
                        placeholder={`후보 ${index + 1}`}
                        className="min-w-0 bg-transparent text-sm font-black text-stone-100 placeholder-stone-600 outline-none"
                      />
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center justify-start gap-1 sm:justify-end">
                      <div className="max-w-full min-w-0 sm:max-w-[360px]">
                        <LockedRef option={option} value={candidate.ref} />
                      </div>
                      <button
                        type="button"
                        onClick={() => moveCandidate(candidate.id, -1)}
                        disabled={index === 0}
                        className="rounded-full p-1.5 text-stone-500 hover:bg-primary/10 hover:text-primary disabled:opacity-30"
                        title="위로 이동"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveCandidate(candidate.id, 1)}
                        disabled={index === candidates.length - 1}
                        className="rounded-full p-1.5 text-stone-500 hover:bg-primary/10 hover:text-primary disabled:opacity-30"
                        title="아래로 이동"
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeCandidate(candidate.id)}
                        disabled={candidates.length === 1}
                        className="rounded-full p-1.5 text-stone-500 hover:bg-[#d7653d]/10 hover:text-[#ff9b78] disabled:opacity-30"
                        title="후보 삭제"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="grid min-w-0 gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(180px,0.5fr)]">
                    <DarkOptionMenu
                      value={candidate.ref}
                      onChange={(nextRef) => updateCandidate(candidate.id, { ref: nextRef, label: candidate.label || nextRef })}
                      optionGroups={optionGroups}
                      loading={loadingRefs}
                      placeholder="feature branch, tag, commit"
                      searchPlaceholder="후보 브랜치, 태그, 커밋 검색"
                      menuClassName="min-w-full sm:min-w-[420px]"
                    />
                    <div className="field-surface flex h-[50px] items-center gap-2 rounded-xl border px-3">
                      <input
                        value={candidate.ref}
                        onChange={(event) => updateCandidate(candidate.id, { ref: event.target.value })}
                        placeholder="직접 입력"
                        className="min-w-0 flex-1 bg-transparent text-sm text-stone-100 placeholder-stone-500 outline-none"
                      />
                      {candidate.ref && (
                        <button
                          type="button"
                          onClick={() => updateCandidate(candidate.id, { ref: '' })}
                          className="rounded-full p-1 text-stone-500 hover:bg-primary/10 hover:text-primary"
                          aria-label="후보 입력 지우기"
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                  {candidateIssues[candidate.id] && (
                    <p className="mt-2 rounded-lg border border-[#d7653d]/25 bg-[#d7653d]/10 px-3 py-2 text-[11px] font-bold text-[#ffb59e]">
                      {candidateIssues[candidate.id]}
                    </p>
                  )}
                </div>
              )
            })}
          </div>

          {validationMessage && (
            <p className="mt-3 rounded-xl border border-[#d7653d]/25 bg-[#d7653d]/10 px-3 py-2 text-xs leading-5 text-[#ffb59e]">
              {validationMessage}
            </p>
          )}

          <button
            type="button"
            onClick={addCandidate}
            className="mt-3 inline-flex h-9 items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 text-xs font-black text-primary hover:bg-primary/15"
          >
            <Plus size={14} />
            후보 추가
          </button>
        </section>
      </div>

      <div className="rounded-2xl border border-primary/10 bg-stone-950/25 p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <GitMerge size={16} className="text-primary" />
              <h3 className="text-sm font-black text-stone-50">개별 + 순차 dry-run</h3>
              {statusMeta && <StatusPill status={resultStatus} />}
            </div>
            <p className="mt-1 text-xs leading-5 text-stone-500">
              임시 작업공간에서만 충돌을 확인합니다. 원격 merge, commit, push는 수행하지 않으며, clean 순차 단계의 커밋은 로컬 임시 커밋입니다.
              캐시 무시를 켜면 기존 결과와 AI 리뷰를 재사용하지 않고 새 dry-run을 실행합니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex h-9 items-center gap-2 rounded-full border border-primary/10 bg-stone-950/35 px-3 text-xs font-bold text-stone-300">
              <input
                type="checkbox"
                checked={includeAiReview}
                onChange={(event) => setIncludeAiReview(event.target.checked)}
                className="accent-primary"
              />
              AI 리뷰
            </label>
            <label className="inline-flex h-9 items-center gap-2 rounded-full border border-[#79b8c5]/15 bg-stone-950/35 px-3 text-xs font-bold text-stone-300">
              <input
                type="checkbox"
                checked={forceRefresh}
                onChange={(event) => setForceRefresh(event.target.checked)}
                className="accent-[#79b8c5]"
              />
              캐시 무시
            </label>
            <select
              value={reviewStyle}
              onChange={(event) => setReviewStyle(event.target.value)}
              className="field-surface h-9 rounded-full border px-3 text-xs font-bold outline-none"
            >
              <option value="balanced">균형잡힌</option>
              <option value="concise">핵심만</option>
              <option value="detailed">자세하게</option>
            </select>
            {loading && (
              <button
                type="button"
                onClick={cancel}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-amber-400/25 px-3 text-xs font-black text-amber-200 hover:bg-amber-400/10"
              >
                취소
              </button>
            )}
            <button
              type="button"
              onClick={runPlan}
              disabled={!canRun || loading}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-black text-stone-950 transition-all hover:bg-[#ffc35c] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {loading ? <Clock size={15} className="animate-spin" /> : <GitMerge size={15} />}
              통합 머지 플랜 실행
            </button>
          </div>
        </div>

        {visibleError && (
          <p className="mt-3 rounded-xl border border-[#d7653d]/25 bg-[#d7653d]/10 px-3 py-2 text-xs text-[#ffb59e]">
            {visibleError}
          </p>
        )}

        <CommandPreviewPanel
          phase={progress?.phase || (result ? 'merge_plan_done' : null)}
          candidateCount={Math.max(1, candidates.filter(candidate => candidate.ref?.trim()).length)}
          open={commandGuideOpen}
          onToggle={() => setCommandGuideOpen(value => !value)}
        />

        {progress && (
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-stone-400">{progress.message}</span>
              {progress.elapsedSeconds > 0 && <span className="font-mono text-stone-500">{Math.round(progress.elapsedSeconds)}s</span>}
            </div>
            <div className="grid gap-2 md:grid-cols-6">
              {mergePlanStages.map((stage, index) => {
                const active = index === progressIndex && progress.status === 'running'
                const done = progress.status === 'completed' || index < progressIndex
                const failed = progress.status === 'failed' && index === progressIndex
                return (
                  <div
                    key={stage.key}
                    className={`rounded-xl border px-3 py-3 ${
                      failed
                        ? 'border-[#d7653d]/30 bg-[#d7653d]/10'
                        : active
                          ? 'border-primary/30 bg-primary/10'
                          : done
                            ? 'border-[#79b8c5]/15 bg-stone-950/30'
                            : 'border-primary/10 bg-stone-950/20 opacity-70'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-black ${
                        failed
                          ? 'bg-[#d7653d]/20 text-[#ff9b78]'
                          : done
                            ? 'bg-[#79b8c5]/15 text-[#b8edf5]'
                            : active
                              ? 'bg-primary/20 text-primary'
                              : 'bg-stone-800 text-stone-500'
                      }`}>
                        {done ? '완' : index + 1}
                      </span>
                      <span className="truncate text-xs font-black text-stone-100">{stage.label}</span>
                    </div>
                    <p className="mt-2 text-[11px] leading-5 text-stone-500">{stage.description}</p>
                  </div>
                )
              })}
            </div>
            <CandidateProgressQueue candidates={candidates} progress={progress} result={result} />
          </div>
        )}

        {result && (
          <div className="mt-4">
            <GitCommandLog result={result} />
          </div>
        )}
      </div>

      {result && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="space-y-3">
            <div className={`rounded-2xl border p-4 ${mergePlanStatusMeta[result.status]?.className || mergePlanStatusMeta.unknown.className}`}>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    {result.status === 'conflicts' ? <AlertTriangle size={17} /> : <GitMerge size={17} />}
                    <h3 className="text-sm font-black">결과 요약</h3>
                  </div>
                  <p className="mt-1 text-xs leading-5 opacity-80">
                    대상 {result.target_resolved?.short_sha || formatShortSha(result.target_resolved?.sha)} 기준, 후보 {result.candidates?.length || 0}개를 확인했습니다.
                    같은 후보를 개별 검사와 순차 검사 두 관점으로 나눠 표시합니다.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] font-black">
                  {result.cache_hit && (
                    <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-primary">
                      캐시 결과
                    </span>
                  )}
                  <span className="rounded-full border border-current/20 px-2 py-1">
                    개별 clean {result.summary_counts?.individual?.clean || 0}
                  </span>
                  <span className="rounded-full border border-current/20 px-2 py-1">
                    순차 blocker {result.summary_counts?.sequential?.blocked || 0}
                  </span>
                </div>
              </div>
            </div>

            <CollapsibleSection
              title="후보별 개별 결과"
              eyebrow="같은 대상 C에 각 후보를 따로 붙인 결과"
              count={`${(result.individual_results || []).length}개`}
              open={individualResultsOpen}
              onToggle={() => setIndividualResultsOpen(value => !value)}
            >
              <div className="space-y-2">
                {(result.individual_results || []).map(item => (
                  <ResultRow key={`individual-${item.candidate_id}`} item={item} mode="개별" />
                ))}
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="순차 시뮬레이션"
              eyebrow="후보 순서대로 누적해서 붙인 결과"
              count={`${(result.sequential_results || []).length}개`}
              open={sequentialResultsOpen}
              onToggle={() => setSequentialResultsOpen(value => !value)}
            >
              <div className="space-y-2">
                {(result.sequential_results || []).map(item => (
                  <ResultRow key={`sequential-${item.candidate_id || item.status}`} item={item} mode={`순서 ${item.order || '-'}`} />
                ))}
              </div>
            </CollapsibleSection>
          </section>

          <aside className="space-y-3">
            <MergePlanReviewPanel result={result} conflictFiles={conflictFiles} onForceRefresh={rerunWithoutCache} />
          </aside>
        </div>
      )}
    </div>
  )
}

export default MergePlanPanel
