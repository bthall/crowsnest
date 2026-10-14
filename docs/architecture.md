# Architecture

The dashboard uses a shared Worker-compatible application, running either on ChatGPT Sites with R2 or in a standalone Node server with SQLite. It polls every 15 seconds and marks reports stale after two minutes.

Each host runs a Python collector and an HAProxy socket proxy in Docker Compose. The proxy exposes only Docker version, container list, container inspection, and bounded one-shot stats reads over an internal Docker network. It denies other endpoints and methods. The collector has outbound HTTPS access and sends a report every 30 seconds. Neither service publishes ports.

Reports include container name, image, state, health, restart count, timestamps, Docker Engine version, optional collector version, and optional Compose project/service names. Only `com.docker.compose.project` and `com.docker.compose.service` are read from labels; arbitrary labels, environment variables, logs, mounts, and network addresses are not sent. Cloudflare R2 holds registrations, latest reports, bounded activity, maintenance timers, and notification state. The dashboard does not control application containers.

## Authentication

Standalone deployments authenticate one owner through an HttpOnly browser session. The HTTP boundary strips supplied platform identity headers and injects identity only after verifying its own session. HTTPS origins use Secure, SameSite=Strict cookies; loopback development uses a separate cookie name. Passwords use salted scrypt, and random session/setup/recovery values are stored only as hashes. Setup and recovery require a server-issued code, expire after 15 minutes, and are single-use. Writes require the configured origin; forwarded identity and IP headers are not trusted. See [self-hosting](self-hosting.md). Standalone collectors use only individual reporting tokens.

The following platform boundary applies to Sites:

ChatGPT Sites enforces the existing owner-only access policy. Dashboard routes additionally require the platform authenticated-user header. Registration checks that the browser Origin matches the request URL origin, supporting both generated and custom domains.

The collector uses a platform service credential to reach the private Site and a separate host token to authorize ingestion. Host tokens are stored as SHA-256 hashes in R2. Registration, rename, removal, and replacement issuance require authenticated same-origin requests. Runtime secrets are configured through Sites and never committed to this repository.

## Enrollment and lifecycle

The dashboard requests private setup JSON containing a copyable Bash preparation block and a standard tar package with matching credentials. The block writes inspectable Compose, collector, proxy, and configuration files with private credential-file permissions, without starting containers. Four stages separate naming, preparing files, reviewing/starting the collector, and confirming an actual report. The registration API retains its previous Compose and script responses for compatibility. Private setup is only issued through authenticated same-origin requests; no public download endpoint is added. Collector updates return a source-only Bash block and do not issue new credentials.

Replacement tokens are staged as hashes with ten-minute activation deadlines. The original remains usable until a validated report arrives using the replacement; that report promotes the new hash and clears the pending replacement. Host lists expose only a non-secret credential revision for activation feedback. Removal deletes the registration, snapshot, and activity; subsequent reports for that host are rejected.

Renaming, replacement issuance, and activation use conditional R2 writes against the registration's ETag. A competing management change returns HTTP 409 instead of overwriting newer credentials or recreating a removed registration. This protects each registration write, not transactions spanning all objects. Concurrent enrollment can still race name uniqueness or the host-count check; an already authorized report can finish after removal and leave orphaned snapshot/history/notification objects. Orphans are not included in viewer routes without a registration. Strict enrollment uniqueness and transactional cleanup would require coordinated storage.

Fleet reads process five hosts at a time, with independent snapshot/maintenance reads in parallel. Host-specific activity reads its registration and history directly. Browser refresh callers share an in-flight request; callbacks for credential-bearing setup and clipboard operations are scoped to their original dialog session.

## Activity and alerts

Reporting compares each snapshot with the previous one to record container appearance/removal, state and health changes, restart increases, image changes, engine/collector version changes, container renames, and reporting recovery. First reports, renames, and activated replacements are also recorded. Each host retains at most 100 events; events older than 30 days are hidden and pruned on the next history write. The history API returns at most 100 events for the selected host or fleet. New container events carry the container ID. Container details filter the same retained history by host and ID; legacy events matched by name are labeled as potentially belonging to a previous instance. Concurrent reporting can coalesce events because R2 history writes are not transactional; this is an operational activity feed, not an audit log.

In-app alerts derive from the latest reports: stale hosts, enrollment awaiting a report for more than ten minutes, unhealthy/restarting/dead containers, and confirmed resource/restart rules when enabled. Stale container states are explicitly last known. Optional ntfy delivery runs on accepted reports, with a separately scheduled sweep for stale hosts and retries. The browser controls fleet-wide policy, recovery messages, and a rate-limited test. See [notifications](notifications.md). History records changes from incoming reports and does not reconstruct earlier snapshots. Optional history-write failures do not reject an otherwise valid report.

Resource history keeps each five-minute window's latest report, up to 24 hours, 288 readings, and 2 MiB per host. Per-container readings belong to full IDs; replacements do not inherit another container's history. Signal tracking uses fresh reports to establish sustained resource usage and observed restart deltas. Missing measurements and reporting gaps remain explicit. See [resource measurements](resources.md).

Per-host maintenance is stored separately from registration records so timer writes cannot overwrite credential changes. Both ingestion and sweeps check the server-time expiry before automatic delivery. During a pause, the last delivered notification baseline remains intact. After expiry or early end, current issues are re-evaluated on the next report or sweep. Reports, health, and activity continue during maintenance. These R2 operations are best effort: an already in-flight publish can finish after a pause starts.

## Source layout

- `server/`: standalone HTTP boundary, owner UI, authentication, SQLite adapter, CLI, and process lock.
- `Dockerfile`, `compose.yaml`: standalone dashboard build and deployment.

- `worker/notifications.js`: server-side ntfy transitions, acknowledgements, retry state, and sweeps.
- `worker/signals.js`: sustained resource and observed restart windows, strict policy validation, and notification targets.
- `worker/resources.js`: resource validation, workload totals, bounded storage, and per-container readings.
- `notifier/`: optional standard-library Python runner and restricted Compose deployment for minute sweeps.
- `worker/index.js`: routes, registration, report validation, and installer generation.
- `worker/board.html`, `board.js`, `board.css`: dashboard structure, interactions, and styles.
- `worker/collector.py`: outbound status collector, stamped with the package version during assembly.
- `worker/versions.js`: shared strict SemVer validation and precedence comparison.
- `worker/proxy.cfg`: restricted Docker API proxy.
- `worker/compose.yaml`: collector deployment template.
- `worker/setup.sh`: installer template.
- `scripts/`: Worker assembly and checks.
- `.openai/hosting.json`: portable R2 binding declaration; deployment checkouts also retain their own Site identity.

## Publishing

Standalone deployments rebuild their Compose image deliberately and retain their data volume; a source push does not update a running dashboard. SQLite host mutations use serialized transactions with WAL and full synchronous commits. Operations outside an active transaction wait outside it; automatic alert checks run separately. A kernel process lock excludes another server or restore. One process per data volume is supported. Hosted publishing follows the separate process below.

For hosted deployments, GitHub tracks reviewed source and hosting remains managed by ChatGPT Sites; a push to this GitHub repository does not deploy the dashboard. Site publishing must synchronize the selected source with the existing Site repository and publish its matching artifact through the Sites workflow. Preserve the existing Site ID and access policy.

Separate deployments use the clean source export described in [ChatGPT Sites setup](chatgpt-sites.md). Each deployment has independent storage and service access.
