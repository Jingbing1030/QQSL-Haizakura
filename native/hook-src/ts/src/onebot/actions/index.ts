// The action registry: compile, validate, resolve, bind.
//
// Reference region: reference/index.mjs:21209-21320 (`../onebot/src/actions/index.ts`)
// — `validateSpecProjection`, `conflictMessage`, `compileActionRegistry`,
// `bindActionRegistry`, `ACTION_GROUPS`.
//
// The registry preserves the reference category order for every family currently
// implemented here. Unported categories remain absent rather than receiving stubs.
//
// ---------------------------------------------------------------------------
// What `compileActionRegistry` actually enforces
// ---------------------------------------------------------------------------
// Three checks, all reproduced, because each catches a real class of bug:
//
//   1. The canonical name (and every alias) must be non-empty. `names[0]` empty
//      would register an unnamed action.
//   2. `describe()`'s names must equal `names` — same order, same length. So
//      `describe()` cannot drift from the executable names.
//   3. `describe().stream === true` must agree with `spec.kind`, so a stream action
//      cannot be mislabelled.
//
// And the conflict matrix: each executable name is claimed once, and a second claim
// throws naming BOTH claimants (canonical, name, kind, role). That message is
// reproduced verbatim because it is what a developer sees when two families collide.
//
// ---------------------------------------------------------------------------
// `category` is a doc field, not a routing field
// ---------------------------------------------------------------------------
// `compileActionRegistry` copies the group's category onto every action's `doc` and
// into the `categories` summary. Dispatch never reads it. It matters anyway:
// `get_group_info` and `get_group_list` are registered under 群信息 here, while the
// task's 4.1 list also mentions them; the task's grouping is by assignment, not by
// the reference's category. The registry keeps the REFERENCE's category so the
// counts per category stay comparable, and the discrepancy is reported rather than
// papered over by re-labelling.

import type { ApiResponse, StreamSink } from "../types.js";
import { failedResponse, RETCODE } from "../types.js";
import type { ActionContext } from "./context.js";
import type { ActionDoc, ActionSpec, StreamActionSpec } from "./kit.js";
import {
  HANDLE_QUICK_OPERATION_ACTION,
  HANDLE_QUICK_OPERATION_ASYNC_ACTION,
  createHandleQuickOperation,
  type QuickOperationApi,
  type QuickOperationHandler,
} from "./quick-operation.js";
import { infoActions } from "./info.js";
import { messageActions } from "./message.js";
import { groupInfoActions } from "./group-info.js";
import { groupAdminActions } from "./group-admin.js";
import { extendedActions } from "./extended.js";
import { groupFileActions } from "./group-file.js";
import { groupAlbumActions } from "./group-album.js";
import { friendActions } from "./friend.js";
import { systemFaceActions } from "./system-face.js";
import { qzoneActions } from "./qzone.js";
import { qzonePublicActions } from "./qzone-public.js";
import { streamFileActions } from "./stream-file.js";
import { streamDownloadActions } from "./stream-download.js";

/** A registered action, frozen — reference:21252. */
export interface RegisteredAction<C = ActionContext> {
  readonly canonical: string;
  readonly names: readonly string[];
  readonly kind: "normal" | "stream";
  readonly category: string;
  readonly doc: Readonly<ActionDoc & { category: string }>;
  readonly spec:
    | ActionSpec<Record<string, unknown>, C>
    | StreamActionSpec<Record<string, unknown>, C>;
}

/** One executable name → what it points at — reference:21260. */
export interface NameClaim<C = ActionContext> {
  readonly name: string;
  readonly canonical: string;
  readonly kind: "normal" | "stream" | "raw";
  readonly role: "canonical" | "alias" | "raw";
  readonly action?: RegisteredAction<C>;
}

/** What `bind()` produces: name → callable handler — reference:21310. */
export interface BoundHandler<C = ActionContext> {
  readonly handler: (params: Record<string, unknown>, sink?: StreamSink) => Promise<ApiResponse>;
  readonly canonical: string;
  /** `"raw"` for a reservation — the reference writes the same literal at L21300. */
  readonly kind: "normal" | "stream" | "raw";
}

/**
 * A **raw reservation** — reference:21278-21290.
 *
 * A name the registry owns that is NOT an action definition: it has no `params` kit,
 * no `describe()`, no `returns`/`examples` metadata and no category, and it contributes
 * nothing to the per-category definition counts. This is exactly why the reference
 * keeps the quick-operation handler out of `ACTION_GROUPS` — it is reachable by name
 * but is not one of the documented 222 definitions.
 */
export interface RawReservation {
  readonly name: string;
  /** The definition (and factory key) this name resolves to. Shared by both aliases. */
  readonly canonical: string;
}

