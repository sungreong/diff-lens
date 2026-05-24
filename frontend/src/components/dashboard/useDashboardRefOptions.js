import { useMemo } from 'react'

export function useDashboardRefOptions(ctx) {
  const { analysisSort, analysisStatusFilter, authorFilter, authorSearch, authors, baseCommit, buildCommitRefOptions, commits, compareRefs, dateFilter, maxFiles, preview, refBookmarks, refScopedCommits, settings, sortFilesForAnalysis, targetCommit } = ctx

  // Filter commits by date only (for Base selection)
  const baseCommitList = useMemo(() => {
    if (!dateFilter || !commits.length) return commits;
    const daysAgo = parseInt(dateFilter);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysAgo);
    return commits.filter(c => new Date(c.created_at) >= cutoffDate);
  }, [commits, dateFilter]);
  
  const previewPrioritizedFiles = useMemo(() => {
    if (!preview?.files) return [];
    const scopedFiles = analysisStatusFilter === 'all' ? preview.files : preview.files.filter(file => file.status === analysisStatusFilter);
    return sortFilesForAnalysis(scopedFiles, analysisSort);
  }, [preview?.files, analysisStatusFilter, analysisSort]);
  
  const previewScopeFileCount = useMemo(() => {
    if (!preview?.files) return null;
    return previewPrioritizedFiles.length;
  }, [preview?.files, previewPrioritizedFiles.length]);
  
  const previewAnalysisFileCount = useMemo(() => {
    if (previewScopeFileCount === null) return null;
    if (!maxFiles || maxFiles <= 0) return previewScopeFileCount;
    return Math.min(maxFiles, previewScopeFileCount);
  }, [previewScopeFileCount, maxFiles]);
  
  // Get base commit index for filtering target
  
  // Get base commit index for filtering target
  const baseCommitIndex = useMemo(() => {
    if (!baseCommit || !commits.length) return -1;
    return commits.findIndex(c => c.id === baseCommit);
  }, [commits, baseCommit]);
  
  // Filter commits for Target: must be after base, filtered by author
  
  // Filter commits for Target: must be after base, filtered by author
  const targetCommitList = useMemo(() => {
    let filtered = commits;
  
    // Date filter
    if (dateFilter) {
      const daysAgo = parseInt(dateFilter);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysAgo);
      filtered = filtered.filter(c => new Date(c.created_at) >= cutoffDate);
    }
  
    // Must be before or equal to base position (commits are newest first)
    // Inclusive: include the base commit itself in the range
    if (baseCommitIndex >= 0) {
      filtered = filtered.slice(0, baseCommitIndex + 1);
    }
  
    // Author filter
    if (authorFilter.length > 0) {
      filtered = filtered.filter(c => authorFilter.some(author => c.author_name.toLowerCase().includes(author.toLowerCase())));
    }
    return filtered;
  }, [commits, dateFilter, baseCommitIndex, authorFilter]);
  
  // Compute authors from commits in the selected range (base to target)
  
  // Compute authors from commits in the selected range (base to target)
  const authorsInRange = useMemo(() => {
    if (!commits.length) return [];
    let commitsInRange = commits;
  
    // Apply date filter
    if (dateFilter) {
      const daysAgo = parseInt(dateFilter);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysAgo);
      commitsInRange = commitsInRange.filter(c => new Date(c.created_at) >= cutoffDate);
    }
  
    // Apply base commit filter (from base to target)
    if (baseCommitIndex >= 0) {
      // Get commits from target to base (inclusive)
      const targetIndex = targetCommit ? commits.findIndex(c => c.id === targetCommit) : 0;
      commitsInRange = commits.slice(targetIndex, baseCommitIndex + 1);
    }
  
    // Extract unique authors with commit counts
    const authorMap = new Map();
    commitsInRange.forEach(c => {
      const key = c.author_name;
      if (authorMap.has(key)) {
        authorMap.get(key).count++;
      } else {
        authorMap.set(key, {
          name: c.author_name,
          email: c.author_email,
          count: 1
        });
      }
    });
  
    // Sort by commit count descending
    return Array.from(authorMap.values()).sort((a, b) => b.count - a.count);
  }, [commits, dateFilter, baseCommitIndex, targetCommit]);
  
  const visibleAuthorChips = useMemo(() => {
    const baseAuthors = authorsInRange.length > 0 ? authorsInRange : authors;
    const searchedAuthors = authorSearch ? baseAuthors.filter(a => a.name.toLowerCase().includes(authorSearch.toLowerCase())) : baseAuthors;
    const chipMap = new Map();
    searchedAuthors.forEach(author => chipMap.set(author.name, author));
    baseAuthors.filter(author => authorFilter.includes(author.name)).forEach(author => chipMap.set(author.name, author));
    return Array.from(chipMap.values()).sort((a, b) => {
      const aSelected = authorFilter.includes(a.name);
      const bSelected = authorFilter.includes(b.name);
      if (aSelected !== bSelected) return bSelected ? 1 : -1;
      const countDiff = (b.count || 0) - (a.count || 0);
      if (countDiff !== 0) return countDiff;
      return a.name.localeCompare(b.name, 'ko');
    });
  }, [authorsInRange, authors, authorSearch, authorFilter]);
  
  // Git report state
  
  const refOptionGroups = useMemo(() => {
    const addUnique = (items, getValue, getLabel) => {
      const seen = new Set();
      return items.map(item => {
        const value = getValue(item);
        if (!value || seen.has(value)) return null;
        seen.add(value);
        return {
          value,
          label: getLabel(item, value),
          sha: item.sha || item.full_sha || null,
          shortSha: item.short_sha || item.short_id || item.sha?.slice?.(0, 8) || item.full_sha?.slice?.(0, 8) || null,
          raw: item
        };
      }).filter(Boolean);
    };
    const groups = [{
      label: '즐겨찾기',
      options: addUnique(refBookmarks, item => item.ref, item => `${item.label}${item.short_sha ? ` @ ${item.short_sha}` : ''}`)
    }, {
      label: '브랜치',
      options: addUnique(compareRefs.branches || [], item => item.name, item => `${item.name}${item.short_sha ? ` @ ${item.short_sha}` : ''}`)
    }, {
      label: '태그',
      options: addUnique(compareRefs.tags || [], item => item.name, item => `${item.name}${item.short_sha ? ` @ ${item.short_sha}` : ''}`)
    }, {
      label: '최근 커밋',
      options: buildCommitRefOptions(compareRefs.commits || [])
    }];
    return groups.filter(group => group.options.length > 0);
  }, [refBookmarks, compareRefs]);
  
  const knownBranchNames = useMemo(() => new Set((compareRefs.branches || []).map(branch => branch.name).filter(Boolean)), [compareRefs.branches]);
  
  const primaryRefOptionGroups = useMemo(() => refOptionGroups.filter(group => group.label !== '최근 커밋'), [refOptionGroups]);
  
  const candidateCommitOptions = useMemo(() => buildCommitRefOptions(refScopedCommits.candidate), [refScopedCommits.candidate]);
  
  const baselineCommitOptions = useMemo(() => buildCommitRefOptions(refScopedCommits.baseline), [refScopedCommits.baseline]);
  
  const repoBranchOptions = useMemo(() => {
    const seen = new Set();
    const options = [];
    const add = (name, suffix = '') => {
      const value = (name || '').trim();
      if (!value || seen.has(value)) return;
      seen.add(value);
      options.push({
        value,
        label: suffix ? `${value} · ${suffix}` : value
      });
    };
    add(settings.branch, 'active');
    add(compareRefs.default_branch, 'default');
    (compareRefs.branches || []).forEach(branch => add(branch.name, branch.short_sha || branch.sha?.slice(0, 8) || ''));
    if (!options.length) add('main');
    return options;
  }, [settings.branch, compareRefs]);

  return { baseCommitList, previewPrioritizedFiles, previewScopeFileCount, previewAnalysisFileCount, baseCommitIndex, targetCommitList, authorsInRange, visibleAuthorChips, refOptionGroups, knownBranchNames, primaryRefOptionGroups, candidateCommitOptions, baselineCommitOptions, repoBranchOptions }
}
