# TestOrchestrator: report test results

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
![Runs on Node 24](https://img.shields.io/badge/runs%20on-node24-brightgreen.svg)

A GitHub Action that uploads your test results to [TestOrchestrator](https://testorchestrator.com) test
management in one step, whatever runs your tests: **pytest, Jest, JUnit / Maven / Gradle, Vitest, Cypress**
(JUnit XML), **Playwright** (its JSON report) or TestOrchestrator's own
[`to-results.json`](https://testorchestrator.com/schemas/to-results.v1.json). Every result lands on a test run
named after the job, linked to the test case it automates; anything that matches no case is kept on the run's
**Unmatched** tab to link later. The step prints the run, writes a job summary and gives you the run id and
counts as outputs.

```yaml
- name: Report to TestOrchestrator
  if: ${{ !cancelled() }} # report failures too
  uses: testorchestratorhq/report-results@v1
  with:
    api-key: ${{ secrets.TO_API_KEY }}
    project: prj_8kd2hq0vxc1a
    files: reports/*.xml
```

`@v1` follows the latest 1.x release. Pinning a full commit sha (`testorchestratorhq/report-results@<sha>`) is the
stricter alternative.

## Before you start

1. **A workspace service key.** A Tenant Admin creates one in TestOrchestrator under **Settings → API keys →
   Workspace service keys**. Add it to the repository as the secret `TO_API_KEY` (**Settings → Secrets and
   variables → Actions**). The Action masks it in the log.
2. **The project's `prj_` id**, shown on the project's settings page in TestOrchestrator (never the number in
   the app's URL).
3. **Cases for the results to find.** A result links to a case when the case's **automation key** equals the
   test's id, or when the test names the case (`C-123` in its name, a tag, an annotation or a JUnit
   `<property>`). The first run is often all unmatched: the run's **Unmatched** tab shows each test id, and
   **Link to case** writes it as that case's key so the next run matches by itself.

## Examples

Complete workflows, each tested with the real test runner and reporter:
[Playwright](./examples/workflows/playwright.yml) · [pytest](./examples/workflows/pytest.yml) ·
[Jest](./examples/workflows/jest.yml) (projects in [`examples/`](./examples)).

**pytest**

```yaml
- run: pytest --junitxml=reports/pytest.xml
- if: ${{ !cancelled() }}
  uses: testorchestratorhq/report-results@v1
  with:
    api-key: ${{ secrets.TO_API_KEY }}
    project: prj_8kd2hq0vxc1a
    files: reports/*.xml
```

**Jest** (with [jest-junit](https://www.npmjs.com/package/jest-junit))

```yaml
- run: npx jest --ci --reporters=default --reporters=jest-junit
- if: ${{ !cancelled() }}
  uses: testorchestratorhq/report-results@v1
  with:
    api-key: ${{ secrets.TO_API_KEY }}
    project: prj_8kd2hq0vxc1a
    files: reports/jest-junit.xml
```

**Playwright** (its `json` reporter; or use
[`@testorchestrator/playwright-reporter`](https://www.npmjs.com/package/@testorchestrator/playwright-reporter)
and skip this step)

```yaml
- run: npx playwright test # reporter: [['json', { outputFile: 'playwright-report/results.json' }]]
- if: ${{ !cancelled() }}
  uses: testorchestratorhq/report-results@v1
  with:
    api-key: ${{ secrets.TO_API_KEY }}
    project: prj_8kd2hq0vxc1a
    files: playwright-report/results.json
```

## Inputs

| Input                  | Required | Default                                          | What it does                                                                                                                                                                                             |
| ---------------------- | -------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api-key`              | yes      |                                                  | Workspace service key (`ingest:results` scope). Pass it from a secret. Masked.                                                                                                                           |
| `project`              | yes      |                                                  | The project's `prj_` id. With a project key it must be that key's project.                                                                                                                               |
| `files`                | yes      |                                                  | Glob patterns, separated by new lines or commas; `!pattern` excludes. Each file is one upload, in name order.                                                                                            |
| `format`               | no       | `auto`                                           | `auto`, `junit-xml`, `playwright-json`, `to-results-json` (`to-json` also works). `auto`: `.xml` is JUnit XML; JSON with `suites` is Playwright; JSON with `version` and `results` is `to-results.json`. |
| `run-key`              | no       | `${{ github.run_id }}-${{ github.run_attempt }}` | Uploads with the same key land on one run. **Re-run jobs** gets a new attempt, so a new run.                                                                                                             |
| `run-name`             | no       | `CI · <branch> · #<build>`                       | Name of a new run.                                                                                                                                                                                       |
| `environment`          | no       |                                                  | One Environment for every result. Leave it empty when results carry their own configuration (a Playwright project name, matched to the Environment of the same name).                                    |
| `tags`                 | no       |                                                  | Comma-separated Automation tag names for the run. Unknown names are reported in the warnings, never created.                                                                                             |
| `complete`             | no       | `true`                                           | Close the run with the last file — only when every file was uploaded ([When the run closes](#when-the-run-closes)). Set `false` in matrix / shard jobs and close the run from a final job.               |
| `base-url`             | no       | `https://api.testorchestrator.com`               | API host.                                                                                                                                                                                                |
| `project-url`          | no       |                                                  | Your project's address in the app (`https://testorchestrator.com/<workspace>/projects/<n>`), to produce `run-url` and a link in the summary.                                                             |
| `fail-on-ingest-error` | no       | `true`                                           | Fail the step when a file cannot be read, an upload is refused or the TestOrchestrator API cannot be reached. `false` reports it as a warning and the step passes.                                       |

## Outputs

| Output    | Example                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------- |
| `run-id`  | `41` — the number in the run's URL                                                             |
| `run-ref` | `TR-12`                                                                                        |
| `run-url` | the run's link, when `project-url` is set                                                      |
| `counts`  | `{"files":1,"total":7,"matched":1,"unmatched":6,"superseded":0,"by_outcome":{"passed":5,...}}` |

```yaml
- id: report
  uses: testorchestratorhq/report-results@v1
  with: { api-key: '${{ secrets.TO_API_KEY }}', project: prj_8kd2hq0vxc1a, files: 'reports/*.xml' }
- run: echo "Results are on ${{ steps.report.outputs.run-ref }}"
```

## What the step does

- Reads every matching file and works out its format; a `to-results.json` file is checked against the
  [schema](https://testorchestrator.com/schemas/to-results.v1.json) first, with the same messages the server
  uses (`/results/3/outcome: "outcome" must be one of …`), and is not uploaded when it is invalid.
- Uploads each file to `POST /api/v1/ingest/results` with the run key, the CI facts of the job (branch,
  commit, run number, actor, a link to the workflow run) and an `Idempotency-Key` made from the run key, the
  file's position, the upload's fields and its content: a retried request gets the first answer back and
  nothing is written twice. **Re-run jobs** has a new attempt number, so it uploads to a new run.
- Retries, up to 5 times with a backoff of up to 1, 2, 4, 8 and 16 s (or the `Retry-After` the server sends, up
  to 120 s): `429`, `5xx`, `409 BUSY`, and the network errors that can heal (`ECONNREFUSED`, `ECONNRESET`,
  `ETIMEDOUT`, `EAI_AGAIN`, any other socket error). Does not retry `ENOTFOUND`, `EHOSTUNREACH`, `ENETUNREACH`
  or any other refusal. Each retry is written to the debug log (re-run with debug logging to see it); the
  file's line ends with `retried N times`.
- Closes the run with the last file when `complete` is `true` and every file before it was uploaded.
- Writes a job summary (the run, totals, one row per file, the server's warnings) and the outputs.

## When the run closes

With `complete: true` (the default) the run is closed by the last file's upload, **and only when every file was
read and uploaded**. If a file cannot be read, is not valid, or is refused, the run is left open, the job
summary and the log say so, and the step fails (with `fail-on-ingest-error: true`); re-run the step once the file
is fixed, or let the run close by itself after the workspace's auto-close delay.

## Matrix and sharded jobs

TestOrchestrator closes a run as soon as one upload says `complete`, and parallel jobs finish in any order. So
every job uploads with the same `run-key` and `complete: false`, and one job that `needs:` them all closes the run
with an empty file:

```yaml
jobs:
  test:
    strategy: { matrix: { shard: [1, 2, 3] } }
    runs-on: ubuntu-latest
    steps:
      # … checkout, install …
      - run: npx playwright test --shard=${{ matrix.shard }}/3
      - if: ${{ !cancelled() }}
        uses: testorchestratorhq/report-results@v1
        with:
          api-key: ${{ secrets.TO_API_KEY }}
          project: prj_8kd2hq0vxc1a
          files: playwright-report/results.json
          complete: false

  close-run:
    needs: test
    if: ${{ !cancelled() }}
    runs-on: ubuntu-latest
    steps:
      - run: printf '' > close.json # an empty file: no results, it only closes the run
      - uses: testorchestratorhq/report-results@v1
        with:
          api-key: ${{ secrets.TO_API_KEY }}
          project: prj_8kd2hq0vxc1a
          files: close.json
          complete: true
```

All jobs of one workflow run share the default `run-key` (`<run id>-<run attempt>`). Without the final job, the
run closes by itself after the workspace's auto-close delay.

## Troubleshooting

| In the log                                                                    | What to do                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `No file matches "reports/*.xml"`                                             | The test step wrote elsewhere, or did not run. Check the path relative to the repository root.                                                                                                                                                  |
| `401 API_KEY_UNAUTHORIZED: A valid workspace service key is required.`        | The secret is missing, wrong, revoked, or a personal key. Use a workspace service key.                                                                                                                                                          |
| `403 KEY_PROJECT_MISMATCH: This key cannot report to that project…`           | `project` is not this key's project, or the `prj_` id is wrong.                                                                                                                                                                                 |
| `400 INVALID_PROJECT_ID: project must be a project id like prj_8kd2hq0vxc1a…` | Use the `prj_` id from the project's settings page, not the number in the URL.                                                                                                                                                                  |
| `409 RUN_CLOSED: That run is closed. Upload with a new run_key.`              | An earlier upload closed the run for this key. Keep the default `run-key` (it includes the attempt), or close from a final job.                                                                                                                 |
| `… is not valid to-results.json: /results/0/outcome: …`                       | Fix the file the pointer names; check it locally with `npx -p @testorchestrator/results-schema to-results-validate results.json`.                                                                                                               |
| `already uploaded (replay)`                                                   | The same file was uploaded earlier with the same key; nothing was written twice.                                                                                                                                                                |
| `… 2 results → TR-12 · 2 matched, 0 unmatched; retried 1 time`                | Nothing: the step waited (for `429`, as `Retry-After` said) and sent it again. With debug logging each attempt shows as `upload: 429 RATE_LIMIT_EXCEEDED; retry 1/5 in 2.0 s (Retry-After)`. Repeated `429`: you upload more than once per job. |
| `could not connect to https://… (ENOTFOUND)`                                  | No such host: check `base-url`. Not retried.                                                                                                                                                                                                    |
| `closing run TR-12: close.json holds no results, the upload only closes it`   | The close step worked: an empty file with `complete: true`. An empty file without `complete` gets the warning `The file holds no test results.` instead.                                                                                        |

Full docs: [CI integrations](https://testorchestrator.com/docs/api-keys/ci-integrations) ·
[Report automated results](https://testorchestrator.com/docs/api-keys/report-automated-results).

## Development

`src/` is TypeScript, bundled with esbuild into `dist/index.js`, which is committed (the Action runs it on
Node 24 with no `npm install`). `npm run check:dist` fails when `dist/` is not the build of `src/`; CI runs it.
See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE) © Test Orchestrator Ltd
