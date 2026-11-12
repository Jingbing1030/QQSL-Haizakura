init_logger();
var log$17 = createLogger("Bridge");
var packetLog = createLogger("Bridge.Packet");
var runtimeLog = createLogger("Bridge.Runtime");
var BridgeManager = class {
	bridges = /* @__PURE__ */ new Map();
	pidToUin_ = /* @__PURE__ */ new Map();
	closingSessions_ = /* @__PURE__ */ new Map();
	sessionSubscriptions = /* @__PURE__ */ new Set();
	disposal_ = null;
	/** Hook callbacks remain synchronous; shutdown awaits every detached account. */
	dispose() {
		this.sessionSubscriptions.clear();
		return this.disposal_ ??= Promise.resolve().then(() => this.disposeSessions());
	}
	async disposeSessions() {
		for (const [uin, session] of this.bridges) this.closeSession(uin, session);
		this.bridges.clear();
		this.pidToUin_.clear();
		const errors = (await Promise.allSettled([...this.closingSessions_.values()].flatMap((sessions) => [...sessions]))).flatMap((result) => result.status === "rejected" ? [result.reason] : []);
		if (errors.length) throw new AggregateError(errors, "Bridge persistence shutdown failed");
	}
	closeSession(uin, bridge) {
		const sessions = this.closingSessions_.get(uin) ?? /* @__PURE__ */ new Set();
		const closing = bridge.dispose();
		sessions.add(closing);
		this.closingSessions_.set(uin, sessions);
		closing.then(() => {
			sessions.delete(closing);
			if (sessions.size === 0) this.closingSessions_.delete(uin);
		}, (error) => {
			log$17.error("identity close failed: UIN=%s err=%s", uin, error instanceof Error ? error.stack ?? error.message : String(error));
		});
	}
	/** Listener changes take effect on the next event. Close observers run before
	*  Bridge disposal, so the final process and account identity remain readable. */
	subscribeSessions(listener) {
		const subscription = { listener };
		this.sessionSubscriptions.add(subscription);
		return () => {
			this.sessionSubscriptions.delete(subscription);
		};
	}
	fireSessionStarted(uin, bridge) {
		for (const { listener } of [...this.sessionSubscriptions]) try {
			listener.started?.(uin, bridge);
		} catch (err) {
			log$17.warn("session-started listener threw: %s", err instanceof Error ? err.message : String(err));
		}
	}
	fireSessionClosed(uin, bridge, pid) {
		for (const { listener } of [...this.sessionSubscriptions]) try {
			listener.closed?.(uin, bridge, pid);
		} catch (err) {
			log$17.warn("session-closed listener threw: %s", err instanceof Error ? err.message : String(err));
		}
	}
	onPidDisconnected(pid) {
		const uin = this.pidToUin_.get(pid);
		if (!uin) return;
		runWithTraceRequest(() => {
			const startedAt = Date.now();
			runtimeLog.trace("bridge_detach_start pid=%d uin=%j", pid, uin);
			try {
				const closed = this.detachPidFromSession(pid, uin);
				const activePid = this.bridges.get(uin)?.activePid ?? null;
				if (closed) runtimeLog.trace("bridge_detach_branch pid=%d uin=%j branch=session_closed", pid, uin);
				runtimeLog.trace("bridge_detach_terminal pid=%d uin=%j outcome=completed reason=%s activePid=%j elapsedMs=%d", pid, uin, closed ? "session_closed" : "pid_detached", activePid, Date.now() - startedAt);
			} catch (error) {
				runtimeLog.trace("bridge_detach_terminal pid=%d uin=%j outcome=failed reason=invariant_violation error=%j elapsedMs=%d", pid, uin, error instanceof Error ? error.message : String(error), Date.now() - startedAt);
				throw error;
			}
		});
	}
	onPidReceiveHealthChanged(pid, healthy) {
		if (this.disposal_) return;
		const uin = this.pidToUin_.get(pid);
		if (!uin) {
			const message = `BridgeManager invariant violated: receive health for unmapped PID=${pid}`;
			log$17.error(message);
			throw new Error(message);
		}
		const session = this.bridges.get(uin);
		if (!session || !session.hasPid(pid)) {
			const message = `BridgeManager invariant violated: receive health PID=${pid} is not owned by UIN=${uin}`;
			log$17.error(message);
			throw new Error(message);
		}
		session.setPidReceiveHealthy(pid, healthy);
	}
	onHookLogin(pid, uin, packetClient) {
		if (this.disposal_ || !isRealUin(uin)) return;
		runWithTraceRequest(() => {
			const startedAt = Date.now();
			const previousUin = this.pidToUin_.get(pid) ?? null;
			runtimeLog.trace("bridge_binding_start pid=%d uin=%j source=login previousUin=%j", pid, uin, previousUin);
			try {
				const { session, created } = this.bindPid(pid, uin, packetClient, "login");
				if (previousUin && previousUin !== uin) {
					runtimeLog.trace("bridge_binding_branch pid=%d uin=%j branch=account_rebind previousUin=%j", pid, uin, previousUin);
					const previousSession = this.bridges.get(previousUin);
					runtimeLog.trace("bridge_binding_branch pid=%d uin=%j branch=%s previousUin=%j activePid=%j", pid, uin, previousSession ? "previous_session_retained" : "previous_session_closed", previousUin, previousSession?.activePid ?? null);
				}
				if (created) {
					runtimeLog.trace("bridge_binding_branch pid=%d uin=%j branch=session_created", pid, uin);
					log$17.debug("session started: UIN=%s", uin);
					this.fireSessionStarted(uin, session);
				}
				runtimeLog.trace("bridge_binding_terminal pid=%d uin=%j source=login outcome=completed reason=%s created=%s activePid=%j elapsedMs=%d", pid, uin, previousUin && previousUin !== uin ? "rebound" : "bound", created, session.activePid, Date.now() - startedAt);
			} catch (error) {
				runtimeLog.trace("bridge_binding_terminal pid=%d uin=%j source=login outcome=failed reason=binding_failed error=%j elapsedMs=%d", pid, uin, error instanceof Error ? error.message : String(error), Date.now() - startedAt);
				throw error;
			}
		});
	}
	onPacket(pkt) {
		if (this.disposal_) return;
		runWithTraceRequest(() => this.onPacketInContext(pkt));
	}
	onPacketInContext(pkt) {
		const startedAt = Date.now();
		packetLog.trace(() => [
			"packet_push serviceCmd=%j seqId=%d retCode=%d fromClient=%s pid=%d uin=%j length=%d body=%s",
			pkt.serviceCmd,
			pkt.seqId,
			pkt.retCode,
			pkt.fromClient,
			pkt.pid,
			pkt.uin,
			pkt.body.byteLength,
			renderTraceBytes(pkt.body)
		]);
		if (!pkt.uin || !isRealUin(pkt.uin)) {
			packetLog.trace(() => [
				"packet_terminal serviceCmd=%j seqId=%d outcome=dropped reason=invalid_uin events=0 dispatched=0 elapsedMs=%d",
				pkt.serviceCmd,
				pkt.seqId,
				Date.now() - startedAt
			]);
			return;
		}
		const uin = pkt.uin;
		let completion;
		let handedToPipeline = false;
		try {
			const client = pkt.pid > 0 ? this.packetClientForPid(pkt.pid) : null;
			const { session, created } = client ? this.bindPid(pkt.pid, uin, client, "packet") : this.ensureSession(uin);
			if (created) {
				log$17.debug("session started: UIN=%s", uin);
				this.fireSessionStarted(uin, session);
			}
			handedToPipeline = true;
			completion = session.onPacket(pkt);
		} catch (error) {
			this.tracePacketFailure(pkt, startedAt, handedToPipeline ? "pipeline_failed" : "routing_failed", error);
			throw error;
		}
		completion.catch((error) => {
			this.tracePacketFailure(pkt, startedAt, "pipeline_failed", error);
		});
	}
	tracePacketFailure(pkt, startedAt, reason, error) {
		packetLog.trace(() => [
			"packet_terminal serviceCmd=%j seqId=%d outcome=failed reason=%s error=%j events=0 dispatched=0 elapsedMs=%d",
			pkt.serviceCmd,
			pkt.seqId,
			reason,
			error instanceof Error ? error.message : String(error),
			Date.now() - startedAt
		]);
		log$17.error("packet %s failed for %s: %s", reason === "routing_failed" ? "routing" : "pipeline", pkt.serviceCmd, error instanceof Error ? error.stack ?? error.message : String(error));
	}
	/** Bind PID + sender as one state transition. If the PID changed accounts,
	*  the old Bridge is fully detached (and, when empty, closed) before the new
	*  Bridge is created. */
	bindPid(pid, uin, packetClient, source) {
		const previousUin = this.pidToUin_.get(pid);
		if (previousUin && previousUin !== uin) {
			log$17.warn("PID ownership changed: PID=%d UIN=%s -> UIN=%s source=%s", pid, previousUin, uin, source);
			this.detachPidFromSession(pid, previousUin);
		}
		const result = this.ensureSession(uin);
		result.session.bindPid(pid, packetClient);
		this.pidToUin_.set(pid, uin);
		return result;
	}
	packetClientForPid(pid) {
		const uin = this.pidToUin_.get(pid);
		if (!uin) return null;
		const session = this.bridges.get(uin);
		if (!session) {
			const message = `BridgeManager invariant violated: PID=${pid} references missing UIN=${uin} session`;
			log$17.error(message);
			throw new Error(message);
		}
		const packetClient = session.packetClientForPid(pid);
		if (packetClient) return packetClient;
		const message = `BridgeManager invariant violated: PID=${pid} has no sender in UIN=${uin} session`;
		log$17.error(message);
		throw new Error(message);
	}
	detachPidFromSession(pid, uin) {
		const mappedUin = this.pidToUin_.get(pid);
		if (mappedUin !== uin) {
			const message = `BridgeManager invariant violated: PID=${pid} detach expected UIN=${uin}, mapped UIN=${mappedUin ?? "none"}`;
			log$17.error(message);
			throw new Error(message);
		}
		const session = this.bridges.get(uin);
		if (!session) {
			const message = `BridgeManager invariant violated: PID=${pid} references missing UIN=${uin} session`;
			log$17.error(message);
			throw new Error(message);
		}
		if (!session.hasPid(pid)) {
			const message = `BridgeManager invariant violated: PID=${pid} is mapped to UIN=${uin}, but Bridge does not own the PID`;
			log$17.error(message);
			throw new Error(message);
		}
		this.pidToUin_.delete(pid);
		session.detachPid(pid);
		if (!session.empty) return false;
		this.bridges.delete(uin);
		log$17.debug("session closed: UIN=%s", uin);
		this.fireSessionClosed(uin, session, pid);
		this.closeSession(uin, session);
		return true;
	}
	ensureSession(uin) {
		const session = this.bridges.get(uin);
		if (session) return {
			session,
			created: false
		};
		const closing = this.closingSessions_.get(uin);
		const beforeOpen = closing ? Promise.allSettled(closing).then(() => void 0) : void 0;
		const bridge = new Bridge(IdentityService.openForUin(uin, "data", beforeOpen));
		this.bridges.set(uin, bridge);
		return {
			session: bridge,
			created: true
		};
	}
	getBridge(uin) {
		return this.bridges.get(uin) ?? null;
	}
};
