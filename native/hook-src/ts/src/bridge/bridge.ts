// `Bridge` — the object that IS `ctx`, and the only implementation of
// `BridgeContext` in this port.
//
// Reference region: src/bridge/bridge.ts (reference/index.mjs:347321, 371 lines).
//
// ---------------------------------------------------------------------------
// What is ported and what is not, and why the line falls where it does
// ---------------------------------------------------------------------------
// PORTED — the whole `ctx` surface plus session bookkeeping:
//
//   identity / apis / events        the three fields every API reads
//   connections (bind/detach/has)    insertion-ordered PID → PacketClient map
//   sendRawPacket                    the OIDB transport, including the synthetic
//                                    "no packet sender attached" failure
//   resolveUserUid                   identity.resolveUid with a group hint
//   nextClientSequence               +1 per call, seeded at 1e8 + now%1e9
//   nextMessageRandom                the 2654435769 LCG, masked to 31 bits
//   rememberUploadedFile             bounded 1024-entry FIFO
//   recallUploadedFile               lookup by fileId
//   getOnlineClients                 frozen snapshot from the event bus
//   dispose / receive-health         shutdown and liveness
//
// NOT PORTED — both because they are gated on modules this port does not have, not
// because they are hard:
//
//   the constructor's `setFetcher` + `IncomingPacketPipeline` wiring
//       needs `apis.contacts` (4 missing OIDB classes) and the 535-line packet
//       pipeline, which in turn needs `IdentityService` (1074 lines, SQLite).
//   registerCmd / handlesCmd / onPacket / processClientMessage
//       the packet dispatch surface; same dependency.
//   runRosterWarmup / whenRosterWarmupSettled / maybeStartRosterWarmup
//       needs `contacts.fetchFriendList` and `contacts.fetchGroupList`.
//
// Those are listed in `docs/bridge-layer.md` with the exact OIDB classes they wait
// on. The `Bridge` below is deliberately constructed WITHOUT a pipeline, so it is
// a usable `ctx` for every ported API and a compile-time-checked statement of what
// `ctx` requires; it is not yet a hook-attachable bridge.
//
// ---------------------------------------------------------------------------
// `sendRawPacket`'s failure policy is the load-bearing part
// ---------------------------------------------------------------------------
// With no PID bound, the reference returns
//
//     { success: false, gotResponse: false, errorCode: -1,
//       errorMessage: "no packet sender attached", responseData: null }
//
// and does NOT throw. That is not laziness: `invokeOidb` treats a `gotResponse:
// false` result as a transport failure and raises its own error naming the
// command, so the "-1" sentinel is what makes "QQ is not running" arrive at the
// OneBot caller as a failed action with a message about the COMMAND rather than an
// unhandled rejection from a background task. Throwing here would change that.

import type {
  BridgeApiHub,
  BridgeContext,
  BridgeEvent,
  BridgeEventBus,
  BridgeIdentity,
  FriendInfo,
  GroupInfo,
  GroupMemberInfo,
  IdentityFetcher,
  PacketClient,
  PacketSendResult,
  SelfProfile,
  UploadedFileMeta,
  UserProfile,
} from "./context.js";
import { packetTimeoutMs } from "./context.js";
import { IncomingPacketPipeline, type IncomingPacket, type PacketHandler } from "./packet-pipeline.js";
import { buildApiHub, type PortedApiHub } from "./apis/index.js";
import { BridgeEventBusImpl } from "./events.js";
import { createLogger, errorMessage } from "../onebot/log.js";
import { MSG_PUSH_CMD, createMsgPushHandler, withSysMsgDedup } from "./msg-push-pipeline.js";
import { SysMsgDedup } from "./sysmsg-dedup.js";

const log = createLogger("Bridge");

/** One live hook connection: a PID and the packet client attached to it. */
export interface BridgeConnection {
  pid: number;
  client: PacketClient;
  /** Set false when the hook reports the receive path is broken; cleared on rebind. */
  receiveHealthy: boolean;
}

