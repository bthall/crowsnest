# Collector images and updates

Collector releases have their own version in `collector/version.json` and GitHub tag
`collector-vMAJOR.MINOR.PATCH`. Dashboard releases do not make a working collector
outdated. Protocol compatibility is tracked separately; a missing protocol in an
older report is unknown, not an automatic instruction to upgrade.

Updates are manual by default. Each host owns its update policy and Docker access.
The dashboard displays reported policy and outcomes; it does not remotely control
Docker or enable automatic updates.

## Migrate once, then update

The dashboard's **Manage host → Update collector → Prepare update command** installs
the local `crowsnest` manager and performs the one-time migration to packaged images.
Run the copied Bash command as the installation owner. Host Python 3.9+ and Docker
Compose v2 are required. The image release matching the dashboard's collector version
must already be published and both GHCR packages must be readable by that host.
A missing release or failed image pull leaves the running deployment unchanged.

New dashboard installation packages include the manager. After an independent
collector image release is available, the equivalent commands are:

```bash
cd /srv/docker/crowsnest-collector
./crowsnest migrate --version 0.11.1
./crowsnest status
```

For later updates:

```bash
./crowsnest update
# Or choose an exact stable release:
./crowsnest update --version 0.11.2
```

The version above is an example, not a promise that a release exists. Without
`--version`, the manager selects the highest published stable collector version
and verifies its protocol before any deployment. It rejects downgrades; use
`rollback` to restore the previous deployment.

The release manifest pins both the collector and restricted socket-proxy images
by digest. Python code and HAProxy configuration live inside their respective
images. The manager downloads metadata over verified HTTPS and only accepts the
expected repositories and reporting protocol.

Both images are pulled before either service is recreated. A deployment succeeds
only when the collector has delivered a new report accepted by the dashboard.
Failure restores the previous deployment and verifies reporting again. A failed
rollback is reported separately and keeps its recovery checkpoint.

## Preserve an installation's settings

Use the same installation directory and account that own `collector.json` and
`.env`. `--directory` selects a custom directory before the command:

```bash
/srv/tools/crowsnest --directory /srv/docker/custom-collector status
```

The manager leaves `compose.yaml`, `.env`, credentials, and Compose overrides
untouched. On a manual update it asks Compose to resolve the installation's normal
configuration, including default override files and `COMPOSE_FILE`, then replaces
only the managed images and standard source/config mounts. Supply any custom
Compose environment consistently when running manual updates. Custom source mounts,
builds, or entrypoints that cannot be migrated safely require manual adaptation.

Private effective deployments and recovery checkpoints live under `.crowsnest/`.
Treat this directory as sensitive: a resolved Compose configuration can contain
environment values. Keep its permissions at 0700, retain the images needed for
rollback, and do not prune them during an update. Only a separate, bounded status
directory is mounted read-only into the collector; deployment snapshots are never
mounted into it or sent to the dashboard.

After migration, use `./crowsnest update` and `./crowsnest rollback` for deployment
changes. Running plain `docker compose up` with the unchanged legacy source template
would restore that template's old images and bind mounts. Editing original Compose
settings takes effect on the next manual manager update. `status` reports saved
management state and any pending recovery; the dashboard confirms report freshness.

After replacing reporting credentials, use `./crowsnest restart`. It recreates
only the installed collector from its saved deployment, preserves the pinned
images and overrides, and verifies a fresh accepted report. The dashboard's
token-replacement command selects this path automatically for managed hosts and
uses the original Compose command only for unmigrated installations. A failed
managed restart never falls back to the legacy template.

For image-native installations from a collector release archive, create the private
state directory as the installation owner before starting Compose:

```bash
umask 077
mkdir -p .crowsnest/status
```

Obtain `collector.json` privately through the dashboard and set the owner UID/GID
in `.env`. The public release archive never contains reporting credentials.

## Enable unattended updates explicitly

Complete one successful manual migration/update first. The timer runs as the
installation owner and needs direct Docker access; it cannot prompt for sudo.
Manual operations can use an existing noninteractive sudo authorization. Do not
run the manager as root against another user's installation.

The owner's systemd user manager must remain available after logout. If lingering
is not already enabled, an administrator can explicitly enable it:

```bash
sudo loginctl enable-linger "$USER"
```

Then opt this installation into compatible patch updates during a local window:

```bash
./crowsnest auto-update enable --window 02:00-04:00 --timezone America/New_York
./crowsnest status
```

