# Crowsnest

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People operating their own Docker fleet. The first self-hosted release supports one owner per instance, as confirmed by the project owner.

## Product Purpose

Keep host and container status visible from one private dashboard. Make installation, collector enrollment, updates, notifications, and recovery clear enough for another operator to use independently.

## Operating Context

Docker Engine and Compose on Linux hosts. Collectors report outbound over HTTPS. The owner prefers deployments below `/srv/docker`, clean directory/container names, and files usable by a normal user. The current instance is hosted privately through ChatGPT Sites; standalone Docker deployment is available.

## Capabilities and Constraints

Read-only monitoring, separate reporting credentials per host, a restricted socket proxy, collector versions, container details, Compose grouping, activity, ntfy notifications, and timed maintenance. Do not collect environment variables, logs, mounts, or network addresses without a separate product decision. The owner has approved public source and image distribution and will manage the GitHub visibility changes. MIT licensing is confirmed. Never commit runtime credentials or real fleet data.

## Brand Commitments

Crowsnest, the existing crow mark, and “Your fleet. In sight.” Preserve the established interface identity. UI polish must avoid generic AI design patterns and keep operating tasks clear.

## Evidence on Hand

Working dashboard and collector source, recorded API/browser checks, and fictional screenshot fixtures under `docs/screenshots`. No customer claims or performance benchmarks are supplied.

## Product Principles

- Show actual reports and label stale or unavailable information.
- Use limited Docker access and private credentials.
- Make the next installation step explicit and confirm success from a report.
- Keep common operating tasks easy to scan.
