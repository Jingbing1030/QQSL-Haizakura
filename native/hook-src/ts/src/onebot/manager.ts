// Network supervisor: owns the configured topology and every lifecycle change.
//
// Reference region: ../onebot/src/network/network-manager.ts L341877-L342213
//
// The contract, restated because the ordering is the whole point:
//
//   * `compileDesiredPlan` runs `assertValidOneBotConfig` OUTSIDE the FIFO queue,
//     so a deterministic config error is rejected immediately instead of
//     queueing behind a network bind that may take seconds.
//   * Every mutation then runs through ONE queue (`operationTail`), so a reload
//     can never interleave with another reload or with shutdown.
//   * Runtime failures are data (`{applied, errors, statuses}`), never throws —
//     one broken adapter must not stop the others from coming up.
//   * `shutdown()` is idempotent and sticky: after it is requested, reconcile and
//     emit both fail fast, and in-flight dispatches are awaited before closing.
//
// The reference also imports `assertValidOneBotConfig` from config.ts; that
// module (L5124-L5931) is the desktop app's full config loader and is out of
// scope for this port, so validation arrives as a constructor option and the
// port keeps the exact call order. The messages the fixtures assert on
// (`network adapter name "w" is duplicated in …`,
// `networks.wsServers[1] conflicts with … on server binding …`) come from the
// caller's validator, so `validateOneBotNetworks` below reproduces the two the
// network layer itself can produce.

import { createLogger, errorMessage } from "./log.js";
import { OneBotConfigValidationError } from "./config-error.js";
import {
  IOneBotNetworkAdapter,
  type AdapterStatus,
  type NetworkBaseConfig,
  type NetworkKind,
} from "./adapter.js";
import { HttpPostAdapter, HttpServerAdapter, type HttpClientConfig, type HttpServerConfig } from "./http.js";
import { WsClientAdapter, WsServerAdapter, type WsClientConfig } from "./ws.js";
import { SatoriServerAdapter } from "./network/satori-server-adapter.js";
import type { WsServerConfig } from "./adapter.js";
import {
  buildDispatchPayload,
  type DispatchPayload,
  type OneBotNetworkContext,
} from "./types.js";

const log = createLogger("OneBot.Network");

/** One entry of the compiled plan. `config` is a deep clone, never shared. */
export interface DesiredAdapter {
  name: string;
  kind: NetworkKind;
  config: NetworkBaseConfig;
}

/** The config shape this module reads; the rest of the app config is opaque. */
export interface NetworksConfig {
  httpServers: HttpServerConfig[];
  httpClients: HttpClientConfig[];
  wsServers: WsServerConfig[];
  wsClients: WsClientConfig[];
}

export interface OneBotConfigLike {
  networks: NetworksConfig;
}

/** One reconciliation/apply failure, reported as data. */
export interface ApplyFailure {
  name: string;
  kind: NetworkKind;
  phase: "open" | "close" | "reload" | "replace" | "restore" | "shutdown";
  message: string;
  at: number;
  restored?: boolean;
}

export interface OperationResult {
  applied: boolean;
  errors: ApplyFailure[];
  statuses: AdapterStatus[];
}

export interface ShutdownResult {
  closed: boolean;
  errors: ApplyFailure[];
}

/**
 * L5451 `assertValidOneBotConfig` — only the two network-layer rules that the
 * manager's own error messages depend on. The reference validates far more
 * (statusCommand, historySync, notifications, per-kind field types); the full
 * validator is `assertValidOneBotConfig` in `config.ts`, and the WebUI/save paths
 * must call that one. This stays because `compileDesiredPlan` calls it before
 * queueing and because these two messages are what the reference emits for a
 * duplicate name or a bind conflict (fixture-verified).
 *
 * The error class itself now lives in `config-error.ts` and is re-exported here:
 * `config.ts` throws the same class, and two declarations with the same `name`
 * would make every `instanceof` depend on which module the thrower imported.
 */
export { OneBotConfigValidationError };

