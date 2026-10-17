# Self-hosting Crowsnest

Crowsnest runs as a single Docker Compose service with a persistent SQLite volume. You do not need a ChatGPT account, Cloudflare account, or platform service token. Each instance has one owner account. Collectors continue to report outbound over HTTPS.

## Requirements

- Linux, Docker Engine, and Docker Compose v2.
- An HTTPS dashboard origin and a reverse proxy that forwards the original `Host` header.
- At least 768 MiB available for the dashboard container. Password hashing uses approximately 128 MiB per attempt, with at most two concurrent hashes.
- Access to this repository, or a versioned deployment archive and its GHCR image.

The image caps Node's managed heap at 192 MiB to leave headroom for native password hashing, SQLite, buffers, and diagnostic commands within the container's 768 MiB limit.

The Compose file binds the dashboard to `127.0.0.1:8080`. Use a reverse proxy on that host, or explicitly configure a private Docker network for a containerized proxy. Do not expose the backend port publicly.

## Install

When a versioned release is available, use its deployment archive from [GitHub Releases](https://github.com/bthall/crowsnest/releases). It contains a Compose file pinned to the tested multi-platform image digest, an empty configuration example, instructions, and the MIT license. Verify the accompanying `SHA256SUMS` before extracting. While the repository and registry remain private, repository access and GHCR read authentication are required. Public publication is an owner decision.

The source-build path below remains available and requires access to this repository.

Create a directory under `/srv/docker` owned by your normal user, then clone the repository there. For example:

```bash
sudo install -d -m 0755 -o "$(id -u)" -g "$(id -g)" /srv/docker/crowsnest
git clone https://github.com/bthall/crowsnest.git /srv/docker/crowsnest
cd /srv/docker/crowsnest
umask 077
cp .env.example .env
```

Edit `.env` and set `CROWSNEST_PUBLIC_URL` to your HTTPS origin, such as `https://crowsnest.example.com`. Include a nonstandard HTTPS port if your proxy uses one. No path, query, embedded credentials, or fragment is allowed.

```bash
docker compose up -d --build
docker compose ps
docker compose exec crowsnest node server/cli.mjs setup-token
```

Use `sudo docker` when your account requires it. The last command prints a private code valid for 15 minutes. Open your configured URL, enter that code, and choose a username and a password of at least 12 characters. There is no default password. Generating a new code invalidates the previous code.

![Owner setup with the server code, username, and password fields](screenshots/owner-setup-desktop.png)

This is an actual interface capture with empty fields. [Screenshot provenance](screenshots/README.md).

For a host-based Caddy proxy, a minimal configuration is:

```caddyfile
crowsnest.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Configure DNS and certificate issuance for your own environment. Keep TLS verification enabled. Crowsnest uses its configured origin for links and same-origin checks; it does not trust client-supplied forwarded identity or IP headers.

## Connect hosts

Choose **Connect a host** and follow the four setup steps. Copy the preparation block into a Bash terminal on the Docker host, review the generated files, start the Compose project, and wait for an actual report. New collectors use `/srv/docker/crowsnest-collector`. The maintenance commands also find earlier default installations; see [collector migration](deployment.md#migrate-an-existing-installation) to adopt the Crowsnest deployment names.

Standalone collector configuration contains its dashboard URL, host ID, and individual reporting token. It has no ChatGPT Sites service token. Dashboard and collector credentials are separate; reporting tokens cannot sign in or read the fleet.

Existing collectors aimed at another dashboard are not migrated automatically. Enroll them in the new instance and replace their configuration deliberately. Do not reuse registrations from a different instance without a documented data migration.

## Notifications

Set `NTFY_URL` to a private, hard-to-guess topic and provide `NTFY_TOKEN` for an authenticated ntfy server. Then recreate the dashboard:

```bash
docker compose up -d
```

Enable notifications in the dashboard, subscribe from your phone, and send a test. The dashboard checks alert state every 30 seconds; a separate notifier container is unnecessary for standalone deployment. See [notifications](notifications.md) for topic permissions and delivery troubleshooting. Topic secrecy alone does not provide authentication.

You may instead mount a Docker secret and set `NTFY_TOKEN_FILE` to its container path. Use either the token environment variable or the file, never both. Keep `.env` private and untracked.

## Backup

The SQLite online-backup API creates a consistent backup while the server is running. Do not copy only the live `.sqlite` file: committed changes can be in its WAL file.

```bash
docker compose exec crowsnest node server/cli.mjs backup /data/backup-2026-10-13.sqlite
umask 077
docker compose cp crowsnest:/data/backup-2026-10-13.sqlite ./backup-2026-10-13.sqlite
chmod 0600 ./backup-2026-10-13.sqlite
```

Use a new filename for each backup. Move backups to private off-host storage, test restoring them, and retain the corresponding application version. Backups contain password hashes, host credentials, and private fleet data; protect them like the live data volume. Runtime `.env` values and ntfy secrets need a separate private backup.

## Restore

1. Make a current backup if possible. Stop the server with `docker compose down`, keeping the data volume.
2. Copy the chosen backup into that volume, for example with a one-off container:

```bash
docker compose run --rm --no-deps --entrypoint sh crowsnest -c 'cat > /data/restore.sqlite' < ./backup-2026-10-13.sqlite
docker compose run --rm --no-deps --entrypoint node crowsnest server/cli.mjs restore /data/restore.sqlite
docker compose up -d
```

Restore verifies database integrity and schema, takes the same process lock as the server, and refuses while the server is running. It replaces the instance database and invalidates restored browser sessions and setup/recovery codes. Sign in again after restart. Restored reporting-token state matches the backup, so a token rotated after the backup may need replacement.

The database is versioned and uses WAL with full synchronous commits. Run one server per data volume. Do not scale multiple replicas against the same files or place SQLite on an unreliable/network filesystem.

## Update and recover access

Back up first, check the changelog, and select the intended release commit or tag before building. Then run `docker compose up -d --build`. The persistent volume survives recreation. Do not run `docker compose down --volumes` unless you intend to delete the instance data.

If you forget the owner password:

```bash
docker compose exec crowsnest node server/cli.mjs reset-token
```

Open the recovery URL printed by the command, enter the current owner username and recovery code, and set a new password. Successful recovery invalidates all existing browser sessions.

## Diagnostics and local development

```bash
docker compose logs --tail=50 crowsnest
docker compose exec crowsnest node server/cli.mjs doctor
```

The diagnostic command reports schema version, database integrity, whether an owner exists, and host count. Logs omit credentials and request bodies. Health checks use `/healthz`; this exposes only a readiness boolean.

For local development, use `npm ci --ignore-scripts`, `npm run build`, then `npm start`. The default origin is `http://127.0.0.1:8080`, and data is stored in the ignored `data/` directory. Linux `flock` is required for the process lock. HTTP is allowed only for loopback development; production collector enrollment requires an HTTPS origin. Node 22 or newer is required; the Docker image uses Node 24 LTS.
