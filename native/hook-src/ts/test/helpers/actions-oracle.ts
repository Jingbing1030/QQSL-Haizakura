// An oracle built from the committed reference bundle at test time.
//
// ---------------------------------------------------------------------------
// Why this exists, and why it is not under work/
// ---------------------------------------------------------------------------
// The task requires the action tests to be measured against
// `reference/index.mjs` rather than against my reading of it. The bundle is one
// 374k-line ESM file with no exports, so the only way to execute its action
// definitions is to slice out the regions that define them and evaluate them.
//
// It must live under `ts/test/helpers/`, NOT under `work/`: `.gitignore` excludes
// `work/`, and a test whose oracle silently disappears in a fresh checkout degrades
// into a test that asserts nothing. `message-oracle.ts` in this directory already
// solved the same problem and its header explains the constraint; this file follows
// that pattern.
//
// ---------------------------------------------------------------------------
// How the slice is chosen
// ---------------------------------------------------------------------------
// The bundle is a concatenation of `//#region <original path>` blocks. Each action
// module is exactly one region, and regions appear in dependency order, so a fixed
// list of region paths is enough to bring in the action definitions plus the helpers
// they need (`action-kit.ts` for `defineAction`/`f`, `types.ts` for `RETCODE` and
// the envelopes, the `*-result-schemas.ts` files because the action literals
// reference them).
//
// Two initialisation calls sit inside the sliced regions but belong to modules
// outside them (`init_logger()`, `init_log_summary()`). They are stripped, and a
// PRELUDE supplies the small number of globals the sliced code references at
// definition time. The PRELUDE values are copied from the bundle itself — not
// invented — and each one is annotated with where it came from.
//
// ---------------------------------------------------------------------------
// What the oracle proves, and what it does not
// ---------------------------------------------------------------------------
// It proves the *response shape and wording* of an action for a given `ctx` and
// params: the action's `parse` and `run` are the bundle's own code, so comparing my
// implementation's output against the oracle's is a real measurement.
//
// It does NOT prove wire behaviour: `run` bodies that call `ctx.bridge.apis.*` are
// exercised against the same fake context on both sides, so both sides agree by
// construction about the bridge. What is being compared is the part I wrote — the
// params schema, the routing, the response assembly and the failure wording.

import { createHash as createHashFn } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile as readFileImpl } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the bundle from either the source tree (`ts/test/helpers/`) or the compiled
 * tree (`ts/build/test/helpers/`).
 *
 * The depth differs by one, and hard-coding either one makes the oracle vanish —
 * silently turning every comparison into a no-op — in the layout the tests are not
 * run from. So the candidate list is tried in order and a miss is a hard error.
 *
 * This is the same trap the task's brief warns about for `work/`: an oracle that
 * cannot be found must FAIL, never skip.
 */
function findReference(): string {
  const candidates = [
    join(HERE, "..", "..", "..", "reference", "index.mjs"), // ts/test/helpers → repo
    join(HERE, "..", "..", "..", "..", "reference", "index.mjs"), // ts/build/test/helpers → repo
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `reference bundle not found; tried:
  ${candidates.join("\n  ")}
` +
      "The action tests compare against reference/index.mjs and must not skip when it is absent.",
  );
}

const REFERENCE_PATH = findReference();

/**
 * The regions the five action families live in, in the bundle's own order.
 *
 * The two `actions/*-schema.ts` entries are not actions; they are here because the
 * action literals reference their constants (`messageIdSchema` etc.) while the
 * region is being evaluated.
 */
