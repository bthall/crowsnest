# Install a collector

## New installation

In the private dashboard, choose **Connect a host**, enter a unique name, and choose **Prepare setup**. Choose **Copy setup** and paste it into a Bash terminal on the Docker host as your normal user. Docker Engine and Compose v2 must already be installed. Setup detects whether Docker needs sudo, creates a private directory owned by your user, and writes `compose.yaml`, `collector.py`, `proxy.cfg`, `collector.json`, and `.env`. It validates the Compose configuration without pulling images or starting containers.

Review `compose.yaml`, `collector.py`, and `proxy.cfg` in `/srv/docker/docker-dashboard-collector`, then use **Copy start commands** to start the collector. No file transfer is needed. If clipboard access is blocked, the dashboard reveals a selected, read-only setup field for manual copying. Closing setup clears the in-memory command and that field; it cannot clear your operating system clipboard or terminal history.

Copied setup contains the same private reporting credentials as a downloaded package. Paste it only into the intended host's terminal and keep any shell history containing it private. The dashboard does not create a public credential download URL or put service credentials in a curl command.

For a different installation directory, change the first copied line from `bash <<'CROWSNEST_SETUP'` to `bash -s -- /srv/docker/your-directory <<'CROWSNEST_SETUP'`. Use an absolute path and quote paths containing spaces. Use the same path in the start and maintenance commands.

### Download alternative

Choose **Download and transfer instead** to download `crowsnest-collector.tar` and transfer it privately to the host. It contains the same Compose, Python, proxy, and configuration files plus a short README. Inspect the files before starting.

Follow the commands shown in the dashboard as your normal user. The default sequence below assumes the archive is at `~/Downloads/crowsnest-collector.tar` and Docker requires sudo. Change the archive path to its actual location; omit sudo on Docker commands when your user has daemon access.

```bash
test ! -e /srv/docker/docker-dashboard-collector &&
sudo install -d -m 0700 -o "$(id -u)" -g "$(id -g)" /srv/docker/docker-dashboard-collector &&
cd /srv/docker/docker-dashboard-collector &&
(umask 077
 tar --keep-old-files -xf ~/Downloads/crowsnest-collector.tar &&
 printf 'COLLECTOR_UID=%s\nCOLLECTOR_GID=%s\n' "$(id -u)" "$(id -g)" > .env) &&
sudo docker compose config --quiet &&
sudo docker compose up -d
```

For a different directory under `/srv/docker`, replace the path consistently in these commands. The initial check and `tar --keep-old-files` protect existing installations; each step proceeds only if the previous step succeeds. If the directory already exists, inspect it and use **Manage host** for credential replacement. If extraction fails on a new, empty installation, correct the archive path and finish the remaining steps inside that directory.

Choose **I’ve started the collector** to wait for its first report. Closing the dialog keeps the host registration. Use **Continue setup** to prepare new copied setup and a matching package for an awaiting host. That replacement must activate within ten minutes; otherwise prepare new setup again.

The Compose project is `docker-dashboard`. Containers are `docker-dashboard-collector` and `docker-dashboard-socket-proxy`. The deployment files belong to the installing user, including the invoking user when the installer is run through sudo. The collector runs with that user's UID/GID. The directory is private (0700), and `collector.json` and `.env` are private (0600).

One collector installation is supported per Docker daemon. The Docker socket defaults to `/var/run/docker.sock`; rootless Docker requires adjusting the socket path and user mapping for the daemon. Do not loosen socket permissions. The socket proxy runs as container root with all capabilities dropped, and permits only selected Docker API reads. No ports are published.

The older script format remains supported by the registration API for compatibility. Existing collectors do not need reinstalling for this dashboard release.

## Verify and maintain

```bash
cd /srv/docker/docker-dashboard-collector
sudo docker compose logs -f collector
```

Omit sudo if your user already has Docker access. Successful reports log `Status delivered: ... containers`. The host should appear as Reporting in the dashboard. The collector retries failures every 30 seconds; reports become stale after two minutes.

`docker compose pull` and `docker compose up -d` update container images. Keep credentials private.

## Manage hosts and reporting credentials

Select a host and choose **Manage host** to rename it, prepare replacement credentials, or remove it. Renaming changes only the dashboard label. Removal requires entering the exact current name and invalidates the host registration, removing its snapshot and activity. It leaves containers running on the server; stop the collector from its installation directory with `docker compose down` when retiring it.

To replace a reporting token, download the new `collector.json` and transfer it privately to the host. In the installation directory, install it as the owning user and recreate the collector:

```bash
install -m 0600 ~/Downloads/collector.json ./collector.json
sudo docker compose up -d --force-recreate collector
```

The existing token stays valid until a successful report using the replacement arrives. The replacement must first activate within ten minutes. An expired or lost replacement does not revoke the current token; prepare another configuration. Keep a private copy of the previous configuration until activation is confirmed so you can restore it after an expired attempt. Once activated, the previous host token is rejected. Only the latest prepared replacement can activate.

This flow rotates the per-host reporting token. The platform service credential is shared by collectors and must be changed through Sites, followed by updating every collector. For a compromised host token requiring immediate revocation, remove the host rather than relying on the staged replacement window, then enroll it again with a new installation/configuration.
