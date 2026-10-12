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
| `Reporting failed: HTTP 409` | A management change overlapped token activation. The collector retries automatically; if it persists, prepare current credentials through Manage host. |
| `Reporting failed: HTTP 301/302/303/307/308` | The reporting endpoint redirects. Use the stable generated HTTPS Site origin; collectors reject redirects to protect credentials. |
| Collection error with no successful reports | Check the socket path, proxy logs, the 250-container/128-KiB limits, and response acknowledgement. Non-404 inspection failures prevent submission. |
| `Collection failed: TimeoutError` | Docker inspections exceeded their admission budget or a socket timed out. Check the proxy and Docker daemon; existing status remains marked stale until a full report succeeds. |
| Invalid origin during registration | Access registration through the same origin as the dashboard page. Confirm the deployed version supports the attached custom domain. |
| Directory or named container already exists | Inspect the existing installation and use Manage host for credential replacement. Do not extract a new package over it. Only one collector is supported per Docker daemon. |

## Credentials lost

For an awaiting host, choose **Continue setup** to prepare new copied setup and a matching Compose package. For an already reporting host, choose **Manage host → Replace reporting token** to prepare a configuration. Apply it within ten minutes and confirm activation. The current token remains valid until the first successful report with the replacement. An expired replacement requires preparing another one; restore the previous private configuration if the collector was already switched to an expired token.

If the platform service credential was changed, every collector needs that new value through a private configuration update. Do not post either credential in an issue or message containing diagnostics.
