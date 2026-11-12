init_logger();
var MAX_CACHED_FORWARDS = 512;
var log$35 = createLogger("Bridge.Forward");
/** Nested results share the lifetime and recency of the result that supplied them. */
var ForwardResultCache = class {
	entries = /* @__PURE__ */ new Map();
	get(resId) {
		let hit;
		for (const [rootId, layers] of this.entries) {
			const nodes = layers.get(resId);
			if (nodes) hit = {
				rootId,
				resId,
				layers,
				nodes
			};
		}
		if (hit) {
			this.entries.delete(hit.rootId);
			this.entries.set(hit.rootId, hit.layers);
		}
		return hit;
	}
	set(rootId, layers) {
		if (!layers.has(rootId)) throw new Error("forward cache entry is missing its outer result");
		this.entries.delete(rootId);
		this.entries.set(rootId, new Map(layers));
		while (this.entries.size > MAX_CACHED_FORWARDS) {
			const oldest = this.entries.entries().next().value;
			this.entries.delete(oldest[0]);
			log$35.trace("forward cache evicted: res_id=%s layers=%d remaining=%d", oldest[0], oldest[1].size, this.entries.size);
		}
	}
	update(hit, nodes) {
		if (this.entries.get(hit.rootId) === hit.layers && hit.layers.get(hit.resId) === hit.nodes) hit.layers.set(hit.resId, nodes);
	}
};
