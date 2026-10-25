# Changelog

Notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Version numbers follow the policy in [docs/versioning.md](docs/versioning.md).

## [Unreleased]

### Changed

- Overlap host-list storage reads within a fixed concurrency budget, including when signal alerts are enabled.

### Fixed

- Validate the complete staged restore schema before replacing an instance database, and include committed WAL changes in the restored snapshot.

## [0.11.1] - 2026-10-17

### Fixed

- Keep the standalone image on digest-pinned Node 24 LTS and require deliberate review of runtime-major upgrades.
- Use constant-time comparison for hashed setup and recovery codes; reject framing with X-Frame-Options and Content-Security-Policy.
- Preserve visible focus spacing in dialogs and selectors.
- Document GitHub private vulnerability reporting and the Release workflow's publication permissions. CI rejects deployment-specific Site identities in current source while credential scans cover Git history.

## [0.11.0] - 2026-10-13

### Added

- Opt-in sustained CPU/memory threshold alerts and observed restart-burst rules, with per-container cooldowns, recovery messages, and maintenance-aware observation windows.
- Container resource charts and readings, keyed by full Docker ID and retaining at most 24 hours, 288 five-minute readings, and 2 MiB per host.
- Notification links select the affected host and, for a single affected container, open its details. Standalone sign-in preserves these links without accepting external redirect targets.

### Compatibility

- Existing collectors already supply the measurements and restart counters. New rules start disabled; previous notification settings and existing host workload history remain supported.

### Fixed

- Serialize fresh standalone database initialization when the server and CLI open it concurrently, preventing duplicate schema creation.

## [0.10.0] - 2026-10-13

### Changed

- New collector installations use `/srv/docker/crowsnest-collector`, the `crowsnest-collector` Compose project, and `crowsnest-collector` / `crowsnest-socket-proxy` containers. Setup downloads, copy commands, documentation, and internal test names consistently use Crowsnest.
- Existing collectors remain supported. Update and credential replacement commands find either standard directory or use `CROWSNEST_COLLECTOR_DIR`; simultaneous standard installations require an explicit choice. Existing Compose customization is preserved. The deployment guide covers optional migration to the new names.

### Fixed

- Resource sampling accepts Docker one-shot responses that omit their container ID. Requests remain bound to a full container ID, and a supplied mismatched ID is still rejected. Status-only reporting remains compatible.

## [0.9.0] - 2026-10-13

### Added

- Optional container CPU and memory measurements with bounded, read-only sampling, honest warm-up/unavailable states, and 24-hour host workload history.
- Labeled resource charts and an accessible readings table; container details include current CPU, memory, and memory limit.
- Host groups with scoped navigation, containers, activity, and alerts.
- ntfy category, host-delay, and priority controls that preserve maintenance, deduplication, and real recovery semantics.

### Changed

- Collector updates replace both the collector and restricted proxy configuration while retaining private credentials and user ownership.
- Resource measurements can be omitted when needed to keep core status reports within the existing size limit. Older reports remain compatible.

## [0.8.0] - 2026-10-13

### Added

- CI-gated amd64/arm64 release automation with immutable version images, digest-pinned deployment archives, SPDX SBOMs, and build provenance.

- Standalone Docker Compose deployment with one owner account and durable SQLite storage, independent of ChatGPT Sites.
- Server-issued, single-use setup and recovery codes, scrypt password hashing, hashed browser sessions, same-origin writes, and persistent sign-in rate limits.
- Transactional standalone host changes and automatic notification checks outside report transactions.
- Consistent online backups, stopped-server restore, readiness checks, diagnostics, and a kernel process lock released on crashes and restarts.
- Branded owner setup, sign-in, password recovery, and sign-out controls.
- MIT license and a self-hosting guide covering HTTPS, private files, updates, backup, and recovery.

### Compatibility

- Existing private Sites deployments and collectors retain their authentication and configuration. Standalone collectors omit the platform service token and support custom HTTPS ports. Existing collectors remain accepted; no reinstall is required for the dashboard update.

## [0.7.2] - 2026-10-12

### Fixed

- Collectors reject redirects before forwarding reporting credentials, validate their HTTPS configuration, bound responses, and verify ingestion acknowledgements.
- Container inspections run with four workers and a collection admission deadline. Containers removed between listing and inspection no longer prevent a report; other inspection failures still reject the collection.
- Reporting cadence accounts for collection time instead of always adding another 30 seconds.
- Conditional host writes prevent overlapping renames, credential issuance, activation, or deletion from overwriting newer registration state.
- Container notification baselines survive stale-host alerts, preventing repeated alerts and missed recoveries when reporting resumes.
- Invalid JSON root types and malformed UTF-8 return client errors; partial R2 listing pages no longer trigger a false host limit.
- Fleet polling uses bounded concurrent storage reads; single-host activity reads only that host's records.
- Overlapping dashboard refreshes share their request, and delayed clipboard operations cannot alter a reopened dialog or different container.
- Hidden container tables are not rebuilt on every refresh, and host-button lookups use a map.
- Notifier configuration and response shapes receive explicit validation; README version now matches the package.
- The local secret checker recognizes quoted JSON/Python credential keys, with isolated Git-fixture coverage.

