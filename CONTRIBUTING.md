# Contributing

Node.js 22 or later.

```bash
npm ci
npm run lint && npm run typecheck && npm test
npm run build        # rebuilds dist/index.js - commit it with the source change
npm run check:dist   # what CI runs: dist/ must be the build of src/
```

`src/` uses the published packages `@testorchestrator/playwright-reporter` (upload, retries, idempotency) and
`@testorchestrator/results-schema` (validation), installed from npm at the exact versions in `package.json`.

Commits follow [Conventional Commits](https://www.conventionalcommits.org).

## Releasing

1. `npm run check:dist`, update `CHANGELOG.md`, commit.
2. Tag the commit `v1.0.0` and move the major tag: `git tag -f v1 v1.0.0 && git push origin v1.0.0 && git push -f origin v1`.
3. Draft a GitHub release from `v1.0.0` and tick **Publish this Action to the GitHub Marketplace** (the
   repository must be public).

Never put a real API key in a test, an example or a log; examples read it from `secrets.TO_API_KEY`.
