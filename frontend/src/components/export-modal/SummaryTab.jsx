import { useEffect, useMemo, useState } from 'react'
import { BarChart3, ChevronDown, ChevronUp, Download, Plus, RefreshCw, Settings, Trash2 } from 'lucide-react'
import AiMarkdown from '../AiMarkdown'
import { runBackgroundJob } from './exportJobUtils'
import { BatchSizeControl, SummaryRunStatus } from './SummaryControls'
import { FLAT_TEMPLATES, PREDEFINED_SUMMARY_TYPES } from './summaryTemplates'

export default function SummaryTab({ files, settings }) {
  const [selectedType, setSelectedType] = useState('risk_analysis')
  const [batchSize, setBatchSize] = useState(4)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [cacheNotice, setCacheNotice] = useState(null)
  
  const [outputMode, setOutputMode] = useState('json')
  
  const [flatTemplate, setFlatTemplate] = useState('risk_classification')
  const [flatResult, setFlatResult] = useState(null)
  
  const [editableFlatConfig, setEditableFlatConfig] = useState(null)
  const [showFlatEditor, setShowFlatEditor] = useState(false)
  
  const [sampleLoading, setSampleLoading] = useState(false)
  const [sampleResult, setSampleResult] = useState(null)
  const [sampleSize, setSampleSize] = useState(3)
  
  const [editableGroups, setEditableGroups] = useState(
    JSON.parse(JSON.stringify(PREDEFINED_SUMMARY_TYPES.risk_analysis.groups))
  )
  const [showGroupEditor, setShowGroupEditor] = useState(false)
  const [newKeyName, setNewKeyName] = useState({})
  const [newKeyDesc, setNewKeyDesc] = useState({})
  const [editingKey, setEditingKey] = useState(null) // {groupIdx, keyIdx} 형태로 편집 중인 키

  const handleFlatTemplateSelect = (templateKey) => {
    setFlatTemplate(templateKey)
    if (templateKey === 'custom') {
      setEditableFlatConfig({
        category: { name: '분류', values: ['값1', '값2', '값3'] },
        columns: [
          { name: '요약', description: '해당 분류의 요약 내용' },
          { name: '해당 파일', description: '이 분류에 해당하는 파일 목록' }
        ]
      })
    } else {
      const template = FLAT_TEMPLATES[templateKey]
      setEditableFlatConfig({
        category: { ...template.category },
        columns: template.columns.map(c => ({ ...c }))
      })
    }
    setShowFlatEditor(true)
    setSampleResult(null)
  }

  const updateFlatCategoryName = (name) => {
    if (!editableFlatConfig) return
    setEditableFlatConfig({
      ...editableFlatConfig,
      category: { ...editableFlatConfig.category, name }
    })
  }

  const addFlatCategoryValue = () => {
    if (!editableFlatConfig) return
    setEditableFlatConfig({
      ...editableFlatConfig,
      category: {
        ...editableFlatConfig.category,
        values: [...editableFlatConfig.category.values, '']
      }
    })
  }

  const removeFlatCategoryValue = (idx) => {
    if (!editableFlatConfig) return
    setEditableFlatConfig({
      ...editableFlatConfig,
      category: {
        ...editableFlatConfig.category,
        values: editableFlatConfig.category.values.filter((_, i) => i !== idx)
      }
    })
  }

  const updateFlatCategoryValue = (idx, value) => {
    if (!editableFlatConfig) return
    const newValues = [...editableFlatConfig.category.values]
    newValues[idx] = value
    setEditableFlatConfig({
      ...editableFlatConfig,
      category: { ...editableFlatConfig.category, values: newValues }
    })
  }

  const addFlatColumn = () => {
    if (!editableFlatConfig) return
    setEditableFlatConfig({
      ...editableFlatConfig,
      columns: [...editableFlatConfig.columns, { name: '', description: '' }]
    })
  }

  const removeFlatColumn = (idx) => {
    if (!editableFlatConfig) return
    setEditableFlatConfig({
      ...editableFlatConfig,
      columns: editableFlatConfig.columns.filter((_, i) => i !== idx)
    })
  }

  const updateFlatColumn = (idx, field, value) => {
    if (!editableFlatConfig) return
    const newColumns = [...editableFlatConfig.columns]
    newColumns[idx][field] = value
    setEditableFlatConfig({ ...editableFlatConfig, columns: newColumns })
  }

  const updateFlatCategoryValues = (values) => {
    if (!editableFlatConfig) return
    setEditableFlatConfig({
      ...editableFlatConfig,
      category: { ...editableFlatConfig.category, values }
    })
  }

  const handleTypeSelect = (typeKey) => {
    setSelectedType(typeKey)
    if (typeKey === 'custom') {
      setEditableGroups([{ 
        name: '새 그룹', 
        description: '',
        keys: [{ name: '항목1', description: '이 키에서 추출할 내용 설명' }] 
      }])
    } else if (PREDEFINED_SUMMARY_TYPES[typeKey]) {
      setEditableGroups(JSON.parse(JSON.stringify(PREDEFINED_SUMMARY_TYPES[typeKey].groups)))
    }
    setShowGroupEditor(true)
    setNewKeyName({})
    setNewKeyDesc({})
    setEditingKey(null)
  }

  const addGroup = () => {
    setEditableGroups([...editableGroups, { name: '새 그룹', description: '', keys: [] }])
  }

  const removeGroup = (idx) => {
    setEditableGroups(editableGroups.filter((_, i) => i !== idx))
  }

  const updateGroup = (idx, field, value) => {
    const newGroups = [...editableGroups]
    newGroups[idx][field] = value
    setEditableGroups(newGroups)
  }

  const addKeyToGroup = (groupIdx) => {
    const keyName = newKeyName[groupIdx]?.trim()
    if (!keyName) return
    
    const newGroups = [...editableGroups]
    const keyDesc = newKeyDesc[groupIdx]?.trim() || ''
    
    if (!newGroups[groupIdx].keys.some(k => k.name === keyName)) {
      newGroups[groupIdx].keys = [...newGroups[groupIdx].keys, { name: keyName, description: keyDesc }]
      setEditableGroups(newGroups)
    }
    setNewKeyName({ ...newKeyName, [groupIdx]: '' })
    setNewKeyDesc({ ...newKeyDesc, [groupIdx]: '' })
  }

  const removeKeyFromGroup = (groupIdx, keyIdx) => {
    const newGroups = [...editableGroups]
    newGroups[groupIdx].keys = newGroups[groupIdx].keys.filter((_, i) => i !== keyIdx)
    setEditableGroups(newGroups)
    if (editingKey?.groupIdx === groupIdx && editingKey?.keyIdx === keyIdx) {
      setEditingKey(null)
    }
  }

  const updateKeyDescription = (groupIdx, keyIdx, desc) => {
    const newGroups = [...editableGroups]
    newGroups[groupIdx].keys[keyIdx].description = desc
    setEditableGroups(newGroups)
  }

  const runSummary = async () => {
    if (editableGroups.length === 0 || editableGroups.every(g => g.keys.length === 0)) {
      setError('최소 하나의 그룹에 키를 정의해주세요.')
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)
    setCacheNotice(null)
    setProgress({ message: '분석 준비 중...', percent: 0 })

    try {
      const data = await runBackgroundJob('/api/jobs/export/batch-summary-stream', {
        files: files.map(f => ({
          path: f.path,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          ai_summary: f.ai_summary || ''
        })),
        summary_type: 'custom',
        batch_size: batchSize,
        custom_groups: editableGroups,
        openai_api_key: settings.openaiApiKey,
        openai_base_url: settings.openaiBaseUrl,
        openai_model: settings.openaiModel,
        langfuse_public_key: settings.langfusePublicKey,
        langfuse_secret_key: settings.langfuseSecretKey,
        langfuse_host: settings.langfuseHost
      }, (next) => {
        setProgress(prev => ({ ...(prev || {}), ...next, thinking: null }))
        if (next.cacheHit) {
          setCacheNotice({
            message: '동일 조건 결과를 캐시에서 재사용했습니다.',
            cacheKey: next.cacheKey,
            hits: next.hits,
          })
        }
      })
      if (data?.data) {
        setResult(data.data)
      } else {
        setResult(data)
      }

    } catch (e) {
      setError(`실패: ${e.message}`)
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }

  const downloadJson = () => {
    if (!result && !flatResult) return

    const data = outputMode === 'flat' ? flatResult : result
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `export-summary-${outputMode === 'flat' ? flatTemplate : selectedType}-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const runSampleTest = async () => {
    setSampleLoading(true)
    setSampleResult(null)
    setError(null)

    const sampleFiles = [...files]
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.min(sampleSize, files.length))

    try {
      const endpoint = outputMode === 'flat' 
        ? '/api/jobs/export/flat-summary'
        : '/api/jobs/export/batch-summary'

      const body = outputMode === 'flat'
        ? {
            files: sampleFiles.map(f => ({
              path: f.path,
              status: f.status,
              additions: f.additions,
              deletions: f.deletions,
              ai_summary: f.ai_summary || ''
            })),
            template_type: flatTemplate,
            batch_size: Math.min(batchSize, sampleFiles.length),
            custom_config: editableFlatConfig ? {
              category: editableFlatConfig.category,
              columns: editableFlatConfig.columns
            } : null,
            openai_api_key: settings.openaiApiKey,
            openai_base_url: settings.openaiBaseUrl,
            openai_model: settings.openaiModel
          }
        : {
            files: sampleFiles.map(f => ({
              path: f.path,
              status: f.status,
              additions: f.additions,
              deletions: f.deletions,
              ai_summary: f.ai_summary || ''
            })),
            summary_type: 'custom',
            batch_size: Math.min(batchSize, sampleFiles.length),
            custom_groups: editableGroups,
            openai_api_key: settings.openaiApiKey,
            openai_base_url: settings.openaiBaseUrl,
            openai_model: settings.openaiModel
          }

      const data = await runBackgroundJob(endpoint, body, setProgress)
      setSampleResult({ ...data, sampled_files: sampleFiles.map(f => f.path) })
    } catch (e) {
      setError(`네트워크 오류: ${e.message}`)
    } finally {
      setSampleLoading(false)
    }
  }

  const runFlatSummary = async () => {
    setLoading(true)
    setError(null)
    setFlatResult(null)
    setCacheNotice(null)
    setProgress({ message: '분석 시작 중...', percent: 0 })

    try {
      const data = await runBackgroundJob('/api/jobs/export/flat-summary-stream', {
        files: files.map(f => ({
          path: f.path,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          ai_summary: f.ai_summary || ''
        })),
        template_type: flatTemplate,
        batch_size: batchSize,
        custom_config: editableFlatConfig ? {
          category: editableFlatConfig.category,
          columns: editableFlatConfig.columns
        } : null,
        openai_api_key: settings.openaiApiKey,
        openai_base_url: settings.openaiBaseUrl,
        openai_model: settings.openaiModel,
        langfuse_public_key: settings.langfusePublicKey,
        langfuse_secret_key: settings.langfuseSecretKey,
        langfuse_host: settings.langfuseHost
      }, (next) => {
        setProgress(next)
        if (next.cacheHit) {
          setCacheNotice({
            message: '동일 조건 결과를 캐시에서 재사용했습니다.',
            cacheKey: next.cacheKey,
            hits: next.hits,
          })
        }
      })
      setFlatResult(data?.data || data)
    } catch (e) {
      setError(`실패: ${e.message}`)
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }

  const downloadCsv = () => {
    if (!flatResult?.table || flatResult.table.length === 0) return

    const category = flatResult.category?.name || '카테고리'
    const columns = flatResult.columns?.map(c => c.name) || []
    const headers = [category, ...columns]

    const rows = flatResult.table.map(row => {
      return headers.map(h => {
        const val = row[h] || ''
        return `"${String(val).replace(/"/g, '""')}"`
      }).join(',')
    })

    const csv = [headers.join(','), ...rows].join('\n')
    const bom = '\uFEFF' // UTF-8 BOM for Excel
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `export-flat-${flatTemplate}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const currentTypeInfo = PREDEFINED_SUMMARY_TYPES[selectedType] || { 
    name: '커스텀', 
    icon: '🔧', 
    description: '사용자 정의 그룹/키로 요약' 
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-xl border border-slate-700">
        <div>
          <h3 className="font-medium">출력 형식</h3>
          <p className="text-xs text-slate-400 mt-1">
            {outputMode === 'json' 
              ? '계층적 JSON - 그룹별로 상세 정보 출력' 
              : 'FLAT 테이블 - 카테고리당 1행, Excel 다운 가능'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setOutputMode('json'); setSampleResult(null); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              outputMode === 'json'
                ? 'bg-primary text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            📊 계층적 JSON
          </button>
          <button
            onClick={() => { setOutputMode('flat'); setSampleResult(null); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              outputMode === 'flat'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            📋 FLAT 테이블
          </button>
        </div>
      </div>

      {outputMode === 'flat' && (
        <div className="space-y-4">
          <h3 className="text-md font-medium flex items-center gap-2">
            📋 FLAT 템플릿 선택
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(FLAT_TEMPLATES).map(([key, info]) => (
              <button
                key={key}
                onClick={() => handleFlatTemplateSelect(key)}
                className={`flex items-start gap-3 p-4 rounded-xl border transition-all text-left ${
                  flatTemplate === key
                    ? 'border-emerald-500 bg-emerald-500/10'
                    : 'border-slate-700 hover:border-slate-600 bg-slate-800/50'
                }`}
              >
                <span className="text-2xl">{info.icon}</span>
                <div>
                  <div className="font-medium">{info.name}</div>
                  <div className="text-xs text-slate-400 mt-1">{info.description}</div>
                  <div className="text-xs text-emerald-400 mt-2">
                    {info.category.values.join(' / ')}
                  </div>
                </div>
              </button>
            ))}

            <button
              onClick={() => handleFlatTemplateSelect('custom')}
              className={`flex items-start gap-3 p-4 rounded-xl border transition-all text-left ${
                flatTemplate === 'custom'
                  ? 'border-emerald-500 bg-emerald-500/10'
                  : 'border-slate-700 hover:border-slate-600 bg-slate-800/50'
              }`}
            >
              <span className="text-2xl">🔧</span>
              <div>
                <div className="font-medium">커스텀</div>
                <div className="text-xs text-slate-400 mt-1">직접 카테고리와 컬럼을 정의</div>
                <div className="text-xs text-emerald-400 mt-2">
                  사용자 정의
                </div>
              </div>
            </button>
          </div>
        </div>
      )}

      {outputMode === 'flat' && showFlatEditor && editableFlatConfig && (
        <div className="space-y-4 p-4 bg-slate-800/50 rounded-xl border border-slate-700">
          <div className="flex items-center justify-between">
            <h4 className="font-medium flex items-center gap-2">
              <span>{FLAT_TEMPLATES[flatTemplate]?.icon}</span>
              {FLAT_TEMPLATES[flatTemplate]?.name} - 추출 컬럼 설정
            </h4>
            <button
              onClick={addFlatColumn}
              className="flex items-center gap-1 px-3 py-1 bg-emerald-600/20 text-emerald-400 rounded-lg text-sm hover:bg-emerald-600/30 transition-colors"
            >
              <Plus size={14} />
              컬럼 추가
            </button>
          </div>

          <div className="p-3 bg-slate-900/50 rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs text-slate-400">카테고리 (행 구분)</div>
              <button
                onClick={addFlatCategoryValue}
                className="flex items-center gap-1 px-2 py-1 bg-emerald-600/20 text-emerald-400 rounded text-xs hover:bg-emerald-600/30 transition-colors"
              >
                <Plus size={12} />
                값 추가
              </button>
            </div>
            
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 w-16">이름:</span>
              <input
                type="text"
                value={editableFlatConfig.category.name}
                onChange={(e) => updateFlatCategoryName(e.target.value)}
                className="flex-1 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                placeholder="카테고리명"
              />
            </div>

            <div className="space-y-2">
              <span className="text-xs text-slate-400">가능한 값들:</span>
              <div className="flex flex-wrap gap-2">
                {editableFlatConfig.category.values.map((v, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <input
                      type="text"
                      value={v}
                      onChange={(e) => updateFlatCategoryValue(i, e.target.value)}
                      className="w-24 px-2 py-1 bg-slate-800 border border-emerald-600/50 rounded text-sm text-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                      placeholder="값"
                    />
                    {editableFlatConfig.category.values.length > 1 && (
                      <button
                        onClick={() => removeFlatCategoryValue(i)}
                        className="p-1 hover:bg-red-500/20 text-red-400 rounded transition-colors"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs text-slate-400">추출할 컬럼 (열)</div>
            {editableFlatConfig.columns.map((col, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="컬럼명"
                  value={col.name}
                  onChange={(e) => updateFlatColumn(idx, 'name', e.target.value)}
                  className="w-1/4 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                />
                <input
                  type="text"
                  placeholder="설명 (추출 지침)"
                  value={col.description}
                  onChange={(e) => updateFlatColumn(idx, 'description', e.target.value)}
                  className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                />
                <button
                  onClick={() => removeFlatColumn(idx)}
                  className="p-2 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
          </div>

          <div className="p-3 bg-slate-900/50 rounded-lg">
            <div className="text-xs text-slate-400 mb-2">출력 테이블 미리보기</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-800">
                    <th className="border border-slate-700 px-2 py-1 text-emerald-400">
                      {editableFlatConfig.category.name}
                    </th>
                    {editableFlatConfig.columns.map((col, i) => (
                      <th key={i} className="border border-slate-700 px-2 py-1">
                        {col.name || '(미정)'}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {editableFlatConfig.category.values.slice(0, 2).map((v, i) => (
                    <tr key={i}>
                      <td className="border border-slate-700 px-2 py-1 text-emerald-300">{v}</td>
                      {editableFlatConfig.columns.map((_, j) => (
                        <td key={j} className="border border-slate-700 px-2 py-1 text-slate-500">...</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {outputMode === 'json' && (
      <div className="space-y-4">
        <h3 className="text-md font-medium flex items-center gap-2">
          <BarChart3 size={18} className="text-primary" />
          요약 유형 선택
        </h3>

        <div className="grid grid-cols-2 gap-3">
          {Object.entries(PREDEFINED_SUMMARY_TYPES).map(([key, info]) => (
            <button
              key={key}
              onClick={() => handleTypeSelect(key)}
              className={`flex items-start gap-3 p-4 rounded-xl border transition-all text-left ${
                selectedType === key
                  ? 'border-primary bg-primary/10'
                  : 'border-slate-700 hover:border-slate-600 bg-slate-800/50'
              }`}
            >
              <span className="text-2xl">{info.icon}</span>
              <div>
                <div className="font-medium">{info.name}</div>
                <div className="text-xs text-slate-400 mt-1">{info.description}</div>
              </div>
            </button>
          ))}
          
          <button
            onClick={() => handleTypeSelect('custom')}
            className={`flex items-start gap-3 p-4 rounded-xl border transition-all text-left ${
              selectedType === 'custom'
                ? 'border-primary bg-primary/10'
                : 'border-slate-700 hover:border-slate-600 bg-slate-800/50'
            }`}
          >
            <span className="text-2xl">🔧</span>
            <div>
              <div className="font-medium">커스텀</div>
              <div className="text-xs text-slate-400 mt-1">사용자 정의 그룹/키로 요약</div>
            </div>
          </button>
        </div>
      </div>
      )}

      {outputMode === 'json' && showGroupEditor && (
        <div className="space-y-4 p-4 bg-slate-800/50 rounded-xl border border-slate-700">
          <div className="flex items-center justify-between">
            <h4 className="font-medium flex items-center gap-2">
              <span>{currentTypeInfo.icon}</span>
              {currentTypeInfo.name} - 추출 그룹 및 키
              <span className="text-xs text-slate-500">(키 클릭하여 설명 편집)</span>
            </h4>
            <button
              onClick={addGroup}
              className="flex items-center gap-1 px-3 py-1 bg-primary/20 text-primary rounded-lg text-sm hover:bg-primary/30 transition-colors"
            >
              <Plus size={14} />
              그룹 추가
            </button>
          </div>
          
          <div className="space-y-4">
            {editableGroups.map((group, groupIdx) => (
              <div key={groupIdx} className="p-3 bg-slate-900/50 rounded-lg border border-slate-600/50">
                <div className="flex items-center gap-3 mb-2">
                  <input
                    type="text"
                    value={group.name}
                    onChange={(e) => updateGroup(groupIdx, 'name', e.target.value)}
                    className="flex-1 px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/50"
                    placeholder="그룹명"
                  />
                  <button
                    onClick={() => removeGroup(groupIdx)}
                    className="p-1.5 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors"
                    title="그룹 삭제"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                
                <input
                  type="text"
                  value={group.description || ''}
                  onChange={(e) => updateGroup(groupIdx, 'description', e.target.value)}
                  className="w-full mb-3 px-3 py-1.5 bg-slate-800/50 border border-slate-700 rounded-lg text-xs text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/50"
                  placeholder="그룹 설명 (선택사항 - 이 그룹에서 추출할 정보에 대한 컨텍스트)"
                />
                
                <div className="space-y-2 mb-3">
                  {group.keys.map((keyItem, keyIdx) => (
                    <div 
                      key={keyIdx} 
                      className={`p-2 rounded-lg border transition-all ${
                        editingKey?.groupIdx === groupIdx && editingKey?.keyIdx === keyIdx
                          ? 'border-primary bg-primary/5'
                          : 'border-slate-700/50 bg-slate-800/30 hover:border-slate-600'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span 
                          className="flex-1 px-2 py-1 bg-primary/20 text-primary rounded text-xs font-medium cursor-pointer"
                          onClick={() => setEditingKey(
                            editingKey?.groupIdx === groupIdx && editingKey?.keyIdx === keyIdx 
                              ? null 
                              : { groupIdx, keyIdx }
                          )}
                        >
                          {keyItem.name}
                        </span>
                        <button
                          onClick={() => removeKeyFromGroup(groupIdx, keyIdx)}
                          className="p-1 hover:bg-red-500/20 text-red-400 rounded transition-colors"
                        >
                          <X size={12} />
                        </button>
                      </div>
                      
                      {editingKey?.groupIdx === groupIdx && editingKey?.keyIdx === keyIdx && (
                        <input
                          type="text"
                          value={keyItem.description || ''}
                          onChange={(e) => updateKeyDescription(groupIdx, keyIdx, e.target.value)}
                          className="w-full mt-2 px-2 py-1 bg-slate-900 border border-slate-600 rounded text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
                          placeholder="이 키에서 추출할 값에 대한 설명 (예: HIGH/MEDIUM/LOW 중 하나)"
                          autoFocus
                        />
                      )}
                      
                      {!(editingKey?.groupIdx === groupIdx && editingKey?.keyIdx === keyIdx) && keyItem.description && (
                        <p className="mt-1 px-2 text-[10px] text-slate-500 truncate">
                          📝 {keyItem.description}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newKeyName[groupIdx] || ''}
                    onChange={(e) => setNewKeyName({ ...newKeyName, [groupIdx]: e.target.value })}
                    placeholder="키 이름"
                    className="w-1/3 px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <input
                    type="text"
                    value={newKeyDesc[groupIdx] || ''}
                    onChange={(e) => setNewKeyDesc({ ...newKeyDesc, [groupIdx]: e.target.value })}
                    onKeyPress={(e) => e.key === 'Enter' && addKeyToGroup(groupIdx)}
                    placeholder="키 설명 (추출할 값이 무엇인지)"
                    className="flex-1 px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <button
                    onClick={() => addKeyToGroup(groupIdx)}
                    className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs transition-colors"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          
          {editableGroups.length === 0 && (
            <div className="text-center py-8 text-slate-500 text-sm">
              그룹이 없습니다. "그룹 추가" 버튼을 눌러 추가하세요.
            </div>
          )}
        </div>
      )}

      <BatchSizeControl batchSize={batchSize} fileCount={files.length} onChange={setBatchSize} />
      <SummaryRunStatus error={error} loading={loading} progress={progress} cacheNotice={cacheNotice} />

      <div className="flex flex-wrap gap-3">
        <button
          onClick={runSampleTest}
          disabled={sampleLoading || loading}
          className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
        >
          {sampleLoading ? (
            <RefreshCw size={18} className="animate-spin" />
          ) : (
            <span>🧪</span>
          )}
          {sampleLoading ? '테스트 중...' : `샘플 테스트 (${Math.min(sampleSize, files.length)}개)`}
        </button>

        {outputMode === 'json' ? (
          <button
            onClick={runSummary}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {loading ? (
              <RefreshCw size={18} className="animate-spin" />
            ) : (
              <BarChart3 size={18} />
            )}
            {loading ? '요약 중...' : '🚀 JSON 요약 실행'}
          </button>
        ) : (
          <button
            onClick={runFlatSummary}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {loading ? (
              <RefreshCw size={18} className="animate-spin" />
            ) : (
              <span>📋</span>
            )}
            {loading ? '분석 중...' : '🚀 FLAT 분석 실행'}
          </button>
        )}
        
        {(result || flatResult) && (
          <>
            <button
              onClick={downloadJson}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
            >
              <Download size={18} />
              JSON 다운로드
            </button>
            {outputMode === 'flat' && flatResult?.table && (
              <button
                onClick={downloadCsv}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
              >
                <Download size={18} />
                CSV 다운로드
              </button>
            )}
          </>
        )}
      </div>

      {sampleResult && (
        <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-yellow-400">🧪 샘플 테스트 결과</h4>
            <span className="text-xs text-slate-400">
              {sampleResult.sampled_files?.length}개 파일로 테스트
            </span>
          </div>
          <div className="text-xs text-slate-400 mb-2">
            {sampleResult.sampled_files?.join(', ')}
          </div>
          <div className="bg-slate-800/50 rounded-lg p-3 max-h-48 overflow-y-auto">
            <pre className="text-sm text-slate-300 whitespace-pre-wrap">
              {JSON.stringify(
                outputMode === 'flat' ? sampleResult.table : sampleResult.final_summary, 
                null, 2
              )}
            </pre>
          </div>
          <p className="text-xs text-yellow-400">
            ⚠️ 이 결과는 전체 파일 중 일부만 샘플링한 예상 결과입니다.
          </p>
        </div>
      )}

      {outputMode === 'json' && result && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-md font-medium flex items-center gap-2">
              {currentTypeInfo.icon} {currentTypeInfo.name} 결과
            </h3>
            <span className="text-xs text-slate-500">
              {result.stats?.total_files}개 파일 / {result.stats?.total_batches}개 배치
            </span>
          </div>

          {(result.log_entries || (Array.isArray(result.final_summary) && result.is_list_format)) ? (
            <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                {(result.log_entries || result.final_summary).map((entry, idx, arr) => {
                    const isLast = idx === arr.length - 1;
                    
                    return (
                        <details 
                            key={idx} 
                            className="bg-slate-800 border border-slate-700 rounded-xl shadow-lg group overflow-hidden" 
                            open={isLast} // 마지막 항목(최신 업데이트)만 기본적으로 펼침
                        >
                            <summary className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-700/50 transition-colors list-none select-none">
                                 <div className="flex items-center gap-3">
                                    <div className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold transition-colors ${
                                        isLast ? 'bg-emerald-500 text-white animate-pulse' : 'bg-slate-600 text-slate-300'
                                    }`}>
                                      {entry.batch_index || idx + 1}
                                    </div>
                                    <div className="flex flex-col">
                                        <span className={`font-medium text-sm ${isLast ? 'text-emerald-400' : 'text-slate-300'}`}>
                                          배치 분석 ({entry.batch_index || idx + 1}/{entry.total_batches || '?'})
                                        </span>
                                        <span className="text-[10px] text-slate-400">
                                            {isLast ? '최신 업데이트 반영 중...' : `Ver.${idx + 1} 스냅샷`}
                                        </span>
                                    </div>
                                 </div>
                                 <div className="flex items-center gap-2">
                                     {entry.files_count && (
                                        <span className="text-[10px] text-slate-400 bg-slate-900/50 px-2 py-1 rounded-md border border-slate-700">
                                          + 파일 {entry.files_count}개
                                        </span>
                                     )}
                                     <span className="text-slate-500 transform group-open:rotate-180 transition-transform duration-300">
                                         ▼
                                     </span>
                                 </div>
                            </summary>
                            
                            <div className="p-5 border-t border-slate-700/50 bg-slate-900/20 animate-in slide-in-from-top-2 duration-200">
                                <AiMarkdown compact sectioned>
                                  {entry.content || ''}
                                </AiMarkdown>
                            </div>
                        </details>
                    );
                })}
            </div>
          ) : typeof result.final_summary === 'string' ? (
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 max-h-96 overflow-y-auto custom-scrollbar">
              <AiMarkdown compact sectioned>
                {result.final_summary}
              </AiMarkdown>
            </div>
          ) : (
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 max-h-96 overflow-y-auto custom-scrollbar">
              <pre className="text-sm text-slate-300 whitespace-pre-wrap font-mono">
                {JSON.stringify(result.final_summary, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {outputMode === 'flat' && flatResult && flatResult.table && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-md font-medium flex items-center gap-2">
              {FLAT_TEMPLATES[flatTemplate]?.icon} {FLAT_TEMPLATES[flatTemplate]?.name} 결과
            </h3>
            <span className="text-xs text-slate-500">
              {flatResult.stats?.total_files}개 파일 → {flatResult.stats?.table_rows}행
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-800">
                  <th className="border border-slate-700 px-3 py-2 text-left font-medium text-emerald-400">
                    {flatResult.category?.name}
                  </th>
                  {flatResult.columns?.map((col, idx) => (
                    <th key={idx} className="border border-slate-700 px-3 py-2 text-left font-medium">
                      {col.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {flatResult.table.map((row, rowIdx) => (
                  <tr key={rowIdx} className="hover:bg-slate-800/50">
                    <td className="border border-slate-700 px-3 py-2 font-medium text-emerald-300">
                      {row[flatResult.category?.name]}
                    </td>
                    {flatResult.columns?.map((col, colIdx) => (
                      <td key={colIdx} className="border border-slate-700 px-3 py-2 text-slate-300">
                        {row[col.name] || '-'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
