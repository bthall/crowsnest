# Contributing to Crowsnest

Use a focused branch and pull request for each change. Describe the user-visible problem, the resulting behavior, and the validation performed. Link a relevant issue when one exists.

## Set up and validate

Follow [docs/development.md](docs/development.md). Before submitting:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

Add regression coverage for changes to authentication, origin checks, report validation, storage, or installer behavior. For a UI change, check narrow and wide layouts and keyboard use in a browser. State which live-host or browser checks were not performed.

## Preserve the deployment contract

- Keep existing collector filenames, API routes, credentials, and Compose names compatible unless the release documents the compatibility change and user steps.
- Preserve the private dashboard access boundary and the restricted socket proxy.
- Use the configured Sites workflow for dashboard publication. A GitHub push does not deploy it.
- Keep operational notes out of user-facing UI unless they help users install or troubleshoot the collector.

## Documentation

Update the relevant guide when a command, configuration key, default path, limit, or behavior changes. Keep the README focused on orientation and getting started; put detailed procedures in `docs/`. Use relative links and commands that match the current implementation.

Commit documentation that helps users operate Crowsnest or contributors maintain it. Keep task plans, agent handoffs, review transcripts, local deployment records, and personal project context outside the repository. Summarize lasting behavior in the relevant guide and release changes in `CHANGELOG.md`; validation evidence belongs in the pull request and CI results. Use fictional data for examples and screenshots.

The tracked hosting manifest declares portable storage bindings. A deployment's Site identity belongs in its separate deployment checkout; preserve that identity when updating the Site and exclude it from general distribution.

## Credentials

Use synthetic values in tests. Never include real credentials, generated setup downloads, `.env` files, `collector.json`, private keys, or production logs containing tokens. Review the staged diff and run the secret checks before publishing.

Report security concerns privately as described in [SECURITY.md](SECURITY.md).

Follow [versioning and releases](docs/versioning.md) and update the changelog for user-visible changes. See [DESIGN.md](DESIGN.md) before UI changes.
