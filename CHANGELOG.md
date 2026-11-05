# Changelog

All notable changes to the `testorchestratorhq/report-results` Action. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); releases are tagged `vX.Y.Z` and the moving major tag
`v1` points at the latest `v1.x.y`.

## [Unreleased]

## [1.0.0] - 2026-11-05

### Added

- Upload JUnit XML, Playwright JSON and `to-results.json` files (glob patterns, `!` excludes) to
  `POST /api/v1/ingest/results`; `format: auto` detects the format by extension and content.
- `to-results.json` files are validated with `@testorchestrator/results-schema` before upload.
- Inputs `api-key` (masked), `project`, `files`, `format`, `run-key`, `run-name`, `environment`, `tags`,
  `complete`, `base-url`, `project-url`, `fail-on-ingest-error`; outputs `run-id`, `run-ref`, `run-url`, `counts`.
- Job summary with the run, totals, one row per file and the server's warnings.
- `Idempotency-Key` per file from run key, position, form fields and content; retries for 429 / 5xx / 409 BUSY / network
  errors honouring `Retry-After`.