### Changed

- CI runs the regression suite on Python 3.12 and the collector's Python 3.13 runtime, using a pinned setup action.
- Shared R2 test storage models conditional writes and pagination; added interleaving, redirect, churn, bounds, and recovery regressions.
- Documented review findings, remaining storage concurrency limits, collector behavior, and upgrade steps.

### Compatibility

- Existing collectors remain accepted. Update each collector through **Manage host → Update collector** to receive the redirect protection and reporting fixes. Existing credentials, installation directories, Compose names, and report fields are retained.

## [0.7.1] - 2026-10-12

### Changed

- Compact host navigation on phones and tablets, with All hosts in the same scrolling selector.
- Quieter dashboard tabs, clearer attention rows, and fewer repeated service labels in the container table.
- Host-specific, numbered terminal instructions and clearer progress during collector enrollment.
- Refreshed README screenshots using fictional data.

### Fixed

- Stale or unavailable reports freeze container uptime at the last report, matching container details.
- Delayed enrollment, update, and token responses cannot populate a different or reopened host dialog.
- Collector update confirmation compares report timestamps rather than depending on the browser clock.

### Compatibility

- Existing collectors continue reporting. This interface update does not require a collector reinstall or configuration change.

## [0.7.0] - 2026-10-12

### Added

- Collector versions shown separately from Docker Engine versions, with update status against the collector bundled with the deployed dashboard.
- Version-stamped setup and update commands. Manage host confirms an update only after a fresh report contains the requested version.
- Container details opened from container names, with image, state, health, restart count, uptime, timestamps, Compose metadata, full ID copying, and recent changes.
- Container-ID attribution for new activity, including renames, so changes remain associated with an instance when its name changes.
- Compatibility, SemVer, container-history authorization, replacement/rename, keyboard, and responsive checks; a new README screenshot with fictional data.

### Compatibility and limits

- Existing collectors remain accepted. Collectors without a reported version show **unknown** until updated; Docker Engine versions are never treated as collector versions.
- Older activity can be matched by name and is labeled as potentially belonging to a previous container with that name. History shares the host's existing 100-event, 30-day retention limit.
- Stale and missing containers show last reported values. No extra Docker API endpoints, arbitrary labels, environment variables, logs, mounts, or network addresses are collected.
- Collector versions newer than the dashboard are identified explicitly; the UI disables its update command to avoid an unintended downgrade.

## [0.6.0] - 2026-10-12

### Added

- Compose grouping by host and project, service labels, and project/service search. Older collectors keep working; metadata becomes available after a collector update.
- Timed per-host maintenance (15 minutes, 1 hour, 4 hours, or 24 hours), with early end, automatic expiry, and visible notification-pause indicators. Reports, health, and activity continue during maintenance.
- Copyable in-place collector updates that preserve credentials, Compose configuration, and user permissions.
- ntfy topic copying, Android app links, and explicit subscription/test guidance without exposing publisher credentials.

### Changed

- Enrollment separates naming, file preparation, collector startup, and actual first-report confirmation. Copy success is distinct from installation success.
- Updated documentation, compatibility checks, and screenshots using fictional data.

### Compatibility and limits

- Existing reports remain accepted. Only the two standard Compose labels are collected; no arbitrary labels or environment variables are transmitted.
- Maintenance resumes on the next report or background sweep and compares current issues with the last delivered state. Transient suppressed issues do not generate false recoveries. Notification state remains best effort under concurrent R2 writes.
- Resource usage and collector version reporting remain on the longer-term roadmap.

## [0.5.0] - 2026-10-12

### Added

- Copyable host setup that prepares private, user-owned Compose files directly in a Bash terminal, without transferring a package.
- Explicit review and start commands, a manual-copy fallback when clipboard access is blocked, and an optional package download.
- Enrollment checks for matching copied/downloaded credentials, private access, staged replacement, file permissions, overwrite protection, and preparation without container startup.

### Compatibility

- Existing collectors, installation paths, and Compose/script API formats remain supported. No collector update is required.

## [0.4.2] - 2026-10-10

### Fixed

