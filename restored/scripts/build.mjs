#!/usr/bin/env node
/**
 * SnowLuma dev-mode builder  (mode C: byte-faithful base + new source files)
 * =========================================================================
 * Adds "new source file" support on top of the byte-faithful scripts/merge.mjs,
 * WITHOUT changing merge.mjs / check.mjs / manifest.json.
 *
 * One pass produces:
 *   1. the 467 original regions laid down VERBATIM at their absolute line
 *      numbers -> still byte-identical to the reference bundle;
 *   2. new modules declared in manifest-extra.json spliced in at a
 *      region-relative insertion point, wrapped in rolldown-style __esmMin
 *      thunks so init order is explicit and controllable.
 *
 * Because the bundle is ONE flat scope with zero `export` statements, a new
 * module must not have its own imports/exports - see README-BUILD.md.
 *
 * usage:
 *   node scripts/build.mjs --verify-base          verify base, write nothing
 *   node scripts/build.mjs                        full build (base + extras)
 *   node scripts/build.mjs --base-only            byte-faithful rebuild only
 *   node scripts/build.mjs --ref <bundle>         explicit reference bundle
 *   node scripts/build.mjs --suggest-insert <f>   propose an "insert" value
 *   node scripts/build.mjs --help
 *
 * exit 0 = ok, 1 = at least one check failed.
 */
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync, realpathSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'manifest.json');
const EXTRA_DEFAULT = join(ROOT, 'manifest-extra.json');
const LOOSE = join(ROOT, '_unassigned', 'loose-lines.txt');
const STAMP = join(ROOT, 'reference', '.pristine-source.stamp.json');
const HEADER_MARK = '// @ts-nocheck\n';

/** Known reference profiles. --base-profile <name> asserts the rebuilt base
 *  hashes to <sha>; a hash is strictly better than "delta N" because it proves
 *  *which* tree (and which brand) you are actually building. */
const PROFILES = {
  pristine:  { size: 12338350, sha256: '9875467bcbebb9e149126f5e30dfb089f297a2a483862cf7cb5fd06c413a98e6', note: 'original SnowLuma branding' },
  haizakura: { size: 12338442, sha256: 'd86359ed63b89a8accb014f67a8181418c820e3993838918a23542ec30d9a6da', note: 'rebranded SnowLuma -> Haizakura (+92 bytes)' },
};

/* ------------------------------------------------------------------ cli */

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };

if (flag('--help') || flag('-h')) {
  console.log(`SnowLuma dev-mode builder

  node scripts/build.mjs [options]

  (no options)                  build dist/index.mjs = 467 base regions + manifest-extra.json
  --verify-base                 verify the base reproduction only; write nothing
  --base-only                   byte-faithful rebuild only (ignore manifest-extra.json)
  --suggest-insert <file>       propose an "insert" value for a new file, then exit
  --ref <bundle>                reference bundle for the byte-exact check
  --base-profile <name>         assert the rebuilt base equals a known profile
                                (${Object.keys(PROFILES).join(' | ')} | auto)
  --expect-base <sizes>         comma-separated accepted base byte sizes
                                (default 12338442,12338350 = haizakura,pristine)
  --expect-sha <sha256>         assert the rebuilt base hash
  --extra <file>                new-module config (default manifest-extra.json)
  --out <file>                  output path (default dist/index.mjs)
  --no-check                    skip \`node --check\`
  --no-strict                   do not fail on a non-byte-exact base
  --banner                      prepend a generated-file banner

Notes
  * dist/index.mjs is the only supported output name: the bundle derives its
    install root from import.meta.url (to find native/ and dist/client/).
  * never edit an existing slice's line count; see README-BUILD.md.`);
  process.exit(0);
}

const OUT = resolve(ROOT, opt('--out', join('dist', 'index.mjs')));
const BASE_ONLY = flag('--base-only');
const VERIFY_ONLY = flag('--verify-base');
const PROFILE = opt('--base-profile', 'auto');
const EXPECT_SHA = opt('--expect-sha', null);
const EXPECT_BASE = opt('--expect-base', '12338442,12338350')
  .split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
const SUGGEST = opt('--suggest-insert', null);
const STRICT = !flag('--no-strict');

