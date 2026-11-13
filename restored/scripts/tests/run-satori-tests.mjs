#!/usr/bin/env node
/** Satori protocol + HTTP API assertions against the real built bundle. */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildHarness } from './strip-and-append.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'satori-test-'));
const driver = join(HERE, 'driver-protocol.mjs');
const out = join(tmp, 'harness.mjs');
const info = buildHarness(driver, out);
console.log(`[satori-test] harness: bundle truncated at line ${info.headLines} (before src/index.ts)`);
try {
  execFileSync('node', [out], { stdio: 'inherit', env: { ...process.env } });
  console.log('[satori-test] OK');
} catch (e) {
  console.error('[satori-test] FAILED');
  process.exit(e.status ?? 1);
}
