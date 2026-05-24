export const mergePlanStatusMeta = {
  clean: {
    label: '충돌 없음',
    className: 'border-[#79b8c5]/30 bg-[#79b8c5]/10 text-[#b8edf5]',
  },
  conflicts: {
    label: '충돌 있음',
    className: 'border-[#d7653d]/35 bg-[#d7653d]/10 text-[#ff9b78]',
  },
  unknown: {
    label: '확인 불가',
    className: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  },
  running: {
    label: '실행 중',
    className: 'border-primary/30 bg-primary/10 text-primary',
  },
}

export const mergePlanStages = [
  { key: 'merge_plan_prepare', label: '준비', description: '요청과 저장소 설정을 확인합니다.' },
  { key: 'resolving_refs', label: 'SHA 잠금', description: '대상과 후보 ref를 실제 커밋으로 고정합니다.' },
  { key: 'individual_checks', label: '개별 확인', description: '각 후보를 대상에 단독으로 붙여봅니다.' },
  { key: 'sequential_checks', label: '순차 확인', description: '후보 순서대로 누적 병합을 시뮬레이션합니다.' },
  { key: 'merge_plan_review', label: 'AI 리뷰', description: '충돌 원인과 다음 액션을 정리합니다.' },
  { key: 'merge_plan_done', label: '완료', description: '결과를 화면에 표시합니다.' },
]

export const formatShortSha = (value) => (value ? String(value).slice(0, 8) : '')

export const findRefOption = (optionGroups = [], value = '') => {
  const target = String(value || '').trim()
  if (!target) return null
  return optionGroups
    .flatMap(group => group.options || [])
    .find(option => option.value === target) || null
}

export const buildResolvedPreview = (option, value) => {
  const sha = option?.sha || option?.raw?.sha || option?.raw?.full_sha || null
  if (!sha) return null
  return {
    type: option?.raw?.type || 'ref',
    short_sha: option?.shortSha || option?.raw?.short_sha || formatShortSha(sha),
    sha,
    title: option?.raw?.title || option?.label || value,
  }
}

export const buildMergePlanPayload = ({
  settings,
  targetRef,
  targetOption,
  candidates,
  optionGroups,
  includeAiReview,
  reviewStyle,
  forceRefresh = false,
}) => {
  const targetSha = targetOption?.sha || targetOption?.raw?.sha || targetOption?.raw?.full_sha || null
  return {
    repo_id: settings.repoId,
    llm_config_id: settings.llmConfigId,
    tracing_config_id: settings.tracingConfigId,
    git_url: settings.gitUrl,
    git_token: settings.gitToken,
    project_id: settings.projectId,
    branch: settings.branch,
    target_ref: targetRef,
    target_sha: targetSha,
    fail_on_ref_drift: true,
    include_ai_review: includeAiReview,
    review_style: reviewStyle,
    force_refresh: forceRefresh,
    openai_api_key: settings.openaiApiKey || null,
    openai_base_url: settings.openaiBaseUrl || null,
    openai_model: settings.openaiModel || null,
    langfuse_public_key: settings.langfusePublicKey || null,
    langfuse_secret_key: settings.langfuseSecretKey || null,
    langfuse_host: settings.langfuseHost || null,
    candidates: candidates
      .filter(candidate => candidate.ref?.trim())
      .map((candidate, index) => {
        const option = findRefOption(optionGroups, candidate.ref)
        const sha = option?.sha || option?.raw?.sha || option?.raw?.full_sha || null
        return {
          id: candidate.id || `candidate-${index + 1}`,
          label: candidate.label || candidate.ref,
          ref: candidate.ref,
          sha,
        }
      }),
  }
}

export const collectConflictFiles = (result) => {
  const files = []
  ;[...(result?.individual_results || []), ...(result?.sequential_results || [])].forEach(item => {
    ;(item.conflict_files || []).forEach(file => {
      if (file && !files.includes(file)) files.push(file)
    })
  })
  return files
}

export const candidateResultStatusLabel = (status) => {
  if (status === 'clean') return 'clean'
  if (status === 'conflicts') return 'conflict'
  if (status === 'blocked') return 'blocked'
  if (status === 'not_run_after_blocker') return 'skipped'
  if (status === 'not_run_after_unknown') return 'skipped'
  return 'unknown'
}
