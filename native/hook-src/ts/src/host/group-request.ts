// `set_group_add_request` / `get_group_system_msg` — the group-request inbox.
//
// Reference regions:
//   handleGroupAddRequest          reference/index.mjs:39984
//   parseGroupRequestFlag          reference/index.mjs:39923
//   fetchRequestInboxes            reference/index.mjs:39952
//   throwMissingGroupRequest       reference/index.mjs:39974
//   resolveLiveGroupRequest        reference/index.mjs:39978
//   applyGroupRequest              reference/index.mjs:39987
//   getGroupSystemMessages         reference/index.mjs:39660
//   groupRequestActor              reference/index.mjs:39648
//   isJoinOrInviteNotify           reference/index.mjs:39645
//   resolveRequesterUins           reference/index.mjs:39584
//   formatGroupRequestFlag         reference/index.mjs:11184
//   isSelfGroupInvitation         reference/index.mjs:11180
//
// ===========================================================================
// Why there are TWO inbox readers
// ===========================================================================
// `fetchGroupRequests` and `fetchFilteredGroupRequests` read the SAME spec
// (`FetchGroupRequests`, `0x10c0_0`) into DIFFERENT shapes, and the difference is
// load-bearing rather than stylistic:
//
//   * `fetchGroupRequests` → nested `{group, target, invitor}`, the shape
//     `get_group_system_msg`'s 4.1 projection was written against;
//   * `fetchFilteredGroupRequests` → the FLAT row, which is the only one carrying
//     `notifyType`, top-level `groupId`, and `filtered`.
//
// Every function here needs the flat row: `formatGroupRequestFlag` reads
// `groupId`/`sequence`/`eventType`/`filtered` off it, and `isJoinOrInviteNotify`
// reads `notifyType`. Adapting one to the other would answer plausible values in
// every field while being wrong in all of them — a differential test in the
// reference's own history caught exactly that, and contacts.ts's header records it.
//
// ===========================================================================
// Why failures are AGGREGATED rather than retried
// ===========================================================================
// `fetchRequestInboxes` calls both inboxes with `Promise.allSettled` and keeps the
// rejections. The rule that falls out:
//
//   * BOTH fail              → throw `AggregateError` (nothing can be looked up);
//   * ONE fails              → log a warning and search the other;
//   * no match, with failures → `AggregateError` ("lookup incomplete"), because an
//     absence from a partially-failed search is not an absence;
//   * no match, clean        → plain `Error` ("not found").
//
// Collapsing those four into one `null` would make "QQ is unreachable" and "that
// request does not exist" indistinguishable to an operator, and the second is a
// permanent answer while the first is worth retrying.

import { createLogger } from "../onebot/log.js";
import type {
  ActionGroupRequest,
  FilteredGroupRequestRow,
  GroupRequestInboxRow,
} from "../onebot/actions/context.js";
import {
  formatGroupRequestFlag,
  groupRequestOperationType,
  isSelfGroupInvitation,
  isJoinOrInviteNotify,
  parseGroupRequestFlag,
} from "../oidb/services/index.js";

const log = createLogger("Host.GroupRequest");

/** Concurrency `resolveRequesterUins` uses for its profile fetches (reference:39582). */
const REQUESTER_PROFILE_CONCURRENCY = 4;

/**
 * What the request paths need from the session.
 *
 * Narrow on purpose — the reference takes the whole `bridge` and reaches into
 * `apis.contacts`, `apis.groupAdmin` and `identity`. Every member here is used at
 * least once, and a missing one is a compile error rather than an `undefined is not
 * a function` at the second approval.
 */
