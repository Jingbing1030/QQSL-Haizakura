// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/oidb-services/contacts/fetch-group-member-list-page.ts"
// original bundle lines 57055-59070  (2014 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var __td$125 = new TextDecoder();
var __te$120 = new TextEncoder();
var __nonAscii$120 = /[^\x00-\x7f]/;
var __utf8Scratch$120;
var __tdStrict$125 = new TextDecoder("utf-8", { fatal: true });
function __utf8LenLong$120(value) {
	const buffer = __utf8Scratch$120 ??= /* @__PURE__ */ new Uint8Array(4096);
	let length = 0;
	for (;;) {
		const result = __te$120.encodeInto(value, buffer);
		length += result.written;
		if (result.read === value.length) return length;
		value = value.slice(result.read);
	}
}
function __utf8Len$120(value) {
	if (value.length >= 32) return __utf8LenLong$120(value);
	if (value.length >= 8 && value.charCodeAt(0) < 128 && !__nonAscii$120.test(value)) return value.length;
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
function __utf8Write$120(buf, offset, value) {
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
function __utf8WriteLong$120(buf, offset, value) {
	return offset + __te$120.encodeInto(value, buf.subarray(offset)).written;
}
function __asciiWrite$120(buf, offset, value) {
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
function __utf8ReadLong$125(data, start, end) {
	const bytes = data.subarray(start, end);
	if (end - start < 128) return __td$125.decode(bytes);
	try {
		return __tdStrict$125.decode(bytes);
	} catch {
		return __td$125.decode(bytes);
	}
}
function __utf8Read$125(data, start, end) {
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
			if ((b & 192) !== 128) return __td$125.decode(data.subarray(start, end));
			value += String.fromCharCode((a & 31) << 6 | b & 63);
		} else if (a >= 224 && a < 240 && offset + 1 < end) {
			const b = data[offset++], c = data[offset++];
			if ((b & 192) !== 128 || (c & 192) !== 128 || a === 224 && b < 160 || a === 237 && b >= 160) return __td$125.decode(data.subarray(start, end));
			const code = (a & 15) << 12 | (b & 63) << 6 | c & 63;
			if (code !== 65279 || offset !== start + 3) value += String.fromCharCode(code);
		} else if (a >= 240 && a < 245 && offset + 2 < end) {
			const b = data[offset++], c = data[offset++], d = data[offset++];
			if ((b & 192) !== 128 || (c & 192) !== 128 || (d & 192) !== 128 || a === 240 && b < 144 || a === 244 && b >= 144) return __td$125.decode(data.subarray(start, end));
			const code = ((a & 7) << 18 | (b & 63) << 12 | (c & 63) << 6 | d & 63) - 65536;
			value += String.fromCharCode(55296 | code >>> 10, 56320 | code & 1023);
		} else return __td$125.decode(data.subarray(start, end));
	}
	return value;
}
var __pool$122;
var __poolOffset$122 = 0;
function __allocate$122(size) {
	if (size > 4096) return new Uint8Array(size);
	let buffer = __pool$122;
	if (!buffer || __poolOffset$122 + size > buffer.length) {
		buffer = __pool$122 = /* @__PURE__ */ new Uint8Array(8192);
		__poolOffset$122 = 0;
	}
	const start = __poolOffset$122;
	__poolOffset$122 += size;
	return buffer.subarray(start, start + size);
}
function __readVarint32$126(data, offset, end) {
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
function __skipVarint$126(data, offset, end) {
	for (let i = 0; i < 10; i++) {
		if (offset >= end) throw new Error("protobuf truncated varint");
		const byte = data[offset++];
		if (i === 9 && byte > 1) throw new Error("protobuf varint overflow");
		if ((byte & 128) === 0) return offset;
	}
	throw new Error("protobuf varint overflow");
}
function __checkedEnd$126(offset, length, end) {
	if (length > end - offset) throw new Error("protobuf length-delimited field exceeds parent bounds");
	return offset + length;
}
function __skipUnknownField$126(data, offset, end, wireType, fieldNumber, depth = 0) {
	if (depth > 64) throw new Error("protobuf group nesting exceeds 64");
	if (wireType === 0) return __skipVarint$126(data, offset, end);
	if (wireType === 1) {
		if (end - offset < 8) throw new Error("protobuf truncated fixed64 field");
		return offset + 8;
	}
	if (wireType === 2) {
		const [length, next] = __readVarint32$126(data, offset, end);
		return __checkedEnd$126(next, length, end);
	}
	if (wireType === 3) {
		while (offset < end) {
			const [tag, next] = __readVarint32$126(data, offset, end);
			offset = next;
			const nestedField = tag >>> 3;
			const nestedWire = tag & 7;
			if (nestedField === 0) throw new Error("protobuf field number 0 is invalid");
			if (nestedWire === 4) {
				if (nestedField !== fieldNumber) throw new Error("protobuf mismatched end-group tag");
				return offset;
			}
			offset = __skipUnknownField$126(data, offset, end, nestedWire, nestedField, depth + 1);
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
function __size_OidbProperty$101(obj, sizes) {
	let size = 0;
	const _f0 = obj["key"];
	const _f1 = obj["value"];
	if (_f0 != null && _f0 !== "") {
		const _len = __utf8Len$120(_f0);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f1 != null && _f1.length > 0) {
		const _len = _f1.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_OidbProperty$101(obj, buf, offset, sizes) {
	const _f0 = obj["key"];
	const _f1 = obj["value"];
	if (_f0 != null && _f0 !== "") {
		buf[offset++] = 10;
		const _len = sizes[sizes[0]++];
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
		offset = _len >= 128 ? __utf8WriteLong$120(buf, offset, _f0) : _len === _f0.length ? __asciiWrite$120(buf, offset, _f0) : __utf8Write$120(buf, offset, _f0);
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
	return offset;
}
function protobuf_decode_OidbProperty$101(data, offset = 0, end = data.length) {
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
				_f0 = _len <= 32 ? __utf8Read$125(data, offset, offset + _len) : __utf8ReadLong$125(data, offset, offset + _len);
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
				offset = __skipUnknownField$126(data, offset, end, wireType, _tag >>> 3);
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
		"key": _f0,
		"value": _f1
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
function protobuf_encode_OidbBase__OidbGroupMemberListRequest(obj) {
	const sizes = [1];
	const size = __size_OidbBase__OidbGroupMemberListRequest(obj, sizes);
	const buf = size <= 64 ? new Uint8Array(size) : __allocate$122(size);
	__write_OidbBase__OidbGroupMemberListRequest(obj, buf, 0, sizes);
	return buf;
}
function __size_OidbBase__OidbGroupMemberListRequest(obj, sizes) {
	let size = 0;
	const _f0 = obj["command"];
	const _f1 = obj["subCommand"];
	const _f2 = obj["errorCode"];
	const _f3 = obj["body"];
	const _f4 = obj["errorMsg"];
	const _f5 = obj["properties"];
	const _f6 = obj["reserved"];
	if (_f0 != null && _f0 !== 0) {
		const _val = _f0 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f1 != null && _f1 !== 0) {
		const _val = _f1 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f2 != null && _f2 !== 0) {
		const _val = _f2 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f3 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_OidbGroupMemberListRequest(_f3, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f4 != null && _f4 !== "") {
		const _len = __utf8Len$120(_f4);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f5 != null && _f5.length > 0) for (let _i = 0; _i < _f5.length; _i++) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_OidbProperty$101(_f5[_i], sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f6 != null && _f6 !== 0) {
		const _val = _f6 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_OidbBase__OidbGroupMemberListRequest(obj, buf, offset, sizes) {
	const _f0 = obj["command"];
	const _f1 = obj["subCommand"];
	const _f2 = obj["errorCode"];
	const _f3 = obj["body"];
	const _f4 = obj["errorMsg"];
	const _f5 = obj["properties"];
	const _f6 = obj["reserved"];
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
	if (_f1 != null && _f1 !== 0) {
		buf[offset++] = 16;
		let _v = _f1 >>> 0;
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
	if (_f2 != null && _f2 !== 0) {
		buf[offset++] = 24;
		let _v = _f2 >>> 0;
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
	if (_f3 != null) {
		buf[offset++] = 34;
		let _v = sizes[sizes[0]++];
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
		offset = __write_OidbGroupMemberListRequest(_f3, buf, offset, sizes);
	}
	if (_f4 != null && _f4 !== "") {
		buf[offset++] = 42;
		const _len = sizes[sizes[0]++];
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
		offset = _len >= 128 ? __utf8WriteLong$120(buf, offset, _f4) : _len === _f4.length ? __asciiWrite$120(buf, offset, _f4) : __utf8Write$120(buf, offset, _f4);
	}
	if (_f5 != null && _f5.length > 0) for (let _i = 0; _i < _f5.length; _i++) {
		buf[offset++] = 90;
		let _v = sizes[sizes[0]++];
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
		offset = __write_OidbProperty$101(_f5[_i], buf, offset, sizes);
	}
	if (_f6 != null && _f6 !== 0) {
		buf[offset++] = 96;
		let _v = _f6 >>> 0;
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
	return offset;
}
function __size_OidbGroupMemberListRequest(obj, sizes) {
	let size = 0;
	const _f0 = obj["groupUin"];
	const _f1 = obj["field2"];
	const _f2 = obj["field3"];
	const _f3 = obj["body"];
	const _f4 = obj["token"];
	if (_f0 != null && _f0 !== 0) {
		const _val = _f0 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f1 != null && _f1 !== 0) {
		const _val = _f1 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f2 != null && _f2 !== 0) {
		const _val = _f2 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f3 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_OidbGroupMemberListBody(_f3, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f4 != null && _f4 !== "") {
		const _len = __utf8Len$120(_f4);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_OidbGroupMemberListRequest(obj, buf, offset, sizes) {
	const _f0 = obj["groupUin"];
	const _f1 = obj["field2"];
	const _f2 = obj["field3"];
	const _f3 = obj["body"];
	const _f4 = obj["token"];
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
	if (_f1 != null && _f1 !== 0) {
		buf[offset++] = 16;
		let _v = _f1 >>> 0;
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
	if (_f2 != null && _f2 !== 0) {
		buf[offset++] = 24;
		let _v = _f2 >>> 0;
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
	if (_f3 != null) {
		buf[offset++] = 34;
		let _v = sizes[sizes[0]++];
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
		offset = __write_OidbGroupMemberListBody(_f3, buf, offset, sizes);
	}
	if (_f4 != null && _f4 !== "") {
		buf[offset++] = 122;
		const _len = sizes[sizes[0]++];
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
		offset = _len >= 128 ? __utf8WriteLong$120(buf, offset, _f4) : _len === _f4.length ? __asciiWrite$120(buf, offset, _f4) : __utf8Write$120(buf, offset, _f4);
	}
	return offset;
}
function __size_OidbGroupMemberListBody(obj, sizes) {
	let size = 0;
	const _f0 = obj["memberName"];
	const _f1 = obj["memberCard"];
	const _f2 = obj["level"];
	const _f3 = obj["field13"];
	const _f4 = obj["field16"];
	const _f5 = obj["specialTitle"];
	const _f6 = obj["field18"];
	const _f7 = obj["field20"];
	const _f8 = obj["field21"];
	const _f9 = obj["joinTimestamp"];
	const _f10 = obj["lastMsgTimestamp"];
	const _f11 = obj["shutUpTimestamp"];
	const _f12 = obj["field103"];
	const _f13 = obj["field104"];
	const _f14 = obj["field105"];
	const _f15 = obj["field106"];
	const _f16 = obj["permission"];
	const _f17 = obj["field200"];
	const _f18 = obj["field201"];
	if (_f0 === true) size += 2;
	if (_f1 === true) size += 2;
	if (_f2 === true) size += 2;
	if (_f3 === true) size += 2;
	if (_f4 === true) size += 3;
	if (_f5 === true) size += 3;
	if (_f6 === true) size += 3;
	if (_f7 === true) size += 3;
	if (_f8 === true) size += 3;
	if (_f9 === true) size += 3;
	if (_f10 === true) size += 3;
	if (_f11 === true) size += 3;
	if (_f12 === true) size += 3;
	if (_f13 === true) size += 3;
	if (_f14 === true) size += 3;
	if (_f15 === true) size += 3;
	if (_f16 === true) size += 3;
	if (_f17 === true) size += 3;
	if (_f18 === true) size += 3;
	return size;
}
function __write_OidbGroupMemberListBody(obj, buf, offset, sizes) {
	const _f0 = obj["memberName"];
	const _f1 = obj["memberCard"];
	const _f2 = obj["level"];
	const _f3 = obj["field13"];
	const _f4 = obj["field16"];
	const _f5 = obj["specialTitle"];
	const _f6 = obj["field18"];
	const _f7 = obj["field20"];
	const _f8 = obj["field21"];
	const _f9 = obj["joinTimestamp"];
	const _f10 = obj["lastMsgTimestamp"];
	const _f11 = obj["shutUpTimestamp"];
	const _f12 = obj["field103"];
	const _f13 = obj["field104"];
	const _f14 = obj["field105"];
	const _f15 = obj["field106"];
	const _f16 = obj["permission"];
	const _f17 = obj["field200"];
	const _f18 = obj["field201"];
	if (_f0 === true) {
		buf[offset++] = 80;
		buf[offset++] = _f0 ? 1 : 0;
	}
	if (_f1 === true) {
		buf[offset++] = 88;
		buf[offset++] = _f1 ? 1 : 0;
	}
	if (_f2 === true) {
		buf[offset++] = 96;
		buf[offset++] = _f2 ? 1 : 0;
	}
	if (_f3 === true) {
		buf[offset++] = 104;
		buf[offset++] = _f3 ? 1 : 0;
	}
	if (_f4 === true) {
		buf[offset++] = 128;
		buf[offset++] = 1;
		buf[offset++] = _f4 ? 1 : 0;
	}
	if (_f5 === true) {
		buf[offset++] = 136;
		buf[offset++] = 1;
		buf[offset++] = _f5 ? 1 : 0;
	}
	if (_f6 === true) {
		buf[offset++] = 144;
		buf[offset++] = 1;
		buf[offset++] = _f6 ? 1 : 0;
	}
	if (_f7 === true) {
		buf[offset++] = 160;
		buf[offset++] = 1;
		buf[offset++] = _f7 ? 1 : 0;
	}
	if (_f8 === true) {
		buf[offset++] = 168;
		buf[offset++] = 1;
		buf[offset++] = _f8 ? 1 : 0;
	}
	if (_f9 === true) {
		buf[offset++] = 160;
		buf[offset++] = 6;
		buf[offset++] = _f9 ? 1 : 0;
	}
	if (_f10 === true) {
		buf[offset++] = 168;
		buf[offset++] = 6;
		buf[offset++] = _f10 ? 1 : 0;
	}
	if (_f11 === true) {
		buf[offset++] = 176;
		buf[offset++] = 6;
		buf[offset++] = _f11 ? 1 : 0;
	}
	if (_f12 === true) {
		buf[offset++] = 184;
		buf[offset++] = 6;
		buf[offset++] = _f12 ? 1 : 0;
	}
	if (_f13 === true) {
		buf[offset++] = 192;
		buf[offset++] = 6;
		buf[offset++] = _f13 ? 1 : 0;
	}
	if (_f14 === true) {
		buf[offset++] = 200;
		buf[offset++] = 6;
		buf[offset++] = _f14 ? 1 : 0;
	}
	if (_f15 === true) {
		buf[offset++] = 208;
		buf[offset++] = 6;
		buf[offset++] = _f15 ? 1 : 0;
	}
	if (_f16 === true) {
		buf[offset++] = 216;
		buf[offset++] = 6;
		buf[offset++] = _f16 ? 1 : 0;
	}
	if (_f17 === true) {
		buf[offset++] = 192;
		buf[offset++] = 12;
		buf[offset++] = _f17 ? 1 : 0;
	}
	if (_f18 === true) {
		buf[offset++] = 200;
		buf[offset++] = 12;
		buf[offset++] = _f18 ? 1 : 0;
	}
	return offset;
}
function protobuf_decode_OidbBase__OidbSvcTrpcTcp0xFE7_3Response(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	let _f2 = null;
	let _f3 = null;
	let _f4 = null;
	const _f5 = [];
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
				_f3 = protobuf_decode_OidbSvcTrpcTcp0xFE7_3Response(data, offset, offset + _len);
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
				_f4 = _len <= 32 ? __utf8Read$125(data, offset, offset + _len) : __utf8ReadLong$125(data, offset, offset + _len);
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
				_f5.push(protobuf_decode_OidbProperty$101(data, offset, offset + _len));
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
				_f6 = _val | 0;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$126(data, offset, end, wireType, _tag >>> 3);
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
		"command": _f0,
		"subCommand": _f1,
		"errorCode": _f2,
		"body": _f3,
		"errorMsg": _f4,
		"properties": _f5,
		"reserved": _f6
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
function protobuf_decode_OidbSvcTrpcTcp0xFE7_3Response(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	const _f1 = [];
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
				_f1.push(protobuf_decode_OidbSvcTrpcTcp0xFE7_3Member(data, offset, offset + _len));
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
				_f3 = _val;
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
				_f5 = _len <= 32 ? __utf8Read$125(data, offset, offset + _len) : __utf8ReadLong$125(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$126(data, offset, end, wireType, _tag >>> 3);
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
		"members": _f1,
		"field3": _f2,
		"memberChangeSeq": _f3,
		"memberCardChangeSeq": _f4,
		"token": _f5
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
function protobuf_decode_OidbSvcTrpcTcp0xFE7_3Member(data, offset = 0, end = data.length) {
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
				_f0 = protobuf_decode_OidbSvcTrpcTcp0xFE7_3Uin(data, offset, offset + _len);
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
				_f1 = _len <= 32 ? __utf8Read$125(data, offset, offset + _len) : __utf8ReadLong$125(data, offset, offset + _len);
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
				_f2 = protobuf_decode_OidbSvcTrpcTcp0xFE7_3Card(data, offset, offset + _len);
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
				_f3 = protobuf_decode_OidbSvcTrpcTcp0xFE7_3Level(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 138: {
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
				_f4 = _len <= 32 ? __utf8Read$125(data, offset, offset + _len) : __utf8ReadLong$125(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 800: {
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
			case 808: {
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
			case 816: {
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
			case 856: {
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
				offset = __skipUnknownField$126(data, offset, end, wireType, _tag >>> 3);
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
		"memberName": _f1,
		"memberCard": _f2,
		"level": _f3,
		"specialTitle": _f4,
		"joinTimestamp": _f5,
		"lastMsgTimestamp": _f6,
		"shutUpTimestamp": _f7,
		"permission": _f8
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
function protobuf_decode_OidbSvcTrpcTcp0xFE7_3Uin(data, offset = 0, end = data.length) {
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
				_f0 = _len <= 32 ? __utf8Read$125(data, offset, offset + _len) : __utf8ReadLong$125(data, offset, offset + _len);
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
				_f1 = _val;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$126(data, offset, end, wireType, _tag >>> 3);
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
		"uin": _f1
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
function protobuf_decode_OidbSvcTrpcTcp0xFE7_3Card(data, offset = 0, end = data.length) {
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
				_f0 = _len <= 32 ? __utf8Read$125(data, offset, offset + _len) : __utf8ReadLong$125(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$126(data, offset, end, wireType, _tag >>> 3);
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
	const _result = { "memberCard": _f0 };
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
function protobuf_decode_OidbSvcTrpcTcp0xFE7_3Level(data, offset = 0, end = data.length) {
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
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$126(data, offset, end, wireType, _tag >>> 3);
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
		"infos": _f0,
		"level": _f1
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
function permissionToRole(permission) {
	switch (permission) {
		case 1: return "owner";
		case 2: return "admin";
		default: return "member";
	}
}
var FetchGroupMemberListPage;
(function(_FetchGroupMemberListPage) {
	_FetchGroupMemberListPage.command = 4071;
	_FetchGroupMemberListPage.subCommand = 3;
	_FetchGroupMemberListPage.serialize = (_ctx, p) => {
		const body = {
			groupUin: p.groupId,
			field2: 5,
			field3: 2,
			body: {
				memberName: true,
				memberCard: true,
				level: true,
				field13: true,
				field16: true,
				specialTitle: true,
				field18: true,
				field20: true,
				field21: true,
				joinTimestamp: true,
				lastMsgTimestamp: true,
				shutUpTimestamp: true,
				field103: true,
				field104: true,
				field105: true,
				field106: true,
				permission: true,
				field200: true,
				field201: true
			}
		};
		if (p.token) body.token = p.token;
		return body;
	};
	_FetchGroupMemberListPage.deserialize = (_ctx, body) => ({
		members: (body.members ?? []).map((raw) => ({
			uin: raw.uin?.uin ?? 0,
			uid: raw.uin?.uid ?? "",
			nickname: raw.memberName ?? "",
			card: raw.memberCard?.memberCard ?? "",
			isRobot: false,
			role: permissionToRole(raw.permission ?? 0),
			level: raw.level?.level ?? 0,
			title: raw.specialTitle ?? "",
			joinTime: raw.joinTimestamp ?? 0,
			lastSentTime: raw.lastMsgTimestamp ?? 0,
			shutUpTime: raw.shutUpTimestamp ?? 0
		})),
		token: body.token ?? ""
	});
	_FetchGroupMemberListPage.encode = (env) => protobuf_encode_OidbBase__OidbGroupMemberListRequest(env);
	_FetchGroupMemberListPage.decode = (bytes) => protobuf_decode_OidbBase__OidbSvcTrpcTcp0xFE7_3Response(bytes);
	_FetchGroupMemberListPage.invoke = (deps, params) => invokeOidb(deps, FetchGroupMemberListPage, params);
})(FetchGroupMemberListPage || (FetchGroupMemberListPage = {}));
export {};