- Optional restricted Docker sweep runner under `/srv/docker/crowsnest-notifier` for timely stale-host checks on Sites, whose cloud scheduling has an hourly minimum.
- CI coverage for private unattended writer access, TLS/redirect handling, bounded replies, and persisted readback.
- Documented checker/ntfy host outage limits and the actual supported schedule cadence.

## [0.4.1] - 2026-10-10

### Fixed

- Portable server-side request cancellation and explicit redirect rejection for hosted ntfy publishing.
- Sanitized delivery errors in test responses, sweep readback, and server logs to diagnose hosted connectivity.

## [0.4.0] - 2026-10-10

### Added

- Optional ntfy delivery for stale/awaiting hosts and unhealthy, restarting, or dead containers, plus recovery messages.
- Fleet-wide notification controls, delivery status, and an explicit rate-limited test in Alerts.
- Server-only publisher credentials, bounded messages, HTTPS destinations, denied redirects, transition deduplication, and retry backoff.
- Authorized unattended sweeps and setup instructions for stale-host detection while every collector is silent.
- Network-mocked CI coverage for notification security and delivery behavior.

### Compatibility and limits

- Existing collectors continue reporting without updates. Notification delivery is optional and defaults off.
- R2 writes are not transactional; concurrent work or an acknowledgement lost after publishing may duplicate a message. Stale-host timing depends on the configured sweep schedule.

## [0.3.0] - 2026-10-10

### Added

- Guided Docker Compose enrollment with inspectable package contents, explicit permissions, deployment commands, and first-report confirmation.
- Continue setup for awaiting hosts, host renaming/removal, and staged reporting-token replacement with a ten-minute activation window.
- Fleet-wide container and host search with last-known status labels.
- Bounded recent activity for report and host changes, plus in-app stale/enrollment/container alerts.

### Changed

- Dashboard enrollment uses a Compose package instead of a downloaded shell script. Legacy registration and collector ingestion remain compatible.
- Updated lifecycle/security documentation and synthetic README screenshots.

### Limitations

- Activity begins with this release and is an operational feed, not a transactional audit log. Retention is up to 100 events per host within 30 days.
- Alerts appear in the dashboard; external delivery and historical metrics are not configured.

## [0.2.1] - 2026-10-09

### Fixed

- Optional canonical dashboard origin for domain moves, with private homepage redirects and unchanged collector endpoints.

## [0.2.0] - 2026-10-09

### Added

- Container and image search, an attention filter, and issue counts beside hosts.
- Mobile rows with uptime and restart details.
- Desktop and mobile README screenshots using fictional data.
- Gitleaks history scanning, application security rules, and weekly CI security checks.
- A clean source export and setup guide for separate ChatGPT Sites deployments.

### Changed

- Compact host navigation, clearer report age and errors, and contextual setup help.
- Dashboard JavaScript and CSS served as private assets with a stricter content security policy.
- Host and container text rendered with DOM APIs.
- Documented release versioning and compatibility expectations.

### Removed

- The one-time collector relocation endpoint, download, and associated setup logic.

## [0.1.0] - 2026-10-09

### Added

- Private Docker host and container dashboard with Crowsnest branding.
- Restricted outbound collector and user-owned installation under `/srv/docker`.
- Host registration, per-host reporting tokens, and latest-snapshot storage.
- README, configuration, development, troubleshooting, and security documentation.

[0.3.0]: https://github.com/bthall/crowsnest/compare/453b199d0112b27f29440e1298e8b3521e8e75f0...main
[0.2.1]: https://github.com/bthall/crowsnest/compare/b7c9d4b1d39eb467d5b3881dc1422caf6d3d83a1...453b199d0112b27f29440e1298e8b3521e8e75f0
[0.2.0]: https://github.com/bthall/crowsnest/compare/5efb8b44c1338f5365ac1e400fe0794cbc2431f0...b7c9d4b1d39eb467d5b3881dc1422caf6d3d83a1
[0.1.0]: https://github.com/bthall/crowsnest/tree/5efb8b44c1338f5365ac1e400fe0794cbc2431f0

[0.4.0]: https://github.com/bthall/crowsnest/compare/7ca8023a294a21a45bec7a546075a9f45b86b42e...main

[0.4.1]: https://github.com/bthall/crowsnest/compare/21e6fdf74ee24853b5116a63fad97714c587f6fa...main

[0.4.2]: https://github.com/bthall/crowsnest/compare/6b3897592520d5ae8fb8f021eab24d88a4398b70...main

[0.5.0]: https://github.com/bthall/crowsnest/compare/3f09bea74a1cfefd45ce66a832080fa37637c377...main

[0.6.0]: https://github.com/bthall/crowsnest/compare/62d219757223eb8a8ec319fbf3b44ff2dac624d7...main
