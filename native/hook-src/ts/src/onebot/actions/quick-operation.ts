// OneBot v11 "quick operation": the `operation` object an HTTP reporter returns in
// a JSON response body is applied to the event that produced it.
//
// Reference region: `../onebot/src/network/quick-operation.ts`
// (reference/index.mjs:21378-21445), and the raw reservation that exposes it at
// reference:21367-21376 plus the factory `ApiHandler` builds for it at
// reference:21482-21492.
//
// ---------------------------------------------------------------------------
// Why this is a RAW action and not a `defineAction`
// ---------------------------------------------------------------------------
// Every other action validates `params` through `defineAction`'s field kit. This one
// cannot: its `params` are `{context, operation}` where `context` is the *event* the
// action itself is a reaction to and `operation` is an untyped v11 object whose keys
// are all optional and mutually independent. The reference therefore registers it as a
// **raw reservation** — a name that exists in the registry, lives outside
// `ACTION_GROUPS` (so it contributes no definition, alias or category), and binds to a
// hand-written handler instead of a `toHandler`.
//
// Adding it to an `ACTION_GROUPS` family would have been the wrong shape twice over:
// it would inflate the 222/228 definition/name parity numbers the registry is measured
// against, and it would give it a category and a documented params schema that the
// reference does not have.
//
// ---------------------------------------------------------------------------
// The semantics, transcribed
// ---------------------------------------------------------------------------
// `operation` is applied in this order (the reference's statement order, which is
// observable because the calls are awaited sequentially):
//
//   post_type "message":
//     1. `reply`  — non-undefined, non-null, non-"" ⇒ send_group_msg (group) or
//                    send_private_msg (private). In a GROUP, when `at_sender !==
//                    false` and the event has a truthy `user_id`, an `at` segment is
//                    prepended: a string reply is rewritten to
//                    `[at, text]` and **`auto_escape` is forced to false** (the
//                    string is carried as a text segment, so escaping it again would
//                    double-encode it); an array reply is spread after the at segment
//                    and keeps the caller's `auto_escape`.
//     2. `delete` — truthy ⇒ delete_msg with the event's `message_id`.
//     3. `ban`    — truthy AND the event is a group message ⇒ set_group_ban with
//                    `ban_duration` when it is a number, else 1800.
//     4. `kick`   — truthy AND the event is a group message ⇒ set_group_kick with
//                    `reject_add_request: !!operation.reject_add_request`.
//
//   post_type "request":
//     5. `approve` — present (`!== undefined`, so `null` counts) ⇒
//                    set_friend_add_request (friend) or set_group_add_request (group),
//                    with `remark`/`reason` defaulting to `""`.
//
// Anything else — an absent `operation`, an empty object, unknown keys, an event whose
// `post_type` is neither `message` nor `request` — is a NO-OP that answers 1200/ok. It
// never throws: `operation` is never destructured or validated, every field is read
// through a truthiness/presence test.

import type { ApiResponse } from "../types.js";
import { okResponse, failedResponse, RETCODE } from "../types.js";

/** The hidden action name; `_async` is the NoneBot 1 alias. Reference:21367,21373. */
export const HANDLE_QUICK_OPERATION_ACTION = ".handle_quick_operation";
export const HANDLE_QUICK_OPERATION_ASYNC_ACTION = ".handle_quick_operation_async";

/**
 * The slice of `OneBotApi` this module dispatches through.
 *
 * Structural on purpose: the quick operation must reach the SAME `api.handle` the
 * transports use (so the quiesce gate, the 1404 path and the response envelope are
 * shared), but it must not import the whole `OneBotApi` surface — a narrower type
 * keeps this file from being a second place to maintain when that interface grows.
 */
export interface QuickOperationApi {
  handle(action: string, params: Record<string, unknown>): Promise<ApiResponse>;
}

/** The v11 `operation` object: every key optional and independently applied. */
export type QuickOperation = Record<string, unknown>;

