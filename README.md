# Git Diff Lens

Git Diff Lens는 GitLab 프로젝트를 위한 **배포 전 Diff Briefing + Merge Dry-run + AI 리뷰 보조 도구**입니다.

작은 로컬 변경을 확인하는 용도라면 `git diff`가 더 빠르고 충분합니다. 이 도구의 목적은 단순히 "어떤 라인이 바뀌었나"를 보여주는 것이 아니라, 릴리즈나 병합 전에 개발자, 리뷰어, 배포 담당자가 다음 질문에 답하도록 돕는 것입니다.

- 배포 기준 버전과 개발 후보 버전 사이에 무엇이 달라졌나?
- 운영/기준 브랜치에만 있는 hotfix가 개발 후보에서 빠져 있지는 않은가?
- 지금 이 후보 브랜치를 대상 브랜치에 붙이면 충돌이 나는가?
- 여러 후보 브랜치를 순서대로 통합할 때 어디서 막히는가?
- 리뷰나 인수인계 문서에 어떤 변경 근거를 포함해야 하는가?

핵심 원칙은 **Git first, AI second**입니다. Git compare 결과, resolved SHA, dry-run merge 결과, 충돌 증거가 기준 데이터이고, AI는 그 근거를 요약하고 정리하는 보조 계층입니다. AI 결과는 코드 리뷰, 테스트, 배포 승인 판단을 대체하지 않습니다.

## 언제 쓰면 좋은가

Git Diff Lens가 유용한 경우:

- 릴리즈 또는 배포 전 변경 검토가 필요할 때
- 개발 후보 브랜치와 운영, staging, release tag, 특정 commit을 비교해야 할 때
- 기준 브랜치에만 존재하는 hotfix 누락 가능성을 확인해야 할 때
- merge request를 열거나 완료하기 전에 안전하게 merge dry-run을 돌리고 싶을 때
- 여러 후보 브랜치의 통합 순서를 정해야 할 때
- Markdown 또는 XLSX 형태의 리뷰/보고 자료가 필요할 때
- 큰 diff를 LLM으로 요약하되, 먼저 Git 근거를 고정하고 싶을 때

그냥 `git diff`나 GitLab MR diff로 충분한 경우:

- 한두 파일의 작은 변경만 확인하면 될 때
- 정확한 라인 변경만 보면 될 때
- 릴리즈 기준, hotfix drift, 병합 순서 문제가 없을 때
- AI 요약, export, 지속적인 검토 기록이 필요 없을 때

## 핵심 워크플로우

### 1. 커밋 비교

Base commit과 Target commit 또는 branch를 선택해 최종 Git 변경표를 생성합니다.

제공하는 정보:

- 파일 상태, 추가/삭제 라인, 관련 커밋
- 작성자 필터
- 최종 net diff와 history-only 파일
- 파일 트리 탐색과 diff 확인
- Markdown export
- Git report XLSX, 파일 x 커밋 heatmap XLSX

history-only 파일은 선택 범위 안에서 커밋이 파일을 건드렸지만 최종 snapshot 기준으로는 net diff가 없는 파일입니다. 단순 `git diff`에서는 놓치기 쉬운 "중간 작업 흔적"을 검토할 때 유용합니다.

### 2. 배포 전 Diff Briefing

개발 후보 버전과 배포 기준 버전을 비교합니다.

지원하는 비교 전략:

- `deployment_state`: 전체 상태 차이를 봅니다. 기준 버전에만 있는 파일/변경도 포함하므로, 후보 브랜치에 production hotfix가 빠졌는지 확인하기 좋습니다.
- `branch_delta`: 공통 기준 이후 개발 후보 브랜치의 작업분만 봅니다.

Preview 단계에서 baseline과 candidate의 resolved SHA를 잠급니다. 이후 분석이나 merge-check 실행 시 ref가 움직였으면 중단할 수 있어, "검토한 버전"과 "실행 시점 버전"이 달라지는 문제를 줄입니다.

