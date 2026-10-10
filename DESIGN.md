# Crowsnest interface

This document records the current dashboard conventions for future polish passes.
The audience and use case come from the owner's brief: a private view of Docker hosts and container status, with collectors installed under `/srv/docker`.

## Direction

Treat the dashboard as an operating tool. Keep the crow mark, slate surfaces, warm copper action color, and “Your fleet. In sight.” brand line. Put host selection, report freshness, and container state ahead of decoration. Use compact hierarchy and explicit labels.

## Layout and interaction

- Hosts at the left on desktop, horizontally scrollable on phones.
- Selected-host summary attached to its container table.
- All hosts is the default fleet view; host selection scopes containers, activity, and alerts.
- Search matches container names, images, and host names in fleet view. The attention filter means unhealthy, restarting, or dead.
- Attention rows sort first, then names alphabetically.
- Preserve host-button focus during polling and help disclosure while reading.
- Use a focused enrollment dialog with naming, inspectable Compose deployment, and first-report confirmation. Keep deployment steps available if a report is delayed; allow an awaiting host to continue setup.
- Explain Docker access and credentials before downloads. Keep secrets out of commands and rendered text. The downloaded archive is private and contains the actual configuration.
- Host removal requires an exact-name confirmation. Reporting-token replacement leaves the current token usable until successful activation.
- Keep setup explanations in contextual help and the first-run state.

## Tokens and accessibility

Tokens live in `worker/board.css`. Use a single system sans family for interface text, a monospace face for image tags and commands, and tabular numerals for counts and durations. Copper identifies primary actions and focus; green, amber, and red identify labeled states.

Controls have visible keyboard focus and accessible names. Status relies on text as well as color. On phones, uptime and restart counts remain within each container row. Honor reduced-motion preferences. Render external host/container data as text through DOM APIs.

## Evidence

README captures use fictional data from `scripts/preview.mjs`. See [screenshot provenance](docs/screenshots/README.md) and [development guidance](docs/development.md) for reproduction and verification limits.