The systemd user timer checks approximately every fifteen minutes with up to five
minutes of host-specific jitter. The explicit timezone controls window evaluation,
including daylight-saving changes. Midnight-crossing windows are supported. A
short window may contain no timer firing; choose a window long enough for checks
and image pulls. A window limits when a new deployment starts; verification and
recovery may finish after the window ends.

Automatic updates stay within the installed major/minor version and the supported
protocol. Minor/major upgrades need an explicit manual update. Automatic operation
uses the saved effective deployment, preserving settings from the last manual
operation. The manager records the Docker daemon identity and refuses a different
daemon on a later update or rollback, including changes in Docker context.
Overlapping manager commands are rejected by a host lock.

After a deployment fails and is rolled back, automatic attempts for that same
release are blocked to avoid repeated reporting interruptions. A newer release or
a successful explicit manual retry clears that block.

To turn automatic updates off:

```bash
./crowsnest auto-update disable
```

This disables policy before stopping the timer. It does not cancel an already
running update. If another operation holds the manager lock, wait for it to finish
and retry disablement. Check the last result before shutting down the host.
Enabling or disabling updates does not change dashboard notification maintenance
mode; notification pauses remain a separate dashboard control.

## Rollback and recovery

```bash
./crowsnest rollback
./crowsnest status
```

The manager preserves one prior effective deployment. A pending transaction from
an interrupted update is recovered before another deployment. If rollback fails,
inspect host Docker availability, the retained images, mounts, and credentials;
then retry `rollback`. A network or dashboard outage can prevent reporting
verification even when the previous containers are running. Never interpret that
state as a verified recovery.

The dashboard shows the last reported attempt, result, and rollback status. Stale
collectors can only show their last reported policy; a collector that cannot report
also cannot send its newest failure. Host `status` remains available in that case.

## Release validation

The collector release workflow waits for successful Checks and Security on the
same trusted main commit. It builds and tests amd64/arm64 collector and proxy
images, scans for fixable high/critical vulnerabilities, and attaches the digest
manifest, management archive, SBOMs, and checksums. Published version tags are
immutable. Collector releases do not replace the dashboard's GitHub latest release
and do not restart existing hosts.

First-time GHCR packages may be private. The repository owner must configure public
read access or provision registry authentication before hosts can pull them. A
published GitHub manifest alone does not establish registry visibility.

## Refresh the host manager

The manager has its own version and compatibility range, shown by
`./crowsnest manager-info` and `./crowsnest status`. A release declares the minimum
manager it needs. An incompatible upgrade stops before pulling or recreating
containers and prints the exact refresh command:

```bash
./crowsnest self-update
# Or obtain the manager for the collector release you intend to install:
./crowsnest self-update --version 0.11.2
./crowsnest update --version 0.11.2
```

These versions are examples. Refresh downloads the standalone manager asset from
the selected published collector release, verifies its SHA-256 against that
release's manifest, checks Python syntax, and runs its metadata probe before
atomically replacing the executable. It keeps the old executable at
`.crowsnest/manager.previous`. A failed download, checksum, or compatibility check
leaves the installed manager intact. Pending container recovery must be completed
first. Manager downgrades and symbolic executable paths are refused.

Refreshing the manager does not restart containers or change automatic-update
policy. Automatic container updates do not replace this host executable;
refresh is explicit. If an automatic release requires a newer manager, the
attempt is recorded as failed without interrupting reporting; the user timer log
contains the required command. The dashboard's prepared update command remains
an alternative for installations predating `self-update`.

## Maintaining release values

`collector/version.json` owns the collector version, current/minimum supported
reporting protocols, manager version, and required minimum manager version.
Image builds, dashboard packaging, and standalone manager packaging consume that
metadata. Runtime image digests and download checksums are generated by release
CI; never copy them between source files manually.

Python and HAProxy pins live in the collector Dockerfiles. Dependabot groups their
Dockerfile and legacy Compose updates into one dependency PR. CI rejects drift;
for a manual dependency change, synchronize the legacy template with:

```bash
node scripts/collector-dependencies.mjs --write
```

CI compares collector release inputs against the previous collector release.
Changing code, images, proxy configuration, or packaging requires a newer
collector version. Changing manager code or protocol support also requires a
newer manager version. The trusted publication job repeats the check against
published release source, so forgetting a bump cannot silently skip publication.
Dashboard UI, documentation, and test-only changes do not force collector releases.