let errors = 0;
const fail = (m) => { console.error(`[build] ERROR ${m}`); errors++; };
const warn = (m) => console.error(`[build] WARN  ${m}`);
const info = (m) => console.log(`[build] ${m}`);
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/* --------------------------------------------------- slice / body helpers */

function slicePath(e) {
  if (e.kind === 'vendor') {
    return join('vendor-regions', 'node_modules/.pnpm',
      e.region.slice(e.region.indexOf('node_modules/.pnpm/') + 'node_modules/.pnpm/'.length));
  }
  if (e.kind === 'other') {
    return join('vendor-regions', '__other__', e.region.replace(/[^A-Za-z0-9._/-]/g, '_'));
  }
  return e.out;
}

/** Exact inverse of split.mjs - must stay identical to merge.mjs. */
function normalizeSlice(e) {
  let body = readFileSync(join(ROOT, slicePath(e)), 'utf8');
  const hdr = body.indexOf(HEADER_MARK);
  if (hdr !== -1) body = body.slice(hdr + HEADER_MARK.length);
  body = body.replace(/\nexport \{\};\n$/, '\n');
  if (body.endsWith('\n')) body = body.slice(0, -1);
  return body.split('\n');
}

/** Blank out string/template/regex/comment content so identifier scanning and
 *  declaration extraction do not pick up words inside literals. Newlines are
 *  preserved; escaped characters become spaces. */
function maskLiterals(src) {
  const out = new Array(src.length);
  let i = 0;
  const n = src.length;
  let prev = '';
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') { out[i] = ' '; i++; }
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      out[i] = ' '; out[i + 1] = ' '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out[i] = src[i] === '\n' ? '\n' : ' '; i++; }
      if (i < n) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out[i] = ' '; i++;
      let depth = 0;                       // template ${...} nesting
      while (i < n) {
        if (src[i] === '\\') {
          out[i] = ' '; if (i + 1 < n) out[i + 1] = src[i + 1] === '\n' ? '\n' : ' '; i += 2; continue;
        }
        if (q === '`' && src[i] === '$' && src[i + 1] === '{') {
          // ${...} is CODE, not literal - copy it through verbatim (recursively
          // masked) so identifiers inside it are still discovered.
          out[i] = ' '; out[i + 1] = src[i + 1]; i += 2; depth = 1;
          let start = i;
          while (i < n && depth > 0) {
            const ch = src[i];
            if (ch === '{') depth++;
            else if (ch === '}') { depth--; if (depth === 0) break; }
            else if (ch === '"' || ch === "'" || ch === '`') {
              const qq = ch; i++;
              while (i < n) {
                if (src[i] === '\\') { i += 2; continue; }
                if (src[i] === qq) { i++; break; }
                i++;
              }
              continue;
            }
            i++;
          }
          const inner = maskLiterals(src.slice(start, i));
          for (let k = 0; k < inner.length; k++) out[start + k] = inner[k];
          if (i < n) { out[i] = src[i]; i++; }
          continue;
        }
        if (src[i] === q) { out[i] = ' '; i++; break; }
        out[i] = src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      prev = q; continue;
    }
    if (c === '/' && /[=(,:[!&|?{};+\-*%~^<>]|^$/.test(prev)) {
      // regex literal: scan to the unescaped closing slash on the same line
      let j = i + 1, inClass = false, ok = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) { ok = true; break; }
        j++;
      }
      if (ok) {
        for (let k = i; k <= j; k++) out[k] = ' ';
        i = j + 1; prev = '/'; continue;
      }
    }
    out[i] = c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join('');
}

const KEYWORDS = new Set(('break case catch class const continue debugger default delete do else export ' +
  'extends finally for function if import in instanceof let new return super switch this throw try typeof ' +
  'var void while with yield async await static get set of as from enum implements interface package private ' +
  'protected public true false null undefined NaN Infinity arguments eval globalThis').split(' '));

