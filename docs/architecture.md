# Architecture

The dashboard is a dependency-free Cloudflare Worker hosted through ChatGPT Sites. The page lists registered Docker hosts and their latest container reports. It polls every 15 seconds and marks reports stale after two minutes.

Each host runs a Python collector and an HAProxy socket proxy in Docker Compose. The proxy exposes only Docker version, container list, and container inspection reads over an internal Docker network. It denies other endpoints and methods. The collector has outbound HTTPS access and sends a report every 30 seconds. Neither service publishes ports.

Reports include container name, image, state, health, restart count, timestamps, and Docker Engine version. Environment variables, container logs, mounts, and network addresses are not sent. Cloudflare R2 holds host registration records, latest reports, and bounded activity records. The dashboard does not control containers.

## Authentication

ChatGPT Sites enforces the existing owner-only access policy. Dashboard routes additionally require the platform authenticated-user header. Registration checks that the browser Origin matches the request URL origin, supporting both generated and custom domains.

The collector uses a platform service credential to reach the private Site and a separate host token to authorize ingestion. Host tokens are stored as SHA-256 hashes in R2. Registration, rename, removal, and replacement issuance require authenticated same-origin requests. Runtime secrets are configured through Sites and never committed to this repository.

## Enrollment and lifecycle

The dashboard requests a standard tar package containing inspectable Compose, collector, proxy, and configuration files, with private credential-file permissions. A three-step flow follows naming, deployment, and the first report. The registration API also retains its previous script response when a Compose format is not requested.

Replacement tokens are staged as hashes with ten-minute activation deadlines. The original remains usable until a validated report arrives using the replacement; that report promotes the new hash and clears the pending replacement. Host lists expose only a non-secret credential revision for activation feedback. Removal deletes the registration, snapshot, and activity; subsequent reports for that host are rejected.

## Activity and alerts

Reporting compares each snapshot with the previous one to record container appearance/removal, state and health changes, restart increases, image changes, engine changes, and reporting recovery. First reports, renames, and activated replacements are also recorded. Each host retains at most 100 events; events older than 30 days are hidden and pruned on the next history write. The history API returns at most 100 events for the selected host or fleet. Concurrent reporting can coalesce events because R2 history writes are not transactional; this is an operational activity feed, not an audit log.

In-app alerts derive from the latest reports: stale hosts, enrollment awaiting a report for more than ten minutes, and unhealthy/restarting/dead containers. Stale container states are explicitly last known. Optional ntfy delivery runs on accepted reports, with a separately scheduled sweep for stale hosts and retries. The browser controls fleet-wide enablement, recovery messages, and a rate-limited test. See [notifications](notifications.md). History starts with this release and does not reconstruct old snapshots. Optional history-write failures do not reject an otherwise valid report.

## Source layout

- `worker/notifications.js`: server-side ntfy transitions, acknowledgements, retry state, and sweeps.
- `notifier/`: optional standard-library Python runner and restricted Compose deployment for minute sweeps.
- `worker/index.js`: routes, registration, report validation, and installer generation.
- `worker/board.html`, `board.js`, `board.css`: dashboard structure, interactions, and styles.
- `worker/collector.py`: outbound status collector.
- `worker/proxy.cfg`: restricted Docker API proxy.
- `worker/compose.yaml`: collector deployment template.
- `worker/setup.sh`: installer template.
- `scripts/`: Worker assembly and checks.
- `.openai/hosting.json`: the existing Site's non-secret identity and R2 binding declaration.

## Publishing

GitHub tracks reviewed source. Hosting remains managed by ChatGPT Sites; a push to this GitHub repository does not deploy the dashboard. Site publishing must synchronize the selected source with the existing Site repository and publish its matching artifact through the Sites workflow. Preserve the existing Site ID and access policy.

Separate deployments use the clean source export described in [ChatGPT Sites setup](chatgpt-sites.md). Each deployment has independent storage and service access.
