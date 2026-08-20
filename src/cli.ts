import { Command } from "commander";
import pc from "picocolors";
import { KinstaApiError, KinstaClient } from "./api.ts";
import type { HealthCategory } from "./analyze.ts";
import { cacheClearCommand } from "./commands/cache.ts";
import { diagnoseCommand } from "./commands/diagnose.ts";
import { fixWpRocketCommand } from "./commands/fix.ts";
import { healthCommand } from "./commands/health.ts";
import { phpRestartCommand } from "./commands/php.ts";
import { sitesCommand } from "./commands/sites.ts";
import { sshCommand } from "./commands/ssh.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { SiteResolutionError } from "./resolve.ts";

const VERSION = "0.1.0";

function createClient(): KinstaClient {
  return new KinstaClient(loadConfig());
}

function handleError(err: unknown): never {
  if (err instanceof ConfigError) {
    console.error(pc.red(err.message));
    process.exit(2);
  }
  if (err instanceof SiteResolutionError) {
    console.error(pc.red(err.message));
    for (const site of err.matches) console.error(pc.dim(`  - ${site.name}`));
    process.exit(2);
  }
  if (err instanceof KinstaApiError) {
    console.error(pc.red(`Kinsta API error ${err.status}: ${err.message}`));
    process.exit(1);
  }
  console.error(pc.red(err instanceof Error ? err.message : String(err)));
  process.exit(1);
}

function buildProgram(): Command {
  const program = new Command();
  program
    .name("kinsta")
    .description("Unofficial CLI for managing Kinsta-hosted WordPress sites.")
    .version(VERSION);

  program
    .command("sites")
    .description("List all sites (name, primary domain, status, PHP, live env id)")
    .option("--json", "output raw JSON")
    .action(async (opts: { json?: boolean }) => {
      await sitesCommand(createClient(), opts);
    });

  program
    .command("health")
    .description("Bulk homepage health check (cache-busted) across all sites")
    .option("--json", "output raw JSON")
    .option("--only <category>", "filter by category: ok|server_error|forbidden|unreachable|other")
    .option("-c, --concurrency <n>", "parallel requests", (v) => Number(v))
    .action(async (opts: { json?: boolean; only?: HealthCategory; concurrency?: number }) => {
      await healthCommand(createClient(), opts);
    });

  program
    .command("diagnose")
    .argument("<site>", "site name or domain")
    .description("Read the error log and identify the likely cause of a fatal")
    .option("--lines <n>", "log lines to scan", (v) => Number(v))
    .action(async (site: string, opts: { lines?: number }) => {
      await diagnoseCommand(createClient(), site, opts);
    });

  const cache = program.command("cache").description("Cache operations");
  cache
    .command("clear")
    .argument("<site>", "site name or domain")
    .description("Clear the site cache (optionally CDN and edge cache)")
    .option("--cdn", "also clear the CDN cache")
    .option("--edge", "also clear the edge cache")
    .action(async (site: string, opts: { cdn?: boolean; edge?: boolean }) => {
      await cacheClearCommand(createClient(), site, opts);
    });

  const php = program.command("php").description("PHP operations");
  php
    .command("restart")
    .argument("<site>", "site name or domain")
    .description("Restart PHP (clears OPcache)")
    .action(async (site: string) => {
      await phpRestartCommand(createClient(), site);
    });

  program
    .command("ssh")
    .argument("<site>", "site name or domain")
    .description("Open an SSH shell, run a command, or print connection info")
    .option("--info", "print connection details instead of connecting")
    .option("--exec <cmd>", "run a single command and print its output")
    .action(async (site: string, opts: { info?: boolean; exec?: string }) => {
      process.exitCode = await sshCommand(createClient(), site, opts);
    });

  const fix = program.command("fix").description("Automated remediations");
  fix
    .command("wp-rocket")
    .argument("[site]", "site name or domain (omit with --all)")
    .description("Deactivate the wp-rocket PHP 8 fatal, restart PHP, clear cache")
    .option("--all", "scan and fix every affected site")
    .option("--dry-run", "report what would change without making changes")
    .option("--force", "fix even if no wp-rocket fatal is detected")
    .action(
      async (
        site: string | undefined,
        opts: { all?: boolean; dryRun?: boolean; force?: boolean },
      ) => {
        await fixWpRocketCommand(createClient(), site, opts);
      },
    );

  return program;
}

async function main(): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(process.argv);
}

main().catch(handleError);
