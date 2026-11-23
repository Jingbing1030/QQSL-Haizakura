// The `Namespace.invoke(ctx, params)` adapter over the OIDB layer.
//
// ---------------------------------------------------------------------------
// Why this file exists at all
// ---------------------------------------------------------------------------
// Every bridge module calls OIDB as `ClassName.invoke(this.ctx, params)`:
//
//     ModifyGroupExtInfo.invoke(this.ctx, { groupId, robotMemberSwitch, robotMemberExamine })
//     GetPskey.invoke(this.ctx, { domainList: [COLLECTION_DOMAIN] })
//
// `ts/src/oidb/spec.ts` has no `.invoke` member — it exposes `invokeOidb(ctx, spec,
// params)` as a free function, because the spec object is pure data (numbers +
// codec) and the reference only attaches `.invoke` afterwards through an IIFE:
//
//     _GetPskey.invoke = (deps, params) => invokeOidb(deps, GetPskey, params);
//     (reference/index.mjs:42569)
//
// That IIFE exists because the reference cannot pass `deps` to a free function at
// the call site without naming it. We can, so the port keeps `spec.ts` untouched
// and rebuilds the `.invoke` surface here, in the layer that wants it.
//
// ---------------------------------------------------------------------------
// Do not put this on the specs
// ---------------------------------------------------------------------------
// Attaching `.invoke` to each exported spec would make the OIDB barrel the
// authority on the bridge context, inverting the dependency (the bridge depends on
// OIDB, never the reverse) and creating a second definition of the same call
// template for every one of the 92 commands. One adapter, one place.

import type { BridgeContext } from "./context.js";
import type { OidbSpec } from "../oidb/spec.js";
import { invokeOidb } from "../oidb/spec.js";

/** The shape a bridge call site expects: one method, `ctx` first. */
export interface OidbCaller<TParams, TResult> {
  invoke(ctx: BridgeContext, params: TParams, timeoutMs?: number): Promise<TResult>;
}

/**
 * Wrap one spec as a callable namespace.
 *
 * The context is accepted as a `BridgeContext` and passed straight to `invokeOidb`,
 * which narrows it to `OidbContext` structurally. That assignability is the
 * reason `BridgeContext.sendRawPacket` returns the same shape `OidbContext`
 * declares, including the `-1` "no sender attached" code.
 */
export function oidbCaller<TParams, TWireReq, TWireResp, TResult>(
  spec: OidbSpec<TParams, TWireReq, TWireResp, TResult>,
): OidbCaller<TParams, TResult> {
  return {
    invoke(ctx: BridgeContext, params: TParams, timeoutMs?: number): Promise<TResult> {
      return timeoutMs === undefined
        ? invokeOidb(ctx, spec, params)
        : invokeOidb(ctx, spec, params, timeoutMs);
    },
  };
}