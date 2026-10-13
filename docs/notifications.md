# ntfy notifications

Crowsnest can publish fleet alerts to [ntfy](https://docs.ntfy.sh/publish/). Delivery runs on the server while the dashboard is closed. Existing collectors need no update.

## Configure a private destination

1. Choose an authenticated ntfy server and a dedicated, hard-to-guess topic. Generate at least 128 random bits, for example with `openssl rand -hex 16`, and prefix the result with `crowsnest-`. Create a regular publisher account with **write-only** access to that exact topic, then issue its bearer token. Keep subscriber credentials separate. See [ntfy access control](https://docs.ntfy.sh/config/#access-control).
2. Through Sites runtime configuration, set `NTFY_URL` to the full topic URL, in the form `https://ntfy.example.com/crowsnest-<32-random-hex-characters>`. Store `NTFY_TOKEN` as a **secret**. Never put either credential in the hosting manifest, browser JavaScript, or collector configuration.
3. Publish the matching Site version to apply runtime changes. The destination must be HTTPS on a DNS hostname, with one topic path and no credentials, query, fragment, custom port, or reserved ntfy route. The server must be reachable from the hosted Worker. Redirects are rejected. The operator must trust its DNS and access controls.
4. Open **Alerts → ntfy notifications**. Choose **Copy topic URL** and add that server/topic in your ntfy app with your subscriber account. On Android, **Open in ntfy (Android)** opens the subscription through [ntfy’s documented app link](https://docs.ntfy.sh/subscribe/phone/#deep-linking). Other devices can use the copied URL. The app link contains no publisher token. Choose **Send test notification**, then enable **Send fleet notifications** and save. `NTFY_ENABLED=true` can set the initial enabled default; saved dashboard settings override it.
5. Configure and verify a background sweep as described below. A URL by itself does not create a schedule.

For an authenticated server, a topic name is not a password. On a public server, a guessable topic exposes fleet details. Prefer authentication for a private fleet. Anonymous publishing is supported when `NTFY_TOKEN` is absent, but topic confidentiality then depends on the server.

## What gets sent

- A host has not reported for more than the selected delay (two minutes by default).
- A newly enrolled host has no first report after ten minutes.
- A reported container is unhealthy, restarting, or dead.
- A previously delivered issue clears, if recovery messages are enabled.

Messages contain the host name and affected container names/state/health, with a link back to the private dashboard. They do not include logs, environment variables, reporting credentials, or publisher tokens. Exited containers are excluded because scheduled jobs often exit normally. Recoveries for missing containers say to check the dashboard rather than claiming they are healthy. Stale snapshots cannot produce container recovery messages.

Previously delivered container alerts remain in the baseline while a host is stale. A fresh report resolves them or preserves them without repeating the original alert; the collector-report recovery is evaluated separately.

Each host's changes are grouped into a message, limited to ten displayed changes and 3,500 UTF-8 bytes. Unchanged reports do not send repeated alerts. A changed destination starts a new baseline and can send currently active issues. Pausing stops automatic delivery; the explicit test remains available. Re-enabling compares current issues with the last delivered state.

The Worker verifies ntfy's message acknowledgement before recording success. **Accepted by ntfy** does not prove delivery to a phone: subscriptions, mobile permissions, and ntfy push configuration still matter. A failed send preserves the transition for retry, with exponential backoff from 30 seconds up to 15 minutes. New reports and scheduled sweeps drive retries; superseded transitions are coalesced to current state. R2 state is not transactional: overlapping work or lost acknowledgements can duplicate a message. This is best-effort operational notification delivery, without an incident paging SLA.

## Notification policy

In **Alerts → ntfy notifications**, choose which conditions to send: missing host reports, unhealthy, restarting, and dead containers. All are enabled by default. Choose a host delay of 2, 5, 10, or 15 minutes and an alert priority of Default, High (the default), or Urgent. Recovery messages keep default priority. These settings apply to the entire fleet, including hosts outside the selected group.

The dashboard still marks reports stale after two minutes. Notification delay changes only when a stale-host message is sent; first-report warnings remain ten minutes after enrollment. Stale hosts retain delivered container baselines even when host-report alerts are disabled or delayed. Turning off a category silently removes its baseline without reporting a recovery. Re-enabling a category alerts on an issue still present. Existing saved settings inherit the original default policy.

## Per-host maintenance

**Manage host → Maintenance mode** pauses that host’s automatic alerts and recoveries for a bounded duration. It leaves collection, health, and activity visible and does not stop the minute checker. Expiry or early end resumes current-state evaluation on the next report or sweep; suppressed transient issues do not send recoveries. See [maintenance details](deployment.md#pause-notifications-during-maintenance).

## Unattended stale-host checks

Collector reports process their own host's alerts. Stale hosts and pending deliveries also need an independent sweep, particularly if every collector stops. The browser is not a scheduler.

ChatGPT Sites cloud schedules currently permit no more than one run per hour. For timely stale-host alerts, use the optional Docker runner below, or another external timer. An hourly Site-linked task is suitable only if that delay is acceptable. Inspect `get_site.automations` first, reuse a matching task, and preserve a paused task. Ordinary alert checks do not redeploy the Site. Other Worker deployments may attach a platform cron trigger to the exported `scheduled` handler.

### Saved instructions for the scheduled updater

These instructions are part of the reviewed source. The runtime supplies the selected Site ID; never substitute another deployment or widen its audience.

1. Use Sites `get_site` for that Site to obtain its supported service-access bearer. Do not log, persist, or print the bearer. If service access is unavailable, report the failed check instead of inventing an identity.
2. Make an HTTPS `POST` to the generated Site origin's `/api/notifications/sweep`. Set both `OAI-Sites-Authorization: Bearer <service bearer>` for private dispatch and `Authorization: Bearer <service bearer>` for the restricted application sweep route. The generated origin avoids custom-domain redirects. No visitor identity or browser Origin is required for this service route.
3. Expect HTTP 200 and `{ok:true, checked, sent, pending, at}`. A check within 30 seconds of another can return `{ok:true, skipped:true}`. Requests need a timeout sufficient for up to 100 hosts, with five outbound deliveries at a time and five-second per-delivery timeouts. If `pending` is nonzero, ntfy delivery is still failing or backing off; check later rather than hammering the endpoint.
4. Read back `GET /api/notifications/sweep` through the same service access. Confirm the persisted `at` and result correspond to the completed sweep. `lastDeliveryError` gives a sanitized ntfy failure when present. Log only counts, timestamps, or a redacted failure. On transient request failure, retry once after at least 30 seconds; leave further retries to the next scheduled run. Alert-processing errors must not cause a Site redeployment or credential rotation.

The service credential authorizes notification sweep/readback and the rate-limited test route, in addition to private dispatch. It cannot read dashboard data or change notification settings without a viewer session. Keep it private, including in every collector configuration. No ntfy token is required by the scheduler.

With the Docker runner's one-minute sweeps, a host becoming stale is normally detected between two and three minutes after its last report, plus delivery time. An hourly cloud task can delay it by over an hour. Check **Last background check** in Alerts to detect a paused or failing schedule. A failed/absent schedule leaves reporting-time container alerts working but stale-host detection incomplete.

## Optional Docker runner

`notifier/notifier.py` uses only Python's standard library. It checks once a minute, verifies each POST with a persisted GET readback, denies redirects, retains TLS verification, and logs only counts/timestamps or error types. It needs no ntfy credential and publishes no messages itself.

Deploy the reviewed `notifier/compose.yaml` and `notifier/notifier.py` to `/srv/docker/crowsnest-notifier`. Create the directory as your normal user using the same ownership pattern as collector setup:

```bash
sudo install -d -m 0700 -o "$(id -u)" -g "$(id -g)" /srv/docker/crowsnest-notifier
cd /srv/docker/crowsnest-notifier
# Copy the two reviewed source files here as compose.yaml and notifier.py.
(umask 077; printf 'NOTIFIER_UID=%s\nNOTIFIER_GID=%s\n' "$(id -u)" "$(id -g)" > .env)
```

Using supported service access for your own Site, securely create `notifier.json` (mode 0600) with keys `url` (the generated HTTPS Site origin) and `serviceToken` (its supported service bearer). This file is private and ignored by Git. Configure it through a private file transfer or agent stdin, keeping the bearer out of shell arguments/history. Do not reuse credentials from another owner's deployment.

```bash
sudo docker compose config --quiet
sudo docker compose up -d
sudo docker compose logs --tail=20 notifier
```

The container is named `crowsnest-notifier`, runs as the configured UID/GID, has a read-only filesystem, dropped capabilities, resource limits, and no published ports. Files stay owned by your normal user. After rotating the Site service credential, update this private file and recreate the notifier. Stop it with `docker compose down`; dashboard notification settings do not stop the checker.

Place the checker on an available host. A checker on a monitored host cannot detect that host's failure while it is down. Likewise, a self-hosted ntfy server cannot deliver notifications while its own host is down. Use an independently hosted checker and ntfy server if alerts during a complete local outage are required. Failures coalesce and retry once services return; this setup is not an independent uptime monitor.

## Troubleshooting

- **HTTP 401/403:** verify the publisher token, exact topic ACL, and that the runtime revision was published. Do not grant admin access as a shortcut.
- **HTTP 429:** ntfy is rate limiting. Automatic retries back off. The test button has an additional one-minute application limit.
- **Connection or acknowledgement failed:** check the public HTTPS endpoint, certificate, DNS, ntfy availability, and proxy rules. The destination cannot redirect.
- **No phone alert after accepted test:** verify the server/topic subscription and subscriber access in ntfy, then notification permissions and self-hosted push configuration.
- **No stale-host alert:** check that notifications are enabled and that background checks continue while the browser and collectors are silent.

Network-mocked CI tests cover private routes, destination restrictions, secret exposure, transitions, recoveries, deduplication, retries, pausing, service sweeps, acknowledgements, test rate limiting, and host-removal cleanup. Live setup additionally requires an accepted test and an unattended sweep with persisted readback.
