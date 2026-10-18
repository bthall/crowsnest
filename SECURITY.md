# Security policy

## Reporting a vulnerability

Use **Report a vulnerability** on [Crowsnest's security advisories page](https://github.com/bthall/crowsnest/security/advisories) to contact the maintainer privately through GitHub. If the button is unavailable, open an issue asking only for a private reporting channel, without vulnerability details.

Include the affected revision, a description of the issue, and reproduction steps using synthetic or redacted data. Do not place active credentials or exploitable details in a public issue or pull request.

Crowsnest is in initial development. Reports should identify the current `main` revision or the exact deployed revision; no separate support schedule has been published for older versions.

## Security boundaries

Standalone deployment supports one owner per instance. Setup and recovery require single-use, hashed server codes with 15-minute expiries; there is no default password or public first-user claim. Passwords use salted scrypt (N=131072, r=8, p=1). Sessions use random 256-bit tokens stored as SHA-256 hashes, expire after eight hours, and are revoked by logout, recovery, or restore. HTTPS cookies are HttpOnly, Secure, SameSite=Strict, and scoped to `/`. Persistent rate limits and a two-hash concurrency cap bound sign-in work. The standalone boundary removes supplied platform identity headers and enforces the configured Host and Origin. Its collectors use only individual reporting tokens. Keep the data volume and backups private.

The following platform boundary applies to Sites:

ChatGPT Sites enforces access to the private dashboard. Worker viewer routes require the platform authenticated-user header, and host registration validates same-origin requests. Preserve the existing owner-only access policy when deploying changes.

A collector uses two credentials: a platform service credential to reach the private Site and a host-specific reporting token. The Worker stores the host token as a SHA-256 hash. Possession of the service credential is privileged; keep all collector configuration private.

Collector versions from 0.7.2 require an HTTPS reporting origin, retain certificate verification, and deny redirects before either reporting credential can be forwarded. Apply the source-only collector update to existing hosts to receive this protection. Renames and staged-token writes use R2 ETag preconditions to prevent stale registration writes from replacing newer credentials.

The socket proxy permits only Docker version, container list, container inspection, and bounded one-shot container stats reads. Streaming stats and all mutation methods are denied. A read-only socket mount alone does not restrict API methods. Container inspection can expose sensitive local information, so the collector and proxy must remain trusted even though only selected status fields are transmitted.

## Credential handling

- Configure Site secrets through the hosting platform, not source files or the hosting manifest.
- Keep copied setup, downloaded Compose packages, legacy setup scripts, and `collector.json` private. They contain reporting credentials. Copied setup can remain in clipboard managers and terminal history; handle those copies as credentials too.
- Keep `notifier.json` private as well; it holds the privileged Site service credential.
- Keep installation directories at 0700 and credential files at 0600.
- Use synthetic credentials in examples and automated tests.
- Exclude generated installs, environment files, keys, and credential-bearing diagnostics from Git.

The public repository's `.openai/hosting.json` declares the portable R2 binding `BUCKET` and contains no Site identifier or runtime credentials. A private deployment checkout retains its own platform-returned Site identifier. Clean exports omit deployment identity and runtime settings. README screenshots contain only fictional data.

## Checks and incident handling

The local secret check detects common credential patterns and generated credential file names in tracked source. The `--history` mode additionally checks local Git blob history. CI also runs Gitleaks across complete Git history with redacted output, focused Semgrep application rules, and npm audit. These checks complement manual review; they do not detect every possible secret format.

If a credential is exposed, revoke or rotate it before treating deletion as remediation. **Manage host** offers staged per-host token replacement: the current token remains valid until the replacement's first valid report, which must arrive within ten minutes. Use host removal for immediate host-token revocation when a token is compromised, then enroll again. Updating the platform service credential requires changing the Site runtime secret and updating every collector. Verify reporting afterward.

Activity records describe recent operational changes and exclude credentials. They are bounded by count and age and are not a transactional security audit trail. Host removal deletes its registration, snapshot, and history. Optional ntfy delivery sends host names and alerting container names/state/health to the configured server. Store the publisher token as a Site secret and use a topic-scoped, write-only publisher. Destination changes require operator runtime access; browser controls cannot redirect publishing. HTTPS, DNS hostname validation, denied redirects, request timeouts, and bounded messages constrain outbound requests. The operator must trust the destination DNS: the Worker does not implement DNS pinning. Publishing must not use a public topic for a private fleet.

The existing platform service credential can authorize only notification sweeps and rate-limited tests in addition to its dispatch role. A sweep cannot register hosts, change notification settings, or read the dashboard. Collector holders therefore can trigger bounded notifications; treat this shared service credential as privileged. R2 transition state is not transactional, so overlapping reports/sweeps can duplicate a message. Delivery is best effort, not an incident paging SLA.

The dashboard blocks inline scripts and styles with CSP. Standalone login scripts, shared CSS, and the logo are public static assets; fleet scripts and APIs require a session. Sites assets remain authenticated. External container fields render as text through DOM APIs. Separate owners should deploy separate instances or private Sites.

Standalone host mutations use SQLite transactions; notification publication remains best effort and can finish after maintenance or removal starts. Backups contain private state and must not be committed. Restore requires a stopped server, checks integrity/schema, and invalidates browser sessions and server codes. Reporting tokens changed after a backup may need replacement.

The Docker runtime runs as the Node user with a read-only root filesystem, dropped capabilities, and no Docker socket mount. Image builds apply OS security updates and remove npm tooling. CI scans images with digest-pinned Trivy and fails on fixable high/critical vulnerabilities. Triage unfixed and lower-severity findings separately.