/** Canonical name → the factory `bind()` uses to build its handler. */
export type RawFactory = (api: QuickOperationApi) => QuickOperationHandler;

/**
 * The raw reservations, in claim order — reference:21369-21376.
 *
 * Both names point at ONE canonical definition, so `bind()` builds one handler per
 * name from the same factory, exactly as an alias shares its canonical's `toHandler`.
 */
export const RAW_ACTION_RESERVATIONS: readonly RawReservation[] = Object.freeze([
  Object.freeze({ name: HANDLE_QUICK_OPERATION_ACTION, canonical: HANDLE_QUICK_OPERATION_ACTION }),
  // NoneBot 1 spells the same handler with an `_async` suffix; the reference
  // registers it as a second reservation rather than as `names[1]` because raw
  // reservations are not allowed to be aliases of each other.
  Object.freeze({ name: HANDLE_QUICK_OPERATION_ASYNC_ACTION, canonical: HANDLE_QUICK_OPERATION_ACTION }),
]);

/**
 * The factories `bind()` resolves raw canonicals against — reference:21483-21491.
 *
 * A raw reservation with no factory here is a startup error, not a 1404, so a typo in
 * `RAW_ACTION_RESERVATIONS` cannot degrade into "the name exists but never runs".
 */
const RAW_FACTORIES: Readonly<Record<string, RawFactory>> = Object.freeze({
  [HANDLE_QUICK_OPERATION_ACTION]: createHandleQuickOperation,
});

export interface ActionGroup<C = ActionContext> {
  readonly category: string;
  readonly actions: readonly (
    | ActionSpec<Record<string, unknown>, C>
    | StreamActionSpec<Record<string, unknown>, C>
  )[];
}

// The friend source file also contains the two request actions; keep category
// boundaries aligned with the reference arrays when assembling the registry.
const friendFamilyActions = friendActions.slice(0, 3);
const requestFamilyActions = friendActions.slice(3);

export const ACTION_GROUPS: readonly ActionGroup[] = [
  { category: "信息", actions: infoActions },
  { category: "消息", actions: messageActions },
  { category: "好友", actions: friendFamilyActions },
  { category: "群信息", actions: groupInfoActions },
  { category: "群管理", actions: groupAdminActions },
  { category: "群文件", actions: groupFileActions },
  { category: "请求", actions: requestFamilyActions },
  { category: "擴展", actions: extendedActions },
  //
  // These final categories follow the reference's 群相册/空间/系统表情/流式接口 order.
  { category: "群相册", actions: groupAlbumActions },
  { category: "空间", actions: [...qzoneActions, ...qzonePublicActions] },
  { category: "系统表情", actions: systemFaceActions },
  { category: "流式接口", actions: [...streamFileActions, ...streamDownloadActions] },
];

/** `conflictMessage` — reference:21238. Reproduced verbatim; a developer reads it. */
function conflictMessage(name: string, first: NameClaim, second: NameClaim): string {
  return [
    `Action registry conflict for executable name "${name}"`,
    `canonical "${first.canonical}" (name "${first.name}", kind ${first.kind}, role ${first.role})`,
    `canonical "${second.canonical}" (name "${second.name}", kind ${second.kind}, role ${second.role})`,
  ].join(": ");
}

/**
 * `validateSpecProjection` — reference:21214.
 *
 * Note the third check reads `doc.stream`, which `ActionDoc` does not declare for
 * normal actions. Reading it through a cast keeps normal `describe()` output
 * unchanged while still validating the stream projection.
 */
function validateSpecProjection(
  spec:
    | ActionSpec<Record<string, unknown>, ActionContext>
    | StreamActionSpec<Record<string, unknown>, ActionContext>,
  doc: ActionDoc,
): void {
  const canonical = spec.names[0];
  if (!canonical || canonical.trim() === "") {
    throw new Error(`Action registry invalid ${spec.kind} action: canonical name must not be empty`);
  }
  for (const name of spec.names) {
    if (name.trim() === "") {
      throw new Error(
        `Action registry invalid ${spec.kind} action canonical "${canonical}": executable name must not be empty`,
      );
    }
  }
  const aliases = spec.names.slice(1);
  if (doc.name !== canonical || doc.aliases.length !== aliases.length || doc.aliases.some((name, i) => name !== aliases[i])) {
    throw new Error(
      `Action registry invalid ${spec.kind} action canonical "${canonical}": describe() names do not match executable names`,
    );
  }
  const documentedKind = (doc as { stream?: unknown }).stream === true ? "stream" : "normal";
  if (documentedKind !== spec.kind) {
    throw new Error(
      `Action registry invalid ${spec.kind} action canonical "${canonical}": describe() reports kind ${documentedKind}`,
    );
  }
}

