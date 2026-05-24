import { Suspense, lazy } from 'react'
import { createPortal } from 'react-dom'
import { useDashboardContext } from './DashboardContext'
import DebugConsole from './DebugConsole'

const DiffModal = lazy(() => import('../diff-viewer/DiffModal'))
const ExportModal = lazy(() => import('../ExportModal'))
const HistoryDrawer = lazy(() => import('../HistoryDrawer'))

function DashboardOverlays() {
  const { analysisMode, backendLogAutoRefresh, backendLogSource, backendLogSources, backendLogs, backendLogsError, backendLogsLoading, baseCommit, baselineRef, candidateRef, closeHistoryDrawer, debugLogTab, debugLogs, diffModalScrollStateRef, error, exportModalOpen, fetchBackendLogs, fullCodeContent, gitReport, historyAnalysis, historyDrawerOpen, historyJobProgress, loadingFullCode, loadingHistory, modalViewMode, result, selectedFileForDiff, selectedHistoryFile, setBackendLogAutoRefresh, setBackendLogSource, setDebugLogTab, setDebugLogs, setExportModalOpen, setFullCodeContent, setLoadingFullCode, setModalViewMode, setSelectedFileForDiff, setShowDebugLog, settings, showDebugLog, showJobNotice, targetCommit } = useDashboardContext()
  return (
    <>
      {historyDrawerOpen && (
        <Suspense fallback={null}>
          <HistoryDrawer
            isOpen={historyDrawerOpen}
            onClose={closeHistoryDrawer}
            file={selectedHistoryFile}
            analysis={historyAnalysis}
            loading={loadingHistory}
            progress={historyJobProgress}
          />
        </Suspense>
      )}
      {selectedFileForDiff && typeof document !== 'undefined' && createPortal(
        <Suspense fallback={null}>
          <DiffModal
            selectedFileForDiff={selectedFileForDiff}
            analysisMode={analysisMode}
            modalViewMode={modalViewMode}
            fullCodeContent={fullCodeContent}
            loadingFullCode={loadingFullCode}
            gitReport={gitReport}
            result={result}
            targetCommit={targetCommit}
            candidateRef={candidateRef}
            settings={settings}
            baseCommit={baseCommit}
            baselineRef={baselineRef}
            showJobNotice={showJobNotice}
            setSelectedFileForDiff={setSelectedFileForDiff}
            setModalViewMode={setModalViewMode}
            setFullCodeContent={setFullCodeContent}
            setLoadingFullCode={setLoadingFullCode}
            diffModalScrollStateRef={diffModalScrollStateRef}
          />
        </Suspense>,
        document.body
      )}
      
      <DebugConsole
        showDebugLog={showDebugLog}
        error={error}
        debugLogTab={debugLogTab}
        setDebugLogTab={setDebugLogTab}
        debugLogs={debugLogs}
        setDebugLogs={setDebugLogs}
        backendLogs={backendLogs}
        backendLogSources={backendLogSources}
        backendLogSource={backendLogSource}
        setBackendLogSource={setBackendLogSource}
        backendLogsLoading={backendLogsLoading}
        backendLogsError={backendLogsError}
        backendLogAutoRefresh={backendLogAutoRefresh}
        setBackendLogAutoRefresh={setBackendLogAutoRefresh}
        setShowDebugLog={setShowDebugLog}
        fetchBackendLogs={fetchBackendLogs}
      />

      {/* Export Modal */}
      {exportModalOpen && (
        <Suspense fallback={null}>
          <ExportModal
            files={result?.files || []}
            settings={settings}
            onClose={() => setExportModalOpen(false)}
          />
        </Suspense>
      )}
    </>
  )
}

export default DashboardOverlays
