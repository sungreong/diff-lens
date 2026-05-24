import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, BookOpen, ChevronDown, ChevronUp, Clock, Code, FileText, X } from 'lucide-react'
import AiMarkdown from '../AiMarkdown'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const DiffModal = ({
selectedFileForDiff,
analysisMode,
modalViewMode,
fullCodeContent,
loadingFullCode,
gitReport,
result,
targetCommit,
candidateRef,
settings,
baseCommit,
baselineRef,
showJobNotice,
setSelectedFileForDiff,
setModalViewMode,
setFullCodeContent,
setLoadingFullCode,
diffModalScrollStateRef,
}) => {
  if (!selectedFileForDiff) return null;
  const { path, diff } = selectedFileForDiff;
  const diffLines = diff ? diff.split('\n') : [];
  const isGitOnlyDiff = selectedFileForDiff._gitOnly || analysisMode === 'git';

  // Reset view mode when modal opens is handled by the toggle logic
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, []);

  useEffect(() => {
    if ((modalViewMode === 'full' || modalViewMode === 'clean') && !fullCodeContent && !loadingFullCode) {
      fetchFullCode();
    }
  }, [modalViewMode]);

  const fetchFullCode = async () => {
    setLoadingFullCode(true);
    try {
      const reportTarget = gitReport?.candidate_resolved?.sha || (gitReport?.target_commit && gitReport.target_commit !== 'HEAD' ? gitReport.target_commit : null);
      const targetRef = result?.candidate_resolved?.sha || result?.target_commit || reportTarget || targetCommit || candidateRef || settings.branch || 'HEAD';
      const baseRef = result?.baseline_resolved?.sha || result?.base_commit || gitReport?.baseline_resolved?.sha || baseCommit || baselineRef;
      
      console.log('DEBUG: Fetching full code - Target:', targetRef, 'Base:', baseRef);
      
      // Fetch target file (D)
      const targetParams = new URLSearchParams({
        project_id: settings.projectId,
        file_path: path,
        ref: targetRef,
        git_url: settings.gitUrl,
        git_token: settings.gitToken
      });
      const targetRes = await fetch(`${API_URL}/file-content?${targetParams.toString()}`);
      
      // Fetch base file (A) if we have a base commit
      let baseContent = null;
      if (baseRef) {
        const baseParams = new URLSearchParams({
          project_id: settings.projectId,
          file_path: path,
          ref: baseRef,
          git_url: settings.gitUrl,
          git_token: settings.gitToken
        });
        try {
          const baseRes = await fetch(`${API_URL}/file-content?${baseParams.toString()}`);
          if (baseRes.ok) {
            const baseData = await baseRes.json();
            baseContent = baseData.content;
          }
        } catch (e) {
          console.log('DEBUG: Could not fetch base file (may be new file)');
        }
      }
      
      if (targetRes.ok) {
        const targetData = await targetRes.json();
        // Store both in a combined format
        setFullCodeContent({
          target: targetData.content,
          base: baseContent
        });
      } else {
        console.error('Failed to fetch target file');
      }
    } catch (err) {
      console.error('Error fetching full code:', err);
    } finally {
      setLoadingFullCode(false);
    }
  };

  // Build unified view: merge base and target with diff information
  const buildUnifiedView = () => {
    if (!fullCodeContent) return [];
    
    const targetLines = fullCodeContent.target ? fullCodeContent.target.split('\n') : [];
    const baseLines = fullCodeContent.base ? fullCodeContent.base.split('\n') : [];
    
    // If no base or no diff, just show target with additions highlighted
    if (!fullCodeContent.base || !diff) {
      return targetLines.map((line, i) => ({
        lineNum: i + 1,
        content: line,
        type: 'unchanged'
      }));
    }
    
    // Parse diff hunks to understand changes
    const result = [];
    let targetIdx = 0;
    let baseIdx = 0;
    
    // Simple approach: parse diff and build unified view
    let i = 0;
    while (i < diffLines.length) {
      const line = diffLines[i];
      
      if (line.startsWith('@@')) {
        // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
        const match = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
        if (match) {
          const oldStart = parseInt(match[1]);
          const newStart = parseInt(match[3]);
          
          // Add unchanged lines before this hunk
          while (targetIdx < newStart - 1 && targetIdx < targetLines.length) {
            result.push({
              lineNum: targetIdx + 1,
              content: targetLines[targetIdx],
              type: 'unchanged'
            });
            targetIdx++;
            baseIdx++;
          }
        }
        i++;
        continue;
      }
      
      if (line.startsWith('-') && !line.startsWith('---')) {
        // Deleted line - show from base
        result.push({
          lineNum: null,
          content: line.substring(1),
          type: 'deleted'
        });
        baseIdx++;
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        // Added line - show from target
        result.push({
          lineNum: targetIdx + 1,
          content: line.substring(1),
          type: 'added'
        });
        targetIdx++;
      } else if (!line.startsWith('\\') && !line.startsWith('diff') && !line.startsWith('index')) {
        // Context line
        if (targetIdx < targetLines.length) {
          result.push({
            lineNum: targetIdx + 1,
            content: line.startsWith(' ') ? line.substring(1) : line,
            type: 'unchanged'
          });
          targetIdx++;
          baseIdx++;
        }
      }
      i++;
    }
    
    // Add remaining lines after last hunk
    while (targetIdx < targetLines.length) {
      result.push({
        lineNum: targetIdx + 1,
        content: targetLines[targetIdx],
        type: 'unchanged'
      });
      targetIdx++;
    }
    
    return result;
  };

  const unifiedLines = useMemo(() => buildUnifiedView(), [fullCodeContent, diff]);

  const handleClose = () => {
    setSelectedFileForDiff(null);
    setModalViewMode('diff');
    setFullCodeContent(null);
  };

  // Search functionality
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatches, setSearchMatches] = useState([]);
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);
  const codeContainerRef = useRef(null);
  const aiEvidenceContainerRef = useRef(null);
  const codeScrollKey = `${path}::${modalViewMode}::code`;
  const aiEvidenceScrollKey = `${path}::ai-evidence`;

  const saveScrollPosition = useCallback((event, key) => {
    const element = event.currentTarget;
    diffModalScrollStateRef.current[key] = {
      top: element.scrollTop,
      left: element.scrollLeft,
    };
  }, []);

  const restoreScrollPosition = useCallback((element, key) => {
    const position = diffModalScrollStateRef.current[key];
    if (!element || !position) return;
    element.scrollTop = position.top || 0;
    element.scrollLeft = position.left || 0;
  }, []);

  useLayoutEffect(() => {
    restoreScrollPosition(codeContainerRef.current, codeScrollKey);
    restoreScrollPosition(aiEvidenceContainerRef.current, aiEvidenceScrollKey);
  }, [aiEvidenceScrollKey, codeScrollKey, restoreScrollPosition]);

  const handleSearch = (query) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchMatches([]);
      setCurrentMatchIdx(0);
      return;
    }

    // Check if query is a line number (only works in clean/full modes)
    const lineNum = parseInt(query);
    if (!isNaN(lineNum) && lineNum > 0 && (modalViewMode === 'clean' || modalViewMode === 'full')) {
      // Jump to line number
      const row = codeContainerRef.current?.querySelector(`[data-line="${lineNum}"]`);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.add('ring-2', 'ring-yellow-400');
        setTimeout(() => row.classList.remove('ring-2', 'ring-yellow-400'), 2000);
      } else {
        showJobNotice(`${lineNum}번 라인을 찾을 수 없습니다.`, 'warning');
      }
      return;
    }

    // Keyword search - use appropriate lines for current view mode
    const lowerQuery = query.toLowerCase();
    let lines;
    if (modalViewMode === 'clean') {
      lines = fullCodeContent?.target?.split('\n') || [];
    } else if (modalViewMode === 'full') {
      lines = unifiedLines;
    } else {
      lines = diffLines;
    }
    
    const matches = [];
    
    lines.forEach((line, idx) => {
      const content = typeof line === 'string' ? line : line.content;
      if (content?.toLowerCase().includes(lowerQuery)) {
        matches.push(idx);
      }
    });
    
    setSearchMatches(matches);
    setCurrentMatchIdx(0);
    
    if (matches.length > 0) {
      scrollToMatch(matches[0]);
    }
  };

  const scrollToMatch = (idx) => {
    const row = codeContainerRef.current?.querySelector(`[data-idx="${idx}"]`);
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.add('ring-2', 'ring-yellow-400');
      setTimeout(() => row.classList.remove('ring-2', 'ring-yellow-400'), 1500);
    }
  };

  const navigateMatch = (direction) => {
    if (searchMatches.length === 0) return;
    let newIdx = currentMatchIdx + direction;
    if (newIdx < 0) newIdx = searchMatches.length - 1;
    if (newIdx >= searchMatches.length) newIdx = 0;
    setCurrentMatchIdx(newIdx);
    scrollToMatch(searchMatches[newIdx]);
  };

  // Highlight matching text in content
  const highlightText = (text, query) => {
    if (!query || !text) return text;
    const lineNum = parseInt(query);
    if (!isNaN(lineNum)) return text; // Don't highlight for line number search
    
    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    return parts.map((part, i) => 
      part.toLowerCase() === query.toLowerCase() 
        ? <mark key={i} className="bg-yellow-400 text-black px-0.5 rounded">{part}</mark>
        : part
    );
  };

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[1000] flex items-start justify-center overflow-y-auto overscroll-contain p-2 md:p-6 lg:p-8 animate-fade-in">
      <div className="bg-slate-900 w-full max-w-[95vw] h-[calc(100dvh-1rem)] md:h-[calc(100dvh-3rem)] lg:h-[calc(100dvh-4rem)] max-h-[920px] rounded-2xl flex flex-col min-h-0 overflow-hidden border border-white/10 shadow-2xl">
        {/* Modal Header */}
        <div className="px-4 md:px-6 py-4 bg-slate-800/50 border-b border-slate-700 flex flex-col lg:flex-row lg:items-center justify-between gap-3 flex-none min-w-0">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="shrink-0 p-2 bg-primary/20 rounded-lg">
              <Code className="text-primary" size={18} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <h3 className="shrink-0 text-lg font-bold text-white leading-tight">
                  {isGitOnlyDiff ? 'Git Diff Viewer' : 'Diff Viewer'}
                </h3>
                <div className="flex max-w-full overflow-x-auto bg-slate-950/50 p-1 rounded-lg border border-slate-700 pointer-events-auto custom-scrollbar">
                  <button 
                    onClick={() => { setModalViewMode('diff'); setSearchMatches([]); setCurrentMatchIdx(0); }}
                    className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${modalViewMode === 'diff' ? 'bg-primary text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                  >
                    변경점 (Diff)
                  </button>
                  <button 
                    onClick={() => { setModalViewMode('full'); setSearchMatches([]); setCurrentMatchIdx(0); }}
                    className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${modalViewMode === 'full' ? 'bg-primary text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                  >
                    통합 (Full)
                  </button>
                  <button 
                    onClick={() => { setModalViewMode('clean'); setSearchMatches([]); setCurrentMatchIdx(0); }}
                    className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${modalViewMode === 'clean' ? 'bg-primary text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                  >
                    최종 코드
                  </button>
                </div>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2 mt-0.5">
                <p className="min-w-0 max-w-full break-all text-xs text-slate-400 font-mono md:truncate" title={path}>{path}</p>
                {selectedFileForDiff.additions !== undefined && (
                  <div className="flex shrink-0 items-center gap-1.5 text-xs">
                    <span className="px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 font-mono font-bold">
                      +{selectedFileForDiff.additions}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-mono font-bold">
                      -{selectedFileForDiff.deletions}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          {/* Search Box */}
          <div className="flex min-w-0 flex-wrap items-center gap-2 shrink-0 lg:justify-end">
            <div className="flex min-w-0 items-center bg-slate-700/50 rounded-lg border border-slate-600 focus-within:border-primary/50">
              <input
                type="text"
                placeholder="줄번호/키워드 후 Enter"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (searchMatches.length > 0) navigateMatch(1);
                    else handleSearch(searchQuery);
                  }
                  if (e.key === 'Escape') { setSearchQuery(''); setSearchMatches([]); }
                }}
                className="w-36 min-w-0 px-3 py-1.5 text-xs bg-transparent text-white placeholder:text-slate-500 outline-none sm:w-40"
              />
              {searchMatches.length > 0 && (
                <span className="px-2 text-[10px] text-slate-400 border-l border-slate-600">
                  {currentMatchIdx + 1}/{searchMatches.length}
                </span>
              )}
              <button
                onClick={() => navigateMatch(-1)}
                className="p-1 text-slate-400 hover:text-white disabled:opacity-30"
                disabled={searchMatches.length === 0}
              >
                <ChevronUp size={14} />
              </button>
              <button
                onClick={() => navigateMatch(1)}
                className="p-1 text-slate-400 hover:text-white disabled:opacity-30"
                disabled={searchMatches.length === 0}
              >
                <ChevronDown size={14} />
              </button>
            </div>
            
            <button 
              onClick={handleClose}
              className="p-2 hover:bg-slate-700 rounded-full text-slate-400 hover:text-white transition-all"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Modal Content */}
        <div className="flex-1 flex min-w-0 flex-col md:flex-row min-h-0 overflow-hidden bg-slate-950">
          {/* Left Pane: Code View */}
          <div
            ref={codeContainerRef}
            onScroll={(event) => saveScrollPosition(event, codeScrollKey)}
            className={`min-w-0 flex-1 min-h-0 overflow-auto custom-scrollbar p-1 md:p-4 ${isGitOnlyDiff ? '' : 'border-b md:border-b-0 md:border-r border-slate-700/50'}`}
          >
            {modalViewMode === 'diff' ? (
              /* Diff View Mode */
              !diff ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-4">
                  <FileText size={48} className="opacity-20" />
                  <p className="italic">No diff available for this file.</p>
                </div>
              ) : (
                <div className="font-mono text-[11px] leading-relaxed select-text min-w-max">
                  <table className="w-full border-collapse">
                    <tbody>
                      {diffLines.map((line, i) => {
                        let bgColor = '';
                        let textColor = 'text-slate-400';
                        if (line.startsWith('+')) {
                          bgColor = 'bg-green-500/10';
                          textColor = 'text-green-400';
                        } else if (line.startsWith('-')) {
                          bgColor = 'bg-red-500/10';
                          textColor = 'text-red-400';
                        } else if (line.startsWith('@@')) {
                          bgColor = 'bg-blue-500/5';
                          textColor = 'text-blue-400/60 italic';
                        }
                        const isMatch = searchMatches.includes(i);
                        return (
                          <tr key={i} data-idx={i} data-line={i + 1} className={`${bgColor} ${isMatch ? 'ring-1 ring-yellow-400/50' : ''} hover:bg-white/5 group`}>
                            <td className="w-12 pr-4 text-right text-slate-600 select-none border-r border-slate-800/50 group-hover:text-slate-400 transition-colors">
                              {i + 1}
                            </td>
                            <td className={`pl-4 pr-6 whitespace-pre ${textColor}`}>
                              {searchQuery ? highlightText(line, searchQuery) : line}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            ) : modalViewMode === 'clean' ? (
              /* Clean Code View Mode (Target only, no highlights) */
              loadingFullCode ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-4">
                  <Clock size={40} className="animate-spin opacity-20" />
                  <p className="animate-pulse">최종 코드를 불러오고 있습니다...</p>
                </div>
              ) : !fullCodeContent?.target ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-4">
                  <FileText size={48} className="opacity-20" />
                  <p className="italic">파일 내용을 불러올 수 없습니다.</p>
                  <button onClick={fetchFullCode} className="text-xs text-primary underline">다시 시도</button>
                </div>
              ) : (
                <div className="font-mono text-[11px] leading-relaxed select-text min-w-max">
                  <table className="w-full border-collapse">
                    <tbody>
                      {fullCodeContent.target.split('\n').map((line, i) => {
                        const isMatch = searchMatches.includes(i);
                        return (
                          <tr key={i} data-idx={i} data-line={i + 1} className={`${isMatch ? 'ring-1 ring-yellow-400/50' : ''} hover:bg-white/5 group`}>
                            <td className="w-12 pr-4 text-right text-slate-600 select-none border-r border-slate-800/50 group-hover:text-slate-400 transition-colors">
                              {i + 1}
                            </td>
                            <td className="pl-4 pr-6 whitespace-pre text-slate-300">
                              {searchQuery ? highlightText(line, searchQuery) : line}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              /* Full Code View Mode (Unified with highlights) */
              loadingFullCode ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-4">
                  <Clock size={40} className="animate-spin opacity-20" />
                  <p className="animate-pulse">전체 코드를 불러오고 있습니다...</p>
                </div>
              ) : !fullCodeContent ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-4">
                  <FileText size={48} className="opacity-20" />
                  <p className="italic">파일 내용을 불러올 수 없습니다.</p>
                  <button onClick={fetchFullCode} className="text-xs text-primary underline">다시 시도</button>
                </div>
              ) : (
                <div className="font-mono text-[11px] leading-relaxed select-text min-w-max">
                  <table className="w-full border-collapse">
                    <tbody>
                      {unifiedLines.map((item, i) => {
                        const isDeleted = item.type === 'deleted';
                        const isAdded = item.type === 'added';
                        
                        let bgColor = '';
                        let textColor = 'text-slate-300';
                        let lineNumColor = 'text-slate-600 group-hover:text-slate-400';
                        let decoration = '';
                        
                        if (isDeleted) {
                          bgColor = 'bg-red-500/10';
                          textColor = 'text-red-400';
                          lineNumColor = 'text-red-500/50';
                          decoration = 'line-through opacity-70';
                        } else if (isAdded) {
                          bgColor = 'bg-green-500/10';
                          textColor = 'text-green-400';
                          lineNumColor = 'text-green-500 font-bold';
                        }
                        
                        const isMatch = searchMatches.includes(i);
                        return (
                          <tr key={i} data-idx={i} data-line={item.lineNum} className={`${bgColor} ${isMatch ? 'ring-1 ring-yellow-400/50' : ''} hover:bg-white/5 group`}>
                            <td className={`w-12 pr-4 text-right select-none border-r border-slate-800/50 transition-colors ${lineNumColor}`}>
                              {isDeleted ? '-' : item.lineNum}
                            </td>
                            <td className={`pl-4 pr-6 whitespace-pre ${textColor} ${decoration}`}>
                              {isDeleted && <span className="mr-2 text-red-500">−</span>}
                              {isAdded && <span className="mr-2 text-green-500">+</span>}
                              {searchQuery ? highlightText(item.content, searchQuery) : item.content}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>

          {!isGitOnlyDiff && (
            <div
              ref={aiEvidenceContainerRef}
              onScroll={(event) => saveScrollPosition(event, aiEvidenceScrollKey)}
              className="min-w-0 flex-[1.5] min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar bg-slate-900/30 p-4 md:p-8 lg:p-12"
            >
              <div className="flex min-w-0 items-center gap-2 mb-8 pb-6 border-b border-white/5">
                <div className="shrink-0 p-2 bg-primary/15 rounded-lg">
                   <BarChart3 size={20} className="text-primary"/>
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-black text-white uppercase tracking-widest">AI 증빙 분석</h4>
                  <p className="break-words text-[10px] text-slate-500 mt-0.5">Automated code review & evidence</p>
                </div>
              </div>

              <div className="min-w-0 max-w-none overflow-x-hidden text-slate-100">
                {selectedFileForDiff.ai_summary ? (
                  <AiMarkdown sectioned>
                    {selectedFileForDiff.ai_summary}
                  </AiMarkdown>
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 text-slate-600 text-center gap-3">
                    <Clock size={32} className="opacity-20" />
                    <p className="italic text-xs">AI 분석 결과가 없거나 분석 중입니다.</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-slate-800/30 border-t border-slate-700 flex justify-between items-center flex-none">
           <div className="flex gap-4 text-[10px] uppercase font-bold tracking-widest text-slate-500">
              <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-green-500/50"></div> Added</span>
              <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-red-500/50"></div> Removed</span>
              {modalViewMode === 'full' && (
                <span className="flex items-center gap-1.5 ml-4 text-primary"><BookOpen size={10}/> Full File View</span>
              )}
           </div>
           <button
             onClick={handleClose}
             className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold rounded-lg transition-all"
           >
             Close
           </button>
        </div>
      </div>
    </div>
  );
}

export default memo(DiffModal)
