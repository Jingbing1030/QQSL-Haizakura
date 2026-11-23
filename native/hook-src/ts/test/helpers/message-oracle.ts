// Builds the message region's codec closure as an in-memory ES module.
//
// ---------------------------------------------------------------------------
// Why this exists in `test/` rather than in `work/`
// ---------------------------------------------------------------------------
// `work/` is gitignored (see .gitignore — those dirs hold 12 MB of reverse-engineering
// intermediates). `reference/index.mjs` IS tracked. A golden-bytes oracle living under
// `work/` therefore would not survive a fresh checkout, and every differential test using
// it would silently skip — which is the worst outcome: the suite stays green while the
// comparisons stop running.
//
// So this module reproduces the extraction at test time from the tracked reference. The
// offline version used while authoring (`work/bridge-message/build-ref.mjs`) is the same
// algorithm; this file is the one that ships.
//
// ---------------------------------------------------------------------------
// What it extracts
// ---------------------------------------------------------------------------
// The region cannot be imported whole: it opens with `init_logger()` and declares
// `MessageApi`, both of which reference the rest of the bundle. So this pulls only the
// functions the codec roots transitively call, plus the per-file helper declarations those
// functions read.
//
// Two subtleties that each broke an earlier attempt:
//
//   1. **The dependency walk must follow EVERY identifier call, not just `protobuf_*` and
//      `__*`.** The dataline codec calls plain-named helpers (`appIdForTerType`,
//      `findDatalineDeviceByTerType`) that a prefixed walk misses, and the failure is a
//      `ReferenceError` at call time rather than at extraction time.
//
//   2. **Per-file `var` helpers are named `<stem>$<N>` and are not called.** `__utf8Len$85`
//      reads `__nonAscii$85` and `__utf8Scratch$85`, which nothing calls and which a
//      call-following walk therefore never sees. They are found by suffix: for each $N that
//      appears among the pulled functions, admit the matching `var` declarations.
//
// A third attempt's mistake is worth recording because it is easy to repeat: sweeping ALL
// `var` lines re-admitted `DATALINE_DEVICES`, whose value spans multiple lines, and the
// concatenation produced a syntax error. Only single-line declarations are admitted.

import { readFileSync } from "node:fs";

/** The roots the bridge's send path and history path reach. */
const ROOTS = [
  // Send path (message region).
  "protobuf_encode_SendMessageRequest__SendRichText",
  "protobuf_encode_SendMessageRequest__bytes",
  "protobuf_encode_C2CRecallRequest",
  "protobuf_encode_GroupRecallRequest",
  "protobuf_encode_FileExtra",
  "protobuf_encode_SsoReadedReportReq",
  "protobuf_decode_SendMessageResponse",
  "protobuf_decode_SsoReadedReportResp",
  // History request builders (the two satellite regions).
  "protobuf_encode_SsoGetGroupMsg",
  "protobuf_encode_SsoGetC2cMsg$1",
  "protobuf_encode_SsoGetRoamMsg",
  "protobuf_decode_SsoGetGroupMsgResponse",
  "protobuf_decode_SsoGetC2cMsgResponse$1",
  "protobuf_decode_SsoGetRoamMsgResponse",
  // The dataline codec, a separate region entirely.
  "protobuf_encode_DatalineTextMsg",
  "protobuf_encode_DatalineMsgBody",
  "protobuf_decode_DatalineMsgBody",
  "encodeDatalineText",
  // The elem encoder, so the envelope comparison can be made on identical inputs.
  "protobuf_encode_Elem",
];

/** Declarations the codecs read but do not define. */
const CONSTANTS = [
  "var __td$19 = new TextDecoder();",
  "var __te$21 = new TextEncoder();",
  "var __pool$21;",
  "var __poolOffset$21 = 0;",
  "var textEncoder = new TextEncoder();",
  "var textDecoder = new TextDecoder();",
];

/** `<stem>$N` helpers, which are matched by suffix rather than by name. */
const SUFFIXED_VAR = /^var __(?:nonAscii|utf8Scratch|tdStrict|td|te)\$\d+\s*(?:=|;)/;
/** Fixed single-line constants the dataline codec reads. These carry no `$N`. */
const DATALINE_VAR = /^var DATALINE_(?:SUBCMD|GENERIC|TEXT)_[A-Z]+ = /;

