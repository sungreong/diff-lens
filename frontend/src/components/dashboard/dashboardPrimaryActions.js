export function createDashboardPrimaryActions(ctx) {
  const { API_URL, URLSearchParams, addLog, analysisMode, analysisSort, analysisStatusFilter, authorFilter, baseCommit, baselineRef, buildMergeCheckContext, candidateRef, candidateSourceRef, clearMergeCheckProgressTimers, compareStrategy, contextDepth, downloadXlsx, finishMergeCheckProgress, formatDate, formatRelatedCommits, getCommitAuthor, getCommitDateValue, getCommitKey, getCommitShort, getCommitTime, getCommitTitle, getFileStatusLabel, getLastTouchInfo, getNetDiffFiles, getXlsxHeatStyle, gitReport, impactMaxFiles, includeImpact, isPreDeploy, knownBranchNames, maxFiles, mergeCheck, onSettingsRefresh, preview, previewMatchesSelection, previewRunSeqRef, refLockMatchesSelection, repoIdentityRef, resolvedRefs, result, setAuthors, setBaselineRef, setBaselineSourceRef, setBookmarkError, setCandidateRef, setCandidateSourceRef, setCommitLoadError, setCommits, setCompareRefs, setDeepAnalysisResults, setError, setExpandedGitRows, setGitHeatmapMetric, setGitReport, setGitReportError, setGitReportView, setLoadingBookmarks, setLoadingCommits, setLoadingGitReport, setLoadingMergeCheck, setLoadingPreview, setLoadingRefs, setMergeCheck, setMergeCheckProgress, setPreview, setProgress, setRefBookmarks, setRepoBranchDraft, setRepoBranchError, setRepoStatus, setResolvedRefs, setResult, setSavingRepoBranch, settings, startMergeCheckProgress, targetCommit, waitForJobResult } = ctx

  const buildCompareV2Payload = (modeOverride = analysisMode, options = {}) => {
    const {
      includeRefLock = true,
      previewOverride = null,
      failOnRefDrift = true
    } = options;
    const lockSource = previewOverride || preview;
    const baselineLock = resolvedRefs?.baseline || lockSource?.baseline_resolved || null;
    const candidateLock = resolvedRefs?.candidate || lockSource?.candidate_resolved || null;
    const lockedBaseline = includeRefLock && refLockMatchesSelection(baselineLock, baselineRef) ? baselineLock : null;
    const lockedCandidate = includeRefLock && refLockMatchesSelection(candidateLock, candidateRef) ? candidateLock : null;
    return {
      repo_id: settings.repoId,
      llm_config_id: settings.llmConfigId,
      tracing_config_id: settings.tracingConfigId,
      git_url: settings.gitUrl,
      git_token: settings.gitToken,
      project_id: settings.projectId,
      branch: settings.branch,
      comparison_type: isPreDeploy ? 'pre_deploy' : 'commit',
      baseline_ref: isPreDeploy ? baselineRef : baseCommit,
      candidate_ref: isPreDeploy ? candidateRef : targetCommit || settings.branch || null,
      baseline_sha: isPreDeploy ? lockedBaseline?.sha || null : null,
      candidate_sha: isPreDeploy ? lockedCandidate?.sha || null : null,
      fail_on_ref_drift: failOnRefDrift,
      base_commit: isPreDeploy ? baselineRef : baseCommit,
      target_commit: isPreDeploy ? candidateRef : targetCommit || null,
      compare_strategy: isPreDeploy ? compareStrategy : 'deployment_state',
      include_impact: isPreDeploy ? includeImpact : false,
      impact_max_files: Math.min(Math.max(Number(impactMaxFiles) || 15, 0), 30),
      context_depth: Math.min(Math.max(Number(contextDepth) || 1, 1), 3),
      author_filter: authorFilter.length > 0 ? authorFilter.join(',') : null,
      analysis_mode: modeOverride,
      max_files: maxFiles,
      file_status_filter: analysisStatusFilter,
      analysis_sort: analysisSort,
      merge_check_context: isPreDeploy ? buildMergeCheckContext(mergeCheck) : null,
      openai_api_key: settings.openaiApiKey || null,
      openai_base_url: settings.openaiBaseUrl || null,
      openai_model: settings.openaiModel || null,
      langfuse_public_key: settings.langfusePublicKey || null,
      langfuse_secret_key: settings.langfuseSecretKey || null,
      langfuse_host: settings.langfuseHost || null
    };
  };
  
  const fetchPreview = async () => {
    const runSeq = previewRunSeqRef.current + 1;
    previewRunSeqRef.current = runSeq;
    const requestRepoIdentity = repoIdentityRef.current;
    const requestSelection = {
      isPreDeploy,
      baseCommit: baseCommit || '',
      targetCommit: targetCommit || '',
      baselineRef: baselineRef || '',
      candidateRef: candidateRef || '',
      compareStrategy,
      includeImpact: Boolean(includeImpact),
      impactMaxFiles: String(impactMaxFiles),
      contextDepth: String(contextDepth),
      authorFilter: authorFilter.join('\u0001')
    };
    const isCurrentPreviewRequest = () => runSeq === previewRunSeqRef.current && requestRepoIdentity === repoIdentityRef.current && requestSelection.isPreDeploy === isPreDeploy && requestSelection.baseCommit === (baseCommit || '') && requestSelection.targetCommit === (targetCommit || '') && requestSelection.baselineRef === (baselineRef || '') && requestSelection.candidateRef === (candidateRef || '') && requestSelection.compareStrategy === compareStrategy && requestSelection.includeImpact === Boolean(includeImpact) && requestSelection.impactMaxFiles === String(impactMaxFiles) && requestSelection.contextDepth === String(contextDepth) && requestSelection.authorFilter === authorFilter.join('\u0001');
    setLoadingPreview(true);
    try {
      const res = await fetch(`${API_URL}${isPreDeploy ? '/api/jobs/compare-preview-v2' : '/api/jobs/preview'}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(isPreDeploy ? buildCompareV2Payload(analysisMode, {
          includeRefLock: false
        }) : {
          git_url: settings.gitUrl,
          git_token: settings.gitToken,
          project_id: settings.projectId,
          branch: settings.branch,
          base_commit: baseCommit,
          target_commit: targetCommit || null,
          author_filter: authorFilter.length > 0 ? authorFilter.join(',') : null
        })
      });
      if (res.ok) {
        const startedJob = await res.json();
        const data = await waitForJobResult(startedJob, {
          onProgress: job => {
            if (job?.progress?.message) addLog(`[preview] ${job.progress.message}`);
          }
        });
        if (!isCurrentPreviewRequest()) return null;
        setPreview(data);
        if (isPreDeploy) {
          setResolvedRefs({
            baseline: data.baseline_resolved,
            candidate: data.candidate_resolved
          });
        }
        return data;
      }
      const text = await res.text();
      throw new Error(text || `Preview failed: ${res.status}`);
    } catch (e) {
      console.error('Preview fetch failed:', e);
      return null;
    } finally {
      if (isCurrentPreviewRequest()) {
        setLoadingPreview(false);
      }
    }
  };
  
  // Fetch commits and authors when settings are configured
  
  const saveActiveRepoBranch = async nextBranch => {
    const cleanBranch = (nextBranch || '').trim();
    if (!cleanBranch) {
      setRepoBranchDraft(settings.branch || '');
      setRepoBranchError('브랜치 이름이 비어 있습니다.');
      return;
    }
    if (cleanBranch === settings.branch) {
      setRepoBranchDraft(cleanBranch);
      setRepoBranchError('');
      return;
    }
    if (!settings.repoId) {
      setRepoBranchDraft(settings.branch || '');
      setRepoBranchError('저장된 repository ID가 없어 설정에서 브랜치를 변경해야 합니다.');
      return;
    }
    const previousBranch = settings.branch || '';
    setRepoBranchDraft(cleanBranch);
    setSavingRepoBranch(true);
    setRepoBranchError('');
    try {
      const res = await fetch(`${API_URL}/repos/${settings.repoId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          id: settings.repoId,
          profile_id: settings.id || null,
          name: settings.repoName || settings.name || 'Active Repository',
          git_url: settings.gitUrl,
          git_token: settings.gitToken,
          project_id: settings.projectId,
          branch: cleanBranch,
          commit_limit: settings.commitLimit || 100,
          is_active: true
        })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `branch 저장 실패 (${res.status})`);
      }
      if (!candidateRef || candidateRef === previousBranch) {
        setCandidateRef(cleanBranch);
      }
      if (!candidateSourceRef || candidateSourceRef === previousBranch) {
        setCandidateSourceRef(cleanBranch);
      }
      setResolvedRefs(null);
      setPreview(null);
      setGitReport(null);
      setMergeCheck(null);
      clearMergeCheckProgressTimers();
      setMergeCheckProgress(null);
      await onSettingsRefresh?.({
        silent: true
      });
    } catch (err) {
      setRepoBranchDraft(previousBranch);
      setRepoBranchError(err.message || '브랜치를 저장하지 못했습니다.');
    } finally {
      setSavingRepoBranch(false);
    }
  };
  
  const testActiveRepository = async () => {
    const requestRepoIdentity = repoIdentityRef.current;
    setRepoStatus({
      state: 'checking',
      message: '현재 선택된 repository 연결을 확인하는 중입니다.'
    });
    try {
      const res = await fetch(`${API_URL}/test-connection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          git_url: settings.gitUrl,
          git_token: settings.gitToken,
          project_id: settings.projectId,
          branch: settings.branch
        })
      });
      const data = await res.json();
      if (requestRepoIdentity !== repoIdentityRef.current) return;
      if (data.success) {
        setRepoStatus({
          state: 'connected',
          message: data.message || '연결 성공',
          projectName: data.project_name,
          defaultBranch: data.default_branch,
          checkedAt: new Date().toLocaleTimeString()
        });
      } else {
        setRepoStatus({
          state: 'disconnected',
          message: data.message || '연결 실패: Git URL, token, project ID를 확인하세요.',
          checkedAt: new Date().toLocaleTimeString()
        });
      }
    } catch (err) {
      if (requestRepoIdentity !== repoIdentityRef.current) return;
      setRepoStatus({
        state: 'disconnected',
        message: `API 서버 또는 네트워크 연결 실패: ${err.message}`,
        checkedAt: new Date().toLocaleTimeString()
      });
    }
  };
  
  const fetchCommitsAndAuthors = async () => {
    const requestRepoIdentity = repoIdentityRef.current;
    setLoadingCommits(true);
    setLoadingRefs(true);
    setCommitLoadError(null);
    try {
      const credentials = {
        git_url: settings.gitUrl,
        git_token: settings.gitToken,
        project_id: settings.projectId,
        branch: settings.branch,
        limit: settings.commitLimit
      };
      const requestInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(credentials)
      };
      const [commitsRes, authorsRes, refsRes] = await Promise.all([fetch(`${API_URL}/commits`, requestInit), fetch(`${API_URL}/authors`, requestInit), fetch(`${API_URL}/api/v2/compare/refs`, requestInit)]);
      if (commitsRes.ok) {
        const commitsData = await commitsRes.json();
        if (requestRepoIdentity !== repoIdentityRef.current) return;
        setCommits(commitsData);
      } else {
        const text = await commitsRes.text();
        if (requestRepoIdentity !== repoIdentityRef.current) return;
        setCommits([]);
        throw new Error(`커밋 목록을 불러오지 못했습니다: ${text || commitsRes.status}`);
      }
      if (authorsRes.ok) {
        const authorsData = await authorsRes.json();
        if (requestRepoIdentity !== repoIdentityRef.current) return;
        setAuthors(authorsData);
      } else {
        if (requestRepoIdentity !== repoIdentityRef.current) return;
        setAuthors([]);
      }
      if (refsRes.ok) {
        const refsData = await refsRes.json();
        if (requestRepoIdentity !== repoIdentityRef.current) return;
        setCompareRefs({
          default_branch: refsData.default_branch || null,
          branches: refsData.branches || [],
          tags: refsData.tags || [],
          commits: refsData.commits || []
        });
      } else {
        if (requestRepoIdentity !== repoIdentityRef.current) return;
        setCompareRefs(prev => ({
          ...prev,
          branches: [],
          tags: [],
          commits: []
        }));
      }
    } catch (err) {
      if (requestRepoIdentity !== repoIdentityRef.current) return;
      console.error('Failed to fetch commits/authors:', err);
      setCommitLoadError(err.message);
      setRepoStatus(prev => prev.state === 'connected' ? {
        ...prev,
        state: 'warning',
        message: err.message,
        checkedAt: new Date().toLocaleTimeString()
      } : prev);
    } finally {
      if (requestRepoIdentity === repoIdentityRef.current) {
        setLoadingCommits(false);
        setLoadingRefs(false);
      }
    }
  };
  
  const fetchRefBookmarks = async () => {
    if (!settings.repoId && !settings.projectId) return;
    const requestRepoIdentity = repoIdentityRef.current;
    setLoadingBookmarks(true);
    setBookmarkError(null);
    try {
      const params = new URLSearchParams();
      if (settings.repoId) params.set('repo_id', settings.repoId);else params.set('project_id', settings.projectId);
      const res = await fetch(`${API_URL}/api/v2/ref-bookmarks?${params.toString()}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (requestRepoIdentity !== repoIdentityRef.current) return;
      setRefBookmarks(data || []);
    } catch (err) {
      if (requestRepoIdentity !== repoIdentityRef.current) return;
      setBookmarkError(err.message || '즐겨찾기 ref를 불러오지 못했습니다.');
    } finally {
      if (requestRepoIdentity === repoIdentityRef.current) {
        setLoadingBookmarks(false);
      }
    }
  };
  
  const saveRefBookmark = async side => {
    const resolved = side === 'baseline' ? resolvedRefs?.baseline || preview?.baseline_resolved : resolvedRefs?.candidate || preview?.candidate_resolved;
    const refValue = side === 'baseline' ? baselineRef : candidateRef;
    if (!refValue) return;
    setBookmarkError(null);
    try {
      const labelPrefix = side === 'baseline' ? '기준' : '개발';
      const res = await fetch(`${API_URL}/api/v2/ref-bookmarks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          repo_id: settings.repoId || null,
          profile_id: settings.id || null,
          git_url: settings.gitUrl,
          project_id: settings.projectId,
          label: `${labelPrefix}: ${refValue}${resolved?.short_sha ? ` @ ${resolved.short_sha}` : ''}`,
          ref: refValue,
          ref_type: resolved?.type || 'ref',
          sha: resolved?.sha || null,
          short_sha: resolved?.short_sha || null,
          title: resolved?.title || null,
          note: side === 'baseline' ? '배포 기준 후보' : '개발 후보',
          color: side === 'baseline' ? 'cyan' : 'amber',
          is_favorite: true
        })
      });
      if (!res.ok) throw new Error(await res.text());
      await fetchRefBookmarks();
    } catch (err) {
      setBookmarkError(err.message || '즐겨찾기 저장 실패');
    }
  };
  
  const applyRefBookmark = (bookmark, side) => {
    clearMergeCheckProgressTimers();
    const bookmarkedRef = bookmark.ref || '';
    if (side === 'baseline') {
      setBaselineRef(bookmarkedRef);
      if (knownBranchNames.has(bookmarkedRef)) setBaselineSourceRef(bookmarkedRef);
    } else {
      setCandidateRef(bookmarkedRef);
      if (knownBranchNames.has(bookmarkedRef)) setCandidateSourceRef(bookmarkedRef);
    }
    setResolvedRefs(null);
    setMergeCheck(null);
    setMergeCheckProgress(null);
  };
  
  const deleteRefBookmark = async bookmarkId => {
    try {
      const res = await fetch(`${API_URL}/api/v2/ref-bookmarks/${bookmarkId}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error(await res.text());
      setRefBookmarks(prev => prev.filter(item => item.id !== bookmarkId));
    } catch (err) {
      setBookmarkError(err.message || '즐겨찾기 삭제 실패');
    }
  };
  
  const runMergeCheck = async () => {
    if (!baselineRef || !candidateRef) {
      setError('개발 버전과 기준 버전을 먼저 선택하세요.');
      return;
    }
    const runSeq = startMergeCheckProgress();
    setLoadingMergeCheck(true);
    setMergeCheck(null);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/jobs/merge-check-v2`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(buildCompareV2Payload(analysisMode, {
          includeRefLock: false,
          failOnRefDrift: false
        }))
      });
      const startedJob = await res.json();
      if (!res.ok) throw new Error(startedJob.detail || startedJob.message || '충돌 체크 실패');
      const data = await waitForJobResult(startedJob, {
        onProgress: job => {
          if (job?.progress?.message) {
            setMergeCheckProgress(prev => prev ? {
              ...prev,
              message: job.progress.message,
              elapsedSeconds: prev.startedAt ? (Date.now() - prev.startedAt) / 1000 : prev.elapsedSeconds
            } : prev);
          }
        }
      });
      setMergeCheck(data);
      finishMergeCheckProgress(runSeq, data.status === 'unknown' ? 'failed' : 'completed', data.status === 'conflicts' ? '충돌 파일을 찾았습니다. 아래 목록에서 먼저 확인하세요.' : data.status === 'clean' ? '충돌이 발견되지 않았습니다. 이 결과는 테스트 통과를 의미하지는 않습니다.' : '충돌 여부를 확정하지 못했습니다.');
    } catch (err) {
      finishMergeCheckProgress(runSeq, 'failed', err.message || '충돌 체크 중 오류가 발생했습니다.');
      setMergeCheck({
        status: 'unknown',
        mergeable: null,
        has_conflicts: null,
        conflict_files: [],
        message: err.message || '충돌 체크 중 오류가 발생했습니다.'
      });
    } finally {
      setLoadingMergeCheck(false);
    }
  };
  
  const previewMergeConflictUi = () => {
    const candidateFiles = [...(gitReport?.files || []), ...(preview?.files || [])].map(file => file?.path).filter(Boolean);
    const uniqueFiles = [...new Set(candidateFiles)];
    const conflictFiles = uniqueFiles.length > 0 ? uniqueFiles.slice(0, 4) : ['src/example/service.py', 'src/example/config.yml', 'tests/example/test_service.py'];
    clearMergeCheckProgressTimers();
    setLoadingMergeCheck(false);
    setMergeCheckProgress({
      runSeq: 'demo',
      status: 'completed',
      activeStep: 'collecting_conflicts',
      startedAt: Date.now(),
      elapsedSeconds: 2.4,
      message: '충돌 예시 화면입니다.'
    });
    setMergeCheck({
      status: 'conflicts',
      mergeable: false,
      has_conflicts: true,
      conflict_files: conflictFiles,
      conflict_count: conflictFiles.length,
      method: 'ui_conflict_preview',
      message: '예시입니다. 실제 Git 작업은 수행하지 않았고, 충돌이 발생했을 때의 화면 흐름만 보여줍니다.',
      target_ref: baselineRef,
      source_ref: candidateRef,
      target_sha: resolvedRefs?.baseline?.sha || preview?.baseline_resolved?.sha || null,
      source_sha: resolvedRefs?.candidate?.sha || preview?.candidate_resolved?.sha || null,
      target_resolved: resolvedRefs?.baseline || preview?.baseline_resolved || null,
      source_resolved: resolvedRefs?.candidate || preview?.candidate_resolved || null,
      diagnostics: {
        ui_preview: true
      },
      is_demo: true
    });
  };
  
  const clearMergeConflictPreview = () => {
    if (!mergeCheck?.is_demo) return;
    clearMergeCheckProgressTimers();
    setMergeCheck(null);
    setMergeCheckProgress(null);
  };
  
  const openGitReport = async () => {
    if (isPreDeploy ? !baselineRef || !candidateRef : !baseCommit) {
      setGitReportError(isPreDeploy ? '개발 버전과 기준 버전을 먼저 선택하세요.' : 'Base commit을 먼저 선택하세요.');
      return;
    }
    const requestRepoIdentity = repoIdentityRef.current;
    setLoadingGitReport(true);
    setGitReportError(null);
    setError(null);
    setResult(null);
    setProgress(null);
    setExpandedGitRows(new Set());
    setGitReportView('table');
    setGitHeatmapMetric('split');
    setDeepAnalysisResults([]);
    try {
      const data = previewMatchesSelection(preview, baselineRef, candidateRef, compareStrategy) ? preview : await fetchPreview();
      if (!data) {
        throw new Error('Git 변경 정보를 가져오지 못했습니다.');
      }
      if (requestRepoIdentity !== repoIdentityRef.current) return;
      const files = getNetDiffFiles(data.files || []);
      const report = {
        ...data,
        files,
        raw_file_count: data.files?.length || 0,
        file_count: files.length,
        total_additions: files.reduce((sum, file) => sum + (file.additions || 0), 0),
        total_deletions: files.reduce((sum, file) => sum + (file.deletions || 0), 0),
        base_commit: isPreDeploy ? data.baseline_resolved?.sha || baselineRef : baseCommit,
        target_commit: isPreDeploy ? data.candidate_resolved?.sha || candidateRef : targetCommit || 'HEAD',
        baseline_ref: isPreDeploy ? baselineRef : baseCommit,
        candidate_ref: isPreDeploy ? candidateRef : targetCommit || 'HEAD',
        baseline_resolved: data.baseline_resolved || null,
        candidate_resolved: data.candidate_resolved || null,
        comparison_type: isPreDeploy ? 'pre_deploy' : 'commit',
        compare_strategy: isPreDeploy ? compareStrategy : null
      };
      setGitReport(report);
      return report;
    } catch (e) {
      if (requestRepoIdentity !== repoIdentityRef.current) return;
      setGitReportError(e.message);
      return null;
    } finally {
      if (requestRepoIdentity === repoIdentityRef.current) {
        setLoadingGitReport(false);
      }
    }
  };
  
  const downloadGitReportXlsx = () => {
    if (!gitReport?.files) return;
    const columns = [{
      key: 'no',
      header: 'No',
      width: 8
    }, {
      key: 'status',
      header: '상태',
      width: 14
    }, {
      key: 'path',
      header: '파일 경로',
      width: 58
    }, {
      key: 'oldPath',
      header: '이전 경로',
      width: 42
    }, {
      key: 'additions',
      header: '추가 라인',
      width: 12
    }, {
      key: 'deletions',
      header: '삭제 라인',
      width: 12
    }, {
      key: 'net',
      header: '순증감',
      width: 12
    }, {
      key: 'lastTouchedBy',
      header: '마지막 수정자',
      width: 20
    }, {
      key: 'lastTouchedEmail',
      header: '마지막 수정자 이메일',
      width: 28
    }, {
      key: 'lastTouchedCommit',
      header: '마지막 수정 커밋',
      width: 38
    }, {
      key: 'lastTouchedAt',
      header: '마지막 수정 시각',
      width: 24
    }, {
      key: 'commitCount',
      header: '관련 커밋 수',
      width: 14
    }, {
      key: 'commitIds',
      header: '관련 커밋 SHA',
      width: 38
    }, {
      key: 'commitMessages',
      header: '관련 커밋 정보',
      width: 72
    }];
    const rows = gitReport.files.map((file, index) => {
      const lastTouch = getLastTouchInfo(file);
      return {
        no: index + 1,
        status: getFileStatusLabel(file.status),
        path: file.path,
        oldPath: file.old_path || '',
        additions: file.additions || 0,
        deletions: file.deletions || 0,
        net: (file.additions || 0) - (file.deletions || 0),
        lastTouchedBy: lastTouch.author,
        lastTouchedEmail: lastTouch.email,
        lastTouchedCommit: lastTouch.commit,
        lastTouchedAt: lastTouch.date,
        commitCount: file.commit_ids?.length || file.related_commits?.length || 0,
        commitIds: (file.commit_ids || []).join('\n'),
        commitMessages: formatRelatedCommits(file.related_commits)
      };
    });
    downloadXlsx({
      filename: `git-net-diff-${baseCommit.slice(0, 8)}-${(targetCommit || 'HEAD').slice(0, 8)}.xlsx`,
      sheetName: 'Git Net Diff',
      columns,
      rows
    });
  };
  
  const downloadGitHeatmapXlsx = () => {
    if (!gitReport?.files?.length) return;
    const files = gitReport.files;
    const hasPerCommitStats = files.some(file => file.commit_file_stats?.length);
    const commitMap = new Map();
    const fileStatMaps = new Map();
    let maxAdditionCell = 1;
    let maxDeletionCell = 1;
    files.forEach(file => {
      const statMap = new Map();
      const stats = file.commit_file_stats || [];
      if (stats.length) {
        stats.forEach(stat => {
          const key = getCommitKey(stat);
          if (!key) return;
          if (!commitMap.has(key)) {
            commitMap.set(key, {
              key,
              shortSha: getCommitShort(stat),
              date: getCommitDateValue(stat),
              author: getCommitAuthor(stat),
              title: getCommitTitle(stat)
            });
          }
          const current = statMap.get(key) || {
            additions: 0,
            deletions: 0
          };
          current.additions += stat.additions || 0;
          current.deletions += stat.deletions || 0;
          statMap.set(key, current);
          maxAdditionCell = Math.max(maxAdditionCell, current.additions);
          maxDeletionCell = Math.max(maxDeletionCell, current.deletions);
        });
      } else if (!hasPerCommitStats && (file.related_commits?.length || 0) === 1) {
        const commit = file.related_commits[0];
        const key = getCommitKey(commit);
        if (key) {
          if (!commitMap.has(key)) {
            commitMap.set(key, {
              key,
              shortSha: getCommitShort(commit),
              date: getCommitDateValue(commit),
              author: getCommitAuthor(commit),
              title: getCommitTitle(commit)
            });
          }
          const additions = file.additions || 0;
          const deletions = file.deletions || 0;
          statMap.set(key, {
            additions,
            deletions
          });
          maxAdditionCell = Math.max(maxAdditionCell, additions);
          maxDeletionCell = Math.max(maxDeletionCell, deletions);
        }
      }
      fileStatMaps.set(file.path, statMap);
    });
    const orderedCommits = Array.from(commitMap.values()).sort((a, b) => getCommitTime(a) - getCommitTime(b) || a.shortSha.localeCompare(b.shortSha));
    if (!orderedCommits.length) {
      setGitReportError('커밋별 히트맵을 만들 통계가 없습니다. 변경표를 다시 생성한 뒤 시도하세요.');
      return;
    }
    const summaryColumns = [{
      key: 'no',
      header: 'No',
      width: 8
    }, {
      key: 'status',
      header: '상태',
      width: 14
    }, {
      key: 'path',
      header: '파일 경로',
      width: 58
    }, {
      key: 'additions',
      header: '최종 추가 라인',
      width: 14,
      style: 11
    }, {
      key: 'deletions',
      header: '최종 삭제 라인',
      width: 14,
      style: 11
    }, {
      key: 'net',
      header: '최종 순증감',
      width: 12
    }, {
      key: 'activityAdditions',
      header: '커밋 활동 +',
      width: 14
    }, {
      key: 'activityDeletions',
      header: '커밋 활동 -',
      width: 14
    }, {
      key: 'activityTotal',
      header: '활동 총량',
      width: 12,
      style: 11
    }, {
      key: 'commitCount',
      header: '관련 커밋 수',
      width: 14
    }, {
      key: 'lastTouchedBy',
      header: '마지막 수정자',
      width: 20
    }, {
      key: 'lastTouchedCommit',
      header: '마지막 수정 커밋',
      width: 18
    }];
    const summaryRows = files.map((file, index) => {
      const lastTouch = getLastTouchInfo(file);
      const activityAdditions = (file.commit_file_stats || []).reduce((sum, stat) => sum + (stat.additions || 0), 0);
      const activityDeletions = (file.commit_file_stats || []).reduce((sum, stat) => sum + (stat.deletions || 0), 0);
      return {
        no: index + 1,
        status: getFileStatusLabel(file.status),
        path: file.path,
        additions: file.additions || 0,
        deletions: file.deletions || 0,
        net: (file.additions || 0) - (file.deletions || 0),
        activityAdditions: activityAdditions || file.additions || 0,
        activityDeletions: activityDeletions || file.deletions || 0,
        activityTotal: activityAdditions + activityDeletions || (file.additions || 0) + (file.deletions || 0),
        commitCount: file.commit_ids?.length || file.related_commits?.length || 0,
        lastTouchedBy: lastTouch.author,
        lastTouchedCommit: lastTouch.shortCommit || lastTouch.commit
      };
    });
    const commitColumns = orderedCommits.map((commit, index) => ({
      key: `c${index}`,
      header: `${formatDate(commit.date)}\n${commit.shortSha}`,
      width: 13
    }));
    const buildHeatmapRows = metric => {
      const maxValue = metric === 'additions' ? maxAdditionCell : maxDeletionCell;
      return files.map(file => {
        const row = {
          status: getFileStatusLabel(file.status),
          path: file.path,
          total: metric === 'additions' ? file.additions || 0 : file.deletions || 0,
          __styles: {
            total: 11
          }
        };
        const statMap = fileStatMaps.get(file.path) || new Map();
        orderedCommits.forEach((commit, index) => {
          const key = `c${index}`;
          const value = statMap.get(commit.key)?.[metric] || 0;
          row[key] = value || '';
          row.__styles[key] = getXlsxHeatStyle(value, maxValue, metric);
        });
        return row;
      }).sort((a, b) => (b.total || 0) - (a.total || 0));
    };
    const heatmapFixedColumns = totalHeader => [{
      key: 'status',
      header: '상태',
      width: 14
    }, {
      key: 'path',
      header: '파일 경로',
      width: 58
    }, {
      key: 'total',
      header: totalHeader,
      width: 13,
      style: 11
    }, ...commitColumns];
    const legendColumns = [{
      key: 'no',
      header: 'No',
      width: 8
    }, {
      key: 'date',
      header: '커밋 시각',
      width: 22
    }, {
      key: 'shortSha',
      header: '커밋',
      width: 14
    }, {
      key: 'author',
      header: '작성자',
      width: 22
    }, {
      key: 'title',
      header: '메시지',
      width: 72
    }];
    const legendRows = orderedCommits.map((commit, index) => ({
      no: index + 1,
      date: commit.date || '',
      shortSha: commit.shortSha,
      author: commit.author,
      title: commit.title
    }));
    const noteColumns = [{
      key: 'item',
      header: '항목',
      width: 26,
      style: 2
    }, {
      key: 'description',
      header: '설명',
      width: 92
    }];
    const noteRows = [{
      item: '구조',
      description: '행은 파일, 열은 Base -> Target 사이의 커밋 시간순입니다.'
    }, {
      item: '추가 히트맵',
      description: '셀 값은 해당 커밋에서 해당 파일에 추가된 라인 수입니다. 값이 클수록 진한 녹색 계열로 표시됩니다.'
    }, {
      item: '삭제 히트맵',
      description: '셀 값은 해당 커밋에서 해당 파일에서 삭제된 라인 수입니다. 값이 클수록 진한 주황/빨간 계열로 표시됩니다.'
    }, {
      item: '최종 diff와 차이',
      description: '요약의 최종 추가/삭제는 Base->Target 스냅샷 차이이고, 커밋 활동 +/-, 히트맵 셀은 중간 커밋별 활동량입니다. 중간에 추가 후 삭제된 라인도 활동량에는 포함될 수 있습니다.'
    }, {
      item: '주의',
      description: '라인 수는 변경 규모를 보는 참고 지표입니다. 포맷팅, rename, lock/generated 파일은 실제 위험도보다 크게 보일 수 있습니다.'
    }, {
      item: '작성자 해석',
      description: '마지막 수정자와 커밋별 작성자는 리뷰 분배 참고용이며 책임 소재나 기여 품질 판단 지표가 아닙니다.'
    }];
    downloadXlsx({
      filename: `git-heatmap-${baseCommit.slice(0, 8)}-${(targetCommit || 'HEAD').slice(0, 8)}.xlsx`,
      sheets: [{
        sheetName: '읽는 법',
        columns: noteColumns,
        rows: noteRows,
        freezeColumns: 1
      }, {
        sheetName: '요약',
        columns: summaryColumns,
        rows: summaryRows,
        freezeColumns: 2
      }, {
        sheetName: '추가 히트맵',
        columns: heatmapFixedColumns('총 추가'),
        rows: buildHeatmapRows('additions'),
        freezeColumns: 3
      }, {
        sheetName: '삭제 히트맵',
        columns: heatmapFixedColumns('총 삭제'),
        rows: buildHeatmapRows('deletions'),
        freezeColumns: 3
      }, {
        sheetName: '커밋 범례',
        columns: legendColumns,
        rows: legendRows,
        freezeColumns: 0
      }]
    });
  };
  
  // Download as Excel (CSV format - opens in Excel)
  
  // Download as Excel (CSV format - opens in Excel)
  const downloadAsExcel = () => {
    if (!result) return;
    const headers = ['파일 경로', '상태', '추가 라인', '삭제 라인', 'AI 요약', '관련 커밋'];
    const rows = result.files.map(f => [f.path, f.status, f.additions, f.deletions, (f.ai_summary || '').replace(/"/g, '""'), (f.commit_ids || []).join(', ')]);
    const csvContent = [headers.join(','), ...rows.map(row => row.map(cell => `"${cell}"`).join(','))].join('\n');
  
    // Add BOM for Korean support in Excel
    const bom = '\uFEFF';
    const blob = new Blob([bom + csvContent], {
      type: 'text/csv;charset=utf-8'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `semantic-diff-${baseCommit.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  
  // Download as Markdown
  
  // Download as Markdown
  const downloadAsMarkdown = () => {
    if (!result) return;
    const date = new Date().toLocaleDateString('ko-KR');
    let md = `# Git 변경 사항 분석 리포트\n\n`;
    md += `- **분석 일시**: ${date}\n`;
    md += `- **Base Commit**: ${baseCommit}\n`;
    md += `- **Author Filter**: ${authorFilter || '없음'}\n\n`;
    md += `## 📊 통계\n\n`;
    md += `| 항목 | 값 |\n|------|----|\n`;
    md += `| 커밋 수 | ${result.commit_count} |\n`;
    md += `| 변경 파일 수 | ${result.files.length} |\n`;
    md += `| 추가된 라인 | +${result.total_additions} |\n`;
    md += `| 삭제된 라인 | -${result.total_deletions} |\n\n`;
    md += `## 📁 변경 파일 목록\n\n`;
    md += `| 상태 | 파일 경로 | +/- | AI 요약 |\n|------|----------|-----|--------|\n`;
    result.files.forEach(f => {
      const status = {
        added: '🆕',
        deleted: '🗑️',
        modified: '✏️',
        renamed: '📝'
      }[f.status] || '📄';
      md += `| ${status} | \`${f.path}\` | +${f.additions}/-${f.deletions} | ${f.ai_summary || '-'} |\n`;
    });
    md += `\n---\n\n${result.summary}`;
    const blob = new Blob([md], {
      type: 'text/markdown;charset=utf-8'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `semantic-diff-${baseCommit.slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  
  // ========== 리스크 검토 기능 ==========

  return { buildCompareV2Payload, fetchPreview, saveActiveRepoBranch, testActiveRepository, fetchCommitsAndAuthors, fetchRefBookmarks, saveRefBookmark, applyRefBookmark, deleteRefBookmark, runMergeCheck, previewMergeConflictUi, clearMergeConflictPreview, openGitReport, downloadGitReportXlsx, downloadGitHeatmapXlsx, downloadAsExcel, downloadAsMarkdown }
}
