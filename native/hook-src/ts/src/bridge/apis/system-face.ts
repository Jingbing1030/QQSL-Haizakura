// `SystemFaceApi` and the `SysFaceStore` behind it.
//
// Reference regions:
//   ../protocol/src/sys-face-store.ts   reference/index.mjs:109595-109848 (254 lines)
//   src/bridge/apis/system-face.ts      reference/index.mjs:339140-339166 (27 lines)
//
// ---------------------------------------------------------------------------
// Why the store is ported rather than stubbed
// ---------------------------------------------------------------------------
// `SystemFaceApi` is 27 lines of delegation. Every decision lives in the store:
//
//   * the catalog is a process-wide SINGLETON because the face set is
//     account-independent — two accounts share one catalog and one refresh;
//   * `refresh` coalesces concurrent callers onto one in-flight request
//     (`refreshInflight`) AND persists atomically afterwards;
//   * `resolve` is a three-tier lookup: catalog hit → forced refresh (once per
//     process, `refreshedInProcess`) → single-face `0x9155_1`, with the single-face
//     answer CACHED as a promise so concurrent callers share it;
//   * `ensureReady` restores persisted state before fetching, so a warm process does
//     not spend a `0x9154_1` merely to answer a `search`;
//   * `validateCatalog` enforces eight invariants, including the one that stops a
//     duplicate id from carrying CONFLICTING send metadata — a face listed twice with
//     different sticker dimensions would send as the wrong representation.
//
// A stub returning `[]` would make `fetch_sys_faces` answer `{packs: []}`, which is
// indistinguishable from "QQ has no system faces". That is the failure mode the brief
// forbids, so it is not done.
//
// ---------------------------------------------------------------------------
// The recursion in `resolve` is deliberate, and bounded
// ---------------------------------------------------------------------------
// After awaiting a single-face lookup, the store checks `this.catalog === catalog`.
// If a refresh replaced the catalog WHILE the lookup was in flight, the cached
// promise belongs to a dead catalog, so the store re-enters `resolve` — which then
// answers from the new catalog (or starts a fresh lookup against it). The recursion
// cannot spin: the second entry either finds a hit or awaits a promise stored in the
// CURRENT catalog, and the `catch` above it swallows only errors raised against a
// catalog that has since been replaced. Reproducing this exactly matters because the
// alternative — returning a stale entry — would send a face id whose metadata came
// from a superseded panel.
//
// ---------------------------------------------------------------------------
// What is NOT ported, and why
// ---------------------------------------------------------------------------
//   * `resolveWire` / `classify` / `faceWireFor` — the SEND-side machinery (`super` vs
//     `classic` vs `small` element encoding). No action in this batch sends a face;
//     `faceWireFor` is the message-element builder's job. Omitting it keeps this
//     module free of the element layer.
//   * `prewarm` — a startup optimisation with no action caller.
//   * `configureStorage` — the reference installs a storage instance before first use.
//     This port takes it in the constructor options instead, because a mutable
//     configure-after-construction step is one more ordering rule to get wrong and
//     nothing in the action path needs it.
//   * `validateSnapshot`'s schema-version gate IS reproduced (see `restoreCache`): a
//     snapshot from a future schema must be rejected, not half-read.

import { createLogger } from "../../onebot/log.js";
import type { BridgeContext } from "../context.js";
import { oidbCaller } from "../oidb-invoke.js";
import {
  FetchSysFace,
  FetchSysFaces,
  type CatalogFaceEntry,
  type CatalogPack,
} from "../../oidb/services/0x9154-9155.js";

const log = createLogger("SysFace");

const fetchSysFacesCall = oidbCaller(FetchSysFaces);
const fetchSysFaceCall = oidbCaller(FetchSysFace);

/** True when the catalog declares an animated sticker representation. */
export function isSuperFaceEntry(face: CatalogFaceEntry): boolean {
  return face.aniStickerType != null && face.aniStickerType > 0;
}

/** `isAddressableFaceId` — a face id that is a plain non-negative integer string. */
export function isAddressableFaceId(id: string): boolean {
  if (!/^(?:0|[1-9]\d*)$/.test(id)) return false;
  const numeric = Number(id);
  return Number.isSafeInteger(numeric) && numeric >= 0;
}

/**
 * `hasCompatibleSendMetadata` — the duplicate-id rule.
 *
 * For an id that is not addressable (a Unicode emoji id), any duplicate is fine: it
 * cannot be sent by number, so the ambiguity never reaches a request. For an
 * addressable id, a super/non-super disagreement is fatal, and two SUPER entries must
 * agree on all three sticker fields — otherwise the same face id would send as two
 * different animations depending on which pack the caller's search happened to hit.
 */
