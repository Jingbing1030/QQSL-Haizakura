init_utils();
var __td$95 = new TextDecoder();
var __te$91 = new TextEncoder();
var __nonAscii$91 = /[^\x00-\x7f]/;
var __utf8Scratch$91;
var __tdStrict$95 = new TextDecoder("utf-8", { fatal: true });
function __utf8LenLong$91(value) {
	const buffer = __utf8Scratch$91 ??= /* @__PURE__ */ new Uint8Array(4096);
	let length = 0;
	for (;;) {
		const result = __te$91.encodeInto(value, buffer);
		length += result.written;
		if (result.read === value.length) return length;
		value = value.slice(result.read);
	}
}
function __utf8Len$91(value) {
	if (value.length >= 32) return __utf8LenLong$91(value);
	if (value.length >= 8 && value.charCodeAt(0) < 128 && !__nonAscii$91.test(value)) return value.length;
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
function __utf8Write$91(buf, offset, value) {
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
function __utf8WriteLong$91(buf, offset, value) {
	return offset + __te$91.encodeInto(value, buf.subarray(offset)).written;
}
function __asciiWrite$91(buf, offset, value) {
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
function __utf8ReadLong$95(data, start, end) {
	const bytes = data.subarray(start, end);
	if (end - start < 128) return __td$95.decode(bytes);
	try {
		return __tdStrict$95.decode(bytes);
	} catch {
		return __td$95.decode(bytes);
	}
}
function __utf8Read$95(data, start, end) {
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
			if ((b & 192) !== 128) return __td$95.decode(data.subarray(start, end));
			value += String.fromCharCode((a & 31) << 6 | b & 63);
		} else if (a >= 224 && a < 240 && offset + 1 < end) {
			const b = data[offset++], c = data[offset++];
			if ((b & 192) !== 128 || (c & 192) !== 128 || a === 224 && b < 160 || a === 237 && b >= 160) return __td$95.decode(data.subarray(start, end));
			const code = (a & 15) << 12 | (b & 63) << 6 | c & 63;
			if (code !== 65279 || offset !== start + 3) value += String.fromCharCode(code);
		} else if (a >= 240 && a < 245 && offset + 2 < end) {
			const b = data[offset++], c = data[offset++], d = data[offset++];
			if ((b & 192) !== 128 || (c & 192) !== 128 || (d & 192) !== 128 || a === 240 && b < 144 || a === 244 && b >= 144) return __td$95.decode(data.subarray(start, end));
			const code = ((a & 7) << 18 | (b & 63) << 12 | (c & 63) << 6 | d & 63) - 65536;
			value += String.fromCharCode(55296 | code >>> 10, 56320 | code & 1023);
		} else return __td$95.decode(data.subarray(start, end));
	}
	return value;
}
var __pool$93;
var __poolOffset$93 = 0;
function __allocate$93(size) {
	if (size > 4096) return new Uint8Array(size);
	let buffer = __pool$93;
	if (!buffer || __poolOffset$93 + size > buffer.length) {
		buffer = __pool$93 = /* @__PURE__ */ new Uint8Array(8192);
		__poolOffset$93 = 0;
	}
	const start = __poolOffset$93;
	__poolOffset$93 += size;
	return buffer.subarray(start, start + size);
}
function __readVarint32$96(data, offset, end) {
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
function __skipVarint$96(data, offset, end) {
	for (let i = 0; i < 10; i++) {
		if (offset >= end) throw new Error("protobuf truncated varint");
		const byte = data[offset++];
		if (i === 9 && byte > 1) throw new Error("protobuf varint overflow");
		if ((byte & 128) === 0) return offset;
	}
	throw new Error("protobuf varint overflow");
}
function __checkedEnd$96(offset, length, end) {
	if (length > end - offset) throw new Error("protobuf length-delimited field exceeds parent bounds");
	return offset + length;
}
function __skipUnknownField$96(data, offset, end, wireType, fieldNumber, depth = 0) {
	if (depth > 64) throw new Error("protobuf group nesting exceeds 64");
	if (wireType === 0) return __skipVarint$96(data, offset, end);
	if (wireType === 1) {
		if (end - offset < 8) throw new Error("protobuf truncated fixed64 field");
		return offset + 8;
	}
	if (wireType === 2) {
		const [length, next] = __readVarint32$96(data, offset, end);
		return __checkedEnd$96(next, length, end);
	}
	if (wireType === 3) {
		while (offset < end) {
			const [tag, next] = __readVarint32$96(data, offset, end);
			offset = next;
			const nestedField = tag >>> 3;
			const nestedWire = tag & 7;
			if (nestedField === 0) throw new Error("protobuf field number 0 is invalid");
			if (nestedWire === 4) {
				if (nestedField !== fieldNumber) throw new Error("protobuf mismatched end-group tag");
				return offset;
			}
			offset = __skipUnknownField$96(data, offset, end, nestedWire, nestedField, depth + 1);
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
function __varint64Size$38(value) {
	if (value < 128n) return 1;
	const hi = Number(value >> 32n);
	return ((hi ? 64 - Math.clz32(hi) : 32 - Math.clz32(Number(value))) + 6) / 7 | 0;
}
function __writeVarint64$38(buf, offset, value) {
	let lo = Number(value & 4294967295n) >>> 0;
	let hi = Number(value >> 32n) >>> 0;
	while (hi || lo > 127) {
		buf[offset++] = lo & 127 | 128;
		lo = (lo >>> 7 | hi << 25) >>> 0;
		hi >>>= 7;
	}
	buf[offset++] = lo;
	return offset;
}
function protobuf_encode_FlashFileId(obj) {
	let size = 0;
	const _f0 = obj["sha1"];
	const _f1 = obj["fileSize"];
	const _f2 = obj["appid"];
	const _f3 = obj["timestamp"];
	const _f4 = obj["env"];
	let _c4;
	const _f5 = obj["ttl"];
	const _f6 = obj["sessionId"];
	const _f7 = obj["field15"];
	const _f8 = obj["region"];
	let _c8;
	if (_f0 != null && _f0.length > 0) {
		const _len = _f0.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
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
	if (_f3 != null && _f3 !== 0n) size += 1 + __varint64Size$38(BigInt.asUintN(64, _f3));
	if (_f4 != null && _f4 !== "") {
		const _len = __utf8Len$91(_f4);
		_c4 = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f5 != null && _f5 !== 0) {
		const _val = _f5 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f6 != null && _f6.length > 0) {
		const _len = _f6.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f7 != null && _f7.length > 0) {
		const _len = _f7.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f8 != null && _f8 !== "") {
		const _len = __utf8Len$91(_f8);
		_c8 = _len;
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	const buf = size <= 64 ? new Uint8Array(size) : __allocate$93(size);
	let offset = 0;
	if (_f0 != null && _f0.length > 0) {
		buf[offset++] = 18;
		const _len = _f0.length;
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
		buf.set(_f0, offset);
		offset += _len;
	}
	if (_f1 != null && _f1 !== 0) {
		buf[offset++] = 24;
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
		buf[offset++] = 32;
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
	if (_f3 != null && _f3 !== 0n) {
		buf[offset++] = 40;
		offset = __writeVarint64$38(buf, offset, BigInt.asUintN(64, _f3));
	}
	if (_f4 != null && _f4 !== "") {
		buf[offset++] = 50;
		const _len = _c4;
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
		offset = _len >= 128 ? __utf8WriteLong$91(buf, offset, _f4) : _len === _f4.length ? __asciiWrite$91(buf, offset, _f4) : __utf8Write$91(buf, offset, _f4);
	}
	if (_f5 != null && _f5 !== 0) {
		buf[offset++] = 80;
		let _v = _f5 >>> 0;
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
	if (_f6 != null && _f6.length > 0) {
		buf[offset++] = 90;
		const _len = _f6.length;
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
		buf.set(_f6, offset);
		offset += _len;
	}
	if (_f7 != null && _f7.length > 0) {
		buf[offset++] = 122;
		const _len = _f7.length;
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
		buf.set(_f7, offset);
		offset += _len;
	}
	if (_f8 != null && _f8 !== "") {
		buf[offset++] = 130;
		buf[offset++] = 1;
		const _len = _c8;
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
		offset = _len >= 128 ? __utf8WriteLong$91(buf, offset, _f8) : _len === _f8.length ? __asciiWrite$91(buf, offset, _f8) : __utf8Write$91(buf, offset, _f8);
	}
	return buf;
}
function protobuf_encode_FlashSliceUploadBody(obj) {
	const sizes = [1];
	const size = __size_FlashSliceUploadBody(obj, sizes);
	const buf = size <= 64 ? new Uint8Array(size) : __allocate$93(size);
	__write_FlashSliceUploadBody(obj, buf, 0, sizes);
	return buf;
}
function __size_FlashSliceUploadBody(obj, sizes) {
	let size = 0;
	const _f0 = obj["field1"];
	const _f1 = obj["appid"];
	const _f2 = obj["field3"];
	const _f3 = obj["payload"];
	if (_f0 != null) {
		const _val = _f0 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f1 != null && _f1 !== 0) {
		const _val = _f1 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f2 != null) {
		const _val = _f2 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f3 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_FlashSlicePayload(_f3, sizes);
		sizes[_slot] = _len;
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_FlashSliceUploadBody(obj, buf, offset, sizes) {
	const _f0 = obj["field1"];
	const _f1 = obj["appid"];
	const _f2 = obj["field3"];
	const _f3 = obj["payload"];
	if (_f0 != null) {
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
	if (_f2 != null) {
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
		buf[offset++] = 218;
		buf[offset++] = 6;
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
		offset = __write_FlashSlicePayload(_f3, buf, offset, sizes);
	}
	return offset;
}
function __size_FlashSlicePayload(obj, sizes) {
	let size = 0;
	const _f0 = obj["field1"];
	const _f1 = obj["rkey"];
	const _f2 = obj["start"];
	const _f3 = obj["end"];
	const _f4 = obj["sha1"];
	const _f5 = obj["sha1StateV"];
	const _f6 = obj["chunk"];
	if (_f0 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_FlashEmpty(_f0, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f1 != null && _f1 !== "") {
		const _len = __utf8Len$91(_f1);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f2 != null) {
		const _val = _f2 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f3 != null) {
		const _val = _f3 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f4 != null && _f4.length > 0) {
		const _len = _f4.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f5 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_FlashSha1StateV(_f5, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f6 != null && _f6.length > 0) {
		const _len = _f6.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_FlashSlicePayload(obj, buf, offset, sizes) {
	const _f0 = obj["field1"];
	const _f1 = obj["rkey"];
	const _f2 = obj["start"];
	const _f3 = obj["end"];
	const _f4 = obj["sha1"];
	const _f5 = obj["sha1StateV"];
	const _f6 = obj["chunk"];
	if (_f0 != null) {
		buf[offset++] = 10;
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
		offset = __write_FlashEmpty(_f0, buf, offset, sizes);
	}
	if (_f1 != null && _f1 !== "") {
		buf[offset++] = 18;
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
		offset = _len >= 128 ? __utf8WriteLong$91(buf, offset, _f1) : _len === _f1.length ? __asciiWrite$91(buf, offset, _f1) : __utf8Write$91(buf, offset, _f1);
	}
	if (_f2 != null) {
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
		buf[offset++] = 32;
		let _v = _f3 >>> 0;
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
	if (_f4 != null && _f4.length > 0) {
		buf[offset++] = 42;
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
	if (_f5 != null) {
		buf[offset++] = 50;
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
		offset = __write_FlashSha1StateV(_f5, buf, offset, sizes);
	}
	if (_f6 != null && _f6.length > 0) {
		buf[offset++] = 58;
		const _len = _f6.length;
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
		buf.set(_f6, offset);
		offset += _len;
	}
	return offset;
}
function __size_FlashEmpty(obj, sizes) {
	return 0;
}
function __write_FlashEmpty(obj, buf, offset, sizes) {
	return offset;
}
function __size_FlashSha1StateV(obj, sizes) {
	let size = 0;
	const _f0 = obj["state"];
	if (_f0 != null && _f0.length > 0) for (let _i = 0; _i < _f0.length; _i++) {
		const _len = _f0[_i].length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_FlashSha1StateV(obj, buf, offset, sizes) {
	const _f0 = obj["state"];
	if (_f0 != null && _f0.length > 0) for (let _i = 0; _i < _f0.length; _i++) {
		buf[offset++] = 10;
		const _len = _f0[_i].length;
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
		buf.set(_f0[_i], offset);
		offset += _len;
	}
	return offset;
}
function protobuf_decode_FlashSliceUploadResp(data, offset = 0, end = data.length) {
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
				_f0 = _len <= 32 ? __utf8Read$95(data, offset, offset + _len) : __utf8ReadLong$95(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$96(data, offset, end, wireType, _tag >>> 3);
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
	const _result = { "status": _f0 };
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
var FLASH_SLICE_SIZE = 1024 * 1024;
var FLASH_IMAGE_EXT = /* @__PURE__ */ new Set([
	"jpg",
	"jpeg",
	"png",
	"gif",
	"bmp",
	"webp",
	"heic",
	"avif",
	"tiff",
	"tif",
	"ico",
	"dib",
	"heif"
]);
var FLASH_AUDIO_EXT = /* @__PURE__ */ new Set([
	"mp3",
	"wav",
	"aac",
	"flac"
]);
var FLASH_VIDEO_EXT = /* @__PURE__ */ new Set([
	"mp4",
	"avi",
	"mkv",
	"mov",
	"3gp",
	"mpeg",
	"rmvb",
	"rm",
	"wmv",
	"flv",
	"asf",
	"webm",
	"mpg",
	"vob",
	"m4v",
	"f4v"
]);
var FLASH_ARCHIVE_EXT = /* @__PURE__ */ new Set([
	"zip",
	"rar",
	"tar",
	"bz2",
	"xz",
	"tgz",
	"gz",
	"7z"
]);
var FLASH_MODEL_EXT = /* @__PURE__ */ new Set([
	"pt",
	"pth",
	"onnx",
	"model",
	"mlmodel"
]);
/** 0x93cf f3 粗类：压缩包走 2/6，其余按媒体类 7。 */
function flashApplyTypeCode(ext) {
	if (ext === "zip") return 6;
	if (FLASH_ARCHIVE_EXT.has(ext)) return 2;
	return 7;
}
/**
* 0x93d0 / 0x12a9 格式码。与 QQ 客户端按扩展名判定的图标类型一致：
* 图片 26、音频 1、视频 2、文档 3、压缩包 4、未知 11。
*/
function flashFormatCode(ext) {
	if (FLASH_IMAGE_EXT.has(ext)) return 26;
	if (FLASH_AUDIO_EXT.has(ext)) return 1;
	if (FLASH_VIDEO_EXT.has(ext)) return 2;
	if (ext === "doc" || ext === "docx") return 3;
	if (FLASH_ARCHIVE_EXT.has(ext)) return 4;
	if (ext === "apk") return 5;
	if (ext === "xls" || ext === "xlsx") return 6;
	if (ext === "ppt" || ext === "pptx") return 7;
	if (ext === "html" || ext === "htm") return 8;
	if (ext === "pdf") return 9;
	if (ext === "txt") return 10;
	if (ext === "psd") return 12;
	if (FLASH_MODEL_EXT.has(ext)) return 15;
	if (ext === "ttf" || ext === "otf") return 16;
	if (ext === "ipa") return 17;
	if (ext === "dmg") return 23;
	if (ext === "pkg") return 24;
	if (ext === "key") return 18;
	if (ext === "note") return 19;
	if (ext === "numbers") return 20;
	if (ext === "pages") return 21;
	if (ext === "sketch") return 22;
	if (ext === "exe") return 27;
	return 11;
}
/** After create returns, 0x93d4 can still omit the main-file fileId for a
*  few seconds (#364). Re-query on this schedule (first lookup is immediate). */
var FLASH_FILE_ID_RETRY_DELAYS_MS = [
	1e3,
	2e3,
	4e3,
	4e3
];
/** Fail cleanly if the staged file changed since the streaming hash pass. */
async function assertUnchanged$1(filePath, baseline) {
	const now = await promises.stat(filePath);
	if (now.size !== baseline.size || now.mtimeMs !== baseline.mtimeMs) throw new Error("file source changed during send (mutated between hashing and upload)");
}
function flashStageMaxBytes(source) {
	return inlineBase64Payload(source) !== null ? FLASH_TRANSFER_INLINE_MAX_BYTES : FLASH_TRANSFER_MAX_BYTES;
}
function flashFileDisplayName(override, fallback) {
	return (override ?? "").replace(/[/\\]/g, "_").trim() || fallback;
}
function normalizeFlashTaskInputs(files) {
	return (Array.isArray(files) ? files : [files]).map((item) => typeof item === "string" ? { file: item } : item);
}
function entryToInfo(e) {
	return {
		filesetUuid: e.filesetUuid ?? "",
		fileName: e.fileName ?? "",
		origName: e.origName ?? "",
		fileSize: Number(e.fileSize ?? 0),
		shareUrl: e.uploadUrlWrap?.uploadUrl ?? "",
		fileId: e.fileIdWrap?.fileId ?? "",
		downloadUrl: e.fileIdWrap?.download?.downloadUrl ?? ""
	};
}
var QFILE_SHARE_ORIGIN = "https://qfile.qq.com";
var QFILE_SHARE_PAGE_MAX_BYTES = 2 * 1024 * 1024;
var QFILE_SHARE_TIMEOUT_MS = 2e4;
function officialQfileShareUrl(input) {
	const value = input.trim();
	if (!value) throw new Error("get_fileset_id: share code is empty");
	let code = value;
	if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith("//")) {
		let parsed;
		try {
			parsed = new URL(value);
		} catch (error) {
			throw new Error("get_fileset_id: expected an official QQ share URL", { cause: error });
		}
		if (parsed.protocol !== "https:" || parsed.hostname !== "qfile.qq.com" || parsed.port !== "" || parsed.username !== "" || parsed.password !== "") throw new Error("get_fileset_id: expected an official QQ share URL");
		const match = /^\/q\/([^/]+)\/?$/.exec(parsed.pathname);
		if (!match) throw new Error("get_fileset_id: expected an official QQ share URL");
		try {
			code = decodeURIComponent(match[1]);
		} catch (error) {
			throw new Error("get_fileset_id: expected an official QQ share URL", { cause: error });
		}
	}
	const hasForbiddenCharacter = Array.from(code).some((char) => {
		const codePoint = char.codePointAt(0) ?? 0;
		return codePoint <= 32 || codePoint === 127 || "/\\?#".includes(char);
	});
	if (code.length > 256 || hasForbiddenCharacter) throw new Error("get_fileset_id: invalid share code");
	return `${QFILE_SHARE_ORIGIN}/q/${encodeURIComponent(code)}`;
}
async function rejectShareResponse(response, error) {
	try {
		await response.body?.cancel(error);
	} catch (cleanupError) {
		throw new AggregateError([error, cleanupError], error.message);
	}
	throw error;
}
async function readSharePage(response) {
	const declaredLength = response.headers.get("content-length");
	if (declaredLength !== null) {
		if (!/^\d+$/.test(declaredLength)) await rejectShareResponse(response, /* @__PURE__ */ new Error("get_fileset_id: invalid response length"));
		if (Number(declaredLength) > QFILE_SHARE_PAGE_MAX_BYTES) await rejectShareResponse(response, /* @__PURE__ */ new Error("get_fileset_id: share page too large"));
	}
	if (!response.body) throw new Error("get_fileset_id: share page response has no body");
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let total = 0;
	let html = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			total += value.byteLength;
			if (total > QFILE_SHARE_PAGE_MAX_BYTES) {
				const error = /* @__PURE__ */ new Error("get_fileset_id: share page too large");
				try {
					await reader.cancel(error);
				} catch (cleanupError) {
					throw new AggregateError([error, cleanupError], error.message);
				}
				throw error;
			}
			html += decoder.decode(value, { stream: true });
		}
		html += decoder.decode();
		return html;
	} finally {
		reader.releaseLock();
	}
}
var CRC_TABLE = (() => {
	const table = /* @__PURE__ */ new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();
function crc32(buf) {
	let c = 4294967295;
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ c >>> 8;
	return (c ^ 4294967295) >>> 0;
}
function pngChunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const typeBuf = Buffer.from(type, "ascii");
	const crc = crc32(Buffer.concat([typeBuf, data]));
	const crcBuf = Buffer.alloc(4);
	crcBuf.writeUInt32BE(crc, 0);
	return Buffer.concat([
		len,
		typeBuf,
		data,
		crcBuf
	]);
}
/** 生成 width×height 随机纯色 PNG（8-bit RGB）。每次随机颜色，SHA1 不同以避免秒传。 */
function generatePng(width, height) {
	const r = Math.floor(Math.random() * 256);
	const g = Math.floor(Math.random() * 256);
	const b = Math.floor(Math.random() * 256);
	const rowLen = 1 + width * 3;
	const raw = Buffer.alloc(rowLen * height);
	for (let y = 0; y < height; y++) {
		const off = y * rowLen;
		raw[off] = 0;
		for (let x = 0; x < width; x++) {
			raw[off + 1 + x * 3] = r;
			raw[off + 1 + x * 3 + 1] = g;
			raw[off + 1 + x * 3 + 2] = b;
		}
	}
	const compressed = deflateSync(raw);
	const sig = Buffer.from([
		137,
		80,
		78,
		71,
		13,
		10,
		26,
		10
	]);
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	ihdr[10] = 0;
	ihdr[11] = 0;
	ihdr[12] = 0;
	return Buffer.concat([
		sig,
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", compressed),
		pngChunk("IEND", Buffer.alloc(0))
	]);
}
var FlashTransferApi = class FlashTransferApi {
	ctx;
	constructor(ctx) {
		this.ctx = ctx;
	}
	/** 获取文件集信息（get_fileset_info）。 */
	async getFilesetInfo(filesetUuid) {
		return (await GetFilesetDetail.invoke(this.ctx, { filesetUuid })).map(entryToInfo);
	}
	/** 获取闪传文件列表（get_flash_file_list）。同 getFilesetInfo，返回文件数组。 */
	async getFlashFileList(filesetUuid) {
		return this.getFilesetInfo(filesetUuid);
	}
	/**
	* 拿指定文件的下载直链 + 元信息。0x93d4 返回 fileset 内所有文件（f3 repeated，
	* 多文件时每条 f6=序号、f14=主文件 fileId），按 fileIndex 选中后走 0x12a9 sub=200
	* 拿主文件直链。0x93d3/0x93d4 的 downloadUrl 字段是缩略图（appid=14903/14902），
	* 主文件必须走 0x12a9 sub=200。
	*
	* create 刚返回时 f14 可能还是空的（#364）。fileId 空则按
	* FLASH_FILE_ID_RETRY_DELAYS_MS 再问 0x93d4；已经有 fileId 后 0x12a9 只打一枪。
	*/
	async getFileDownload(filesetUuid, fileIndex = 1) {
		for (let attempt = 0;; attempt++) {
			const meta = (await GetDownloadUrl.invoke(this.ctx, { filesetUuid })).find((m) => m.fileIndex === fileIndex);
			if (meta?.fileId) {
				const url = await GetFlashDownload.invoke(this.ctx, {
					filesetUuid: meta.filesetUuid,
					fileUuid: meta.fileUuid,
					fileId: meta.fileId,
					fileName: meta.fileName
				});
				if (!url) return null;
				return {
					url,
					fileName: meta.fileName,
					fileSize: meta.fileSize
				};
			}
			const delay = FLASH_FILE_ID_RETRY_DELAYS_MS[attempt];
			if (delay === void 0) return null;
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}
	/**
	* 获取闪传文件下载链接（get_flash_file_url）。主文件直链走 0x12a9 sub=200
	* （0x93d3 的 downloadUrl 是缩略图 appid=14903，非主文件）。多文件 fileset 用
	* fileIndex 指定第几个文件（默认 1）。找不到文件或拿不到直链时抛错。
	*/
	async getFlashFileUrl(filesetUuid, fileIndex = 1) {
		const dl = await this.getFileDownload(filesetUuid, fileIndex);
		if (!dl || !dl.url) throw new Error("get_flash_file_url: no download url available");
		return dl.url;
	}
	/**
	* 解析闪传文件下载直链（download_fileset）。返回指定文件的下载 URL + 文件名/大小，
	* 不下载文件内容（由调用方拉）。多文件 fileset 用 fileIndex 指定第几个文件（默认 1）。
	*/
	async downloadFileset(filesetUuid, opts) {
		const dl = await this.getFileDownload(filesetUuid, opts?.fileIndex ?? 1);
		if (!dl || !dl.url) throw new Error("download_fileset: no download url available");
		return dl;
	}
	/** 获取分享链接（get_share_link）= qfile.qq.com/q/<code>。 */
	async getShareLink(filesetUuid) {
		return (await GetFilesetDetail.invoke(this.ctx, { filesetUuid })).find((e) => e.uploadUrlWrap?.uploadUrl)?.uploadUrlWrap?.uploadUrl ?? "";
	}
	/** 列出当前账号的所有 fileset（OneBot 标准未定义，QQ 面板有此入口）。 */
	async listFilesets() {
		return (await ListFilesets.invoke(this.ctx, {})).map(entryToInfo);
	}
	/** 删除闪传文件（delete_flash_file）。 */
	async deleteFlashFile(filesetUuid) {
		await DeleteFlashFile.invoke(this.ctx, { filesetUuid });
	}
	/** 重命名闪传文件（rename_flash_file）。 */
	async renameFlashFile(filesetUuid, newName) {
		await RenameFlashFile.invoke(this.ctx, {
			filesetUuid,
			newName
		});
	}
	/**
	* 发送闪传文件（send_flash_msg，0x93d7）。私聊：user_id→uid；群聊：group_id 直接用。
	* 0x93d7 响应无 message_id（分享 fileset，非传统消息），OneBot 层 message_id 由 action 返回 0。
	*/
	async sendFlashMsg(filesetUuid, target) {
		if (target.groupId) {
			await SendFlashMsg.invoke(this.ctx, {
				groupId: target.groupId,
				filesetUuid
			});
			return;
		}
		const userId = target.userId;
		if (!userId) throw new Error("send_flash_msg: user_id or group_id is required");
		const targetUid = await this.ctx.identity.resolveUid(userId);
		await SendFlashMsg.invoke(this.ctx, {
			targetUid,
			filesetUuid
		});
	}
	/**
	* 从分享码/链接获取 fileset_id（get_fileset_id）。code→UUID 不走 OIDB，QQ 客户端
	* 走 trpc HTTP API；分享页 qfile.qq.com/q/<code> 的 HTML 内嵌了 fileset_id（trpc
	* 接口数据），直接 GET + 正则提取即可，无需复刻带签名的 trpc 调用。
	*/
	async getFilesetIdByCode(shareCode) {
		const url = officialQfileShareUrl(shareCode);
		let resp;
		try {
			resp = await fetch(url, {
				redirect: "manual",
				signal: AbortSignal.timeout(QFILE_SHARE_TIMEOUT_MS)
			});
		} catch (error) {
			if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) throw new Error("get_fileset_id: share page request timed out", { cause: error });
			throw error;
		}
		if (resp.status >= 300 && resp.status < 400) await rejectShareResponse(resp, /* @__PURE__ */ new Error("get_fileset_id: share page redirect is not allowed"));
		if (!resp.ok) await rejectShareResponse(resp, /* @__PURE__ */ new Error(`get_fileset_id: HTTP ${resp.status}`));
		const html = await readSharePage(resp);
		const m = /fileset_id\\?"\s*:\s*\\?"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(html);
		if (!m) throw new Error("get_fileset_id: fileset_id not found in share page");
		return m[1];
	}
	/**
	* 文件扩展名 → 闪传类型码。typeCode 用于 0x93cf f3（卡片粗类：压缩包/媒体）；
	* formatCode 用于 0x93d0 commit f7 与 0x12a9 filesetWrap.f7，决定对端图标
	* （png=26，mp4=2，zip=4，未知=11）。
	*/
	static fileTypeCode(fileName) {
		const ext = fileName.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
		return {
			typeCode: flashApplyTypeCode(ext),
			formatCode: flashFormatCode(ext)
		};
	}
	/** 构造 sub=103 的 fileId（客户端生成的 protobuf，base64url 编码）。
	*  f2=SHA1, f3=filesize, f4=appid, f5=微秒时间戳, f6="prod",
	*  f10=TTL(1209600), f11=16B 会话ID, f15=3B, f16="gz"。
	*  f11/f15 随机生成，服务端不校验。
	*  appid 决定 fileId 落在哪个槽位：主文件用 14901（0x93d4 f14.f1），
	*  png 缩略图用 14903、jpg 缩略图用 14902（f13.f1）。主文件必须用 14901，
	*  否则 fileId 不会被服务端采纳进 f14，对端无法拿到主文件下载入口。 */
	static buildFileId(sha1, fileSize, appid = 14901) {
		const fileId = {
			sha1: new Uint8Array(sha1),
			fileSize,
			appid,
			timestamp: BigInt(Date.now()) * 1000n,
			env: "prod",
			ttl: 1209600,
			sessionId: randomBytes(16),
			field15: randomBytes(3),
			region: "gz"
		};
		return Buffer.from(protobuf_encode_FlashFileId(fileId)).toString("base64url");
	}
	/**
	* 创建闪传任务（create_flash_task）。所有文件统一走 sub=100/103+sliceupload，
	* 不走小文件 PUT——QQ 客户端即使几百 KB 的文件也走 sliceupload。只有 sliceupload
	* 路径会上报主文件 sha1/size，服务端据此把 fileset 标记为完成（对端可下载）；
	* PUT 路径不上报 sha1，fileset 会卡在"上传中"无法被下载。
	*
	* 多文件：0x93d0 的 f4 是 repeated，一个 commit 请求同时携带 fileset 内所有文件
	* 条目，每条 f6=文件序号（1,2,3...）。commit 在上传前只发一次，之后 complete →
	* 逐个 prepare/apply/sliceupload。prepare/apply 的 filesetWrap.f4 必须与 commit
	* 的 f6 一致，否则文件不计入 fileset。ApplyFileset 的 fileName 是 fileset 显示名
	* （卡片标题）：有 name 用 name，否则单文件用首文件名、多文件用「<首文件名>等N个文件」。
	* fileSize 用总和——服务端据此判定 fileset 为多文件。各文件在 commit 里用
	* 条目上的 name（若有），否则用路径 basename。
	*
	* 源文件经 stageSourceToDisk 落到本地路径后流式哈希 / 分片读取，不再经
	* loadBinarySource 整文件进内存。本地与 HTTP 上限与群文件相同（4 GiB）；
	* 内联 base64 仍按 1 GiB 封顶，因为 stage 解码时会占用等量 RAM。
	*/
	async createFlashTask(files, name, _thumbPath) {
		const fileList = normalizeFlashTaskInputs(files);
		if (fileList.length === 0) throw new Error("create_flash_task: files is empty");
		const uploader = {
			uin: this.ctx.identity.uin,
			nickname: this.ctx.identity.nickname,
			uid: await resolveSelfUid(this.ctx)
		};
		const items = [];
		try {
			for (let i = 0; i < fileList.length; i++) {
				const source = fileList[i].file;
				if (!source) throw new Error("create_flash_task: files is empty");
				const staged = await stageSourceToDisk(source, flashStageMaxBytes(source));
				const fileName = flashFileDisplayName(fileList[i].name, staged.fileName);
				const { formatCode } = FlashTransferApi.fileTypeCode(fileName);
				items.push({
					filePath: staged.filePath,
					fileSize: staged.fileSize,
					fileName,
					fileUuid: randomUUID(),
					fileIndex: i + 1,
					formatCode,
					guardStat: await promises.stat(staged.filePath),
					cleanup: () => staged.cleanup()
				});
				if (staged.fileSize === 0) throw new Error("create_flash_task: file is empty");
			}
			const first = items[0];
			const { typeCode } = FlashTransferApi.fileTypeCode(first.fileName);
			const isMulti = items.length > 1;
			const filesetName = name?.trim() || (isMulti ? `${first.fileName}等${items.length}个文件` : first.fileName);
			const totalSize = items.reduce((s, it) => s + it.fileSize, 0);
			const filesetUuid = (await ApplyFileset.invoke(this.ctx, {
				fileName: filesetName,
				origName: filesetName,
				fileSize: totalSize,
				typeCode,
				uploader
			})).filesetUuid;
			if (!filesetUuid) throw new Error("apply fileset failed: missing uuid");
			const commitEntries = items.map((it) => ({
				fileUuid: it.fileUuid,
				fileName: it.fileName,
				origName: it.fileName,
				fileSize: it.fileSize,
				formatCode: it.formatCode,
				fileIndex: it.fileIndex
			}));
			await CommitFile.invoke(this.ctx, {
				filesetUuid,
				entries: commitEntries
			});
			await CompleteFileset.invoke(this.ctx, { filesetUuid });
			const prepared = [];
			for (const it of items) {
				const p = await this.prepareAndApply(filesetUuid, it);
				if (p) prepared.push({
					it,
					...p
				});
			}
			for (const p of prepared) {
				await assertUnchanged$1(p.it.filePath, p.it.guardStat);
				await this.sliceuploadFile(p.it.filePath, p.it.fileSize, p.rkey, p.sha1StateV, p.sliceCount, p.it.fileName);
			}
			await this.uploadThumbnail(filesetUuid, items[0].fileUuid, "png", items.length + 1);
			await this.uploadThumbnail(filesetUuid, items[0].fileUuid, "jpg", items.length + 2);
			await SetFilesetStatus.invoke(this.ctx, { filesetUuid });
			return { filesetId: filesetUuid };
		} finally {
			await Promise.all(items.map((it) => it.cleanup()));
		}
	}
	/**
	* 阶段1：流式哈希 + prepare（拿 rkey）+ apply（注册 fileId）。
	* 秒传时 prepare 不回 rkey，仍必须 apply，否则 fileset 会一直停在等待上传；
	* 返回 null 只表示调用方跳过 sliceupload。
	*/
	async prepareAndApply(filesetUuid, it) {
		const hashes = await hashFlashFileStreaming(it.filePath);
		await assertUnchanged$1(it.filePath, it.guardStat);
		const rkey = await PrepareUpload.invoke(this.ctx, {
			filesetUuid,
			fileUuid: it.fileUuid,
			fileName: it.fileName,
			fileSize: it.fileSize,
			sha1: hashes.sha1Hex,
			fileIndex: it.fileIndex,
			formatCode: it.formatCode
		});
		const fileId = FlashTransferApi.buildFileId(hashes.sha1, it.fileSize);
		await ApplyUpload.invoke(this.ctx, {
			filesetUuid,
			fileUuid: it.fileUuid,
			fileId,
			fileName: it.fileName,
			fileSize: it.fileSize,
			md5: hashes.md5Hex,
			sha1: hashes.sha1Hex,
			fileIndex: it.fileIndex,
			formatCode: it.formatCode
		});
		if (rkey === null) return null;
		return {
			rkey,
			sha1StateV: hashes.sha1StateV,
			sliceCount: hashes.sliceCount
		};
	}
	/**
	* 阶段2：从磁盘按 1 MiB 切片 POST sliceupload（所有文件 prepare+apply 完成后调用）。
	*/
	async sliceuploadFile(filePath, fileSize, rkey, sha1StateV, sliceCount, fileName) {
		const src = await FileChunkSource.open(filePath, fileSize);
		try {
			for (let i = 0; i < sliceCount; i++) {
				const start = i * FLASH_SLICE_SIZE;
				const chunkLen = Math.min(FLASH_SLICE_SIZE, fileSize - start);
				const chunk = await src.read(start, chunkLen);
				const chunkSha1 = new Uint8Array(createHash("sha1").update(Buffer.from(chunk)).digest());
				const bodyBytes = protobuf_encode_FlashSliceUploadBody({
					field1: 0,
					appid: 14901,
					field3: 2,
					payload: {
						field1: {},
						rkey,
						start,
						end: start + chunkLen - 1,
						sha1: chunkSha1,
						sha1StateV: { state: sha1StateV.map((s) => new Uint8Array(s)) },
						chunk: new Uint8Array(chunk)
					}
				});
				await this.postSliceupload(bodyBytes, `${fileName} slice ${i}`);
			}
		} finally {
			await src.close();
		}
	}
	/**
	* POST sliceupload 并校验响应。服务端即使 HTTP 200 也可能在业务体里返回错误，
	* 所以必须解析 f5(status)，非 "success" 视为失败。label 用于错误信息定位切片来源。
	*/
	async postSliceupload(bodyBytes, label) {
		const resp = await fetch("https://multimedia.qfile.qq.com/sliceupload", {
			method: "POST",
			body: bodyBytes,
			headers: {
				Accept: "*/*",
				Connection: "Keep-Alive",
				"User-Agent": "Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.2)",
				Pragma: "no-cache",
				"Cache-Control": "no-cache",
				"Content-Length": String(bodyBytes.length),
				"X-Retried-Times": "1"
			}
		});
		if (!resp.ok) {
			const errBody = await resp.text().catch(() => "");
			throw new Error(`${label} failed: HTTP ${resp.status} ${errBody.slice(0, 300)}`);
		}
		const sliceResp = protobuf_decode_FlashSliceUploadResp(new Uint8Array(await resp.arrayBuffer()));
		if (sliceResp.status !== "success") throw new Error(`${label} failed: ${sliceResp.status || "no status in response"}`);
	}
	/**
	* 上传占位缩略图（png+jpg）。主文件上传后调用——主文件下载入口（0x93d3 的下载
	* fileId）需要缩略图关联才会被服务端填充，不传缩略图时 bot 自身上传的 fileset
	* 无法被 download_fileset 解析。缩略图用随机纯色 PNG，无需 ffmpeg/sharp。
	* fileIndex 为缩略图在 fileset 内的序号（主文件之后递增），与 commit f6 对齐。
	*/
	async uploadThumbnail(filesetUuid, mainFileUuid, thumbType, fileIndex) {
		const width = 526, height = 360;
		const thumbBytes = generatePng(width, height);
		const appid = thumbType === "png" ? 14903 : 14902;
		const fileUuid = thumbType === "png" ? randomUUID() : mainFileUuid;
		const fileName = thumbType === "png" ? `${randomUUID().slice(0, 8)}_one.png` : `${createHash("md5").update(thumbBytes).digest("hex").slice(0, 32)}.jpg`;
		const hashes = computeHashes(new Uint8Array(thumbBytes));
		const fileSize = thumbBytes.length;
		const thumbFormatCode = thumbType === "png" ? 26 : 2;
		const rkey = await PrepareUpload.invoke(this.ctx, {
			filesetUuid,
			fileUuid,
			fileName,
			fileSize,
			sha1: hashes.sha1Hex,
			fileIndex,
			formatCode: thumbFormatCode,
			thumbType,
			width,
			height
		});
		const fileId = FlashTransferApi.buildFileId(hashes.sha1, fileSize, appid);
		await ApplyUpload.invoke(this.ctx, {
			filesetUuid,
			fileUuid,
			fileId,
			fileName,
			fileSize,
			md5: hashes.md5Hex,
			sha1: hashes.sha1Hex,
			fileIndex,
			formatCode: thumbFormatCode,
			thumbType,
			width,
			height
		});
		if (rkey === null) return;
		const sha1StateV = computeSha1StateV(new Uint8Array(thumbBytes), 1, fileSize);
		const bodyBytes = protobuf_encode_FlashSliceUploadBody({
			field1: 0,
			appid,
			field3: 2,
			payload: {
				field1: {},
				rkey,
				start: 0,
				end: fileSize - 1,
				sha1: new Uint8Array(hashes.sha1),
				sha1StateV: { state: sha1StateV.map((s) => new Uint8Array(s)) },
				chunk: new Uint8Array(thumbBytes)
			}
		});
		await this.postSliceupload(bodyBytes, "thumbnail sliceupload");
	}
};
