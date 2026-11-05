import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { validateResults } from '@testorchestrator/results-schema'
import {
  ciFacts,
  DEFAULT_RETRY,
  describeError,
  isCloseStep,
  retriedSuffix,
  warningsToShow,
  type IngestAccepted,
  type UploadOutcome,
  type UploadRequest,
} from '@testorchestrator/playwright-reporter'
import { DetectError, detectFormat, parseFormatInput, type Format } from './detect'
import { expandPatterns, splitPatterns } from './files'
import {
  appendSummary,
  error,
  getBooleanInput,
  getInput,
  info,
  setOutput,
  setSecret,
  warning,
  type Toolkit,
} from './toolkit'

export const VERSION = '1.0.0'

export interface FileReport {
  file: string
  format: Format | null
  body: IngestAccepted | null
  replay: boolean
  error: string | null
  /** The server's warnings worth showing (the empty-file warning is dropped for the close step). */
  warnings?: string[]
}

export interface RunDeps {
  upload: (req: UploadRequest) => Promise<UploadOutcome>
  cwd: string
}

const OUTCOMES = [
  'passed',
  'failed',
  'skipped',
  'errored',
  'timed_out',
  'flaky_passed',
  'inconclusive',
] as const

export interface Totals {
  files: number
  total: number
  matched: number
  unmatched: number
  superseded: number
  by_outcome: Record<(typeof OUTCOMES)[number], number>
}

export function totals(reports: FileReport[]): Totals {
  const t: Totals = {
    files: reports.length,
    total: 0,
    matched: 0,
    unmatched: 0,
    superseded: 0,
    by_outcome: Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Totals['by_outcome'],
  }
  for (const r of reports) {
    const c = r.body?.counts
    if (!c) continue
    t.total += c.total
    t.matched += c.matched
    t.unmatched += c.unmatched
    t.superseded += c.superseded
    for (const o of OUTCOMES) t.by_outcome[o] += c.by_outcome[o]
  }
  return t
}

