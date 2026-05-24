import { useState, useEffect } from 'react'
import { Star,  Trash2, Edit2, Plus, Globe, Lock, Save, RefreshCw, GitBranch, AlertCircle, ArrowLeft, Copy } from 'lucide-react'

const API_URL = import.meta.env.VITE_API_URL || '/api'

export default function SettingsRepo({ repos, activeProfileId, onUpdate }) {
  const [editingRepo, setEditingRepo] = useState(null)
  const [statuses, setStatuses] = useState({}) 

  useEffect(() => {
    repos.forEach(repo => {
        if (!statuses[repo.id]) {
            testItemConnection(repo)
        }
    })
  }, [repos])

  const testItemConnection = async (repo) => {
    setStatuses(prev => ({ ...prev, [repo.id]: { loading: true } }))
    try {
        const res = await fetch(`${API_URL}/test-connection`, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ git_url: repo.git_url, git_token: repo.git_token, project_id: repo.project_id })
        })
        const result = await res.json()
        setStatuses(prev => ({ 
          ...prev, 
          [repo.id]: { 
            loading: false, 
            success: result.success,
            message: result.message,
            projectName: result.project_name,
            defaultBranch: result.default_branch,
            checkedAt: new Date().toLocaleTimeString()
          } 
        }))
    } catch (e) {
        setStatuses(prev => ({ ...prev, [repo.id]: { loading: false, success: false, message: `브라우저에서 API 서버에 연결하지 못했습니다: ${e.message}`, checkedAt: new Date().toLocaleTimeString() } }))
    }
  }

  const handleActivate = async (id, e) => {
    e?.stopPropagation()
    await fetch(`${API_URL}/repos/${id}/activate`, { method: 'PATCH' })
    await onUpdate?.()
  }

  const handleDelete = async (id, e) => {
    e.stopPropagation()
    if (!confirm('Delete this repository?')) return
    await fetch(`${API_URL}/repos/${id}`, { method: 'DELETE' })
    onUpdate()
  }

  const openEditModal = (repo = null) => {
    setEditingRepo(repo || { name: '', git_url: '', git_token: '', project_id: '', branch: 'main' })
  }

  const copyToClipboard = (text) => {
      navigator.clipboard.writeText(text)
  }

  const getConnectionLabel = (st) => {
      if (st.loading) return 'Checking'
      if (st.success === true) return 'Connected'
      if (st.success === false) return 'Disconnected'
      return 'Not checked'
  }

  const getConnectionState = (st) => {
      if (st.loading) return 'checking'
      if (st.success === true) return 'connected'
      if (st.success === false) return 'disconnected'
      return 'idle'
  }

  if (editingRepo) {
      return (
        <RepoEditForm 
            repo={editingRepo} 
            activeProfileId={activeProfileId}
            onClose={() => setEditingRepo(null)} 
            onSave={() => {
                onUpdate()
                setEditingRepo(null)
            }}
        />
      )
  }

  return (
    <div className="flex-1 flex flex-col h-full relative overflow-hidden min-w-0">
        <div className="flex-1 flex flex-col p-6 overflow-hidden min-w-0">
            <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start gap-4 mb-6 shrink-0 min-w-0">
                <div className="min-w-0">
                    <h2 className="text-xl font-bold text-white">Repositories</h2>
                    <p className="text-xs text-stone-400 mt-1">
                        별표가 켜진 항목이 현재 분석에 사용됩니다. 연결 실패 시 Status에서 원인을 바로 확인하세요.
                    </p>
                </div>
                <button 
                    onClick={() => openEditModal()} 
                    className="action-primary px-4 py-2 text-sm active:scale-95 shrink-0 whitespace-nowrap self-start lg:self-auto"
                >
                    <Plus size={16} />
                    <span>Add Repository</span>
                </button>
            </div>

            <div className="surface-card flex-1 overflow-auto custom-scrollbar rounded-xl min-w-0 max-w-full">
                <table className="data-table settings-repo-table w-full table-fixed text-left">
                    <thead className="text-xs uppercase font-bold sticky top-0 z-10 backdrop-blur-md">
                        <tr>
                            <th className="px-6 py-3 w-12 text-center">Active</th>
                            <th className="px-6 py-3">Repository Info</th>
                            <th className="px-6 py-3 w-40">Branch</th>
                            <th className="px-6 py-3 w-72">Status</th>
                            <th className="px-6 py-3 w-36 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/50 text-sm md:text-base">
                        {repos.length === 0 && (
                            <tr>
                                <td colSpan="5" className="py-12 text-center text-slate-500">
                                    <div className="flex flex-col items-center justify-center gap-3">
                                        <div className="w-12 h-12 rounded-full bg-slate-800/50 flex items-center justify-center text-slate-600">
                                            <Globe size={24} />
                                        </div>
                                        <p className="font-medium text-slate-400">No repositories found</p>
                                        <p className="text-xs text-slate-500 max-w-xs">Connect a GitLab repository to start tracking changes.</p>
                                        <button 
                                            onClick={() => openEditModal()} 
                                            className="mt-2 text-primary text-xs font-bold hover:underline"
                                        >
                                            + Add New Repository
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        )}
                        {repos.map(r => {
                            const st = statuses[r.id] || {}
                            return (
                                <tr key={r.id} className="hover:bg-slate-800/30 transition-colors group">
                                    <td className="px-6 py-4 text-center">
                                        <button 
                                            onClick={(e) => handleActivate(r.id, e)}
                                            className={`p-1.5 rounded-full transition-all ${r.is_active ? 'text-yellow-400' : 'text-slate-600 hover:text-slate-400'}`}
                                            title={r.is_active ? "Active Repository" : "Set as Active"}
                                            aria-label={r.is_active ? "Active Repository" : "Set as Active Repository"}
                                        >
                                            <Star size={20} fill={r.is_active ? "currentColor" : "none"} strokeWidth={r.is_active ? 0 : 2} />
                                        </button>
                                    </td>
                                    <td className="px-6 py-4 min-w-0">
                                        <div className="flex flex-col gap-1.5 min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="font-bold text-white text-base truncate max-w-full">{r.name}</span>
                                                {r.is_active && (
                                                    <span className="status-pill px-2 py-0.5 text-[10px]">Used for analysis</span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-3 min-w-0">
                                                 <div 
                                                    className="flex items-center gap-1.5 text-slate-400 text-xs hover:text-slate-300 cursor-pointer group/url transition-colors min-w-0"
                                                    onClick={() => copyToClipboard(r.git_url)}
                                                    title="Click to Copy URL"
                                                >
                                                    <Globe size={11} className="shrink-0" />
                                                    <span className="truncate max-w-[240px]">{r.git_url}</span>
                                                    <Copy size={10} className="opacity-0 group-hover/url:opacity-100 transition-opacity" />
                                                 </div>
                                                 <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-800 text-slate-500 border border-slate-700/50 truncate max-w-[150px]" title={`ID: ${r.project_id}`}>
                                                    ID: {r.project_id}
                                                 </span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className="inline-flex max-w-full items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                            <GitBranch size={12} className="shrink-0" />
                                            <span className="truncate">{r.branch}</span>
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col gap-2">
                                            <div className="flex items-center gap-2">
                                                <span className="connection-chip" data-state={getConnectionState(st)}>
                                                    {st.loading && <RefreshCw size={13} className="animate-spin" />}
                                                    {!st.loading && <span className={`w-2 h-2 rounded-full ${st.success === true ? 'bg-secondary' : st.success === false ? 'bg-[#d7653d]' : 'bg-stone-600'}`} />}
                                                    {getConnectionLabel(st)}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => testItemConnection(r)}
                                                    className="action-ghost px-2 py-1 text-[10px]"
                                                    title="연결 상태 다시 확인"
                                                >
                                                    Retry
                                                </button>
                                            </div>
                                            <div className="max-w-[260px] text-[11px] leading-relaxed text-stone-400 break-words">
                                                {st.success === true ? (
                                                    <>
                                                        <span className="font-semibold text-secondary">{st.projectName || 'Project found'}</span>
                                                        {st.defaultBranch && <span> · default: {st.defaultBranch}</span>}
                                                    </>
                                                ) : st.success === false ? (
                                                    <span title={st.message}>{st.message || '연결 실패: Git URL, token, project ID 또는 네트워크를 확인하세요.'}</span>
                                                ) : (
                                                    <span>아직 연결 테스트를 실행하지 않았습니다.</span>
                                                )}
                                                {st.checkedAt && <span className="block text-stone-600">checked {st.checkedAt}</span>}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className={`flex items-center justify-end gap-1 transition-opacity ${r.is_active ? 'opacity-40 group-hover:opacity-100' : 'opacity-100'}`}>
                                            {!r.is_active && (
                                                <button
                                                    onClick={(e) => handleActivate(r.id, e)}
                                                    className="action-ghost px-2 py-1 text-[10px] whitespace-nowrap"
                                                    title="이 저장소를 분석 대상으로 사용"
                                                >
                                                    Use
                                                </button>
                                            )}
                                            <button onClick={() => openEditModal(r)} className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors" title="Edit">
                                                <Edit2 size={16} />
                                            </button>
                                            <button onClick={(e) => handleDelete(r.id, e)} className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors" title="Delete">
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    </div>
  )
}

function RepoEditForm({ repo, activeProfileId, onClose, onSave }) {
    const [form, setForm] = useState({ ...repo })
    const [branches, setBranches] = useState([])
    const [testing, setTesting] = useState(false)
    const [testResult, setTestResult] = useState(null)

    const isNew = !repo.id

    const handleTest = async () => {
        setTesting(true)
        setTestResult(null)
        try {
          const creds = { git_url: form.git_url, git_token: form.git_token, project_id: form.project_id }
          const res = await fetch(`${API_URL}/test-connection`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(creds)
          })
          const result = await res.json()
          setTestResult(result)
          if (result.success) {
            const bRes = await fetch(`${API_URL}/branches`, {
                 method: 'POST', headers: {'Content-Type': 'application/json'},
                 body: JSON.stringify(creds)
            })
            if (bRes.ok) setBranches(await bRes.json())
          }
        } catch (e) {
          setTestResult({ success: false, message: e.message })
        } finally {
          setTesting(false)
        }
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        try {
            const method = isNew ? 'POST' : 'PUT'
            const url = isNew 
                ? `${API_URL}/profiles/${activeProfileId}/repos` 
                : `${API_URL}/repos/${repo.id}`

            const res = await fetch(url, { 
                method, 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify(form) 
            })

            if (res.ok) {
                onSave()
            } else {
                alert('Failed to save')
            }
        } catch (e) {
            console.error(e)
            alert(e.message)
        }
    }

    return (
        <div className="flex-1 flex flex-col h-full bg-stone-950/20">
            {/* Header */}
            <div className="h-[60px] px-6 border-b border-primary/10 flex items-center gap-4 bg-stone-950/20 shrink-0">
                <button onClick={onClose} className="action-ghost p-2 -ml-2">
                    <ArrowLeft size={20} />
                </button>
                <div className='flex flex-col'>
                    <h3 className="font-bold text-lg text-white leading-tight">{isNew ? 'New Repository' : 'Edit Repository'}</h3>
                    <p className='text-[10px] text-slate-400 leading-none'>Enter your GitLab repository details below.</p>
                </div>
            </div>
            
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto custom-scrollbar p-6">
                <div className="grid grid-cols-12 gap-x-6 gap-y-6">
                    {/* Section: Basic Info */}
                    <div className="col-span-12">
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4 border-b border-slate-700/50 pb-2">Repository Details</h4>
                    </div>

                    {/* Name */}
                    <div className="col-span-12 md:col-span-6 space-y-1.5">
                        <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Repository Name</label>
                        <input 
                            value={form.name} 
                            onChange={e => setForm({...form, name: e.target.value})} 
                            placeholder="e.g. My Frontend Repo"
                            className="control-field field-surface w-full border rounded-lg px-3 py-2.5 text-sm text-stone-50 outline-none transition-all" 
                            required 
                        />
                    </div>
                    {/* Project ID */}
                    <div className="col-span-12 md:col-span-6 space-y-1.5">
                         <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Project ID</label>
                         <input 
                            value={form.project_id} 
                            onChange={e => setForm({...form, project_id: e.target.value})} 
                            placeholder="e.g. 123456"
                            className="field-surface w-full border rounded-lg px-3 py-2.5 text-sm text-stone-50 outline-none font-mono transition-all" 
                            required 
                        />
                    </div>

                    {/* Section: Connection */}
                    <div className="col-span-12 mt-2">
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4 border-b border-slate-700/50 pb-2">Connection & Auth</h4>
                    </div>

                    {/* URL */}
                    <div className="col-span-12 space-y-1.5">
                         <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">GitLab URL</label>
                         <div className="relative group">
                            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-primary transition-colors" size={16}/>
                            <input 
                                value={form.git_url} 
                                onChange={e => setForm({...form, git_url: e.target.value})} 
                                placeholder="https://gitlab.com/username/project.git"
                                className="field-surface w-full border rounded-lg pl-10 pr-3 py-2.5 text-sm text-stone-50 outline-none font-mono transition-all" 
                                required 
                            />
                         </div>
                    </div>

                    {/* Token */}
                    <div className="col-span-12 md:col-span-6 space-y-1.5">
                        <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Access Token</label>
                        <div className="relative group">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-primary transition-colors" size={16}/>
                            <input 
                                type="password"
                                value={form.git_token} 
                                onChange={e => setForm({...form, git_token: e.target.value})} 
                                placeholder="glpat-xxxxxxxxxxxx"
                                className="field-surface w-full border rounded-lg pl-10 pr-3 py-2.5 text-sm text-stone-50 outline-none font-mono transition-all" 
                                required 
                            />
                        </div>
                    </div>

                    {/* Commit Limit */}
                    <div className="col-span-12 md:col-span-6 space-y-1.5">
                        <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Max Commits (Default: 100)</label>
                        <input 
                            type="number"
                            min="1"
                            max="1000"
                            value={form.commit_limit || 100} 
                            onChange={e => setForm({...form, commit_limit: parseInt(e.target.value) || 100})} 
                            className="field-surface w-full border rounded-lg px-3 py-2.5 text-sm text-stone-50 outline-none font-mono transition-all" 
                        />
                    </div>

                    {/* Branch */}
                    <div className="col-span-12 md:col-span-6 space-y-1.5">
                        <div className="flex justify-between items-center">
                            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Target Branch</label>
                             {/* Small fetch text helper */}
                            {branches.length === 0 && !testResult?.success && (
                                <span className="text-[10px] text-slate-500 flex items-center gap-1">
                                    <AlertCircle size={10} /> Fetch to load
                                </span>
                            )}
                        </div>
                        <div className="field-surface relative group h-[42px] flex rounded-lg border transition-all">
                             <div className="relative flex-1">
                                <GitBranch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-primary transition-colors" size={16}/>
                                <select 
                                    value={form.branch} 
                                    onChange={e => setForm({...form, branch: e.target.value})} 
                                    className="w-full h-full bg-transparent border-none rounded-l-lg pl-10 pr-8 text-sm text-white focus:ring-0 outline-none appearance-none cursor-pointer"
                                >
                                    <option value="main">main</option>
                                    <option value="master">master</option>
                                    <option value="develop">develop</option>
                                    {branches.map(b => (b!=='main' && b!=='master' && b!=='develop') && <option key={b} value={b}>{b}</option>)}
                                </select>
                                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none text-[10px]">▼</div>
                             </div>
                             <button 
                                type="button"
                                onClick={handleTest}
                                disabled={testing}
                                className="px-3 border-l border-slate-700 hover:bg-slate-800 text-slate-400 hover:text-white rounded-r-lg transition-colors flex items-center justify-center"
                                title="Fetch Branches"
                            >
                                {testing ? <RefreshCw size={14} className="animate-spin text-primary"/> : <RefreshCw size={14}/>}
                            </button>
                        </div>
                    </div>
                </div>
                
                 {/* Footer - Sticky Bottom */}
                 <div className="mt-8 pt-6 border-t border-slate-700/50 flex items-center justify-between">
                    {/* Status Indicator (Left) */}
                    <div className="flex items-start gap-3 min-w-0">
                         <div className={`w-2.5 h-2.5 rounded-full transition-all duration-500 ${testResult?.success ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : testResult?.success === false ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]' : 'bg-slate-700'}`} />
                         <div className="min-w-0">
                             <span className="text-xs font-bold text-slate-400">
                                 {testing ? 'Checking connection...' : testResult ? (testResult.success ? 'Ready to Connect' : 'Connection Failed') : 'Not Checked'}
                             </span>
                             {testResult && (
                                <p className={`text-[11px] mt-1 max-w-xl truncate ${testResult.success ? 'text-secondary' : 'text-[#ff9b78]'}`} title={testResult.message}>
                                    {testResult.success 
                                      ? `${testResult.message}${testResult.project_name ? ` · ${testResult.project_name}` : ''}${testResult.default_branch ? ` · default: ${testResult.default_branch}` : ''}`
                                      : testResult.message}
                                </p>
                             )}
                         </div>
                    </div>

                    {/* Buttons (Right) */}
                    <div className="flex gap-3">
                        <button onClick={onClose} type="button" className="action-ghost px-6 py-2.5 text-sm">Cancel</button>
                        <button type="submit" className="action-primary px-6 py-2.5 text-sm active:scale-95">
                            <Save size={16} />
                            Save
                        </button>
                    </div>
                </div>
            </form>
        </div>
    )
}
