# Resource measurements and host groups

Collector v0.9.0 adds optional CPU and memory measurements for running containers. Use **Manage host → Update collector** to replace both `collector.py` and `proxy.cfg` on older installations. Credentials, Compose configuration, and user ownership stay in place. Status-only collectors remain compatible.

## Reading the values

Select a host and expand **Container resources** for its current workload, 24-hour charts, and the same readings as a table. Choose a container name for individual CPU, memory, and memory-limit details.

- CPU is the change in Docker CPU counters between two collector readings. **100% uses one CPU core**, so a multi-core workload can exceed 100%. The first sample, a restarted container, a counter reset, or a gap exceeding two minutes needs a new baseline. CPU shows unavailable until it can be measured.
- Memory subtracts reclaimable inactive file cache from usage: `total_inactive_file` for cgroup v1 and `inactive_file` for v2. The memory limit is Docker's reported limit; without a configured container limit it can reflect the daemon's available memory. It is not reserved memory.
- Host totals sum running containers. They describe **container workloads**, not the entire machine's CPU or RAM. A missing measurement makes that total unavailable. Zero running containers is a measured zero workload when resource reporting is supported.
- Stale or disconnected views show last reported values. History is attached to server receipt time and does not fill missing intervals with zero.

The formulas follow the [Docker Engine stats API](https://docs.docker.com/reference/api/engine/version/v1.51/) and [Docker CLI memory semantics](https://docs.docker.com/reference/cli/docker/container/stats/).

## Collection and retention

The collector finishes status inspections first, then samples resources with four workers and at most six seconds of its existing 60-second collection budget. The restricted proxy allows only full-container-ID stats reads with the exact query `stream=false&one-shot=true`. Streaming, other endpoints, and all mutation methods remain denied. Docker API 1.41 or later is needed for one-shot sampling. Stats failure never rejects a core status report; optional measurements are dropped if necessary to fit the existing 128 KiB report limit.

Each host retains the **latest report in each five-minute window**, with at most 288 readings over the last 24 hours. These are samples, not averages or peaks. Charts leave missing windows and unavailable values empty. Earlier status-only reports do not erase retained history. Removing a host removes its resource history. Standalone SQLite backups include it.

The collector transmits only CPU percentage, sample duration, memory usage, and memory limit. Raw stats, network interfaces/addresses, environment variables, mounts, and logs are excluded. Resource history stores only workload totals, running count, timestamp, and sampling state.

## Groups

In **Manage host**, set an optional group such as Production or Home. Groups accept up to 32 letters, numbers, spaces, dots, dashes, or underscores, start with a letter or number, and are case-sensitive. The Group selector appears once a group exists. It scopes host navigation, container counts, activity, and current alerts; global fleet counts and ntfy policy still cover the entire fleet. Host names remain unique across groups. Leave the field empty to return a host to Ungrouped.
