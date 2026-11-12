// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/highway/ptt-waveform.ts"
// original bundle lines 110444-110632  (187 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var __pool$90;
var __poolOffset$90 = 0;
function __allocate$90(size) {
	if (size > 4096) return new Uint8Array(size);
	let buffer = __pool$90;
	if (!buffer || __poolOffset$90 + size > buffer.length) {
		buffer = __pool$90 = /* @__PURE__ */ new Uint8Array(8192);
		__poolOffset$90 = 0;
	}
	const start = __poolOffset$90;
	__poolOffset$90 += size;
	return buffer.subarray(start, start + size);
}
function protobuf_encode_PttWaveform(obj) {
	let size = 0;
	const _f0 = obj["size"];
	const _f1 = obj["amplitudes"];
	if (_f0 != null && _f0 !== 0) {
		const _val = _f0 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f1 != null && _f1.length > 0) {
		const _len = _f1.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	const buf = size <= 64 ? new Uint8Array(size) : __allocate$90(size);
	let offset = 0;
	if (_f0 != null && _f0 !== 0) {
		buf[offset++] = 8;
		let _v = _f0 >>> 0;
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
	}
	if (_f1 != null && _f1.length > 0) {
		buf[offset++] = 18;
		const _len = _f1.length;
		let _v = _len;
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
		buf.set(_f1, offset);
		offset += _len;
	}
	return buf;
}
function u16le(bytes, offset) {
	return bytes[offset] | bytes[offset + 1] << 8;
}
function u32le(bytes, offset) {
	return bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16 | bytes[offset + 3] << 24;
}
function fourcc(bytes, offset) {
	return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}
function s16le(bytes, offset) {
	const raw = u16le(bytes, offset);
	return raw >= 32768 ? raw - 65536 : raw;
}
/**
* Pull s16le PCM out of a WAV produced by `decodeAudioToFmt(..., 'wav')`.
* Rejects non-PCM / non-16-bit so a botched transcode cannot invent bars.
*/
function pcmS16leFromWav(wav) {
	if (wav.length < 12) throw new Error("wav is truncated");
	if (fourcc(wav, 0) !== "RIFF" || fourcc(wav, 8) !== "WAVE") throw new Error("wav is not a RIFF/WAVE file");
	let offset = 12;
	let channels = 0;
	let sampleRate = 0;
	let bitsPerSample = 0;
	let audioFormat = 0;
	let data;
	while (offset + 8 <= wav.length) {
		const id = fourcc(wav, offset);
		const size = u32le(wav, offset + 4);
		const start = offset + 8;
		if (start + size > wav.length) throw new Error("wav chunk is truncated");
		if (id === "fmt ") {
			if (size < 16) throw new Error("wav fmt chunk is short");
			audioFormat = u16le(wav, start);
			channels = u16le(wav, start + 2);
			sampleRate = u32le(wav, start + 4);
			bitsPerSample = u16le(wav, start + 14);
		} else if (id === "data") data = wav.subarray(start, start + size);
		offset = start + size + (size & 1);
	}
	if (!data) throw new Error("wav has no data chunk");
	if (audioFormat !== 1) throw new Error(`wav format ${audioFormat} is not PCM`);
	if (channels < 1) throw new Error("wav channel count is invalid");
	if (bitsPerSample !== 16) throw new Error(`wav bits ${bitsPerSample} is not s16`);
	return {
		pcm: data,
		channels,
		sampleRate
	};
}
function silentWaveform(bins) {
	return new Uint8Array(bins).fill(25);
}
/**
* Peak each window of interleaved s16le frames into official-length bars.
* Quiet windows stay 0 (valleys). A fully silent clip uses the official floor
* so private-chat clients still draw a progress track.
*/
function amplitudesFromPcmS16le(pcm, options = {}) {
	const channels = options.channels ?? 1;
	const bins = options.bins ?? 30;
	if (channels < 1 || bins < 1) throw new Error("waveform channels/bins must be >= 1");
	const frameSize = channels * 2;
	const frames = Math.floor(pcm.length / frameSize);
	if (frames === 0) return silentWaveform(bins);
	const out = new Uint8Array(bins);
	let any = false;
	for (let bin = 0; bin < bins; bin += 1) {
		const start = Math.floor(bin * frames / bins);
		let end = Math.floor((bin + 1) * frames / bins);
		if (end <= start) end = start + 1;
		let peak = 0;
		for (let frame = start; frame < end && frame < frames; frame += 1) {
			const base = frame * frameSize;
			for (let channel = 0; channel < channels; channel += 1) {
				const sample = Math.abs(s16le(pcm, base + channel * 2));
				if (sample > peak) peak = sample;
			}
		}
		const amplitude = Math.min(255, Math.round(peak * 255 / 32767));
		if (amplitude > 0) any = true;
		out[bin] = amplitude;
	}
	return any ? out : silentWaveform(bins);
}
/** Encode amplitudes as the blob `ParsePttWave` accepts (count == bytes). */
function encodePttWaveform(amplitudes) {
	if (amplitudes.length === 0) throw new Error("ptt waveform amplitudes are empty");
	return protobuf_encode_PttWaveform({
		size: amplitudes.length,
		amplitudes
	});
}
/** Stamp computed waveform onto the upload response so finalize cannot drop it. */
function mergePttWaveform(upload, waveform) {
	if (!waveform || waveform.length === 0 || !upload.msgInfo) return;
	const ext = upload.msgInfo.extBizInfo ?? {};
	upload.msgInfo.extBizInfo = {
		...ext,
		ptt: {
			...ext.ptt,
			waveform
		}
	};
}
export {};
