# Security policy

## Reporting a vulnerability

Report suspected vulnerabilities privately to the repository owner, `@bthall`, through your established private contact channel. Include the affected revision, a description of the issue, and reproduction steps using synthetic or redacted data. Do not place active credentials or exploitable details in an issue or pull request.

Crowsnest is in initial development. Reports should identify the current `main` revision or the exact deployed revision; no separate support schedule has been published for older versions.

## Security boundaries

ChatGPT Sites enforces access to the private dashboard. Worker viewer routes require the platform authenticated-user header, and host registration validates same-origin requests. Preserve the existing owner-only access policy when deploying changes.

A collector uses two credentials: a platform service credential to reach the private Site and a host-specific reporting token. The Worker stores the host token as a SHA-256 hash. Possession of the service credential is privileged; keep all collector configuration private.

The socket proxy permits only Docker version, container list, and container inspection reads. A read-only socket mount alone does not restrict API methods. Container inspection can expose sensitive local information, so the collector and proxy must remain trusted even though only selected status fields are transmitted.

## Credential handling

- Configure Site secrets through the hosting platform, not source files or the hosting manifest.
- Keep downloaded setup scripts and `collector.json` private. Both contain reporting credentials.
- Keep installation directories at 0700 and credential files at 0600.
- Use synthetic credentials in examples and automated tests.
- Exclude generated installs, environment files, keys, and credential-bearing diagnostics from Git.

The tracked `.openai/hosting.json` contains a non-secret Site identifier and an R2 binding name. It contains no runtime credentials. Clean exports omit this Site identity and all runtime settings. README screenshots contain only fictional data.

## Checks and incident handling

The local secret check detects common credential patterns and generated credential file names in tracked source. The `--history` mode additionally checks local Git blob history. CI also runs Gitleaks across complete Git history with redacted output, focused Semgrep application rules, and npm audit. These checks complement manual review; they do not detect every possible secret format.

If a credential is exposed, revoke or rotate it before treating deletion as remediation. Updating the platform service credential requires updating every collector. There is currently no token-rotation UI. Coordinate token revocation and storage changes with the repository owner and verify reporting afterward.

The dashboard serves JavaScript and CSS as authenticated assets and blocks inline scripts and styles with CSP. External container fields render as text through DOM APIs. Separate owners should deploy separate private Sites; the current host collection has one Site-level owner boundary.