/** What `bindPid` returns so the manager can tell a rebind from a new connection. */
export interface BindPidResult {
  connection: BridgeConnection;
  /** True when this PID was not already bound to this exact client. */
  changed: boolean;
}

/**
 * The bridge session for one QQ account.
 *
 * Note `identity` is injected, not constructed: `BridgeEventBusImpl` and the API hub
 * are built here, but the roster is the caller's (in the reference it is an
 * `IdentityService`; a test supplies an in-memory object satisfying `BridgeIdentity`).
 */
export class Bridge implements BridgeContext {
  readonly identity: BridgeContext["identity"];
  readonly apis: PortedApiHub;
  readonly events: BridgeEventBus;

  /** Insertion order tracks login recency; the newest connection sends packets. */
  private readonly connections = new Map<number, BridgeConnection>();

  /** Bounded store of what this session uploaded, so a later recall can name it. */
  static readonly UPLOADED_FILE_CACHE_MAX = 1024;
  private readonly uploadedFileMeta = new Map<string, UploadedFileMeta>();

  /** Seeded so two processes started the same second do not collide. */
  private clientSeq = 1e8 + (Date.now() % 1e9);

  /** 32-bit state for the message-random LCG. */
  private msgRandom = Date.now() & 0xffffffff;

  private onlineClients: readonly unknown[] | null = null;
  private disposePromise: Promise<void> | null = null;

  /**
   * When this session was constructed, in epoch ms.
   *
   * The reference's `OneBotInstance` keeps `startedAt` and answers
   * `getUptimeMs: () => Math.max(0, Date.now() - this.startedAt)`
   * (reference:342790), which `get_status` reports as `time` — whole seconds since
   * the account service started. The equivalent epoch here is Bridge CONSTRUCTION,
   * not first-bind: a bridge that has been open for an hour before a payload
   * attaches has still been up for an hour, and `#Haizakura`'s status line reports
   * the same figure.
   *
   * It lives on `Bridge` rather than on the action host because the host is
   * constructed per caller (a test may build several), while a session has exactly
   * one start. `Date.now()` at construction cannot be negative, but the getter clamps
   * anyway — a monotonic-clock read that goes backwards must not report a negative
   * uptime to a client.
   */
  private readonly startedAtMs: number = Date.now();
  private readonly packetPipeline: IncomingPacketPipeline;

  /**
   * Survival filter for push messages (reference/index.mjs:347337 `sysMsgDedup_`).
   *
   * Stateful and per-session on purpose: the reference holds exactly one instance
   * per `Bridge`, so a dedup ring must not be shared across accounts or recycled
   * between logins.
   */
  private readonly sysMsgDedup = new SysMsgDedup();

  constructor(identity: BridgeContext["identity"], pipeline?: IncomingPacketPipeline) {
    this.identity = identity;
    this.apis = buildApiHub(this);
    this.events = new BridgeEventBusImpl();
    this.packetPipeline = pipeline ?? new IncomingPacketPipeline({
      publish: async (events) => {
        for (const event of events) {
          if (event && typeof event === "object" && "kind" in event && typeof event.kind === "string") {
            await this.events.emit(event as BridgeEvent);
          }
        }
      },
      onError: (error, packet, phase) => {
        log.error("inbound packet %s failure for %s seq=%d: %s", phase, packet.cmd, packet.seq, error instanceof Error ? error.stack ?? error.message : String(error));
      },
    });
    // reference/index.mjs:347367 — the MsgPush parser is registered on the shared
    // pipeline, and the dedup runs BEFORE any decoder (see `withSysMsgDedup`).
    // Registration appends rather than replaces, so this must happen exactly once.
    this.packetPipeline.registerCmd(
      MSG_PUSH_CMD,
      createMsgPushHandler({ dedup: withSysMsgDedup(this.sysMsgDedup) }),
    );
    // Mirrors the reference's `online_devices_changed` subscription: the snapshot is
    // re-frozen on every event so `getOnlineClients` can hand out a stable array.
    this.events.on("online_devices_changed", (event) => {
      const devices = (event as { devices?: readonly unknown[] }).devices ?? [];
      const snapshot = devices.map((device) =>
        Object.freeze({ ...(device as Record<string, unknown>) }),
      );
      this.onlineClients = Object.freeze(snapshot);
      log.debug(
        "online-device snapshot updated: uin=%s clients=%d",
        this.identity.uin,
        snapshot.length,
      );
    });
  }

