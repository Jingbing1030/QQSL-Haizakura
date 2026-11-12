var DebounceMachine = class {
	states = /* @__PURE__ */ new Map();
	/** Account went offline. `debounceSeconds` is read fresh from config so a
	*  reload takes effect on the next transition. */
	onOffline(uin, debounceSeconds) {
		if (this.states.has(uin)) return { kind: "none" };
		if (!Number.isFinite(debounceSeconds) || debounceSeconds <= 0) {
			this.states.set(uin, "offline");
			return {
				kind: "emit",
				event: "offline"
			};
		}
		this.states.set(uin, "pending");
		return {
			kind: "schedule",
			delayMs: debounceSeconds * 1e3
		};
	}
	/** Account came online. */
	onOnline(uin) {
		const state = this.states.get(uin);
		this.states.delete(uin);
		if (state === "pending") return { kind: "cancel" };
		if (state === "offline") return {
			kind: "emit",
			event: "online"
		};
		return { kind: "none" };
	}
	/** The offline debounce window elapsed (the armed timer fired). */
	onTimerElapsed(uin) {
		if (this.states.get(uin) !== "pending") return { kind: "none" };
		this.states.set(uin, "offline");
		return {
			kind: "emit",
			event: "offline"
		};
	}
};
