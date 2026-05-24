import React, { useState, useEffect } from 'react';
import { AlertCircle, Save, RotateCcw, Check, CheckCircle2, History } from 'lucide-react';

// Required variables config
const REQUIRED_VARS = {
  file_analyzer: ["{path}", "{status}", "{additions}", "{deletions}", "{diff}"],
  summary_generator: ["{commit_count}", "{file_count}", "{commit_messages}", "{categorized_summary}"],
  history_commit_analyzer: ["{file_path}", "{commit_message}", "{diff}"],
  history_summary_generator: ["{file_path}", "{history_text}"]
};

const OPTIONAL_VARS = {
  file_analyzer: ["{commit_context}", "{evidence_context}", "{chunk_info}"],
  summary_generator: ["{impact_summary}", "{history_only_files}", "{new_files}", "{deleted_files}", "{modified_files}", "{total_added}", "{total_deleted}"],
  history_commit_analyzer: [],
  history_summary_generator: []
};

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function PromptEditor({ isActive, profileId }) {
  const [prompts, setPrompts] = useState(null);
  const [defaults, setDefaults] = useState(null);
  const [activeTab, setActiveTab] = useState('file_analyzer'); // 'file_analyzer' | 'summary_generator' | 'history_commit_analyzer' | 'history_summary_generator'
  const [mode, setMode] = useState('custom'); // 'default' | 'custom'
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null); // { type: 'success' | 'error', text: '' }

  // Load prompts on mount or tab switching? No, load once.
  useEffect(() => {
    if (isActive && profileId) fetchPrompts();
  }, [isActive, profileId]);

  const fetchPrompts = async () => {
    if (!profileId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/settings/prompts?profile_id=${profileId}`);
      if (res.ok) {
        const data = await res.json();
        // data.current already includes merged defaults from backend
        setPrompts(data.current || {});
        setDefaults(data.default || {});
      } else {
        throw new Error('Failed to load prompts');
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    if (!confirm('정말로 이 프롬프트를 기본값으로 초기화하시겠습니까?')) return;
    
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/settings/prompts/reset?profile_id=${profileId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_name: activeTab })
      });
      
      if (res.ok) {
        const updatedFullPrompts = await res.json();
        // The backend returns the full prompts object for the profile
        setPrompts(updatedFullPrompts); 
        setMessage({ type: 'success', text: '기본값으로 초기화되었습니다.' });
      } else {
        const errData = await res.json();
        throw new Error(errData.detail || 'Reset failed');
      }
    } catch (err) {
       setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!prompts?.[activeTab]) return;
    
    const missing = getMissingVariables();
    if (missing.length > 0) {
      setMessage({ type: 'error', text: `필수 변수가 누락되었습니다: ${missing.join(', ')}` });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/settings/prompts?profile_id=${profileId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prompts)
      });

      if (res.ok) {
        setMessage({ type: 'success', text: '프롬프트가 저장되었습니다!' });
        setTimeout(() => setMessage(null), 3000);
      } else {
        const errData = await res.json();
        throw new Error(errData.detail || 'Save failed');
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (field, value) => {
    setPrompts(prev => ({
      ...prev,
      [activeTab]: {
        ...(prev?.[activeTab] || { system_prompt: '', user_prompt: '' }),
        [field]: value
      }
    }));
  };

  // Helper to insert variable at cursor
  const insertVariable = (variable) => {
    const textarea = document.getElementById('user-prompt-editor');
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = prompts?.[activeTab]?.user_prompt || '';
    
    const newText = text.substring(0, start) + variable + text.substring(end);
    handleChange('user_prompt', newText);
    
    // Defer focus restore
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + variable.length, start + variable.length);
    }, 0);
  };

  // Check required variables
  const getMissingVariables = () => {
    if (!prompts || !prompts[activeTab]) return [];
    const currentText = prompts[activeTab].user_prompt || '';
    const required = REQUIRED_VARS[activeTab] || [];
    return required.filter(v => !currentText.includes(v));
  };
  
  const missingVars = getMissingVariables();
  const currentRequired = REQUIRED_VARS[activeTab] || [];
  const currentOptional = OPTIONAL_VARS[activeTab] || [];
  
  // Display data based on mode
  const displayData = (mode === 'default') 
    ? (defaults?.[activeTab] || { system_prompt: '', user_prompt: '' })
    : (prompts?.[activeTab] || { system_prompt: '', user_prompt: '' });

  if (loading && !prompts) {
    return <div className="p-8 text-center text-slate-500">Loading prompts...</div>;
  }

  return (
    <div className="flex flex-col h-full bg-slate-900 text-slate-200">
      {/* Header & Tabs */}
      <div className="shrink-0 p-6 border-b border-slate-800 flex items-center justify-between">
         <div className="flex gap-1 bg-slate-800/50 p-1 rounded-xl">
             <button 
               onClick={() => setActiveTab('file_analyzer')}
               className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'file_analyzer' ? 'bg-indigo-500/20 text-indigo-400 shadow-sm border border-indigo-500/30' : 'text-slate-400 hover:text-white'}`}
             >
               File Analyzer
             </button>
             <button 
               onClick={() => setActiveTab('summary_generator')}
               className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'summary_generator' ? 'bg-indigo-500/20 text-indigo-400 shadow-sm border border-indigo-500/30' : 'text-slate-400 hover:text-white'}`}
             >
               Summary Generator
             </button>
             <button 
               onClick={() => setActiveTab('history_commit_analyzer')}
               className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'history_commit_analyzer' ? 'bg-indigo-500/20 text-indigo-400 shadow-sm border border-indigo-500/30' : 'text-slate-400 hover:text-white'}`}
             >
               History Commit Analyzer
             </button>
             <button 
               onClick={() => setActiveTab('history_summary_generator')}
               className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'history_summary_generator' ? 'bg-indigo-500/20 text-indigo-400 shadow-sm border border-indigo-500/30' : 'text-slate-400 hover:text-white'}`}
             >
               History Summary Generator
             </button>
         </div>
         
         {/* Mode Toggle */}
         <div className="flex items-center gap-3 bg-slate-800/50 px-3 py-1.5 rounded-lg border border-slate-700/50">
            <span className={`text-xs font-bold ${mode === 'default' ? 'text-white' : 'text-slate-500'}`}>Default</span>
            <button 
               onClick={() => setMode(mode === 'custom' ? 'default' : 'custom')}
               className={`relative w-10 h-5 rounded-full transition-colors ${mode === 'custom' ? 'bg-primary' : 'bg-slate-600'}`}
            >
               <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-transform ${mode === 'custom' ? 'left-6' : 'left-1'}`} />
            </button>
            <span className={`text-xs font-bold ${mode === 'custom' ? 'text-primary' : 'text-slate-500'}`}>Custom</span>
         </div>
      </div>

      {/* Editor Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
         {/* System Prompt */}
         <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
               System Prompt
               <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-500 font-normal">AI Persona & Insturctions</span>
            </label>
            <textarea
               value={displayData.system_prompt}
               onChange={(e) => handleChange('system_prompt', e.target.value)}
               disabled={mode === 'default'}
               className={`w-full h-32 bg-slate-950/50 border rounded-xl p-4 font-mono text-sm leading-relaxed transition-all resize-none focus:ring-1 focus:ring-primary outline-none ${mode === 'default' ? 'border-transparent text-slate-500 cursor-not-allowed' : 'border-slate-800 text-slate-200 focus:border-primary'}`}
               placeholder="Enter system prompt..."
            />
         </div>

         {/* User Prompt */}
         <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
               User Prompt
               <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-500 font-normal">Context & Input Format</span>
            </label>
            <textarea
               id="user-prompt-editor"
               value={displayData.user_prompt}
               onChange={(e) => handleChange('user_prompt', e.target.value)}
               disabled={mode === 'default'}
               className={`w-full h-64 bg-slate-950/50 border rounded-xl p-4 font-mono text-sm leading-relaxed transition-all resize-none focus:ring-1 focus:ring-primary outline-none ${mode === 'default' ? 'border-transparent text-slate-500 cursor-not-allowed' : 'border-slate-800 text-slate-200 focus:border-primary'}`}
               placeholder="Enter user prompt..."
            />
            
            {/* Variable Chips */}
            {mode === 'custom' && (
                <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800/50 space-y-2">
                   <div className="flex items-center gap-2 text-[10px] text-slate-400 uppercase font-bold">
                      Required Variables
                      <div className="h-px bg-slate-700 flex-1"></div>
                   </div>
                   <div className="flex flex-wrap gap-2">
                      {currentRequired.map(v => {
                         const exists = displayData.user_prompt.includes(v);
                         return (
                            <button
                               key={v}
                               onClick={() => insertVariable(v)}
                               title="Click to insert"
                               className={`px-2.5 py-1.5 rounded-md text-xs font-mono font-medium transition-all flex items-center gap-1.5 border ${
                                  exists 
                                  ? 'bg-green-500/10 text-green-400 border-green-500/20 hover:bg-green-500/20' 
                                  : 'bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20 animate-pulse'
                               }`}
                            >
                               {exists ? <Check size={12} /> : <AlertCircle size={12} />}
                               {v}
                            </button>
                         )
                      })}
                   </div>
                    {missingVars.length > 0 && (
                       <p className="text-xs text-red-400 flex items-center gap-1.5 mt-1">
                          <AlertCircle size={12} />
                          Essential variables are missing. Please add them to save.
                       </p>
                    )}
                   {currentOptional.length > 0 && (
                     <>
                       <div className="flex items-center gap-2 text-[10px] text-slate-400 uppercase font-bold pt-2">
                         Optional Evidence Variables
                         <div className="h-px bg-slate-700 flex-1"></div>
                       </div>
                       <div className="flex flex-wrap gap-2">
                         {currentOptional.map(v => {
                           const exists = displayData.user_prompt.includes(v);
                           return (
                             <button
                               key={v}
                               onClick={() => insertVariable(v)}
                               title="Click to insert"
                               className={`px-2.5 py-1.5 rounded-md text-xs font-mono font-medium transition-all flex items-center gap-1.5 border ${
                                 exists
                                   ? 'bg-blue-500/10 text-blue-300 border-blue-500/20 hover:bg-blue-500/20'
                                   : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-slate-200 hover:border-slate-500'
                               }`}
                             >
                               {exists ? <Check size={12} /> : <AlertCircle size={12} />}
                               {v}
                             </button>
                           )
                         })}
                       </div>
                       <p className="text-[11px] text-slate-500">
                         Custom 프롬프트에 <span className="font-mono">{'{evidence_context}'}</span>가 없어도 분석 시 자동 보강되지만, 명시적으로 넣으면 전/후 증빙과 리스크 초안의 위치를 직접 제어할 수 있습니다.
                       </p>
                     </>
                   )}
                 </div>
             )}
         </div>
      </div>

      {/* Footer Actions */}
      {mode === 'custom' && (
          <div className="shrink-0 p-6 border-t border-slate-800 bg-slate-900/50 flex justify-between items-center backdrop-blur-sm">
             <button
                onClick={handleReset}
                disabled={saving}
                className="px-4 py-2.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
             >
                <RotateCcw size={16} />
                Reset to Default
             </button>

             <div className="flex items-center gap-4">
                {message && (
                   <span className={`text-sm ${message.type === 'error' ? 'text-red-400' : 'text-green-400'} animate-fade-in`}>
                      {message.text}
                   </span>
                )}
                <button
                   onClick={handleSave}
                   disabled={saving || missingVars.length > 0}
                   className="px-6 py-2.5 bg-primary hover:bg-primary/90 text-white font-bold text-sm rounded-lg shadow-lg shadow-primary/20 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                   {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={16} />}
                   Save Changes
                </button>
             </div>
          </div>
      )}
    </div>
  );
}

export default PromptEditor;
