export const BatchSizeControl = ({ batchSize, fileCount, onChange }) => (
  <div className="flex items-center gap-4">
    <label className="text-sm text-slate-400">배치 크기:</label>
    <select
      value={batchSize}
      onChange={(event) => onChange(parseInt(event.target.value))}
      className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm"
    >
      <option value={2}>2개씩</option>
      <option value={4}>4개씩</option>
      <option value={6}>6개씩</option>
      <option value={8}>8개씩</option>
    </select>
    <span className="text-xs text-slate-500">
      (총 {Math.ceil(fileCount / batchSize)}회 요약)
    </span>
  </div>
)

export const SummaryRunStatus = ({ error, loading, progress, cacheNotice }) => (
  <>
    {error && (
      <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
        ⚠️ {error}
      </div>
    )}
    {loading && (
      <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700/50 space-y-3">
        <div className="flex items-center gap-3 text-sm">
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-slate-600 border-t-emerald-500" />
          <span className="text-slate-200 font-medium">
            {progress ? progress.message : '작업 진행 중...'}
          </span>
          {progress?.percent !== undefined && (
            <span className="ml-auto text-emerald-400 font-bold">{progress.percent}%</span>
          )}
        </div>
        {progress?.percent !== undefined && (
          <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-300 ease-out"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        )}
      </div>
    )}
    {cacheNotice && !loading && (
      <div className="p-3 rounded-lg border border-sky-300/20 bg-sky-300/10 text-sm text-sky-100">
        <span className="font-semibold">캐시 재사용</span>
        <span className="text-sky-200/80">
          {' '}{cacheNotice.message}
          {cacheNotice.hits ? ` ${cacheNotice.hits}회` : ''}
          {cacheNotice.cacheKey ? ` · ${cacheNotice.cacheKey}` : ''}
        </span>
      </div>
    )}
  </>
)
