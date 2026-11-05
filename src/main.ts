import { defaultDeps, uploadResults } from '@testorchestrator/playwright-reporter'
import { run } from './run'
import { debug, defaultToolkit, error } from './toolkit'

// each retry goes to the debug log (shown with ACTIONS_STEP_DEBUG); the final line counts them
const deps = {
  ...defaultDeps,
  debug: (line: string) => {
    debug(defaultToolkit, line)
  },
}

run(defaultToolkit, { upload: (req) => uploadResults(req, deps), cwd: process.cwd() })
  .then((code) => {
    process.exitCode = code
  })
  .catch((e: unknown) => {
    error(defaultToolkit, e instanceof Error ? e.message : String(e))
    process.exitCode = 1
  })
