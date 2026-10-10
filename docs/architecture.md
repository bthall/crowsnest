# Architecture

The dashboard is a dependency-free Cloudflare Worker hosted through ChatGPT Sites. The page lists registered Docker hosts and their latest container reports. It polls every 15 seconds and marks reports stale after two minutes.

Each host runs a Python collector and an HAProxy socket proxy in Docker Compose. The proxy exposes only Docker version, container list, and container inspection reads over an internal Docker network. It denies other endpoints and methods. The collector has outbound HTTPS access and sends a report every 30 seconds. Neither service publishes ports.

Reports include container name, image, state, health, restart count, timestamps, and Docker Engine version. Environment variables, container logs, mounts, and network addresses are not sent. Cloudflare R2 holds host registration records and each host's latest report; this version does not keep history or control containers.

## Authentication

ChatGPT Sites enforces the existing owner-only access policy. Dashboard routes additionally require the platform authenticated-user header. Registration checks that the browser Origin matches the request URL origin, supporting both generated and custom domains.

The collector uses a platform service credential to reach the private Site and a separate host token to authorize ingestion. Host tokens are stored as SHA-256 hashes in R2. Runtime secrets are configured through Sites and never committed to this repository.

## Source layout

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
