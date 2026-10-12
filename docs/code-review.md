# Project review: 0.7.2

Reviewed 2026-10-12 against the complete 0.7.1 source: Worker routes and R2 storage, dashboard interactions and presentation, collector and socket proxy, installer and Compose templates, notification delivery and unattended runner, build/export scripts, tests, CI, and documentation. Fixes preserve the existing private Site, reporting fields, credentials, installation paths, and Compose names.

## Findings addressed

| Priority | Finding and consequence | Result and regression coverage |
| --- | --- | --- |
| High | Default urllib redirects could forward both collector credentials to another origin. | Actual reporting requests reject 301/302/303/307/308 in a loopback HTTP test. HTTPS configuration, TLS verification, response bounds, and ingestion acknowledgements are enforced. Existing hosts need the source-only collector update. |
| High | Overlapping rename, replacement issuance, or activation could replace newer credentials or recreate a removed registration. | Registration changes use R2 ETag preconditions. Interleaved API tests verify conflicts, successful retries, token invalidation, preserved names, and removal during activation. |
| Medium | A container removed after listing caused every container on that host to lose its report. | Inspection 404 omits the removed container. Other inspection errors still prevent submission. Tests distinguish churn from permission/server failures. |
| Medium | Serial inspections and a fixed sleep after collection lengthened reporting cycles. | Four inspection workers preserve list order; a 60-second admission budget prevents starting further reads indefinitely. Tests verify concurrency, ordering, response/report limits, and work-adjusted cadence. |
| Medium | Stale-host notifications discarded delivered container alerts, causing repeated alerts or missing recoveries when reports resumed. | Delivered container baselines survive an outage until a fresh report resolves them. Tests cover repeated sweeps, unchanged unhealthy containers, and recovery. |
| Medium | JSON null could turn a client error into HTTP 503; invalid UTF-8 was silently replaced. | Object-only JSON and strict UTF-8 parsing return HTTP 400 without changing state. Notifier configuration and reply shapes are also validated. |
| Medium | Partial R2 listing pages were interpreted as a full fleet during enrollment. | Registration follows cursors and counts existing records. Tests cover small pages and the actual 100-host limit. |
| Medium | Fleet polling used serial storage reads; single-host activity scanned unrelated registrations. | Five-host batches overlap independent reads, with at most ten storage reads active. Host activity uses two direct reads. Tests check paging, concurrency, and operation counts. |
| Medium | A refresh caller could return immediately while another request was pending; delayed clipboard callbacks could alter a different dialog. | Refresh callers await one shared request. Clipboard feedback/fallbacks retain their original dialog or container context. Real-browser checks cover overlap, selection, and delayed rejection. |
| Low | Hidden container tables were rebuilt during Activity/Alerts, and host lookups repeatedly scanned arrays. | Hidden views preserve table nodes, and host buttons use indexed lookup. Browser checks verify node preservation and normal navigation/focus. |
| Medium | The local secret checker missed quoted JSON/Python keys. | It recognizes quoted assignments. Isolated Git fixtures verify rejection of synthetic candidate values and generated credential files without printing their values. |
| Low | CI did not explicitly test the deployed Python version; README still named 0.7.0. | Python 3.12/3.13 CI matrix, pinned setup action, corrected README, and package/README version consistency check. Clean exports include every new test dependency. |

Priority describes the consequence if triggered, not evidence that credentials were exposed or production data was lost.

## Validation

`npm run check` builds the actual Worker and exercises private viewer/service routes, origins, token staging and expiry, field allowlisting, version compatibility, bounded history, maintenance, notification acknowledgements and backoff, installer permissions, and source-only updates. The expanded collector tests import the production module; the redirect test makes real HTTP requests to a loopback server using synthetic credentials. API concurrency tests interleave actual Worker calls against storage implementing conditional writes and pagination.

Browser QA uses fictional hosts and intercepted mutations. Tested widths: 1440, 1024, 768, 390, and 320 pixels. Overview, details, enrollment, notifications, and management had no tested WCAG A/AA violations, horizontal document overflow, or page exceptions. Checks include keyboard focus, search/filtering, stale/offline states, enrollment through an actual synthetic report, credential dialog isolation, update confirmation with browser clock skew, shared refresh callers, and delayed clipboard operations. These are tested states, not a claim of exhaustive accessibility coverage. README images retain their truthful 0.7.1 capture provenance because this patch changes behavior without redesigning the interface.

Release validation also requires the complete-history secret checks, Gitleaks, and the GitHub Checks/Security workflows on the pushed commit. Production publication and any live collector rollout are recorded separately from this source review.

## Remaining limits and follow-up

- R2 conditional writes protect individual registration changes. Name uniqueness and host-count checks across simultaneous enrollments are not transactional. History, snapshots, notification deduplication, and cleanup span multiple objects; overlapping requests can coalesce events, duplicate notifications, or leave unreferenced objects after removal. Strict guarantees require coordinated storage, such as a transactional database or a Durable Object. Existing viewer routes enumerate registrations and do not expose orphaned data.
- Docker socket inspection exposes local container configuration to the trusted collector, even though only allowed status fields are sent. The existing proxy remains restricted to GET on version/list/inspect paths and publishes no ports.
- Docker image tags receive upstream patch updates when explicitly pulled. CI's focused Semgrep rules are not an image vulnerability scan; reproducible image digests and an image-update/CVE process remain follow-up work. No claim is made that npm audit scans Python, HAProxy, or Alpine images.
- A socket timeout and collection admission deadline do not enforce a hard wall-clock deadline against a peer that continuously streams. Responses and concurrency are bounded; slow or failing collections remain visibly stale rather than reporting incomplete success.
- Owner-private access depends on Sites dispatch and its authenticated-user header. This Worker must not be exposed through a separate untrusted origin that can spoof that header. It remains one private Site per owner, not a shared multi-tenant service.
- An independently available notifier and ntfy server are required for alerts during a monitored host outage. Phone delivery and ntfy permissions need live integration verification; an acknowledgement only confirms server acceptance.
- No distribution license, immutable Git tag, or formal GitHub Release is introduced by this patch. Product SemVer and hosted publication numbers remain separate.

## Primary references

- [Python urllib redirect handler](https://docs.python.org/3/library/urllib.request.html#urllib.request.HTTPRedirectHandler.redirect_request)
- [Cloudflare R2 conditional operations](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#conditional-operations)
- [Pinned setup-python action source](https://github.com/actions/setup-python/tree/ece7cb06caefa5fff74198d8649806c4678c61a1)
