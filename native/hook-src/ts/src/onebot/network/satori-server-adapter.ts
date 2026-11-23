import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

import {
  IOneBotNetworkAdapter,
  isAuthorized,
  normalizePath,
  parseRequestPath,
  rawDataToString,
  safeClose,
  safeSend,
  type AdapterStatus,
  type NetworkBaseConfig,
  type SendableSocket,
  type WsServerConfig,
} from "../adapter.js";
import { WebSocketServer, type WebSocket } from "../websocket.js";
import { readRequestBody, RequestBodyTooLargeError, writeJson } from "../http.js";
import type { OneBotNetworkContext } from "../types.js";

const EVENTS_PATH = "/v1/events";
const INVALID_TOKEN = 4004;
const INVALID_FRAME = 4000;

interface SatoriConfig extends WsServerConfig {}
interface Connection {
  socket: WebSocket;
  identified: boolean;
  identifyTimer: NodeJS.Timeout | null;
  /**
   * The highest event `sn` this client has acknowledged, or 0 before it has said anything.
   *
   * Satori's resume contract: a reconnecting client sends the `sn` of the last event it
   * processed in its IDENTIFY body, and the server may replay everything after it. We record
   * the value so a resume is at least observable; the reference does the same
   * (`connection.lastSn = resumeSn`, index.mjs:344429) and likewise does not replay.
   */
  lastSn: number;
}

type SatoriHandler = (ctx: OneBotNetworkContext, body: Record<string, unknown>) => Promise<unknown>;

function valueNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function user(id: unknown, name?: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = { id: String(id ?? ""), avatar: `http://q.qlogo.cn/headimg_dl?dst_uin=${String(id ?? "")}&spec=640`, is_bot: false };
  if (name !== undefined && String(name).trim()) result.name = result.nick = String(name);
  return result;
}

function channelId(body: Record<string, unknown>): { group: boolean; id: number; user: string } {
  const raw = String(body.channel_id ?? "");
  const direct = raw.startsWith("private:");
  const id = direct ? raw.slice(8) : raw;
  return { group: !direct, id: valueNumber(id), user: direct ? id : "" };
}

/**
 * Satori role ids ⟷ OneBot `role` strings.
 *
 * Satori numbers the roles (4/3/2) while OneBot names them (owner/admin/member), so every
 * `guild.member.*` call crosses this table. Reference: `satoriRoleIdFromOneBot` /
 * `satoriRoleNameFromId` (index.mjs:343335-343347).
 */
const SATORI_ROLE_IDS: Record<string, string> = {
  "4": "owner",
  owner: "owner",
  "3": "admin",
  admin: "admin",
  "2": "member",
  member: "member",
};

function roleNameFromId(roleId: unknown): string {
  return SATORI_ROLE_IDS[String(roleId ?? "").trim()] ?? "member";
}

/** `guild.role.list` is static — Satori defines exactly three fixed roles. */
const SATORI_ROLES = [
  { id: "4", name: "owner", position: 3 },
  { id: "3", name: "admin", position: 2 },
  { id: "2", name: "member", position: 1 },
];

/**
 * The capability list advertised by `login.get`.
 *
 * The reference advertises 26 names (index.mjs:343812-343838), two of which — `message.list.from`
 * and `guild.plain` — have no handler and therefore answer 404. We advertise what we actually
 * serve: the 24 real methods. A client that trusts this list can call every entry in it.
 */
const SATORI_FEATURES = [
  "login.get",
  "message.create",
  "message.get",
  "message.delete",
  "message.list",
  "channel.get",
  "channel.list",
  "guild.get",
  "guild.list",
  "guild.member.get",
  "guild.member.list",
  "guild.member.kick",
  "guild.member.mute",
  "guild.member.role.set",
  "guild.member.approve",
  "guild.approve",
  "guild.role.list",
  "reaction.create",
  "reaction.delete",
  "reaction.list",
  "user.get",
  "friend.list",
  "friend.delete",
  "friend.approve",
];

/** A Satori message id is a decimal string; `0` is never a valid target. */
function requireMessageId(body: Record<string, unknown>): number {
  const id = valueNumber(body.message_id);
  if (id === 0) throw new Error("message_id is required");
  return id;
}

