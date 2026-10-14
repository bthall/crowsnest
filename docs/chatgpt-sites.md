# Set up Crowsnest with ChatGPT Sites

The supported deployment model is **one private Site per owner**, with its own storage and reporting credentials. This keeps each user's Docker fleet separate and matches the current single-owner application.

This guide follows the Sites skill's source, authentication, storage, and publication workflow. Access to Sites, private repository access, and supported service access must be available to the installing user.

## Prepare source

From an authorized checkout:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run export:site
```

The export appears in `output/site-template`. It contains an explicit list of implementation files and a hosting manifest declaring R2 binding `BUCKET`. It omits the current Site ID, Git history, user data, host registrations, runtime settings, and collector credentials. It refuses to overwrite an existing export.

Crowsnest is licensed under [MIT](../LICENSE). Repository access and deployment credentials are separate: an exported folder prepares a new deployment and carries no access to an existing instance. Use your own Site identity and runtime secrets.

## Create the private Site

Ask ChatGPT/Codex with the Sites skill to work from the clean export:

> Create a new owner-private Crowsnest Site from this clean source folder. This is a dependency-free Worker ESM app. Keep the R2 binding BUCKET, persist the new Site identity, configure its own canonical reporting origin and service credential through Sites, run the checks, and publish the exact matching source and artifact. Keep collector credentials out of source and browser code.

The publishing agent should:

1. Confirm the export has no existing `project_id`. Register the new Site once and immediately persist the platform-returned ID in `.openai/hosting.json`.
2. Keep R2 binding `BUCKET`; Sites provisions and connects the new storage. Do not copy stored records from another owner's Site.
3. Use the new Site's generated HTTPS origin for `SITE_ORIGIN`. Configure `COLLECTOR_SERVICE_TOKEN` as a runtime secret using the supported service-access value for that same Site. The platform consumes `OAI-Sites-Authorization`; it does not supply visitor identity.
4. If the connected tools omit supported service access, resolve that capability before registering hosts. Do not change the audience or invent credentials.
5. Run the build and checks, synchronize the exact source through the Sites source helper, and package the matching Worker artifact.
6. Publish with the private deployment operation. Check a non-terminal deployment until it completes, then return its URL.

For an existing Site, open its selected source through the Sites helper and preserve its exact Site ID, storage bindings, and audience. Never treat the GitHub repository URL as the hosted dashboard origin.

## Connect and verify a host

Open the new dashboard while signed in, choose **Connect a host**, then follow [collector installation](deployment.md). Inspect the Compose package, deploy it as a normal user, and confirm reporting from a real host.

Before calling the setup complete, verify:

- The access policy permits only the intended owner; anonymous dashboard and asset requests are denied.
- Registration works on the generated origin and any active custom domain, while cross-origin registration is rejected.
- Reporting requires both supported private-Site service access and the host's reporting token.
- The ordinary page and static JavaScript source contain no service credential. Explicit private setup responses and collector downloads carry credentials. Manual-copy fallback reveals setup only after a requested copy is blocked; host configuration remains private.
- A first report appears, stale reporting is clear, and desktop/mobile and keyboard flows work.

## Distribution and account scope

The source export has portable bindings, synthetic fixtures, and no deployment credentials. Product releases, image availability, and visibility are described in [versioning](versioning.md). The standalone installation path is covered in [self-hosting](self-hosting.md).

A shared Site for unrelated users requires a separate product design: server-side ownership on every host, snapshot, registration, and reporting path; isolation of storage keys; and reporting credentials scoped to each owner. The current host collection is shared within a Site. The browser identity header establishes identity, while the Sites access policy establishes membership.

## Platform references

- The **Sites** skill in the publishing agent's installed environment.
- Sites references: **Identity and Secrets**, **Storage**, and **Browser agent support (WebMCP)**.
- [Configuration reference](configuration.md), [security policy](../SECURITY.md), and [versioning](versioning.md).

The dashboard preserves its existing optional WebMCP tools: reading status and opening setup. Opening setup does not register a host or issue credentials. A Site MCP server or marketplace listing is a separate capability and is not required for this private dashboard.
