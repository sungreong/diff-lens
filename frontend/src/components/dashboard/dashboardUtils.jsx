import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, GitCompareArrows, GitMerge, ShieldCheck } from 'lucide-react'

// Format ISO date to readable Korean format
export const formatDate = (isoDate) => {
  if (!isoDate) return ''
  const date = new Date(isoDate)
  return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
}

export const formatDuration = (seconds) => {
  if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) return ''
  const value = Math.max(0, Number(seconds))
  if (value < 60) return `${value < 10 ? value.toFixed(1) : Math.round(value)}초`
  const minutes = Math.floor(value / 60)
  const rest = Math.round(value % 60)
  return `${minutes}분 ${rest}초`
}

export const normalizeRefValue = (value) => (value || '').trim().toLowerCase()

export const refLockMatchesSelection = (resolved, selectedRef) => {
  if (!resolved || !selectedRef) return false
  const selected = normalizeRefValue(selectedRef)
  return [
    resolved.sha,
    resolved.full_sha,
    resolved.short_sha,
    resolved.ref,
    resolved.name,
  ].some(value => normalizeRefValue(value) === selected)
}

export const previewMatchesSelection = (preview, baselineRef, candidateRef, compareStrategy) => {
  if (!preview) return false
  if (preview.compare_strategy && preview.compare_strategy !== compareStrategy) return false
  return (
    refLockMatchesSelection(preview.baseline_resolved, baselineRef) &&
    refLockMatchesSelection(preview.candidate_resolved, candidateRef)
  )
}

export const mergeCheckMethodLabel = (method) => {
  if (!method || method === 'git_dry_run_merge') return '임시 병합 확인'
  if (method === 'ui_conflict_preview') return '충돌 화면 예시'
  return method
}

export const buildMergeCheckContext = (mergeCheck) => {
  if (!mergeCheck) return null
  if (mergeCheck.is_demo) return null
  return {
    status: mergeCheck.status,
    mergeable: mergeCheck.mergeable,
    has_conflicts: mergeCheck.has_conflicts,
    conflict_files: mergeCheck.conflict_files || [],
    conflict_count: mergeCheck.conflict_count || mergeCheck.conflict_files?.length || 0,
    method: mergeCheck.method,
    message: mergeCheck.message,
    target_ref: mergeCheck.target_ref,
    source_ref: mergeCheck.source_ref,
    target_sha: mergeCheck.target_sha,
    source_sha: mergeCheck.source_sha,
    merge_base_sha: mergeCheck.merge_base_sha,
    diagnostics: mergeCheck.diagnostics || {},
  }
}

export const getMergeCheckAiQuestions = (mergeCheck) => {
  if (!mergeCheck) return []
  if (mergeCheck.status === 'conflicts') {
    const firstFile = mergeCheck.conflict_files?.[0]
    return [
      firstFile
        ? `가장 먼저 봐야 할 충돌 파일은 ${firstFile}인가요? 이유를 설명해줘.`
        : '어떤 충돌 유형부터 확인해야 하나요?',
      '기준 버전의 hotfix와 개발 후보 변경 중 어느 쪽이 빠지면 위험한가요?',
      '충돌을 해결하기 전에 추가로 확인해야 할 테스트나 영향 파일은 무엇인가요?',
    ]
  }
  if (mergeCheck.status === 'unknown') {
    return [
      '충돌 체크가 왜 확정되지 않았는지 가능한 원인을 설명해줘.',
      '다시 실행하기 전에 브랜치/커밋 선택에서 확인해야 할 것은 무엇인가요?',
      'AI 분석은 계속 진행해도 되는지, 먼저 Git 상태를 정리해야 하는지 판단해줘.',
    ]
  }
  return []
}

// Get date range options

// Helper to build file tree with recursive stats
export const buildFileTree = (files) => {
  const root = { 
      name: 'root', 
      path: '', 
      type: 'folder', 
      children: {}, 
      files: [],
      stats: { files: 0, additions: 0, deletions: 0 }
  };

  files.forEach(file => {
    const parts = file.path.split('/');
    let current = root;

    // Update root stats
    root.stats.files++;
    root.stats.additions += (file.additions || 0);
    root.stats.deletions += (file.deletions || 0);

    // Handle directories
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!current.children[part]) {
            const path = parts.slice(0, i + 1).join('/');
            current.children[part] = { 
                name: part, 
                path: path, 
                type: 'folder', 
                children: {}, 
                files: [],
                stats: { files: 0, additions: 0, deletions: 0 }
            };
        }
        current = current.children[part];
        
        // Update folder stats (accumulation)
        current.stats.files++;
        current.stats.additions += (file.additions || 0);
        current.stats.deletions += (file.deletions || 0);
    }

    // Add file to the leaf folder
    current.files.push(file);
  });

  return root;
};