  // -------------------------------------------------------------------------
  // Session lifecycle
  // -------------------------------------------------------------------------

  /**
   * Shut the session down: drop connections, settle pending packet work, close the
   * identity, clear subscribers. Idempotent — the second call returns the same
   * promise, so two shutdown paths (hook saysto and manager dispose) cannot
   * double-close the roster.
   */
  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.connections.clear();
    this.onlineClients = null;
    this.disposePromise = (async () => {
      try {
        await this.identity.close();
      } finally {
        // In `finally` so a roster that fails to close cannot leak subscribers.
        this.events.clear();
      }
    })();
    return this.disposePromise;
  }

  /** True while the session accepts work. Used to bail out of long warmups. */
  stillOpen(): boolean {
    return this.disposePromise === null;
  }

  // -------------------------------------------------------------------------
  // Connection bookkeeping
  // -------------------------------------------------------------------------

  /**
   * Attach a packet client to a PID, making it the active sender.
   *
   * Re-binding the same PID to the same client is a no-op for identity but still
   * moves it to the end of the insertion order — "newest sends packets" — and
   * clears `receiveHealthy`, because a fresh hook binding resets liveness.
   */
  bindPid(pid: number, client: PacketClient): BindPidResult {
    // Whether this session already had a process, taken BEFORE the insert. This is
    // the port's equivalent of the reference's `ensureSession(...).created`
    // (reference/index.mjs:347797): a session that goes from "no process" to "one
    // process" is a login, and a second PID on an already-live session is not.
    const wasEmpty = this.connections.size === 0;
    const existing = this.connections.get(pid);
    this.connections.delete(pid);
    const connection: BridgeConnection =
      existing?.client === client ? existing : { pid, client, receiveHealthy: true };
    connection.receiveHealthy = true;
    this.connections.set(pid, connection);
    if (wasEmpty) this.publishSessionEdge(SESSION_STARTED, { uin: this.identity.uin });
    return { connection, changed: existing?.client !== client };
  }

  /** Drop one PID. Returns true when it was the active sender that went away. */
  detachPid(pid: number): boolean {
    const wasActive = this.activePid === pid;
    const existed = this.connections.has(pid);
    this.connections.delete(pid);
    if (wasActive && this.activeConnection) {
      log.debug(
        "packet sender changed: UIN=%s PID=%d→%d",
        this.identity.uin,
        pid,
        this.activeConnection.pid,
      );
    }
    // Only a detach that actually removed a connection can end a session, and only
    // when it was the last one. The `existed` guard matters: `detachPid` is called
    // unconditionally during shutdown (`HaizakuraRuntime.stop`), so without it an
    // already-empty bridge would announce a closure on every teardown.
    if (existed && this.connections.size === 0) {
      this.publishSessionEdge(SESSION_CLOSED, { uin: this.identity.uin, pid });
    }
    return wasActive;
  }

  /**
   * Publish one session-lifecycle edge on the event bus.
   *
   * The reference does NOT use its event bus for this: `BridgeManager` calls
   * `fireSessionStarted` / `fireSessionClosed` on its own subscriber set
   * (reference/index.mjs:347736-L347750), because the manager owns session
   * creation and the bus is per-session. This port has one `Bridge` per account
   * and no manager, so `bindPid`/`detachPid` are the only two places a session can
   * begin or end — publishing from exactly there is what makes "no session event
   * was missed" a property of the code rather than a hope. See
   * `src/host/notification-source.ts` for the consumer.
   *
   * `void ... .catch` on purpose: `emit` never rejects (it uses `allSettled`), and
   * a synchronous listener must not be able to fail a `bindPid` that has already
   * mutated the connection map. The `catch` is belt-and-braces against a bus
   * implementation that violates that contract.
   */
  private publishSessionEdge(kind: string, payload: Record<string, unknown>): void {
    const event: BridgeEvent = {
      kind,
      time: Math.floor(Date.now() / 1_000),
      ...payload,
    };
    // `void` + `catch`: the edge is fire-and-forget for the bridge itself. Nothing
    // in the send path may wait on a notification decision.
    void this.events.emit(event).catch((error: unknown) => {
      log.warn("session edge %s could not be published: %s", kind, errorMessage(error));
    });
  }

  hasPid(pid: number): boolean {
    return this.connections.has(pid);
  }

  /** No connection at all — the account is "logged out" from the hook's view. */
  get empty(): boolean {
    return this.connections.size === 0;
  }

  /** The newest connection, which sends every packet. */
  get activeConnection(): BridgeConnection | undefined {
    return [...this.connections.values()].at(-1);
  }

  get activePid(): number | null {
    return this.activeConnection?.pid ?? null;
  }

  /** True when ANY connection reports a healthy receive path. */
  get receiveHealthy(): boolean {
    return [...this.connections.values()].some((connection) => connection.receiveHealthy);
  }

  /**
   * Set one PID's receive health.
   *
   * THROWS on an unknown PID rather than ignoring it: the only caller is the
   * manager, which has already proven the PID is mapped, so an unknown PID means a
   * bookkeeping bug and silently accepting it would hide the bug until packets start
   * disappearing.
   */
  setPidReceiveHealthy(pid: number, healthy: boolean): void {
    const connection = this.connections.get(pid);
    if (!connection) {
      throw new Error(`Bridge receive-health invariant violated: PID=${String(pid)} is not attached`);
    }
    connection.receiveHealthy = healthy;
  }

  getOnlineClients(): readonly unknown[] | null {
    return this.onlineClients;
  }

  /**
   * Milliseconds this session has been up (reference:342790
   * `getUptimeMs: () => Math.max(0, Date.now() - this.startedAt)`).
   *
   * Never negative, and never `null`: a bridge that exists has a start time, unlike
   * `HaizakuraRuntime.uptimeMs()`, which answers `null` before `start()` because that
   * object is constructed before it is running.
   */
  getUptimeMs(): number {
    return Math.max(0, Date.now() - this.startedAtMs);
  }

  /** Register a parser for one inbound service command. */
  registerCmd(cmd: string, handler: PacketHandler): void {
    this.packetPipeline.registerCmd(cmd, handler);
  }

  /** Whether an inbound parser is registered for this command. */
  handlesCmd(cmd: string): boolean {
    return this.packetPipeline.handlesCmd(cmd);
  }

  /**
   * Accept one normalized inbound packet. Initialization delays ingress; packets
   * are otherwise rejected unless the session is logged in and both UINs are valid.
   */
  async onPacket(packet: IncomingPacket): Promise<void> {
    await this.identity.initialization;
    if (!this.stillOpen() || !this.identity.selfProfile) return;
    if (!isRealUin(packet.uin) || packet.uin !== this.identity.uin) return;
    await this.packetPipeline.process(packet);
  }

  // -------------------------------------------------------------------------
  // The transport
  // -------------------------------------------------------------------------

  /**
   * Send one raw packet to QQ and await its reply.
   *
   * Never throws for the "no sender" case — see this file's header for why the
   * `-1` sentinel must reach `invokeOidb` as a result rather than as a rejection.
   */
  async sendRawPacket(serviceCmd: string, body: Uint8Array, timeoutMs = packetTimeoutMs()): Promise<PacketSendResult> {
    const connection = this.activeConnection;
    if (!connection) {
      log.warn("packet %s dropped: no packet sender attached", serviceCmd);
      return {
        success: false,
        gotResponse: false,
        errorCode: -1,
        errorMessage: "no packet sender attached",
      };
    }
    const startedAt = Date.now();
    // `Buffer.from(body)` copies: a caller that reuses its buffer must not be able to
    // mutate bytes that are already in flight.
    const result = await connection.client.sendPacket(serviceCmd, Buffer.from(body), timeoutMs);
    const elapsed = Date.now() - startedAt;
    if (!result.success || result.errorCode !== 0) {
      log.warn(
        "packet %s failed: code=%s gotResponse=%s %s (uin=%s, %dB, %dms)",
        serviceCmd,
        String(result.errorCode),
        String(result.gotResponse),
        result.errorMessage ?? "",
        this.identity.uin,
        body.length,
        elapsed,
      );
    } else {
      const responseLength = result.responseData ? result.responseData.length : 0;
      log.trace(
        "packet %s ok (%dB ⇄ %dB, %dms)",
        serviceCmd,
        body.length,
        responseLength,
        elapsed,
      );
    }
    return result;
  }

  /**
   * Resolve a uin to its uid, preferring the group-scoped uid when a group is given.
   *
   * Delegates straight to the identity roster; the `groupId` hint exists because a
   * member's uid can differ per group on QQ's newer accounts.
   */
  async resolveUserUid(uin: number | string, groupId?: number): Promise<string> {
    const resolved = await this.identity.resolveUid(uin, groupId);
    if (typeof resolved !== "string") {
      throw new Error(`identity.resolveUid returned ${typeof resolved} for uin=${String(uin)}`);
    }
    return resolved;
  }

  // -------------------------------------------------------------------------
  // Sequence / random generators
  // -------------------------------------------------------------------------

  /** Monotonic client sequence. Starts above 1e8 so it never collides with a small id. */
  nextClientSequence(): number {
    return ++this.clientSeq;
  }

  /**
   * The next message-random.
   *
   * `msgRandom + 2654435769 >>> 0` is Knuth's multiplicative step on 32 bits, and
   * the `& 0x7FFFFFFF` keeps the result a positive int32 because the field is
   * encoded as a signed varint and a negative random changes the packet layout.
   * The `>>> 0` must come BEFORE the mask, not after.
   */
  nextMessageRandom(): number {
    this.msgRandom = (this.msgRandom + 2654435769) >>> 0;
    return this.msgRandom & 0x7fffffff;
  }

  // -------------------------------------------------------------------------
  // Uploaded-file memory
  // -------------------------------------------------------------------------

  /**
   * Remember one uploaded file's metadata.
   *
   * Evicts the OLDEST entry once the cache is full, so the bound is on entries, not
   * bytes. A `meta` without a `fileId` is dropped rather than stored under `""`,
   * because `""` would then be found by every lookup that forgets its argument.
   */
  rememberUploadedFile(meta: UploadedFileMeta): void {
    if (!meta.fileId) return;
    if (this.uploadedFileMeta.size >= Bridge.UPLOADED_FILE_CACHE_MAX) {
      const oldest = this.uploadedFileMeta.keys().next().value;
      if (oldest !== undefined) this.uploadedFileMeta.delete(oldest);
    }
    this.uploadedFileMeta.set(meta.fileId, meta);
  }

  recallUploadedFile(fileId: string): UploadedFileMeta | undefined {
    if (!fileId) return;
    return this.uploadedFileMeta.get(fileId);
  }

  /** Number of remembered uploads. Used by diagnostics and tests, not by APIs. */
  get uploadedFileCount(): number {
    return this.uploadedFileMeta.size;
  }
}

