import { Download, FileText, Sparkles, X } from 'lucide-react'
import AiMarkdown from '../AiMarkdown'
import { formatDuration, promptStyleOptions, riskCounts, riskPromptStageMeta } from './riskReviewUtils'

const RiskReviewModal = ({
  filesWithRisks,
  baseCommit,
  targetCommit,
  reviewState,
  reviewActions,
}) => {
  if (!reviewState.riskReviewModalOpen) return null

  const counts = riskCounts(filesWithRisks)
  const hasPrompt = Boolean(reviewState.generatedPrompt)
  const isPromptLoading = Boolean(reviewState.loadingRiskPrompt)
  const isReviewRunning = Boolean(reviewState.loadingReviewRun || reviewState.reviewRunProgress?.status === 'running')

  return (
    <div className="modal-backdrop fixed inset-0 z-[1000] flex items-center justify-center p-2 sm:p-4">
      <div className="modal-shell flex h-[min(92dvh,900px)] w-[calc(100vw-1rem)] max-w-[1500px] flex-col overflow-hidden rounded-[1.75rem] sm:w-[94vw] xl:w-[86vw] 2xl:w-[78vw]">
        <div className="modal-header flex items-center justify-between px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="shrink-0 rounded-xl border border-primary/20 bg-primary/15 p-2">
              <FileText size={18} className="text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-stone-50">AI 검토 요청과 실행</h3>
              <p className="text-xs text-stone-400">{filesWithRisks.length}개 리스크 파일 포함 · 프롬프트 생성 후 앱 안에서 바로 실행 가능</p>
            </div>
          </div>
          <button
            type="button"
            onClick={reviewActions.closeRiskReviewModal}
            className="action-ghost p-2"
            title="닫기"
          >
            <X size={18} className="text-slate-400" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-3 custom-scrollbar sm:p-5 lg:p-6">
          {!hasPrompt && !isPromptLoading ? (
            <div className="space-y-4">
              <div className="mb-6 text-center">
                <h4 className="mb-2 text-lg font-semibold text-stone-50">검토 대상 파일 목록</h4>
                <p className="text-sm text-stone-400">아래 파일들에서 잠재적 리스크가 감지되었습니다. 확인 후 프롬프트를 생성하세요.</p>
              </div>

              <div className="mb-4 flex flex-wrap justify-center gap-4">
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2">
                  <span className="font-bold text-red-400">HIGH</span>
                  <span className="ml-2 text-slate-400">{counts.high}개</span>
                </div>
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-2">
                  <span className="font-bold text-amber-400">MEDIUM</span>
                  <span className="ml-2 text-slate-400">{counts.medium}개</span>
                </div>
                <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-4 py-2">
                  <span className="font-bold text-yellow-400">LOW</span>
                  <span className="ml-2 text-slate-400">{counts.low}개</span>
                </div>
              </div>

              <div className="surface-card max-h-[45vh] overflow-auto rounded-xl custom-scrollbar">
                <table className="data-table w-full min-w-[760px] text-xs">
                  <thead className="sticky top-0">
                    <tr>
                      <th className="w-8 px-3 py-2 text-left font-medium text-slate-400">#</th>
                      <th className="px-3 py-2 text-left font-medium text-slate-400">파일 경로</th>
                      <th className="px-3 py-2 text-left font-medium text-slate-400">리스크 유형</th>
                      <th className="w-20 px-3 py-2 text-center font-medium text-slate-400">심각도</th>
                      <th className="px-3 py-2 text-left font-medium text-slate-400">위치</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {filesWithRisks.map((file, idx) => (
                      <tr key={`${file.path}-${idx}`} className="hover:bg-slate-800/30">
                        <td className="px-3 py-2 text-slate-500">{idx + 1}</td>
                        <td className="px-3 py-2 font-mono text-[11px] text-slate-300 break-all">{file.path}</td>
                        <td className="max-w-[200px] px-3 py-2 text-slate-400">
                          <div className="truncate" title={file.risk.originalContent}>{file.risk.riskType}</div>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            file.risk.severity === 'HIGH' ? 'bg-red-500/20 text-red-400' :
                            file.risk.severity === 'MEDIUM' ? 'bg-amber-500/20 text-amber-400' :
                            'bg-yellow-500/20 text-yellow-400'
                          }`}>
                            {file.risk.severity}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-[10px] text-slate-500 break-all">{file.risk.location}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="surface-card flex flex-col justify-between gap-3 rounded-xl p-3 text-xs text-stone-400 md:flex-row md:items-center">
                <div className="flex flex-wrap items-center gap-4">
                  <span>분석 범위: <code className="text-slate-300">{baseCommit?.slice(0, 8) || 'N/A'}</code>{' -> '}<code className="text-slate-300">{targetCommit?.slice(0, 8) || 'HEAD'}</code></span>
                  <span>총 {filesWithRisks.length}개 파일</span>
                </div>
                <button
                  type="button"
                  onClick={reviewActions.copyRiskListAsMarkdown}
                  className="action-ghost px-3 py-1 text-[11px]"
                >
                  <FileText size={14} />
                  목록 MD 복사
                </button>
              </div>

              <div className="surface-card rounded-xl p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-white">프롬프트 스타일</span>
                  <span className="text-xs text-slate-500">생성될 프롬프트의 상세도를 선택하세요</span>
                </div>
                <div className="flex flex-col gap-2 md:flex-row">
                  {promptStyleOptions.map(option => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => reviewActions.setPromptStyle(option.key)}
                      className={`flex-1 rounded-lg border px-4 py-3 text-left transition-all duration-200 ${
                        reviewState.promptStyle === option.key
                          ? 'border-primary/40 bg-primary/15 ring-2 ring-primary/15'
                          : 'border-primary/10 bg-stone-950/35 hover:border-primary/25 hover:bg-primary/10'
                      }`}
                    >
                      <div className="mb-1 flex items-center gap-2">
                        <span className={`font-medium ${reviewState.promptStyle === option.key ? 'text-purple-300' : 'text-white'}`}>
                          {option.label}
                        </span>
                        {reviewState.promptStyle === option.key && (
                          <span className="ml-auto rounded-full bg-primary/20 px-2 py-0.5 text-xs text-primary">선택됨</span>
                        )}
                      </div>
                      <p className="text-[11px] leading-relaxed text-slate-400">{option.description}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : isPromptLoading ? (
            <div className="h-full min-h-[520px] space-y-5">
              <div className="surface-card rounded-2xl border border-sky-400/20 bg-sky-950/10 p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-sky-300/25 border-t-sky-300" />
                      <h4 className="text-base font-semibold text-stone-50">검토 요청 프롬프트를 만들고 있습니다</h4>
                    </div>
                    <p className="text-sm leading-relaxed text-stone-400">
                      {reviewState.riskPromptProgress?.message || '리스크 파일과 변경 근거를 정리하고 있습니다.'}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-right">
                    <div className="rounded-xl border border-primary/10 bg-stone-950/40 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-stone-500">elapsed</p>
                      <p className="text-sm font-bold text-stone-100">{formatDuration(reviewState.riskPromptProgress?.elapsedSeconds || 0)}</p>
                    </div>
                    <div className="rounded-xl border border-primary/10 bg-stone-950/40 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-stone-500">files</p>
                      <p className="text-sm font-bold text-stone-100">
                        {Math.min(reviewState.riskPromptProgress?.current || 0, reviewState.riskPromptProgress?.total || filesWithRisks.length)}
                        <span className="text-stone-500"> / {reviewState.riskPromptProgress?.total || filesWithRisks.length}</span>
                      </p>
                    </div>
                  </div>
                </div>
                <div className="mt-5 h-2 overflow-hidden rounded-full border border-primary/10 bg-stone-950/70">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-sky-300 via-primary to-amber-300 transition-all duration-500"
                    style={{
                      width: `${reviewState.riskPromptProgress?.total
                        ? Math.min(96, Math.max(8, Math.round(((reviewState.riskPromptProgress.current || 0) / reviewState.riskPromptProgress.total) * 100)))
                        : 30}%`,
                    }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.15fr]">
                <div className="surface-card rounded-2xl p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h5 className="text-sm font-semibold text-stone-100">진행 단계</h5>
                    <span className="status-pill px-2 py-1 text-[11px]">
                      {promptStyleOptions.find(option => option.key === reviewState.promptStyle)?.label || '균형잡힌'}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {riskPromptStageMeta.map((stage, idx) => {
                      const activeIdx = Math.max(0, riskPromptStageMeta.findIndex(item => item.key === reviewState.riskPromptProgress?.stage))
                      const isDone = idx < activeIdx
                      const isActive = idx === activeIdx
                      return (
                        <div
                          key={stage.key}
                          className={`rounded-xl border p-3 transition-colors ${
                            isActive
                              ? 'border-sky-300/35 bg-sky-300/10'
                              : isDone
                                ? 'border-emerald-300/20 bg-emerald-300/5'
                                : 'border-primary/10 bg-stone-950/25'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
                              isActive
                                ? 'bg-sky-300 text-stone-950'
                                : isDone
                                  ? 'bg-emerald-300/20 text-emerald-200'
                                  : 'bg-stone-900 text-stone-500'
                            }`}>
                              {isDone ? '완' : idx + 1}
                            </span>
                            <span className="text-sm font-semibold text-stone-100">{stage.label}</span>
                          </div>
                          <p className="mt-1 pl-8 text-xs leading-relaxed text-stone-500">{stage.description}</p>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="surface-card min-h-0 rounded-2xl p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h5 className="text-sm font-semibold text-stone-100">준비 중인 파일</h5>
                      <p className="text-xs text-stone-500">프롬프트에 포함될 리스크 파일을 순서대로 정리합니다.</p>
                    </div>
                    {filesWithRisks.length > 8 && (
                      <span className="status-pill px-2 py-1 text-[11px]">외 {filesWithRisks.length - 8}개</span>
                    )}
                  </div>
                  <div className="max-h-[310px] space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                    {filesWithRisks.slice(0, 8).map((file, idx) => {
                      const prepared = idx < (reviewState.riskPromptProgress?.current || 0)
                      return (
                        <div
                          key={`${file.path}-${idx}`}
                          className={`rounded-xl border px-3 py-2 transition-colors ${
                            prepared
                              ? 'border-sky-300/25 bg-sky-300/10'
                              : 'border-primary/10 bg-stone-950/25'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate font-mono text-xs text-stone-100" title={file.path}>{file.path}</p>
                              <p className="mt-1 truncate text-[11px] text-stone-500" title={file.risk.originalContent}>
                                {file.risk.riskType}
                              </p>
                            </div>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              file.risk.severity === 'HIGH' ? 'bg-red-500/20 text-red-300' :
                              file.risk.severity === 'MEDIUM' ? 'bg-amber-500/20 text-amber-300' :
                              'bg-yellow-500/15 text-yellow-200'
                            }`}>
                              {file.risk.severity}
                            </span>
                          </div>
                          <div className="mt-2 flex items-center gap-2 text-[11px]">
                            <span className={`h-1.5 w-1.5 rounded-full ${prepared ? 'bg-sky-300' : 'bg-stone-700'}`} />
                            <span className={prepared ? 'text-sky-200' : 'text-stone-500'}>
                              {prepared ? '근거 정리됨' : '대기 중'}
                            </span>
                            <span className="ml-auto text-stone-600">{idx + 1}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold text-white">AI가 정리한 검토 요청 프롬프트</h4>
                  <p className="mt-1 text-xs text-stone-500">아래 문서를 외부 도구에 복사하거나, 바로 AI 검토 실행으로 결과를 확인할 수 있습니다.</p>
                  {reviewState.riskPromptCacheInfo && (
                    <p className="mt-1 text-xs text-sky-200">
                      캐시 재사용
                      {reviewState.riskPromptCacheInfo.hits ? ` ${reviewState.riskPromptCacheInfo.hits}회` : ''}
                      {reviewState.riskPromptCacheInfo.cacheKey ? ` · ${reviewState.riskPromptCacheInfo.cacheKey}` : ''}
                      {reviewState.riskPromptCacheInfo.waited ? ' · 진행 중이던 동일 요청 이어받음' : ''}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => reviewActions.setGeneratedPrompt('')}
                  className="shrink-0 text-xs text-slate-400 transition-colors hover:text-white"
                >
                  파일 목록으로 돌아가기
                </button>
              </div>
              <div className={`surface-card overflow-y-auto whitespace-pre-wrap rounded-xl p-4 font-mono text-xs leading-relaxed text-stone-300 custom-scrollbar ${
                reviewState.reviewRunResult || reviewState.reviewRunProgress ? 'max-h-[clamp(220px,30vh,360px)]' : 'max-h-[clamp(320px,58vh,620px)]'
              }`}>
                {reviewState.generatedPrompt}
              </div>

              {(reviewState.loadingReviewRun || reviewState.reviewRunProgress) && (
                <div className={`surface-card rounded-2xl border p-4 ${
                  reviewState.reviewRunProgress?.status === 'failed' || reviewState.reviewRunProgress?.status === 'cancelled' || reviewState.reviewRunProgress?.status === 'interrupted'
                    ? 'border-red-400/25 bg-red-950/10'
                    : reviewState.reviewRunProgress?.status === 'done'
                      ? 'border-emerald-300/25 bg-emerald-950/10'
                      : 'border-sky-300/25 bg-sky-950/10'
                }`}>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        {isReviewRunning ? (
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-sky-300/25 border-t-sky-300" />
                        ) : (
                          <span className={`h-2.5 w-2.5 rounded-full ${
                            reviewState.reviewRunProgress?.status === 'done' ? 'bg-emerald-300' :
                            reviewState.reviewRunProgress?.status === 'failed' ? 'bg-red-300' : 'bg-stone-500'
                          }`} />
                        )}
                        <h5 className="text-sm font-semibold text-stone-100">
                          {reviewState.reviewRunProgress?.status === 'done' ? 'AI 검토 완료' : 'AI 검토 실행'}
                        </h5>
                      </div>
                      <p className="text-sm leading-relaxed text-stone-400">
                        {reviewState.reviewRunProgress?.message || '프롬프트를 실제 AI 검토로 실행하고 있습니다.'}
                      </p>
                      <p className="text-xs text-stone-500">
                        이 실행도 백그라운드 job으로 처리되며, 같은 프롬프트와 모델이면 캐시를 재사용합니다.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-right">
                      <div className="rounded-xl border border-primary/10 bg-stone-950/40 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-stone-500">elapsed</p>
                        <p className="text-sm font-bold text-stone-100">{formatDuration(reviewState.reviewRunProgress?.elapsedSeconds || 0)}</p>
                      </div>
                      <div className="rounded-xl border border-primary/10 bg-stone-950/40 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-stone-500">cache</p>
                        <p className="text-sm font-bold text-stone-100">
                          {reviewState.reviewRunCacheInfo?.hits ? `${reviewState.reviewRunCacheInfo.hits}회` : (reviewState.reviewRunCacheInfo?.cacheKey ? '준비됨' : '새 실행')}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full border border-primary/10 bg-stone-950/70">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        reviewState.reviewRunProgress?.status === 'done'
                          ? 'bg-emerald-300'
                          : reviewState.reviewRunProgress?.status === 'failed'
                            ? 'bg-red-300'
                            : 'bg-gradient-to-r from-sky-300 via-primary to-amber-300'
                      }`}
                      style={{
                        width: `${reviewState.reviewRunProgress?.total
                          ? Math.min(100, Math.max(8, Math.round(((reviewState.reviewRunProgress.current || 0) / reviewState.reviewRunProgress.total) * 100)))
                          : 20}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {reviewState.reviewRunResult && (
                <div className="surface-card overflow-hidden rounded-2xl border border-primary/15">
                  <div className="flex flex-col gap-2 border-b border-primary/10 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h5 className="text-sm font-semibold text-stone-50">AI 검토 결과</h5>
                      <p className="text-xs text-stone-500">
                        프롬프트를 앱 안에서 실행한 결과입니다. 수정은 자동 수행하지 않고 검토 의견만 보여줍니다.
                      </p>
                      {reviewState.reviewRunCacheInfo?.cacheKey && (
                        <p className="mt-1 text-xs text-sky-200">
                          {reviewState.reviewRunCacheInfo.hits ? `캐시 재사용 ${reviewState.reviewRunCacheInfo.hits}회` : '결과 캐시 준비됨'}
                          {` · ${reviewState.reviewRunCacheInfo.cacheKey}`}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={reviewActions.downloadReviewRunResult}
                        className="action-ghost px-3 py-1.5 text-xs"
                      >
                        <Download size={14} />
                        결과 MD
                      </button>
                      <button
                        type="button"
                        onClick={reviewActions.copyReviewRunResultToClipboard}
                        className="action-ghost px-3 py-1.5 text-xs"
                      >
                        <FileText size={14} />
                        결과 복사
                      </button>
                    </div>
                  </div>
                  <div className="max-h-[clamp(320px,52vh,620px)] overflow-y-auto p-4 custom-scrollbar lg:p-5">
                    <AiMarkdown sectioned>
                      {reviewState.reviewRunResult}
                    </AiMarkdown>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-header flex flex-wrap justify-end gap-3 border-t px-6 py-4">
          {!hasPrompt && !isPromptLoading ? (
            <button
              type="button"
              onClick={reviewActions.triggerRiskPromptGeneration}
              className="action-primary px-6 py-2"
            >
              <Sparkles size={16} />
              AI 프롬프트 생성 시작
            </button>
          ) : isPromptLoading ? (
            <button
              type="button"
              onClick={reviewActions.cancelRiskPromptJob}
              className="action-ghost px-4 py-2"
            >
              작업 취소
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={reviewActions.triggerRiskReviewExecution}
                disabled={reviewState.loadingReviewRun || reviewState.loadingRiskPrompt}
                className="action-primary px-4 py-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {reviewState.loadingReviewRun ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-stone-950/25 border-t-stone-950" />
                ) : (
                  <Sparkles size={16} />
                )}
                AI 검토 실행
              </button>
              {isReviewRunning && (
                <button
                  type="button"
                  onClick={reviewActions.cancelReviewRunJob}
                  className="action-ghost px-4 py-2"
                >
                  실행 취소
                </button>
              )}
              <button
                type="button"
                onClick={reviewActions.downloadRiskReviewPrompt}
                className="action-ghost px-4 py-2"
              >
                <Download size={16} />
                MD 다운로드
              </button>
              <button
                type="button"
                onClick={reviewActions.copyPromptToClipboard}
                className="action-primary px-4 py-2"
              >
                <FileText size={16} />
                클립보드 복사
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default RiskReviewModal
