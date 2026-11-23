// `CollectionApi` — read-only access to the account's QQ collection (收藏) list.
//
// Reference region: src/bridge/apis/collection.ts (reference/index.mjs:46966, 21
// lines). This is the smallest bridge module and the first one this port lands,
// because its entire OIDB surface is one class that already exists.
//
// Verbatim from the reference — the whole class body is these three statements:
//
//     const { domainPskeyMap } = await GetPskey.invoke(this.ctx, { domainList: [COLLECTION_DOMAIN] });
//     const pskey = domainPskeyMap.get(COLLECTION_DOMAIN);
//     if (!pskey) throw new Error(`QQ did not return a p_skey for ${COLLECTION_DOMAIN}`);
//     return getCollectionList({ uin: this.ctx.identity.uin, pskey, category, count });
//
// Two things worth noticing:
//
//  * `GetPskey` is `0x102a_0` — real OIDB, and `ts/src/oidb/services/0x102a.ts`
//    already has it. That is the only reason this module is portable today.
//  * The `!pskey` throw is not defensive padding. `GetPskey.deserialize` drops
//    empty `(domain, pskey)` pairs, so a domain the server declined to mint a key
//    for arrives as a MISSING map entry, and the honest report is that QQ did not
//    return one — not "the collection is empty". Without the throw the next call
//    would fail with a Weiyun `retCode` that says nothing about the real cause.

import { GetPskey } from "../../oidb/services/index.js";
import type { BridgeContext } from "../context.js";
import { oidbCaller } from "../oidb-invoke.js";
import { getCollectionList, type CollectionListResult, type CollectionTransport } from "../web/collection.js";

/** The single domain this API asks a pskey for. */
export const COLLECTION_DOMAIN = "weiyun.com";

/**
 * `GetPskey.invoke` from the reference, rebuilt from the ported spec.
 *
 * `GetPskey` itself stays a plain `OidbSpec`; see `../oidb-invoke.ts` for why the
 * adapter lives in the bridge layer instead of on the spec.
 */
const GetPskeyCaller = oidbCaller(GetPskey);

export class CollectionApi {
  readonly ctx: BridgeContext;

  constructor(ctx: BridgeContext) {
    this.ctx = ctx;
  }

  /**
   * `category = 0` means "all categories"; the wire value is passed through
   * unchanged. `count` is the caller's page size, validated downstream.
   */
  async list(category = 0, count = 50): Promise<CollectionListResult> {
    const { domainPskeyMap } = await GetPskeyCaller.invoke(this.ctx, { domainList: [COLLECTION_DOMAIN] });
    const pskey = domainPskeyMap.get(COLLECTION_DOMAIN);
    if (!pskey) throw new Error(`QQ did not return a p_skey for ${COLLECTION_DOMAIN}`);
    return getCollectionList({
      uin: this.ctx.identity.uin,
      pskey,
      category,
      count,
    });
  }

  /**
   * Same call with an injectable transport.
   *
   * Not in the reference: the reference reaches the network through a module-level
   * `fetch`. A test (or a host that routes egress through a proxy) needs the seam,
   * and adding it as a separate method keeps `list()` byte-identical in behaviour.
   */
  async listWithTransport(
    transport: CollectionTransport,
    category = 0,
    count = 50,
  ): Promise<CollectionListResult> {
    const { domainPskeyMap } = await GetPskeyCaller.invoke(this.ctx, { domainList: [COLLECTION_DOMAIN] });
    const pskey = domainPskeyMap.get(COLLECTION_DOMAIN);
    if (!pskey) throw new Error(`QQ did not return a p_skey for ${COLLECTION_DOMAIN}`);
    return getCollectionList({
      uin: this.ctx.identity.uin,
      pskey,
      category,
      count,
      transport,
    });
  }
}