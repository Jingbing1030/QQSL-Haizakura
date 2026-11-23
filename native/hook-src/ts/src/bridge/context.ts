// The `ctx` contract every bridge module receives.
//
// ---------------------------------------------------------------------------
// What `ctx` actually is (not a guess: this is what the callers read)
// ---------------------------------------------------------------------------
// The reference names the parameter `ctx` in most APIs and `bridge` in a few
// (`getCookies(bridge, domain)`, `getSKey(bridge)` — `src/bridge/apis/web.ts`
// reference/index.mjs:338947), and `web.ts` opens with a cast that proves the two
// names are one type:
//
//     function asBridge(ctx) { return ctx; }
//
// So a bridge API's `ctx` IS the `Bridge` instance, passed whole. `Bridge`
// (reference/index.mjs:347321 `src/bridge/bridge.ts`) is not a small facade: it
// owns the connection set, the event bus, the packet pipeline, the API hub, the
// upload-metadata cache and the sequence counters. The APIs only ever touch the
// slice below, so this port declares that slice as `BridgeContext` and lets the
// host's `Bridge` satisfy it structurally — which is exactly what the reference
// comment at reference/index.mjs:82649 says its own helper does:
//
//     "Takes just the `BridgeContext` slice it needs, so both a full `Bridge` and a
//      bare context (e.g. an OIDB service's Deps) satisfy it."
//
// ---------------------------------------------------------------------------
// The complete member list, measured rather than assumed
// ---------------------------------------------------------------------------
// Grepping every `ctx.` / `this.ctx.` in the 21 bridge regions yields exactly ten
// distinct members, and nothing else — no `ctx.log`, no `ctx.config`, no
// `ctx.request`, no `ctx.bridge`:
//
//     identity            87 uses   the IdentityService (see BridgeIdentity)
//     apis                39 uses   the ApiHub (cross-API calls; see BridgeApiHub)
//     sendRawPacket       19 uses   the OIDB transport (see sendRawPacket below)
//     resolveUserUid       8 uses   UIN → UID, with network fallback
//     nextMessageRandom    5 uses   message random for outbound packets
//     nextClientSequence   4 uses   client sequence for outbound packets
//     recallUploadedFile   3 uses   rememberUploadedFile's counterpart
//     events               2 uses   the BridgeEventBus
//     rememberUploadedFile 2 uses   upload metadata cache
//     dispose              1 use    comments only; no bridge API calls it
//
// Logging is *not* on `ctx`. Every module does `createLogger("Bridge.X")` at module
// scope instead (`var log$30 = createLogger("Bridge.GroupAdmin")`,
// reference/index.mjs:234065). A `createLogger` call needs no context, so putting
// one on `ctx` would invent surface the reference does not have.
//
// ---------------------------------------------------------------------------
// What the OIDB layer needs from the same object
// ---------------------------------------------------------------------------
// `invokeOidb` (reference/index.mjs:19136) calls `ctx.sendRawPacket(wireName,
// bytes, timeoutMs?)` and nothing else for transport, but it threads `ctx` into
// every spec's `serialize`/`deserialize`, where the specs read:
//
//     ctx.resolveUserUid   14 uses
//     ctx.identity.uin      6 uses
//     ctx.identity.findUinByUid / ctx.identity.resolveUin
//
// `ts/src/oidb/spec.ts` narrows the transport to `OidbContext` (sendRawPacket
// only), which is correct for the specs written so far but is NOT sufficient for
// the bridge layer: a bridge API both invokes OIDB and reads identity. So the
// bridge context is a superset of `OidbContext`, and the compatibility is
// one-way: `BridgeContext` satisfies `OidbContext`, not the reverse.
//
// ---------------------------------------------------------------------------
// Why `identity` is modelled as an interface, not the real IdentityService
// ---------------------------------------------------------------------------
// The reference's IdentityService (reference/index.mjs:345386,
// `../protocol/src/identity-service.ts`, 1074 lines) is an in-memory roster plus a
// SQLite snapshot with a bounded retry queue. Its 17 members that the bridge layer
// touches are all that any ported API needs; persistence, schema migration and the
// replay queue are invisible from here. Declaring the interface (rather than
// porting 1074 lines of SQLite) keeps this layer runnable against an in-memory
// identity and leaves the durable store as a separate, independently testable job.

import type { OidbTransportResult } from "../oidb/spec.js";
import { readEnvAlias } from "./env.js";