/** Locate a function's full body by brace matching from its declaration line. */
function bodyAt(lines: readonly string[], start: number): { text: string; end: number } | null {
  let depth = 0;
  let started = false;
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i]!;
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    if (depth > 0) started = true;
    if (started && depth <= 0) return { text: lines.slice(start, i + 1).join("\n"), end: i };
  }
  return null;
}

/**
 * Build the oracle module's source text.
 *
 * Exported for the test's own diagnostics, and because it is the only way to assert that
 * extraction found every root without booting a module.
 */
export function buildOracleSource(referenceSource: string): { source: string; functions: string[]; missing: string[] } {
  const lines = referenceSource.split("\n");

  // Index every function in the whole bundle, first definition wins except that a
  // region-local definition overrides a bundle-wide one of the same name. The "$N"
  // suffixed names are distinct keys, which is exactly what is wanted: the caller picks
  // the copy by the name the spec's `encode =` line uses (MEMORY.md §2.3ab).
  const byName = new Map<string, string>();
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(?:async )?function ([\w$]+)\(/.exec(lines[i]!);
    if (!match) continue;
    const body = bodyAt(lines, i);
    if (body === null) continue;
    if (!byName.has(match[1]!)) byName.set(match[1]!, body.text);
    i = body.end;
  }

  const picked: string[] = [];
  const seen = new Set<string>();
  const missing: string[] = [];
  const stack = [...ROOTS];
  while (stack.length > 0) {
    const name = stack.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const text = byName.get(name);
    if (text === undefined) {
      missing.push(name);
      continue;
    }
    picked.push(text);
    for (const call of text.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const callee = call[1]!;
      // Skip JS keywords that look like calls (`if (`, `for (`, `switch (`).
      if (KEYWORDS.has(callee) || seen.has(callee) || !byName.has(callee)) continue;
      stack.push(callee);
    }
  }

  // Admit the single-line declarations: the fixed constants, plus every `<stem>$N` helper
  // whose suffix belongs to a pulled function.
  const suffixes = new Set<string>();
  for (const name of seen) {
    const match = /\$(\d+)$/.exec(name);
    if (match) suffixes.add(match[1]!);
  }
  const declarations = CONSTANTS.filter((decl) => {
    const name = /(?:function|var) ([\w$]+)/.exec(decl)?.[1];
    return name === undefined || !seen.has(name);
  });
  // Two independent filters, because the two families are keyed differently: the `$N`
  // helpers are selected by suffix, the DATALINE constants by name.
  const suffixDecls = lines.filter((line) => {
    if (DATALINE_VAR.test(line)) return true;
    if (!SUFFIXED_VAR.test(line)) return false;
    const match = /\$(\d+)/.exec(line);
    return match !== null && suffixes.has(match[1]!);
  });

  const exported = [...ROOTS, "__utf8Len$21", "__utf8Write$21", "__allocate$21"].filter((name) => seen.has(name));
  const source = [
    "// Generated by ts/test/helpers/message-oracle.ts -- not source.",
    ...declarations,
    ...suffixDecls,
    ...picked,
    "export {",
    exported.map((name) => `  ${name},`).join("\n"),
    "};",
    "",
  ].join("\n");

  return { source, functions: picked, missing };
}

const KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "function",
  "typeof",
  "await",
  "new",
  "do",
  "else",
  "with",
  "delete",
  "void",
  "throw",
  "super",
  "constructor",
]);

/** Load the oracle from a reference source file. Throws if a root is missing. */
export async function loadOracle(referencePath: string): Promise<Record<string, (...args: never[]) => Uint8Array>> {
  const { source, missing } = buildOracleSource(readFileSync(referencePath, "utf8"));
  if (missing.length > 0) throw new Error(`oracle extraction missed ${missing.length} root(s): ${missing.join(", ")}`);
  // A data-URL import keeps the module independent of the filesystem, so the same text can
  // be built and evaluated without writing a temporary file (and without the risk of a
  // stale temp file from a previous run being reused).
  const url = `data:text/javascript;base64,${Buffer.from(source, "utf8").toString("base64")}`;
  return (await import(url)) as Record<string, (...args: never[]) => Uint8Array>;
}