### 3. Merge Dry-run

AI 설명을 보기 전에, 임시 로컬 Git 작업공간에서 실제 merge 가능 여부를 확인합니다.

dry-run 동작:

- 요청한 ref만 fetch
- remote 저장소를 변경하지 않고 merge check 수행
- clean, conflicts, unknown 상태 반환
- 충돌 파일, merge-base, 진단 정보 수집
- command log에서 token 노출 방지

이 기능은 단순 `git diff`가 안정적으로 답하지 못하는 질문에 답합니다.

```text
지금 source ref를 target ref에 merge하면 충돌이 나는가?
```

### 4. 통합 머지 플랜

release train이나 여러 후보 브랜치 통합 상황에서, 하나의 target branch에 여러 candidate를 붙여보는 워크플로우입니다.

수행하는 검사:

- 개별 dry-run: 각 후보를 target에 단독으로 merge
- 순차 dry-run: 선택한 후보 순서대로 merge 누적
- 첫 blocker 탐지: 순차 통합을 처음 막는 후보 식별
- 충돌 증거 수집: unmerged path, conflict marker block, stage variant, command history
- 선택적 AI review: dry-run 증거를 기반으로 충돌 원인과 다음 확인 순서 요약

remote merge, push, remote branch commit은 수행하지 않습니다. 순차 단계에서 만들어지는 commit은 disposable dry-run 작업공간 내부에서만 생성됩니다.

### 5. AI 리뷰 보조 계층

AI 기능은 선택 사항이며 Git 근거 위에 얹힙니다.

지원 모드:

- Git 변경표: AI 없이 가장 빠른 기본 경로
- 파일별 AI 메모: 파일 단위 변경 요약과 보수적 리스크 메모
- 선택 범위 요약: 리뷰/공유용 종합 요약
- 커밋 흐름 분석: 파일별 관련 커밋의 흐름 분석
- 영향 후보: 변경 파일의 path, import, symbol, route, config 근거로 주변 영향 파일 후보 탐색
- 리스크 리뷰 프롬프트/실행: 감지된 리스크 파일로 검토 요청 프롬프트 생성 후 LLM 실행

AI 결과는 테스트 통과, 배포 안전, 책임자 승인 의미가 아닙니다.

## 구조

```text
diff-lens/
|-- backend/
|   |-- main.py                 # FastAPI app setup and router registration
|   |-- routers/                # Compare, jobs, settings, profiles, legacy/export APIs
|   |-- src/
|   |   |-- git_client.py       # GitLab compare, refs, file content, commit data
|   |   |-- git_repository_agent.py
|   |   |-- git_merge_dry_run.py
|   |   |-- merge_plan_service.py
|   |   |-- job_queue.py
|   |   |-- job_store.py
|   |   |-- analysis_graph.py
|   |   `-- agents.py
|   `-- tests/
|-- frontend/
|   |-- src/App.jsx
|   `-- src/components/
|-- docker-compose.yml
`-- README.md
```

Backend:

- FastAPI
- SQLite, SQLModel 기반 profile/settings/bookmark/job 저장
- python-gitlab 기반 GitLab API 연동
- 로컬 Git command 기반 dry-run merge
- LangChain/LangGraph 기반 AI 분석 흐름
- OpenAI-compatible LLM 설정
- 선택적 Langfuse tracing

Frontend:

- Vite
- React
- Tailwind CSS
- Lucide icons
- job progress polling과 server-sent events

## Long-running 작업

시간이 오래 걸리는 작업은 `/api/jobs/*` endpoint와 SQLite job queue를 사용합니다. 브라우저가 긴 HTTP 요청 하나에 묶이지 않도록 하고, 진행률, 취소, 재사용 가능한 cache 결과를 제공합니다.

현재 job 기반 endpoint:

