import { useState } from 'react'
import { Download, FileText, Plus, RefreshCw, Trash2 } from 'lucide-react'
import AiMarkdown from '../AiMarkdown'
import { runBackgroundJob } from './exportJobUtils'

export default function FileAnalysisTab({ files, settings }) {
  const [schema, setSchema] = useState([
    { key: '변경_목적', description: '이 파일에서 무엇을 변경했는지 한 줄로 설명' },
    { key: '영향_범위', description: '변경으로 인해 영향 받는 시스템이나 기능' },
    { key: '리스크_레벨', description: 'HIGH/MEDIUM/LOW 중 하나' }
  ])
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [showPreview, setShowPreview] = useState(false)
  const [progress, setProgress] = useState(null)
  
  // 샘플 테스트 상태
  const [sampleLoading, setSampleLoading] = useState(false)
  const [sampleResult, setSampleResult] = useState(null)
  const sampleSize = 3

  // 필드 추가
  const addField = () => {
    setSchema([...schema, { key: '', description: '' }])
  }

  // 필드 삭제
  const removeField = (index) => {
    setSchema(schema.filter((_, i) => i !== index))
  }

  // 필드 업데이트
  const updateField = (index, field, value) => {
    const newSchema = [...schema]
    newSchema[index][field] = value
    setSchema(newSchema)
  }

  // 미리보기/추출 실행
  const runExtraction = async () => {
    // 빈 필드 검증
    const validSchema = schema.filter(s => s.key.trim() && s.description.trim())
    if (validSchema.length === 0) {
      setError('최소 하나의 필드를 정의해주세요.')
      return
    }

    setLoading(true)
    setError(null)
    setResults(null)
    setProgress({ message: '백그라운드 추출 작업을 등록하고 있습니다.', percent: 0 })

    try {
      const data = await runBackgroundJob('/api/jobs/export/extract-fields', {
        files: files.map(f => ({
          path: f.path,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          ai_summary: f.ai_summary || '',
          diff: f.diff || ''
        })),
        schema: validSchema,
        openai_api_key: settings.openaiApiKey,
        openai_base_url: settings.openaiBaseUrl,
        openai_model: settings.openaiModel,
        langfuse_public_key: settings.langfusePublicKey,
        langfuse_secret_key: settings.langfuseSecretKey,
        langfuse_host: settings.langfuseHost
      }, setProgress)
      setResults(data.results)
      setShowPreview(true)
    } catch (e) {
      setError(`네트워크 오류: ${e.message}`)
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }

  // Excel 다운로드
  const downloadExcel = () => {
    if (!results) return

    const validSchema = schema.filter(s => s.key.trim())
    const headers = ['파일 경로', ...validSchema.map(s => s.key)]
    
    const rows = results.map(r => [
      r.file_path,
      ...validSchema.map(s => (r.fields[s.key] || '').replace(/"/g, '""'))
    ])

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n')

    const bom = '\uFEFF'
    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `export-fields-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // 샘플 테스트 (2-3개 파일로 미리 결과 확인)
  const runSampleTest = async () => {
    const validSchema = schema.filter(s => s.key.trim() && s.description.trim())
    if (validSchema.length === 0) {
      setError('최소 하나의 필드를 정의해주세요.')
      return
    }

    setSampleLoading(true)
    setSampleResult(null)
    setError(null)
    setProgress({ message: '샘플 추출 작업을 등록하고 있습니다.', percent: 0 })

    // 파일 샘플링 (랜덤하게 sampleSize개 선택)
    const sampleFiles = [...files]
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.min(sampleSize, files.length))

    try {
      const data = await runBackgroundJob('/api/jobs/export/extract-fields', {
        files: sampleFiles.map(f => ({
          path: f.path,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          ai_summary: f.ai_summary || '',
          diff: f.diff || ''
        })),
        schema: validSchema,
        openai_api_key: settings.openaiApiKey,
        openai_base_url: settings.openaiBaseUrl,
        openai_model: settings.openaiModel
      }, setProgress)
      setSampleResult({
        results: data.results,
        sampled_files: sampleFiles.map(f => f.path)
      })
    } catch (e) {
      setError(`네트워크 오류: ${e.message}`)
    } finally {
      setSampleLoading(false)
      setProgress(null)
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Schema Editor */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-md font-medium flex items-center gap-2">
            <Settings size={18} className="text-primary" />
            추출 필드 정의
          </h3>
          <button
            onClick={addField}
            className="flex items-center gap-1 px-3 py-1.5 bg-primary/20 hover:bg-primary/30 text-primary rounded-lg text-sm transition-colors"
          >
            <Plus size={16} />
            필드 추가
          </button>
        </div>

        <div className="space-y-2">
          {schema.map((field, idx) => (
            <div key={idx} className="flex gap-3 items-start">
              <input
                type="text"
                placeholder="KEY (컬럼명)"
                value={field.key}
                onChange={(e) => updateField(idx, 'key', e.target.value)}
                className="w-1/4 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <input
                type="text"
                placeholder="VALUE 설명 (추출 지침)"
                value={field.description}
                onChange={(e) => updateField(idx, 'description', e.target.value)}
                className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <button
                onClick={() => removeField(idx)}
                className="p-2 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors"
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          ⚠️ {error}
        </div>
      )}

      {progress && (
        <div className="p-4 rounded-xl border border-primary/20 bg-primary/10 space-y-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-stone-100">{progress.message}</span>
            <span className="text-primary font-bold">{Math.round(progress.percent || 0)}%</span>
          </div>
          <div className="h-2 rounded-full bg-stone-950/60 overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${Math.max(5, Math.min(100, progress.percent || 5))}%` }}
            />
          </div>
          <p className="text-xs text-stone-500">
            백엔드 job으로 실행 중입니다. {progress.jobId && <span>job {progress.jobId.slice(0, 8)}</span>}
            {progress.elapsed && <span> · 경과 {progress.elapsed}</span>}
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        {/* Sample Test Button */}
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

        {/* Full Extraction Button */}
        <button
          onClick={runExtraction}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
        >
          {loading ? (
            <RefreshCw size={18} className="animate-spin" />
          ) : (
            <FileText size={18} />
          )}
          {loading ? '추출 중...' : '🚀 전체 추출'}
        </button>
        
        {results && (
          <button
            onClick={downloadExcel}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
          >
            <Download size={18} />
            📥 Excel 다운로드
          </button>
        )}
      </div>

      {/* Sample Test Result */}
      {sampleResult && (
        <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-yellow-400">🧪 샘플 테스트 결과</h4>
            <span className="text-xs text-slate-400">
              {sampleResult.results?.length}개 파일로 테스트
            </span>
          </div>
          <div className="text-xs text-slate-400 mb-2">
            {sampleResult.sampled_files?.join(', ')}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-slate-800">
                <tr>
                  <th className="border border-slate-700 px-3 py-2 text-left text-yellow-400">파일</th>
                  {schema.filter(s => s.key.trim()).map((s, i) => (
                    <th key={i} className="border border-slate-700 px-3 py-2 text-left">{s.key}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sampleResult.results?.map((r, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/50">
                    <td className="border border-slate-700 px-3 py-2 font-mono text-xs text-primary">
                      {r.file_path?.split('/').pop()}
                    </td>
                    {schema.filter(s => s.key.trim()).map((s, i) => (
                      <td key={i} className="border border-slate-700 px-3 py-2 text-slate-300">
                        {r.fields?.[s.key] || '-'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-yellow-400">
            ⚠️ 이 결과는 전체 파일 중 일부만 샘플링한 예상 결과입니다.
          </p>
        </div>
      )}

      {/* Preview Table */}
      {showPreview && results && (
        <div className="space-y-3">
          <h3 className="text-md font-medium">미리보기 ({results.length}개 파일)</h3>
          <div className="overflow-x-auto border border-slate-700 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-slate-800">
                <tr>
                  <th className="px-4 py-2 text-left text-slate-400 font-medium">파일</th>
                  {schema.filter(s => s.key.trim()).map((s, i) => (
                    <th key={i} className="px-4 py-2 text-left text-slate-400 font-medium">{s.key}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.slice(0, 10).map((r, idx) => (
                  <tr key={idx} className="border-t border-slate-700/50 hover:bg-slate-800/50">
                    <td className="px-4 py-2 font-mono text-xs text-primary">{r.file_path.split('/').pop()}</td>
                    {schema.filter(s => s.key.trim()).map((s, i) => (
                      <td key={i} className="px-4 py-2 text-slate-300 max-w-xs truncate">
                        {r.fields[s.key] || '-'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {results.length > 10 && (
              <div className="px-4 py-2 bg-slate-800/50 text-center text-slate-400 text-sm">
                ... 외 {results.length - 10}개 파일
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}


// ============================================================================
// SummaryTab - 배치 점진적 요약
// ============================================================================

// 사전 정의 요약 타입 (백엔드와 동기화 - keys는 {name, description} 형식)
