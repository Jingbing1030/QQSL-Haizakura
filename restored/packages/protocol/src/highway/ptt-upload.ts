// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/highway/ptt-upload.ts"
// original bundle lines 110633-110837  (203 lines) of dist/index.mjs
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
init_ffmpeg_addon();
init_utils();
var moduleLog$6 = createLogger("Highway.Ptt");
function loggerFor(bridge) {
	const raw = bridge.identity?.uin;
	const uin = typeof raw === "string" ? Number.parseInt(raw, 10) : 0;
	return Number.isFinite(uin) && uin > 0 ? moduleLog$6.child({ uin }) : moduleLog$6;
}
var PRIVATE_PTT_CMD_ID = 1007;
var GROUP_PTT_CMD_ID = 1008;
function pttPayloadFromFingerprint(element) {
	return {
		bytes: /* @__PURE__ */ new Uint8Array(0),
		md5: hexToBytes(element.md5Hex ?? ""),
		sha1: hexToBytes(element.sha1Hex ?? ""),
		md5Hex: element.md5Hex ?? "",
		sha1Hex: element.sha1Hex ?? "",
		fileName: element.fileName || `${element.md5Hex ?? "record"}.amr`,
		fileSize: element.fileSize ?? 0,
		duration: element.duration ?? 1,
		voiceFormat: element.voiceFormat || 1,
		fastOnly: true,
		cleanups: []
	};
}
async function loadPtt(element, tempDir) {
	if (element.noByteFallback) {
		if (!element.md5Hex || !element.sha1Hex) throw new Error("record fast-upload requires md5Hex + sha1Hex");
		return pttPayloadFromFingerprint(element);
	}
	const source = element.url || element.fileId || "";
	if (!source) throw new Error("record source is empty");
	const cleanups = [];
	const runCleanups = () => {
		while (cleanups.length > 0) {
			const fn = cleanups.pop();
			if (!fn) continue;
			try {
				fn();
			} catch {}
		}
	};
	fs$1.mkdirSync(tempDir, { recursive: true });
	try {
		let inputPath;
		const local = resolveLocalFilePath(source);
		if (local && fs$1.existsSync(local)) inputPath = local;
		else {
			const loaded = await loadBinarySource(source, "record");
			inputPath = path$1.join(tempDir, `snowluma-ptt-in-${crypto$2.randomUUID()}`);
			fs$1.writeFileSync(inputPath, Buffer.from(loaded.bytes));
			cleanups.push(() => {
				try {
					fs$1.unlinkSync(inputPath);
				} catch {}
			});
		}
		const silk = await encodeSilk(inputPath, tempDir);
		if (silk.converted) {
			cleanups.push(() => {
				try {
					fs$1.unlinkSync(silk.path);
				} catch {}
			});
			moduleLog$6.debug("converted record to silk: %s -> %s (duration=%ds)", inputPath, silk.path, silk.duration);
		}
		const silkBytes = new Uint8Array(fs$1.readFileSync(silk.path));
		if (silkBytes.length === 0) throw new Error("silk file is empty after conversion");
		const hashes = computeHashes(silkBytes);
		const waveform = await tryPttWaveform(silk.path, tempDir, cleanups);
		return {
			bytes: silkBytes,
			md5: hashes.md5,
			sha1: hashes.sha1,
			md5Hex: hashes.md5Hex,
			sha1Hex: hashes.sha1Hex,
			fileName: `${hashes.md5Hex}.amr`,
			fileSize: silkBytes.length,
			duration: silk.duration,
			voiceFormat: 1,
			fastOnly: false,
			cleanups: [...cleanups],
			waveform
		};
	} catch (err) {
		runCleanups();
		throw err;
	}
}
async function tryPttWaveform(silkPath, tempDir, cleanups) {
	const wavPath = path$1.join(tempDir, `snowluma-ptt-wave-${crypto$2.randomUUID()}.wav`);
	cleanups.push(() => {
		try {
			fs$1.unlinkSync(wavPath);
		} catch {}
	});
	try {
		if (!(await getFFmpegAddon().decodeAudioToFmt(silkPath, wavPath, "wav")).result || !fs$1.existsSync(wavPath)) return;
		const { pcm, channels } = pcmS16leFromWav(new Uint8Array(fs$1.readFileSync(wavPath)));
		return encodePttWaveform(amplitudesFromPcmS16le(pcm, { channels }));
	} catch (err) {
		moduleLog$6.debug("ptt waveform skipped: %s", err instanceof Error ? err.message : String(err));
		return;
	}
}
/**
* Upload a voice clip and return the encoded MsgInfo bytes that go inside
* a `commonElem { serviceType: 48, businessType: 22 }`.
*/
async function uploadPtt(bridge, isGroup, targetIdOrUid, element) {
	const log = loggerFor(bridge);
	const ptt = await loadPtt(element, defaultPttTempDir());
	log.debug("uploading %d bytes md5=%s... → %s %s duration=%ds", ptt.fileSize, ptt.md5Hex.slice(0, 8), isGroup ? "group" : "c2c", String(targetIdOrUid), ptt.duration);
	try {
		const uploads = [{
			source: "top",
			cmdId: isGroup ? GROUP_PTT_CMD_ID : PRIVATE_PTT_CMD_ID,
			bytes: ptt.bytes,
			md5: ptt.md5,
			sha1: ptt.sha1,
			fastOnlyError: "record fast-upload not available (server requires bytes)"
		}];
		const upload = await runNtv2Upload({
			bridge,
			isGroup,
			targetIdOrUid,
			oidbCmd: isGroup ? 4718 : 4717,
			serviceCmd: isGroup ? "OidbSvcTrpcTcp.0x126e_100" : "OidbSvcTrpcTcp.0x126d_100",
			requestId: isGroup ? 1 : 4,
			businessType: 3,
			uploadInfo: [{
				fileInfo: {
					fileSize: ptt.fileSize,
					fileHash: ptt.md5Hex,
					fileSha1: ptt.sha1Hex,
					fileName: ptt.fileName,
					type: {
						type: 3,
						picFormat: 0,
						videoFormat: 0,
						voiceFormat: ptt.voiceFormat
					},
					width: 0,
					height: 0,
					time: ptt.duration,
					original: 0
				},
				subFileType: 0
			}],
			compatQmsgSceneType: isGroup ? 2 : 1,
			extBizInfo: {
				pic: { textSummary: "Nya~" },
				video: { bytesPbReserve: /* @__PURE__ */ new Uint8Array(0) },
				ptt: {
					bytesReserve: new Uint8Array([
						8,
						0,
						56,
						0
					]),
					bytesPbReserve: /* @__PURE__ */ new Uint8Array(0),
					...isGroup ? { bytesGeneralFlags: new Uint8Array([
						154,
						1,
						7,
						170,
						3,
						4,
						8,
						8,
						18,
						0
					]) } : {},
					...ptt.waveform ? { waveform: ptt.waveform } : {}
				}
			},
			uploads,
			label: "ptt"
		});
		mergePttWaveform(upload, ptt.waveform);
		const encoded = finalizeMediaMsgInfo(upload);
		const mediaNode = upload.msgInfo?.msgInfoBody?.[0]?.index;
		Object.assign(element, {
			md5Hex: ptt.md5Hex,
			sha1Hex: ptt.sha1Hex,
			fileSize: ptt.fileSize,
			fileName: ptt.fileName,
			duration: ptt.duration,
			voiceFormat: ptt.voiceFormat,
			fileId: mediaNode?.fileUuid,
			mediaNode
		});
		return {
			msgInfo: encoded,
			compatQMsg: upload.compatQMsg
		};
	} finally {
		for (const fn of ptt.cleanups) try {
			fn();
		} catch {}
	}
}
export {};
