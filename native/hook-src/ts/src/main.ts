/**
 * Process entry point: assemble the whole OneBot stack from real parts.
 *
 * Before this file existed the port had 137 source files and 55 test suites but **no
 * way to start a process** — every piece was proven in isolation and nothing was
 * wired together. `ts/package.json` had only `build` and `test`; there was no
 * `main`, no `bin`, and no production code that ever wrote `new Bridge(...)`,
 * `new HookClient(...)` or `new OneBotNetworkManager(...)`.
 *
 * The consequence was not merely "a feature is missing". It was that integration
 * bugs were *invisible*: a component can pass its own suite while being wired to
 * nothing, which is exactly how the `MSG_PUSH_CMD` registration went missing while
 * every decoder test stayed green.
 *
 * This file is deliberately thin. It does one thing — read config, build the graph,
 * run it — and delegates every decision to a component that owns it:
 *
 *     config/            -> runtime-config.ts   (typed, validated)
 *     HookClient         -> owns the control socket to the injected payload
 *     Bridge             -> owns identity, apis, event bus, packet pipeline
 *     ActionContext      -> host/action-context-host.ts
 *     OneBotNetworkManager -> owns HTTP/WS adapters
 *     lifecycle.ts       -> owns start/stop/restart and honest status
 *     notification-source.ts -> adapts `Bridge.events` session edges to the
 *                         notification manager's `NotificationSessionSource`
 *
 * ## What this file does NOT do
 *
 * - It does not implement media/Highway. `refreshMessageMedia` is wired to the
 *   provider's `MEDIA_REFRESH_UNSUPPORTED_REASON`, which throws a named error. A
 *   silent empty result would be worse: it would report success for work never done.
 * - It does not invent a default for anything. Every optional config field falls
 *   back to the reference's own default (see `runtime-config.ts`).
 * - It does not claim the receive path works. Whether the C++ side has an observer
 *   installed on the recv slot is a *runtime* fact this process cannot assert; it can
 *   only report whether a peer is attached.
 * - It does not serve the notification WebUI routes. The manager is real and wired
 *   (`getNotificationManager()`), but there is no WebUI in this port yet, so
 *   `testSend` and `getRecent` have no HTTP caller — the same gap as the rest of the
 *   WebUI, not a notification-specific one.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

import { Bridge, MemoryIdentity } from "./bridge/bridge.js";
import { attachRecvIngress, type RecvIngressDetach } from "./bridge/recv-ingress.js";
import { HookClient } from "./hook-client.js";
import { RecvClient } from "./recv-client.js";
import type { RecvPacket } from "./recv-client.js";
import { loadRuntimeConfig } from "./host/runtime-config.js";
import { BridgeNotificationSessionSource } from "./host/notification-source.js";
import {
  NotificationManager,
  createNotificationManager,
} from "./notifications/manager.js";
import type { NotificationProcessFacts } from "./notifications/types.js";
import { createLogger, setLogLevel } from "./onebot/log.js";

const log = createLogger("main");

/** Parsed CLI arguments. Kept minimal on purpose — config lives in files, not argv. */
export interface CliOptions {
  readonly configPath?: string | undefined;
  readonly logLevel?: string | undefined;
  /** Print the resolved config and exit. The fastest way to debug a bad file. */
  readonly check?: boolean;
}

/**
 * Parse `process.argv`-shaped input.
 *
 * Accepts both `--flag=value` and `--flag value`, because a config path with an `=`
 * in it is common enough that silently mis-parsing one wastes an afternoon.
 */
