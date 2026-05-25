# Security Policy

Git Diff Lens handles repository tokens, optional LLM keys, and optional tracing keys. Treat local runtime files and debug logs as sensitive.

## Supported Versions

The `main` branch is the supported development line.

## Reporting a Vulnerability

If GitHub Security Advisories are available for this repository, please use a private advisory. If not, open a GitHub issue with only a high-level description and avoid posting tokens, exploit payloads, private repository URLs, or full logs.

Useful details:

- Affected workflow or endpoint.
- Whether the issue requires a configured Git token or LLM key.
- Minimal reproduction steps without secrets.
- Expected impact.

## Secret Handling Expectations

- Do not commit `.env`, SQLite databases, logs, or runtime cache directories.
- Use `.env.example` for public configuration examples.
- Redact GitLab tokens, OpenAI-compatible keys, Langfuse keys, Authorization headers, and private repository URLs before posting logs.
- Rotate any token that may have been exposed in a public issue, commit, screenshot, or log.

## Current Security Notes

- Job/cache request payloads sanitize known secret fields before persistence.
- Runtime logs redact common key/token patterns.
- Merge dry-run command logs redact repository URLs, Git tokens, and basic-auth payloads.
- Settings are designed for a local/single-user deployment. For multi-user hosted deployments, secret fields should be made write-only and returned only as presence flags or masked suffixes.