/** `guild_id` is mandatory on every `guild.*` and `channel.list` call. */
function requireGuildId(body: Record<string, unknown>): number {
  const id = valueNumber(body.guild_id) || channelId(body).id;
  if (id <= 0) throw new Error("guild_id is required");
  return id;
}

function guild(id: unknown, name: unknown): Record<string, unknown> {
  const text = String(id ?? "");
  return { id: text, name: String(name ?? ""), avatar: `https://p.qlogo.cn/gh/${text}/${text}/640` };
}

function channel(id: unknown, name: unknown, isDirect: boolean): Record<string, unknown> {
  return { id: String(id ?? ""), type: isDirect ? 1 : 0, name: String(name ?? "") };
}

/** A `guild.member` object: Satori nests the user inside the member. */
function member(row: Record<string, unknown>, guildId: unknown): Record<string, unknown> {
  const userId = row.user_id;
  const result: Record<string, unknown> = {
    user: user(userId, row.nickname),
    nick: String(row.card ?? row.nickname ?? ""),
    avatar: `http://q.qlogo.cn/headimg_dl?dst_uin=${String(userId ?? "")}&spec=640`,
    roles: [SATORI_ROLE_IDS[String(row.role ?? "member")] ?? "member"],
  };
  // `join_time` is in SECONDS on the OneBot wire and MILLISECONDS in Satori. A zero means
  // "unknown" (the server omits it for a bot that never joined), and must not become 1970.
  const joinTime = valueNumber(row.join_time);
  if (joinTime > 0) result.joined_at = joinTime * 1000;
  if (guildId !== undefined) result.guild_id = String(guildId);
  return result;
}