- `/api/jobs/preview`
- `/api/jobs/compare-preview-v2`
- `/api/jobs/merge-check-v2`
- `/api/jobs/merge-plan-v1`
- `/api/jobs/compare-v2`
- `/api/jobs/analyze`
- `/api/jobs/history`
- `/api/jobs/risk-prompt`
- `/api/jobs/risk-review-run`
- `/api/jobs/export/extract-fields`
- `/api/jobs/export/batch-summary`
- `/api/jobs/export/custom-group`
- `/api/jobs/export/flat-summary`
- `/api/jobs/export/batch-summary-stream`
- `/api/jobs/export/flat-summary-stream`

성공한 job 결과는 cache key가 안정적일 때 재사용됩니다. Cache key에는 resolved Git SHA 또는 sanitized payload, compare strategy, model/prompt 설정, 파일 수/영향 후보 수 같은 limit 값이 포함됩니다. 실패한 job은 성공 결과로 cache하지 않습니다.

## 설정

대부분의 설정은 UI의 Settings에서 관리할 수 있습니다.

- GitLab URL
- Personal access token
- Project ID 또는 project path
- Active branch
- LLM provider, base URL, API key, model
- Langfuse tracing 설정
- Prompt profile 설정

로컬 개발과 기본값을 위해 환경 변수도 사용할 수 있습니다.

```env
BACKEND_PORT=8000
FRONTEND_PORT=3000
VITE_API_URL=http://localhost:8000

# 선택: UI 설정으로 override 가능
GIT_URL=https://gitlab.example.com
GIT_TOKEN=glpat-your-token
PROJECT_ID=group/project

# AI 모드에서 필요
OPENAI_API_KEY=sk-your-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_MODEL=gpt-4o-mini

# 선택: tracing
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_HOST=https://cloud.langfuse.com

# 선택: 개발 중 DB 초기화
RESET_DB_ON_STARTUP=false
```

Git 변경표와 merge dry-run은 LLM key 없이도 사용할 수 있습니다. AI 모드는 LLM 설정이 필요합니다.

## Docker Compose 실행

```bash
docker-compose up --build
```

접속:

- Frontend: http://localhost:3000
- Backend: http://localhost:8000

## 로컬 개발 실행

Backend:

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## 기본 사용 순서

1. Settings에서 GitLab repository를 연결합니다.
2. 목적을 선택합니다.
   - 커밋 비교
   - 배포 전 점검
   - 통합 머지 플랜
3. baseline과 candidate ref 또는 commit을 선택합니다.
4. 먼저 Git 변경표를 생성합니다.
5. 배포 전 점검이라면 merge dry-run을 실행합니다.
6. Git 근거가 확정된 뒤 필요한 경우 AI 리뷰를 시작합니다.
7. 리뷰/공유가 필요하면 Markdown 또는 XLSX로 export합니다.

## 안전성 메모

- Merge check는 임시 로컬 작업공간에서 실행됩니다.
- remote branch에 push, merge, commit을 수행하지 않습니다.
- 순차 merge-plan의 commit은 disposable dry-run 작업공간 내부에서만 생성됩니다.
- ref drift guard로 preview 이후 branch가 움직인 경우 분석을 중단할 수 있습니다.
- 민감한 request field는 job 저장과 cache record에서 sanitize됩니다.
- AI output은 리뷰 보조 자료이며 배포 승인 근거가 아닙니다.

## 개발 검증

Backend tests:

```bash
python -m pytest backend/tests -q
```

Frontend build:

```bash
cd frontend
npm run build
```

## 한 줄 포지셔닝

일상적인 라인 변경 확인은 `git diff`로 충분합니다. Git Diff Lens는 release/integration decision을 위해 Git 근거를 briefing으로 바꾸는 도구입니다. 후보를 비교하고, 기준 버전 전용 변경을 찾고, merge dry-run을 돌리고, 필요한 경우 AI가 근거를 요약하게 한 뒤, 리뷰 자료로 export합니다.