/**
 * A minimal in-memory roster: the `BridgeIdentity` slice with no SQLite, no network
 * and no retry queue.
 *
 * This is NOT a port of `IdentityService` (1074 lines, `../protocol/src/identity-service.ts`).
 * It exists so every ported API is reachable in a test and so `Bridge` is
 * constructible today; the durable roster remains a separate job. What it does
 * model faithfully is the identity mapping rules, because those are what the OIDB
 * specs depend on:
 *
 *   * `uin` is a STRING and stays one — several URL builders concatenate it.
 *   * `selfUid` is `""` before warmup and becomes the profile's uid afterwards.
 *   * `findUidByUin` / `findUinByUid` are SYNCHRONOUS, cache-only lookups that
 *     return `null` on a miss; `resolveUid` is the one with a network fallback and
 *     it is the only one that throws.
 *   * Member uids are group-scoped, so an unscoped lookup only sees the self uid
 *     and friends.
 */
export class MemoryIdentity implements BridgeIdentity {
  readonly uin: string;
  nickname: string;
  private selfProfileValue: SelfProfile | null = null;
  private readonly friendsByUin = new Map<number, FriendInfo>();
  private readonly friendsByUid = new Map<string, FriendInfo>();
  private readonly groupsById = new Map<number, GroupInfo>();
  private readonly membersByGroup = new Map<number, Map<number, GroupMemberInfo>>();
  private readonly requests: unknown[] = [];
  private fetcher: IdentityFetcher | null = null;

