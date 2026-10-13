# Production readiness

The objective is a polished fleet monitor that an operator can deploy without a ChatGPT account. Existing private Sites deployments remain supported.

## Delivery gates

| Work | Required evidence |
| --- | --- |
| Standalone deployment | Fresh Docker Compose install, owner setup, collector enrollment, restart persistence |
| Authentication | Bootstrap and recovery codes, hashed passwords and sessions, same-origin writes, spoofed identity rejected, rate limits |
| Storage and operations | Transactional host changes, consistent backup, stopped-server restore, health check and graceful shutdown |
| Fleet visibility | Optional CPU/memory measurements, honest unavailable states, bounded trends, grouping and filters |
| Notifications | Background checks, useful policy controls, private ntfy topic, delivery/recovery tests |
| UI polish | Desktop/mobile browser verification, keyboard and accessibility checks, updated fictional screenshots |
| Distribution | Selected license, release instructions, reproducible image build, dependency/image/security CI |

This is a delivery record, not a claim that every gate has passed. Record the version and verification evidence when each increment ships. The owner selected MIT and approved public source/image distribution; GitHub visibility changes require the owner's administration access.

## Comparable tools

The useful patterns are Portainer's [environment tags and groups](https://docs.portainer.io/admin/environments), Dozzle's [read-only monitoring and authentication](https://dozzle.dev/guide/authentication), Beszel's [resource history and alerts](https://beszel.dev/guide/), and Dockge's [file-based Compose installation](https://github.com/louislam/dockge). Crowsnest retains outbound reporting and limited Docker access. Container mutation, arbitrary commands, and unattended image replacement require a separate product decision.

## First increment

Add a standalone Node runtime using the same dashboard/API and SQLite storage. Keep platform identity exclusive to Sites: the standalone HTTP boundary must remove supplied platform identity headers and authenticate its own owner session. Use a local CLI to issue short-lived setup/recovery codes, with no default account or password. Host state changes commit together; automatic notification processing runs outside report transactions. The runtime is one process per data directory.

## Open decisions

- License: MIT, confirmed by the owner.
- Account scope: one owner per instance, confirmed by the owner.
- Public repository and container registry publication: approved by the owner; verify actual visibility before claiming anonymous distribution.

## v0.8.0 local evidence

- Regression suite: Worker/API, enrollment, notifications, maintenance, history, Python collector/notifier, installer, and standalone HTTP/SQLite checks passed.
- Docker lifecycle: the non-root image passed fresh setup, collector report, restart persistence, online backup, live-restore refusal, and stopped restore using an isolated volume and no Docker socket.
- Owner access: real authentication and recovery checks passed. Desktop/mobile browser checks covered setup, sign-in, recovery, failure/retry, keyboard focus, overflow, and credential storage. The finish reviewer scored the field-contrast repair resolved; the documenter preserved the incumbent design system.
- Security: full-history and working-tree Gitleaks, six application rules, and the custom source/history scanner passed. The final local image had zero fixable high/critical findings under the pinned Trivy gate. This does not certify lower-severity or unfixed vulnerabilities.
- Distribution: MIT license, owner-only self-hosting, private configuration, backup/recovery documentation, and a clean Sites source exporter are included. [v0.8.0 Release](https://github.com/bthall/crowsnest/actions/runs/38425953682) passed actual amd64/arm64 runtime tests and image scans, then published the private digest-pinned deployment package, SBOM, provenance, and immutable version image. Public visibility remains an owner decision. Resource history, grouping, and alert policy controls are the next delivery increment.

## v0.9.0 local evidence

- Fleet visibility: optional CPU/memory measurements, strict field validation, partial totals, zero workloads, bounded history, conditional writes, group filters, and removal cleanup passed the API regressions. Legacy collectors remain compatible.
- Notifications: category choices, host delay, priority, policy validation, and suppression of false recoveries passed alongside the existing delivery, maintenance, deduplication, and retry checks.
- Restricted Docker access: the real HAProxy configuration passed against a synthetic socket. Bounded one-shot stats reads were allowed; streaming, extra query parameters, private endpoints, and all mutation methods were denied.
- Docker lifecycle: the isolated non-root image retained host groups, resource history, and notification policy through restart and consistent backup/stopped restore. Concurrent owner sign-ins passed within the container's configured memory limit.
- UI: desktop, mobile, and narrow browser checks covered grouping, chart gaps and source readings, legacy/stale values, details, host management, policy saves, retry, request cancellation, and focus preservation. Audited surfaces had no detected Axe violations, page errors, or document overflow. The fresh finish reviewer approved the deployment-specific ntfy copy repair; the documenter preserved the incumbent system. These checks do not establish full accessibility or physical-device certification.
- Packaging: the fresh sanitized Site export installed and passed the full regression suite without the maintainer's Site identity or credentials. README screenshots are real Chromium captures of fictional data with embedded provenance.
- Security: the dependency audit, six application security rules, and custom source/history scanner passed; Gitleaks found no secrets in full history or the working tree. The tested local image passed the pinned fixable high/critical Trivy gate. This gate does not certify lower-severity or unfixed vulnerabilities.

GitHub release publication requires successful Checks and Security on the same commit, followed by runtime tests and image scans for both amd64 and arm64. The release record carries that separate CI evidence; local checks above do not claim an unpublished release exists. Repository and registry visibility remain controlled by the owner.

## v0.10.0 compatibility verification

Poseidon's Docker Engine 26.1.4 omits the ID from one-shot stats responses. The collector now permits that omission because its request uses the full container ID; supplied mismatches remain rejected. A regression exercises warm-up, complete CPU/memory reports, privacy, and invalid supplied IDs. Live read-only verification through the updated restricted proxy measured memory for all six running containers on the first read and CPU/memory for all six on the second. Normal reporting acknowledgements continued, with credentials, file modes, and installing-user ownership preserved.

Poseidon was migrated to `/srv/docker/crowsnest-collector`, project `crowsnest-collector`, and containers `crowsnest-collector` / `crowsnest-socket-proxy`. Both services ran without restarts and delivered reports after migration. Installer checks reject existing collectors under either naming scheme; maintenance checks cover current, legacy, ambiguous, and explicit custom directories. Current enrollment and fleet captures use v0.10.0, with fictional data and embedded provenance. Desktop, mobile, and narrow enrollment/update checks found no horizontal overflow, page errors, or Axe A/AA violations; the fresh finish review returned `ship`.