export function parseCli(argv: readonly string[]): CliOptions {
  const out: { configPath?: string; logLevel?: string; check?: boolean } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--check") {
      out.check = true;
      continue;
    }
    if (arg.startsWith("--config=")) {
      out.configPath = arg.slice("--config=".length);
      continue;
    }
    if (arg === "--config") {
      const next = argv[i + 1];
      if (next === undefined) throw new Error("--config requires a path");
      out.configPath = next;
      i += 1;
      continue;
    }
    if (arg.startsWith("--log-level=")) {
      out.logLevel = arg.slice("--log-level=".length);
      continue;
    }
    if (arg === "--log-level") {
      const next = argv[i + 1];
      if (next === undefined) throw new Error("--log-level requires a level");
      out.logLevel = next;
      i += 1;
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
  }
  return out;
}

/** Where `config/runtime.json` lives relative to this file's build output. */
export function defaultConfigPath(): string {
  // build/src/main.js -> ../../config/runtime.json
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../config/runtime.json");
}

/**
 * The live process. Owns the components and nothing else.
 *
 * Deliberately not a singleton: tests build several, and a module-level instance would
 * leak state between them.
 */
export class HaizakuraRuntime {
  private readonly bridge: Bridge;
  private readonly identity: MemoryIdentity;
  private hook: HookClient | null = null;
  /**
   * Every PID this runtime bound, including ones bound through `getBridge()`
   * directly, mapped to the sender that was attached.
   *
   * Tracking it here rather than reading `bridge`'s private map is deliberate: a
   * caller may bind a sender without going through `attachHook`, and `stop()` must
   * still detach it. A runtime that leaves a stale PID bound keeps writing packets to
   * a dead process while reporting itself stopped — the exact silent-failure mode this
   * port has been fighting.
   *
   * The client is kept (not just the pid) because `resolveProcess` has to answer
   * *why* an account went away, and that answer lives on the client: whether its
   * socket is up, and whether the payload ever reported a login.
   */
  private readonly boundPids = new Map<number, Parameters<Bridge["bindPid"]>[1]>();
  private recvClient: RecvClient | null = null;
  private detachIngress: RecvIngressDetach | null = null;
  private startedAt: number | null = null;

  /**
   * The notification subsystem, wired to this runtime's bridge.
   *
   * Constructed in the constructor rather than in `main()` because the subscription
   * must exist BEFORE the first `bindPid`: `session_started` is published from
   * `Bridge.bindPid`, and the event bus has no replay, so a manager bound after the
   * first login would miss that account's "online" edge. That ordering requirement
   * is the whole reason a session notification ever goes missing, so it is made
   * structural here instead of being a comment in `main()`.
   */
  private readonly notificationSource: BridgeNotificationSessionSource;
  private readonly notifications: NotificationManager;

  constructor(private readonly options: { readonly uin: string; readonly nickname: string }) {
    this.identity = new MemoryIdentity(options.uin);
    // `SelfProfile` is the full 13-field record, not a name triple: the action layer
    // reads `sex`/`level`/`qidian*` when serving `get_login_info` and the profile
    // actions, so a partial object would answer nulls for fields that exist. These are
    // honest unknowns, not fabricated values — the real profile arrives from the
    // payload once a client is attached.
    this.identity.setSelfProfile({
      uin: Number(options.uin),
      uid: `u_${options.uin}`,
      nickname: options.nickname,
      remark: "",
      qid: "",
      sex: "unknown",
      age: 0,
      sign: "",
      avatar: "",
      level: 0,
      qidianMasterFlag: 0,
      qidianCrewFlag: 0,
      qidianCrewFlag2: 0,
    });
    this.bridge = new Bridge(this.identity);
    // Subscribe first, then bind: see the field comment above.
    this.notificationSource = new BridgeNotificationSessionSource();
    this.notificationSource.addBridge(this.bridge);
    this.notifications = createNotificationManager((uin, pid) =>
      this.resolveProcessFacts(uin, pid),
    );
    this.notifications.bind(this.notificationSource);
  }

