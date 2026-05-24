import { useMemo } from 'react'

export function useGitReportMetrics(ctx) {
  const { formatDate, getCommitAuthor, getCommitDateValue, getCommitKey, getCommitShort, getCommitTime, getCommitTitle, getDirectoryPath, getFileName, getFileStatusLabel, getHeatmapMetricValue, getLastTouchInfo, gitHeatmapMetric, gitReport, gitTableQuery, gitTableSort, gitTableStatus } = ctx

  const filteredGitReportFiles = useMemo(() => {
    if (!gitReport?.files) return [];
    const query = gitTableQuery.trim().toLowerCase();
    let files = gitReport.files;
    if (query) {
      files = files.filter(file => file.path?.toLowerCase().includes(query) || getFileName(file.path).toLowerCase().includes(query) || getDirectoryPath(file.path).toLowerCase().includes(query) || getLastTouchInfo(file).author?.toLowerCase().includes(query));
    }
    if (gitTableStatus !== 'all') {
      files = files.filter(file => file.status === gitTableStatus);
    }
    return [...files].sort((a, b) => {
      if (gitTableSort === 'path') return (a.path || '').localeCompare(b.path || '');
      if (gitTableSort === 'status') return getFileStatusLabel(a.status).localeCompare(getFileStatusLabel(b.status));
      return (b.additions || 0) + (b.deletions || 0) - ((a.additions || 0) + (a.deletions || 0));
    });
  }, [gitReport?.files, gitTableQuery, gitTableStatus, gitTableSort]);
  
  const gitReportDensity = useMemo(() => {
    const files = filteredGitReportFiles;
    const totalChange = files.reduce((sum, file) => sum + (file.additions || 0) + (file.deletions || 0), 0);
    const totalAdditions = files.reduce((sum, file) => sum + (file.additions || 0), 0);
    const totalDeletions = files.reduce((sum, file) => sum + (file.deletions || 0), 0);
    const hasPerCommitStats = files.some(file => file.commit_file_stats?.length);
    const maxFileChange = Math.max(1, ...files.map(file => (file.additions || 0) + (file.deletions || 0)));
    const topFiles = files.map(file => {
      const change = (file.additions || 0) + (file.deletions || 0);
      let changeType = '수정 중심';
      if (file.status === 'added') changeType = '신규 추가';else if (file.status === 'deleted') changeType = '삭제 중심';else if (file.status === 'renamed') changeType = change > 0 ? '이름 변경+수정' : '이름 변경';else if ((file.additions || 0) > (file.deletions || 0) * 2) changeType = '추가 중심';else if ((file.deletions || 0) > (file.additions || 0) * 2) changeType = '삭제 중심';
      return {
        ...file,
        change,
        changeType,
        lastTouch: getLastTouchInfo(file),
        directory: getDirectoryPath(file.path)
      };
    }).sort((a, b) => b.change - a.change);
    const authorMap = new Map();
    files.forEach(file => {
      const stats = file.commit_file_stats || [];
      if (stats.length) {
        stats.forEach(stat => {
          const key = getCommitAuthor(stat);
          const current = authorMap.get(key) || {
            name: key,
            additions: 0,
            deletions: 0,
            filePaths: new Set(),
            commits: new Set()
          };
          current.additions += stat.additions || 0;
          current.deletions += stat.deletions || 0;
          current.filePaths.add(file.path);
          if (getCommitKey(stat)) current.commits.add(getCommitKey(stat));
          authorMap.set(key, current);
        });
        return;
      }
      const lastTouch = getLastTouchInfo(file);
      const key = lastTouch.author || '확인 불가';
      const current = authorMap.get(key) || {
        name: key,
        additions: 0,
        deletions: 0,
        filePaths: new Set(),
        commits: new Set()
      };
      current.additions += file.additions || 0;
      current.deletions += file.deletions || 0;
      current.filePaths.add(file.path);
      (file.commit_ids || []).forEach(id => current.commits.add(id));
      authorMap.set(key, current);
    });
    const authorsByTouch = Array.from(authorMap.values()).map(author => ({
      ...author,
      files: author.filePaths.size,
      change: author.additions + author.deletions,
      commitCount: author.commits.size
    })).sort((a, b) => b.change - a.change);
    const authorTotalChange = authorsByTouch.reduce((sum, author) => sum + author.change, 0);
    const directoryMap = new Map();
    files.forEach(file => {
      const directory = getDirectoryPath(file.path);
      const current = directoryMap.get(directory) || {
        directory,
        additions: 0,
        deletions: 0,
        files: 0
      };
      current.additions += file.additions || 0;
      current.deletions += file.deletions || 0;
      current.files += 1;
      directoryMap.set(directory, current);
    });
    const directories = Array.from(directoryMap.values()).map(directory => ({
      ...directory,
      change: directory.additions + directory.deletions
    })).sort((a, b) => b.change - a.change);
    const timelineMap = new Map();
    files.forEach(file => {
      ;
      (file.related_commits || []).forEach(commit => {
        const dateSource = commit.committed_date || commit.created_at || commit.authored_date;
        const parsedDate = dateSource ? new Date(dateSource) : null;
        const key = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString().slice(0, 10) : '날짜 없음';
        const current = timelineMap.get(key) || {
          key,
          commits: new Set(),
          files: new Set()
        };
        current.commits.add(commit.id || commit.short_sha || commit.short_id || `${file.path}-${key}`);
        current.files.add(file.path);
        timelineMap.set(key, current);
      });
    });
    const timeline = Array.from(timelineMap.values()).sort((a, b) => a.key.localeCompare(b.key)).map(bucket => ({
      key: bucket.key,
      label: bucket.key === '날짜 없음' ? bucket.key : formatDate(bucket.key),
      commitCount: bucket.commits.size,
      fileCount: bucket.files.size
    }));
    return {
      files,
      totalChange,
      totalAdditions,
      totalDeletions,
      hasPerCommitStats,
      maxFileChange,
      maxAuthorChange: Math.max(1, ...authorsByTouch.map(author => author.change)),
      maxDirectoryChange: Math.max(1, ...directories.map(directory => directory.change)),
      maxTimelineCount: Math.max(1, ...timeline.map(bucket => bucket.commitCount)),
      topFiles,
      authorsByTouch,
      topAuthor: authorsByTouch[0] || null,
      topAuthorShare: authorTotalChange ? Math.round((authorsByTouch[0]?.change || 0) / authorTotalChange * 100) : 0,
      directories,
      timeline
    };
  }, [filteredGitReportFiles]);
  
  const gitReportHeatmap = useMemo(() => {
    const commitMap = new Map();
    let hasStats = false;
    const rows = filteredGitReportFiles.map(file => {
      const cells = new Map();
      const stats = file.commit_file_stats || [];
      let totalAdditions = 0;
      let totalDeletions = 0;
      stats.forEach(stat => {
        const key = getCommitKey(stat);
        if (!key) return;
        hasStats = true;
        if (!commitMap.has(key)) {
          commitMap.set(key, {
            key,
            shortSha: getCommitShort(stat),
            date: getCommitDateValue(stat),
            author: getCommitAuthor(stat),
            title: getCommitTitle(stat)
          });
        }
        const current = cells.get(key) || {
          additions: 0,
          deletions: 0
        };
        current.additions += stat.additions || 0;
        current.deletions += stat.deletions || 0;
        cells.set(key, current);
        totalAdditions += stat.additions || 0;
        totalDeletions += stat.deletions || 0;
      });
      return {
        file,
        cells,
        totalAdditions,
        totalDeletions,
        totalChurn: totalAdditions + totalDeletions,
        totalMetric: getHeatmapMetricValue({
          additions: totalAdditions,
          deletions: totalDeletions
        }, gitHeatmapMetric),
        lastTouch: getLastTouchInfo(file)
      };
    });
    const commits = Array.from(commitMap.values()).sort((a, b) => getCommitTime(a) - getCommitTime(b) || a.shortSha.localeCompare(b.shortSha));
    const sortedRows = rows.filter(row => row.totalMetric > 0 || !hasStats).sort((a, b) => b.totalMetric - a.totalMetric || (b.file.additions || 0) + (b.file.deletions || 0) - ((a.file.additions || 0) + (a.file.deletions || 0)) || (a.file.path || '').localeCompare(b.file.path || ''));
    const heatmapCells = sortedRows.flatMap(row => commits.map(commit => row.cells.get(commit.key) || {
      additions: 0,
      deletions: 0
    }));
    const maxCellValue = Math.max(1, ...heatmapCells.map(cell => getHeatmapMetricValue(cell, gitHeatmapMetric)));
    const maxAdditionCell = Math.max(1, ...heatmapCells.map(cell => cell.additions || 0));
    const maxDeletionCell = Math.max(1, ...heatmapCells.map(cell => cell.deletions || 0));
    return {
      hasStats,
      commits,
      rows: sortedRows,
      visibleRows: sortedRows.slice(0, 60),
      maxCellValue,
      maxAdditionCell,
      maxDeletionCell,
      hiddenRows: Math.max(0, sortedRows.length - 60),
      metricLabel: gitHeatmapMetric === 'split' ? '+/- 분리' : gitHeatmapMetric === 'additions' ? '추가 라인' : gitHeatmapMetric === 'deletions' ? '삭제 라인' : '총 변경 라인'
    };
  }, [filteredGitReportFiles, gitHeatmapMetric]);

  return { filteredGitReportFiles, gitReportDensity, gitReportHeatmap }
}
