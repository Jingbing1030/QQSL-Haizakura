init_env();
init_errors();
init_logger();
var log$15 = createLogger("Notifications");
var DEFAULT_HISTORY_LIMIT = 100;
var DEFAULT_POST_TIMEOUT_MS = 1e4;
/**
* Pure: the channels a UIN should be notified through — globally enabled AND
* opted into by the UIN — preserving config order. Exported for unit tests.
*/
function selectChannels(channels, enabledIds) {
	const wanted = new Set(enabledIds);
	return channels.filter((c) => c.enabled && wanted.has(c.id));
}
var NotificationManager = class {
	deps;
	machine = new DebounceMachine();
	timers = /* @__PURE__ */ new Map();
	accounts = /* @__PURE__ */ new Map();
	history = [];
	deliveries = /* @__PURE__ */ new Map();
	historyLimit;
	disposed = false;
	unsubscribeSessions = null;
	constructor(deps) {
		this.deps = deps;
		this.historyLimit = deps.historyLimit ?? DEFAULT_HISTORY_LIMIT;
	}
	/** Subscribe to the global session online/offline edges. Register AFTER
	*  OneBotManager so the nickname fallback is already populated. */
	bind(bridgeManager) {
		if (this.disposed) return;
		this.unsubscribeSessions?.();
		this.unsubscribeSessions = bridgeManager.subscribeSessions({
			started: (uin, bridge) => this.handleOnline(uin, bridge.identity.nickname, bridge.activePid),
			closed: (uin, bridge, pid) => this.handleOffline(uin, bridge.identity.nickname, pid)
		});
	}
	handleOnline(uin, nickname, pid = null) {
		if (this.disposed) return;
		this.accounts.set(uin, {
			nickname: nickname || this.accounts.get(uin)?.nickname || uin,
			pid
		});
		this.apply(uin, this.machine.onOnline(uin));
	}
	handleOffline(uin, nickname, pid = null) {
		if (this.disposed) return;
		let debounceSeconds;
		try {
			debounceSeconds = this.deps.loadConfig().debounceSeconds;
		} catch (err) {
			log$15.warn("offline(%s) skipped — config load failed: %s", uin, errorMessage(err));
			return;
		}
		this.accounts.set(uin, {
			nickname: nickname || this.accounts.get(uin)?.nickname || uin,
			pid
		});
		this.apply(uin, this.machine.onOffline(uin, debounceSeconds));
	}
	apply(uin, decision) {
		switch (decision.kind) {
			case "schedule": {
				const timer = setTimeout(() => {
					this.timers.delete(uin);
					this.apply(uin, this.machine.onTimerElapsed(uin));
				}, decision.delayMs);
				timer.unref();
				this.timers.set(uin, timer);
				break;
			}
			case "cancel":
				clearTimeout(this.timers.get(uin));
				this.timers.delete(uin);
				break;
			case "emit":
				this.notify(uin, decision.event);
				break;
			case "none": break;
		}
	}
	/** Queue one transition; channel failures are recorded independently. */
	notify(uin, event) {
		if (this.disposed) return Promise.resolve();
		const account = this.accounts.get(uin) ?? {
			nickname: uin,
			pid: null
		};
		const delivery = (this.deliveries.get(uin) ?? Promise.resolve()).then(() => this.notifyNow(uin, event, account)).finally(() => {
			if (this.deliveries.get(uin) === delivery) this.deliveries.delete(uin);
		});
		this.deliveries.set(uin, delivery);
		return delivery;
	}
	async notifyNow(uin, event, account) {
		if (this.disposed) return;
		let channels;
		try {
			channels = selectChannels(this.deps.loadConfig().channels, this.deps.loadChannelIds(uin));
		} catch (err) {
			log$15.warn("notify(%s, %s) skipped — config load failed: %s", uin, event, errorMessage(err));
			return;
		}
		if (channels.length === 0) return;
		let facts;
		try {
			facts = await this.deps.resolveProcess?.(uin, account.pid);
		} catch (err) {
			log$15.warn("resolveProcess(%s, %s) failed: %s", uin, account.pid, errorMessage(err));
		}
		const vars = {
			uin,
			nickname: account.nickname,
			event,
			time: new Date(this.deps.now()).toISOString(),
			status: facts?.status ?? "",
			pid: facts?.pid === void 0 ? "" : String(facts.pid),
			error: facts?.error ?? ""
		};
		for (const ch of channels) {
			if (this.disposed) return;
			const result = await this.deliver(ch, vars);
			this.record({
				time: this.deps.now(),
				uin,
				event,
				channelId: ch.id,
				ok: result.ok,
				status: result.status,
				error: result.ok ? void 0 : result.error ?? (result.status ? `HTTP ${result.status}` : "delivery failed")
			});
			if (!result.ok) log$15.warn("notify %s→%s channel=%s failed: %s", uin, event, ch.id, result.error ?? `HTTP ${result.status ?? "?"}`);
		}
	}
	async deliver(ch, vars) {
		try {
			if (isEmailChannel(ch)) {
				const send = this.deps.sendMail;
				if (!send) return {
					ok: false,
					error: "email delivery is not configured"
				};
				return await send({
					host: ch.smtpHost,
					port: ch.smtpPort,
					secure: ch.smtpSecure,
					user: ch.smtpUser,
					pass: ch.smtpPass,
					from: ch.from,
					to: ch.to,
					subject: renderTemplate(ch.subjectTemplate, vars),
					text: renderTemplate(ch.bodyTemplate, vars)
				});
			}
			return await this.deps.post(ch.url, renderTemplate(ch.bodyTemplate, vars), ch.headers);
		} catch (err) {
			return {
				ok: false,
				error: errorMessage(err)
			};
		}
	}
	/** Send a one-off test to a single channel by id — ignores `enabled` and the
	*  per-UIN opt-in (you test a channel before wiring it up), with sample
	*  variables. Reuses the real render+deliver path; NOT recorded to history.
	*  `found:false` means the channel id is unknown. */
	async testSend(channelId) {
		let channel;
		try {
			channel = this.deps.loadConfig().channels.find((c) => c.id === channelId);
		} catch (err) {
			return {
				ok: false,
				found: false,
				error: errorMessage(err)
			};
		}
		if (!channel) return {
			ok: false,
			found: false
		};
		const vars = {
			uin: "10000",
			nickname: "测试账号",
			event: "offline",
			time: new Date(this.deps.now()).toISOString(),
			status: "disconnected",
			pid: "1234",
			error: ""
		};
		return {
			...await this.deliver(channel, vars),
			found: true
		};
	}
	record(rec) {
		this.history.push(rec);
		if (this.history.length > this.historyLimit) this.history.splice(0, this.history.length - this.historyLimit);
	}
	/** Most-recent-first delivery history (capped at the buffer size). */
	getRecent(limit = this.historyLimit) {
		const n = Math.max(0, Math.min(Math.trunc(limit) || 0, this.history.length));
		return this.history.slice(this.history.length - n).reverse();
	}
	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.unsubscribeSessions?.();
		this.unsubscribeSessions = null;
		for (const timer of this.timers.values()) clearTimeout(timer);
		this.timers.clear();
	}
};
/** Default outbound POST: a single attempt with a timeout, JSON content-type
*  (the common case for 钉钉/Discord/飞书). Never throws. */
function createDefaultPost(timeoutMs = positiveIntEnv("SNOWLUMA_NOTIFICATION_HTTP_TIMEOUT_MS", DEFAULT_POST_TIMEOUT_MS)) {
	return async (url, body, headers) => {
		try {
			const res = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...headers
				},
				body,
				signal: AbortSignal.timeout(timeoutMs)
			});
			return {
				ok: res.ok,
				status: res.status,
				error: res.ok ? void 0 : `HTTP ${res.status}`
			};
		} catch (err) {
			return {
				ok: false,
				error: errorMessage(err)
			};
		}
	};
}
var DEFAULT_SMTP_TIMEOUT_MS = 15e3;
/** Default SMTP send. Never throws. */
function createDefaultSendMail(timeoutMs = DEFAULT_SMTP_TIMEOUT_MS) {
	return async (mail) => {
		try {
			await sendSmtpMail({
				host: mail.host,
				port: mail.port,
				secure: mail.secure,
				user: mail.user,
				pass: mail.pass,
				from: mail.from,
				to: parseRecipients(mail.to),
				subject: mail.subject,
				body: mail.text
			}, { timeoutMs });
			return { ok: true };
		} catch (err) {
			return {
				ok: false,
				error: formatSmtpError(err, mail.host, mail.port)
			};
		}
	};
}
/** The real, fully-wired singleton. `resolveProcess` is supplied by the
*  runtime — this package deliberately knows nothing about HookManager. */
function createNotificationManager(resolveProcess) {
	return new NotificationManager({
		loadConfig: loadNotificationsConfig,
		loadChannelIds: (uin) => loadOneBotConfig(uin).notifications?.channelIds ?? [],
		post: createDefaultPost(),
		sendMail: createDefaultSendMail(),
		now: () => Date.now(),
		resolveProcess
	});
}