const REGIONS = [
  "../onebot/src/types.ts",
  "../onebot/src/action-kit.ts",
  "../onebot/src/actions/info.ts",
  "../onebot/src/action-result-schemas.ts",
  "../onebot/src/actions/message.ts",
  "../onebot/src/actions/contact-profile-schema.ts",
  "../onebot/src/actions/friend.ts",
  "../onebot/src/actions/group-info.ts",
  "../onebot/src/actions/group-admin.ts",
  // `请求` action family: set_friend_add_request and set_group_add_request.
  "../onebot/src/actions/request.ts",
  "../onebot/src/actions/qzone.ts",
  "../onebot/src/actions/qzone-public.ts",
  "../onebot/src/actions/stream-file.ts",
  "../onebot/src/actions/stream-download.ts",
  // QQ system-face directory actions.
  "../onebot/src/actions/system-face.ts",
  // 4.5 — the 擴展 family. Four extra regions are needed beyond its own:
  //   `message-id.ts`            — DOWNLOAD_FILE_MAX_BYTES is defined there
  //   `web/friend-dress.ts`      — `_get_friend_dress` references `FriendDressError`
  //   `action-result-schemas.ts` — already above, reused for the essence schemas
  // Four extra regions are needed beyond the family's own, all because a `run` body
  // calls a free function rather than a `ctx` member:
  //   `common/hex.ts`            — `send_packet` calls `fromHex`/`toHex`
  //   `protocol/qq-info.ts`      — `formatGroupRequestFlag` (a free function, not the
  //                                action-layer copy in `ts/src/onebot/actions/format.ts`)
  //   `onebot/message-id.ts`     — `hashMessageIdInt32`, `hasAuthoritativeSequence`
  //   `protocol/web/friend-dress.ts` — `FriendDressError`, referenced by `_get_friend_dress`
  // Ordering follows the bundle's own so `var`-less function hoisting still works.
  "../common/src/hex.ts",
  "../common/src/concurrency.ts",
  "../protocol/src/qq-info.ts",
  "../onebot/src/message-id.ts",
  "../protocol/src/web/friend-dress.ts",
  "../onebot/src/actions/extended.ts",
  // 4.3b — 群文件 and 群相册. Both regions need NOTHING beyond `types.ts` and
  // `action-kit.ts`: measured by extracting each region's identifiers and testing
  // which of them the base regions do not define. `group-file.ts` uses only
  // `f$1`, `defineAction`, `groupAction`, `okResponse`, `failedResponse`,
  // `RETCODE`, and its own local `busidOr102`. `group-album.ts` uses only `f$1`,
  // `groupAction`, `okResponse` and its own four schema constants
  // (`albumCoverUrlSchema`, `albumCoverSchema`, `mediaUrlSchema`,
  // `mediaPhotoUrlsSchema`, `mediaImageSchema`, `albumMediaSchema`), which are
  // `var`s declared INSIDE the region. So no extra region is pulled in, and in
  // particular the album region does NOT reach `GroupAlbumApi` — the action bodies
  // go through `ctx.bridge.apis.groupAlbum`, exactly like every other family.
  "../onebot/src/actions/group-file.ts",
  "../onebot/src/actions/group-album.ts",
  // 4.3b — `getGroupFiles`, the formatter the two listing actions reach. It is NOT
  // in the group-file action region: it lives in `modules/contact-actions.ts`
  // (reference:39317-39759) and is bound to `ctx.getGroupFiles` by
  // `buildApiContext` (reference:40056). Pulling the region in is what lets the
  // formatter be tested DIFFERENTIALLY instead of against a hand-written table.
  //
  // Evaluating the whole region is safe at definition time: the two identifiers it
  // uses but does not define (`formatFriend` in `getFriendList`, `findDatalineDeviceByUin`
  // in `getStrangerInfo`, plus `formatPublicProfile`) are only touched when those
  // functions are CALLED, and the oracle calls none of them.
  "../onebot/src/modules/contact-actions.ts",
] as const;

/**
 * Globals the sliced regions reference before anything defines them.
 *
 * Each is copied from the bundle, and the source line is given so a reader can
 * verify it rather than trusting this comment:
 *
 *   RETCODE            L6910  (types.ts)          — identical to ts/src/onebot/types.ts
 *   okResponse         L6916                       — `data = null` default is load-bearing
 *   failedResponse     L6923                       — key order status/retcode/data/wording
 *   WebHonorType       L8880  (group-info.ts)     — the five enum values, in order
 *   integerFromDecimalString L11260               — used by the group-info run bodies
 *   primitiveText      L11276                     — same
 *   createLogger       L6032                      — `get_status` etc. call it for a scoped logger
 *   init_logger/init_log_summary                  — stripped, they initialise real sinks
 */