function invalid(message: string): never {
  throw new OneBotConfigValidationError(message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateOneBotNetworks(value: unknown): void {
  if (!isObject(value)) invalid("configuration must be an object");
  if (!isObject(value["networks"])) invalid("networks must be an object");
  const networks = value["networks"] as Record<string, unknown>;
  const seen = new Map<string, string>();
  const bindings = new Map<string, string>();
  const kinds: Array<"httpServers" | "httpClients" | "wsServers" | "wsClients"> = [
    "httpServers",
    "httpClients",
    "wsServers",
    "wsClients",
  ];
  for (const kind of kinds) {
    const list = networks[kind];
    if (!Array.isArray(list)) invalid(`networks.${kind} must be an array`);
    for (let index = 0; index < list.length; index += 1) {
      const item = list[index] as unknown;
      const at = `networks.${kind}[${index}]`;
      if (!isObject(item)) invalid(`${at} must be an object`);
      const name = item["name"];
      if (typeof name !== "string" || !name.trim()) invalid(`${at}.name must be a non-empty string`);
      const previousKind = seen.get(name);
      if (previousKind !== undefined) invalid(`network adapter name "${name}" is duplicated in ${previousKind} and ${kind}`);
      seen.set(name, kind);
      if (kind === "httpServers" || kind === "wsServers") {
        const host = item["host"] ?? "0.0.0.0";
        const port = item["port"];
        if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
          invalid(`${at}.port must be an integer between 1 and 65535`);
        }
        const binding = `${String(host)}:${String(port)}`;
        const wildcard = host === "0.0.0.0" || host === "::";
        const previousExact = bindings.get(binding);
        if (previousExact !== undefined) invalid(`${at} conflicts with ${previousExact} on server binding ${binding}`);
        if (wildcard) {
          for (const [existing, owner] of bindings) {
            if (existing.endsWith(`:${String(port)}`)) {
              invalid(`${at} conflicts with ${owner} on wildcard server port ${String(port)}`);
            }
          }
        }
        bindings.set(binding, at);
      }
    }
  }
}

/**
 * L341890 `OneBotNetworkManager`.
 *
 * `factory` builds an adapter from a plan entry; `ctx` supplies uin/api/meta
 * builders. The reference passes the factory in the constructor and lets
 * `OneBotInstance.createNetworkAdapter` switch on kind; the same split is kept
 * here, with a default factory so a caller can skip it.
 */
export class OneBotNetworkManager {
  private readonly adapters = new Map<string, { kind: NetworkKind; adapter: IOneBotNetworkAdapter }>();
  private readonly factory: ((desired: DesiredAdapter) => IOneBotNetworkAdapter) | null;
  private operationTail: Promise<unknown> = Promise.resolve();
  private accepting = true;
  private readonly inFlightEmits = new Set<Promise<void>>();
  private shutdownPromise: Promise<ShutdownResult> | null = null;
  /** Debug taps: notified for every emitted event regardless of adapter state. */
  private readonly debugSubscribers = new Set<(event: Record<string, unknown>) => void>();
  private readonly validate: (config: unknown) => void;

  constructor(options: {
    ctx: OneBotNetworkContext;
    factory?: (desired: DesiredAdapter) => IOneBotNetworkAdapter;
    validate?: (config: unknown) => void;
  }) {
    this.ctx = options.ctx;
    this.factory = options.factory ?? null;
    this.validate = options.validate ?? validateOneBotNetworks;
  }

  private readonly ctx: OneBotNetworkContext;

  subscribeDebug(cb: (event: Record<string, unknown>) => void): () => void {
    this.debugSubscribers.add(cb);
    return () => {
      this.debugSubscribers.delete(cb);
    };
  }

  /** Test/embedding seam for pre-built adapters. Production topology changes
   *  go through `reconcile()`, which refuses duplicate names. */
  register(adapter: IOneBotNetworkAdapter): void {
    if (!this.accepting) throw new Error("network manager is shutting down");
    if (this.adapters.has(adapter.name)) throw new Error(`network adapter name already registered: ${adapter.name}`);
    const kind = adapter.describeStatus().kind;
    this.adapters.set(adapter.name, { kind, adapter });
  }

  has(name: string): boolean {
    return this.adapters.has(name);
  }

  get(name: string): IOneBotNetworkAdapter | null {
    return this.adapters.get(name)?.adapter ?? null;
  }

  list(): IOneBotNetworkAdapter[] {
    return [...this.adapters.values()].map((entry) => entry.adapter);
  }

  describeStatuses(): AdapterStatus[] {
    return this.list().map((adapter) => adapter.describeManagedStatus());
  }

  hasActiveAdapters(): boolean {
    for (const { adapter } of this.adapters.values()) if (adapter.isActive) return true;
    return false;
  }

  /** L341950 `compileDesiredPlan`: validate outside the queue, then flatten in
   *  the reference's fixed order (httpServers, httpClients, wsServers,
   *  wsClients). */
  compileDesiredPlan(config: OneBotConfigLike): DesiredAdapter[] {
    this.validate(config);
    return [
      ...config.networks.httpServers.map((network) => ({
        name: network.name,
        kind: "httpServer" as const,
        config: structuredClone(network) as NetworkBaseConfig,
      })),
      ...config.networks.httpClients.map((network) => ({
        name: network.name,
        kind: "httpClient" as const,
        config: structuredClone(network) as NetworkBaseConfig,
      })),
      ...config.networks.wsServers.map((network) => ({
        name: network.name,
        kind: "wsServer" as const,
        config: structuredClone(network) as NetworkBaseConfig,
      })),
      ...config.networks.wsClients.map((network) => ({
        name: network.name,
        kind: "wsClient" as const,
        config: structuredClone(network) as NetworkBaseConfig,
      })),
    ];
  }

  reconcile(config: OneBotConfigLike): Promise<OperationResult> {
    const desired = this.compileDesiredPlan(config);
    if (!this.accepting) return Promise.reject(new Error("network manager is shutting down"));
    return this.enqueue(() => this.reconcileNow(desired));
  }

  /** L341996 `openAll`: open already-registered adapters in map order. */
  openAll(): Promise<OperationResult> {
    if (!this.accepting) return Promise.reject(new Error("network manager is shutting down"));
    return this.enqueue(async () => {
      const errors: ApplyFailure[] = [];
      for (const entry of this.adapters.values()) {
        try {
          await entry.adapter.open();
          entry.adapter.clearApplyFailure();
        } catch (error) {
          entry.adapter.markApplyFailure(error);
          errors.push(this.report(entry.adapter.name, entry.kind, "open", error));
        }
      }
      return this.result(errors);
    });
  }

  closeOne(name: string): Promise<void> {
    if (!this.accepting) return Promise.reject(new Error("network manager is shutting down"));
    return this.enqueue(async () => {
      const entry = this.adapters.get(name);
      if (!entry) return;
      await entry.adapter.close();
      this.adapters.delete(name);
    }) as Promise<void>;
  }

  /** L342026 `shutdown`: ordered, idempotent, sticky. */
  shutdown(): Promise<ShutdownResult> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.accepting = false;
    const attempt = this.enqueue(async () => {
      const errors: ApplyFailure[] = [];
      const dispatches = await Promise.allSettled([...this.inFlightEmits]);
      for (const dispatch of dispatches) {
        if (dispatch.status === "rejected") log.error("in-flight event dispatch failed during shutdown: %s", errorMessage(dispatch.reason));
      }
      // Reverse insertion order: the last adapter opened goes down first.
      const entries = [...this.adapters.entries()].reverse();
      for (const [name, entry] of entries) {
        try {
          await entry.adapter.close();
          this.adapters.delete(name);
        } catch (error) {
          entry.adapter.markApplyFailure(error);
          errors.push(this.report(name, entry.kind, "shutdown", error));
        }
      }
      this.debugSubscribers.clear();
      return { closed: errors.length === 0, errors };
    }) as Promise<ShutdownResult>;
    this.shutdownPromise = attempt;
    void attempt.then(
      (result) => {
        if (!result.closed) this.shutdownPromise = null;
      },
      () => {
        this.shutdownPromise = null;
      },
    );
    return attempt;
  }

  /** L342055 `forceRelease`: best effort, does not wait for anything. */
  forceRelease(): void {
    this.accepting = false;
    for (const { adapter } of this.adapters.values()) {
      try {
        adapter.forceClose();
      } catch (error) {
        log.error("forced adapter release failed: %s", errorMessage(error));
      }
    }
  }

  /** L342066 `emitEvent`: rejected after shutdown, never silently dropped. */
  emitEvent(event: Record<string, unknown>): Promise<void> {
    if (!this.accepting) return Promise.reject(new Error("network manager is shutting down; event dispatch rejected"));
    const operation = this.emitEventNow(event);
    this.inFlightEmits.add(operation);
    void operation.then(
      () => this.inFlightEmits.delete(operation),
      () => this.inFlightEmits.delete(operation),
    );
    return operation;
  }

  /** L342075 `emitEventNow`. Payload shaping happens ONCE for all adapters, then
   *  each adapter picks its own serialization. A throwing adapter is logged and
   *  contained, so one bad sink cannot starve the others. */
  private async emitEventNow(event: Record<string, unknown>): Promise<void> {
    if (this.debugSubscribers.size > 0) {
      for (const cb of this.debugSubscribers) {
        try {
          cb(event);
        } catch (error) {
          log.warn("debug subscriber error: %s", errorMessage(error));
        }
      }
    }
    const active = [...this.adapters.values()]
      .map(({ adapter }) => adapter)
      .filter((adapter) => adapter.isActive);
    if (active.length === 0) {
      log.trace("report_terminal outcome=no_active_targets");
      return;
    }
    log.trace(() => ["report_targets targets=%s", JSON.stringify(active.map((adapter) => adapter.name))]);
    const payload: DispatchPayload = buildDispatchPayload(event);
    const tasks = active.map((adapter) =>
      Promise.resolve()
        .then(() => adapter.onEvent(event, payload))
        .catch((error: unknown) => {
          log.warn("adapter [%s] onEvent error: %s", adapter.name, errorMessage(error));
        }),
    );
    await Promise.allSettled(tasks);
    log.trace("report_terminal outcome=settled");
  }

  /** L342097 `reconcileNow`: teardown of vanished adapters, then upsert. */
  private async reconcileNow(desired: DesiredAdapter[]): Promise<OperationResult> {
    const errors: ApplyFailure[] = [];
    const desiredByName = new Map(desired.map((entry) => [entry.name, entry]));
    for (const [name, live] of [...this.adapters]) {
      if (desiredByName.has(name)) continue;
      try {
        await live.adapter.close();
        this.adapters.delete(name);
      } catch (error) {
        live.adapter.markApplyFailure(error);
        errors.push(this.report(name, live.kind, "close", error));
      }
    }
    for (const next of desired) {
      const live = this.adapters.get(next.name);
      if (!live) await this.createAndOpen(next, errors);
      else if (live.kind === next.kind) await this.reloadSameKind(live, next, errors);
      else await this.replaceKind(live, next, errors);
    }
    return this.result(errors);
  }

  private async createAndOpen(next: DesiredAdapter, errors: ApplyFailure[]): Promise<void> {
    let adapter: IOneBotNetworkAdapter;
    try {
      adapter = this.create(next);
    } catch (error) {
      errors.push(this.report(next.name, next.kind, "open", error));
      return;
    }
    this.adapters.set(next.name, { kind: next.kind, adapter });
    try {
      await adapter.open();
      adapter.clearApplyFailure();
    } catch (error) {
      adapter.markApplyFailure(error);
      errors.push(this.report(next.name, next.kind, "open", error));
    }
  }

  /** L342126 `reloadSameKind`: on failure, try to restore the previous config so
   *  the account keeps working, and record whether the restore succeeded. */
  private async reloadSameKind(
    live: { kind: NetworkKind; adapter: IOneBotNetworkAdapter },
    next: DesiredAdapter,
    errors: ApplyFailure[],
  ): Promise<void> {
    const previous = structuredClone(live.adapter.currentConfig);
    try {
      if (live.adapter.hasApplyFailure) await live.adapter.close();
      await live.adapter.reload(next.config);
      live.adapter.clearApplyFailure();
    } catch (error) {
      let restored = false;
      try {
        await live.adapter.reload(previous);
        restored = true;
      } catch (restoreError) {
        errors.push(this.report(next.name, live.kind, "restore", restoreError));
      }
      live.adapter.markApplyFailure(error);
      errors.push(this.report(next.name, next.kind, "reload", error, restored));
    }
  }

  /** L342142 `replaceKind`: a kind change is close-then-create; a failure puts
   *  the old adapter back if it will reopen. */
  private async replaceKind(
    live: { kind: NetworkKind; adapter: IOneBotNetworkAdapter },
    next: DesiredAdapter,
    errors: ApplyFailure[],
  ): Promise<void> {
    try {
      await live.adapter.close();
    } catch (error) {
      live.adapter.markApplyFailure(error);
      errors.push(this.report(next.name, live.kind, "replace", error));
      return;
    }
    let replacement: IOneBotNetworkAdapter;
    try {
      replacement = this.create(next);
    } catch (error) {
      let restored = false;
      try {
        await live.adapter.open();
        restored = true;
      } catch (restoreError) {
        errors.push(this.report(next.name, live.kind, "restore", restoreError));
      }
      live.adapter.markApplyFailure(error);
      errors.push(this.report(next.name, next.kind, "replace", error, restored));
      return;
    }
    this.adapters.set(next.name, { kind: next.kind, adapter: replacement });
    try {
      await replacement.open();
      replacement.clearApplyFailure();
      return;
    } catch (error) {
      try {
        await replacement.close();
      } catch (cleanupError) {
        replacement.markApplyFailure(error);
        errors.push(this.report(next.name, next.kind, "close", cleanupError));
        errors.push(this.report(next.name, next.kind, "replace", error, false));
        return;
      }
      let restored = false;
      try {
        await live.adapter.open();
        live.adapter.markApplyFailure(error);
        this.adapters.set(next.name, live);
        restored = true;
      } catch (restoreError) {
        replacement.markApplyFailure(error);
        errors.push(this.report(next.name, live.kind, "restore", restoreError));
      }
      errors.push(this.report(next.name, next.kind, "replace", error, restored));
    }
  }

  /** L342196 `create`: the factory must not rename the adapter it returns. */
  private create(next: DesiredAdapter): IOneBotNetworkAdapter {
    const factory = this.factory ?? ((desired: DesiredAdapter) => createNetworkAdapter(desired, this.ctx));
    const adapter = factory(next);
    if (adapter.name !== next.name) {
      throw new Error(`network adapter factory returned name ${adapter.name} for desired ${next.name}`);
    }
    return adapter;
  }

  private result(errors: ApplyFailure[]): OperationResult {
    return { applied: errors.length === 0, errors, statuses: this.describeStatuses() };
  }

  /** L342026 `report`: log + the data record. `restored` is omitted entirely
   *  when undefined — the fixtures distinguish "no key" from "false". */
  private report(name: string, kind: NetworkKind, phase: ApplyFailure["phase"], error: unknown, restored?: boolean): ApplyFailure {
    const detail: ApplyFailure = {
      name,
      kind,
      phase,
      message: errorMessage(error),
      at: Date.now(),
      ...(restored === undefined ? {} : { restored }),
    };
    log.error(
      "adapter [%s] kind=%s phase=%s failed%s: %s",
      name,
      kind,
      phase,
      restored === undefined ? "" : ` restored=${String(restored)}`,
      detail.message,
    );
    return detail;
  }

  /** L342208 `enqueue`: one FIFO chain; a failed operation does not poison it. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

/**
 * L343070 `OneBotInstance.createNetworkAdapter`: the canonical factory. Exposed
 * so a caller can pass it (or a wrapper) to the manager.
 */
export function createNetworkAdapter(desired: DesiredAdapter, ctx: OneBotNetworkContext): IOneBotNetworkAdapter {
  switch (desired.kind) {
    case "httpServer":
      return new HttpServerAdapter(desired.name, desired.config as HttpServerConfig, ctx);
    case "httpClient":
      return new HttpPostAdapter(desired.name, desired.config as HttpClientConfig, ctx);
    case "wsServer": {
      const config = desired.config as WsServerConfig;
      const normalizedPath = (config.path ?? "/").split("?")[0]?.replace(/\/+$/, "") || "/";
      if (config.protocol === "satori" || normalizedPath === "/v1/events") {
        return new SatoriServerAdapter(desired.name, config, ctx);
      }
      return new WsServerAdapter(desired.name, config, ctx);
    }
    case "wsClient":
      return new WsClientAdapter(desired.name, desired.config as WsClientConfig, ctx);
    default:
      throw new Error(`unknown network adapter kind: ${String(desired.kind)}`);
  }
}