export interface GroupRequestContext {
  selfUin: number;
  /**
   * `identity.selfUid` — the invited account's own uid, when known.
   *
   * `| null` is accepted because that is what `BridgeIdentity` answers for "unknown"
   * (`context.ts:173` resolves uids to `string`; the identity's own `selfUid` is
   * `string | null`). Every use here is a truthiness test, so the two are equivalent —
   * and declaring only `undefined` would force a `?? undefined` at the call site for no
   * change in behaviour.
   */
  selfUid: string | null | undefined;
  contacts: {
    fetchGroupRequests(
      filtered?: boolean,
      count?: number,
      cursor?: bigint,
    ): Promise<readonly ActionGroupRequest[]>;
    fetchFilteredGroupRequests(
      count?: number,
      filtered?: boolean,
    ): Promise<readonly FilteredGroupRequestRow[]>;
    /**
     * `contacts.groupInvites.findCardGroup` (reference:39979) — the invite-card group
     * for a bare-sequence flag.
     *
     * ⚠️ Still OPTIONAL, but no longer because the tracker is missing: it IS ported
     * (`bridge/apis/group-invite-tracker.ts`) and `ContactsApi` constructs one. The
     * optionality is the reference's own `?.` (`resolveLiveGroupRequest` guards the
     * call), and it is load-bearing for a structural reason: `GroupRequestContext` is
     * what the ACTION layer injects, and a host that constructs these functions
     * without a full `ContactsApi` (a unit test, a diagnostic tool) must still
     * typecheck. When the member is absent every path falls through to the inbox
     * search — which is exactly the reference's behaviour when the card is unknown,
     * not a degradation.
     */
    findGroupInviteCardGroupBySequence?(sequence: number, groupId?: number): number | null | undefined;
    /**
     * `contacts.groupInvites.getSelfInviteNotice` (reference:40008) — the notice a
     * legacy `invite:` flag should consult before searching the inbox.
     *
     * OPTIONAL for the same structural reason as the member above. When absent, the
     * legacy flag has no notice to consult and is matched against the inbox alone —
     * the reference's own fallback when the tracker has no notice for that group/uid
     * (its `notice?.cardSequence` test fails on `undefined` exactly as it would on a
     * miss).
     */
    getSelfInviteNotice?(groupId: number, targetUid: string): { cardSequence?: number } | undefined;
    fetchUserProfileByUid(uid: string): Promise<{ uin: number; nickname: string }>;
    fetchUserProfile(uin: number): Promise<{ uin: number; nickname: string }>;
  };
  groupAdmin: {
    setAddRequest(
      groupId: number,
      sequence: number,
      eventType: number,
      approve: boolean,
      reason: string,
      filtered: boolean,
      operateTransInfo?: Uint8Array | undefined,
    ): Promise<void>;
  };
}

// ===========================================================================
// The flag
// ===========================================================================

/**
 * `positiveSafeInteger` (reference:39914) — the flag's field parser.
 *
 * Rejects `0`, negatives, non-integers and anything past `MAX_SAFE_INTEGER`, because a
 * group id or sequence of 0 names nothing: `set_group_add_request` would carry
 * "group 0" onto the wire and QQ would answer about a group that does not exist.
 */
function positiveSafeInteger(value: string, field: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`invalid ${field} in group request flag: ${value}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid ${field} in group request flag: ${value}`);
  }
  return parsed;
}

/**
 * `formatGroupRequestFlag` (reference:11184) — re-exported so callers here have one
 * source. The implementation lives in `oidb/services/0x10c0.ts` because
 * `set_group_add_request` and `get_group_system_msg` must agree byte for byte on the
 * format; two copies would be two chances to drift.
 */
export { formatGroupRequestFlag };

// ===========================================================================
// The two inbox readers
// ===========================================================================

/**
 * One union row — the flat inbox record, with `operateTransInfo` optional.
 *
 * ⚠️ An ALIAS, not a second declaration. `FilteredGroupRequestRow` (context.ts:1036)
 * has no `operateTransInfo`, but `applyGroupRequest` passes it through to
 * `setAddRequest` (reference:39989 `live.operateTransInfo`). It is `undefined` for a
 * row that did not carry one, which is what the reference's
 * `raw.operateTransInfo && raw.operateTransInfo.length > 0 ? ... : void 0` produces
 * (reference:74688).
 *
 * `ContactsApi.fetchGroupRequestsByUid` produces the same shape, so the declaration
 * lives in `onebot/actions/context.ts` where both layers can name it — two identical
 * structural declarations would be two chances to drift.
 */