  constructor(uin: string, nickname: string = uin) {
    this.uin = uin;
    this.nickname = nickname;
  }

  get selfProfile(): SelfProfile | null {
    return this.selfProfileValue;
  }

  get selfUid(): string | null {
    return this.selfProfileValue?.uid ?? null;
  }

  /** Nothing to wait for: this roster is synchronous, so the promise is already resolved. */
  get initialization(): Promise<void> {
    return Promise.resolve();
  }

  get friends(): readonly FriendInfo[] {
    return [...this.friendsByUin.values()];
  }

  get groups(): readonly GroupInfo[] {
    return [...this.groupsById.values()];
  }

  setFetcher(fetcher: IdentityFetcher): void {
    this.fetcher = fetcher;
  }

  setSelfProfile(info: SelfProfile): void {
    this.selfProfileValue = { ...info };
    this.nickname = info.nickname || this.uin;
  }

  /**
   * UIN → UID. Cache first, then a network fetch through the installed fetcher.
   *
   * THROWS when both miss, matching the reference: `resolveUid` is used by the OIDB
   * `serialize` hooks where a missing uid means the request cannot be built at all.
   */
  async resolveUid(uin: number | string, groupId?: number): Promise<string> {
    const numeric = Number(uin);
    const cached = this.findUidByUin(numeric, groupId);
    if (cached !== null) return cached;
    if (groupId !== undefined) {
      const member = this.membersByGroup.get(groupId)?.get(numeric);
      if (member?.uid) return member.uid;
    }
    const friend = this.friendsByUin.get(numeric);
    if (friend?.uid) return friend.uid;
    if (!this.fetcher) throw new Error(`cannot resolve uid for uin ${String(uin)}: no fetcher installed`);
    const profile = await this.fetcher.fetchProfile(numeric);
    this.rememberUserProfile(profile);
    return profile.uid;
  }

