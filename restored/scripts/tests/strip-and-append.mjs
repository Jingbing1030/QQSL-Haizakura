/** Truncate dist/index.mjs before the `src/index.ts` entry region and append a
 *  driver. Shared by the Satori test runners. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function buildHarness(driverPath, outPath) {
  const dist = readFileSync(join(ROOT, 'dist', 'index.mjs'), 'utf8');
  const marker = '//#region src/index.ts';
  const at = dist.indexOf(marker);
  if (at === -1) throw new Error(`entry region not found in dist/index.mjs (${marker})`);
  // cut at the start of the marker's own line
  const lineStart = dist.lastIndexOf('\n', at) + 1;
  const head = dist.slice(0, lineStart);
  const driver = readFileSync(driverPath, 'utf8');
  writeFileSync(outPath, head + '\n' + driver);
  return { headLines: head.split('\n').length - 1, out: outPath };
}
