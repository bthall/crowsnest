# Configuration reference

## Hosted dashboard

Configure production values through ChatGPT Sites. Do not write secrets to source or `.openai/hosting.json`.

| Key or binding | Required | Purpose |
| --- | --- | --- |
| `BUCKET` | Yes | R2 storage for host registrations and latest snapshots |
| `SITE_ORIGIN` | Yes | Canonical HTTPS reporting endpoint embedded in new collector configuration |
| `DASHBOARD_ORIGIN` | No | Preferred HTTPS browser origin; homepage requests on other Site domains redirect here |
| `NTFY_URL` | No | Full HTTPS topic URL; operator-controlled notification destination |
| `NTFY_TOKEN` | No, secret | Bearer token for a dedicated write-only ntfy publisher |
| `NTFY_ENABLED` | No | `true` enables a new configuration until dashboard settings are saved; default off |
| `COLLECTOR_SERVICE_TOKEN` | Yes, secret | Platform service credential used by collectors to reach the private Site |

Keep `SITE_ORIGIN` as a stable reporting endpoint when changing the browser address. Set `DASHBOARD_ORIGIN` to the new HTTPS origin after its DNS and certificate are active. It must have no path, credentials, query, or fragment. An absent or invalid value disables the homepage redirect.

Authenticated homepage GET and HEAD requests on other attached domains redirect to `DASHBOARD_ORIGIN`; API and asset routes stay on the requested domain. Browser registration accepts the actual request's origin. Existing collectors continue to use their configured endpoint without reinstalling. Keep old domains attached while collectors use them.

The hosting manifest retains the existing Site's identifier and declares the `BUCKET` R2 binding. Do not replace the Site ID during an update or change the access policy as a shortcut for service access. This checkout is configured for the existing deployment; provisioning a separate Site requires its own identity, storage, runtime settings, and access policy.

## Collector installation

| Item | Default or behavior |
| --- | --- |
| Directory | `/srv/docker/docker-dashboard-collector` |
| Compose project | `docker-dashboard` |
| Collector container | `docker-dashboard-collector` |
| Proxy container | `docker-dashboard-socket-proxy` |
| Docker socket | `/var/run/docker.sock` |
| Reporting interval | 30 seconds |
| Dashboard refresh interval | 15 seconds |
| Stale threshold | 120 seconds |

The installer writes `COLLECTOR_UID` and `COLLECTOR_GID` to the deployment's private `.env` file. They match the file owner, including the invoking user when running through sudo. The socket proxy runs as container root with dropped capabilities; the collector runs as the configured UID/GID.

`collector.json` contains the dashboard URL, host ID, host token, and platform service token. It is generated during registration. It is not a source file, and it must not be committed. The repository has no real sample credentials.

A custom installation path is passed to the setup script as its first argument. Rootless Docker is not automatically configured; adjust the socket mount and user mapping for that daemon before running the collector.

## Current limits

- Up to 100 registered hosts.
- Up to 250 containers per report.
- A report body no larger than 128 KiB.
- Host names up to 64 characters, unique without regard to case.
- Only the latest snapshot is retained for each host.
- Compose project/service fields are optional, at most 128 characters each. Only the standard `com.docker.compose.project` and `com.docker.compose.service` labels are collected.
- Per-host maintenance timers allow 15 minutes, 1 hour, 4 hours, or 24 hours; the server bounds the duration.
- Activity retains up to 100 events per host within 30 days; older entries are hidden and pruned on the next history write.
- Replacement reporting tokens have a ten-minute activation window. The current token remains valid until replacement activation.

A partial collection is not sent as a successful report. Stale data remains visible and is marked stale.

## Notifications

See [ntfy setup and background checks](notifications.md). Dashboard settings persist in R2 and override the initial `NTFY_ENABLED` default. Changing the destination starts a new delivery baseline. A configured URL alone leaves notifications off.
