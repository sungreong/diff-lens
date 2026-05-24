import { AlertTriangle, BookOpen, Code, GitBranch, GitMerge, ShieldCheck, Terminal } from 'lucide-react'

const workflowSteps = [
  {
    title: '대상과 후보를 SHA로 잠금',
    command: 'git rev-parse --verify <ref>^{commit}',
    detail: '화면에서 고른 branch, tag, commit을 실행 시점의 commit SHA로 고정합니다.',
  },
  {
    title: '임시 작업공간 준비',
    command: 'git checkout --detach <target_sha>',
    detail: '원격 브랜치나 로컬 작업 브랜치를 건드리지 않는 detached 상태에서 검사를 시작합니다.',
  },
  {
    title: '개별 충돌 확인',
    command: 'git merge --no-commit --no-ff <candidate_sha>',
    detail: 'merge 결과를 커밋하지 않고 충돌 파일과 종료 코드를 확인합니다.',
  },
  {
    title: '충돌 파일 수집',
    command: 'git diff --name-only --diff-filter=U',
    detail: 'unmerged 상태의 파일만 모아 결과 표와 AI 리뷰의 근거로 사용합니다.',
  },
  {
    title: '순차 dry-run 누적',
    command: 'git commit -q -m "dry-run merge candidate <n>"',
    detail: 'clean 후보만 임시 작업공간에 로컬 커밋으로 쌓아 다음 후보와의 조합 충돌을 봅니다.',
  },
]

const commandGroups = [
  {
    title: '현재 위치와 ref 확인',
    icon: GitBranch,
    rows: [
      ['git status --short --branch', '현재 브랜치, staged/unstaged 변경을 짧게 확인합니다.'],
      ['git branch --show-current', '현재 checkout된 브랜치명만 확인합니다.'],
      ['git rev-parse --short HEAD', '현재 커밋 SHA를 짧게 확인합니다.'],
      ['git log --oneline -5', '최근 커밋 5개를 한 줄씩 봅니다.'],
    ],
  },
  {
    title: '브랜치 이동과 분기',
    icon: GitBranch,
    rows: [
      ['git switch <branch>', '기존 브랜치로 이동합니다. 브랜치 이동 의도가 가장 명확합니다.'],
      ['git switch -c <new-branch> <start-point>', '특정 지점에서 새 브랜치를 만들고 이동합니다.'],
      ['git checkout --detach <sha>', '브랜치가 아닌 특정 커밋 상태를 임시로 확인할 때 씁니다.'],
      ['git checkout <branch>', '예전 방식의 브랜치 이동 명령입니다. 파일 복구 의미도 있어 switch보다 넓습니다.'],
    ],
  },
  {
    title: '원격 최신 상태 반영',
    icon: Terminal,
    rows: [
      ['git fetch --prune origin', 'origin의 최신 ref를 가져오고 사라진 원격 추적 브랜치를 정리합니다.'],
      ['git fetch origin <branch>', '특정 브랜치만 가져옵니다.'],
      ['git ls-remote --heads origin <branch>', '원격 브랜치가 존재하는지와 원격 SHA를 확인합니다.'],
      ['git rev-parse origin/<branch>', 'fetch 후 원격 추적 브랜치의 SHA를 확인합니다.'],
    ],
  },
  {
    title: '충돌 확인과 중단',
    icon: GitMerge,
    rows: [
      ['git merge --no-commit --no-ff <candidate>', '커밋 없이 merge 가능 여부와 충돌 여부를 확인합니다.'],
      ['git diff --name-only --diff-filter=U', '충돌 상태인 파일만 출력합니다.'],
      ['git status --porcelain', 'dry-run 중 작업공간의 변경 상태를 기계가 읽기 쉬운 형식으로 봅니다.'],
      ['git merge --abort', '수동 dry-run 중 충돌 merge를 되돌립니다. 임시 작업공간에서는 폐기로 정리합니다.'],
    ],
  },
]

const safetyRules = [
  '통합 머지 플랜 v1은 원격 merge, commit, push를 수행하지 않습니다.',
  '순차 검사에서 만드는 commit은 임시 작업공간 안에서만 다음 후보를 이어 붙이기 위한 로컬 커밋입니다.',
  '결과의 clean은 Git merge 충돌이 없다는 뜻이며, 배포 가능 판정을 단정하지 않습니다.',
  '화면 결과에 표시되는 명령 로그는 토큰과 인증 정보가 제거된 형태로만 보여줍니다.',
]

