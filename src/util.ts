export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Render a simple left-aligned column table. */
export function table(rows: string[][], headers?: string[]): string {
  const all = headers ? [headers, ...rows] : rows;
  if (all.length === 0) return "";
  const widths: number[] = [];
  for (const row of all) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  }
  const format = (row: string[]) =>
    row.map((cell, i) => cell.padEnd(i === row.length - 1 ? 0 : (widths[i] ?? 0))).join("  ");
  const lines: string[] = [];
  if (headers) {
    lines.push(format(headers));
    lines.push(widths.map((w) => "-".repeat(w)).join("  "));
    for (const row of rows) lines.push(format(row));
  } else {
    for (const row of all) lines.push(format(row));
  }
  return lines.join("\n");
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, Math.max(0, max - 1)) + "…";
}
