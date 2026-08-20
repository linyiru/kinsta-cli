import pc from "picocolors";
import type { KinstaClient } from "../api.ts";
import { diagnoseLogs } from "../analyze.ts";
import { resolveSite } from "../resolve.ts";

export interface DiagnoseOptions {
  lines?: number;
}

export async function diagnoseCommand(
  client: KinstaClient,
  query: string,
  opts: DiagnoseOptions = {},
): Promise<void> {
  const sites = await client.listSites();
  const { site, env } = resolveSite(sites, query);

  console.log(pc.bold(`${site.name}`) + pc.dim(` (${env.display_name} · ${env.id})`));

  const lines = await client.getLogs(env.id, {
    fileName: "error",
    lines: opts.lines ?? 500,
    search: "PHP Fatal error",
  });

  const diagnosis = diagnoseLogs(lines);

  const badge =
    diagnosis.issue === "none"
      ? pc.green("HEALTHY")
      : diagnosis.issue === "unknown-fatal"
        ? pc.yellow(diagnosis.issue)
        : pc.red(diagnosis.issue);
  console.log(`\n${badge}  ${diagnosis.summary}`);

  if (diagnosis.fatal) {
    const f = diagnosis.fatal;
    if (f.plugin) console.log(pc.dim(`  plugin: `) + f.plugin);
    if (f.file) console.log(pc.dim(`  file:   `) + `${f.file}:${f.line ?? "?"}`);
    console.log(pc.dim(`  error:  `) + f.message);
  }
  if (diagnosis.remediation) {
    console.log(pc.dim(`\n→ ${diagnosis.remediation}`));
  }
}