type RequestInboxRow = GroupRequestInboxRow;

/**
 * `fetchRequestInboxes` (reference:39952) — read both pages, keep the failures.
 *
 * `allSettled` rather than `all`: a single inbox failing must not hide the other
 * page's contents. The returned `failures` array is what lets a caller distinguish
 * "not found" from "could not look".
 */
async function fetchRequestInboxes(
  ctx: GroupRequestContext,
  count = 100,
): Promise<{ requests: RequestInboxRow[]; failures: unknown[] }> {
  const [main, filtered] = await Promise.allSettled([
    ctx.contacts.fetchFilteredGroupRequests(count, false),
    ctx.contacts.fetchFilteredGroupRequests(count, true),
  ]);
  if (main.status === "rejected") {
    log.warn(
      "failed to fetch main group-request inbox: %s",
      main.reason instanceof Error ? main.reason.message : String(main.reason),
    );
  }
  if (filtered.status === "rejected") {
    log.warn(
      "failed to fetch filtered group-request inbox: %s",
      filtered.reason instanceof Error ? filtered.reason.message : String(filtered.reason),
    );
  }
  const failures = [main, filtered]
    .filter((result) => result.status === "rejected")
    .map((result) => (result as PromiseRejectedResult).reason);
  if (failures.length === 2) {
    throw new AggregateError(failures, "failed to fetch group requests from both inboxes");
  }
  return {
    requests: [
      ...(main.status === "fulfilled" ? main.value : []),
      ...(filtered.status === "fulfilled" ? filtered.value : []),
    ],
    failures,
  };
}

/**
 * `throwMissingGroupRequest` (reference:39974) — "not found" versus "could not look".
 *
 * The `AggregateError` carries the inbox failures as `errors`, so a caller that logs
 * only `error.message` still gets the reference's prefix and a caller that inspects
 * `errors` sees the real transport failures.
 */
function throwMissingGroupRequest(message: string, failures: readonly unknown[]): never {
  if (failures.length > 0) {
    throw new AggregateError(failures, `group request lookup incomplete: ${message}`);
  }
  throw new Error(message);
}

// ===========================================================================
// Applying one request
// ===========================================================================

/** The four facts `setAddRequest` needs, in the flag's own field order. */
interface RequestHandle {
  sequence: number;
  groupId: number;
  eventType: number;
  filtered: boolean;
  operateTransInfo?: Uint8Array | undefined;
}

/**
 * `resolveLiveGroupRequest` (reference:39978) — prefer the LIVE row over the one the
 * caller named.
 *
 * The caller's handle came from a `flag` string, which is a SNAPSHOT: the request may
 * have been re-issued since (a different `eventType`, a different `filtered` bucket),
 * and approving a stale `eventType` operates on the wrong sub-command. So the inbox is
 * searched for the same `(groupId, sequence)` with a positive `eventType`, and the live
 * row wins when found.
 *
 * The invite-card check comes first (`?.` — the member is optional on this context, see
 * its declaration) because a card's `groupId` is authoritative for a sequence that
 * belongs to an invitation rather than an application.
 *
 * When nothing matches, the caller's handle is returned UNCHANGED: the reference does
 * the same, on the reasoning that a request the inbox no longer lists is still worth
 * attempting — QQ's answer is the authority, not a cached page.
 */
async function resolveLiveGroupRequest(
  ctx: GroupRequestContext,
  handle: RequestHandle,
): Promise<RequestHandle> {
  if (
    ctx.contacts.findGroupInviteCardGroupBySequence?.(handle.sequence, handle.groupId) === handle.groupId
  ) {
    return handle;
  }
  const live = (await fetchRequestInboxes(ctx)).requests.find(
    (request) =>
      request.groupId === handle.groupId && request.sequence === handle.sequence && request.eventType > 0,
  );
  if (!live) return handle;
  return {
    sequence: live.sequence,
    groupId: live.groupId,
    eventType: live.eventType,
    filtered: live.filtered,
    ...(live.operateTransInfo === undefined ? {} : { operateTransInfo: live.operateTransInfo }),
  };
}

