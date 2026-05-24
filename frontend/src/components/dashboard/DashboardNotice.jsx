import { useDashboardContext } from './DashboardContext'

function DashboardNotice() {
  const { X, jobNotice, setJobNotice } = useDashboardContext()
  return (
    <>
      {jobNotice && (
        <div className={`fixed bottom-5 right-5 z-50 max-w-sm rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur ${
          jobNotice.tone === 'error'
            ? 'border-red-400/30 bg-red-950/85 text-red-100'
            : jobNotice.tone === 'warning'
              ? 'border-amber-300/30 bg-amber-950/85 text-amber-100'
              : 'border-[#79b8c5]/30 bg-stone-950/90 text-stone-100'
        }`}>
          <div className="flex items-start gap-3">
            <div className="mt-1 h-2 w-2 rounded-full bg-current opacity-80" />
            <div>
              <p className="text-sm font-semibold">백그라운드 작업 상태</p>
              <p className="mt-0.5 text-xs leading-relaxed opacity-80">{jobNotice.message}</p>
            </div>
            <button
              type="button"
              onClick={() => setJobNotice(null)}
              className="ml-2 rounded-full p-1 text-current/60 hover:bg-white/10 hover:text-current"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </>
  )
}

export default DashboardNotice