export function hasCompatibleSendMetadata(left: CatalogFaceEntry, right: CatalogFaceEntry): boolean {
  if (!isAddressableFaceId(left.qSid)) return true;
  const leftIsSuper = isSuperFaceEntry(left);
  if (leftIsSuper !== isSuperFaceEntry(right)) return false;
  if (!leftIsSuper) return true;
  return (
    left.aniStickerType === right.aniStickerType &&
    left.aniStickerPackId === right.aniStickerPackId &&
    left.aniStickerId === right.aniStickerId
  );
}

/**
 * `validateCatalog` — eight invariants, each with its own wording.
 *
 * The duplicate tracking is per-(id, pack): a duplicate WITHIN one pack is always an
 * error (the same list cannot list a face twice), while a duplicate ACROSS packs is
 * allowed when the send metadata agrees. That is why the registry keeps a
 * `faceIndexByPack` map rather than a single index.
 */
export function validateCatalog(packs: readonly CatalogPack[]): readonly CatalogPack[] {
  if (!Array.isArray(packs) || packs.length === 0) throw new Error("system face catalog is empty");
  interface Seen {
    face: CatalogFaceEntry;
    packIndex: number;
    faceIndex: number;
    faceIndexByPack: Map<number, number>;
  }
  const seen = new Map<string, Seen>();
  let faceCount = 0;
  for (const [packIndex, pack] of packs.entries()) {
    if (!pack || typeof pack.packName !== "string" || !Array.isArray(pack.emojis)) {
      throw new Error(`invalid system face pack at index ${packIndex}`);
    }
    for (const [faceIndex, face] of pack.emojis.entries()) {
      if (!face || typeof face.qSid !== "string" || face.qSid.length === 0) {
        throw new Error(`invalid system face id at pack ${packIndex}, face ${faceIndex}: value=${JSON.stringify(face?.qSid)}`);
      }
      if (!Array.isArray(face.emojiNameAlias) || face.emojiNameAlias.some((alias: unknown) => typeof alias !== "string")) {
        throw new Error(`invalid aliases for system face id ${face.qSid}`);
      }
      if (typeof face.qDes !== "string" || typeof face.emCode !== "string") {
        throw new Error(`invalid text metadata for system face id ${face.qSid}`);
      }
      for (const [name, value] of [
        ["qCid", face.qCid],
        ["aniStickerType", face.aniStickerType],
        ["aniStickerPackId", face.aniStickerPackId],
        ["aniStickerId", face.aniStickerId],
        ["aniStickerWidth", face.aniStickerWidth],
        ["aniStickerHeight", face.aniStickerHeight],
      ] as const) {
        if (value !== null && !Number.isSafeInteger(value)) {
          throw new Error(`invalid ${name} for system face id ${face.qSid}`);
        }
      }
      if (face.url !== null && typeof face.url !== "string") {
        throw new Error(`invalid url for system face id ${face.qSid}`);
      }
      const previous = seen.get(face.qSid);
      if (previous) {
        const previousFaceIndex = previous.faceIndexByPack.get(packIndex);
        if (previousFaceIndex !== undefined) {
          throw new Error(
            `duplicate system face id ${face.qSid} within pack ${packIndex}: faces ${previousFaceIndex} and ${faceIndex}`,
          );
        }
        if (!hasCompatibleSendMetadata(previous.face, face)) {
          throw new Error(
            `conflicting system face send metadata for id ${face.qSid}: pack ${previous.packIndex}, face ${previous.faceIndex} vs pack ${packIndex}, face ${faceIndex}`,
          );
        }
        previous.faceIndexByPack.set(packIndex, faceIndex);
      } else {
        seen.set(face.qSid, {
          face,
          packIndex,
          faceIndex,
          faceIndexByPack: new Map([[packIndex, faceIndex]]),
        });
      }
      faceCount += 1;
    }
  }
  if (faceCount === 0) throw new Error("system face catalog contains no faces");
  return packs;
}

/** The persisted snapshot the store can restore from. */
export interface SystemFaceSnapshot {
  schemaVersion: 1;
  fetchedAt: number;
  packs: CatalogPack[];
}

