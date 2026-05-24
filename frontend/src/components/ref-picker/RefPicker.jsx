import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Clock, Code, GitBranch, Search, Star, X } from 'lucide-react'

const flattenRefOptionGroups = (groups = []) => (
  groups.flatMap(group => group.options || []).filter(option => option?.value)
)

export const DarkOptionMenu = ({
  value,
  onChange,
  optionGroups = [],
  placeholder = '직접 입력 / 현재 값',
  disabled = false,
  loading = false,
  LeadingIcon = GitBranch,
  accentClass = 'text-primary',
  buttonClassName = 'field-surface flex h-[50px] items-center gap-2 rounded-xl border px-3',
  valueClassName = 'text-sm font-bold text-stone-100',
  menuClassName = '',
  title,
  searchPlaceholder = '브랜치, 태그, 커밋 검색',
}) => {
  const [open, setOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const menuRef = useRef(null)
  const flatOptions = flattenRefOptionGroups(optionGroups)
  const selectedOption = flatOptions.find(option => option.value === value)
  const currentLabel = selectedOption?.label || placeholder
  const normalizedSearch = searchTerm.trim().toLowerCase()
  const filteredGroups = optionGroups
    .map(group => ({
      ...group,
      options: (group.options || []).filter(option => {
        if (!normalizedSearch) return true
        return (
          option.label?.toLowerCase().includes(normalizedSearch) ||
          option.value?.toLowerCase().includes(normalizedSearch) ||
          group.label?.toLowerCase().includes(normalizedSearch)
        )
      }),
    }))
    .filter(group => group.options.length > 0)
  const totalFilteredOptions = filteredGroups.reduce((sum, group) => sum + group.options.length, 0)

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined

    const closeFromOutside = (event) => {
      if (!menuRef.current?.contains(event.target)) setOpen(false)
    }
    const closeFromEscape = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', closeFromOutside)
    document.addEventListener('keydown', closeFromEscape)
    return () => {
      document.removeEventListener('mousedown', closeFromOutside)
      document.removeEventListener('keydown', closeFromEscape)
    }
  }, [open])

  const handleSelect = (nextValue) => {
    if (!nextValue) return
    onChange(nextValue)
    setOpen(false)
    setSearchTerm('')
  }

  return (
    <div ref={menuRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => !disabled && setOpen(prev => !prev)}
        disabled={disabled}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`${buttonClassName} w-full text-left transition-all disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {loading ? (
          <Clock size={16} className="shrink-0 animate-spin text-primary" />
        ) : (
          <LeadingIcon size={16} className={`${accentClass} shrink-0`} />
        )}
        <span className={`min-w-0 flex-1 truncate ${valueClassName}`}>
          {currentLabel}
        </span>
        <ChevronDown size={15} className={`shrink-0 text-stone-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="listbox"
          className={`absolute left-0 right-0 top-[calc(100%+8px)] z-[80] overflow-hidden rounded-2xl border border-primary/20 bg-[#11100b] shadow-2xl shadow-black/60 ring-1 ring-white/5 ${menuClassName}`}
        >
          <div className="border-b border-white/5 bg-[#17140c] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-primary/80">
            직접 입력 / 현재 값
          </div>
          <div className="border-b border-white/5 bg-[#100f0a] p-2">
            <div className="flex h-9 items-center gap-2 rounded-xl border border-primary/15 bg-black/20 px-3">
              <Search size={14} className="shrink-0 text-primary/80" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder={searchPlaceholder}
                className="min-w-0 flex-1 bg-transparent text-sm text-stone-100 placeholder-stone-500 outline-none"
                autoFocus
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="rounded-full p-1 text-stone-500 hover:bg-primary/10 hover:text-primary"
                  aria-label="검색어 지우기"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>
          <div className="max-h-[340px] overflow-y-auto custom-scrollbar py-1">
            {optionGroups.length === 0 && (
              <div className="px-3 py-3 text-xs text-stone-500">
                선택 가능한 브랜치/태그/커밋을 불러오지 못했습니다.
              </div>
            )}
            {optionGroups.length > 0 && totalFilteredOptions === 0 && (
              <div className="px-3 py-3 text-xs text-stone-500">
                검색 결과가 없습니다.
              </div>
            )}
            {filteredGroups.map(group => (
              <div key={group.label} className="py-1">
                <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-stone-500">
                  <span className="min-w-0 truncate">{group.label}</span>
                  <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] tracking-normal text-primary/80">
                    {group.options.length}
                  </span>
                </div>
                {(group.options || []).map(option => {
                  const selected = option.value === value
                  return (
                    <button
                      key={`${group.label}-${option.value}`}
                      type="button"
                      onClick={() => handleSelect(option.value)}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                        selected
                          ? 'bg-[#79b8c5]/16 text-[#d8f6fb]'
                          : 'text-[#ffe2a5] hover:bg-primary/10 hover:text-stone-50'
                      }`}
                      aria-selected={selected}
                      role="option"
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${selected ? 'bg-[#79b8c5]' : 'bg-primary/40'}`} />
                      <span className="min-w-0 truncate">{option.label}</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const RefPicker = ({
  label,
  helper,
  value,
  onChange,
  primaryOptionGroups,
  commitOptions = [],
  sourceRef,
  onSourceRefChange,
  isSourceBranch = false,
  loading,
  placeholder,
  resolved,
  onSave,
  saveTitle,
  accentClass = 'text-primary',
  branchCommitLoading = false,
}) => {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <label className="block text-sm font-medium text-slate-300">
          {label}
          {loading && <span className="ml-1 text-xs text-primary">(목록 불러오는 중)</span>}
          {branchCommitLoading && <span className="ml-1 text-xs text-[#79b8c5]">(브랜치 커밋 불러오는 중)</span>}
        </label>
        {helper && <span className="text-[11px] text-stone-500">{helper}</span>}
      </div>
      <div className="space-y-2">
        <DarkOptionMenu
          value={sourceRef || value}
          onChange={(nextValue) => {
            onSourceRefChange?.(nextValue)
            onChange(nextValue)
          }}
          optionGroups={primaryOptionGroups}
          loading={loading}
          placeholder="브랜치 / 태그 선택"
          accentClass={accentClass}
          buttonClassName="field-surface flex h-[50px] items-center gap-2 rounded-xl border px-3"
          searchPlaceholder="브랜치, 태그, 즐겨찾기 검색"
        />

        {isSourceBranch && (
          <DarkOptionMenu
            value={value}
            onChange={onChange}
            optionGroups={commitOptions.length > 0 ? [{ label: `COMMIT · ${sourceRef}`, options: commitOptions }] : []}
            loading={branchCommitLoading}
            LeadingIcon={Code}
            placeholder={branchCommitLoading ? '커밋 불러오는 중' : 'COMMIT 선택'}
            accentClass={accentClass}
            buttonClassName="field-surface flex h-[50px] items-center gap-2 rounded-xl border px-3"
            searchPlaceholder="커밋 ID 또는 메시지 검색"
          />
        )}

        <details className="rounded-xl border border-primary/10 bg-stone-950/20 px-3 py-2">
          <summary className="cursor-pointer text-xs font-bold text-stone-400 marker:text-primary">
            직접 커밋 SHA 또는 이름 입력
          </summary>
          <div className="mt-2 field-surface flex h-[44px] items-center gap-2 rounded-xl border px-4">
            <input
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder={placeholder}
              className="min-w-0 flex-1 bg-transparent text-sm text-stone-100 placeholder-stone-500 outline-none"
            />
          </div>
        </details>
      </div>
      {resolved?.short_sha && (
        <div className="mt-2 flex min-w-0 items-center gap-2 text-[11px] text-stone-500">
          <span className="status-pill px-2 py-0.5">{resolved.type}</span>
          <span className={`font-mono ${accentClass}`}>{resolved.short_sha}</span>
          <span className="truncate" title={resolved.title}>{resolved.title}</span>
          {onSave && (
            <button
              type="button"
              onClick={onSave}
              className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-bold hover:bg-stone-950/30 ${accentClass}`}
              title={saveTitle}
            >
              <Star size={11} /> 저장
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default RefPicker
