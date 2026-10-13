# Versioning and releases

Crowsnest uses [Semantic Versioning 2.0.0](https://semver.org/): `MAJOR.MINOR.PATCH`.
`package.json` is the source of truth. The lockfile, dashboard footer, and bundled collector use the same version. Assembly replaces the collector template version marker before setup/update delivery. Run `npm run build` before distributing the collector; the raw template is not an installable version-stamped collector.

## Compatibility contract

Compatibility covers the collector report format and ingestion route, collector configuration keys, installation arguments and filenames, Compose service names, and stored host records. A visual change does not require reinstalling collectors. Older collectors may omit `collectorVersion`; the dashboard labels them unknown. Supplied versions use strict SemVer precedence, including prereleases and ignoring build metadata. Update guidance compares against the deployed dashboard bundle, not the latest GitHub release. Site publication numbers identify hosted builds and are separate from product versions.

During initial development (`0.x.y`), a minor release may introduce a documented incompatible change. Patch releases contain compatible fixes. An incompatible change must include release notes and instructions for affected users. The retirement of the one-time relocation endpoint is part of `0.2.0`; existing collectors continue reporting through the same ingestion route.

After `1.0.0`, increment:

- **PATCH** for compatible bug fixes, security fixes, and visual corrections.
- **MINOR** for compatible features and documented deprecations.
- **MAJOR** for changes requiring users to change collector configuration, installation, API use, or stored data.

Use `-rc.1`, `-rc.2`, and so on for release candidates. A released version and its Git tag are immutable.

## Release procedure

1. Update the version with `npm version <version> --no-git-tag-version`. Update `CHANGELOG.md` with the actual changes and date.
2. Run `npm run check`, the CI security scanners, and the relevant browser/collector checks. Require the **Checks** and **Security** workflows to pass on the release commit.
3. For UI changes, refresh the README captures using synthetic data and record their provenance.
4. Push reviewed source to main. The **Release** workflow waits for matching successful **Checks** and **Security**, builds and verifies the two platform images, and creates the annotated `v<version>` tag and GitHub release. Published versions are skipped; do not reuse a version for new release content.
5. Publish the matching source and artifact through ChatGPT Sites. Preserve the selected Site's identity and access policy. Record the product version, Git SHA, and hosted version together.

For standalone releases, keep the source Compose image tag aligned with `package.json`. The Release workflow builds Linux amd64/arm64 from the reviewed commit, tests both platform images in isolated volumes, and scans both for fixable high/critical vulnerabilities. It publishes the exact tested digest to `ghcr.io/bthall/crowsnest:<version>` and attaches a deployment archive, checksums, and multi-platform SPDX SBOM. The archive's Compose file pins the digest. Build provenance and SBOM attestations are also retained with the image.

The image base and npm dependencies are pinned. Source builds apply current OS package updates, so they are not bit-for-bit reproducible across dates. Published versions are never overwritten by this workflow. An interrupted release can reuse its matching image; a conflicting tag or digest requires a new version. Review Dependabot changes and bump the version when releasing dependency fixes. The vulnerability gate excludes unfixed and lower-severity findings, which require separate triage.

The privileged release job accepts only successful Security runs from main pushes in this repository, checks the matching Checks result, and refuses publication if main has advanced. It does not consume pull-request artifacts. Tokens remain in the runner environment; actions are pinned to reviewed commit SHAs. Registry visibility is a separate owner setting: first GHCR publication defaults to private. See [GitHub's container registry guide](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

GitHub releases and Site deployment are separate steps. Release CI does not update a running dashboard or collector. Set branch rules to require the workflows when repository plan support permits; workflow files alone do not prevent merging a failing change.
