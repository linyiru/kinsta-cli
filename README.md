# kinsta-cli

[![npm version](https://img.shields.io/npm/v/kinsta-cli.svg)](https://www.npmjs.com/package/kinsta-cli)
[![npm downloads](https://img.shields.io/npm/dm/kinsta-cli.svg)](https://www.npmjs.com/package/kinsta-cli)
[![node](https://img.shields.io/node/v/kinsta-cli.svg)](https://www.npmjs.com/package/kinsta-cli)
[![license](https://img.shields.io/npm/l/kinsta-cli.svg)](./LICENSE)

> Unofficial CLI for managing [Kinsta](https://kinsta.com)-hosted WordPress sites — bulk health checks, log diagnostics, traffic analytics, cache/PHP control, WP-CLI over the API, and one-shot **wp-rocket PHP 8** remediation.

The binary is installed as `kinsta`.

```bash
npm install -g kinsta-cli
kinsta --help
```

## Configuration

Configuration is read from environment variables:

| Variable            | Description                                      |
| ------------------- | ------------------------------------------------ |
| `KINSTA_API_KEY`    | Personal API key (Bearer token) from MyKinsta    |
| `KINSTA_COMPANY_ID` | Company UUID (used as the `company` query param) |

```bash
export KINSTA_API_KEY=...
export KINSTA_COMPANY_ID=...
```

> Tip: keep these in a secret manager and export them at runtime, e.g. with the 1Password CLI:
> `export KINSTA_API_KEY=$(op read "op://Personal/Kinsta API/KINSTA_API_KEY")`

## Commands

```
kinsta sites                     List all sites (name, domain, status, PHP, live env id)
kinsta health                    Bulk homepage health check (cache-busted) across all sites
kinsta analytics <site>          Traffic & usage analytics (visits, bandwidth, top-N, response codes)
kinsta diagnose <site>           Read the error log and identify the likely cause of a fatal
kinsta cache clear <site>        Clear the site cache (--cdn, --edge for those layers)
kinsta php restart <site>        Restart PHP (clears OPcache)
kinsta ssh <site>                Open an SSH shell (--info to print details, --exec to run one command)
kinsta wp <site> <command...>    Run a single WP-CLI command via the Kinsta API (no SSH)
kinsta fix wp-rocket [site]      Deactivate the wp-rocket PHP 8 fatal, restart PHP, clear cache
kinsta delete site <site>        Permanently delete a site (typed confirmation required)
```

`<site>` accepts a site name, display name, or any domain (exact match wins over substring).

### Examples

```bash
# Find every broken homepage (500s hidden behind a cached 200 are exposed via a cache-buster)
kinsta health --only server_error

# Figure out why a specific site is down
kinsta diagnose example.com

# Fix a single wp-rocket outage (deactivate + PHP restart + cache clear + verify)
kinsta fix wp-rocket example.com

# Scan and fix every affected site at once
kinsta fix wp-rocket --all

# Preview without changing anything
kinsta fix wp-rocket --all --dry-run

# Run a one-off command over SSH
kinsta ssh example.com --exec "wp plugin list --status=active"

# Run a single WP-CLI command via the API (no SSH); --wait polls until it finishes
kinsta wp example.com core version --wait
# quote the command when it has its own flags
kinsta wp example.com "plugin deactivate wp-rocket --skip-plugins --skip-themes"

# Traffic dashboard for one site (default metrics, last 7 days)
kinsta analytics example.com

# Pick specific metrics and a window
kinsta analytics example.com -m visits response-codes top-countries -s 30_days

# Every available metric, custom date range, as JSON
kinsta analytics example.com -m all --from 2025-08-01 --to 2025-08-20 --json

# Fleet-wide one-line summary per site
kinsta analytics --all -m usage response-codes
```

### Analytics metrics

`usage` (this-month plan usage), `visits`, `bandwidth`, `cdn-bandwidth`, `disk-space`,
`response-codes`, `top-countries`, `top-cities`, `top-client-ips`, `top-referrers`,
`top-browsers`, `top-user-agents`, `top-asns`, `top-hosts`, `visits-dispersion` — or `all`.
Windows: `--span 24_hours|7_days|30_days|60_days` (default `7_days`) or `--from`/`--to`.

## Why `fix wp-rocket`?

wp-rocket ≤ 3.16.x calls `substr()` with an integer key in its Cloudflare add-on, which is a
fatal `TypeError` on PHP 8. Because wp-rocket caches HTML, the homepage can return a **cached
200** while every uncached request 500s — so `health` always probes with a cache-busting query
param. wp-rocket is premium (WP-CLI cannot update it), so the safe remediation is to deactivate
it, restart PHP to clear OPcache, and flush the cache. `fix wp-rocket` automates exactly that and
verifies the site recovers.

By default `fix wp-rocket` remediates over the **Kinsta API** (`kinsta wp` under the hood), so no
SSH connection — and therefore no SSH password — is involved. Because the API accepts only a
single `wp` command (no shell chaining or `rm`), it deactivates wp-rocket and sets `WP_CACHE`
false to stop WordPress loading the broken `advanced-cache.php` drop-in. Pass `--wait` to poll each
operation to completion before the homepage is re-checked, or `--ssh` to fall back to the original
SSH + WP-CLI flow (which also removes the drop-in outright).

Verification is deliberately strict: `fix` re-checks the **real** (non cache-busted) homepage the
way a visitor sees it, treats a blank `200` (empty body) as a failure rather than success, retries
a few times to ride out the PHP-FPM restart window (a transient `503`), and re-clears the page
cache once if it finds a stale blank entry. `health` reports the same empty-body case as a distinct
**`BLANK`** status so a fatal swallowed by an output buffer no longer masquerades as healthy.

### `kinsta wp`

Runs one WP-CLI command through the Kinsta API. The API accepts a single `wp ...` invocation with
letters, digits and `_-./:=@'` only — no shell chaining (`&&`, `;`, `|`), quotes, or redirection —
and runs it **asynchronously without returning stdout**. The command prints the operation id;
`--wait` polls until it finishes, `--json` emits machine-readable output. Quote the WP-CLI command
when it carries its own flags (e.g. `kinsta wp <site> "plugin deactivate wp-rocket --skip-plugins"`).
Use `kinsta ssh --exec` when you need the command's output.

### `kinsta delete site`

Deleting a site removes every environment, its database and its files, and Kinsta
offers no undo — so this command is deliberately harder to use than the others.

```bash
kinsta delete site donnadiet --dry-run          # show what would go, change nothing
kinsta delete site donnadiet                    # interactive: retype the site name
kinsta delete site donnadiet --confirm donnadiet  # non-interactive
```

The guardrails, and why each one is there:

- **`<site>` must match exactly.** Every other command accepts a substring; here
  that convenience would let a typo resolve to a site nobody looked at.
- **The confirmation string is the resolved `site.name`**, not the argument you
  typed. Resolving by domain is fine, but you still have to confirm with the name
  printed in the summary — so you have to read it. `--confirm` is therefore
  bound to one specific site and cannot be pasted between invocations.
- **Non-interactive stdin without `--confirm` is refused**, never treated as
  consent, so a stray invocation in CI cannot delete anything.
- **The site is re-read twice**: once so the summary reflects current state
  rather than a cached listing, and again with nothing between that check and
  the irreversible call. Confirming is unbounded — an interactive prompt can sit
  open indefinitely — so a rename landing in that window aborts the delete.
- **There is no `--all` and no wildcard.** One site per invocation.

Deletion is asynchronous: the API answers `202` with an operation id and the site
shows up as `status: deleting` in `kinsta sites` until it finishes. The command
polls that operation, then checks whether the site is actually gone (a `404` on
`GET /sites/{id}`).

That existence check — not the operation status — decides the exit code, because
a delete that failed can still report a finished operation, and one that timed
out may have landed anyway. The site being gone is the only success. If it is
still there, whether polling finished or timed out, the command exits non-zero
so automation cannot carry on as though the site were deleted. `--no-wait`
returns as soon as the request is accepted and makes no such claim.

**Back up first — the command does not.** A verified backup means a database dump
and a `wp-content` archive whose checksums match after transfer, not just files
that exist:

```bash
kinsta ssh <site> --exec "cd <web_root> && wp db export /path/private/db.sql"
kinsta ssh <site> --exec "cd <web_root> && tar czf /path/private/files.tar.gz wp-content wp-config.php"
# download both, then verify: sha256 matches, `tar tzf` lists, and the dump ends
# with "-- Dump completed on ..."
```

## SSH host-key verification

Kinsta issues a **password** for SSH/SFTP, so an unverified connection would let a network
man-in-the-middle capture that password (and inject commands during `fix`). kinsta pins each
host key on first use (TOFU): the first connection to a `host:port` records the key's
`SHA256:` fingerprint, and every later connection must match or the connection is refused.

- Pinned keys live in `~/.config/kinsta/known_hosts.json` (override with `KINSTA_KNOWN_HOSTS`,
  or relocate via `XDG_CONFIG_HOME`).
- Keys are pinned per `host:port`, since Kinsta containers share IPs across different ports.
- If a key legitimately changes, delete its entry from the file and reconnect to re-pin.

## Development

```bash
npm install
npm run build       # bundle with rolldown → dist/cli.js
npm run typecheck   # TypeScript 7 (tsc --noEmit)
npm run lint        # oxlint
npm run format      # oxfmt
npm test            # vitest (MSW-backed, VCR-style fixtures)
npm run check       # format:check + lint + typecheck + test
```

Tests replay **de-identified** recorded API responses (`test/fixtures/`) through
[MSW](https://mswjs.io/), covering success, rate-limit retry, and error paths. SSH is exercised
through an injectable runner so no real connections are made.

## License

[MIT](./LICENSE)
