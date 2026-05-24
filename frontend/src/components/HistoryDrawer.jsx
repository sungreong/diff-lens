import React from 'react';
import AiMarkdown from './AiMarkdown';

const formatElapsed = (seconds) => {
  if (seconds == null) return '';
  if (seconds < 60) return `${seconds}초`;
  return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
};

const HistoryProgressCard = ({ progress }) => {
  const percent = Math.max(0, Math.min(100, Number(progress?.percent) || 0));
  const hasTotal = Number(progress?.total) > 0;
  const stageLabel = {
    history_queued: '작업 준비',
    history_resolving_range: '범위 확인',
    history_range_ready: '커밋 범위 확인',
    history_commit_fetching: 'diff 수집',
    history_commit_analyzing: '커밋별 AI 분석',
    history_summarizing: '흐름 요약',
    history_cache_hit: '캐시 재사용',
    history_cache_wait_hit: '실행 결과 재사용',
    complete: '완료',
  }[progress?.phase] || '커밋 흐름 분석';

  return (
    <div className="w-full max-w-2xl surface-card rounded-2xl border border-primary/15 p-5 text-left">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow text-[10px] text-primary mb-1">Commit Flow Job</div>
          <div className="text-base font-bold text-stone-100">{stageLabel}</div>
          <p className="mt-1 text-sm text-stone-400">
            {progress?.message || '커밋 흐름을 분석하고 있습니다.'}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {progress?.cacheHit && (
            <span className="status-pill px-2 py-1 text-[11px] text-sky-200 border-sky-300/25 bg-sky-300/10">캐시</span>
          )}
          {progress?.elapsedSeconds != null && (
            <span className="status-pill px-2 py-1 text-[11px]">{formatElapsed(progress.elapsedSeconds)}</span>
          )}
        </div>
      </div>

      <div className="mt-4">
        <div className="h-2 rounded-full bg-stone-950/80 overflow-hidden border border-primary/10">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${hasTotal ? percent : 18}%` }}
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
          <span>
            {hasTotal ? `${progress.current || 0}/${progress.total} 단계` : '분석 단계 준비 중'}
          </span>
          {progress?.commitCount ? (
            <span>
              커밋 {progress.commitIndex || progress.analyzedCount || 0}/{progress.commitCount}
              {progress.commit ? ` · ${progress.commit}` : ''}
            </span>
          ) : (
            <span>{hasTotal ? `${percent}%` : 'job 연결됨'}</span>
          )}
        </div>
      </div>
    </div>
  );
};

const HistoryDrawer = ({ isOpen, onClose, file, analysis, loading, progress }) => {
  // Ensure file is handled safely regardless of structure
  const rawPath = file && typeof file === 'object' ? (file.path || file.file_path) : file;
  const filePath = typeof rawPath === 'string' ? rawPath : '';
  const fileName = filePath ? filePath.split('/').pop() : 'Unknown File';

  if (!isOpen) return null;

  return (
    <div className="warm-scope fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div 
        className="modal-backdrop absolute inset-0 transition-opacity"
        onClick={onClose}
      />
      
      {/* Drawer Panel */}
      <div className="modal-shell relative w-full max-w-5xl border-l h-full flex flex-col transform transition-transform duration-300 ease-in-out">
        {/* Header */}
        <div className="modal-header flex items-center justify-between p-6">
          <div>
            <div className="eyebrow text-xs text-primary font-bold mb-1">Deep History Analysis</div>
            <h2 className="text-xl font-bold text-stone-100 break-all">{fileName}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-stone-500">
              <span className="truncate max-w-md">{filePath}</span>
              {analysis?.cache_hit && (
                <span className="status-pill px-2 py-0.5 text-[11px] text-sky-200 border-sky-300/25 bg-sky-300/10">
                  캐시 재사용{analysis.cache_hits ? ` ${analysis.cache_hits}회` : ''}
                </span>
              )}
            </div>
          </div>
          <button 
            onClick={onClose}
            className="action-ghost p-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center p-8 space-y-5">
              <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
              <div className="text-center">
                <p className="text-lg font-medium text-stone-200">커밋 흐름 분석 중입니다...</p>
                <p className="text-sm text-stone-400 mt-2">파일이 어떤 커밋을 거쳐 변했는지 단계별로 추적합니다.</p>
              </div>
              <HistoryProgressCard progress={progress} />
            </div>
          ) : !analysis ? (
            <div className="h-full flex items-center justify-center text-slate-500">
              분석 결과가 없습니다.
            </div>
          ) : (
            <div className="p-6 space-y-8">
              {(analysis.before_summary || analysis.after_summary || analysis.risk_verdict) && (
                <div className="bg-slate-800/30 rounded-2xl p-6 border border-slate-700/50">
                  <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                    <span>증빙 요약</span>
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700/60">
                      <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Before</div>
                      <p className="text-sm text-slate-300 leading-relaxed">{analysis.before_summary || '변경 전 증빙 없음'}</p>
                    </div>
                    <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700/60">
                      <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">After</div>
                      <p className="text-sm text-slate-300 leading-relaxed">{analysis.after_summary || '변경 후 증빙 없음'}</p>
                    </div>
                  </div>
                  <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700/60">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">문제 여부</span>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                        analysis.risk_verdict === '문제 가능성 있음'
                          ? 'bg-red-500/15 text-red-300'
                          : analysis.risk_verdict === '문제 없음'
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-amber-500/15 text-amber-300'
                      }`}>
                        {analysis.risk_verdict || '불확실'}
                      </span>
                      {analysis.confidence && (
                        <span className="text-xs text-slate-500">confidence: {analysis.confidence}</span>
                      )}
                    </div>
                    <p className="text-sm text-slate-300 leading-relaxed">{analysis.risk_reason || '근거가 부족해 안전 여부를 단정하지 않습니다.'}</p>
                    {analysis.recommended_checks?.length > 0 && (
                      <ul className="mt-3 space-y-1 text-sm text-slate-400 list-disc list-inside">
                        {analysis.recommended_checks.map((check, idx) => (
                          <li key={idx}>{check}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
              
              {/* 1. Macro Narrative Summary */}
              <div className="surface-card rounded-2xl p-6">
                <h3 className="text-lg font-semibold text-stone-50 mb-4 flex items-center gap-2">
                  <span>📜</span> 
                  <span>변천사 요약</span>
                </h3>
                <AiMarkdown compact sectioned>
                  {analysis.final_summary}
                </AiMarkdown>
              </div>

              {/* 2. Micro Timeline */}
              <div>
                <h3 className="text-lg font-semibold text-stone-50 mb-6 flex items-center gap-2 px-2">
                   <span>⏳</span>
                   <span>상세 타임라인</span>
                   <span className="status-pill px-2 py-0.5 ml-auto">
                     {analysis.commits_analyzed} Commits
                   </span>
                </h3>
                
                <div className="relative pl-6 border-l-2 border-primary/20 space-y-8 ml-3">
                  {analysis.history.map((item, idx) => (
                    <div key={idx} className="relative group">
                      {/* Timeline Dot */}
                      <div className="absolute -left-[31px] top-1.5 w-4 h-4 rounded-full bg-stone-950 border-2 border-primary/50 group-hover:border-primary group-hover:scale-110 transition-all z-10" />
                      
                      {/* Date & Author */}
                      <div className="flex items-baseline gap-2 mb-2">
                        <span className="text-xs font-mono text-slate-500">
                          {new Date(item.date).toLocaleDateString()}
                        </span>
                        <span className="text-sm font-medium text-[#79b8c5]">
                          {item.author}
                        </span>
                        <span className="text-xs text-slate-600 font-mono">
                          {item.short_id}
                        </span>
                      </div>

                      {/* Card */}
                      <div className="surface-card rounded-xl p-4 hover:border-primary/30 transition-colors shadow-lg">
                        <div className="flex justify-between items-start mb-3 gap-4">
                          <h4 className="font-semibold text-slate-200 text-sm leading-snug">
                            {item.message}
                          </h4>
                           <span className={`shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded ${
                             (item.diff_stat || '').includes('+0/-0') ? 'bg-slate-700 text-slate-400' : 'bg-slate-700 text-slate-300'
                           }`}>
                             {item.diff_stat}
                           </span>
                        </div>
                        
                        {/* Agent Analysis */}
                        <div className="text-sm text-stone-300 bg-stone-950/45 rounded-lg p-3 border-l-2 border-primary/50">
                          <span className="text-xs text-primary font-bold block mb-1 uppercase tracking-wide">
                            Analysis
                          </span>
                          {item.analysis}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default HistoryDrawer;
