# Diff Lens Agent Notes

## Long-running API Work

- Any API that can call an LLM, process files in batches, traverse Git history, fetch large Git compare payloads, run dry-run merge checks, or generate export summaries should expose a `/api/jobs/*` path backed by the DB job queue.
- Direct legacy endpoints may stay for backward compatibility, but new UI work should prefer job endpoints so the browser is not tied to one long HTTP request.
- Job cache keys must include the resolved Git SHAs or the exact sanitized request payload, compare strategy, model/prompt version when AI is involved, and relevant limits such as file count, batch size, impact depth, or template type.
- Failed jobs and timeout strings must not be cached as successful results. Deterministic fallback results are cacheable only when the payload records the fallback mode.

## File Size Rule

- Keep source files below 1000 lines. Split before adding substantial logic to an already large file.
- Generated files such as `package-lock.json`, build output, cache files, and vendored dependencies are exempt.
- When touching an existing oversized file, first look for a cohesive extraction point such as a router, service, agent, hook, utility module, or presentational component. Trivial one-line fixes may skip extraction, but larger feature work should reduce the oversized file instead of making it bigger.

## Oversized Inventory, 2026-05-15

- `frontend/src/components/Dashboard.jsx`: split into workflow hooks, ref picker components, merge-check panel, git report table, and AI memo/risk panels.
- `backend/main.py`: move API groups into routers (`jobs`, `compare`, `legacy_git`, `export`, `profiles`) and keep app setup only in `main.py`.
- `frontend/src/components/ExportModal.jsx`: split export job utilities, file-analysis tab, summary tab, template editors, and download helpers.
- `backend/src/git_client.py`: split GitLab API access, diff parsing, cache helpers, and dry-run merge utilities.
- `backend/src/export_agents.py`: custom group extraction and flat templates have been extracted; continue splitting field extraction, batch summary, and flat summary agents as they grow.
- `backend/src/agents.py`: pipeline orchestration and risk prompt generation have been extracted; continue splitting runtime/LLM helpers, file analysis agents, and history analysis as they grow.
- `backend/src/analysis_graph.py`: split graph wiring, impact discovery, per-file analysis, and release summary nodes.

## Current Job Endpoints

- `/api/jobs/preview`
- `/api/jobs/compare-preview-v2`
- `/api/jobs/merge-check-v2`
- `/api/jobs/compare-v2`
- `/api/jobs/analyze`
- `/api/jobs/history`
- `/api/jobs/risk-prompt`
- `/api/jobs/export/extract-fields`
- `/api/jobs/export/batch-summary`
- `/api/jobs/export/custom-group`
- `/api/jobs/export/flat-summary`
- `/api/jobs/export/batch-summary-stream`
- `/api/jobs/export/flat-summary-stream`
