#!/usr/bin/env bash
set -euo pipefail
umask 077
mode=__INSTALL_MODE__
source_dir=''
if [[ "$mode" == update ]]; then
    if [[ $# -lt 1 || $# -gt 2 ]]; then
        echo 'Usage: bash docker-watch-update.sh EXISTING_DIRECTORY [TARGET_DIRECTORY]' >&2
        exit 1
    fi
    source_dir="$(cd -- "$1" && pwd -P)"
    target="${2:-/srv/docker/docker-dashboard-collector}"
else
    if [[ $# -gt 1 ]]; then
        echo 'Usage: bash docker-watch-setup.sh [TARGET_DIRECTORY]' >&2
        exit 1
    fi
    target="${1:-/srv/docker/docker-dashboard-collector}"
fi
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
if [[ -n "$source_dir" ]]; then
    for file in compose.yaml collector.json; do
        [[ -f "$source_dir/$file" ]] || { echo "Missing $file in $source_dir" >&2; exit 1; }
    done
fi
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
if [[ -n "$source_dir" ]]; then
    cp -- "$source_dir/collector.json" collector.json
fi
printf 'COLLECTOR_UID=%s\nCOLLECTOR_GID=%s\n' "$owner_uid" "$owner_gid" > .env
chmod 0600 collector.json .env
chmod 0644 compose.yaml collector.py proxy.cfg
if [[ "$EUID" == 0 ]]; then
    chown "$owner_uid:$owner_gid" -- . compose.yaml collector.py proxy.cfg collector.json .env
fi
"${DOCKER[@]}" compose config --quiet
"${DOCKER[@]}" compose pull
if [[ -n "$source_dir" ]]; then
    "${DOCKER[@]}" compose --project-directory "$source_dir" -f "$source_dir/compose.yaml" down
fi
if ! "${DOCKER[@]}" compose up -d; then
    echo "Startup failed. Installation files are retained at $target." >&2
    if [[ -n "$source_dir" ]]; then
        "${DOCKER[@]}" compose down || true
        "${DOCKER[@]}" compose --project-directory "$source_dir" -f "$source_dir/compose.yaml" up -d || true
    fi
    exit 1
fi
printf '\nCollector installed at %s\n' "$target"
printf 'Container names: docker-dashboard-collector, docker-dashboard-socket-proxy\n'
printf 'Check reports with: cd %q && ' "$target"
printf '%q ' "${DOCKER[@]}"
printf 'compose logs -f collector\n'
if [[ -n "$source_dir" ]]; then
    printf 'Existing host credentials were preserved. Original files remain at %s\n' "$source_dir"
fi
