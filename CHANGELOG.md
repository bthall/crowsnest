# Changelog

Notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Version numbers follow the policy in [docs/versioning.md](docs/versioning.md).

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
