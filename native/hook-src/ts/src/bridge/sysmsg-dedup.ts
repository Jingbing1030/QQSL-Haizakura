// `sysmsg-dedup` — a port of QQ NT's own system-message dedup.
//
// Reference region: `../protocol/src/msg-push/sysmsg-dedup.ts`
// (reference/index.mjs:154040-154101, 62 lines). Ported whole: the route table,
// the identity derivation and the ring-buffer dedupe are each verbatim, including
// the order of the early returns.
//
// ---------------------------------------------------------------------------
// WHAT THIS IS
// ---------------------------------------------------------------------------
// QQ NT's `sys_msg_mgr.cc` ignores a repeated raw OlPush system event before it
// ever notifies its listeners, keyed by `{peerUid}_{chatType}_{msg_seq}_{random}`.
// Because the native client throws those duplicates away, an OlPush interception
// layer that reports every frame it sees reports *more* than QQ itself does — the
// same recall / mute / poke event surfaces twice. This module reproduces the
// kernel-side filter on our side of the wire, so the framework's event stream
// matches what a QQ client would have shown.
//
// The reverse-engineered anchors, as recorded by the reference:
//
//   macOS QQ 6.9.98 `sys_msg_mgr.cc::ProcessRecvSysMsg` (`sub_E4B94A`) builds
//     global_key = `{peerUid}_{chatType}_{msg_seq}_{random}`
//   `sub_E523C8` maps content-head fields 5 and 4 to `msg_seq` and `random`.
//   `sub_E4B30D` supplies chatType from a static `(msgType, subType)` table.
//   `sub_E4B62A` selects response-head `fromUid` for C2C or decimal `fromUin` for
//     groups.
//
// ---------------------------------------------------------------------------
// NO REAL CAPTURE VALIDATES THIS — stated plainly
// ---------------------------------------------------------------------------
// Nothing here has been checked against a live QQ NT client. The route table is
// reproduced from the reference's disassembly notes, not from packets we captured,
// and no packet capture, container or production traffic was used to build or
// verify this module. Two consequences worth keeping in mind:
//
//   * A route the reference mis-transcribed stays silently un-deduped here (it
//     fails open, see below), and a route that is genuinely in the table but whose
//     fields we mis-read would suppress an event QQ would have delivered. Neither
//     failure mode is observable without a capture.
//   * The capacity (1024) is the reference's default, not something measured
//     against the native client's own ring size.
//
// ---------------------------------------------------------------------------
// Why every unknown route fails OPEN
// ---------------------------------------------------------------------------
// `getNativeSysMsgChatType` returns null for anything not in the static table, and
// `deriveSysMsgDedupIdentity` then returns null, which callers must read as "not
// dedupable" rather than "duplicate". Only the static routes proven in
// `sys_msg_mgr.cc` participate; guessing at a wider table would risk suppressing
// unrelated events, which is a worse failure than a duplicate.

/**
 * The chat type the native key's middle component takes.
 *
 * 1 = C2C (peer identified by `fromUid`), 2 = group (peer identified by the
 * decimal `fromUin`). These two values are the only ones the native table emits.
 */
export type NativeSysMsgChatType = 1 | 2;

/**
 * The content-head fields the dedup key consumes.
 *
 * Narrow on purpose: the real `ContentHeadInfo` (`msg-push.ts`) carries seven
 * fields, but `msg_seq` (5) and `random` (4) are the only two the key has, and
 * `(msgType, subType)` are the only two the route table reads. Spreading the whole
 * head in here would make this module depend on `msg-push.ts` for no benefit.
 */
export interface SysMsgDedupHead {
  msgType: number;
  subType: number;
  /** Content-head field 5. */
  sequence: number;
  /** Content-head field 4, the "random" component of the native key. */
  msgId: number;
}

/**
 * The minimal context shape `deriveSysMsgDedupIdentity` needs.
 *
 * Structurally satisfied by `PushContext` from `msg-push.ts` — that its wider
 * object is assignable to this one is asserted at compile time in
 * `test/sysmsg-dedup.test.ts`, so this stays a narrow, independently-compilable
 * interface without the two ever drifting apart in silence.
 */
export interface SysMsgDedupContext {
  head: SysMsgDedupHead;
  /** Response-head `fromUid`; the C2C peer. */
  fromUid: string;
  /** Response-head `fromUin`; the group peer, once stringified. */
  fromUin: number;
}

/** One native dedup key, decomposed. */
export interface SysMsgDedupIdentity {
  /** `fromUid` for C2C, decimal `String(fromUin)` for groups. */
  peerUid: string;
  chatType: NativeSysMsgChatType;
  /** Content-head field 5, `msg_seq`. */
  sequence: number;
  /** Content-head field 4, `random` (the message id). */
  random: number;
}

