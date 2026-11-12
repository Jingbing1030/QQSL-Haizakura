// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/history-sync.ts"
// original bundle lines 339063-339309  (245 lines) of dist/index.mjs
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
var LOGIN_HISTORY_SYNC_LIMITS = {
	startupDelayMs: 3e4,
	scannedGroups: LOGIN_HISTORY_SYNC_PROTOCOL_LIMITS.maxTargetsPerKind,
	scannedPrivateUsers: LOGIN_HISTORY_SYNC_PROTOCOL_LIMITS.maxTargetsPerKind,
	maxGroups: 3,
	maxPrivateUsers: 3,
	messagesPerSession: LOGIN_HISTORY_SYNC_PROTOCOL_LIMITS.maxMessagesPerSession
};
var log$22 = createLogger("OneBot.HistorySync");
var SYSTEM_CLOCK = { sleep: (ms, signal) => abortableSleep(ms, signal) };
/**
* Process-wide coordinator for automatic login backfill.
*
* The 30-second grace period happens before entering the global FIFO, so one
* account waiting out startup does not block another account that is already
* ready. The complete per-account operation is serialized so conversion and
* persistence cannot overlap another account's automatic sync.
*/
var LoginHistorySyncCoordinator = class {
	clock;
	tail = Promise.resolve();
	constructor(clock = SYSTEM_CLOCK) {
		this.clock = clock;
	}
	async schedule(ref, signal) {
		await this.clock.sleep(LOGIN_HISTORY_SYNC_LIMITS.startupDelayMs, signal);
		throwIfAborted(signal);
		let operationStarted = false;
		const operation = this.tail.then(async () => {
			throwIfAborted(signal);
			operationStarted = true;
			return this.runAccount(ref, signal);
		});
		this.tail = operation.then(() => void 0, () => void 0);
		return rejectWhileQueuedOnAbort(operation, signal, () => operationStarted);
	}
	async runAccount(ref, signal) {
		const groups = ref.bridge.identity.groups.filter((group) => Number.isSafeInteger(group.groupId) && group.groupId > 0);
		const privateUsers = ref.bridge.identity.friends.filter((friend) => Number.isSafeInteger(friend.uin) && friend.uin > 0 && friend.uin !== ref.selfId && typeof friend.uid === "string" && friend.uid.trim().length > 0);
		const truncatedGroups = groups.length > LOGIN_HISTORY_SYNC_LIMITS.scannedGroups;
		const truncatedPrivateUsers = privateUsers.length > LOGIN_HISTORY_SYNC_LIMITS.scannedPrivateUsers;
		const scannedGroups = groups.slice(0, LOGIN_HISTORY_SYNC_LIMITS.scannedGroups);
		const scannedPrivateUsers = privateUsers.slice(0, LOGIN_HISTORY_SYNC_LIMITS.scannedPrivateUsers);
		if (truncatedGroups || truncatedPrivateUsers) log$22.warn("login history sync roster truncated: UIN=%d groups=%d/%d private=%d/%d", ref.selfId, scannedGroups.length, groups.length, scannedPrivateUsers.length, privateUsers.length);
		throwIfAborted(signal);
		const state = await ref.bridge.apis.message.probeHistorySyncState(scannedGroups.map((group) => group.groupId), scannedPrivateUsers.map((friend) => ({
			userId: friend.uin,
			uid: friend.uid
		})), signal);
		const groupCandidates = await selectGroupCandidates(ref.messageStore, state.groups);
		const privateCandidates = await selectPrivateCandidates(ref.messageStore, state.privateUsers);
		const mediaSegmentSink = ref.converterCtx.mediaSegmentSink;
		const persistenceRef = {
			...ref,
			converterCtx: {
				...ref.converterCtx,
				imageUrlResolver: null,
				mediaUrlResolver: null,
				mediaSegmentSink: mediaSegmentSink ? async (mediaType, element, data, isGroup, sessionId) => {
					throwIfAborted(signal);
					await mediaSegmentSink(mediaType, element, data, isGroup, sessionId);
				} : null
			}
		};
		const result = {
			scannedGroups: scannedGroups.length,
			scannedPrivateUsers: scannedPrivateUsers.length,
			selectedGroups: groupCandidates.length,
			selectedPrivateUsers: privateCandidates.length,
			fetchedMessages: 0,
			storedMessages: 0,
			failedSessions: 0,
			truncatedGroups,
			truncatedPrivateUsers
		};
		log$22.info("login history sync selected: UIN=%d scanned=%d/%d selected=%d/%d", ref.selfId, result.scannedGroups, result.scannedPrivateUsers, result.selectedGroups, result.selectedPrivateUsers);
		for (const candidate of groupCandidates) {
			throwIfAborted(signal);
			try {
				const messages = await fetchGroupCandidate(persistenceRef, candidate, signal);
				throwIfAborted(signal);
				result.fetchedMessages += messages.length;
				for (const message of messages) {
					throwIfAborted(signal);
					await persistGroupMessage(persistenceRef, message, signal);
					result.storedMessages += 1;
				}
			} catch (error) {
				if (signal.aborted) throwIfAborted(signal);
				result.failedSessions += 1;
				log$22.warn("login history sync group failed: UIN=%d group=%d error=%s", ref.selfId, candidate.state.groupId, errorText(error));
			}
		}
		for (const candidate of privateCandidates) {
			throwIfAborted(signal);
			try {
				const messages = await fetchPrivateCandidate(persistenceRef, candidate, signal);
				throwIfAborted(signal);
				result.fetchedMessages += messages.length;
				for (const message of messages) {
					throwIfAborted(signal);
					if (await persistPrivateMessage(persistenceRef, candidate.state.userId, message, signal)) result.storedMessages += 1;
				}
			} catch (error) {
				if (signal.aborted) throwIfAborted(signal);
				result.failedSessions += 1;
				log$22.warn("login history sync private failed: UIN=%d peer=%d error=%s", ref.selfId, candidate.state.userId, errorText(error));
			}
		}
		log$22.info("login history sync complete: UIN=%d fetched=%d stored=%d failed=%d", ref.selfId, result.fetchedMessages, result.storedMessages, result.failedSessions);
		return result;
	}
};
var loginHistorySyncCoordinator = new LoginHistorySyncCoordinator();
async function selectGroupCandidates(store, states) {
	return (await mapWithConcurrency(states, 8, async (state) => {
		if (!Number.isSafeInteger(state.latestSeq) || state.latestSeq <= 0) return [];
		const observedSequence = await store.findLatestAuthoritativeSequence(true, state.groupId);
		const localSequence = await store.findLatestPersistedAuthoritativeSequence(true, state.groupId);
		if (localSequence !== null) {
			if (state.latestSeq <= localSequence) return [];
			return [{
				state,
				localSequence,
				priority: state.latestSeq - localSequence,
				knownGap: true
			}];
		}
		if (observedSequence !== null) return [{
			state,
			localSequence: null,
			priority: state.latestSeq,
			knownGap: true
		}];
		if (state.latestSeq <= state.readSeq) return [];
		return [{
			state,
			localSequence: null,
			priority: state.latestSeq - state.readSeq,
			knownGap: false
		}];
	})).flat().sort(compareCandidates).slice(0, LOGIN_HISTORY_SYNC_LIMITS.maxGroups);
}
async function selectPrivateCandidates(store, states) {
	return (await mapWithConcurrency(states, 8, async (state) => {
		if (!Number.isSafeInteger(state.latestSeq) || state.latestSeq <= 0) return [];
		const observedSequence = await store.findLatestAuthoritativeSequence(false, state.userId);
		const localSequence = await store.findLatestPersistedAuthoritativeSequence(false, state.userId);
		if (localSequence !== null) {
			if (state.latestSeq <= localSequence) return [];
			return [{
				state,
				localSequence,
				priority: state.latestSeq - localSequence,
				knownGap: true
			}];
		}
		if (!Number.isSafeInteger(state.lastMsgTime) || state.lastMsgTime <= 0) return [];
		return [{
			state,
			localSequence: null,
			priority: state.lastMsgTime,
			knownGap: observedSequence !== null
		}];
	})).flat().sort(compareCandidates).slice(0, LOGIN_HISTORY_SYNC_LIMITS.maxPrivateUsers);
}
function compareCandidates(left, right) {
	if (left.knownGap !== right.knownGap) return left.knownGap ? -1 : 1;
	if (left.localSequence !== null !== (right.localSequence !== null)) return left.localSequence !== null ? -1 : 1;
	return right.priority - left.priority;
}
function fetchGroupCandidate(ref, candidate, signal) {
	const endSeq = candidate.localSequence === null ? candidate.state.latestSeq : Math.min(candidate.state.latestSeq, candidate.localSequence + LOGIN_HISTORY_SYNC_LIMITS.messagesPerSession);
	const startSeq = candidate.localSequence === null ? Math.max(1, endSeq - LOGIN_HISTORY_SYNC_LIMITS.messagesPerSession + 1) : candidate.localSequence + 1;
	return ref.bridge.apis.message.getGroupHistorySyncPage(candidate.state.groupId, startSeq, endSeq, ref.selfId, signal);
}
function fetchPrivateCandidate(ref, candidate, signal) {
	if (candidate.localSequence !== null) {
		const endSeq = Math.min(candidate.state.latestSeq, candidate.localSequence + LOGIN_HISTORY_SYNC_LIMITS.messagesPerSession);
		return ref.bridge.apis.message.getC2cHistorySyncPage(candidate.state.uid, candidate.localSequence + 1, endSeq, ref.selfId, signal);
	}
	const beforeTime = Math.min(4294967295, candidate.state.lastMsgTime + 1);
	return ref.bridge.apis.message.getC2cLatestHistorySyncPage(candidate.state.uid, LOGIN_HISTORY_SYNC_LIMITS.messagesPerSession, ref.selfId, beforeTime, signal);
}
async function persistGroupMessage(ref, message, signal) {
	throwIfAborted(signal);
	const converted = await convertEvent(ref.converterCtx, message);
	throwIfAborted(signal);
	if (!converted || converted.message_type !== "group") throw new Error(`group history conversion failed: group=${message.groupId} seq=${message.msgSeq} messageType=${String(converted?.message_type)}`);
	await persistHistoryEvent(ref.messageStore, converted);
}
async function persistPrivateMessage(ref, peerUin, message, signal) {
	throwIfAborted(signal);
	const receivedPeer = message.peerUin ?? 0;
	if (receivedPeer > 0 && receivedPeer !== peerUin) throw new Error(`private history peer mismatch: requested=${peerUin} received=${receivedPeer} seq=${String(message.ntMsgSeq ?? message.msgSeq)}`);
	if (receivedPeer <= 0) message.peerUin = peerUin;
	const clientSequence = message.clientSeq ?? message.msgSeq;
	const sentBySelf = message.senderUin === ref.selfId;
	const converted = await convertEvent(ref.converterCtx, message);
	throwIfAborted(signal);
	if (!converted || converted.message_type !== "private") throw new Error(`private history conversion failed: peer=${peerUin} seq=${String(message.ntMsgSeq ?? message.msgSeq)} messageType=${String(converted?.message_type)}`);
	if (await ref.messageStore.isPrivateMessageRecalled(peerUin, clientSequence, sentBySelf, message.time)) {
		log$22.debug("login history sync omitted recalled private message: UIN=%d peer=%d clientSeq=%d self=%s", ref.selfId, peerUin, clientSequence, String(sentBySelf));
		return false;
	}
	if (converted.post_type === "message_sent" && toHistoryInt(converted.target_id) === 0) converted.target_id = peerUin;
	return persistHistoryEvent(ref.messageStore, converted, peerUin, message);
}
function abortableSleep(ms, signal) {
	throwIfAborted(signal);
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		timer.unref();
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal.reason ?? /* @__PURE__ */ new Error("login history sync aborted"));
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}
function throwIfAborted(signal) {
	if (signal.aborted) throw signal.reason ?? /* @__PURE__ */ new Error("login history sync aborted");
}
function rejectWhileQueuedOnAbort(result, signal, hasStarted) {
	if (signal.aborted && !hasStarted()) return Promise.reject(signal.reason ?? /* @__PURE__ */ new Error("login history sync aborted"));
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			if (!hasStarted()) {
				signal.removeEventListener("abort", onAbort);
				reject(signal.reason ?? /* @__PURE__ */ new Error("login history sync aborted"));
			}
		};
		signal.addEventListener("abort", onAbort);
		result.then(resolve, reject).finally(() => {
			signal.removeEventListener("abort", onAbort);
		});
	});
}
function errorText(error) {
	return error instanceof Error ? error.stack ?? error.message : String(error);
}
export {};