  /** UID → UIN. NEVER throws — inbound events still have to be emitted. */
  async resolveUin(uid: string, _groupId?: number): Promise<number | null> {
    const cached = this.findUinByUid(uid);
    if (cached !== null) return cached;
    if (!this.fetcher) return null;
    try {
      const profile = await this.fetcher.fetchProfileByUid(uid);
      this.rememberUserProfile(profile);
      return profile.uin;
    } catch {
      return null;
    }
  }

  findUidByUin(uin: number | string, groupId?: number): string | null {
    const numeric = Number(uin);
    if (numeric === Number(this.uin)) return this.selfUid;
    if (groupId !== undefined) {
      const member = this.membersByGroup.get(groupId)?.get(numeric);
      if (member?.uid) return member.uid;
    }
    return this.friendsByUin.get(numeric)?.uid ?? null;
  }

  findUinByUid(uid: string, _groupId?: number): number | null {
    if (!uid) return null;
    if (uid === this.selfUid) return Number(this.uin);
    const friend = this.friendsByUid.get(uid);
    if (friend) return friend.uin;
    for (const members of this.membersByGroup.values()) {
      for (const member of members.values()) if (member.uid === uid) return member.uin;
    }
    return null;
  }

  findUserProfile(uin: number): UserProfile | null {
    if (uin === Number(this.uin) && this.selfProfileValue) return { ...this.selfProfileValue };
    const friend = this.friendsByUin.get(uin);
    if (!friend) return null;
    return {
      uin: friend.uin,
      uid: friend.uid,
      nickname: friend.nickname,
      remark: friend.remark,
      qid: "",
      sex: "unknown",
      age: 0,
      sign: "",
      avatar: "",
      level: 0,
      qidianMasterFlag: 0,
      qidianCrewFlag: 0,
      qidianCrewFlag2: 0,
    };
  }