/** `validateSnapshot` — schema version first, then the catalog. */
export function validateSnapshot(snapshot: unknown): asserts snapshot is SystemFaceSnapshot {
  if (typeof snapshot !== "object" || snapshot === null) throw new Error("invalid system face catalog snapshot root");
  const candidate = snapshot as Record<string, unknown>;
  if (candidate["schemaVersion"] !== 1) {
    throw new Error(`unsupported system face catalog schema version: ${String(candidate["schemaVersion"])}`);
  }
  const fetchedAt = candidate["fetchedAt"];
  if (!Number.isSafeInteger(fetchedAt) || (fetchedAt as number) < 0) {
    throw new Error(`invalid system face catalog fetchedAt: ${String(fetchedAt)}`);
  }
  validateCatalog(candidate["packs"] as CatalogPack[]);
}

/** The index over one catalog snapshot. */
export interface CatalogIndex {
  packs: readonly CatalogPack[];
  byId: Map<string, CatalogFaceEntry>;
  entryCount: number;
  overlapCount: number;
  /**
   * Per-id single-face lookup results: either a resolved outcome or an in-flight
   * promise. Two shapes in one map, distinguished by the `"entry" in` test the
   * reference uses.
   *
   * ⚠️ `entry` may be **null**: the reference caches a MISS
   * (`catalog.lookups.set(faceId, { entry })` where `entry` is `null`), so a face the
   * server does not know is asked for once and then answered `null` from cache. A
   * `{ entry: CatalogFaceEntry }` type would forbid that and either lose the negative
   * cache or need an `if (entry)` that the reference does not have.
   */
  lookups: Map<number, { entry: CatalogFaceEntry | null } | { promise: Promise<CatalogFaceEntry | null> }>;
}

/** `indexCatalog`. First id wins, so `overlapCount` counts the shadows. */
export function indexCatalog(packs: readonly CatalogPack[]): CatalogIndex {
  const byId = new Map<string, CatalogFaceEntry>();
  let entryCount = 0;
  for (const pack of packs) {
    for (const emoji of pack.emojis) {
      entryCount += 1;
      if (!byId.has(emoji.qSid)) byId.set(emoji.qSid, emoji);
    }
  }
  return { packs, byId, entryCount, overlapCount: entryCount - byId.size, lookups: new Map() };
}

/** The persistence half — supplied by the host, exactly as the reference's `storage` option. */
export interface SystemFaceStorage {
  load(): Promise<unknown>;
  save(snapshot: SystemFaceSnapshot): Promise<void>;
}

export interface SysFaceStoreOptions {
  storage?: SystemFaceStorage | null;
  fetchCatalog?: (sender: BridgeContext) => Promise<CatalogPack[]>;
  now?: () => number;
  fetchFace?: (sender: BridgeContext, faceId: number) => Promise<CatalogFaceEntry | null>;
}

/**
 * `SysFaceStore` — reference:109595.
 *
 * The store holds a `BridgeContext` only through the `sender` argument of each call,
 * matching the reference's `sender` parameter, so one store serves every account.
 */
export class SysFaceStore {
  #catalog: CatalogIndex | null = null;
  #storage: SystemFaceStorage | null;
  readonly #fetchCatalog: (sender: BridgeContext) => Promise<CatalogPack[]>;
  readonly #now: () => number;
  readonly #fetchFace: (sender: BridgeContext, faceId: number) => Promise<CatalogFaceEntry | null>;
  #cacheLoad: Promise<void> | null = null;
  #refreshInflight: Promise<readonly CatalogPack[]> | null = null;
  /** Set once a refresh succeeded IN THIS PROCESS — the gate on the forced re-read. */
  #refreshedInProcess = false;

  constructor(options: SysFaceStoreOptions = {}) {
    this.#storage = options.storage ?? null;
    this.#fetchCatalog = options.fetchCatalog ?? ((sender) => fetchSysFacesCall.invoke(sender, {}));
    this.#now = options.now ?? Date.now;
    this.#fetchFace = options.fetchFace ?? ((sender, faceId) => fetchSysFaceCall.invoke(sender, { faceId }));
  }

  /**
   * Index a trusted catalog without persisting.
   *
   * Public because a protocol consumer that already obtained a full catalog wants the
   * same query semantics without paying for a fetch.
   */
  load(packs: readonly CatalogPack[]): void {
    this.#catalog = indexCatalog(validateCatalog(packs));
  }

  /** A catalog hit, in either the id map or the per-id lookup cache. */
  lookup(faceId: number): CatalogFaceEntry | null {
    const lookup = this.#catalog?.lookups.get(faceId);
    const fromId = this.#catalog?.byId.get(String(faceId));
    if (fromId) return fromId;
    return lookup && "entry" in lookup ? lookup.entry : null;
  }