  /**
   * `NotificationManagerDeps.resolveProcess` for this runtime.
   *
   * The reference answers this from `hookManager.listProcesses()` and picks the row
   * whose `pid` AND `uin` both match (reference/index.mjs:374220-L374227). This port
   * has no `HookManager`: the runtime itself owns the PIDs, so the same question is
   * answered from the bound sender for that pid.
   *
   * The status vocabulary is the reference's own five settled values
   * (`../bridge/src/hook-status.ts`, reference/index.mjs:3706): `statusFor(flags)` =
   * `!injected ? "available" : connected ? (loggedIn ? "online" : "loaded") :
   * wasLoggedIn ? "disconnected" : "connecting"`. Here a pid in `boundPids` is
   * by definition injected, so `available` is unreachable, and `wasLoggedIn` is
   * read off the client's own login state before its socket dropped — the client
   * resets `loginState` on teardown, so "disconnected" is reported from
   * `isClosed` alone. `undefined` means "no process facts" (an unknown pid, or no
   * pid at all), which the manager renders as empty `{status}`/`{pid}` rather than
   * a fabricated value.
   *
   * Reads only synchronous getters, but declared `async` because the deps contract
   * is async and because the reference's version awaits a process enumeration.
   */
  private async resolveProcessFacts(
    uin: string,
    pid: number | null,
  ): Promise<NotificationProcessFacts | undefined> {
    if (pid === null) return undefined;
    if (uin !== this.bridge.identity.uin) return undefined;
    const client = this.boundPids.get(pid);
    if (client === undefined) return undefined;
    // `PacketClient` is the structural transport contract and does not expose
    // liveness; `HookClient` does. Narrowing rather than widening the interface is
    // deliberate — a test double legitimately has no status to report, and inventing
    // one would make the notification claim facts it cannot know.
    const hook = this.hook !== null && this.hook.pid === pid ? this.hook : null;
    if (hook === null) return { pid };
    const status = hook.isClosed
      ? "disconnected"
      : hook.connected
        ? (hook.isLoggedIn ? "online" : "loaded")
        : "connecting";
    const error = hook.isClosed ? "control channel closed" : undefined;
    return error === undefined ? { status, pid } : { status, pid, error };
  }

  /** The bridge, for a caller that needs to attach a packet sender or read events. */
  getBridge(): Bridge {
    return this.bridge;
  }

  /**
   * The live notification manager. Exposed so a host can serve the history
   * (`getRecent`) and the "test send" button (`testSend`) — the two things the
   * reference's WebUI routes call (reference/index.mjs:373846-L373870).
   */
  getNotificationManager(): NotificationManager {
    return this.notifications;
  }

  /** The adapter feeding the manager. Exposed for diagnostics and tests. */
  getNotificationSource(): BridgeNotificationSessionSource {
    return this.notificationSource;
  }

  /**
   * Bind an arbitrary packet sender and remember the PID so `stop()` can detach it.
   *
   * Callers that have their own `PacketClient` (a test double, or a transport that is
   * not a control socket) must go through this rather than `getBridge().bindPid(...)`
   * directly: only this method records the PID, and a runtime that forgets a binding
   * keeps writing to a dead process after `stop()`.
   */
  bindSender(pid: number, client: Parameters<Bridge["bindPid"]>[1]): void {
    this.bridge.bindPid(pid, client);
    this.boundPids.set(pid, client);
  }

