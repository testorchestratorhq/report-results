import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UploadOutcome, UploadRequest } from '@testorchestrator/playwright-reporter'
import { detectFormat, parseFormatInput, DetectError } from '../src/detect'
import { expandPatterns, splitPatterns } from '../src/files'
import { run, summaryMarkdown, totals, type FileReport } from '../src/run'
import { getBooleanInput, getInput, setOutput, setSecret, type Toolkit } from '../src/toolkit'

const KEY = 'tok_action_secret_never_printed'
const JUNIT =
  '<?xml version="1.0"?>\n<testsuites><testsuite name="s"><testcase classname="c" name="t"/></testsuite></testsuites>'
const PW = JSON.stringify({ config: {}, suites: [] })
const TO = JSON.stringify({ version: 1, results: [{ test_id: 'a', title: 'a', outcome: 'passed' }] })

function body(over: Record<string, unknown> = {}) {
  return {
    ingest_id: 'ing_1',
    status: 'accepted',
    run_id: 41,
    run_ref: 'TR-7',
    run_key: 'k',
    complete: false,
    warnings: [],
    counts: {
      total: 2,
      matched: 1,
      unmatched: 1,
      unmatched_overflow: 0,
      superseded: 0,
      by_outcome: {
        passed: 1,
        failed: 1,
        skipped: 0,
        errored: 0,
        timed_out: 0,
        flaky_passed: 0,
        inconclusive: 0,
      },
    },
    ...over,
  }
}

function workspace(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'rr-'))
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true })
    writeFileSync(join(dir, name), content)
  }
  return dir
}

function toolkit(inputs: Record<string, string>, extraEnv: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rr-gh-'))
  const env: Record<string, string> = {
    GITHUB_OUTPUT: join(dir, 'out'),
    GITHUB_STEP_SUMMARY: join(dir, 'summary'),
    ...extraEnv,
  }
  writeFileSync(env.GITHUB_OUTPUT ?? '', '')
  writeFileSync(env.GITHUB_STEP_SUMMARY ?? '', '')
  for (const [k, v] of Object.entries(inputs)) env[`INPUT_${k.toUpperCase()}`] = v
  const lines: string[] = []
  const tk: Toolkit = { env, write: (l) => lines.push(l) }
  const outputs = () => {
    const text = readFileSync(env.GITHUB_OUTPUT ?? '', 'utf8')
    const out: Record<string, string> = {}
    const re = /^([\w-]+)<<(ghadelimiter_[\w-]+)\r?\n([\s\S]*?)\r?\n\2$/gm
    for (let m = re.exec(text); m; m = re.exec(text)) out[m[1] ?? ''] = m[3] ?? ''
    return out
  }
  return { tk, lines, outputs, summary: () => readFileSync(env.GITHUB_STEP_SUMMARY ?? '', 'utf8') }
}

function fakeUpload(answer: (req: UploadRequest, n: number) => UploadOutcome) {
  const calls: UploadRequest[] = []
  return {
    calls,
    upload: (req: UploadRequest) => {
      calls.push(req)
      return Promise.resolve(answer(req, calls.length))
    },
  }
}

const base = {
  'api-key': KEY,
  project: 'prj_8kd2hq0vxc1a',
  'run-key': '99-1',
  'base-url': 'http://127.0.0.1:9',
}

test('format input: auto, the three formats, the to-json alias', () => {
  assert.equal(parseFormatInput(''), 'auto')
  assert.equal(parseFormatInput('AUTO'), 'auto')
  assert.equal(parseFormatInput('to-json'), 'to-results-json')
  assert.equal(parseFormatInput('junit-xml'), 'junit-xml')
  assert.throws(() => parseFormatInput('xunit'), /must be auto, junit-xml/)
})

test('auto-detection by extension and content', () => {
  assert.equal(detectFormat('r.xml', Buffer.from(JUNIT), 'auto'), 'junit-xml')
  assert.equal(detectFormat('report', Buffer.from('<testsuite name="x"></testsuite>'), 'auto'), 'junit-xml')
  assert.equal(detectFormat('r.json', Buffer.from(PW), 'auto'), 'playwright-json')
  assert.equal(detectFormat('r.json', Buffer.from('\ufeff' + TO), 'auto'), 'to-results-json')
  assert.equal(detectFormat('r.json', Buffer.from(''), 'auto'), 'to-results-json')
  assert.equal(detectFormat('r.txt', Buffer.from('anything'), 'junit-xml'), 'junit-xml')
  assert.throws(() => detectFormat('r.xml', Buffer.from('<html></html>'), 'auto'), DetectError)
  assert.throws(
    () => detectFormat('r.json', Buffer.from('{"a":1}'), 'auto'),
    /neither a Playwright JSON report/,
  )
  assert.throws(() => detectFormat('r.json', Buffer.from('{oops'), 'auto'), /not valid JSON/)
  assert.throws(() => detectFormat('r.txt', Buffer.from('plain'), 'auto'), /cannot tell the format/)
})

