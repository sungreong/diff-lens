import { useDashboardContext } from './DashboardContext'

function DashboardStandardControlPanel() {
  const { API_URL, AlertTriangle, Clock, DarkOptionMenu, Eye, FileText, GitMerge, RefPicker, Search, Sparkles, Star, X, activePurposeDetail, analysisCostHint, analysisMode, analysisModeOptions, analysisSort, analysisSortOptions, analysisStatusFilter, applyRefBookmark, authorFilter, authorSearch, authors, authorsInRange, baseCommit, baseCommitList, baselineCommitOptions, baselineRef, baselineSourceRef, bookmarkError, cancelAnalysis, candidateCommitOptions, candidateRef, candidateSourceRef, clearMergeConflictPreview, commitLoadError, compareRefs, compareStrategy, compareStrategyOptions, comparisonPurpose, comparisonPurposeOptions, contextDepth, dateFilter, deleteRefBookmark, explainMergeCheckWithAi, fetchCommitsAndAuthors, formatDate, formatDuration, getAnalysisLimitLabel, getAnalysisSortOption, getAnalysisStatusLabel, getDateRangeOptions, getRepoHost, getRepoStateLabel, handleAnalyze, handleComparisonPurposeChange, handleModeChange, hasSelectedRange, impactMaxFiles, impactScopeOptions, includeImpact, isMergeCheckDemo, isMergeCheckRunning, isMergePlan, isPreDeploy, knownBranchNames, loading, loadingBookmarks, loadingCommits, loadingGitReport, loadingMergeCheck, loadingPreview, loadingRefScopedCommits, loadingRefs, maxFiles, mergeCheck, mergeCheckActiveStepIndex, mergeCheckAiQuestions, mergeCheckMessage, mergeCheckMethodLabel, mergeCheckProgress, mergeCheckSteps, mergeCheckTitle, notifyJobComplete, onOpenSettings, preview, previewAnalysisFileCount, previewMergeConflictUi, previewPrioritizedFiles, previewScopeFileCount, primaryActionDisabledReason, primaryActionLabel, primaryLoadingLabel, primaryRefOptionGroups, refBookmarks, refOptionGroups, repoBranchDraft, repoBranchError, repoBranchOptions, repoStatus, resolvedRefs, runMergeCheck, saveActiveRepoBranch, saveRefBookmark, savingRepoBranch, selectedModeDetail, setAnalysisSort, setAnalysisStatusFilter, setAuthorFilter, setAuthorSearch, setBaseCommit, setBaselineRef, setBaselineSourceRef, setCandidateRef, setCandidateSourceRef, setCompareStrategy, setContextDepth, setDateFilter, setImpactMaxFiles, setIncludeImpact, setMaxFiles, setSelectedFileForDiff, setTargetCommit, settings, shouldOfferMergeCheckAi, showJobNotice, targetCommit, targetCommitList, testActiveRepository, visibleAuthorChips, workflowSteps } = useDashboardContext()
  return (
    <>
      <div className="glass hero-panel rounded-[2rem] p-4 md:p-5">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 mb-3">
          <div>
            <p className="eyebrow text-[10px] font-bold text-primary mb-1">Git diff briefing room</p>
            <h2 className="text-xl md:text-2xl font-bold tracking-tight text-stone-50">{activePurposeDetail.title}</h2>
            <p className="text-xs md:text-sm text-stone-400 mt-1 max-w-3xl">{activePurposeDetail.description}</p>
          </div>

          <div className="flex flex-col items-stretch gap-2 shrink-0 xl:items-end">
            <div className="mode-switch flex rounded-full p-1 overflow-x-auto">
              {comparisonPurposeOptions.map((purpose) => (
                <button
                  key={purpose.key}
                  type="button"
                  onClick={() => handleComparisonPurposeChange(purpose.key)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs md:text-sm font-bold transition-all whitespace-nowrap ${
                    comparisonPurpose === purpose.key
                      ? 'bg-[#79b8c5] text-stone-950 shadow-lg shadow-[#79b8c5]/20'
                      : 'text-stone-400 hover:text-stone-100'
                  }`}
                >
                  <purpose.Icon size={16} />
                  {purpose.label}
                </button>
              ))}
            </div>

              <div className="mode-switch flex rounded-full p-1 overflow-x-auto">
                {analysisModeOptions.map((mode) => (
                  <button
                    key={mode.key}
                    type="button"
                    onClick={() => handleModeChange(mode.key)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs md:text-sm font-bold transition-all whitespace-nowrap ${
                      analysisMode === mode.key
                        ? 'bg-primary text-stone-950 shadow-lg shadow-primary/20'
                        : 'text-stone-400 hover:text-stone-100'
                    }`}
                  >
                    {mode.Icon ? (
                      <mode.Icon size={16} className="inline-block mr-1.5 align-[-2px]" />
                    ) : (
                      <span className="mr-1">{mode.icon}</span>
                    )}
                    {mode.label}
                    <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-black tracking-normal ${
                      analysisMode === mode.key
                        ? 'bg-stone-950/18 text-stone-950'
                        : mode.kind === 'git'
                          ? 'bg-[#79b8c5]/15 text-[#9ed9e4]'
                          : 'bg-primary/10 text-primary/80'
                    }`}>
                      {mode.badge}
                    </span>
                  </button>
                ))}
              </div>
          </div>
        </div>

        {/* Mode Description */}
        {!isMergePlan && <div className="mb-4 rounded-2xl border border-primary/10 bg-stone-950/25 px-4 py-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="eyebrow text-[10px] font-bold text-primary">Selected view</span>
                <h3 className="text-sm md:text-base font-black text-stone-50">{selectedModeDetail.title}</h3>
                <span className="status-pill px-2 py-0.5 text-[10px]">{selectedModeDetail.estimate}</span>
                <span className="text-[11px] text-stone-500">{selectedModeDetail.caution}</span>
              </div>
              <p className="mt-1 text-xs text-stone-400 truncate" title={`${selectedModeDetail.question} ${selectedModeDetail.result}`}>
                {selectedModeDetail.question} · {selectedModeDetail.result}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {workflowSteps.map((step, index) => (
                <span
                  key={step.label}
                  title={step.helper}
                  className={`inline-flex max-w-[220px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors ${
                    step.done
                      ? 'border-[#79b8c5]/25 bg-[#79b8c5]/10 text-[#b9e9f0]'
                      : step.active
                        ? 'border-primary/35 bg-primary/10 text-primary'
                        : 'border-primary/10 bg-stone-950/25 text-stone-500'
                  }`}
                >
                  <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] ${
                    step.done ? 'bg-[#79b8c5] text-stone-950' : step.active ? 'bg-primary text-stone-950' : 'bg-stone-800 text-stone-400'
                  }`}>
                    {step.done ? '✓' : index + 1}
                  </span>
                  <span className="truncate">{step.label}</span>
                </span>
              ))}
            </div>
          </div>
        </div>}

        <div className="repo-identity rounded-2xl px-4 py-3 mb-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 min-w-0">
          <div className="min-w-0">
            <div className="eyebrow text-[10px] font-bold text-primary mb-1">Git repository for this diff</div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-bold text-stone-50 truncate max-w-[280px]">{settings.repoName || settings.name || 'Active Repository'}</span>
              <span className="text-stone-600">/</span>
              <span className="font-mono text-[#79b8c5] truncate max-w-[320px]">{getRepoHost(settings.gitUrl)}</span>
              <span className="status-pill px-2 py-0.5">Project {settings.projectId || 'N/A'}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="connection-chip" data-state={repoStatus.state === 'warning' ? 'disconnected' : repoStatus.state}>
                {repoStatus.state === 'checking' && (
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z"></path>
                  </svg>
                )}
                {repoStatus.state !== 'checking' && (
                  <span className={`w-2 h-2 rounded-full ${
                    repoStatus.state === 'connected' ? 'bg-secondary' :
                    repoStatus.state === 'idle' ? 'bg-stone-600' :
                    'bg-[#d7653d]'
                  }`} />
                )}
                {getRepoStateLabel(repoStatus.state)}
              </span>
              <span className={`max-w-4xl truncate ${repoStatus.state === 'connected' ? 'text-secondary' : 'text-[#ff9b78]'}`} title={repoStatus.message}>
                {repoStatus.state === 'connected'
                  ? `${repoStatus.projectName || repoStatus.message}${repoStatus.defaultBranch ? ` · default: ${repoStatus.defaultBranch}` : ''}`
                  : repoStatus.message}
              </span>
              {commitLoadError && (
                <span className="text-[#ff9b78]" title={commitLoadError}>커밋 목록 로드 실패</span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs shrink-0">
            <div className="min-w-[220px]">
              <DarkOptionMenu
                value={repoBranchDraft || settings.branch || ''}
                onChange={saveActiveRepoBranch}
                optionGroups={[{ label: '브랜치', options: repoBranchOptions }]}
                disabled={savingRepoBranch || loadingRefs}
                loading={savingRepoBranch}
                placeholder="브랜치 선택"
                accentClass="text-primary"
                buttonClassName="field-surface flex h-9 items-center gap-2 rounded-full border px-3"
                valueClassName="text-xs font-black uppercase tracking-wide text-[#d8c796]"
                menuClassName="min-w-[320px]"
                title="커밋/작성자 목록의 기준이 되는 active repository branch를 저장합니다."
              />
              {repoBranchError && (
                <div className="mt-1 max-w-[280px] truncate text-[11px] text-[#ff9b78]" title={repoBranchError}>
                  {repoBranchError}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                testActiveRepository()
                fetchCommitsAndAuthors()
              }}
              className="action-ghost px-3 py-1"
            >
              연결 재확인
            </button>
            <button
              type="button"
              onClick={() => onOpenSettings?.('git')}
              className="action-ghost px-3 py-1 whitespace-nowrap"
              title="Repository 설정을 열어 분석에 사용할 저장소를 선택합니다."
            >
              저장소 바꾸기
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {isPreDeploy ? (
            <div className="space-y-3">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-end">
                <RefPicker
                  label="개발 버전"
                  helper="왼쪽: merge source"
                  value={candidateRef}
                  onChange={setCandidateRef}
                  primaryOptionGroups={primaryRefOptionGroups}
                  commitOptions={candidateCommitOptions}
                  sourceRef={candidateSourceRef}
                  onSourceRefChange={setCandidateSourceRef}
                  isSourceBranch={knownBranchNames.has((candidateSourceRef || '').trim())}
                  loading={loadingRefs}
                  branchCommitLoading={loadingRefScopedCommits.candidate}
                  placeholder="dev branch, candidate commit SHA"
                  resolved={resolvedRefs?.candidate}
                  onSave={() => saveRefBookmark('candidate')}
                  saveTitle="개발 버전을 중요한 상태로 저장"
                  accentClass="text-primary"
                />

                <div className="hidden pb-3 text-slate-500 lg:block">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </div>

                <RefPicker
                  label="기준 버전"
                  helper="오른쪽: merge target"
                  value={baselineRef}
                  onChange={setBaselineRef}
                  primaryOptionGroups={primaryRefOptionGroups}
                  commitOptions={baselineCommitOptions}
                  sourceRef={baselineSourceRef}
                  onSourceRefChange={setBaselineSourceRef}
                  isSourceBranch={knownBranchNames.has((baselineSourceRef || '').trim())}
                  loading={loadingRefs}
                  branchCommitLoading={loadingRefScopedCommits.baseline}
                  placeholder="main, prod, release tag, commit SHA"
                  resolved={resolvedRefs?.baseline}
                  onSave={() => saveRefBookmark('baseline')}
                  saveTitle="기준 버전을 중요한 상태로 저장"
                  accentClass="text-[#79b8c5]"
                />
              </div>

              {(refBookmarks.length > 0 || bookmarkError) && (
                <div className="rounded-2xl border border-primary/10 bg-stone-950/25 p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Star size={14} className="text-primary" />
                      <span className="text-sm font-bold text-stone-200">중요 버전 즐겨찾기</span>
                      {loadingBookmarks && <span className="text-[11px] text-stone-500">불러오는 중...</span>}
                    </div>
                    {bookmarkError && <span className="text-[11px] text-[#ff9b78] truncate">{bookmarkError}</span>}
                  </div>
                  <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1">
                    {refBookmarks.map(bookmark => (
                      <div key={bookmark.id} className="flex shrink-0 items-center gap-2 rounded-full border border-primary/10 bg-stone-950/40 px-2 py-1 text-xs">
                        <button
                          type="button"
                          onClick={() => applyRefBookmark(bookmark, 'baseline')}
                          className="rounded-full px-2 py-1 font-bold text-[#9ed9e4] hover:bg-[#79b8c5]/10"
                          title="기준 버전에 적용"
                        >
                          기준
                        </button>
                        <button
                          type="button"
                          onClick={() => applyRefBookmark(bookmark, 'candidate')}
                          className="rounded-full px-2 py-1 font-bold text-primary hover:bg-primary/10"
                          title="개발 버전에 적용"
                        >
                          개발
                        </button>
                        <span className="max-w-[220px] truncate font-mono text-stone-300" title={`${bookmark.label} · ${bookmark.ref}`}>
                          {bookmark.label}
                        </span>
                        <button
                          type="button"
                          onClick={() => deleteRefBookmark(bookmark.id)}
                          className="rounded-full p-1 text-stone-600 hover:bg-[#d7653d]/10 hover:text-[#ff9b78]"
                          aria-label={`${bookmark.label} 삭제`}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-[#79b8c5]/15 bg-stone-950/25 p-3">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-stone-200">비교 방식</span>
                      <span className="status-pill px-2 py-0.5 text-[10px]">
                        {compareStrategy === 'deployment_state' ? '기준/개발 전체 비교' : '브랜치 작업만'}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-stone-500">
                      기본값은 배포 기준과 개발 후보의 실제 상태 차이를 보여서 prod hotfix 누락도 드러냅니다.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {compareStrategyOptions.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setCompareStrategy(option.key)}
                        title={option.detail}
                        className={`rounded-full border px-3 py-2 text-xs font-bold transition-all ${
                          compareStrategy === option.key
                            ? 'border-[#79b8c5]/45 bg-[#79b8c5]/10 text-[#d8f6fb]'
                            : 'border-primary/10 bg-stone-950/35 text-stone-400 hover:border-primary/25 hover:text-stone-100'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                    <label className="inline-flex h-9 items-center gap-2 rounded-full border border-primary/10 bg-stone-950/35 px-3 text-xs font-bold text-stone-300">
                      <input
                        type="checkbox"
                        checked={includeImpact}
                        onChange={(e) => setIncludeImpact(e.target.checked)}
                        className="accent-primary"
                      />
                      영향 후보
                    </label>
                    <label
                      className="inline-flex h-9 items-center gap-2 rounded-full border border-primary/10 bg-stone-950/35 px-3 text-xs font-bold text-stone-300"
                      title="AI가 영향 후보로 보여줄 최대 파일 수입니다."
                    >
                      <span>후보 수</span>
                      <input
                        type="number"
                        min="0"
                        max="30"
                        value={impactMaxFiles}
                        onChange={(e) => setImpactMaxFiles(e.target.value)}
                        className="w-10 bg-transparent text-center text-xs text-stone-100 outline-none"
                      />
                    </label>
                    <select
                      value={contextDepth}
                      onChange={(e) => setContextDepth(Number(e.target.value))}
                      className="field-surface h-9 rounded-full border px-3 text-xs font-bold outline-none"
                      title="영향 후보를 찾을 때 얼마나 넓게 훑을지입니다. 결과 개수는 후보 수 한도를 넘지 않습니다."
                    >
                      {impactScopeOptions.map(option => (
                        <option key={option.value} value={option.value}>{`탐색 ${option.label}`}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={runMergeCheck}
                      disabled={loadingMergeCheck || !baselineRef || !candidateRef}
                      className="inline-flex h-9 items-center gap-2 rounded-full border border-[#79b8c5]/25 bg-[#79b8c5]/10 px-3 text-xs font-black text-[#b8edf5] transition-all hover:bg-[#79b8c5]/20 disabled:opacity-45"
                      title="실제 merge 없이 개발 후보를 기준 버전에 임시 dry-run merge해서 충돌 여부만 확인합니다."
                    >
                      {loadingMergeCheck ? <Clock size={14} className="animate-spin" /> : <GitMerge size={14} />}
                      충돌 체크 (dry-run)
                    </button>
                    <button
                      type="button"
                      onClick={isMergeCheckDemo ? clearMergeConflictPreview : previewMergeConflictUi}
                      disabled={loadingMergeCheck || !baselineRef || !candidateRef}
                      className="inline-flex h-9 items-center gap-2 rounded-full border border-[#d7653d]/25 bg-[#d7653d]/10 px-3 text-xs font-black text-[#ffb59e] transition-all hover:bg-[#d7653d]/18 disabled:opacity-45"
                      title="실제 Git 작업 없이 충돌 발생 화면만 미리 봅니다."
                    >
                      <AlertTriangle size={14} />
                      {isMergeCheckDemo ? '예시 닫기' : '충돌 예시 보기'}
                    </button>
                  </div>
                </div>
              </div>

              {(mergeCheckProgress || mergeCheck) && (
                <div className={`rounded-2xl border p-4 ${
                  isMergeCheckRunning
                    ? 'border-[#79b8c5]/20 bg-[#79b8c5]/10'
                    : mergeCheck?.status === 'clean'
                    ? 'border-[#79b8c5]/25 bg-[#79b8c5]/10'
                    : mergeCheck?.status === 'conflicts'
                      ? 'border-[#d7653d]/30 bg-[#d7653d]/10'
                      : 'border-amber-400/25 bg-amber-400/10'
                }`}>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {isMergeCheckRunning ? (
                          <Clock size={17} className="animate-spin text-[#79b8c5]" />
                        ) : mergeCheck?.status === 'conflicts' ? (
                          <AlertTriangle size={17} className="text-[#ff9b78]" />
                        ) : (
                          <GitMerge size={17} className={mergeCheck?.status === 'clean' ? 'text-[#79b8c5]' : 'text-amber-300'} />
                        )}
                        <h4 className="text-sm font-black text-stone-50">
                          {mergeCheckTitle}
                        </h4>
                      </div>
                      <p className="mt-1 text-xs text-stone-400">
                        {mergeCheckMessage}
                      </p>
                      <p className="mt-1 text-[11px] text-stone-500">
                        개발 {mergeCheck?.source_resolved?.short_sha || mergeCheck?.source_sha?.slice(0, 8) || candidateRef}
                        <span className="mx-1">→</span>
                        기준 {mergeCheck?.target_resolved?.short_sha || mergeCheck?.target_sha?.slice(0, 8) || baselineRef}
                        {mergeCheck?.merge_base_sha && <span className="ml-2 font-mono">base {mergeCheck.merge_base_sha.slice(0, 8)}</span>}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {mergeCheckProgress?.elapsedSeconds > 0 && (
                        <span className="rounded-full border border-primary/10 bg-stone-950/35 px-3 py-1 text-xs font-bold text-stone-400">
                          {formatDuration(mergeCheckProgress.elapsedSeconds)}
                        </span>
                      )}
                      <span className={`rounded-full border px-3 py-1 text-xs font-black ${
                        isMergeCheckRunning || mergeCheck?.status === 'clean'
                          ? 'border-[#79b8c5]/25 text-[#b8edf5]'
                          : mergeCheck?.status === 'conflicts'
                            ? 'border-[#d7653d]/30 text-[#ff9b78]'
                            : 'border-amber-400/25 text-amber-200'
                      }`}>
                        {isMergeCheckRunning ? '임시 병합 확인' : mergeCheckMethodLabel(mergeCheck?.method)}
                      </span>
                      {isMergeCheckDemo && (
                        <span className="rounded-full border border-[#d7653d]/30 bg-[#d7653d]/10 px-3 py-1 text-xs font-black text-[#ffb59e]">
                          화면 예시
                        </span>
                      )}
                      {mergeCheck?.status === 'unknown' && !loadingMergeCheck && (
                        <button
                          type="button"
                          onClick={runMergeCheck}
                          className="rounded-full border border-amber-400/25 px-3 py-1 text-xs font-black text-amber-200 hover:bg-amber-400/10"
                        >
                          현재 버전으로 다시 확인
                        </button>
                      )}
                    </div>
                  </div>

                  {mergeCheckProgress && (
                    <div className="mt-4 grid gap-2 md:grid-cols-5">
                      {mergeCheckSteps.map((step, index) => {
                        const isCurrent = index === mergeCheckActiveStepIndex
                        const isDone = mergeCheckProgress.status === 'completed' || index < mergeCheckActiveStepIndex
                        const isFailed = mergeCheckProgress.status === 'failed' && isCurrent
                        return (
                          <div
                            key={step.key}
                            className={`rounded-xl border px-3 py-3 ${
                              isFailed
                                ? 'border-amber-400/25 bg-amber-400/10'
                                : isCurrent && isMergeCheckRunning
                                  ? 'border-[#79b8c5]/30 bg-[#79b8c5]/10'
                                  : isDone
                                    ? 'border-[#79b8c5]/15 bg-stone-950/30'
                                    : 'border-primary/10 bg-stone-950/20 opacity-70'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-black ${
                                isFailed
                                  ? 'bg-amber-400/20 text-amber-200'
                                  : isDone
                                    ? 'bg-[#79b8c5]/15 text-[#b8edf5]'
                                    : isCurrent
                                      ? 'bg-[#79b8c5]/20 text-[#d8f6fb]'
                                      : 'bg-stone-800 text-stone-500'
                              }`}>
                                {isFailed ? '!' : isDone ? '완' : index + 1}
                              </span>
                              <span className="truncate text-xs font-black text-stone-100">{step.label}</span>
                            </div>
                            <p className="mt-2 text-[11px] leading-5 text-stone-500">{step.description}</p>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {isMergeCheckRunning && (
                    <p className="mt-3 text-[11px] text-stone-500">
                      서버가 실제 git 작업을 수행하는 동안 단계 기준으로 표시합니다. 토큰, 원격 URL, 임시 경로 같은 민감한 세부정보는 화면에 노출하지 않습니다.
                    </p>
                  )}

                  <p className="mt-3 rounded-xl border border-primary/10 bg-stone-950/25 px-3 py-2 text-[11px] text-stone-400">
                    {isMergeCheckDemo
                      ? '이 화면은 충돌 발생 시 UI를 확인하기 위한 예시입니다. Git 작업은 수행하지 않았습니다.'
                      : '이 확인은 임시 작업공간에서만 수행되며 실제 merge, commit, push는 수행하지 않습니다.'}
                  </p>

                  {mergeCheck?.status === 'clean' && (
                    <p className="mt-3 rounded-xl border border-[#79b8c5]/15 bg-stone-950/25 px-3 py-2 text-[11px] text-stone-400">
                      충돌이 발견되지 않았다는 뜻이며, 테스트 통과나 배포 가능 판정은 아닙니다.
                    </p>
                  )}

                  {shouldOfferMergeCheckAi && (
                    <div className="mt-3 rounded-2xl border border-primary/20 bg-stone-950/35 p-3">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Sparkles size={15} className="text-primary" />
                            <h5 className="text-sm font-black text-stone-50">
                              AI에게 이 상황 설명받기
                            </h5>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-stone-400">
                            {isMergeCheckDemo
                              ? '실제 충돌이 나면 이 자리에서 AI에게 원인, 우선 확인 파일, 다음 질문을 정리하게 할 수 있습니다.'
                              : 'dry-run 결과와 아래 변경표를 함께 보내서 원인, 우선 확인 파일, 다음 질문을 정리하게 합니다.'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={explainMergeCheckWithAi}
                          disabled={isMergeCheckDemo || loading || loadingGitReport || repoStatus.state !== 'connected'}
                          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full border border-primary/25 bg-primary px-4 text-sm font-black text-stone-950 transition-all hover:bg-[#ffc35c] disabled:cursor-not-allowed disabled:opacity-50"
                          title={isMergeCheckDemo ? '예시 화면에서는 AI를 호출하지 않습니다.' : 'dry-run 결과와 변경표를 함께 AI에게 보냅니다.'}
                        >
                          {loading ? <Clock size={15} className="animate-spin" /> : <Sparkles size={15} />}
                          {isMergeCheckDemo ? '실제 충돌에서 활성화' : 'AI에게 물어보기'}
                        </button>
                      </div>
                      {mergeCheckAiQuestions.length > 0 && (
                        <div className="mt-3 grid gap-2 lg:grid-cols-3">
                          {mergeCheckAiQuestions.map((question) => (
                            <div
                              key={question}
                              className="rounded-xl border border-primary/10 bg-stone-950/45 px-3 py-2 text-[11px] leading-5 text-stone-300"
                            >
                              {question}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {mergeCheck?.conflict_files?.length > 0 && (
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {mergeCheck.conflict_files.slice(0, 12).map(file => (
                        <div key={file} className="rounded-xl bg-stone-950/40 px-3 py-2 font-mono text-xs text-stone-300">
                          {file}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col lg:flex-row lg:items-end gap-4">
              {/* Date Filter - Compact */}
              <div className="w-[140px] shrink-0">
                <label className="block text-sm font-medium text-slate-300 mb-2 truncate">
                  📅 기간 필터
                </label>
                <select
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="field-surface w-full h-[50px] px-4 py-3 rounded-xl border outline-none transition-all"
                >
                  {getDateRangeOptions().map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {/* Base Commit */}
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  📍 Base (시작)
                  {loadingCommits && <span className="text-xs text-primary ml-1">(loading...)</span>}
                  {!loadingCommits && baseCommitList.length > 0 && <span className="text-xs text-slate-500 ml-1">({baseCommitList.length})</span>}
                  {!loadingCommits && commitLoadError && <span className="text-xs text-[#ff9b78] ml-1">(로드 실패)</span>}
                </label>
                {baseCommitList.length > 0 ? (
                  <select
                    value={baseCommit}
                    onChange={(e) => {
                        setBaseCommit(e.target.value);
                        setTargetCommit('');
                    }}
                    className="field-surface w-full h-[50px] px-4 py-3 rounded-xl border outline-none transition-all"
                  >
                    <option value="">-- 시작 커밋 선택 --</option>
                    {baseCommitList.map((commit) => (
                      <option key={commit.id} value={commit.id}>
                        [{formatDate(commit.created_at)}] {commit.short_id} - {commit.title.slice(0, 15)}...
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={baseCommit}
                    onChange={(e) => setBaseCommit(e.target.value)}
                    placeholder="SHA 입력"
                    className="field-surface w-full h-[50px] px-4 py-3 rounded-xl border outline-none transition-all"
                  />
                )}
              </div>

              {/* Arrow Icon - Aligned to bottom */}
              <div className="pb-3 text-slate-500 shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </div>

              {/* Target Commit */}
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  🎯 Target (종료)
                </label>
                {baseCommit && targetCommitList.length > 0 ? (
                  <select
                    value={targetCommit}
                    onChange={(e) => setTargetCommit(e.target.value)}
                    className="field-surface w-full h-[50px] px-4 py-3 rounded-xl border outline-none transition-all"
                  >
                    <option value="">-- 최신 (HEAD) --</option>
                    {targetCommitList.map((commit) => (
                      <option key={commit.id} value={commit.id}>
                        [{formatDate(commit.created_at)}] {commit.short_id} - {commit.title.slice(0, 20)}...
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={targetCommit}
                    onChange={(e) => setTargetCommit(e.target.value)}
                    placeholder={baseCommit ? "HEAD (Default)" : "Base 먼저"}
                    disabled={!baseCommit}
                    className="field-surface w-full h-[50px] px-4 py-3 rounded-xl border outline-none transition-all disabled:opacity-50"
                  />
                )}
              </div>
            </div>
          )}

          {/* Author Filter */}
          {!isMergePlan && (
          <div className="rounded-2xl border border-primary/10 bg-stone-950/25 p-3 min-w-0">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
              <div className="shrink-0 min-w-[150px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-slate-300">변경 작성자</span>
                  {authorFilter.length > 0 && (
                    <span className="status-pill px-2 py-0.5 text-[10px]">{authorFilter.length}명 선택됨</span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-stone-500">선택한 작성자 기준으로 비교 범위를 좁힙니다.</p>
              </div>

              {authors.length > 0 || authorsInRange.length > 0 ? (
                <>
                  <div className="field-surface flex h-10 w-full shrink-0 items-center gap-2 rounded-xl border px-3 xl:w-[220px]">
                    <Search size={15} className="text-stone-500" />
                    <input
                      type="text"
                      value={authorSearch}
                      onChange={(e) => setAuthorSearch(e.target.value)}
                      placeholder="작성자 검색"
                      className="min-w-0 flex-1 bg-transparent text-sm text-stone-200 placeholder-stone-500 outline-none"
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1">
                      <button
                        type="button"
                        aria-pressed={authorFilter.length === 0}
                        onClick={() => setAuthorFilter([])}
                        className={`shrink-0 rounded-full border px-3 py-2 text-xs font-bold transition-all ${
                          authorFilter.length === 0
                            ? 'border-primary/40 bg-primary/15 text-primary'
                            : 'border-primary/10 bg-stone-950/35 text-stone-400 hover:border-primary/25 hover:text-stone-100'
                        }`}
                      >
                        전체
                      </button>

                      {visibleAuthorChips.map((author) => {
                        const selected = authorFilter.includes(author.name)
                        return (
                          <button
                            key={author.name}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => {
                              setAuthorFilter(prev => (
                                prev.includes(author.name)
                                  ? prev.filter(name => name !== author.name)
                                  : [...prev, author.name]
                              ))
                            }}
                            className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-bold transition-all ${
                              selected
                                ? 'border-[#79b8c5]/45 bg-[#79b8c5]/10 text-[#b8edf5] shadow-[0_0_0_1px_rgba(121,184,197,0.12)]'
                                : 'border-primary/10 bg-stone-950/35 text-stone-400 hover:border-primary/25 hover:text-stone-100'
                            }`}
                            title={author.email ? `${author.name} · ${author.email}` : author.name}
                          >
                            <span className="max-w-[150px] truncate">{author.name}</span>
                            {author.count > 0 && (
                              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                                selected ? 'bg-[#79b8c5]/15 text-[#d8f6fb]' : 'bg-primary/10 text-stone-500'
                              }`}>
                                {author.count}
                              </span>
                            )}
                          </button>
                        )
                      })}

                      {visibleAuthorChips.length === 0 && (
                        <span className="shrink-0 rounded-full border border-primary/10 px-3 py-2 text-xs text-stone-500">
                          일치하는 작성자가 없습니다
                        </span>
                      )}
                    </div>
                  </div>

                  {(authorFilter.length > 0 || authorSearch) && (
                    <button
                      type="button"
                      onClick={() => {
                        setAuthorFilter([])
                        setAuthorSearch('')
                      }}
                      className="action-ghost shrink-0 px-3 py-2 text-xs whitespace-nowrap"
                    >
                      작성자 필터 초기화
                    </button>
                  )}
                </>
              ) : (
                <input
                  type="text"
                  value={authorFilter.join(',')}
                  onChange={(e) => setAuthorFilter(e.target.value ? e.target.value.split(',').map(v => v.trim()).filter(Boolean) : [])}
                  placeholder="작성자 이름 (쉼표로 구분)"
                  className="field-surface h-10 w-full min-w-[260px] rounded-xl border px-4 py-2 outline-none transition-all"
                />
              )}
            </div>
          </div>
          )}
        </div>

        {!isMergePlan && (
        <div className="grid gap-4 mt-6 xl:grid-cols-[minmax(560px,1fr)_minmax(360px,560px)] 2xl:grid-cols-[minmax(720px,1fr)_minmax(420px,680px)] xl:items-end">
          {/* Preview Info */}
          <div className="min-w-0">
            {preview ? (
              <div className="p-4 rounded-2xl bg-stone-950/45 border border-primary/15 shadow-lg shadow-black/20 flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm shrink-0">
                  <span className="text-slate-400 flex shrink-0 items-center gap-2 whitespace-nowrap font-medium">
                    📊 실행 전 확인
                  </span>
                  <div className="h-4 w-px shrink-0 bg-slate-700"></div>
                  <span className="text-white font-bold">{preview.file_count}</span> <span className="text-slate-500 -ml-3 sm:-ml-4">Files</span>
                  <span className="text-slate-700">·</span>
                  <span className="text-white font-bold">{preview.commit_count}</span> <span className="text-slate-500 -ml-3 sm:-ml-4">Commits</span>

                  <div className="flex shrink-0 items-center gap-3 sm:ml-auto bg-slate-950/50 px-3 py-1.5 rounded-lg border border-slate-700/50 shadow-inner">
                      <span className="text-green-400 font-bold flex items-center gap-0.5">
                        <span className="text-[10px]">▲</span> {preview.total_additions}
                      </span>
                      <div className="w-px h-3 bg-slate-800"></div>
                      <span className="text-red-400 font-bold flex items-center gap-0.5">
                         <span className="text-[10px]">▼</span> {preview.total_deletions}
                      </span>
                  </div>
                </div>

                {isPreDeploy && preview.direct_origin_counts && (
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-400">
                    <span className="status-pill px-2 py-0.5">
                      기준 전용 {preview.direct_origin_counts.baseline_only || 0}
                    </span>
                    <span className="status-pill px-2 py-0.5">
                      후보 전용 {preview.direct_origin_counts.candidate_only || 0}
                    </span>
                    <span className="status-pill px-2 py-0.5">
                      양쪽 변경 {preview.direct_origin_counts.changed_between_versions || 0}
                    </span>
                    {preview.run_manifest?.ref_lock?.locked && (
                      <span className="rounded-full border border-[#79b8c5]/25 bg-[#79b8c5]/10 px-2 py-0.5 font-bold text-[#b8edf5]">
                        커밋 기준 고정됨
                      </span>
                    )}
                  </div>
                )}

                {/* Compact File List in Preview */}
                {previewPrioritizedFiles.length > 0 && (
                  <div className="space-y-2">
                    {analysisMode !== 'git' && (
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-500">
                        <span>AI 분석 순서 미리보기</span>
                        <span className="status-pill px-2 py-0.5">{getAnalysisSortOption(analysisSort).shortLabel}</span>
                        <span className="status-pill px-2 py-0.5">{getAnalysisStatusLabel(analysisStatusFilter)}</span>
                      </div>
                    )}
                    <div className="max-h-[120px] overflow-y-auto pr-2 custom-scrollbar space-y-1.5">
                    {previewPrioritizedFiles.slice(0, 8).map((file, idx) => (
                      <div key={`${file.path}-${idx}`} className="flex min-w-0 items-center justify-between gap-3 py-1.5 px-3 bg-slate-900/40 rounded-lg group/file">
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          {analysisMode !== 'git' && (
                            <span className="w-5 text-right text-[10px] font-bold text-stone-600">{idx + 1}</span>
                          )}
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            file.status === 'added' ? 'bg-green-500' :
                            file.status === 'deleted' ? 'bg-red-500' :
                            file.status === 'renamed' ? 'bg-blue-500' : 'bg-yellow-500'
                          }`}></span>
                          <span className="min-w-0 flex-1 text-[11px] font-mono truncate text-slate-400" title={file.path}>{file.path}</span>
                          {isPreDeploy && file.compare_origin_label && (
                            <span className="hidden rounded-full border border-primary/10 px-2 py-0.5 text-[10px] text-stone-500 md:inline-flex">
                              {file.compare_origin_label}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => setSelectedFileForDiff(analysisMode === 'git' ? { ...file, _gitOnly: true } : file)}
                          className="shrink-0 p-1 hover:bg-primary/20 text-slate-600 hover:text-primary rounded transition-all opacity-0 group-hover/file:opacity-100"
                        >
                          <Eye size={12} />
                        </button>
                      </div>
                    ))}
                    {previewPrioritizedFiles.length > 8 && (
                      <div className="px-3 pt-1 text-[11px] text-stone-500">
                        외 {previewPrioritizedFiles.length - 8}개 파일은 변경표에서 확인합니다.
                      </div>
                    )}
                    </div>
                  </div>
                )}
              </div>
            ) : loadingPreview ? (
              <div className="p-4 rounded-2xl bg-stone-950/45 border border-primary/15 text-sm text-stone-400 animate-pulse flex items-center gap-3">
                 <div className="w-4 h-4 border-2 border-slate-600 border-t-primary rounded-full animate-spin"/>
                 선택한 범위의 변경 파일을 확인하는 중입니다...
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-stone-950/45 border border-primary/15 text-sm text-stone-400 flex items-center gap-2">
                 <span className="text-lg">←</span>
                 {isPreDeploy
                   ? (hasSelectedRange ? '선택한 개발/기준 버전으로 배포 전 점검을 만들 수 있습니다.' : '개발 버전과 기준 버전을 선택하면 실행 전 변경 파일을 확인할 수 있습니다.')
                   : (baseCommit ? 'Target을 선택하거나 HEAD 기준으로 변경표를 만들 수 있습니다.' : 'Base 커밋을 선택하면 실행 전 변경 파일을 확인할 수 있습니다.')}
              </div>
            )}
          </div>

          {/* Configuration & Action */}
          <div className="flex flex-wrap items-end gap-3 xl:justify-end xl:w-full">
              {/* Max Files Selector */}
              {analysisMode !== 'git' && (
                <>
                  <div className="flex flex-col items-end gap-1.5">
                    <label className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">파일 범위</label>
                    <select
                      value={analysisStatusFilter}
                      onChange={(e) => setAnalysisStatusFilter(e.target.value)}
                      className="field-surface h-[46px] px-4 rounded-xl border text-sm outline-none cursor-pointer transition-colors text-right min-w-[130px]"
                    >
                      <option value="all">전체 상태</option>
                      <option value="modified">수정만</option>
                      <option value="added">추가만</option>
                      <option value="deleted">삭제만</option>
                      <option value="renamed">이름 변경만</option>
                    </select>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <label className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">분석 순서</label>
                    <select
                      value={analysisSort}
                      onChange={(e) => setAnalysisSort(e.target.value)}
                      className="field-surface h-[46px] px-4 rounded-xl border text-sm outline-none cursor-pointer transition-colors text-right min-w-[165px]"
                      title={getAnalysisSortOption(analysisSort).description}
                    >
                      {analysisSortOptions.map(option => (
                        <option key={option.key} value={option.key}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <label className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">분석 개수</label>
                    <select
                      value={maxFiles}
                      onChange={(e) => setMaxFiles(parseInt(e.target.value))}
                      className="field-surface h-[46px] px-4 rounded-xl border text-sm outline-none cursor-pointer transition-colors text-right min-w-[145px]"
                    >
                      <option value={10}>Top 10 빠르게</option>
                      <option value={20}>Top 20 추천</option>
                      <option value={50}>Top 50</option>
                      <option value={100}>Top 100</option>
                      <option value={0}>전체 파일</option>
                    </select>
                  </div>
                </>
              )}

              {/* Analyze Button */}
              <button
                onClick={() => handleAnalyze()}
                disabled={(analysisMode === 'git' ? (loadingGitReport || loadingPreview) : loading) || !hasSelectedRange || repoStatus.state === 'checking' || repoStatus.state === 'disconnected' || repoStatus.state === 'missing' || repoStatus.state === 'warning' || (analysisMode !== 'git' && previewScopeFileCount === 0)}
                className={`h-[46px] px-8 rounded-full font-bold hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:transform-none flex items-center gap-2 whitespace-nowrap ${
                  analysisMode === 'git'
                    ? 'bg-[#79b8c5] text-stone-950 hover:bg-[#96cfda] hover:shadow-[#79b8c5]/20'
                    : 'bg-primary text-stone-950 hover:bg-[#ffc35c] hover:shadow-primary/20'
                }`}
              >
                {(analysisMode === 'git' ? loadingGitReport : loading) ? (
                  <>
                    <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>{primaryLoadingLabel}</span>
                  </>
                ) : (
                  <>
                    {analysisMode === 'git' ? (
                      <FileText size={18} />
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                      </svg>
                    )}
                    <span>{primaryActionLabel}</span>
                  </>
                )}
              </button>

              {primaryActionDisabledReason && (
                <p className="w-full text-right text-[11px] text-stone-500">
                  {primaryActionDisabledReason}
                </p>
              )}
              {analysisMode !== 'git' && (
                <p className="w-full text-right text-[11px] text-stone-500">
                  AI 실행 범위: {getAnalysisStatusLabel(analysisStatusFilter)} · {getAnalysisSortOption(analysisSort).shortLabel} 기준 {getAnalysisLimitLabel(maxFiles)}
                  {previewAnalysisFileCount !== null && (
                    <span> · 실제 분석 예정 {previewAnalysisFileCount}/{previewScopeFileCount} files</span>
                  )}
                  <span> · {analysisCostHint}</span>
                </p>
              )}
              
              {/* Cancel Button (로딩 중일 때만 표시) */}
              {loading && (
                <button
                  onClick={cancelAnalysis}
                  className="h-[46px] px-4 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-400 font-medium transition-all flex items-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                  취소
                </button>
              )}
          </div>
        </div>
        )}
      </div>
    </>
  )
}

export default DashboardStandardControlPanel
