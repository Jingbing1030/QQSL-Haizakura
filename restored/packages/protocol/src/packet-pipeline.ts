// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/packet-pipeline.ts"
// original bundle lines 345057-345591  (533 lines) of dist/index.mjs
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
var moduleLog = createLogger("Bridge");
var moduleEventLog = createLogger("Event");
var modulePacketLog = createLogger("Protocol.Packet");
var WARN_EVENT_KINDS = /* @__PURE__ */ new Set([
	"group_recall",
	"friend_recall",
	"group_member_leave",
	"group_mute",
	"friend_request",
	"group_invite"
]);
var EnrichedDispatchError = class extends Error {
	originalError;
	constructor(originalError) {
		super(originalError instanceof Error ? originalError.message : String(originalError));
		this.originalError = originalError;
		this.name = "EnrichedDispatchError";
	}
};
var IncomingPacketPipeline = class {
	deps;
	cmdHandlers_ = /* @__PURE__ */ new Map();
	memberRefreshTasks_ = /* @__PURE__ */ new Map();
	log;
	eventLog;
	packetLog;
	constructor(deps) {
		this.deps = deps;
		const uinNum = Number.parseInt(deps.identity.uin, 10);
		const bind = Number.isFinite(uinNum) && uinNum > 0 ? { uin: uinNum } : null;
		this.log = bind ? moduleLog.child(bind) : moduleLog;
		this.eventLog = bind ? moduleEventLog.child(bind) : moduleEventLog;
		this.packetLog = bind ? modulePacketLog.child(bind) : modulePacketLog;
	}
	registerCmd(cmd, parser) {
		const arr = this.cmdHandlers_.get(cmd) ?? [];
		arr.push(parser);
		this.cmdHandlers_.set(cmd, arr);
	}
	handlesCmd(cmd) {
		return this.cmdHandlers_.has(cmd);
	}
	process(pkt) {
		return this.processWithHandlers(pkt, this.cmdHandlers_.get(pkt.serviceCmd));
	}
	processEvents(pkt, events) {
		return this.processWithHandlers(pkt, [() => [...events]]);
	}
	processWithHandlers(pkt, handlers) {
		const startedAt = Date.now();
		if (!handlers) {
			this.packetLog.trace(() => [
				"packet_branch serviceCmd=%j seqId=%d branch=parser_unregistered",
				pkt.serviceCmd,
				pkt.seqId
			]);
			this.packetLog.trace(() => [
				"packet_terminal serviceCmd=%j seqId=%d outcome=dropped reason=parser_unregistered events=0 dispatched=0 elapsedMs=%d",
				pkt.serviceCmd,
				pkt.seqId,
				Date.now() - startedAt
			]);
			return Promise.resolve();
		}
		let eventCount = 0;
		let dispatched = 0;
		let parserErrors = 0;
		let dispatchErrors = 0;
		let enrichmentFailures = 0;
		const enrichmentTasks = [];
		handlers.forEach((handler, index) => {
			const parser = index + 1;
			try {
				const events = handler(pkt, this.deps.identity);
				if (events.length === 0) {
					this.packetLog.trace(() => [
						"packet_branch serviceCmd=%j seqId=%d parser=%d branch=parser_zero_events",
						pkt.serviceCmd,
						pkt.seqId,
						parser
					]);
					return;
				}
				eventCount += events.length;
				this.packetLog.trace(() => [
					"packet_branch serviceCmd=%j seqId=%d parser=%d branch=parser_events events=%d",
					pkt.serviceCmd,
					pkt.seqId,
					parser,
					events.length
				]);
				for (const event of events) if (this.needsPreDispatchIdentityRefresh(event)) {
					this.traceEnrichmentStarted(pkt, event, "identity_refresh");
					const task = this.dispatchAfterIdentityRefresh(pkt, event).then((count) => {
						dispatched += count;
					}).catch((error) => {
						if (error instanceof EnrichedDispatchError) {
							dispatchErrors += 1;
							this.traceDispatchFailure(pkt, event, error.originalError);
						} else {
							enrichmentFailures += 1;
							this.traceEnrichmentFailure(pkt, event, "identity_refresh", error);
						}
						this.log.warn("dispatchAfterIdentityRefresh failed: %s", error instanceof Error ? error.stack ?? error.message : String(error));
					});
					enrichmentTasks.push(task);
				} else if (event.kind === "group_invite") {
					this.traceEnrichmentStarted(pkt, event, "group_invite");
					const task = this.dispatchGroupInvite(pkt, event).then((count) => {
						dispatched += count;
					}).catch((error) => {
						if (error instanceof EnrichedDispatchError) {
							dispatchErrors += 1;
							this.traceDispatchFailure(pkt, event, error.originalError);
						} else {
							enrichmentFailures += 1;
							this.traceEnrichmentFailure(pkt, event, "group_invite", error);
						}
						this.log.warn("dispatchGroupInvite failed: %s", error instanceof Error ? error.stack ?? error.message : String(error));
					});
					enrichmentTasks.push(task);
				} else try {
					dispatched += this.dispatchEvent(pkt, event, "sync");
				} catch (error) {
					dispatchErrors += 1;
					this.traceDispatchFailure(pkt, event, error);
					this.log.error("dispatch error for %s event=%s: %s", pkt.serviceCmd, event.kind, error instanceof Error ? error.stack ?? error.message : String(error));
					break;
				}
			} catch (error) {
				parserErrors += 1;
				this.packetLog.trace(() => [
					"packet_branch serviceCmd=%j seqId=%d parser=%d branch=parser_exception error=%j",
					pkt.serviceCmd,
					pkt.seqId,
					parser,
					error instanceof Error ? error.message : String(error)
				]);
				this.log.error("handler error for %s: %s", pkt.serviceCmd, error instanceof Error ? error.stack ?? error.message : String(error));
			}
		});
		const finish = () => {
			if (enrichmentFailures > 0 || dispatchErrors > 0) {
				this.packetLog.trace(() => [
					"packet_terminal serviceCmd=%j seqId=%d outcome=failed reason=%s events=%d dispatched=%d parserErrors=%d dispatchErrors=%d elapsedMs=%d",
					pkt.serviceCmd,
					pkt.seqId,
					enrichmentFailures > 0 ? "enrichment_failed" : "dispatch_exception",
					eventCount,
					dispatched,
					parserErrors,
					dispatchErrors,
					Date.now() - startedAt
				]);
				return;
			}
			if (parserErrors > 0) {
				this.packetLog.trace(() => [
					"packet_terminal serviceCmd=%j seqId=%d outcome=failed reason=parser_exception events=%d dispatched=%d parserErrors=%d elapsedMs=%d",
					pkt.serviceCmd,
					pkt.seqId,
					eventCount,
					dispatched,
					parserErrors,
					Date.now() - startedAt
				]);
				return;
			}
			if (dispatched > 0) {
				this.packetLog.trace(() => [
					"packet_terminal serviceCmd=%j seqId=%d outcome=completed reason=dispatch_complete events=%d dispatched=%d parserErrors=%d elapsedMs=%d",
					pkt.serviceCmd,
					pkt.seqId,
					eventCount,
					dispatched,
					parserErrors,
					Date.now() - startedAt
				]);
				return;
			}
			this.packetLog.trace(() => [
				"packet_terminal serviceCmd=%j seqId=%d outcome=%s reason=%s events=%d dispatched=0 parserErrors=%d elapsedMs=%d",
				pkt.serviceCmd,
				pkt.seqId,
				parserErrors > 0 ? "failed" : "dropped",
				parserErrors > 0 ? "parser_exception" : "no_events",
				eventCount,
				parserErrors,
				Date.now() - startedAt
			]);
		};
		if (enrichmentTasks.length === 0) {
			finish();
			return Promise.resolve();
		}
		return Promise.all(enrichmentTasks).then(finish);
	}
	traceEnrichmentStarted(pkt, event, enrichment) {
		this.packetLog.trace(() => [
			"packet_branch serviceCmd=%j seqId=%d branch=enrichment_started eventKind=%j enrichment=%j",
			pkt.serviceCmd,
			pkt.seqId,
			event.kind,
			enrichment
		]);
	}
	traceEnrichmentFailure(pkt, event, enrichment, error) {
		this.packetLog.trace(() => [
			"packet_branch serviceCmd=%j seqId=%d branch=enrichment_failed eventKind=%j enrichment=%j error=%j",
			pkt.serviceCmd,
			pkt.seqId,
			event.kind,
			enrichment,
			error instanceof Error ? error.message : String(error)
		]);
	}
	traceDispatchFailure(pkt, event, error) {
		this.packetLog.trace(() => [
			"packet_branch serviceCmd=%j seqId=%d branch=dispatch_exception eventKind=%j error=%j",
			pkt.serviceCmd,
			pkt.seqId,
			event.kind,
			error instanceof Error ? error.message : String(error)
		]);
	}
	traceDispatch(pkt, eventKind, mode) {
		this.packetLog.trace(() => [
			"packet_branch serviceCmd=%j seqId=%d branch=dispatch eventKind=%j mode=%s",
			pkt.serviceCmd,
			pkt.seqId,
			eventKind,
			mode
		]);
	}
	dispatchEvent(pkt, event, mode) {
		const cardBefore = this.groupCardBefore(event);
		this.finishDispatch(event);
		this.traceDispatch(pkt, event.kind, mode);
		let dispatched = 1;
		if (this.emitGroupCardChange(event, cardBefore)) {
			this.traceDispatch(pkt, "group_card_change", "derived");
			dispatched++;
		}
		if (this.emitGroupInviteCard(event)) {
			this.traceDispatch(pkt, "group_invite", "derived");
			dispatched++;
		}
		return dispatched;
	}
	emitGroupInviteCard(event) {
		if (event.kind !== "friend_message" || event.senderUin === event.selfUin) return false;
		const groupId = event.inviteCardGroupUin;
		const sequence = event.inviteCardSequence;
		if (!groupId || !sequence || !this.deps.groupInvites.receiveCard(groupId, sequence, event.senderUid)) return false;
		this.finishDispatch({
			kind: "group_invite",
			time: event.time,
			selfUin: event.selfUin,
			groupId,
			fromUin: event.senderUin,
			fromUid: event.senderUid,
			invitedUin: event.selfUin,
			subType: "invite",
			message: "",
			flag: formatGroupRequestFlag({
				groupId,
				sequence,
				eventType: 2,
				filtered: false
			})
		});
		return true;
	}
	emit(event) {
		this.deps.events.emit(event);
	}
	/** The sender's cached group card just before this event is dispatched (its
	*  side-effects will overwrite the cache). Only meaningful for group_message. */
	groupCardBefore(event) {
		if (event.kind !== "group_message") return;
		return this.deps.identity.findGroupMember(event.groupId, event.senderUin)?.card;
	}
	/** Surface a `group_card_change` when a KNOWN member's card actually changed —
	*  mirrors NapCat's `parseCardChangedEvent`. Requires a non-empty prior card
	*  (`cardBefore`) that differs from a non-empty new one, so a cold/unknown
	*  cache never fabricates a change on first contact. */
	emitGroupCardChange(event, cardBefore) {
		if (event.kind !== "group_message") return false;
		const cardNew = event.senderCard ?? "";
		if (!cardBefore || !cardNew || cardBefore === cardNew) return false;
		this.finishDispatch({
			kind: "group_card_change",
			time: event.time,
			selfUin: event.selfUin,
			groupId: event.groupId,
			userUin: event.senderUin,
			cardNew,
			cardOld: cardBefore
		});
		return true;
	}
	/**
	* Common dispatch tail shared by the sync path and the two async enrichment
	* paths: run side effects, log the event, then emit it.
	*/
	finishDispatch(event) {
		this.handleSideEffects(event);
		printEvent(this.eventLog, this.deps.identity, event);
		this.emit(event);
	}
	needsPreDispatchIdentityRefresh(event) {
		return event.kind === "group_member_join" && event.groupId > 0 && event.userUin <= 0 && Boolean(event.userUid);
	}
	async dispatchAfterIdentityRefresh(pkt, event) {
		try {
			await this.prepareGroupMemberJoinIdentity(event);
		} catch (e) {
			this.packetLog.trace(() => [
				"packet_branch serviceCmd=%j seqId=%d branch=enrichment_degraded eventKind=%j enrichment=\"identity_refresh\" error=%j",
				pkt.serviceCmd,
				pkt.seqId,
				event.kind,
				e instanceof Error ? e.message : String(e)
			]);
			this.log.warn("failed to resolve group member join identity: group=%d uid=%s err=%s", event.groupId, event.userUid ?? "", e instanceof Error ? e.message : String(e));
		}
		try {
			return this.dispatchEvent(pkt, event, "enriched");
		} catch (error) {
			throw new EnrichedDispatchError(error);
		}
	}
	async dispatchGroupInvite(pkt, event) {
		if (event.subType === "invite" && this.isSelfMemberIdentity(event.invitedUin ?? 0, event.invitedUid)) {
			if (!(event.groupId > 0) || !event.fromUid?.trim() || !event.flag) {
				this.log.warn("self invitation missing group or inviter: group=%d", event.groupId);
				return 0;
			}
			if (!this.deps.groupInvites.receiveNotice(event.groupId, event.fromUid)) {
				this.log.debug("self invitation already dispatched from the card: group=%d", event.groupId);
				return 0;
			}
			if (!event.fromUin) {
				event.fromUin = await this.deps.identity.resolveUin(event.fromUid, event.groupId) ?? 0;
				if (!event.fromUin) this.log.warn("self invitation sender unavailable: group=%d uid=%s", event.groupId, event.fromUid);
			}
			try {
				return this.dispatchEvent(pkt, event, "sync");
			} catch (error) {
				throw new EnrichedDispatchError(error);
			}
		}
		const uid = event.fromUid;
		if (!uid) throw new Error("group request omitted requester UID");
		this.deps.identity.rememberRequestIdentity({
			groupId: event.groupId,
			uid,
			uin: event.fromUin,
			source: "group_request"
		});
		const request = await this.deps.resolveGroupJoinRequest(event.groupId, uid, event.subType, event.invitedUid);
		if (!request) {
			this.log.warn("pending group request not found: group=%d uid=%s", event.groupId, uid);
			return 0;
		}
		if (isSelfGroupInvitation(request)) return 0;
		event.message = request.comment;
		event.flag = formatGroupRequestFlag(request);
		const requesterUin = event.subType === "invite" ? request.invitorUin : request.targetUin;
		event.fromUin = event.fromUin || requesterUin || await this.deps.identity.resolveUin(uid, event.groupId) || 0;
		if (event.fromUin === 0) this.log.warn("group request sender unavailable: group=%d uid=%s", event.groupId, uid);
		if (event.subType === "invite") {
			event.invitedUid = request.targetUid;
			event.invitedUin = request.targetUin || await this.deps.identity.resolveUin(request.targetUid, event.groupId) || 0;
		}
		try {
			return this.dispatchEvent(pkt, event, "enriched");
		} catch (error) {
			throw new EnrichedDispatchError(error);
		}
	}
	async prepareGroupMemberJoinIdentity(event) {
		this.resolveMemberIdentityFromCache(event);
		if (event.userUin > 0 || !event.userUid) return;
		const uin = await this.deps.identity.resolveUin(event.userUid, event.groupId);
		if (uin !== null) event.userUin = uin;
		this.resolveMemberIdentityFromCache(event);
	}
	resolveMemberIdentityFromCache(event) {
		if (event.groupId <= 0) return;
		if (event.userUin <= 0 && event.userUid) {
			const uin = this.deps.identity.findUinByUid(event.userUid, event.groupId);
			if (uin !== null) event.userUin = uin;
		}
		if (event.operatorUin <= 0 && event.operatorUid) {
			const uin = this.deps.identity.findUinByUid(event.operatorUid, event.groupId);
			if (uin !== null) event.operatorUin = uin;
		}
	}
	isSelfMemberIdentity(uin, uid) {
		const selfUin = Number(this.deps.identity.uin);
		return uin > 0 && uin === selfUin || Boolean(uid) && uid === this.deps.identity.selfUid;
	}
	handleSideEffects(event) {
		this.rememberEventIdentity(event);
		let groupId = 0;
		let reason = "";
		let refreshGroupList = false;
		switch (event.kind) {
			case "group_member_join":
				groupId = event.groupId;
				reason = "group_member_join";
				refreshGroupList = this.isSelfMemberIdentity(event.userUin, event.userUid);
				break;
			case "group_member_leave":
				groupId = event.groupId;
				reason = "group_member_leave";
				break;
			case "group_admin":
				groupId = event.groupId;
				reason = "group_admin";
				break;
			default: return;
		}
		if (groupId <= 0) return;
		if (this.memberRefreshTasks_.has(groupId)) return;
		if (event.kind === "group_member_join" && !this.deps.identity.findGroup(groupId)) refreshGroupList = true;
		const task = (async () => {
			try {
				if (refreshGroupList) try {
					await this.deps.fetchGroupList();
				} catch {}
				if (!this.deps.identity.findGroup(groupId)) {
					this.log.debug("member cache refreshed: group=%d reason=%s", groupId, reason);
					return;
				}
				await this.deps.fetchGroupMemberList(groupId);
				this.log.debug("member cache refreshed: group=%d reason=%s", groupId, reason);
			} catch (e) {
				this.log.warn("failed to refresh member cache: group=%d reason=%s err=%s", groupId, reason, e instanceof Error ? e.message : String(e));
			} finally {
				this.memberRefreshTasks_.delete(groupId);
			}
		})();
		this.memberRefreshTasks_.set(groupId, task);
	}
	rememberEventIdentity(event) {
		switch (event.kind) {
			case "friend_message":
				this.deps.identity.rememberRequestIdentity({
					uid: event.senderUid,
					uin: event.senderUin,
					source: "friend_message"
				});
				break;
			case "group_message": {
				const cached = this.deps.identity.findGroupMember(event.groupId, event.senderUin);
				if (cached && event.senderCard && event.senderCard !== cached.card) this.deps.identity.updateGroupMember(event.groupId, {
					...cached,
					card: event.senderCard
				});
				break;
			}
			case "group_member_join":
				this.deps.identity.rememberGroupMemberIdentity(event.groupId, {
					uid: event.userUid,
					uin: event.userUin
				});
				this.deps.identity.rememberGroupMemberIdentity(event.groupId, {
					uid: event.operatorUid,
					uin: event.operatorUin
				});
				this.deps.identity.rememberGroupMemberJoined(event.groupId, {
					uid: event.userUid,
					uin: event.userUin
				});
				break;
			case "group_member_leave":
				this.deps.identity.markGroupMemberInactive(event.groupId, {
					uid: event.userUid,
					uin: event.userUin
				});
				this.deps.identity.rememberGroupMemberIdentity(event.groupId, {
					uid: event.operatorUid,
					uin: event.operatorUin
				});
				break;
			case "group_admin": {
				this.deps.identity.rememberGroupMemberIdentity(event.groupId, { uin: event.userUin });
				const cached = this.deps.identity.findGroupMember(event.groupId, event.userUin);
				if (cached && cached.role !== "owner") this.deps.identity.updateGroupMember(event.groupId, {
					...cached,
					role: event.set ? "admin" : "member"
				});
				break;
			}
			case "friend_request":
				this.deps.identity.rememberRequestIdentity({
					uid: event.fromUid,
					uin: event.fromUin,
					source: "friend_request"
				});
				break;
			case "friend_remark_changed": {
				const rosterUpdated = this.deps.identity.updateFriendRemark(event.userUid, event.userUin, event.remark);
				this.log.debug("friend remark synchronized (uid=%s uin=%d length=%d rosterUpdated=%s)", event.userUid, event.userUin, event.remark.length, rosterUpdated);
				break;
			}
			case "group_invite":
				this.deps.identity.rememberRequestIdentity({
					groupId: event.groupId,
					uid: event.fromUid,
					uin: event.fromUin,
					source: "group_request"
				});
				if (event.invitedUid) this.deps.identity.rememberRequestIdentity({
					groupId: event.groupId,
					uid: event.invitedUid,
					uin: event.invitedUin ?? 0,
					source: "group_request"
				});
				break;
			default: break;
		}
	}
};
function printEvent(log, identity, event) {
	const message = formatEvent(identity, event);
	if (!message) return;
	if (WARN_EVENT_KINDS.has(event.kind)) log.warn("%s", message);
	else log.info("%s", message);
}
export {};
