#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ $# -gt 1 ]]; then
    echo 'Usage: bash docker-watch-setup.sh [TARGET_DIRECTORY]' >&2
    exit 1
fi
target="${1:-/srv/docker/docker-dashboard-collector}"
[[ "$target" == /* ]] || target="$PWD/$target"
if [[ -e "$target" || -L "$target" ]]; then
    echo "Directory already exists; refusing to overwrite: $target" >&2
    exit 1
fi
owner_uid="$(id -u)"
owner_gid="$(id -g)"
if [[ "$owner_uid" == 0 && -n "${SUDO_UID:-}" && -n "${SUDO_GID:-}" ]]; then
    owner_uid="$SUDO_UID"
    owner_gid="$SUDO_GID"
fi
[[ "$owner_uid" =~ ^[0-9]+$ && "$owner_gid" =~ ^[0-9]+$ ]] || exit 1
command -v docker >/dev/null || { echo 'Docker must be installed before running this script.' >&2; exit 1; }
DOCKER=(docker)
if ! "${DOCKER[@]}" info >/dev/null 2>&1; then
    if [[ "$EUID" != 0 ]] && command -v sudo >/dev/null; then
        echo 'Docker access requires sudo; only Docker commands will use sudo.'
        DOCKER=(sudo docker)
        "${DOCKER[@]}" info >/dev/null
    else
        echo 'Cannot access the Docker daemon. Check that Docker is running and your account can access it.' >&2
        exit 1
    fi
fi
"${DOCKER[@]}" compose version >/dev/null
for container in docker-dashboard-collector docker-dashboard-socket-proxy; do
    if "${DOCKER[@]}" container inspect "$container" >/dev/null 2>&1; then
        echo "Container already exists: $container. Inspect the existing installation before continuing." >&2
        exit 1
    fi
done
parent="$(dirname -- "$target")"
if [[ ! -d "$parent" ]]; then
    if ! mkdir -p -- "$parent" 2>/dev/null; then
        echo "Creating $parent requires sudo."
        sudo mkdir -p -- "$parent"
    fi
fi
if [[ -w "$parent" ]]; then
    mkdir -m 0700 -- "$target"
else
    echo "Creating $target requires sudo."
    sudo mkdir -m 0700 -- "$target"
    sudo chown "$owner_uid:$owner_gid" -- "$target"
fi
cd -- "$target"
__WRITE_FILES__
printf 'COLLECTOR_UID=%s\nCOLLECTOR_GID=%s\n' "$owner_uid" "$owner_gid" > .env
chmod 0600 collector.json .env
chmod 0644 compose.yaml collector.py proxy.cfg
if [[ "$EUID" == 0 ]]; then
    chown "$owner_uid:$owner_gid" -- . compose.yaml collector.py proxy.cfg collector.json .env
fi
"${DOCKER[@]}" compose config --quiet
if [[ "${CROWSNEST_PREPARE_ONLY:-0}" == 1 ]]; then
    printf '\nPrivate Compose files prepared at %s\n' "$target"
    printf 'Review compose.yaml, collector.py and proxy.cfg before starting.\n'
    printf 'Then run: cd %q && ' "$target"
    printf '%q ' "${DOCKER[@]}"
    printf 'compose up -d\n'
    exit 0
fi
"${DOCKER[@]}" compose pull
if ! "${DOCKER[@]}" compose up -d; then
    echo "Startup failed. Installation files are retained at $target." >&2
    exit 1
fi
printf '\nCollector installed at %s\n' "$target"
printf 'Container names: docker-dashboard-collector, docker-dashboard-socket-proxy\n'
printf 'Check reports with: cd %q && ' "$target"
printf '%q ' "${DOCKER[@]}"
printf 'compose logs -f collector\n'