  /**
   * Case-insensitive search over id, description, emCode, pack name and aliases.
   *
   * `toLocaleLowerCase`, not `toLowerCase`: the reference uses the locale-aware form,
   * and for the Turkish-I case the two differ. The `matchedIds` set de-duplicates
   * across packs, but the returned entry is the CANONICAL one from `byId` — not the
   * pack-local copy that matched — so a search hit and a lookup hit are the same
   * object.
   *
   * `ensureReady` is NOT called here: the reference's `search` does not await anything
   * (the ACTION calls `ensureReady` first via `fetchCatalog`/`search` ordering — see
   * `SystemFaceApi.search`, which awaits `ensureReady`). Keeping the store's `search`
   * synchronous is what makes it usable from `classify` too.
   */
  search(query: string): CatalogFaceEntry[] {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle || !this.#catalog) return [];
    const matches: CatalogFaceEntry[] = [];
    const matchedIds = new Set<string>();
    for (const pack of this.#catalog.packs) {
      for (const face of pack.emojis) {
        if (matchedIds.has(face.qSid)) continue;
        const haystack = [face.qSid, face.qDes, face.emCode, pack.packName, ...face.emojiNameAlias];
        if (haystack.some((value) => value.toLocaleLowerCase().includes(needle))) {
          const canonical = this.#catalog?.byId.get(face.qSid);
          if (!canonical) throw new Error(`system face index is missing catalog id ${face.qSid}`);
          matches.push(canonical);
          matchedIds.add(face.qSid);
        }
      }
    }
    return matches;
  }