/**
 * What `PacketClient.sendPacket` must answer.
 *
 * Declared as an extension of `OidbTransportResult` rather than a parallel shape:
 * `invokeOidb` consumes the transport result directly, so any difference here
 * becomes a cast in the one place the two layers meet. The only delta is
 * `responseData`, which the reference sets to literal `null` on the synthetic
 * "no sender attached" answer; `invokeOidb` already reads it as
 * `result.responseData ?? new Uint8Array(0)`, so `undefined` and `null` are
 * interchangeable to it. This port uses `undefined` so the type is a strict
 * supertype/subtype match instead of needing a widening cast.
 */
export interface PacketSendResult extends OidbTransportResult {}

/**
 * The live packet sender for one QQ process.
 *
 * In the reference this is the `PacketClient` handed to `Bridge.bindPid(pid, client)`
 * (reference/index.mjs:347321); when no sender is attached `Bridge.sendRawPacket`
 * returns the synthetic failure `{ success: false, gotResponse: false,
 * errorCode: -1, errorMessage: "no packet sender attached", responseData: null }`
 * rather than throwing (reference/index.mjs:347459). That distinction is load-bearing:
 * callers branch on `errorCode === -1` to mean "nothing is attached yet", which is a
 * different condition from "the server said no".
 */
export interface PacketClient {
  sendPacket(wireName: string, body: Uint8Array, timeoutMs?: number): Promise<PacketSendResult>;
}

/** One bridge event, as `BridgeEventBus.emit` takes it. */
export interface BridgeEvent {
  kind: string;
  [field: string]: unknown;
}

/** An unsubscribe handle, the shape `BridgeEventBus.on` returns. */
export type Unsubscribe = () => void;

/**
 * The event bus the reference attaches to every Bridge
 * (reference/index.mjs:346460, `../protocol/src/event-bus.ts`).
 *
 * `emit` fans out to every subscriber of the kind plus every `onAny` subscriber and
 * resolves once all of them settle; a rejecting subscriber is reported through
 * `onError` and never blocks the others. Bridge APIs only subscribe (`on`) and
 * publish (`emit`); the rest of the bus is there because a host needs it.
 */
export interface BridgeEventBus {
  on(kind: string, handler: (event: BridgeEvent) => void | Promise<void>): Unsubscribe;
  onAny(handler: (event: BridgeEvent) => void | Promise<void>): Unsubscribe;
  off(kind: string, handler: (event: BridgeEvent) => void | Promise<void>): void;
  has(kind: string): boolean;
  clear(): void;
  emit(event: BridgeEvent): Promise<void>;
}

/**
 * The identity/roster slice the bridge layer reads and writes.
 *
 * Every member here is used by at least one bridge module; see the counts in the
 * header. `uin` is a **string** in the reference — `IdentityService.uin_` is set
 * from the constructor's `uin` argument and `openForUin(uin)` receives it as a
 * string; bridge code does `Number(this.ctx.identity.uin)` where it needs a number
 * (`apis/group-admin.ts` reference/index.mjs:234618) and passes the string verbatim
 * into `getCookies`' URL. Typing it as number would silently change those URLs.
 */
export interface BridgeIdentity {
  /** The bot's own QQ number, as a decimal string. */
  readonly uin: string;
  nickname: string;
  readonly selfProfile: SelfProfile | null;
  /** The bot's own uid, or null before warmup resolves it. */
  readonly selfUid: string | null;

  /**
   * Resolves once the roster has finished its initial load.
   *
   * `Bridge.onPacket` chains EVERY inbound packet on this promise
   * (reference/index.mjs:347435), so a packet that arrives before the roster is warm
   * is delayed rather than dropped. Typed as a bare promise: nothing in the bridge
   * layer reads a value from it.
   */
  readonly initialization: Promise<void>;

  setFetcher(fetcher: IdentityFetcher): void;
  setSelfProfile(info: SelfProfile): void;

  /**
   * Release the roster (and its persistence, when it has any). Called from
   * `Bridge.dispose` and awaited by `BridgeManager.disposeSessions`, which turns a
   * rejection into an `AggregateError` that names persistence as the culprit —
   * hence the name of this method matters less than the fact that it can reject.
   */
  close(): Promise<void>;

  /** UIN → UID with network fallback; THROWS when it cannot be resolved. */
  resolveUid(uin: number | string, groupId?: number): Promise<string>;
  /** UID → UIN; returns null on a miss and NEVER throws (inbound events still emit). */
  resolveUin(uid: string, groupId?: number): Promise<number | null>;
  findUidByUin(uin: number | string, groupId?: number): string | null;
  findUinByUid(uid: string, groupId?: number): number | null;

