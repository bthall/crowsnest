# Fleet visibility direction

This extends the incumbent Crowsnest dashboard in Operate mode. The owner's production-readiness request covers useful fleet features, clear unavailable states, and desktop/mobile polish. Preserve DESIGN.md, the crow mark, slate surfaces, copper actions, existing enrollment, private access, and read-only operation. The build is code-led; no new visual world or raster assets are needed.

## First viewport

Host selection stays beside the container table on desktop and above it on mobile. An optional labeled Group selector scopes hosts, containers, activity, and current alerts. Global fleet counts remain explicitly global. Host names stay unique across groups. Manage host edits a name and optional group together.

## Resource inspection

Choose a host to find Container resources, with current CPU and memory attached to the host's report. Expand it for two labeled 24-hour charts and a table of the same readings. CPU uses 100% per core; memory excludes reclaimable cache. Values are container workloads, not whole-machine utilization. Five-minute windows retain the latest report, never an invented average. Missing samples break the chart. Legacy collectors, denied stats, warm-up, partial reports, empty workloads, and stale reports get distinct truthful copy. Container details add CPU, memory, and limit information without exposing raw Docker stats.

The signature interaction is inspection in context: selecting a host scopes its readings; switching hosts cancels pending requests so a response cannot populate another host. Native disclosures keep the overview compact. Charts carry units, times, a text description, and accessible table values. Retry is explicit. Polling preserves keyboard focus and open disclosures.

## Notification policy

Existing Alerts settings gain labeled choices for host reports, unhealthy, restarting, and dead containers, host delay, and ntfy priority. Default behavior is unchanged. Explain the two-minute dashboard freshness threshold separately from notification delay and the ten-minute first-report warning. Changing a policy never claims that a disabled condition recovered. Maintenance and deduplication continue to apply. Settings affect the entire fleet regardless of selected group.

## Verification contract

Batch desktop (1440), mobile (390), and narrow (320) verification for populated and unavailable resource views, grouping, container details, and policy settings. Cover keyboard, focus, overflow, loading/error/retry, request cancellation, Axe, and reduced motion. At most two builder inspection rounds precede the fresh finish reviewer and documenter. Use fictional preview data only in shipping screenshots and document its provenance.
