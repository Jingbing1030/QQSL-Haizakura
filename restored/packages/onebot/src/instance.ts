// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/instance.ts"
// original bundle lines 342558-343045  (486 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
init_logger();
var moduleLog$1 = createLogger("Event");
var OneBotInstance = class OneBotInstance {
	uin;
	bridge;
	apiHandler;
	converterCtx;
	messageStore;
	mediaStore;
	reactionStore;
	networkManager;
	networkReady;
	lifecycleTail;
	rkeyCache;
	ctx;
	/** Account-session uptime shared by the status action and `#sl`. */
	startedAt = Date.now();
	/** Per-conversation last-reply timestamp for the `#sl` cooldown. */
	statusCommandCooldown = /* @__PURE__ */ new Map();
	/** Reported self sends retained while matching subsequent QQ echoes. */
	recentSelfSentEvents = /* @__PURE__ */ new Map();
	eventPipeline = null;
	eventPipelineDrain = Promise.resolve();
	disposePromise = null;
	disposeRequested = false;
	acceptingActions = true;
	inFlightActions = /* @__PURE__ */ new Set();
	historySyncAbortController = new AbortController();
	historySyncEnabledAtStartup;
	historySyncStartRequested = false;
	historySyncTask = null;
	storeCloseState = {
		message: false,
		media: false,
		reaction: false
	};
	pids = /* @__PURE__ */ new Set();
	online = true;
	heartbeatTimer = null;
	static HEARTBEAT_INTERVAL = 3e4;
	log;
	get nickname() {
		return this.bridge.identity.nickname;
	}
	/** Live status of this account's OneBot network adapters. */
	getConnectionStatuses() {
		return this.networkManager.describeStatuses();
	}
	/** Tap every emitted OneBot event for this account. Returns an unsubscribe. */
	subscribeDebugEvents(cb) {
		return this.networkManager.subscribeDebug(cb);
	}
	/** Observe every handled action for this account. Returns an unsubscribe. */
	observeActions(cb) {
		return this.apiHandler.setObserver(cb);
	}
	/** Invoke an OneBot action against this account (debug tester). */
	invokeAction(action, params) {
		return this.trackAction(`debug action ${action}`, () => this.apiHandler.handle(action, params));
	}
	/** Drive an action through the streaming seam (debug tester, stream actions).
	*  `rawRequest` is a `{action, params, echo?}` JSON string; `emit` receives
	*  each frame as a JSON string. Non-stream actions emit a single frame. */
	invokeStream(rawRequest, emit, isAlive) {
		return this.trackAction("debug stream action", () => this.apiHandler.processStreamRequest(rawRequest, emit, isAlive));
	}
	constructor(uin, bridge, config, globalSettings) {
		this.uin = uin;
		this.bridge = bridge;
		this.historySyncEnabledAtStartup = config.historySync.enabled;
		const uinNum = Number.parseInt(uin, 10);
		this.log = Number.isFinite(uinNum) && uinNum > 0 ? moduleLog$1.child({ uin: uinNum }) : moduleLog$1;
		this.rkeyCache = new RKeyCache(globalSettings.rkey);
		this.mediaStore = new MediaStore(path$1.join("data", this.uin, "messages.db"));
		this.messageStore = new MessageStore(path$1.join("data", this.uin, "messages.json"));
		this.reactionStore = new ReactionStore(path$1.join("data", this.uin, "reactions.db"));
		const mediaUrlResolver = new MediaUrlResolver(this.bridge, this.rkeyCache);
		const mediaIndexer = new MediaIndexer(this.mediaStore);
		this.converterCtx = {
			selfId: parseInt(this.uin, 10) || 0,
			imageUrlResolver: (element, isGroup) => this.rkeyCache.resolveImageUrl(this.bridge, element, isGroup),
			mediaUrlResolver: (element, isGroup, sessionId) => mediaUrlResolver.resolve(element, isGroup, sessionId),
			messageIdResolver: createMessageIdResolver(this.messageStore),
			mediaSegmentSink: async (mediaType, element, data, isGroup, sessionId) => await mediaIndexer.remember(mediaType, element, data, isGroup, sessionId)
		};
		const ctx = {
			uin: this.uin,
			selfId: parseInt(this.uin, 10) || 0,
			bridge: this.bridge,
			messageStore: this.messageStore,
			mediaStore: this.mediaStore,
			reactionStore: this.reactionStore,
			tempSessions: new TempSessionStore(),
			converterCtx: this.converterCtx,
			config,
			musicSignUrl: globalSettings.musicSignUrl,
			getUptimeMs: () => Math.max(0, Date.now() - this.startedAt),
			cacheMessageMeta: async (messageId, meta) => await this.cacheMessageMeta(messageId, meta),
			dispatchEvent: (event, source = "bridge", startedAt) => this.dispatchEvent(event, source, startedAt)
		};
		this.ctx = ctx;
		this.apiHandler = new ApiHandler(buildApiContext(ctx), uinNum > 0 ? uinNum : void 0);
		const networkCtx = this.buildNetworkContext();
		this.networkManager = new OneBotNetworkManager((desired) => this.createNetworkAdapter(desired, networkCtx));
		this.networkReady = Promise.all([
			bridge.identity.initialization,
			this.messageStore.initialization,
			this.mediaStore.initialization,
			this.reactionStore.initialization
		]).then(() => this.networkManager.reconcile(config));
		this.lifecycleTail = this.networkReady.then(() => void 0, () => void 0);
		this.startHeartbeat();
		this.rkeyCache.warmUp(this.bridge, this.uin);
		this.eventPipeline = registerEventPipeline(ctx);
	}
	waitUntilNetworkReady() {
		return this.networkReady;
	}
	/** Bridge session edge → OneBot notice. Awaited so offline can leave
	*  adapters before this generation is disposed. */
	emitBotStatus(subType) {
		return this.dispatchEvent(makeBotStatusEvent(parseInt(this.uin, 10) || 0, subType));
	}
	/**
	* Start the optional login-time backfill once roster warmup has completed.
	* The startup snapshot is intentional: hot config edits take effect on the
	* next account lifecycle and never cause an unexpected QQ request.
	*/
	startLoginHistorySync() {
		if (this.historySyncStartRequested || this.disposeRequested) return;
		this.historySyncStartRequested = true;
		if (!this.historySyncEnabledAtStartup) {
			this.log.debug("login history sync disabled for this account lifecycle");
			return;
		}
		this.historySyncTask = loginHistorySyncCoordinator.schedule({
			selfId: Number.parseInt(this.uin, 10) || 0,
			bridge: this.bridge,
			messageStore: this.messageStore,
			converterCtx: this.converterCtx
		}, this.historySyncAbortController.signal).then(() => void 0, (error) => {
			if (this.historySyncAbortController.signal.aborted) {
				this.log.debug("login history sync cancelled: %s", error instanceof Error ? error.message : String(error));
				return;
			}
			this.log.error("login history sync failed: %s", error instanceof Error ? error.stack ?? error.message : String(error));
		});
	}
	reloadConfig(config) {
		if (this.disposeRequested) return Promise.reject(/* @__PURE__ */ new Error(`OneBot instance UIN=${this.uin} is disposing`));
		const snapshot = structuredClone(config);
		this.networkManager.compileDesiredPlan(snapshot);
		return this.enqueueLifecycle(async () => {
			this.ctx.config = snapshot;
			return this.networkManager.reconcile(snapshot);
		});
	}
	/** Apply edited global (all-accounts) settings without a restart. Called by
	*  the manager when config/snowluma.json is saved from the WebUI. */
	applyGlobalSettings(globalSettings) {
		this.rkeyCache.setFallbackServers(globalSettings.rkey.fallbackServers);
		this.ctx.musicSignUrl = globalSettings.musicSignUrl;
	}
	/** Drop listeners and sockets without waiting for shutdown to finish.
	*  Used when dispose() does not settle and a replacement session must bind. */
	forceRelease() {
		try {
			this.quiesce();
		} catch (error) {
			this.log.warn("quiesce during forced release failed: %s", error instanceof Error ? error.message : String(error));
		}
		this.networkManager.forceRelease();
	}
	/** Synchronously stop every ingress seam for this instance generation.
	*
	* This operation is sticky and idempotent. It is intentionally separate
	* from the asynchronous resource release so the manager can quiesce all
	* generations before waiting for older lifecycle work to settle. */
	quiesce() {
		if (this.disposeRequested) return;
		this.disposeRequested = true;
		this.acceptingActions = false;
		this.apiHandler.quiesce();
		this.online = false;
		this.stopHeartbeat();
		this.historySyncAbortController?.abort(/* @__PURE__ */ new Error(`OneBot instance UIN=${this.uin} is disposing`));
		const pipeline = this.eventPipeline;
		if (pipeline) {
			pipeline.stop();
			this.eventPipeline = null;
			this.eventPipelineDrain = pipeline.drain();
		}
	}
	dispose() {
		if (this.disposePromise) return this.disposePromise;
		this.quiesce();
		const attempt = this.enqueueLifecycle(async () => {
			await Promise.all([
				Promise.all(this.inFlightActions),
				this.eventPipelineDrain,
				this.historySyncTask ?? Promise.resolve()
			]);
			const shutdown = await this.networkManager.shutdown();
			if (!shutdown.closed) throw new AggregateError(shutdown.errors.map((error) => /* @__PURE__ */ new Error(`adapter ${error.name} ${error.phase} failed: ${error.message}`)), `network shutdown incomplete for UIN=${this.uin}; stores remain open`);
			const closeErrors = [];
			const stores = [
				["message", async () => await this.messageStore.close()],
				["media", async () => await this.mediaStore.close()],
				["reaction", async () => await this.reactionStore.close()]
			];
			for (const [name, close] of stores) {
				if (this.storeCloseState[name]) continue;
				try {
					await close();
					this.storeCloseState[name] = true;
				} catch (error) {
					closeErrors.push(error);
				}
			}
			if (closeErrors.length > 0) throw new AggregateError(closeErrors, `failed to close OneBot stores for UIN=${this.uin}`);
			return shutdown;
		});
		this.disposePromise = attempt;
		attempt.then(() => void 0, () => {
			if (this.disposePromise === attempt) this.disposePromise = null;
		});
		return attempt;
	}
	addPid(pid) {
		this.pids.add(pid);
	}
	removePid(pid) {
		this.pids.delete(pid);
	}
	hasPid(pid) {
		return this.pids.has(pid);
	}
	getPids() {
		return [...this.pids];
	}
	get empty() {
		return this.pids.size === 0;
	}
	async dispatchEvent(event, source = "bridge", startedAt = Date.now()) {
		if (!await this.cacheMessageEvent(event)) {
			this.traceEventHandoffTerminal(event, startedAt, "suppressed", "private_recall");
			return;
		}
		if (source === "bridge") {
			if (this.isDuplicateSelfSentEcho(event)) {
				this.log.trace("duplicate self-message echo suppressed message_id=%d message_seq=%d", toInt(event.message_id), toInt(event.message_seq));
				this.traceEventHandoffTerminal(event, startedAt, "suppressed", "duplicate_self_echo");
				return;
			}
			if (event.post_type === "message_sent") this.rememberSelfSentEvent(event);
		} else this.rememberSelfSentEvent(event);
		if (source === "bridge") await this.logReceivedMessage(event);
		if (source === "bridge" && this.handleStatusCommand(event)) {
			this.traceEventHandoffTerminal(event, startedAt, "suppressed", "status_command");
			return;
		}
		this.traceEventHandoffTerminal(event, startedAt, "reporting_started");
		try {
			await this.networkManager.emitEvent(event);
		} catch (err) {
			this.log.warn("emitEvent failed: %s", err instanceof Error ? err.stack ?? err.message : String(err));
		}
	}
	traceEventHandoffTerminal(event, startedAt, outcome, reason) {
		this.log.trace(() => [
			"event_terminal post_type=%s outcome=%s%s ms=%d",
			String(event.post_type ?? "?"),
			outcome,
			reason === void 0 ? "" : ` reason=${reason}`,
			Date.now() - startedAt
		]);
	}
	rememberSelfSentEvent(event) {
		const key = selfSentEventKey(event);
		if (key === null) return;
		const now = Date.now();
		this.sweepSelfSentEvents(now);
		this.recentSelfSentEvents.set(key, {
			event,
			expiresAt: now + SELF_SENT_ECHO_WINDOW_MS
		});
	}
	isDuplicateSelfSentEcho(event) {
		const key = selfSentEventKey(event);
		if (key === null) return false;
		const now = Date.now();
		this.sweepSelfSentEvents(now);
		const pending = this.recentSelfSentEvents.get(key);
		if (!pending || !sameSelfSentMessage(pending.event, event)) return false;
		return true;
	}
	sweepSelfSentEvents(now) {
		for (const [key, pending] of this.recentSelfSentEvents) if (pending.expiresAt <= now) this.recentSelfSentEvents.delete(key);
	}
	/**
	* Built-in `#sl` status command. Returns `true` when the event matched AND
	* `swallow` is configured — the caller then skips `emitEvent` so downstream
	* adapters never see it. The reply itself is fired async and rate-limited
	* per conversation; matching and replying are independent of swallowing.
	*/
	handleStatusCommand(event) {
		const cfg = this.ctx.config.statusCommand;
		if (!cfg.enabled) return false;
		const postType = event.post_type;
		if (postType !== "message" && postType !== "message_sent") return false;
		if (!matchesStatusCommand(event.message, cfg.trigger)) return false;
		const isGroup = event.message_type === "group";
		const sessionId = isGroup ? toInt(event.group_id) : toInt(event.user_id);
		if (sessionId === 0) return cfg.swallow;
		const key = `${isGroup ? "g" : "p"}:${sessionId}`;
		const now = Date.now();
		if (statusCooldownElapsed(this.statusCommandCooldown.get(key), now, cfg.cooldownSeconds)) {
			this.statusCommandCooldown.set(key, now);
			this.trackAction("status command reply", () => this.replyStatus(isGroup, sessionId));
		}
		return cfg.swallow;
	}
	async replyStatus(isGroup, sessionId) {
		const text = buildStatusText({
			version: APP_VERSION,
			platform: process.platform,
			arch: process.arch,
			uptimeMs: this.ctx.getUptimeMs()
		});
		if (isGroup) await sendGroupMessage(this.ctx, sessionId, text, true);
		else await sendPrivateMessage(this.ctx, sessionId, text, true);
	}
	buildNetworkContext() {
		return {
			uin: this.uin,
			api: this.apiHandler,
			buildLifecycleEvent: (subType) => this.makeLifecycleEvent(subType),
			buildHeartbeatEvent: () => this.makeHeartbeatEvent()
		};
	}
	createNetworkAdapter(desired, ctx) {
		switch (desired.kind) {
			case "httpServer": return new HttpServerAdapter(desired.name, desired.config, ctx);
			case "httpClient": return new HttpPostAdapter(desired.name, desired.config, ctx);
			case "wsServer": return new WsServerAdapter(desired.name, desired.config, ctx);
			case "wsClient": return new WsClientAdapter(desired.name, desired.config, ctx);
		}
	}
	enqueueLifecycle(operation) {
		const result = this.lifecycleTail.then(operation);
		this.lifecycleTail = result.then(() => void 0, () => void 0);
		return result;
	}
	trackAction(label, start) {
		if (!this.acceptingActions) return this.rejectedAction(label, /* @__PURE__ */ new Error(`OneBot instance UIN=${this.uin} is disposing; ${label} rejected`));
		let action;
		try {
			action = start();
		} catch (error) {
			return this.rejectedAction(label, error);
		}
		const tracked = action.then(() => void 0, (error) => {
			this.log.error("%s failed: %s", label, error instanceof Error ? error.stack ?? error.message : String(error));
		});
		this.inFlightActions.add(tracked);
		tracked.then(() => {
			this.inFlightActions.delete(tracked);
		});
		return action;
	}
	rejectedAction(label, error) {
		const rejected = Promise.reject(error);
		rejected.catch((reason) => {
			this.log.error("%s rejected: %s", label, reason instanceof Error ? reason.stack ?? reason.message : String(reason));
		});
		return rejected;
	}
	async logReceivedMessage(event) {
		const isSelf = event.post_type === "message_sent";
		if (event.post_type !== "message" && !isSelf) return;
		const messageId = toInt(event.message_id);
		const isGroup = event.message_type === "group";
		const idStr = `ID:${messageId}`;
		const selfTag = isSelf ? "[自身] " : "";
		const identity = this.bridge.identity;
		const renderedParts = [];
		const message = event.message;
		if (Array.isArray(message)) for (const seg of message) {
			if (typeof seg !== "object" || seg === null || Array.isArray(seg)) continue;
			const type = String(seg.type ?? "");
			const data = typeof seg.data === "object" && seg.data !== null && !Array.isArray(seg.data) ? seg.data : {};
			if (type === "reply") {
				const replyId = toInt(data.id);
				renderedParts.push(await formatReply(this.messageStore, identity, replyId));
			} else renderedParts.push(formatMessageSegments([seg]));
		}
		else if (typeof message === "string") renderedParts.push(formatMessageSegments(message));
		const content = renderedParts.join(" ").trim() || "[空消息]";
		if (isGroup) {
			const groupId = toInt(event.group_id);
			const userId = toInt(event.user_id);
			const sender = typeof event.sender === "object" && event.sender !== null && !Array.isArray(event.sender) ? event.sender : {};
			const nicknameFromEvent = sender.card || sender.nickname || "";
			const userPart = nicknameFromEvent ? `[${nicknameFromEvent}(${userId})]` : formatUser(identity, groupId, userId);
			this.log.success(`${selfTag}群 ${formatGroup(identity, groupId)} | ${userPart}: ${idStr} ${content}`);
		} else {
			const userId = toInt(event.user_id);
			const nicknameFromEvent = (typeof event.sender === "object" && event.sender !== null && !Array.isArray(event.sender) ? event.sender : {}).nickname || "";
			const userPart = nicknameFromEvent ? `[${nicknameFromEvent}(${userId})]` : formatUser(identity, void 0, userId);
			this.log.success(`${selfTag}私聊 ${userPart}: ${idStr} ${content}`);
		}
	}
	async cacheMessageEvent(event) {
		if (event.post_type !== "message" && event.post_type !== "message_sent") return true;
		const messageId = toInt(event.message_id);
		if (messageId === 0) return true;
		const isGroup = event.message_type === "group";
		const sessionId = isGroup ? toInt(event.group_id) : event.post_type === "message_sent" ? toInt(event.target_id) || toInt(event.user_id) : toInt(event.user_id);
		const sequence = toInt(event.message_seq);
		const eventName = isGroup ? GROUP_MESSAGE_EVENT : event.sub_type === "friend" ? privateMessageEventName(event.post_type === "message_sent", false) : PRIVATE_MESSAGE_EVENT;
		if (sessionId === 0) return true;
		return this.messageStore.storeEvent(messageId, isGroup, sessionId, sequence, eventName, event);
	}
	async cacheMessageMeta(messageId, meta) {
		if (!Number.isInteger(messageId) || messageId === 0) return;
		await this.messageStore.storeMeta(messageId, meta);
	}
	makeLifecycleEvent(subType) {
		const selfId = parseInt(this.uin, 10) || 0;
		return {
			time: Math.floor(Date.now() / 1e3),
			self_id: selfId,
			post_type: "meta_event",
			meta_event_type: "lifecycle",
			sub_type: subType,
			status: {
				online: this.online,
				good: this.online && this.bridge.receiveHealthy
			}
		};
	}
	startHeartbeat() {
		this.heartbeatTimer = setInterval(() => {
			this.dispatchEvent(this.makeHeartbeatEvent());
		}, OneBotInstance.HEARTBEAT_INTERVAL);
		this.heartbeatTimer.unref();
	}
	makeHeartbeatEvent() {
		const selfId = parseInt(this.uin, 10) || 0;
		return {
			time: Math.floor(Date.now() / 1e3),
			self_id: selfId,
			post_type: "meta_event",
			meta_event_type: "heartbeat",
			status: {
				online: this.online,
				good: this.online && this.bridge.receiveHealthy
			},
			interval: OneBotInstance.HEARTBEAT_INTERVAL
		};
	}
	stopHeartbeat() {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
	}
};
function makeBotStatusEvent(selfId, subType, time = Math.floor(Date.now() / 1e3)) {
	return {
		time,
		self_id: selfId,
		post_type: "notice",
		notice_type: "bot_status",
		sub_type: subType,
		user_id: selfId
	};
}
function toInt(value) {
	if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return Math.trunc(parsed);
	}
	return 0;
}
export {};
