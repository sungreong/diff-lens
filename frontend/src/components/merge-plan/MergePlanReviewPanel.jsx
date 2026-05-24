import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronRight, FileText, GitMerge, Sparkles, X } from 'lucide-react'

const textOf = (value) => {
  if (!value) return ''
  if (typeof value === 'string') return value
  return value.text || ''
}

const isTruncated = (value) => Boolean(value && typeof value === 'object' && value.truncated)

const collectConflictDetails = (result) => {
  const byPath = new Map()
  ;[...(result?.individual_results || []), ...(result?.sequential_results || [])].forEach(item => {
    ;(item.conflict_details || []).forEach(detail => {
      const path = detail.file_path
      if (!path) return
      const current = byPath.get(path)
      const isSequentialConflict = item.order && ['blocked', 'conflicts'].includes(item.status)
      if (!current || (isSequentialConflict && !current.seen_in?.some(seen => seen.mode === '순차'))) {
        byPath.set(path, { ...detail, seen_in: current?.seen_in || [] })
      }
      byPath.get(path).seen_in.push({
        mode: item.order ? '순차' : '개별',
        candidate: item.candidate_label || item.candidate_ref,
        order: item.order || null,
        status: item.status,
      })
    })
  })
  return [...byPath.values()]
}

const fallbackReview = (filePath) => ({
  file_path: filePath,
  why_conflict: '이 파일은 dry-run merge에서 충돌 파일로 확인됐습니다. 상세 diff 근거가 제한적이면 기준 쪽과 들어오는 후보 쪽 내용을 직접 비교해야 합니다.',
  decision: 'manual_review',
  decision_label: '수동 판단 필요',
  confidence: 'low',
  recommended_action: '상세 근거를 다시 수집하거나 기준 쪽/들어오는 후보 쪽 diff를 직접 비교해 보존할 동작을 정하세요.',
  resolution_plan: [
    '기준 쪽과 들어오는 후보 쪽 중 어느 변경이 기준 동작인지 먼저 정합니다.',
    '양쪽 변경을 합쳐야 하면 충돌 marker를 제거하고 의도한 최종 코드를 직접 작성합니다.',
    '파일 소유자 확인 후 같은 후보 순서로 dry-run을 재실행합니다.',
  ],
  checks: ['conflict marker 제거', '파일 단위 테스트 또는 관련 workflow smoke test 실행'],
  evidence: ['dry-run 결과의 conflict_files에 포함됐습니다.'],
})

