# Crowsnest

Crowsnest is a private Docker fleet monitor with one outbound collector per host. Reports arrive every 30 seconds; the board refreshes every 15 seconds and marks data stale after 120 seconds. State and health are separate, and containers without HEALTHCHECK are explicitly labeled.

## Connect a host

Choose Connect a host, enter a unique hostname, and download docker-watch-setup.sh. Transfer it privately to your Linux Docker host, review it, then run `bash docker-watch-setup.sh` as your normal user. The default installation directory is `/srv/docker/docker-dashboard-collector`, following the preference to keep Docker projects under `/srv/docker`. Pass an absolute directory as the optional first argument to use another location. The script refuses to overwrite an existing directory.

The installer requests sudo only if needed to create the directory or access Docker. It does not change Docker socket permissions or account group membership. If started through sudo, it assigns the files to the invoking user. The directory is mode 0700; `collector.json` and `.env` are mode 0600. Code and the proxy configuration are mode 0644. `.env` sets the collector's UID/GID to the file owner so it can read its credentials without widening their permissions. The Compose project is `docker-dashboard`; containers are named `docker-dashboard-collector` and `docker-dashboard-socket-proxy`. One collector installation is supported per Docker daemon. No ports are published.

From the created directory, use `docker compose logs -f collector` to troubleshoot. Keep the downloaded script and collector.json private: both contain reporting credentials. Do not commit them to Git. Repeat registration for additional hosts. The socket path defaults to /var/run/docker.sock; rootless Docker requires adjusting it.

## Move an existing collector

Use **Move existing collector** on the dashboard to download `docker-watch-update.sh`. On each server, run `bash docker-watch-update.sh /path/to/existing/docker-watch-directory`. Use `sudo bash ...` if the old directory belongs to root or is under `/root`; the new installation will still belong to your invoking user. The optional second argument chooses a different target directory.

This migrates to `/srv/docker/docker-dashboard-collector` with the readable container names above. It copies the existing `collector.json` unchanged, preserving the host ID and reporting credentials, so no new host registration is required. It validates the new Compose configuration and pulls images before stopping the original project. It starts the new project and attempts to restart the old project if startup fails. The original files remain for rollback; keep them private. The target must not already exist. The old project must use the project name from its Compose file or original directory, rather than a custom CLI `-p` override.

## Architecture and security

HAProxy permits only GET /version and versioned container list/inspect endpoints. All other paths and methods are denied. The proxy mounts the Docker socket and joins only an internal network. The collector joins that network plus an outbound network. Socket access is privileged; a read-only mount does not restrict API methods. The proxy allowlist provides that restriction. Inspection may contain sensitive local fields, so the collector must remain trusted.

Only container ID, name, image, state, health, restart count, start/finish timestamps, and Engine version leave the host. No environment variables, logs, mounts, or network addresses are transmitted. A partial collection sends no report. Reports are limited to 250 containers and 128 KiB. Running does not guarantee application availability, and restart counts reset when containers are recreated.

Private Sites access protects viewing. Viewer APIs additionally require the platform authenticated-user header. Registration requires the browser Origin to match the request URL origin, supporting both the generated Site URL and attached custom domains. The collector continues to report to the configured SITE_ORIGIN endpoint. Ingestion requires a platform service credential and a host-specific token; host tokens are stored as SHA-256 hashes. Credentials are runtime secrets, not committed source. Keep the Site owner-private; reassess authorization before sharing it.

R2 stores configuration documents and the latest JSON snapshot for each host in separate keys. There is no historical metrics retention or remote container control.

## Operations

Use `docker compose pull` and `docker compose up -d` from the collector directory to update images; pin approved image digests for exact reproducibility. `docker compose down` stops reporting and the board becomes stale.

Collector credentials are generated once. Retain the protected files; this version has no recovery or token rotation UI. If files are lost, register a new unique host name; the old entry stays stale. Service credential rotation requires updating every collector. To revoke a host, remove its hosts/<uuid>.json object in Site storage administration.

## Development and validation

The deployed app is a dependency-free Worker ESM module. The repository contains only the dependencies it uses; no npm dependencies need to be installed.

Run `node scripts/build-board.mjs`, `node scripts/validate-artifact.mjs`, `node scripts/check-board.mjs`, and `node scripts/check-installer.mjs`. Checks cover private routes, origin validation, token rejection, report limits, field allowlisting, persistence, multiple hosts, and installer generation using an R2 test double. Installer execution tests use a Docker command double to verify file permissions, clean names, migration, overwrite protection, and startup rollback; run them as an ordinary user as well to exercise the sudo fallback. Installer shell syntax and Python syntax are also checked. Temporary-container tests verified that a non-root collector can read mode-0600 credentials and the restricted proxy can read Docker status without accepting other endpoints. A live reporting smoke test is required after installing on each host. Browser and optional WebMCP validation were unavailable in this environment.

## Repository guide

- [Architecture and authentication](docs/architecture.md)
- [Install or migrate a collector](docs/deployment.md)
- [Development and automated checks](docs/development.md)

GitHub tracks source and runs checks; deployment remains managed through ChatGPT Sites.

## Crowsnest branding

The crow emblem and dark-slate/copper interface identify Crowsnest. Existing collector filenames, Compose names, installation paths, and API endpoints stay compatible with the installed fleet. Brand assets and the image-generation brief are stored under `worker/assets`.
