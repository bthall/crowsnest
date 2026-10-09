# Install or migrate a host

## New installation

In the private dashboard, choose **Connect a host**, enter a unique name, and download `docker-watch-setup.sh`. Review it and transfer it privately to the host. Run it as your normal user:

```bash
bash docker-watch-setup.sh
```

The default directory is `/srv/docker/docker-dashboard-collector`. Pass an absolute path as the first argument to choose another directory. The installer refuses to overwrite an existing destination. It asks for sudo only when directory creation or Docker access requires it.

The Compose project is `docker-dashboard`. Containers are `docker-dashboard-collector` and `docker-dashboard-socket-proxy`. The deployment files belong to the installing user, including the invoking user when the installer is run through sudo. The collector runs with that user's UID/GID. The directory is private (0700), and `collector.json` and `.env` are private (0600).

One collector installation is supported per Docker daemon. The Docker socket defaults to `/var/run/docker.sock`; rootless Docker requires adjusting the socket path and user mapping for the daemon. The installer does not grant Docker access by changing groups or loosening socket permissions.

## Existing installation

Choose **Move existing collector** in the dashboard and download `docker-watch-update.sh`. Run:

```bash
bash docker-watch-update.sh /path/to/existing/collector
```

If the old directory requires root access:

```bash
sudo bash docker-watch-update.sh /path/to/existing/collector
```

The optional second argument sets the destination directory. Migration preserves `collector.json` exactly, so the host ID and reporting credentials stay the same. It validates configuration and pulls images before stopping the old deployment, then starts the new project. If startup fails, it attempts to restart the original deployment. The original files remain available for rollback. The old project must use its Compose-declared or directory-derived name rather than an external `-p` override.

## Verify and maintain

```bash
cd /srv/docker/docker-dashboard-collector
sudo docker compose logs -f collector
```

Omit sudo if your user already has Docker access. Successful reports log `Status delivered: ... containers`. The host should appear as Reporting in the dashboard. The collector retries failures every 30 seconds; reports become stale after two minutes.

`docker compose pull` and `docker compose up -d` update container images. Keep credentials and original migration files private. This version has no token recovery or rotation UI; losing credentials requires a new host registration, while the old entry remains stale.