function makeApi(): Record<string, SatoriHandler> {
  return {
    "login.get": async (ctx) => {
      const response = await ctx.api.handle("get_login_info", {});
      const id = response.data && typeof response.data === "object" ? (response.data as Record<string, unknown>).user_id : ctx.uin;
      const name = response.data && typeof response.data === "object" ? (response.data as Record<string, unknown>).nickname : undefined;
      return { sn: 1, adapter: "haizakura", platform: "haizakura", user: user(id, name), status: 1, features: [...SATORI_FEATURES] };
    },
    "message.create": async (ctx, body) => {
      const c = channelId(body);
      const content = String(body.content ?? "");
      // The reference refuses a message with no sendable element rather than sending an empty
      // one (index.mjs:343866-343870). An empty text is the common way to get here by accident.
      if (content.trim() === "") throw new Error("content must contain at least one sendable element");
      const res = await ctx.api.handle(c.group ? "send_group_msg" : "send_private_msg", {
        ...(c.group ? { group_id: c.id } : { user_id: c.id }), message: content,
      });
      if (res.status !== "ok") throw new Error(res.wording || "message send failed");
      const data = res.data && typeof res.data === "object" ? (res.data as Record<string, unknown>) : {};
      const created: Record<string, unknown> = {
        id: String(data.message_id ?? ""),
        content,
        channel: channel(body.channel_id, "", !c.group),
        user: user(ctx.uin),
        created_at: Date.now(),
      };
      // A group message belongs to a guild; a private one has no guild at all, and the reference
      // omits the field rather than sending an empty object.
      if (c.group) created.guild = guild(c.id, "");
      // Satori's `message.create` answers with an ARRAY (index.mjs:343873), because one create
      // may fan out to several channels. Answering with a bare object makes every conforming
      // client read `[0]` of an object and see `undefined`.
      return [created];
    },
    "message.delete": async (ctx, body) => {
      const res = await ctx.api.handle("delete_msg", { message_id: requireMessageId(body) });
      if (res.status !== "ok") throw new Error(res.wording || "message delete failed");
      return null;
    },
    "message.get": async (ctx, body) => {
      const res = await ctx.api.handle("get_msg", { message_id: requireMessageId(body) });
      if (res.status !== "ok" || !res.data) throw new Error(res.wording || "message not found");
      const row = res.data as Record<string, unknown>;
      // Decode into a Satori Message instead of leaking the OneBot event shape, which has no
      // `content`/`channel`/`user` keys at all.
      const groupId = row.group_id;
      const isGroup = groupId !== undefined && valueNumber(groupId) > 0;
      const target = isGroup ? valueNumber(groupId) : valueNumber(row.user_id);
      const senderId = row.sender && typeof row.sender === "object" ? (row.sender as Record<string, unknown>).user_id : row.user_id;
      const decoded: Record<string, unknown> = {
        id: String(row.message_id ?? body.message_id ?? ""),
        content: String(row.raw_message ?? ""),
        channel: channel(isGroup ? String(target) : `private:${String(target)}`, "", !isGroup),
        user: user(senderId),
      };
      if (isGroup) decoded.guild = guild(groupId, "");
      const time = valueNumber(row.time);
      if (time > 0) decoded.created_at = time * 1000;
      return decoded;
    },
    "message.list": async (ctx, body) => {
      const c = channelId(body);
      // Satori caps a page at 100 and falls back to 50 for a nonsensical limit
      // (index.mjs:343904-343910). Defaulting to 20 silently truncates.
      const rawLimit = valueNumber(body.limit) || 50;
      const limit = rawLimit <= 0 || rawLimit > 100 ? 50 : rawLimit;
      // The anchor is `message_id`; `next` is the same thing under the name a paging client
      // echoes back from the previous response.
      const anchor = valueNumber(body.message_id) || valueNumber(body.next);
      const order = String(body.order ?? "desc");
      const request: Record<string, unknown> = {
        ...(c.group ? { group_id: c.id } : { user_id: c.id }),
        count: limit,
        // Satori's `desc` means newest-first, which the history action expresses as
        // `reverse_order: true`. Without this the page comes back in the opposite order.
        reverse_order: order === "desc",
      };
      if (anchor !== 0) request.message_id = anchor;
      const res = await ctx.api.handle(c.group ? "get_group_msg_history" : "get_friend_msg_history", request);
      // The history action answers `{ messages: [...] }`, NOT an array. Reading `res.data`
      // directly yields the wrapper object, which `Array.isArray` rejects — so this method
      // returned an empty list for every request and looked like "no history".
      const rows = res.data && typeof res.data === "object" && Array.isArray((res.data as Record<string, unknown>).messages)
        ? ((res.data as Record<string, unknown>).messages as Record<string, unknown>[])
        : Array.isArray(res.data)
          ? (res.data as Record<string, unknown>[])
          : [];
      const data = rows.map((row) => {
        const item = row as Record<string, unknown>;
        const senderId = item.sender && typeof item.sender === "object" ? (item.sender as Record<string, unknown>).user_id : item.user_id;
        const decoded: Record<string, unknown> = {
          id: String(item.message_id ?? ""),
          content: String(item.raw_message ?? ""),
          channel: channel(body.channel_id, "", !c.group),
          user: user(senderId),
        };
        if (c.group) decoded.guild = guild(c.id, "");
        const time = valueNumber(item.time);
        if (time > 0) decoded.created_at = time * 1000;
        return decoded;
      });
      const result: Record<string, unknown> = { data };
      // Only advertise a cursor when the page is full: a partial page means there is nothing
      // after it, and a `next` pointing past the end makes a client loop forever.
      if (data.length > 0 && data.length === limit) result.next = data[data.length - 1]!.id;
      return result;
    },
    "channel.get": async (ctx, body) => {
      const c = channelId(body);
      if (!c.group) {
        const res = await ctx.api.handle("get_stranger_info", { user_id: c.id });
        const name = res.data && typeof res.data === "object" ? (res.data as Record<string, unknown>).nickname : "";
        return channel(body.channel_id, name, true);
      }
      const res = await ctx.api.handle("get_group_info", { group_id: c.id });
      const name = res.data && typeof res.data === "object" ? ((res.data as Record<string, unknown>).group_name ?? "") : "";
      return channel(body.channel_id, name, false);
    },
    "channel.list": async (ctx, body) => {
      // A Satori channel is a conversation INSIDE a guild. Ignoring `guild_id` and returning
      // every group in the account is the wrong collection under the right name.
      const guildId = requireGuildId(body);
      const res = await ctx.api.handle("get_group_info", { group_id: guildId });
      const name = res.data && typeof res.data === "object" ? ((res.data as Record<string, unknown>).group_name ?? "") : "";
      return { data: [channel(String(guildId), name, false)] };
    },
    "guild.get": async (ctx, body) => {
      const guildId = requireGuildId(body);
      const res = await ctx.api.handle("get_group_info", { group_id: guildId });
      const row = res.data && typeof res.data === "object" ? (res.data as Record<string, unknown>) : {};
      return guild(guildId, row.group_name ?? row.group_remark ?? "");
    },
    "guild.list": async (ctx) => {
      const res = await ctx.api.handle("get_group_list", {});
      return { data: (Array.isArray(res.data) ? res.data : []).map((row) => {
        const item = row as Record<string, unknown>;
        return guild(item.group_id, item.group_name);
      }) };
    },
    "guild.member.get": async (ctx, body) => {
      const guildId = requireGuildId(body);
      const userId = valueNumber(body.user_id);
      if (!userId) throw new Error("user_id is required");
      const res = await ctx.api.handle("get_group_member_info", { group_id: guildId, user_id: userId });
      if (res.status !== "ok" || !res.data) throw new Error(res.wording || "member not found");
      return member(res.data as Record<string, unknown>, guildId);
    },
    "guild.member.list": async (ctx, body) => {
      const guildId = requireGuildId(body);
      const res = await ctx.api.handle("get_group_member_list", { group_id: guildId });
      const rows = Array.isArray(res.data) ? res.data : [];
      return { data: rows.map((row) => member(row as Record<string, unknown>, guildId)) };
    },
    "guild.member.kick": async (ctx, body) => {
      const guildId = requireGuildId(body);
      const userId = valueNumber(body.user_id);
      if (!userId) throw new Error("user_id is required");
      const res = await ctx.api.handle("set_group_kick", {
        group_id: guildId,
        user_id: userId,
        // Satori's `permanent` is OneBot's `reject_add_request`.
        reject_add_request: body.permanent === true,
      });
      if (res.status !== "ok") throw new Error(res.wording || "kick failed");
      return null;
    },
    "guild.member.mute": async (ctx, body) => {
      const guildId = requireGuildId(body);
      const userId = valueNumber(body.user_id);
      if (!userId) throw new Error("user_id is required");
      // Satori takes MILLISECONDS, OneBot takes SECONDS. Round up so a 1 ms mute is still a
      // mute; `Math.floor` would turn anything under a second into an unmute.
      const durationMs = valueNumber(body.duration);
      const seconds = durationMs <= 0 ? 0 : Math.max(1, Math.ceil(durationMs / 1000));
      const res = await ctx.api.handle("set_group_ban", { group_id: guildId, user_id: userId, duration: seconds });
      if (res.status !== "ok") throw new Error(res.wording || "mute failed");
      return null;
    },
    "guild.member.role.set": async (ctx, body) => {
      const guildId = requireGuildId(body);
      const userId = valueNumber(body.user_id);
      if (!userId) throw new Error("user_id is required");
      const res = await ctx.api.handle("set_group_admin", {
        group_id: guildId,
        user_id: userId,
        // Only "admin" maps to a boolean; owner and member both mean "not an admin", because
        // OneBot has no separate owner flag on this action.
        enable: roleNameFromId(body.role_id) === "admin",
      });
      if (res.status !== "ok") throw new Error(res.wording || "set role failed");
      return null;
    },
    "guild.member.approve": async (ctx, body) => {
      const res = await ctx.api.handle("set_group_add_request", {
        flag: String(body.message_id ?? ""),
        sub_type: "add",
        approve: body.approve !== false,
        reason: String(body.comment ?? ""),
      });
      if (res.status !== "ok") throw new Error(res.wording || "approve failed");
      return null;
    },
    "guild.approve": async (ctx, body) => {
      const res = await ctx.api.handle("set_group_add_request", {
        flag: String(body.message_id ?? ""),
        sub_type: "invite",
        approve: body.approve !== false,
        reason: String(body.comment ?? ""),
      });
      if (res.status !== "ok") throw new Error(res.wording || "approve failed");
      return null;
    },
    "guild.role.list": async () => ({ data: SATORI_ROLES.map((role) => ({ ...role })) }),
    "reaction.create": async (ctx, body) => {
      const messageId = requireMessageId(body);
      const emojiId = String(body.emoji_id ?? "").trim();
      if (emojiId === "") throw new Error("emoji_id is required");
      const res = await ctx.api.handle("set_msg_emoji_like", { message_id: messageId, emoji_id: emojiId, set: true });
      if (res.status !== "ok") throw new Error(res.wording || "reaction failed");
      return null;
    },
    "reaction.delete": async (ctx, body) => {
      const messageId = requireMessageId(body);
      const emojiId = String(body.emoji_id ?? "").trim();
      if (emojiId === "") throw new Error("emoji_id is required");
      // Same action as create, with `set: false`. There is no separate delete command.
      const res = await ctx.api.handle("set_msg_emoji_like", { message_id: messageId, emoji_id: emojiId, set: false });
      if (res.status !== "ok") throw new Error(res.wording || "reaction failed");
      return null;
    },
    "reaction.list": async (ctx, body) => {
      const messageId = requireMessageId(body);
      const request: Record<string, unknown> = { message_id: messageId };
      if (body.emoji_id !== undefined) request.emoji_id = String(body.emoji_id);
      const res = await ctx.api.handle("get_emoji_likes", request);
      const row = res.data && typeof res.data === "object" ? (res.data as Record<string, unknown>) : {};
      const list = Array.isArray(row.emoji_like_list) ? (row.emoji_like_list as Record<string, unknown>[]) : [];
      return { data: list.map((item) => user(item.user_id, item.nick_name)) };
    },
    "user.get": async (ctx, body) => {
      const id = valueNumber(body.user_id);
      if (!id) throw new Error("user_id is required");
      const res = await ctx.api.handle("get_stranger_info", { user_id: id });
      if (res.status !== "ok" || !res.data) throw new Error(res.wording || "user not found");
      return user(id, (res.data as Record<string, unknown>).nickname);
    },
    "friend.list": async (ctx) => {
      const res = await ctx.api.handle("get_friend_list", {});
      return { data: (Array.isArray(res.data) ? res.data : []).map((row) => {
        const item = row as Record<string, unknown>;
        return { user: user(item.user_id, item.nickname ?? item.remark), nick: String(item.remark ?? "") };
      }) };
    },
    "friend.delete": async (ctx, body) => {
      const id = valueNumber(body.user_id);
      if (!id) throw new Error("user_id is required");
      const res = await ctx.api.handle("delete_friend", { user_id: id });
      if (res.status !== "ok") throw new Error(res.wording || "delete friend failed");
      return null;
    },
    "friend.approve": async (ctx, body) => {
      // The Satori `message_id` is an opaque flag here, not a message: it is the value the
      // request event carried for the client to hand back.
      const res = await ctx.api.handle("set_friend_add_request", {
        flag: String(body.message_id ?? ""),
        approve: body.approve !== false,
      });
      if (res.status !== "ok") throw new Error(res.wording || "approve failed");
      return null;
    },
  };
}

