import ReactMarkdown from 'react-markdown'
import { normalizeAiResultMarkdown } from './aiMarkdownUtils'

export { aiSummaryPreviewText, normalizeAiResultMarkdown } from './aiMarkdownUtils'

const splitSeverityFromTitle = (title = '') => {
  const match = title.match(/\[(CRITICAL|HIGH|MEDIUM|LOW|Critical|High|Medium|Low)\]\s*$/)
  if (!match) return { title, severity: '' }
  return {
    title: title.replace(match[0], '').trim(),
    severity: match[1].toUpperCase(),
  }
}

const sectionTone = (title = '') => {
  if (/리스크|위험|심각도|문제/.test(title)) {
    return {
      eyebrow: 'text-red-200',
      border: 'border-red-300/20',
      bg: 'bg-red-950/10',
      dot: 'bg-red-300',
    }
  }
  if (/판정|결론|요약/.test(title)) {
    return {
      eyebrow: 'text-amber-100',
      border: 'border-amber-300/25',
      bg: 'bg-amber-400/10',
      dot: 'bg-amber-300',
    }
  }
  if (/근거|Before|After|변경|추가|삭제|목적/.test(title)) {
    return {
      eyebrow: 'text-[#b8edf5]',
      border: 'border-[#79b8c5]/20',
      bg: 'bg-[#79b8c5]/10',
      dot: 'bg-[#79b8c5]',
    }
  }
  if (/수정|권고|테스트|검증|점검|확인/.test(title)) {
    return {
      eyebrow: 'text-emerald-100',
      border: 'border-emerald-300/20',
      bg: 'bg-emerald-400/10',
      dot: 'bg-emerald-300',
    }
  }
  if (/불확실|오탐/.test(title)) {
    return {
      eyebrow: 'text-stone-200',
      border: 'border-stone-300/15',
      bg: 'bg-stone-400/10',
      dot: 'bg-stone-300',
    }
  }
  return {
    eyebrow: 'text-primary',
    border: 'border-primary/15',
    bg: 'bg-primary/10',
    dot: 'bg-primary',
  }
}

