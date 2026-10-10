# Changelog

Notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Version numbers follow the policy in [docs/versioning.md](docs/versioning.md).

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

[0.2.1]: https://github.com/bthall/crowsnest/compare/b7c9d4b1d39eb467d5b3881dc1422caf6d3d83a1...main
[0.2.0]: https://github.com/bthall/crowsnest/compare/5efb8b44c1338f5365ac1e400fe0794cbc2431f0...b7c9d4b1d39eb467d5b3881dc1422caf6d3d83a1
[0.1.0]: https://github.com/bthall/crowsnest/tree/5efb8b44c1338f5365ac1e400fe0794cbc2431f0
