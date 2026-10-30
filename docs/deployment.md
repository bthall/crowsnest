# Install a collector

## New installation

In the private dashboard, choose **Connect a host**, enter a unique name, and choose **Prepare setup**. Choose **Copy setup** and paste it into a Bash terminal on the Docker host as your normal user. Docker Engine and Compose v2 must already be installed. Setup detects whether Docker needs sudo, creates a private directory owned by your user, and writes `compose.yaml`, `collector.py`, `proxy.cfg`, `collector.json`, `.env`, and the local `crowsnest` manager. It validates the Compose configuration without pulling images or starting containers.

When the terminal prints **Private Compose files prepared**, choose **Files prepared — continue**. Review `compose.yaml`, `collector.py`, and `proxy.cfg` in `/srv/docker/crowsnest-collector`, then use **Copy start commands** to start the collector. No file transfer is needed. If clipboard access is blocked, the dashboard reveals a selected, read-only setup field for manual copying. Closing setup clears the in-memory command and that field; it cannot clear your operating system clipboard or terminal history.

Copied setup contains the same private reporting credentials as a downloaded package. Paste it only into the intended host's terminal and keep any shell history containing it private. The dashboard does not create a public credential download URL or put service credentials in a curl command.

For a different installation directory, change the first copied line from `bash <<'CROWSNEST_SETUP'` to `bash -s -- /srv/docker/your-directory <<'CROWSNEST_SETUP'`. Use an absolute path and quote paths containing spaces. Use the same path in the start and maintenance commands.

### Download alternative

Choose **Download and transfer instead** to download `crowsnest-collector.tar` and transfer it privately to the host. It contains the same Compose, Python, proxy, and configuration files, the local manager, and a short README. Inspect the files before starting.

Follow the commands shown in the dashboard as your normal user. The default sequence below assumes the archive is at `~/Downloads/crowsnest-collector.tar` and Docker requires sudo. Change the archive path to its actual location; omit sudo on Docker commands when your user has daemon access.

```bash
test ! -e /srv/docker/crowsnest-collector &&
sudo install -d -m 0700 -o "$(id -u)" -g "$(id -g)" /srv/docker/crowsnest-collector &&
cd /srv/docker/crowsnest-collector &&
(umask 077
 tar --keep-old-files -xf ~/Downloads/crowsnest-collector.tar &&
 printf 'COLLECTOR_UID=%s\nCOLLECTOR_GID=%s\n' "$(id -u)" "$(id -g)" > .env) &&
sudo docker compose config --quiet &&
sudo docker compose up -d
```

For a different directory under `/srv/docker`, replace the path consistently in these commands. The initial check and `tar --keep-old-files` protect existing installations; each step proceeds only if the previous step succeeds. If the directory already exists, inspect it and use **Manage host** for credential replacement. If extraction fails on a new, empty installation, correct the archive path and finish the remaining steps inside that directory.

Choose **I’ve started the collector** to wait for its first report. Closing the dialog keeps the host registration. Use **Continue setup** to prepare new copied setup and a matching package for an awaiting host. That replacement must activate within ten minutes; otherwise prepare new setup again.

The Compose project is `crowsnest-collector`. Containers are `crowsnest-collector` and `crowsnest-socket-proxy`. The deployment files belong to the installing user, including the invoking user when the installer is run through sudo. The collector runs with that user's UID/GID. The directory is private (0700), and `collector.json` and `.env` are private (0600).

One collector installation is supported per Docker daemon. The Docker socket defaults to `/var/run/docker.sock`; rootless Docker requires adjusting the socket path and user mapping for the daemon. Do not loosen socket permissions. The socket proxy runs as container root with all capabilities dropped, and permits only selected Docker API reads. No ports are published.

The older script format remains supported by the registration API for compatibility. Existing collectors do not need reinstalling for this dashboard release.

## Verify and maintain

```bash
cd /srv/docker/crowsnest-collector
sudo docker compose logs -f collector
```

Omit sudo if your user already has Docker access. Successful reports log `Status delivered: ... containers`. The host should appear as Reporting in the dashboard. The collector retries failures every 30 seconds; reports become stale after two minutes.

Before image migration, `docker compose pull` only updates the base runtimes because collector code is bind-mounted. After image migration, use `./crowsnest update`; see [collector updates](collector-updates.md). Keep credentials private.

## Manage hosts and reporting credentials

Select a host and choose **Manage host** to rename it, prepare replacement credentials, or remove it. Renaming changes only the dashboard label. Removal requires entering the exact current name and invalidates the host registration, removing its snapshot and activity. It leaves containers running on the server; stop the collector from its installation directory with `docker compose down` when retiring it.

To replace a reporting token, download the new `collector.json` and transfer it privately to the host. In the installation directory, install it as the owning user and recreate the collector:

```bash
install -m 0600 ~/Downloads/collector.json ./collector.json
if [ -e .crowsnest/active.json ] || [ -e .crowsnest/state.json ] || [ -e .crowsnest/pending.json ]; then
  ./crowsnest restart
else
  sudo docker compose up -d --force-recreate collector
fi
```

