// `positiveIntEnv` — read a positive integer environment variable.
//
// Reference region: ../common/src/env.ts (reference/index.mjs:1664). Three lines of
// logic, ported because four separate env knobs in this layer (`SNOWLUMA_PACKET_TIMEOUT_MS`,
// `SNOWLUMA_HTTP_DOWNLOAD_TIMEOUT_MS`, `SNOWLUMA_MAX_BINARY_DOWNLOAD_BYTES`, and the
// hook ack timeout) all route through it and they must agree on what "invalid" means.
//
// The policy: a BLANK value is absent (return the fallback silently); a present but
// unusable value is ignored with a warning (return the fallback). It never throws —
// a typo in a deployment's env file must not stop the process from starting, but it
// must be visible.

import { createLogger } from "../onebot/log.js";

const log = createLogger("Env");

/** `MAX_POSITIVE_INT` — the largest value `setTimeout` accepts. */
export const MAX_POSITIVE_INT = 2_147_483_647;

export interface PositiveIntEnvOptions {
  max?: number;
  env?: NodeJS.ProcessEnv;
}

export function positiveIntEnv(
  name: string,
  fallback: number,
  options: PositiveIntEnvOptions = {},
): number {
  const max = options.max ?? MAX_POSITIVE_INT;
  const raw = (options.env ?? process.env)[name];
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  const value = raw.trim();
  const parsed = /^[1-9]\d*$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed > max) {
    log.warn("%s=%j is ignored; expected a positive integer up to %d", name, raw, max);
    return fallback;
  }
  return parsed;
}