const GLOBALS = new Set(('console process Buffer require module exports __dirname __filename setTimeout ' +
  'clearTimeout setInterval clearInterval setImmediate clearImmediate queueMicrotask structuredClone fetch ' +
  'URL URLSearchParams TextEncoder TextDecoder AbortController AbortSignal Event EventTarget Blob FormData ' +
  'Headers Request Response WebSocket crypto performance atob btoa Promise Object Array String Number Boolean ' +
  'Symbol Map Set WeakMap WeakSet Date RegExp JSON Math Error TypeError RangeError SyntaxError ReferenceError ' +
  'EvalError URIError AggregateError Proxy Reflect Intl BigInt ArrayBuffer SharedArrayBuffer DataView ' +
  'Uint8Array Int8Array Uint16Array Int16Array Uint32Array Int32Array Float32Array Float64Array BigInt64Array ' +
  'BigUint64Array Uint8ClampedArray FinalizationRegistry WeakRef Function eval isNaN isFinite parseFloat ' +
  'parseInt decodeURI decodeURIComponent encodeURI encodeURIComponent escape unescape').split(' '));

/** Split a declarator list on top-level commas, respecting brackets and strings. */
function splitTopLevel(s) {
  const parts = [];
  let depth = 0, cur = '', q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === '\\') { cur += s[++i] ?? ''; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    if (c === ')' || c === ']' || c === '}') depth--;
    if ((c === ',' || c === ';') && depth === 0) { parts.push(cur); cur = ''; if (c === ';') break; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

/** Collect binding names from one declarator ("a = 1", "{a, b: c}", "[x, ...r]"). */
function declaratorNames(decl) {
  let eq = -1, depth = 0, q = null;
  for (let i = 0; i < decl.length; i++) {           // first top-level '='
    const c = decl[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === '=' && depth === 0 && decl[i + 1] !== '=' && decl[i - 1] !== '!' &&
             decl[i - 1] !== '<' && decl[i - 1] !== '>' && decl[i - 1] !== '=') { eq = i; break; }
  }
  const target = (eq === -1 ? decl : decl.slice(0, eq)).trim();
  if (!target) return [];
  if (target[0] !== '{' && target[0] !== '[') {
    const m = /^([A-Za-z_$][\w$]*)/.exec(target);
    return m ? [m[1]] : [];
  }
  const names = [];
  const re = /([A-Za-z_$][\w$]*)\s*(:)?/g;
  let m;
  while ((m = re.exec(target))) {
    if (m[2]) continue;                             // "b: c" -> b is an object key
    if (m[1] === 'true' || m[1] === 'false') continue;
    names.push(m[1]);
  }
  return names;
}

/** Map top-level name -> hoisted? for everything a region declares.
 *  hoisted=true means function/class: safe to call before its region runs. */
function extractDeclarations(raw) {
  const out = new Map();
  const src = maskLiterals(raw);
  for (const line of src.split('\n')) {
    let m;
    if ((m = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(line))) { out.set(m[1], true); continue; }
    if ((m = /^class\s+([A-Za-z_$][\w$]*)/.exec(line))) { out.set(m[1], true); continue; }
    if ((m = /^(?:var|let|const)\s+(.+)/.exec(line))) {
      for (const decl of splitTopLevel(m[1])) for (const n of declaratorNames(decl)) out.set(n, false);
    }
  }
  return out;
}

/* ------------------------------------------------------- 1. base line map */

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
info(`manifest: ${manifest.length} regions`);

const lines = new Map();
for (const raw of readFileSync(LOOSE, 'utf8').split('\n')) {
  if (!raw) continue;
  const tab = raw.indexOf('\t');
  lines.set(Number(raw.slice(0, tab)), raw.slice(tab + 1));
}

let max = 0;
const regionIndex = new Map();   // region name -> entry
const thunkToRegion = new Map(); // init_xxx -> region name
for (const e of manifest) {
  if (regionIndex.has(e.region)) warn(`duplicate region name in manifest: ${e.region}`);
  regionIndex.set(e.region, e);
  const rows = normalizeSlice(e);

  // Guard the silent-corruption failure mode of the line-number merge: if a
  // slice gains/loses lines, the excess is either dropped or it overruns its
  // neighbours, while the byte delta can still read 0 and `node --check` still
  // passes. Never edit a slice's line count without updating manifest.json.
  if (rows.length !== e.body_lines) {
    fail(`line-count drift in ${e.region}: slice has ${rows.length} line(s), manifest says ${e.body_lines}`
      + ` (expected bundle lines ${e.start_line + 1}..${e.start_line + e.body_lines})`);
  }
  if (rows.length + 2 !== e.end_line - e.start_line + 1) {
    fail(`span mismatch in ${e.region}: ${rows.length} body line(s) do not fill ${e.start_line}..${e.end_line}`);
  }
  for (const line of rows) {
    const m = /^var (init_[A-Za-z0-9_$]+) = __esmMin/.exec(line);
    if (m) thunkToRegion.set(m[1], e.region);
  }

  lines.set(e.start_line, `//#region ${e.region}`);
  rows.forEach((r, i) => lines.set(e.start_line + 1 + i, r));
  lines.set(e.end_line, `//#endregion`);
  max = Math.max(max, e.end_line);
}

const baseLines = [];
for (let i = 1; i <= max; i++) baseLines.push(lines.get(i) ?? '');
const baseBuf = Buffer.from(baseLines.join('\n') + '\n');
const baseSha = sha(baseBuf);

/* ------------------------------------------ 2. name index (aggregate pass) */

function buildNameIndex() {
  const idx = new Map();   // name -> { region, endLine, hoisted, thunk }
  for (const e of manifest) {
    const rows = normalizeSlice(e);
    const decls = extractDeclarations(rows.join('\n'));
    let thunk = null;
    for (const line of rows) {
      const m = /^var (init_[A-Za-z0-9_$]+) = __esmMin/.exec(line);
      if (m) thunk = m[1];
    }
    for (const [n, hoisted] of decls) {
      idx.set(n, { region: e.region, endLine: e.end_line, hoisted, thunk }); // later regions win
    }
  }
  return idx;
}
let nameIndexCache = null;
const nameIndex = () => (nameIndexCache ??= buildNameIndex());

/* --------------------------------------------------- 3. reference resolve */

/** Candidate reference bundles. When several exist (e.g. reference/ holds both
 *  the pristine and a rebranded artifact) we pick the one the rebuilt base is
 *  actually identical to, so the byte check stays meaningful in every tree. */
function referenceCandidates() {
  const explicit = opt('--ref', null);
  const out = [];
  if (explicit) out.push(resolve(ROOT, explicit));
  const dir = join(ROOT, 'reference');
  if (existsSync(dir)) {
    try {
      for (const f of readdirSync(dir).sort()) if (/\.mjs$/.test(f)) out.push(join(dir, f));
    } catch { /* ignore */ }
  }
  for (const c of [join(ROOT, 'pristine-index.mjs'), join(ROOT, 'dist', 'index.mjs.ref')]) {
    if (existsSync(c)) out.push(c);
  }
  return [...new Set(out)];
}

function resolveRef() {
  const explicit = opt('--ref', null);
  const cands = [];
  const skipped = [];
  for (const c of referenceCandidates()) {
    if (!existsSync(c)) { skipped.push(`${relative(ROOT, c)} (absent)`); continue; }
    if (existsSync(OUT) && realpathSync(c) === realpathSync(OUT)) {
      warn(`ignoring reference ${relative(ROOT, c)}: it is the output file (byte check would be tautological)`);
      skipped.push(`${relative(ROOT, c)} (is the output)`);
      continue;
    }
    cands.push(c);
  }

  if (explicit) {
    const p = resolve(ROOT, explicit);
    if (cands.includes(p)) return p;
    // an explicit --ref that does not match will be reported as a diff, which is
    // the honest outcome; only fall through when the file is unusable.
    if (existsSync(p) && !(existsSync(OUT) && realpathSync(p) === realpathSync(OUT))) return p;
    warn(`--ref ${explicit} is unusable; falling back to auto-detection`);
  }
  if (!cands.length) {
    warn(`no reference bundle found; looked at: ${skipped.join(', ') || '(nothing)'}`);
    return null;
  }
  // prefer a candidate the base is byte-identical to, then one matching a known
  // profile, then the first - so the check is exact wherever possible.
  const withSha = cands.map((p) => ({ p, sha: sha(readFileSync(p)) }));
  const exact = withSha.find((c) => c.sha === baseSha);
  if (exact) return exact.p;
  const profiled = withSha.find((c) => Object.values(PROFILES).some((v) => v.sha256 === c.sha));
  return (profiled ?? withSha[0]).p;
}

const REF = resolveRef();
let refOk = null;
let refProfile = null;
let refSha = null;
let refDiff = null;

if (REF) {
  const ref = readFileSync(REF);
  refSha = sha(ref);

  // A reference that silently changes (e.g. gets rebranded) would silently move
  // the "byte-exact" goalpost. Stamp it and refuse to trust a changed one.
  if (existsSync(STAMP)) {
    try {
      const st = JSON.parse(readFileSync(STAMP, 'utf8'));
      if (st.refSha && st.refPath === relative(ROOT, REF) && st.refSha !== refSha) {
        fail(`reference ${relative(ROOT, REF)} changed since the last verified build`
          + ` (stamped ${st.refSha.slice(0, 12)}, now ${refSha.slice(0, 12)}).`
          + ` Re-verify deliberately, then delete ${relative(ROOT, STAMP)}.`);
      }
    } catch { /* unreadable stamp: ignore */ }
  }

  for (const [k, v] of Object.entries(PROFILES)) if (v.sha256 === refSha) refProfile = k;
  info(`reference: ${relative(ROOT, REF)} (${ref.length} bytes, sha256 ${refSha.slice(0, 12)}`
    + (refProfile ? `, profile "${refProfile}" - ${PROFILES[refProfile].note}` : ', unknown profile') + ')');

  refOk = ref.length === baseBuf.length && ref.equals(baseBuf);
  if (refOk) info(`base reproduction: BYTE-EXACT (sha256 ${baseSha.slice(0, 12)})`);
  else {
    let d = -1; const n = Math.min(ref.length, baseBuf.length);
    for (let i = 0; i < n; i++) if (ref[i] !== baseBuf[i]) { d = i; break; }
    if (d === -1) d = n;
    refDiff = { d, line: baseBuf.subarray(0, d).toString('utf8').split('\n').length };
  }
} else {
  warn('no reference bundle to compare against (see --ref in README-BUILD.md)');
}

// A hash assertion proves *which* tree was rebuilt, which is stronger than
// "differs from pristine by N bytes" when the tree is intentionally rebranded.
// Matching a hardcoded profile hash is itself proof of identity: the tree is
// byte-for-byte that known artifact.
const baseProfileName = Object.entries(PROFILES).find(([, v]) => v.sha256 === baseSha)?.[0] ?? null;
const profileAsserted = PROFILE !== 'auto' && PROFILES[PROFILE]?.sha256 === baseSha;
const shaAsserted = Boolean(EXPECT_SHA) && baseSha === EXPECT_SHA;
const baseProven = refOk === true || baseProfileName !== null || shaAsserted;
if (baseProfileName) info(`base profile: "${baseProfileName}" - ${PROFILES[baseProfileName].note}`);

if (refOk === false) {
  if (baseProfileName || shaAsserted) {
    info(`base differs from ${relative(ROOT, REF)} at byte ${refDiff.d} (line ~${refDiff.line}) - expected:`
      + ` this tree is "${baseProfileName ?? 'custom'}" (sha256 ${baseSha.slice(0, 12)}), not the reference.`);
  } else {
    fail(`base reproduction DIFFERS from reference at byte ${refDiff.d} (line ~${refDiff.line}):`
      + ` built ${baseBuf.length} bytes (reference was ${refDiff.d === 0 ? 'same length' : 'a different length'}) - a slice was edited.`
      + ` If this tree is intentionally modified (rebranded), its hash must be asserted`
      + ` (--expect-sha ${baseSha}) or added to PROFILES in this script.`);
  }
}
if (!baseProven) warn('base identity not proven: no reference, no known profile, no --expect-sha');

// --base-profile / --expect-sha: assert which tree we are actually building.
if (PROFILE !== 'auto') {
  const p = PROFILES[PROFILE];
  if (!p) fail(`unknown --base-profile "${PROFILE}" (known: ${Object.keys(PROFILES).join(', ')})`);
  else if (baseSha !== p.sha256) {
    fail(`--base-profile ${PROFILE} expects base sha256 ${p.sha256.slice(0, 12)}, got ${baseSha.slice(0, 12)}`
      + ` (${baseBuf.length} bytes vs expected ${p.size}) - wrong tree, or a slice was edited`);
  } else info(`--base-profile ${PROFILE}: base sha256 matches`);
}
if (EXPECT_SHA && baseSha !== EXPECT_SHA) {
  fail(`--expect-sha ${EXPECT_SHA.slice(0, 12)} does not match built base ${baseSha.slice(0, 12)}`);
}
if (!REF && EXPECT_BASE.length && !EXPECT_BASE.includes(baseBuf.length)) {
  fail(`base is ${baseBuf.length} bytes, expected one of ${EXPECT_BASE.join(' / ')}`
    + ` - a slice was edited, or pass --expect-base <sizes>`);
}

/* ------------------------------------------------------ 4. --suggest-insert */

if (SUGGEST) {
  const p = resolve(ROOT, SUGGEST);
  if (!existsSync(p)) { fail(`--suggest-insert: file not found ${SUGGEST}`); process.exit(1); }
  let src = readFileSync(p, 'utf8');
  if (/\.ts$/.test(p)) {
    try { src = (await import('node:module')).stripTypeScriptTypes(src, { mode: 'strip' }); }
    catch { /* plain js */ }
  }

  const declared = extractDeclarations(src);
  // also collect *nested* declarations (e.g. `const log = ...` inside a
  // function) so self-references are not mistaken for bundle names.
  {
    const reNested = /(?:^|[;{}()\s,])(?:const|let|var|function|class)\s*\*?\s*([A-Za-z_$][\w$]*)/g;
    const masked = maskLiterals(src);
    let mm;
    while ((mm = reNested.exec(masked))) declared.set(mm[1], true);
  }
  const idx = nameIndex();
  const refs = new Map();
  const scan = maskLiterals(src);
  const re = /([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(scan))) {
    const n = m[1];
    if (/[.\w$]$/.test(scan.slice(Math.max(0, m.index - 2), m.index))) continue;  // property access / longer word
    if (/^\s*:/.test(scan.slice(m.index + n.length))) continue;                   // object key or label
    if (KEYWORDS.has(n) || GLOBALS.has(n) || declared.has(n)) continue;
    if (!idx.has(n)) continue;
    const hit = idx.get(n);
    const prev = refs.get(n);
    if (!prev || hit.endLine > prev.endLine) refs.set(n, hit);
  }

  console.log(`[build] --suggest-insert ${relative(ROOT, p)}`);
  console.log(`  declared here: ${declared.size ? [...declared.keys()].join(', ') : '(none)'}`);
  if (!refs.size) {
    console.log('  no reference to any bundle top-level name -> "insert": "end" is fine.');
    process.exit(errors ? 1 : 0);
  }
  console.log(`  bundle names referenced (${refs.size}):`);
  for (const [n, h] of [...refs].sort((a, b) => a[1].endLine - b[1].endLine)) {
    const kind = h.hoisted ? 'function/class (hoisted)' : 'value binding';
    console.log(`    ${n.padEnd(24)} ${kind.padEnd(24)} ${h.region}  ends ${h.endLine}`
      + `${h.thunk ? `  [${h.thunk}]` : ''}`);
  }
  const values = [...refs].filter(([, h]) => !h.hoisted);
  const latest = (values.length ? values : [...refs]).sort((a, b) => b[1].endLine - a[1].endLine)[0];
  const needed = [...new Set(values.filter(([, h]) => h.thunk).map(([, h]) => h.thunk.replace(/^init_/, '')))];
  console.log('');
  if (!values.length) {
    console.log('  every referenced name is a hoisted function/class -> position is free.');
    console.log(`  suggested: "insert": "after:${latest[1].region}"   (or "before:src/index.ts" to run at startup)`);
  } else {
    console.log(`  latest value binding used: ${latest[0]} (${latest[1].region})`);
    console.log(`  suggested: "insert": "after:${latest[1].region}"   (bundle line ${latest[1].endLine + 1})`);
  }
  if (needed.length) console.log(`  suggested: "after_inits": ${JSON.stringify(needed)}`);
  console.log('  note: advisory - use "before:src/index.ts" if the module must run during startup.');
  process.exit(errors ? 1 : 0);
}

if (VERIFY_ONLY) {
  info(`verify-base: built ${baseBuf.length} bytes, ${max} lines${refOk === true ? ', BYTE-EXACT' : ''}`);
  process.exit(errors ? 1 : 0);
}

/* ------------------------------------------------------ 5. splice new files */

const EXTRA = resolve(ROOT, opt('--extra', EXTRA_DEFAULT));
if (!BASE_ONLY && !existsSync(EXTRA)) info(`no ${relative(ROOT, EXTRA)} - building base only`);
const extra = (BASE_ONLY || !existsSync(EXTRA)) ? {} : JSON.parse(readFileSync(EXTRA, 'utf8'));
// accept a couple of key spellings so hand-written configs are not a trap
const extraRegions = extra.regions ?? extra.modules ?? [];

function resolveInsert(spec) {
  const s = typeof spec === 'string' ? spec : spec?.insert;
  if (!s || s === 'end') return max + 1;
  let m;
  if ((m = /^before:(.+)$/.exec(s))) {
    const e = regionIndex.get(m[1]);
    if (!e) throw new Error(`insert "before:${m[1]}" - unknown region`);
    return e.start_line;
  }
  if ((m = /^after:(.+)$/.exec(s))) {
    const e = regionIndex.get(m[1]);
    if (!e) throw new Error(`insert "after:${m[1]}" - unknown region`);
    return e.end_line + 1;
  }
  if ((m = /^line:(\d+)$/.exec(s))) return Number(m[1]);
  if (/^\d+$/.test(s)) return Number(s);
  throw new Error(`bad insert spec: ${JSON.stringify(s)} - use end | before:<region> | after:<region> | line:<N>`);
}

const modeOf = (r) => r.mode ?? 'run';
const idOf = (r) => r.id ?? r.region ?? r.out ?? r.file;   // `region` gives the nicest init_ name
const initOf = (id) => 'init_' + String(id).replace(/[^A-Za-z0-9_]/g, '_');

const baseNames = new Set(nameIndex().keys());
const baseThunks = new Set(thunkToRegion.keys());
const newNames = new Map();     // top-level name -> region id
const newInits = new Map();     // init_xxx -> region id
const declaredIds = new Set(extraRegions.map(idOf).filter(Boolean));
const spliced = [];

for (const r of extraRegions) {
  const id = idOf(r);
  const file = r.file ?? r.out;
  if (!id || !file) { fail('extra region needs "id" (or "out") and "file"'); continue; }
  if (r.enabled === false) { info(`skip (disabled): ${id}`); continue; }

  const abs = join(ROOT, file);
  if (!existsSync(abs)) { fail(`extra region ${id}: file not found "${file}"`); continue; }

  let src = readFileSync(abs, 'utf8');
  if (/\.ts$/.test(file)) {
    try {
      const { stripTypeScriptTypes } = await import('node:module');
      if (typeof stripTypeScriptTypes === 'function') src = stripTypeScriptTypes(src, { mode: 'strip' });
    } catch { /* node <22.13: assume the file is already plain JS */ }
  }
  src = src.replace(/\s+$/, '');

  // New files end with a bare `export {}` only to look like modules to editors;
  // the bundle has zero export statements, so drop it. Anything else is a real
  // ESM export, which cannot exist in a single flat scope.
  src = src.replace(/\n?export \{\s*\};\s*$/, '');
  const stray = src.split('\n').findIndex((l) => /^\s*export\b/.test(l));
  if (stray !== -1 && modeOf(r) !== 'inline') {
    fail(`extra region ${id}: real ESM exports are impossible here - the bundle is ONE flat scope`
      + ` with zero export statements (line ${stray + 1}: ${src.split('\n')[stray].trim()}).`
      + ` Drop the export and call the name directly, or use "mode": "inline".`);
  }
  const topImport = src.split('\n').findIndex((l) => /^\s*import\b/.test(l));
  if (topImport !== -1 && modeOf(r) !== 'inline') {
    fail(`extra region ${id}: a new module cannot have its own imports (line ${topImport + 1}:`
      + ` ${src.split('\n')[topImport].trim()}). The bundle hoists every import into one flat scope -`
      + ` use the already-hoisted bindings (fs, path, crypto$1, ...) directly.`);
  }

  // collision guard: one flat scope for all 467 regions, so a duplicate
  // top-level name silently shadows (or is shadowed by) existing code.
  for (const [n] of extractDeclarations(src)) {
    if (baseNames.has(n)) fail(`extra region ${id}: top-level name "${n}" is already declared in the bundle (one flat scope)`);
    if (newNames.has(n)) fail(`extra region ${id}: top-level name "${n}" is also declared by ${newNames.get(n)}`);
    newNames.set(n, id);
  }

  const initName = r.init ?? initOf(id);
  if (r.init && (baseThunks.has(initName) || newInits.has(initName))) {
    fail(`extra region ${id}: init name "${initName}" collides with an existing thunk`);
  }
  newInits.set(initName, id);

  const mode = modeOf(r);                        // run | lazy | inline
  const head = [];
  for (const d of r.deps ?? []) {
    if (regionIndex.has(d)) continue;              // existing region: `insert` already places us
    if (!declaredIds.has(d)) {
      fail(`extra region ${id}: dep "${d}" is neither an existing region nor a declared new module`);
      continue;
    }
    head.push(`${initOf(d)}();`);
  }
  for (const t of r.after_inits ?? []) {         // EXISTING regions' init_* thunks
    const name = t.startsWith('init_') ? t : `init_${t}`;
    if (!baseThunks.has(name)) {
      fail(`extra region ${id}: after_inits "${t}" - no such thunk in the bundle (only ${baseThunks.size}`
        + ` regions declare an init_* thunk; for the rest, order is implied by the insertion point)`);
      continue;
    }
    head.push(`${name}();`);
  }

  const body = src.split('\n').map((l) => (l.length ? '\t' + l : l)).join('\n');
  let block;
  if (mode === 'inline') {
    block = src;
  } else {
    block = [`var ${initName} = __esmMin((() => {`, body, `}));`,
      ...(mode === 'run' ? [`${initName}();`] : [])].join('\n');
  }

  let pos;
  try { pos = resolveInsert(r); }
  catch (err) { fail(`extra region ${id}: ${err.message}`); continue; }

  spliced.push({ pos, id, text: [`//#region ${r.label ?? r.region ?? id}`, ...head, block, '//#endregion'].join('\n') });
}

/* ------------------------------------------------------------- 6. assemble */

spliced.sort((a, b) => a.pos - b.pos);
const outLines = [];
for (let i = 1; i <= max; i++) {
  for (const s of spliced) if (s.pos === i) outLines.push(s.text);
  outLines.push(baseLines[i - 1]);
}
for (const s of spliced) if (s.pos > max) outLines.push(s.text);

let text = outLines.join('\n') + '\n';
if (flag('--banner')) {
  text = `// GENERATED by scripts/build.mjs - 467 base regions byte-faithful`
    + ` + ${spliced.length} new module(s)\n` + text;
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, text);

// stamp the verified reference, so a later silent edit is caught
if (REF && refOk !== false) {
  try {
    mkdirSync(dirname(STAMP), { recursive: true });
    writeFileSync(STAMP, JSON.stringify({
      refPath: relative(ROOT, REF), refSha, baseSha, profile: refProfile, at: new Date().toISOString(),
    }, null, 2) + '\n');
  } catch { /* stamp is best-effort */ }
}

/* ----------------------------------------------------------- 7. report out */

const bytes = statSync(OUT).size;
info(`wrote ${relative(ROOT, OUT)}`);
info(`  ${bytes} bytes, ${text.split('\n').length - 1} lines`);
info(`  base ${baseBuf.length} bytes (sha256 ${baseSha.slice(0, 12)}) + ${spliced.length} new region(s) -> delta ${bytes - baseBuf.length}`);
for (const s of spliced) info(`  + ${s.id} @ bundle line ${s.pos}`);

if (!flag('--no-check')) {
  try { execFileSync('node', ['--check', OUT], { stdio: 'pipe' }); info('node --check: syntax OK'); }
  catch (e) { fail(`node --check failed:\n${e.stderr?.toString().split('\n').slice(0, 12).join('\n')}`); }
}

// STRICT: a base that is neither byte-exact nor identity-proven means a slice
// may have been edited silently - the exact failure mode this script exists to
// catch. Override with --no-strict once the new identity is asserted.
if (STRICT && !baseProven) fail('base identity not proven - aborting (use --no-strict to override)');
process.exit(errors ? 1 : 0);
