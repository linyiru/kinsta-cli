# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `kinsta wp <site> <command...>` — run a single WP-CLI command through the
  Kinsta API without SSH. Supports `--wait` (poll the operation to completion)
  and `--json`. The API runs commands asynchronously and returns no stdout.
- `health` now flags a new `blank` category: a `200` response with an empty
  body (e.g. a plugin fatal swallowed by an early output buffer), which
  previously looked healthy. `checkHealth` reads a small body prefix to detect
  this without downloading the whole page.

### Changed

- `fix wp-rocket` now remediates over the Kinsta API by default (no SSH
  password exchange, closing the man-in-the-middle exposure). It deactivates
  wp-rocket and sets `WP_CACHE` false to stop the broken `advanced-cache.php`
  drop-in from loading. Added `--wait` to await each operation before
  verifying, and `--ssh` to fall back to the original SSH + WP-CLI flow.
- `fix wp-rocket` verification is hardened: it now probes the real (non
  cache-busted) homepage the way a visitor sees it, treats a blank `200` as a
  failure, retries a few times to ride out the PHP-FPM restart window
  (transient `503`), and re-clears the page cache once when it sees a stale
  blank cache entry.

### Fixed

- `getSshConfig` now handles the flat `GET .../ssh/config` response shape the
  Kinsta API actually returns (previously it assumed an `environment` wrapper,
  causing `Cannot read properties of undefined (reading 'host')` for
  `ssh --info/--exec` and the `--ssh` fix path). The legacy wrapped shape is
  still supported.

## [0.2.0] - 2026-08-20

### Added

- `kinsta analytics <site>` command exposing every Kinsta analytics endpoint:
  - Time series: `visits`, `bandwidth`, `cdn-bandwidth`, `disk-space`.
  - `usage` — this-month plan usage (visits plus server and CDN bandwidth).
  - `response-codes` — HTTP status-code breakdown.
  - Top-N: `top-countries`, `top-cities`, `top-client-ips`, `top-referrers`,
    `top-browsers`, `top-user-agents`, `top-asns`, `top-hosts`.
  - `visits-dispersion` — device split over time.
- Metric selection with `-m/--metric <name...>` (or `all`), time windows via
  `-s/--span 24_hours|7_days|30_days|60_days` (default `7_days`) or
  `--from`/`--to`, `-n/--top` for top-N rows, `--json`, and `--all` for a
  fleet-wide per-site summary.

## [0.1.1] - 2026-08-20

### Security

- SSH connections now verify host keys with trust-on-first-use (TOFU) pinning.
  Previously `ssh2` accepted any host key, so a network man-in-the-middle could
  capture the API-issued SSH password and inject commands during `fix`. Keys are
  pinned per `host:port` and a changed key now refuses the connection.

### Added

- Pinned host keys persist to `~/.config/kinsta/known_hosts.json` (overridable
  via `KINSTA_KNOWN_HOSTS` or `XDG_CONFIG_HOME`).

## [0.1.0] - 2026-08-20

### Added

- Initial CLI for managing Kinsta-hosted WordPress sites, with commands:
  `sites`, `health`, `diagnose`, `cache clear`, `php restart`, `ssh`, and
  `fix wp-rocket`.
- Homepage health checks are cache-busted so a cached 200 never hides a 500.
- `fix wp-rocket` remediates the wp-rocket PHP 8 fatal (deactivate over SSH,
  restart PHP, clear cache, verify), with `--all`, `--dry-run`, and `--force`.
- Rate-limit aware API client (serialized requests plus exponential backoff).
- MSW-backed, VCR-style test suite using de-identified fixtures.

## [0.0.1] - 2026-08-20

### Added

- Placeholder package to reserve the `kinsta-cli` name on npm.

[Unreleased]: https://github.com/linyiru/kinsta-cli/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/linyiru/kinsta-cli/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/linyiru/kinsta-cli/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/linyiru/kinsta-cli/releases/tag/v0.1.0
[0.0.1]: https://github.com/linyiru/kinsta-cli/releases/tag/v0.0.1
