import { useState, useEffect } from 'react'
import { Star,  Trash2, Edit2, Plus, Globe, Key, Lock, Save, RefreshCw, ArrowLeft, Copy, Activity } from 'lucide-react'

const API_URL = import.meta.env.VITE_API_URL || '/api'

export default function SettingsTracing({ tracings, activeProfileId, onUpdate }) {
  const [editingItem, setEditingItem] = useState(null)
  const [statuses, setStatuses] = useState({})

  // Auto-test connections
  useEffect(() => {
    tracings.forEach(t => {
        if (!statuses[t.id] && t.langfuse_public_key) {
            testItemConnection(t)
        }
    })
  }, [tracings])

  const testItemConnection = async (item) => {
    setStatuses(prev => ({ ...prev, [item.id]: { loading: true } }))
    try {
        const res = await fetch(`${API_URL}/test/langfuse`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                public_key: item.langfuse_public_key,
                secret_key: item.langfuse_secret_key,
                host: item.langfuse_host
            })
        })
        const result = await res.json()
        setStatuses(prev => ({ ...prev, [item.id]: { loading: false, success: result.success } }))
    } catch (e) {
        setStatuses(prev => ({ ...prev, [item.id]: { loading: false, success: false } }))
    }
  }

  const handleActivate = async (id, e) => {
    e?.stopPropagation()
    await fetch(`${API_URL}/tracings/${id}/activate`, { method: 'PATCH' })
    onUpdate()
  }

  const handleDelete = async (id, e) => {
    e.stopPropagation()
    if (!confirm('Delete this tracing config?')) return
    await fetch(`${API_URL}/tracings/${id}`, { method: 'DELETE' })
    onUpdate()
  }

  const openEditModal = (item = null) => {
    setEditingItem(item || { name: '', langfuse_public_key: '', langfuse_secret_key: '', langfuse_host: 'https://cloud.langfuse.com' })
  }

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text)
  }

  // Helper to simplify URL display
  const simplifyUrl = (url) => {
      try {
          const u = new URL(url)
          return u.hostname
      } catch {
          return url
      }
  }

  // View Switching
  if (editingItem) {
      return (
        <TracingEditForm
            item={editingItem}
            activeProfileId={activeProfileId}
            onClose={() => setEditingItem(null)}
            onSave={() => {
                onUpdate()
                setEditingItem(null)
            }}
        />
      )
  }

  return (
    <div className="flex-1 flex flex-col h-full relative overflow-hidden">
        {/* Table View */}
        <div className="flex-1 flex flex-col p-6 overflow-hidden">
            <div className="flex justify-between items-center mb-6 shrink-0">
                <h2 className="text-xl font-bold text-white">Tracing Configs</h2>
                <button
                    onClick={() => openEditModal()}
                    className="action-primary px-4 py-2 text-sm active:scale-95"
                >
                    <Plus size={16} />
                    <span>Add Tracing</span>
                </button>
            </div>

            <div className="surface-card flex-1 overflow-auto custom-scrollbar rounded-xl">
                <table className="data-table w-full text-left">
                    <thead className="text-xs uppercase font-bold sticky top-0 z-10 backdrop-blur-md">
                        <tr>
                            <th className="px-6 py-3 w-12 text-center">Active</th>
                            <th className="px-6 py-3">Configuration</th>
                            <th className="px-6 py-3">Public Key</th>
                            <th className="px-6 py-3 w-24 text-center">Status</th>
                            <th className="px-6 py-3 w-28 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/50 text-sm md:text-base">
                        {tracings.length === 0 && (
                            <tr>
                                <td colSpan="5" className="py-12 text-center text-slate-500">
                                    <div className="flex flex-col items-center justify-center gap-3">
                                        <div className="w-12 h-12 rounded-full bg-slate-800/50 flex items-center justify-center text-slate-600">
                                            <Activity size={24} />
                                        </div>
                                        <p className="font-medium text-slate-400">No tracing configs found</p>
                                        <p className="text-xs text-slate-500 max-w-xs">Setup Langfuse tracing to monitor your AI application.</p>
                                        <button 
                                            onClick={() => openEditModal()} 
                                            className="mt-2 text-primary text-xs font-bold hover:underline"
                                        >
                                            + Add New Config
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        )}
                        {tracings.map(t => {
                            const st = statuses[t.id] || {}
                            return (
                                <tr key={t.id} className="hover:bg-slate-800/30 transition-colors group">
                                    <td className="px-6 py-4 text-center">
                                        <button
                                            onClick={(e) => handleActivate(t.id, e)}
                                            className={`p-1.5 rounded-full transition-all ${t.is_active ? 'text-yellow-400' : 'text-slate-600 hover:text-slate-400'}`}
                                            title={t.is_active ? "Active Config" : "Set as Active"}
                                        >
                                            <Star size={20} fill={t.is_active ? "currentColor" : "none"} strokeWidth={t.is_active ? 0 : 2} />
                                        </button>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col">
                                            <span className="font-bold text-white text-base leading-tight">{t.name}</span>
                                            <span className="text-[10px] text-slate-500 mt-1 font-mono">{simplifyUrl(t.langfuse_host)}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div 
                                            className="group/key inline-flex items-center gap-2 cursor-pointer bg-slate-800/50 hover:bg-slate-800 px-2.5 py-1 rounded transition-colors border border-slate-700/50 hover:border-slate-600"
                                            onClick={() => copyToClipboard(t.langfuse_public_key)}
                                            title="Click to copy Public Key"
                                        >
                                            <code className="text-slate-400 text-xs font-mono">
                                                {t.langfuse_public_key ? t.langfuse_public_key.substring(0, 8) + '••••••••' : '-'}
                                            </code>
                                            <Copy size={10} className="text-slate-500 opacity-0 group-hover/key:opacity-100 transition-opacity" />
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <div className="flex justify-center group/status relative">
                                            {st.loading && <RefreshCw size={18} className="animate-spin text-slate-500" />}
                                            {!st.loading && st.success === true && <div className="w-3 h-3 bg-green-500 rounded-full shadow-[0_0_8px_rgba(34,197,94,0.6)] ring-2 ring-green-500/20" />}
                                            {!st.loading && st.success === false && <div className="w-3 h-3 bg-red-500 rounded-full shadow-[0_0_8px_rgba(239,68,68,0.6)] ring-2 ring-red-500/20" />}
                                            
                                            {/* Tooltip */}
                                            {!st.loading && (
                                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 translate-y-3 opacity-0 group-hover/status:opacity-100 transition-all pointer-events-none z-10 pt-2">
                                                    <div className="bg-black/90 text-[10px] text-white px-2 py-1 rounded whitespace-nowrap">
                                                        {st.success === true ? "Connected" : "Disconnected"}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center justify-end gap-1 opacity-40 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => openEditModal(t)} className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors" title="Edit">
                                                <Edit2 size={16} />
                                            </button>
                                            <button onClick={(e) => handleDelete(t.id, e)} className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors" title="Delete">
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

function TracingEditForm({ item, activeProfileId, onClose, onSave }) {
    const [form, setForm] = useState({ ...item })
    const [testing, setTesting] = useState(false)
    const [testResult, setTestResult] = useState(null)

    const isNew = !item.id

    const handleTest = async () => {
        setTesting(true)
        setTestResult(null)
        try {
          const res = await fetch(`${API_URL}/test/langfuse`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                public_key: form.langfuse_public_key,
                secret_key: form.langfuse_secret_key,
                host: form.langfuse_host
            })
          })
          const result = await res.json()
          setTestResult(result)
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
                ? `${API_URL}/profiles/${activeProfileId}/tracings`
                : `${API_URL}/tracings/${item.id}`

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form)
            })

            if (res.ok) {
                onSave()
            } else {
                const txt = await res.text()
                alert(`Failed: ${txt}`)
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
                    <h3 className="font-bold text-lg text-white leading-tight">{isNew ? 'New Tracing Config' : 'Edit Tracing Config'}</h3>
                    <p className='text-[10px] text-slate-400 leading-none'>Configure your Langfuse tracing metrics.</p>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto custom-scrollbar p-6">
                <div className="grid grid-cols-12 gap-x-6 gap-y-6">
                    <div className="col-span-12">
                         <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 border-b border-slate-700/50 pb-2">General & Host</h4>
                    </div>

                    {/* Row 1: Name (4) + Host (8) */}
                    <div className="col-span-12 md:col-span-4 space-y-1.5">
                        <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Config Name</label>
                        <input 
                            value={form.name} 
                            onChange={e => setForm({...form, name: e.target.value})} 
                            placeholder="e.g. Langfuse Prod"
                            className="field-surface w-full border rounded-lg px-3 py-2.5 text-sm text-stone-50 outline-none transition-all" 
                            required 
                        />
                    </div>
                    <div className="col-span-12 md:col-span-8 space-y-1.5">
                         <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Langfuse Host</label>
                         <div className="relative group">
                            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-primary transition-colors" size={16}/>
                            <input 
                                value={form.langfuse_host} 
                                onChange={e => setForm({...form, langfuse_host: e.target.value})} 
                                placeholder="https://cloud.langfuse.com"
                                className="field-surface w-full border rounded-lg pl-10 pr-3 py-2.5 text-sm text-stone-50 outline-none font-mono transition-all" 
                                required 
                            />
                         </div>
                    </div>

                    <div className="col-span-12 mt-2">
                         <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 border-b border-slate-700/50 pb-2">Security Keys</h4>
                    </div>

                    {/* Row 2: Public Key (Full Width for Readability) */}
                    <div className="col-span-12 space-y-1.5">
                        <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Public Key</label>
                        <div className="relative group">
                            <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-primary transition-colors" size={16}/>
                            <input 
                                value={form.langfuse_public_key} 
                                onChange={e => setForm({...form, langfuse_public_key: e.target.value})} 
                                placeholder="pk-lf-..."
                                className="field-surface w-full border rounded-lg pl-10 pr-3 py-2.5 text-sm text-stone-50 outline-none font-mono transition-all" 
                                required 
                            />
                        </div>
                    </div>
                    {/* Row 3: Secret Key (Full Width for Readability) */}
                    <div className="col-span-12 space-y-1.5">
                        <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Secret Key</label>
                        <div className="relative group">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-primary transition-colors" size={16}/>
                            <input 
                                type="password"
                                value={form.langfuse_secret_key} 
                                onChange={e => setForm({...form, langfuse_secret_key: e.target.value})} 
                                placeholder="sk-lf-..."
                                className="field-surface w-full border rounded-lg pl-10 pr-3 py-2.5 text-sm text-stone-50 outline-none font-mono transition-all" 
                                required 
                            />
                        </div>
                    </div>
                </div>

                {/* Footer - Sticky Bottom */}
                <div className="mt-8 pt-6 border-t border-slate-700/50 flex items-center justify-between">
                    {/* Status Indicator (Left) */}
                    <div className="flex items-center gap-3">
                         <div className={`w-2.5 h-2.5 rounded-full transition-all duration-500 ${testResult?.success ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : testResult?.success === false ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]' : 'bg-slate-700'}`} />
                         <span className="text-xs font-bold text-slate-400">
                             {testResult ? (testResult.success ? 'Ready to Connect' : 'Connection Failed') : 'Not Checked'}
                         </span>
                    </div>

                    {/* Buttons (Right) */}
                    <div className="flex gap-3">
                        <button 
                            type="button" 
                            onClick={handleTest} 
                            disabled={testing}
                            className="action-ghost px-4 py-2.5 text-sm"
                        >
                             {testing ? <RefreshCw size={14} className="animate-spin"/> : 'Test'}
                        </button>
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
