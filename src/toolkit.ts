/**
 * The GitHub Actions runner contract, without a dependency: inputs from INPUT_* variables, outputs and the job
 * summary through the GITHUB_OUTPUT / GITHUB_STEP_SUMMARY files, and workflow commands (::add-mask::,
 * ::warning::, ::error::) on stdout. Same escaping as @actions/core.
 */
import { appendFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { EOL } from 'node:os'

export type Env = Record<string, string | undefined>

export interface Toolkit {
  env: Env
  write: (line: string) => void
}

export const defaultToolkit: Toolkit = {
  env: process.env,
  write: (line) => {
    process.stdout.write(line + EOL)
  },
}

function escapeData(s: string): string {
  return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}

export function getInput(tk: Toolkit, name: string, required = false): string {
  const value = (tk.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] ?? '').trim()
  if (required && value === '') throw new Error(`Input required and not supplied: ${name}`)
  return value
}

export function getBooleanInput(tk: Toolkit, name: string, fallback: boolean): boolean {
  const v = getInput(tk, name)
  if (v === '') return fallback
  if (['true', 'True', 'TRUE'].includes(v)) return true
  if (['false', 'False', 'FALSE'].includes(v)) return false
  throw new Error(`Input ${name} must be true or false (got "${v}")`)
}

export function setSecret(tk: Toolkit, value: string): void {
  if (value !== '') tk.write(`::add-mask::${escapeData(value)}`)
}

export function setOutput(tk: Toolkit, name: string, value: string): void {
  const file = tk.env.GITHUB_OUTPUT
  if (!file) {
    tk.write(`${name}=${value}`)
    return
  }
  const delimiter = `ghadelimiter_${randomUUID()}`
  appendFileSync(file, `${name}<<${delimiter}${EOL}${value}${EOL}${delimiter}${EOL}`, 'utf8')
}

export function appendSummary(tk: Toolkit, markdown: string): void {
  const file = tk.env.GITHUB_STEP_SUMMARY
  if (file) appendFileSync(file, markdown + EOL, 'utf8')
}

export function info(tk: Toolkit, message: string): void {
  tk.write(message)
}

/** Shown only when the workflow runs with debug logging (ACTIONS_STEP_DEBUG). */
export function debug(tk: Toolkit, message: string): void {
  tk.write(`::debug::${escapeData(message)}`)
}

export function warning(tk: Toolkit, message: string): void {
  tk.write(`::warning::${escapeData(message)}`)
}

export function error(tk: Toolkit, message: string): void {
  tk.write(`::error::${escapeData(message)}`)
}
