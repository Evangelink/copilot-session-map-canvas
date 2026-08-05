# Contributing to Session Map

Thank you for considering a contribution. Bug reports, feature proposals,
documentation improvements, and code changes are welcome.

## Before you start

- Search existing issues before opening a new one.
- Use an issue to discuss substantial behavior or architecture changes before
  investing in an implementation.
- Do not include secrets, personal session data, or generated files from
  `.copilot/session-map/` in an issue or pull request.
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md) in all project spaces.

## Development setup

The extension runtime uses Node.js built-ins and the Copilot extension SDK
provided by the host. Node.js 24 is used in CI.

1. Fork and clone the repository.
2. Run `npm ci` to install the browser-test dependency.
3. Make focused changes under `.github/extensions/session-map/`.
4. Add or update tests for changed behavior.

Run the unit tests:

```powershell
node --test .github\extensions\session-map\tests\*.test.mjs
```

Run syntax checks:

```powershell
Get-ChildItem .github\extensions\session-map -Filter *.mjs -Recurse |
  ForEach-Object { node --check $_.FullName }
```

For browser tests, install Chromium once and run the UI suite:

```powershell
npx playwright install chromium
npm run test:ui
```

## Pull requests

- Keep each pull request limited to one coherent change.
- Explain the user-visible behavior and any design tradeoffs.
- Link related issues using `Fixes #123` when applicable.
- Ensure relevant tests and syntax checks pass.
- Update documentation when behavior, setup, or public interfaces change.
- Do not commit generated reports, local session state, or dependency folders.

Maintainers may ask for changes to keep the extension dependency-free at
runtime, accessible, secure, and compatible with the Copilot extension host.

## Reporting security issues

Do not open public issues for suspected vulnerabilities. Follow
[SECURITY.md](SECURITY.md) instead.
