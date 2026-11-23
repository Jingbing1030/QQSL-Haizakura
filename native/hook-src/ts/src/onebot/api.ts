// The concrete `OneBotApi`: the thing the transports actually call.
//
// Until this file existed `types.ts` declared `OneBotApi` and the HTTP/WS adapters accepted one,
// but nothing implemented it — so the compiled actions were registry-tested and unreachable. This
// file is the wiring, and it is deliberately thin: everything it does is a decision the reference
// also makes in `ApiHandler`, and every such decision is cited.
//
// It is action-count agnostic. The registry grew from 42 executable names to 163 when the 擴展
// family landed, and nothing here changed: the handler map is built from
// `actionRegistry.bind(ctx)`, so a family that is registered is dispatchable and one that is not
// answers 1404.
//
// What is *not* here: the message queue, the event bus, the login gate's transitions. Those belong
// to the host and are injected, because a class that owned them could not be tested without a
// running QQ.
import type { ApiResponse, OneBotApi, StreamSink } from "./types.js";
import { StreamTransportClosedError, wrapStreamFrame, wrapStreamTerminal } from "./types.js";
import type { ActionContext } from "./actions/context.js";
import {
  actionRegistry,
  dispatchAction,
  type BoundHandler,
} from "./actions/index.js";
import { failedResponse, okResponse, RETCODE } from "./types.js";

/** The registry bound to one context, produced once per logged-in session. */
export type BoundActions = ReadonlyMap<string, BoundHandler>;

export interface OneBotApiOptions {
  /** Builds the action context for the session. Called once, lazily. */
  createContext: () => ActionContext;
  /**
   * Whether the instance is accepting actions — a sticky lifecycle gate, not a login check.
   *
   * Separate from login on purpose: a session that is logged in but quiescing must refuse, and a
   * session that is not logged in yet must also refuse, and conflating the two makes the refusal
   * message wrong in one of the cases.
   */
  isAcceptingActions: () => boolean;
  /**
   * Actions whose response is a stream rather than one body.
   *
   * The reference reads this from a fixed set (`ApiHandler.isStreamAction`, reference:21518).
   * Injected rather than hardcoded so this file does not have to grow every time the set does,
   * and because a wrong answer here changes the wire framing rather than just a payload.
   */
  isStreamAction?: (action: string) => boolean;
}

/**
 * Builds an `OneBotApi` backed by the compiled action registry.
 *
 * The bound handler map is created lazily and memoised: `actionRegistry.bind` walks all 42
 * actions and rebuilds every closure, which is fine once per session and wasteful on the first
 * heartbeat if the transport touches this early.
 */
export function createOneBotApi(options: OneBotApiOptions): OneBotApi {
  let bound: BoundActions | null = null;

  const handlers = (): BoundActions => {
    // `api` is handed to `bind` so a raw reservation (the v11 quick-operation handler)
    // dispatches back through THIS object. That is the reference's wiring —
    // `rawFactories[canonical] = (api) => ...` (reference:21487) — and it is what makes
    // a quick operation obey the same quiesce gate and produce the same envelope as a
    // direct action call. Reads `api` through the closure because the object below is
    // only fully formed after this point; a raw name is never bound before then.
    if (bound === null) bound = actionRegistry.bind(options.createContext(), api);
    return bound;
  };

  const api: OneBotApi = {
    get isAcceptingActions(): boolean {
      return options.isAcceptingActions();
    },

    isStreamAction(action: string): boolean {
      return options.isStreamAction
        ? options.isStreamAction(action)
        : handlers().get(action)?.kind === "stream";
    },

    async handle(action: string, params: Record<string, unknown>, sink?: StreamSink): Promise<ApiResponse> {
      // Order matters and matches the reference: the quiesce gate is checked before the registry,
      // so an action that exists is still refused while shutting down. Doing it the other way
      // round answers "unknown action" during shutdown, which is a misleading reason.
      if (!options.isAcceptingActions()) {
        return failedResponse(RETCODE.ACTION_FAILED, "instance is not accepting actions");
      }

      return await dispatchAction(handlers(), action, params, sink);
    },

    async processStreamRequest(
      rawRequest: string,
      emit: (frame: string) => Promise<void> | void,
      isAlive?: () => boolean,
    ): Promise<void> {
      const badRequest = failedResponse(RETCODE.BAD_REQUEST, "bad request");
      if (!rawRequest.trim()) {
        await emit(JSON.stringify(badRequest));
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawRequest);
      } catch {
        await emit(JSON.stringify(badRequest));
        return;
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        await emit(JSON.stringify(badRequest));
        return;
      }
      const envelope = parsed as { action?: unknown; params?: unknown; echo?: unknown };
      if (typeof envelope.action !== "string" || !envelope.action) {
        await emit(JSON.stringify(badRequest));
        return;
      }
      const params = typeof envelope.params === "object" && envelope.params !== null && !Array.isArray(envelope.params)
        ? envelope.params as Record<string, unknown>
        : {};

      if (!api.isStreamAction(envelope.action)) {
        const response = await api.handle(envelope.action, params);
        if (isAlive && !isAlive()) return;
        if (envelope.echo !== undefined) response.echo = envelope.echo;
        await emit(JSON.stringify(response));
        return;
      }

      const response = await api.handle(envelope.action, params, {
        send: async (frame) => {
          if (isAlive && !isAlive()) throw new StreamTransportClosedError();
          await emit(JSON.stringify(wrapStreamFrame(frame, envelope.echo)));
        },
      });
      if (isAlive && !isAlive()) return;
      await emit(JSON.stringify(wrapStreamTerminal(response, envelope.echo)));
    },
  };

  return api;
}

/** A no-op `OneBotApi` for a transport tested without a session. */
export function createIdleOneBotApi(reason = "not logged in"): OneBotApi {
  return {
    isAcceptingActions: false,
    isStreamAction: () => false,
    handle: async () => failedResponse(RETCODE.ACTION_FAILED, reason),
    processStreamRequest: async (raw, emit) => {
      await emit(JSON.stringify(failedResponse(RETCODE.ACTION_FAILED, reason)));
    },
  };
}

export { okResponse, failedResponse };