test('files: patterns split by new lines and commas, sorted, deduplicated, ! excludes', () => {
  assert.deepEqual(splitPatterns('a/*.xml,\n b.json \n\n'), ['a/*.xml', 'b.json'])
  const dir = workspace({
    'r/b.xml': JUNIT,
    'r/a.xml': JUNIT,
    'r/skip.xml': JUNIT,
    'r/sub/c.xml': JUNIT,
    'x.json': TO,
  })
  assert.deepEqual(expandPatterns(['r/**/*.xml', 'r/a.xml', '!r/skip.xml'], dir), [
    'r/a.xml',
    'r/b.xml',
    'r/sub/c.xml',
  ])
  assert.deepEqual(expandPatterns(['nothing/*.xml'], dir), [])
})

test('toolkit: inputs, booleans, masking, outputs', () => {
  const { tk, lines, outputs } = toolkit({ name: ' v ', flag: 'false' })
  assert.equal(getInput(tk, 'name'), 'v')
  assert.throws(() => getInput(tk, 'missing', true), /Input required and not supplied: missing/)
  assert.equal(getBooleanInput(tk, 'flag', true), false)
  assert.equal(getBooleanInput(tk, 'missing', true), true)
  tk.env.INPUT_BAD = 'maybe'
  assert.throws(() => getBooleanInput(tk, 'bad', true), /must be true or false/)
  setSecret(tk, 'a%b\nc')
  assert.equal(lines[0], '::add-mask::a%25b%0Ac')
  setOutput(tk, 'counts', '{"a":1}')
  assert.deepEqual(outputs(), { counts: '{"a":1}' })
  const noFile: Toolkit = { env: {}, write: (l) => lines.push(l) }
  setOutput(noFile, 'x', 'y')
  assert.equal(lines.at(-1), 'x=y')
})

test('uploads every file (complete only on the last), masks the key, writes outputs and the job summary', async () => {
  const dir = workspace({ 'results/pytest.xml': JUNIT, 'results/pw.json': PW, 'results/own.json': TO })
  const fake = fakeUpload((req, n) => ({
    ok: true,
    retries: 0,
    body: body({ complete: req.complete, run_id: 41, warnings: n === 1 ? ['w1'] : [] }) as never,
    replay: false,
    idempotencyKey: 'x',
  }))
  const g = toolkit(
    { ...base, files: 'results/*', 'project-url': 'https://testorchestrator.com/acme/projects/6/' },
    {
      GITHUB_ACTIONS: 'true',
      GITHUB_SHA: 'abc',
      GITHUB_REF_NAME: 'main',
    },
  )
  assert.equal(await run(g.tk, { upload: fake.upload, cwd: dir }), 0)
  assert.equal(g.lines[0], `::add-mask::${KEY}`)
  assert.deepEqual(
    fake.calls.map((c) => [
      c.fileName,
      c.format,
      c.complete,
      c.shard?.current,
      c.project,
      c.runKey,
      c.keyPrefix,
    ]),
    [
      ['own.json', 'to-results-json', false, 1, 'prj_8kd2hq0vxc1a', '99-1', 'gha'],
      ['pw.json', 'playwright-json', false, 2, 'prj_8kd2hq0vxc1a', '99-1', 'gha'],
      ['pytest.xml', 'junit-xml', true, 3, 'prj_8kd2hq0vxc1a', '99-1', 'gha'],
    ],
  )
  assert.deepEqual(fake.calls[0]?.ci, { ci_provider: 'github', ci_branch: 'main', ci_commit: 'abc' })
  const out = g.outputs()
  assert.equal(out['run-id'], '41')
  assert.equal(out['run-ref'], 'TR-7')
  assert.equal(out['run-url'], 'https://testorchestrator.com/acme/projects/6/test-runs/41')
  assert.deepEqual(JSON.parse(out.counts ?? '{}'), {
    files: 3,
    total: 6,
    matched: 3,
    unmatched: 3,
    superseded: 0,
    by_outcome: {
      passed: 3,
      failed: 3,
      skipped: 0,
      errored: 0,
      timed_out: 0,
      flaky_passed: 0,
      inconclusive: 0,
    },
  })
  const summary = g.summary()
  assert.match(
    summary,
    /### TestOrchestrator \u00b7 \[TR-7\]\(https:\/\/testorchestrator\.com\/acme\/projects\/6\/test-runs\/41\) \(run 41\) \u00b7 closed/,
  )
  assert.match(
    summary,
    /\*\*6 results\*\* \u00b7 3 matched \u00b7 3 unmatched \u00b7 3 passed \u00b7 3 failed/,
  )
  assert.match(summary, /\| `results\/pytest\.xml` \| junit-xml \| 2 \| 1 \| 1 \| 1 \| 1 \| 0 \| uploaded \|/)
  assert.match(summary, /- `results\/own\.json`: w1/)
  assert.ok(g.lines.some((l) => l === '::warning::results/own.json: w1'))
  assert.ok(!g.summary().includes(KEY) && !g.lines.slice(1).some((l) => l.includes(KEY)))
})

