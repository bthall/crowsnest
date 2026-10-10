# Codex UI tools and this polish pass

Tools were reviewed against Crowsnest's existing private dashboard and branding, rather than selecting a new framework or a generic style preset.

| Tool | Fit for Crowsnest | Decision |
| --- | --- | --- |
| [Impeccable](https://github.com/pbakaus/impeccable) | Codex design guidance, critique/polish workflows, and local pattern detection | Used the scoped polish and operating-tool guidance; pinned skill 4.5.2 at commit `d631a8827f99414d2b6daba4ef08b7f8701751d7` |
| [Official Codex Playwright skill](https://github.com/openai/skills/tree/main/skills/.curated/playwright) | Exercise real browser flows and capture the working UI | Used for desktop/mobile review and screenshots |
| [axe-core](https://github.com/dequelabs/axe-core) | Automated accessibility checks alongside keyboard review | Used version 4.14.0 for the page and setup dialog |
| [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | Codex-supported style and design-system exploration | Reviewed as an alternative; no preset or installer added |
| [Codex and Figma workflow](https://developers.openai.com/blog/building-frontend-uis-with-codex-and-figma) | Explore editable designs and return them to implementation | Available for future design collaboration; not needed for this pass |

Installed skills are development aids in the agent's environment. They add no hosted scripts or production dependencies. No design hooks or external design account were connected.

## Changes

Kept the crow, slate surfaces, copper action color, and brand line. Reduced the large introductory area and detached summary cards. Attached a compact summary to the selected host; surfaced issues in navigation and sorted them first in the table. Added search and attention filtering, contextual setup help, clearer errors, and mobile row details.

CSS and JavaScript are separate private assets. Container data uses DOM text APIs. This allows the Worker to deny inline scripts and styles through CSP.

## Verification

Browser checks covered search by name/image, attention filtering and clearing, stale/empty/waiting states, registration errors, permission recovery, keyboard setup and focus restoration, focus preservation during polling, long names/images, and HTML-like container text. Layouts at 320, 390, 850, and 1440 CSS pixels had no page overflow. axe-core reported no violations for its selected WCAG 2 A/AA and WCAG 2.1 AA checks on desktop, mobile, and the setup dialog.

The Impeccable detector could not resolve the absolute asset URL to the source stylesheet and consequently reported a flat-heading warning. Browser-computed styles and visual inspection verified the actual hierarchy. The detector does not establish design quality or accessibility compliance.

Captures use fictional data. Native mobile browser behavior, assistive-technology behavior, and the platform's native WebMCP runtime require separate integration verification. See [DESIGN.md](../DESIGN.md) and [screenshot provenance](screenshots/README.md).