  findUserProfile(uin: number): UserProfile | null;
  readonly friends: readonly FriendInfo[];
  findFriend(uin: number): FriendInfo | null;
  readonly groups: readonly GroupInfo[];
  findGroup(groupId: number): GroupInfo | null;
  findGroupMember(groupId: number, uin: number): GroupMemberInfo | null;

  rememberFriends(friends: readonly FriendInfo[]): void;
  rememberGroups(groups: readonly GroupInfo[]): void;
  forgetGroup(groupId: number): void;
  rememberGroupMembers(groupId: number, members: readonly GroupMemberInfo[]): void;
  rememberUserProfile(info: UserProfile): void;
  updateGroupMember(groupId: number, member: GroupMemberInfo): void;
  /** Stash inbound join requests so `contacts.groupInvites` can report them later. */
  rememberGroupRequests(requests: readonly unknown[]): void;
}

/** The three fetchers a Bridge installs on its identity (reference/index.mjs:347340). */
export interface IdentityFetcher {
  fetchProfile(uin: number): Promise<UserProfile>;
  fetchProfileByUid(uid: string): Promise<UserProfile>;
  fetchGroupMemberList(groupId: number): Promise<readonly GroupMemberInfo[]>;
}

/**
 * The bot's own profile. `identity.ts` L184 `setSelfProfile` stores a copy, and
 * `bridge.ts` builds one from a friend record with every field spelled out
 * (reference/index.mjs:347312) — so the shape is the reference's, including the
 * three `qidian*` flags that only Qidian (企业) accounts set.
 */
export interface SelfProfile {
  uin: number;
  uid: string;
  nickname: string;
  remark: string;
  qid: string;
  sex: "male" | "female" | "unknown";
  age: number;
  sign: string;
  avatar: string;
  level: number;
  qidianMasterFlag: number;
  qidianCrewFlag: number;
  qidianCrewFlag2: number;
}

/** A friend row, as `ContactsApi.fetchFriendList` produces it. */
export interface FriendInfo {
  uin: number;
  uid: string;
  nickname: string;
  remark: string;
}

/** A group row. `members` is keyed by uin. */
export interface GroupInfo {
  groupId: number;
  groupName: string;
  remark: string;
  memberCount: number;
  memberMax: number;
  members?: Map<number, GroupMemberInfo>;
}

/** A group member row. */
export interface GroupMemberInfo {
  uin: number;
  uid: string;
  nickname: string;
  card: string;
  /**
   * `"owner" | "admin" | "member"` — a STRING, not the 0/1/2 wire enum.
   *
   * This was a `number` here, which was wrong. The reference's roster stores the string
   * form all the way through: `rowToMemberInfo` defaults with
   * `role: row.role || "member"` (reference/index.mjs:346412), the OneBot event schema
   * declares `role: {type: "string", enum: ["owner","admin","member"]}`
   * (reference/index.mjs:7770), and `senderRole` is assigned straight off the roster row
   * (`role: event.senderRole || "member"`, reference/index.mjs:23121).
   *
   * The numeric form exists only at the *wire* boundary: the 0xfe7 roster decoders under
   * `ts/src/oidb/services/` map the group's `uint32` to this string before handing it
   * over, which is why `oidb-batch-b.test.ts` already asserts strings.
   *
   * Typing it as a number compiles everywhere and yields a `senderRole` that is a number
   * where the reference has a string — invisible until an event is serialised.
   */
  role: "owner" | "admin" | "member";
  joinTime: number;
  lastSentTime: number;
  shutUpTime: number;
  isRobot?: boolean;
}

/** A user profile row, as `ContactsApi.fetchUserProfile` produces it. */
export interface UserProfile extends SelfProfile {}

/**
 * The slice of the ApiHub one API needs from another.
 *
 * Only four APIs reach across (`apis/forward.ts`, `apis/friend.ts`,
 * `apis/group-album.ts`, `apis/qzone.ts`, `apis/group-file.ts`), and each uses a
 * handful of members. Declaring all of them optional keeps the hub constructible
 * while only the two ported modules exist: a caller that needs `apis.groupFile`
 * gets a clear runtime failure instead of a type error on an unrelated path.
 */
export interface BridgeApiHub {
  collection?: unknown;
  message?: unknown;
  contacts?: ContactsApiSlice;
  groupAdmin?: unknown;
  groupFile?: GroupFileApiSlice;
  groupAlbum?: unknown;
  qzone?: unknown;
  interaction?: unknown;
  friend?: unknown;
  profile?: unknown;
  flashTransfer?: unknown;
  forward?: unknown;
  misc?: unknown;
  extras?: unknown;
  web?: WebApiSlice;
  systemFace?: unknown;
}