const PRELUDE = `
var __noop = () => {};
var __logger = {
  trace: __noop, debug: __noop, info: __noop, warn: __noop, error: __noop,
  child: () => __logger,
};
var createLogger = () => __logger;
var RETCODE = { ACTION_FAILED: 100, INTERNAL_ERROR: 1200, BAD_REQUEST: 1400, UNKNOWN_ACTION: 1404 };
function okResponse(data = null) { return { status: "ok", retcode: 0, data }; }
function failedResponse(retcode, wording) { return { status: "failed", retcode, data: null, wording }; }
var APP_VERSION = "0.2.4.2";
var WebHonorType = {
  TALKATIVE: "talkative",
  PERFORMER: "performer",
  LEGEND: "legend",
  EMOTION: "emotion",
  ALL: "all",
};
function integerFromDecimalString(value) {
  if (value.trim() === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}
function primitiveText(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}
// request_decrypt_key calls readFile(p.db_path) -- a bare import in the bundle
// (import { readFile } from "node:fs/promises"). The oracle must supply it, or the
// region throws ReferenceError instead of returning the reference's own branches, and
// the test would compare "both threw" on a path the reference really implements.
// NOTE: this PRELUDE is a template literal, so it may contain no backticks or interpolation.
function readFile(path) {
  return readFileImpl(path);
}
function positiveIntEnv(name, def) {
  const v = process.env[name];
  if (!v) return def;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : def;
}
`;

/** Slice `//#region` blocks out of the bundle by their path markers. */
function extractRegions(source: string, wanted: readonly string[]): string {
  const lines = source.split("\n");
  const markers: Array<{ path: string; start: number; end: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^\/\/#region (.+)$/.exec(lines[i]!);
    if (match) markers.push({ path: match[1]!, start: i + 1, end: lines.length });
  }
  for (let i = 0; i < markers.length - 1; i++) markers[i]!.end = markers[i + 1]!.start - 1;

  const parts: string[] = [];
  for (const want of wanted) {
    const marker = markers.find((m) => m.path === want);
    if (!marker) throw new Error(`reference bundle has no region ${want}`);
    parts.push(lines.slice(marker.start - 1, marker.end).join("\n"));
  }
  return parts.join("\n");
}

export interface ReferenceAction {
  readonly kind: "normal" | "stream";
  readonly names: readonly string[];
  readonly params: Record<string, unknown>;
  parse(raw: Record<string, unknown>): { ok: boolean; value?: unknown; field?: string; reason?: string };
  toHandler(ctx: unknown): (params: Record<string, unknown>) => Promise<unknown>;
  describe(): Record<string, unknown>;
}

export interface OracleActions {
  info: ReferenceAction[];
  message: ReferenceAction[];
  friend: ReferenceAction[];
  groupInfo: ReferenceAction[];
  groupAdmin: ReferenceAction[];
  request: ReferenceAction[];
  qzone: ReferenceAction[];
  qzonePublic: ReferenceAction[];
  streamFile: ReferenceAction[];
  streamDownload: ReferenceAction[];
  systemFace: ReferenceAction[];
  /** 4.5 — the 擴展 family: 115 definitions, 121 executable names. */
  extended: ReferenceAction[];
  /** 4.3b — 群文件: 12 definitions, 12 executable names (no aliases). */
  groupFile: ReferenceAction[];
  /** 4.3b — 群相册: 9 definitions, 9 executable names (no aliases). */
  groupAlbum: ReferenceAction[];
  /** Every action across the loaded families, keyed by canonical name. */
  byName: Map<string, ReferenceAction>;
  /**
   * 4.3b — the reference bundle's own `getGroupFiles(bridge, groupId, folderId)`
   * from `../onebot/src/modules/contact-actions.ts` (reference:39476).
   *
   * It is NOT an action, which is why it sits beside `byName` rather than in a
   * family array. The two listing actions reach it through `ctx.getGroupFiles`, and
   * this handle is what lets `ts/test/group-file-actions.test.ts` compare the port's
   * formatter against the bundle's code for the same rows instead of against a table
   * somebody typed. `bridge` is duck-typed exactly as the bundle uses it: only
   * `apis.groupFile.list` is ever touched.
   */
  getGroupFiles(
    bridge: { apis: { groupFile: { list(groupId: number, folderId: string): Promise<unknown> } } },
    groupId: number,
    folderId: string | undefined,
  ): Promise<unknown>;
}

