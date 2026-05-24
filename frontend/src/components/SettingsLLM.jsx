import { useState, useEffect } from 'react'
import { Star,  Trash2, Edit2, Plus, Globe, Key, Cpu, Save, RefreshCw, Server, ArrowLeft } from 'lucide-react'

const API_URL = import.meta.env.VITE_API_URL || '/api'

export default function SettingsLLM({ llms, activeProfileId, onUpdate }) {
  const [editingItem, setEditingItem] = useState(null)
  const [statuses, setStatuses] = useState({})

  // Auto-test connections
  useEffect(() => {
    llms.forEach(llm => {
        if (!statuses[llm.id] && llm.openai_api_key) {
            testItemConnection(llm)
        }
    })
  }, [llms])

  const testItemConnection = async (llm) => {
    setStatuses(prev => ({ ...prev, [llm.id]: { loading: true } }))
    try {
        const res = await fetch(`${API_URL}/test/openai`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                openai_api_key: llm.openai_api_key, 
                openai_base_url: llm.openai_base_url, 
                openai_model: llm.openai_model
            })
        })
        const result = await res.json()
        setStatuses(prev => ({ ...prev, [llm.id]: { loading: false, success: result.success } }))
    } catch (e) {
        setStatuses(prev => ({ ...prev, [llm.id]: { loading: false, success: false } }))
    }
  }

  const handleActivate = async (id, e) => {
    e?.stopPropagation()
    await fetch(`${API_URL}/llms/${id}/activate`, { method: 'PATCH' })
    onUpdate()
  }

  const handleDelete = async (id, e) => {
    e.stopPropagation()
    if (!confirm('Delete this model config?')) return
    await fetch(`${API_URL}/llms/${id}`, { method: 'DELETE' })
    onUpdate()
  }

  const openEditModal = (item = null) => {
     // initialize temperature with 0.7 default
     setEditingItem(item || { name: '', openai_api_key: '', openai_base_url: '', openai_model: '', temperature: 0.7, is_active: false })
  }

  // Icons Helper
  const getProviderIcon = (url) => {
      if (!url) return <Edit2 size={16} className="text-slate-400" />
      if (url.includes('api.openai.com')) return <Globe size={16} className="text-green-400" />
      if (url.includes('localhost:11434')) return <Server size={16} className="text-orange-400" />
      if (url.includes('vllm') || url.includes(':8000')) return <Cpu size={16} className="text-blue-400" />
      return <Edit2 size={16} className="text-slate-400" />
  }

  // Provider Name Helper
  const getProviderName = (url) => {
      if (!url) return 'Custom'
      if (url.includes('api.openai.com')) return 'OpenAI'
      if (url.includes('localhost:11434')) return 'Ollama'
      if (url.includes('vllm') || url.includes(':8000')) return 'vLLM'
      return 'Custom'
  }

  // View Switching
  if (editingItem) {
      return (
        <LLMEditForm 
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
        <div className="flex-1 flex flex-col p-6 overflow-hidden">
            <div className="flex justify-between items-center mb-6 shrink-0">
                <h2 className="text-xl font-bold text-white">AI Models</h2>
                <button 
                    onClick={() => openEditModal()} 
                    className="action-primary px-4 py-2 text-sm active:scale-95"
                >
                    <Plus size={16} />
                    <span>Add Model</span>
                </button>
            </div>

            <div className="surface-card flex-1 overflow-auto custom-scrollbar rounded-xl">
                <table className="data-table w-full text-left">
                    <thead className="text-xs uppercase font-bold sticky top-0 z-10 backdrop-blur-md">
                        <tr>
                            <th className="px-6 py-3 w-12 text-center">Active</th>
                            <th className="px-6 py-3">Configuration</th>
                            <th className="px-6 py-3">Provider</th>
                            <th className="px-6 py-3">Model</th>
                            <th className="px-6 py-3 w-24 text-center">Status</th>
                            <th className="px-6 py-3 w-28 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/50 text-sm md:text-base">
                        {llms.length === 0 && (
                            <tr>
                                <td colSpan="6" className="py-12 text-center text-slate-500">
                                     <div className="flex flex-col items-center justify-center gap-3">
                                        <div className="w-12 h-12 rounded-full bg-slate-800/50 flex items-center justify-center text-slate-600">
                                            <Cpu size={24} />
                                        </div>
                                        <p className="font-medium text-slate-400">No AI models configured</p>
                                        <p className="text-xs text-slate-500 max-w-xs">Add an OpenAI, Ollama, or custom model to generate code.</p>
                                        <button 
                                            onClick={() => openEditModal()} 
                                            className="mt-2 text-primary text-xs font-bold hover:underline"
                                        >
                                            + Add New Model
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        )}
                        {llms.map(l => {
                            const st = statuses[l.id] || {}
                            return (
                                <tr key={l.id} className="hover:bg-slate-800/30 transition-colors group">
                                    <td className="px-6 py-4 text-center">
                                        <button 
                                            onClick={(e) => handleActivate(l.id, e)}
                                            className={`p-1.5 rounded-full transition-all ${l.is_active ? 'text-yellow-400' : 'text-slate-600 hover:text-slate-400'}`}
                                            title={l.is_active ? "Active Model" : "Set as Active"}
                                        >
                                            <Star size={20} fill={l.is_active ? "currentColor" : "none"} strokeWidth={l.is_active ? 0 : 2} />
                                        </button>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col">
                                            <span className="font-bold text-white text-sm leading-tight">{l.name}</span>
                                            <span className="text-[10px] text-slate-500 font-mono truncate max-w-[180px] leading-tight mt-0.5">{l.openai_base_url}</span>
                                        </div>
                                    </td>
                                    {/* New Provider Column */}
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2">
                                             <div className="w-6 h-6 rounded bg-slate-800 border border-slate-700/50 flex items-center justify-center shrink-0">
                                                 {getProviderIcon(l.openai_base_url)}
                                             </div>
                                             <span className="text-xs font-medium text-slate-300">{getProviderName(l.openai_base_url)}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-800 border border-slate-700 text-slate-300 font-mono">
                                            {l.openai_model}
                                        </span>
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
                                                        {st.success === true ? "Working" : "Error"}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center justify-end gap-1 opacity-40 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => openEditModal(l)} className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors" title="Edit">
                                                <Edit2 size={16} />
                                            </button>
                                            <button onClick={(e) => handleDelete(l.id, e)} className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors" title="Delete">
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

function LLMEditForm({ item, activeProfileId, onClose, onSave }) {
    const detectProvider = (url) => {
        if (!url) return 'openai'
        if (url.includes('api.openai.com')) return 'openai'
        if (url.includes('localhost:11434')) return 'ollama'
        if (url.includes('vllm') || url.includes(':8000')) return 'vllm'
        return 'custom'
    }

    const [form, setForm] = useState({ 
        ...item, 
        temperature: item.temperature !== undefined ? item.temperature : 0.7 
    })
    const [provider, setProvider] = useState(detectProvider(item.openai_base_url))
    const [testing, setTesting] = useState(false)
    const [testResult, setTestResult] = useState(null)

    const isNew = !item.id

    const PROVIDERS = [
        { id: 'openai', name: 'OpenAI', icon: Globe, defaultUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o' },
        { id: 'ollama', name: 'Ollama', icon: Server, defaultUrl: 'http://localhost:11434/v1', defaultModel: 'llama3' },
        { id: 'vllm', name: 'vLLM', icon: Cpu, defaultUrl: 'http://localhost:8000/v1', defaultModel: 'meta-llama/Llama-2-7b-chat-hf' },
        { id: 'custom', name: 'Custom', icon: Edit2, defaultUrl: '', defaultModel: '' }
    ]

    const handleProviderChange = (newProviderId) => {
        setProvider(newProviderId)
        const prov = PROVIDERS.find(p => p.id === newProviderId)
        if (prov && newProviderId !== 'custom') {
            setForm(prev => ({
                ...prev,
                openai_base_url: prov.defaultUrl,
                openai_model: prov.defaultModel,
                name: prev.name || (newProviderId === 'openai' ? 'OpenAI GPT-4' : newProviderId === 'ollama' ? 'Local LLaMA' : '')
            }))
        }
    }

    const handleTest = async () => {
        setTesting(true)
        setTestResult(null)
        try {
          const res = await fetch(`${API_URL}/test/openai`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                openai_api_key: form.openai_api_key, 
                openai_base_url: form.openai_base_url, 
                openai_model: form.openai_model
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
                ? `${API_URL}/profiles/${activeProfileId}/llms` 
                : `${API_URL}/llms/${item.id}`
            
            // Allow temperature in body
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
                    <h3 className="font-bold text-lg text-white leading-tight">{isNew ? 'New Model Config' : 'Edit Model Config'}</h3>
                    <p className='text-[10px] text-slate-400 leading-none'>Select a provider or configure a custom endpoint.</p>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto custom-scrollbar p-6">
                 {/* Provider Select Group */}
                <div className="mb-8">
                     <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Model Provider</h4>
                     <div className="surface-card p-1.5 rounded-xl flex gap-1 shrink-0">
                        {PROVIDERS.map(p => (
                            <button
                                key={p.id}
                                type="button"
                                onClick={() => handleProviderChange(p.id)}
                                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold transition-all relative overflow-hidden ${provider === p.id ? 'bg-primary text-stone-950 shadow-lg shadow-primary/20' : 'text-stone-500 hover:text-stone-300 hover:bg-primary/10'}`}
                            >
                                <p.icon size={14} className={provider === p.id ? 'text-white' : 'currentColor'} />
                                <span>{p.name}</span>
                                {/* Provider Active Indicator Dot (Optional)  */}
                                {provider === p.id && <div className="absolute inset-0 bg-gradient-to-tr from-white/20 to-transparent pointer-events-none" />}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Form Fields - Grid Layout */}
                <div className="grid grid-cols-12 gap-x-6 gap-y-6">
                     <div className="col-span-12">
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 border-b border-slate-700/50 pb-2">Configuration Details</h4>
                     </div>

                    {/* Name (4) + Base URL (8) */}
                    <div className="col-span-12 md:col-span-4 space-y-1.5">
                        <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Config Name</label>
                        <input 
                            value={form.name} 
                            onChange={e => setForm({...form, name: e.target.value})} 
                            placeholder="e.g. My GPT-4"
                            className="field-surface w-full border rounded-lg px-3 py-2.5 text-sm text-stone-50 outline-none transition-all" 
                            required 
                        />
                    </div>
                    <div className="col-span-12 md:col-span-8 space-y-1.5">
                         <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Base URL</label>
                         <div className="relative group">
                            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-primary transition-colors" size={16}/>
                            <input 
                                value={form.openai_base_url} 
                                onChange={e => setForm({...form, openai_base_url: e.target.value})} 
                                placeholder="https://api.openai.com/v1"
                                className="field-surface w-full border rounded-lg pl-10 pr-3 py-2.5 text-sm text-stone-50 outline-none font-mono transition-all" 
                            />
                         </div>
                    </div>

                    {/* Model (4) + API Key (8) */}
                    <div className="col-span-12 md:col-span-4 space-y-1.5">
                         <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Model Name</label>
                         <div className="relative group">
                            <Cpu className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-primary transition-colors" size={16}/>
                            <input 
                                value={form.openai_model} 
                                onChange={e => setForm({...form, openai_model: e.target.value})} 
                                placeholder="e.g. gpt-4o, llama3"
                                className="field-surface w-full border rounded-lg pl-10 pr-3 py-2.5 text-sm text-stone-50 outline-none font-mono transition-all" 
                            />
                        </div>
                    </div>
                    <div className="col-span-12 md:col-span-8 space-y-1.5">
                        <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">API Key</label>
                        <div className="relative group">
                            <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-primary transition-colors" size={16}/>
                            <input 
                                type="password"
                                value={form.openai_api_key} 
                                onChange={e => setForm({...form, openai_api_key: e.target.value})} 
                                placeholder="sk-..."
                                className="field-surface w-full border rounded-lg pl-10 pr-3 py-2.5 text-sm text-stone-50 outline-none font-mono transition-all" 
                            />
                        </div>
                    </div>

                    {/* Advanced Parameters section added here */}
                     <div className="col-span-12 mt-4">
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 border-b border-slate-700/50 pb-2">Advanced Parameters</h4>
                     </div>
                    
                    {/* Temperature Control */}
                    <div className="surface-card col-span-12 space-y-3 p-4 rounded-xl">
                        <div className="flex justify-between items-center">
                            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                                Temperature
                                <span className="text-[10px] normal-case font-normal text-slate-500">(Creativity)</span>
                            </label>
                            <span className="text-sm font-bold text-primary px-2 py-0.5 bg-primary/10 rounded">{form.temperature}</span>
                        </div>
                        <input 
                            type="range" 
                            min="0" 
                            max="2" 
                            step="0.1"
                            value={form.temperature} 
                            onChange={e => setForm({...form, temperature: parseFloat(e.target.value)})}
                            className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-primary hover:accent-primary/80" 
                        />
                        <div className="flex justify-between text-[10px] text-slate-600 font-mono">
                            <span>0.0 (Precise)</span>
                            <span>1.0 (Balanced)</span>
                            <span>2.0 (Creative)</span>
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
