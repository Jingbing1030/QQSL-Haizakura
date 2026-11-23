// `positiveIntEnv` — read a positive integer environment variable.
//
// Reference region: ../common/src/env.ts (reference/index.mjs:1664). Three lines of
// logic, ported because four separate env knobs in this layer (`PACKET_TIMEOUT_MS`,
// `HTTP_DOWNLOAD_TIMEOUT_MS`, `MAX_BINARY_DOWNLOAD_BYTES`, and the hook ack timeout)
// all route through it and they must agree on what "invalid" means.
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

/**
 * Read an environment variable under the `HAIZAKURA_` name, falling back to `SNOWLUMA_`.
 *
 * Haizakura is a rename of SnowLuma, and deployments that already run SnowLuma have
 * `SNOWLUMA_*` names baked into their compose files, systemd units and container images.
 * Renaming the variables outright would make every existing deployment silently fall back
 * to defaults — the process would start, look healthy, and ignore the operator's
 * configuration. That is the worst possible failure mode for a config knob.
 *
 * So both names are honoured, with the new name winning when both are set.
 */
export function readEnvAlias(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const modern = env[`HAIZAKURA_${name}`];
  if (typeof modern === "string" && modern.trim()) return modern;
  const legacy = env[`SNOWLUMA_${name}`];
  if (typeof legacy === "string" && legacy.trim()) return legacy;
  return undefined;
}

export function positiveIntEnv(
  name: string,
  fallback: number,
  options: PositiveIntEnvOptions = {},
): number {
  const max = options.max ?? MAX_POSITIVE_INT;
  const raw = readEnvAlias(name, options.env ?? process.env);
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  const value = raw.trim();
  const parsed = /^[1-9]\d*$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed > max) {
    log.warn("%s=%j is ignored; expected a positive integer up to %d", name, raw, max);
    return fallback;
  }
  return parsed;
}