export interface ActionRegistry {
  readonly actions: readonly RegisteredAction[];
  readonly executableNames: readonly NameClaim[];
  readonly categories: readonly { readonly category: string; readonly count: number }[];
  /** The raw reservations in claim order — reference:21300 `rawActions`. */
  readonly rawActions: readonly RawReservation[];
  resolve(name: string): NameClaim | undefined;
  /**
   * Bind every name to a handler.
   *
   * `api` is only reached by raw reservations: a `defineAction` handler is closed over
   * the context, while the quick-operation handler must dispatch through the SAME
   * `api.handle` the transports use (so the quiesce gate and the envelope are shared).
   * Every other caller — including every test that binds a fake context — never touches
   * a raw name, so the argument stays optional and the reference's two-argument
   * `bind(ctx, api, rawFactories)` stays a single extra parameter here.
   */
  bind(ctx: ActionContext, api?: QuickOperationApi): ReadonlyMap<string, BoundHandler>;
}

/**
 * The api a raw handler dispatches through when `bind()` was given none.
 *
 * The reference never hits this: its only caller passes the `ApiHandler` itself. The
 * port's `bind()` is also called with a bare context (every action test binds one to
 * prove each name has a callable handler), so a raw name bound that way must still
 * produce a handler — and answering 1200 `"..."` when one is actually dispatched keeps
 * the failure legible instead of turning into a `TypeError` inside the action. This is
 * the same shape `defineStreamAction`'s unreachable base uses for
 * "stream action dispatched without a sink".
 */
const UNBOUND_RAW_API: QuickOperationApi = {
  handle: async () => failedResponse(RETCODE.INTERNAL_ERROR, "raw action dispatched without a bound OneBotApi"),
};

/**
 * `compileActionRegistry` — reference:21250.
 *
 * Pure: it validates and freezes, but binds no context. That separation is what lets
 * the tests compile the registry once and bind it many times with different fake
 * contexts, and it is also why a duplicate name is a startup error rather than a
 * runtime one.
 *
 * `rawReservations` claims names AFTER every definition (reference:21286-21295), so a
 * reservation can never shadow a real action and a collision between the two is
 * reported by the same `conflictMessage` as any other duplicate.
 */
export function compileActionRegistry(
  groups: readonly ActionGroup[],
  rawReservations: readonly RawReservation[] = [],
): ActionRegistry {
  const actions: RegisteredAction[] = [];
  const executableNames: NameClaim[] = [];
  const rawActions: RawReservation[] = [];
  const byName = new Map<string, NameClaim>();

  const claim = (next: NameClaim): void => {
    const previous = byName.get(next.name);
    if (previous) throw new Error(conflictMessage(next.name, previous, next));
    byName.set(next.name, next);
    executableNames.push(next);
  };

  for (const group of groups) {
    for (const spec of group.actions) {
      const described = spec.describe();
      validateSpecProjection(spec, described);
      const canonical = spec.names[0]!;
      const action: RegisteredAction = Object.freeze({
        canonical,
        names: Object.freeze([...spec.names]),
        kind: spec.kind,
        category: group.category,
        doc: Object.freeze({ ...described, category: group.category }),
        spec,
      });
      actions.push(action);
      spec.names.forEach((name, index) => {
        claim(
          Object.freeze({
            name,
            canonical,
            kind: action.kind,
            role: index === 0 ? "canonical" : "alias",
            action,
          }),
        );
      });
    }
  }

  for (const reservation of rawReservations) {
    if (reservation.name.trim() === "" || reservation.canonical.trim() === "") {
      throw new Error("Action registry invalid raw action: canonical and executable name must not be empty");
    }
    // No `action` member: a reservation is a name without a definition, which is what
    // keeps it out of `actions` / `categories` and therefore out of the 222/228 totals.
    const raw: NameClaim = Object.freeze({
      name: reservation.name,
      canonical: reservation.canonical,
      kind: "raw" as const,
      role: "raw" as const,
    });
    claim(raw);
    rawActions.push(Object.freeze({ name: reservation.name, canonical: reservation.canonical }));
  }

  const categories = groups.map(({ category, actions: groupActions }) =>
    Object.freeze({ category, count: groupActions.length }),
  );

  return Object.freeze({
    actions: Object.freeze(actions),
    executableNames: Object.freeze(executableNames),
    categories: Object.freeze(categories),
    rawActions: Object.freeze(rawActions),
    resolve: (name: string) => byName.get(name),
    bind: (ctx: ActionContext, api?: QuickOperationApi) => bindActionRegistry(executableNames, ctx, api),
  });
}

