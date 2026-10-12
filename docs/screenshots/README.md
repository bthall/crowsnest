# Screenshot provenance

The README images are browser captures of the Crowsnest `0.6.0` interface.
All hosts, container names, images, counts, and report ages are fictional examples from `scripts/preview.mjs`. The captures contain no production fleet data, account details, URLs with credentials, or downloaded setup scripts.

- Desktop: Chromium, 1440 × 1120 viewport, full page.
- Mobile layout: Chromium, 390 × 844 viewport, full page.
- Desktop and mobile captures show Compose project grouping; one fictional host is in timed maintenance.
- Host setup: Chromium, 1440 × 1120 viewport, dialog capture. Enrollment uses a synthetic API response and test credentials; the capture shows no credential values.
- Captured on 2026-10-12 (America/New_York).

Run `npm run preview`, then use the Codex Playwright skill or a local browser to capture the page at these widths. Save the captures as `dashboard-desktop.png` and `dashboard-mobile.png`, preserving the full interface. Do not use image generation to fabricate interface details.

The mobile image verifies the responsive layout in Chromium; it is not an iOS Safari or Android-device certification. Browser interactions and axe-core checks cover desktop, mobile, and the setup dialog. These checks complement keyboard and visual review.
