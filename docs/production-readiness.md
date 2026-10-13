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

This is a delivery record, not a claim that every gate has passed. Record the version and verification evidence when each increment ships. The owner selected MIT; public repository visibility remains an owner decision.

## Comparable tools

The useful patterns are Portainer's [environment tags and groups](https://docs.portainer.io/admin/environments), Dozzle's [read-only monitoring and authentication](https://dozzle.dev/guide/authentication), Beszel's [resource history and alerts](https://beszel.dev/guide/), and Dockge's [file-based Compose installation](https://github.com/louislam/dockge). Crowsnest retains outbound reporting and limited Docker access. Container mutation, arbitrary commands, and unattended image replacement require a separate product decision.

## First increment

Add a standalone Node runtime using the same dashboard/API and SQLite storage. Keep platform identity exclusive to Sites: the standalone HTTP boundary must remove supplied platform identity headers and authenticate its own owner session. Use a local CLI to issue short-lived setup/recovery codes, with no default account or password. Host state changes commit together; automatic notification processing runs outside report transactions. The runtime is one process per data directory.

## Open decisions

- License: MIT, confirmed by the owner.
- Account scope: one owner per instance, confirmed by the owner.
- Public repository and container registry publication: verify available permissions before claiming distribution.

## v0.8.0 local evidence

- Regression suite: Worker/API, enrollment, notifications, maintenance, history, Python collector/notifier, installer, and standalone HTTP/SQLite checks passed.
- Docker lifecycle: the non-root image passed fresh setup, collector report, restart persistence, online backup, live-restore refusal, and stopped restore using an isolated volume and no Docker socket.
- Owner access: real authentication and recovery checks passed. Desktop/mobile browser checks covered setup, sign-in, recovery, failure/retry, keyboard focus, overflow, and credential storage. The finish reviewer scored the field-contrast repair resolved; the documenter preserved the incumbent design system.
- Security: full-history and working-tree Gitleaks, six application rules, and the custom source/history scanner passed. The final local image had zero fixable high/critical findings under the pinned Trivy gate. This does not certify lower-severity or unfixed vulnerabilities.
- Distribution: MIT license, owner-only self-hosting, private configuration, backup/recovery documentation, and a clean Sites source exporter are included. Release automation is prepared for CI-gated amd64/arm64 images, digest-pinned installation packages, SBOMs, and provenance; verify the actual Release result before claiming a published image. Public visibility, resource history, grouping, and alert policy controls remain separate delivery work.