const API = makeApi();

/**
 * The handler table, for tests.
 *
 * Exported so a test can call every method directly and assert on the OneBot action it
 * dispatches to, instead of standing up an HTTP server per assertion. The table is built once
 * and is stateless (each handler reads only its `ctx` and `body`), so sharing it is safe.
 */
export const SATORI_API_FOR_TEST = API;

/** Satori v1 server mounted through an existing wsServers configuration entry. */
export class SatoriServerAdapter extends IOneBotNetworkAdapter {
  private server: Server | null = null;
  private webSocketServer: WebSocketServer | null = null;
  private listening = false;
  private accepting = false;
  private closePromise: Promise<void> | null = null;
  private readonly connections = new Map<WebSocket, Connection>();
  private readonly inFlight = new Set<Promise<void>>();
  private eventSeq = 0;

  constructor(name: string, config: SatoriConfig, ctx: OneBotNetworkContext) {
    super(name, config, ctx);
  }

  private get configValue(): SatoriConfig { return this.config as SatoriConfig; }
  private mountPrefix(): string {
    const path = normalizePath(this.configValue.path);
    return path === "/" || path === EVENTS_PATH ? "" : path;
  }
  private eventsPath(): string { return `${this.mountPrefix()}${EVENTS_PATH}`; }
  private apiPrefix(): string { return `${this.mountPrefix()}/v1/`; }

