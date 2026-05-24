import { useMemo } from 'react'

export function useDashboardFileFilters(ctx) {
  const { buildFileTree, extractRiskFromAiSummary, filterQuery, result, riskFilter, selectedPath, setExpandedFolders, setSelectedPath } = ctx

  // Filter Logic & Tree Memoization
  const filesWithRiskMeta = useMemo(() => {
    if (!result?.files) return [];
    return result.files.map(file => ({
      ...file,
      risk: file.risk || extractRiskFromAiSummary(file.ai_summary, file.path)
    }));
  }, [result?.files]);
  
  const riskCounts = useMemo(() => {
    return filesWithRiskMeta.reduce((acc, file) => {
      if (file.risk) {
        acc.total += 1;
        acc[file.risk.severity] = (acc[file.risk.severity] || 0) + 1;
      } else {
        acc.none += 1;
      }
      return acc;
    }, {
      total: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
      none: 0
    });
  }, [filesWithRiskMeta]);
  
  const filteredFiles = useMemo(() => {
    if (!filesWithRiskMeta.length) return [];
    let files = filesWithRiskMeta;
  
    // 1. Filter by Directory Path
    if (selectedPath) {
      files = files.filter(f => f.path.startsWith(selectedPath + '/'));
    }
    if (riskFilter === 'risk') {
      files = files.filter(f => Boolean(f.risk));
    } else if (riskFilter === 'none') {
      files = files.filter(f => !f.risk);
    } else if (['HIGH', 'MEDIUM', 'LOW'].includes(riskFilter)) {
      files = files.filter(f => f.risk?.severity === riskFilter);
    }
  
    // 2. Filter by Search Query
    if (filterQuery) {
      const lowerQuery = filterQuery.toLowerCase();
      const pathMatches = files.filter(f => f.path.toLowerCase().includes(lowerQuery));
      files = pathMatches.length > 0 ? pathMatches : files.filter(f => f.ai_summary?.toLowerCase().includes(lowerQuery) || f.risk?.riskType?.toLowerCase().includes(lowerQuery) || f.risk?.originalContent?.toLowerCase().includes(lowerQuery));
    }
    return files;
  }, [filesWithRiskMeta, filterQuery, selectedPath, riskFilter]);
  
  const fileTree = useMemo(() => {
    if (!filesWithRiskMeta.length) return null;
    return buildFileTree(filesWithRiskMeta);
  }, [filesWithRiskMeta]);
  
  const toggleFolder = path => {
    // If clicking the currently selected folder, toggle expansion only?
    // User wants: "Calculate filtering... clicking it shows only things there"
    // So clicking a folder should SELECT it as filter path.
  
    if (selectedPath === path) {
      // Deselect if clicking again? Or just toggle expansion?
      // Let's functionality: Click -> Selects & Expands. Click again -> Collapses?
      // Better: Click -> Selects Filter. Expansion managed separately (arrow)?
      // For simplicity: Click whole row -> Select Filter & Toggle Expand
      setSelectedPath(prev => prev === path ? null : path);
    } else {
      setSelectedPath(path);
    }
    setExpandedFolders(prev => ({
      ...prev,
      [path]: !prev[path]
    }));
  };
  
  // Expand root folders by default

  return { filesWithRiskMeta, riskCounts, filteredFiles, fileTree, toggleFolder }
}