function CommandLine({ command, description }) {
  return (
    <div className="grid gap-2 border-t border-primary/10 py-3 first:border-t-0 sm:grid-cols-[minmax(220px,0.95fr)_minmax(0,1fr)]">
      <code className="min-w-0 overflow-x-auto rounded-lg border border-primary/15 bg-black/30 px-3 py-2 text-[11px] font-semibold text-amber-100 custom-scrollbar">
        {command}
      </code>
      <p className="min-w-0 text-xs leading-5 text-stone-400">{description}</p>
    </div>
  )
}

function CommandGroup({ group }) {
  const Icon = group.icon
  return (
    <section className="rounded-2xl border border-primary/15 bg-stone-950/35 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Icon size={16} className="text-primary" />
        <h3 className="text-sm font-bold text-stone-100">{group.title}</h3>
      </div>
      <div>
        {group.rows.map(([command, description]) => (
          <CommandLine key={command} command={command} description={description} />
        ))}
      </div>
    </section>
  )
}

function WorkflowStep({ step, index }) {
  return (
    <div className="grid gap-3 border-t border-primary/10 py-4 first:border-t-0 md:grid-cols-[36px_minmax(0,1fr)_minmax(260px,0.9fr)]">
      <div className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-xs font-black text-primary">
        {index + 1}
      </div>
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-stone-100">{step.title}</h3>
        <p className="mt-1 text-xs leading-5 text-stone-400">{step.detail}</p>
      </div>
      <code className="min-w-0 overflow-x-auto rounded-lg border border-primary/15 bg-black/30 px-3 py-2 text-[11px] font-semibold text-amber-100 custom-scrollbar">
        {step.command}
      </code>
    </div>
  )
}

function SwitchVsCheckout() {
  return (
    <section className="rounded-2xl border border-cyan-400/20 bg-cyan-950/10 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Code size={16} className="text-cyan-200" />
        <h3 className="text-sm font-bold text-stone-100">switch와 checkout 선택 기준</h3>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-cyan-400/15 bg-black/20 p-3">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200">git switch</p>
          <p className="mt-2 text-xs leading-5 text-stone-400">
            브랜치 이동과 생성 의도가 분명할 때 우선 사용합니다. 사람에게도 로그를 읽는 도구에게도 의미가 좁고 안전합니다.
          </p>
        </div>
        <div className="rounded-xl border border-cyan-400/15 bg-black/20 p-3">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200">git checkout</p>
          <p className="mt-2 text-xs leading-5 text-stone-400">
            특정 SHA를 detached로 열거나 오래된 스크립트와 호환할 때 사용합니다. 파일 복구 의미도 있어서 수동 작업에서는 더 조심해야 합니다.
          </p>
        </div>
      </div>
    </section>
  )
}

export default function GitCommandGuide() {
  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-6">
        <header className="flex flex-col gap-3 border-b border-primary/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-primary">
              <BookOpen size={14} />
              Git command reference
            </div>
            <h2 className="text-2xl font-black text-stone-50">상황별 Git 명령어 가이드</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-400">
              릴리즈 점검과 통합 머지 플랜에서 자주 쓰는 명령을 의도별로 정리했습니다. 실제 결과 화면의 명령 로그와 같이 보면 어떤 검사가 수행됐는지 추적하기 쉽습니다.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-950/20 px-3 py-2 text-xs font-bold text-emerald-200">
            <ShieldCheck size={14} />
            원격 변경 없는 dry-run 기준
          </div>
        </header>

        <section className="rounded-2xl border border-primary/15 bg-stone-950/35 p-4">
          <div className="mb-1 flex items-center gap-2">
            <GitMerge size={16} className="text-primary" />
            <h3 className="text-sm font-bold text-stone-100">통합 머지 플랜 내부 흐름</h3>
          </div>
          <p className="mb-3 text-xs leading-5 text-stone-500">
            후보 A, B, ...를 대상 C에 넣어본다고 가정할 때 사용하는 대표 명령입니다. 실제 구현은 토큰을 숨기고 임시 작업공간에서만 실행합니다.
          </p>
          {workflowSteps.map((step, index) => (
            <WorkflowStep key={step.title} step={step} index={index} />
          ))}
        </section>

        <SwitchVsCheckout />

        <div className="grid gap-4 xl:grid-cols-2">
          {commandGroups.map(group => (
            <CommandGroup key={group.title} group={group} />
          ))}
        </div>

        <section className="rounded-2xl border border-amber-400/20 bg-amber-950/10 p-4">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-200" />
            <h3 className="text-sm font-bold text-stone-100">해석할 때 주의할 점</h3>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {safetyRules.map(rule => (
              <div key={rule} className="rounded-xl border border-amber-400/15 bg-black/20 p-3 text-xs leading-5 text-stone-300">
                {rule}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
