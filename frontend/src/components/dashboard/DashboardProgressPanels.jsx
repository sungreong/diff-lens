import { useDashboardContext } from './DashboardContext'

function DashboardProgressPanels() {
  const { aiSummaryPreviewText, error, formatDuration, getAnalysisSortOption, gitReportError, progress } = useDashboardContext()
  return (
    <>
      {/* Error Display */}
      {error && (
        <div className="surface-panel rounded-2xl p-4 border-l-4 border-red-500 bg-red-500/10">
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {/* Progress Indicator */}
      {progress && (
        <div className="surface-panel rounded-2xl p-6">
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0">
              <svg className={`${progress.phase === 'cancelled' ? '' : 'animate-spin'} h-8 w-8 ${progress.phase === 'cancelled' ? 'text-[#ff9b78]' : 'text-primary'}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
            <div className="flex-1">
              {progress.schema_version === '2.0' && !['fetch_done', 'analyzing', 'complete', 'cancelled'].includes(progress.phase) && (
                <p className="text-slate-300">
                  <span className="text-primary">{progress.node || 'compare-v2'}</span>
                  <span className="mx-2 text-stone-600">·</span>
                  {progress.message || progress.event || progress.phase}
                </p>
              )}
              {progress.schema_version === 'job.1' && progress.phase === 'job_progress' && (
                <div>
                  <p className="text-slate-300">
                    <span className="text-primary">백그라운드 작업</span>
                    <span className="mx-2 text-stone-600">·</span>
                    {progress.message}
                  </p>
                  <p className="mt-1 text-xs text-stone-500">
                    화면을 닫아도 백엔드 프로세스가 살아 있으면 계속 진행됩니다.
                    {progress.cache_key && <span> · cache {progress.cache_key}</span>}
                  </p>
                </div>
              )}
              {progress.phase === 'fetch' && (
                <p className="text-slate-300">{progress.message}</p>
              )}
              {progress.phase === 'fetch_done' && (
                <p className="text-slate-300">
                  ✅ {progress.message}
                  {progress.scope_file_count !== undefined && (
                    <span className="text-stone-500"> · 범위 {progress.total}/{progress.scope_file_count} files</span>
                  )}
                  {progress.analysis_sort && (
                    <span className="text-stone-500"> · {getAnalysisSortOption(progress.analysis_sort).shortLabel} 기준</span>
                  )}
                  <span className="text-stone-500"> · 커밋 {progress.commits}개</span>
                </p>
              )}
              {(progress.phase === 'analyzing' || progress.phase === 'file_done' || progress.phase === 'cache_wait_progress') && (
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-slate-300">
                      {progress.schema_version === 'job.1'
                        ? (progress.job_phase || '백그라운드 분석')
                        : (progress.phase === 'cache_wait_progress' ? '진행 중인 동일 분석 이어보기' : '파일 분석 중')}
                      : {progress.current || 0}/{progress.total || 0}
                    </span>
                    <span className="text-primary">
                      {progress.percent ?? (progress.total ? Math.round(((progress.current || 0) / progress.total) * 100) : 0)}%
                    </span>
                  </div>
                  <div className="w-full bg-stone-950/70 rounded-full h-2 overflow-hidden border border-primary/10">
                    <div
                      className="bg-gradient-to-r from-primary to-secondary h-2 rounded-full transition-all duration-300"
                      style={{ width: `${progress.percent ?? (progress.total ? ((progress.current || 0) / progress.total) * 100 : 0)}%` }}
                    ></div>
                  </div>
                  {(progress.elapsed_seconds !== undefined || progress.average_seconds !== undefined || progress.estimated_remaining_seconds !== undefined || progress.duration_seconds !== undefined || progress.cache_completed_count > 0) && (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-stone-500">
                      {progress.elapsed_seconds !== undefined && (
                        <span>누적 {formatDuration(progress.elapsed_seconds)}</span>
                      )}
                      {progress.duration_seconds !== undefined && (
                        <span>최근 파일 {formatDuration(progress.duration_seconds)}</span>
                      )}
                      {progress.average_seconds !== undefined && progress.average_seconds !== null && (
                        <span>평균 {formatDuration(progress.average_seconds)}/file</span>
                      )}
                      {progress.estimated_remaining_seconds !== undefined && progress.estimated_remaining_seconds !== null && (
                        <span>예상 남음 {formatDuration(progress.estimated_remaining_seconds)}</span>
                      )}
                      {progress.cache_completed_count > 0 && (
                        <span>캐시 재사용 {progress.cache_completed_count}개</span>
                      )}
                      {progress.concurrency && (
                        <span>동시 {progress.concurrency}개</span>
                      )}
                    </div>
                  )}
                  {progress.file && (
                    <p className="text-xs text-stone-500 mt-2 truncate">📄 {typeof progress.file === 'string' ? progress.file : progress.file.path}</p>
                  )}
                </div>
              )}
              {progress.phase === 'categorizing' && (
                <p className="text-slate-300">📁 {progress.message}</p>
              )}
              {progress.phase === 'summarizing' && (
                <p className="text-slate-300">✍️ {progress.message}</p>
              )}
              {progress.phase === 'cache_hit' && (
                <p className="text-[#79b8c5]">⚡ {progress.message}</p>
              )}
              {progress.phase === 'cache_wait' && (
                <p className="text-[#79b8c5]">⏳ {progress.message}</p>
              )}
              {progress.phase === 'cancelled' && (
                <p className="text-[#ff9b78]">분석 취소됨 · {progress.message}</p>
              )}
              {progress.phase === 'cache_wait_timeout' && (
                <p className="text-amber-300">⏱ {progress.message}</p>
              )}
            </div>
          </div>

          {/* Preview: Show analyzed files as they complete */}
          {progress.previewFiles && progress.previewFiles.length > 0 && (
            <div className="mt-4 border-t border-primary/10 pt-4">
              <p className="text-sm text-stone-400 mb-2">📄 분석 완료된 파일:</p>
              <div className="max-h-48 overflow-y-auto space-y-2">
                {progress.previewFiles.map((file, idx) => (
                  <div key={idx} className="surface-card p-3 rounded-xl">
                    <div className="flex items-center gap-2">
                      <span className="text-green-400">✓</span>
                      <span className="text-sm font-mono text-stone-300 truncate">{file.path}</span>
                    </div>
                  {file.ai_summary && (
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2">{aiSummaryPreviewText(file.ai_summary, 180)}</p>
                  )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {gitReportError && (
        <div className="surface-panel rounded-2xl p-4 border-l-4 border-[#d7653d] bg-[#d7653d]/10">
          <p className="text-[#ff9b78]">{gitReportError}</p>
        </div>
      )}
    </>
  )
}

export default DashboardProgressPanels