const parseSectionedMarkdown = (markdown = '') => {
  const normalized = normalizeAiResultMarkdown(markdown)
  if (!normalized) return []

  const groups = []
  let currentGroup = { title: '', intro: [], sections: [] }
  let currentSection = null

  const flushSection = () => {
    if (!currentSection) return
    const body = currentSection.body.join('\n').trim()
    if (body) {
      currentGroup.sections.push({ ...currentSection, body })
    }
    currentSection = null
  }

  const flushGroup = () => {
    flushSection()
    const intro = currentGroup.intro.join('\n').trim()
    if (currentGroup.title || intro || currentGroup.sections.length) {
      groups.push({ ...currentGroup, intro })
    }
    currentGroup = { title: '', intro: [], sections: [] }
  }

  normalized.split('\n').forEach(line => {
    const heading = line.match(/^(#{2,4})\s+(.+?)\s*$/)
    if (!heading) {
      if (currentSection) currentSection.body.push(line)
      else currentGroup.intro.push(line)
      return
    }

    const level = heading[1].length
    const title = heading[2].trim()
    if (level <= 2) {
      flushGroup()
      currentGroup = { title, intro: [], sections: [] }
      return
    }

    flushSection()
    currentSection = { title, body: [] }
  })

  flushGroup()
  return groups
}

const textWrapClass = 'min-w-0 break-words [overflow-wrap:anywhere]'
const blockWrapClass = 'min-w-0 max-w-full break-words [overflow-wrap:anywhere]'

export const aiResultMarkdownComponents = {
  h1: ({ node, ...props }) => (
    <h2 className={`mb-5 mt-0 text-xl font-black tracking-normal text-stone-50 ${textWrapClass}`} {...props} />
  ),
  h2: ({ node, ...props }) => (
    <h3 className={`mb-4 mt-8 first:mt-0 border-b border-primary/10 pb-3 text-base font-black tracking-normal text-stone-50 ${textWrapClass}`} {...props} />
  ),
  h3: ({ node, ...props }) => (
    <h4 className={`mb-3 mt-6 first:mt-0 border-l-2 border-primary/60 pl-3 text-[0.78rem] font-black uppercase tracking-[0.16em] text-primary ${textWrapClass}`} {...props} />
  ),
  h4: ({ node, ...props }) => (
    <h5 className={`mb-2 mt-4 text-sm font-black text-[#b8edf5] ${textWrapClass}`} {...props} />
  ),
  p: ({ node, ...props }) => (
    <p className={`my-3 max-w-[82ch] text-[0.94rem] leading-8 text-stone-200/95 ${blockWrapClass}`} {...props} />
  ),
  ul: ({ node, ...props }) => (
    <ul className={`my-3 max-w-[82ch] space-y-2 pl-5 text-[0.94rem] leading-8 text-stone-200/95 ${blockWrapClass}`} {...props} />
  ),
  ol: ({ node, ...props }) => (
    <ol className={`my-3 max-w-[82ch] space-y-2 pl-5 text-[0.94rem] leading-8 text-stone-200/95 ${blockWrapClass}`} {...props} />
  ),
  li: ({ node, ...props }) => (
    <li className={`pl-1 marker:text-primary/80 ${textWrapClass}`} {...props} />
  ),
  strong: ({ node, ...props }) => (
    <strong className={`font-black text-stone-50 ${textWrapClass}`} {...props} />
  ),
  code: ({ node, inline, ...props }) => (
    <code
      className={inline ? `rounded bg-stone-950/70 px-1.5 py-0.5 text-[0.86em] text-[#b8edf5] ${textWrapClass}` : 'text-[#b8edf5]'}
      {...props}
    />
  ),
  pre: ({ node, ...props }) => (
    <pre className="my-4 min-w-0 max-w-full overflow-x-auto rounded-2xl border border-primary/10 bg-stone-950/75 p-4 text-xs leading-6 text-[#b8edf5] custom-scrollbar" {...props} />
  ),
  blockquote: ({ node, ...props }) => (
    <blockquote className={`my-4 max-w-[82ch] border-l-2 border-[#79b8c5]/50 bg-[#79b8c5]/5 py-2 pl-4 text-sm text-stone-300 ${blockWrapClass}`} {...props} />
  ),
  hr: ({ node, ...props }) => (
    <hr className="my-6 border-primary/10" {...props} />
  ),
  table: ({ node, ...props }) => (
    <div className="my-4 min-w-0 max-w-full overflow-x-auto custom-scrollbar">
      <table className="w-full min-w-[560px] border-collapse text-left text-xs" {...props} />
    </div>
  ),
  th: ({ node, ...props }) => (
    <th className={`border-b border-primary/15 bg-stone-950/60 px-3 py-2 font-black text-stone-300 ${textWrapClass}`} {...props} />
  ),
  td: ({ node, ...props }) => (
    <td className={`border-b border-primary/10 px-3 py-2 align-top text-stone-300 ${textWrapClass}`} {...props} />
  ),
  a: ({ node, ...props }) => (
    <a className={`text-[#b8edf5] underline decoration-[#79b8c5]/40 underline-offset-4 hover:text-primary ${textWrapClass}`} {...props} />
  ),
}

const compactComponents = {
  ...aiResultMarkdownComponents,
  h1: ({ node, ...props }) => (
    <h2 className={`mb-3 mt-0 text-base font-black text-stone-50 ${textWrapClass}`} {...props} />
  ),
  h2: ({ node, ...props }) => (
    <h3 className={`mb-2 mt-4 first:mt-0 text-sm font-black text-stone-50 ${textWrapClass}`} {...props} />
  ),
  h3: ({ node, ...props }) => (
    <h4 className={`mb-2 mt-4 first:mt-0 border-l-2 border-primary/60 pl-2 text-[0.68rem] font-black uppercase tracking-[0.14em] text-primary ${textWrapClass}`} {...props} />
  ),
  p: ({ node, ...props }) => (
    <p className={`my-2 max-w-[78ch] text-[0.84rem] leading-7 text-stone-300 ${blockWrapClass}`} {...props} />
  ),
  ul: ({ node, ...props }) => (
    <ul className={`my-2 max-w-[78ch] space-y-1.5 pl-4 text-[0.84rem] leading-7 text-stone-300 ${blockWrapClass}`} {...props} />
  ),
  ol: ({ node, ...props }) => (
    <ol className={`my-2 max-w-[78ch] space-y-1.5 pl-4 text-[0.84rem] leading-7 text-stone-300 ${blockWrapClass}`} {...props} />
  ),
}

const renderMarkdown = (markdown, compact = false) => (
  <ReactMarkdown components={compact ? compactComponents : aiResultMarkdownComponents}>
    {markdown}
  </ReactMarkdown>
)

const StandardAiMarkdown = ({ children, className = '', compact = false }) => (
  <div className={`ai-result-markdown min-w-0 max-w-full text-stone-200 ${className}`}>
    <ReactMarkdown components={compact ? compactComponents : aiResultMarkdownComponents}>
      {normalizeAiResultMarkdown(children || '')}
    </ReactMarkdown>
  </div>
)

const severityClass = (severity) => {
  if (severity === 'CRITICAL' || severity === 'HIGH') return 'border-red-300/30 bg-red-400/10 text-red-100'
  if (severity === 'MEDIUM') return 'border-amber-300/30 bg-amber-400/10 text-amber-100'
  if (severity === 'LOW') return 'border-yellow-200/25 bg-yellow-300/10 text-yellow-100'
  return 'border-primary/15 bg-primary/10 text-primary'
}

const SectionedAiMarkdown = ({ children, className = '', compact = false }) => {
  const groups = parseSectionedMarkdown(children || '')
  if (!groups.length || groups.every(group => !group.title && group.sections.length < 2)) {
    return <StandardAiMarkdown compact={compact} className={className}>{children}</StandardAiMarkdown>
  }

  return (
    <div className={`ai-result-markdown min-w-0 max-w-full ${compact ? 'space-y-3' : 'space-y-5'} text-stone-200 ${className}`}>
      {groups.map((group, groupIndex) => {
        const titleParts = splitSeverityFromTitle(group.title)
        return (
          <article
            key={`${group.title}-${groupIndex}`}
            className={`min-w-0 overflow-hidden rounded-2xl border border-primary/12 bg-stone-950/30 ${compact ? 'p-3' : 'p-5'}`}
          >
            {group.title && (
              <header className={`${compact ? 'mb-3' : 'mb-4'} flex flex-wrap items-start justify-between gap-3`}>
                <div className="min-w-0 flex-1">
                  <div className="text-[0.68rem] font-black uppercase tracking-[0.18em] text-stone-500">
                    AI 결과 항목
                  </div>
                  <h3 className={`${compact ? 'mt-1 text-sm' : 'mt-2 text-base'} break-words [overflow-wrap:anywhere] font-black text-stone-50`}>
                    {titleParts.title}
                  </h3>
                </div>
                {titleParts.severity && (
                  <span className={`rounded-full border px-2.5 py-1 text-[0.68rem] font-black ${severityClass(titleParts.severity)}`}>
                    {titleParts.severity}
                  </span>
                )}
              </header>
            )}

            {group.intro && (
              <div className={`${compact ? 'mb-3' : 'mb-4'} min-w-0 overflow-hidden rounded-xl border border-primary/10 bg-stone-950/35 px-3 py-2`}>
                {renderMarkdown(group.intro, true)}
              </div>
            )}

            <div className={`grid min-w-0 ${compact ? 'gap-2' : 'gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'}`}>
              {group.sections.map((section, sectionIndex) => {
                const tone = sectionTone(section.title)
                return (
                  <section
                    key={`${section.title}-${sectionIndex}`}
                    className={`min-w-0 overflow-hidden rounded-2xl border ${tone.border} ${tone.bg} ${compact ? 'p-3' : 'p-4'}`}
                  >
                    <div className="mb-2 flex min-w-0 items-start gap-2">
                      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
                      <h4 className={`min-w-0 break-words text-[0.72rem] font-black uppercase tracking-[0.14em] [overflow-wrap:anywhere] ${tone.eyebrow}`}>
                        {section.title}
                      </h4>
                    </div>
                    {renderMarkdown(section.body, compact)}
                  </section>
                )
              })}
            </div>
          </article>
        )
      })}
    </div>
  )
}

const AiMarkdown = ({ children, className = '', compact = false, sectioned = false }) => (
  sectioned
    ? <SectionedAiMarkdown compact={compact} className={className}>{children}</SectionedAiMarkdown>
    : <StandardAiMarkdown compact={compact} className={className}>{children}</StandardAiMarkdown>
)

export default AiMarkdown
