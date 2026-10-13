# Container details

Choose a container name in the fleet or host table to open its details. **Back to containers** or Escape returns to the table and preserves search and attention filters. Host selection and the Activity/Alerts tabs remain available.

The view displays the last reported image, process state, Docker health, restart count, optional CPU/memory/limit measurements, uptime, start/finish timestamps, Compose project/service, and report time. Expand **Container ID** to view or copy the full ID. If clipboard access is blocked, the ID is selected for manual copying.

Reports older than two minutes are labeled stale. Uptime then stops at the last report. If a container disappears while its details are open, its last reported values remain visible with **No longer reported**; this can mean removal or replacement. A replacement with the same name has a different container ID and a separate details view.

See [resource measurements](resources.md) for CPU semantics, reclaimable cache, warm-up, and unavailable states. Measurements share the report timestamp and are not live streaming stats.

## Recent changes

New activity records the container ID, preserving attribution across renames. The view includes appearances/removals, state or health changes, restart increases, image changes, and renames. Host-wide events are omitted. Older events without an ID may match by the current name; these are labeled because they may refer to a previous container with that name.

Retention is shared with the host's Activity feed: at most 100 events per host within 30 days, not 100 per container. These are retained changes, not a complete health timeline or audit log. Concurrent reports can coalesce events. A history error offers a retry while keeping container information visible.

## Collector versions

Select a host or open **Manage host** to see its reported collector version and report freshness. **Update available** compares that version with the collector bundled with the deployed dashboard; it does not query GitHub for a newer release. An older collector that sends no version is labeled **unknown**. Stale reports retain their last reported version without claiming that the host is currently connected.

Follow [Update an existing collector](deployment.md#update-an-existing-collector) to prepare a copyable update. Preparing or copying the command does not confirm installation. The UI waits for a fresh report with the requested version. If a host already reports that version, it says so without claiming a new update succeeded. A collector newer than the dashboard disables the bundled update command to avoid an unintended downgrade.