  override async open(): Promise<void> {
    if (this.isEnabled && this.listening) return;
    if (this.config.enabled === false) return;
    if (this.server) throw new Error(`Satori adapter [${this.name}] still owns a previous server`);
    await new Promise<void>((resolve, reject) => {
      const server = createServer((req, res) => this.track(() => this.handleRequest(req, res)));
      this.server = server;
      const sockets = new WebSocketServer({ noServer: true, maxPayload: this.configValue.maxPayloadBytes });
      this.webSocketServer = sockets;
      server.on("upgrade", (req, socket, head) => {
        if (parseRequestPath(req.url ?? "/") !== this.eventsPath()) {
          socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
          return;
        }
        sockets.handleUpgrade(req, socket, head, (ws) => this.acceptConnection(ws));
      });
      let opening = true;
      server.once("listening", () => {
        opening = false;
        if (this.server !== server || this.closePromise) {
          sockets.close(); server.close(); reject(new Error(`Satori adapter [${this.name}] was closed while binding`)); return;
        }
        this.listening = true; this.accepting = true; this.isEnabled = true;
        resolve();
      });
      server.on("error", (error) => {
        this.recordTransportFailure(error);
        if (opening) { opening = false; this.server = null; this.webSocketServer = null; reject(error); }
      });
      server.listen(this.configValue.port, this.configValue.host ?? "0.0.0.0");
    });
  }

