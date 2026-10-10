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
| Cannot create the installation directory | Use the displayed sudo install command as your normal user, or choose another writable absolute directory. |
| Docker daemon permission denied | Enable “My Docker commands require sudo” in enrollment. Verify Docker is running; do not loosen socket permissions. |
| Collector cannot read its configuration | Check that `collector.json` is owned by the UID/GID in `.env`, is mode 0600, and is mounted read-only. Recreate the collector after correcting its configured user. |
| Host stays Awaiting report or becomes Stale | Check that both services are running, the socket proxy responds, and the collector can make outbound HTTPS requests. |
| `Reporting failed: HTTP 401` | Check that the platform service credential is valid for the private Site. Coordinate a credential update with the owner. |
| `Reporting failed: HTTP 403` | Check that the host token and host ID belong to the same registration. Keep credentials from one installation together. |
| `Reporting failed: HTTP 404` | Check that the dashboard URL is correct and that the host registration still exists. |
| Collection error with no successful reports | Check the socket path, proxy logs, and the 250-container limit. The collector does not send partial snapshots. |
| Invalid origin during registration | Access registration through the same origin as the dashboard page. Confirm the deployed version supports the attached custom domain. |
| Directory or named container already exists | Inspect the existing installation and use Manage host for credential replacement. Do not extract a new package over it. Only one collector is supported per Docker daemon. |

## Credentials lost

For an awaiting host, choose **Continue setup** to prepare another Compose package. For an already reporting host, choose **Manage host → Replace reporting token** to prepare a configuration. Apply it within ten minutes and confirm activation. The current token remains valid until the first successful report with the replacement. An expired replacement requires preparing another one; restore the previous private configuration if the collector was already switched to an expired token.

If the platform service credential was changed, every collector needs that new value through a private configuration update. Do not post either credential in an issue or message containing diagnostics.