test('an invalid to-results.json is not uploaded; fail-on-ingest-error decides the exit code', async () => {
  const dir = workspace({
    'bad.json': JSON.stringify({ version: 1, results: [{ test_id: 'a', title: 'a', outcome: 'PASS' }] }),
    'ok.xml': JUNIT,
  })
  const fake = fakeUpload(() => ({
    ok: true,
    retries: 0,
    body: body() as never,
    replay: false,
    idempotencyKey: 'x',
  }))
  const strict = toolkit({ ...base, files: '*.json,*.xml' })
  assert.equal(await run(strict.tk, { upload: fake.upload, cwd: dir }), 1)
  assert.deepEqual(
    fake.calls.map((c) => c.fileName),
    ['ok.xml'],
  )
  assert.ok(
    strict.lines.some((l) =>
      l.startsWith('::error::bad.json is not valid to-results.json: /results/0/outcome: '),
    ),
  )
  assert.match(
    strict.summary(),
    /\| `bad\.json` \| to-results-json \| \u2013 \| \u2013 \| \u2013 \| \u2013 \| \u2013 \| \u2013 \| failed: bad\.json is not valid/,
  )
  const lenient = toolkit({ ...base, files: '*.json', 'fail-on-ingest-error': 'false' })
  assert.equal(await run(lenient.tk, { upload: fake.upload, cwd: dir }), 0)
  assert.ok(lenient.lines.some((l) => l.startsWith('::warning::bad.json is not valid')))
})

test('a refused upload is reported with the code and the hint', async () => {
  const dir = workspace({ 'r.xml': JUNIT })
  const fake = fakeUpload(() => ({
    ok: false,
    error: {
      status: 409,
      errorCode: 'RUN_CLOSED',
      message: 'That run is closed. Upload with a new run_key.',
      details: null,
      retryAfterSeconds: null,
    },
    idempotencyKey: 'x',
  }))
  const g = toolkit({ ...base, files: 'r.xml' })
  assert.equal(await run(g.tk, { upload: fake.upload, cwd: dir }), 1)
  assert.ok(
    g.lines.some(
      (l) =>
        l.startsWith('::error::r.xml: 409 RUN_CLOSED: That run is closed.') &&
        l.includes('new run key per CI attempt'),
    ),
  )
  assert.deepEqual(g.outputs()['run-id'], '')
})

test('a replay is shown as already uploaded; no files is an error or a warning', async () => {
  const dir = workspace({ 'r.xml': JUNIT })
  const fake = fakeUpload(() => ({
    ok: true,
    retries: 0,
    body: body({ complete: true }) as never,
    replay: true,
    idempotencyKey: 'x',
  }))
  const g = toolkit({ ...base, files: 'r.xml' })
  assert.equal(await run(g.tk, { upload: fake.upload, cwd: dir }), 0)
  assert.match(g.summary(), /already uploaded \(replay\)/)
  assert.ok(g.lines.some((l) => l.includes('already uploaded (replay)')))
  const none = toolkit({ ...base, files: 'missing/*.xml' })
  assert.equal(await run(none.tk, { upload: fake.upload, cwd: dir }), 1)
  assert.ok(none.lines.some((l) => l.startsWith('::error::No file matches "missing/*.xml"')))
  const soft = toolkit({ ...base, files: 'missing/*.xml', 'fail-on-ingest-error': 'false' })
  assert.equal(await run(soft.tk, { upload: fake.upload, cwd: dir }), 0)
})

test('required inputs', async () => {
  const g = toolkit({ project: 'prj_x', files: 'x' })
  await assert.rejects(
    run(g.tk, { upload: () => Promise.reject(new Error('no')), cwd: '.' }),
    /Input required and not supplied: api-key/,
  )
})

test('summary and totals with no answers', () => {
  const reports: FileReport[] = [
    { file: 'a|b.xml', format: null, body: null, replay: false, error: 'boom\nline' },
  ]
  assert.equal(totals(reports).total, 0)
  assert.match(
    summaryMarkdown(reports, null, null, null, false),
    /### TestOrchestrator \u00b7 no run \u00b7 open[\s\S]*\| `a\\\|b\.xml` \| \u2013 \|[\s\S]*failed: boom line/,
  )
})

