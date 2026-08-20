export type HealthCategory = "ok" | "server_error" | "forbidden" | "unreachable" | "other";

export function classifyHttpStatus(code: number): HealthCategory {
  if (code === 0) return "unreachable";
  if (code === 403) return "forbidden";
  if (code >= 200 && code < 400) return "ok";
  if (code >= 500) return "server_error";
  return "other";
}

export type KnownIssue = "wp-rocket-php8" | "jet-popup-null" | "unknown-fatal" | "none";

export interface LogFatal {
  raw: string;
  message: string;
  file?: string;
  plugin?: string;
  line?: number;
}

export interface Diagnosis {
  issue: KnownIssue;
  fatal?: LogFatal;
  summary: string;
  /** Human-readable remediation hint. */
  remediation?: string;
  /** Plugin that should be deactivated for automated remediation, if any. */
  targetPlugin?: string;
}

const FATAL_MARKER = "PHP Fatal error";
const FILE_RE = /in (\/[^\s:]+\.php):(\d+)/;
const PLUGIN_RE = /\/plugins\/([^/]+)\//;

/** Parse a single error-log line into a structured fatal, if it is one. */
export function parseFatal(line: string): LogFatal | undefined {
  if (!line.includes(FATAL_MARKER)) return undefined;

  const messageStart = line.indexOf(FATAL_MARKER);
  const message = line
    .slice(messageStart)
    .replace(/\\?"?\s*$/, "")
    .trim();

  const fatal: LogFatal = { raw: line, message };
  const fileMatch = line.match(FILE_RE);
  if (fileMatch) {
    fatal.file = fileMatch[1];
    fatal.line = Number(fileMatch[2]);
    const pluginMatch = fileMatch[1]?.match(PLUGIN_RE);
    if (pluginMatch) fatal.plugin = pluginMatch[1];
  }
  return fatal;
}

/**
 * Analyze error-log lines (newest last) and classify the most recent fatal.
 */
export function diagnoseLogs(lines: string[]): Diagnosis {
  let latest: LogFatal | undefined;
  for (const line of lines) {
    const fatal = parseFatal(line);
    if (fatal) latest = fatal;
  }

  if (!latest) {
    return {
      issue: "none",
      summary: "No PHP fatal errors found in the recent error log.",
    };
  }

  if (latest.plugin === "wp-rocket" && /substr\(/.test(latest.message)) {
    return {
      issue: "wp-rocket-php8",
      fatal: latest,
      targetPlugin: "wp-rocket",
      summary:
        "wp-rocket Cloudflare add-on passes an integer to substr(), which is a fatal TypeError on PHP 8.",
      remediation:
        "Deactivate wp-rocket (premium; WP-CLI cannot update it), then restart PHP and clear cache. `kinsta fix wp-rocket <site>` automates this.",
    };
  }

  if (latest.plugin === "jet-popup" && /to_block_attrs\(\)/.test(latest.message)) {
    return {
      issue: "jet-popup-null",
      fatal: latest,
      targetPlugin: "jet-popup",
      summary:
        "jet-popup calls to_block_attrs() on a null data_attributes object (missing null-guard on PHP 8).",
      remediation:
        "Update jet-popup via your Crocoblock licence, deactivate it, or add the same null-guard used elsewhere in the plugin.",
    };
  }

  return {
    issue: "unknown-fatal",
    fatal: latest,
    summary: latest.plugin
      ? `Fatal error originating in plugin "${latest.plugin}".`
      : "Fatal error (source plugin could not be determined).",
    remediation: "Inspect the full fatal below and deactivate/repair the offending plugin.",
  };
}