  /** Load durable state, fetching only when no usable catalog exists. */
  async ensureReady(sender: BridgeContext): Promise<void> {
    await (this.#refreshInflight ?? this.#loadCache());
    if (this.#refreshInflight || !this.#catalog) await this.refresh(sender);
  }

  /**
   * Fetch the authoritative catalog. Concurrent callers share one request.
   *
   * The `finally` clearing `refreshInflight` runs BEFORE the returned promise settles
   * for any waiter that joined mid-flight, which is why `ensureReady` can test
   * `this.#refreshInflight` as a "a refresh just happened" signal.
   */
  refresh(sender: BridgeContext): Promise<readonly CatalogPack[]> {
    if (this.#refreshInflight) return this.#refreshInflight;
    const startedAt = this.#now();
    this.#refreshInflight = this.#fetchCatalog(sender)
      .then(async (packs) => {
        const validated = validateCatalog(packs);
        const snapshot: SystemFaceSnapshot = { schemaVersion: 1, fetchedAt: this.#now(), packs: [...validated] };
        const catalog = indexCatalog(validated);
        this.#catalog = catalog;
        this.#refreshedInProcess = true;
        if (this.#storage) await this.#storage.save(snapshot);
        log.info(
          "system face catalog refreshed: entries=%d uniqueFaces=%d overlaps=%d packs=%d elapsedMs=%d",
          catalog.entryCount,
          catalog.byId.size,
          catalog.overlapCount,
          validated.length,
          this.#now() - startedAt,
        );
        return validated;
      })
      .catch((error: unknown) => {
        log.error(
          "system face catalog refresh failed: elapsedMs=%d error=%s",
          this.#now() - startedAt,
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      })
      .finally(() => {
        this.#refreshInflight = null;
      });
    return this.#refreshInflight;
  }

  /**
   * Resolve one face id, with the three tiers and the stale-catalog retry.
   *
   * See the header for why the recursive call is correct rather than a loop hazard.
   */
  async resolve(sender: BridgeContext, faceId: number): Promise<CatalogFaceEntry | null> {
    await this.ensureReady(sender);
    let cached = this.lookup(faceId);
    if (cached) return cached;
    if (!this.#refreshedInProcess) {
      await this.refresh(sender);
      cached = this.lookup(faceId);
      if (cached) return cached;
    }
    const catalog = this.#catalog;
    if (!catalog) throw new Error("system face catalog is unavailable after readiness completed");
    const lookup = catalog.lookups.get(faceId);
    if (lookup && "entry" in lookup) return lookup.entry;
    const request =
      (lookup && "promise" in lookup
        ? lookup.promise
        : this.#fetchSingleFace(sender, faceId)
            .then((entry) => {
              catalog.lookups.set(faceId, { entry });
              return entry;
            })
            .catch((error: unknown) => {
              catalog.lookups.delete(faceId);
              throw error;
            }));
    if (!lookup || !("promise" in lookup)) catalog.lookups.set(faceId, { promise: request });
    try {
      const entry = await request;
      if (this.#catalog === catalog) return entry;
    } catch (error) {
      if (this.#catalog === catalog) throw error;
    }
    // A refresh replaced the catalog under us: re-enter against the live one.
    return this.resolve(sender, faceId);
  }

  /**
   * `fetchSingleFace` — the id-equality and metadata checks live HERE, not in the
   * codec. See `0x9154-9155.ts`'s header for why.
   */
  async #fetchSingleFace(sender: BridgeContext, faceId: number): Promise<CatalogFaceEntry | null> {
    try {
      const entry = await this.#fetchFace(sender, faceId);
      if (entry) {
        if (entry.qSid !== String(faceId)) {
          throw new Error(`system face lookup id mismatch: requested=${faceId} received=${entry.qSid}`);
        }
        // Re-run the catalog invariants on the single answer: a lookup must not be
        // able to introduce an entry the catalog's own validation would reject.
        validateCatalog([{ packName: "", emojis: [entry] }]);
      }
      log.debug(
        "system face lookup completed: id=%d found=%s animated=%s",
        faceId,
        entry !== null,
        entry !== null && isSuperFaceEntry(entry),
      );
      return entry;
    } catch (error) {
      log.error("system face lookup failed: id=%d error=%s", faceId, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * `getCatalog` — `refresh: true` forces a fetch, `false` restores-or-fetches.
   *
   * The returned array is the store's own `packs` reference, not a copy. The reference
   * does the same, and it is safe because `validateCatalog` has already frozen the
   * shape's invariants and nothing mutates a pack after indexing.
   */
  async getCatalog(sender: BridgeContext, refresh = false): Promise<readonly CatalogPack[]> {
    if (refresh) await this.refresh(sender);
    else await this.ensureReady(sender);
    if (!this.#catalog) throw new Error("system face catalog is unavailable after readiness completed");
    return this.#catalog.packs;
  }

  #loadCache(): Promise<void> {
    if (this.#catalog) return Promise.resolve();
    this.#cacheLoad ??= this.#restoreCache();
    return this.#cacheLoad;
  }

  /**
   * `restoreCache` — a failed restore is an ERROR when no catalog exists.
   *
   * The `if (this.#catalog) return;` in the catch is the subtle line: a refresh may
   * have completed while the restore was failing, in which case the failure is
   * irrelevant. Without it, a slow disk read would fail a request whose catalog is
   * already in memory.
   */
  async #restoreCache(): Promise<void> {
    if (!this.#storage) return;
    const startedAt = this.#now();
    try {
      const snapshot = await this.#storage.load();
      if (this.#catalog || !snapshot) return;
      validateSnapshot(snapshot);
      const catalog = indexCatalog(snapshot.packs);
      this.#catalog = catalog;
      log.info(
        "system face catalog restored: entries=%d uniqueFaces=%d overlaps=%d packs=%d fetchedAt=%d elapsedMs=%d",
        catalog.entryCount,
        catalog.byId.size,
        catalog.overlapCount,
        snapshot.packs.length,
        snapshot.fetchedAt,
        this.#now() - startedAt,
      );
    } catch (error) {
      if (this.#catalog) return;
      log.error(
        "system face catalog restore failed: elapsedMs=%d error=%s",
        this.#now() - startedAt,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }
}

/** The process-wide catalog. Account-independent, so one store for every sender. */
export const sysFaceStore = new SysFaceStore();

/**
 * `SystemFaceApi` — reference:339140. 27 lines of delegation, reproduced exactly.
 *
 * Note `fetchFace`'s two paths: `refresh: true` RE-READS the existing index after a
 * forced refresh (`lookup`), it does not perform a single-face lookup. So
 * `fetch_face_entity` with `refresh: true` can answer `null` for a face that
 * `refresh: false` would find via `0x9155_1`. That asymmetry is the reference's and is
 * asserted by a differential test.
 */
export class SystemFaceApi {
  readonly #ctx: BridgeContext;

  constructor(ctx: BridgeContext) {
    this.#ctx = ctx;
  }

  fetchCatalog(refresh = false): Promise<readonly CatalogPack[]> {
    return sysFaceStore.getCatalog(this.#ctx, refresh);
  }

  async fetchFace(faceId: number, refresh = false): Promise<CatalogFaceEntry | null> {
    if (refresh) {
      await sysFaceStore.refresh(this.#ctx);
      return sysFaceStore.lookup(faceId);
    }
    return sysFaceStore.resolve(this.#ctx, faceId);
  }

  async search(query: string): Promise<readonly CatalogFaceEntry[]> {
    await sysFaceStore.ensureReady(this.#ctx);
    return sysFaceStore.search(query);
  }

  async isSuper(faceId: number, refresh = false): Promise<boolean> {
    const face = await this.fetchFace(faceId, refresh);
    return face !== null && isSuperFaceEntry(face);
  }
}