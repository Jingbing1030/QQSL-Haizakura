// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/msg-push/helpers.ts"
// original bundle lines 121659-122165  (505 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var __td$92 = new TextDecoder();
var __tdStrict$92 = new TextDecoder("utf-8", { fatal: true });
function __utf8ReadLong$92(data, start, end) {
	const bytes = data.subarray(start, end);
	if (end - start < 128) return __td$92.decode(bytes);
	try {
		return __tdStrict$92.decode(bytes);
	} catch {
		return __td$92.decode(bytes);
	}
}
function __utf8Read$92(data, start, end) {
	let value = "", offset = start;
	while (offset + 7 < end) {
		const a = data[offset], b = data[offset + 1], c = data[offset + 2], d = data[offset + 3];
		const e = data[offset + 4], f = data[offset + 5], g = data[offset + 6], h = data[offset + 7];
		if ((a | b | c | d | e | f | g | h) & 128) break;
		value += String.fromCharCode(a, b, c, d, e, f, g, h);
		offset += 8;
	}
	if (offset + 3 < end) {
		const a = data[offset], b = data[offset + 1], c = data[offset + 2], d = data[offset + 3];
		if (!((a | b | c | d) & 128)) {
			value += String.fromCharCode(a, b, c, d);
			offset += 4;
		}
	}
	while (offset < end) {
		const a = data[offset++];
		if (a < 128) value += String.fromCharCode(a);
		else if (a >= 194 && a < 224 && offset < end) {
			const b = data[offset++];
			if ((b & 192) !== 128) return __td$92.decode(data.subarray(start, end));
			value += String.fromCharCode((a & 31) << 6 | b & 63);
		} else if (a >= 224 && a < 240 && offset + 1 < end) {
			const b = data[offset++], c = data[offset++];
			if ((b & 192) !== 128 || (c & 192) !== 128 || a === 224 && b < 160 || a === 237 && b >= 160) return __td$92.decode(data.subarray(start, end));
			const code = (a & 15) << 12 | (b & 63) << 6 | c & 63;
			if (code !== 65279 || offset !== start + 3) value += String.fromCharCode(code);
		} else if (a >= 240 && a < 245 && offset + 2 < end) {
			const b = data[offset++], c = data[offset++], d = data[offset++];
			if ((b & 192) !== 128 || (c & 192) !== 128 || (d & 192) !== 128 || a === 240 && b < 144 || a === 244 && b >= 144) return __td$92.decode(data.subarray(start, end));
			const code = ((a & 7) << 18 | (b & 63) << 12 | (c & 63) << 6 | d & 63) - 65536;
			value += String.fromCharCode(55296 | code >>> 10, 56320 | code & 1023);
		} else return __td$92.decode(data.subarray(start, end));
	}
	return value;
}
function __readVarint32$93(data, offset, end) {
	let value = 0;
	for (let i = 0; i < 5; i++) {
		if (offset >= end) throw new Error("protobuf truncated uint32 varint");
		const byte = data[offset++];
		if (i === 4 && (byte & 240) !== 0) throw new Error("protobuf uint32 varint overflow");
		value += (byte & 127) * 2 ** (i * 7);
		if ((byte & 128) === 0) return [value >>> 0, offset];
	}
	throw new Error("protobuf uint32 varint overflow");
}
function __skipVarint$93(data, offset, end) {
	for (let i = 0; i < 10; i++) {
		if (offset >= end) throw new Error("protobuf truncated varint");
		const byte = data[offset++];
		if (i === 9 && byte > 1) throw new Error("protobuf varint overflow");
		if ((byte & 128) === 0) return offset;
	}
	throw new Error("protobuf varint overflow");
}
function __checkedEnd$93(offset, length, end) {
	if (length > end - offset) throw new Error("protobuf length-delimited field exceeds parent bounds");
	return offset + length;
}
function __skipUnknownField$93(data, offset, end, wireType, fieldNumber, depth = 0) {
	if (depth > 64) throw new Error("protobuf group nesting exceeds 64");
	if (wireType === 0) return __skipVarint$93(data, offset, end);
	if (wireType === 1) {
		if (end - offset < 8) throw new Error("protobuf truncated fixed64 field");
		return offset + 8;
	}
	if (wireType === 2) {
		const [length, next] = __readVarint32$93(data, offset, end);
		return __checkedEnd$93(next, length, end);
	}
	if (wireType === 3) {
		while (offset < end) {
			const [tag, next] = __readVarint32$93(data, offset, end);
			offset = next;
			const nestedField = tag >>> 3;
			const nestedWire = tag & 7;
			if (nestedField === 0) throw new Error("protobuf field number 0 is invalid");
			if (nestedWire === 4) {
				if (nestedField !== fieldNumber) throw new Error("protobuf mismatched end-group tag");
				return offset;
			}
			offset = __skipUnknownField$93(data, offset, end, nestedWire, nestedField, depth + 1);
		}
		throw new Error("protobuf unterminated group");
	}
	if (wireType === 4) throw new Error("protobuf unexpected end-group tag");
	if (wireType === 5) {
		if (end - offset < 4) throw new Error("protobuf truncated fixed32 field");
		return offset + 4;
	}
	throw new Error("protobuf invalid wire type " + wireType);
}
function protobuf_decode_OperatorInfo(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _unknownFields = null;
	let _unknownFieldsByKey = null;
	let _unknownTotalOccurrences = 0;
	let _unknownOmittedOccurrences = 0;
	let _unknownOmittedByteLength = 0;
	while (offset < end) {
		let _tag = data[offset++];
		if (_tag & 128) {
			let _s = 7, _b;
			_tag &= 127;
			do {
				if (offset >= end) throw new Error("Truncated protobuf varint");
				_b = data[offset++];
				if (_s === 28 && _b > 15) throw new Error("Invalid protobuf varint");
				if (_s < 32) _tag |= (_b & 127) << _s;
				_s += 7;
			} while (_b & 128);
			_tag >>>= 0;
		}
		if (_tag >>> 3 === 0) throw new Error("Invalid protobuf field number");
		switch (_tag) {
			case 10: {
				if (offset >= end) throw new Error("Truncated protobuf varint");
				let _len = data[offset++];
				if (_len & 128) {
					let _s = 7, _b;
					_len &= 127;
					do {
						if (offset >= end) throw new Error("Truncated protobuf varint");
						_b = data[offset++];
						if (_s === 28 && _b > 15) throw new Error("Invalid protobuf varint");
						if (_s < 32) _len |= (_b & 127) << _s;
						_s += 7;
					} while (_b & 128);
					_len >>>= 0;
				}
				if (offset + _len > end) throw new Error("Truncated protobuf field");
				_f0 = protobuf_decode_OperatorField1(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$93(data, offset, end, wireType, _tag >>> 3);
				const _unknownFieldNumber = _tag >>> 3;
				const _unknownByteLength = offset - _unknownStart;
				const _unknownKey = _unknownFieldNumber * 8 + wireType;
				_unknownTotalOccurrences++;
				const _knownUnknown = _unknownFieldsByKey?.get(_unknownKey);
				if (_knownUnknown) {
					_knownUnknown.count++;
					_knownUnknown.totalByteLength += _unknownByteLength;
				} else if ((_unknownFields?.length ?? 0) < 64) {
					const _unknown = {
						fieldNumber: _unknownFieldNumber,
						wireType,
						count: 1,
						totalByteLength: _unknownByteLength
					};
					(_unknownFields ??= []).push(_unknown);
					(_unknownFieldsByKey ??= /* @__PURE__ */ new Map()).set(_unknownKey, _unknown);
				} else {
					_unknownOmittedOccurrences++;
					_unknownOmittedByteLength += _unknownByteLength;
				}
				break;
			}
		}
	}
	const _result = { "operatorField": _f0 };
	if (_unknownTotalOccurrences > 0) Object.defineProperty(_result, Symbol.for("snowluma.proton.unknownFields"), {
		value: {
			fields: _unknownFields ?? [],
			totalOccurrences: _unknownTotalOccurrences,
			omittedOccurrences: _unknownOmittedOccurrences,
			omittedByteLength: _unknownOmittedByteLength
		},
		enumerable: false
	});
	return _result;
}
function protobuf_decode_OperatorField1(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
	let _f4 = null;
	let _unknownFields = null;
	let _unknownFieldsByKey = null;
	let _unknownTotalOccurrences = 0;
	let _unknownOmittedOccurrences = 0;
	let _unknownOmittedByteLength = 0;
	while (offset < end) {
		let _tag = data[offset++];
		if (_tag & 128) {
			let _s = 7, _b;
			_tag &= 127;
			do {
				if (offset >= end) throw new Error("Truncated protobuf varint");
				_b = data[offset++];
				if (_s === 28 && _b > 15) throw new Error("Invalid protobuf varint");
				if (_s < 32) _tag |= (_b & 127) << _s;
				_s += 7;
			} while (_b & 128);
			_tag >>>= 0;
		}
		if (_tag >>> 3 === 0) throw new Error("Invalid protobuf field number");
		switch (_tag) {
			case 10: {
				if (offset >= end) throw new Error("Truncated protobuf varint");
				let _len = data[offset++];
				if (_len & 128) {
					let _s = 7, _b;
					_len &= 127;
					do {
						if (offset >= end) throw new Error("Truncated protobuf varint");
						_b = data[offset++];
						if (_s === 28 && _b > 15) throw new Error("Invalid protobuf varint");
						if (_s < 32) _len |= (_b & 127) << _s;
						_s += 7;
					} while (_b & 128);
					_len >>>= 0;
				}
				if (offset + _len > end) throw new Error("Truncated protobuf field");
				_f0 = _len <= 32 ? __utf8Read$92(data, offset, offset + _len) : __utf8ReadLong$92(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 16: {
				if (offset >= end) throw new Error("Truncated protobuf varint");
				let _val = data[offset++];
				if (_val & 128) {
					let _s = 7, _b;
					_val &= 127;
					do {
						if (offset >= end) throw new Error("Truncated protobuf varint");
						_b = data[offset++];
						if (_s === 63 && _b > 1) throw new Error("Invalid protobuf varint");
						if (_s < 32) _val |= (_b & 127) << _s;
						_s += 7;
					} while (_b & 128);
					_val >>>= 0;
				}
				_f1 = _val;
				break;
			}
			case 26: {
				if (offset >= end) throw new Error("Truncated protobuf varint");
				let _len = data[offset++];
				if (_len & 128) {
					let _s = 7, _b;
					_len &= 127;
					do {
						if (offset >= end) throw new Error("Truncated protobuf varint");
						_b = data[offset++];
						if (_s === 28 && _b > 15) throw new Error("Invalid protobuf varint");
						if (_s < 32) _len |= (_b & 127) << _s;
						_s += 7;
					} while (_b & 128);
					_len >>>= 0;
				}
				if (offset + _len > end) throw new Error("Truncated protobuf field");
				_f2 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 32: {
				if (offset >= end) throw new Error("Truncated protobuf varint");
				let _val = data[offset++];
				if (_val & 128) {
					let _s = 7, _b;
					_val &= 127;
					do {
						if (offset >= end) throw new Error("Truncated protobuf varint");
						_b = data[offset++];
						if (_s === 63 && _b > 1) throw new Error("Invalid protobuf varint");
						if (_s < 32) _val |= (_b & 127) << _s;
						_s += 7;
					} while (_b & 128);
					_val >>>= 0;
				}
				_f3 = _val;
				break;
			}
			case 42: {
				if (offset >= end) throw new Error("Truncated protobuf varint");
				let _len = data[offset++];
				if (_len & 128) {
					let _s = 7, _b;
					_len &= 127;
					do {
						if (offset >= end) throw new Error("Truncated protobuf varint");
						_b = data[offset++];
						if (_s === 28 && _b > 15) throw new Error("Invalid protobuf varint");
						if (_s < 32) _len |= (_b & 127) << _s;
						_s += 7;
					} while (_b & 128);
					_len >>>= 0;
				}
				if (offset + _len > end) throw new Error("Truncated protobuf field");
				_f4 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$93(data, offset, end, wireType, _tag >>> 3);
				const _unknownFieldNumber = _tag >>> 3;
				const _unknownByteLength = offset - _unknownStart;
				const _unknownKey = _unknownFieldNumber * 8 + wireType;
				_unknownTotalOccurrences++;
				const _knownUnknown = _unknownFieldsByKey?.get(_unknownKey);
				if (_knownUnknown) {
					_knownUnknown.count++;
					_knownUnknown.totalByteLength += _unknownByteLength;
				} else if ((_unknownFields?.length ?? 0) < 64) {
					const _unknown = {
						fieldNumber: _unknownFieldNumber,
						wireType,
						count: 1,
						totalByteLength: _unknownByteLength
					};
					(_unknownFields ??= []).push(_unknown);
					(_unknownFieldsByKey ??= /* @__PURE__ */ new Map()).set(_unknownKey, _unknown);
				} else {
					_unknownOmittedOccurrences++;
					_unknownOmittedByteLength += _unknownByteLength;
				}
				break;
			}
		}
	}
	const _result = {
		"uid": _f0,
		"field2": _f1,
		"field3": _f2,
		"field4": _f3,
		"field5": _f4
	};
	if (_unknownTotalOccurrences > 0) Object.defineProperty(_result, Symbol.for("snowluma.proton.unknownFields"), {
		value: {
			fields: _unknownFields ?? [],
			totalOccurrences: _unknownTotalOccurrences,
			omittedOccurrences: _unknownOmittedOccurrences,
			omittedByteLength: _unknownOmittedByteLength
		},
		enumerable: false
	});
	return _result;
}
var MAX_RICH_CARD_OUTPUT_BYTES = 4 * 1024 * 1024;
var MAX_RICH_CARD_MESSAGE_OUTPUT_BYTES = 8 * 1024 * 1024;
function makeImageUrl(origUrl) {
	if (!origUrl) return "";
	if (/^https?:\/\//i.test(origUrl)) return origUrl;
	if (!origUrl.startsWith("/")) return "";
	if (origUrl.includes("rkey") || origUrl.includes("fileid")) return "https://multimedia.nt.qq.com.cn" + origUrl;
	return "http://gchat.qpic.cn" + origUrl;
}
/** Classic group-pic URL used when the wire carries an MD5 and no download path. */
function imageUrlFromMd5(md5Hex) {
	if (!/^[0-9a-fA-F]{32}$/.test(md5Hex)) return "";
	return `http://gchat.qpic.cn/gchatpic_new/0/0-0-${md5Hex.toUpperCase()}/0`;
}
/** NT multimedia download URL reconstructed from a file id when the path is omitted. */
function ntImageUrlFromFileId(fileId, isGroup) {
	if (!fileId) return "";
	return `https://multimedia.nt.qq.com.cn/download?appid=${isGroup ? 1407 : 1406}&fileid=${encodeURIComponent(fileId)}`;
}
function decompressData(data, maxOutputBytes = MAX_RICH_CARD_OUTPUT_BYTES) {
	if (!data || data.length === 0) return {
		ok: false,
		reason: "empty_payload"
	};
	if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) throw new Error(`invalid decompression output limit: ${maxOutputBytes}`);
	if ((data[0] === 0 || data[0] === 1) && data.length === 1) return {
		ok: false,
		reason: "marker_without_payload"
	};
	if (data[0] === 1) try {
		const inflated = inflateSync(Buffer.from(data.subarray(1)), { maxOutputLength: maxOutputBytes });
		return inflated.length > 0 ? {
			ok: true,
			text: inflated.toString("utf8"),
			outputBytes: inflated.length
		} : {
			ok: false,
			reason: "empty_output"
		};
	} catch (error) {
		const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
		return {
			ok: false,
			reason: code === "ERR_BUFFER_TOO_LARGE" ? "output_limit_exceeded" : code ? `inflate_failed:${code}` : "inflate_failed"
		};
	}
	if (data[0] === 0) {
		if (data.length - 1 > maxOutputBytes) return {
			ok: false,
			reason: "output_limit_exceeded"
		};
		return {
			ok: true,
			text: Buffer.from(data.subarray(1)).toString("utf8"),
			outputBytes: data.length - 1
		};
	}
	if (data.length > maxOutputBytes) return {
		ok: false,
		reason: "output_limit_exceeded"
	};
	return {
		ok: true,
		text: Buffer.from(data).toString("utf8"),
		outputBytes: data.length
	};
}
/** Sync Identity lookup. Miss is unresolved (0). Decoder must not invent a UIN. */
function resolveUidToUin(identity, groupId, uid) {
	if (!uid) return 0;
	return identity.findUinByUid(uid, groupId || void 0) ?? 0;
}
/**
* C2C routing hop. Prefer Identity on the hop UID; otherwise use that hop's
* own wire UIN. This is not a fallback that assigns an unrelated header UIN
* to a different UID.
*/
function c2cRoutingUin(identity, uid, wireUin) {
	const resolved = resolveUidToUin(identity, 0, uid);
	if (resolved > 0) return resolved;
	return wireUin > 0 ? wireUin : 0;
}
var OPERATOR_BYTES_PREVIEW_LENGTH = 32;
function describeOperatorBytes(bytes) {
	return `bytes=${bytes.length} preview=${hexPreview(bytes, OPERATOR_BYTES_PREVIEW_LENGTH)}`;
}
function hasControlCharacter(value) {
	for (const char of value) {
		const codePoint = char.codePointAt(0);
		if (codePoint !== void 0 && (codePoint <= 31 || codePoint === 127)) return true;
	}
	return false;
}
function assertOperatorUid(uid, context, bytes) {
	if (hasControlCharacter(uid)) throw new Error(`${context} operator UID contains control characters (${describeOperatorBytes(bytes)})`);
	return uid;
}
function decodeRawOperatorUid(bytes, context) {
	if (!bytes || bytes.length === 0) return "";
	let uid;
	try {
		uid = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch (error) {
		throw new Error(`${context} operator UID is not valid UTF-8 (${describeOperatorBytes(bytes)})`, { cause: error });
	}
	return assertOperatorUid(uid, context, bytes);
}
function decodeNestedOperatorUid(bytes, context) {
	if (!bytes || bytes.length === 0) return "";
	let info;
	try {
		info = protobuf_decode_OperatorInfo(bytes);
	} catch (error) {
		throw new Error(`${context} operator info decode failed (${describeOperatorBytes(bytes)})`, { cause: error });
	}
	const uid = info?.operatorField?.uid;
	if (!uid) throw new Error(`${context} operator info is missing UID (${describeOperatorBytes(bytes)})`);
	return assertOperatorUid(uid, context, bytes);
}
var OPERATOR_INFO_FIELD_TAG = 10;
function decodeGroupChangeOperatorUid(bytes, context) {
	if (!bytes || bytes.length === 0) return "";
	return bytes[0] === OPERATOR_INFO_FIELD_TAG ? decodeNestedOperatorUid(bytes, context) : decodeRawOperatorUid(bytes, context);
}
function buildTemplateMap(params) {
	const map = /* @__PURE__ */ new Map();
	for (const p of params) if (p.name !== void 0) map.set(p.name, p.value ?? "");
	return map;
}
function findTemplateValue(map, ...keys) {
	for (const k of keys) {
		const v = map.get(k);
		if (v) return v;
	}
	return "";
}
function unwrapGroupNotifyPayload(content) {
	if (content.length <= 7) return null;
	const lenBe = content[5] << 8 | content[6];
	const lenLe = content[5] | content[6] << 8;
	if (7 + lenBe <= content.length) return content.subarray(7, 7 + lenBe);
	if (7 + lenLe <= content.length) return content.subarray(7, 7 + lenLe);
	return content.subarray(7);
}
export {};
