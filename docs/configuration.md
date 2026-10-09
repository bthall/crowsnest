# Configuration reference

## Hosted dashboard

Configure production values through ChatGPT Sites. Do not write secrets to source or `.openai/hosting.json`.

| Key or binding | Required | Purpose |
| --- | --- | --- |
| `BUCKET` | Yes | R2 storage for host registrations and latest snapshots |
| `SITE_ORIGIN` | Yes | Canonical HTTPS reporting endpoint embedded in new collector configuration |
| `COLLECTOR_SERVICE_TOKEN` | Yes, secret | Platform service credential used by collectors to reach the private Site |

`SITE_ORIGIN` remains the reporting endpoint when a custom domain is added. Browser registration accepts the actual request's origin; existing collectors continue to use their configured endpoint.

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

`collector.json` contains the dashboard URL, host ID, host token, and platform service token. It is generated during registration or preserved during migration. It is not a source file, and it must not be committed. The repository has no real sample credentials.

A custom installation path is passed to the setup script as its first argument or the migration script as its second argument. Rootless Docker is not automatically configured; adjust the socket mount and user mapping for that daemon before running the collector.

## Current limits

- Up to 100 registered hosts.
- Up to 250 containers per report.
- A report body no larger than 128 KiB.
- Host names up to 64 characters, unique without regard to case.
- Only the latest snapshot is retained for each host.

A partial collection is not sent as a successful report. Stale data remains visible and is marked stale.
