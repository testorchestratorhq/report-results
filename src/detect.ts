/** Which results format a file holds: by the `format` input, else by extension and content. */
import { extname } from 'node:path'

export type Format = 'junit-xml' | 'playwright-json' | 'to-results-json'

export const FORMATS: Format[] = ['junit-xml', 'playwright-json', 'to-results-json']

/** The `format` input: auto, a format, or the to-json alias. */
export function parseFormatInput(value: string): Format | 'auto' {
  const v = value.trim().toLowerCase()
  if (v === '' || v === 'auto') return 'auto'
  if (v === 'to-json') return 'to-results-json'
  if ((FORMATS as string[]).includes(v)) return v as Format
  throw new Error(`Input format must be auto, junit-xml, playwright-json or to-results-json (got "${value}")`)
}

export class DetectError extends Error {}

function firstChar(text: string): string {
  const m = /^\ufeff?\s*(.)/s.exec(text)
  return m?.[1] ?? ''
}

function sniffJson(file: string, text: string): Format {
  let doc: unknown
  try {
    doc = JSON.parse(text.replace(/^\ufeff/, ''))
  } catch (e) {
    throw new DetectError(`${file}: not valid JSON (${(e as Error).message})`)
  }
  if (typeof doc === 'object' && doc !== null && !Array.isArray(doc)) {
    const o = doc as Record<string, unknown>
    if (Array.isArray(o.suites)) return 'playwright-json'
    if ('version' in o && 'results' in o) return 'to-results-json'
  }
  throw new DetectError(
    `${file}: JSON that is neither a Playwright JSON report ("suites") nor to-results.json ("version" + "results"); set the format input`,
  )
}

export function detectFormat(file: string, content: Buffer, requested: Format | 'auto'): Format {
  if (requested !== 'auto') return requested
  const text = content.toString('utf8')
  const ext = extname(file).toLowerCase()
  const first = firstChar(text)
  if (first === '') {
    // an empty file is "no results"; our own format says so most plainly
    return 'to-results-json'
  }
  if (ext === '.xml' || first === '<') {
    if (/<testsuites?[\s>/]/.test(text.slice(0, 65536))) return 'junit-xml'
    throw new DetectError(`${file}: XML without a <testsuites> or <testsuite> element; set the format input`)
  }
  if (ext === '.json' || first === '{') return sniffJson(file, text)
  throw new DetectError(
    `${file}: cannot tell the format from the extension or the content; set the format input`,
  )
}
