import { useState, useEffect } from 'react'
import SettingsRepo from './SettingsRepo'
import SettingsLLM from './SettingsLLM'
import SettingsTracing from './SettingsTracing'
import GitCommandGuide from './settings/GitCommandGuide'
import PromptEditor from './settings/PromptEditor'

const API_URL = import.meta.env.VITE_API_URL || '/api'
const SETTINGS_TABS = [
  { id: 'git', label: 'Repository' },
  { id: 'models', label: 'AI Models' },
  { id: 'tracing', label: 'Tracing' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'git-guide', label: 'Git 명령어' },
]

const SidebarItem = ({ active, label, onClick, onDelete, isActiveStatus }) => (
    <div onClick={onClick} className={`group flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer transition-all border ${active ? 'bg-primary/15 border-primary/40 text-stone-50 shadow-md' : 'border-transparent text-stone-400 hover:bg-primary/10'}`}>
       <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActiveStatus ? 'bg-primary shadow-primary' : 'bg-slate-600'}`} />
       <span className="truncate font-medium text-xs flex-1 text-left">{label}</span>
       {onDelete && <button onClick={onDelete} className="hidden group-hover:block text-slate-500 hover:text-red-400">×</button>}
    </div>
  )

function SettingsModal({ settings, initialTab = 'git', onChanged, onSave, onClose }) {
  const [profiles, setProfiles] = useState([])
  const [activeProfileId, setActiveProfileId] = useState(settings?.id)
  const [profileName, setProfileName] = useState('')
  const [activeTab, setActiveTab] = useState(initialTab)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  
  // Data for the active profile
  const [activeProfileData, setActiveProfileData] = useState(null)

  useEffect(() => {
    fetchProfiles()
  }, [])

  useEffect(() => {
    setActiveTab(initialTab)
  }, [initialTab])

  useEffect(() => {
    if (activeProfileId && profiles.length > 0) {
        updateActiveProfileData()
    }
  }, [activeProfileId, profiles])

  const fetchProfiles = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/profiles`, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setProfiles(data)
        
        if (!activeProfileId && data.length > 0) {
            const active = data.find(p => p.is_active) || data[0]
            setActiveProfileId(active.id)
        }
      } else {
        throw new Error('Failed to fetch profiles')
      }
    } catch (e) {
      console.error('Failed to fetch profiles', e)
      setError('Connection failed')
    } finally {
      setLoading(false)
    }
  }

  const updateActiveProfileData = () => {
    const p = profiles.find(p => p.id === activeProfileId)
    if (p) {
        setProfileName(p.name)
        setActiveProfileData(p)
    }
  }

  const refreshProfilesAndNotify = async () => {
    await fetchProfiles()
    await onChanged?.()
  }

  const handleCreateProfile = async () => {
    const name = prompt('New Profile Name:', `Profile ${profiles.length + 1}`)
    if (!name) return
    try {
      const res = await fetch(`${API_URL}/profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, repositories: [], llm_configs: [], tracing_configs: [] })
      })
      if (res.ok) {
        const newProfile = await res.json()
        await fetchProfiles() 
        setActiveProfileId(newProfile.id)
      }
    } catch(e) { alert('Failed to create profile') }
  }

  const handleActivateProfile = async (id) => {
    try {
      const res = await fetch(`${API_URL}/profiles/${id}/activate`, { method: 'PATCH' })
      if (res.ok) {
        const data = await res.json()
        await fetchProfiles() 
        setActiveProfileId(data.id)
        onSave()
      }
    } catch(e) { alert('Failed to activate profile') }
  }

  const handleDeleteProfile = async (id, e) => {
    e.stopPropagation()
    if (!confirm('Delete this profile?')) return
    await fetch(`${API_URL}/profiles/${id}`, { method: 'DELETE' })
    fetchProfiles()
    if (activeProfileId === id) setActiveProfileId(null)
  }

  const handleUpdateProfileName = async () => {
    if (!activeProfileId) return
    await fetch(`${API_URL}/profiles/${activeProfileId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: profileName })
    })
    fetchProfiles()
  }

  return (
    <div className="warm-scope modal-backdrop fixed inset-0 flex items-center justify-center z-[100] p-4 text-stone-200">
      <div className="modal-shell rounded-[1.75rem] w-full max-w-6xl h-[85vh] max-h-[900px] flex flex-col md:flex-row overflow-hidden">
        
        {/* Profile Sidebar - Slimmer & Cleaner */}
        <div className="w-full md:w-56 max-h-56 md:max-h-none bg-stone-950/50 border-b md:border-b-0 md:border-r border-primary/10 flex flex-col shrink-0 backdrop-blur-md">
          <div className="p-4 border-b border-primary/10 flex items-center gap-3">
             <div className="w-8 h-8 rounded-xl bg-primary/15 border border-primary/20 flex items-center justify-center text-primary">
                ⚙️
             </div>
             <span className="font-bold text-white text-sm tracking-wide">Settings</span>
          </div>
          
          <div className="flex flex-col flex-1 min-h-0 py-3">
              <div className="flex justify-between items-center px-4 mb-2">
                 <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Profiles</span>
                 <button onClick={handleCreateProfile} className="action-ghost p-1 rounded-lg">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                 </button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-0.5 custom-scrollbar px-2">
                 {loading && <div className="text-xs text-slate-500 text-center py-4">Loading...</div>}
                 {!loading && !error && profiles.map(p => (
                    <SidebarItem 
                        key={p.id} 
                        label={p.name} 
                        active={p.id === activeProfileId} 
                        isActiveStatus={p.is_active} 
                        onClick={() => setActiveProfileId(p.id)} 
                        onDelete={(e) => handleDeleteProfile(p.id, e)}  
                    />
                 ))}
              </div>
          </div>
        </div>

        {/* Main Content Area - Maximized */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-stone-950/20 relative">
           {/* Header */}
           <div className="modal-header px-6 py-5 shrink-0 flex justify-between items-start gap-4">
              <div className="space-y-3 w-full max-w-2xl min-w-0">
                 <div className="flex items-center gap-3 min-w-0">
                    <input 
                        value={profileName} 
                        onChange={e=>setProfileName(e.target.value)} 
                        onBlur={handleUpdateProfileName} 
                        className="bg-transparent text-xl font-bold text-stone-50 border-none focus:ring-0 px-0 placeholder-stone-600 p-0 m-0 leading-none w-auto min-w-[150px] max-w-full truncate" 
                        placeholder="Untitled Profile"
                    />
                    <div className="h-4 w-px bg-primary/20 mx-1"></div>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${activeProfileData?.is_active ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-slate-800 border-slate-700 text-slate-500'}`}>
                        {activeProfileData?.is_active ? 'Active' : 'Inactive'}
                    </span>
                    {!activeProfileData?.is_active && activeProfileId && (
                        <button onClick={() => handleActivateProfile(activeProfileId)} className="text-[10px] text-primary hover:underline font-bold transition-all">
                            Set as Active
                        </button>
                    )}
                 </div>

                 {/* Tabs integrated into Header bottom */}
                 <div className="flex gap-6 pt-1 overflow-x-auto custom-scrollbar">
                    {SETTINGS_TABS.map(tab => (
                        <button key={tab.id} onClick={()=>setActiveTab(tab.id)} className={`shrink-0 pb-1 text-sm font-bold relative transition-colors ${activeTab === tab.id ? 'text-stone-50' : 'text-stone-500 hover:text-stone-300'}`}>
                        {tab.label}
                        {activeTab === tab.id && <div className="absolute -bottom-[21px] left-0 right-0 h-[3px] bg-primary shadow-[0_0_12px_rgba(242,169,59,0.42)] rounded-t-full" />}
                        </button>
                    ))}
                 </div>
              </div>

              <button onClick={onClose} className="action-ghost p-2 shrink-0">
                <span className="sr-only">Close</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
             </button>
           </div>

           {/* Tab Content - Expanded Area */}
           <div className="flex-1 overflow-hidden flex flex-col relative p-0 min-w-0">
              {activeTab === 'git-guide' ? (
                  <GitCommandGuide />
              ) : !activeProfileId ? (
                  <div className="m-auto text-slate-500 flex flex-col items-center gap-4">
                      <div className="text-4xl opacity-50">📂</div>
                      <p className="text-sm">Select a profile to configure.</p>
                  </div> 
              ) : (
                  <>
                    {activeTab === 'git' && (
                        <SettingsRepo 
                            repos={activeProfileData?.repositories || []} 
                            activeProfileId={activeProfileId}
                            onUpdate={refreshProfilesAndNotify} 
                        />
                    )}
                    {activeTab === 'models' && (
                        <SettingsLLM 
                            llms={activeProfileData?.llm_configs || []} 
                            activeProfileId={activeProfileId}
                            onUpdate={refreshProfilesAndNotify} 
                        />
                    )}
                    {activeTab === 'tracing' && (
                        <SettingsTracing 
                            tracings={activeProfileData?.tracing_configs || []} 
                            activeProfileId={activeProfileId}
                            onUpdate={refreshProfilesAndNotify} 
                        />
                    )}
                    {activeTab === 'prompts' && (
                        <PromptEditor 
                            isActive={activeTab === 'prompts'} 
                            profileId={activeProfileId}
                        />
                    )}
                  </>
              )}
           </div>
           
           {/* Footer REMOVED per user request for consolidation. Actions are now inside sub-components. */}
        </div>
      </div>
    </div>
  )
}

export default SettingsModal
