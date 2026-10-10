# Development

Use Node.js 22.13 or newer, Bash, Git, and Python 3 on Linux. There are no npm dependencies. Docker is required to run a collector or perform a live integration check, but the automated tests use a Docker command double.

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
python3 -c "import ast,pathlib; ast.parse(pathlib.Path('worker/collector.py').read_text())"
```

`npm run build` assembles the Worker and embedded collector assets into `dist/server/index.js`. The hosting manifest is copied into `dist/.openai/hosting.json`. Build output is ignored by Git.

The checks cover private routes, same-origin registration on generated and custom domains, report authentication and limits, persistence, field allowlisting, duplicate host names, and installer generation. Installer tests execute generated scripts against a Docker command double and verify file ownership/permissions, clean names, overwrite protection and private credential retention after startup failure. They do not contact production or require real reporting credentials.

GitHub Actions runs these checks on pushes and pull requests. The Security workflow runs on these events, weekly, and on manual dispatch. It uses checksum-verified Gitleaks for complete Git history and a digest-pinned Semgrep image with local rules. CI has read-only repository permissions and does not deploy the Site or change any host.

For a live integration check, use a temporary installation on a Docker host. Verify that a non-root collector reads its mode-0600 credentials and that reports arrive at the dashboard. Retain the host credentials privately; never commit generated setup downloads, collector.json, .env, or service tokens.

## Secret checks

`npm run check` scans tracked files for common credential patterns and generated configuration files. To include local Git history, run `node scripts/check-secrets.mjs --history`. Review the staged diff as well; the pattern check does not identify every possible secret. See [SECURITY.md](../SECURITY.md).

## UI preview and screenshots

Run `npm run preview` and open `http://127.0.0.1:4175`. The server binds only to loopback, uses fictional data, and cannot register hosts. Use browser screenshots rather than generated mockups. See [screenshot provenance](screenshots/README.md).

Playwright is a development tool supplied by the Codex Playwright skill; it is not a production dependency. Capture wide and narrow layouts together, exercise search, attention filtering, host selection, errors, empty states, and keyboard setup. Inspect console output and run an accessibility audit.

## Security scans

Gitleaks 8.30.1 is pinned by release checksum in `.github/workflows/security.yml`. It scans all Git refs with credential output redacted. Semgrep 1.180.0 is pinned by image digest; it runs without network access using `.semgrep.yml`. The six rules prohibit dynamic code evaluation, HTML injection sinks, shell execution in application code, disabled collector TLS verification, and privileged collector containers. These focused rules supplement the API security regression checks and manual review; they are not a full vulnerability assessment or container-image CVE scan.

Actions use immutable commit SHAs, checkout credentials are not persisted, workflows have read-only permissions, and Dependabot proposes GitHub Actions updates. Review scanner releases and refresh their version/hash together. `npm audit --audit-level=high` checks package metadata; the production Worker currently has no npm dependencies.

CI runs checks only and has no deployment credentials. Read-only workflow files alone do not enforce branch protection. Set required-check rules where supported.
