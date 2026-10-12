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
- Attention rows sort first, then names alphabetically within each Compose group. Group by host ID and project label; never infer project names from container names. Label missing metadata and standalone containers distinctly.
- Timed maintenance pauses notifications while health and activity remain truthful. Show the expiry and allow early end in Manage host.
- ntfy subscription help offers topic copying and an Android app link, with separate subscriber credentials and explicit phone receipt confirmation.
- Preserve host-button focus during polling and help disclosure while reading.
- Use four explicit enrollment stages: name the host, prepare files, review/start the collector, and confirm an actual report. Copying does not advance the installation state. Keep deployment steps available if a report is delayed; allow an awaiting host to continue setup.
- Explain Docker access and credentials before setup. The primary action copies a private Bash block that prepares inspectable Compose files; starting containers is separate. Do not render credentials in ordinary instructions or static assets. Clipboard failure reveals a selected, read-only setup field only on request. Clear that field and the in-memory setup on dialog close. The alternative archive contains the same private configuration.
- Host removal requires an exact-name confirmation. Reporting-token replacement leaves the current token usable until successful activation.
- Keep setup explanations in contextual help and the first-run state.

## Tokens and accessibility

Tokens live in `worker/board.css`. Use a single system sans family for interface text, a monospace face for image tags and commands, and tabular numerals for counts and durations. Copper identifies primary actions and focus; green, amber, and red identify labeled states.

Controls have visible keyboard focus and accessible names. Status relies on text as well as color. On phones, uptime and restart counts remain within each container row. Honor reduced-motion preferences. Render external host/container data as text through DOM APIs.

## Evidence

README captures use fictional data from `scripts/preview.mjs`. See [screenshot provenance](docs/screenshots/README.md) and [development guidance](docs/development.md) for reproduction and verification limits.
