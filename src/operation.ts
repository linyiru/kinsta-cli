import pc from "picocolors";
import type { KinstaClient } from "./api.ts";

/** An async operation finished with a non-2xx status, or never finished. */
export class OperationFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationFailedError";
  }
}

export interface AwaitOperationOptions {
  intervalMs?: number;
  maxAttempts?: number;
}

/**
 * Poll an operation to completion and print one line for it. Throws when it
 * fails or outlasts the poll window, so a multi-step command stops before
 * building on a step that did not land.
 */
export async function awaitOperation(
  client: KinstaClient,
  operationId: string,
  label: string,
  opts: AwaitOperationOptions = {},
): Promise<void> {
  const result = await client.waitForOperation(operationId, opts);
  if (result.timedOut) {
    throw new OperationFailedError(
      `${label}: still running after the poll window (${operationId}). Check MyKinsta.`,
    );
  }
  if (result.status < 200 || result.status >= 300) {
    throw new OperationFailedError(`${label}: failed (${result.status}) — ${result.message}`);
  }
  console.log(pc.green("✓") + ` ${label} ` + pc.dim(result.message));
}
