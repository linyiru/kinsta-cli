# kinsta-cli

> Unofficial CLI for managing [Kinsta](https://kinsta.com)-hosted WordPress sites — bulk health checks, log diagnostics, cache/PHP control, and one-shot **wp-rocket PHP 8** remediation.

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
kinsta diagnose <site>           Read the error log and identify the likely cause of a fatal
kinsta cache clear <site>        Clear the site cache (--cdn, --edge for those layers)
kinsta php restart <site>        Restart PHP (clears OPcache)
kinsta ssh <site>                Open an SSH shell (--info to print details, --exec to run one command)
kinsta fix wp-rocket [site]      Deactivate the wp-rocket PHP 8 fatal, restart PHP, clear cache
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
```

## Why `fix wp-rocket`?

wp-rocket ≤ 3.16.x calls `substr()` with an integer key in its Cloudflare add-on, which is a
fatal `TypeError` on PHP 8. Because wp-rocket caches HTML, the homepage can return a **cached
200** while every uncached request 500s — so `health` always probes with a cache-busting query
param. wp-rocket is premium (WP-CLI cannot update it), so the safe remediation is to deactivate
it, restart PHP to clear OPcache, and flush the cache. `fix wp-rocket` automates exactly that and
verifies the site recovers.

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