function esc(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

export const LEFT_OPEN =
  "The run was not closed because a file failed; fix it and re-run the step, or the run closes by itself after the workspace's auto-close delay."

export function summaryMarkdown(
  reports: FileReport[],
  runRef: string | null,
  runId: number | null,
  runUrl: string | null,
  closed: boolean,
  leftOpen = false,
): string {
  const t = totals(reports)
  const title = runRef ? (runUrl ? `[${runRef}](${runUrl})` : runRef) : 'no run'
  const lines = [
    `### TestOrchestrator \u00b7 ${title}${runId !== null ? ` (run ${runId})` : ''} \u00b7 ${closed ? 'closed' : 'open'}`,
    '',
    `**${t.total} results** \u00b7 ${t.matched} matched \u00b7 ${t.unmatched} unmatched` +
      (t.superseded > 0 ? ` \u00b7 ${t.superseded} replaced` : '') +
      ' \u00b7 ' +
      OUTCOMES.filter((o) => t.by_outcome[o] > 0)
        .map((o) => `${t.by_outcome[o]} ${o}`)
        .join(' \u00b7 '),
    '',
    '| File | Format | Results | Matched | Unmatched | Passed | Failed | Skipped | Upload |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ]
  for (const r of reports) {
    const c = r.body?.counts
    const status = r.error ? `failed: ${esc(r.error)}` : r.replay ? 'already uploaded (replay)' : 'uploaded'
    const failed = c ? c.by_outcome.failed + c.by_outcome.errored + c.by_outcome.timed_out : null
    const cell = (n: number | null | undefined) => (n === null || n === undefined ? '\u2013' : String(n))
    lines.push(
      `| \`${esc(r.file)}\` | ${r.format ?? '\u2013'} | ${cell(c?.total)} | ${cell(c?.matched)} | ${cell(c?.unmatched)} | ${cell(c?.by_outcome.passed)} | ${cell(failed)} | ${cell(c?.by_outcome.skipped)} | ${status} |`,
    )
  }
  if (leftOpen) lines.push('', `**${LEFT_OPEN}**`)
  const warnings = reports.flatMap((r) =>
    (r.warnings ?? r.body?.warnings ?? []).map((w) => `- \`${esc(r.file)}\`: ${esc(w)}`),
  )
  if (warnings.length > 0) lines.push('', '**Warnings**', '', ...warnings)
  return lines.join('\n') + '\n'
}

/** The whole step. Returns the exit code (0 ok, 1 failed). Never throws for an upload problem. */
export async function run(tk: Toolkit, deps: RunDeps): Promise<number> {
  const apiKey = getInput(tk, 'api-key', true)
  setSecret(tk, apiKey)
  const project = getInput(tk, 'project', true)
  const patterns = splitPatterns(getInput(tk, 'files', true))
  const requested = parseFormatInput(getInput(tk, 'format'))
  const runKey = getInput(tk, 'run-key') || null
  const runName = getInput(tk, 'run-name') || null
  const environment = getInput(tk, 'environment') || null
  const tags = getInput(tk, 'tags')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '')
  const complete = getBooleanInput(tk, 'complete', true)
  const baseUrl = (getInput(tk, 'base-url') || 'https://api.testorchestrator.com').replace(/\/+$/, '')
  const projectUrl = getInput(tk, 'project-url').replace(/\/+$/, '') || null
  const failOnError = getBooleanInput(tk, 'fail-on-ingest-error', true)
  const ci = ciFacts(tk.env)

  const files = expandPatterns(patterns, deps.cwd)
  const reports: FileReport[] = []
  if (files.length === 0) {
    const message = `No file matches ${patterns.map((p) => `"${p}"`).join(', ')} (in ${deps.cwd}).`
    if (failOnError) {
      error(tk, message)
      return 1
    }
    warning(tk, message)
    return 0
  }

  // 1. read, detect and validate every file first, so a bad file is known before anything is uploaded
  const prepared: { report: FileReport; content: Buffer | null }[] = files.map((file) => {
    const report: FileReport = { file, format: null, body: null, replay: false, error: null }
    reports.push(report)
    let content: Buffer
    try {
      content = readFileSync(resolve(deps.cwd, file))
      report.format = detectFormat(file, content, requested)
    } catch (e) {
      report.error = e instanceof DetectError ? e.message : `${file}: ${(e as Error).message}`
      return { report, content: null }
    }
    if (report.format === 'to-results-json') {
      const v = validateResults(content)
      if (!v.valid) {
        report.error = `${file} is not valid to-results.json: ${v.errors
          .slice(0, 5)
          .map((e) => `${e.path}: ${e.message}`)
          .join('; ')}${v.errors.length > 5 ? ` (+${v.errors.length - 5} more)` : ''}`
        return { report, content: null }
      }
    }
    return { report, content }
  })

  // 2. upload; with a run key the run is closed by the last file only, and only when every file before it was
  //    read and uploaded - a run with a missing file is left open (it closes by itself after the auto-close delay)
  const uploadable = prepared.filter((p) => p.content !== null)
  let failures = prepared.length - uploadable.length
  for (const [i, { report, content }] of uploadable.entries()) {
    if (content === null || report.format === null) continue
    const last = i === uploadable.length - 1
    const closeNow = runKey === null ? complete : last && complete && failures === 0
    const outcome = await deps.upload({
      baseUrl,
      apiKey,
      content,
      format: report.format,
      fileName: basename(report.file),
      keyPrefix: 'gha',
      project,
      runKey,
      runName,
      environment,
      complete: closeNow,
      tags,
      ci,
      shard: { current: i + 1, total: uploadable.length },
      userAgent: `testorchestrator-report-results/${VERSION} node/${process.versions.node}`,
      retry: DEFAULT_RETRY,
    })
    if (outcome.ok) {
      report.body = outcome.body
      report.replay = outcome.replay
      report.warnings = warningsToShow(outcome.body, closeNow)
      const c = outcome.body.counts
      info(
        tk,
        `${report.file} (${report.format}): ${c.total} results \u2192 ${outcome.body.run_ref ?? 'no run'} \u00b7 ${c.matched} matched, ${c.unmatched} unmatched${outcome.replay ? ' \u00b7 already uploaded (replay)' : ''}${retriedSuffix(outcome.retries)}`,
      )
      if (isCloseStep(outcome.body, closeNow)) {
        info(
          tk,
          `closing run ${outcome.body.run_ref ?? ''}: ${report.file} holds no results, the upload only closes it`,
        )
      }
      for (const w of report.warnings) warning(tk, `${report.file}: ${w}`)
    } else {
      report.error = `${report.file}: ${describeError(outcome.error)}`
      failures++
    }
  }
  const leftOpen = complete && runKey !== null && failures > 0

  const lastBody = [...reports].reverse().find((r) => r.body?.run_id != null)?.body ?? null
  const runId = lastBody?.run_id ?? null
  const runRef = lastBody?.run_ref ?? null
  const runUrl =
    lastBody?.run_url ?? (projectUrl && runId !== null ? `${projectUrl}/test-runs/${runId}` : null)
  const closed = reports.some((r) => r.body?.complete === true)
  setOutput(tk, 'run-id', runId === null ? '' : String(runId))
  setOutput(tk, 'run-ref', runRef ?? '')
  setOutput(tk, 'run-url', runUrl ?? '')
  setOutput(tk, 'counts', JSON.stringify(totals(reports)))
  appendSummary(tk, summaryMarkdown(reports, runRef, runId, runUrl, closed, leftOpen))

  const failed = reports.filter((r) => r.error !== null)
  for (const f of failed) (failOnError ? error : warning)(tk, f.error ?? '')
  if (leftOpen) warning(tk, `${LEFT_OPEN} (${failed.length} of ${reports.length} file(s) failed)`)
  if (runRef) info(tk, `TestOrchestrator run: ${runRef}${runUrl ? ` ${runUrl}` : ''}`)
  return failed.length > 0 && failOnError ? 1 : 0
}
