# Screenshot provenance

The overview, container-details, resource-history, and notification-rule README images are browser captures of Crowsnest `0.11.0`, refreshed on 2026-10-13. The enrollment capture uses `0.10.0` and its Crowsnest directory names.
All hosts, container names, images, counts, and report ages are fictional examples from `scripts/preview.mjs`. The captures contain no production fleet data, account details, URLs with credentials, or downloaded setup scripts.

- Container details: Chromium, 1440 × 1000 viewport, full page, showing a fictional unhealthy container, individual resource history, and retained changes.
- Desktop overview: Chromium, 1440 × 1000 viewport, full page.
- Mobile layout: Chromium, 390 × 844 viewport, full page.
- Desktop and mobile captures show host groups; one fictional host is in timed maintenance.
- Resource history: Chromium, 1440 × 1000 and 390 × 844 viewports, full page, with fictional running-container totals and 24-hour readings that deliberately contain gaps.
- Host setup: Chromium, 1440 × 1000 viewport, dialog capture. Enrollment uses synthetic registration and host-list API responses; the capture shows no credential values.
- Notification rules: Chromium, 1440 × 1000 viewport, full page. The fictional fixture demonstrates enabled rules and an illustrative example topic; real installations start with the new rules disabled.
- These captures are from 2026-10-13 (America/New_York).

Run `npm run preview`, then use Playwright or a local browser to capture the page at these widths. Save overview captures as `dashboard-desktop.png` and `dashboard-mobile.png`; choose a container name for `container-details-desktop.png`, preserving the full interface. Do not use image generation to fabricate interface details.

The mobile image verifies the responsive layout in Chromium; it is not an iOS Safari or Android-device certification. Browser interactions and axe-core checks cover widths of 1440, 1024, 768, 390, and 320 pixels, with no detected WCAG A/AA violations in the audited surfaces. Enrollment, delayed dialog responses, clipboard fallback, first-report confirmation, stale uptime, and keyboard focus were checked using synthetic responses. These checks complement visual review and do not establish full accessibility conformance.

The v0.11.0 pass specifically audited fleet, host history, container history, and optional rules at 1440, 390, and 320 pixels. Validation, failed-save retry, dependent controls, individual readings, missing target links, request cancellation, and polling/keyboard focus passed. These are browser checks, not physical-device certification.

`owner-setup-desktop.png` is a Chromium capture of the standalone Crowsnest `0.8.0` setup screen at a 1440 × 1000 viewport, captured on 2026-10-13. Its fields are empty; it contains no account, code, password, or fleet data. The local browser used a synthetic unclaimed-instance state. The image embeds this origin as PNG metadata. Desktop/mobile setup, sign-in, and recovery views were inspected; error, retry, keyboard, overflow, and axe-core checks passed. Successful authentication, persistence, and recovery were tested separately through real HTTP/SQLite and the isolated Docker image.
