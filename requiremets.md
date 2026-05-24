# [기획서] SemanticDiff AI Lite (최소 구현 버전)

이 문서는 DB와 Redis를 사용하지 않고, 환경 변수와 브라우저 저장소만으로 작동하는 최소 기능 제품(MVP)에 대한 개발 가이드라인입니다.

---

## 1. 프로젝트 개요
- **서비스명**: SemanticDiff AI Lite
- **목적**: 특정 커밋 시점 이후의 변경 사항을 추적하여 AI가 파일별/작업자별 수정 사항을 요약함.
- **핵심 아키텍처**: Frontend(Next.js) + Backend(FastAPI) + Docker Compose.

---

## 2. 시스템 아키텍처 및 데이터 흐름



1. **사용자**: UI에서 Git 설정(URL, Token, Project ID)과 분석 범위(Base Commit, Author) 입력.
2. **프론트엔드**: 입력된 민감 정보는 `localStorage`에 저장(보안 주의)하고, API 요청 시마다 백엔드로 전달.
3. **백엔드**: 전달받은 정보를 바탕으로 Git API(GitLab/GitHub)를 호출하여 Diff 데이터를 실시간 추출.
4. **AI 분석**: 추출된 Diff와 커밋 메시지를 AI 모델에 전달하여 요약본 생성 후 반환.

---

## 3. 환경 변수 관리 (.env)

프로젝트 루트 디렉토리에 `.env` 파일을 생성하여 다음과 같이 관리합니다.

```env
# Docker & System
BACKEND_PORT=8000
FRONTEND_PORT=3000

# Backend Settings
OPENAI_API_KEY=your_openai_api_key_here
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## 4. Docker Compose 구성

version: '3.8'
services:
  backend:
    build: ./backend
    ports:
      - "${BACKEND_PORT}:${BACKEND_PORT}"
    env_file:
      - .env
    environment:
      - PORT=${BACKEND_PORT}

  frontend:
    build: ./frontend
    ports:
      - "${FRONTEND_PORT}:${FRONTEND_PORT}"
    env_file:
      - .env
    environment:
      - NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

5. 주요 구현 상세
5.1 Backend (FastAPI)
Git 연동: python-gitlab 또는 PyGithub 라이브러리 사용.

Diff 처리:

Base Commit ID부터 현재까지의 파일별 변경분(diff)을 병합.

특정 Author(작성자) 필터링 로직 구현.

AI 분석 프롬프트:

"당신은 시니어 개발자입니다. 다음 Diff와 커밋 메시지를 보고 기술적인 수정 사항을 요약하세요."

"결과를 UI 수정 사항과 Backend 수정 사항으로 구분하여 마크다운 형식으로 작성하세요."

5.2 Frontend (Next.js + Tailwind CSS)
설정 페이지: Git API URL, 개인 액세스 토큰, 프로젝트 ID 입력 폼 제공.

분석 대시보드:

Base Commit ID 입력 필드 및 Author 필터 선택기.

좌측 섹션: 수정된 파일 목록 트리 뷰.

우측 섹션: AI가 생성한 요약 리포트 표시창 (Markdown 렌더링).

데이터 저장: 사용자가 입력한 설정값은 localStorage를 사용하여 브라우저 재방문 시 자동 로드.

6. AI 개발 지시용 프롬프트 (Copy & Paste)
개발용 AI에게 다음 내용을 전달하세요:

"기본 제공된 project_spec.py의 마크다운 기획서를 바탕으로 프로젝트를 생성해줘.

DB와 Redis 없이 오직 메모리와 API 통신으로만 구현해.

모든 설정값은 .env에서 관리하고, Git 토큰은 사용자로부터 입력받아 API 헤더로 넘겨줘.

FastAPI 백엔드에서는 GitLab API를 우선적으로 지원하도록 작성해줘.

프론트엔드는 Tailwind CSS를 사용해 깔끔한 다크 모드 UI로 만들어줘."