  private track(start: () => Promise<void>): void {
    const action = Promise.resolve().then(start).catch((error: unknown) => this.log.warn("[%s] request failed: %s", this.name, String(error)));
    this.inFlight.add(action);
    void action.then(() => this.inFlight.delete(action));
  }

  private acceptConnection(socket: WebSocket): void {
    if (!this.accepting || this.ctx.api.isAcceptingActions === false) { safeClose(socket as unknown as SendableSocket, 1012, "server closing"); return; }
    const connection: Connection = { socket, identified: false, identifyTimer: null, lastSn: 0 };
    connection.identifyTimer = setTimeout(() => {
      if (!connection.identified && this.connections.has(socket)) safeClose(socket as unknown as SendableSocket, INVALID_FRAME, "IDENTIFY timeout");
    }, 10_000);
    connection.identifyTimer.unref?.();
    this.connections.set(socket, connection);
    socket.on("message", (raw) => this.track(async () => this.handleFrame(connection, raw)));
    socket.on("close", () => { if (connection.identifyTimer) clearTimeout(connection.identifyTimer); this.connections.delete(socket); });
    socket.on("error", (error) => this.log.warn("[%s] Satori socket error: %s", this.name, String(error)));
  }

  private async handleFrame(connection: Connection, raw: unknown): Promise<void> {
    let frame: Record<string, unknown>;
    try { frame = JSON.parse(rawDataToString(raw)) as Record<string, unknown>; }
    catch { safeClose(connection.socket as unknown as SendableSocket, INVALID_FRAME, "invalid message"); return; }
    if (frame.op === 1) { safeSend(connection.socket as unknown as SendableSocket, JSON.stringify({ op: 2, body: {} })); return; }
    if (frame.op !== 3) return;
    const body = frame.body && typeof frame.body === "object" ? frame.body as Record<string, unknown> : {};
    if (this.configValue.accessToken && String(body.token ?? "") !== this.configValue.accessToken) {
      safeClose(connection.socket as unknown as SendableSocket, INVALID_TOKEN, "invalid token"); return;
    }
    connection.identified = true;
    if (connection.identifyTimer) clearTimeout(connection.identifyTimer);
    // A reconnecting client echoes the `sn` of the last event it saw so the server can replay
    // from there. Recording it is what makes a resume distinguishable from a cold start; the
    // reference stores the same value and does not replay either (index.mjs:344429).
    const resumeSn = valueNumber(body.sn);
    if (resumeSn > 0) connection.lastSn = resumeSn;
    let logins: unknown[];
    try { logins = [await API["login.get"]!(this.ctx, {})]; }
    catch { logins = [{ sn: 1, adapter: "haizakura", platform: "haizakura", user: user(this.ctx.uin), status: 1, features: [] }]; }
    safeSend(connection.socket as unknown as SendableSocket, JSON.stringify({ op: 4, body: { logins, proxy_urls: [] } }));
  }

  override onEvent(event: Record<string, unknown>): void {
    if (!this.isEnabled || ![...this.connections.values()].some((c) => c.identified)) return;
    const converted = this.convertEvent(event);
    if (!converted) return;
    this.eventSeq += 1;
    const frame = JSON.stringify({ op: 0, body: { id: this.eventSeq, sn: this.eventSeq, timestamp: Date.now(), login: { sn: 1, adapter: "haizakura", platform: "haizakura", user: user(this.ctx.uin) }, ...converted } });
    for (const c of this.connections.values()) if (c.identified) safeSend(c.socket as unknown as SendableSocket, frame);
  }

