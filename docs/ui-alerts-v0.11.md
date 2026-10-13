# Actionable alerts and container trends

Extend the incumbent Crowsnest interface in Operate mode. Keep the crow, slate/copper system, host navigation, owner-only access, and read-only collectors. This is code-led work inside existing surfaces; no new visual world or comp is required.

Alert settings gain an optional disclosure for CPU/memory thresholds, sustained duration, observed restart bursts, and cooldown. All new rules start disabled. Explain CPU units, absolute memory units, missing measurements, rolling restart windows, and maintenance. Existing health/report settings stay recognizable. Settings cover the entire fleet.

The existing resource disclosure also serves container inspection. Its title, current values, charts, and table explicitly identify the chosen container; totals remain host-only. Full IDs own readings, and missing/legacy samples leave gaps. Retain at most 24 hours, 288 five-minute readings, and 2 MiB per host; large fleets may retain fewer readings. Loading, retry, cancellation, stale and empty states remain truthful.

Notification URLs select the host, and a single affected container when possible. A missing container produces a clear message and leaves the host visible. Selection survives standalone sign-in without accepting external redirect targets.

Verify desktop 1440, mobile 390, and narrow 320: optional-rule controls, validation, save/retry, charts/table, deep links including missing targets, keyboard focus, request cancellation, polling, overflow and Axe. Use fictional fixture data. Batch builder visual review in at most two rounds, then fresh finish-reviewer and documenter handoffs.

## Completed extension

The optional rules are inside **Alerts → ntfy notifications → Resource and restart rules**, alongside the existing health and host-report settings. CPU, memory, and restart-burst rules remain disabled by default, including when older settings are loaded. Their fields become available when the corresponding rule is enabled. Saving applies the settings to the entire fleet. The interface explains one-core CPU percentages, absolute MiB memory thresholds, sustained durations, observed restart windows, cooldown, recoveries, missing measurements, and maintenance. The fictional screenshot fixture intentionally enables all three rules to demonstrate their controls; it does not represent installation defaults. See [notification behavior](notifications.md#resource-and-restart-rules).

Container inspection reuses the existing resource disclosure, charts, readings table, and retry action. Its heading, current values, help text, and table caption identify the chosen container. Host inspection continues to show running-container totals. History belongs to the full container ID, and gaps remain empty. The interface names the 24-hour, 288-reading, and 2 MiB per-host retention limits and explains that large hosts may retain fewer readings. See [resource semantics](resources.md#collection-and-retention).

Alert links open the affected container when one is identified. Dashboard URLs retain host/container selection, explain a removed target, and keep its host visible. Standalone sign-in preserves a return URL only for the same-origin dashboard path. Resource requests are cancelled when their disclosure closes or their target changes, and older responses cannot populate the new selection.

## Reuse of the incumbent system

The finished extension preserves the crow, slate surfaces, copper actions and focus, labeled status colors, system sans text, and monospace technical values recorded in [DESIGN.md](../DESIGN.md). The source diff adds disclosure spacing and a number-field border treatment to the existing notification form; it adds no color, font, radius, motion, or spacing tokens. Notification fields and action buttons use the established six-pixel corners and 42-pixel minimum height. The desktop type hierarchy remains 15-pixel body text, 26-pixel page headings, and 21-pixel container titles. Resource charts keep green CPU and copper memory series with divider-colored grid lines. Existing breakpoints stack notification fields and charts below 700 pixels and retain horizontally scrollable host navigation on phones.

This is an ordinary Operate extension. No design-system change was required, and DESIGN.md was left untouched.

## Verification and documentation handoff

The review set contains twelve fictional-data captures under `.impeccable/review/`: `alerts-overview`, `alerts-host-history`, `alerts-container-history`, and `alerts-rules`, each at 1440, 390, and 320 pixels. The documenter checked `worker/board.html`, `worker/board.css`, `worker/board.js`, `server/auth.js`, PRODUCT.md, DESIGN.md, and the operational notification/resource documentation; it directly sampled desktop and narrow rules plus desktop and mobile container history captures.

The implementation handoff reports no Axe violations, page overflow, or page errors across the three widths. Functional checks passed for settings validation and save/retry, chart/table readings, private deep links and missing targets, request cancellation, polling, and focus restoration. The fresh finish reviewer returned **ship**, with no material fixes.

The detector's single flat-type warning used fallback 16-pixel sizes because it did not resolve the absolute `/assets/board.css` URL. Source values and rendered captures show the established hierarchy, so no typography change was made. Preexisting documentation drift remains: DESIGN.md uses prose-only headings without the canonical YAML token frontmatter, and `.impeccable/design.json` is absent. This handoff records that drift without migrating the incumbent system or canonizing the detector warning.
