// The shape every OIDB service shares.
//
// The reference calls this `OidbSpec` (reference/index.mjs:19136 `invokeOidb`
// consumes exactly these members).  Keeping the same shape here means the 87
// commands differ only in their data, and the generic `invokeOidb` below is
// written once.
//
// Reference: reference/index.mjs:19102 (`resolveOidbCall`),
// reference/index.mjs:19108 (`isAcceptedEnvelopeCode`).

import {
  OidbError,
  decodeOidbResponse,
  encodeOidbEnvelope,
  makeOidbEnvelope,
  oidbWireName,
  type DecodedOidbEnvelope,
} from "./envelope.js";

/**
 * One OIDB command: its numbers, its codec, and how to build/consume the body.
 *
 * `TParams` is the action-level input; `TWireReq`/`TWireResp` are the request
 * and response bodies as JSON-shaped data (so tests can compare them literally);
 * `TResult` is the business result after `deserialize`.
 *
 * Request and response shapes are separate type parameters on purpose: most
 * commands answer with a different message than they send, and a shared
 * parameter would force `decodeBody` to return the request type — which is the
 * mistake that makes a decoder look type-safe while returning nothing useful.
 */
export interface OidbSpec<TParams, TWireReq, TWireResp, TResult> {
  /** The `0xNNNN` command id. */
  readonly command: number;
  /** The `_N` suffix.  Omitted when `resolveSubCommand` picks it per call. */
  readonly subCommand?: number;
  /**
   * Set when the command carries a uin/uid mode switch.  `true` puts `reserved=1`
   * on the wire.  See the envelope header for why the name is misleading.
   */
  readonly uinForm?: boolean;
  /** Choose the sub-command per call (0x10c0 uses 1 for main, 2 for filtered). */
  readonly resolveSubCommand?: (params: TParams) => number;
  /** Envelope error codes this spec handles itself rather than throwing on. */
  readonly acceptedEnvelopeCodes?: readonly number[];
  /** Override the wire command name; only 0xeb7_1 needs it. */
  readonly wireName?: (command: number, subCommand: number) => string;
  /** Build the body from action parameters. */
  readonly serialize: (params: TParams) => TWireReq;
  /** Encode the request body alone. */
  readonly encodeBody: (body: TWireReq) => Uint8Array;
  /** Decode the response body alone. */
  readonly decodeBody: (data: Uint8Array, offset?: number, end?: number) => TWireResp;
  /** Map the decoded response body onto the business result. */
  readonly deserialize: (body: TWireResp) => TResult;
}

/** Resolve the command/sub-command pair for one call. */
export function resolveOidbCall<TParams, TWireReq, TWireResp, TResult>(
  spec: OidbSpec<TParams, TWireReq, TWireResp, TResult>,
  params: TParams,
): { command: number; subCommand: number } {
  return {
    command: spec.command,
    subCommand: spec.resolveSubCommand ? spec.resolveSubCommand(params) : (spec.subCommand ?? 0),
  };
}

/** What `sendRawPacket` is expected to hand back. */
export interface OidbTransportResult {
  gotResponse: boolean;
  success: boolean;
  errorCode?: number;
  errorMessage?: string;
  responseData?: Uint8Array;
}

/** The one capability `invokeOidb` needs from its context. */
export interface OidbContext {
  sendRawPacket(wireName: string, request: Uint8Array, timeoutMs?: number): Promise<OidbTransportResult>;
}

/**
 * The single template every OIDB call goes through.
 *
 * Order of operations matters and is copied from the reference
 * (reference/index.mjs:19136-19158):
 *
 *   1. build envelope -> encode -> send
 *   2. fail if no response; fail on a transport error code
 *   3. decode the *envelope* first and fail on its error code, so a server-side
 *      rejection surfaces as OidbError instead of a confusing body parse error
 *   4. decode the body and let the spec map it
 *
 * Step 3 is the one worth preserving carefully: without it, an error response
 * whose body is empty or truncated raises "Truncated protobuf field" and the
 * real cause (the server's errorMessage) is lost.
 */
export async function invokeOidb<TParams, TWireReq, TWireResp, TResult>(
  ctx: OidbContext,
  spec: OidbSpec<TParams, TWireReq, TWireResp, TResult>,
  params: TParams,
  timeoutMs?: number,
): Promise<TResult> {
  const { command, subCommand } = resolveOidbCall(spec, params);
  const body = spec.encodeBody(spec.serialize(params));
  const envelope = makeOidbEnvelope(command, subCommand, body, spec.uinForm === true);
  const request = encodeOidbEnvelope(envelope);
  const wireName = spec.wireName
    ? spec.wireName(command, subCommand)
    : oidbWireName(command, subCommand);

  const result = timeoutMs === undefined
    ? await ctx.sendRawPacket(wireName, request)
    : await ctx.sendRawPacket(wireName, request, timeoutMs);

  if (!result.gotResponse) throw new Error(result.errorMessage || "no response");
  if (!result.success) {
    if (result.errorCode !== undefined && result.errorCode !== 0) {
      if (spec.acceptedEnvelopeCodes?.includes(result.errorCode) !== true) {
        throw new OidbError(result.errorCode, result.errorMessage || "", command, subCommand);
      }
    } else {
      throw new Error(result.errorMessage || "packet send failed");
    }
  }

  const responseBytes = result.responseData ?? new Uint8Array(0);
  const decoded: DecodedOidbEnvelope<TWireResp> = decodeOidbResponse(
    spec.acceptedEnvelopeCodes === undefined
      ? { command, subCommand }
      : { command, subCommand, acceptedEnvelopeCodes: spec.acceptedEnvelopeCodes },
    responseBytes,
    spec.decodeBody,
  );

  return spec.deserialize(decoded.body ?? ({} as TWireResp));
}