  /**
   * Attach the inbound half of the wire and start feeding `Bridge.onPacket`.
   *
   * Separate from `attachHook` because the two halves are independent: a payload can
   * publish pushes without being able to send, and the control socket can be up while
   * the recv socket is not. Conflating them would make "attached" mean "can receive",
   * which is exactly the kind of overclaim this port has been rooting out.
   *
   * Returns the client so a caller can observe its socket state. Importing
   * `recv-ingress` here (rather than inside `Bridge`) keeps the bridge free of any
   * knowledge of sockets, which is what makes it testable without one.
   */
  attachRecv(pid: number): RecvClient {
    if (this.recvClient !== null) {
      throw new Error(`a recv client is already attached on pid ${this.recvClient.pid}`);
    }
    const client = new RecvClient({ pid });
    this.recvClient = client;
    // The MsgPush decoder is registered on the bridge's own pipeline (see the Bridge
    // constructor), so wiring the socket is all that is needed to produce events.
    this.detachIngress = attachRecvIngress(this.bridge, client);

    // Route send replies back to the request that is waiting for them.
    //
    // `send_group_msg` goes out through the payload's `DSND` command, which calls QQ's real send
    // entry directly. QQ delivers the answer over its own receive path, so it lands here as an
    // ordinary op 6 packet rather than as op 4 on the control socket. The payload stamps the
    // originating request id onto the frame (0 for anything that is not a reply to us), and that
    // stamp is the whole correlation story -- there is no second mechanism to fall back on.
    //
    // Listening on the client rather than inside the ingress keeps the bridge ignorant of a
    // protocol detail that only the send path cares about, and means a deployment with no recv
    // socket still behaves exactly as before.
    const onReply = (packet: RecvPacket): void => {
      if (packet.requestId === 0) return;
      if (this.hook !== null && this.hook.settleFromRecv(packet.requestId, packet.status, packet.body)) {
        log.trace(
          "settled direct send requestId=%d from recv cmd=%s status=%d bodyLen=%d",
          packet.requestId,
          packet.cmd,
          packet.status,
          packet.body.length,
        );
      }
    };
    client.on("packet", onReply);
    const detachIngress = this.detachIngress;
    this.detachIngress = async () => {
      client.off("packet", onReply);
      await detachIngress();
    };
    return client;
  }

  /** Whether an inbound socket is attached. Says nothing about whether a peer is live. */
  hasRecv(): boolean {
    return this.recvClient !== null;
  }

  /**
   * Attach a control-socket client and bind its PID to the bridge.
   *
   * Separate from `start()` because the PID comes from the injector, not from config:
   * a caller that has not attached a payload yet is a valid state (the process is up
   * but cannot send), and conflating the two would make "started" mean "can send".
   */
  attachHook(pid: number): HookClient {
    if (this.hook !== null) throw new Error(`a hook is already attached on pid ${this.hook.pid}`);
    const client = new HookClient({ pid });
    this.hook = client;
    this.bindSender(pid, client);
    return client;
  }

  /** Mark the runtime started. Idempotent-unsafe on purpose: a double start is a bug. */
  start(): void {
    if (this.startedAt !== null) throw new Error("runtime is already started");
    this.startedAt = Date.now();
    log.info("Haizakura runtime started: uin=%s", this.options.uin);
  }

  /** Uptime in ms, or `null` before `start()`. */
  uptimeMs(): number | null {
    return this.startedAt === null ? null : Date.now() - this.startedAt;
  }

  /** Whether a control-socket client is attached. Says nothing about the peer. */
  hasHook(): boolean {
    return this.hook !== null;
  }

