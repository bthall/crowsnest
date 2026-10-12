# Architecture

The dashboard is a dependency-free Cloudflare Worker hosted through ChatGPT Sites. The page lists registered Docker hosts and their latest container reports. It polls every 15 seconds and marks reports stale after two minutes.

Each host runs a Python collector and an HAProxy socket proxy in Docker Compose. The proxy exposes only Docker version, container list, and container inspection reads over an internal Docker network. It denies other endpoints and methods. The collector has outbound HTTPS access and sends a report every 30 seconds. Neither service publishes ports.

Reports include container name, image, state, health, restart count, timestamps, Docker Engine version, optional collector version, and optional Compose project/service names. Only `com.docker.compose.project` and `com.docker.compose.service` are read from labels; arbitrary labels, environment variables, logs, mounts, and network addresses are not sent. Cloudflare R2 holds registrations, latest reports, bounded activity, maintenance timers, and notification state. The dashboard does not control application containers.

## Authentication

ChatGPT Sites enforces the existing owner-only access policy. Dashboard routes additionally require the platform authenticated-user header. Registration checks that the browser Origin matches the request URL origin, supporting both generated and custom domains.

The collector uses a platform service credential to reach the private Site and a separate host token to authorize ingestion. Host tokens are stored as SHA-256 hashes in R2. Registration, rename, removal, and replacement issuance require authenticated same-origin requests. Runtime secrets are configured through Sites and never committed to this repository.

## Enrollment and lifecycle

The dashboard requests private setup JSON containing a copyable Bash preparation block and a standard tar package with matching credentials. The block writes inspectable Compose, collector, proxy, and configuration files with private credential-file permissions, without starting containers. Four stages separate naming, preparing files, reviewing/starting the collector, and confirming an actual report. The registration API retains its previous Compose and script responses for compatibility. Private setup is only issued through authenticated same-origin requests; no public download endpoint is added. Collector updates return a source-only Bash block and do not issue new credentials.

Replacement tokens are staged as hashes with ten-minute activation deadlines. The original remains usable until a validated report arrives using the replacement; that report promotes the new hash and clears the pending replacement. Host lists expose only a non-secret credential revision for activation feedback. Removal deletes the registration, snapshot, and activity; subsequent reports for that host are rejected.

Renaming, replacement issuance, and activation use conditional R2 writes against the registration's ETag. A competing management change returns HTTP 409 instead of overwriting newer credentials or recreating a removed registration. This protects each registration write, not transactions spanning all objects. Concurrent enrollment can still race name uniqueness or the host-count check; an already authorized report can finish after removal and leave orphaned snapshot/history/notification objects. Orphans are not included in viewer routes without a registration. Strict enrollment uniqueness and transactional cleanup would require coordinated storage.

Fleet reads process five hosts at a time, with independent snapshot/maintenance reads in parallel. Host-specific activity reads its registration and history directly. Browser refresh callers share an in-flight request; callbacks for credential-bearing setup and clipboard operations are scoped to their original dialog session.

## Activity and alerts

Reporting compares each snapshot with the previous one to record container appearance/removal, state and health changes, restart increases, image changes, engine/collector version changes, container renames, and reporting recovery. First reports, renames, and activated replacements are also recorded. Each host retains at most 100 events; events older than 30 days are hidden and pruned on the next history write. The history API returns at most 100 events for the selected host or fleet. New container events carry the container ID. Container details filter the same retained history by host and ID; legacy events matched by name are labeled as potentially belonging to a previous instance. Concurrent reporting can coalesce events because R2 history writes are not transactional; this is an operational activity feed, not an audit log.

In-app alerts derive from the latest reports: stale hosts, enrollment awaiting a report for more than ten minutes, and unhealthy/restarting/dead containers. Stale container states are explicitly last known. Optional ntfy delivery runs on accepted reports, with a separately scheduled sweep for stale hosts and retries. The browser controls fleet-wide enablement, recovery messages, and a rate-limited test. See [notifications](notifications.md). History starts with this release and does not reconstruct old snapshots. Optional history-write failures do not reject an otherwise valid report.

Per-host maintenance is stored separately from registration records so timer writes cannot overwrite credential changes. Both ingestion and sweeps check the server-time expiry before automatic delivery. During a pause, the last delivered notification baseline remains intact. After expiry or early end, current issues are re-evaluated on the next report or sweep. Reports, health, and activity continue during maintenance. These R2 operations are best effort: an already in-flight publish can finish after a pause starts.

## Source layout

- `worker/notifications.js`: server-side ntfy transitions, acknowledgements, retry state, and sweeps.
- `notifier/`: optional standard-library Python runner and restricted Compose deployment for minute sweeps.
- `worker/index.js`: routes, registration, report validation, and installer generation.
- `worker/board.html`, `board.js`, `board.css`: dashboard structure, interactions, and styles.
- `worker/collector.py`: outbound status collector, stamped with the package version during assembly.
- `worker/versions.js`: shared strict SemVer validation and precedence comparison.
- `worker/proxy.cfg`: restricted Docker API proxy.
- `worker/compose.yaml`: collector deployment template.
- `worker/setup.sh`: installer template.
- `scripts/`: Worker assembly and checks.
- `.openai/hosting.json`: the existing Site's non-secret identity and R2 binding declaration.

## Publishing

GitHub tracks reviewed source. Hosting remains managed by ChatGPT Sites; a push to this GitHub repository does not deploy the dashboard. Site publishing must synchronize the selected source with the existing Site repository and publish its matching artifact through the Sites workflow. Preserve the existing Site ID and access policy.

Separate deployments use the clean source export described in [ChatGPT Sites setup](chatgpt-sites.md). Each deployment has independent storage and service access.
