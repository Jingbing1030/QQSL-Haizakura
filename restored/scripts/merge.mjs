#!/usr/bin/env node
/**
 * SnowLuma build - reassemble dist/index.mjs from the restored region fragments.
 *
 * The original dist/index.mjs is a single-file, fully-inlined rolldown bundle:
 * every module (all workspace packages + 15 vendored npm packages) was merged
 * into ONE module scope with zero `export` statements. Runtime module init is
 * performed by `init_xxx()` thunks emitted by rolldown's __esmMin helper.
 *
 * Reconstructing real per-module ESM boundaries would require re-deriving every
 * import/export edge, which the bundle does not record. Instead this script does
 * the exact inverse of the extraction: it concatenates the region slices back in
 * their original order - bit-for-bit what the bundler produced.
 *
 *   packages/star/src/star.ts + vendor-regions/... -> dist/index.mjs
 *
 * Verified: round-trip is byte-exact (12,338,350 / 12,338,350 bytes).
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'manifest.json');
const OUT = join(ROOT, 'dist', 'index.mjs');
const HEADER_MARK = '// @ts-nocheck\n';

/** region name -> path of its slice, relative to ROOT */
function slicePath(e) {
  if (e.kind === 'vendor') {
    return join('vendor-regions', 'node_modules/.pnpm',
      e.region.slice(e.region.indexOf('node_modules/.pnpm/') + 'node_modules/.pnpm/'.length));
  }
  if (e.kind === 'other') {
    return join('vendor-regions', '__other__',
      e.region.replace(/[^A-Za-z0-9._/-]/g, '_'));
  }
  return e.out;
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

// 1. loose lines (the hoisted `import ... from "node:*"` prologue) keep their
//    original line numbers, so region slices can be laid back into place.
const lines = new Map();
for (const raw of readFileSync(join(ROOT, '_unassigned', 'loose-lines.txt'), 'utf8').split('\n')) {
  if (!raw) continue;
  const tab = raw.indexOf('\t');
  lines.set(Number(raw.slice(0, tab)), raw.slice(tab + 1));
}

// 2. lay every region slice back down between its //#region / //#endregion markers
let max = 0;
for (const e of manifest) {
  let body = readFileSync(join(ROOT, slicePath(e)), 'utf8');
  const hdr = body.indexOf(HEADER_MARK);
  if (hdr !== -1) body = body.slice(hdr + HEADER_MARK.length); // strip restore header
  body = body.replace(/\nexport \{\};\n$/, '\n');
  if (body.endsWith('\n')) body = body.slice(0, -1);
  const rows = body.split('\n');
  lines.set(e.start_line, `//#region ${e.region}`);
  rows.forEach((r, i) => lines.set(e.start_line + 1 + i, r));
  lines.set(e.end_line, '//#endregion');
  max = Math.max(max, e.end_line);
}

const out = [];
for (let i = 1; i <= max; i++) out.push(lines.get(i) ?? '');
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out.join('\n') + '\n');

const bytes = statSync(OUT).size;
console.log(`[merge] wrote ${OUT} (${bytes} bytes, ${max} lines)`);
console.log(`[merge] original 12338350 bytes -> delta ${bytes - 12338350}`);