let cached: OracleActions | null = null;

/**
 * Evaluate the bundle's action regions and return the action arrays.
 *
 * The evaluation uses `new Function` rather than a `data:` module because the slice
 * contains `var` declarations that the bundle relies on sharing across regions. The
 * reference is only ever read, never written.
 *
 * A failure here is a hard error, not a skip: a skipped oracle means the test proves
 * nothing, which is precisely the failure mode the task warns about.
 */
export function loadActionOracle(): OracleActions {
  if (cached) return cached;
  const source = readFileSync(REFERENCE_PATH, "utf8");
  const body = extractRegions(source, REGIONS)
    // Real process-state initializers are irrelevant to action definitions.
    .replace(/^init_logger\(\);\n/gm, "")
    .replace(/^init_errors\(\);\n/gm, "")
    .replace(/^init_utils\(\);\n/gm, "")
    .replace(/^init_log_summary\(\);\n/gm, "")
    // `extended.ts` opens with `init_env()` (reference:11264), which initialises the
    // real env reader. Stripped for the same reason as the two log inits.
    .replace(/^init_env\(\);\n/gm, "");

  // `createHash` is injected rather than imported because `new Function` bodies have no
  // module scope. The bundle's own `message-id.ts` region calls it at MESSAGE time, not
  // definition time, but injecting it keeps the slice self-contained.
  const evaluate = new Function(
    "createHash",
    "readFileImpl",
    `${PRELUDE}\n${body}\n;return {
      info: actions$13,
      message: actions$12,
      friend: actions$11,
      groupInfo: actions$10,
      groupAdmin: actions$9,
      request: actions$7,
      qzone: actions$4,
      qzonePublic: actions$3,
      streamFile: actions$2,
      streamDownload: actions$1,
      systemFace: actions,
      extended: actions$6,
      groupFile: actions$8,
      groupAlbum: actions$5,
      getGroupFiles,
    };`,
  ) as (
    createHash: typeof createHashFn,
    readFile: (path: string) => Promise<Buffer>,
  ) => Omit<OracleActions, "byName" | "getGroupFiles"> & Pick<OracleActions, "getGroupFiles">;

  const raw = evaluate(createHashFn, (path: string) => readFileImpl(path));
  // EVERY name — canonical AND alias — maps to its action.
  //
  // This is what lets `registry: every port action exists in the reference` hold the
  // registry to the reference for aliases too. Registering only `names[0]` would make
  // that test vacuous for the 121-name extended family, whose six aliases
  // (`.ocr_image`, `nc_get_rkey`, `send_group_sign`, `.send_packet`,
  // `get_ptt_text`, `get_record_text`) are exactly the names a port is most likely to
  // misspell or drop.
  const byName = new Map<string, ReferenceAction>();
  for (const group of [
    raw.info,
    raw.message,
    raw.friend,
    raw.groupInfo,
    raw.groupAdmin,
    raw.request,
    raw.qzone,
    raw.qzonePublic,
    raw.streamFile,
    raw.streamDownload,
    raw.systemFace,
    raw.extended,
    raw.groupFile,
    raw.groupAlbum,
  ]) {
    for (const action of group) for (const name of action.names) byName.set(name, action);
  }
  cached = { ...raw, byName };
  return cached;
}

/** The oracle action for a name, or a thrown error naming the region that should hold it. */
export function oracleFor(name: string): ReferenceAction {
  const action = loadActionOracle().byName.get(name);
  if (!action) throw new Error(`reference bundle has no action named ${name}`);
  return action;
}