// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/msg-push/rich-body-decoder.ts"
// original bundle lines 122224-135710  (13485 lines) of dist/index.mjs
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
var __td$91 = new TextDecoder();
var __te$87 = new TextEncoder();
var __nonAscii$87 = /[^\x00-\x7f]/;
var __utf8Scratch$87;
var __tdStrict$91 = new TextDecoder("utf-8", { fatal: true });
function __utf8LenLong$87(value) {
	const buffer = __utf8Scratch$87 ??= /* @__PURE__ */ new Uint8Array(4096);
	let length = 0;
	for (;;) {
		const result = __te$87.encodeInto(value, buffer);
		length += result.written;
		if (result.read === value.length) return length;
		value = value.slice(result.read);
	}
}
function __utf8Len$87(value) {
	if (value.length >= 32) return __utf8LenLong$87(value);
	if (value.length >= 8 && value.charCodeAt(0) < 128 && !__nonAscii$87.test(value)) return value.length;
	let length = 0;
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);
		if (code < 128) {
			length++;
			continue;
		}
		if (code < 2048) {
			length += 2;
			continue;
		}
		if ((code & 64512) === 55296) {
			if (i + 1 < value.length) {
				if ((value.charCodeAt(i + 1) & 64512) === 56320) {
					length += 4;
					i++;
					continue;
				}
			}
			length += 3;
			continue;
		}
		if ((code & 64512) === 56320) {
			length += 3;
			continue;
		}
		length += 3;
	}
	return length;
}
function __utf8Write$87(buf, offset, value) {
	for (let i = 0; i < value.length; i++) {
		let code = value.charCodeAt(i);
		if (code < 128) {
			buf[offset++] = code;
			continue;
		}
		if (code < 2048) {
			buf[offset++] = 192 | code >> 6;
			buf[offset++] = 128 | code & 63;
			continue;
		}
		if ((code & 64512) === 55296) {
			if (i + 1 < value.length) {
				const next = value.charCodeAt(i + 1);
				if ((next & 64512) === 56320) {
					const point = (code - 55296 << 10) + (next - 56320) + 65536;
					buf[offset++] = 240 | point >> 18;
					buf[offset++] = 128 | point >> 12 & 63;
					buf[offset++] = 128 | point >> 6 & 63;
					buf[offset++] = 128 | point & 63;
					i++;
					continue;
				}
			}
			code = 65533;
		} else if ((code & 64512) === 56320) code = 65533;
		buf[offset++] = 224 | code >> 12;
		buf[offset++] = 128 | code >> 6 & 63;
		buf[offset++] = 128 | code & 63;
	}
	return offset;
}
function __utf8WriteLong$87(buf, offset, value) {
	return offset + __te$87.encodeInto(value, buf.subarray(offset)).written;
}
function __asciiWrite$87(buf, offset, value) {
	let i = 0;
	for (; i + 7 < value.length; i += 8) {
		buf[offset++] = value.charCodeAt(i);
		buf[offset++] = value.charCodeAt(i + 1);
		buf[offset++] = value.charCodeAt(i + 2);
		buf[offset++] = value.charCodeAt(i + 3);
		buf[offset++] = value.charCodeAt(i + 4);
		buf[offset++] = value.charCodeAt(i + 5);
		buf[offset++] = value.charCodeAt(i + 6);
		buf[offset++] = value.charCodeAt(i + 7);
	}
	for (; i < value.length; i++) buf[offset++] = value.charCodeAt(i);
	return offset;
}
function __utf8ReadLong$91(data, start, end) {
	const bytes = data.subarray(start, end);
	if (end - start < 128) return __td$91.decode(bytes);
	try {
		return __tdStrict$91.decode(bytes);
	} catch {
		return __td$91.decode(bytes);
	}
}
function __utf8Read$91(data, start, end) {
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
			if ((b & 192) !== 128) return __td$91.decode(data.subarray(start, end));
			value += String.fromCharCode((a & 31) << 6 | b & 63);
		} else if (a >= 224 && a < 240 && offset + 1 < end) {
			const b = data[offset++], c = data[offset++];
			if ((b & 192) !== 128 || (c & 192) !== 128 || a === 224 && b < 160 || a === 237 && b >= 160) return __td$91.decode(data.subarray(start, end));
			const code = (a & 15) << 12 | (b & 63) << 6 | c & 63;
			if (code !== 65279 || offset !== start + 3) value += String.fromCharCode(code);
		} else if (a >= 240 && a < 245 && offset + 2 < end) {
			const b = data[offset++], c = data[offset++], d = data[offset++];
			if ((b & 192) !== 128 || (c & 192) !== 128 || (d & 192) !== 128 || a === 240 && b < 144 || a === 244 && b >= 144) return __td$91.decode(data.subarray(start, end));
			const code = ((a & 7) << 18 | (b & 63) << 12 | (c & 63) << 6 | d & 63) - 65536;
			value += String.fromCharCode(55296 | code >>> 10, 56320 | code & 1023);
		} else return __td$91.decode(data.subarray(start, end));
	}
	return value;
}
var __pool$88;
var __poolOffset$88 = 0;
function __allocate$88(size) {
	if (size > 4096) return new Uint8Array(size);
	let buffer = __pool$88;
	if (!buffer || __poolOffset$88 + size > buffer.length) {
		buffer = __pool$88 = /* @__PURE__ */ new Uint8Array(8192);
		__poolOffset$88 = 0;
	}
	const start = __poolOffset$88;
	__poolOffset$88 += size;
	return buffer.subarray(start, start + size);
}
function __readVarint32$92(data, offset, end) {
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
function __skipVarint$92(data, offset, end) {
	for (let i = 0; i < 10; i++) {
		if (offset >= end) throw new Error("protobuf truncated varint");
		const byte = data[offset++];
		if (i === 9 && byte > 1) throw new Error("protobuf varint overflow");
		if ((byte & 128) === 0) return offset;
	}
	throw new Error("protobuf varint overflow");
}
function __checkedEnd$92(offset, length, end) {
	if (length > end - offset) throw new Error("protobuf length-delimited field exceeds parent bounds");
	return offset + length;
}
function __skipUnknownField$92(data, offset, end, wireType, fieldNumber, depth = 0) {
	if (depth > 64) throw new Error("protobuf group nesting exceeds 64");
	if (wireType === 0) return __skipVarint$92(data, offset, end);
	if (wireType === 1) {
		if (end - offset < 8) throw new Error("protobuf truncated fixed64 field");
		return offset + 8;
	}
	if (wireType === 2) {
		const [length, next] = __readVarint32$92(data, offset, end);
		return __checkedEnd$92(next, length, end);
	}
	if (wireType === 3) {
		while (offset < end) {
			const [tag, next] = __readVarint32$92(data, offset, end);
			offset = next;
			const nestedField = tag >>> 3;
			const nestedWire = tag & 7;
			if (nestedField === 0) throw new Error("protobuf field number 0 is invalid");
			if (nestedWire === 4) {
				if (nestedField !== fieldNumber) throw new Error("protobuf mismatched end-group tag");
				return offset;
			}
			offset = __skipUnknownField$92(data, offset, end, nestedWire, nestedField, depth + 1);
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
function protobuf_decode_PushMsgBody$5(data, offset = 0, end = data.length) {
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
				_f0 = protobuf_decode_ResponseHead$5(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 18: {
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
				_f1 = protobuf_decode_ContentHead$5(data, offset, offset + _len);
				offset += _len;
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
				_f2 = protobuf_decode_MessageBody$5(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"responseHead": _f0,
		"contentHead": _f1,
		"body": _f2
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
function protobuf_decode_ResponseHead$5(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
	let _f4 = null;
	let _f5 = null;
	let _f6 = null;
	let _f7 = null;
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
			case 18: {
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
				_f1 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 24: {
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
				_f2 = _val;
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
			case 40: {
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
				_f4 = _val;
				break;
			}
			case 50: {
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
				_f5 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 58: {
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
				_f6 = protobuf_decode_ResponseForward$5(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 66: {
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
				_f7 = protobuf_decode_ResponseGrp$5(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"fromUin": _f0,
		"fromUid": _f1,
		"type": _f2,
		"sigMap": _f3,
		"toUin": _f4,
		"toUid": _f5,
		"forward": _f6,
		"grp": _f7
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
function protobuf_decode_ResponseForward$5(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
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
			case 40: {
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
			case 50: {
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
				_f1 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"tempGroupUin": _f0,
		"friendName": _f1
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
function protobuf_decode_ResponseGrp$5(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
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
			case 18: {
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
				_f1 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
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
				_f2 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 58: {
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
				_f3 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"groupUin": _f0,
		"memberName": _f1,
		"memberCard": _f2,
		"groupName": _f3
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
function protobuf_decode_ContentHead$5(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
	let _f4 = null;
	let _f5 = null;
	let _f6 = null;
	let _f7 = null;
	let _f8 = null;
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
			case 24: {
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
				_f2 = _val;
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
			case 40: {
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
				_f4 = _val;
				break;
			}
			case 48: {
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
				_f5 = _val;
				break;
			}
			case 56: {
				let _lo = 0, _hi = 0, _s = 0, _b;
				do {
					if (offset >= end) throw new Error("Truncated protobuf varint");
					_b = data[offset++];
					if (_s === 63 && _b > 1) throw new Error("Invalid protobuf varint");
					if (_s < 28) _lo |= (_b & 127) << _s;
					else if (_s === 28) {
						_lo |= (_b & 127) << 28;
						_hi = (_b & 127) >>> 4;
					} else _hi |= (_b & 127) << _s - 32;
					_s += 7;
				} while (_b & 128);
				_f6 = _hi === 0 ? BigInt(_lo >>> 0) : BigInt(_lo >>> 0) | BigInt(_hi >>> 0) << 32n;
				break;
			}
			case 88: {
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
				_f7 = _val;
				break;
			}
			case 96: {
				let _lo = 0, _hi = 0, _s = 0, _b;
				do {
					if (offset >= end) throw new Error("Truncated protobuf varint");
					_b = data[offset++];
					if (_s === 63 && _b > 1) throw new Error("Invalid protobuf varint");
					if (_s < 28) _lo |= (_b & 127) << _s;
					else if (_s === 28) {
						_lo |= (_b & 127) << 28;
						_hi = (_b & 127) >>> 4;
					} else _hi |= (_b & 127) << _s - 32;
					_s += 7;
				} while (_b & 128);
				_f8 = _hi === 0 ? BigInt(_lo >>> 0) : BigInt(_lo >>> 0) | BigInt(_hi >>> 0) << 32n;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"msgType": _f0,
		"subType": _f1,
		"c2cCmd": _f2,
		"msgId": _f3,
		"sequence": _f4,
		"timestamp": _f5,
		"field7": _f6,
		"ntMsgSeq": _f7,
		"newId": _f8
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
function protobuf_decode_MessageBody$5(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
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
				_f0 = protobuf_decode_RichText$5(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 18: {
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
				_f1 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"richText": _f0,
		"msgContent": _f1
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
function protobuf_decode_RichText$5(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	const _f0 = [];
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
			case 18: {
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
				_f0.push(protobuf_decode_Elem$5(data, offset, offset + _len));
				offset += _len;
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
				_f1 = protobuf_decode_NotOnlineFile$5(data, offset, offset + _len);
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
				_f2 = protobuf_decode_Ptt$5(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"elems": _f0,
		"notOnlineFile": _f1,
		"ptt": _f2
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
function protobuf_decode_Elem$5(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
	let _f4 = null;
	let _f5 = null;
	let _f6 = null;
	let _f7 = null;
	let _f8 = null;
	let _f9 = null;
	let _f10 = null;
	let _f11 = null;
	let _f12 = null;
	let _f13 = null;
	let _f14 = null;
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
				_f0 = protobuf_decode_TextElem$5(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 18: {
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
				_f1 = protobuf_decode_FaceElem$5(data, offset, offset + _len);
				offset += _len;
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
				_f2 = protobuf_decode_OnlineImage$5(data, offset, offset + _len);
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
				_f3 = protobuf_decode_NotOnlineImage$5(data, offset, offset + _len);
				offset += _len;
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
				_f4 = protobuf_decode_TransElem$5(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 50: {
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
				_f5 = protobuf_decode_MarketFace$5(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 66: {
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
				_f6 = protobuf_decode_CustomFace$5(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 98: {
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
				_f7 = protobuf_decode_RichMsg$5(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 106: {
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
				_f8 = protobuf_decode_GroupFileElem$5(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 130: {
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
				_f9 = protobuf_decode_ExtraInfo$5(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 154: {
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
				_f10 = protobuf_decode_VideoFile$5(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 298: {
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
				_f11 = protobuf_decode_GeneralFlags$5(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 362: {
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
				_f12 = protobuf_decode_SrcMsg$5(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 410: {
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
				_f13 = protobuf_decode_LightAppElem$5(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 426: {
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
				_f14 = protobuf_decode_CommonElem$5(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"text": _f0,
		"face": _f1,
		"onlineImage": _f2,
		"notOnlineImage": _f3,
		"transElem": _f4,
		"marketFace": _f5,
		"customFace": _f6,
		"richMsg": _f7,
		"groupFile": _f8,
		"extraInfo": _f9,
		"videoFile": _f10,
		"generalFlags": _f11,
		"srcMsg": _f12,
		"lightApp": _f13,
		"commonElem": _f14
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
function protobuf_encode_TextElem(obj) {
	let size = 0;
	const _f0 = obj["str"];
	let _c0;
	const _f1 = obj["link"];
	let _c1;
	const _f2 = obj["attr6Buf"];
	const _f3 = obj["attr7Buf"];
	const _f4 = obj["buf"];
	const _f5 = obj["pbReserve"];
	if (_f0 != null && _f0 !== "") {
		const _len = __utf8Len$87(_f0);
		_c0 = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f1 != null && _f1 !== "") {
		const _len = __utf8Len$87(_f1);
		_c1 = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f2 != null && _f2.length > 0) {
		const _len = _f2.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f3 != null && _f3.length > 0) {
		const _len = _f3.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f4 != null && _f4.length > 0) {
		const _len = _f4.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f5 != null && _f5.length > 0) {
		const _len = _f5.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	const buf = size <= 64 ? new Uint8Array(size) : __allocate$88(size);
	let offset = 0;
	if (_f0 != null && _f0 !== "") {
		buf[offset++] = 10;
		const _len = _c0;
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
		offset = _len >= 128 ? __utf8WriteLong$87(buf, offset, _f0) : _len === _f0.length ? __asciiWrite$87(buf, offset, _f0) : __utf8Write$87(buf, offset, _f0);
	}
	if (_f1 != null && _f1 !== "") {
		buf[offset++] = 18;
		const _len = _c1;
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
		offset = _len >= 128 ? __utf8WriteLong$87(buf, offset, _f1) : _len === _f1.length ? __asciiWrite$87(buf, offset, _f1) : __utf8Write$87(buf, offset, _f1);
	}
	if (_f2 != null && _f2.length > 0) {
		buf[offset++] = 26;
		const _len = _f2.length;
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
		buf.set(_f2, offset);
		offset += _len;
	}
	if (_f3 != null && _f3.length > 0) {
		buf[offset++] = 34;
		const _len = _f3.length;
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
		buf.set(_f3, offset);
		offset += _len;
	}
	if (_f4 != null && _f4.length > 0) {
		buf[offset++] = 90;
		const _len = _f4.length;
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
		buf.set(_f4, offset);
		offset += _len;
	}
	if (_f5 != null && _f5.length > 0) {
		buf[offset++] = 98;
		const _len = _f5.length;
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
		buf.set(_f5, offset);
		offset += _len;
	}
	return buf;
}
function protobuf_decode_TextElem$5(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
	let _f4 = null;
	let _f5 = null;
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
				_f0 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 18: {
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
				_f1 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
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
				_f3 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 90: {
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
			case 98: {
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
				_f5 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"str": _f0,
		"link": _f1,
		"attr6Buf": _f2,
		"attr7Buf": _f3,
		"buf": _f4,
		"pbReserve": _f5
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
function protobuf_decode_FaceElem$5(data, offset = 0, end = data.length) {
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
				_f0 = _val | 0;
				break;
			}
			case 18: {
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
				_f1 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 90: {
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
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"index": _f0,
		"oldData": _f1,
		"buf": _f2
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
function protobuf_decode_OnlineImage$5(data, offset = 0, end = data.length) {
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
				_f0 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 18: {
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
				_f1 = data.slice(offset, offset + _len);
				offset += _len;
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
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"guid": _f0,
		"filePath": _f1,
		"oldVerSendFile": _f2
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
function protobuf_decode_NotOnlineImage$5(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
	let _f4 = null;
	let _f5 = null;
	let _f6 = null;
	let _f7 = null;
	let _f8 = null;
	let _f9 = null;
	let _f10 = null;
	let _f11 = null;
	let _f12 = null;
	let _f13 = null;
	let _f14 = null;
	let _f15 = null;
	let _f16 = null;
	let _f17 = null;
	let _f18 = null;
	let _f19 = null;
	let _f20 = null;
	let _f21 = null;
	let _f22 = null;
	let _f23 = null;
	let _f24 = null;
	let _f25 = null;
	let _f26 = null;
	let _f27 = null;
	let _f28 = null;
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
				_f0 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
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
				_f2 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
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
				_f3 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 40: {
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
				_f4 = _val | 0;
				break;
			}
			case 50: {
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
				_f5 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 58: {
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
				_f6 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 64: {
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
				_f7 = _val;
				break;
			}
			case 72: {
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
				_f8 = _val;
				break;
			}
			case 82: {
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
				_f9 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 90: {
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
				_f10 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 98: {
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
				_f11 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 104: {
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
				_f12 = _val | 0;
				break;
			}
			case 114: {
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
				_f13 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 122: {
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
				_f14 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 128: {
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
				_f15 = _val | 0;
				break;
			}
			case 136: {
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
				_f16 = _val | 0;
				break;
			}
			case 144: {
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
				_f17 = _val | 0;
				break;
			}
			case 154: {
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
				_f18 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 160: {
				if (offset >= end) throw new Error("Truncated protobuf varint");
				let _val = data[offset++];
				if (_val & 128) {
					let _s = 7, _b;
					_val &= 127;
					do {
						if (offset >= end) throw new Error("Truncated protobuf varint");
						_b = data[offset++];
						if (_s === 63 && _b > 1) throw new Error("Invalid protobuf varint");
						_val |= _b & 127;
						_s += 7;
					} while (_b & 128);
					_val >>>= 0;
				}
				_f19 = _val !== 0;
				break;
			}
			case 168: {
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
				_f20 = _val | 0;
				break;
			}
			case 176: {
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
				_f21 = _val | 0;
				break;
			}
			case 184: {
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
				_f22 = _val | 0;
				break;
			}
			case 192: {
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
				_f23 = _val;
				break;
			}
			case 200: {
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
				_f24 = _val;
				break;
			}
			case 210: {
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
				_f25 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 216: {
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
				_f26 = _val | 0;
				break;
			}
			case 224: {
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
				_f27 = _val | 0;
				break;
			}
			case 234: {
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
				_f28 = protobuf_decode_NotOnlineImagePbReserve$5(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"filePath": _f0,
		"fileLen": _f1,
		"downloadPath": _f2,
		"oldVerSendFile": _f3,
		"imgType": _f4,
		"previewsImage": _f5,
		"picMd5": _f6,
		"picHeight": _f7,
		"picWidth": _f8,
		"resId": _f9,
		"flag": _f10,
		"thumbUrl": _f11,
		"original": _f12,
		"bigUrl": _f13,
		"origUrl": _f14,
		"bizType": _f15,
		"result": _f16,
		"index": _f17,
		"opFaceBuf": _f18,
		"oldPicMd5": _f19,
		"thumbWidth": _f20,
		"thumbHeight": _f21,
		"fileId": _f22,
		"showLen": _f23,
		"downloadLen": _f24,
		"x400Url": _f25,
		"x400Width": _f26,
		"x400Height": _f27,
		"pbRes": _f28
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
function protobuf_decode_NotOnlineImagePbReserve$5(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
	let _f4 = null;
	let _f5 = null;
	let _f6 = null;
	let _f7 = null;
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
				_f0 = _val | 0;
				break;
			}
			case 24: {
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
				_f1 = _val | 0;
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
				_f2 = _val | 0;
				break;
			}
			case 66: {
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
				_f3 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 80: {
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
				_f4 = _val | 0;
				break;
			}
			case 162: {
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
				_f5 = protobuf_decode_NotOnlineImagePbReserve2$5(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 242: {
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
				_f6 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 250: {
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
				_f7 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"subType": _f0,
		"field3": _f1,
		"field4": _f2,
		"summary": _f3,
		"field10": _f4,
		"field20": _f5,
		"url": _f6,
		"md5Str": _f7
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
function protobuf_decode_NotOnlineImagePbReserve2$5(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
	let _f4 = null;
	let _f5 = null;
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
				_f0 = _val | 0;
				break;
			}
			case 18: {
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
				_f1 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 24: {
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
				_f2 = _val | 0;
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
				_f3 = _val | 0;
				break;
			}
			case 40: {
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
				_f4 = _val | 0;
				break;
			}
			case 58: {
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
				_f5 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"field1": _f0,
		"field2": _f1,
		"field3": _f2,
		"field4": _f3,
		"field5": _f4,
		"field7": _f5
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
function protobuf_decode_TransElem$5(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
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
				_f0 = _val | 0;
				break;
			}
			case 18: {
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
				_f1 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"elemType": _f0,
		"elemValue": _f1
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
function protobuf_decode_MarketFace$5(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
	let _f4 = null;
	let _f5 = null;
	let _f6 = null;
	let _f7 = null;
	let _f8 = null;
	let _f9 = null;
	let _f10 = null;
	let _f11 = null;
	let _f12 = null;
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
				_f0 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
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
			case 24: {
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
				_f2 = _val;
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
				_f3 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 40: {
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
				_f4 = _val;
				break;
			}
			case 48: {
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
				_f5 = _val;
				break;
			}
			case 58: {
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
				_f6 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 66: {
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
				_f7 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 72: {
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
				_f8 = _val;
				break;
			}
			case 80: {
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
				_f9 = _val;
				break;
			}
			case 88: {
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
				_f10 = _val;
				break;
			}
			case 98: {
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
				_f11 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 106: {
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
				_f12 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"faceName": _f0,
		"itemType": _f1,
		"faceInfo": _f2,
		"faceId": _f3,
		"tabId": _f4,
		"subType": _f5,
		"key": _f6,
		"param": _f7,
		"mediaType": _f8,
		"imageWidth": _f9,
		"imageHeight": _f10,
		"mobileParam": _f11,
		"pbReserve": _f12
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
function protobuf_decode_CustomFace$5(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
	let _f4 = null;
	let _f5 = null;
	let _f6 = null;
	let _f7 = null;
	let _f8 = null;
	let _f9 = null;
	let _f10 = null;
	let _f11 = null;
	let _f12 = null;
	let _f13 = null;
	let _f14 = null;
	let _f15 = null;
	let _f16 = null;
	let _f17 = null;
	let _f18 = null;
	let _f19 = null;
	let _f20 = null;
	let _f21 = null;
	let _f22 = null;
	let _f23 = null;
	let _f24 = null;
	let _f25 = null;
	let _f26 = null;
	let _f27 = null;
	let _f28 = null;
	let _f29 = null;
	let _f30 = null;
	let _f31 = null;
	let _f32 = null;
	let _f33 = null;
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
				_f0 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 18: {
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
				_f1 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
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
				_f2 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
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
				_f3 = data.slice(offset, offset + _len);
				offset += _len;
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
			case 50: {
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
				_f5 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 56: {
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
				_f6 = _val;
				break;
			}
			case 64: {
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
				_f7 = _val | 0;
				break;
			}
			case 72: {
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
				_f8 = _val | 0;
				break;
			}
			case 80: {
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
				_f9 = _val | 0;
				break;
			}
			case 90: {
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
				_f10 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 96: {
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
				_f11 = _val | 0;
				break;
			}
			case 106: {
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
				_f12 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 114: {
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
				_f13 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 122: {
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
				_f14 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 130: {
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
				_f15 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 136: {
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
				_f16 = _val | 0;
				break;
			}
			case 144: {
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
				_f17 = _val | 0;
				break;
			}
			case 152: {
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
				_f18 = _val | 0;
				break;
			}
			case 160: {
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
				_f19 = _val | 0;
				break;
			}
			case 168: {
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
				_f20 = _val | 0;
				break;
			}
			case 176: {
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
				_f21 = _val | 0;
				break;
			}
			case 184: {
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
				_f22 = _val | 0;
				break;
			}
			case 192: {
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
				_f23 = _val | 0;
				break;
			}
			case 200: {
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
				_f24 = _val;
				break;
			}
			case 208: {
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
				_f25 = _val | 0;
				break;
			}
			case 216: {
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
				_f26 = _val | 0;
				break;
			}
			case 224: {
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
				_f27 = _val | 0;
				break;
			}
			case 232: {
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
				_f28 = _val | 0;
				break;
			}
			case 240: {
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
				_f29 = _val | 0;
				break;
			}
			case 250: {
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
				_f30 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 256: {
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
				_f31 = _val | 0;
				break;
			}
			case 264: {
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
				_f32 = _val | 0;
				break;
			}
			case 274: {
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
				_f33 = protobuf_decode_CustomFacePbReserve$5(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"guid": _f0,
		"filePath": _f1,
		"shortcut": _f2,
		"buffer": _f3,
		"flag": _f4,
		"oldData": _f5,
		"fileId": _f6,
		"serverIp": _f7,
		"serverPort": _f8,
		"fileType": _f9,
		"signature": _f10,
		"useful": _f11,
		"md5": _f12,
		"thumbUrl": _f13,
		"bigUrl": _f14,
		"origUrl": _f15,
		"bizType": _f16,
		"repeatIndex": _f17,
		"repeatImage": _f18,
		"imageType": _f19,
		"index": _f20,
		"width": _f21,
		"height": _f22,
		"source": _f23,
		"size": _f24,
		"origin": _f25,
		"thumbWidth": _f26,
		"thumbHeight": _f27,
		"showLen": _f28,
		"downloadLen": _f29,
		"x400Url": _f30,
		"x400Width": _f31,
		"x400Height": _f32,
		"pbRes": _f33
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
function protobuf_decode_CustomFacePbReserve$5(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
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
				_f0 = _val | 0;
				break;
			}
			case 74: {
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
				_f1 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"subType": _f0,
		"summary": _f1
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
function protobuf_decode_RichMsg$5(data, offset = 0, end = data.length) {
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
				_f0 = data.slice(offset, offset + _len);
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
				_f1 = _val | 0;
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
				_f3 = _val | 0;
				break;
			}
			case 40: {
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
				_f4 = _val;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"template1": _f0,
		"serviceId": _f1,
		"msgResId": _f2,
		"rand": _f3,
		"seq": _f4
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
function protobuf_decode_GroupFileElem$5(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
	let _f4 = null;
	let _f5 = null;
	let _f6 = null;
	let _f7 = null;
	let _f8 = null;
	let _f9 = null;
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
				_f0 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 16: {
				let _lo = 0, _hi = 0, _s = 0, _b;
				do {
					if (offset >= end) throw new Error("Truncated protobuf varint");
					_b = data[offset++];
					if (_s === 63 && _b > 1) throw new Error("Invalid protobuf varint");
					if (_s < 28) _lo |= (_b & 127) << _s;
					else if (_s === 28) {
						_lo |= (_b & 127) << 28;
						_hi = (_b & 127) >>> 4;
					} else _hi |= (_b & 127) << _s - 32;
					_s += 7;
				} while (_b & 128);
				_f1 = _hi === 0 ? BigInt(_lo >>> 0) : BigInt(_lo >>> 0) | BigInt(_hi >>> 0) << 32n;
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
				_f2 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
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
				_f3 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
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
				_f4 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 50: {
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
				_f5 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 56: {
				let _lo = 0, _hi = 0, _s = 0, _b;
				do {
					if (offset >= end) throw new Error("Truncated protobuf varint");
					_b = data[offset++];
					if (_s === 63 && _b > 1) throw new Error("Invalid protobuf varint");
					if (_s < 28) _lo |= (_b & 127) << _s;
					else if (_s === 28) {
						_lo |= (_b & 127) << 28;
						_hi = (_b & 127) >>> 4;
					} else _hi |= (_b & 127) << _s - 32;
					_s += 7;
				} while (_b & 128);
				_f6 = _hi === 0 ? BigInt(_lo >>> 0) : BigInt(_lo >>> 0) | BigInt(_hi >>> 0) << 32n;
				break;
			}
			case 66: {
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
				_f7 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 72: {
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
				_f8 = _val | 0;
				break;
			}
			case 82: {
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
				_f9 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"filename": _f0,
		"fileSize": _f1,
		"fileId": _f2,
		"batchId": _f3,
		"fileKey": _f4,
		"mark": _f5,
		"sequence": _f6,
		"batchItemId": _f7,
		"feedMsgTime": _f8,
		"pbReserve": _f9
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
function protobuf_decode_ExtraInfo$5(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
	let _f4 = null;
	let _f5 = null;
	let _f6 = null;
	let _f7 = null;
	let _f8 = null;
	let _f9 = null;
	let _f10 = null;
	let _f11 = null;
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
				_f0 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 18: {
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
				_f1 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 24: {
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
				_f2 = _val | 0;
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
				_f3 = _val | 0;
				break;
			}
			case 40: {
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
				_f4 = _val | 0;
				break;
			}
			case 48: {
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
				_f5 = _val | 0;
				break;
			}
			case 58: {
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
				_f6 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 66: {
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
				_f7 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 72: {
				let _lo = 0, _hi = 0, _s = 0, _b;
				do {
					if (offset >= end) throw new Error("Truncated protobuf varint");
					_b = data[offset++];
					if (_s === 63 && _b > 1) throw new Error("Invalid protobuf varint");
					if (_s < 28) _lo |= (_b & 127) << _s;
					else if (_s === 28) {
						_lo |= (_b & 127) << 28;
						_hi = (_b & 127) >>> 4;
					} else _hi |= (_b & 127) << _s - 32;
					_s += 7;
				} while (_b & 128);
				_f8 = _hi === 0 ? BigInt(_lo >>> 0) : BigInt(_lo >>> 0) | BigInt(_hi >>> 0) << 32n;
				break;
			}
			case 80: {
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
				_f9 = _val | 0;
				break;
			}
			case 88: {
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
				_f10 = _val | 0;
				break;
			}
			case 96: {
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
				_f11 = _val | 0;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"nick": _f0,
		"groupCard": _f1,
		"level": _f2,
		"flags": _f3,
		"groupMask": _f4,
		"msgTailId": _f5,
		"senderTitle": _f6,
		"apnsTips": _f7,
		"uin": _f8,
		"msgStateFlag": _f9,
		"apnsSoundType": _f10,
		"newGroupFlag": _f11
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
function protobuf_decode_VideoFile$5(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
	let _f4 = null;
	let _f5 = null;
	let _f6 = null;
	let _f7 = null;
	let _f8 = null;
	let _f9 = null;
	let _f10 = null;
	let _f11 = null;
	let _f12 = null;
	let _f13 = null;
	let _f14 = null;
	let _f15 = null;
	let _f16 = null;
	let _f17 = null;
	let _f18 = null;
	let _f19 = null;
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
				_f0 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 18: {
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
				_f1 = data.slice(offset, offset + _len);
				offset += _len;
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
				_f2 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
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
				_f3 = _val | 0;
				break;
			}
			case 40: {
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
				_f4 = _val | 0;
				break;
			}
			case 48: {
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
				_f5 = _val | 0;
				break;
			}
			case 56: {
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
				_f6 = _val | 0;
				break;
			}
			case 64: {
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
				_f7 = _val | 0;
				break;
			}
			case 74: {
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
				_f8 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 82: {
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
				_f9 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 88: {
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
				_f10 = _val | 0;
				break;
			}
			case 96: {
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
				_f11 = _val | 0;
				break;
			}
			case 104: {
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
				_f12 = _val | 0;
				break;
			}
			case 112: {
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
				_f13 = _val | 0;
				break;
			}
			case 120: {
				if (offset >= end) throw new Error("Truncated protobuf varint");
				let _val = data[offset++];
				if (_val & 128) {
					let _s = 7, _b;
					_val &= 127;
					do {
						if (offset >= end) throw new Error("Truncated protobuf varint");
						_b = data[offset++];
						if (_s === 63 && _b > 1) throw new Error("Invalid protobuf varint");
						_val |= _b & 127;
						_s += 7;
					} while (_b & 128);
					_val >>>= 0;
				}
				_f14 = _val !== 0;
				break;
			}
			case 128: {
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
				_f15 = _val | 0;
				break;
			}
			case 136: {
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
				_f16 = _val | 0;
				break;
			}
			case 144: {
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
				_f17 = _val | 0;
				break;
			}
			case 152: {
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
				_f18 = _val | 0;
				break;
			}
			case 194: {
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
				_f19 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"fileUuid": _f0,
		"fileMd5": _f1,
		"fileName": _f2,
		"fileFormat": _f3,
		"fileTime": _f4,
		"fileSize": _f5,
		"thumbWidth": _f6,
		"thumbHeight": _f7,
		"thumbFileMd5": _f8,
		"source": _f9,
		"thumbFileSize": _f10,
		"busiType": _f11,
		"fromChatType": _f12,
		"toChatType": _f13,
		"supportProgressive": _f14,
		"fileWidth": _f15,
		"fileHeight": _f16,
		"subBusiType": _f17,
		"videoAttr": _f18,
		"pbReserve": _f19
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
function protobuf_decode_GeneralFlags$5(data, offset = 0, end = data.length) {
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
				_f0 = _val | 0;
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
				_f1 = _val | 0;
				break;
			}
			case 24: {
				let _lo = 0, _hi = 0, _s = 0, _b;
				do {
					if (offset >= end) throw new Error("Truncated protobuf varint");
					_b = data[offset++];
					if (_s === 63 && _b > 1) throw new Error("Invalid protobuf varint");
					if (_s < 28) _lo |= (_b & 127) << _s;
					else if (_s === 28) {
						_lo |= (_b & 127) << 28;
						_hi = (_b & 127) >>> 4;
					} else _hi |= (_b & 127) << _s - 32;
					_s += 7;
				} while (_b & 128);
				_f2 = _hi === 0 ? BigInt(_lo >>> 0) : BigInt(_lo >>> 0) | BigInt(_hi >>> 0) << 32n;
				break;
			}
			case 48: {
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
				_f3 = _val | 0;
				break;
			}
			case 58: {
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
				_f4 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"bubbleDiyTextId": _f0,
		"groupFlagNew": _f1,
		"uin": _f2,
		"longTextFlag": _f3,
		"longTextResId": _f4
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
function protobuf_decode_SrcMsg$5(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	const _f0 = [];
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
	const _f4 = [];
	let _f5 = null;
	let _f6 = null;
	let _f7 = null;
	let _f8 = null;
	let _f9 = null;
	let _f10 = null;
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
				_f0.push(_val);
				break;
			}
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
				const _packedEnd = offset + _len;
				while (offset < _packedEnd) {
					if (offset >= _packedEnd) throw new Error("Truncated protobuf varint");
					let _val = data[offset++];
					if (_val & 128) {
						let _s = 7, _b;
						_val &= 127;
						do {
							if (offset >= _packedEnd) throw new Error("Truncated protobuf varint");
							_b = data[offset++];
							if (_s === 63 && _b > 1) throw new Error("Invalid protobuf varint");
							if (_s < 32) _val |= (_b & 127) << _s;
							_s += 7;
						} while (_b & 128);
						_val >>>= 0;
					}
					_f0.push(_val);
				}
				break;
			}
			case 16: {
				let _lo = 0, _hi = 0, _s = 0, _b;
				do {
					if (offset >= end) throw new Error("Truncated protobuf varint");
					_b = data[offset++];
					if (_s === 63 && _b > 1) throw new Error("Invalid protobuf varint");
					if (_s < 28) _lo |= (_b & 127) << _s;
					else if (_s === 28) {
						_lo |= (_b & 127) << 28;
						_hi = (_b & 127) >>> 4;
					} else _hi |= (_b & 127) << _s - 32;
					_s += 7;
				} while (_b & 128);
				_f1 = _hi === 0 ? BigInt(_lo >>> 0) : BigInt(_lo >>> 0) | BigInt(_hi >>> 0) << 32n;
				break;
			}
			case 24: {
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
				_f2 = _val | 0;
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
				_f3 = _val | 0;
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
				_f4.push(data.slice(offset, offset + _len));
				offset += _len;
				break;
			}
			case 48: {
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
				_f5 = _val | 0;
				break;
			}
			case 58: {
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
				_f6 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 66: {
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
				_f7 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 74: {
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
				_f8 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 80: {
				let _lo = 0, _hi = 0, _s = 0, _b;
				do {
					if (offset >= end) throw new Error("Truncated protobuf varint");
					_b = data[offset++];
					if (_s === 63 && _b > 1) throw new Error("Invalid protobuf varint");
					if (_s < 28) _lo |= (_b & 127) << _s;
					else if (_s === 28) {
						_lo |= (_b & 127) << 28;
						_hi = (_b & 127) >>> 4;
					} else _hi |= (_b & 127) << _s - 32;
					_s += 7;
				} while (_b & 128);
				_f9 = _hi === 0 ? BigInt(_lo >>> 0) : BigInt(_lo >>> 0) | BigInt(_hi >>> 0) << 32n;
				break;
			}
			case 90: {
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
				_f10 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"origSeqs": _f0,
		"senderUin": _f1,
		"time": _f2,
		"flag": _f3,
		"elemsRaw": _f4,
		"type": _f5,
		"richMsg": _f6,
		"pbReserve": _f7,
		"sourceMsg": _f8,
		"toUin": _f9,
		"troopName": _f10
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
function protobuf_decode_LightAppElem$5(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
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
				_f0 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 18: {
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
				_f1 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"data": _f0,
		"msgResid": _f1
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
function protobuf_decode_CommonElem$5(data, offset = 0, end = data.length) {
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
				_f0 = _val | 0;
				break;
			}
			case 18: {
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
				_f1 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 24: {
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
				_f2 = _val;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"serviceType": _f0,
		"pbElem": _f1,
		"businessType": _f2
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
function protobuf_decode_NotOnlineFile$5(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
	let _f4 = null;
	let _f5 = null;
	let _f6 = null;
	let _f7 = null;
	let _f8 = null;
	let _f9 = null;
	let _f10 = null;
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
				_f1 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
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
				_f2 = data.slice(offset, offset + _len);
				offset += _len;
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
				_f3 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 48: {
				let _lo = 0, _hi = 0, _s = 0, _b;
				do {
					if (offset >= end) throw new Error("Truncated protobuf varint");
					_b = data[offset++];
					if (_s === 63 && _b > 1) throw new Error("Invalid protobuf varint");
					if (_s < 28) _lo |= (_b & 127) << _s;
					else if (_s === 28) {
						_lo |= (_b & 127) << 28;
						_hi = (_b & 127) >>> 4;
					} else _hi |= (_b & 127) << _s - 32;
					_s += 7;
				} while (_b & 128);
				_f4 = _hi === 0 ? BigInt(_lo >>> 0) : BigInt(_lo >>> 0) | BigInt(_hi >>> 0) << 32n;
				break;
			}
			case 72: {
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
				_f5 = _val;
				break;
			}
			case 96: {
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
				_f6 = _val;
				break;
			}
			case 400: {
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
				_f7 = _val;
				break;
			}
			case 440: {
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
				_f8 = _val;
				break;
			}
			case 450: {
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
				_f9 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 458: {
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
				_f10 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"fileType": _f0,
		"fileUuid": _f1,
		"fileMd5": _f2,
		"fileName": _f3,
		"fileSize": _f4,
		"subcmd": _f5,
		"downloadFlag": _f6,
		"dangerEvel": _f7,
		"expireTime": _f8,
		"pbReserve": _f9,
		"fileHash": _f10
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
function protobuf_decode_Ptt$5(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
	let _f4 = null;
	let _f5 = null;
	let _f6 = null;
	let _f7 = null;
	let _f8 = null;
	let _f9 = null;
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
			case 16: {
				let _lo = 0, _hi = 0, _s = 0, _b;
				do {
					if (offset >= end) throw new Error("Truncated protobuf varint");
					_b = data[offset++];
					if (_s === 63 && _b > 1) throw new Error("Invalid protobuf varint");
					if (_s < 28) _lo |= (_b & 127) << _s;
					else if (_s === 28) {
						_lo |= (_b & 127) << 28;
						_hi = (_b & 127) >>> 4;
					} else _hi |= (_b & 127) << _s - 32;
					_s += 7;
				} while (_b & 128);
				_f1 = _hi === 0 ? BigInt(_lo >>> 0) : BigInt(_lo >>> 0) | BigInt(_hi >>> 0) << 32n;
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
				_f3 = data.slice(offset, offset + _len);
				offset += _len;
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
				_f4 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 48: {
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
				_f5 = _val;
				break;
			}
			case 82: {
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
				_f6 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 114: {
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
				_f7 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 152: {
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
				_f8 = _val;
				break;
			}
			case 232: {
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
				_f9 = _val;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"fileType": _f0,
		"fileId": _f1,
		"fileUuid": _f2,
		"fileMd5": _f3,
		"fileName": _f4,
		"fileSize": _f5,
		"groupFileKey": _f6,
		"fileKey": _f7,
		"time": _f8,
		"format": _f9
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
function protobuf_decode_FileExtra(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
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
				_f0 = protobuf_decode_NotOnlineFile$5(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 50: {
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
				_f1 = protobuf_decode_PrivateFileExtra(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"file": _f0,
		"field6": _f1
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
function protobuf_decode_PrivateFileExtra(data, offset = 0, end = data.length) {
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
			case 18: {
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
				_f0 = protobuf_decode_PrivateFileExtraField2(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
	const _result = { "field2": _f0 };
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
function protobuf_decode_PrivateFileExtraField2(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
	let _f4 = null;
	let _f5 = null;
	let _f6 = null;
	let _f7 = null;
	let _f8 = null;
	let _f9 = null;
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
				_f1 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
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
				_f2 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 48: {
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
			case 58: {
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
			case 66: {
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
				_f5 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 72: {
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
				_f6 = _val;
				break;
			}
			case 114: {
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
				_f7 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 122: {
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
				_f8 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 130: {
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
				_f9 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"field1": _f0,
		"fileUuid": _f1,
		"fileName": _f2,
		"field6": _f3,
		"field7": _f4,
		"field8": _f5,
		"timestamp1": _f6,
		"fileHash": _f7,
		"selfUid": _f8,
		"destUid": _f9
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
function protobuf_decode_IndexNode(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
	let _f4 = null;
	let _f5 = null;
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
				_f0 = protobuf_decode_FileInfo(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 18: {
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
				_f1 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 24: {
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
				_f2 = _val;
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
			case 40: {
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
				_f4 = _val;
				break;
			}
			case 48: {
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
				_f5 = _val;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"info": _f0,
		"fileUuid": _f1,
		"storeId": _f2,
		"uploadTime": _f3,
		"ttl": _f4,
		"subType": _f5
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
function protobuf_decode_FileInfo(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
	let _f4 = null;
	let _f5 = null;
	let _f6 = null;
	let _f7 = null;
	let _f8 = null;
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
			case 18: {
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
				_f1 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
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
				_f2 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
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
				_f3 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
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
				_f4 = protobuf_decode_FileType(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 48: {
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
				_f5 = _val;
				break;
			}
			case 56: {
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
				_f6 = _val;
				break;
			}
			case 64: {
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
				_f7 = _val;
				break;
			}
			case 72: {
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
				_f8 = _val;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"fileSize": _f0,
		"fileHash": _f1,
		"fileSha1": _f2,
		"fileName": _f3,
		"type": _f4,
		"width": _f5,
		"height": _f6,
		"time": _f7,
		"original": _f8
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
function protobuf_decode_FileType(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
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
			case 24: {
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
				_f2 = _val;
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
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"type": _f0,
		"picFormat": _f1,
		"videoFormat": _f2,
		"voiceFormat": _f3
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
function protobuf_decode_PictureInfo(data, offset = 0, end = data.length) {
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
				_f0 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 18: {
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
				_f1 = protobuf_decode_PicUrlExtInfo(data, offset, offset + _len);
				offset += _len;
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
				_f2 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"urlPath": _f0,
		"ext": _f1,
		"domain": _f2
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
function protobuf_decode_PicUrlExtInfo(data, offset = 0, end = data.length) {
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
				_f0 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 18: {
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
				_f1 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
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
				_f2 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"originalParameter": _f0,
		"bigParameter": _f1,
		"thumbParameter": _f2
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
function protobuf_decode_HashSum(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
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
			case 1610: {
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
				_f0 = protobuf_decode_C2cSource(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 1618: {
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
				_f1 = protobuf_decode_TroopSource(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"bytesPbReserveC2c": _f0,
		"troopSource": _f1
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
function protobuf_decode_C2cSource(data, offset = 0, end = data.length) {
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
			case 18: {
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
				_f0 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
	const _result = { "friendUid": _f0 };
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
function protobuf_decode_TroopSource(data, offset = 0, end = data.length) {
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
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
	const _result = { "groupUin": _f0 };
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
function protobuf_decode_PicExtBizInfo(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
	let _f4 = null;
	let _f5 = null;
	let _f6 = null;
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
			case 18: {
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
				_f1 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 90: {
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
			case 98: {
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
				_f3 = protobuf_decode_PicExtData(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 8008: {
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
				_f4 = _val;
				break;
			}
			case 8016: {
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
				_f5 = _val;
				break;
			}
			case 8024: {
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
				_f6 = _val;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"bizType": _f0,
		"textSummary": _f1,
		"bytesPbReserveC2c": _f2,
		"extData": _f3,
		"fromScene": _f4,
		"toScene": _f5,
		"oldFileId": _f6
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
function protobuf_decode_PicExtData(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
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
			case 74: {
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
				_f1 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"subType": _f0,
		"textSummary": _f1
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
function protobuf_decode_VideoExtBizInfo(data, offset = 0, end = data.length) {
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
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"fromScene": _f0,
		"toScene": _f1,
		"bytesPbReserve": _f2
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
function protobuf_decode_PttExtBizInfo(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
	let _f4 = null;
	let _f5 = null;
	let _f6 = null;
	let _f7 = null;
	let _f8 = null;
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
				let _lo = 0, _hi = 0, _s = 0, _b;
				do {
					if (offset >= end) throw new Error("Truncated protobuf varint");
					_b = data[offset++];
					if (_s === 63 && _b > 1) throw new Error("Invalid protobuf varint");
					if (_s < 28) _lo |= (_b & 127) << _s;
					else if (_s === 28) {
						_lo |= (_b & 127) << 28;
						_hi = (_b & 127) >>> 4;
					} else _hi |= (_b & 127) << _s - 32;
					_s += 7;
				} while (_b & 128);
				_f0 = _hi === 0 ? BigInt(_lo >>> 0) : BigInt(_lo >>> 0) | BigInt(_hi >>> 0) << 32n;
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
			case 24: {
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
				_f2 = _val;
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
			case 48: {
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
				_f5 = _val;
				break;
			}
			case 90: {
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
				_f6 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 98: {
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
				_f7 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 106: {
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
				_f8 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"srcUin": _f0,
		"pttScene": _f1,
		"pttType": _f2,
		"changeVoice": _f3,
		"waveform": _f4,
		"autoConvertText": _f5,
		"bytesReserve": _f6,
		"bytesPbReserve": _f7,
		"bytesGeneralFlags": _f8
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
function protobuf_decode_QFaceExtra(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
	let _f4 = null;
	let _f5 = null;
	let _f6 = null;
	let _f7 = null;
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
				_f0 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 18: {
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
				_f1 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 24: {
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
				_f2 = _val | 0;
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
				_f3 = _val | 0;
				break;
			}
			case 40: {
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
				_f4 = _val | 0;
				break;
			}
			case 50: {
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
				_f5 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 58: {
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
				_f6 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 72: {
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
				_f7 = _val | 0;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"packId": _f0,
		"stickerId": _f1,
		"qsid": _f2,
		"sourceType": _f3,
		"stickerType": _f4,
		"resultId": _f5,
		"text": _f6,
		"randomType": _f7
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
function protobuf_decode_MarkdownData(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
	let _f4 = null;
	let _f5 = null;
	let _f6 = null;
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
				_f0 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 18: {
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
				_f1 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
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
				_f3 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
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
				_f4 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 48: {
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
				_f5 = _val;
				break;
			}
			case 58: {
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
				_f6 = protobuf_decode_MarkdownFlashTransferExt(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"content": _f0,
		"field2": _f1,
		"field3": _f2,
		"processMsg": _f3,
		"summary": _f4,
		"extType": _f5,
		"extInfo": _f6
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
function protobuf_decode_MarkdownFlashTransferExt(data, offset = 0, end = data.length) {
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
				_f0 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 18: {
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
				_f1 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 24: {
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
				_f2 = _val;
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
				_f3 = protobuf_decode_MarkdownFlashTransferThumb(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 48: {
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
				_f4 = _val;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"filesetId": _f0,
		"name": _f1,
		"fileSize": _f2,
		"thumbnail": _f3,
		"expireTime": _f4
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
function protobuf_decode_MarkdownFlashTransferThumb(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
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
				_f0 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 18: {
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
				_f1 = protobuf_decode_MarkdownFlashTransferThumbUrl(data, offset, offset + _len);
				offset += _len;
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
				_f2 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
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
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"fileId": _f0,
		"download": _f1,
		"sha1": _f2,
		"field4": _f3
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
function protobuf_decode_MarkdownFlashTransferThumbUrl(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
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
			case 18: {
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
				_f1 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"field1": _f0,
		"downloadUrl": _f1
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
function protobuf_decode_InlineKeyboardExtra(data, offset = 0, end = data.length) {
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
				_f0 = protobuf_decode_InlineKeyboardData(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
	const _result = { "keyboard": _f0 };
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
function protobuf_decode_InlineKeyboardData(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	const _f0 = [];
	let _f1 = null;
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
				_f0.push(protobuf_decode_InlineKeyboardRow(data, offset, offset + _len));
				offset += _len;
				break;
			}
			case 16: {
				let _lo = 0, _hi = 0, _s = 0, _b;
				do {
					if (offset >= end) throw new Error("Truncated protobuf varint");
					_b = data[offset++];
					if (_s === 63 && _b > 1) throw new Error("Invalid protobuf varint");
					if (_s < 28) _lo |= (_b & 127) << _s;
					else if (_s === 28) {
						_lo |= (_b & 127) << 28;
						_hi = (_b & 127) >>> 4;
					} else _hi |= (_b & 127) << _s - 32;
					_s += 7;
				} while (_b & 128);
				_f1 = _hi === 0 ? BigInt(_lo >>> 0) : BigInt(_lo >>> 0) | BigInt(_hi >>> 0) << 32n;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"rows": _f0,
		"botAppid": _f1
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
function protobuf_decode_InlineKeyboardRow(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	const _f0 = [];
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
				_f0.push(protobuf_decode_InlineKeyboardButton(data, offset, offset + _len));
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
	const _result = { "buttons": _f0 };
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
function protobuf_decode_InlineKeyboardButton(data, offset = 0, end = data.length) {
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
				_f0 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 18: {
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
				_f1 = protobuf_decode_InlineKeyboardRenderData(data, offset, offset + _len);
				offset += _len;
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
				_f2 = protobuf_decode_InlineKeyboardAction(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"id": _f0,
		"renderData": _f1,
		"action": _f2
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
function protobuf_decode_InlineKeyboardRenderData(data, offset = 0, end = data.length) {
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
				_f0 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 18: {
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
				_f1 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 24: {
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
				_f2 = _val;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"label": _f0,
		"visitedLabel": _f1,
		"style": _f2
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
function protobuf_decode_InlineKeyboardAction(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
	let _f4 = null;
	let _f5 = null;
	let _f6 = null;
	let _f7 = null;
	let _f8 = null;
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
			case 18: {
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
				_f1 = protobuf_decode_InlineKeyboardPermission(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 24: {
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
				_f2 = _val;
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
				_f3 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
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
				_f4 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 48: {
				if (offset >= end) throw new Error("Truncated protobuf varint");
				let _val = data[offset++];
				if (_val & 128) {
					let _s = 7, _b;
					_val &= 127;
					do {
						if (offset >= end) throw new Error("Truncated protobuf varint");
						_b = data[offset++];
						if (_s === 63 && _b > 1) throw new Error("Invalid protobuf varint");
						_val |= _b & 127;
						_s += 7;
					} while (_b & 128);
					_val >>>= 0;
				}
				_f5 = _val !== 0;
				break;
			}
			case 56: {
				if (offset >= end) throw new Error("Truncated protobuf varint");
				let _val = data[offset++];
				if (_val & 128) {
					let _s = 7, _b;
					_val &= 127;
					do {
						if (offset >= end) throw new Error("Truncated protobuf varint");
						_b = data[offset++];
						if (_s === 63 && _b > 1) throw new Error("Invalid protobuf varint");
						_val |= _b & 127;
						_s += 7;
					} while (_b & 128);
					_val >>>= 0;
				}
				_f6 = _val !== 0;
				break;
			}
			case 64: {
				if (offset >= end) throw new Error("Truncated protobuf varint");
				let _val = data[offset++];
				if (_val & 128) {
					let _s = 7, _b;
					_val &= 127;
					do {
						if (offset >= end) throw new Error("Truncated protobuf varint");
						_b = data[offset++];
						if (_s === 63 && _b > 1) throw new Error("Invalid protobuf varint");
						_val |= _b & 127;
						_s += 7;
					} while (_b & 128);
					_val >>>= 0;
				}
				_f7 = _val !== 0;
				break;
			}
			case 72: {
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
				_f8 = _val;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"type": _f0,
		"permission": _f1,
		"clickLimit": _f2,
		"unsupportedTips": _f3,
		"data": _f4,
		"atBotShowChannelList": _f5,
		"reply": _f6,
		"enter": _f7,
		"anchor": _f8
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
function protobuf_decode_InlineKeyboardPermission(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	const _f1 = [];
	const _f2 = [];
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
			case 18: {
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
				_f1.push(_len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len));
				offset += _len;
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
				_f2.push(_len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len));
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"type": _f0,
		"specifyRoleIds": _f1,
		"specifyUserIds": _f2
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
function protobuf_decode_MentionExtra(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
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
			case 24: {
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
				_f0 = _val | 0;
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
				_f1 = _val;
				break;
			}
			case 40: {
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
				_f2 = _val | 0;
				break;
			}
			case 74: {
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
				_f3 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"type": _f0,
		"uin": _f1,
		"field5": _f2,
		"uid": _f3
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
function protobuf_decode_GroupFileExtra(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
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
			case 18: {
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
				_f1 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
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
				_f2 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 58: {
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
				_f3 = protobuf_decode_GroupFileExtraInner(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"field1": _f0,
		"fileName": _f1,
		"display": _f2,
		"inner": _f3
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
function protobuf_decode_GroupFileExtraInner(data, offset = 0, end = data.length) {
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
			case 18: {
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
				_f0 = protobuf_decode_GroupFileInfo(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
	const _result = { "info": _f0 };
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
function protobuf_decode_GroupFileInfo(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
	let _f4 = null;
	let _f5 = null;
	let _f6 = null;
	let _f7 = null;
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
			case 18: {
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
				_f1 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 24: {
				let _lo = 0, _hi = 0, _s = 0, _b;
				do {
					if (offset >= end) throw new Error("Truncated protobuf varint");
					_b = data[offset++];
					if (_s === 63 && _b > 1) throw new Error("Invalid protobuf varint");
					if (_s < 28) _lo |= (_b & 127) << _s;
					else if (_s === 28) {
						_lo |= (_b & 127) << 28;
						_hi = (_b & 127) >>> 4;
					} else _hi |= (_b & 127) << _s - 32;
					_s += 7;
				} while (_b & 128);
				_f2 = _hi === 0 ? BigInt(_lo >>> 0) : BigInt(_lo >>> 0) | BigInt(_hi >>> 0) << 32n;
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
				_f3 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 40: {
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
				_f4 = _val;
				break;
			}
			case 50: {
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
				_f5 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			case 58: {
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
				_f6 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 66: {
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
				_f7 = data.slice(offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"busId": _f0,
		"fileId": _f1,
		"fileSize": _f2,
		"fileName": _f3,
		"field5": _f4,
		"fileSha": _f5,
		"extInfoString": _f6,
		"fileMd5": _f7
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
function protobuf_decode_MsgInfo(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	const _f0 = [];
	let _f1 = null;
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
				_f0.push(protobuf_decode_MsgInfoBody(data, offset, offset + _len));
				offset += _len;
				break;
			}
			case 18: {
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
				_f1 = protobuf_decode_ExtBizInfo(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"msgInfoBody": _f0,
		"extBizInfo": _f1
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
function protobuf_decode_MsgInfoBody(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
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
				_f0 = protobuf_decode_IndexNode(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 18: {
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
				_f1 = protobuf_decode_PictureInfo(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 40: {
				if (offset >= end) throw new Error("Truncated protobuf varint");
				let _val = data[offset++];
				if (_val & 128) {
					let _s = 7, _b;
					_val &= 127;
					do {
						if (offset >= end) throw new Error("Truncated protobuf varint");
						_b = data[offset++];
						if (_s === 63 && _b > 1) throw new Error("Invalid protobuf varint");
						_val |= _b & 127;
						_s += 7;
					} while (_b & 128);
					_val >>>= 0;
				}
				_f2 = _val !== 0;
				break;
			}
			case 50: {
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
				_f3 = protobuf_decode_HashSum(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"index": _f0,
		"picture": _f1,
		"fileExist": _f2,
		"hashSum": _f3
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
function protobuf_decode_ExtBizInfo(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
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
				_f0 = protobuf_decode_PicExtBizInfo(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 18: {
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
				_f1 = protobuf_decode_VideoExtBizInfo(data, offset, offset + _len);
				offset += _len;
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
				_f2 = protobuf_decode_PttExtBizInfo(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 80: {
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
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"pic": _f0,
		"video": _f1,
		"ptt": _f2,
		"busiType": _f3
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
function protobuf_decode_QSmallFaceExtra(data, offset = 0, end = data.length) {
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
			case 18: {
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
				_f1 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
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
				_f2 = _len <= 32 ? __utf8Read$91(data, offset, offset + _len) : __utf8ReadLong$91(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$92(data, offset, end, wireType, _tag >>> 3);
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
		"faceId": _f0,
		"preview": _f1,
		"preview2": _f2
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
var unknownElementLog = createLogger("MsgPush.UnknownElement");
var DECODED_WIRE_FIELDS = /* @__PURE__ */ new Set([
	"text",
	"face",
	"notOnlineImage",
	"transElem",
	"marketFace",
	"customFace",
	"richMsg",
	"groupFile",
	"videoFile",
	"srcMsg",
	"lightApp",
	"commonElem",
	"extraInfo",
	"generalFlags"
]);
var METADATA_WIRE_FIELDS = /* @__PURE__ */ new Set(["extraInfo", "generalFlags"]);
function invalidCard(inputBytes, error, budgetBytes = 0) {
	return {
		element: null,
		error,
		inputBytes,
		budgetBytes
	};
}
function decodeCardData(data, remainingOutputBytes) {
	if (remainingOutputBytes <= 0) return {
		ok: false,
		reason: "message_output_budget_exceeded",
		budgetBytes: 0
	};
	const limit = Math.min(MAX_RICH_CARD_OUTPUT_BYTES, remainingOutputBytes);
	const decoded = decompressData(data, limit);
	if (!decoded.ok && decoded.reason === "output_limit_exceeded" && limit < 4194304) return {
		ok: false,
		reason: "message_output_budget_exceeded",
		budgetBytes: limit
	};
	if (!decoded.ok) return {
		...decoded,
		budgetBytes: decoded.reason === "output_limit_exceeded" ? limit : 0
	};
	return {
		...decoded,
		budgetBytes: decoded.outputBytes
	};
}
var MULTI_MSG_FILE_NAME_PATTERN = /^MultiMsg_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isXmlCardContent(content) {
	const trimmed = content.trim();
	return trimmed.startsWith("<") && trimmed.endsWith(">");
}
function decodeRichMsgCard(elem, remainingOutputBytes) {
	const rm = elem.richMsg;
	const data = rm?.template1;
	if (!data || data.length === 0) return;
	const decoded = decodeCardData(data, remainingOutputBytes);
	if (!decoded.ok) return invalidCard(data.length, decoded.reason, decoded.budgetBytes);
	const content = decoded.text;
	const svcId = rm?.serviceId ?? 0;
	if (svcId !== 1 && !isXmlCardContent(content)) return invalidCard(data.length, "invalid_xml", decoded.budgetBytes);
	const rootAttributes = svcId === 0 || svcId === 35 ? readXmlMsgAttributes(content) : void 0;
	if (svcId === 35 || svcId === 0 && rootAttributes?.get("serviceID") === "35") {
		const resId = rootAttributes?.get("m_resid");
		const fileName = rootAttributes?.get("m_fileName") || void 0;
		const forwardId = resId || (rootAttributes?.get("action") === "viewMultiMsg" && fileName && MULTI_MSG_FILE_NAME_PATTERN.test(fileName) ? fileName : void 0);
		return {
			element: forwardId ? {
				type: "forward",
				resId: forwardId,
				forwardUuid: fileName
			} : {
				type: "xml",
				text: content,
				subType: svcId
			},
			error: null,
			inputBytes: data.length,
			budgetBytes: decoded.budgetBytes
		};
	}
	if (svcId === 1) {
		try {
			const parsed = JSON.parse(content);
			if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return invalidCard(data.length, "invalid_json_object", decoded.budgetBytes);
		} catch {
			return invalidCard(data.length, "invalid_json", decoded.budgetBytes);
		}
		return {
			element: {
				type: "json",
				text: content
			},
			error: null,
			inputBytes: data.length,
			budgetBytes: decoded.budgetBytes
		};
	}
	return {
		element: {
			type: "xml",
			text: content,
			subType: svcId
		},
		error: null,
		inputBytes: data.length,
		budgetBytes: decoded.budgetBytes
	};
}
function decodeLightAppCard(elem, remainingOutputBytes) {
	const data = elem.lightApp?.data;
	if (!data || data.length === 0) return;
	const decoded = decodeCardData(data, remainingOutputBytes);
	if (!decoded.ok) return invalidCard(data.length, decoded.reason, decoded.budgetBytes);
	let parsed;
	try {
		parsed = JSON.parse(decoded.text);
	} catch {
		return invalidCard(data.length, "invalid_json", decoded.budgetBytes);
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return invalidCard(data.length, "invalid_json_object", decoded.budgetBytes);
	const card = parsed;
	if (card.app === "com.tencent.multimsg") {
		const detail = card.meta?.detail ?? {};
		const resId = typeof detail.resid === "string" ? detail.resid : "";
		const uniseq = typeof detail.uniseq === "string" ? detail.uniseq : "";
		if (resId) return {
			element: {
				type: "forward",
				resId,
				forwardUuid: uniseq || void 0
			},
			error: null,
			inputBytes: data.length,
			budgetBytes: decoded.budgetBytes
		};
	}
	return {
		element: {
			type: "json",
			text: decoded.text
		},
		error: null,
		inputBytes: data.length,
		budgetBytes: decoded.budgetBytes
	};
}
function decodeCardsOnce(elems) {
	const decoded = /* @__PURE__ */ new Map();
	let remainingOutputBytes = MAX_RICH_CARD_MESSAGE_OUTPUT_BYTES;
	for (const elem of elems) {
		const cards = {};
		const rich = decodeRichMsgCard(elem, remainingOutputBytes);
		if (rich) remainingOutputBytes = Math.max(0, remainingOutputBytes - rich.budgetBytes);
		const light = decodeLightAppCard(elem, remainingOutputBytes);
		if (light) remainingOutputBytes = Math.max(0, remainingOutputBytes - light.budgetBytes);
		if (rich) cards.rich = rich;
		if (light) cards.light = light;
		if (!rich && !light) continue;
		decoded.set(elem, cards);
		for (const [source, card] of Object.entries(cards)) if (card?.error) unknownElementLog.debug("wire %s card ignored inputBytes=%d reason=%s", source, card.inputBytes, card.error);
	}
	return decoded;
}
function decodeBigFacesOnce(elems) {
	const decoded = /* @__PURE__ */ new Map();
	for (const elem of elems) {
		const ce = elem.commonElem;
		if (ce?.serviceType !== 37 || !ce.pbElem) continue;
		decoded.set(elem, decodeProtobufPayload("commonElem.bigFace", ce.pbElem, () => protobuf_decode_QFaceExtra(ce.pbElem)));
	}
	return decoded;
}
var MARKDOWN_BUSINESS_TYPES = /* @__PURE__ */ new Set([
	1,
	3,
	4
]);
var INLINE_KEYBOARD_SERVICE_TYPES = /* @__PURE__ */ new Set([
	46,
	50,
	51
]);
function decodeMarkdownCommonElement(pbElem, businessType) {
	const md = decodeProtobufPayload("commonElem.markdown", pbElem, () => protobuf_decode_MarkdownData(pbElem));
	const content = md?.content ?? "";
	if (md && businessType === 3 && isFlashTransferMarkdown(md, content)) return decodeFlashTransfer(md);
	if (!content) return null;
	return {
		type: "markdown",
		text: content
	};
}
function decodeMarkdownElementsOnce(elems) {
	const decoded = /* @__PURE__ */ new Map();
	for (const elem of elems) {
		const ce = elem.commonElem;
		const businessType = ce?.businessType ?? 0;
		if (ce?.serviceType !== 45 || !MARKDOWN_BUSINESS_TYPES.has(businessType) || !ce.pbElem?.length) continue;
		decoded.set(elem, decodeMarkdownCommonElement(ce.pbElem, businessType));
	}
	return decoded;
}
function decodeInlineKeyboardCommonElement(pbElem) {
	const keyboard = decodeProtobufPayload("commonElem.inlineKeyboard", pbElem, () => protobuf_decode_InlineKeyboardExtra(pbElem))?.keyboard;
	if (!keyboard) return null;
	return {
		type: "inline_keyboard",
		botAppid: String(keyboard.botAppid ?? 0),
		rows: (keyboard.rows ?? []).map((row) => ({ buttons: (row.buttons ?? []).map((button) => {
			const render = button.renderData;
			const action = button.action;
			const permission = action?.permission;
			return {
				id: button.id ?? "",
				label: render?.label ?? "",
				visitedLabel: render?.visitedLabel ?? "",
				style: render?.style ?? 0,
				type: action?.type ?? 0,
				clickLimit: action?.clickLimit ?? 0,
				unsupportedTips: action?.unsupportedTips ?? "",
				data: action?.data ?? "",
				atBotShowChannelList: action?.atBotShowChannelList ?? false,
				permissionType: permission?.type ?? 0,
				specifyRoleIds: permission?.specifyRoleIds ?? [],
				specifyUserIds: permission?.specifyUserIds ?? [],
				isReply: action?.reply ?? false,
				enter: action?.enter ?? false,
				anchor: action?.anchor ?? 0
			};
		}) }))
	};
}
function decodeInlineKeyboardsOnce(elems) {
	const decoded = /* @__PURE__ */ new Map();
	for (const elem of elems) {
		const ce = elem.commonElem;
		if (!ce || !INLINE_KEYBOARD_SERVICE_TYPES.has(ce.serviceType ?? 0) || ce.businessType !== 1 || !ce.pbElem?.length) continue;
		decoded.set(elem, decodeInlineKeyboardCommonElement(ce.pbElem));
	}
	return decoded;
}
function logUnknownWireMetadata(value, path, depth = 0, seen = /* @__PURE__ */ new WeakSet()) {
	if (depth > 16 || value === null || typeof value !== "object" || ArrayBuffer.isView(value)) return;
	if (seen.has(value)) return;
	seen.add(value);
	logUnknownWireFields(value, path);
	if (Array.isArray(value)) {
		value.forEach((entry, index) => logUnknownWireMetadata(entry, `${path}[${index}]`, depth + 1, seen));
		return;
	}
	for (const [key, entry] of Object.entries(value)) logUnknownWireMetadata(entry, `${path}.${key}`, depth + 1, seen);
}
function logUnknownWireFields(value, path) {
	const metadata = protobuf_getUnknownFieldMetadata(value);
	for (const unknown of metadata.fields) unknownElementLog.debug("wire element ignored unknownTag=%d wireType=%d count=%d bytes=%d reason=no schema decoder path=%s", unknown.fieldNumber, unknown.wireType, unknown.count, unknown.totalByteLength, path);
	if (metadata.omittedOccurrences > 0) unknownElementLog.debug("wire unknown metadata truncated totalOccurrences=%d retainedKinds=%d omittedOccurrences=%d omittedBytes=%d path=%s", metadata.totalOccurrences, metadata.fields.length, metadata.omittedOccurrences, metadata.omittedByteLength, path);
}
function classifyProtobufDecodeError(error) {
	const message = error instanceof Error ? error.message.toLowerCase() : "";
	if (message.includes("truncated")) return "protobuf_truncated";
	if (message.includes("overflow")) return "protobuf_varint_overflow";
	if (message.includes("bounds") || message.includes("invalid progress")) return "protobuf_bounds";
	if (message.includes("wire type")) return "protobuf_invalid_wire_type";
	if (message.includes("field number")) return "protobuf_invalid_field_number";
	if (message.includes("group")) return "protobuf_invalid_group";
	return "protobuf_decode_failed";
}
function decodeProtobufPayload(source, data, decode) {
	try {
		const decoded = decode();
		logUnknownWireMetadata(decoded, source);
		return decoded;
	} catch (error) {
		unknownElementLog.debug("wire protobuf payload ignored source=%s bytes=%d reason=%s", source, data.length, classifyProtobufDecodeError(error));
		return null;
	}
}
var BIG_FACE_COMPAT_SUFFIX = "]请使用最新版手机QQ体验新功能";
function isValidBigFace(extra) {
	return extra?.qsid !== void 0 && Number.isSafeInteger(extra.qsid) && extra.qsid >= 0;
}
function bytesEqual(left, right) {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}
function isBigFaceCompatibilityText(extra, text) {
	const faceText = extra.text ?? "";
	const reserveData = text.pbReserve;
	if (!faceText || text.str !== faceText || !reserveData?.length) return false;
	return bytesEqual(reserveData, protobuf_encode_TextElem({ str: `[${faceText.slice(1)}${BIG_FACE_COMPAT_SUFFIX}` }));
}
function assignValidFingerprints(element, md5Hex, sha1Hex, source) {
	if (md5Hex) if (/^[0-9a-fA-F]{32}$/.test(md5Hex)) element.md5Hex = md5Hex;
	else unknownElementLog.debug("wire %s ignored invalid md5 fingerprint length=%d", source, md5Hex.length);
	if (sha1Hex) if (/^[0-9a-fA-F]{40}$/.test(sha1Hex)) element.sha1Hex = sha1Hex;
	else unknownElementLog.debug("wire %s ignored invalid sha1 fingerprint length=%d", source, sha1Hex.length);
}
/**
* Build the `mediaNode` re-upload descriptor from an NTV2 IndexNode + FileInfo.
* Record and video decode to the byte-identical `{ fileUuid, storeId,
* uploadTime, ttl, subType, info:{…} }` shape — share one builder so the two
* never drift (add a field to one and forget the other).
*/
function buildMediaNode(idx, fi) {
	return {
		fileUuid: idx.fileUuid,
		storeId: idx.storeId,
		uploadTime: idx.uploadTime,
		ttl: idx.ttl,
		subType: idx.subType,
		info: {
			fileSize: fi.fileSize,
			fileHash: fi.fileHash,
			fileSha1: fi.fileSha1,
			fileName: fi.fileName,
			width: fi.width,
			height: fi.height,
			time: fi.time,
			original: fi.original,
			type: {
				type: fi.type?.type,
				picFormat: fi.type?.picFormat,
				videoFormat: fi.type?.videoFormat,
				voiceFormat: fi.type?.voiceFormat
			}
		}
	};
}
/** Whether this body carries any slot {@link decodeRichBody} would try:
*  `richText.elems`, a voice (`ptt`), a c2c file (`notOnlineFile`), or
*  serialized `msgContent`. Presence, not successful decode — a body that
*  has elems we do not yet understand is still decodable content. */
function hasDecodableContent(body) {
	const rt = body?.richText;
	if (rt) {
		if (rt.elems && rt.elems.length > 0) return true;
		if (rt.ptt || rt.notOnlineFile) return true;
	}
	return !!(body?.msgContent && body.msgContent.length > 0);
}
function decodeRichBody(body, isGroup) {
	const elements = [];
	logUnknownWireFields(body, "body");
	if (body?.richText) {
		const rt = body.richText;
		logUnknownWireFields(rt, "body.richText");
		if (rt.elems) elements.push(...convertElements(rt.elems, isGroup));
		extractRichtextExtras(rt, elements, isGroup);
	}
	if (body?.msgContent && body.msgContent.length > 0) extractMsgContent(body.msgContent, elements);
	return elements;
}
function convertElements(elems, isGroup) {
	const result = [];
	const decodedCards = decodeCardsOnce(elems);
	const decodedBigFaces = decodeBigFacesOnce(elems);
	const decodedMarkdown = decodeMarkdownElementsOnce(elems);
	const decodedInlineKeyboards = decodeInlineKeyboardsOnce(elems);
	const hasRichContent = [...decodedCards.values()].some((cards) => Boolean(cards.rich?.element || cards.light?.element)) || [...decodedMarkdown.values()].some((element) => element?.type === "markdown" || element?.type === "flash_file");
	let previousBigFace = null;
	let sawReply = false;
	let dropNextBlankText = false;
	for (const elem of elems) {
		const resultCountBeforeElement = result.length;
		const precedingBigFace = previousBigFace;
		const decodedBigFace = decodedBigFaces.get(elem);
		previousBigFace = isValidBigFace(decodedBigFace) ? decodedBigFace : null;
		logUnknownWireMetadata(elem, "elem");
		const unsupportedFields = Object.entries(elem).filter(([, value]) => value !== null && value !== void 0).map(([key]) => key).filter((key) => !DECODED_WIRE_FIELDS.has(key));
		if (unsupportedFields.length > 0) unknownElementLog.debug("wire element ignored fields=%s reason=no MessageElement decoder", unsupportedFields.join(","));
		if (elem.srcMsg) {
			const src = elem.srcMsg;
			const replySeq = src.origSeqs?.[0] ?? 0;
			if (replySeq > 0) {
				const reply = {
					type: "reply",
					replySeq
				};
				if (src.senderUin) reply.replySenderUin = Number(src.senderUin);
				if (src.time) reply.replyTime = src.time;
				if (src.elemsRaw?.length) {
					const decoded = [];
					for (const [index, raw] of src.elemsRaw.entries()) {
						const nested = decodeProtobufPayload(`srcMsg.elemsRaw[${index}]`, raw, () => protobuf_decode_Elem$5(raw));
						if (nested) decoded.push(nested);
					}
					if (decoded.length) reply.replyElements = convertElements(decoded, isGroup);
				}
				if (src.sourceMsg?.length && !reply.replyElements?.some((e) => e.type === "file")) {
					const nof = decodeProtobufPayload("srcMsg.sourceMsg", src.sourceMsg, () => protobuf_decode_PushMsgBody$5(src.sourceMsg))?.body?.richText?.notOnlineFile;
					if (nof?.fileName) (reply.replyElements ??= []).push({
						type: "file",
						fileName: nof.fileName,
						fileSize: nof.fileSize !== void 0 ? Number(nof.fileSize) : 0,
						fileId: nof.fileUuid ?? ""
					});
				}
				result.push(reply);
			}
			sawReply = true;
		}
		if (elem.text) {
			const t = elem.text;
			if (!(precedingBigFace ? isBigFaceCompatibilityText(precedingBigFace, t) : false)) {
				let mention = null;
				if (t.pbReserve && t.pbReserve.length > 0) mention = decodeProtobufPayload("text.pbReserve", t.pbReserve, () => protobuf_decode_MentionExtra(t.pbReserve));
				const hasAttr6 = t.attr6Buf && t.attr6Buf.length > 11;
				const hasMention = mention && (mention.type === 1 || mention.type === 2);
				if (sawReply && mention && mention.type === 2 && (mention.uin ?? 0) === 0) {
					dropNextBlankText = true;
					continue;
				}
				if (dropNextBlankText) {
					dropNextBlankText = false;
					if (!hasMention && (t.str ?? "").trim() === "") continue;
				}
				if (hasAttr6 || hasMention) {
					const me = {
						type: "at",
						targetUin: 0,
						text: t.str ?? ""
					};
					if (hasAttr6) {
						const buf = t.attr6Buf;
						me.targetUin = (buf[7] << 24 | buf[8] << 16 | buf[9] << 8 | buf[10]) >>> 0;
					}
					if (hasMention && mention) {
						me.uid = mention.uid ?? "";
						if (!me.targetUin) me.targetUin = mention.uin ?? 0;
					}
					result.push(me);
				} else {
					const text = t.str ?? "";
					if (text && hasRichContent) continue;
					if (text) result.push({
						type: "text",
						text
					});
				}
			}
		}
		if (elem.face) {
			const faceId = elem.face.index ?? 0;
			if (Number.isSafeInteger(faceId) && faceId >= 0) result.push({
				type: "face",
				faceId
			});
		}
		if (elem.marketFace) {
			const mf = elem.marketFace;
			if (mf.faceId?.length === 16) result.push({
				type: "mface",
				text: mf.faceName ?? "",
				emojiId: toHex(mf.faceId),
				emojiPackageId: mf.tabId ?? 0,
				emojiKey: mf.key ?? ""
			});
		}
		if (elem.notOnlineImage) {
			const img = elem.notOnlineImage;
			if (img.picMd5?.length === 16) {
				const md5Hex = toHexUpper(img.picMd5);
				const urlPath = img.origUrl || img.bigUrl || "";
				result.push({
					type: "image",
					imageUrl: makeImageUrl(urlPath) || (!urlPath ? imageUrlFromMd5(md5Hex) : ""),
					fileId: img.filePath || md5Hex,
					fileSize: img.fileLen ?? 0,
					width: img.picWidth ?? 0,
					height: img.picHeight ?? 0,
					subType: img.pbRes?.subType ?? 0,
					summary: img.pbRes?.summary || (img.pbRes?.subType === 1 ? "[动画表情]" : "[图片]"),
					md5Hex
				});
			}
		}
		if (elem.customFace) {
			const img = elem.customFace;
			if (img.md5?.length === 16) {
				const md5Hex = toHexUpper(img.md5);
				const origUrl = img.origUrl ?? "";
				result.push({
					type: "image",
					imageUrl: makeImageUrl(origUrl) || (!origUrl ? imageUrlFromMd5(md5Hex) : ""),
					fileId: img.filePath || md5Hex,
					fileSize: img.size ?? 0,
					width: img.width ?? 0,
					height: img.height ?? 0,
					subType: img.pbRes?.subType ?? 0,
					summary: img.pbRes?.summary || (img.pbRes?.subType === 1 ? "[动画表情]" : "[图片]"),
					md5Hex
				});
			}
		}
		if (elem.videoFile) {
			const v = elem.videoFile;
			result.push({
				type: "video",
				fileId: v.fileUuid ?? "",
				fileName: v.fileName ?? "",
				fileSize: v.fileSize ?? 0,
				duration: v.fileTime ?? 0,
				fileHash: v.fileMd5 && v.fileMd5.length > 0 ? toHexUpper(v.fileMd5) : "",
				mediaNode: {
					fileUuid: v.fileUuid ?? "",
					info: {
						fileSize: v.fileSize ?? 0,
						fileHash: v.fileMd5 && v.fileMd5.length > 0 ? toHexUpper(v.fileMd5) : "",
						fileName: v.fileName ?? "",
						width: v.fileWidth ?? 0,
						height: v.fileHeight ?? 0,
						time: v.fileTime ?? 0,
						type: {
							type: 2,
							videoFormat: v.fileFormat ?? 0
						}
					}
				}
			});
		}
		if (elem.groupFile) {
			const f = elem.groupFile;
			result.push({
				type: "file",
				fileId: f.fileId ?? "",
				fileName: f.filename ?? "",
				fileSize: f.fileSize !== void 0 ? Number(f.fileSize) : 0
			});
		}
		if (elem.transElem) {
			const te = elem.transElem;
			const resultCountBeforeTrans = result.length;
			if ((te.elemType ?? 0) === 24 && te.elemValue && te.elemValue.length > 3) {
				const val = te.elemValue;
				const len = val[1] << 8 | val[2];
				if (val.length >= 3 + len) {
					const payload = val.subarray(3, 3 + len);
					const extra = decodeProtobufPayload("transElem.groupFile", payload, () => protobuf_decode_GroupFileExtra(payload));
					if (extra?.inner?.info) {
						const info = extra.inner.info;
						result.push({
							type: "file",
							fileName: info.fileName ?? "",
							fileSize: info.fileSize !== void 0 ? Number(info.fileSize) : 0,
							fileId: info.fileId ?? ""
						});
					}
				}
			}
			if (result.length === resultCountBeforeTrans) unknownElementLog.debug("wire transElem ignored elemType=%d reason=no recognized MessageElement payload", te.elemType ?? 0);
		}
		const cards = decodedCards.get(elem);
		if (cards?.rich?.element) result.push(cards.rich.element);
		if (cards?.light?.element) result.push(cards.light.element);
		if (elem.commonElem) {
			const ce = elem.commonElem;
			const svcType = ce.serviceType ?? 0;
			const bizType = ce.businessType ?? 0;
			const resultCountBeforeCommon = result.length;
			if (svcType === 2) result.push({
				type: "poke",
				subType: bizType
			});
			else if (svcType === 3 && ce.pbElem && ce.pbElem.length > 1) {
				const pb = ce.pbElem;
				let pos = 1;
				let length = 0, shift = 0;
				while (pos < pb.length) {
					const b = pb[pos++];
					length |= (b & 127) << shift;
					shift += 7;
					if ((b & 128) === 0) break;
				}
				if (pos + length <= pb.length) {
					const payload = pb.subarray(pos, pos + length);
					const img = decodeProtobufPayload("commonElem.flashImage", payload, () => protobuf_decode_NotOnlineImage$5(payload));
					if (img) {
						const me = {
							type: "image",
							fileId: img.filePath ?? "",
							fileSize: img.fileLen ?? 0,
							width: img.picWidth ?? 0,
							height: img.picHeight ?? 0,
							flash: true,
							summary: "[flash image]"
						};
						if (img.pbRes) me.subType = img.pbRes.subType ?? 0;
						if (img.picMd5 && img.picMd5.length > 0) me.imageUrl = "http://gchat.qpic.cn/gchatpic_new/0/0-0-" + toHexUpper(img.picMd5) + "/0";
						result.push(me);
					}
				}
			} else if (ce.pbElem && (svcType === 48 || bizType === 10 || bizType === 20 || bizType === 11 || bizType === 21 || bizType === 12 || bizType === 22)) {
				const info = decodeProtobufPayload("commonElem.msgInfo", ce.pbElem, () => protobuf_decode_MsgInfo(ce.pbElem));
				if (info?.msgInfoBody && info.msgInfoBody.length > 0) {
					const body = info.msgInfoBody[0];
					if (body.index?.info) {
						const idx = body.index;
						const fi = idx.info;
						if (bizType === 10 || bizType === 20) {
							let url = "";
							if (body.picture) {
								const domain = body.picture.domain ?? "multimedia.nt.qq.com.cn";
								const path = body.picture.urlPath ?? "";
								if (path) {
									url = "https://" + domain + path;
									if (body.picture.ext?.originalParameter) url += body.picture.ext.originalParameter;
								}
							}
							let fileId = fi.fileName || idx.fileUuid || "";
							if (!url && idx.fileUuid) url = ntImageUrlFromFileId(idx.fileUuid, isGroup);
							const me = {
								type: "image",
								fileId,
								fileSize: fi.fileSize ?? 0,
								width: fi.width ?? 0,
								height: fi.height ?? 0,
								imageUrl: url
							};
							assignValidFingerprints(me, fi.fileHash, fi.fileSha1, "commonElem image");
							if (!fileId && me.md5Hex) fileId = `${me.md5Hex.toLowerCase()}.png`;
							if (!url && me.md5Hex) url = imageUrlFromMd5(me.md5Hex);
							me.fileId = fileId;
							me.imageUrl = url;
							if (fi.type?.picFormat) me.picFormat = fi.type.picFormat;
							if (info.extBizInfo?.pic) {
								me.subType = info.extBizInfo.pic.bizType ?? 0;
								me.summary = info.extBizInfo.pic.textSummary || (me.subType === 1 ? "[动画表情]" : "[图片]");
							}
							if (hasUsableImageIdentity(me)) result.push(me);
						} else if (bizType === 12 || bizType === 22) {
							const record = {
								type: "record",
								fileName: fi.fileName ?? "",
								fileId: idx.fileUuid ?? "",
								duration: fi.time ?? 0,
								fileHash: fi.fileHash ?? "",
								fileSize: fi.fileSize ?? 0,
								voiceFormat: fi.type?.voiceFormat ?? 0,
								mediaNode: buildMediaNode(idx, fi)
							};
							assignValidFingerprints(record, fi.fileHash, fi.fileSha1, "commonElem record");
							result.push(record);
						} else if (bizType === 11 || bizType === 21) {
							const video = {
								type: "video",
								fileName: fi.fileName ?? "",
								fileId: idx.fileUuid ?? "",
								fileSize: fi.fileSize ?? 0,
								duration: fi.time ?? 0,
								fileHash: fi.fileHash ?? "",
								width: fi.width ?? 0,
								height: fi.height ?? 0,
								videoFormat: fi.type?.videoFormat ?? 0,
								mediaNode: buildMediaNode(idx, fi)
							};
							assignValidFingerprints(video, fi.fileHash, fi.fileSha1, "commonElem video");
							result.push(video);
						}
					}
				}
			} else if (svcType === 33 && ce.pbElem) {
				const faceId = decodeProtobufPayload("commonElem.smallFace", ce.pbElem, () => protobuf_decode_QSmallFaceExtra(ce.pbElem))?.faceId ?? 0;
				if (Number.isSafeInteger(faceId) && faceId >= 0) result.push({
					type: "face",
					faceId
				});
			} else if (svcType === 37 && ce.pbElem) {
				const extra = decodedBigFaces.get(elem);
				if (isValidBigFace(extra)) result.push({
					type: "face",
					faceId: extra.qsid,
					...extra.resultId != null ? { resultId: extra.resultId } : {}
				});
			} else if (svcType === 45 && ce.pbElem && ce.pbElem.length > 0) {
				const markdown = decodedMarkdown.get(elem);
				if (markdown) result.push(markdown);
			} else if (INLINE_KEYBOARD_SERVICE_TYPES.has(svcType) && bizType === 1 && ce.pbElem?.length) {
				const keyboard = decodedInlineKeyboards.get(elem);
				if (keyboard) result.push(keyboard);
			}
			if (result.length === resultCountBeforeCommon) unknownElementLog.debug("wire commonElem ignored serviceType=%d businessType=%d reason=no recognized MessageElement payload", svcType, bizType);
		}
		if (result.length === resultCountBeforeElement) {
			const ignoredKnownFields = Object.entries(elem).filter(([, value]) => value !== null && value !== void 0).map(([key]) => key).filter((key) => DECODED_WIRE_FIELDS.has(key) && !METADATA_WIRE_FIELDS.has(key) && key !== "transElem" && key !== "commonElem");
			if (ignoredKnownFields.length > 0) unknownElementLog.debug("wire element ignored fields=%s reason=no recognized MessageElement payload", ignoredKnownFields.join(","));
		}
	}
	return dropLegacyImageSiblings(result);
}
function hasUsableImageIdentity(element) {
	if (element.type !== "image") return false;
	if (element.fileId) return true;
	if (element.md5Hex && /^[0-9a-fA-F]{32}$/.test(element.md5Hex)) return true;
	return isUsableImageUrl(element.imageUrl ?? "");
}
function isNtImage(element) {
	if (!hasUsableImageIdentity(element)) return false;
	if (element.picFormat != null || element.sha1Hex) return true;
	return (element.imageUrl ?? "").includes("://multimedia.nt.qq.com.cn/");
}
function isUsableImageUrl(url) {
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
	if (parsed.hostname === "multimedia.nt.qq.com.cn") return parsed.pathname.length > 1;
	return parsed.pathname.length > 1;
}
function sameImageFile(left, right) {
	if (left.type !== "image" || right.type !== "image") return false;
	if (left.fileId && right.fileId && left.fileId === right.fileId) return true;
	return Boolean(left.md5Hex && right.md5Hex && left.md5Hex === right.md5Hex);
}
function dropLegacyImageSiblings(elements) {
	const ntImages = elements.filter(isNtImage);
	return elements.filter((element) => {
		if (element.type !== "image") return true;
		if (isNtImage(element)) return true;
		const url = element.imageUrl ?? "";
		if (!url || !isUsableImageUrl(url)) return false;
		return !ntImages.some((nt) => sameImageFile(nt, element));
	});
}
/**
* Decode a 闪传 markdown commonElem (svc=45, biz=3) into `flash_file`.
*
* Current NT (DecodeMarkdownElement + DecodeMdExtInfoFileTransfer, #358):
*   extType=1, extInfo.filesetId / name; click scheme also carries
*   `mqqrouter://flash_transfer/open_fileset?fileset_id=`.
* Older cards (#199/#200): only the richui JSON `data.fileSetId`.
* Field names on the JSON card are searched recursively because the
* sender builds that blob; extInfo tags are fixed.
*/
function deepFindValue(obj, keys, depth = 0) {
	if (depth > 8 || obj === null || typeof obj !== "object") return;
	const rec = obj;
	for (const key of keys) {
		const v = rec[key];
		if (v !== void 0 && v !== null && v !== "") return v;
	}
	for (const v of Object.values(rec)) {
		const found = deepFindValue(v, keys, depth + 1);
		if (found !== void 0) return found;
	}
}
function isFlashTransferMarkdown(md, content) {
	if (md?.extType === 1 && md.extInfo?.filesetId) return true;
	return content.includes("FlashTransfer") || content.includes("flash_transfer");
}
function parseQueryValue(text, key) {
	const m = text.match(new RegExp(`[?&]${key}=([^&\\s"']+)`));
	if (!m) return "";
	try {
		return decodeURIComponent(m[1]).trim();
	} catch {
		return m[1].trim();
	}
}
function collectSchemeFields(obj) {
	const schemes = [];
	const walk = (value, depth) => {
		if (depth > 8 || value == null) return;
		if (typeof value === "string") {
			if (value.includes("fileset_id=") || value.includes("open_fileset")) schemes.push(value);
			return;
		}
		if (typeof value === "object") for (const child of Object.values(value)) walk(child, depth + 1);
	};
	walk(obj, 0);
	for (const scheme of schemes) {
		const filesetId = parseQueryValue(scheme, "fileset_id");
		if (!filesetId) continue;
		const rawScene = parseQueryValue(scheme, "scene_type");
		const n = Number(rawScene);
		return {
			filesetId,
			sceneType: rawScene && Number.isSafeInteger(n) && n >= 0 ? n : void 0
		};
	}
	return {
		filesetId: "",
		sceneType: void 0
	};
}
function parseFlashTransferCard(content) {
	const m = content.match(/[?&]json=([^)\s]+)/);
	let obj;
	let decodedJson = "";
	if (m) {
		try {
			decodedJson = decodeURIComponent(m[1]);
		} catch {
			decodedJson = m[1];
		}
		try {
			obj = JSON.parse(decodedJson);
		} catch {
			obj = void 0;
		}
	}
	const fromKeys = obj ? String(deepFindValue(obj, [
		"fileSetId",
		"filesetId",
		"fileset_id",
		"file_set_id"
	]) ?? "").trim() : "";
	const fromScheme = obj ? collectSchemeFields(obj) : {
		filesetId: "",
		sceneType: void 0
	};
	const fromRaw = {
		filesetId: parseQueryValue(decodedJson, "fileset_id"),
		sceneType: Number(parseQueryValue(decodedJson, "scene_type"))
	};
	const filesetId = fromKeys || fromScheme.filesetId || fromRaw.filesetId;
	if (!filesetId && obj && deepFindValue(obj, ["busId"]) !== "FlashTransfer" && !content.includes("flash_transfer")) return null;
	const title = obj ? deepFindValue(obj, [
		"title",
		"fileName",
		"name"
	]) : void 0;
	const rawScene = obj ? deepFindValue(obj, ["sceneType", "scene_type"]) : void 0;
	let sceneType;
	if (rawScene != null && rawScene !== "") {
		const n = Number(rawScene);
		if (Number.isSafeInteger(n) && n >= 0) sceneType = n;
	}
	if (sceneType == null) sceneType = fromScheme.sceneType;
	if (sceneType == null && Number.isSafeInteger(fromRaw.sceneType) && fromRaw.sceneType >= 0 && parseQueryValue(decodedJson, "scene_type")) sceneType = fromRaw.sceneType;
	return {
		filesetId,
		fileName: title != null ? String(title) : "",
		sceneType
	};
}
function decodeFlashTransfer(md) {
	const ext = md.extType === 1 ? md.extInfo : void 0;
	const card = parseFlashTransferCard(md.content ?? "");
	const filesetId = (ext?.filesetId ?? card?.filesetId ?? "").trim();
	if (!filesetId) return null;
	let fileName = (ext?.name ?? "").trim();
	if (!fileName) fileName = (card?.fileName ?? "").trim();
	if (!fileName && md.summary) fileName = md.summary.replace(/^\[QQ闪传\]\s*/, "").trim();
	const thumbUrl = (ext?.thumbnail?.download?.downloadUrl ?? "").trim();
	return {
		type: "flash_file",
		filesetId,
		fileName,
		sceneType: card?.sceneType ?? 0,
		...thumbUrl ? { thumbUrl } : {}
	};
}
function extractRichtextExtras(rt, elements, isGroup = false) {
	const hasNtv2Record = elements.some((element) => element.type === "record");
	if (rt.ptt && !hasNtv2Record) {
		const p = rt.ptt;
		const md5Hex = p.fileMd5 && p.fileMd5.length > 0 ? toHexUpper(p.fileMd5) : void 0;
		const me = {
			type: "record",
			fileName: p.fileName ?? "",
			fileSize: p.fileSize ?? 0,
			duration: p.time ?? 0,
			fileHash: md5Hex ?? "",
			voiceFormat: p.format ?? 0
		};
		assignValidFingerprints(me, md5Hex, void 0, "ptt");
		if (isGroup && (p.fileId ?? 0n) !== 0n) me.fileId = p.groupFileKey ?? "";
		else if (p.fileUuid && p.fileUuid.length > 0) me.fileId = Buffer.from(p.fileUuid).toString("utf8");
		me.mediaNode = {
			fileUuid: me.fileId ?? "",
			info: {
				fileSize: p.fileSize ?? 0,
				fileHash: p.fileMd5 && p.fileMd5.length > 0 ? toHexUpper(p.fileMd5) : "",
				fileName: p.fileName ?? "",
				time: p.time ?? 0,
				type: {
					type: 3,
					voiceFormat: p.format ?? 0
				}
			}
		};
		elements.push(me);
	}
	if (rt.notOnlineFile && !isOfflineFileReceiptMetadata(rt.notOnlineFile)) {
		const f = rt.notOnlineFile;
		elements.push({
			type: "file",
			fileId: f.fileUuid ?? "",
			fileName: f.fileName ?? "",
			fileSize: f.fileSize !== void 0 ? Number(f.fileSize) : 0,
			fileHash: f.fileHash ?? ""
		});
	}
}
function extractMsgContent(msgContent, elements) {
	const extra = decodeProtobufPayload("messageBody.msgContent", msgContent, () => protobuf_decode_FileExtra(msgContent));
	if (!extra?.file) return;
	const f = extra.file;
	if (isOfflineFileReceiptMetadata(f)) return;
	if (!f.fileUuid) return;
	elements.push({
		type: "file",
		fileId: f.fileUuid,
		fileName: f.fileName ?? "",
		fileSize: f.fileSize !== void 0 ? Number(f.fileSize) : 0,
		fileHash: f.fileHash ?? ""
	});
}
/** Download acknowledgements can use either the receipt flag or the file subcommand. */
function isOfflineFileReceiptMetadata(file) {
	return file?.downloadFlag === 2 || file?.fileType === 1 && file.subcmd === 2;
}
/** True when this body is an offline-file download receipt, not a new file message. */
function isOfflineFileReceipt(body) {
	if (isOfflineFileReceiptMetadata(body?.richText?.notOnlineFile)) return true;
	if (!body?.msgContent || body.msgContent.length === 0) return false;
	return isOfflineFileReceiptMetadata(decodeProtobufPayload("messageBody.msgContent", body.msgContent, () => protobuf_decode_FileExtra(body.msgContent))?.file);
}
export {};
