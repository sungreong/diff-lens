function DebugConsole({
  showDebugLog,
  error,
  debugLogTab,
  setDebugLogTab,
  debugLogs,
  setDebugLogs,
  backendLogs,
  backendLogSources,
  backendLogSource,
  setBackendLogSource,
  backendLogsLoading,
  backendLogsError,
  backendLogAutoRefresh,
  setBackendLogAutoRefresh,
  setShowDebugLog,
  fetchBackendLogs,
}) {
  return (
    <div className="glass rounded-2xl p-4 mt-8 border border-primary/10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold text-slate-500 uppercase">개발자 로그</h3>
          <p className="mt-1 text-[11px] text-stone-500">
            화면 이벤트는 프론트/SSE 흐름 확인용이고, 백엔드 로그는 API 오류·job 진행·GitLab 호출 문제를 볼 때 씁니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {debugLogTab === 'frontend' && debugLogs.length > 0 && (
            <button onClick={() => setDebugLogs([])} className="action-ghost px-3 py-1.5 text-xs">Clear</button>
          )}
          {debugLogTab === 'backend' && showDebugLog && (
            <button
              onClick={fetchBackendLogs}
              disabled={backendLogsLoading}
              className="action-ghost px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {backendLogsLoading ? '불러오는 중' : '백엔드 새로고침'}
            </button>
          )}
          <button
            onClick={() => setShowDebugLog(prev => !prev)}
            className="action-secondary px-3 py-1.5 text-xs"
          >
            {showDebugLog ? '로그 접기' : '로그 보기'}
          </button>
        </div>
      </div>
      {(showDebugLog || error) && (
        <div className="mt-4 rounded-2xl border border-primary/10 bg-stone-950/35 overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-primary/10 p-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setDebugLogTab('frontend')}
                className={`rounded-full px-3 py-1 text-xs font-bold border ${
                  debugLogTab === 'frontend'
                    ? 'border-primary/40 bg-primary/20 text-primary'
                    : 'border-primary/10 bg-stone-950/35 text-stone-400 hover:text-stone-100'
                }`}
              >
                화면 이벤트 {debugLogs.length}
              </button>
              <button
                type="button"
                onClick={() => setDebugLogTab('backend')}
                className={`rounded-full px-3 py-1 text-xs font-bold border ${
                  debugLogTab === 'backend'
                    ? 'border-[#79b8c5]/40 bg-[#79b8c5]/15 text-[#b8edf5]'
                    : 'border-primary/10 bg-stone-950/35 text-stone-400 hover:text-stone-100'
                }`}
              >
                백엔드 로그 {backendLogs.length}
              </button>
            </div>
            {debugLogTab === 'backend' && (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={backendLogSource}
                  onChange={e => setBackendLogSource(e.target.value)}
                  className="rounded-full border border-primary/15 bg-stone-950/70 px-3 py-1 text-xs font-bold text-stone-200 outline-none"
                >
                  {(backendLogSources.length ? backendLogSources : [
                    { key: 'runtime', label: 'runtime', exists: true },
                    { key: 'backend_err', label: 'backend err', exists: false },
                    { key: 'backend_out', label: 'backend out', exists: false },
                    { key: 'git_client', label: 'git client', exists: false },
                    { key: 'all', label: 'all sources', exists: true },
                  ]).map(source => (
                    <option key={source.key} value={source.key}>
                      {source.label}{source.exists ? '' : ' (없음)'}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setBackendLogAutoRefresh(prev => !prev)}
                  className={`rounded-full px-3 py-1 text-xs font-bold border ${
                    backendLogAutoRefresh
                      ? 'border-emerald-300/30 bg-emerald-300/10 text-emerald-200'
                      : 'border-primary/10 bg-stone-950/35 text-stone-400'
                  }`}
                >
                  자동 갱신 {backendLogAutoRefresh ? 'ON' : 'OFF'}
                </button>
              </div>
            )}
          </div>

          {debugLogTab === 'frontend' ? (
            <div className="h-40 overflow-y-auto p-3 text-[10px] font-mono text-slate-400 space-y-1 custom-scrollbar">
              {debugLogs.length === 0 && <span className="opacity-50">화면 이벤트 로그가 아직 없습니다. 분석/요약/job 실행 중 주요 이벤트가 여기에 쌓입니다.</span>}
              {debugLogs.map((log, i) => (
                <div key={i} className="border-b border-white/5 pb-1">{log}</div>
              ))}
            </div>
          ) : (
            <div className="h-56 overflow-y-auto p-3 text-[10px] font-mono text-slate-400 space-y-1 custom-scrollbar">
              {backendLogsError && (
                <div className="rounded-lg border border-red-400/20 bg-red-950/20 px-3 py-2 text-red-200">
                  {backendLogsError}
                </div>
              )}
              {backendLogsLoading && backendLogs.length === 0 && <span className="opacity-50">백엔드 로그를 불러오는 중...</span>}
              {!backendLogsLoading && backendLogs.length === 0 && !backendLogsError && (
                <span className="opacity-50">표시할 백엔드 로그가 없습니다. 다른 소스를 선택하거나 새로고침해 보세요.</span>
              )}
              {backendLogs.slice().reverse().map((record, i) => (
                <div key={`${record.source}-${record.timestamp}-${i}`} className="grid gap-1 border-b border-white/5 pb-1 lg:grid-cols-[132px_76px_160px_minmax(0,1fr)]">
                  <span className="text-stone-600">{record.timestamp || '-'}</span>
                  <span className={`font-black ${
                    record.level === 'ERROR' || record.level === 'CRITICAL'
                      ? 'text-red-300'
                      : record.level === 'WARNING'
                        ? 'text-amber-200'
                        : 'text-[#b8edf5]'
                  }`}>
                    {record.level || 'LOG'}
                  </span>
                  <span className="truncate text-stone-500" title={record.logger}>{record.logger || record.source}</span>
                  <span className="break-words text-stone-300">{record.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default DebugConsole
