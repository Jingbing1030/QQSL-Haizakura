#!/usr/bin/env node
/**
 * SnowLuma build integrity check.
 *   1. every region slice exists and is non-empty
 *   2. reassembly is byte-exact against the reference bundle (when available)
 *   3. dist/index.mjs passes `node --check`
 */
import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REF = process.argv[2] || '/tmp/sl/index.mjs';
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
let fail = 0, missing = 0;

function slicePath(e) {
  if (e.kind === 'vendor') return join('vendor-regions', 'node_modules/.pnpm', e.region.slice(e.region.indexOf('node_modules/.pnpm/') + 'node_modules/.pnpm/'.length));
  if (e.kind === 'other') return join('vendor-regions', '__other__', e.region.replace(/[^A-Za-z0-9._/-]/g, '_'));
  return e.out;
}
for (const e of manifest) {
  const p = join(ROOT, slicePath(e));
  if (!existsSync(p) || statSync(p).size === 0) { console.error('MISSING', p); missing++; fail++; }
}
console.log(`[check] regions: ${manifest.length}  missing: ${missing}`);

execFileSync('node', [join(ROOT, 'scripts', 'merge.mjs')], { stdio: 'inherit' });
const dist = join(ROOT, 'dist', 'index.mjs');
execFileSync('node', ['--check', dist], { stdio: 'inherit' });
console.log('[check] dist/index.mjs: syntax OK');

if (existsSync(REF)) {
  const a = readFileSync(dist), b = readFileSync(REF);
  const n = Math.min(a.length, b.length);
  let diff = -1;
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) { diff = i; break; }
  if (diff === -1 && a.length !== b.length) diff = n;
  if (diff === -1) console.log(`[check] BYTE-EXACT match with reference (${a.length} bytes) OK`);
  else { console.error(`[check] MISMATCH at byte ${diff} (rebuilt ${a.length} vs ref ${b.length})`); fail++; }
} else console.log(`[check] reference ${REF} not present - skipped byte comparison`);
process.exit(fail ? 1 : 0);
