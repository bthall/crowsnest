# Roadmap

The current release includes collector enrollment and updates, standalone owner access, ntfy policy and maintenance controls, Compose grouping, container details, host groups, optional CPU/memory measurements, bounded host/container history, sustained resource alerts, restart-burst detection, and direct notification links.

Longer-term candidates include image-update awareness, pinned services, and longer configurable retention. They require clear scope, bounded storage/network costs, and honest handling of unavailable registry data before release.

Collector delivery now has an independent image-release path and a host-owned
manager for migration, updates, status, and rollback. Automatic compatible patch
updates require an explicit choice per host and a maintenance window. First
publication, package visibility, and live-host validation must complete before
claiming a released updater is available. Operational behavior is documented in
[collector updates](collector-updates.md).

These are planning items, not available features or promised release dates. Existing collectors must remain compatible as metadata expands.
