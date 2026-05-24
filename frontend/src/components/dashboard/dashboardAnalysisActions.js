export function createDashboardAnalysisActions(ctx) {
  const { API_URL, AbortController, TextDecoder, activeAnalysisJob, activeAnalysisModeRef, addLog, analysisAbortController, analysisJobEventSourceRef, analysisMode, analysisSort, analysisStatusFilter, authorFilter, baseCommit, baselineRef, buildCompareV2Payload, buildJobProgress, candidateRef, closeJobEventSource, compareStrategy, gitReport, isPreDeploy, maxFiles, mergeCheck, notifyJobComplete, openGitReport, persistAnalysisJob, preview, previewMatchesSelection, repoStatus, resolvedRefs, setActiveAnalysisJob, setAnalysisMode, setDebugLogs, setDeepAnalysisResults, setError, setGitReport, setGitReportError, setLoading, setProgress, setResolvedRefs, setResult, settings, showJobNotice, targetCommit } = ctx

  const attachAnalysisJob = jobId => {
    if (!jobId) return;
    closeJobEventSource(analysisJobEventSourceRef);
    const source = new EventSource(`${API_URL}/api/jobs/${jobId}/events`);
    analysisJobEventSourceRef.current = source;
    source.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        setActiveAnalysisJob(data);
        setProgress(buildJobProgress(data));
        if (data.status === 'completed') {
          closeJobEventSource(analysisJobEventSourceRef);
          persistAnalysisJob(null);
          setLoading(false);
          if (data.result) {
            processData(data.result);
          }
          setProgress(null);
          notifyJobComplete('Diff Lens 분석 완료', '백그라운드 AI 분석 결과가 준비되었습니다.');
        } else if (['failed', 'cancelled', 'interrupted'].includes(data.status)) {
          closeJobEventSource(analysisJobEventSourceRef);
          persistAnalysisJob(null);
          setLoading(false);
          const message = data.error?.message || data.message || '백그라운드 작업이 중단되었습니다.';
          setError(message);
          setProgress(prev => prev ? {
            ...prev,
            phase: data.status === 'cancelled' ? 'cancelled' : 'job_progress',
            message
          } : null);
          showJobNotice(message, data.status === 'cancelled' ? 'warning' : 'error');
        }
      } catch (e) {
        console.warn('Job event parse failed:', e, event.data);
      }
    };
    source.onerror = () => {
      setProgress(prev => prev ? {
        ...prev,
        message: '작업은 백엔드에서 계속 진행 중입니다. 연결을 다시 시도하고 있습니다.'
      } : prev);
    };
  };
  
  // 분석 취소 함수
  
  // 분석 취소 함수
  const cancelAnalysis = () => {
    if (activeAnalysisJob?.job_id) {
      fetch(`${API_URL}/api/jobs/${activeAnalysisJob.job_id}/cancel`, {
        method: 'POST'
      }).catch(() => {});
      closeJobEventSource(analysisJobEventSourceRef);
      persistAnalysisJob(null);
      setActiveAnalysisJob(null);
    }
    if (analysisAbortController.current) {
      analysisAbortController.current.abort();
      analysisAbortController.current = null;
      console.log('[Analysis] API 요청 취소됨');
    }
    setLoading(false);
    setProgress(prev => prev ? {
      ...prev,
      phase: 'cancelled',
      message: `취소됨: ${prev.current && prev.total ? `${prev.current}/${prev.total} files` : '다시 실행하면 완료된 파일 캐시를 재사용합니다.'}`
    } : {
      phase: 'cancelled',
      message: '분석을 취소했습니다. 다시 실행하면 완료된 파일 캐시를 재사용합니다.'
    });
    addLog('사용자가 분석을 취소했습니다.');
  };
  
  const handleAnalyze = async (modeOverride = analysisMode) => {
    const allowedModes = new Set(['git', 'quick', 'full', 'history']);
    const requestedMode = typeof modeOverride === 'string' ? modeOverride : analysisMode;
    const activeMode = allowedModes.has(requestedMode) ? requestedMode : analysisMode;
    activeAnalysisModeRef.current = activeMode;
    if (activeMode !== analysisMode) {
      setAnalysisMode(activeMode);
    }
    if (activeMode === 'git') {
      await openGitReport();
      return;
    }
    if (repoStatus.state === 'checking') {
      setError('Repository 연결 상태를 확인하는 중입니다. 잠시 후 다시 시도해 주세요.');
      return;
    }
    if (repoStatus.state === 'disconnected' || repoStatus.state === 'missing' || repoStatus.state === 'warning') {
      setError(repoStatus.message || '현재 선택된 repository에 접근할 수 없습니다. Settings에서 연결 정보를 확인해 주세요.');
      return;
    }
    if (isPreDeploy ? !baselineRef || !candidateRef : !baseCommit) {
      setError(isPreDeploy ? '개발 버전과 기준 버전을 입력하세요.' : 'Please enter a Base Commit ID');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    if (!isPreDeploy) {
      setGitReport(null);
    }
    setGitReportError(null);
    setDeepAnalysisResults([]);
    setDebugLogs(['Analysis started...']); // Reset logs
    setProgress({
      phase: 'starting',
      message: isPreDeploy ? 'AI가 직접 변경 파일과 영향 후보 근거를 읽는 중입니다.' : '분석 시작...'
    });
    if (isPreDeploy || activeMode !== 'history') {
      try {
        const payload = isPreDeploy ? buildCompareV2Payload(activeMode) : {
          repo_id: settings.repoId,
          llm_config_id: settings.llmConfigId,
          tracing_config_id: settings.tracingConfigId,
          git_url: settings.gitUrl,
          git_token: settings.gitToken,
          project_id: settings.projectId,
          branch: targetCommit ? null : settings.branch || null,
          base_commit: baseCommit,
          target_commit: targetCommit || null,
          author_filter: authorFilter.length > 0 ? authorFilter.join(',') : null,
          analysis_mode: activeMode,
          max_files: maxFiles,
          file_status_filter: analysisStatusFilter,
          analysis_sort: analysisSort,
          openai_api_key: settings.openaiApiKey || null,
          openai_base_url: settings.openaiBaseUrl || null,
          openai_model: settings.openaiModel || null,
          langfuse_public_key: settings.langfusePublicKey || null,
          langfuse_secret_key: settings.langfuseSecretKey || null,
          langfuse_host: settings.langfuseHost || null
        };
        addLog(`Starting background ${isPreDeploy ? 'compare-v2' : 'commit'} job...`);
        const response = await fetch(`${API_URL}${isPreDeploy ? '/api/jobs/compare-v2' : '/api/jobs/analyze'}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || 'Analysis job failed to start');
        }
        const job = await response.json();
        if (job.status === 'completed' && job.result) {
          setProgress({
            phase: 'cache_hit',
            message: job.cache_hit ? '동일 조건 분석 결과를 캐시에서 재사용합니다.' : '백그라운드 분석 결과가 준비되어 있습니다.',
            cache_key: job.cache_key
          });
          processData(job.result);
          setLoading(false);
          notifyJobComplete('Diff Lens 분석 완료', job.cache_hit ? '캐시된 AI 분석 결과를 바로 불러왔습니다.' : 'AI 분석 결과가 준비되었습니다.');
          return;
        }
        if (!job.job_id) {
          throw new Error('Job id가 없는 응답입니다.');
        }
        setActiveAnalysisJob(job);
        persistAnalysisJob(job.job_id);
        setProgress({
          phase: 'job_progress',
          job_id: job.job_id,
          job_status: job.status,
          message: job.message || '백그라운드 분석 작업을 시작했습니다.',
          current: 0,
          total: 0,
          cache_key: job.cache_key
        });
        attachAnalysisJob(job.job_id);
        return;
      } catch (err) {
        addLog(`Analysis Job Error: ${err.message}`);
        setError(err.message);
        setLoading(false);
        return;
      }
    }
  
    // 새 AbortController 생성
    analysisAbortController.current = new AbortController();
    let abortedByUser = false;
    try {
      const endpoint = isPreDeploy ? '/api/v2/compare/analyze-stream' : '/analyze-stream';
      addLog(`Fetching stream from ${endpoint}...`);
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(isPreDeploy ? buildCompareV2Payload(activeMode) : {
          // Config IDs (Preferred)
          repo_id: settings.repoId,
          llm_config_id: settings.llmConfigId,
          tracing_config_id: settings.tracingConfigId,
          git_url: settings.gitUrl,
          git_token: settings.gitToken,
          project_id: settings.projectId,
          branch: targetCommit ? null : settings.branch || null,
          base_commit: baseCommit,
          target_commit: targetCommit || null,
          author_filter: authorFilter.length > 0 ? authorFilter.join(',') : null,
          analysis_mode: activeMode,
          max_files: maxFiles,
          file_status_filter: analysisStatusFilter,
          analysis_sort: analysisSort,
          openai_api_key: settings.openaiApiKey || null,
          openai_base_url: settings.openaiBaseUrl || null,
          openai_model: settings.openaiModel || null,
          langfuse_public_key: settings.langfusePublicKey || null,
          langfuse_secret_key: settings.langfuseSecretKey || null,
          langfuse_host: settings.langfuseHost || null
        }),
        signal: analysisAbortController.current.signal // AbortController signal 연결
      });
      if (!response.ok) {
        throw new Error('Analysis failed');
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let previewFiles = []; // Accumulate files for preview
  
      while (true) {
        const {
          done,
          value
        } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, {
          stream: true
        });
        addLog(`Received chunk (${chunk.length} bytes)`);
        buffer += chunk;
  
        // Robust splitting: handle \n, \r\n
        const parts = buffer.split(/(?:\r\n|\r|\n)+/);
        buffer = parts.pop() || '';
        for (const part of parts) {
          if (!part.trim() || !part.startsWith('data: ')) continue;
          const jsonStr = part.replace(/^data: /, '');
          if (jsonStr === '[DONE]') break;
          try {
            const data = JSON.parse(jsonStr);
            addLog(`Parsed keys: ${Object.keys(data).join(',')}`);
            addLog(`Phase value: ${data.phase}`);
            processData(data);
          } catch (e) {
            const errMsg = `Stream parse error: ${e.message}`;
            console.warn(errMsg, jsonStr);
            addLog(errMsg);
  
            // Fallback: Attempt to rescue concatenated JSONs (e.g., "}data: {")
            // This happens if the split by newline didn't catch a boundary
            const rescuedParts = jsonStr.split(/data: /);
            if (rescuedParts.length > 1) {
              addLog(`Attempting rescue of ${rescuedParts.length} parts`);
              console.log("Attempting to rescue concatenated JSONs...", rescuedParts.length);
              rescuedParts.forEach(rescuedStr => {
                if (!rescuedStr.trim()) return;
                try {
                  const param = JSON.parse(rescuedStr);
                  addLog(`Rescued JSON: ${param.phase}`);
                  processData(param);
                } catch (innerE) {
                  addLog(`Rescue failed: ${innerE.message}`);
                  console.error("Rescue failed for:", rescuedStr);
                }
              });
            }
          }
        }
      }
    } catch (err) {
      // 사용자가 취소한 경우는 에러 표시 안 함
      if (err.name === 'AbortError') {
        abortedByUser = true;
        console.log('[Analysis] 사용자가 요청을 취소했습니다.');
        addLog('사용자가 분석을 취소했습니다.');
        return;
      }
      addLog(`Analysis Error: ${err.message}`);
      setError(err.message);
    } finally {
      addLog('Analysis stopped.');
      setLoading(false);
      if (!abortedByUser) {
        setProgress(null);
      }
      analysisAbortController.current = null;
    }
  };
  
  const startPreDeployAiAnalysis = (mode = 'quick') => {
    const hasCurrentPreview = previewMatchesSelection(preview, baselineRef, candidateRef, compareStrategy);
    if (!gitReport && !hasCurrentPreview) {
      setError('먼저 변경표를 생성해 AI가 읽을 직접 변경 파일을 확정해 주세요.');
      return;
    }
    handleAnalyze(mode);
  };
  
  const explainMergeCheckWithAi = async () => {
    if (!mergeCheck || !['conflicts', 'unknown'].includes(mergeCheck.status)) return;
    if (mergeCheck.is_demo) {
      setError('충돌 예시 화면에서는 AI를 호출하지 않습니다. 실제 충돌 결과가 나오면 같은 위치에서 AI에게 설명을 요청할 수 있습니다.');
      return;
    }
    setError(null);
    let report = gitReport?.comparison_type === 'pre_deploy' ? gitReport : null;
    if (!report) {
      report = await openGitReport();
    }
    if (!report) {
      setError('AI에게 설명을 요청하려면 먼저 변경표를 준비해야 합니다.');
      return;
    }
    await handleAnalyze('full');
  };
  
  const upsertImpactCandidate = (candidates = [], candidate) => {
    const key = candidate.file_path || candidate.path;
    const index = candidates.findIndex(item => (item.file_path || item.path) === key);
    if (index >= 0) {
      const next = [...candidates];
      next[index] = {
        ...next[index],
        ...candidate
      };
      return next;
    }
    return [...candidates, candidate];
  };
  
  const processCompareV2Data = data => {
    const payload = data.payload || {};
    const event = data.event || payload.event || data.phase;
    const progressPayload = {
      ...data,
      ...payload,
      phase: data.phase,
      event,
      message: payload.message || data.message
    };
    if (event === 'refs_resolved') {
      setResolvedRefs({
        baseline: payload.baseline,
        candidate: payload.candidate
      });
      setProgress(progressPayload);
      addLog(`Resolved refs: ${payload.baseline?.short_sha} -> ${payload.candidate?.short_sha}`);
      return;
    }
    if (event === 'compare_fetched') {
      setProgress({
        ...progressPayload,
        total: payload.file_count,
        commits: payload.commits
      });
      setResult(prev => prev ? {
        ...prev,
        direct_origin_counts: payload.direct_origin_counts || prev.direct_origin_counts,
        run_manifest: payload.run_manifest || prev.run_manifest
      } : prev);
      return;
    }
    if (event === 'impact_discovery_done') {
      setResult(prev => prev ? {
        ...prev,
        impact_diagnostics: payload.diagnostics,
        skipped_reasons: payload.diagnostics?.skipped_reasons || prev.skipped_reasons || []
      } : prev);
      setProgress(progressPayload);
      return;
    }
    if (event === 'direct_file_done') {
      const file = payload.file;
      if (!file?.path) return;
      setResult(prev => {
        const base = prev || {
          schema_version: '2.0',
          mode: activeAnalysisModeRef.current || analysisMode,
          comparison_type: 'pre_deploy',
          compare_strategy: compareStrategy,
          baseline_ref: baselineRef,
          candidate_ref: candidateRef,
          baseline_resolved: resolvedRefs?.baseline || null,
          candidate_resolved: resolvedRefs?.candidate || null,
          files: [],
          impact_candidates: [],
          summary: '',
          commit_count: payload.total || 0,
          total_additions: 0,
          total_deletions: 0
        };
        const nextFile = {
          ...file,
          _analyzed: true
        };
        const existingIdx = base.files.findIndex(f => f.path === nextFile.path);
        const files = existingIdx >= 0 ? base.files.map((f, idx) => idx === existingIdx ? {
          ...f,
          ...nextFile
        } : f) : [...base.files, nextFile];
        return {
          ...base,
          files,
          direct_files: files,
          total_additions: files.reduce((sum, f) => sum + (f.additions || 0), 0),
          total_deletions: files.reduce((sum, f) => sum + (f.deletions || 0), 0)
        };
      });
      setProgress(progressPayload);
      return;
    }
    if (event === 'impact_candidate_found') {
      const candidate = payload.candidate;
      if (!candidate) return;
      setResult(prev => ({
        ...(prev || {
          schema_version: '2.0',
          mode: activeAnalysisModeRef.current || analysisMode,
          comparison_type: 'pre_deploy',
          compare_strategy: compareStrategy,
          baseline_ref: baselineRef,
          candidate_ref: candidateRef,
          files: [],
          summary: ''
        }),
        impact_candidates: upsertImpactCandidate(prev?.impact_candidates || [], candidate)
      }));
      setProgress(progressPayload);
      return;
    }
    if (event === 'impact_file_done') {
      const candidate = payload.candidate;
      if (!candidate) return;
      setResult(prev => ({
        ...(prev || {
          schema_version: '2.0',
          mode: activeAnalysisModeRef.current || analysisMode,
          comparison_type: 'pre_deploy',
          compare_strategy: compareStrategy,
          baseline_ref: baselineRef,
          candidate_ref: candidateRef,
          files: [],
          summary: ''
        }),
        impact_candidates: upsertImpactCandidate(prev?.impact_candidates || [], candidate)
      }));
      setProgress(progressPayload);
      return;
    }
    if (event === 'summary_done') {
      setResult(prev => prev ? {
        ...prev,
        summary: payload.summary || prev.summary
      } : prev);
      setProgress(progressPayload);
      return;
    }
    if (event === 'complete' || data.phase === 'complete') {
      const finalPayload = Object.keys(payload).length > 0 ? payload : data;
      setResolvedRefs({
        baseline: finalPayload.baseline_resolved,
        candidate: finalPayload.candidate_resolved
      });
      setResult(prev => {
        if (prev?.files?.length) {
          const mergedFiles = (finalPayload.files || []).map(serverFile => {
            const progressiveFile = prev.files.find(f => f.path === serverFile.path);
            return progressiveFile?._analyzed ? {
              ...serverFile,
              ai_summary: progressiveFile.ai_summary,
              cache_hit: progressiveFile.cache_hit
            } : serverFile;
          });
          const progressiveCandidates = prev.impact_candidates || [];
          const mergedCandidates = (finalPayload.impact_candidates || []).reduce((items, candidate) => upsertImpactCandidate(items, candidate), progressiveCandidates);
          return {
            ...finalPayload,
            files: mergedFiles,
            direct_files: mergedFiles,
            impact_candidates: mergedCandidates
          };
        }
        return finalPayload;
      });
      addLog(`Compare v2 complete. Files: ${finalPayload.files?.length || 0}, Impact: ${finalPayload.impact_candidates?.length || 0}`);
      return;
    }
    if (event === 'error' || data.phase === 'error') {
      setError(payload.message || data.message || 'v2 analysis failed');
      addLog(`Compare v2 error: ${payload.message || data.message}`);
      return;
    }
    setProgress(progressPayload);
  };
  
  const processData = data => {
    if (data.schema_version === '2.0') {
      processCompareV2Data(data);
      return;
    }
    if (data.phase === 'fetch_done') {
      // Phase 1 Complete: Show files table immediately with loading placeholders
      addLog(`Fetch done. Total files: ${data.total}, Commits: ${data.commits}`);
      // Note: We'll initialize result structure when first file_done arrives
      // or we can initialize a skeleton here if we have file list
      setProgress(data);
    } else if (data.phase === 'file_done') {
      // Progressive update: A file's AI analysis is complete
      addLog(`File analyzed: ${data.file} (${data.current}/${data.total})`);
      setResult(prev => {
        const newFile = {
          path: data.file,
          ai_summary: data.summary,
          status: data.status || 'modified',
          additions: data.additions || 0,
          deletions: data.deletions || 0,
          diff: data.diff || '',
          commit_ids: data.commit_ids || [],
          before_summary: data.before_summary || null,
          after_summary: data.after_summary || null,
          change_evidence: data.change_evidence || [],
          risk_verdict: data.risk_verdict || '불확실',
          risk_reason: data.risk_reason || null,
          confidence: data.confidence || 'low',
          uncertainty_reason: data.uncertainty_reason || null,
          recommended_checks: data.recommended_checks || [],
          evidence_level: data.evidence_level || 'unknown',
          omitted_hunks: data.omitted_hunks || 0,
          analysis_warnings: data.analysis_warnings || [],
          cache_hit: Boolean(data.cache_hit),
          _analyzed: true
        };
        if (!prev) {
          // First file_done: Initialize result structure
          return {
            mode: activeAnalysisModeRef.current || analysisMode,
            files: [newFile],
            commit_count: 0,
            total_additions: data.additions || 0,
            total_deletions: data.deletions || 0,
            summary: ''
          };
        }
  
        // Check if file already exists (update it)
        const existingIdx = prev.files.findIndex(f => f.path === data.file);
        if (existingIdx >= 0) {
          const updatedFiles = [...prev.files];
          updatedFiles[existingIdx] = {
            ...updatedFiles[existingIdx],
            ...newFile
          };
          return {
            ...prev,
            files: updatedFiles,
            total_additions: prev.total_additions + (data.additions || 0),
            total_deletions: prev.total_deletions + (data.deletions || 0)
          };
        } else {
          // Add new file to list
          return {
            ...prev,
            files: [...prev.files, newFile],
            total_additions: prev.total_additions + (data.additions || 0),
            total_deletions: prev.total_deletions + (data.deletions || 0)
          };
        }
      });
      setProgress(data);
    } else if (data.phase === 'history_file_result') {
      // Accumulate batch history results
      setDeepAnalysisResults(prev => [...prev, data]);
      addLog(`Received history result for: ${data.file_path}`);
    } else if (data.phase === 'cache_hit' || data.phase === 'cache_wait' || data.phase === 'cache_wait_progress' || data.phase === 'cache_wait_timeout') {
      setProgress(data);
      addLog(`${data.phase}: ${data.cache_key || ''}`);
    } else if (data.phase === 'complete') {
      // Final result: Merge with any progressively loaded data
      setResult(prev => {
        if (prev && prev.files && prev.files.length > 0) {
          // Merge: keep AI summaries from progressive updates
          const mergedFiles = data.files.map(serverFile => {
            const progressiveFile = prev.files.find(f => f.path === serverFile.path);
            if (progressiveFile && progressiveFile._analyzed) {
              return {
                ...serverFile,
                ai_summary: progressiveFile.ai_summary,
                cache_hit: progressiveFile.cache_hit
              };
            }
            return serverFile;
          });
          return {
            ...data,
            files: mergedFiles
          };
        }
        return data;
      });
      addLog(`Analysis Complete. Mode: ${data.mode}, Files: ${data.files?.length}`);
    } else if (data.phase === 'error') {
      setError(data.message);
      addLog(`Error Phase: ${data.message}`);
    } else {
      // Assume anything else is progress
      setProgress(data);
    }
  };

  return { attachAnalysisJob, cancelAnalysis, handleAnalyze, startPreDeployAiAnalysis, explainMergeCheckWithAi, upsertImpactCandidate, processCompareV2Data, processData }
}
