init_logger();
var log$18 = createLogger("Bridge");
var runtimeLog$1 = createLogger("Bridge.Runtime");
var VERBOSE_WARMUP = process.env.SNOWLUMA_VERBOSE_WARMUP === "1";
var Bridge = class Bridge {
	identity;
	/** Insertion order tracks login recency; the newest connection sends packets. */
	connections = /* @__PURE__ */ new Map();
	events = new BridgeEventBus();
	apis;
	pipeline;
	static UPLOADED_FILE_CACHE_MAX = 1024;
	uploadedFileMeta_ = /* @__PURE__ */ new Map();
	clientSeq_ = 1e8 + Date.now() % 1e9;
	msgRandom_ = (Date.now() & 4294967295) >>> 0;
	sysMsgDedup_ = new SysMsgDedup();
	onlineClients_ = null;
	disposePromise_ = null;
	pendingPackets_ = /* @__PURE__ */ new Set();
	clientMessageTasks_ = /* @__PURE__ */ new Map();
	rosterWarmupStarted_ = false;
	settleRosterWarmup;
	rosterWarmup = new Promise((resolve) => {
		this.settleRosterWarmup = resolve;
	});
	constructor(identity) {
		this.identity = identity;
		this.apis = buildApiHub(this);
		this.identity.setFetcher({
			fetchProfile: (uin) => this.apis.contacts.fetchUserProfile(uin),
			fetchProfileByUid: (uid) => this.apis.contacts.fetchUserProfileByUid(uid),
			fetchGroupMemberList: (gid) => this.apis.contacts.fetchGroupMemberList(gid)
		});
		this.pipeline = new IncomingPacketPipeline({
			identity: this.identity,
			events: this.events,
			fetchGroupList: async () => {
				await this.apis.contacts.fetchGroupList();
			},
			fetchGroupMemberList: async (groupId) => {
				await this.apis.contacts.fetchGroupMemberList(groupId);
			},
			resolveGroupJoinRequest: (groupId, uid, subType, invitedUid) => this.apis.contacts.resolveGroupJoinRequest(groupId, uid, subType, invitedUid),
			groupInvites: this.apis.contacts.groupInvites
		});
		this.pipeline.registerCmd(MSG_PUSH_CMD, (pkt, identity) => parseMsgPushOrThrow(pkt, identity, this.sysMsgDedup_));
		this.pipeline.registerCmd(KICK_NT_CMD, parseKickNT);
		this.events.on("online_devices_changed", (event) => {
			const snapshot = event.devices.map((device) => Object.freeze({ ...device }));
			this.onlineClients_ = Object.freeze(snapshot);
			log$18.debug("online-device snapshot updated: uin=%s clients=%d types=%s", this.identity.uin, snapshot.length, snapshot.map((device) => device.clientType).join(","));
		});
	}
	dispose() {
		if (this.disposePromise_) return this.disposePromise_;
		this.settleRosterWarmup({
			friendsLoaded: false,
			groupsLoaded: false
		});
		this.connections.clear();
		this.onlineClients_ = null;
		this.disposePromise_ = (async () => {
			try {
				await Promise.allSettled(this.pendingPackets_);
				await this.identity.close();
			} finally {
				this.events.clear();
			}
		})();
		return this.disposePromise_;
	}
	registerCmd(cmd, parser) {
		this.pipeline.registerCmd(cmd, parser);
	}
	handlesCmd(cmd) {
		return this.pipeline.handlesCmd(cmd);
	}
	bindPid(pid, client) {
		const previous = this.activeConnection;
		const existing = this.connections.get(pid);
		this.connections.delete(pid);
		const connection = existing?.client === client ? existing : {
			pid,
			client,
			receiveHealthy: true
		};
		connection.receiveHealthy = true;
		this.connections.set(pid, connection);
		if (previous?.pid !== pid || previous.client !== client) runtimeLog$1.trace("bridge_sender_fact event=selected uin=%j pid=%d previousPid=%j", this.identity.uin, pid, previous?.pid ?? null);
		this.maybeStartRosterWarmup();
	}
	/** @internal BridgeManager lookup used when an incoming packet is the first
	*  observation that a live PID changed UIN. */
	packetClientForPid(pid) {
		return this.connections.get(pid)?.client ?? null;
	}
	detachPid(pid) {
		const wasActive = this.activePid === pid;
		this.connections.delete(pid);
		const active = this.activeConnection;
		if (wasActive && active) {
			runtimeLog$1.trace("bridge_sender_fact event=fallback uin=%j detachedPid=%d fallbackPid=%d", this.identity.uin, pid, active.pid);
			log$18.debug("packet sender changed: UIN=%s PID=%d→%d", this.identity.uin, pid, active.pid);
		}
	}
	hasPid(pid) {
		return this.connections.has(pid);
	}
	get empty() {
		return this.connections.size === 0;
	}
	get activeConnection() {
		return [...this.connections.values()].at(-1);
	}
	get activePid() {
		return this.activeConnection?.pid ?? null;
	}
	get receiveHealthy() {
		return [...this.connections.values()].some((connection) => connection.receiveHealthy);
	}
	setPidReceiveHealthy(pid, healthy) {
		const connection = this.connections.get(pid);
		if (!connection) throw new Error(`Bridge receive-health invariant violated: PID=${pid} is not attached`);
		connection.receiveHealthy = healthy;
	}
	getOnlineClients() {
		return this.onlineClients_;
	}
	whenRosterWarmupSettled() {
		return this.rosterWarmup;
	}
	onPacket(pkt) {
		if (this.disposePromise_) return Promise.reject(/* @__PURE__ */ new Error("Bridge is disposed"));
		const connection = this.connections.get(pkt.pid);
		const work = this.identity.initialization.then(() => pkt.source === "client-message" ? this.processClientMessage(pkt, connection) : this.pipeline.process(pkt));
		this.pendingPackets_.add(work);
		work.finally(() => this.pendingPackets_.delete(work)).catch(() => void 0);
		return work;
	}
	async processClientMessage(pkt, connection) {
		const requireConnection = () => {
			if (this.disposePromise_ || !connection || this.connections.get(pkt.pid) !== connection) throw new Error("Client message receipt belongs to an inactive connection");
			return connection;
		};
		const current = requireConnection();
		const receipt = decodeClientMessageReceipt(pkt, this.identity.uin);
		const key = JSON.stringify([
			pkt.pid,
			receipt.peerUid,
			receipt.sequence,
			receipt.clientSequence,
			receipt.timestamp
		]);
		const pending = this.clientMessageTasks_.get(key);
		if (pending?.connection === current) return pending.work;
		if (this.clientMessageTasks_.size >= 256) throw new Error("Too many pending client message lookups");
		runtimeLog$1.trace("client_message_lookup_start uin=%j pid=%d seqId=%d", this.identity.uin, pkt.pid, pkt.seqId);
		const work = (async () => {
			const event = await fetchClientMessage({ sendPacket: (cmd, body, timeout) => requireConnection().client.sendPacket(cmd, body, timeout) }, this.identity, receipt);
			requireConnection();
			await this.pipeline.processEvents(pkt, [event]);
			runtimeLog$1.trace("client_message_lookup_complete uin=%j pid=%d seqId=%d", this.identity.uin, pkt.pid, pkt.seqId);
		})();
		const task = {
			connection: current,
			work
		};
		this.clientMessageTasks_.set(key, task);
		try {
			await work;
		} finally {
			if (this.clientMessageTasks_.get(key) === task) this.clientMessageTasks_.delete(key);
		}
	}
	rememberUploadedFile(meta) {
		if (!meta.fileId) return;
		if (this.uploadedFileMeta_.size >= Bridge.UPLOADED_FILE_CACHE_MAX) {
			const oldest = this.uploadedFileMeta_.keys().next().value;
			if (oldest !== void 0) this.uploadedFileMeta_.delete(oldest);
		}
		this.uploadedFileMeta_.set(meta.fileId, meta);
	}
	recallUploadedFile(fileId) {
		if (!fileId) return;
		return this.uploadedFileMeta_.get(fileId);
	}
	nextClientSequence() {
		return ++this.clientSeq_;
	}
	nextMessageRandom() {
		this.msgRandom_ = this.msgRandom_ + 2654435769 >>> 0;
		return this.msgRandom_ & 2147483647;
	}
	async sendRawPacket(serviceCmd, body, timeoutMs = packetTimeoutMs()) {
		const connection = this.activeConnection;
		if (!connection) return runWithTraceRequest(() => {
			const startedAt = Date.now();
			runtimeLog$1.trace(() => [
				"bridge_send_start serviceCmd=%j uin=%j activePid=%j timeoutMs=%d length=%d body=%s",
				serviceCmd,
				this.identity.uin,
				this.activePid,
				timeoutMs,
				body.byteLength,
				renderTraceBytes(body)
			]);
			log$18.warn("packet %s dropped: no packet sender attached", serviceCmd);
			runtimeLog$1.trace(() => [
				"bridge_send_terminal serviceCmd=%j uin=%j activePid=%j outcome=dropped reason=no_sender length=%d body=%s elapsedMs=%d",
				serviceCmd,
				this.identity.uin,
				this.activePid,
				body.byteLength,
				renderTraceBytes(body),
				Date.now() - startedAt
			]);
			return {
				success: false,
				gotResponse: false,
				errorCode: -1,
				errorMessage: "no packet sender attached",
				responseData: null
			};
		});
		const startedAt = Date.now();
		const result = await connection.client.sendPacket(serviceCmd, Buffer.from(body), timeoutMs);
		const elapsed = Date.now() - startedAt;
		const respLen = result.responseData ? result.responseData.length : 0;
		if (!result.success || result.errorCode !== 0) log$18.warn("packet %s failed: code=%d gotResponse=%s %s (uin=%s, %dB, %dms)", serviceCmd, result.errorCode, result.gotResponse, result.errorMessage ?? "", this.identity.uin, body.length, elapsed);
		else log$18.trace(() => [`packet ${serviceCmd} ok (${body.length}B⇄${respLen}B, ${elapsed}ms)`]);
		return result;
	}
	async resolveUserUid(uin, groupId) {
		return this.identity.resolveUid(uin, groupId);
	}
	maybeStartRosterWarmup() {
		if (this.disposePromise_ || this.rosterWarmupStarted_ || this.empty) return;
		this.rosterWarmupStarted_ = true;
		if (!this.identity.nickname) this.identity.nickname = this.identity.uin;
		this.runRosterWarmup().then((result) => this.settleRosterWarmup(this.disposePromise_ ? {
			friendsLoaded: false,
			groupsLoaded: false
		} : result), (err) => {
			log$18.warn("roster warmup failed: uin=%s err=%s", this.identity.uin, err instanceof Error ? err.stack ?? err.message : String(err));
			this.settleRosterWarmup({
				friendsLoaded: false,
				groupsLoaded: false
			});
		});
	}
	stillOpen() {
		return this.disposePromise_ === null;
	}
	async runRosterWarmup() {
		await this.identity.initialization;
		if (this.disposePromise_) return {
			friendsLoaded: false,
			groupsLoaded: false
		};
		const uin = this.identity.uin;
		const selfUin = parseInt(uin, 10) || 0;
		let selfResolved = false;
		let friendsLoaded = false;
		try {
			const friends = await this.apis.contacts.fetchFriendList();
			if (!this.stillOpen()) return {
				friendsLoaded: false,
				groupsLoaded: false
			};
			friendsLoaded = true;
			log$18.info("friends loaded: UIN=%s count=%d", uin, friends.length);
			for (const friend of friends) if (friend.uin === selfUin) {
				this.identity.setSelfProfile({
					uin: friend.uin,
					uid: friend.uid,
					nickname: friend.nickname || uin,
					remark: "",
					qid: "",
					sex: "unknown",
					age: 0,
					sign: "",
					avatar: "",
					level: 0,
					qidianMasterFlag: 0,
					qidianCrewFlag: 0,
					qidianCrewFlag2: 0
				});
				this.identity.nickname = friend.nickname || uin;
				log$18.debug("self info: UIN=%s uid=%s nickname=%s", uin, friend.uid, friend.nickname ?? "");
				selfResolved = true;
				break;
			}
		} catch (e) {
			if (!this.stillOpen()) return {
				friendsLoaded: false,
				groupsLoaded: false
			};
			log$18.warn("failed to load friends for UIN %s: %s", uin, e instanceof Error ? e.message : String(e));
		}
		if (!selfResolved && selfUin > 0 && this.stillOpen()) try {
			const profile = await this.apis.contacts.fetchUserProfile(selfUin);
			if (!this.stillOpen()) return {
				friendsLoaded: false,
				groupsLoaded: false
			};
			this.identity.setSelfProfile(profile);
			this.identity.nickname = profile.nickname || uin;
			log$18.debug("self info via profile: UIN=%s uid=%s nickname=%s", uin, profile.uid, profile.nickname);
		} catch (e) {
			if (!this.stillOpen()) return {
				friendsLoaded: false,
				groupsLoaded: false
			};
			log$18.warn("failed to load self profile for UIN %s: %s", uin, e instanceof Error ? e.message : String(e));
		}
		let groups = [];
		let groupsLoaded = false;
		try {
			groups = await this.apis.contacts.fetchGroupList();
			if (!this.stillOpen()) return {
				friendsLoaded: false,
				groupsLoaded: false
			};
			groupsLoaded = true;
			log$18.info("groups loaded: UIN=%s count=%d", uin, groups.length);
		} catch (e) {
			if (!this.stillOpen()) return {
				friendsLoaded: false,
				groupsLoaded: false
			};
			log$18.warn("failed to load groups for UIN %s: %s", uin, e instanceof Error ? e.message : String(e));
		}
		let loadedGroupCount = 0;
		let loadedMemberCount = 0;
		let failedGroupCount = 0;
		for (const group of groups) {
			if (!this.stillOpen()) return {
				friendsLoaded: false,
				groupsLoaded: false
			};
			try {
				const members = await this.apis.contacts.fetchGroupMemberList(group.groupId);
				if (!this.stillOpen()) return {
					friendsLoaded: false,
					groupsLoaded: false
				};
				loadedGroupCount += 1;
				loadedMemberCount += members.length;
				if (VERBOSE_WARMUP) log$18.debug("members loaded: group=%d count=%d", group.groupId, members.length);
			} catch (e) {
				if (!this.stillOpen()) return {
					friendsLoaded: false,
					groupsLoaded: false
				};
				failedGroupCount += 1;
				log$18.warn("failed to load members for group %d: %s", group.groupId, e instanceof Error ? e.message : String(e));
			}
		}
		if (!this.stillOpen()) return {
			friendsLoaded: false,
			groupsLoaded: false
		};
		log$18.info("member warmup completed: UIN=%s groups=%d/%d members=%d failed=%d", uin, loadedGroupCount, groups.length, loadedMemberCount, failedGroupCount);
		return {
			friendsLoaded,
			groupsLoaded
		};
	}
};