const decisionMeta = {
  combine: { label: '양쪽 변경 합치기', tone: 'border-primary/25 bg-primary/10 text-primary' },
  keep_ours: { label: '기준 쪽 유지', tone: 'border-[#79b8c5]/25 bg-[#79b8c5]/10 text-[#b8edf5]' },
  accept_theirs: { label: '들어오는 후보 적용', tone: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100' },
  manual_review: { label: '수동 판단 필요', tone: 'border-amber-400/25 bg-amber-400/10 text-amber-100' },
}

const splitConflictMarker = (block) => {
  const ours = []
  const theirs = []
  let side = null
  textOf(block).split('\n').forEach(line => {
    const trimmed = line.trimStart()
    if (trimmed.startsWith('<<<<<<<')) {
      side = 'ours'
      return
    }
    if (trimmed.startsWith('=======')) {
      side = 'theirs'
      return
    }
    if (trimmed.startsWith('>>>>>>>')) {
      side = null
      return
    }
    if (side === 'ours') ours.push(line)
    if (side === 'theirs') theirs.push(line)
  })
  return { ours, theirs }
}

const codePreview = (lines, limit = 4) => {
  const picked = lines.filter(line => line.trim()).slice(0, limit)
  return picked.length ? picked.join('\n').slice(0, 520) : '(빈 변경)'
}

const deriveMergeContext = (review, detail) => {
  if (review?.base_side_label || review?.incoming_side_label || review?.merge_context_summary) {
    return {
      baseSideLabel: review.base_side_label || '기준 쪽',
      incomingSideLabel: review.incoming_side_label || '들어오는 후보 쪽',
      summary: review.merge_context_summary || '',
    }
  }
  const seen = detail?.seen_in || []
  const primary = seen.find(item => item.mode === '순차' && ['blocked', 'conflicts'].includes(item.status)) || seen[0] || {}
  const candidate = primary.candidate || '현재 후보'
  if (primary.mode === '순차') {
    const order = primary.order
    const baseSideLabel = order && order > 1
      ? `대상 C + 앞선 후보 1~${order - 1}까지 누적된 상태`
      : '대상 C 현재 상태'
    const incomingSideLabel = order
      ? String(candidate).replace(/\s/g, '') === `후보${order}` ? `${order}번째 후보` : `${order}번째 후보 ${candidate}`
      : `현재 후보 ${candidate}`
    return {
      baseSideLabel,
      incomingSideLabel,
      summary: `순차 dry-run에서 ${incomingSideLabel}를 ${baseSideLabel}에 붙이는 순간 충돌했습니다.`,
    }
  }
  return {
    baseSideLabel: '대상 C 현재 상태',
    incomingSideLabel: `후보 ${candidate}`,
    summary: `개별 dry-run에서 후보 ${candidate}를 대상 C에 붙이는 순간 충돌했습니다.`,
  }
}

const inlineHint = (lines) => {
  const first = lines.find(line => line.trim())?.trim()
  if (!first) return '빈 변경'
  return `\`${first.slice(0, 90)}${first.length > 90 ? '...' : ''}\``
}

const deriveRegionsFromDetail = (detail) => (detail?.conflict_marker_blocks || []).slice(0, 6).map(block => {
  const { ours, theirs } = splitConflictMarker(block)
  const hasOurs = ours.some(line => line.trim())
  const hasTheirs = theirs.some(line => line.trim())
  const lineRange = `${block.start_line || '?'}-${block.end_line || '?'}`
  let decision = 'manual_review'
  let recommendedAction = `lines ${lineRange}에서 기준 쪽/들어오는 후보 쪽을 직접 비교해 최종 코드를 정하세요.`
  if (hasOurs && hasTheirs) {
    decision = 'combine'
    recommendedAction = `lines ${lineRange}에서는 단순 선택하지 말고 기준 쪽의 ${inlineHint(ours)}와 들어오는 후보 쪽의 ${inlineHint(theirs)}를 같은 흐름으로 합치세요.`
  } else if (hasTheirs) {
    decision = 'accept_theirs'
    recommendedAction = `lines ${lineRange}에서는 들어오는 후보 쪽 변경을 적용하고 주변 제어 흐름을 검증하세요.`
  } else if (hasOurs) {
    decision = 'keep_ours'
    recommendedAction = `lines ${lineRange}에서는 기준 쪽 로직을 유지하고 marker를 제거하세요.`
  }
  const combined = `${ours.join('\n')}\n${theirs.join('\n')}`
  const rationale = []
  if (combined.includes('file_content') && (combined.includes('max_page_limit') || combined.includes('PDF_VLM_MIN_CHARS_PER_BATCH'))) {
    rationale.push('빈 텍스트 보호와 페이지/최소 글자 검증은 서로 다른 guard라 둘 다 보존하는 쪽이 안전합니다.')
  }
  if (combined.includes('return ')) {
    rationale.push('return 경로가 포함되어 있어 guard 순서가 뒤쪽 로직을 막지 않는지 확인해야 합니다.')
  }
  return {
    line_range: lineRange,
    decision,
    decision_label: decisionMeta[decision]?.label || '수동 판단 필요',
    recommended_action: recommendedAction,
    ours_preview: codePreview(ours),
    theirs_preview: codePreview(theirs),
    base_side_preview: codePreview(ours),
    incoming_side_preview: codePreview(theirs),
    rationale: rationale.length ? rationale : ['같은 라인 범위에서 양쪽 변경이 서로 다른 최종 내용을 만들고 있습니다.'],
  }
})

const deriveDecision = (review, detail) => {
  const regions = review?.conflict_regions?.length ? review.conflict_regions : deriveRegionsFromDetail(detail)
  const hasCombine = regions.some(region => region.decision === 'combine')
  const hasManual = regions.some(region => region.decision === 'manual_review')
  const first = regions[0] || {}
  const decision = review?.decision || (hasManual ? 'manual_review' : hasCombine ? 'combine' : first.decision || 'manual_review')
  return {
    decision,
    decisionLabel: review?.decision_label || decisionMeta[decision]?.label || first.decision_label || '수동 판단 필요',
    confidence: review?.confidence || (hasManual ? 'low' : 'medium'),
    recommendedAction: review?.recommended_action || first.recommended_action || '기준 쪽/들어오는 후보 쪽 근거를 비교해 최종 코드를 정하세요.',
    steps: review?.implementation_steps?.length ? review.implementation_steps : review?.resolution_plan || [],
    regions,
    suggestedFinalShape: review?.suggested_final_shape || '',
    context: deriveMergeContext(review, detail),
  }
}

function CodeBlock({ label, value }) {
  const text = textOf(value)
  if (!text) return null
  return (
    <details className="rounded-xl border border-primary/10 bg-black/20">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-black text-stone-100 marker:text-primary">
        {label}{isTruncated(value) ? ' · 일부만 표시' : ''}
      </summary>
      <pre className="max-h-72 overflow-auto border-t border-primary/10 p-3 text-[11px] leading-5 text-stone-300 custom-scrollbar">
        <code>{text}</code>
      </pre>
    </details>
  )
}

function SnippetLine({ line, lineNumber }) {
  const marker = line.startsWith('<<<<<<<') || line.startsWith('=======') || line.startsWith('>>>>>>>')
  return (
    <div className={`grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)] gap-3 px-3 py-0.5 ${
      marker ? 'bg-[#d7653d]/15 text-[#ffb59e]' : ''
    }`}>
      <span className="select-none text-right font-mono text-[10px] text-stone-600">{lineNumber}</span>
      <code className="min-w-0 whitespace-pre-wrap break-words font-mono text-[11px] leading-5">{line || ' '}</code>
    </div>
  )
}

function ConflictLocationSummary({ detail, onForceRefresh, onClose }) {
  const blocks = detail?.conflict_marker_blocks || []
  const diffText = textOf(detail?.combined_diff)
  const variantText = textOf(detail?.diff_variants?.ours) || textOf(detail?.diff_variants?.theirs) || textOf(detail?.diff_variants?.base)
  if (!detail?.file_path) {
    return (
      <div className="mb-4 rounded-2xl border border-amber-400/20 bg-amber-950/10 p-4 text-xs leading-5 text-amber-100/80">
        <p className="font-bold text-amber-100">이 결과에는 라인 단위 충돌 근거가 없습니다.</p>
        <p className="mt-1">
          이전 캐시 결과이거나 상세 근거 수집 전의 결과일 수 있습니다. conflict marker와 기준 쪽/들어오는 후보 쪽 근거는 dry-run 실행 순간에만 수집됩니다.
        </p>
        {onForceRefresh && (
          <button
            type="button"
            onClick={() => {
              onClose?.()
              onForceRefresh()
            }}
            className="mt-3 inline-flex h-9 items-center rounded-full border border-amber-400/25 bg-amber-400/10 px-3 text-xs font-black text-amber-100 hover:bg-amber-400/15"
          >
            캐시 무시로 다시 실행
          </button>
        )}
      </div>
    )
  }

  if (!blocks.length && !diffText && !variantText) {
    return (
      <div className="mb-4 rounded-2xl border border-primary/10 bg-stone-950/35 p-4 text-xs leading-5 text-stone-400">
        충돌 파일은 확인됐지만 이 파일에서 표시할 marker/diff snippet은 수집되지 않았습니다. 아래 공통 조상/기준 쪽/들어오는 후보 쪽 원문이 있으면 직접 비교하세요.
      </div>
    )
  }

  return (
    <section className="mb-4 rounded-2xl border border-[#d7653d]/25 bg-[#d7653d]/10 p-4">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#ffb59e]">구체적 충돌 위치</p>
          <p className="mt-1 text-xs leading-5 text-stone-300">
            conflict marker 기준 라인 범위입니다. Git marker에서 HEAD는 기준 쪽, 아래 블록은 들어오는 후보 쪽입니다.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-[#d7653d]/25 px-2 py-1 text-[10px] font-black text-[#ffb59e]">
          marker block {blocks.length || 0}개
        </span>
      </div>

      {blocks.length > 0 ? (
        <div className="space-y-3">
          {blocks.map((block, index) => {
            const start = block.context_start_line || block.start_line || 1
            const lines = textOf(block).split('\n')
            return (
              <div key={`${block.start_line}-${index}`} className="overflow-hidden rounded-xl border border-[#d7653d]/20 bg-black/25">
                <div className="flex items-center justify-between gap-2 border-b border-[#d7653d]/15 px-3 py-2">
                  <p className="font-mono text-xs font-black text-[#ffb59e]">
                    conflict #{index + 1} · lines {block.start_line}-{block.end_line}
                  </p>
                  {isTruncated(block) && <span className="text-[10px] font-bold text-stone-500">일부만 표시</span>}
                </div>
                <pre className="max-h-56 overflow-auto py-2 text-stone-300 custom-scrollbar">
                  {lines.map((line, lineIndex) => (
                    <SnippetLine key={`${lineIndex}-${line}`} line={line} lineNumber={start + lineIndex} />
                  ))}
                </pre>
              </div>
            )
          })}
        </div>
      ) : (
        <pre className="max-h-56 overflow-auto rounded-xl border border-[#d7653d]/15 bg-black/25 p-3 text-[11px] leading-5 text-stone-300 custom-scrollbar">
          <code>{(diffText || variantText).slice(0, 2500)}</code>
        </pre>
      )}
    </section>
  )
}

function ReviewBullets({ title, items }) {
  if (!items?.length) return null
  return (
    <div>
      <p className="text-[11px] font-black uppercase tracking-[0.12em] text-stone-500">{title}</p>
      <ul className="mt-2 space-y-1 text-xs leading-5 text-stone-300">
        {items.map(item => <li key={item}>- {item}</li>)}
      </ul>
    </div>
  )
}

function DecisionCard({ review, detail }) {
  const decision = deriveDecision(review, detail)
  const meta = decisionMeta[decision.decision] || decisionMeta.manual_review
  return (
    <section className="mb-4 rounded-2xl border border-primary/20 bg-primary/10 p-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-primary">추천 조치</p>
          <h3 className="mt-1 text-lg font-black text-stone-50">{decision.decisionLabel}</h3>
          <p className="mt-2 text-sm font-bold leading-6 text-stone-100">{decision.recommendedAction}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <span className={`rounded-full border px-3 py-1 text-[11px] font-black ${meta.tone}`}>{meta.label}</span>
          <span className="rounded-full border border-stone-500/20 bg-stone-900/40 px-3 py-1 text-[11px] font-black text-stone-300">
            confidence {decision.confidence}
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-xl border border-[#79b8c5]/20 bg-[#79b8c5]/10 p-3">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#b8edf5]">기준 쪽</p>
          <p className="mt-1 text-xs font-bold leading-5 text-stone-100">{decision.context.baseSideLabel}</p>
        </div>
        <div className="rounded-xl border border-primary/20 bg-primary/10 p-3">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-primary">들어오는 후보 쪽</p>
          <p className="mt-1 text-xs font-bold leading-5 text-stone-100">{decision.context.incomingSideLabel}</p>
        </div>
      </div>
      {decision.context.summary && (
        <p className="mt-2 rounded-xl border border-primary/10 bg-black/20 px-3 py-2 text-xs leading-5 text-stone-300">
          {decision.context.summary}
        </p>
      )}

      {decision.steps.length > 0 && (
        <div className="mt-4 rounded-xl border border-primary/10 bg-black/20 p-3">
          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-stone-500">바로 할 일</p>
          <ol className="mt-2 space-y-1 text-xs leading-5 text-stone-300">
            {decision.steps.slice(0, 5).map((step, index) => <li key={`${index}-${step}`}>{index + 1}. {step}</li>)}
          </ol>
        </div>
      )}

      {decision.regions.length > 0 && (
        <div className="mt-3 space-y-2">
          {decision.regions.slice(0, 3).map(region => (
            <details key={region.line_range} className="rounded-xl border border-primary/10 bg-black/20">
              <summary className="cursor-pointer select-none px-3 py-2 text-xs font-black text-stone-100 marker:text-primary">
                lines {region.line_range} · {region.decision_label || decisionMeta[region.decision]?.label || '판단'}
              </summary>
              <div className="grid gap-3 border-t border-primary/10 p-3 xl:grid-cols-2">
                <div className="min-w-0">
                  <p className="mb-1 text-[10px] font-black uppercase text-stone-500">기준 쪽 변경</p>
                  <pre className="max-h-44 overflow-auto rounded-lg bg-black/25 p-2 text-[11px] leading-5 text-stone-300 custom-scrollbar">{region.base_side_preview || region.ours_preview}</pre>
                </div>
                <div className="min-w-0">
                  <p className="mb-1 text-[10px] font-black uppercase text-stone-500">들어오는 후보 쪽 변경</p>
                  <pre className="max-h-44 overflow-auto rounded-lg bg-black/25 p-2 text-[11px] leading-5 text-stone-300 custom-scrollbar">{region.incoming_side_preview || region.theirs_preview}</pre>
                </div>
                <div className="xl:col-span-2 text-xs leading-5 text-stone-300">
                  <p className="font-bold text-primary">{region.recommended_action}</p>
                  {(region.rationale || []).slice(0, 2).map(item => <p key={item} className="mt-1 text-stone-400">- {item}</p>)}
                </div>
              </div>
            </details>
          ))}
        </div>
      )}

      {decision.suggestedFinalShape && (
        <pre className="mt-3 whitespace-pre-wrap rounded-xl border border-primary/10 bg-black/20 p-3 text-xs leading-5 text-stone-300">
          {decision.suggestedFinalShape}
        </pre>
      )}
    </section>
  )
}

function ConflictDetailModal({ result, conflictFiles, onClose, onForceRefresh }) {
  const conflictDetails = useMemo(() => collectConflictDetails(result), [result])
  const reviews = result?.ai_review?.file_reviews || []
  const fileList = conflictFiles.length ? conflictFiles : reviews.map(review => review.file_path).filter(Boolean)
  const [selectedFile, setSelectedFile] = useState(fileList[0] || '')
  const activeFile = selectedFile || fileList[0] || ''
  const detail = conflictDetails.find(item => item.file_path === activeFile) || {}
  const review = reviews.find(item => item.file_path === activeFile) || fallbackReview(activeFile)

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="modal-shell flex h-[86vh] w-full max-w-7xl min-w-0 flex-col overflow-hidden rounded-3xl border border-primary/20 bg-stone-950 text-stone-200">
        <div className="flex items-start justify-between gap-4 border-b border-primary/10 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-primary">
              <GitMerge size={14} />
              Merge conflict review
            </div>
            <h2 className="mt-1 truncate text-xl font-black text-stone-50">충돌 상세 분석</h2>
            <p className="mt-1 text-xs leading-5 text-stone-500">
              AI 리뷰는 dry-run에서 수집한 conflict marker, combined diff, 공통 조상/기준 쪽/들어오는 후보 쪽 stage를 근거로 작성됩니다.
            </p>
          </div>
          <button type="button" onClick={onClose} className="action-ghost shrink-0 p-2" aria-label="충돌 상세 닫기">
            <X size={18} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="min-h-0 border-b border-primary/10 p-4 lg:border-b-0 lg:border-r">
            <p className="mb-3 text-xs font-black text-stone-400">충돌 파일 {fileList.length}개</p>
            <div className="max-h-full space-y-2 overflow-y-auto pr-1 custom-scrollbar">
              {fileList.map(file => (
                <button
                  key={file}
                  type="button"
                  onClick={() => setSelectedFile(file)}
                  className={`flex w-full min-w-0 items-center gap-2 rounded-xl border px-3 py-3 text-left ${
                    activeFile === file
                      ? 'border-[#d7653d]/35 bg-[#d7653d]/10 text-[#ffb59e]'
                      : 'border-primary/10 bg-stone-950/35 text-stone-300 hover:border-primary/20'
                  }`}
                >
                  <FileText size={14} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs" title={file}>{file}</span>
                  <ChevronRight size={14} className="shrink-0 opacity-60" />
                </button>
              ))}
            </div>
          </aside>

          <main className="min-h-0 overflow-y-auto p-5 custom-scrollbar">
            <div className="mb-4 rounded-2xl border border-[#d7653d]/20 bg-[#d7653d]/10 p-4">
              <p className="truncate font-mono text-sm font-black text-[#ffb59e]" title={activeFile}>{activeFile || '충돌 파일 없음'}</p>
              <p className="mt-2 text-sm font-bold text-stone-100">{review.why_conflict}</p>
              {detail.status && <p className="mt-2 font-mono text-[11px] text-stone-500">{detail.status}</p>}
            </div>
            <DecisionCard review={review} detail={detail} />
            <ConflictLocationSummary detail={detail} onForceRefresh={onForceRefresh} onClose={onClose} />

            <div className="grid gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
              <section className="space-y-4 rounded-2xl border border-primary/10 bg-stone-950/35 p-4">
                <ReviewBullets title="해결 순서 제안" items={review.resolution_plan} />
                <ReviewBullets title="검증 체크" items={review.checks} />
                <ReviewBullets title="판단 근거" items={review.evidence} />
                {detail.seen_in?.length > 0 && (
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.12em] text-stone-500">발생 위치</p>
                    <div className="mt-2 space-y-1">
                      {detail.seen_in.map((item, index) => (
                        <div key={`${item.mode}-${item.candidate}-${index}`} className="rounded-lg border border-primary/10 bg-black/20 px-3 py-2 text-xs text-stone-300">
                          {item.mode} · {item.candidate || '후보'} · {item.status}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              <section className="space-y-3">
                {(detail.conflict_marker_blocks || []).map(block => (
                  <CodeBlock
                    key={`${activeFile}-${block.start_line}`}
                    label={`Conflict marker lines ${block.start_line}-${block.end_line}`}
                    value={block}
                  />
                ))}
                <CodeBlock label="git diff --cc" value={detail.combined_diff} />
                <div className="grid gap-3 xl:grid-cols-3">
                  <CodeBlock label="git diff --base · 공통 조상" value={detail.diff_variants?.base} />
                  <CodeBlock label="git diff --ours · 기준 쪽" value={detail.diff_variants?.ours} />
                  <CodeBlock label="git diff --theirs · 들어오는 후보 쪽" value={detail.diff_variants?.theirs} />
                </div>
                <CodeBlock label="git ls-files -u" value={detail.unmerged_index} />
                <div className="grid gap-3 xl:grid-cols-3">
                  <CodeBlock label="base (:1) · 공통 조상" value={detail.stages?.base} />
                  <CodeBlock label="ours (:2) · 기준 쪽" value={detail.stages?.ours} />
                  <CodeBlock label="theirs (:3) · 들어오는 후보 쪽" value={detail.stages?.theirs} />
                </div>
                {!detail.file_path && (
                  <div className="rounded-2xl border border-primary/10 bg-stone-950/35 p-4 text-xs leading-5 text-stone-400">
                    상세 diff 근거가 없는 결과입니다. 이전 캐시 결과라면 통합 머지 플랜을 다시 실행하면 더 깊은 충돌 근거가 수집됩니다.
                  </div>
                )}
              </section>
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

export default function MergePlanReviewPanel({ result, conflictFiles, onForceRefresh }) {
  const [detailOpen, setDetailOpen] = useState(false)
  const review = result?.ai_review
  const fileReviews = review?.file_reviews || []
  const conflictDetails = useMemo(() => collectConflictDetails(result), [result])
  const hasDetails = conflictFiles.length > 0 || fileReviews.length > 0
  const missingDetailedEvidence = conflictFiles.length > 0 && conflictDetails.length === 0
  const reviewModeLabel = review?.mode === 'llm'
    ? 'LLM 생성'
    : review?.mode
      ? 'fallback'
      : ''

  return (
    <>
      {conflictFiles.length > 0 && (
        <div className="rounded-2xl border border-[#d7653d]/25 bg-[#d7653d]/10 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex min-w-0 items-center gap-2 text-sm font-black text-[#ffb59e]">
              <AlertTriangle size={15} />
              충돌 파일
            </h3>
            <button
              type="button"
              onClick={() => missingDetailedEvidence ? onForceRefresh?.() : setDetailOpen(true)}
              className="shrink-0 rounded-full border border-[#d7653d]/25 px-2 py-1 text-[11px] font-black text-[#ffb59e] hover:bg-[#d7653d]/10"
            >
              {missingDetailedEvidence ? '다시 수집' : '상세 보기'}
            </button>
          </div>
          {missingDetailedEvidence && (
            <p className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-100/85">
              이 결과는 충돌 파일명만 있고 라인/diff 근거가 없습니다. 캐시 무시로 새 dry-run을 실행해야 실제 conflict marker와 기준 쪽/들어오는 후보 쪽 diff를 볼 수 있습니다.
            </p>
          )}
          <div className="mt-3 space-y-2">
            {conflictFiles.slice(0, 8).map(file => (
              <div key={file} className="truncate rounded-xl bg-stone-950/35 px-3 py-2 font-mono text-xs text-stone-200" title={file}>
                {file}
              </div>
            ))}
          </div>
        </div>
      )}

      {review && (
        <div className="rounded-2xl border border-primary/20 bg-stone-950/35 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex min-w-0 items-center gap-2 text-sm font-black text-stone-50">
              <Sparkles size={15} className="shrink-0 text-primary" />
              AI 리뷰
            </h3>
            <div className="flex shrink-0 items-center gap-1">
              {result?.cache_hit && (
                <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-black text-primary">
                  캐시
                </span>
              )}
              {reviewModeLabel && (
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${
                  review?.mode === 'llm'
                    ? 'border-[#79b8c5]/25 text-[#b8edf5]'
                    : 'border-amber-400/25 text-amber-200'
                }`}>
                  {reviewModeLabel}
                </span>
              )}
            </div>
          </div>
          <p className="mt-2 text-sm font-black text-primary">{review.headline}</p>
          <p className="mt-2 text-xs leading-5 text-stone-400">{review.summary}</p>
          {review.first_blocker_note && (
            <p className="mt-2 rounded-xl border border-[#d7653d]/20 bg-[#d7653d]/10 px-3 py-2 text-xs leading-5 text-[#ffb59e]">
              {review.first_blocker_note}
            </p>
          )}
          {missingDetailedEvidence && (
            <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-3 text-xs leading-5 text-amber-100/85">
              <p className="font-black text-amber-100">상세 diff가 없는 이전 결과입니다.</p>
              <p className="mt-1">
                현재 화면의 fallback 리뷰는 파일명만 근거로 만든 보수적 안내입니다. 아래 버튼으로 새 dry-run을 실행하면 conflict marker, combined diff, 공통 조상/기준 쪽/들어오는 후보 쪽 stage를 다시 수집합니다.
              </p>
            </div>
          )}
          {(review.next_actions || []).length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] font-black uppercase text-stone-500">다음 액션</p>
              <ul className="mt-2 space-y-1 text-xs leading-5 text-stone-300">
                {review.next_actions.slice(0, 3).map(action => <li key={action}>- {action}</li>)}
              </ul>
            </div>
          )}
          {hasDetails && (
            <button
              type="button"
              onClick={() => missingDetailedEvidence ? onForceRefresh?.() : setDetailOpen(true)}
              className="mt-4 inline-flex h-9 items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 text-xs font-black text-primary hover:bg-primary/15"
            >
              {missingDetailedEvidence ? '상세 diff 다시 수집' : '파일별 해결안 / diff 열기'}
            </button>
          )}
        </div>
      )}

      {detailOpen && (
        <ConflictDetailModal
          result={result}
          conflictFiles={conflictFiles}
          onClose={() => setDetailOpen(false)}
          onForceRefresh={onForceRefresh}
        />
      )}
    </>
  )
}