/**
 * `bindActionRegistry` — reference:21305.
 *
 * Every name (canonical AND alias) maps to a handler, and aliases share the same
 * `toHandler` closure as their canonical — so an alias behaves identically, it is not
 * a separate registration.
 *
 * Raw reservations take the other branch: they resolve their canonical through
 * `RAW_FACTORIES`, and a canonical with no factory is a hard error rather than a name
 * that resolves to nothing (reference:21308, 21313). The two sweeps after the loop
 * reproduce the reference's "unexpected raw factory" check: a factory registered for a
 * canonical no reservation points at is dead code and must not go unnoticed.
 */
function bindActionRegistry(
  executableNames: readonly NameClaim[],
  ctx: ActionContext,
  api?: QuickOperationApi,
): ReadonlyMap<string, BoundHandler> {
  const handlers = new Map<string, BoundHandler>();
  const unclaimedFactories = new Set(Object.keys(RAW_FACTORIES));
  for (const claim of executableNames) {
    if (claim.kind === "raw") {
      const factory = RAW_FACTORIES[claim.canonical];
      if (!factory) {
        throw new Error(
          `Action registry raw factory missing: canonical "${claim.canonical}" (name "${claim.name}", kind raw)`,
        );
      }
      unclaimedFactories.delete(claim.canonical);
      handlers.set(
        claim.name,
        Object.freeze({
          handler: factory(api ?? UNBOUND_RAW_API),
          canonical: claim.canonical,
          kind: "raw" as const,
        }),
      );
      continue;
    }
    const action = claim.action;
    if (!action) continue;
    handlers.set(
      claim.name,
      Object.freeze({
        handler: action.spec.toHandler(ctx),
        canonical: claim.canonical,
        kind: action.kind,
      }),
    );
  }
  if (unclaimedFactories.size > 0) {
    const extra = [...unclaimedFactories][0]!;
    throw new Error(`Action registry unexpected raw factory: canonical "${extra}" (name "${extra}", kind raw)`);
  }
  return handlers;
}

/** The compiled registry for this port, compiled once at import. */
export const actionRegistry: ActionRegistry = compileActionRegistry(ACTION_GROUPS, RAW_ACTION_RESERVATIONS);

/**
 * The dispatch function a `OneBotApi` implementation can delegate to.
 *
 * Reproduces `ApiHandler.handleInContext`'s two branches that the registry owns
 * (reference:21532):
 *
 *   * unknown name → `failedResponse(1404, "unknown action")`
 *   * handler threw → `failedResponse(1400 if MessageElementValidationError else 100, message)`
 *   * stream handler receives the optional sink; normal handlers do not.
 *
 * The quiesce/shutdown branch is the transport's concern and is NOT reproduced here:
 * `types.ts`'s `OneBotApi` already has `isAcceptingActions` for that, and duplicating
 * it would give two places to change.
 *
 * 🔴 `MessageElementValidationError` is detected by `instanceof` against
 * `element-builder.ts`'s class — the same class the parser throws. A host that
 * re-wraps parser errors in another type would get 100 instead of 1400, so the tests
 * assert the 1400 path explicitly.
 */
export async function dispatchAction(
  handlers: ReadonlyMap<string, BoundHandler>,
  action: string,
  params: Record<string, unknown>,
  sink?: StreamSink,
): Promise<ApiResponse> {
  const registered = handlers.get(action);
  if (!registered) return failedResponse(RETCODE.UNKNOWN_ACTION, "unknown action");
  try {
    return await registered.handler(params, registered.kind === "stream" ? sink : undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isValidation = error instanceof Error && error.name === "MessageElementValidationError";
    return failedResponse(isValidation ? RETCODE.BAD_REQUEST : RETCODE.ACTION_FAILED, message);
  }
}

/**
 * Definition counts by family; total counts executable names including aliases.
 */
export const ACTION_COUNTS = {
  info: infoActions.length,
  message: messageActions.length,
  friend: friendFamilyActions.length,
  groupInfo: groupInfoActions.length,
  groupAdmin: groupAdminActions.length,
  groupFile: groupFileActions.length,
  request: requestFamilyActions.length,
  extended: extendedActions.length,
  groupAlbum: groupAlbumActions.length,
  space: qzoneActions.length + qzonePublicActions.length,
  systemFace: systemFaceActions.length,
  stream: streamFileActions.length + streamDownloadActions.length,
  definitions: actionRegistry.actions.length,
  /**
   * Definition names only: 222 definitions + 6 aliases = 228.
   *
   * Excludes the two RAW reservations (`.handle_quick_operation`,
   * `.handle_quick_operation_async`), which the reference compiles in alongside
   * `ACTION_GROUPS` and which are therefore absent from the reference oracle's
   * per-family arrays. Use `total` when you want everything dispatchable.
   */
  definitionNames: actionRegistry.executableNames.length - actionRegistry.rawActions.length,
  /** Every dispatchable name, raw reservations included: 228 + 2 = 230. */
  total: actionRegistry.executableNames.length,
} as const;