/**
 * `executeQuickOperation` — reference:21379.
 *
 * Returns nothing; every outcome is expressed as a dispatched action. The caller
 * (`createHandleQuickOperation`) answers `okResponse()` regardless of what the inner
 * calls answered, which is the reference's behaviour: the reporter's HTTP response has
 * already been sent, so a failed inner action can only be logged, and the log line is
 * the transport's (`http.ts`'s `handleQuickOperation`).
 */
export async function executeQuickOperation(
  event: Record<string, unknown>,
  operation: QuickOperation,
  api: QuickOperationApi,
): Promise<void> {
  const postType = event["post_type"];

  if (postType === "message") {
    // `!== void 0 && !== null && !== ""` — three separate tests, not a truthiness
    // check: `reply: 0` is a present (if nonsensical) reply that the reference still
    // sends, and `reply: ""` is a deliberate no-op.
    const reply = operation["reply"];
    if (reply !== undefined && reply !== null && reply !== "") {
      const messageType = event["message_type"];
      const autoEscape = !!operation["auto_escape"];
      if (messageType === "group") {
        const params: Record<string, unknown> = {
          group_id: event["group_id"],
          message: reply,
          auto_escape: autoEscape,
        };
        // Truthiness, not presence: `user_id: 0` must NOT produce an at segment.
        if (operation["at_sender"] !== false && event["user_id"]) {
          const atSegment = { type: "at", data: { qq: String(event["user_id"]) } };
          if (typeof reply === "string") {
            params["message"] = [atSegment, { type: "text", data: { text: reply } }];
            // The string became a text segment, so it is no longer escaped.
            params["auto_escape"] = false;
          } else if (Array.isArray(reply)) {
            params["message"] = [atSegment, ...reply];
          }
        }
        await api.handle("send_group_msg", params);
      } else if (messageType === "private") {
        await api.handle("send_private_msg", {
          user_id: event["user_id"],
          message: reply,
          auto_escape: autoEscape,
        });
      }
    }

    if (operation["delete"]) await api.handle("delete_msg", { message_id: event["message_id"] });

    if (operation["ban"] && event["message_type"] === "group") {
      const duration = typeof operation["ban_duration"] === "number" ? operation["ban_duration"] : 1800;
      await api.handle("set_group_ban", {
        group_id: event["group_id"],
        user_id: event["user_id"],
        duration,
      });
    }

    if (operation["kick"] && event["message_type"] === "group") {
      await api.handle("set_group_kick", {
        group_id: event["group_id"],
        user_id: event["user_id"],
        reject_add_request: !!operation["reject_add_request"],
      });
    }
  }

  if (postType === "request") {
    // `!== void 0` — `approve: null` is a present value here and is dispatched as
    // such; the receiving action is what rejects it (1400 "approve: expected a
    // boolean"), exactly as it would for a direct call.
    if (operation["approve"] !== undefined) {
      const requestType = event["request_type"];
      if (requestType === "friend") {
        await api.handle("set_friend_add_request", {
          flag: event["flag"],
          approve: operation["approve"],
          remark: operation["remark"] ?? "",
        });
      } else if (requestType === "group") {
        await api.handle("set_group_add_request", {
          flag: event["flag"],
          sub_type: event["sub_type"],
          approve: operation["approve"],
          reason: operation["reason"] ?? "",
        });
      }
    }
  }
}

/** What a raw factory produces: the registry-facing handler. */
export type QuickOperationHandler = (params: Record<string, unknown>) => Promise<ApiResponse>;

/**
 * The raw factory `ApiHandler` builds — reference:21483-21491.
 *
 * `context` and `operation` are both required and both tested for truthiness, so a
 * missing pair answers 1400 `context and operation are required` — that wording is
 * the reference's, and it is the only failure this action itself produces.
 */
export function createHandleQuickOperation(api: QuickOperationApi): QuickOperationHandler {
  return async (params: Record<string, unknown>): Promise<ApiResponse> => {
    const opContext = params["context"];
    const operation = params["operation"];
    if (!opContext || !operation) return failedResponse(RETCODE.BAD_REQUEST, "context and operation are required");
    await executeQuickOperation(opContext as Record<string, unknown>, operation as QuickOperation, api);
    return okResponse();
  };
}
