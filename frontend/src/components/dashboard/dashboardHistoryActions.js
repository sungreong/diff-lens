export function createDashboardHistoryActions(ctx) {
  const { API_URL, AbortController, baseCommit, closeJobEventSource, commits, historyAbortController, historyJobEventSourceRef, notifyJobComplete, setActiveHistoryJob, setHistoryAnalysis, setHistoryDrawerOpen, setHistoryJobProgress, setLoadingHistory, setSelectedHistoryFile, settings, targetCommit } = ctx

  // 심층 분석 Drawer 닫기 (진행 중인 요청 취소)
  const closeHistoryDrawer = () => {
    if (historyAbortController.current) {
      historyAbortController.current.abort();
      historyAbortController.current = null;
      console.log('[DeepAnalysis] API 요청 취소됨');
    }
    closeJobEventSource(historyJobEventSourceRef);
    setHistoryDrawerOpen(false);
    setLoadingHistory(false);
    setActiveHistoryJob(null);
    setHistoryJobProgress(null);
  };
  
  const attachHistoryJob = jobId => {
    if (!jobId) return;
    closeJobEventSource(historyJobEventSourceRef);
    const source = new EventSource(`${API_URL}/api/jobs/${jobId}/events`);
    historyJobEventSourceRef.current = source;
    source.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        setActiveHistoryJob(data);
        const progressInfo = data.progress || {};
        const startedAt = data.started_at || data.created_at;
        setHistoryJobProgress({
          status: data.status,
          phase: progressInfo.phase || data.phase,
          message: progressInfo.message || data.message || '커밋 흐름을 분석하고 있습니다.',
          current: progressInfo.current ?? 0,
          total: progressInfo.total ?? 0,
          percent: progressInfo.percent ?? 0,
          file: progressInfo.file,
          commit: progressInfo.commit,
          commitIndex: progressInfo.commit_index,
          commitCount: progressInfo.commit_count,
          analyzedCount: progressInfo.analyzed_count,
          cacheHit: Boolean(progressInfo.cache_hit || data.cache_hit),
          cacheWaited: Boolean(progressInfo.cache_waited),
          cacheKey: data.cache_key,
          elapsedSeconds: startedAt ? Math.max(0, Math.round(Date.now() / 1000 - startedAt)) : null
        });
        if (['queued', 'running'].includes(data.status)) {
          setHistoryAnalysis({
            final_summary: `### 분석 진행 중\n\n${data.progress?.message || data.message || '백엔드에서 커밋 흐름을 분석하고 있습니다.'}`,
            history: [],
            commits_analyzed: 0
          });
        }
        if (data.status === 'completed') {
          closeJobEventSource(historyJobEventSourceRef);
          setLoadingHistory(false);
          setHistoryJobProgress(prev => prev ? {
            ...prev,
            status: 'completed',
            percent: 100,
            message: '커밋 흐름 분석이 완료되었습니다.'
          } : null);
          setHistoryAnalysis(data.result);
          notifyJobComplete('커밋 흐름 분석 완료', '파일의 커밋 흐름 분석 결과가 준비되었습니다.');
        } else if (['failed', 'cancelled', 'interrupted'].includes(data.status)) {
          closeJobEventSource(historyJobEventSourceRef);
          setLoadingHistory(false);
          setHistoryJobProgress(prev => prev ? {
            ...prev,
            status: data.status,
            message: data.error?.message || data.message || '작업이 중단되었습니다.'
          } : null);
          setHistoryAnalysis({
            final_summary: `### ⚠️ 분석 중단\n\n${data.error?.message || data.message || '작업이 중단되었습니다.'}`,
            history: [],
            commits_analyzed: 0
          });
        }
      } catch (e) {
        console.warn('History job event parse failed:', e);
      }
    };
  };
  
  // Handle Deep History Analysis
  
  // Handle Deep History Analysis
  const handleDeepAnalysis = async file => {
    setSelectedHistoryFile(file);
    setHistoryAnalysis(null);
    setHistoryDrawerOpen(true);
    setLoadingHistory(true);
    setActiveHistoryJob(null);
    setHistoryJobProgress({
      status: 'starting',
      phase: 'history_starting',
      message: '커밋 흐름 분석 작업을 준비하고 있습니다.',
      current: 0,
      total: 0,
      percent: 0,
      file: file.path
    });
    let jobStarted = false;
  
    // 새 AbortController 생성
    historyAbortController.current = new AbortController();
    try {
      const payload = {
        git_url: settings.gitUrl,
        git_token: settings.gitToken,
        project_id: settings.projectId,
        branch: settings.branch,
        file_path: file.path,
        base_commit: baseCommit,
        // Use currently selected base
        target_commit: targetCommit || (commits.length > 0 ? commits[0].id : '') // Use selected target or newest
      };
      console.log("Analyzing history with payload:", payload);
      const res = await fetch(`${API_URL}/api/jobs/history`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: historyAbortController.current.signal // AbortController signal 연결
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'completed' && data.result) {
          setHistoryAnalysis(data.result);
          setHistoryJobProgress({
            status: 'completed',
            phase: 'cache_hit',
            message: data.cache_hit ? '캐시된 커밋 흐름 분석 결과를 불러왔습니다.' : '커밋 흐름 분석 결과가 준비되었습니다.',
            current: data.result.commits_analyzed || 1,
            total: data.result.commits_analyzed || 1,
            percent: 100,
            file: file.path,
            cacheHit: Boolean(data.cache_hit || data.result.cache_hit),
            cacheKey: data.cache_key || data.result.cache_key
          });
          setLoadingHistory(false);
          notifyJobComplete('커밋 흐름 분석 완료', data.cache_hit ? '캐시된 커밋 흐름 결과를 불러왔습니다.' : '커밋 흐름 분석 결과가 준비되었습니다.');
        } else if (data.job_id) {
          jobStarted = true;
          setActiveHistoryJob(data);
          setHistoryJobProgress({
            status: data.status,
            phase: data.phase || 'queued',
            message: data.message || '백엔드에서 커밋 흐름 분석을 시작했습니다.',
            current: data.progress?.current || 0,
            total: data.progress?.total || 0,
            percent: data.progress?.percent || 0,
            file: file.path,
            cacheKey: data.cache_key
          });
          setHistoryAnalysis({
            final_summary: `### 분석 대기열 등록\n\n${data.message || '백엔드에서 커밋 흐름 분석을 시작했습니다.'}`,
            history: [],
            commits_analyzed: 0
          });
          attachHistoryJob(data.job_id);
        } else {
          throw new Error('Job id가 없는 응답입니다.');
        }
      } else {
        const errText = await res.text();
        console.error("Deep analysis failed:", errText);
        setHistoryAnalysis({
          final_summary: `### ⚠️ 분석 실패\n\n서버에서 오류가 발생했습니다: ${errText}`,
          history: [],
          commits_analyzed: 0
        });
        setHistoryJobProgress(prev => prev ? {
          ...prev,
          status: 'failed',
          message: '커밋 흐름 분석 요청이 실패했습니다.'
        } : null);
      }
    } catch (e) {
      // 사용자가 취소한 경우는 에러 표시 안 함
      if (e.name === 'AbortError') {
        console.log('[DeepAnalysis] 사용자가 요청을 취소했습니다.');
        return;
      }
      console.error("Deep analysis network error:", e);
      setHistoryAnalysis({
        final_summary: `### ⚠️ 네트워크 오류\n\n서버에 연결할 수 없습니다: ${e.message}`,
        history: [],
        commits_analyzed: 0
      });
      setHistoryJobProgress(prev => prev ? {
        ...prev,
        status: 'failed',
        message: e.message
      } : null);
    } finally {
      if (!jobStarted) {
        setLoadingHistory(false);
      }
      historyAbortController.current = null;
    }
  };
  
  // Progress state for streaming

  return { closeHistoryDrawer, attachHistoryJob, handleDeepAnalysis }
}
