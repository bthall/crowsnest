# Screenshot provenance

The overview, enrollment, and container-details README images are browser captures of Crowsnest `0.7.1`.
All hosts, container names, images, counts, and report ages are fictional examples from `scripts/preview.mjs`. The captures contain no production fleet data, account details, URLs with credentials, or downloaded setup scripts.

- Container details: Chromium, 1440 × 1120 viewport, full page, showing a fictional unhealthy container and retained changes.
- Desktop overview: Chromium, 1440 × 1120 viewport, full page.
- Mobile layout: Chromium, 390 × 844 viewport, full page.
- Desktop and mobile captures show Compose project grouping; one fictional host is in timed maintenance.
- Host setup: Chromium, 1440 × 1120 viewport, dialog capture. Enrollment uses a synthetic API response and test credentials; the capture shows no credential values.
- Captured on 2026-10-12 (America/New_York).

Run `npm run preview`, then use the Codex Playwright skill or a local browser to capture the page at these widths. Save overview captures as `dashboard-desktop.png` and `dashboard-mobile.png`; choose a container name for `container-details-desktop.png`, preserving the full interface. Do not use image generation to fabricate interface details.

The mobile image verifies the responsive layout in Chromium; it is not an iOS Safari or Android-device certification. Browser interactions and axe-core checks cover widths of 1440, 1024, 768, 390, and 320 pixels, with no detected WCAG A/AA violations in the audited surfaces. Enrollment, delayed dialog responses, clipboard fallback, first-report confirmation, stale uptime, and keyboard focus were checked using synthetic responses. These checks complement visual review and do not establish full accessibility conformance.

`owner-setup-desktop.png` is a Chromium capture of the standalone Crowsnest `0.8.0` setup screen at a 1440 × 1000 viewport, captured on 2026-10-13. Its fields are empty; it contains no account, code, password, or fleet data. The local browser used a synthetic unclaimed-instance state. The image embeds this origin as PNG metadata. Desktop/mobile setup, sign-in, and recovery views were inspected; error, retry, keyboard, overflow, and axe-core checks passed. Successful authentication, persistence, and recovery were tested separately through real HTTP/SQLite and the isolated Docker image.