/**
 * `applyGroupRequest` (reference:39987) — the one place a request is approved.
 *
 * `knownLive` short-circuits the re-resolve: a caller that just read the row out of the
 * inbox has already done it, and re-fetching would double every approval's round-trips.
 */
async function applyGroupRequest(
  ctx: GroupRequestContext,
  handle: RequestHandle,
  approve: boolean,
  reason: string,
  knownLive?: RequestHandle,
): Promise<void> {
  const live = knownLive ?? (await resolveLiveGroupRequest(ctx, handle));
  log.debug(
    "handling group request: group=%d sequence=%d eventType=%d filtered=%s approve=%s",
    live.groupId,
    live.sequence,
    live.eventType,
    String(live.filtered),
    String(approve),
  );
  await ctx.groupAdmin.setAddRequest(
    live.groupId,
    live.sequence,
    live.eventType,
    approve,
    reason,
    live.filtered,
    live.operateTransInfo,
  );
}

// ===========================================================================
// The action entry point
// ===========================================================================

/**
 * `handleGroupAddRequest` (reference:39984) — `set_group_add_request`.
 *
 * Three flag grammars, and each takes a different route to the same `applyGroupRequest`:
 *
 *   * `canonical` (`slreq:1:…`) → straight through. Everything needed is in the flag.
 *   * `sequence`  (bare digits) → the invite-card group if known, else an inbox search
 *     by sequence alone. `eventType: 2` is hard-coded for the card path because an
 *     invitation approval IS type 2 (`isSelfGroupInvitation`), not because 2 is a
 *     default.
 *   * `legacy`    (`add:` / `invite:` + group + uid) → an inbox search with a
 *     different predicate: `add` matches the TARGET uid, `invite` matches the
 *     INVITOR uid, because an invitation is addressed by who sent it.
 *
 * The final ambiguity check — "do two different pending rows match?" — is what stops a
 * legacy flag from approving an arbitrary one of several identical requests. It throws
 * rather than picking, and the comparison is on all three of
 * `(sequence, eventType, filtered)` because any one differing means a different
 * sub-command.
 *
 * ⚠️ `_subType` is UNUSED, and that is the reference's behaviour rather than an
 * oversight: `handleGroupAddRequest` takes no sub-type (reference:39984) and the
 * adapter at reference:40049 discards it. The action schema accepts it for OneBot
 * compatibility, but the request type is recovered from the FLAG (`add`/`invite`), not
 * from the caller's claim — a client that sent `sub_type: "invite"` with an `add:` flag
 * gets the `add` behaviour, which is the safe direction.
 */
