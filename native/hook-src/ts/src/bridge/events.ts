// The bridge's event bus: a typed publish/subscribe hub for the `BridgeEvent`
// union, with per-handler error isolation.
//
// Reference region: ../protocol/src/event-bus.ts (reference/index.mjs:346460, 78
// lines). Ported whole — it is small, self-contained, and `Bridge.events` holds
// one, so nothing else in the layer can be exercised without it.
//
// ---------------------------------------------------------------------------
// Why `emit` is async and uses `allSettled` rather than `all`
// ---------------------------------------------------------------------------
// A subscriber that throws must not stop the other subscribers, and a subscriber
// that hangs must not stop the NEXT event. `emit` therefore collects one promise
// per handler, each already wrapped so the rejection is converted to an
// `onError(kind, err)` call, and awaits `allSettled` — which means the returned
// promise resolves only after every subscriber settled, but never rejects.
//
// That choice is observable: a test that emits and then asserts an unhandled
// rejection will see none, and a caller that forgets to `await emit` will observe
// subscribers still running. Both are the reference's behaviour.
//
// ---------------------------------------------------------------------------
// Subscription bookkeeping uses wrapper objects, not bare handler references
// ---------------------------------------------------------------------------
// Each registration is stored as `{ handler }`, so the same function may be
// registered twice for the same kind and each registration gets its own
// unsubscribe. `off(kind, handler)` then removes EVERY matching registration,
// which is the opposite resolution of that ambiguity — deliberate, and the reason
// the unsubscribe closure is the documented way to cancel one subscription.
//
// `emit` snapshots its handler lists before dispatching, so a handler that
// subscribes or unsubscribes during dispatch does not affect the event in flight.

import type { BridgeEvent, BridgeEventBus as BridgeEventBusContract, Unsubscribe } from "../bridge/context.js";
import { createLogger } from "../onebot/log.js";

const DEFAULT_LOGGER = createLogger("Bridge.Events");

/** How a handler failure is reported. Never rethrown. */
export type EventErrorHandler = (kind: string, error: unknown) => void;

export interface BridgeEventBusOptions {
  onError?: EventErrorHandler;
  /** When `onError` is omitted, log failures under this scope instead of "Bridge.Events". */
  loggerName?: string;
}

/** A registration, boxed so duplicate registrations stay distinguishable. */
interface Subscription<TEvent> {
  handler: (event: TEvent) => unknown;
}

/**
 * The concrete bus behind `ctx.events`.
 *
 * `any` is typed as `BridgeEvent` because the union is closed; a caller that needs
 * a narrower view narrows at its own handler.
 */
export class BridgeEventBusImpl implements BridgeEventBusContract {
  private readonly handlers = new Map<string, Set<Subscription<BridgeEvent>>>();
  private readonly anyHandlers = new Set<Subscription<BridgeEvent>>();
  private readonly onError: EventErrorHandler;

  constructor(opts: BridgeEventBusOptions = {}) {
    if (opts.onError) {
      this.onError = opts.onError;
      return;
    }
    const log = opts.loggerName ? createLogger(opts.loggerName) : DEFAULT_LOGGER;
    this.onError = (kind, err) => {
      log.error(
        "event handler error [%s]: %s",
        kind,
        err instanceof Error ? (err.stack ?? err.message) : String(err),
      );
    };
  }

  /** Subscribe to one kind. The returned function removes exactly this registration. */
  on<TKind extends BridgeEvent["kind"]>(
    kind: TKind,
    handler: (event: Extract<BridgeEvent, { kind: TKind }>) => unknown,
  ): Unsubscribe {
    let set = this.handlers.get(kind);
    if (!set) {
      set = new Set();
      this.handlers.set(kind, set);
    }
    const subscription: Subscription<BridgeEvent> = {
      handler: handler as (event: BridgeEvent) => unknown,
    };
    set.add(subscription);
    return () => {
      this.handlers.get(kind)?.delete(subscription);
    };
  }

  /** Subscribe to every kind. Used by loggers and diagnostics, not by feature code. */
  onAny(handler: (event: BridgeEvent) => unknown): Unsubscribe {
    const subscription: Subscription<BridgeEvent> = { handler };
    this.anyHandlers.add(subscription);
    return () => {
      this.anyHandlers.delete(subscription);
    };
  }

  /** Remove every registration of `handler` for one kind. */
  off<TKind extends BridgeEvent["kind"]>(
    kind: TKind,
    handler: (event: Extract<BridgeEvent, { kind: TKind }>) => unknown,
  ): void {
    const subscriptions = this.handlers.get(kind);
    if (!subscriptions) return;
    for (const subscription of subscriptions) {
      if (subscription.handler === handler) subscriptions.delete(subscription);
    }
  }

  /** True when at least one subscriber (kind-specific or `any`) would receive `kind`. */
  has(kind: BridgeEvent["kind"]): boolean {
    return (this.handlers.get(kind)?.size ?? 0) + this.anyHandlers.size > 0;
  }

  /** Drop every subscriber. Used by `Bridge.dispose` and by tests. */
  clear(): void {
    this.handlers.clear();
    this.anyHandlers.clear();
  }

  /**
   * Dispatch to every kind-specific subscriber plus every `any` subscriber.
   *
   * Resolves once all of them settled; never rejects. Handler failures go to
   * `onError` with the event kind (or `"*"` for an `any` handler).
   */
  async emit(event: BridgeEvent): Promise<void> {
    const kindHandlers = [...(this.handlers.get(event.kind) ?? [])];
    const anyHandlers = [...this.anyHandlers];
    const tasks: Promise<void>[] = [];
    for (const { handler } of kindHandlers) {
      tasks.push(invokeIsolated(this.onError, event.kind, () => handler(event)));
    }
    for (const { handler } of anyHandlers) {
      tasks.push(invokeIsolated(this.onError, "*", () => handler(event)));
    }
    await Promise.allSettled(tasks);
  }
}

/** Run one handler, routing a throw or rejection to `onError` instead of out. */
async function invokeIsolated(
  onError: EventErrorHandler,
  kind: string,
  fn: () => unknown,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    onError(kind, err);
  }
}