import { useState } from 'react'
import { X, FileText, BarChart3, Download } from 'lucide-react'
import FileAnalysisTab from './export-modal/FileAnalysisTab'
import SummaryTab from './export-modal/SummaryTab'

function ExportModal({ files, settings, onClose }) {
  const [activeTab, setActiveTab] = useState('file_analysis') // 'file_analysis' | 'summary'
  
  return (
    <div className="warm-scope modal-backdrop fixed inset-0 flex items-center justify-center z-50 p-4">
      <div className="modal-shell rounded-[1.75rem] w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="modal-header flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/15 rounded-xl border border-primary/20">
              <Download size={20} className="text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-stone-50">EXPORT 추가 분석</h2>
              <p className="text-sm text-stone-400">{files.length}개 파일 분석 데이터 활용</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="action-ghost p-2"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 px-6 py-3 border-b border-primary/10">
          <button
            onClick={() => setActiveTab('file_analysis')}
            className={`flex items-center gap-2 px-4 py-2 rounded-full font-bold transition-all ${
              activeTab === 'file_analysis'
                ? 'bg-primary text-stone-950'
                : 'hover:bg-primary/10 text-stone-400'
            }`}
          >
            <FileText size={18} />
            파일별 분석
          </button>
          <button
            onClick={() => setActiveTab('summary')}
            className={`flex items-center gap-2 px-4 py-2 rounded-full font-bold transition-all ${
              activeTab === 'summary'
                ? 'bg-primary text-stone-950'
                : 'hover:bg-primary/10 text-stone-400'
            }`}
          >
            <BarChart3 size={18} />
            요약
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'file_analysis' && (
            <FileAnalysisTab files={files} settings={settings} />
          )}
          {activeTab === 'summary' && (
            <SummaryTab files={files} settings={settings} />
          )}
        </div>
      </div>
    </div>
  )
}

export default ExportModal