export async function handleGroupAddRequest(
  ctx: GroupRequestContext,
  flag: string,
  _subType: string,
  approve: boolean,
  reason: string,
): Promise<void> {
  const parsed = parseGroupRequestFlag(flag);

  if (parsed.kind === "canonical") {
    await applyGroupRequest(ctx, parsed, approve, reason);
    return;
  }

  if (parsed.kind === "sequence") {
    const cardGroupId = ctx.contacts.findGroupInviteCardGroupBySequence?.(parsed.sequence);
    if (cardGroupId) {
      await applyGroupRequest(
        ctx,
        { groupId: cardGroupId, sequence: parsed.sequence, eventType: 2, filtered: false },
        approve,
        reason,
      );
      return;
    }
    const lookup = await fetchRequestInboxes(ctx);
    const matching = lookup.requests.find((request) => request.sequence === parsed.sequence);
    if (!matching) {
      throwMissingGroupRequest(`group request sequence ${parsed.sequence} not found`, lookup.failures);
    }
    await applyGroupRequest(ctx, matching, approve, reason, matching);
    return;
  }

  // `legacy`. The invite-card notice is consulted ONLY for `invite` — an `add` request
  // has no notice to find, and asking would be a wasted lookup on the common path.
  const notice =
    parsed.requestType === "invite"
      ? ctx.contacts.getSelfInviteNotice?.(parsed.groupId, parsed.targetUid)
      : undefined;
  if (notice?.cardSequence) {
    await applyGroupRequest(
      ctx,
      { groupId: parsed.groupId, sequence: notice.cardSequence, eventType: 2, filtered: false },
      approve,
      reason,
    );
    return;
  }
  const lookup = await fetchRequestInboxes(ctx);
  // reference:40013-40019. Three predicates, and the middle two only apply when a
  // notice WAS found: a self-invitation must actually be one (`isSelfGroupInvitation`),
  // must target the bot (`targetUin === selfUin`) or carry no target at all, and must
  // carry the bot's own uid or none. A row that fails any of them is a DIFFERENT
  // member's invitation that happens to share the group.
  const candidates = lookup.requests.filter((request) => {
    if (request.groupId !== parsed.groupId || request.state !== 1 || request.eventType <= 0) return false;
    if (
      notice !== undefined &&
      (!isSelfGroupInvitation(request) ||
        (request.targetUin > 0 && request.targetUin !== ctx.selfUin) ||
        (request.targetUid && ctx.selfUid && request.targetUid !== ctx.selfUid))
    ) {
      return false;
    }
    return parsed.requestType === "add"
      ? request.targetUid === parsed.targetUid
      : request.invitorUid === parsed.targetUid;
  });
  const matching = candidates[0];
  if (!matching) {
    log.warn(
      "group request match failed: group=%d kind=%s selfInvitation=%s inboxTypes=%s",
      parsed.groupId,
      parsed.requestType,
      String(Boolean(notice)),
      lookup.requests
        .filter((request) => request.groupId === parsed.groupId)
        .map((request) => `${String(request.notifyType ?? "?")}:${request.eventType}:${request.state}`)
        .join(","),
    );
    throwMissingGroupRequest("matching group request not found", lookup.failures);
  }
  if (
    candidates.some(
      (request) =>
        request.sequence !== matching.sequence ||
        request.eventType !== matching.eventType ||
        request.filtered !== matching.filtered,
    )
  ) {
    throw new Error("multiple pending group requests match this flag");
  }
  await applyGroupRequest(ctx, matching, approve, reason, matching);
}

// ===========================================================================
// get_group_system_msg
// ===========================================================================

/**
 * `isSelfGroupInvitation` (reference:11180) now lives in the OIDB barrel
 * (`oidb/services/0x10c0.ts`, next to `formatGroupRequestFlag` — both are the same
 * reference region, `qq-info.ts`).
 *
 * It moved because `bridge/apis/contacts.ts`'s `resolveGroupJoinRequest` needs the
 * same predicate. `host/action-context-host.ts` builds ON the bridge, so the bridge
 * importing from `host/` would invert that direction; the OIDB barrel is what both
 * layers already depend on. The implementation is unchanged — see the import below.
 */

/**
 * `groupRequestActor` (reference:39648) — WHICH side of the request is the requester.
 *
 * An invitation the bot itself received (`eventType` 2 or 10, `isSelfGroupInvitation`)
 * is addressed by its INVITOR: the invitor is who the bot would be accepting. Every
 * other request is addressed by its TARGET: the target is who wants in.
 *
 * Getting this backwards produces a `get_group_system_msg` row whose `requester_uin`
 * is the group administrator rather than the applicant, which reads as a plausible
 * answer and is wrong on every invitation.
 */
function groupRequestActor(request: FilteredGroupRequestRow): {
  uid: string;
  uin: number;
  name: string;
} {
  if (isSelfGroupInvitation(request)) {
    return { uid: request.invitorUid, uin: request.invitorUin, name: request.invitorName };
  }
  return { uid: request.targetUid, uin: request.targetUin, name: request.targetName };
}

