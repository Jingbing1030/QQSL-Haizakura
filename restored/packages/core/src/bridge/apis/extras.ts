init_ffmpeg_addon();
init_utils();
init_logger();
var __td$109 = new TextDecoder();
var __te$105 = new TextEncoder();
var __nonAscii$105 = /[^\x00-\x7f]/;
var __utf8Scratch$105;
var __tdStrict$109 = new TextDecoder("utf-8", { fatal: true });
function __utf8LenLong$105(value) {
	const buffer = __utf8Scratch$105 ??= /* @__PURE__ */ new Uint8Array(4096);
	let length = 0;
	for (;;) {
		const result = __te$105.encodeInto(value, buffer);
		length += result.written;
		if (result.read === value.length) return length;
		value = value.slice(result.read);
	}
}
function __utf8Len$105(value) {
	if (value.length >= 32) return __utf8LenLong$105(value);
	if (value.length >= 8 && value.charCodeAt(0) < 128 && !__nonAscii$105.test(value)) return value.length;
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
function __utf8Write$105(buf, offset, value) {
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
function __utf8WriteLong$105(buf, offset, value) {
	return offset + __te$105.encodeInto(value, buf.subarray(offset)).written;
}
function __asciiWrite$105(buf, offset, value) {
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
function __utf8ReadLong$109(data, start, end) {
	const bytes = data.subarray(start, end);
	if (end - start < 128) return __td$109.decode(bytes);
	try {
		return __tdStrict$109.decode(bytes);
	} catch {
		return __td$109.decode(bytes);
	}
}
function __utf8Read$109(data, start, end) {
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
			if ((b & 192) !== 128) return __td$109.decode(data.subarray(start, end));
			value += String.fromCharCode((a & 31) << 6 | b & 63);
		} else if (a >= 224 && a < 240 && offset + 1 < end) {
			const b = data[offset++], c = data[offset++];
			if ((b & 192) !== 128 || (c & 192) !== 128 || a === 224 && b < 160 || a === 237 && b >= 160) return __td$109.decode(data.subarray(start, end));
			const code = (a & 15) << 12 | (b & 63) << 6 | c & 63;
			if (code !== 65279 || offset !== start + 3) value += String.fromCharCode(code);
		} else if (a >= 240 && a < 245 && offset + 2 < end) {
			const b = data[offset++], c = data[offset++], d = data[offset++];
			if ((b & 192) !== 128 || (c & 192) !== 128 || (d & 192) !== 128 || a === 240 && b < 144 || a === 244 && b >= 144) return __td$109.decode(data.subarray(start, end));
			const code = ((a & 7) << 18 | (b & 63) << 12 | (c & 63) << 6 | d & 63) - 65536;
			value += String.fromCharCode(55296 | code >>> 10, 56320 | code & 1023);
		} else return __td$109.decode(data.subarray(start, end));
	}
	return value;
}
var __pool$107;
var __poolOffset$107 = 0;
function __allocate$107(size) {
	if (size > 4096) return new Uint8Array(size);
	let buffer = __pool$107;
	if (!buffer || __poolOffset$107 + size > buffer.length) {
		buffer = __pool$107 = /* @__PURE__ */ new Uint8Array(8192);
		__poolOffset$107 = 0;
	}
	const start = __poolOffset$107;
	__poolOffset$107 += size;
	return buffer.subarray(start, start + size);
}
function __readVarint32$110(data, offset, end) {
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
function __skipVarint$110(data, offset, end) {
	for (let i = 0; i < 10; i++) {
		if (offset >= end) throw new Error("protobuf truncated varint");
		const byte = data[offset++];
		if (i === 9 && byte > 1) throw new Error("protobuf varint overflow");
		if ((byte & 128) === 0) return offset;
	}
	throw new Error("protobuf varint overflow");
}
function __checkedEnd$110(offset, length, end) {
	if (length > end - offset) throw new Error("protobuf length-delimited field exceeds parent bounds");
	return offset + length;
}
function __skipUnknownField$110(data, offset, end, wireType, fieldNumber, depth = 0) {
	if (depth > 64) throw new Error("protobuf group nesting exceeds 64");
	if (wireType === 0) return __skipVarint$110(data, offset, end);
	if (wireType === 1) {
		if (end - offset < 8) throw new Error("protobuf truncated fixed64 field");
		return offset + 8;
	}
	if (wireType === 2) {
		const [length, next] = __readVarint32$110(data, offset, end);
		return __checkedEnd$110(next, length, end);
	}
	if (wireType === 3) {
		while (offset < end) {
			const [tag, next] = __readVarint32$110(data, offset, end);
			offset = next;
			const nestedField = tag >>> 3;
			const nestedWire = tag & 7;
			if (nestedField === 0) throw new Error("protobuf field number 0 is invalid");
			if (nestedWire === 4) {
				if (nestedField !== fieldNumber) throw new Error("protobuf mismatched end-group tag");
				return offset;
			}
			offset = __skipUnknownField$110(data, offset, end, nestedWire, nestedField, depth + 1);
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
function __varint64Size$41(value) {
	if (value < 128n) return 1;
	const hi = Number(value >> 32n);
	return ((hi ? 64 - Math.clz32(hi) : 32 - Math.clz32(Number(value))) + 6) / 7 | 0;
}
function __writeVarint64$41(buf, offset, value) {
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
function protobuf_encode_PttTransReq(obj) {
	const sizes = [1];
	const size = __size_PttTransReq(obj, sizes);
	const buf = size <= 64 ? new Uint8Array(size) : __allocate$107(size);
	__write_PttTransReq(obj, buf, 0, sizes);
	return buf;
}
function __size_PttTransReq(obj, sizes) {
	let size = 0;
	const _f0 = obj["type"];
	const _f1 = obj["groupItem"];
	const _f2 = obj["c2cItem"];
	if (_f0 != null && _f0 !== 0) {
		const _val = _f0 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f1 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_GroupPttTransItem(_f1, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f2 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_C2CPttTransItem(_f2, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_PttTransReq(obj, buf, offset, sizes) {
	const _f0 = obj["type"];
	const _f1 = obj["groupItem"];
	const _f2 = obj["c2cItem"];
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
	if (_f1 != null) {
		buf[offset++] = 18;
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
		offset = __write_GroupPttTransItem(_f1, buf, offset, sizes);
	}
	if (_f2 != null) {
		buf[offset++] = 26;
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
		offset = __write_C2CPttTransItem(_f2, buf, offset, sizes);
	}
	return offset;
}
function __size_GroupPttTransItem(obj, sizes) {
	let size = 0;
	const _f0 = obj["msgId"];
	const _f1 = obj["senderUin"];
	const _f2 = obj["groupUin"];
	const _f3 = obj["fileId"];
	const _f4 = obj["md5"];
	const _f5 = obj["duration"];
	const _f6 = obj["size"];
	const _f7 = obj["format"];
	const _f8 = obj["uuid"];
	const _f9 = obj["eventType"];
	const _f10 = obj["ext"];
	if (_f0 != null && _f0 !== 0n) size += 1 + __varint64Size$41(BigInt.asUintN(64, _f0));
	if (_f1 != null && _f1 !== 0n) size += 1 + __varint64Size$41(BigInt.asUintN(64, _f1));
	if (_f2 != null && _f2 !== 0n) size += 1 + __varint64Size$41(BigInt.asUintN(64, _f2));
	if (_f3 != null && _f3 !== 0) {
		const _val = _f3 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f4 != null && _f4 !== "") {
		const _len = __utf8Len$105(_f4);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f5 != null && _f5 !== 0) {
		const _val = _f5 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f6 != null && _f6 !== 0) {
		const _val = _f6 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f7 != null && _f7 !== 0) {
		const _val = _f7 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f8 != null && _f8 !== "") {
		const _len = __utf8Len$105(_f8);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f9 != null && _f9 !== 0) {
		const _val = _f9 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f10 != null && _f10 !== 0) {
		const _val = _f10 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_GroupPttTransItem(obj, buf, offset, sizes) {
	const _f0 = obj["msgId"];
	const _f1 = obj["senderUin"];
	const _f2 = obj["groupUin"];
	const _f3 = obj["fileId"];
	const _f4 = obj["md5"];
	const _f5 = obj["duration"];
	const _f6 = obj["size"];
	const _f7 = obj["format"];
	const _f8 = obj["uuid"];
	const _f9 = obj["eventType"];
	const _f10 = obj["ext"];
	if (_f0 != null && _f0 !== 0n) {
		buf[offset++] = 8;
		offset = __writeVarint64$41(buf, offset, BigInt.asUintN(64, _f0));
	}
	if (_f1 != null && _f1 !== 0n) {
		buf[offset++] = 16;
		offset = __writeVarint64$41(buf, offset, BigInt.asUintN(64, _f1));
	}
	if (_f2 != null && _f2 !== 0n) {
		buf[offset++] = 24;
		offset = __writeVarint64$41(buf, offset, BigInt.asUintN(64, _f2));
	}
	if (_f3 != null && _f3 !== 0) {
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
		offset = _len >= 128 ? __utf8WriteLong$105(buf, offset, _f4) : _len === _f4.length ? __asciiWrite$105(buf, offset, _f4) : __utf8Write$105(buf, offset, _f4);
	}
	if (_f5 != null && _f5 !== 0) {
		buf[offset++] = 48;
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
	if (_f6 != null && _f6 !== 0) {
		buf[offset++] = 56;
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
	if (_f7 != null && _f7 !== 0) {
		buf[offset++] = 64;
		let _v = _f7 >>> 0;
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
	if (_f8 != null && _f8 !== "") {
		buf[offset++] = 74;
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
		offset = _len >= 128 ? __utf8WriteLong$105(buf, offset, _f8) : _len === _f8.length ? __asciiWrite$105(buf, offset, _f8) : __utf8Write$105(buf, offset, _f8);
	}
	if (_f9 != null && _f9 !== 0) {
		buf[offset++] = 80;
		let _v = _f9 >>> 0;
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
	if (_f10 != null && _f10 !== 0) {
		buf[offset++] = 88;
		let _v = _f10 >>> 0;
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
function __size_C2CPttTransItem(obj, sizes) {
	let size = 0;
	const _f0 = obj["msgId"];
	const _f1 = obj["senderUin"];
	const _f2 = obj["receiverUin"];
	const _f3 = obj["uuid"];
	const _f4 = obj["duration"];
	const _f5 = obj["size"];
	const _f6 = obj["format"];
	const _f7 = obj["eventType"];
	const _f8 = obj["md5"];
	if (_f0 != null && _f0 !== 0n) size += 1 + __varint64Size$41(BigInt.asUintN(64, _f0));
	if (_f1 != null && _f1 !== 0n) size += 1 + __varint64Size$41(BigInt.asUintN(64, _f1));
	if (_f2 != null && _f2 !== 0n) size += 1 + __varint64Size$41(BigInt.asUintN(64, _f2));
	if (_f3 != null && _f3 !== "") {
		const _len = __utf8Len$105(_f3);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f4 != null && _f4 !== 0) {
		const _val = _f4 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f5 != null && _f5 !== 0) {
		const _val = _f5 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f6 != null && _f6 !== 0) {
		const _val = _f6 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f7 != null && _f7 !== 0) {
		const _val = _f7 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f8 != null && _f8 !== "") {
		const _len = __utf8Len$105(_f8);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_C2CPttTransItem(obj, buf, offset, sizes) {
	const _f0 = obj["msgId"];
	const _f1 = obj["senderUin"];
	const _f2 = obj["receiverUin"];
	const _f3 = obj["uuid"];
	const _f4 = obj["duration"];
	const _f5 = obj["size"];
	const _f6 = obj["format"];
	const _f7 = obj["eventType"];
	const _f8 = obj["md5"];
	if (_f0 != null && _f0 !== 0n) {
		buf[offset++] = 8;
		offset = __writeVarint64$41(buf, offset, BigInt.asUintN(64, _f0));
	}
	if (_f1 != null && _f1 !== 0n) {
		buf[offset++] = 16;
		offset = __writeVarint64$41(buf, offset, BigInt.asUintN(64, _f1));
	}
	if (_f2 != null && _f2 !== 0n) {
		buf[offset++] = 24;
		offset = __writeVarint64$41(buf, offset, BigInt.asUintN(64, _f2));
	}
	if (_f3 != null && _f3 !== "") {
		buf[offset++] = 34;
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
		offset = _len >= 128 ? __utf8WriteLong$105(buf, offset, _f3) : _len === _f3.length ? __asciiWrite$105(buf, offset, _f3) : __utf8Write$105(buf, offset, _f3);
	}
	if (_f4 != null && _f4 !== 0) {
		buf[offset++] = 40;
		let _v = _f4 >>> 0;
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
	if (_f5 != null && _f5 !== 0) {
		buf[offset++] = 48;
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
	if (_f6 != null && _f6 !== 0) {
		buf[offset++] = 56;
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
	if (_f7 != null && _f7 !== 0) {
		buf[offset++] = 64;
		let _v = _f7 >>> 0;
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
	if (_f8 != null && _f8 !== "") {
		buf[offset++] = 74;
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
		offset = _len >= 128 ? __utf8WriteLong$105(buf, offset, _f8) : _len === _f8.length ? __asciiWrite$105(buf, offset, _f8) : __utf8Write$105(buf, offset, _f8);
	}
	return offset;
}
function protobuf_decode_PttTransResp(data, offset = 0, end = data.length) {
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
				_f1 = protobuf_decode_GroupPttTransResult(data, offset, offset + _len);
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
				_f2 = protobuf_decode_C2CPttTransResult(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$110(data, offset, end, wireType, _tag >>> 3);
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
		"groupResult": _f1,
		"c2cResult": _f2
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
function protobuf_decode_GroupPttTransResult(data, offset = 0, end = data.length) {
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
				_f1 = _len <= 32 ? __utf8Read$109(data, offset, offset + _len) : __utf8ReadLong$109(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$110(data, offset, end, wireType, _tag >>> 3);
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
		"errCode": _f0,
		"text": _f1
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
function protobuf_decode_C2CPttTransResult(data, offset = 0, end = data.length) {
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
				_f0 = _val;
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
				_f1 = _len <= 32 ? __utf8Read$109(data, offset, offset + _len) : __utf8ReadLong$109(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$110(data, offset, end, wireType, _tag >>> 3);
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
		"errCode": _f0,
		"text": _f1
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
var log$44 = createLogger("Bridge.Extras");
var AI_VOICE_RECEIPT_TIMEOUT_MS = 5e3;
var AI_VOICE_CANDIDATE_LIMIT = 64;
var AI_VOICE_CLAIM_LIMIT = 256;
function normalizeMediaUuid(value) {
	return typeof value === "string" ? value.trim() : "";
}
function matchesAiVoiceEvent(node, event) {
	const expectedUuid = normalizeMediaUuid(node.fileUuid);
	if (!expectedUuid) return false;
	for (const element of event.elements) {
		if (element.type !== "record") continue;
		if (normalizeMediaUuid(element.mediaNode?.fileUuid || element.fileId) === expectedUuid) return true;
	}
	return false;
}
function describeAiVoiceFingerprint(node) {
	const uuid = normalizeMediaUuid(node.fileUuid);
	if (uuid) return `uuid:${uuid.slice(-12)}`;
	return "missing";
}
var ExtrasApi = class {
	ctx;
	claimedAiVoiceReceiptKeys = /* @__PURE__ */ new Set();
	constructor(ctx) {
		this.ctx = ctx;
	}
	async getGroupTodoList(groupId) {
		const items = await GetGroupTodoList.invoke(this.ctx, { groupId });
		log$44.debug("group todo list fetched group=%d count=%d", groupId, items.length);
		return items;
	}
	setGroupTodo(groupId, msgSeq) {
		return GroupTodo.invoke(this.ctx, {
			groupId,
			msgSeq,
			action: "set"
		});
	}
	completeGroupTodo(groupId, msgSeq) {
		return GroupTodo.invoke(this.ctx, {
			groupId,
			msgSeq,
			action: "complete"
		});
	}
	cancelGroupTodo(groupId, msgSeq) {
		return GroupTodo.invoke(this.ctx, {
			groupId,
			msgSeq,
			action: "cancel"
		});
	}
	/**
	* Keeps the action response user-safe while retaining the underlying
	* failure in the service log for diagnosis.
	*/
	async getStrangerStatus(uin) {
		try {
			const status = await GetStrangerStatus.invoke(this.ctx, { uin });
			if (!status) log$44.warn("user status query returned no status target=%d", uin);
			return status;
		} catch (error) {
			log$44.warn("user status query failed target=%d: %s", uin, error instanceof Error ? error.message : String(error));
			return null;
		}
	}
	fetchAiVoiceList(groupId, chatType) {
		return FetchAiVoiceList.invoke(this.ctx, {
			groupId,
			chatType
		});
	}
	/**
	* Trigger AI voice synthesis. Server may return an empty msgInfo while
	* the render is in-flight; we retry until a node materialises or the
	* cap is hit. napcat uses the same 30-retry budget.
	*
	* The returned node plugs directly into
	* `apis.groupFile.getPttUrl`, which already handles every other
	* download-URL fetch in Haizakura. The synthesis response does not contain a
	* reliable message sequence; callers that need one must use `sendAiVoice`,
	* which correlates the subsequent self-message receipt.
	*/
	async fetchAiVoice(groupId, voiceId, text, chatType, maxRetries = 30) {
		const sessionId = Math.floor(Math.random() * 4294967295) >>> 0;
		for (let i = 0; i < maxRetries; i++) {
			const node = await FetchAiVoice.invoke(this.ctx, {
				groupId,
				voiceId,
				text,
				chatType,
				sessionId
			});
			if (node) {
				log$44.debug("AI voice synthesis completed group=%d media=%s polls=%d", groupId, describeAiVoiceFingerprint(node), i + 1);
				return node;
			}
		}
		throw new Error(`AI voice synthesis did not complete after ${maxRetries} polls`);
	}
	/**
	* Publish an AI voice and wait for QQ's canonical self-message receipt.
	*
	* The 0x929B completion response carries the media node but, on live QQ,
	* omits the group message sequence. Subscribe before publishing so an echo
	* that wins the response race is buffered, then correlate by the exact media
	* UUID. Never guess from content hashes or "the next voice in the group":
	* concurrent requests can legitimately render byte-identical audio.
	*/
	async sendAiVoice(groupId, voiceId, text, chatType, receiptTimeoutMs = AI_VOICE_RECEIPT_TIMEOUT_MS) {
		const candidates = [];
		let candidatesOverflowed = false;
		let expectedNode = null;
		let receiptSettled = false;
		let resolveReceipt = null;
		const receiptPromise = new Promise((resolve) => {
			resolveReceipt = resolve;
		});
		const claim = (event) => {
			if (receiptSettled) return false;
			const key = `${event.groupId}:${event.msgSeq}:${event.msgId}`;
			if (this.claimedAiVoiceReceiptKeys.has(key)) return false;
			this.claimedAiVoiceReceiptKeys.add(key);
			if (this.claimedAiVoiceReceiptKeys.size > AI_VOICE_CLAIM_LIMIT) {
				const oldest = this.claimedAiVoiceReceiptKeys.values().next().value;
				if (oldest !== void 0) this.claimedAiVoiceReceiptKeys.delete(oldest);
			}
			receiptSettled = true;
			return true;
		};
		const accept = (event) => {
			if (event.groupId !== groupId || event.senderUin !== event.selfUin) return;
			if (!event.elements.some((element) => element.type === "record")) return;
			if (expectedNode && matchesAiVoiceEvent(expectedNode, event) && claim(event)) {
				resolveReceipt?.(event);
				return;
			}
			candidates.push(event);
			if (candidates.length > AI_VOICE_CANDIDATE_LIMIT) {
				candidates.shift();
				candidatesOverflowed = true;
			}
		};
		const unsubscribe = this.ctx.events.on("group_message", accept);
		let timeout = null;
		try {
			const node = await this.fetchAiVoice(groupId, voiceId, text, chatType);
			expectedNode = node;
			const fingerprint = describeAiVoiceFingerprint(node);
			if (fingerprint === "missing") throw new Error("AI voice was published but QQ returned no exact media identifier for receipt correlation");
			const buffered = candidates.find((event) => matchesAiVoiceEvent(node, event) && claim(event));
			if (!buffered && candidatesOverflowed) throw new Error(`AI voice was published but receipt correlation overflowed after ${AI_VOICE_CANDIDATE_LIMIT} unmatched self voice messages (group=${groupId} media=${fingerprint})`);
			const event = buffered ?? await Promise.race([receiptPromise, new Promise((_resolve, reject) => {
				timeout = setTimeout(() => {
					reject(/* @__PURE__ */ new Error(`AI voice was published but no matching group-message receipt arrived within ${receiptTimeoutMs}ms (group=${groupId} media=${fingerprint})`));
				}, receiptTimeoutMs);
				timeout.unref();
			})]);
			if (!Number.isInteger(event.msgSeq) || event.msgSeq <= 0) throw new Error(`AI voice receipt carried invalid message sequence: ${event.msgSeq}`);
			log$44.debug("AI voice receipt matched group=%d media=%s sequence=%d random=%d", groupId, fingerprint, event.msgSeq, event.msgId);
			return { sequence: event.msgSeq };
		} finally {
			if (timeout) clearTimeout(timeout);
			unsubscribe();
		}
	}
	/**
	* Send ONE `pttTrans.Trans{C2C,Group}PttReq` to trigger transcription and
	* return the recognised text IF the response carries it inline (the
	* already-transcribed case). For a freshly-received voice the response is an
	* empty ack and the text is delivered later via the async Event 0x210
	* subType-61 push — callers should treat `''` as "pending" and wait for the
	* `ptt_trans_result` event (correlated by msgId).
	*/
	async translatePttToText(input) {
		const md5 = input.md5Hex.toLowerCase();
		const req = input.isGroup ? {
			type: 1,
			groupItem: {
				msgId: BigInt(input.msgId),
				senderUin: BigInt(input.senderUin),
				groupUin: BigInt(input.peerUin),
				fileId: input.fileId ?? 0,
				md5,
				duration: input.duration,
				size: input.size,
				format: input.format,
				uuid: input.uuid
			}
		} : {
			type: 2,
			c2cItem: {
				msgId: BigInt(input.msgId),
				senderUin: BigInt(input.senderUin),
				receiverUin: BigInt(input.peerUin),
				uuid: input.uuid,
				duration: input.duration,
				size: input.size,
				format: input.format,
				md5
			}
		};
		const cmd = input.isGroup ? "pttTrans.TransGroupPttReq" : "pttTrans.TransC2CPttReq";
		const result = await this.ctx.sendRawPacket(cmd, protobuf_encode_PttTransReq(req));
		if (!result.success || !result.gotResponse || !result.responseData) throw new Error(result.errorMessage || "ptt translate request failed");
		const resp = protobuf_decode_PttTransResp(result.responseData);
		const item = input.isGroup ? resp?.groupResult : resp?.c2cResult;
		if (item?.errCode) {
			log$44.warn("ptt translate errCode=%d isGroup=%s md5=%s format=%d uuid=%s dur=%d size=%d", item.errCode, input.isGroup, input.md5Hex ? `${input.md5Hex.length / 2}B` : "EMPTY", input.format, input.uuid ? "set" : "EMPTY", input.duration, input.size);
			throw new Error(`ptt translate failed: error=${item.errCode}`);
		}
		return item?.text ?? "";
	}
	/**
	* Transcode a voice record (`get_record out_format`, #165). `source` is a
	* URL / local path / `base64://…` (the record's download URL in practice);
	* it is loaded then transcoded to `format` via the bundled SILK-capable
	* ffmpeg addon. Returns base64 + size. Throws on unsupported format or a
	* failed conversion.
	*/
	async convertRecord(source, format) {
		const { bytes } = await loadBinarySource(source, "record", 64 * 1024 * 1024);
		return convertAudioBytes(bytes, format);
	}
};
