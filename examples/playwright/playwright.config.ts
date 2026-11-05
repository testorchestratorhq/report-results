import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  retries: 1,
  // Playwright's own JSON reporter; the report-results Action uploads the file.
  reporter: [['list'], ['json', { outputFile: 'playwright-report/results.json' }]],
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
  ],
})
