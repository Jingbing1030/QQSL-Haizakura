var COLLECTION_DOMAIN = "weiyun.com";
/** Read-only access to the account's QQ collection list. */
var CollectionApi = class {
	ctx;
	constructor(ctx) {
		this.ctx = ctx;
	}
	async list(category = 0, count = 50) {
		const { domainPskeyMap } = await GetPskey.invoke(this.ctx, { domainList: [COLLECTION_DOMAIN] });
		const pskey = domainPskeyMap.get(COLLECTION_DOMAIN);
		if (!pskey) throw new Error(`QQ did not return a p_skey for ${COLLECTION_DOMAIN}`);
		return getCollectionList({
			uin: this.ctx.identity.uin,
			pskey,
			category,
			count
		});
	}
};