test('the run is closed only when every file was read and uploaded', async () => {
  const dir = workspace({
    'a.xml': JUNIT,
    'b.xml': JUNIT,
    'c.json': '{"version":1,"results":[{"test_id":"a"}]}',
  })
  const fake = fakeUpload((req) => ({
    ok: true,
    retries: 0,
    body: body({ complete: req.complete }) as never,
    replay: false,
    idempotencyKey: 'x',
  }))
  const g = toolkit({ ...base, files: '*.xml,*.json' })
  assert.equal(await run(g.tk, { upload: fake.upload, cwd: dir }), 1)
  assert.deepEqual(
    fake.calls.map((c) => [c.fileName, c.complete]),
    [
      ['a.xml', false],
      ['b.xml', false],
    ],
  )
  assert.match(g.summary(), /The run was not closed because a file failed/)
  assert.ok(
    g.lines.some(
      (l) =>
        l.startsWith('::warning::The run was not closed because a file failed') &&
        l.includes('(1 of 3 file(s) failed)'),
    ),
  )
})

test('a refused upload before the last file keeps the run open', async () => {
  const dir = workspace({ 'a.xml': JUNIT, 'b.xml': JUNIT })
  const fake = fakeUpload((req, n) =>
    n === 1
      ? {
          ok: false,
          error: {
            status: 503,
            errorCode: 'INGEST_NOT_AVAILABLE',
            message: 'off',
            details: null,
            retryAfterSeconds: null,
          },
          idempotencyKey: 'x',
        }
      : {
          ok: true,
          retries: 0,
          body: body({ complete: req.complete }) as never,
          replay: false,
          idempotencyKey: 'x',
        },
  )
  const g = toolkit({ ...base, files: '*.xml', 'fail-on-ingest-error': 'false' })
  assert.equal(await run(g.tk, { upload: fake.upload, cwd: dir }), 0)
  assert.deepEqual(
    fake.calls.map((c) => c.complete),
    [false, false],
  )
  assert.match(g.summary(), /· open/)
})

test('without a run key every file is its own run and carries complete', async () => {
  const dir = workspace({ 'a.xml': JUNIT, 'b.xml': JUNIT })
  const fake = fakeUpload((req) => ({
    ok: true,
    retries: 0,
    body: body({ complete: req.complete }) as never,
    replay: false,
    idempotencyKey: 'x',
  }))
  const g = toolkit({ ...base, 'run-key': '', files: '*.xml' })
  assert.equal(await run(g.tk, { upload: fake.upload, cwd: dir }), 0)
  assert.deepEqual(
    fake.calls.map((c) => [c.runKey, c.complete]),
    [
      [null, true],
      [null, true],
    ],
  )
})

const EMPTY = { ...body().counts, total: 0, matched: 0, unmatched: 0 }

test('the close step (an empty file with complete): an info line, not the empty-file warning', async () => {
  const dir = workspace({ 'close.json': '' })
  const answer = (req: UploadRequest): UploadOutcome => ({
    ok: true,
    retries: 0,
    body: body({
      complete: req.complete,
      counts: EMPTY,
      warnings: ['The file holds no test results.'],
    }) as never,
    replay: false,
    idempotencyKey: 'x',
  })
  const close = toolkit({ ...base, files: 'close.json', complete: 'true' })
  assert.equal(await run(close.tk, { upload: fakeUpload(answer).upload, cwd: dir }), 0)
  assert.ok(close.lines.includes('closing run TR-7: close.json holds no results, the upload only closes it'))
  assert.ok(!close.lines.some((l) => l.startsWith('::warning::')), close.lines.join(' | '))
  assert.ok(!close.summary().includes('Warnings'))
  const open = toolkit({ ...base, files: 'close.json', complete: 'false' })
  assert.equal(await run(open.tk, { upload: fakeUpload(answer).upload, cwd: dir }), 0)
  assert.ok(open.lines.includes('::warning::close.json: The file holds no test results.'))
  assert.ok(!open.lines.some((l) => l.startsWith('closing run')))
  assert.match(open.summary(), /- `close\.json`: The file holds no test results\./)
})

test('an upload that needed retries says how many', async () => {
  const dir = workspace({ 'a.xml': JUNIT })
  const g = toolkit({ ...base, files: 'a.xml' })
  const fake = fakeUpload(() => ({
    ok: true,
    retries: 2,
    body: body() as never,
    replay: false,
    idempotencyKey: 'x',
  }))
  assert.equal(await run(g.tk, { upload: fake.upload, cwd: dir }), 0)
  assert.ok(
    g.lines.some((l) => l.startsWith('a.xml (junit-xml): 2 results') && l.endsWith('; retried 2 times')),
  )
})
