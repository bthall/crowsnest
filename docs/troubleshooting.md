# Troubleshooting

Start with the collector logs and container state:

```bash
cd /srv/docker/docker-dashboard-collector
sudo docker compose ps
sudo docker compose logs --tail 50 collector socket-proxy
```

Omit sudo if your account has Docker access. Redact credentials before sharing any configuration or diagnostic output.

| Symptom | What to check |
| --- | --- |
| Cannot create the installation directory | Run the installer as your normal user and allow sudo for directory creation, or pass a writable absolute target path. |
| Docker daemon permission denied | Use the installer's sudo fallback. Verify Docker is running; do not loosen socket permissions. |
| Collector cannot read its configuration | Check that `collector.json` is owned by the UID/GID in `.env`, is mode 0600, and is mounted read-only. Recreate the collector after correcting its configured user. |
| Host stays Awaiting report or becomes Stale | Check that both services are running, the socket proxy responds, and the collector can make outbound HTTPS requests. |
| `Reporting failed: HTTP 401` | Check that the platform service credential is valid for the private Site. Coordinate a credential update with the owner. |
| `Reporting failed: HTTP 403` | Check that the host token and host ID belong to the same registration. Keep credentials from one installation together. |
| `Reporting failed: HTTP 404` | Check that the dashboard URL is correct and that the host registration still exists. |
| Collection error with no successful reports | Check the socket path, proxy logs, and the 250-container limit. The collector does not send partial snapshots. |
| Invalid origin during registration | Access registration through the same origin as the dashboard page. Confirm the deployed version supports the attached custom domain. |
| Directory or named container already exists | Inspect the existing installation. The scripts deliberately avoid overwriting a target or colliding with fixed container names. |

## Credentials lost

There is no credential-recovery UI. Contact the owner before changing storage or secrets. A new registration requires a unique name and leaves the old registration present until it is removed through storage administration.
