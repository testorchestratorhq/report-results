import { globSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

/** Patterns from the `files` input: separated by new lines or commas, blank entries dropped. */
export function splitPatterns(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((p) => p.trim())
    .filter((p) => p !== '')
}

/** Matching regular files, relative to `cwd`, sorted by name, each once. A pattern starting with ! excludes. */
export function expandPatterns(patterns: string[], cwd: string): string[] {
  const include = patterns.filter((p) => !p.startsWith('!'))
  const exclude = patterns.filter((p) => p.startsWith('!')).map((p) => p.slice(1))
  const found = new Set<string>()
  for (const pattern of include) {
    const matches = globSync(pattern, { cwd, exclude })
    for (const m of matches) {
      const abs = isAbsolute(m) ? m : resolve(cwd, m)
      try {
        if (statSync(abs).isFile()) found.add(relative(cwd, abs).split('\\').join('/'))
      } catch {
        // vanished between glob and stat
      }
    }
  }
  return [...found].sort()
}