  private convertEvent(event: Record<string, unknown>): Record<string, unknown> | null {
    const post = String(event.post_type ?? "");
    const uid = String(event.user_id ?? "");
    const gid = String(event.group_id ?? "");
    const channel = (id: string, direct = false) => ({ id, type: direct ? 1 : 0 });
    const guild = { id: gid, name: String(event.group_name ?? ""), avatar: `https://p.qlogo.cn/gh/${gid}/${gid}/640` };
    const sender = event.sender && typeof event.sender === "object" ? event.sender as Record<string, unknown> : {};
    if (post === "message" || post === "message_sent") {
      if (valueNumber(event.group_id) <= 0 && valueNumber(event.user_id) <= 0) return null;
      const direct = event.message_type === "private" || valueNumber(event.group_id) <= 0;
      const cid = direct ? `private:${uid}` : gid;
      const u = user(uid, sender.card ?? sender.nickname);
      const message: Record<string, unknown> = { id: String(event.message_id ?? ""), content: typeof event.raw_message === "string" ? event.raw_message : String(event.message ?? ""), created_at: valueNumber(event.time) * 1000 };
      const payload: Record<string, unknown> = { message, user: u, channel: channel(cid, direct) };
      if (!direct) { payload.guild = guild; payload.member = { user: u, nick: String(sender.card ?? sender.nickname ?? "") }; }
      return { type: "message-created", ...payload };
    }
    if (post === "notice") {
      const kind = String(event.notice_type ?? "");
      if (kind === "group_recall" || kind === "friend_recall") {
        const direct = kind === "friend_recall"; const cid = direct ? `private:${uid}` : gid;
        const payload: Record<string, unknown> = { message: { id: String(event.message_id ?? ""), channel: channel(cid, direct) }, channel: channel(cid, direct), user: user(event.user_id) };
        if (!direct) payload.guild = guild;
        if (valueNumber(event.operator_id) > 0 && valueNumber(event.operator_id) !== valueNumber(event.user_id)) payload.operator = user(event.operator_id);
        return { type: "message-deleted", ...payload };
      }
      if (kind === "group_increase" || kind === "group_decrease") {
        const u = user(event.user_id);
        return { type: kind === "group_increase" ? "guild-member-added" : "guild-member-removed", guild, channel: channel(gid), user: u, member: { user: u, nick: "" }, ...(valueNumber(event.operator_id) > 0 ? { operator: user(event.operator_id) } : {}) };
      }
      if (kind === "group_card" || kind === "group_admin") {
        const u = user(event.user_id);
        return { type: "guild-member-updated", guild, channel: channel(gid), user: u, member: { user: u, nick: String(event.card_new ?? ""), ...(kind === "group_admin" ? { roles: [String(event.sub_type ?? "") === "set" ? { id: "3", name: "admin" } : { id: "2", name: "member" }] } : {}) } };
      }
      if (kind === "group_msg_emoji_like") {
        const u = user(event.operator_id ?? event.user_id); const likes = Array.isArray(event.likes) ? event.likes as Array<Record<string, unknown>> : [];
        return { type: String(event.sub_type ?? "") === "remove" ? "reaction-removed" : "reaction-added", guild, channel: channel(gid), message: { id: String(event.message_id ?? ""), channel: channel(gid) }, user: u, operator: u, emoji: { id: String(likes[0]?.emoji_id ?? "") } };
      }
      if (kind === "bot_status") return { type: String(event.sub_type ?? "") === "offline" ? "login-removed" : "login-added", login: { sn: 1, adapter: "haizakura", platform: "haizakura", user: user(this.ctx.uin), status: String(event.sub_type ?? "") === "online" ? 1 : 0, features: [] } };
      return null;
    }
    if (post === "request") {
      const request = String(event.request_type ?? ""); const message = { id: String(event.flag ?? ""), content: String(event.comment ?? "") };
      if (request === "friend") return { type: "friend-request", user: user(event.user_id), message };
      if (request === "group") { const u = user(event.user_id); return { type: String(event.sub_type ?? "") === "invite" ? "guild-request" : "guild-member-request", guild, channel: channel(gid), user: u, member: { user: u, nick: "" }, message, operator: u }; }
    }
    return null;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const error = (status: number, message: string) => writeJson(res, status, { message });
    if (!this.accepting) { error(503, "server closing"); return; }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const prefix = this.apiPrefix();
    if (!url.pathname.startsWith(prefix)) { error(404, "not found"); return; }
    const method = url.pathname.slice(prefix.length);
    if (method === "events") { res.setHeader("Allow", "GET"); error(405, "please connect with WebSocket"); return; }
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); error(405, "method not allowed"); return; }
    if (!isAuthorized(req, this.configValue.accessToken ?? "")) { error(this.configValue.accessToken ? (req.headers.authorization ? 403 : 401) : 200, this.configValue.accessToken ? (req.headers.authorization ? "invalid token" : "authorization required") : ""); if (!this.configValue.accessToken) res.end("{}"); return; }
    if (req.headers["satori-platform"] !== undefined && req.headers["satori-platform"] !== "haizakura") { error(403, "login not found"); return; }
    if (req.headers["satori-user-id"] !== undefined && String(req.headers["satori-user-id"]) !== String(this.ctx.uin)) { error(403, "login not found"); return; }
    const handler = API[method];
    if (!handler) { error(404, "method not found"); return; }
    if (this.ctx.api.isAcceptingActions === false) { error(503, "server closing"); return; }
    let body: Record<string, unknown> = {};
    try {
      const text = await readRequestBody(req);
      if (text.trim()) {
        const parsed: unknown = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) { error(400, "request body must be a JSON object"); return; }
        body = parsed as Record<string, unknown>;
      }
    } catch (cause) { error(cause instanceof RequestBodyTooLargeError ? 413 : 400, "invalid JSON body"); return; }
    try { writeJson(res, 200, await handler(this.ctx, body)); }
    catch (cause) { error(400, cause instanceof Error ? cause.message : String(cause)); }
  }

  override async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.accepting = false; this.isEnabled = false; this.listening = false;
    for (const c of this.connections.values()) safeClose(c.socket as unknown as SendableSocket, 1001, "server closing");
    this.connections.clear();
    const server = this.server; const sockets = this.webSocketServer;
    const closeHttp = server ? new Promise<void>((resolve, reject) => server.close((e) => e && (e as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING" ? reject(e) : resolve())) : Promise.resolve();
    const attempt = (async () => { await Promise.all([closeHttp, Promise.all(this.inFlight)]); if (this.server === server) this.server = null; if (sockets) await new Promise<void>((resolve) => sockets.close(() => resolve())); if (this.webSocketServer === sockets) this.webSocketServer = null; })();
    this.closePromise = attempt;
    try { await attempt; } finally { this.closePromise = null; }
  }

  override forceClose(): void {
    this.accepting = false; this.isEnabled = false; this.listening = false;
    const sockets = this.webSocketServer; this.webSocketServer = null; sockets?.destroy();
    const server = this.server; this.server = null;
    const closable = server as (Server & { closeAllConnections?: () => void }) | null;
    closable?.closeAllConnections?.();
    try { server?.close(() => undefined); } catch { /* already closed */ }
  }

  override describeStatus(): AdapterStatus {
    if (!this.isEnabled) return { name: this.name, kind: "satoriServer", status: "disabled", detail: "未启用" };
    if (!this.listening) return { name: this.name, kind: "satoriServer", status: "down", detail: "未监听（端口被占用？）" };
    return { name: this.name, kind: "satoriServer", status: "ok", detail: `Satori v1 · ${this.connections.size} 个事件客户端` };
  }

  override bindingSignature(config: NetworkBaseConfig): string {
    const c = config as SatoriConfig;
    return `${c.host ?? "0.0.0.0"}:${c.port}${normalizePath(c.path ?? "/")}#${c.accessToken ?? ""}#${c.maxPayloadBytes ?? ""}`;
  }

  override onConfigReplaced(next: NetworkBaseConfig): void {
    if ((this.configValue.accessToken ?? "") !== (next.accessToken ?? "")) {
      for (const c of this.connections.values()) safeClose(c.socket as unknown as SendableSocket, 1008, "access token changed");
      this.connections.clear();
    }
  }
}
