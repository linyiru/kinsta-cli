/**
 * Helpers for the Kinsta "Run a WP-CLI command" API.
 *
 * The endpoint only accepts a single `wp ...` invocation matching a strict
 * pattern — no shell chaining (`&&`, `;`, `|`), redirection, or non-`wp`
 * programs — and it does not return command output (only an operation id).
 */

/** Mirrors the API's `runWPCLICommand-Body.wp_command` pattern + length cap. */
export const WP_COMMAND_PATTERN = /^wp\s+[a-zA-Z0-9_\-./:=@'\s]+$/;
export const WP_COMMAND_MAX_LENGTH = 5000;

export function isValidWpCommand(command: string): boolean {
  return command.length <= WP_COMMAND_MAX_LENGTH && WP_COMMAND_PATTERN.test(command.trim());
}

export class WpCommandError extends Error {
  constructor(public readonly command: string) {
    super(
      `Invalid WP-CLI command: "${command}".\n` +
        `The Kinsta API accepts a single "wp ..." command with letters, digits, ` +
        `and _-./:=@' only (no &&, ;, |, quotes, or redirection), up to ` +
        `${WP_COMMAND_MAX_LENGTH} characters.`,
    );
    this.name = "WpCommandError";
  }
}

/**
 * API-compatible wp-rocket PHP 8 remediation, run as separate `wp` commands
 * (the API forbids chaining and cannot `rm` the drop-in). Deactivating the
 * plugin and turning WP_CACHE off stops WordPress from loading the broken
 * `advanced-cache.php`, which is what the SSH flow achieved with `rm`.
 */
export const WP_ROCKET_REMEDIATION_COMMANDS: readonly string[] = [
  "wp plugin deactivate wp-rocket --skip-plugins --skip-themes",
  "wp config set WP_CACHE false --raw",
];