/** `mapWithConcurrency` (reference:11011) — batches, preserving input order. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.trunc(concurrency));
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    results.push(...(await Promise.all(batch.map((item) => fn(item)))));
  }
  return results;
}

/**
 * `resolveRequesterUins` (reference:39584) — fill in the uins the inbox row omits.
 *
 * The inbox carries uid AND uin for each party, but either can be empty depending on
 * which decode variant QQ answered with. This resolves the gaps against the roster
 * cache first and the profile service second, and the two key spaces are DIFFERENT:
 *
 *   * a uid we could not resolve is stored under the bare `uid`;
 *   * a uin with no name is stored under `uin:<uin>`, PREFIXED.
 *
 * The prefix is not cosmetic — a uid and a uin are both strings at the boundary and a
 * numeric uid would otherwise collide with a uin. The caller looks up both forms
 * (reference:39682).
 *
 * An explicit `uin > 0` WITH a name short-circuits: nothing needs resolving, and the
 * row already says who it is.
 *
 * Failure policy, in the reference's own order:
 *   * a profile fetch that THROWS is wrapped with `failed to resolve requester UIN for
 *     UID <uid>`, so the operator sees which request broke;
 *   * a profile that comes back with a non-positive uin THROWS (not skipped) — a
 *     resolved-to-nothing answer means the uid is invalid, and silently dropping it
 *     would make the row fall back to an uin of 0;
 *   * the by-UIN fallback SWALLOWS its error and skips the row: it is a best-effort
 *     name lookup, and failing the whole page because one nickname is unavailable would
 *     be a worse answer than the name the inbox already had.
 */
async function resolveRequesterUins(
  ctx: GroupRequestContext,
  requests: readonly FilteredGroupRequestRow[],
  findUinByUid: (uid: string, groupId?: number) => number | null | undefined,
): Promise<Map<string, { uin: number; name: string }>> {
  const resolved = new Map<string, { uin: number; name: string }>();
  const unresolved = new Set<string>();
  const names = new Map<string, string>();
  const unresolvedUins = new Set<number>();

  for (const request of requests) {
    const actor = groupRequestActor(request);
    const uid = actor.uid;
    if (actor.name) names.set(uid || `uin:${actor.uin}`, actor.name);
    if (uid && actor.uin > 0 && actor.name) {
      resolved.set(uid, { uin: actor.uin, name: actor.name });
      unresolved.delete(uid);
      continue;
    }
    if (uid) {
      if (resolved.has(uid) || unresolved.has(uid)) continue;
      // Scoped to the group first, then unscoped: the same uid can be a different
      // account in a different group's namespace, so the scoped answer wins.
      const cached = findUinByUid(uid, request.groupId) ?? findUinByUid(uid);
      if (cached && cached > 0 && actor.name) resolved.set(uid, { uin: cached, name: actor.name });
      else unresolved.add(uid);
      continue;
    }
    if (actor.uin > 0 && !actor.name) unresolvedUins.add(actor.uin);
  }

  const profiles = await mapWithConcurrency([...unresolved], REQUESTER_PROFILE_CONCURRENCY, async (uid) => {
    let profile: { uin: number; nickname: string };
    try {
      profile = await ctx.contacts.fetchUserProfileByUid(uid);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`failed to resolve requester UIN for UID ${uid}: ${message}`, { cause: error });
    }
    if (!Number.isSafeInteger(profile.uin) || profile.uin <= 0) {
      throw new Error(`failed to resolve requester UIN for UID ${uid}`);
    }
    return [uid, profile] as const;
  });
  for (const [uid, profile] of profiles) {
    resolved.set(uid, { uin: profile.uin, name: names.get(uid) || profile.nickname || "" });
  }

  const uinProfiles = await mapWithConcurrency(
    [...unresolvedUins],
    REQUESTER_PROFILE_CONCURRENCY,
    async (uin) => {
      try {
        return [uin, await ctx.contacts.fetchUserProfile(uin)] as const;
      } catch {
        // Best effort — see the doc comment.
        return [uin, undefined] as const;
      }
    },
  );
  for (const [uin, profile] of uinProfiles) {
    if (!profile) continue;
    resolved.set(`uin:${uin}`, { uin: profile.uin, name: profile.nickname || "" });
  }
  return resolved;
}

/** The `get_group_system_msg` query. Every member is optional but `count` has a default. */
export interface GroupSystemMessageQuery {
  groupId?: number | undefined;
  onlyPending: boolean;
  count: number;
}

