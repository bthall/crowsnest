# Development

Use Node.js 22.13 or newer, Bash, Git, Linux `flock`, and Python 3 on Linux. The Worker has no runtime npm dependencies; the standalone server uses pinned `better-sqlite3`. Docker is required for the container integration suite and live collector checks. Installer tests use a Docker command double.

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
python3 -c "import ast,pathlib; ast.parse(pathlib.Path('worker/collector.py').read_text())"
```

`npm run build` assembles the Worker and embedded collector assets into `dist/server/index.js`. The hosting manifest is copied into `dist/.openai/hosting.json`. Build output is ignored by Git.

The checks cover private routes, same-origin writes on generated and custom domains, report authentication and limits, persistence, field allowlisting, duplicate host names, canonical redirects, and installer generation. Compose enrollment checks parse the tar package with Python's standard tar reader, verify file types/modes, and cover rename/removal, staged replacement/expiry, bounded activity, and removed-host rejection. Legacy installer tests execute generated scripts against a Docker command double and verify file ownership/permissions, clean names, overwrite protection and private credential retention after startup failure. Notification checks mock outbound fetch and verify destination restrictions, private controls, service sweep authorization, transition deduplication, recoveries, retry/backoff, acknowledgements, test rate limiting, pausing, and removal cleanup. Maintenance checks cover viewer/origin authorization, all bounded durations, ingestion and sweep suppression, expiry, early end, history/health preservation, and recovery baselines. Collector checks execute the actual report function against synthetic Docker inspection data to verify Compose label allowlisting. Update checks execute the generated Bash block with a Docker double and verify credential/configuration preservation and symlink refusal. Version/details checks verify optional version compatibility, strict SemVer precedence, version-stamped delivery, private container history, retention, rename attribution, and same-name replacement isolation. They do not contact production or require real reporting credentials.

The resilience suite interleaves real API operations against an R2 test double with ETags and partial pages. It covers credential/rename/removal conflicts, JSON shapes, malformed UTF-8, direct host activity reads, and the concurrency ceiling for fleet polling. Collector tests import the actual module, verify its data allowlist, acknowledgements, configuration, response/report limits, admission deadline, four-worker ordering, and container churn. A loopback HTTP server exercises 301/302/303/307/308 denial using synthetic credentials; it never contacts production. Notification tests cover stale-host preservation of delivered container baselines.

GitHub Actions runs these checks on pushes and pull requests with Python 3.12 and 3.13. The Security workflow runs on these events, weekly, and on manual dispatch. It uses checksum-verified Gitleaks for complete Git history and a digest-pinned Semgrep image with local rules. CI has read-only repository permissions and does not deploy the Site or change any host.

For a live integration check, use a temporary installation on a Docker host. Verify that a non-root collector reads its mode-0600 credentials and that reports arrive at the dashboard. Retain the host credentials privately; never commit generated setup downloads, collector.json, .env, or service tokens.

Copy setup checks execute the generated clipboard block in Bash using the Docker command double. They verify directory and credential permissions, ownership, overwrite refusal, and that preparation does not pull or start containers. Enrollment checks compare copied credentials with the alternative tar download and exercise staged replacement through the new setup format.

## Secret checks

`npm run check` scans tracked files for common credential patterns and generated configuration files, including quoted JSON/Python credential assignments. Its scanner regression uses isolated temporary Git fixtures and synthetic values. To include local Git history, run `node scripts/check-secrets.mjs --history`. Review the staged diff as well; the pattern check does not identify every possible secret. See [SECURITY.md](../SECURITY.md).

## UI preview and screenshots

Run `npm run preview` and open `http://127.0.0.1:4175`. The server binds only to loopback, uses fictional data, and cannot register hosts. Use browser screenshots rather than generated mockups. See [screenshot provenance](screenshots/README.md).

Playwright is a development tool supplied by the Codex Playwright skill; it is not a production dependency. Capture wide and narrow layouts together. Exercise fleet and host search, attention filtering, activity/alerts, host management, enrollment through a first report, continuation, errors, empty states, and keyboard focus. Use synthetic API responses for mutations in browser QA; the API suite separately checks storage and credential behavior. Exercise container details, ID copy/fallback, Back/Escape focus restoration, stale and removed-container labels, history retry, collector version comparison, and fresh-report update confirmation. Inspect console output and run an accessibility audit.

## Security scans

The standalone HTTP/SQLite suite checks authentication, spoofed identity, Host/Origin checks, secure cookies, setup/recovery, session invalidation, rate limits, concurrent registration, transaction isolation, restart persistence, and backup/restore. The Docker job builds the image and runs `node scripts/check-docker.mjs <image>` in a networkless container without a Docker socket mount. It verifies enrollment/reporting, restart, online backup, live-restore refusal, and stopped restore, then removes temporary containers and volumes.

Gitleaks 8.30.1 is pinned by release checksum in `.github/workflows/security.yml`. It scans all Git refs with credential output redacted. Semgrep 1.180.0 is pinned by image digest; it runs without network access using `.semgrep.yml`. The six rules prohibit dynamic code evaluation, HTML injection sinks, shell execution in hosted application code, disabled collector TLS verification, and privileged collector containers. These focused rules supplement the API security regression checks and manual review; they are not a full vulnerability assessment. A separate digest-pinned Trivy job scans an exported image without mounting the Docker socket and fails on fixable high/critical findings.

Actions use immutable commit SHAs, checkout credentials are not persisted, workflows have read-only permissions, and Dependabot proposes GitHub Actions, npm, and Docker updates. Review scanner releases and refresh their version/hash together. `npm audit --audit-level=high` checks package metadata; the Worker has no runtime npm dependencies; the standalone dependency is pinned.

CI runs checks only and has no deployment credentials. Read-only workflow files alone do not enforce branch protection. Set required-check rules where supported.
