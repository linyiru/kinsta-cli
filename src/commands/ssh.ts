import pc from "picocolors";
import type { KinstaClient } from "../api.ts";
import { resolveSite } from "../resolve.ts";
import { Ssh2Runner, type SshRunner, type SshTarget } from "../ssh.ts";

export interface SshOptions {
  info?: boolean;
  exec?: string;
  runner?: SshRunner;
}

async function buildTarget(client: KinstaClient, query: string) {
  const sites = await client.listSites();
  const { site, env } = resolveSite(sites, query);
  const config = await client.getSshConfig(site.id, env.id);
  const password = await client.getSshPassword(env.id);
  const target: SshTarget = {
    host: config.host,
    port: Number(config.port),
    user: config.user,
    password,
  };
  return { site, env, config, target };
}

export async function sshCommand(
  client: KinstaClient,
  query: string,
  opts: SshOptions = {},
): Promise<number> {
  const { site, config, target } = await buildTarget(client, query);

  if (opts.info) {
    console.log(pc.bold(site.name));
    console.log(`  host:     ${config.host}`);
    console.log(`  port:     ${config.port}`);
    console.log(`  user:     ${config.user}`);
    console.log(`  password: ${target.password}`);
    console.log(`  command:  ${config.ssh_command}`);
    return 0;
  }

  const runner = opts.runner ?? new Ssh2Runner();

  if (opts.exec) {
    const result = await runner.run(target, opts.exec);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    return result.code ?? 0;
  }

  console.error(pc.dim(`Connecting to ${config.user}@${config.host}:${config.port} …`));
  return runner.shell(target);
}
