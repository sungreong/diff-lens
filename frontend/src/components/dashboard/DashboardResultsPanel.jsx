import { Suspense, lazy } from 'react'
import { useDashboardContext } from './DashboardContext'
import AiMarkdown from '../AiMarkdown'
import RiskReviewBanner from '../risk-review/RiskReviewBanner'

const RiskReviewModal = lazy(() => import('../risk-review/RiskReviewModal'))

function DashboardResultsPanel() {
  const { AlertTriangle, BarChart3, BookOpen, Eye, FileTreeNode, FolderOpen, Search, Sparkles, Upload, X, aiMemoPanelRef, aiSummaryPreviewText, analysisModeDetails, analysisStatusFilter, baseCommit, baselineOnlyResultFiles, deepAnalysisResults, downloadAsExcel, downloadAsMarkdown, expandedFolders, fileTree, filesWithRiskMeta, filesWithRisks, filterQuery, filteredFiles, focusFileInAiMemo, getAnalysisLimitLabel, getAnalysisStatusLabel, handleDeepAnalysis, maxFiles, result, resultAnalysisCount, resultExcludedCount, resultRawCount, resultScopeCount, resultScopeExcludedCount, resultSortOption, riskCounts, riskFilter, riskReviewActions, riskReviewState, riskSeverityRank, selectedPath, setAnalysisSort, setAnalysisStatusFilter, setExportModalOpen, setFilterQuery, setHistoryAnalysis, setHistoryDrawerOpen, setMaxFiles, setRiskFilter, setSelectedFileForDiff, setSelectedHistoryFile, setSelectedPath, setSortBy, setStatusFilter, sortBy, statusFilter, targetCommit, toggleFolder } = useDashboardContext()
  return (
    <>
      {/* Results */}
      {result && (
        <div className="space-y-6">
          {/* Stats Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="glass metric-card rounded-2xl p-5">
              <div className="eyebrow text-[10px] font-bold text-stone-500 mb-3">Commits</div>
              <div className="text-4xl font-bold text-primary">{result.commit_count}</div>
              <div className="text-sm text-stone-400 mt-1">분석된 커밋</div>
            </div>
            <div className="glass metric-card rounded-2xl p-5">
              <div className="eyebrow text-[10px] font-bold text-stone-500 mb-3">Files</div>
              <div className="text-4xl font-bold text-stone-50">{result.files?.length || 0}</div>
              <div className="text-sm text-stone-400 mt-1">변경 파일</div>
            </div>
            <div className="glass metric-card rounded-2xl p-5">
              <div className="eyebrow text-[10px] font-bold text-stone-500 mb-3">Added</div>
              <div className="text-4xl font-bold text-secondary">+{result.total_additions || 0}</div>
              <div className="text-sm text-stone-400 mt-1">추가 라인</div>
            </div>
            <div className="glass metric-card rounded-2xl p-5">
              <div className="eyebrow text-[10px] font-bold text-stone-500 mb-3">Deleted</div>
              <div className="text-4xl font-bold text-[#d7653d]">-{result.total_deletions || 0}</div>
              <div className="text-sm text-stone-400 mt-1">삭제 라인</div>
            </div>
          </div>

          {/* Export Buttons */}
          <div className="flex flex-wrap gap-3 justify-end">
            <button
              onClick={downloadAsExcel}
              className="px-4 py-2 rounded-full bg-secondary/15 hover:bg-secondary/25 text-secondary border border-secondary/20 transition-all duration-200 flex items-center gap-2 text-sm font-bold"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
              Excel (CSV)
            </button>
            <button
              onClick={downloadAsMarkdown}
              className="px-4 py-2 rounded-full bg-[#79b8c5]/15 hover:bg-[#79b8c5]/25 text-[#79b8c5] border border-[#79b8c5]/20 transition-all duration-200 flex items-center gap-2 text-sm font-bold"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
              Markdown
            </button>
            <button
              onClick={() => setExportModalOpen(true)}
              className="px-4 py-2 rounded-full bg-primary/15 hover:bg-primary/25 text-primary border border-primary/20 transition-all duration-200 flex items-center gap-2 text-sm font-bold"
            >
              <Upload size={16} />
              📤 Export
            </button>
          </div>

          {result.mode !== 'git' && (
            <div className="surface-panel rounded-[1.5rem] p-4 border border-[#79b8c5]/20 bg-[#79b8c5]/5">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="eyebrow text-[10px] font-bold text-[#79b8c5] mb-1">AI review layer</p>
                  <h3 className="text-lg font-black text-stone-50">
                    {(analysisModeDetails[result.mode] || analysisModeDetails.full).title}
                  </h3>
                  <p className="mt-1 text-sm text-stone-300">
                    {(analysisModeDetails[result.mode] || analysisModeDetails.full).question}
                  </p>
                  <p className="mt-1 text-xs text-stone-500">
                    AI 결과는 Git diff와 커밋 정보를 읽기 쉽게 정리하는 보조 자료이며, 테스트 통과나 책임자 판정을 의미하지 않습니다.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs shrink-0">
                  <span className="status-pill px-3 py-1">
                    AI 분석 {resultAnalysisCount}/{resultScopeCount} files
                  </span>
                  {resultExcludedCount > 0 && (
                    <span className="rounded-full border border-[#d7653d]/30 bg-[#d7653d]/10 px-3 py-1 font-bold text-[#ff9b78]">
                      미분석 {resultExcludedCount} files
                    </span>
                  )}
                  {resultScopeExcludedCount > 0 && (
                    <span className="status-pill px-3 py-1">
                      스코프 제외 {resultScopeExcludedCount} files
                    </span>
                  )}
                  {resultRawCount !== resultScopeCount && (
                    <span className="status-pill px-3 py-1">
                      원본 변경 {resultRawCount} files
                    </span>
                  )}
                  <span className="status-pill px-3 py-1">{getAnalysisStatusLabel(result.file_status_filter || analysisStatusFilter)}</span>
                  <span className="status-pill px-3 py-1" title={resultSortOption.description}>
                    {resultSortOption.shortLabel} 기준 {getAnalysisLimitLabel(result.max_files ?? maxFiles)}
                  </span>
                  <span className="status-pill px-3 py-1">{result.commit_count || 0} commits</span>
                  <span className="status-pill px-3 py-1">
                    Git 기준: {result.baseline_resolved?.short_sha || baseCommit?.slice(0, 8)} → {result.candidate_resolved?.short_sha || (targetCommit || 'HEAD').slice(0, 8)}
                  </span>
                  {result.cache_hit && (
                    <span className="rounded-full border border-[#79b8c5]/35 bg-[#79b8c5]/10 px-3 py-1 font-bold text-[#b8edf5]">
                      캐시 재사용 {result.cache_hits ? `${result.cache_hits}회` : ''}
                    </span>
                  )}
                  {resultExcludedCount > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setAnalysisStatusFilter('all')
                        setAnalysisSort('changes')
                        setMaxFiles(0)
                      }}
                      className="action-secondary px-3 py-1 text-xs"
                      title="AI 파일 범위를 전체 상태, 전체 파일로 설정합니다. 다시 실행하면 전체 범위를 분석합니다."
                    >
                      전체 범위로 설정
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {result.comparison_type === 'pre_deploy' && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
              <div className="surface-panel rounded-[1.5rem] p-5 border border-primary/15">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div>
                    <p className="eyebrow text-[10px] font-bold text-primary mb-1">Release preview summary</p>
                    <h3 className="text-lg font-black text-stone-50">배포 전 요약</h3>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="status-pill px-3 py-1">
                      {result.compare_strategy === 'branch_delta' ? '브랜치 작업분' : '배포 상태 차이'}
                    </span>
                    <span className="status-pill px-3 py-1">
                      {result.straight ? '기준 전용 변경 포함' : '공통 기준 이후 변경만'}
                    </span>
                  </div>
                </div>
                <div className="grid gap-2 text-xs text-stone-400 sm:grid-cols-2">
                  <div className="rounded-2xl border border-primary/10 bg-stone-950/35 p-3">
                    <div className="eyebrow text-[10px] text-stone-500 mb-1">개발 버전</div>
                    <div className="font-bold text-stone-100 truncate" title={result.candidate_ref}>{result.candidate_ref}</div>
                    <div className="mt-1 font-mono text-primary">{result.candidate_resolved?.short_sha || 'unresolved'}</div>
                  </div>
                  <div className="rounded-2xl border border-primary/10 bg-stone-950/35 p-3">
                    <div className="eyebrow text-[10px] text-stone-500 mb-1">기준 버전</div>
                    <div className="font-bold text-stone-100 truncate" title={result.baseline_ref}>{result.baseline_ref}</div>
                    <div className="mt-1 font-mono text-[#79b8c5]">{result.baseline_resolved?.short_sha || 'unresolved'}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                  <span className="status-pill px-2 py-1">
                    직접 변경 {result.direct_origin_counts?.changed_between_versions || 0} · 후보 전용 {result.direct_origin_counts?.candidate_only || 0}
                  </span>
                  <span className={`rounded-full border px-2 py-1 font-bold ${
                    baselineOnlyResultFiles.length
                      ? 'border-[#d7653d]/30 bg-[#d7653d]/10 text-[#ff9b78]'
                      : 'border-[#79b8c5]/25 bg-[#79b8c5]/10 text-[#b8edf5]'
                  }`}>
                    기준 전용 {baselineOnlyResultFiles.length}
                  </span>
                  {result.run_manifest?.ref_lock?.locked && (
                    <span className="rounded-full border border-[#79b8c5]/25 bg-[#79b8c5]/10 px-2 py-1 font-bold text-[#b8edf5]">
                      커밋 기준 고정됨
                    </span>
                  )}
                  {result.run_manifest?.run_id && (
                    <span className="status-pill px-2 py-1 font-mono">run {result.run_manifest.run_id.slice(0, 8)}</span>
                  )}
                </div>
                {baselineOnlyResultFiles.length > 0 && (
                  <div className="mt-4 rounded-2xl border border-[#d7653d]/25 bg-[#d7653d]/10 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-black text-stone-50">개발 후보에 없는 기준 버전 변경</div>
                        <div className="mt-1 text-xs text-stone-500">prod-only hotfix 누락 후보입니다. 배포 방식에 따라 사라질 위험 또는 의도된 제거인지 확인하세요.</div>
                      </div>
                      <span className="shrink-0 text-sm font-black text-[#ff9b78]">{baselineOnlyResultFiles.length}</span>
                    </div>
                    <div className="mt-3 space-y-1.5">
                      {baselineOnlyResultFiles.slice(0, 5).map(file => (
                        <button
                          key={file.path}
                          type="button"
                          onClick={() => setSelectedFileForDiff(file)}
                          className="flex w-full min-w-0 items-center justify-between gap-3 rounded-xl bg-stone-950/35 px-3 py-2 text-left"
                        >
                          <span className="min-w-0 truncate font-mono text-xs text-stone-300">{file.path}</span>
                          <span className="shrink-0 text-xs text-[#ff9b78]">{file.status}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {result.summary && (
                  <AiMarkdown sectioned className="mt-5">
                    {result.summary}
                  </AiMarkdown>
                )}
              </div>

              <div className="surface-panel rounded-[1.5rem] p-5 border border-[#79b8c5]/15 bg-[#79b8c5]/5">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div>
                    <p className="eyebrow text-[10px] font-bold text-[#79b8c5] mb-1">Inferred impact</p>
                    <h3 className="flex items-center gap-2 text-lg font-black text-stone-50"><Sparkles size={17} className="text-[#79b8c5]" />AI 영향 후보</h3>
                  </div>
                  <span className="status-pill px-3 py-1">{result.impact_candidates?.length || 0} files</span>
                </div>
                {(result.skipped_reasons || result.impact_diagnostics?.skipped_reasons || []).length > 0 && (
                  <div className="mb-3 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-3 text-xs text-amber-100/80">
                    {(result.skipped_reasons || result.impact_diagnostics?.skipped_reasons || []).slice(0, 2).map((reason, idx) => (
                      <div key={`${reason.code}-${idx}`} className="truncate" title={reason.message}>
                        {reason.code}: {reason.message}
                      </div>
                    ))}
                  </div>
                )}
                <div className="space-y-3 max-h-[520px] overflow-y-auto custom-scrollbar pr-1">
                  {(result.impact_candidates || []).map((candidate, index) => (
                    <div key={`${candidate.file_path || candidate.path}-${index}`} className="rounded-2xl border border-[#79b8c5]/15 bg-stone-950/40 p-3">
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-mono text-xs font-bold text-[#d8f6fb] break-all">{candidate.file_path || candidate.path}</div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {(candidate.reason_codes || []).slice(0, 5).map(code => (
                              <span key={code} className="rounded-full border border-[#79b8c5]/20 bg-[#79b8c5]/10 px-2 py-0.5 text-[10px] font-bold text-[#b8edf5]">
                                {code}
                              </span>
                            ))}
                          </div>
                        </div>
                        <span className="shrink-0 rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-[10px] font-black text-primary">
                          {Math.round((candidate.confidence_score || 0) * 100)}%
                        </span>
                      </div>
                      {(candidate.evidence || []).length > 0 && (
                        <div className="mt-3 rounded-xl border border-[#79b8c5]/10 bg-stone-950/35 p-2">
                          <div className="mb-1 text-[10px] font-black uppercase tracking-wider text-[#79b8c5]">Evidence</div>
                          <div className="space-y-1 text-[11px] text-stone-400">
                            {candidate.evidence.slice(0, 3).map((item, evidenceIndex) => (
                              <div key={evidenceIndex} className="min-w-0">
                                <span className="font-bold text-stone-300">{item.type || 'match'}</span>
                                {item.changed_file && <span className="ml-1 truncate">from {item.changed_file}</span>}
                                {item.match && <span className="ml-1 font-mono text-primary">{item.match}</span>}
                                {item.snippet && <div className="mt-0.5 truncate font-mono text-stone-500" title={item.snippet}>{item.snippet}</div>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {candidate.ai_summary && (
                        <AiMarkdown compact sectioned className="mt-3">
                          {candidate.ai_summary}
                        </AiMarkdown>
                      )}
                      {(candidate.recommended_checks || []).length > 0 && (
                        <ul className="mt-3 space-y-1 text-[11px] text-stone-400">
                          {candidate.recommended_checks.slice(0, 3).map(check => (
                            <li key={check} className="flex gap-2">
                              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[#79b8c5] shrink-0" />
                              <span>{check}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                  {(!result.impact_candidates || result.impact_candidates.length === 0) && (
                    <div className="rounded-2xl border border-primary/10 bg-stone-950/35 p-4 text-sm text-stone-500">
                      직접 변경 파일 주변에서 표시할 영향 후보가 아직 없습니다.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <RiskReviewBanner
            filesWithRisks={filesWithRisks}
            reviewState={riskReviewState}
            reviewActions={riskReviewActions}
            onFocusFile={focusFileInAiMemo}
            onSelectRiskFilter={(filter) => {
              setRiskFilter(filter)
              setFilterQuery('')
              setSelectedPath(null)
              requestAnimationFrame(() => {
                aiMemoPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              })
            }}
          />

          {riskReviewState.riskReviewModalOpen && (
            <Suspense fallback={null}>
              <RiskReviewModal
                filesWithRisks={filesWithRisks}
                baseCommit={baseCommit}
                targetCommit={targetCommit}
                reviewState={riskReviewState}
                reviewActions={riskReviewActions}
              />
            </Suspense>
          )}

          {result.mode === 'quick' ? (
            <div ref={aiMemoPanelRef} className="surface-panel rounded-[1.75rem] overflow-hidden flex flex-col h-[800px] scroll-mt-6">
              {/* Header */}
              <div className="p-4 border-b border-primary/10 bg-stone-950/35 flex flex-col lg:flex-row lg:justify-between lg:items-center gap-3 shrink-0">
                <div>
                  <h3 className="text-xl font-bold flex items-center gap-3">
                    <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-primary/20 text-primary border border-primary/20">⚡</span>
                    파일별 AI 메모
                  </h3>
                  <p className="mt-1 text-xs text-stone-500">
                    각 파일의 핵심 변경 증빙을 짧게 정리합니다. 범위 요약은 “선택 범위 요약”에서 생성합니다.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                   <div className="flex flex-wrap items-center gap-1 rounded-xl border border-primary/10 bg-stone-950/35 p-1">
                     {[
                       { key: 'all', label: '전체', count: filesWithRiskMeta.length },
                       { key: 'risk', label: '리스크', count: riskCounts.total },
                       { key: 'HIGH', label: 'HIGH', count: riskCounts.HIGH },
                       { key: 'MEDIUM', label: 'MEDIUM', count: riskCounts.MEDIUM },
                       { key: 'LOW', label: 'LOW', count: riskCounts.LOW },
                     ].map(option => (
                       <button
                         key={option.key}
                         type="button"
                         onClick={() => setRiskFilter(option.key)}
                         className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ${
                           riskFilter === option.key
                             ? option.key === 'HIGH'
                               ? 'bg-red-500/20 text-red-200 border border-red-400/30'
                               : option.key === 'MEDIUM'
                                 ? 'bg-amber-500/20 text-amber-100 border border-amber-400/30'
                                 : option.key === 'LOW'
                                   ? 'bg-yellow-500/15 text-yellow-100 border border-yellow-300/25'
                                   : 'bg-primary/20 text-primary border border-primary/30'
                             : 'text-stone-500 hover:bg-primary/10 hover:text-stone-200 border border-transparent'
                         }`}
                         title="AI 메모의 '잠재적 리스크' 섹션 기준 필터입니다."
                       >
                         {option.label}
                         <span className="ml-1 text-[10px] opacity-70">{option.count}</span>
                       </button>
                     ))}
                   </div>
                   <select 
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="field-surface px-3 py-1 rounded-lg text-stone-300 text-sm border outline-none focus:ring-1 focus:ring-primary"
                   >
                      <option value="all">All Status</option>
                      <option value="added">Added</option>
                      <option value="modified">Modified</option>
                      <option value="deleted">Deleted</option>
                      <option value="renamed">Renamed</option>
                   </select>
                   <select 
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value)}
                      className="field-surface px-3 py-1 rounded-lg text-stone-300 text-sm border outline-none focus:ring-1 focus:ring-primary"
                   >
                      <option value="none">정렬: 기본</option>
                      <option value="risk">정렬: 리스크 심각도 ↓</option>
                      <option value="commits">정렬: Commits ↓</option>
                      <option value="changes">정렬: 변경량 ↓</option>
                      <option value="additions">정렬: 추가 ↓</option>
                      <option value="deletions">정렬: 삭제 ↓</option>
                   </select>
                   <span className="status-pill px-3 py-1 text-sm">
                     총 {filteredFiles.filter(f => statusFilter === 'all' || f.status === statusFilter).length || 0}개 파일
                   </span>
                </div>
              </div>

              {/* Body: Sidebar + Main Content */}
              <div className="flex-1 flex flex-col xl:flex-row overflow-hidden">
                {/* Left Sidebar */}
                <div className="w-full xl:w-72 max-h-72 xl:max-h-none border-b xl:border-b-0 xl:border-r border-primary/10 bg-stone-950/25 flex flex-col">
                  {/* Search Box */}
                  <div className="p-3 border-b border-primary/10">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-stone-500">파일 검색</span>
                      <span className="text-[10px] text-stone-600">파일명 우선</span>
                    </div>
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-2.5 text-slate-500" />
                      <input 
                        type="text" 
                        value={filterQuery}
                        onChange={(e) => setFilterQuery(e.target.value)}
                        placeholder="파일명 또는 경로 검색"
                        className="field-surface w-full pl-9 pr-3 py-2 border rounded-lg text-xs text-stone-300 focus:border-primary outline-none"
                      />
                    </div>
                  </div>
                  {/* Tree View */}
                  <div className="flex-1 overflow-y-auto p-2 custom-scrollbar select-none">
                    {selectedPath && (
                      <div 
                        className="flex items-center gap-2 px-2 py-1.5 mb-2 text-xs text-slate-400 hover:text-white cursor-pointer hover:bg-white/5 rounded border border-transparent hover:border-slate-700 border-dashed transition-colors"
                        onClick={() => setSelectedPath(null)}
                      >
                        <X size={12} />
                        <span>Clear Filter: <span className="text-primary">{selectedPath}</span></span>
                      </div>
                    )}
                   {filterQuery && !selectedPath && (
                      <div
                        className="mb-2 flex items-center gap-2 rounded border border-primary/10 bg-primary/5 px-2 py-1.5 text-xs text-stone-400"
                      >
                        <Search size={12} className="shrink-0 text-primary" />
                        <span className="min-w-0 flex-1 truncate">
                          검색: <span className="text-primary">{filterQuery}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setFilterQuery('')}
                          className="rounded p-0.5 text-stone-500 hover:bg-primary/10 hover:text-primary"
                          aria-label="검색어 지우기"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    )}
                    {riskFilter !== 'all' && (
                      <div
                        className="mb-2 flex items-center gap-2 rounded border border-amber-300/15 bg-amber-300/8 px-2 py-1.5 text-xs text-stone-400"
                      >
                        <AlertTriangle size={12} className="shrink-0 text-amber-300" />
                        <span className="min-w-0 flex-1 truncate">
                          리스크 필터: <span className="text-amber-200">
                            {riskFilter === 'risk' ? '잠재 리스크 전체' : riskFilter === 'none' ? '리스크 없음' : riskFilter}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setRiskFilter('all')}
                          className="rounded p-0.5 text-stone-500 hover:bg-amber-300/10 hover:text-amber-200"
                          aria-label="리스크 필터 지우기"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    )}
                    {fileTree ? (
                       <FileTreeNode 
                          node={fileTree} 
                          selectedPath={selectedPath} 
                          expandedFolders={expandedFolders} 
                          toggleFolder={toggleFolder}
                          onSelectFile={(file) => setSelectedFileForDiff(file)}
                       />
                    ) : (
                       <div className="text-center py-10 text-slate-600 text-xs">
                          No file structure
                       </div>
                    )}
                  </div>
                </div>

                {/* Right Content */}
                <div className="flex-1 flex flex-col min-w-0 bg-stone-950/10">
                    <div className="p-4 border-b border-primary/10 flex flex-col lg:flex-row lg:justify-between lg:items-center gap-3 bg-stone-950/35">
                        <div className="flex items-center gap-3">
                           <div className="p-1.5 bg-primary/10 rounded-xl text-primary border border-primary/15">
                              {selectedPath ? <FolderOpen size={16} className="text-primary" /> : <BarChart3 size={16} />}
                           </div>
                           <div className="flex flex-col">
                              <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">
                                 {selectedPath ? 'Folders' : 'Analysis Overview'}
                              </span>
                              <span className="text-sm text-white font-bold">
                                 {selectedPath ? selectedPath : 'All Files'}
                              </span>
                           </div>
                        </div>
                        
                        {/* Summary Stats Badges */}
                        <div className="flex items-center gap-3 text-xs">
                           <div className="status-pill px-3 py-1">
                              <span className="font-bold text-white">{filteredFiles.length}</span> Files
                           </div>
                           {(filteredFiles.reduce((acc, f) => acc + (f.additions||0), 0) > 0 || filteredFiles.reduce((acc, f) => acc + (f.deletions||0), 0) > 0) && (
                               <div className="status-pill flex items-center gap-2 px-3 py-1 font-mono">
                                  <span className="text-green-400 font-bold">+{filteredFiles.reduce((acc, f) => acc + (f.additions||0), 0)}</span>
                                  <span className="text-slate-600">|</span>
                                  <span className="text-red-400 font-bold">-{filteredFiles.reduce((acc, f) => acc + (f.deletions||0), 0)}</span>
                               </div>
                           )}
                        </div>
                    </div>

                    <div className="flex-1 overflow-auto custom-scrollbar">
                      <table className="data-table w-full text-left">
                        <thead className="sticky top-0 z-10 shadow-sm">
                          <tr className="text-slate-400 text-xs uppercase tracking-wider">
                            <th className="py-4 px-6 font-semibold w-20">상태</th>
                            <th className="py-4 px-6 font-semibold w-60">파일명 및 경로</th>
                            <th className="py-4 px-6 font-semibold text-center w-24">Commits</th>
                            <th className="py-4 px-6 font-semibold text-center w-24">Lines</th>
                            <th className="py-4 px-6 font-semibold">AI 메모</th>
                            <th className="py-4 px-6 font-semibold text-center w-28">추가 분석</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                          {filteredFiles
                            .filter(f => statusFilter === 'all' || f.status === statusFilter)
                            .sort((a, b) => {
                              if (sortBy === 'risk') {
                                return (riskSeverityRank[a.risk?.severity] ?? 99) - (riskSeverityRank[b.risk?.severity] ?? 99);
                              }
                              if (sortBy === 'commits') return (b.commit_ids?.length || 0) - (a.commit_ids?.length || 0);
                              if (sortBy === 'changes') return ((b.additions || 0) + (b.deletions || 0)) - ((a.additions || 0) + (a.deletions || 0));
                              if (sortBy === 'additions') return (b.additions || 0) - (a.additions || 0);
                              if (sortBy === 'deletions') return (b.deletions || 0) - (a.deletions || 0);
                              return 0;
                            })
                            .map((file, idx) => (
                            <tr key={idx} className="transition-colors group">
                              <td className="py-4 px-6 align-top">
                                <span className={`inline-flex items-center px-2 py-1 rounded text-[10px] font-bold uppercase ${
                                  file.status === 'added' ? 'bg-green-500/10 text-green-500 border border-green-500/20' :
                                  file.status === 'deleted' ? 'bg-red-500/10 text-red-500 border border-red-500/20' :
                                  file.status === 'renamed' ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' :
                                  'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20'
                                }`}>
                                  {file.status === 'added' ? 'Added' :
                                   file.status === 'deleted' ? 'Deleted' :
                                   file.status === 'renamed' ? 'Renamed' : 'Modified'}
                                </span>
                              </td>
                              <td className="py-4 px-6 align-top w-[180px]">
                                <div className="group/name relative cursor-help">
                                  <div className="font-mono text-sm text-[#79b8c5] font-semibold truncate max-w-[160px]">
                                    {file.path.split('/').pop()}
                                  </div>
                                  <div className="text-[10px] text-slate-500 truncate max-w-[160px]">{file.path}</div>
                                  
                                  {/* Tooltip with full path on hover */}
                                  <div className="absolute left-0 top-full mt-1 z-50 invisible group-hover/name:visible opacity-0 group-hover/name:opacity-100 transition-all duration-200 delay-200">
                                    <div className="modal-shell rounded-xl px-3 py-2 shadow-xl max-w-md">
                                      <div className="text-[10px] text-slate-400 mb-1">전체 경로:</div>
                                      <div className="font-mono text-xs text-slate-200 break-all">{file.path}</div>
                                    </div>
                                  </div>
                                </div>
                                {file.old_path && (
                                  <div className="text-[10px] text-slate-500 mt-1 italic truncate" title={file.old_path}>
                                    Was: {file.old_path.split('/').pop()}
                                  </div>
                                )}
                              </td>
                              <td className="py-4 px-6 align-top text-center">
                                  <div className="text-sm font-mono text-slate-300">
                                      {file.commit_ids?.length > 0 ? (
                                          <span className="cursor-help border-b border-dotted border-slate-500" title={`Commits: ${file.commit_ids?.join(', ')}`}>
                                              {file.commit_ids.length}
                                          </span>
                                      ) : (
                                          <span className="text-slate-600">-</span>
                                      )}
                                  </div>
                              </td>
                              <td className="py-4 px-6 align-top text-center">
                                <div className="flex flex-col gap-1 items-center justify-center">
                                  <span className="text-xs font-semibold text-green-400">+{file.additions}</span>
                                  <span className="text-xs font-semibold text-red-400">-{file.deletions}</span>
                                </div>
                              </td>
                              <td className="py-4 px-6 align-top">
                                {file.risk && (
                                  <div className="mb-3 flex flex-wrap items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => setRiskFilter(file.risk.severity)}
                                      className={`rounded-full px-2 py-0.5 text-[10px] font-black border ${
                                        file.risk.severity === 'HIGH'
                                          ? 'bg-red-500/20 text-red-200 border-red-400/30'
                                          : file.risk.severity === 'MEDIUM'
                                            ? 'bg-amber-500/20 text-amber-100 border-amber-400/30'
                                            : 'bg-yellow-500/15 text-yellow-100 border-yellow-300/25'
                                      }`}
                                      title="같은 심각도만 보기"
                                    >
                                      잠재 리스크 · {file.risk.severity}
                                    </button>
                                    <span
                                      className="max-w-[420px] truncate rounded-full border border-primary/10 bg-stone-950/45 px-2 py-0.5 text-[10px] text-stone-400"
                                      title={file.risk.originalContent}
                                    >
                                      {file.risk.riskType}
                                    </span>
                                    {file.risk.location && file.risk.location !== '위치 미상' && (
                                      <span className="rounded-full border border-primary/10 bg-stone-950/45 px-2 py-0.5 text-[10px] font-mono text-stone-500">
                                        {file.risk.location}
                                      </span>
                                    )}
                                  </div>
                                )}
                                {file.ai_summary ? (
                                  <AiMarkdown compact sectioned className="max-h-56 overflow-y-auto pr-2 custom-scrollbar">
                                    {file.ai_summary}
                                  </AiMarkdown>
                                ) : (
                                  <div className="text-sm text-slate-500">분석 내용 없음</div>
                                )}
                                {file.cache_hit && (
                                  <span className="mt-2 inline-flex rounded-full border border-[#79b8c5]/25 bg-[#79b8c5]/10 px-2 py-0.5 text-[10px] font-bold text-[#b8edf5]">
                                    캐시 재사용
                                  </span>
                                )}
                              </td>
                              <td className="py-4 px-6 align-top text-center space-y-2">
                                {/* Deep Analysis Button */}
                                <button
                                  onClick={() => handleDeepAnalysis(file)}
                                  className="action-secondary w-full px-3 py-1.5 text-xs whitespace-nowrap"
                                  title="이 파일의 커밋 흐름 분석"
                                >
                                   <BookOpen size={14} />
                                   커밋 흐름
                                </button>

                                 <button
                                   onClick={() => setSelectedFileForDiff(file)}
                                   className="p-2 hover:bg-primary/20 hover:text-primary text-slate-500 rounded-lg transition-all group/btn"
                                   title="Diff 보기"
                                 >
                                   <Eye size={18} className="group-hover/btn:scale-110 transition-transform"/>
                                 </button>
                              </td>
                            </tr>
                          ))}
                          {filteredFiles
                            .filter(f => statusFilter === 'all' || f.status === statusFilter).length === 0 && (
                             <tr>
                                <td colSpan="6" className="py-12 text-center text-slate-500">
                                   <div className="flex flex-col items-center gap-2">
                                      <Search size={24} className="opacity-20" />
                                      <p>검색 결과가 없습니다.</p>
                                   </div>
                                </td>
                             </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                </div>
              </div>
            </div>
          ) : result.mode === 'history' ? (
            <div className="surface-panel rounded-[1.75rem] overflow-hidden p-6">
                 <div className="mb-4 flex flex-col md:flex-row md:items-end justify-between gap-3">
                   <div>
                     <h3 className="text-xl font-bold flex items-center gap-3 text-primary">
                        <BookOpen className="w-6 h-6" />
                        커밋 흐름 분석 결과 ({deepAnalysisResults.length} / {result.files?.length})
                     </h3>
                     <p className="mt-1 text-xs text-stone-500">
                       파일별 관련 커밋을 시간순으로 따라가며 왜 바뀌었는지 요약합니다. 참여자는 책임 판정이 아니라 Git 기록의 참고 정보입니다.
                     </p>
                   </div>
                   <span className="status-pill px-3 py-1 text-xs self-start md:self-auto">중요 파일부터 확인 권장</span>
                 </div>
                 <div className="overflow-x-auto custom-scrollbar">
                    <table className="data-table w-full text-left">
                       <thead>
                          <tr className="text-xs uppercase tracking-wider">
                             <th className="py-3 px-4">파일</th>
                             <th className="py-3 px-4">흐름 요약</th>
                             <th className="py-3 px-4 text-center">커밋</th>
                             <th className="py-3 px-4">참여자</th>
                             <th className="py-3 px-4 text-center">상세</th>
                          </tr>
                       </thead>
                       <tbody>
                          {deepAnalysisResults.map((item, idx) => (
                             <tr key={idx}>
                                <td className="py-3 px-4 font-mono text-sm text-[#79b8c5]">
                                   {item.file_path.split('/').pop()}
                                   <div className="text-[10px] text-slate-500 truncate max-w-[200px]">{item.file_path}</div>
                                </td>
                                <td className="py-3 px-4 text-sm text-slate-300 max-w-md">
                                   <div className="line-clamp-2 hover:line-clamp-none transition-all cursor-help" title={item.summary}>
                                      {item.summary}
                                   </div>
                                </td>
                                <td className="py-3 px-4 text-center text-sm">{item.commit_count}</td>
                                <td className="py-3 px-4 text-xs text-slate-400">
                                   {item.contributors.join(', ')}
                                </td>
                                <td className="py-3 px-4 text-center">
                                   <button 
                                      onClick={() => {
                                         setSelectedHistoryFile({ path: item.full_analysis.file_path })
                                         setHistoryAnalysis(item.full_analysis)
                                         setHistoryDrawerOpen(true)
                                      }}
                                      className="action-secondary p-2"
                                      title="View Detailed Timeline"
                                   >
                                      <BookOpen size={16} />
                                   </button>
                                </td>
                             </tr>
                          ))}
                          {deepAnalysisResults.length === 0 && (
                             <tr>
                                <td colSpan="5" className="py-8 text-center text-slate-500">
                                   커밋 흐름 분석 결과가 여기에 표시됩니다. 전체 실행이 길면 빠른 분석 표에서 중요한 파일만 먼저 열어보세요.
                                </td>
                             </tr>
                          )}
                       </tbody>
                    </table>
                 </div>
            </div>
          ) : (
            <>
              <div className="grid md:grid-cols-3 gap-3">
                <div className="surface-card rounded-2xl p-4 border border-primary/10">
                  <p className="eyebrow text-[10px] font-bold text-primary mb-2">Review question</p>
                  <h3 className="text-base font-black text-stone-50">선택 범위를 리뷰 요약으로 만들기</h3>
                  <p className="mt-1 text-xs text-stone-500">현재 AI 분석 범위 안에서 변경 의도와 검토 포인트를 더합니다.</p>
                </div>
                <div className="surface-card rounded-2xl p-4 border border-primary/10">
                  <p className="eyebrow text-[10px] font-bold text-stone-500 mb-2">Scope</p>
                  <div className="flex items-end gap-2">
                    <span className="text-3xl font-black text-stone-50">{result.files?.length || 0}</span>
                    <span className="pb-1 text-sm text-stone-500">files</span>
                  </div>
                  <p className="mt-1 text-xs text-stone-500">{result.commit_count || 0} commits 기준 요약</p>
                </div>
                <div className="surface-card rounded-2xl p-4 border border-[#79b8c5]/20 bg-[#79b8c5]/5">
                  <p className="eyebrow text-[10px] font-bold text-[#79b8c5] mb-2">Reviewer note</p>
                  <h3 className="text-base font-black text-stone-50">AI 요약은 검토 보조</h3>
                  <p className="mt-1 text-xs text-stone-500">테스트 결과나 최종 승인 대신, 리뷰어가 볼 항목을 빠르게 정리합니다.</p>
                </div>
              </div>
              <div className="grid lg:grid-cols-3 gap-6">
              {/* File List */}
              <div className="surface-panel rounded-[1.75rem] p-6">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-primary">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M2 6a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1H8a3 3 0 00-3 3v1.5a1.5 1.5 0 01-3 0V6z" clipRule="evenodd" />
                    <path d="M6 12a2 2 0 012-2h8a2 2 0 012 2v2a2 2 0 01-2 2H2h2a2 2 0 002-2v-2z" />
                  </svg>
                  파일별 분석 ({result.files?.length})
                </h3>
                <div className="space-y-4 max-h-[700px] overflow-y-auto pr-2 custom-scrollbar">
                  {result.files?.map((file, idx) => (
                    <div
                      key={idx}
                      className="surface-card p-4 rounded-xl hover:border-primary/30 transition-all group"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`w-2 h-2 rounded-full ${
                            file.status === 'added' ? 'bg-green-500' :
                            file.status === 'deleted' ? 'bg-red-500' :
                            file.status === 'renamed' ? 'bg-blue-500' : 'bg-yellow-500'
                          }`}></span>
                          <span className="text-xs font-mono truncate text-slate-300" title={file.path}>{file.path.split('/').pop()}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px]">
                          <span className="text-green-500">+{file.additions}</span>
                          <span className="text-red-500">-{file.deletions}</span>
                        </div>
                        <button 
                          onClick={() => setSelectedFileForDiff(file)}
                          className="p-1.5 hover:bg-primary/20 text-slate-500 hover:text-primary rounded-lg transition-all"
                          title="View Diff"
                        >
                          <Eye size={14} />
                        </button>
                      </div>
                      {file.ai_summary && (
                        <div className="text-[11px] text-slate-400 line-clamp-3 bg-slate-900/30 p-2 rounded-lg border border-slate-700/30 group-hover:line-clamp-none transition-all">
                          {aiSummaryPreviewText(file.ai_summary, 220)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Summary */}
              <div className="lg:col-span-2 glass rounded-2xl p-8">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-6">
                  <h3 className="text-xl font-bold flex items-center gap-3 text-secondary">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    선택 범위 AI 요약 및 분류
                  </h3>
                  <div className="flex gap-2">
                    <span className="status-pill px-3 py-1">
                      GPT-4o-mini
                    </span>
                  </div>
                </div>
                
                <AiMarkdown sectioned>
                  {result.summary}
                </AiMarkdown>
              </div>
            </div>
            </>
          )}
        </div>
      )}
    </>
  )
}

export default DashboardResultsPanel