/** One `get_group_system_msg` row — the reference's ten fields, in its own order. */
export interface GroupSystemMessageRow {
  group_id: number;
  group_name: string;
  request_id: number;
  requester_uin: number;
  requester_nick: string;
  invitor_uin: number;
  invitor_nick: string;
  message: string;
  checked: boolean;
  flag: string;
}

/**
 * `getGroupSystemMessages` (reference:39660) — `get_group_system_msg`.
 *
 * The pipeline, and why each stage exists:
 *
 *  1. BOTH inboxes are read (`Promise.all`, not `allSettled`) — unlike
 *     `set_group_add_request`, a page that silently omits the filtered bucket would
 *     look complete. A failure here propagates.
 *  2. Two filters, and both are needed: `isJoinOrInviteNotify(notifyType)` keeps only
 *     join/invite notifications (an admin change is not a request), and
 *     `eventType <= 0` drops rows whose notify type had no operation mapping — those
 *     cannot be acted on, and their `flag` would not round-trip through
 *     `parseGroupRequestFlag`'s `positiveSafeInteger`.
 *  3. DEDUPE by `flag`. The two inboxes can return the same request (a filtered
 *     request that later appears in the main bucket), and the first occurrence wins so
 *     the main bucket's view is preferred.
 *  4. The query filters apply AFTER dedupe — `onlyPending` is `state !== 1`, so
 *     `checked: request.state !== 1` is its exact complement.
 *  5. `resolveRequesterUins` runs on the FINAL list, so no profile is fetched for a
 *     row that was about to be filtered out.
 *
 * `requester_uin`/`requester_nick` prefer the RESOLVED values and fall back to the
 * row's own: resolution is a correction (the inbox may omit the uin), not a
 * replacement. `requester_nick` uses `||` rather than `??` on purpose — an empty
 * resolved name is worse than the actor's, and the reference writes it that way.
 */
export async function getGroupSystemMessages(
  ctx: GroupRequestContext,
  query: GroupSystemMessageQuery,
  findUinByUid: (uid: string, groupId?: number) => number | null | undefined,
): Promise<GroupSystemMessageRow[]> {
  const count = query.count ?? 50;
  if (!Number.isSafeInteger(count) || count < 1 || count > 100) {
    throw new Error(`invalid group-system-message count: ${count}`);
  }
  const [main, filtered] = await Promise.all([
    ctx.contacts.fetchFilteredGroupRequests(count, false),
    ctx.contacts.fetchFilteredGroupRequests(count, true),
  ]);

  const unique = new Map<string, FilteredGroupRequestRow>();
  for (const request of [...main, ...filtered]) {
    if (!isJoinOrInviteNotify(request.notifyType)) continue;
    if (request.eventType <= 0) continue;
    const flag = formatGroupRequestFlag(request);
    if (!unique.has(flag)) unique.set(flag, request);
  }

  const requests = [...unique.values()].filter((request) => {
    if (query.groupId !== undefined && request.groupId !== query.groupId) return false;
    if (query.onlyPending && request.state !== 1) return false;
    return true;
  });

  const requesterUins = await resolveRequesterUins(ctx, requests, findUinByUid);
  return requests.map((request) => {
    const actor = groupRequestActor(request);
    const resolved =
      (actor.uid ? requesterUins.get(actor.uid) : undefined) ??
      (actor.uin > 0 ? requesterUins.get(`uin:${actor.uin}`) : undefined);
    return {
      group_id: request.groupId,
      group_name: request.groupName,
      request_id: request.sequence,
      requester_uin: resolved?.uin ?? actor.uin,
      requester_nick: resolved?.name || actor.name,
      invitor_uin: request.invitorUin,
      invitor_nick: request.invitorName,
      message: request.comment,
      checked: request.state !== 1,
      flag: formatGroupRequestFlag(request),
    };
  });
}

/** `groupRequestOperationType` re-exported for callers that need the mapping alone. */
export { groupRequestOperationType };
