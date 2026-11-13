#!/usr/bin/env node
/**
 * gen-docs-corpus.mjs — embed the offline documentation corpus into the bundle.
 *
 * The WebUI bundle is a SINGLE flat-scope file with no `import` allowed in new
 * regions, so the documentation has to travel inside the source. 856 KB of
 * Markdown would bloat the 12 MB bundle by 7%; gzip+base64 brings that down to
 * ~2.9% (see --report). The generated file is decoded lazily on the first
 * /docs request with the already-hoisted `gunzipSync`.
 *
 * usage:
 *   node scripts/gen-docs-corpus.mjs                 # default paths, writes the .ts
 *   node scripts/gen-docs-corpus.mjs --report        # print stats only, write nothing
 *   node scripts/gen-docs-corpus.mjs --docs <dir> --internals <dir> --out <file>
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(name); return i === -1 ? dflt : argv[i + 1]; };

const DOCS = resolve(opt('--docs', join(ROOT, '..', 'docs')));
const INTERNALS = resolve(opt('--internals', join(ROOT, '..', 'docs-internals')));
const OUT = resolve(ROOT, opt('--out', join('packages', 'core', 'src', 'webui', 'docs-corpus.ts')));
const REPORT_ONLY = argv.includes('--report');

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`gen-docs-corpus.mjs

  --docs <dir>        Markdown root served under /docs/<rel>       (default ../docs)
  --internals <dir>   Markdown root served under /docs/internals/  (default ../docs-internals)
  --out <file>        generated region file (default packages/core/src/webui/docs-corpus.ts)
  --report            print sizes and exit without writing`);
  process.exit(0);
}

/** Deterministic recursive walk: sorted entries, .md only, symlinks skipped. */
function collect(dir, prefix, acc) {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const ent of entries) {
    if (ent.isSymbolicLink()) continue;
    const full = join(dir, ent.name);
    const key = prefix ? prefix + '/' + ent.name : ent.name;
    if (ent.isDirectory()) collect(full, key, acc);
    else if (/\.md$/i.test(ent.name)) acc[key] = readFileSync(full, 'utf8');
  }
}

const corpus = {};
collect(DOCS, '', corpus);
collect(INTERNALS, 'internals', corpus);

const keys = Object.keys(corpus).sort();
if (!keys.length) {
  console.error('[gen-docs] no Markdown found; check --docs / --internals');
  process.exit(1);
}
const ordered = {};
for (const k of keys) ordered[k] = corpus[k];

const json = JSON.stringify(ordered);
const jsonBuf = Buffer.from(json, 'utf8');
const gz = gzipSync(jsonBuf, { level: 9 });
const gz2 = gzipSync(jsonBuf, { level: 9 });            // reproducible-build guard
if (!gz.equals(gz2)) {
  console.error('[gen-docs] gzip output is not deterministic - refusing to write');
  process.exit(1);
}
const b64 = gz.toString('base64');
const digest = createHash('sha256').update(jsonBuf).digest('hex');
const rawBytes = keys.reduce((n, k) => n + Buffer.byteLength(corpus[k], 'utf8'), 0);
const b64Bytes = Buffer.byteLength(b64, 'utf8');

console.log('[gen-docs] sources');
console.log(`  ${DOCS}`);
console.log(`  ${INTERNALS}`);
console.log(`[gen-docs] files          ${keys.length}`);
console.log(`[gen-docs] markdown       ${(rawBytes / 1024).toFixed(1)} KB`);
console.log(`[gen-docs] json           ${(jsonBuf.length / 1024).toFixed(1)} KB`);
console.log(`[gen-docs] gzip           ${(gz.length / 1024).toFixed(1)} KB  (${(gz.length / rawBytes * 100).toFixed(1)}% of markdown)`);
console.log(`[gen-docs] base64 in src  ${(b64Bytes / 1024).toFixed(1)} KB  (${(b64Bytes / rawBytes * 100).toFixed(1)}% of markdown)`);
console.log(`[gen-docs] corpus sha256  ${digest}`);

if (REPORT_ONLY) process.exit(0);

const lines = [];
lines.push('// @ts-nocheck');
lines.push('/* eslint-disable */');
lines.push('// ---------------------------------------------------------------------------');
lines.push('// GENERATED FILE - do not edit by hand.');
lines.push('//');
lines.push('//   regenerate:  node scripts/gen-docs-corpus.mjs');
lines.push(`//   sources:     ${relative(ROOT, DOCS)}  +  ${relative(ROOT, INTERNALS)}`);
lines.push(`//   contents:    ${keys.length} Markdown files, ${rawBytes} bytes`);
lines.push(`//   corpus sha256: ${digest}`);
lines.push('//');
lines.push(`// The corpus is one JSON object { "<doc path>": "<markdown>" }, gzipped and`);
lines.push(`// base64-encoded: ${rawBytes} bytes of Markdown -> ${b64Bytes} bytes of source`);
lines.push(`// (${(b64Bytes / rawBytes * 100).toFixed(1)}%), which keeps the 12 MB bundle growth at ~3%.`);
lines.push('//');
lines.push('// This file must NOT import anything: the bundle is one flat scope and every');
lines.push('// binding it needs (gunzipSync, Buffer) is already hoisted there. It is decoded');
lines.push('// lazily on the first /docs request by hzDocsDecodeCorpus() in docs-mount.ts.');
lines.push('// ---------------------------------------------------------------------------');
lines.push('');
lines.push('var hzDocsCorpusGzipB64 =');
const chunks = b64.match(/[\s\S]{1,400}/g) ?? [];
lines.push(chunks.map((c) => '\t' + JSON.stringify(c)).join(' +\n') + ';');
lines.push('');
lines.push('export {};');
lines.push('');

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join('\n'));
console.log(`[gen-docs] wrote ${relative(ROOT, OUT)} (${Buffer.byteLength(lines.join('\n'), 'utf8')} bytes, ${lines.length} lines)`);