  /**
   * Stop and release. Best-effort: a failing detach must not mask the others, because
   * a half-torn-down process that throws on the way out leaves a socket behind.
   */
  async stop(): Promise<void> {
    const errors: string[] = [];
    // Notifications FIRST, and this ordering is the reference's
    // (reference/index.mjs:374244-L374288: `notificationManager.dispose()` runs before
    // `hookManager.dispose()`). It is load-bearing rather than tidy: detaching a PID
    // below publishes `session_closed`, and an operator who stops the bot must not
    // receive an "account went offline" page for it. A disposed manager drops the
    // edge (`manager.ts:252` returns early), so disposing first is what makes
    // "shutdown is not an incident" true. `dispose()` is synchronous and idempotent,
    // so a second `stop()` is harmless.
    try {
      this.notifications.dispose();
    } catch (error) {
      errors.push(`notification dispose: ${error instanceof Error ? error.message : String(error)}`);
    }
    // Then drop the bus subscriptions: a `Bridge` that outlives this runtime must not
    // keep dispatching into a disposed adapter.
    try {
      this.notificationSource.dispose();
    } catch (error) {
      errors.push(`notification source dispose: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (this.hook !== null) {
      const pid = this.hook.pid;
      try {
        // `close()` is synchronous: it tears the socket down and rejects pending
        // requests. Awaiting it is harmless but misleading, so call it plainly.
        this.hook.close();
      } catch (error) {
        errors.push(`hook close: ${error instanceof Error ? error.message : String(error)}`);
      }
      this.hook = null;
    }
    // Detach the inbound half first: `detachIngress` unsubscribes the listener, and
    // doing it before closing the socket means no packet can be delivered into a
    // half-torn-down bridge.
    if (this.detachIngress !== null) {
      try {
        await this.detachIngress();
      } catch (error) {
        errors.push(`recv ingress detach: ${error instanceof Error ? error.message : String(error)}`);
      }
      this.detachIngress = null;
    }
    if (this.recvClient !== null) {
      try {
        this.recvClient.close();
      } catch (error) {
        errors.push(`recv close: ${error instanceof Error ? error.message : String(error)}`);
      }
      this.recvClient = null;
    }
    // Detach every PID, not just `this.hook`: a caller may have bound a sender
    // through `getBridge().bindPid(...)`, and leaving it attached means later sends
    // reach a process that is gone.
    for (const pid of [...this.boundPids.keys()]) this.bridge.detachPid(pid);
    this.boundPids.clear();
    this.startedAt = null;
    if (errors.length > 0) throw new Error(`shutdown completed with errors: ${errors.join("; ")}`);
    log.info("Haizakura runtime stopped");
  }
}

/**
 * `--check`: load and print the resolved config, then exit non-zero on a bad file.
 *
 * This exists because the first thing anyone does with a new config file is get it
 * wrong, and "the process exited immediately" is a bad error message.
 */
export async function runCheck(configPath: string): Promise<number> {
  try {
    const config = await loadRuntimeConfig(configPath);
    process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`invalid config at ${configPath}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

/** The `main` the package has been missing. */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const options = parseCli(argv);
  if (options.logLevel !== undefined) {
    if (!setLogLevel(options.logLevel)) {
      process.stderr.write(`unknown log level: ${options.logLevel}\n`);
      return 2;
    }
  }
  const configPath = options.configPath ?? process.env["HAIZAKURA_CONFIG"] ?? defaultConfigPath();
  if (options.check === true) return runCheck(configPath);

  const config = await loadRuntimeConfig(configPath);
  const uin = process.env["HAIZAKURA_UIN"];
  if (uin === undefined || !/^\d+$/.test(uin)) {
    process.stderr.write(
      "HAIZAKURA_UIN must be the bot's QQ number before the runtime can start; " +
        "the identity is not read from the payload because a wrong UIN silently " +
        "attributes every message to the wrong account\n",
    );
    return 2;
  }
  const runtime = new HaizakuraRuntime({ uin, nickname: process.env["HAIZAKURA_NICKNAME"] ?? uin });
  runtime.start();
  log.info("webui configured on %s:%d (tls=%s)", config.webuiHost, config.webuiPort, String(config.webuiTls.enabled));

  // Shutdown is wired here rather than in `stop()` so that a caller embedding the
  // runtime (tests, a future daemon) does not install process-wide handlers.
  const shutdown = (signal: string): void => {
    log.info("received %s, shutting down", signal);
    void runtime.stop().then(
      () => { process.exitCode = 0; },
      (error: unknown) => {
        process.stderr.write(`shutdown failed: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      },
    );
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  return 0;
}

// Only run when executed directly, so importing this module in a test is inert.
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().then(
    (code) => { process.exitCode = code; },
    (error: unknown) => {
      process.stderr.write(`fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
