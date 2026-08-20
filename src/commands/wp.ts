import pc from "picocolors";
import type { KinstaClient } from "../api.ts";
import { resolveSite } from "../resolve.ts";
import { isValidWpCommand, WpCommandError } from "../wpcli.ts";

export interface WpOptions {
  wait?: boolean;
  json?: boolean;
}

export async function wpCliCommand(
  client: KinstaClient,
  query: string,
  command: string,
  opts: WpOptions = {},
): Promise<void> {
  const wpCommand = command.trim();
  if (!isValidWpCommand(wpCommand)) throw new WpCommandError(wpCommand);

  const sites = await client.listSites();
  const { site, env } = resolveSite(sites, query);

  const operationId = await client.runWpCli(env.id, wpCommand);

  let result: Awaited<ReturnType<KinstaClient["waitForOperation"]>> | undefined;
  if (opts.wait) result = await client.waitForOperation(operationId);

  if (opts.json) {
    console.log(
      JSON.stringify(
        { site: site.name, env: env.id, command: wpCommand, operation_id: operationId, result },
        null,
        2,
      ),
    );
    return;
  }

  console.log(pc.bold(site.name) + pc.dim(` (${env.id})`));
  console.log(pc.green("✓") + ` queued ` + pc.dim(`${wpCommand}`));
  console.log(pc.dim(`  operation: ${operationId}`));
  console.log(pc.dim("  (the API does not return command output; check MyKinsta for details)"));

  if (result) {
    if (result.timedOut) {
      console.log(pc.yellow("!") + ` still running after wait — ` + pc.dim(result.message));
    } else if (result.status >= 200 && result.status < 300) {
      console.log(pc.green("✓") + ` completed — ` + pc.dim(result.message));
    } else {
      console.log(pc.red("✗") + ` failed (${result.status}) — ` + pc.dim(result.message));
    }
  }
}
