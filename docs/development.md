# Development

Use Node.js 22.13 or newer, Bash, Git, and Python 3 on Linux. There are no npm dependencies. Docker is required to run a collector or perform a live integration check, but the automated tests use a Docker command double.

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
python3 -c "import ast,pathlib; ast.parse(pathlib.Path('worker/collector.py').read_text())"
```

`npm run build` assembles the Worker and embedded collector assets into `dist/server/index.js`. The hosting manifest is copied into `dist/.openai/hosting.json`. Build output is ignored by Git.

The checks cover private routes, same-origin registration on generated and custom domains, report authentication and limits, persistence, field allowlisting, duplicate host names, and installer generation. Installer tests execute generated scripts against a Docker command double and verify file ownership/permissions, clean names, credential-preserving migration, overwrite protection, and startup rollback. They do not contact production or require real reporting credentials.

GitHub Actions runs these checks on pushes and pull requests. CI has read-only repository permissions and does not deploy the Site or change any host.

For a live integration check, use a temporary installation on a Docker host. Verify that a non-root collector reads its mode-0600 credentials and that reports arrive at the dashboard. Retain the host credentials privately; never commit generated setup downloads, collector.json, .env, or service tokens.

## Secret checks

`npm run check` scans tracked files for common credential patterns and generated configuration files. To include local Git history, run `node scripts/check-secrets.mjs --history`. Review the staged diff as well; the pattern check does not identify every possible secret. See [SECURITY.md](../SECURITY.md).
