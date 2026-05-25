# Contributing

Git Diff Lens is a Git-first review tool. Contributions should preserve that posture: deterministic Git evidence comes before AI interpretation.

## Development Setup

1. Create your local environment file:

```bash
cp .env.example .env
```

2. Start the app with Docker Compose:

```bash
docker-compose up --build
```

3. Or run services separately:

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

```bash
cd frontend
npm install
npm run dev
```

## Before Opening a Pull Request

Run the backend test suite:

```bash
python -m pytest backend/tests -q
```

Run the frontend production build:

```bash
cd frontend
npm run build
```

For Git compare, job queue, merge dry-run, cache, or AI behavior changes, add or update tests in `backend/tests`.

## Pull Request Guidelines

- Keep source files under 1000 lines where practical.
- Prefer `/api/jobs/*` endpoints for long-running work.
- Include resolved Git SHAs, compare strategy, model/prompt version, and relevant limits in cache keys.
- Never cache failed jobs as successful results.
- Treat AI output as review assistance, not deployment approval.
- Do not commit `.env`, SQLite databases, logs, build output, or Git object caches.

## Reporting Bugs

Please include:

- What workflow you used: commit compare, pre-deploy check, merge plan, export, or AI review.
- Baseline and candidate ref types, without private tokens.
- Whether the issue happened in Git-only mode or AI mode.
- Relevant backend/frontend logs with secrets removed.

## Security

Please read `SECURITY.md` before reporting vulnerabilities or sharing logs.