/** The `ContactsApi` members other APIs call. */
export interface ContactsApiSlice {
  fetchFriendList(): Promise<readonly FriendInfo[]>;
  fetchGroupList(): Promise<readonly GroupInfo[]>;
  fetchGroupMemberList(groupId: number): Promise<readonly GroupMemberInfo[]>;
  fetchUserProfile(uin: number): Promise<UserProfile>;
  fetchUserProfileByUid(uid: string): Promise<UserProfile>;
  readonly groupInvites?: unknown;
  resolveGroupJoinRequest?(...args: unknown[]): Promise<unknown>;
}

/** The `GroupFileApi` members other APIs call. */
export interface GroupFileApiSlice {
  getUrl(groupId: number, fileId: string): Promise<string>;
  getPrivateUrl(userId: number, fileId: string): Promise<string>;
  upload(...args: unknown[]): Promise<{ fileId: string }>;
  uploadPrivate(...args: unknown[]): Promise<{ fileId: string }>;
}

/**
 * The `WebApi` members other APIs call.
 *
 * This is deliberately the *public method* shape, not `WebApi` itself: `qzone.ts`
 * and `group-album.ts` call `this.ctx.apis.web.getCookies(...)`, so cross-API use
 * goes through the public surface and never through the module-local helpers.
 */
export interface WebApiSlice {
  forceFetchClientKey(): Promise<ClientKey>;
  getCookies(domain: string): Promise<CookieJar>;
  getCookiesStr(domain: string): Promise<string>;
  getCsrfToken(): Promise<number>;
  getCredentials(domain: string): Promise<{ cookies: string; token: number; csrf_token: number }>;
}

/** `GetPskey`'s business result: domain → pskey, empty pairs dropped. */
export interface PskeyMap {
  domainPskeyMap: Map<string, string>;
}

/**
 * `ForceFetchClientKey`'s business result. All three fields are **strings**: the
 * reference stringifies them because they are concatenated straight into the
 * `ssl.ptlogin2.qq.com/jump` URL (reference/index.mjs:338580).
 */
export interface ClientKey {
  clientKey: string;
  keyIndex: string;
  expireTime: string;
}

/** A parsed cookie jar: key → value, insertion-ordered. */
export type CookieJar = Record<string, string>;

/**
 * The upload-metadata cache entry. `apis/group-file.ts` writes these and
 * `apis/forward.ts` reads them back to avoid re-uploading a file it just sent.
 */
export interface UploadedFileMeta {
  fileId: string;
  [field: string]: unknown;
}

/**
 * Everything a bridge API may use. This is the whole contract; there is no other
 * context type in the layer.
 *
 * `sendRawPacket` is the same method `OidbContext` declares, widened only in the
 * return type's optionality, so a `BridgeContext` is assignable to `OidbContext`
 * and the OIDB specs work unchanged.
 */
export interface BridgeContext {
  readonly identity: BridgeIdentity;
  readonly apis: BridgeApiHub;
  readonly events: BridgeEventBus;

  sendRawPacket(wireName: string, body: Uint8Array, timeoutMs?: number): Promise<PacketSendResult>;

  resolveUserUid(uin: number | string, groupId?: number): Promise<string>;

  /** Monotonic counter for `client_sequence`. Starts at 1e8 + (Date.now() % 1e9). */
  nextClientSequence(): number;
  /** LCG over `Date.now() & 0xffffffff`, masked to 31 bits. */
  nextMessageRandom(): number;

  rememberUploadedFile(meta: UploadedFileMeta): void;
  recallUploadedFile(fileId: string): UploadedFileMeta | undefined;

  dispose(): Promise<void>;
}

/**
 * The default wait for a QQ reply. `SNOWLUMA_PACKET_TIMEOUT_MS` overrides it
 * (reference/index.mjs:1685 `../bridge/src/packet-timeout.ts`).
 */
export const DEFAULT_PACKET_TIMEOUT_MS = 15_000;

/** The reference's env reader, kept so the bridge layer honours the same variable. */
export function packetTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = readEnvAlias("PACKET_TIMEOUT_MS", env);
  if (typeof raw !== "string" || !raw.trim()) return DEFAULT_PACKET_TIMEOUT_MS;
  const value = raw.trim();
  const parsed = /^[1-9]\d*$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed > 2_147_483_647) return DEFAULT_PACKET_TIMEOUT_MS;
  return parsed;
}