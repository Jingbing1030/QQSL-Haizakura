#!/usr/bin/env node
/**
 * Region splitter - the inverse of scripts/merge.mjs.
 * Cuts a rolldown single-file bundle into per-region source files using
 * `//#region <path>` / `//#endregion` as boundaries, and writes manifest.json.
 *
 *   node scripts/split.mjs <bundle.mjs> <outDir>
 *
 * Notes:
 *  - Regions are verified to be flat (no nesting) and balanced before writing.
 *  - Code outside every region (the hoisted node:* import prologue) is preserved
 *    in _unassigned/loose-lines.txt with its original 1-based line numbers, so
 *    scripts/merge.mjs can lay everything back down exactly.
 *  - Region -> workspace path mapping:
 *      ../../node_modules/.pnpm/...  -> vendor-regions/node_modules/.pnpm/...
 *      ../<pkg>/src/...              -> packages/<pkg>/src/...
 *      src/...                       -> packages/core/src/...   (build cwd was packages/core)
 *      \0rolldown/runtime.js         -> packages/core/src/_rolldown-runtime.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';

const SRC = process.argv[2];
const OUT = resolve(process.argv[3] ?? '/tmp/restored');
if (!SRC) { console.error('usage: split.mjs <bundle.mjs> <outDir>'); process.exit(2); }

const VENDOR = join(OUT, 'vendor-regions');
const lines = readFileSync(SRC, 'utf8').split('\n');

// ---- parse regions (flat + balanced) ----
const stack = [], regions = [];
lines.forEach((l, i) => {
  if (l.startsWith('//#region')) stack.push([l.slice('//#region'.length).trim(), i]);
  else if (l.startsWith('//#endregion')) {
    const [name, s] = stack.pop();
    regions.push({ region: name, start_line: s + 1, end_line: i + 1 });
  }
});
if (stack.length) { console.error('unbalanced regions'); process.exit(1); }
regions.sort((a, b) => a.start_line - b.start_line);
// reject nesting (would make slicing ambiguous)
for (let i = 1; i < regions.length; i++) {
  if (regions[i].start_line < regions[i - 1].end_line) {
    console.error('nested regions are not supported'); process.exit(1);
  }
}

/** region name -> { kind, out } */
function classify(name) {
  if (name.startsWith('\\0') || name.startsWith('\0')) {
    return { kind: 'runtime-internal', out: 'packages/core/src/_rolldown-runtime.ts' };
  }
  if (name.includes('node_modules/.pnpm/')) {
    const tail = name.slice(name.indexOf('node_modules/.pnpm/') + 'node_modules/.pnpm/'.length);
    return { kind: 'vendor', out: join('vendor-regions', 'node_modules/.pnpm', tail) };
  }
  const sib = name.match(/^\.\.\/([a-z0-9_-]+)\/(.*)$/);
  if (sib) return { kind: 'workspace', out: `packages/${sib[1]}/${sib[2]}` };
  const own = name.match(/^src\/(.*)$/);
  if (own) return { kind: 'workspace', out: `packages/core/src/${own[1]}` };
  return { kind: 'other', out: join('vendor-regions', '__other__', name.replace(/[^A-Za-z0-9._/-]/g, '_')) };
}

const covered = new Set();
let totalLines = 0, totalBytes = 0;
for (const r of regions) {
  const { kind, out } = classify(r.region);
  const body = lines.slice(r.start_line, r.end_line - 1);   // between the markers
  const full = join(OUT, out);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body.join('\n') + '\n');
  Object.assign(r, { kind, out: relative(OUT, full), body_lines: body.length,
                     body_bytes: Buffer.byteLength(body.join('\n')) + 1 });
  for (let i = r.start_line; i <= r.end_line; i++) covered.add(i);
  totalLines += r.body_lines; totalBytes += r.body_bytes;
}

const loose = [];
lines.forEach((l, i) => { if (i > 0 && !covered.has(i + 1) && l !== '') loose.push(`${i + 1}\t${l}`); });
mkdirSync(join(OUT, '_unassigned'), { recursive: true });
writeFileSync(join(OUT, '_unassigned', 'loose-lines.txt'), loose.join('\n') + '\n');
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(regions, null, 1));

console.log(`[split] ${SRC}: ${readFileSync(SRC).length} bytes, ${lines.length} lines`);
console.log(`[split] ${regions.length} regions -> ${regions.length} files, ${totalLines} lines, ${totalBytes} bytes`);
console.log(`[split] loose lines outside regions: ${loose.length}`);
console.log('[split] mapping: split.mjs assigns src/* -> packages/core/src (build cwd was packages/core);');
console.log('[split] after splitting, rename packages/runtime -> packages/core if you use the python original.');