/**
 * reference L154041 `getNativeSysMsgChatType` — the static `(msgType, subType)`
 * route table, reproduced row for row.
 *
 * reference L154042: (528, 290) -> C2C
 * reference L154043: (166, 75|129|131|133|135) -> C2C
 * reference L154044: (167, 133) -> C2C
 * reference L154045: (732, 12|16|20) -> group
 * reference L154046: (33|34|85, 0) -> group
 * reference L154047: everything else -> null
 *
 * Note the exactness: subType must match one of the listed values, so
 * `(166, 130)` and `(167, 75)` are NOT routes even though their msgType is
 * listed. The `167` row in particular has no subType list, just the single 133.
 */
export function getNativeSysMsgChatType(msgType: number, subType: number): NativeSysMsgChatType | null {
  if (msgType === 528 && subType === 290) return 1;
  if (msgType === 166 && (subType === 75 || subType === 129 || subType === 131 || subType === 133 || subType === 135)) return 1;
  if (msgType === 167 && subType === 133) return 1;
  if (msgType === 732 && (subType === 12 || subType === 16 || subType === 20)) return 2;
  if ((msgType === 33 || msgType === 34 || msgType === 85) && subType === 0) return 2;
  return null;
}

/**
 * reference L154048 `deriveSysMsgDedupIdentity` — turn a push context into the
 * native key's parts, or null when the context cannot be keyed.
 *
 * reference L154052: an unknown route, `sequence === 0` or `msgId === 0` are all
 * "not dedupable" and return null BEFORE the peer is resolved; only the static
 * routes proven in `sys_msg_mgr.cc` participate, so unknown routes fail open
 * rather than risking suppression of unrelated events.
 *
 * reference L154053: `peerUid = chatType === 1 ? ctx.fromUid : String(ctx.fromUin)`.
 * reference L154054: null when `peerUid` is falsy — which catches the C2C case with
 * a blank `fromUid` — and, separately, `chatType === 2 && ctx.fromUin === 0`, which
 * the falsy test alone would miss because `String(0)` is the truthy string `"0"`.
 * That second check is the whole reason the native client never keys a group event
 * to peer `"0"`; dropping it would dedupe every fromUin-0 group event into one entry.
 */
export function deriveSysMsgDedupIdentity(ctx: SysMsgDedupContext): SysMsgDedupIdentity | null {
  const { head } = ctx;
  const chatType = getNativeSysMsgChatType(head.msgType, head.subType);
  if (chatType === null || head.sequence === 0 || head.msgId === 0) return null;
  const peerUid = chatType === 1 ? ctx.fromUid : String(ctx.fromUin);
  if (!peerUid || (chatType === 2 && ctx.fromUin === 0)) return null;
  return {
    peerUid,
    chatType,
    sequence: head.sequence,
    random: head.msgId,
  };
}

/**
 * reference L177174 `SysMsgDedup` — a fixed-capacity ring of native keys.
 *
 * Behaviour mirrored exactly:
 *   - a zero `sequence`, a zero `random` or an empty `peerUid` returns false
 *     immediately (fail open) and does NOT consume a ring slot;
 *   - a key already in the ring returns true and does not move the cursor, so a
 *     repeated duplicate never shortens the memory of the entries behind it;
 *   - otherwise the slot at the cursor is evicted (deleted from the set when it
 *     holds a key), the new key is stored and added, the cursor advances modulo
 *     capacity, and false is returned.
 *
 * The eviction order is what makes this a ring and not a "Set with a size cap":
 * capacity is a hard floor on how far back deduplication reaches, and the entry
 * lost is the oldest inserted, not the least recently seen.
 *
 * `capacity` must be at least 1. The reference performs no check and neither does
 * this port: capacity 0 would make the cursor advance `(0 + 1) % 0 === NaN`, a
 * pathological caller error rather than a code path worth reinterpreting.
 */
export class SysMsgDedup {
  readonly capacity: number;
  readonly #seen = new Set<string>();
  readonly #ring: Array<string | undefined>;
  #cursor = 0;

  constructor(capacity = 1024) {
    this.capacity = capacity;
    this.#ring = new Array<string | undefined>(capacity);
  }

  /** Returns true when this native system-message identity was already seen. */
  seenDuplicate(identity: SysMsgDedupIdentity): boolean {
    if (identity.sequence === 0 || identity.random === 0 || !identity.peerUid) return false;
    const key = `${identity.peerUid}_${identity.chatType}_${identity.sequence}_${identity.random}`;
    if (this.#seen.has(key)) return true;
    const evicted = this.#ring[this.#cursor];
    if (evicted !== undefined) this.#seen.delete(evicted);
    this.#ring[this.#cursor] = key;
    this.#seen.add(key);
    this.#cursor = (this.#cursor + 1) % this.capacity;
    return false;
  }
}