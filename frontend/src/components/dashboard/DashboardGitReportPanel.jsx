import { useDashboardContext } from './DashboardContext'

function DashboardGitReportPanel() {
  const { BarChart3, ChevronDown, ChevronUp, Clock, Download, Eye, FileText, Fragment, GitCompareArrows, GitMerge, Search, ShieldCheck, Sparkles, authorFilter, baselineOnlyGitReportFiles, baselineRef, candidateRef, downloadGitHeatmapXlsx, downloadGitReportXlsx, expandedGitRows, filteredGitReportFiles, formatDate, getChangeSizeClass, getChangeSizeLabel, getDirectoryPath, getFileName, getFileStatusClass, getFileStatusLabel, getHeatmapCellStyle, getHeatmapMetricValue, getLastTouchInfo, getRepoHost, gitHeatmapMetric, gitReport, gitReportDensity, gitReportHeatmap, gitReportRef, gitReportView, gitTableQuery, gitTableSort, gitTableStatus, impactMaxFiles, includeImpact, isPreDeployGitReport, loadingMergeCheck, mergeCheck, mergeCheckBadge, preDeployAiCanRun, preDeployAiDirectCount, preDeployAiImpactCount, preDeployAiStatus, preDeployAiSummaryText, progress, runMergeCheck, setGitHeatmapMetric, setGitReportView, setGitTableQuery, setGitTableSort, setGitTableStatus, setSelectedFileForDiff, settings, startPreDeployAiAnalysis, toggleGitRowDetails } = useDashboardContext()
  return (
    <>
      {gitReport && (
        <div ref={gitReportRef} className="surface-panel rounded-[1.75rem] overflow-hidden scroll-mt-6">
          <div className="p-4 border-b border-primary/10 bg-stone-950/35 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="eyebrow text-[10px] font-bold text-primary mb-1 flex items-center gap-1.5">
                <GitCompareArrows size={13} strokeWidth={2.5} />
                Git snapshot diff
              </div>
              <h3 className="text-xl font-bold text-stone-50">
                {gitReport.comparison_type === 'pre_deploy' ? '배포 전 직접 변경 파일' : 'Git 커밋 A → B 최종 변경표'}
              </h3>
              <p className="text-xs text-stone-400 mt-1">
                {gitReport.comparison_type === 'pre_deploy' ? (
                  <>
                    개발 <code className="text-stone-200">{gitReport.candidate_ref || gitReport.target_commit?.slice(0, 8) || 'HEAD'}</code>
                    <span className="mx-2 text-stone-600">↔</span>
                    기준 <code className="text-stone-200">{gitReport.baseline_ref || gitReport.base_commit?.slice(0, 8)}</code>
                  </>
                ) : (
                  <>
                    <code className="text-stone-200">{gitReport.baseline_ref || gitReport.base_commit?.slice(0, 8)}</code>
                    <span className="mx-2 text-stone-600">→</span>
                    <code className="text-stone-200">{gitReport.candidate_ref || gitReport.target_commit?.slice(0, 8) || 'HEAD'}</code>
                  </>
                )}
                <span className="mx-2 text-stone-600">·</span>
                {gitReport.comparison_type === 'pre_deploy'
                  ? 'Git compare가 확정한 직접 변경 파일입니다. AI 영향 후보와 분리해서 봅니다.'
                  : '리뷰용 기본 표입니다. 커밋 상세는 행의 고급 정보를 펼쳐 확인합니다.'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-stone-400">
                <span className="status-pill px-2 py-1 max-w-[240px]">
                  저장소 <span className="truncate normal-case">{settings.repoName || getRepoHost(settings.gitUrl)}</span>
                </span>
                <span className="status-pill px-2 py-1">
                  Branch {settings.branch || 'main'}
                </span>
                <span className="status-pill px-2 py-1">
                  {gitReport.comparison_type === 'pre_deploy'
                    ? `개발 ${gitReport.candidate_resolved?.short_sha || gitReport.target_commit?.slice(0, 8) || 'HEAD'} ↔ 기준 ${gitReport.baseline_resolved?.short_sha || gitReport.base_commit?.slice(0, 8)}`
                    : `범위 ${gitReport.baseline_resolved?.short_sha || gitReport.base_commit?.slice(0, 8)} → ${gitReport.candidate_resolved?.short_sha || gitReport.target_commit?.slice(0, 8) || 'HEAD'}`}
                </span>
                {gitReport.compare_strategy && (
                  <span className="status-pill px-2 py-1">
                    {gitReport.compare_strategy === 'branch_delta' ? '브랜치 작업분' : '배포 상태 차이'}
                  </span>
                )}
                {authorFilter.length > 0 && (
                  <span className="status-pill px-2 py-1">
                    작성자 {authorFilter.length}명 필터
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="status-pill px-3 py-1">{gitReport.file_count} Files</span>
              <span className="status-pill px-3 py-1">{gitReport.commit_count} Commits in range</span>
              <span className="status-pill px-3 py-1 text-secondary">+{gitReport.total_additions}</span>
              <span className="status-pill px-3 py-1 text-[#ff9b78]">-{gitReport.total_deletions}</span>
              <button
                onClick={downloadGitReportXlsx}
                className="action-primary px-4 py-2 text-sm"
              >
                <Download size={16} />
                Git XLSX Export
              </button>
              <button
                onClick={downloadGitHeatmapXlsx}
                className="action-ghost px-4 py-2 text-sm"
                title="파일 x 커밋 시간순 추가/삭제 히트맵을 XLSX로 내보냅니다."
              >
                <BarChart3 size={16} />
                Heatmap XLSX
              </button>
            </div>
          </div>

          {isPreDeployGitReport && (
            <div className="border-b border-[#79b8c5]/15 bg-[#101916]/55 p-4">
              <div className="flex min-w-0 flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="eyebrow whitespace-nowrap text-[10px] font-bold text-[#79b8c5]">Pre-deploy AI gate</span>
                    <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold ${mergeCheckBadge.className}`}>
                      {mergeCheckBadge.label}
                    </span>
                    <span className="whitespace-nowrap rounded-full border border-[#79b8c5]/25 bg-[#79b8c5]/10 px-2 py-0.5 text-[10px] font-bold text-[#b8edf5]">
                      직접 변경표 준비됨
                    </span>
                    <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                      preDeployAiStatus === 'complete'
                        ? 'border-[#79b8c5]/35 bg-[#79b8c5]/10 text-[#b8edf5]'
                        : preDeployAiStatus === 'running'
                          ? 'border-primary/35 bg-primary/10 text-primary'
                          : 'border-stone-700 bg-stone-950/35 text-stone-500'
                    }`}>
                      {preDeployAiStatus === 'complete'
                        ? 'AI 분석 완료'
                        : preDeployAiStatus === 'running'
                          ? 'AI 분석 중'
                          : 'AI 분석 대기'}
                    </span>
                  </div>
                  <h4 className="mt-2 text-lg font-black text-stone-50">AI가 볼 근거와 다음 행동</h4>
                  <p className="mt-1 text-sm text-stone-400">
                    AI는 아래 Git 직접 변경 파일, 선택한 diff, 커밋/작성자 맥락, 영향 후보 탐색 근거를 읽어 배포 리스크를 추론합니다.
                    실제 merge, commit, push 또는 파일 수정은 수행하지 않습니다.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-stone-400">
                    <span className="status-pill whitespace-nowrap px-2 py-1">근거 {gitReport.file_count} files</span>
                    <span className="status-pill whitespace-nowrap px-2 py-1">커밋 {gitReport.commit_count}개</span>
                    <span className="status-pill whitespace-nowrap px-2 py-1">전략 {gitReport.compare_strategy === 'branch_delta' ? '브랜치 작업분' : '배포 상태 차이'}</span>
                    {includeImpact && <span className="status-pill whitespace-nowrap px-2 py-1">영향 후보 최대 {Math.min(Math.max(Number(impactMaxFiles) || 15, 0), 30)}개</span>}
                  </div>
                </div>

                <div className="flex w-full min-w-0 flex-col gap-2 2xl:w-[520px] 2xl:shrink-0">
                  <div className="rounded-2xl border border-primary/10 bg-stone-950/35 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-black text-stone-100">
                          {preDeployAiStatus === 'complete'
                            ? 'AI 영향 분석 결과가 준비되었습니다'
                            : preDeployAiStatus === 'running'
                              ? 'AI가 직접 변경 파일을 읽고 있습니다'
                              : '변경표 다음 단계는 AI 영향 분석입니다'}
                        </div>
                        <div className="mt-1 text-[11px] text-stone-500">
                          {preDeployAiStatus === 'complete'
                            ? `직접 파일 ${preDeployAiDirectCount}개 · 영향 후보 ${preDeployAiImpactCount}개`
                            : preDeployAiStatus === 'running'
                              ? (progress?.message || progress?.event || '파일별 증빙과 영향 후보를 스트리밍합니다.')
                              : '버튼을 누르면 아래 변경표를 근거로 배포 전 AI 리뷰를 시작합니다.'}
                        </div>
                      </div>
                      {preDeployAiStatus === 'running' && <Clock size={18} className="shrink-0 animate-spin text-primary" />}
                      {preDeployAiStatus === 'complete' && <ShieldCheck size={18} className="shrink-0 text-[#79b8c5]" />}
                      {preDeployAiStatus === 'ready' && <Sparkles size={18} className="shrink-0 text-primary" />}
                    </div>
                    {preDeployAiStatus === 'running' && (
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-950/80">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-primary to-[#79b8c5] transition-all"
                          style={{ width: `${progress?.total ? Math.max(8, ((progress.current || 0) / progress.total) * 100) : 18}%` }}
                        />
                      </div>
                    )}
                    {preDeployAiStatus === 'complete' && preDeployAiSummaryText && (
                      <p className="mt-2 line-clamp-2 text-xs text-stone-400" title={preDeployAiSummaryText}>
                        {preDeployAiSummaryText}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 xl:justify-end">
                    <button
                      type="button"
                      onClick={() => startPreDeployAiAnalysis('quick')}
                      disabled={!preDeployAiCanRun}
                      className="inline-flex h-10 items-center gap-2 rounded-full border border-primary/25 bg-primary px-4 text-sm font-black text-stone-950 transition-all hover:bg-[#ffc35c] disabled:cursor-not-allowed disabled:opacity-50"
                      title="직접 변경 파일별 AI 메모와 영향 후보를 생성합니다."
                    >
                          <Sparkles size={15} />
                      AI 영향 분석 시작
                    </button>
                    <button
                      type="button"
                      onClick={() => startPreDeployAiAnalysis('full')}
                      disabled={!preDeployAiCanRun}
                      className="inline-flex h-10 items-center gap-2 rounded-full border border-[#79b8c5]/25 bg-[#79b8c5]/10 px-4 text-sm font-bold text-[#b8edf5] transition-all hover:bg-[#79b8c5]/18 disabled:cursor-not-allowed disabled:opacity-50"
                      title="파일별 메모 이후 선택 범위 요약까지 생성합니다."
                    >
                      <FileText size={15} />
                      요약까지 생성
                    </button>
                    {mergeCheck?.status !== 'clean' && (
                      <button
                        type="button"
                        onClick={runMergeCheck}
                        disabled={loadingMergeCheck || !baselineRef || !candidateRef}
                        className="inline-flex h-10 items-center gap-2 rounded-full border border-stone-700 bg-stone-950/35 px-4 text-sm font-bold text-stone-300 transition-all hover:border-[#79b8c5]/30 hover:text-[#b8edf5] disabled:opacity-50"
                      >
                        <GitMerge size={15} />
                        dry-run 다시 확인
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {gitReport.comparison_type === 'pre_deploy' && baselineOnlyGitReportFiles.length > 0 && (
            <div className="border-b border-[#d7653d]/20 bg-[#d7653d]/5 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="eyebrow text-[10px] font-bold text-[#ff9b78] mb-1">Baseline-only changes</p>
                  <h4 className="text-base font-black text-stone-50">개발 후보에 없는 기준 버전 변경</h4>
                  <p className="mt-1 text-xs text-stone-400">
                    상태 차이 모드에서만 보이는 항목입니다. 배포 방식에 따라 prod hotfix 누락 또는 의도된 제거일 수 있습니다.
                  </p>
                </div>
                <span className="rounded-full border border-[#d7653d]/30 bg-[#d7653d]/10 px-3 py-1 text-xs font-bold text-[#ff9b78]">
                  {baselineOnlyGitReportFiles.length} files
                </span>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {baselineOnlyGitReportFiles.slice(0, 6).map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => setSelectedFileForDiff({ ...file, _gitOnly: true })}
                    className="flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-[#d7653d]/15 bg-stone-950/35 px-3 py-2 text-left hover:border-[#d7653d]/35"
                  >
                    <span className="min-w-0 truncate font-mono text-xs text-stone-300" title={file.path}>{file.path}</span>
                    <span className="shrink-0 text-xs font-bold text-[#ff9b78]">-{file.deletions || 0}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="border-b border-primary/10 bg-stone-950/20 p-3">
            <div className="mb-3 flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
              <div className="inline-flex w-fit rounded-full border border-primary/10 bg-stone-950/45 p-1">
                {[
                  ['table', '검토 파일 목록'],
                  ['density', '변경량 집중도'],
                  ['heatmap', '커밋 히트맵'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setGitReportView(value)}
                    className={`rounded-full px-4 py-2 text-xs font-bold transition-all ${
                      gitReportView === value
                        ? 'bg-primary text-stone-950 shadow-lg shadow-primary/10'
                        : 'text-stone-500 hover:text-stone-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-stone-500">
                변경량 집중도는 코드 변경 활동량 기준의 참고 뷰입니다. 최종 diff 숫자와 커밋별 누적 활동량은 다를 수 있습니다.
              </p>
            </div>
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-1 flex-col gap-2 md:flex-row md:items-center">
                <div className="field-surface flex h-10 min-w-[240px] flex-1 items-center gap-2 rounded-xl border px-3">
                  <Search size={15} className="text-stone-500 shrink-0" />
                  <input
                    type="text"
                    value={gitTableQuery}
                    onChange={(event) => setGitTableQuery(event.target.value)}
                    placeholder="파일 경로, 파일명, 최근 수정자 검색"
                    className="w-full bg-transparent text-sm text-stone-200 placeholder:text-stone-500 outline-none"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    ['all', '전체 상태'],
                    ['added', '추가'],
                    ['modified', '수정'],
                    ['deleted', '삭제'],
                    ['renamed', '이름 변경'],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setGitTableStatus(value)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
                        gitTableStatus === value
                          ? 'border-[#79b8c5]/40 bg-[#79b8c5]/10 text-[#b8edf5]'
                          : 'border-primary/10 bg-stone-950/25 text-stone-500 hover:text-stone-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-stone-500">
                  총 {gitReport.files.length}개 중 <span className="font-bold text-stone-200">{filteredGitReportFiles.length}</span>개 표시
                </span>
                <select
                  value={gitTableSort}
                  onChange={(event) => setGitTableSort(event.target.value)}
                  className="field-surface h-9 rounded-xl border px-3 text-xs outline-none"
                  aria-label="검토 정렬"
                >
                  <option value="changes">변경량 큰 순</option>
                  <option value="path">파일 경로순</option>
                  <option value="status">상태순</option>
                </select>
                {(gitTableQuery || gitTableStatus !== 'all' || gitTableSort !== 'changes') && (
                  <button
                    type="button"
                    onClick={() => {
                      setGitTableQuery('')
                      setGitTableStatus('all')
                      setGitTableSort('changes')
                    }}
                    className="action-ghost px-3 py-1.5"
                  >
                    필터 초기화
                  </button>
                )}
              </div>
            </div>
          </div>

          {gitReportView === 'density' ? (
            <div className="p-5 space-y-5">
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-2xl border border-primary/10 bg-stone-950/35 p-4">
                  <div className="eyebrow text-[10px] text-primary mb-2">Visible files</div>
                  <div className="text-2xl font-bold text-stone-50">{gitReportDensity.files.length}</div>
                  <div className="text-xs text-stone-500 mt-1">현재 필터 기준</div>
                </div>
                <div className="rounded-2xl border border-primary/10 bg-stone-950/35 p-4">
                  <div className="eyebrow text-[10px] text-primary mb-2">Line movement</div>
                  <div className="flex items-baseline gap-2 font-mono text-lg font-bold">
                    <span className="text-secondary">+{gitReportDensity.totalAdditions}</span>
                    <span className="text-[#ff9b78]">-{gitReportDensity.totalDeletions}</span>
                  </div>
                  <div className="text-xs text-stone-500 mt-1">추가/삭제 라인 합계</div>
                </div>
                <div className="rounded-2xl border border-primary/10 bg-stone-950/35 p-4">
                  <div className="eyebrow text-[10px] text-primary mb-2">Hotspot file</div>
                  <div className="text-sm font-bold text-[#9ed9e4] truncate" title={gitReportDensity.topFiles[0]?.path}>
                    {gitReportDensity.topFiles[0] ? getFileName(gitReportDensity.topFiles[0].path) : '없음'}
                  </div>
                  <div className="text-xs text-stone-500 mt-1">
                    {gitReportDensity.topFiles[0]?.change || 0} lines
                  </div>
                </div>
                <div className="rounded-2xl border border-primary/10 bg-stone-950/35 p-4">
                  <div className="eyebrow text-[10px] text-primary mb-2">Top author load</div>
                  <div className="text-sm font-bold text-stone-50 truncate" title={gitReportDensity.topAuthor?.name}>
                    {gitReportDensity.topAuthor?.name || '없음'}
                  </div>
                  <div className="text-xs text-stone-500 mt-1">
                    {gitReportDensity.topAuthor ? `변경 활동량 ${gitReportDensity.topAuthorShare}%` : '작성자 통계 없음'}
                  </div>
                </div>
              </div>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.55fr)]">
                <div className="rounded-2xl border border-primary/10 bg-stone-950/30 p-4 min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                    <div>
                      <div className="eyebrow text-[10px] text-primary mb-1">File heat ranking</div>
                      <h4 className="text-base font-bold text-stone-50">파일별 변경량 TOP</h4>
                    </div>
                    <span className="status-pill px-2 py-1 text-[11px]">+라인 / -라인 분리 표시</span>
                  </div>
                  <div className="space-y-3">
                    {gitReportDensity.topFiles.slice(0, 12).map((file, index) => {
                      const width = Math.max(4, Math.round((file.change / gitReportDensity.maxFileChange) * 100))
                      const addPct = file.change ? Math.round(((file.additions || 0) / file.change) * 100) : 0
                      const delPct = file.change ? 100 - addPct : 0
                      return (
                        <button
                          key={`${file.status}:${file.path}:${index}`}
                          type="button"
                          onClick={() => setSelectedFileForDiff({ ...file, _gitOnly: true })}
                          className="w-full rounded-xl border border-primary/10 bg-stone-950/35 px-3 py-3 text-left transition-colors hover:border-primary/25 hover:bg-stone-950/55"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-mono text-stone-500 w-6">{index + 1}</span>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${getFileStatusClass(file.status)}`}>
                              {getFileStatusLabel(file.status)}
                            </span>
                            <span className="min-w-0 flex-1 font-bold text-[#9ed9e4] truncate" title={file.path}>
                              {getFileName(file.path)}
                            </span>
                            <span className="font-mono text-xs">
                              <span className="text-secondary">+{file.additions || 0}</span>
                              <span className="mx-1 text-stone-600">/</span>
                              <span className="text-[#ff9b78]">-{file.deletions || 0}</span>
                            </span>
                          </div>
                          <div className="mt-2 flex items-center gap-3">
                            <div className="h-2 flex-1 rounded-full bg-stone-950/75 overflow-hidden">
                              <div className="flex h-full rounded-full overflow-hidden" style={{ width: `${width}%` }}>
                                {addPct > 0 && <span className="h-full bg-secondary" style={{ width: `${addPct}%` }} />}
                                {delPct > 0 && <span className="h-full bg-[#ff7b54]" style={{ width: `${delPct}%` }} />}
                              </div>
                            </div>
                            <span className="w-16 text-right text-xs text-stone-500">{file.change} lines</span>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-stone-500">
                            <span className="truncate max-w-[55%]" title={file.directory}>{file.directory}</span>
                            <span>·</span>
                            <span>{file.changeType}</span>
                            {file.lastTouch.author && (
                              <>
                                <span>·</span>
                                <span className="truncate">마지막 {file.lastTouch.author}</span>
                              </>
                            )}
                          </div>
                        </button>
                      )
                    })}
                    {gitReportDensity.topFiles.length === 0 && (
                      <div className="py-10 text-center text-sm text-stone-500">표시할 변경 파일이 없습니다.</div>
                    )}
                  </div>
                </div>

                <div className="space-y-5 min-w-0">
                  <div className="rounded-2xl border border-primary/10 bg-stone-950/30 p-4">
                    <div className="eyebrow text-[10px] text-primary mb-1">Author distribution</div>
                    <h4 className="text-base font-bold text-stone-50 mb-1">
                      {gitReportDensity.hasPerCommitStats ? '커밋 작성자별 변경 분포' : '마지막 수정자 기준 변경 분포'}
                    </h4>
                    <p className="text-[11px] text-stone-500 mb-4">리뷰 분배 참고용이며 사람 평가 지표가 아닙니다.</p>
                    <div className="space-y-3">
                      {gitReportDensity.authorsByTouch.slice(0, 8).map((author) => {
                        const width = Math.max(4, Math.round((author.change / gitReportDensity.maxAuthorChange) * 100))
                        return (
                          <div key={author.name}>
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span className="font-bold text-stone-200 truncate">{author.name}</span>
                              <span className="font-mono text-stone-500">
                                <span className="text-secondary">+{author.additions}</span>
                                <span className="mx-1">/</span>
                                <span className="text-[#ff9b78]">-{author.deletions}</span>
                              </span>
                            </div>
                            <div className="mt-1 h-2 rounded-full bg-stone-950/75 overflow-hidden">
                              <div className="h-full rounded-full bg-[#79b8c5]" style={{ width: `${width}%` }} />
                            </div>
                            <div className="mt-1 text-[10px] text-stone-600">{author.files} files · {author.commitCount} commits</div>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-primary/10 bg-stone-950/30 p-4">
                    <div className="eyebrow text-[10px] text-primary mb-1">Directory load</div>
                    <h4 className="text-base font-bold text-stone-50 mb-4">폴더별 변경 부하</h4>
                    <div className="space-y-3">
                      {gitReportDensity.directories.slice(0, 8).map((directory) => {
                        const width = Math.max(4, Math.round((directory.change / gitReportDensity.maxDirectoryChange) * 100))
                        return (
                          <div key={directory.directory}>
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span className="font-mono text-stone-300 truncate" title={directory.directory}>{directory.directory}</span>
                              <span className="text-stone-500">{directory.change} lines</span>
                            </div>
                            <div className="mt-1 h-2 rounded-full bg-stone-950/75 overflow-hidden">
                              <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {gitReportDensity.timeline.length > 0 && (
                <div className="rounded-2xl border border-primary/10 bg-stone-950/30 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                    <div>
                      <div className="eyebrow text-[10px] text-primary mb-1">Commit timeline</div>
                      <h4 className="text-base font-bold text-stone-50">커밋 시간 흐름</h4>
                    </div>
                    <span className="text-xs text-stone-500">막대 높이는 해당 날짜의 커밋 수입니다.</span>
                  </div>
                  <div className="flex items-end gap-2 overflow-x-auto custom-scrollbar pb-2">
                    {gitReportDensity.timeline.map((bucket) => (
                      <div key={bucket.key} className="flex min-w-[52px] flex-col items-center gap-2">
                        <div className="flex h-24 w-8 items-end rounded-full bg-stone-950/60 p-1">
                          <div
                            className="w-full rounded-full bg-primary"
                            style={{ height: `${Math.max(8, Math.round((bucket.commitCount / gitReportDensity.maxTimelineCount) * 100))}%` }}
                            title={`${bucket.key}: ${bucket.commitCount} commits, ${bucket.fileCount} files`}
                          />
                        </div>
                        <span className="text-[10px] text-stone-500 whitespace-nowrap">{bucket.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : gitReportView === 'heatmap' ? (
            <div className="p-5 space-y-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <div className="eyebrow text-[10px] text-primary mb-1">Commit heatmap</div>
                  <h4 className="text-lg font-bold text-stone-50">파일 × 커밋 변경량 히트맵</h4>
                  <p className="mt-1 text-xs text-stone-500">
                    행은 파일, 열은 Base → Target 사이의 커밋 시간순입니다. 셀 값은 커밋별 변경 활동량이라 최종 diff 합계와 다를 수 있습니다.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {[
                    ['split', '+/- 분리'],
                    ['churn', '총 변경'],
                    ['additions', '추가'],
                    ['deletions', '삭제'],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setGitHeatmapMetric(value)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
                        gitHeatmapMetric === value
                          ? 'border-primary/45 bg-primary/15 text-primary'
                          : 'border-primary/10 bg-stone-950/35 text-stone-500 hover:text-stone-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  <span className="status-pill px-3 py-1 text-[11px]">
                    {gitReportHeatmap.visibleRows.length} files × {gitReportHeatmap.commits.length} commits
                  </span>
                </div>
              </div>

              {!gitReportHeatmap.hasStats ? (
                <div className="rounded-2xl border border-[#ff9b78]/20 bg-[#ff9b78]/10 p-5 text-sm text-[#ffb199]">
                  커밋별 파일 통계가 없는 기존 결과입니다. `A→B 변경표 생성`을 다시 실행하면 화면 히트맵을 볼 수 있습니다.
                </div>
              ) : gitReportHeatmap.commits.length === 0 || gitReportHeatmap.visibleRows.length === 0 ? (
                <div className="rounded-2xl border border-primary/10 bg-stone-950/30 p-10 text-center text-sm text-stone-500">
                  현재 필터 조건에 맞는 히트맵 데이터가 없습니다.
                </div>
              ) : (
                <>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl border border-primary/10 bg-stone-950/35 p-4">
                      <div className="eyebrow text-[10px] text-primary mb-2">Metric</div>
                      <div className="text-lg font-bold text-stone-50">{gitReportHeatmap.metricLabel}</div>
                      <div className="text-xs text-stone-500 mt-1">현재 셀 색상 기준</div>
                    </div>
                    <div className="rounded-2xl border border-primary/10 bg-stone-950/35 p-4">
                      <div className="eyebrow text-[10px] text-primary mb-2">Max cell</div>
                      <div className="text-lg font-bold text-stone-50">
                        {gitHeatmapMetric === 'split' ? (
                          <span className="font-mono">
                            <span className="text-[#8fd4ff]">+{gitReportHeatmap.maxAdditionCell}</span>
                            <span className="mx-1 text-stone-600">/</span>
                            <span className="text-[#ff8f7a]">-{gitReportHeatmap.maxDeletionCell}</span>
                          </span>
                        ) : (
                          gitReportHeatmap.maxCellValue
                        )}
                      </div>
                      <div className="text-xs text-stone-500 mt-1">가장 진한 셀 기준값</div>
                    </div>
                    <div className="rounded-2xl border border-primary/10 bg-stone-950/35 p-4">
                      <div className="eyebrow text-[10px] text-primary mb-2">Rows</div>
                      <div className="text-lg font-bold text-stone-50">{gitReportHeatmap.visibleRows.length}</div>
                      <div className="text-xs text-stone-500 mt-1">
                        {gitReportHeatmap.hiddenRows > 0 ? `상위 60개 표시 · ${gitReportHeatmap.hiddenRows}개는 검색으로 좁혀 확인` : '전체 표시'}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-primary/10 bg-stone-950/25 overflow-hidden">
                    <div className="max-h-[640px] overflow-auto custom-scrollbar">
                      <table className="w-full min-w-[1320px] border-separate border-spacing-0 text-xs">
                        <thead className="sticky top-0 z-30">
                          <tr>
                            <th className="sticky left-0 z-40 w-[430px] bg-[#14120d] px-4 py-3 text-left text-stone-300 border-b border-primary/10">
                              파일
                            </th>
                            <th className="w-24 bg-[#14120d] px-3 py-3 text-right text-stone-300 border-b border-primary/10">
                              합계
                            </th>
                            {gitReportHeatmap.commits.map((commit) => (
                              <th
                                key={commit.key}
                                className="min-w-[92px] bg-[#14120d] px-2 py-3 text-center border-b border-primary/10"
                                title={[commit.shortSha, commit.author, commit.title, commit.date].filter(Boolean).join(' · ')}
                              >
                                <div className="font-mono text-[#9ed9e4]">{commit.shortSha}</div>
                                <div className="mt-1 text-[10px] text-stone-500 whitespace-nowrap">{formatDate(commit.date)}</div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {gitReportHeatmap.visibleRows.map((row, rowIndex) => (
                            <tr key={`${row.file.path}:${rowIndex}`} className="group">
                              <td className="sticky left-0 z-20 border-b border-primary/10 bg-[#11100b] px-4 py-3 align-top group-hover:bg-[#17140e]">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className={`inline-flex shrink-0 items-center px-2 py-0.5 rounded text-[10px] font-bold ${getFileStatusClass(row.file.status)}`}>
                                    {getFileStatusLabel(row.file.status)}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setSelectedFileForDiff({ ...row.file, _gitOnly: true })}
                                    className="min-w-0 truncate text-left font-bold text-[#9ed9e4] hover:text-primary"
                                    title="Diff 보기"
                                  >
                                    {getFileName(row.file.path)}
                                  </button>
                                </div>
                                <div className="mt-1 font-mono text-[10px] text-stone-600 truncate" title={row.file.path}>
                                  {getDirectoryPath(row.file.path)}
                                </div>
                                {row.lastTouch.author && (
                                  <div className="mt-1 text-[10px] text-stone-500 truncate">
                                    마지막 수정자 {row.lastTouch.author}
                                  </div>
                                )}
                              </td>
                              <td className="border-b border-primary/10 px-3 py-3 text-right align-middle font-mono text-stone-300">
                                {gitHeatmapMetric === 'split' ? (
                                  <div className="grid gap-0.5 leading-none">
                                    <span className="text-[#8fd4ff]">+{row.totalAdditions}</span>
                                    <span className="text-[#ff8f7a]">-{row.totalDeletions}</span>
                                  </div>
                                ) : (
                                  row.totalMetric
                                )}
                              </td>
                              {gitReportHeatmap.commits.map((commit) => {
                                const cell = row.cells.get(commit.key) || { additions: 0, deletions: 0 }
                                const value = getHeatmapMetricValue(cell, gitHeatmapMetric)
                                const title = [
                                  row.file.path,
                                  `${commit.shortSha} · ${commit.author}`,
                                  commit.title,
                                  `+${cell.additions || 0} / -${cell.deletions || 0}`,
                                ].filter(Boolean).join('\n')
                                return (
                                  <td key={`${row.file.path}:${commit.key}`} className="border-b border-primary/10 px-1.5 py-2 text-center align-middle">
                                    <button
                                      type="button"
                                      title={title}
                                      onClick={() => setSelectedFileForDiff({ ...row.file, _gitOnly: true })}
                                      className={`mx-auto grid min-w-14 place-items-center rounded-lg border px-2 font-mono text-[11px] font-bold transition-transform hover:scale-105 ${
                                        gitHeatmapMetric === 'split' ? 'h-12' : 'h-9'
                                      }`}
                                      style={getHeatmapCellStyle(value, gitReportHeatmap.maxCellValue, gitHeatmapMetric, cell)}
                                    >
                                      {gitHeatmapMetric === 'split' ? (
                                        value ? (
                                          <span className="grid gap-0.5 leading-none">
                                            {(cell.additions || 0) > 0 && <span className="text-[#d8f1ff]">+{cell.additions}</span>}
                                            {(cell.deletions || 0) > 0 && <span className="text-[#ffe0d9]">-{cell.deletions}</span>}
                                          </span>
                                        ) : (
                                          <span className="text-stone-700">·</span>
                                        )
                                      ) : (
                                        value || ''
                                      )}
                                    </button>
                                  </td>
                                )
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/10 bg-stone-950/30 p-3 text-[11px] text-stone-500">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>색상 기준</span>
                      {gitHeatmapMetric === 'split' ? (
                        <>
                          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-5 rounded bg-[#4babec]" /> 추가</span>
                          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-5 rounded bg-[#ff6a54]" /> 삭제</span>
                          <span className="inline-flex items-center gap-1">
                            <span className="h-2.5 w-5 rounded" style={getHeatmapCellStyle(4, 4, 'split', { additions: 2, deletions: 2 })} />
                            둘 다
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="h-3 w-8 rounded-full border border-primary/10" style={getHeatmapCellStyle(1, 4, gitHeatmapMetric)} />
                          <span className="h-3 w-8 rounded-full border border-primary/10" style={getHeatmapCellStyle(2, 4, gitHeatmapMetric)} />
                          <span className="h-3 w-8 rounded-full border border-primary/10" style={getHeatmapCellStyle(4, 4, gitHeatmapMetric)} />
                          <span>약함 → 강함</span>
                        </>
                      )}
                    </div>
                    <span>히트맵은 변경 활동량을 보여주며, 위험도나 책임 소재 판단 지표가 아닙니다.</span>
                  </div>
                </>
              )}
            </div>
          ) : (
          <div className="max-h-[560px] overflow-auto custom-scrollbar">
            <table className="data-table w-full min-w-[1240px] text-left text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="text-xs uppercase tracking-wider">
                  <th className="py-3 px-4 w-24">상태</th>
                  <th className="py-3 px-4 w-[44%] min-w-[460px]">파일 경로</th>
                  <th className="py-3 px-4 w-48">마지막 수정자</th>
                  <th className="py-3 px-4 w-28 text-center">라인</th>
                  <th className="py-3 px-4 w-20 text-center">Diff</th>
                  <th className="py-3 px-4 w-36 text-center">고급</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {filteredGitReportFiles.map((file, index) => {
                  const lastTouch = getLastTouchInfo(file)
                  const rowKey = `${file.status}:${file.old_path || ''}:${file.path}`
                  const commitCount = file.commit_ids?.length || file.related_commits?.length || 0
                  const isExpanded = expandedGitRows.has(rowKey)
                  return (
                    <Fragment key={rowKey}>
                      <tr className="group">
                        <td className="py-3 px-4 align-top">
                          <span className={`inline-flex items-center px-2 py-1 rounded text-[10px] font-bold uppercase ${getFileStatusClass(file.status)}`}>
                            {getFileStatusLabel(file.status)}
                          </span>
                          {file.compare_origin_label && (
                            <span className="mt-1 inline-flex rounded-full border border-primary/10 px-2 py-0.5 text-[10px] font-bold text-stone-500">
                              {file.compare_origin_label}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 align-top min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-[#9ed9e4] break-all">{getFileName(file.path)}</span>
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${getChangeSizeClass(file)}`}>
                              {getChangeSizeLabel(file)}
                            </span>
                          </div>
                          <div className="mt-1 font-mono text-[11px] text-stone-500 break-all" title={file.path}>
                            {getDirectoryPath(file.path)}
                          </div>
                          {file.old_path && (
                            <div className="text-[11px] text-stone-500 mt-1 break-all">이전: {file.old_path}</div>
                          )}
                        </td>
                        <td className="py-3 px-4 align-top">
                          {lastTouch.author ? (
                            <div
                              className="min-w-0"
                              title={[lastTouch.author, lastTouch.email, lastTouch.commit, lastTouch.date].filter(Boolean).join(' · ')}
                            >
                              <div className="font-bold text-stone-100 truncate">{lastTouch.author}</div>
                              <div className="mt-1 text-[11px] text-stone-500 truncate">
                                {lastTouch.shortCommit && (
                                  <span className="font-mono text-stone-400">{lastTouch.shortCommit}</span>
                                )}
                                {lastTouch.date && (
                                  <span className="ml-1">{formatDate(lastTouch.date)}</span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span className="text-stone-600">확인 불가</span>
                          )}
                        </td>
                        <td className="py-3 px-4 align-top text-center">
                          <div className="inline-flex items-center gap-2 rounded-full bg-stone-950/40 px-3 py-1 font-mono text-xs">
                            <span className="text-secondary">+{file.additions || 0}</span>
                            <span className="text-stone-600">/</span>
                            <span className="text-[#ff9b78]">-{file.deletions || 0}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 align-top text-center">
                          <button
                            type="button"
                            onClick={() => setSelectedFileForDiff({ ...file, _gitOnly: true })}
                            className="action-ghost mx-auto h-10 w-10 justify-center rounded-full p-0"
                            title="두 지점의 diff 보기"
                            aria-label={`${file.path} diff 보기`}
                          >
                            <Eye size={16} />
                          </button>
                        </td>
                        <td className="py-3 px-4 align-top text-center">
                          <button
                            type="button"
                            onClick={() => toggleGitRowDetails(rowKey)}
                            className="action-ghost px-3 py-1.5 text-xs whitespace-nowrap"
                            aria-expanded={isExpanded}
                          >
                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            커밋 {commitCount}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-stone-950/30">
                          <td colSpan="6" className="px-4 py-4">
                            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] text-xs">
                              <div className="rounded-2xl border border-primary/10 bg-stone-950/35 p-4">
                                <div className="eyebrow text-[10px] text-primary mb-2">Advanced Git detail</div>
                                <dl className="space-y-2 text-stone-400">
                                  <div className="flex gap-2">
                                    <dt className="w-24 shrink-0 text-stone-500">마지막 수정자</dt>
                                    <dd className="min-w-0 text-stone-200 truncate">{lastTouch.author || '확인 불가'}</dd>
                                  </div>
                                  {lastTouch.email && (
                                    <div className="flex gap-2">
                                      <dt className="w-24 shrink-0 text-stone-500">이메일</dt>
                                      <dd className="min-w-0 truncate">{lastTouch.email}</dd>
                                    </div>
                                  )}
                                  {lastTouch.commit && (
                                    <div className="flex gap-2">
                                      <dt className="w-24 shrink-0 text-stone-500">마지막 커밋</dt>
                                      <dd className="min-w-0 font-mono text-[#79b8c5] break-all">{lastTouch.commit}</dd>
                                    </div>
                                  )}
                                  {file.old_path && (
                                    <div className="flex gap-2">
                                      <dt className="w-24 shrink-0 text-stone-500">이전 경로</dt>
                                      <dd className="min-w-0 font-mono break-all">{file.old_path}</dd>
                                    </div>
                                  )}
                                </dl>
                              </div>
                              <div className="rounded-2xl border border-primary/10 bg-stone-950/35 p-4">
                                <div className="eyebrow text-[10px] text-primary mb-2">Commits touching this file</div>
                                {file.related_commits?.length > 0 ? (
                                  <div className="space-y-2 max-h-44 overflow-y-auto custom-scrollbar pr-2">
                                    {file.related_commits.map((commit, commitIndex) => (
                                      <div key={`${commit.id || commit.short_id}-${commitIndex}`} className="grid gap-1 rounded-xl bg-stone-950/45 px-3 py-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="font-mono text-[#79b8c5]">{commit.short_sha || commit.short_id || commit.id?.slice(0, 8)}</span>
                                          <span className="text-stone-500">{commit.author_name || commit.author || 'Unknown'}</span>
                                          {(commit.committed_date || commit.created_at) && (
                                            <span className="text-stone-600">{formatDate(commit.committed_date || commit.created_at)}</span>
                                          )}
                                        </div>
                                        <div className="text-stone-300 truncate" title={commit.title || commit.message}>
                                          {commit.title || commit.message || 'No commit message'}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-stone-600">관련 커밋 정보가 없습니다.</p>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
                {filteredGitReportFiles.length === 0 && (
                  <tr>
                    <td colSpan="6" className="py-12 text-center text-stone-500">
                      조건에 맞는 변경 파일이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          )}
        </div>
      )}
    </>
  )
}

export default DashboardGitReportPanel
