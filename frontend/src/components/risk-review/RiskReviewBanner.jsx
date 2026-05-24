import { AlertTriangle, Clock, Download, Eye, FileText, Sparkles } from 'lucide-react'
import { riskCounts } from './riskReviewUtils'

const statusMeta = {
  ready: {
    label: '검토 요청 대기',
    description: '리스크 파일을 확인하고 검토 프롬프트를 만들 수 있습니다.',
    className: 'border-amber-300/25 bg-amber-300/10 text-amber-100',
  },
  prompt_running: {
    label: '프롬프트 생성 중',
    description: '백엔드 job이 검토 요청 프롬프트를 준비하고 있습니다.',
    className: 'border-sky-300/30 bg-sky-300/10 text-sky-100',
  },
  prompt_ready: {
    label: '프롬프트 준비됨',
    description: '모달을 열어 AI 검토 실행 또는 프롬프트 복사를 할 수 있습니다.',
    className: 'border-[#79b8c5]/30 bg-[#79b8c5]/10 text-[#b8edf5]',
  },
  review_running: {
    label: 'AI 검토 실행 중',
    description: '검토 결과가 준비되면 이 영역과 모달에서 바로 볼 수 있습니다.',
    className: 'border-sky-300/30 bg-sky-300/10 text-sky-100',
  },
  review_done: {
    label: 'AI 검토 완료',
    description: '결과 보기, 결과 복사, MD 다운로드를 바로 사용할 수 있습니다.',
    className: 'border-emerald-300/30 bg-emerald-300/10 text-emerald-100',
  },
}

const riskFilterOptions = (counts, total) => [
  { key: 'risk', label: '전체 리스크', count: total },
  { key: 'HIGH', label: 'HIGH', count: counts.high },
  { key: 'MEDIUM', label: 'MEDIUM', count: counts.medium },
  { key: 'LOW', label: 'LOW', count: counts.low },
]

const RiskReviewBanner = ({
  filesWithRisks,
  reviewState,
  reviewActions,
  onFocusFile,
  onSelectRiskFilter,
}) => {
  if (!filesWithRisks.length) return null

  const counts = riskCounts(filesWithRisks)
  const meta = statusMeta[reviewState.status] || statusMeta.ready
  const canUsePrompt = Boolean(reviewState.generatedPrompt)
  const canUseResult = Boolean(reviewState.reviewRunResult)

  return (
    <div className="glass rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="shrink-0 rounded-lg bg-amber-500/20 p-2">
            {reviewState.status === 'review_running' || reviewState.status === 'prompt_running' ? (
              <Clock className="h-5 w-5 animate-spin text-sky-300" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-amber-400" />
            )}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-amber-400">
              {filesWithRisks.length}개 파일에서 잠재적 리스크 감지됨
            </div>
            <div className="mt-0.5 text-xs text-slate-400">
              HIGH: {counts.high} | MEDIUM: {counts.medium} | LOW: {counts.low}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {riskFilterOptions(counts, filesWithRisks.length).map(option => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => onSelectRiskFilter(option.key)}
                  className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-0.5 text-[10px] font-bold text-amber-100 hover:bg-amber-300/20"
                  title="아래 파일별 AI 메모에서 이 리스크만 봅니다."
                >
                  {option.label} {option.count}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 xl:w-[460px] xl:shrink-0">
          <div className={`rounded-2xl border px-3 py-2 ${meta.className}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-black">{meta.label}</p>
                <p className="mt-0.5 text-[11px] opacity-80">{meta.description}</p>
                {reviewState.hasCacheHit && (
                  <p className="mt-1 text-[11px] font-bold opacity-90">캐시 재사용됨</p>
                )}
              </div>
              {reviewState.status === 'review_done' ? (
                <FileText size={16} className="shrink-0" />
              ) : (
                <Sparkles size={16} className="shrink-0" />
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 xl:justify-end">
            <button
              type="button"
              onClick={reviewActions.openRiskReviewModal}
              className="action-primary px-4 py-2 text-sm"
            >
              <Eye size={15} />
              {canUseResult ? '결과 보기' : canUsePrompt ? '검토 실행 열기' : '검토 요청 생성'}
            </button>
            {canUsePrompt && (
              <button
                type="button"
                onClick={reviewActions.copyPromptToClipboard}
                className="action-ghost px-3 py-2 text-xs"
              >
                <FileText size={14} />
                프롬프트 복사
              </button>
            )}
            {canUseResult && (
              <>
                <button
                  type="button"
                  onClick={reviewActions.downloadReviewRunResult}
                  className="action-ghost px-3 py-2 text-xs"
                >
                  <Download size={14} />
                  결과 MD
                </button>
                <button
                  type="button"
                  onClick={reviewActions.copyReviewRunResultToClipboard}
                  className="action-ghost px-3 py-2 text-xs"
                >
                  <FileText size={14} />
                  결과 복사
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 surface-card overflow-x-auto rounded-xl custom-scrollbar">
        <table className="data-table w-full min-w-[760px] text-xs">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left font-medium text-slate-400">파일</th>
              <th className="px-3 py-2 text-left font-medium text-slate-400">리스크 유형</th>
              <th className="px-3 py-2 text-center font-medium text-slate-400">심각도</th>
              <th className="px-3 py-2 text-left font-medium text-slate-400">위치</th>
              <th className="px-3 py-2 text-right font-medium text-slate-400">이동</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {filesWithRisks.slice(0, 5).map((file, idx) => (
              <tr key={`${file.path}-${idx}`} className="hover:bg-slate-800/30">
                <td className="px-3 py-2 font-mono text-slate-300">
                  <button
                    type="button"
                    onClick={() => onFocusFile(file)}
                    className="max-w-[180px] truncate text-left text-[#9ed9e4] hover:text-primary"
                    title={`${file.path} 메모 보기`}
                  >
                    {file.path.split('/').pop()}
                  </button>
                </td>
                <td className="max-w-[200px] truncate px-3 py-2 text-slate-400">{file.risk.riskType}</td>
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
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => onFocusFile(file)}
                    className="rounded-full border border-primary/15 px-2 py-1 text-[10px] font-bold text-primary hover:bg-primary/10"
                  >
                    메모 보기
                  </button>
                </td>
              </tr>
            ))}
            {filesWithRisks.length > 5 && (
              <tr>
                <td colSpan="5" className="px-3 py-2 text-center text-slate-500">
                  ... 외 {filesWithRisks.length - 5}개 파일
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default RiskReviewBanner