  findFriend(uin: number): FriendInfo | null {
    return this.friendsByUin.get(uin) ?? null;
  }

  findGroup(groupId: number): GroupInfo | null {
    return this.groupsById.get(groupId) ?? null;
  }

  findGroupMember(groupId: number, uin: number): GroupMemberInfo | null {
    return this.membersByGroup.get(groupId)?.get(uin) ?? null;
  }

  rememberFriends(friends: readonly FriendInfo[]): void {
    for (const friend of friends) {
      this.friendsByUin.set(friend.uin, friend);
      if (friend.uid) this.friendsByUid.set(friend.uid, friend);
    }
  }

  rememberGroups(groups: readonly GroupInfo[]): void {
    for (const group of groups) this.groupsById.set(group.groupId, group);
  }

  /** Forgetting a group also drops its members: a stale member map outlives the group. */
  forgetGroup(groupId: number): void {
    this.groupsById.delete(groupId);
    this.membersByGroup.delete(groupId);
  }

  rememberGroupMembers(groupId: number, members: readonly GroupMemberInfo[]): void {
    let map = this.membersByGroup.get(groupId);
    if (!map) {
      map = new Map();
      this.membersByGroup.set(groupId, map);
    }
    for (const member of members) map.set(member.uin, member);
  }

  rememberUserProfile(info: UserProfile): void {
    if (info.uin === Number(this.uin)) {
      this.setSelfProfile(info);
      return;
    }
    this.rememberFriends([
      { uin: info.uin, uid: info.uid, nickname: info.nickname, remark: info.remark },
    ]);
  }

  updateGroupMember(groupId: number, member: GroupMemberInfo): void {
    this.rememberGroupMembers(groupId, [member]);
  }

  rememberGroupRequests(requests: readonly unknown[]): void {
    this.requests.push(...requests);
  }

  /** The accumulated join requests. Exposed for tests; no API reads it. */
  get groupInvites(): readonly unknown[] {
    return this.requests;
  }

  async close(): Promise<void> {
    this.friendsByUin.clear();
    this.friendsByUid.clear();
    this.groupsById.clear();
    this.membersByGroup.clear();
    this.requests.length = 0;
    this.fetcher = null;
  }
}

/**
 * Published by `bindPid` when a session acquires its FIRST connection.
 *
 * Not in the reference's bus vocabulary: the reference announces this through
 * `BridgeManager.fireSessionStarted` (reference/index.mjs:347736) instead, because
 * its bus is per-session and its manager owns session creation. This port has no
 * manager, so the edge is published here. The name mirrors the reference's method
 * so the mapping is obvious.
 */
export const SESSION_STARTED = "session_started" as const;

/**
 * Published by `detachPid` when the LAST connection goes away.
 *
 * Carries `{ uin, pid }` where `pid` is the process that was just detached — the
 * notification wants to name it, and `bridge.activePid` is already `null` by the
 * time a listener runs. See `src/host/notification-source.ts`.
 */
export const SESSION_CLOSED = "session_closed" as const;

/** The event kinds `Bridge` itself emits. Exported so subscribers need no strings. */
export const BRIDGE_EVENT_KINDS = [
  "online_devices_changed",
  SESSION_STARTED,
  SESSION_CLOSED,
] as const satisfies readonly BridgeEvent["kind"][];

/**
 * Whether `uin` is a plausible QQ account number: 5–10 decimal digits.
 *
 * Exported because the OneBot config layer needs the same test to gate
 * `loadOneBotConfig(uin)` — the reference interpolates `uin` straight into a
 * filename without validating it, which is a path-traversal hole. Gating at that
 * door is a deliberate divergence, and it must use the same predicate as the rest
 * of the bridge or the two layers disagree about which accounts exist.
 */
export function isRealUin(uin: unknown): uin is string {
  return typeof uin === "string" && /^\d{5,10}$/.test(uin);
}

/** Re-exported for callers that only have the concrete class. */
export type { BridgeApiHub };