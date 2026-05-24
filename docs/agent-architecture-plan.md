# Diff Lens Agent Architecture Plan

## MCP Review Summary

MCP feedback was consistent: Diff Lens should not turn every pipeline step into an
LLM agent. The product needs a deterministic Git backbone and a few constrained
LLM reviewers.

Useful agents/services:

- `GitRepositoryAgent`: deterministic GitLab/ref/compare/dry-run owner.
- `DiffTriageService`: deterministic file priority, scope, and coverage owner.
- `ImpactCandidateDiscoveryService`: deterministic-first impacted file candidate finder.
- `FileReviewAgent`: LLM-assisted review for one changed file.
- `ImpactReviewAgent`: LLM-assisted review for one unchanged impact candidate.
- `ReleaseRiskSummarizerAgent`: evidence-bound release summary narrator.
- `RunOrchestrator`: coordinates concurrency, SSE, cancellation, and cache. It is not
  itself a reviewer agent.

The rule is simple: if a task has a correct answer, use code. If a task needs
judgment over code behavior, use a constrained LLM agent.

## Agent Responsibilities

### GitRepositoryAgent

Purpose: one reusable owner for Git semantics.

Responsibilities:

- Resolve baseline and candidate refs into immutable SHAs.
- Detect ref drift against preview-locked SHAs.
- Fetch GitLab compare results with the selected strategy.
- Run dry-run merge conflict checks in a temporary checkout.
- Return auditable metadata that can be reused by preview, analyze-stream,
  merge-check, history, and bookmarked refs.

LLM usage: none.

Primary outputs:

- `ResolvedRefPair`
- `GitCompareSnapshot`
- `MergeCheckResult`-compatible dict

### DiffTriageService

Purpose: one reusable owner for deterministic file analysis scope.

Responsibilities:

- Attach triage score and reason codes to each direct file.
- Apply file status filters.
- Sort files by the requested analysis priority.
- Enforce `max_files`.
- Report coverage and skipped reasons so the UI does not imply that AI reviewed
  more than it actually did.

LLM usage: none.

Primary outputs:

- `DiffTriageResult`
- `coverage`
- `skipped_reasons`

### FileReviewAgent

Purpose: review one direct changed file.

Responsibilities:

- Read one file diff and deterministic evidence.
- Explain behavior/risk conservatively.
- Return structured findings in a later iteration.

LLM usage: yes, constrained.

### ImpactReviewAgent

Purpose: review one unchanged impact candidate.

Responsibilities:

- Explain why a candidate file may be affected.
- Keep direct-change facts separate from inferred impact.
- Recommend checks without claiming breakage.

LLM usage: yes, constrained.

### ReleaseRiskSummarizerAgent

Purpose: summarize direct facts, inferred candidates, and coverage gaps.

Responsibilities:

- Aggregate structured file review results.
- Keep dry-run results and AI inferences separate.
- Avoid deploy-safety claims.

LLM usage: optional and evidence-bound.

## Implementation Slices

### Slice 1: Deterministic backbone

- Add `GitRepositoryAgent`.
- Add `DiffTriageService`.
- Use them from v2 preview, analyze-stream, and merge-check.
- Add tests for ref drift, compare strategy, dry-run call semantics, triage
  reason codes, and coverage.

### Slice 2: Structured LLM results

- Add Pydantic result models for file and impact review findings.
- Make `FileReviewAgent` return structured JSON first, markdown second.
- Surface analysis coverage in SSE and UI.

### Slice 3: Verifier and impact hardening

- Add a `FindingVerifier` stage that checks whether LLM claims are supported by
  diff evidence or impact evidence.
- Add tree-sitter/import graph based impact discovery where useful.
- Add golden fixture repos for route/config/schema/test impact cases.

## Product Guardrails

- Dry-run merge checks never commit, push, or modify remote refs.
- A clean dry-run only means no textual merge conflicts were found.
- Direct Git diff files and AI impact candidates must remain visually and
  structurally separate.
- Every run should report how many files were analyzed, skipped, or capped.