// Recursive File Tree Node Component
export const FileTreeNode = ({ node, level = 0, selectedPath, expandedFolders, toggleFolder, onSelectFile }) => {
  const isExpanded = expandedFolders[node.path];
  const isSelected = selectedPath === node.path;
  const hasChildren = Object.keys(node.children).length > 0 || node.files.length > 0;
  
  if (!node.path && level === 0) {
    // Root node wrapper
    return (
      <div className="text-sm">
        {Object.values(node.children).map(child => (
          <FileTreeNode 
            key={child.path} 
            node={child} 
            level={level} 
            selectedPath={selectedPath}
            expandedFolders={expandedFolders}
            toggleFolder={toggleFolder}
            onSelectFile={onSelectFile}
          />
        ))}
        {node.files.map(file => (
          <FileTreeNodeFile 
             key={file.path} 
             file={file} 
             level={level}
             onSelectFile={onSelectFile}
          />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div 
        className={`flex items-center gap-1.5 py-1 px-2 cursor-pointer hover:bg-slate-800/50 rounded transition-colors ${isSelected ? 'bg-primary/20 text-primary' : 'text-slate-400'}`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={() => toggleFolder(node.path)}
      >
        <div className="bg-transparent p-0.5 rounded hover:bg-white/10 text-slate-500 shrink-0">
           {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
        {isExpanded ? <FolderOpen size={14} className="text-blue-400 shrink-0" /> : <Folder size={14} className="text-blue-400 shrink-0" />}
        <span className="truncate select-none font-medium">{node.name}</span>
        
        {/* Stats Badge */}
        <div className="ml-auto flex items-center gap-2 text-[10px] font-mono opacity-60">
           <span className="text-slate-400" title="Files">{node.stats.files}</span>
           {(node.stats.additions > 0 || node.stats.deletions > 0) && (
              <div className="flex items-center gap-0.5 bg-slate-800 px-1 rounded">
                 <span className="text-green-500">+{node.stats.additions}</span>
                 <span className="text-slate-600">|</span>
                 <span className="text-red-500">-{node.stats.deletions}</span>
              </div>
           )}
        </div>
      </div>
      
      {isExpanded && (
        <div>
          {Object.values(node.children).map(child => (
            <FileTreeNode 
              key={child.path} 
              node={child} 
              level={level + 1} 
              selectedPath={selectedPath}
              expandedFolders={expandedFolders}
              toggleFolder={toggleFolder}
              onSelectFile={onSelectFile}
            />
          ))}
          {node.files.map(file => (
            <FileTreeNodeFile 
               key={file.path} 
               file={file} 
               level={level + 1}
               onSelectFile={onSelectFile}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// Leaf node for file in tree
export const FileTreeNodeFile = ({ file, level, onSelectFile }) => (
  <div 
    className="flex items-center gap-2 py-1 px-2 cursor-pointer hover:bg-slate-800/50 text-slate-500 hover:text-slate-300 transition-colors group"
    style={{ paddingLeft: `${level * 12 + 28}px` }}
    onClick={() => onSelectFile(file)}
  >
    <FileText size={13} />
    <span className="truncate text-xs group-hover:text-primary transition-colors">{file.path.split('/').pop()}</span>
  </div>
);

export const getDateRangeOptions = () => [
  { value: '', label: '전체 기간' },
  { value: '7', label: '최근 1주' },
  { value: '14', label: '최근 2주' },
  { value: '30', label: '최근 1개월' },
  { value: '90', label: '최근 3개월' },
]

export const getRepoHost = (url) => {
  if (!url) return 'Repository not selected'
  try {
    return new URL(url).host
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] || url
  }
}

export const getRepoStateLabel = (state) => {
  if (state === 'checking') return 'Checking'
  if (state === 'connected') return 'Connected'
  if (state === 'warning') return 'Needs attention'
  if (state === 'missing') return 'Missing config'
  if (state === 'disconnected') return 'Disconnected'
  return 'Not checked'
}

export const getFileStatusLabel = (status) => {
  if (status === 'added') return '추가'
  if (status === 'deleted') return '삭제'
  if (status === 'renamed') return '이름 변경'
  if (status === 'history_only') return '중간 변경'
  return '수정'
}

export const getAnalysisStatusLabel = (status) => {
  if (!status || status === 'all') return '전체 상태'
  return `${getFileStatusLabel(status)}만`
}

export const getAnalysisLimitLabel = (maxFiles) => {
  if (!maxFiles || maxFiles <= 0) return '전체 파일'
  return `Top ${maxFiles}`
}

export const analysisSortOptions = [
  {
    key: 'changes',
    label: '변경량 큰 순',
    shortLabel: '변경량',
    description: '추가와 삭제 라인이 큰 파일부터 봅니다.',
  },
  {
    key: 'risk',
    label: '리스크 후보 우선',
    shortLabel: '리스크 후보',
    description: '인증, API, DB, 설정 파일과 삭제가 많은 파일을 먼저 봅니다.',
  },
  {
    key: 'deletions',
    label: '삭제 많은 순',
    shortLabel: '삭제량',
    description: '빠진 코드가 많은 파일부터 봅니다.',
  },
  {
    key: 'commits',
    label: '커밋 많이 걸친 순',
    shortLabel: '커밋 수',
    description: '여러 번 손댄 파일부터 봅니다.',
  },
  {
    key: 'recent',
    label: '최근 수정 순',
    shortLabel: '최근 수정',
    description: '선택 범위에서 마지막으로 만진 파일부터 봅니다.',
  },
  {
    key: 'additions',
    label: '추가 많은 순',
    shortLabel: '추가량',
    description: '새 코드가 많은 파일부터 봅니다.',
  },
  {
    key: 'path',
    label: '파일 경로 순',
    shortLabel: '경로',
    description: '폴더와 파일명을 기준으로 예측 가능하게 봅니다.',
  },
]

export const getAnalysisSortOption = (sortKey) => (
  analysisSortOptions.find(option => option.key === sortKey) || analysisSortOptions[0]
)

export const getFileRiskPriority = (file) => {
  const path = (file?.path || '').toLowerCase()
  let score = 0
  if (/(auth|permission|security|token|secret|credential)/.test(path)) score += 80
  if (/(api|router|route|endpoint|controller)/.test(path)) score += 45
  if (/(schema|migration|model|database|sql|db)/.test(path)) score += 45
  if (/(config|\.env|docker|compose|requirements|package\.json|lock)/.test(path)) score += 35
  if (/(test|spec)/.test(path)) score -= 10
  score += Math.min(file?.deletions || 0, 120)
  score += Math.min((file?.commit_ids?.length || 0) * 8, 80)
  return score
}

export const getFileLatestTouchValue = (file) => {
  if (file?.last_touched_at) return file.last_touched_at
  const dates = (file?.related_commits || [])
    .map(commit => commit.committed_date || commit.created_at || commit.date || '')
    .filter(Boolean)
  return dates.length ? dates.sort().at(-1) : ''
}

export const sortFilesForAnalysis = (files = [], sortKey = 'changes') => {
  const list = [...files]
  const changeSize = file => (file?.additions || 0) + (file?.deletions || 0)
  if (sortKey === 'path') {
    return list.sort((a, b) => (a.path || '').localeCompare(b.path || ''))
  }
  if (sortKey === 'deletions') {
    return list.sort((a, b) => (b.deletions || 0) - (a.deletions || 0) || changeSize(b) - changeSize(a) || (a.path || '').localeCompare(b.path || ''))
  }
  if (sortKey === 'additions') {
    return list.sort((a, b) => (b.additions || 0) - (a.additions || 0) || changeSize(b) - changeSize(a) || (a.path || '').localeCompare(b.path || ''))
  }
  if (sortKey === 'commits') {
    return list.sort((a, b) => (b.commit_ids?.length || 0) - (a.commit_ids?.length || 0) || changeSize(b) - changeSize(a) || (a.path || '').localeCompare(b.path || ''))
  }
  if (sortKey === 'recent') {
    return list.sort((a, b) => getFileLatestTouchValue(b).localeCompare(getFileLatestTouchValue(a)) || changeSize(b) - changeSize(a) || (a.path || '').localeCompare(b.path || ''))
  }
  if (sortKey === 'risk') {
    return list.sort((a, b) => getFileRiskPriority(b) - getFileRiskPriority(a) || changeSize(b) - changeSize(a) || (a.path || '').localeCompare(b.path || ''))
  }
  return list.sort((a, b) => changeSize(b) - changeSize(a) || (a.path || '').localeCompare(b.path || ''))
}

export const getFileStatusClass = (status) => {
  if (status === 'added') return 'bg-green-500/10 text-green-500 border border-green-500/20'
  if (status === 'deleted') return 'bg-red-500/10 text-red-500 border border-red-500/20'
  if (status === 'renamed') return 'bg-blue-500/10 text-blue-500 border border-blue-500/20'
  if (status === 'history_only') return 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
  return 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20'
}

export const formatRelatedCommits = (commits = []) => {
  if (!commits.length) return ''
  return commits.map((commit) => {
    const id = commit.short_id || commit.id?.slice(0, 8) || ''
    const title = commit.title || commit.message || ''
    const author = commit.author_name || commit.author || ''
    const date = commit.created_at || commit.date || ''
    return [id, title, author, date].filter(Boolean).join(' | ')
  }).join('\n')
}

export const getCommitTime = (commit) => {
  const raw = commit?.committed_date || commit?.created_at || commit?.date
  const timestamp = raw ? Date.parse(raw) : NaN
  return Number.isFinite(timestamp) ? timestamp : -Infinity
}

export const getLastTouchCommit = (file) => {
  const commits = file?.related_commits || []
  if (!commits.length) return null
  return commits.reduce((latest, commit) => (
    getCommitTime(commit) >= getCommitTime(latest) ? commit : latest
  ), commits[0])
}

export const getLastTouchInfo = (file) => {
  if (file?.last_touched_by || file?.last_touched_commit || file?.last_touched_at) {
    return {
      author: file.last_touched_by || 'Unknown',
      email: file.last_touched_email || '',
      commit: file.last_touched_commit || '',
      shortCommit: file.last_touched_commit_short || file.last_touched_commit?.slice(0, 8) || '',
      date: file.last_touched_at || '',
    }
  }

  const commit = getLastTouchCommit(file)
  if (!commit) {
    return {
      author: '',
      email: '',
      commit: '',
      shortCommit: '',
      date: '',
    }
  }

  return {
    author: commit.author_name || commit.author || 'Unknown',
    email: commit.author_email || '',
    commit: commit.full_sha || commit.id || '',
    shortCommit: commit.short_sha || commit.short_id || commit.id?.slice(0, 8) || '',
    date: commit.committed_date || commit.created_at || commit.date || '',
  }
}

export const getNetDiffFiles = (files = []) => files.filter(file => !file.has_history_only && file.status !== 'history_only')

export const getFileName = (path = '') => path.split('/').filter(Boolean).pop() || path || 'unknown'

export const getDirectoryPath = (path = '') => {
  const parts = path.split('/').filter(Boolean)
  if (parts.length <= 1) return '루트 경로'
  return parts.slice(0, -1).join('/')
}

export const getChangeSizeLabel = (file) => {
  const total = (file?.additions || 0) + (file?.deletions || 0)
  if (total >= 300) return '큰 변경'
  if (total >= 80) return '중간 변경'
  return '작은 변경'
}

export const getChangeSizeClass = (file) => {
  const total = (file?.additions || 0) + (file?.deletions || 0)
  if (total >= 300) return 'border-[#ff9b78]/25 bg-[#ff9b78]/10 text-[#ffb199]'
  if (total >= 80) return 'border-primary/25 bg-primary/10 text-primary'
  return 'border-[#79b8c5]/20 bg-[#79b8c5]/10 text-[#9ed9e4]'
}

export const getCommitKey = (commit = {}) => (
  commit.commit_id ||
  commit.full_sha ||
  commit.id ||
  commit.short_sha ||
  commit.short_id ||
  ''
)

export const getCommitShort = (commit = {}) => (
  commit.short_sha ||
  commit.short_id ||
  commit.id ||
  commit.commit_id ||
  ''
).slice(0, 8)

export const getCommitDateValue = (commit = {}) => (
  commit.committed_date ||
  commit.created_at ||
  commit.authored_date ||
  commit.date ||
  ''
)

export const getCommitAuthor = (commit = {}) => (
  commit.author_name ||
  commit.author ||
  commit.last_touched_by ||
  'Unknown'
)

export const getCommitTitle = (commit = {}) => (
  commit.title ||
  commit.message ||
  'No commit message'
)

export const getXlsxHeatStyle = (value, maxValue, type) => {
  if (!value || value <= 0) return 0
  const ratio = value / Math.max(maxValue || 1, 1)
  const base = type === 'deletions' ? 7 : 3
  if (ratio >= 0.75) return base + 3
  if (ratio >= 0.4) return base + 2
  if (ratio >= 0.15) return base + 1
  return base
}

export const getHeatmapMetricValue = (cell = {}, metric = 'churn') => {
  if (metric === 'additions') return cell.additions || 0
  if (metric === 'deletions') return cell.deletions || 0
  return (cell.additions || 0) + (cell.deletions || 0)
}

export const getHeatmapCellStyle = (value, maxValue, metric = 'churn', cell = {}) => {
  if (!value) {
    return {
      backgroundColor: 'rgba(23, 21, 16, 0.42)',
      borderColor: 'rgba(176, 139, 72, 0.08)',
      color: '#575148',
    }
  }

  const ratio = Math.min(1, value / Math.max(maxValue || 1, 1))
  const alpha = 0.16 + ratio * 0.62
  if (metric === 'split') {
    const additions = cell.additions || 0
    const deletions = cell.deletions || 0
    const addRatio = additions / Math.max(value, 1)
    const delRatio = deletions / Math.max(value, 1)
    if (additions && deletions) {
      return {
        background: `linear-gradient(135deg, rgba(75, 171, 236, ${0.18 + addRatio * 0.55}) 0%, rgba(75, 171, 236, ${0.18 + addRatio * 0.55}) 49%, rgba(255, 106, 84, ${0.2 + delRatio * 0.58}) 51%, rgba(255, 106, 84, ${0.2 + delRatio * 0.58}) 100%)`,
        borderColor: 'rgba(241, 210, 144, 0.22)',
        color: '#fff8e7',
      }
    }
    const color = additions
      ? `rgba(75, 171, 236, ${alpha})`
      : `rgba(255, 106, 84, ${alpha})`
    return {
      backgroundColor: color,
      borderColor: color,
      color: ratio > 0.45 ? '#fff8e7' : '#d8caa7',
    }
  }

  const color = metric === 'additions'
    ? `rgba(75, 171, 236, ${alpha})`
    : metric === 'deletions'
      ? `rgba(255, 106, 84, ${alpha})`
      : `rgba(247, 178, 69, ${alpha})`

  return {
    backgroundColor: color,
    borderColor: color,
    color: ratio > 0.5 ? '#fff8e7' : '#d8caa7',
  }
}

export const analysisModeOptions = [
  { key: 'git', label: '변경표', Icon: GitCompareArrows, badge: '기본', kind: 'git' },
  { key: 'quick', label: '파일별 AI 메모', icon: '⚡', badge: 'AI', kind: 'ai' },
  { key: 'full', label: '선택 범위 요약', icon: '📊', badge: 'AI', kind: 'ai' },
  { key: 'history', label: '커밋 흐름 분석', icon: '📚', badge: 'AI', kind: 'ai' },
]

export const comparisonPurposeOptions = [
  {
    key: 'commit',
    label: '커밋 비교',
    Icon: GitCompareArrows,
    title: 'Git 커밋 A→B 변경표',
    description: 'Base와 Target을 고르면 파일 상태, 라인 증감, 커밋 흐름을 정리합니다.',
  },
  {
    key: 'pre_deploy',
    label: '배포 전 점검',
    Icon: ShieldCheck,
    title: '개발 후보 ↔ 배포 기준 점검',
    description: '개발 후보와 운영 기준 버전의 상태 차이, 누락 가능 hotfix, AI 영향 후보를 같이 봅니다.',
  },
  {
    key: 'merge_plan',
    label: '통합 머지 플랜',
    Icon: GitMerge,
    title: '여러 후보 → 대상 브랜치 통합 점검',
    description: 'A, B 후보를 C 브랜치에 개별·순차 dry-run으로 붙여 충돌과 처리 순서를 확인합니다.',
  },
]

export const compareStrategyOptions = [
  {
    key: 'deployment_state',
    label: '전체 상태 차이',
    detail: '기준에만 있는 변경도 함께 보여 누락 가능 hotfix를 확인합니다.',
  },
  {
    key: 'branch_delta',
    label: '브랜치 작업분만',
    detail: '개발 브랜치에서 새로 작업한 변경만 확인합니다.',
  },
]

export const impactScopeOptions = [
  {
    value: 1,
    label: '좁게',
    detail: '가장 관련 있어 보이는 후보만 빠르게 훑습니다.',
  },
  {
    value: 2,
    label: '보통',
    detail: '주변 후보를 조금 더 넓게 확인합니다.',
  },
  {
    value: 3,
    label: '넓게',
    detail: '더 많은 주변 후보를 훑고 최종 후보를 고릅니다.',
  },
]

export const commitToRefOption = (commit) => {
  const value = commit?.full_sha || commit?.sha || commit?.id
  if (!value) return null
  const shortId = commit.short_id || commit.short_sha || value.slice(0, 8)
  return {
    value,
    label: `${shortId} · ${commit.title || 'commit'}`,
    sha: commit.full_sha || commit.sha || value,
    shortSha: shortId,
    raw: commit,
  }
}

export const buildCommitRefOptions = (commits = []) => {
  const seen = new Set()
  return commits
    .map(commitToRefOption)
    .filter(option => {
      if (!option?.value || seen.has(option.value)) return false
      seen.add(option.value)
      return true
    })
}

export const mergeCheckSteps = [
  {
    key: 'resolving_refs',
    label: '버전 확인',
    description: '개발/기준 버전의 실제 커밋을 확인합니다.',
  },
  {
    key: 'preparing_workspace',
    label: '작업공간 준비',
    description: '실제 저장소를 건드리지 않는 임시 병합 공간을 준비합니다.',
  },
  {
    key: 'fetching_refs',
    label: '코드 가져오기',
    description: 'GitLab에서 기준과 후보 버전을 가져옵니다.',
  },
  {
    key: 'running_dry_merge',
    label: '임시 병합',
    description: '커밋 없이 병합 가능 여부만 확인합니다.',
  },
  {
    key: 'collecting_conflicts',
    label: '결과 정리',
    description: '충돌 파일과 확인 메시지를 정리합니다.',
  },
]

export const analysisModeDetails = {
  git: {
    title: 'Git 변경표',
    question: 'A와 B 사이에 최종적으로 어떤 파일이 바뀌었나?',
    result: 'AI 없이 파일 상태, 라인 증감, 커밋 히트맵, XLSX를 만듭니다.',
    estimate: '가장 빠름',
    caution: '리뷰의 기준 화면입니다.',
    action: 'A→B 변경표 생성',
    loading: '변경표 생성 중...',
    step: '변경표 생성',
  },
  quick: {
    title: '파일별 AI 메모',
    question: '각 파일에서 무엇이 바뀌었는지 빠르게 훑고 싶은가?',
    result: '파일별 핵심 변경 증빙과 짧은 AI 메모를 생성합니다.',
    estimate: '빠름 · 파일별 스트리밍',
    caution: '전체 결론보다 파일별 단서 확인에 적합합니다.',
    action: '파일별 AI 메모 생성',
    loading: '파일별 AI 메모 생성 중...',
    step: 'AI 메모 생성',
  },
  full: {
    title: '선택 범위 요약',
    question: '선택한 파일 범위를 리뷰/공유용 리포트로 정리해야 하나?',
    result: '분석 범위 안의 파일 메모에 요약, 변경 유형 분류, 검토 포인트를 더합니다.',
    estimate: '중간 · 요약 단계 포함',
    caution: '요약은 검토 보조이며 테스트 결과를 대체하지 않습니다.',
    action: '선택 범위 요약 생성',
    loading: '선택 범위 요약 생성 중...',
    step: '선택 범위 요약',
  },
  history: {
    title: '커밋 흐름 분석',
    question: '특정 파일이 여러 커밋을 거치며 왜 바뀌었는지 추적해야 하나?',
    result: '파일별 관련 커밋을 시간순으로 따라가며 변화 흐름을 요약합니다.',
    estimate: '느림 · 커밋 단위 분석',
    caution: '전체 실행은 오래 걸릴 수 있어 중요한 파일 위주가 좋습니다.',
    action: '커밋 흐름 분석 시작',
    loading: '커밋 흐름 분석 중...',
    step: '커밋 흐름 분석',
  },
}
