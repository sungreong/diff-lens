import { Suspense, lazy } from 'react'
import { useDashboardContext } from './DashboardContext'
import DashboardStandardControlPanel from './DashboardStandardControlPanel'

const MergePlanPanel = lazy(() => import('../merge-plan/MergePlanPanel'))

function DashboardControlPanel() {
  const {
    API_URL,
    activePurposeDetail,
    baselineRef,
    candidateRef,
    compareRefs,
    comparisonPurpose,
    comparisonPurposeOptions,
    handleComparisonPurposeChange,
    isMergePlan,
    loadingRefs,
    notifyJobComplete,
    refOptionGroups,
    repoStatus,
    settings,
    showJobNotice,
  } = useDashboardContext()

  if (!isMergePlan) return <DashboardStandardControlPanel />

  return (
    <div className="glass hero-panel allow-popovers rounded-[2rem] p-4 md:p-5">
      <div className="flex min-w-0 flex-col gap-4 mb-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <p className="eyebrow text-[10px] font-bold text-primary mb-1">Git diff briefing room</p>
          <h2 className="text-xl md:text-2xl font-bold tracking-tight text-stone-50">{activePurposeDetail.title}</h2>
          <p className="text-xs md:text-sm text-stone-400 mt-1 max-w-3xl">{activePurposeDetail.description}</p>
        </div>

        <div className="mode-switch flex max-w-full shrink-0 overflow-x-auto rounded-full p-1 custom-scrollbar">
          {comparisonPurposeOptions.map((purpose) => (
            <button
              key={purpose.key}
              type="button"
              onClick={() => handleComparisonPurposeChange(purpose.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs md:text-sm font-bold transition-all whitespace-nowrap ${
                comparisonPurpose === purpose.key
                  ? 'bg-[#79b8c5] text-stone-950 shadow-lg shadow-[#79b8c5]/20'
                  : 'text-stone-400 hover:text-stone-100'
              }`}
            >
              <purpose.Icon size={16} />
              {purpose.label}
            </button>
          ))}
        </div>
      </div>

      <Suspense fallback={<div className="h-40 rounded-[1.5rem] border border-primary/10 bg-stone-950/35 animate-pulse" />}>
        <MergePlanPanel
          apiUrl={API_URL}
          settings={settings}
          optionGroups={refOptionGroups}
          loadingRefs={loadingRefs}
          repoStatus={repoStatus}
          defaultTargetRef={baselineRef || compareRefs.default_branch || 'main'}
          defaultCandidateRef={candidateRef || settings.branch || ''}
          showJobNotice={showJobNotice}
          notifyJobComplete={notifyJobComplete}
        />
      </Suspense>
    </div>
  )
}

export default DashboardControlPanel
