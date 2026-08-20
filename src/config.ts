/**
 * Configuration is loaded exclusively from environment variables:
 *   - KINSTA_API_KEY     : personal API key (Bearer token)
 *   - KINSTA_COMPANY_ID  : company UUID used as the `company` query param
 */
export interface KinstaConfig {
  apiKey: string;
  companyId: string;
}

export class ConfigError extends Error {
  constructor(public readonly missing: string[]) {
    super(
      `Missing required environment variable(s): ${missing.join(", ")}.\n` +
        `Set them before running kinsta, e.g.:\n` +
        `  export KINSTA_API_KEY=...\n` +
        `  export KINSTA_COMPANY_ID=...`,
    );
    this.name = "ConfigError";
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): KinstaConfig {
  const apiKey = env.KINSTA_API_KEY?.trim();
  const companyId = env.KINSTA_COMPANY_ID?.trim();

  const missing: string[] = [];
  if (!apiKey) missing.push("KINSTA_API_KEY");
  if (!companyId) missing.push("KINSTA_COMPANY_ID");
  if (missing.length > 0) throw new ConfigError(missing);

  return { apiKey: apiKey as string, companyId: companyId as string };
}