The existing token stays valid until a successful report using the replacement arrives. The replacement must first activate within ten minutes. An expired or lost replacement does not revoke the current token; prepare another configuration. Keep a private copy of the previous configuration until activation is confirmed so you can restore it after an expired attempt. Once activated, the previous host token is rejected. Only the latest prepared replacement can activate.

This flow rotates the per-host reporting token. The platform service credential is shared by collectors and must be changed through Sites, followed by updating every collector. For a compromised host token requiring immediate revocation, remove the host rather than relying on the staged replacement window, then enroll it again with a new installation/configuration.

## Update an existing collector

Select the host, then **Manage host → Update collector → Prepare update command**.
Run the copied command in Bash as the installation owner. It installs the local
`crowsnest` manager and migrates the existing installation to the independently
released collector and restricted proxy images. The matching collector release
must be published and its GHCR images readable. Missing releases or failed pulls
leave the running containers intact.

For a custom path, export `CROWSNEST_COLLECTOR_DIR` before running the copied block.
The manager preserves credentials, `.env`, original Compose files, overrides, and
host registration. After the one-time migration, use `./crowsnest update`,
`./crowsnest status`, and `./crowsnest rollback`. Automatic updates remain disabled
until explicitly enabled on that host.

See [collector updates](collector-updates.md) for exact commands, maintenance
windows, supported customizations, effective deployment snapshots, and recovery.
Use the manager for deployment changes after migration: plain Compose commands
against the unchanged legacy source template would restore its old deployment.


## Migrate an existing installation

The earlier default used `/srv/docker/docker-dashboard-collector`, project `docker-dashboard`, and containers `docker-dashboard-collector` / `docker-dashboard-socket-proxy`. Updating its code preserves the existing Compose file. To adopt Crowsnest names, first update through **Manage host**, then run this in Bash as the installation owner. It briefly stops the two collector services, moves their directory, and updates only the default Compose names. Reporting credentials, `.env`, and the host registration stay in place.

The example assumes the unchanged earlier Compose template and direct Docker access. Use `sudo docker` on its Docker commands if required. For a custom path or modified Compose file, apply the same directory/project/container changes to your actual installation instead.

```bash
set -eu
cd /srv/docker/docker-dashboard-collector
test -O .
test ! -e /srv/docker/crowsnest-collector
umask 077
cp -p compose.yaml compose.before-crowsnest.yaml
chmod 0600 compose.before-crowsnest.yaml
docker compose config --quiet
docker compose down
sed -i \
  -e 's/^name: docker-dashboard$/name: crowsnest-collector/' \
  -e 's/container_name: docker-dashboard-/container_name: crowsnest-/' \
  compose.yaml
docker compose config --quiet
cd /srv/docker
sudo mv -- docker-dashboard-collector crowsnest-collector
cd /srv/docker/crowsnest-collector
docker compose up -d
docker compose logs --tail=30 collector
```

Keep the previous Compose file until fresh reports confirm the migration. If startup fails, run `docker compose down`, restore `compose.before-crowsnest.yaml` as `compose.yaml`, and start that previous configuration from the same directory. The old project/container names work with either directory location. No host re-enrollment is needed.

## Pause notifications during maintenance

Select a host and open **Manage host → Maintenance mode**. Choose 15 minutes, 1 hour, 4 hours, or 24 hours and pause notifications. A banner and host label show the pause. **End maintenance now** resumes early; otherwise the timer expires automatically using server time.

Automatic alerts and recoveries are suppressed for that host, including background stale-host checks. Reports, health indicators, in-app alerts, and activity continue. After expiry or early end, the next report or background sweep evaluates current issues against the last delivered notification state. A failure that appears and clears entirely during the pause sends no false recovery. A previously delivered alert can send a recovery afterward. Manual ntfy tests remain available.

## Container health and resource limits

New collector deployments pin Python 3.13.17 and HAProxy 3.0.30 by image digest.
The collector has a 96 MiB memory limit, 0.35 CPU limit, and 32-process limit;
the restricted socket proxy has 32 MiB, 0.25 CPU, and 16 processes. HAProxy uses
one worker thread so hosts with many CPUs stay within that process budget. Both retain
the read-only filesystem and dropped capabilities. A 1 MiB temporary filesystem
holds the collector's last accepted delivery marker.

Docker marks the collector unhealthy after repeated checks find no accepted
report within 180 seconds. The socket proxy checks its allowed `/version` route.
An unhealthy status alone does not restart a Docker container. Investigate
transport, authentication, and resource failures before changing the limits.

Updating a collector preserves its existing Compose file. To adopt these defaults
on an existing host, compare the current source template with that file, preserve
its identity and private mounts, and recreate the services after updating both
code and Compose. Code updates remain compatible with existing heartbeat checks.
When an older template has no writable marker storage, accepted reports still log
success; source-only updates do not require adopting the new health check.
