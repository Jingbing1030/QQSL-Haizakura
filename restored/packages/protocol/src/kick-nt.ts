// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/kick-nt.ts"
// original bundle lines 344809-345056  (246 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var __td = new TextDecoder();
var __tdStrict = new TextDecoder("utf-8", { fatal: true });
function __utf8ReadLong(data, start, end) {
	const bytes = data.subarray(start, end);
	if (end - start < 128) return __td.decode(bytes);
	try {
		return __tdStrict.decode(bytes);
	} catch {
		return __td.decode(bytes);
	}
}
function __utf8Read(data, start, end) {
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
			if ((b & 192) !== 128) return __td.decode(data.subarray(start, end));
			value += String.fromCharCode((a & 31) << 6 | b & 63);
		} else if (a >= 224 && a < 240 && offset + 1 < end) {
			const b = data[offset++], c = data[offset++];
			if ((b & 192) !== 128 || (c & 192) !== 128 || a === 224 && b < 160 || a === 237 && b >= 160) return __td.decode(data.subarray(start, end));
			const code = (a & 15) << 12 | (b & 63) << 6 | c & 63;
			if (code !== 65279 || offset !== start + 3) value += String.fromCharCode(code);
		} else if (a >= 240 && a < 245 && offset + 2 < end) {
			const b = data[offset++], c = data[offset++], d = data[offset++];
			if ((b & 192) !== 128 || (c & 192) !== 128 || (d & 192) !== 128 || a === 240 && b < 144 || a === 244 && b >= 144) return __td.decode(data.subarray(start, end));
			const code = ((a & 7) << 18 | (b & 63) << 12 | (c & 63) << 6 | d & 63) - 65536;
			value += String.fromCharCode(55296 | code >>> 10, 56320 | code & 1023);
		} else return __td.decode(data.subarray(start, end));
	}
	return value;
}
function __readVarint32(data, offset, end) {
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
function __skipVarint(data, offset, end) {
	for (let i = 0; i < 10; i++) {
		if (offset >= end) throw new Error("protobuf truncated varint");
		const byte = data[offset++];
		if (i === 9 && byte > 1) throw new Error("protobuf varint overflow");
		if ((byte & 128) === 0) return offset;
	}
	throw new Error("protobuf varint overflow");
}
function __checkedEnd(offset, length, end) {
	if (length > end - offset) throw new Error("protobuf length-delimited field exceeds parent bounds");
	return offset + length;
}
function __skipUnknownField(data, offset, end, wireType, fieldNumber, depth = 0) {
	if (depth > 64) throw new Error("protobuf group nesting exceeds 64");
	if (wireType === 0) return __skipVarint(data, offset, end);
	if (wireType === 1) {
		if (end - offset < 8) throw new Error("protobuf truncated fixed64 field");
		return offset + 8;
	}
	if (wireType === 2) {
		const [length, next] = __readVarint32(data, offset, end);
		return __checkedEnd(next, length, end);
	}
	if (wireType === 3) {
		while (offset < end) {
			const [tag, next] = __readVarint32(data, offset, end);
			offset = next;
			const nestedField = tag >>> 3;
			const nestedWire = tag & 7;
			if (nestedField === 0) throw new Error("protobuf field number 0 is invalid");
			if (nestedWire === 4) {
				if (nestedField !== fieldNumber) throw new Error("protobuf mismatched end-group tag");
				return offset;
			}
			offset = __skipUnknownField(data, offset, end, nestedWire, nestedField, depth + 1);
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
function protobuf_decode_KickNTResponse(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
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
			case 8: {
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
				_f0 = _val;
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
				_f1 = _len <= 32 ? __utf8Read(data, offset, offset + _len) : __utf8ReadLong(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 34: {
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
				_f2 = _len <= 32 ? __utf8Read(data, offset, offset + _len) : __utf8ReadLong(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField(data, offset, end, wireType, _tag >>> 3);
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
		"uin": _f0,
		"tips": _f1,
		"title": _f2
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
var KICK_NT_CMD = "trpc.qq_new_tech.status_svc.StatusService.KickNT";
function parseKickNT(pkt, identity) {
	const resp = protobuf_decode_KickNTResponse(pkt.body);
	if (!resp) return [];
	return [{
		kind: "bot_offline",
		time: Math.floor(Date.now() / 1e3),
		selfUin: Number(pkt.uin) || Number(identity.uin) || 0,
		tag: resp.title ?? "",
		message: resp.tips ?? ""
	}];
}
export {};
