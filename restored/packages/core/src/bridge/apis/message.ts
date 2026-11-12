init_logger();
var __td$19 = new TextDecoder();
var __te$21 = new TextEncoder();
var __nonAscii$21 = /[^\x00-\x7f]/;
var __utf8Scratch$21;
var __tdStrict$19 = new TextDecoder("utf-8", { fatal: true });
function __utf8LenLong$21(value) {
	const buffer = __utf8Scratch$21 ??= /* @__PURE__ */ new Uint8Array(4096);
	let length = 0;
	for (;;) {
		const result = __te$21.encodeInto(value, buffer);
		length += result.written;
		if (result.read === value.length) return length;
		value = value.slice(result.read);
	}
}
function __utf8Len$21(value) {
	if (value.length >= 32) return __utf8LenLong$21(value);
	if (value.length >= 8 && value.charCodeAt(0) < 128 && !__nonAscii$21.test(value)) return value.length;
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
function __utf8Write$21(buf, offset, value) {
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
function __utf8WriteLong$21(buf, offset, value) {
	return offset + __te$21.encodeInto(value, buf.subarray(offset)).written;
}
function __asciiWrite$21(buf, offset, value) {
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
function __utf8ReadLong$19(data, start, end) {
	const bytes = data.subarray(start, end);
	if (end - start < 128) return __td$19.decode(bytes);
	try {
		return __tdStrict$19.decode(bytes);
	} catch {
		return __td$19.decode(bytes);
	}
}
function __utf8Read$19(data, start, end) {
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
			if ((b & 192) !== 128) return __td$19.decode(data.subarray(start, end));
			value += String.fromCharCode((a & 31) << 6 | b & 63);
		} else if (a >= 224 && a < 240 && offset + 1 < end) {
			const b = data[offset++], c = data[offset++];
			if ((b & 192) !== 128 || (c & 192) !== 128 || a === 224 && b < 160 || a === 237 && b >= 160) return __td$19.decode(data.subarray(start, end));
			const code = (a & 15) << 12 | (b & 63) << 6 | c & 63;
			if (code !== 65279 || offset !== start + 3) value += String.fromCharCode(code);
		} else if (a >= 240 && a < 245 && offset + 2 < end) {
			const b = data[offset++], c = data[offset++], d = data[offset++];
			if ((b & 192) !== 128 || (c & 192) !== 128 || (d & 192) !== 128 || a === 240 && b < 144 || a === 244 && b >= 144) return __td$19.decode(data.subarray(start, end));
			const code = ((a & 7) << 18 | (b & 63) << 12 | (c & 63) << 6 | d & 63) - 65536;
			value += String.fromCharCode(55296 | code >>> 10, 56320 | code & 1023);
		} else return __td$19.decode(data.subarray(start, end));
	}
	return value;
}
var __pool$21;
var __poolOffset$21 = 0;
function __allocate$21(size) {
	if (size > 4096) return new Uint8Array(size);
	let buffer = __pool$21;
	if (!buffer || __poolOffset$21 + size > buffer.length) {
		buffer = __pool$21 = /* @__PURE__ */ new Uint8Array(8192);
		__poolOffset$21 = 0;
	}
	const start = __poolOffset$21;
	__poolOffset$21 += size;
	return buffer.subarray(start, start + size);
}
function __readVarint32$20(data, offset, end) {
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
function __skipVarint$20(data, offset, end) {
	for (let i = 0; i < 10; i++) {
		if (offset >= end) throw new Error("protobuf truncated varint");
		const byte = data[offset++];
		if (i === 9 && byte > 1) throw new Error("protobuf varint overflow");
		if ((byte & 128) === 0) return offset;
	}
	throw new Error("protobuf varint overflow");
}
function __checkedEnd$20(offset, length, end) {
	if (length > end - offset) throw new Error("protobuf length-delimited field exceeds parent bounds");
	return offset + length;
}
function __skipUnknownField$20(data, offset, end, wireType, fieldNumber, depth = 0) {
	if (depth > 64) throw new Error("protobuf group nesting exceeds 64");
	if (wireType === 0) return __skipVarint$20(data, offset, end);
	if (wireType === 1) {
		if (end - offset < 8) throw new Error("protobuf truncated fixed64 field");
		return offset + 8;
	}
	if (wireType === 2) {
		const [length, next] = __readVarint32$20(data, offset, end);
		return __checkedEnd$20(next, length, end);
	}
	if (wireType === 3) {
		while (offset < end) {
			const [tag, next] = __readVarint32$20(data, offset, end);
			offset = next;
			const nestedField = tag >>> 3;
			const nestedWire = tag & 7;
			if (nestedField === 0) throw new Error("protobuf field number 0 is invalid");
			if (nestedWire === 4) {
				if (nestedField !== fieldNumber) throw new Error("protobuf mismatched end-group tag");
				return offset;
			}
			offset = __skipUnknownField$20(data, offset, end, nestedWire, nestedField, depth + 1);
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
function __varint64Size$7(value) {
	if (value < 128n) return 1;
	const hi = Number(value >> 32n);
	return ((hi ? 64 - Math.clz32(hi) : 32 - Math.clz32(Number(value))) + 6) / 7 | 0;
}
function __writeVarint64$7(buf, offset, value) {
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
function __size_Elem(obj, sizes) {
	let size = 0;
	const _f0 = obj["text"];
	const _f1 = obj["face"];
	const _f2 = obj["onlineImage"];
	const _f3 = obj["notOnlineImage"];
	const _f4 = obj["transElem"];
	const _f5 = obj["marketFace"];
	const _f6 = obj["customFace"];
	const _f7 = obj["richMsg"];
	const _f8 = obj["groupFile"];
	const _f9 = obj["extraInfo"];
	const _f10 = obj["videoFile"];
	const _f11 = obj["generalFlags"];
	const _f12 = obj["srcMsg"];
	const _f13 = obj["lightApp"];
	const _f14 = obj["commonElem"];
	if (_f0 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_TextElem(_f0, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f1 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_FaceElem(_f1, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f2 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_OnlineImage(_f2, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f3 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_NotOnlineImage(_f3, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f4 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_TransElem(_f4, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f5 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_MarketFace(_f5, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f6 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_CustomFace(_f6, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f7 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_RichMsg(_f7, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f8 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_GroupFileElem(_f8, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f9 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_ExtraInfo(_f9, sizes);
		sizes[_slot] = _len;
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f10 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_VideoFile(_f10, sizes);
		sizes[_slot] = _len;
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f11 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_GeneralFlags(_f11, sizes);
		sizes[_slot] = _len;
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f12 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_SrcMsg(_f12, sizes);
		sizes[_slot] = _len;
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f13 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_LightAppElem(_f13, sizes);
		sizes[_slot] = _len;
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f14 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_CommonElem(_f14, sizes);
		sizes[_slot] = _len;
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_Elem(obj, buf, offset, sizes) {
	const _f0 = obj["text"];
	const _f1 = obj["face"];
	const _f2 = obj["onlineImage"];
	const _f3 = obj["notOnlineImage"];
	const _f4 = obj["transElem"];
	const _f5 = obj["marketFace"];
	const _f6 = obj["customFace"];
	const _f7 = obj["richMsg"];
	const _f8 = obj["groupFile"];
	const _f9 = obj["extraInfo"];
	const _f10 = obj["videoFile"];
	const _f11 = obj["generalFlags"];
	const _f12 = obj["srcMsg"];
	const _f13 = obj["lightApp"];
	const _f14 = obj["commonElem"];
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
		offset = __write_TextElem(_f0, buf, offset, sizes);
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
		offset = __write_FaceElem(_f1, buf, offset, sizes);
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
		offset = __write_OnlineImage(_f2, buf, offset, sizes);
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
		offset = __write_NotOnlineImage(_f3, buf, offset, sizes);
	}
	if (_f4 != null) {
		buf[offset++] = 42;
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
		offset = __write_TransElem(_f4, buf, offset, sizes);
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
		offset = __write_MarketFace(_f5, buf, offset, sizes);
	}
	if (_f6 != null) {
		buf[offset++] = 66;
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
		offset = __write_CustomFace(_f6, buf, offset, sizes);
	}
	if (_f7 != null) {
		buf[offset++] = 98;
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
		offset = __write_RichMsg(_f7, buf, offset, sizes);
	}
	if (_f8 != null) {
		buf[offset++] = 106;
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
		offset = __write_GroupFileElem(_f8, buf, offset, sizes);
	}
	if (_f9 != null) {
		buf[offset++] = 130;
		buf[offset++] = 1;
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
		offset = __write_ExtraInfo(_f9, buf, offset, sizes);
	}
	if (_f10 != null) {
		buf[offset++] = 154;
		buf[offset++] = 1;
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
		offset = __write_VideoFile(_f10, buf, offset, sizes);
	}
	if (_f11 != null) {
		buf[offset++] = 170;
		buf[offset++] = 2;
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
		offset = __write_GeneralFlags(_f11, buf, offset, sizes);
	}
	if (_f12 != null) {
		buf[offset++] = 234;
		buf[offset++] = 2;
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
		offset = __write_SrcMsg(_f12, buf, offset, sizes);
	}
	if (_f13 != null) {
		buf[offset++] = 154;
		buf[offset++] = 3;
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
		offset = __write_LightAppElem(_f13, buf, offset, sizes);
	}
	if (_f14 != null) {
		buf[offset++] = 170;
		buf[offset++] = 3;
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
		offset = __write_CommonElem(_f14, buf, offset, sizes);
	}
	return offset;
}
function __size_TextElem(obj, sizes) {
	let size = 0;
	const _f0 = obj["str"];
	const _f1 = obj["link"];
	const _f2 = obj["attr6Buf"];
	const _f3 = obj["attr7Buf"];
	const _f4 = obj["buf"];
	const _f5 = obj["pbReserve"];
	if (_f0 != null && _f0 !== "") {
		const _len = __utf8Len$21(_f0);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f1 != null && _f1 !== "") {
		const _len = __utf8Len$21(_f1);
		sizes.push(_len);
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
	return size;
}
function __write_TextElem(obj, buf, offset, sizes) {
	const _f0 = obj["str"];
	const _f1 = obj["link"];
	const _f2 = obj["attr6Buf"];
	const _f3 = obj["attr7Buf"];
	const _f4 = obj["buf"];
	const _f5 = obj["pbReserve"];
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f0) : _len === _f0.length ? __asciiWrite$21(buf, offset, _f0) : __utf8Write$21(buf, offset, _f0);
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f1) : _len === _f1.length ? __asciiWrite$21(buf, offset, _f1) : __utf8Write$21(buf, offset, _f1);
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
	return offset;
}
function __size_FaceElem(obj, sizes) {
	let size = 0;
	const _f0 = obj["index"];
	const _f1 = obj["oldData"];
	const _f2 = obj["buf"];
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
	if (_f2 != null && _f2.length > 0) {
		const _len = _f2.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_FaceElem(obj, buf, offset, sizes) {
	const _f0 = obj["index"];
	const _f1 = obj["oldData"];
	const _f2 = obj["buf"];
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
	if (_f2 != null && _f2.length > 0) {
		buf[offset++] = 90;
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
	return offset;
}
function __size_OnlineImage(obj, sizes) {
	let size = 0;
	const _f0 = obj["guid"];
	const _f1 = obj["filePath"];
	const _f2 = obj["oldVerSendFile"];
	if (_f0 != null && _f0.length > 0) {
		const _len = _f0.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f1 != null && _f1.length > 0) {
		const _len = _f1.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f2 != null && _f2.length > 0) {
		const _len = _f2.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_OnlineImage(obj, buf, offset, sizes) {
	const _f0 = obj["guid"];
	const _f1 = obj["filePath"];
	const _f2 = obj["oldVerSendFile"];
	if (_f0 != null && _f0.length > 0) {
		buf[offset++] = 10;
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
	return offset;
}
function __size_NotOnlineImage(obj, sizes) {
	let size = 0;
	const _f0 = obj["filePath"];
	const _f1 = obj["fileLen"];
	const _f2 = obj["downloadPath"];
	const _f3 = obj["oldVerSendFile"];
	const _f4 = obj["imgType"];
	const _f5 = obj["previewsImage"];
	const _f6 = obj["picMd5"];
	const _f7 = obj["picHeight"];
	const _f8 = obj["picWidth"];
	const _f9 = obj["resId"];
	const _f10 = obj["flag"];
	const _f11 = obj["thumbUrl"];
	const _f12 = obj["original"];
	const _f13 = obj["bigUrl"];
	const _f14 = obj["origUrl"];
	const _f15 = obj["bizType"];
	const _f16 = obj["result"];
	const _f17 = obj["index"];
	const _f18 = obj["opFaceBuf"];
	const _f19 = obj["oldPicMd5"];
	const _f20 = obj["thumbWidth"];
	const _f21 = obj["thumbHeight"];
	const _f22 = obj["fileId"];
	const _f23 = obj["showLen"];
	const _f24 = obj["downloadLen"];
	const _f25 = obj["x400Url"];
	const _f26 = obj["x400Width"];
	const _f27 = obj["x400Height"];
	const _f28 = obj["pbRes"];
	if (_f0 != null && _f0 !== "") {
		const _len = __utf8Len$21(_f0);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f1 != null && _f1 !== 0) {
		const _val = _f1 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f2 != null && _f2 !== "") {
		const _len = __utf8Len$21(_f2);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f3 != null && _f3.length > 0) {
		const _len = _f3.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f4 != null && _f4 !== 0) {
		const _val = _f4 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f5 != null && _f5.length > 0) {
		const _len = _f5.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f6 != null && _f6.length > 0) {
		const _len = _f6.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f7 != null && _f7 !== 0) {
		const _val = _f7 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f8 != null && _f8 !== 0) {
		const _val = _f8 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f9 != null && _f9 !== "") {
		const _len = __utf8Len$21(_f9);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f10 != null && _f10.length > 0) {
		const _len = _f10.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f11 != null && _f11 !== "") {
		const _len = __utf8Len$21(_f11);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f12 != null && _f12 !== 0) {
		const _val = _f12 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f13 != null && _f13 !== "") {
		const _len = __utf8Len$21(_f13);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f14 != null && _f14 !== "") {
		const _len = __utf8Len$21(_f14);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f15 != null && _f15 !== 0) {
		const _val = _f15 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f16 != null && _f16 !== 0) {
		const _val = _f16 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f17 != null && _f17 !== 0) {
		const _val = _f17 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f18 != null && _f18.length > 0) {
		const _len = _f18.length;
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f19 === true) size += 3;
	if (_f20 != null && _f20 !== 0) {
		const _val = _f20 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f21 != null && _f21 !== 0) {
		const _val = _f21 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f22 != null && _f22 !== 0) {
		const _val = _f22 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f23 != null && _f23 !== 0) {
		const _val = _f23 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f24 != null && _f24 !== 0) {
		const _val = _f24 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f25 != null && _f25 !== "") {
		const _len = __utf8Len$21(_f25);
		sizes.push(_len);
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f26 != null && _f26 !== 0) {
		const _val = _f26 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f27 != null && _f27 !== 0) {
		const _val = _f27 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f28 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_NotOnlineImagePbReserve(_f28, sizes);
		sizes[_slot] = _len;
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_NotOnlineImage(obj, buf, offset, sizes) {
	const _f0 = obj["filePath"];
	const _f1 = obj["fileLen"];
	const _f2 = obj["downloadPath"];
	const _f3 = obj["oldVerSendFile"];
	const _f4 = obj["imgType"];
	const _f5 = obj["previewsImage"];
	const _f6 = obj["picMd5"];
	const _f7 = obj["picHeight"];
	const _f8 = obj["picWidth"];
	const _f9 = obj["resId"];
	const _f10 = obj["flag"];
	const _f11 = obj["thumbUrl"];
	const _f12 = obj["original"];
	const _f13 = obj["bigUrl"];
	const _f14 = obj["origUrl"];
	const _f15 = obj["bizType"];
	const _f16 = obj["result"];
	const _f17 = obj["index"];
	const _f18 = obj["opFaceBuf"];
	const _f19 = obj["oldPicMd5"];
	const _f20 = obj["thumbWidth"];
	const _f21 = obj["thumbHeight"];
	const _f22 = obj["fileId"];
	const _f23 = obj["showLen"];
	const _f24 = obj["downloadLen"];
	const _f25 = obj["x400Url"];
	const _f26 = obj["x400Width"];
	const _f27 = obj["x400Height"];
	const _f28 = obj["pbRes"];
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f0) : _len === _f0.length ? __asciiWrite$21(buf, offset, _f0) : __utf8Write$21(buf, offset, _f0);
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
	if (_f2 != null && _f2 !== "") {
		buf[offset++] = 26;
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f2) : _len === _f2.length ? __asciiWrite$21(buf, offset, _f2) : __utf8Write$21(buf, offset, _f2);
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
	if (_f5 != null && _f5.length > 0) {
		buf[offset++] = 50;
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
	if (_f8 != null && _f8 !== 0) {
		buf[offset++] = 72;
		let _v = _f8 >>> 0;
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
	if (_f9 != null && _f9 !== "") {
		buf[offset++] = 82;
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f9) : _len === _f9.length ? __asciiWrite$21(buf, offset, _f9) : __utf8Write$21(buf, offset, _f9);
	}
	if (_f10 != null && _f10.length > 0) {
		buf[offset++] = 90;
		const _len = _f10.length;
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
		buf.set(_f10, offset);
		offset += _len;
	}
	if (_f11 != null && _f11 !== "") {
		buf[offset++] = 98;
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f11) : _len === _f11.length ? __asciiWrite$21(buf, offset, _f11) : __utf8Write$21(buf, offset, _f11);
	}
	if (_f12 != null && _f12 !== 0) {
		buf[offset++] = 104;
		let _v = _f12 >>> 0;
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
	if (_f13 != null && _f13 !== "") {
		buf[offset++] = 114;
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f13) : _len === _f13.length ? __asciiWrite$21(buf, offset, _f13) : __utf8Write$21(buf, offset, _f13);
	}
	if (_f14 != null && _f14 !== "") {
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f14) : _len === _f14.length ? __asciiWrite$21(buf, offset, _f14) : __utf8Write$21(buf, offset, _f14);
	}
	if (_f15 != null && _f15 !== 0) {
		buf[offset++] = 128;
		buf[offset++] = 1;
		let _v = _f15 >>> 0;
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
	if (_f16 != null && _f16 !== 0) {
		buf[offset++] = 136;
		buf[offset++] = 1;
		let _v = _f16 >>> 0;
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
	if (_f17 != null && _f17 !== 0) {
		buf[offset++] = 144;
		buf[offset++] = 1;
		let _v = _f17 >>> 0;
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
	if (_f18 != null && _f18.length > 0) {
		buf[offset++] = 154;
		buf[offset++] = 1;
		const _len = _f18.length;
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
		buf.set(_f18, offset);
		offset += _len;
	}
	if (_f19 === true) {
		buf[offset++] = 160;
		buf[offset++] = 1;
		buf[offset++] = _f19 ? 1 : 0;
	}
	if (_f20 != null && _f20 !== 0) {
		buf[offset++] = 168;
		buf[offset++] = 1;
		let _v = _f20 >>> 0;
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
	if (_f21 != null && _f21 !== 0) {
		buf[offset++] = 176;
		buf[offset++] = 1;
		let _v = _f21 >>> 0;
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
	if (_f22 != null && _f22 !== 0) {
		buf[offset++] = 184;
		buf[offset++] = 1;
		let _v = _f22 >>> 0;
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
	if (_f23 != null && _f23 !== 0) {
		buf[offset++] = 192;
		buf[offset++] = 1;
		let _v = _f23 >>> 0;
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
	if (_f24 != null && _f24 !== 0) {
		buf[offset++] = 200;
		buf[offset++] = 1;
		let _v = _f24 >>> 0;
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
	if (_f25 != null && _f25 !== "") {
		buf[offset++] = 210;
		buf[offset++] = 1;
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f25) : _len === _f25.length ? __asciiWrite$21(buf, offset, _f25) : __utf8Write$21(buf, offset, _f25);
	}
	if (_f26 != null && _f26 !== 0) {
		buf[offset++] = 216;
		buf[offset++] = 1;
		let _v = _f26 >>> 0;
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
	if (_f27 != null && _f27 !== 0) {
		buf[offset++] = 224;
		buf[offset++] = 1;
		let _v = _f27 >>> 0;
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
	if (_f28 != null) {
		buf[offset++] = 234;
		buf[offset++] = 1;
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
		offset = __write_NotOnlineImagePbReserve(_f28, buf, offset, sizes);
	}
	return offset;
}
function __size_NotOnlineImagePbReserve(obj, sizes) {
	let size = 0;
	const _f0 = obj["subType"];
	const _f1 = obj["field3"];
	const _f2 = obj["field4"];
	const _f3 = obj["summary"];
	const _f4 = obj["field10"];
	const _f5 = obj["field20"];
	const _f6 = obj["url"];
	const _f7 = obj["md5Str"];
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
	if (_f3 != null && _f3 !== "") {
		const _len = __utf8Len$21(_f3);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f4 != null && _f4 !== 0) {
		const _val = _f4 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f5 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_NotOnlineImagePbReserve2(_f5, sizes);
		sizes[_slot] = _len;
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f6 != null && _f6 !== "") {
		const _len = __utf8Len$21(_f6);
		sizes.push(_len);
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f7 != null && _f7 !== "") {
		const _len = __utf8Len$21(_f7);
		sizes.push(_len);
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_NotOnlineImagePbReserve(obj, buf, offset, sizes) {
	const _f0 = obj["subType"];
	const _f1 = obj["field3"];
	const _f2 = obj["field4"];
	const _f3 = obj["summary"];
	const _f4 = obj["field10"];
	const _f5 = obj["field20"];
	const _f6 = obj["url"];
	const _f7 = obj["md5Str"];
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
	if (_f3 != null && _f3 !== "") {
		buf[offset++] = 66;
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f3) : _len === _f3.length ? __asciiWrite$21(buf, offset, _f3) : __utf8Write$21(buf, offset, _f3);
	}
	if (_f4 != null && _f4 !== 0) {
		buf[offset++] = 80;
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
	if (_f5 != null) {
		buf[offset++] = 162;
		buf[offset++] = 1;
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
		offset = __write_NotOnlineImagePbReserve2(_f5, buf, offset, sizes);
	}
	if (_f6 != null && _f6 !== "") {
		buf[offset++] = 242;
		buf[offset++] = 1;
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f6) : _len === _f6.length ? __asciiWrite$21(buf, offset, _f6) : __utf8Write$21(buf, offset, _f6);
	}
	if (_f7 != null && _f7 !== "") {
		buf[offset++] = 250;
		buf[offset++] = 1;
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f7) : _len === _f7.length ? __asciiWrite$21(buf, offset, _f7) : __utf8Write$21(buf, offset, _f7);
	}
	return offset;
}
function __size_NotOnlineImagePbReserve2(obj, sizes) {
	let size = 0;
	const _f0 = obj["field1"];
	const _f1 = obj["field2"];
	const _f2 = obj["field3"];
	const _f3 = obj["field4"];
	const _f4 = obj["field5"];
	const _f5 = obj["field7"];
	if (_f0 != null && _f0 !== 0) {
		const _val = _f0 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f1 != null && _f1 !== "") {
		const _len = __utf8Len$21(_f1);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f2 != null && _f2 !== 0) {
		const _val = _f2 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f3 != null && _f3 !== 0) {
		const _val = _f3 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f4 != null && _f4 !== 0) {
		const _val = _f4 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f5 != null && _f5 !== "") {
		const _len = __utf8Len$21(_f5);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_NotOnlineImagePbReserve2(obj, buf, offset, sizes) {
	const _f0 = obj["field1"];
	const _f1 = obj["field2"];
	const _f2 = obj["field3"];
	const _f3 = obj["field4"];
	const _f4 = obj["field5"];
	const _f5 = obj["field7"];
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f1) : _len === _f1.length ? __asciiWrite$21(buf, offset, _f1) : __utf8Write$21(buf, offset, _f1);
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
	if (_f5 != null && _f5 !== "") {
		buf[offset++] = 58;
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f5) : _len === _f5.length ? __asciiWrite$21(buf, offset, _f5) : __utf8Write$21(buf, offset, _f5);
	}
	return offset;
}
function __size_TransElem(obj, sizes) {
	let size = 0;
	const _f0 = obj["elemType"];
	const _f1 = obj["elemValue"];
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
	return size;
}
function __write_TransElem(obj, buf, offset, sizes) {
	const _f0 = obj["elemType"];
	const _f1 = obj["elemValue"];
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
	return offset;
}
function __size_MarketFace(obj, sizes) {
	let size = 0;
	const _f0 = obj["faceName"];
	const _f1 = obj["itemType"];
	const _f2 = obj["faceInfo"];
	const _f3 = obj["faceId"];
	const _f4 = obj["tabId"];
	const _f5 = obj["subType"];
	const _f6 = obj["key"];
	const _f7 = obj["param"];
	const _f8 = obj["mediaType"];
	const _f9 = obj["imageWidth"];
	const _f10 = obj["imageHeight"];
	const _f11 = obj["mobileParam"];
	const _f12 = obj["pbReserve"];
	if (_f0 != null && _f0 !== "") {
		const _len = __utf8Len$21(_f0);
		sizes.push(_len);
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
	if (_f3 != null && _f3.length > 0) {
		const _len = _f3.length;
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
	if (_f6 != null && _f6 !== "") {
		const _len = __utf8Len$21(_f6);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f7 != null && _f7.length > 0) {
		const _len = _f7.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f8 != null && _f8 !== 0) {
		const _val = _f8 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
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
	if (_f11 != null && _f11.length > 0) {
		const _len = _f11.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f12 != null && _f12.length > 0) {
		const _len = _f12.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_MarketFace(obj, buf, offset, sizes) {
	const _f0 = obj["faceName"];
	const _f1 = obj["itemType"];
	const _f2 = obj["faceInfo"];
	const _f3 = obj["faceId"];
	const _f4 = obj["tabId"];
	const _f5 = obj["subType"];
	const _f6 = obj["key"];
	const _f7 = obj["param"];
	const _f8 = obj["mediaType"];
	const _f9 = obj["imageWidth"];
	const _f10 = obj["imageHeight"];
	const _f11 = obj["mobileParam"];
	const _f12 = obj["pbReserve"];
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f0) : _len === _f0.length ? __asciiWrite$21(buf, offset, _f0) : __utf8Write$21(buf, offset, _f0);
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
	if (_f6 != null && _f6 !== "") {
		buf[offset++] = 58;
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f6) : _len === _f6.length ? __asciiWrite$21(buf, offset, _f6) : __utf8Write$21(buf, offset, _f6);
	}
	if (_f7 != null && _f7.length > 0) {
		buf[offset++] = 66;
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
	if (_f8 != null && _f8 !== 0) {
		buf[offset++] = 72;
		let _v = _f8 >>> 0;
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
	if (_f11 != null && _f11.length > 0) {
		buf[offset++] = 98;
		const _len = _f11.length;
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
		buf.set(_f11, offset);
		offset += _len;
	}
	if (_f12 != null && _f12.length > 0) {
		buf[offset++] = 106;
		const _len = _f12.length;
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
		buf.set(_f12, offset);
		offset += _len;
	}
	return offset;
}
function __size_CustomFace(obj, sizes) {
	let size = 0;
	const _f0 = obj["guid"];
	const _f1 = obj["filePath"];
	const _f2 = obj["shortcut"];
	const _f3 = obj["buffer"];
	const _f4 = obj["flag"];
	const _f5 = obj["oldData"];
	const _f6 = obj["fileId"];
	const _f7 = obj["serverIp"];
	const _f8 = obj["serverPort"];
	const _f9 = obj["fileType"];
	const _f10 = obj["signature"];
	const _f11 = obj["useful"];
	const _f12 = obj["md5"];
	const _f13 = obj["thumbUrl"];
	const _f14 = obj["bigUrl"];
	const _f15 = obj["origUrl"];
	const _f16 = obj["bizType"];
	const _f17 = obj["repeatIndex"];
	const _f18 = obj["repeatImage"];
	const _f19 = obj["imageType"];
	const _f20 = obj["index"];
	const _f21 = obj["width"];
	const _f22 = obj["height"];
	const _f23 = obj["source"];
	const _f24 = obj["size"];
	const _f25 = obj["origin"];
	const _f26 = obj["thumbWidth"];
	const _f27 = obj["thumbHeight"];
	const _f28 = obj["showLen"];
	const _f29 = obj["downloadLen"];
	const _f30 = obj["x400Url"];
	const _f31 = obj["x400Width"];
	const _f32 = obj["x400Height"];
	const _f33 = obj["pbRes"];
	if (_f0 != null && _f0.length > 0) {
		const _len = _f0.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f1 != null && _f1 !== "") {
		const _len = __utf8Len$21(_f1);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f2 != null && _f2 !== "") {
		const _len = __utf8Len$21(_f2);
		sizes.push(_len);
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
	if (_f8 != null && _f8 !== 0) {
		const _val = _f8 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f9 != null && _f9 !== 0) {
		const _val = _f9 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f10 != null && _f10.length > 0) {
		const _len = _f10.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f11 != null && _f11 !== 0) {
		const _val = _f11 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f12 != null && _f12.length > 0) {
		const _len = _f12.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f13 != null && _f13 !== "") {
		const _len = __utf8Len$21(_f13);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f14 != null && _f14 !== "") {
		const _len = __utf8Len$21(_f14);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f15 != null && _f15 !== "") {
		const _len = __utf8Len$21(_f15);
		sizes.push(_len);
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f16 != null && _f16 !== 0) {
		const _val = _f16 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f17 != null && _f17 !== 0) {
		const _val = _f17 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f18 != null && _f18 !== 0) {
		const _val = _f18 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f19 != null && _f19 !== 0) {
		const _val = _f19 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f20 != null && _f20 !== 0) {
		const _val = _f20 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f21 != null && _f21 !== 0) {
		const _val = _f21 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f22 != null && _f22 !== 0) {
		const _val = _f22 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f23 != null && _f23 !== 0) {
		const _val = _f23 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f24 != null && _f24 !== 0) {
		const _val = _f24 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f25 != null && _f25 !== 0) {
		const _val = _f25 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f26 != null && _f26 !== 0) {
		const _val = _f26 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f27 != null && _f27 !== 0) {
		const _val = _f27 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f28 != null && _f28 !== 0) {
		const _val = _f28 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f29 != null && _f29 !== 0) {
		const _val = _f29 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f30 != null && _f30 !== "") {
		const _len = __utf8Len$21(_f30);
		sizes.push(_len);
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f31 != null && _f31 !== 0) {
		const _val = _f31 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f32 != null && _f32 !== 0) {
		const _val = _f32 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f33 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_CustomFacePbReserve(_f33, sizes);
		sizes[_slot] = _len;
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_CustomFace(obj, buf, offset, sizes) {
	const _f0 = obj["guid"];
	const _f1 = obj["filePath"];
	const _f2 = obj["shortcut"];
	const _f3 = obj["buffer"];
	const _f4 = obj["flag"];
	const _f5 = obj["oldData"];
	const _f6 = obj["fileId"];
	const _f7 = obj["serverIp"];
	const _f8 = obj["serverPort"];
	const _f9 = obj["fileType"];
	const _f10 = obj["signature"];
	const _f11 = obj["useful"];
	const _f12 = obj["md5"];
	const _f13 = obj["thumbUrl"];
	const _f14 = obj["bigUrl"];
	const _f15 = obj["origUrl"];
	const _f16 = obj["bizType"];
	const _f17 = obj["repeatIndex"];
	const _f18 = obj["repeatImage"];
	const _f19 = obj["imageType"];
	const _f20 = obj["index"];
	const _f21 = obj["width"];
	const _f22 = obj["height"];
	const _f23 = obj["source"];
	const _f24 = obj["size"];
	const _f25 = obj["origin"];
	const _f26 = obj["thumbWidth"];
	const _f27 = obj["thumbHeight"];
	const _f28 = obj["showLen"];
	const _f29 = obj["downloadLen"];
	const _f30 = obj["x400Url"];
	const _f31 = obj["x400Width"];
	const _f32 = obj["x400Height"];
	const _f33 = obj["pbRes"];
	if (_f0 != null && _f0.length > 0) {
		buf[offset++] = 10;
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f1) : _len === _f1.length ? __asciiWrite$21(buf, offset, _f1) : __utf8Write$21(buf, offset, _f1);
	}
	if (_f2 != null && _f2 !== "") {
		buf[offset++] = 26;
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f2) : _len === _f2.length ? __asciiWrite$21(buf, offset, _f2) : __utf8Write$21(buf, offset, _f2);
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
	if (_f5 != null && _f5.length > 0) {
		buf[offset++] = 50;
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
	if (_f8 != null && _f8 !== 0) {
		buf[offset++] = 72;
		let _v = _f8 >>> 0;
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
	if (_f10 != null && _f10.length > 0) {
		buf[offset++] = 90;
		const _len = _f10.length;
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
		buf.set(_f10, offset);
		offset += _len;
	}
	if (_f11 != null && _f11 !== 0) {
		buf[offset++] = 96;
		let _v = _f11 >>> 0;
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
	if (_f12 != null && _f12.length > 0) {
		buf[offset++] = 106;
		const _len = _f12.length;
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
		buf.set(_f12, offset);
		offset += _len;
	}
	if (_f13 != null && _f13 !== "") {
		buf[offset++] = 114;
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f13) : _len === _f13.length ? __asciiWrite$21(buf, offset, _f13) : __utf8Write$21(buf, offset, _f13);
	}
	if (_f14 != null && _f14 !== "") {
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f14) : _len === _f14.length ? __asciiWrite$21(buf, offset, _f14) : __utf8Write$21(buf, offset, _f14);
	}
	if (_f15 != null && _f15 !== "") {
		buf[offset++] = 130;
		buf[offset++] = 1;
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f15) : _len === _f15.length ? __asciiWrite$21(buf, offset, _f15) : __utf8Write$21(buf, offset, _f15);
	}
	if (_f16 != null && _f16 !== 0) {
		buf[offset++] = 136;
		buf[offset++] = 1;
		let _v = _f16 >>> 0;
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
	if (_f17 != null && _f17 !== 0) {
		buf[offset++] = 144;
		buf[offset++] = 1;
		let _v = _f17 >>> 0;
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
	if (_f18 != null && _f18 !== 0) {
		buf[offset++] = 152;
		buf[offset++] = 1;
		let _v = _f18 >>> 0;
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
	if (_f19 != null && _f19 !== 0) {
		buf[offset++] = 160;
		buf[offset++] = 1;
		let _v = _f19 >>> 0;
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
	if (_f20 != null && _f20 !== 0) {
		buf[offset++] = 168;
		buf[offset++] = 1;
		let _v = _f20 >>> 0;
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
	if (_f21 != null && _f21 !== 0) {
		buf[offset++] = 176;
		buf[offset++] = 1;
		let _v = _f21 >>> 0;
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
	if (_f22 != null && _f22 !== 0) {
		buf[offset++] = 184;
		buf[offset++] = 1;
		let _v = _f22 >>> 0;
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
	if (_f23 != null && _f23 !== 0) {
		buf[offset++] = 192;
		buf[offset++] = 1;
		let _v = _f23 >>> 0;
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
	if (_f24 != null && _f24 !== 0) {
		buf[offset++] = 200;
		buf[offset++] = 1;
		let _v = _f24 >>> 0;
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
	if (_f25 != null && _f25 !== 0) {
		buf[offset++] = 208;
		buf[offset++] = 1;
		let _v = _f25 >>> 0;
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
	if (_f26 != null && _f26 !== 0) {
		buf[offset++] = 216;
		buf[offset++] = 1;
		let _v = _f26 >>> 0;
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
	if (_f27 != null && _f27 !== 0) {
		buf[offset++] = 224;
		buf[offset++] = 1;
		let _v = _f27 >>> 0;
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
	if (_f28 != null && _f28 !== 0) {
		buf[offset++] = 232;
		buf[offset++] = 1;
		let _v = _f28 >>> 0;
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
	if (_f29 != null && _f29 !== 0) {
		buf[offset++] = 240;
		buf[offset++] = 1;
		let _v = _f29 >>> 0;
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
	if (_f30 != null && _f30 !== "") {
		buf[offset++] = 250;
		buf[offset++] = 1;
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f30) : _len === _f30.length ? __asciiWrite$21(buf, offset, _f30) : __utf8Write$21(buf, offset, _f30);
	}
	if (_f31 != null && _f31 !== 0) {
		buf[offset++] = 128;
		buf[offset++] = 2;
		let _v = _f31 >>> 0;
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
	if (_f32 != null && _f32 !== 0) {
		buf[offset++] = 136;
		buf[offset++] = 2;
		let _v = _f32 >>> 0;
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
	if (_f33 != null) {
		buf[offset++] = 146;
		buf[offset++] = 2;
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
		offset = __write_CustomFacePbReserve(_f33, buf, offset, sizes);
	}
	return offset;
}
function __size_CustomFacePbReserve(obj, sizes) {
	let size = 0;
	const _f0 = obj["subType"];
	const _f1 = obj["summary"];
	if (_f0 != null && _f0 !== 0) {
		const _val = _f0 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f1 != null && _f1 !== "") {
		const _len = __utf8Len$21(_f1);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_CustomFacePbReserve(obj, buf, offset, sizes) {
	const _f0 = obj["subType"];
	const _f1 = obj["summary"];
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
	if (_f1 != null && _f1 !== "") {
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f1) : _len === _f1.length ? __asciiWrite$21(buf, offset, _f1) : __utf8Write$21(buf, offset, _f1);
	}
	return offset;
}
function __size_RichMsg(obj, sizes) {
	let size = 0;
	const _f0 = obj["template1"];
	const _f1 = obj["serviceId"];
	const _f2 = obj["msgResId"];
	const _f3 = obj["rand"];
	const _f4 = obj["seq"];
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
	if (_f2 != null && _f2.length > 0) {
		const _len = _f2.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f3 != null && _f3 !== 0) {
		const _val = _f3 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f4 != null && _f4 !== 0) {
		const _val = _f4 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_RichMsg(obj, buf, offset, sizes) {
	const _f0 = obj["template1"];
	const _f1 = obj["serviceId"];
	const _f2 = obj["msgResId"];
	const _f3 = obj["rand"];
	const _f4 = obj["seq"];
	if (_f0 != null && _f0.length > 0) {
		buf[offset++] = 10;
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
	return offset;
}
function __size_GroupFileElem(obj, sizes) {
	let size = 0;
	const _f0 = obj["filename"];
	const _f1 = obj["fileSize"];
	const _f2 = obj["fileId"];
	const _f3 = obj["batchId"];
	const _f4 = obj["fileKey"];
	const _f5 = obj["mark"];
	const _f6 = obj["sequence"];
	const _f7 = obj["batchItemId"];
	const _f8 = obj["feedMsgTime"];
	const _f9 = obj["pbReserve"];
	if (_f0 != null && _f0 !== "") {
		const _len = __utf8Len$21(_f0);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f1 != null && _f1 !== 0n) size += 1 + __varint64Size$7(BigInt.asUintN(64, _f1));
	if (_f2 != null && _f2 !== "") {
		const _len = __utf8Len$21(_f2);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f3 != null && _f3 !== "") {
		const _len = __utf8Len$21(_f3);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f4 != null && _f4 !== "") {
		const _len = __utf8Len$21(_f4);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f5 != null && _f5.length > 0) {
		const _len = _f5.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f6 != null && _f6 !== 0n) size += 1 + __varint64Size$7(BigInt.asUintN(64, _f6));
	if (_f7 != null && _f7.length > 0) {
		const _len = _f7.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f8 != null && _f8 !== 0) {
		const _val = _f8 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f9 != null && _f9.length > 0) {
		const _len = _f9.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_GroupFileElem(obj, buf, offset, sizes) {
	const _f0 = obj["filename"];
	const _f1 = obj["fileSize"];
	const _f2 = obj["fileId"];
	const _f3 = obj["batchId"];
	const _f4 = obj["fileKey"];
	const _f5 = obj["mark"];
	const _f6 = obj["sequence"];
	const _f7 = obj["batchItemId"];
	const _f8 = obj["feedMsgTime"];
	const _f9 = obj["pbReserve"];
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f0) : _len === _f0.length ? __asciiWrite$21(buf, offset, _f0) : __utf8Write$21(buf, offset, _f0);
	}
	if (_f1 != null && _f1 !== 0n) {
		buf[offset++] = 16;
		offset = __writeVarint64$7(buf, offset, BigInt.asUintN(64, _f1));
	}
	if (_f2 != null && _f2 !== "") {
		buf[offset++] = 26;
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f2) : _len === _f2.length ? __asciiWrite$21(buf, offset, _f2) : __utf8Write$21(buf, offset, _f2);
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f3) : _len === _f3.length ? __asciiWrite$21(buf, offset, _f3) : __utf8Write$21(buf, offset, _f3);
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f4) : _len === _f4.length ? __asciiWrite$21(buf, offset, _f4) : __utf8Write$21(buf, offset, _f4);
	}
	if (_f5 != null && _f5.length > 0) {
		buf[offset++] = 50;
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
	if (_f6 != null && _f6 !== 0n) {
		buf[offset++] = 56;
		offset = __writeVarint64$7(buf, offset, BigInt.asUintN(64, _f6));
	}
	if (_f7 != null && _f7.length > 0) {
		buf[offset++] = 66;
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
	if (_f8 != null && _f8 !== 0) {
		buf[offset++] = 72;
		let _v = _f8 >>> 0;
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
	if (_f9 != null && _f9.length > 0) {
		buf[offset++] = 82;
		const _len = _f9.length;
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
		buf.set(_f9, offset);
		offset += _len;
	}
	return offset;
}
function __size_ExtraInfo(obj, sizes) {
	let size = 0;
	const _f0 = obj["nick"];
	const _f1 = obj["groupCard"];
	const _f2 = obj["level"];
	const _f3 = obj["flags"];
	const _f4 = obj["groupMask"];
	const _f5 = obj["msgTailId"];
	const _f6 = obj["senderTitle"];
	const _f7 = obj["apnsTips"];
	const _f8 = obj["uin"];
	const _f9 = obj["msgStateFlag"];
	const _f10 = obj["apnsSoundType"];
	const _f11 = obj["newGroupFlag"];
	if (_f0 != null && _f0.length > 0) {
		const _len = _f0.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f1 != null && _f1.length > 0) {
		const _len = _f1.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f2 != null && _f2 !== 0) {
		const _val = _f2 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f3 != null && _f3 !== 0) {
		const _val = _f3 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
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
	if (_f8 != null && _f8 !== 0n) size += 1 + __varint64Size$7(BigInt.asUintN(64, _f8));
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
	if (_f11 != null && _f11 !== 0) {
		const _val = _f11 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_ExtraInfo(obj, buf, offset, sizes) {
	const _f0 = obj["nick"];
	const _f1 = obj["groupCard"];
	const _f2 = obj["level"];
	const _f3 = obj["flags"];
	const _f4 = obj["groupMask"];
	const _f5 = obj["msgTailId"];
	const _f6 = obj["senderTitle"];
	const _f7 = obj["apnsTips"];
	const _f8 = obj["uin"];
	const _f9 = obj["msgStateFlag"];
	const _f10 = obj["apnsSoundType"];
	const _f11 = obj["newGroupFlag"];
	if (_f0 != null && _f0.length > 0) {
		buf[offset++] = 10;
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
	if (_f7 != null && _f7.length > 0) {
		buf[offset++] = 66;
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
	if (_f8 != null && _f8 !== 0n) {
		buf[offset++] = 72;
		offset = __writeVarint64$7(buf, offset, BigInt.asUintN(64, _f8));
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
	if (_f11 != null && _f11 !== 0) {
		buf[offset++] = 96;
		let _v = _f11 >>> 0;
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
function __size_VideoFile(obj, sizes) {
	let size = 0;
	const _f0 = obj["fileUuid"];
	const _f1 = obj["fileMd5"];
	const _f2 = obj["fileName"];
	const _f3 = obj["fileFormat"];
	const _f4 = obj["fileTime"];
	const _f5 = obj["fileSize"];
	const _f6 = obj["thumbWidth"];
	const _f7 = obj["thumbHeight"];
	const _f8 = obj["thumbFileMd5"];
	const _f9 = obj["source"];
	const _f10 = obj["thumbFileSize"];
	const _f11 = obj["busiType"];
	const _f12 = obj["fromChatType"];
	const _f13 = obj["toChatType"];
	const _f14 = obj["supportProgressive"];
	const _f15 = obj["fileWidth"];
	const _f16 = obj["fileHeight"];
	const _f17 = obj["subBusiType"];
	const _f18 = obj["videoAttr"];
	const _f19 = obj["pbReserve"];
	if (_f0 != null && _f0 !== "") {
		const _len = __utf8Len$21(_f0);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f1 != null && _f1.length > 0) {
		const _len = _f1.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f2 != null && _f2 !== "") {
		const _len = __utf8Len$21(_f2);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f3 != null && _f3 !== 0) {
		const _val = _f3 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
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
	if (_f8 != null && _f8.length > 0) {
		const _len = _f8.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f9 != null && _f9.length > 0) {
		const _len = _f9.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f10 != null && _f10 !== 0) {
		const _val = _f10 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f11 != null && _f11 !== 0) {
		const _val = _f11 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f12 != null && _f12 !== 0) {
		const _val = _f12 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f13 != null && _f13 !== 0) {
		const _val = _f13 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f14 === true) size += 2;
	if (_f15 != null && _f15 !== 0) {
		const _val = _f15 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f16 != null && _f16 !== 0) {
		const _val = _f16 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f17 != null && _f17 !== 0) {
		const _val = _f17 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f18 != null && _f18 !== 0) {
		const _val = _f18 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f19 != null && _f19.length > 0) {
		const _len = _f19.length;
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_VideoFile(obj, buf, offset, sizes) {
	const _f0 = obj["fileUuid"];
	const _f1 = obj["fileMd5"];
	const _f2 = obj["fileName"];
	const _f3 = obj["fileFormat"];
	const _f4 = obj["fileTime"];
	const _f5 = obj["fileSize"];
	const _f6 = obj["thumbWidth"];
	const _f7 = obj["thumbHeight"];
	const _f8 = obj["thumbFileMd5"];
	const _f9 = obj["source"];
	const _f10 = obj["thumbFileSize"];
	const _f11 = obj["busiType"];
	const _f12 = obj["fromChatType"];
	const _f13 = obj["toChatType"];
	const _f14 = obj["supportProgressive"];
	const _f15 = obj["fileWidth"];
	const _f16 = obj["fileHeight"];
	const _f17 = obj["subBusiType"];
	const _f18 = obj["videoAttr"];
	const _f19 = obj["pbReserve"];
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f0) : _len === _f0.length ? __asciiWrite$21(buf, offset, _f0) : __utf8Write$21(buf, offset, _f0);
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
	if (_f2 != null && _f2 !== "") {
		buf[offset++] = 26;
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f2) : _len === _f2.length ? __asciiWrite$21(buf, offset, _f2) : __utf8Write$21(buf, offset, _f2);
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
	if (_f8 != null && _f8.length > 0) {
		buf[offset++] = 74;
		const _len = _f8.length;
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
		buf.set(_f8, offset);
		offset += _len;
	}
	if (_f9 != null && _f9.length > 0) {
		buf[offset++] = 82;
		const _len = _f9.length;
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
		buf.set(_f9, offset);
		offset += _len;
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
	if (_f11 != null && _f11 !== 0) {
		buf[offset++] = 96;
		let _v = _f11 >>> 0;
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
	if (_f12 != null && _f12 !== 0) {
		buf[offset++] = 104;
		let _v = _f12 >>> 0;
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
	if (_f13 != null && _f13 !== 0) {
		buf[offset++] = 112;
		let _v = _f13 >>> 0;
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
	if (_f14 === true) {
		buf[offset++] = 120;
		buf[offset++] = _f14 ? 1 : 0;
	}
	if (_f15 != null && _f15 !== 0) {
		buf[offset++] = 128;
		buf[offset++] = 1;
		let _v = _f15 >>> 0;
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
	if (_f16 != null && _f16 !== 0) {
		buf[offset++] = 136;
		buf[offset++] = 1;
		let _v = _f16 >>> 0;
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
	if (_f17 != null && _f17 !== 0) {
		buf[offset++] = 144;
		buf[offset++] = 1;
		let _v = _f17 >>> 0;
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
	if (_f18 != null && _f18 !== 0) {
		buf[offset++] = 152;
		buf[offset++] = 1;
		let _v = _f18 >>> 0;
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
	if (_f19 != null && _f19.length > 0) {
		buf[offset++] = 194;
		buf[offset++] = 1;
		const _len = _f19.length;
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
		buf.set(_f19, offset);
		offset += _len;
	}
	return offset;
}
function __size_GeneralFlags(obj, sizes) {
	let size = 0;
	const _f0 = obj["bubbleDiyTextId"];
	const _f1 = obj["groupFlagNew"];
	const _f2 = obj["uin"];
	const _f3 = obj["longTextFlag"];
	const _f4 = obj["longTextResId"];
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
	if (_f2 != null && _f2 !== 0n) size += 1 + __varint64Size$7(BigInt.asUintN(64, _f2));
	if (_f3 != null && _f3 !== 0) {
		const _val = _f3 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f4 != null && _f4 !== "") {
		const _len = __utf8Len$21(_f4);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_GeneralFlags(obj, buf, offset, sizes) {
	const _f0 = obj["bubbleDiyTextId"];
	const _f1 = obj["groupFlagNew"];
	const _f2 = obj["uin"];
	const _f3 = obj["longTextFlag"];
	const _f4 = obj["longTextResId"];
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
	if (_f2 != null && _f2 !== 0n) {
		buf[offset++] = 24;
		offset = __writeVarint64$7(buf, offset, BigInt.asUintN(64, _f2));
	}
	if (_f3 != null && _f3 !== 0) {
		buf[offset++] = 48;
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
		buf[offset++] = 58;
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f4) : _len === _f4.length ? __asciiWrite$21(buf, offset, _f4) : __utf8Write$21(buf, offset, _f4);
	}
	return offset;
}
function __size_SrcMsg(obj, sizes) {
	let size = 0;
	const _f0 = obj["origSeqs"];
	const _f1 = obj["senderUin"];
	const _f2 = obj["time"];
	const _f3 = obj["flag"];
	const _f4 = obj["elemsRaw"];
	const _f5 = obj["type"];
	const _f6 = obj["richMsg"];
	const _f7 = obj["pbReserve"];
	const _f8 = obj["sourceMsg"];
	const _f9 = obj["toUin"];
	const _f10 = obj["troopName"];
	if (_f0 != null && _f0.length > 0) for (let _i = 0; _i < _f0.length; _i++) {
		const _val = _f0[_i] >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f1 != null && _f1 !== 0n) size += 1 + __varint64Size$7(BigInt.asUintN(64, _f1));
	if (_f2 != null && _f2 !== 0) {
		const _val = _f2 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f3 != null && _f3 !== 0) {
		const _val = _f3 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f4 != null && _f4.length > 0) for (let _i = 0; _i < _f4.length; _i++) {
		const _len = _f4[_i].length;
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
	if (_f8 != null && _f8.length > 0) {
		const _len = _f8.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f9 != null && _f9 !== 0n) size += 1 + __varint64Size$7(BigInt.asUintN(64, _f9));
	if (_f10 != null && _f10.length > 0) {
		const _len = _f10.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_SrcMsg(obj, buf, offset, sizes) {
	const _f0 = obj["origSeqs"];
	const _f1 = obj["senderUin"];
	const _f2 = obj["time"];
	const _f3 = obj["flag"];
	const _f4 = obj["elemsRaw"];
	const _f5 = obj["type"];
	const _f6 = obj["richMsg"];
	const _f7 = obj["pbReserve"];
	const _f8 = obj["sourceMsg"];
	const _f9 = obj["toUin"];
	const _f10 = obj["troopName"];
	if (_f0 != null && _f0.length > 0) for (let _i = 0; _i < _f0.length; _i++) {
		buf[offset++] = 8;
		let _v = _f0[_i] >>> 0;
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
	if (_f1 != null && _f1 !== 0n) {
		buf[offset++] = 16;
		offset = __writeVarint64$7(buf, offset, BigInt.asUintN(64, _f1));
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
	if (_f4 != null && _f4.length > 0) for (let _i = 0; _i < _f4.length; _i++) {
		buf[offset++] = 42;
		const _len = _f4[_i].length;
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
		buf.set(_f4[_i], offset);
		offset += _len;
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
	if (_f7 != null && _f7.length > 0) {
		buf[offset++] = 66;
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
	if (_f8 != null && _f8.length > 0) {
		buf[offset++] = 74;
		const _len = _f8.length;
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
		buf.set(_f8, offset);
		offset += _len;
	}
	if (_f9 != null && _f9 !== 0n) {
		buf[offset++] = 80;
		offset = __writeVarint64$7(buf, offset, BigInt.asUintN(64, _f9));
	}
	if (_f10 != null && _f10.length > 0) {
		buf[offset++] = 90;
		const _len = _f10.length;
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
		buf.set(_f10, offset);
		offset += _len;
	}
	return offset;
}
function __size_LightAppElem(obj, sizes) {
	let size = 0;
	const _f0 = obj["data"];
	const _f1 = obj["msgResid"];
	if (_f0 != null && _f0.length > 0) {
		const _len = _f0.length;
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
function __write_LightAppElem(obj, buf, offset, sizes) {
	const _f0 = obj["data"];
	const _f1 = obj["msgResid"];
	if (_f0 != null && _f0.length > 0) {
		buf[offset++] = 10;
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
function __size_CommonElem(obj, sizes) {
	let size = 0;
	const _f0 = obj["serviceType"];
	const _f1 = obj["pbElem"];
	const _f2 = obj["businessType"];
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
	if (_f2 != null && _f2 !== 0) {
		const _val = _f2 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_CommonElem(obj, buf, offset, sizes) {
	const _f0 = obj["serviceType"];
	const _f1 = obj["pbElem"];
	const _f2 = obj["businessType"];
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
	return offset;
}
function __size_NotOnlineFile(obj, sizes) {
	let size = 0;
	const _f0 = obj["fileType"];
	const _f1 = obj["fileUuid"];
	const _f2 = obj["fileMd5"];
	const _f3 = obj["fileName"];
	const _f4 = obj["fileSize"];
	const _f5 = obj["subcmd"];
	const _f6 = obj["downloadFlag"];
	const _f7 = obj["dangerEvel"];
	const _f8 = obj["expireTime"];
	const _f9 = obj["pbReserve"];
	const _f10 = obj["fileHash"];
	if (_f0 != null && _f0 !== 0) {
		const _val = _f0 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f1 != null && _f1 !== "") {
		const _len = __utf8Len$21(_f1);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f2 != null && _f2.length > 0) {
		const _len = _f2.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f3 != null && _f3 !== "") {
		const _len = __utf8Len$21(_f3);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f4 != null && _f4 !== 0n) size += 1 + __varint64Size$7(BigInt.asUintN(64, _f4));
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
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f8 != null && _f8 !== 0) {
		const _val = _f8 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f9 != null && _f9.length > 0) {
		const _len = _f9.length;
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f10 != null && _f10 !== "") {
		const _len = __utf8Len$21(_f10);
		sizes.push(_len);
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_NotOnlineFile(obj, buf, offset, sizes) {
	const _f0 = obj["fileType"];
	const _f1 = obj["fileUuid"];
	const _f2 = obj["fileMd5"];
	const _f3 = obj["fileName"];
	const _f4 = obj["fileSize"];
	const _f5 = obj["subcmd"];
	const _f6 = obj["downloadFlag"];
	const _f7 = obj["dangerEvel"];
	const _f8 = obj["expireTime"];
	const _f9 = obj["pbReserve"];
	const _f10 = obj["fileHash"];
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
	if (_f1 != null && _f1 !== "") {
		buf[offset++] = 26;
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f1) : _len === _f1.length ? __asciiWrite$21(buf, offset, _f1) : __utf8Write$21(buf, offset, _f1);
	}
	if (_f2 != null && _f2.length > 0) {
		buf[offset++] = 34;
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
	if (_f3 != null && _f3 !== "") {
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f3) : _len === _f3.length ? __asciiWrite$21(buf, offset, _f3) : __utf8Write$21(buf, offset, _f3);
	}
	if (_f4 != null && _f4 !== 0n) {
		buf[offset++] = 48;
		offset = __writeVarint64$7(buf, offset, BigInt.asUintN(64, _f4));
	}
	if (_f5 != null && _f5 !== 0) {
		buf[offset++] = 72;
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
	if (_f7 != null && _f7 !== 0) {
		buf[offset++] = 144;
		buf[offset++] = 3;
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
	if (_f8 != null && _f8 !== 0) {
		buf[offset++] = 184;
		buf[offset++] = 3;
		let _v = _f8 >>> 0;
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
	if (_f9 != null && _f9.length > 0) {
		buf[offset++] = 194;
		buf[offset++] = 3;
		const _len = _f9.length;
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
		buf.set(_f9, offset);
		offset += _len;
	}
	if (_f10 != null && _f10 !== "") {
		buf[offset++] = 202;
		buf[offset++] = 3;
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f10) : _len === _f10.length ? __asciiWrite$21(buf, offset, _f10) : __utf8Write$21(buf, offset, _f10);
	}
	return offset;
}
function protobuf_decode_SendMessageResponse(data, offset = 0, end = data.length) {
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
				_f1 = _len <= 32 ? __utf8Read$19(data, offset, offset + _len) : __utf8ReadLong$19(data, offset, offset + _len);
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
				_f4 = protobuf_decode_SendMessageServerResult(data, offset, offset + _len);
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
				_f5 = _val;
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
				_f6 = _val;
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
				_f7 = _val;
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
				_f8 = _val;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$20(data, offset, end, wireType, _tag >>> 3);
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
		"result": _f0,
		"errMsg": _f1,
		"timestamp1": _f2,
		"reviewResult": _f3,
		"serverResult": _f4,
		"field10": _f5,
		"groupSequence": _f6,
		"timestamp2": _f7,
		"privateSequence": _f8
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
function protobuf_decode_SendMessageServerResult(data, offset = 0, end = data.length) {
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
				_f2 = _len <= 32 ? __utf8Read$19(data, offset, offset + _len) : __utf8ReadLong$19(data, offset, offset + _len);
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$20(data, offset, end, wireType, _tag >>> 3);
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
		"code": _f1,
		"message": _f2
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
function protobuf_decode_SsoReadedReportResp(data, offset = 0, end = data.length) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end > data.length || offset > end) throw new Error("Invalid protobuf bounds");
	let _f0 = null;
	let _f1 = null;
	const _f2 = [];
	const _f3 = [];
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
				_f1 = _len <= 32 ? __utf8Read$19(data, offset, offset + _len) : __utf8ReadLong$19(data, offset, offset + _len);
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
				_f2.push(protobuf_decode_GroupReadedReportResponseItem(data, offset, offset + _len));
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
				_f3.push(protobuf_decode_C2CReadedReportResponseItem(data, offset, offset + _len));
				offset += _len;
				break;
			}
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$20(data, offset, end, wireType, _tag >>> 3);
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
		"resultCode": _f0,
		"errorMessage": _f1,
		"groupList": _f2,
		"c2cList": _f3
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
function protobuf_decode_GroupReadedReportResponseItem(data, offset = 0, end = data.length) {
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
				_f1 = _len <= 32 ? __utf8Read$19(data, offset, offset + _len) : __utf8ReadLong$19(data, offset, offset + _len);
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
			case 32: {
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
				_f3 = _hi === 0 ? BigInt(_lo >>> 0) : BigInt(_lo >>> 0) | BigInt(_hi >>> 0) << 32n;
				break;
			}
			case 40: {
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
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$20(data, offset, end, wireType, _tag >>> 3);
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
		"resultCode": _f0,
		"errorMessage": _f1,
		"groupUin": _f2,
		"readSeq": _f3,
		"latestSeq": _f4
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
function protobuf_decode_C2CReadedReportResponseItem(data, offset = 0, end = data.length) {
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
				_f1 = _len <= 32 ? __utf8Read$19(data, offset, offset + _len) : __utf8ReadLong$19(data, offset, offset + _len);
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
				_f3 = _len <= 32 ? __utf8Read$19(data, offset, offset + _len) : __utf8ReadLong$19(data, offset, offset + _len);
				offset += _len;
				break;
			}
			case 40: {
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
				_f5 = _hi === 0 ? BigInt(_lo >>> 0) : BigInt(_lo >>> 0) | BigInt(_hi >>> 0) << 32n;
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
			default: {
				const _unknownStart = offset;
				const wireType = _tag & 7;
				offset = __skipUnknownField$20(data, offset, end, wireType, _tag >>> 3);
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
		"resultCode": _f0,
		"errorMessage": _f1,
		"targetUin": _f2,
		"uid": _f3,
		"readSeq": _f4,
		"latestSeq": _f5,
		"lastMsgTime": _f6
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
function protobuf_encode_SendMessageRequest__SendRichText(obj) {
	const sizes = [1];
	const size = __size_SendMessageRequest__SendRichText(obj, sizes);
	const buf = size <= 64 ? new Uint8Array(size) : __allocate$21(size);
	__write_SendMessageRequest__SendRichText(obj, buf, 0, sizes);
	return buf;
}
function __size_SendMessageRequest__SendRichText(obj, sizes) {
	let size = 0;
	const _f0 = obj["routingHead"];
	const _f1 = obj["contentHead"];
	const _f2 = obj["messageBody"];
	const _f3 = obj["clientSequence"];
	const _f4 = obj["random"];
	const _f5 = obj["syncCookie"];
	const _f6 = obj["via"];
	const _f7 = obj["dataStatist"];
	const _f8 = obj["ctrl"];
	const _f9 = obj["multiSendSeq"];
	if (_f0 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_RoutingHead(_f0, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f1 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_SendContentHead(_f1, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f2 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_SendMessageBody__SendRichText(_f2, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f3 != null && _f3 !== 0) {
		const _val = _f3 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f4 != null && _f4 !== 0) {
		const _val = _f4 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f5 != null && _f5.length > 0) {
		const _len = _f5.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
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
	if (_f8 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_MessageControl(_f8, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f9 != null && _f9 !== 0) {
		const _val = _f9 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_SendMessageRequest__SendRichText(obj, buf, offset, sizes) {
	const _f0 = obj["routingHead"];
	const _f1 = obj["contentHead"];
	const _f2 = obj["messageBody"];
	const _f3 = obj["clientSequence"];
	const _f4 = obj["random"];
	const _f5 = obj["syncCookie"];
	const _f6 = obj["via"];
	const _f7 = obj["dataStatist"];
	const _f8 = obj["ctrl"];
	const _f9 = obj["multiSendSeq"];
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
		offset = __write_RoutingHead(_f0, buf, offset, sizes);
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
		offset = __write_SendContentHead(_f1, buf, offset, sizes);
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
		offset = __write_SendMessageBody__SendRichText(_f2, buf, offset, sizes);
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
	if (_f5 != null && _f5.length > 0) {
		buf[offset++] = 50;
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
	if (_f6 != null && _f6 !== 0) {
		buf[offset++] = 64;
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
		buf[offset++] = 72;
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
	if (_f8 != null) {
		buf[offset++] = 98;
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
		offset = __write_MessageControl(_f8, buf, offset, sizes);
	}
	if (_f9 != null && _f9 !== 0) {
		buf[offset++] = 112;
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
	return offset;
}
function __size_RoutingHead(obj, sizes) {
	let size = 0;
	const _f0 = obj["c2c"];
	const _f1 = obj["grp"];
	const _f2 = obj["grpTmp"];
	const _f3 = obj["trans0x211"];
	if (_f0 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_RoutingC2C(_f0, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f1 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_RoutingGroup(_f1, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f2 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_RoutingGrpTmp(_f2, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f3 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_RoutingTrans0x211(_f3, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_RoutingHead(obj, buf, offset, sizes) {
	const _f0 = obj["c2c"];
	const _f1 = obj["grp"];
	const _f2 = obj["grpTmp"];
	const _f3 = obj["trans0x211"];
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
		offset = __write_RoutingC2C(_f0, buf, offset, sizes);
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
		offset = __write_RoutingGroup(_f1, buf, offset, sizes);
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
		offset = __write_RoutingGrpTmp(_f2, buf, offset, sizes);
	}
	if (_f3 != null) {
		buf[offset++] = 122;
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
		offset = __write_RoutingTrans0x211(_f3, buf, offset, sizes);
	}
	return offset;
}
function __size_RoutingC2C(obj, sizes) {
	let size = 0;
	const _f0 = obj["uin"];
	const _f1 = obj["uid"];
	if (_f0 != null && _f0 !== 0) {
		const _val = _f0 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f1 != null && _f1 !== "") {
		const _len = __utf8Len$21(_f1);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_RoutingC2C(obj, buf, offset, sizes) {
	const _f0 = obj["uin"];
	const _f1 = obj["uid"];
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f1) : _len === _f1.length ? __asciiWrite$21(buf, offset, _f1) : __utf8Write$21(buf, offset, _f1);
	}
	return offset;
}
function __size_RoutingGroup(obj, sizes) {
	let size = 0;
	const _f0 = obj["groupCode"];
	if (_f0 != null && _f0 !== 0n) size += 1 + __varint64Size$7(BigInt.asUintN(64, _f0));
	return size;
}
function __write_RoutingGroup(obj, buf, offset, sizes) {
	const _f0 = obj["groupCode"];
	if (_f0 != null && _f0 !== 0n) {
		buf[offset++] = 8;
		offset = __writeVarint64$7(buf, offset, BigInt.asUintN(64, _f0));
	}
	return offset;
}
function __size_RoutingGrpTmp(obj, sizes) {
	let size = 0;
	const _f0 = obj["groupUin"];
	const _f1 = obj["toUid"];
	if (_f0 != null && _f0 !== 0n) size += 1 + __varint64Size$7(BigInt.asUintN(64, _f0));
	if (_f1 != null && _f1 !== "") {
		const _len = __utf8Len$21(_f1);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_RoutingGrpTmp(obj, buf, offset, sizes) {
	const _f0 = obj["groupUin"];
	const _f1 = obj["toUid"];
	if (_f0 != null && _f0 !== 0n) {
		buf[offset++] = 24;
		offset = __writeVarint64$7(buf, offset, BigInt.asUintN(64, _f0));
	}
	if (_f1 != null && _f1 !== "") {
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f1) : _len === _f1.length ? __asciiWrite$21(buf, offset, _f1) : __utf8Write$21(buf, offset, _f1);
	}
	return offset;
}
function __size_RoutingTrans0x211(obj, sizes) {
	let size = 0;
	const _f0 = obj["toUin"];
	const _f1 = obj["ccCmd"];
	const _f2 = obj["uid"];
	if (_f0 != null && _f0 !== 0n) size += 1 + __varint64Size$7(BigInt.asUintN(64, _f0));
	if (_f1 != null && _f1 !== 0) {
		const _val = _f1 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f2 != null && _f2 !== "") {
		const _len = __utf8Len$21(_f2);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_RoutingTrans0x211(obj, buf, offset, sizes) {
	const _f0 = obj["toUin"];
	const _f1 = obj["ccCmd"];
	const _f2 = obj["uid"];
	if (_f0 != null && _f0 !== 0n) {
		buf[offset++] = 8;
		offset = __writeVarint64$7(buf, offset, BigInt.asUintN(64, _f0));
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
	if (_f2 != null && _f2 !== "") {
		buf[offset++] = 66;
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f2) : _len === _f2.length ? __asciiWrite$21(buf, offset, _f2) : __utf8Write$21(buf, offset, _f2);
	}
	return offset;
}
function __size_SendContentHead(obj, sizes) {
	let size = 0;
	const _f0 = obj["type"];
	const _f1 = obj["subType"];
	const _f2 = obj["c2cCmd"];
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
	return size;
}
function __write_SendContentHead(obj, buf, offset, sizes) {
	const _f0 = obj["type"];
	const _f1 = obj["subType"];
	const _f2 = obj["c2cCmd"];
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
	return offset;
}
function __size_SendMessageBody__SendRichText(obj, sizes) {
	let size = 0;
	const _f0 = obj["richText"];
	const _f1 = obj["msgContent"];
	if (_f0 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_SendRichText(_f0, sizes);
		sizes[_slot] = _len;
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
function __write_SendMessageBody__SendRichText(obj, buf, offset, sizes) {
	const _f0 = obj["richText"];
	const _f1 = obj["msgContent"];
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
		offset = __write_SendRichText(_f0, buf, offset, sizes);
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
function __size_SendRichText(obj, sizes) {
	let size = 0;
	const _f0 = obj["elems"];
	if (_f0 != null && _f0.length > 0) for (let _i = 0; _i < _f0.length; _i++) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_Elem(_f0[_i], sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_SendRichText(obj, buf, offset, sizes) {
	const _f0 = obj["elems"];
	if (_f0 != null && _f0.length > 0) for (let _i = 0; _i < _f0.length; _i++) {
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
		offset = __write_Elem(_f0[_i], buf, offset, sizes);
	}
	return offset;
}
function __size_MessageControl(obj, sizes) {
	let size = 0;
	const _f0 = obj["msgFlag"];
	if (_f0 != null && _f0 !== 0) {
		const _val = _f0 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_MessageControl(obj, buf, offset, sizes) {
	const _f0 = obj["msgFlag"];
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
	return offset;
}
function protobuf_encode_SendMessageRequest__bytes(obj) {
	const sizes = [1];
	const size = __size_SendMessageRequest__bytes(obj, sizes);
	const buf = size <= 64 ? new Uint8Array(size) : __allocate$21(size);
	__write_SendMessageRequest__bytes(obj, buf, 0, sizes);
	return buf;
}
function __size_SendMessageRequest__bytes(obj, sizes) {
	let size = 0;
	const _f0 = obj["routingHead"];
	const _f1 = obj["contentHead"];
	const _f2 = obj["messageBody"];
	const _f3 = obj["clientSequence"];
	const _f4 = obj["random"];
	const _f5 = obj["syncCookie"];
	const _f6 = obj["via"];
	const _f7 = obj["dataStatist"];
	const _f8 = obj["ctrl"];
	const _f9 = obj["multiSendSeq"];
	if (_f0 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_RoutingHead(_f0, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f1 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_SendContentHead(_f1, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f2 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_SendMessageBody__bytes(_f2, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f3 != null && _f3 !== 0) {
		const _val = _f3 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f4 != null && _f4 !== 0) {
		const _val = _f4 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f5 != null && _f5.length > 0) {
		const _len = _f5.length;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
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
	if (_f8 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_MessageControl(_f8, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f9 != null && _f9 !== 0) {
		const _val = _f9 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_SendMessageRequest__bytes(obj, buf, offset, sizes) {
	const _f0 = obj["routingHead"];
	const _f1 = obj["contentHead"];
	const _f2 = obj["messageBody"];
	const _f3 = obj["clientSequence"];
	const _f4 = obj["random"];
	const _f5 = obj["syncCookie"];
	const _f6 = obj["via"];
	const _f7 = obj["dataStatist"];
	const _f8 = obj["ctrl"];
	const _f9 = obj["multiSendSeq"];
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
		offset = __write_RoutingHead(_f0, buf, offset, sizes);
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
		offset = __write_SendContentHead(_f1, buf, offset, sizes);
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
		offset = __write_SendMessageBody__bytes(_f2, buf, offset, sizes);
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
	if (_f5 != null && _f5.length > 0) {
		buf[offset++] = 50;
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
	if (_f6 != null && _f6 !== 0) {
		buf[offset++] = 64;
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
		buf[offset++] = 72;
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
	if (_f8 != null) {
		buf[offset++] = 98;
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
		offset = __write_MessageControl(_f8, buf, offset, sizes);
	}
	if (_f9 != null && _f9 !== 0) {
		buf[offset++] = 112;
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
	return offset;
}
function __size_SendMessageBody__bytes(obj, sizes) {
	let size = 0;
	const _f0 = obj["richText"];
	const _f1 = obj["msgContent"];
	if (_f0 != null && _f0.length > 0) {
		const _len = _f0.length;
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
function __write_SendMessageBody__bytes(obj, buf, offset, sizes) {
	const _f0 = obj["richText"];
	const _f1 = obj["msgContent"];
	if (_f0 != null && _f0.length > 0) {
		buf[offset++] = 10;
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
function protobuf_encode_FileExtra(obj) {
	const sizes = [1];
	const size = __size_FileExtra(obj, sizes);
	const buf = size <= 64 ? new Uint8Array(size) : __allocate$21(size);
	__write_FileExtra(obj, buf, 0, sizes);
	return buf;
}
function __size_FileExtra(obj, sizes) {
	let size = 0;
	const _f0 = obj["file"];
	const _f1 = obj["field6"];
	if (_f0 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_NotOnlineFile(_f0, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f1 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_PrivateFileExtra(_f1, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_FileExtra(obj, buf, offset, sizes) {
	const _f0 = obj["file"];
	const _f1 = obj["field6"];
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
		offset = __write_NotOnlineFile(_f0, buf, offset, sizes);
	}
	if (_f1 != null) {
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
		offset = __write_PrivateFileExtra(_f1, buf, offset, sizes);
	}
	return offset;
}
function __size_PrivateFileExtra(obj, sizes) {
	let size = 0;
	const _f0 = obj["field2"];
	if (_f0 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_PrivateFileExtraField2(_f0, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_PrivateFileExtra(obj, buf, offset, sizes) {
	const _f0 = obj["field2"];
	if (_f0 != null) {
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
		offset = __write_PrivateFileExtraField2(_f0, buf, offset, sizes);
	}
	return offset;
}
function __size_PrivateFileExtraField2(obj, sizes) {
	let size = 0;
	const _f0 = obj["field1"];
	const _f1 = obj["fileUuid"];
	const _f2 = obj["fileName"];
	const _f3 = obj["field6"];
	const _f4 = obj["field7"];
	const _f5 = obj["field8"];
	const _f6 = obj["timestamp1"];
	const _f7 = obj["fileHash"];
	const _f8 = obj["selfUid"];
	const _f9 = obj["destUid"];
	if (_f0 != null && _f0 !== 0) {
		const _val = _f0 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f1 != null && _f1 !== "") {
		const _len = __utf8Len$21(_f1);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f2 != null && _f2 !== "") {
		const _len = __utf8Len$21(_f2);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f3 != null && _f3 !== 0) {
		const _val = _f3 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
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
	if (_f6 != null && _f6 !== 0) {
		const _val = _f6 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f7 != null && _f7 !== "") {
		const _len = __utf8Len$21(_f7);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f8 != null && _f8 !== "") {
		const _len = __utf8Len$21(_f8);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f9 != null && _f9 !== "") {
		const _len = __utf8Len$21(_f9);
		sizes.push(_len);
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_PrivateFileExtraField2(obj, buf, offset, sizes) {
	const _f0 = obj["field1"];
	const _f1 = obj["fileUuid"];
	const _f2 = obj["fileName"];
	const _f3 = obj["field6"];
	const _f4 = obj["field7"];
	const _f5 = obj["field8"];
	const _f6 = obj["timestamp1"];
	const _f7 = obj["fileHash"];
	const _f8 = obj["selfUid"];
	const _f9 = obj["destUid"];
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
	if (_f1 != null && _f1 !== "") {
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f1) : _len === _f1.length ? __asciiWrite$21(buf, offset, _f1) : __utf8Write$21(buf, offset, _f1);
	}
	if (_f2 != null && _f2 !== "") {
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f2) : _len === _f2.length ? __asciiWrite$21(buf, offset, _f2) : __utf8Write$21(buf, offset, _f2);
	}
	if (_f3 != null && _f3 !== 0) {
		buf[offset++] = 48;
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
		buf[offset++] = 58;
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
		buf[offset++] = 66;
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
	if (_f6 != null && _f6 !== 0) {
		buf[offset++] = 72;
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
	if (_f7 != null && _f7 !== "") {
		buf[offset++] = 114;
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f7) : _len === _f7.length ? __asciiWrite$21(buf, offset, _f7) : __utf8Write$21(buf, offset, _f7);
	}
	if (_f8 != null && _f8 !== "") {
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f8) : _len === _f8.length ? __asciiWrite$21(buf, offset, _f8) : __utf8Write$21(buf, offset, _f8);
	}
	if (_f9 != null && _f9 !== "") {
		buf[offset++] = 130;
		buf[offset++] = 1;
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f9) : _len === _f9.length ? __asciiWrite$21(buf, offset, _f9) : __utf8Write$21(buf, offset, _f9);
	}
	return offset;
}
function protobuf_encode_GroupRecallRequest(obj) {
	const sizes = [1];
	const size = __size_GroupRecallRequest(obj, sizes);
	const buf = size <= 64 ? new Uint8Array(size) : __allocate$21(size);
	__write_GroupRecallRequest(obj, buf, 0, sizes);
	return buf;
}
function __size_GroupRecallRequest(obj, sizes) {
	let size = 0;
	const _f0 = obj["type"];
	const _f1 = obj["groupUin"];
	const _f2 = obj["info"];
	const _f3 = obj["settings"];
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
	if (_f2 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_GroupRecallInfo(_f2, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f3 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_GroupRecallSettings(_f3, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_GroupRecallRequest(obj, buf, offset, sizes) {
	const _f0 = obj["type"];
	const _f1 = obj["groupUin"];
	const _f2 = obj["info"];
	const _f3 = obj["settings"];
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
		offset = __write_GroupRecallInfo(_f2, buf, offset, sizes);
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
		offset = __write_GroupRecallSettings(_f3, buf, offset, sizes);
	}
	return offset;
}
function __size_GroupRecallInfo(obj, sizes) {
	let size = 0;
	const _f0 = obj["sequence"];
	const _f1 = obj["random"];
	const _f2 = obj["field3"];
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
	return size;
}
function __write_GroupRecallInfo(obj, buf, offset, sizes) {
	const _f0 = obj["sequence"];
	const _f1 = obj["random"];
	const _f2 = obj["field3"];
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
	return offset;
}
function __size_GroupRecallSettings(obj, sizes) {
	let size = 0;
	const _f0 = obj["field1"];
	if (_f0 != null && _f0 !== 0) {
		const _val = _f0 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_GroupRecallSettings(obj, buf, offset, sizes) {
	const _f0 = obj["field1"];
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
	return offset;
}
function protobuf_encode_C2CRecallRequest(obj) {
	const sizes = [1];
	const size = __size_C2CRecallRequest(obj, sizes);
	const buf = size <= 64 ? new Uint8Array(size) : __allocate$21(size);
	__write_C2CRecallRequest(obj, buf, 0, sizes);
	return buf;
}
function __size_C2CRecallRequest(obj, sizes) {
	let size = 0;
	const _f0 = obj["type"];
	const _f1 = obj["targetUid"];
	const _f2 = obj["info"];
	const _f3 = obj["settings"];
	const _f4 = obj["field6"];
	if (_f0 != null && _f0 !== 0) {
		const _val = _f0 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f1 != null && _f1 !== "") {
		const _len = __utf8Len$21(_f1);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f2 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_C2CRecallInfo(_f2, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f3 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_C2CRecallSettings(_f3, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f4 === true) size += 2;
	return size;
}
function __write_C2CRecallRequest(obj, buf, offset, sizes) {
	const _f0 = obj["type"];
	const _f1 = obj["targetUid"];
	const _f2 = obj["info"];
	const _f3 = obj["settings"];
	const _f4 = obj["field6"];
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
	if (_f1 != null && _f1 !== "") {
		buf[offset++] = 26;
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f1) : _len === _f1.length ? __asciiWrite$21(buf, offset, _f1) : __utf8Write$21(buf, offset, _f1);
	}
	if (_f2 != null) {
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
		offset = __write_C2CRecallInfo(_f2, buf, offset, sizes);
	}
	if (_f3 != null) {
		buf[offset++] = 42;
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
		offset = __write_C2CRecallSettings(_f3, buf, offset, sizes);
	}
	if (_f4 === true) {
		buf[offset++] = 48;
		buf[offset++] = _f4 ? 1 : 0;
	}
	return offset;
}
function __size_C2CRecallInfo(obj, sizes) {
	let size = 0;
	const _f0 = obj["clientSequence"];
	const _f1 = obj["random"];
	const _f2 = obj["messageId"];
	const _f3 = obj["timestamp"];
	const _f4 = obj["field5"];
	const _f5 = obj["messageSequence"];
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
	if (_f2 != null && _f2 !== 0n) size += 1 + __varint64Size$7(BigInt.asUintN(64, _f2));
	if (_f3 != null && _f3 !== 0) {
		const _val = _f3 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
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
	return size;
}
function __write_C2CRecallInfo(obj, buf, offset, sizes) {
	const _f0 = obj["clientSequence"];
	const _f1 = obj["random"];
	const _f2 = obj["messageId"];
	const _f3 = obj["timestamp"];
	const _f4 = obj["field5"];
	const _f5 = obj["messageSequence"];
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
	if (_f2 != null && _f2 !== 0n) {
		buf[offset++] = 24;
		offset = __writeVarint64$7(buf, offset, BigInt.asUintN(64, _f2));
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
	return offset;
}
function __size_C2CRecallSettings(obj, sizes) {
	let size = 0;
	const _f0 = obj["field1"];
	const _f1 = obj["field2"];
	if (_f0 === true) size += 2;
	if (_f1 === true) size += 2;
	return size;
}
function __write_C2CRecallSettings(obj, buf, offset, sizes) {
	const _f0 = obj["field1"];
	const _f1 = obj["field2"];
	if (_f0 === true) {
		buf[offset++] = 8;
		buf[offset++] = _f0 ? 1 : 0;
	}
	if (_f1 === true) {
		buf[offset++] = 16;
		buf[offset++] = _f1 ? 1 : 0;
	}
	return offset;
}
function protobuf_encode_SsoReadedReportReq(obj) {
	const sizes = [1];
	const size = __size_SsoReadedReportReq(obj, sizes);
	const buf = size <= 64 ? new Uint8Array(size) : __allocate$21(size);
	__write_SsoReadedReportReq(obj, buf, 0, sizes);
	return buf;
}
function __size_SsoReadedReportReq(obj, sizes) {
	let size = 0;
	const _f0 = obj["groupList"];
	const _f1 = obj["c2cList"];
	if (_f0 != null && _f0.length > 0) for (let _i = 0; _i < _f0.length; _i++) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_GroupReadedReportItem(_f0[_i], sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f1 != null && _f1.length > 0) for (let _i = 0; _i < _f1.length; _i++) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_C2CReadedReportItem(_f1[_i], sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_SsoReadedReportReq(obj, buf, offset, sizes) {
	const _f0 = obj["groupList"];
	const _f1 = obj["c2cList"];
	if (_f0 != null && _f0.length > 0) for (let _i = 0; _i < _f0.length; _i++) {
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
		offset = __write_GroupReadedReportItem(_f0[_i], buf, offset, sizes);
	}
	if (_f1 != null && _f1.length > 0) for (let _i = 0; _i < _f1.length; _i++) {
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
		offset = __write_C2CReadedReportItem(_f1[_i], buf, offset, sizes);
	}
	return offset;
}
function __size_GroupReadedReportItem(obj, sizes) {
	let size = 0;
	const _f0 = obj["groupUin"];
	const _f1 = obj["lastReadSeq"];
	if (_f0 != null && _f0 !== 0n) size += 1 + __varint64Size$7(BigInt.asUintN(64, _f0));
	if (_f1 != null && _f1 !== 0n) size += 1 + __varint64Size$7(BigInt.asUintN(64, _f1));
	return size;
}
function __write_GroupReadedReportItem(obj, buf, offset, sizes) {
	const _f0 = obj["groupUin"];
	const _f1 = obj["lastReadSeq"];
	if (_f0 != null && _f0 !== 0n) {
		buf[offset++] = 8;
		offset = __writeVarint64$7(buf, offset, BigInt.asUintN(64, _f0));
	}
	if (_f1 != null && _f1 !== 0n) {
		buf[offset++] = 16;
		offset = __writeVarint64$7(buf, offset, BigInt.asUintN(64, _f1));
	}
	return offset;
}
function __size_C2CReadedReportItem(obj, sizes) {
	let size = 0;
	const _f0 = obj["uid"];
	const _f1 = obj["lastReadTime"];
	const _f2 = obj["lastReadSeq"];
	if (_f0 != null && _f0 !== "") {
		const _len = __utf8Len$21(_f0);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f1 != null && _f1 !== 0n) size += 1 + __varint64Size$7(BigInt.asUintN(64, _f1));
	if (_f2 != null && _f2 !== 0n) size += 1 + __varint64Size$7(BigInt.asUintN(64, _f2));
	return size;
}
function __write_C2CReadedReportItem(obj, buf, offset, sizes) {
	const _f0 = obj["uid"];
	const _f1 = obj["lastReadTime"];
	const _f2 = obj["lastReadSeq"];
	if (_f0 != null && _f0 !== "") {
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
		offset = _len >= 128 ? __utf8WriteLong$21(buf, offset, _f0) : _len === _f0.length ? __asciiWrite$21(buf, offset, _f0) : __utf8Write$21(buf, offset, _f0);
	}
	if (_f1 != null && _f1 !== 0n) {
		buf[offset++] = 24;
		offset = __writeVarint64$7(buf, offset, BigInt.asUintN(64, _f1));
	}
	if (_f2 != null && _f2 !== 0n) {
		buf[offset++] = 32;
		offset = __writeVarint64$7(buf, offset, BigInt.asUintN(64, _f2));
	}
	return offset;
}
var SEND_MSG_CMD = "MessageSvc.PbSendMsg";
var READ_REPORT_CMD = "trpc.msg.msg_svc.MsgService.SsoReadedReport";
var READ_REPORT_BATCH_SIZE = 100;
var LOGIN_HISTORY_SYNC_PROTOCOL_LIMITS = {
	maxTargetsPerKind: READ_REPORT_BATCH_SIZE,
	maxMessagesPerSession: 20,
	minimumGapMs: 2e3
};
var log$27 = createLogger("Bridge.Message");
function decodeReadReportResponse(result, label) {
	if (!result.success) throw new Error(result.errorMessage || `${label} transport failed`);
	if (!result.gotResponse || !result.responseData || result.responseData.length === 0) throw new Error(`${label} response is empty`);
	let response;
	try {
		response = protobuf_decode_SsoReadedReportResp(result.responseData);
	} catch (error) {
		throw new Error(`${label} response decode failed: ${error instanceof Error ? error.message : String(error)}`);
	}
	const resultCode = response.resultCode ?? 0;
	if (resultCode !== 0) throw new Error(response.errorMessage || `${label} failed with result code ${resultCode}`);
	return response;
}
function uniqueSessionIds(ids, label) {
	const result = [];
	const seen = /* @__PURE__ */ new Set();
	for (const id of ids) {
		if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`invalid ${label} read target ${String(id)}`);
		if (!seen.has(id)) {
			seen.add(id);
			result.push(id);
		}
	}
	return result;
}
function uniqueHistorySyncPrivateTargets(targets) {
	const result = [];
	const userToUid = /* @__PURE__ */ new Map();
	const uidToUser = /* @__PURE__ */ new Map();
	for (const target of targets) {
		if (!Number.isSafeInteger(target.userId) || target.userId <= 0) throw new Error(`invalid private history sync target ${String(target.userId)}`);
		if (typeof target.uid !== "string" || target.uid.trim().length === 0) throw new Error(`private history sync target ${target.userId} has no uid`);
		const uid = target.uid.trim();
		const knownUid = userToUid.get(target.userId);
		if (knownUid !== void 0) {
			if (knownUid !== uid) throw new Error(`private history sync target ${target.userId} maps to conflicting uids`);
			continue;
		}
		const knownUser = uidToUser.get(uid);
		if (knownUser !== void 0 && knownUser !== target.userId) throw new Error(`private history sync uid ${uid} maps to conflicting users`);
		userToUid.set(target.userId, uid);
		uidToUser.set(uid, target.userId);
		result.push({
			userId: target.userId,
			uid
		});
	}
	return result;
}
function requireReadResponseItem(items, index, matches, label) {
	const item = items?.find(matches) ?? items?.[index];
	if (!item) throw new Error(`${label} response item is missing`);
	const resultCode = item.resultCode ?? 0;
	if (resultCode !== 0) throw new Error(item.errorMessage || `${label} failed with result code ${resultCode}`);
	if (!matches(item)) throw new Error(`${label} response identity does not match the request`);
	return item;
}
function readUnsignedSequence(value, label) {
	if (value == null) return 0n;
	if (typeof value !== "bigint" || value < 0n) throw new Error(`${label} is invalid`);
	return value;
}
function requirePositiveSequence(value, label) {
	const sequence = readUnsignedSequence(value, label);
	if (sequence === 0n) throw new Error(`${label} is missing`);
	return sequence;
}
function readSafeSequence(value, label) {
	const sequence = readUnsignedSequence(value, label);
	if (sequence > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} exceeds the safe integer range`);
	return Number(sequence);
}
function validateHistorySyncRange(startSeq, endSeq, label) {
	if (!Number.isSafeInteger(startSeq) || startSeq <= 0) throw new Error(`${label} start sequence is invalid: ${String(startSeq)}`);
	if (!Number.isSafeInteger(endSeq) || endSeq < startSeq || endSeq > HISTORY_MAX_SEQUENCE) throw new Error(`${label} end sequence is invalid: ${String(endSeq)}`);
	if (endSeq - startSeq + 1 > LOGIN_HISTORY_SYNC_PROTOCOL_LIMITS.maxMessagesPerSession) throw new Error(`${label} may request at most ${LOGIN_HISTORY_SYNC_PROTOCOL_LIMITS.maxMessagesPerSession} sequence slots`);
}
var HISTORY_MAX_COUNT = 200;
var PRIVATE_HISTORY_PAGE_SIZE = 100;
var HISTORY_CHUNK_SEQ = 30;
var HISTORY_MAX_REQUESTS = 12;
var HISTORY_MIN_GAP_MS = 300;
var HISTORY_MAX_SEQUENCE = 4294967295;
var historyRequestGate = new HistoryRequestGate();
/**
* Shared walk-back loop for group + c2c history: pull HISTORY_CHUNK_SEQ-wide
* windows ending at `endSeq`, throttled, walking strictly backward (handling a
* server-side short cap via the oldest sequence actually returned), dedup by
* sequence, until `count` (capped) is gathered or the floor is reached. Returns
* the newest `want` items oldest→newest.
*/
async function walkBackHistory(endSeq, count, fetchWindow, sequenceOf = (event) => event.msgSeq) {
	if (!(endSeq > 0)) return [];
	const want = Math.min(Math.max(1, Math.trunc(count) || 0), HISTORY_MAX_COUNT);
	const collected = /* @__PURE__ */ new Map();
	let curEnd = endSeq;
	for (let i = 0; i < HISTORY_MAX_REQUESTS && collected.size < want && curEnd >= 1; i++) {
		const start = Math.max(1, curEnd - HISTORY_CHUNK_SEQ + 1);
		const batch = await historyRequestGate.run(HISTORY_MIN_GAP_MS, () => fetchWindow(start, curEnd));
		if (batch.length > 0) {
			let minSeq = curEnd;
			for (const ev of batch) {
				const sequence = sequenceOf(ev);
				if (!Number.isInteger(sequence) || sequence < start || sequence > curEnd) throw new Error(`history response sequence is outside requested range ${start}-${curEnd}`);
				collected.set(sequence, ev);
				if (sequence < minSeq) minSeq = sequence;
			}
			curEnd = minSeq - 1;
		} else curEnd = start - 1;
	}
	return [...collected.values()].sort((a, b) => sequenceOf(a) - sequenceOf(b)).slice(-want);
}
/**
* Pull sequence windows starting at `startSeq`, retaining the oldest `want`
* messages at or after the anchor. The returned list is chronological, matching
* the existing backward-history API shape.
*/
async function walkForwardHistory(startSeq, count, fetchWindow, sequenceOf = (event) => event.msgSeq) {
	if (!(startSeq > 0) || startSeq > HISTORY_MAX_SEQUENCE) return [];
	const want = Math.min(Math.max(1, Math.trunc(count) || 0), HISTORY_MAX_COUNT);
	const collected = /* @__PURE__ */ new Map();
	const budget = { remaining: HISTORY_MAX_REQUESTS };
	let curStart = startSeq;
	while (budget.remaining > 0 && collected.size < want && curStart <= HISTORY_MAX_SEQUENCE) {
		const end = Math.min(HISTORY_MAX_SEQUENCE, curStart + HISTORY_CHUNK_SEQ - 1);
		const window = await fetchForwardWindow(curStart, end, budget, fetchWindow, sequenceOf);
		for (const event of window.messages) collected.set(sequenceOf(event), event);
		if (!window.complete || end === HISTORY_MAX_SEQUENCE) break;
		curStart = end + 1;
	}
	return [...collected.values()].sort((a, b) => sequenceOf(a) - sequenceOf(b)).slice(0, want);
}
/**
* Resolve one forward window from its lower boundary. The history service may
* short-cap a range to its newest suffix; recursively fetch the omitted prefix
* before exposing that suffix so callers never skip messages nearest the
* anchor. An exhausted request budget marks the window incomplete, preventing
* later messages from being returned ahead of an unresolved prefix.
*/
async function fetchForwardWindow(startSeq, endSeq, budget, fetchWindow, sequenceOf) {
	if (budget.remaining <= 0) return {
		messages: [],
		complete: false
	};
	budget.remaining--;
	const batch = await historyRequestGate.run(HISTORY_MIN_GAP_MS, () => fetchWindow(startSeq, endSeq));
	if (batch.length === 0) return {
		messages: [],
		complete: true
	};
	const messages = [...new Map(batch.map((event) => [sequenceOf(event), event])).values()].sort((a, b) => sequenceOf(a) - sequenceOf(b));
	for (const message of messages) {
		const sequence = sequenceOf(message);
		if (!Number.isInteger(sequence) || sequence < startSeq || sequence > endSeq) throw new Error(`history response sequence is outside requested range ${startSeq}-${endSeq}`);
	}
	const firstSequence = sequenceOf(messages[0]);
	if (firstSequence === startSeq) return {
		messages,
		complete: true
	};
	const prefix = await fetchForwardWindow(startSeq, firstSequence - 1, budget, fetchWindow, sequenceOf);
	if (!prefix.complete) return prefix;
	return {
		messages: [...prefix.messages, ...messages],
		complete: true
	};
}
var MessageApi = class {
	ctx;
	constructor(ctx) {
		this.ctx = ctx;
	}
	/**
	* Send a message to a QQ group.
	*
	* Wraps `MessageSvc.PbSendMsg` with `routingHead.grp.groupCode`.
	* Media elements (image / record / video) trigger highway uploads
	* inside `buildSendElems` — see `element-builder.ts`.
	*
	* Returns a `SendMessageReceipt` carrying the assigned messageId,
	* group sequence, and timestamps; callers cache this for later
	* `recall` / reply lookups.
	*/
	async sendGroup(groupId, elements) {
		if (elements.length === 0) throw new Error("message is empty");
		const protoElems = await buildSendElems(elements, {
			bridge: this.ctx,
			groupId,
			scene: "group"
		});
		const random = this.ctx.nextMessageRandom();
		const request = protobuf_encode_SendMessageRequest__SendRichText({
			routingHead: { grp: { groupCode: BigInt(groupId) } },
			contentHead: { type: 1 },
			messageBody: { richText: { elems: protoElems } },
			clientSequence: 0,
			random,
			syncCookie: /* @__PURE__ */ new Uint8Array(0),
			via: 0,
			dataStatist: 0,
			multiSendSeq: 0
		});
		const result = await this.ctx.sendRawPacket(SEND_MSG_CMD, request);
		if (!result.success || !result.gotResponse || !result.responseData) throw new Error(`send group message failed: ${result.errorMessage || "no response"}`);
		const response = protobuf_decode_SendMessageResponse(result.responseData);
		if (!response) throw new Error("failed to decode SendMessageResponse");
		if (response.result != null && response.result !== 0) throw new Error(`send group message rejected: result=${response.result} err=${response.errMsg ?? ""}`);
		const seq = response.groupSequence ?? 0;
		if (seq <= 0) {
			log$27.warn("group message delivery unconfirmed: group=%d random=%d result=%s sequence=%s time=%s responseBytes=%d", groupId, random, response.result, response.groupSequence, response.timestamp1, result.responseData.length);
			throw new Error("group message delivery was not confirmed: QQ returned no message receipt; check the conversation before retrying");
		}
		return {
			messageId: random & 2147483647 || seq,
			sequence: seq,
			clientSequence: 0,
			random,
			timestamp: response.timestamp1 ?? Math.floor(Date.now() / 1e3)
		};
	}
	/**
	* Send a c2c (private) message.
	*
	* Resolves the recipient's UID only when the message carries media
	* — text-only messages skip the lookup. Routes through `c2c.uin`
	* (and optionally `c2c.uid` for the media case).
	*/
	async sendPrivate(userUin, elements) {
		const device = findDatalineDeviceByUin(userUin);
		if (device) return this.sendDatalineText(device, elements);
		if (elements.length === 0) throw new Error("message is empty");
		assertWindowShakeSendPolicy(elements.filter((element) => element.type === "poke").length, elements.length, "direct-private");
		let userUid = "";
		if (elements.some((e) => e.type === "image" || e.type === "record" || e.type === "video")) userUid = await this.ctx.resolveUserUid(userUin);
		const richText = await encodePrivateRichText(elements, {
			bridge: this.ctx,
			userUid,
			scene: "direct-private"
		});
		const random = this.ctx.nextMessageRandom();
		const clientSeq = this.ctx.nextClientSequence();
		const request = protobuf_encode_SendMessageRequest__bytes({
			routingHead: { c2c: {
				uin: userUin,
				...userUid ? { uid: userUid } : {}
			} },
			contentHead: {
				type: 1,
				subType: 0,
				c2cCmd: 11
			},
			messageBody: { richText },
			clientSequence: clientSeq,
			random,
			syncCookie: /* @__PURE__ */ new Uint8Array(0),
			via: 0,
			dataStatist: 0,
			ctrl: { msgFlag: Math.floor(Date.now() / 1e3) },
			multiSendSeq: 0
		});
		const result = await this.ctx.sendRawPacket(SEND_MSG_CMD, request);
		if (!result.success || !result.gotResponse || !result.responseData) throw new Error(`send private message failed: ${result.errorMessage || "no response"}`);
		const response = protobuf_decode_SendMessageResponse(result.responseData);
		if (!response) throw new Error("failed to decode SendMessageResponse");
		if (response.result != null && response.result !== 0) throw new Error(`send private message rejected: result=${response.result} err=${response.errMsg ?? ""}`);
		const seq = response.privateSequence ?? 0;
		return {
			messageId: random & 2147483647 || seq,
			sequence: seq,
			clientSequence: clientSeq,
			random,
			timestamp: response.timestamp1 ?? Math.floor(Date.now() / 1e3)
		};
	}
	/**
	* Send text to an official my-device contact. These peers are not
	* ordinary friends — they use the same trans0x211 send path as c2c
	* files, with a device-chat body instead of FileExtra.
	*/
	async sendDatalineText(device, elements) {
		const text = datalineTextFromElements(elements);
		const selfUin = parseInt(this.ctx.identity.uin, 10);
		if (!Number.isSafeInteger(selfUin) || selfUin <= 0) throw new Error("self uin unavailable");
		const random = this.ctx.nextMessageRandom();
		const clientSeq = this.ctx.nextClientSequence();
		const nowSec = Math.floor(Date.now() / 1e3);
		const request = protobuf_encode_SendMessageRequest__SendRichText({
			routingHead: { trans0x211: {
				toUin: BigInt(selfUin),
				ccCmd: 7,
				uid: device.uid
			} },
			contentHead: {
				type: 1,
				subType: 0
			},
			messageBody: { msgContent: encodeDatalineText({
				selfUin,
				dstTerType: device.terType,
				text
			}) },
			clientSequence: clientSeq,
			random,
			syncCookie: /* @__PURE__ */ new Uint8Array(0),
			via: 0,
			dataStatist: 0,
			ctrl: { msgFlag: nowSec },
			multiSendSeq: 0
		});
		const result = await this.ctx.sendRawPacket(SEND_MSG_CMD, request);
		if (!result.success || !result.gotResponse || !result.responseData) throw new Error(`send device message failed: ${result.errorMessage || "no response"}`);
		const response = protobuf_decode_SendMessageResponse(result.responseData);
		if (!response) throw new Error("failed to decode SendMessageResponse");
		if (response.result != null && response.result !== 0) throw new Error(`send device message rejected: result=${response.result} err=${response.errMsg ?? ""}`);
		const seq = response.privateSequence ?? 0;
		return {
			messageId: random & 2147483647 || seq,
			sequence: seq,
			clientSequence: clientSeq,
			random,
			timestamp: response.timestamp1 ?? Math.floor(Date.now() / 1e3)
		};
	}
	/**
	* Reply into an existing group temp session (临时会话). Wire primitive only —
	* it does NOT gate; the caller verifies the session before calling. Routes
	* through `grpTmp` (RoutingHead field 3) with { groupUin, toUid } and a normal
	* c2c content head.
	*/
	async sendGroupTempMessage(userUin, groupUin, elements) {
		if (elements.length === 0) throw new Error("message is empty");
		assertWindowShakeSendPolicy(elements.filter((element) => element.type === "poke").length, elements.length, "group-temp");
		const userUid = await this.ctx.resolveUserUid(userUin);
		const protoElems = await buildSendElems(elements, {
			bridge: this.ctx,
			userUid,
			scene: "group-temp",
			tempGroupId: groupUin
		});
		const random = this.ctx.nextMessageRandom();
		const clientSeq = this.ctx.nextClientSequence();
		const request = protobuf_encode_SendMessageRequest__SendRichText({
			routingHead: { grpTmp: {
				groupUin: BigInt(groupUin),
				toUid: userUid
			} },
			contentHead: {
				type: 1,
				subType: 0,
				c2cCmd: 11
			},
			messageBody: { richText: { elems: protoElems } },
			clientSequence: clientSeq,
			random,
			syncCookie: /* @__PURE__ */ new Uint8Array(0),
			via: 0,
			dataStatist: 0,
			ctrl: { msgFlag: Math.floor(Date.now() / 1e3) },
			multiSendSeq: 0
		});
		const result = await this.ctx.sendRawPacket(SEND_MSG_CMD, request);
		if (!result.success || !result.gotResponse || !result.responseData) throw new Error(`send temp message failed: ${result.errorMessage || "no response"}`);
		const response = protobuf_decode_SendMessageResponse(result.responseData);
		if (!response) throw new Error("failed to decode SendMessageResponse");
		if (response.result != null && response.result !== 0) throw new Error(`send temp message rejected: result=${response.result} err=${response.errMsg ?? ""}`);
		const seq = response.privateSequence ?? 0;
		return {
			messageId: random & 2147483647 || seq,
			sequence: seq,
			clientSequence: clientSeq,
			random,
			timestamp: response.timestamp1 ?? Math.floor(Date.now() / 1e3)
		};
	}
	/**
	* Send a c2c file as a chat message.
	*
	* The wire shape isn't the same as a regular c2c message — the c2c
	* file path uses three slots that differ from a normal text/image
	* send (verified against `dev/Lagrange.Core/.../MessagePacker.cs:
	* BuildPacketBase` + `FileEntity.PackMessageContent`):
	*
	*   1. `routingHead.trans0x211 { ccCmd: 4, uid: peer }` instead of
	*      `routingHead.c2c { uin, uid }`. The server rejects c2c file
	*      messages routed through the regular c2c slot.
	*   2. `messageBody.msgContent` carries the serialised
	*      `FileExtra { file: NotOnlineFile }` bytes. NOT
	*      `richText.notOnlineFile` — the receiver doesn't read that
	*      slot for file metadata.
	*   3. `contentHead.c2cCmd` left at 0 (Lagrange's default). The
	*      previous `c2cCmd: 11` was a stale go-cqhttp value the QQ-NT
	*      server doesn't recognise.
	*
	* NotOnlineFile carries three required-on-send fields the receiver
	* itself ignores but the server's intake validator checks:
	*   - `subcmd: 1`     — c2c file send command code
	*   - `dangerEvel: 0` — virus-scan severity, always 0 client-side
	*   - `expireTime`    — 7 days from now (Lagrange convention)
	*
	* `FileExtra.file` alone makes the file downloadable (verified on a live
	* account). We ALSO attach `FileExtra.field6` — extra server-issued download
	* routing from a best-effort 0xE37_800 finalize that mirrors NapCat and may
	* help some receiver clients. The finalize is non-fatal: if it fails we send
	* without field6 rather than failing the send (issue #157).
	*/
	async sendC2cFile(userUin, userUid, info) {
		const random = this.ctx.nextMessageRandom();
		const clientSeq = this.ctx.nextClientSequence();
		const selfUid = await resolveSelfUid(this.ctx);
		const fileHash = info.fileHash ?? "";
		let meta = null;
		try {
			meta = await FinalizeOfflineFile.invoke(this.ctx, {
				senderUid: selfUid,
				receiverUid: userUid,
				fileUuid: info.fileId,
				fileHash
			});
		} catch (err) {
			log$27.warn("c2c file finalize (0xE37_800) failed, sending without field6: %s", err instanceof Error ? err.message : String(err));
		}
		const nowSec = Math.floor(Date.now() / 1e3);
		const fileExtra = { file: {
			fileType: 0,
			fileUuid: info.fileId,
			fileMd5: info.fileMd5,
			fileName: info.fileName,
			fileSize: BigInt(info.fileSize),
			subcmd: 1,
			dangerEvel: 0,
			expireTime: nowSec + 10080 * 60,
			fileHash
		} };
		if (meta) fileExtra.field6 = { field2: {
			field1: meta.field110,
			fileUuid: info.fileId,
			fileName: info.fileName,
			field6: meta.field3,
			field7: meta.field101,
			field8: meta.field100,
			timestamp1: meta.timestamp1,
			fileHash,
			selfUid,
			destUid: userUid
		} };
		const fileExtraBytes = protobuf_encode_FileExtra(fileExtra);
		const request = protobuf_encode_SendMessageRequest__SendRichText({
			routingHead: { trans0x211: {
				ccCmd: 4,
				uid: userUid
			} },
			contentHead: {
				type: 1,
				subType: 0
			},
			messageBody: { msgContent: fileExtraBytes },
			clientSequence: clientSeq,
			random,
			syncCookie: /* @__PURE__ */ new Uint8Array(0),
			via: 0,
			dataStatist: 0,
			ctrl: { msgFlag: nowSec },
			multiSendSeq: 0
		});
		const result = await this.ctx.sendRawPacket(SEND_MSG_CMD, request);
		if (!result.success || !result.gotResponse || !result.responseData) throw new Error(`send c2c file message failed: ${result.errorMessage || "no response"}`);
		const response = protobuf_decode_SendMessageResponse(result.responseData);
		if (!response) throw new Error("failed to decode SendMessageResponse");
		if (response.result != null && response.result !== 0) throw new Error(`send c2c file message rejected: result=${response.result} err=${response.errMsg ?? ""}`);
		const seq = response.privateSequence ?? 0;
		return {
			messageId: random & 2147483647 || seq,
			sequence: seq,
			clientSequence: clientSeq,
			random,
			timestamp: response.timestamp1 ?? Math.floor(Date.now() / 1e3)
		};
	}
	/**
	* Recall (revoke) a group message by sequence number. Server-side
	* the message ages out after the standard 2-minute window unless
	* the user is an admin/owner.
	*/
	async recallGroup(groupId, sequence) {
		const request = protobuf_encode_GroupRecallRequest({
			type: 1,
			groupUin: groupId,
			info: {
				sequence,
				random: 0,
				field3: 0
			},
			settings: { field1: 0 }
		});
		const result = await this.ctx.sendRawPacket("trpc.msg.msg_svc.MsgService.SsoGroupRecallMsg", request);
		if (!result.success) throw new Error(result.errorMessage || "recall group message failed");
	}
	/**
	* Recall a c2c (private) message. Needs more positional info than
	* the group variant because c2c messages are identified by the
	* `(clientSequence, msgSequence, random, timestamp)` tuple rather
	* than a single group-side sequence.
	*/
	async recallPrivate(userUin, clientSeq, msgSeq, random, timestamp) {
		const request = protobuf_encode_C2CRecallRequest({
			type: 1,
			targetUid: await this.ctx.resolveUserUid(userUin),
			info: {
				clientSequence: clientSeq,
				random,
				messageId: 16777216n << 32n | BigInt(random >>> 0),
				timestamp,
				field5: 0,
				messageSequence: msgSeq
			},
			settings: {
				field1: false,
				field2: false
			},
			field6: false
		});
		const result = await this.ctx.sendRawPacket("trpc.msg.msg_svc.MsgService.SsoC2CRecallMsg", request);
		if (!result.success) throw new Error(result.errorMessage || "recall private message failed");
	}
	/** Mark the entire group conversation read, matching QQ NT's setMsgRead(peer). */
	async markGroupRead(groupId) {
		await this.markAllRead([groupId], []);
	}
	/** Mark the entire private conversation read, matching QQ NT's setMsgRead(peer). */
	async markPrivateRead(userId) {
		await this.markAllRead([], [userId]);
	}
	/**
	* Mark every supplied conversation read through SsoReadedReport.
	*
	* Message-head sequences are not valid C2C read sequences. The first packet
	* therefore reports zero for every conversation and reads the server's
	* current read/latest pair from the response without moving the marker
	* backwards. A second packet advances only conversations that are behind.
	* QQ NT caps each packet at 100 C2C plus 100 group entries and waits for the
	* response before sending the next page; mirror that strictly here.
	*/
	async markAllRead(groupIds, privateUserIds) {
		const groups = uniqueSessionIds(groupIds, "group");
		const privateUsers = uniqueSessionIds(privateUserIds, "private");
		const c2cTargets = [];
		for (const userId of privateUsers) {
			const uid = await this.ctx.resolveUserUid(userId);
			if (!uid) throw new Error(`failed to resolve uid for private read target ${userId}`);
			c2cTargets.push({
				userId,
				uid
			});
		}
		const totalBatches = Math.max(Math.ceil(groups.length / READ_REPORT_BATCH_SIZE), Math.ceil(c2cTargets.length / READ_REPORT_BATCH_SIZE));
		if (totalBatches === 0) return;
		log$27.debug("mark-read start: groups=%d c2c=%d batches=%d", groups.length, c2cTargets.length, totalBatches);
		for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
			const start = batchIndex * READ_REPORT_BATCH_SIZE;
			await this.markReadBatch(groups.slice(start, start + READ_REPORT_BATCH_SIZE), c2cTargets.slice(start, start + READ_REPORT_BATCH_SIZE), batchIndex + 1, totalBatches);
		}
		log$27.debug("mark-read complete: groups=%d c2c=%d", groups.length, c2cTargets.length);
	}
	async sendReadReport(request, label, minimumGapMs = HISTORY_MIN_GAP_MS, signal) {
		log$27.debug("%s send: groups=%d c2c=%d", label, request.groupList?.length ?? 0, request.c2cList?.length ?? 0);
		const payload = protobuf_encode_SsoReadedReportReq(request);
		const response = decodeReadReportResponse(await historyRequestGate.run(minimumGapMs, () => this.ctx.sendRawPacket(READ_REPORT_CMD, payload), signal), label);
		log$27.debug("%s response: groups=%d c2c=%d", label, response.groupList?.length ?? 0, response.c2cList?.length ?? 0);
		return response;
	}
	/**
	* Read the server's current read/latest cursors without advancing any read
	* marker. The zero-valued report fields are omitted on the wire by protobuf,
	* matching QQ NT's read-only probe. Automatic login sync is deliberately
	* limited to one probe with at most 100 group and 100 private targets.
	*/
	async probeHistorySyncState(groupIds, privateTargets, signal) {
		const groups = uniqueSessionIds(groupIds, "group");
		const privateUsers = uniqueHistorySyncPrivateTargets(privateTargets);
		const maxTargets = LOGIN_HISTORY_SYNC_PROTOCOL_LIMITS.maxTargetsPerKind;
		if (groups.length > maxTargets) throw new Error(`history sync probe accepts at most ${maxTargets} group targets`);
		if (privateUsers.length > maxTargets) throw new Error(`history sync probe accepts at most ${maxTargets} private targets`);
		if (groups.length === 0 && privateUsers.length === 0) return {
			groups: [],
			privateUsers: []
		};
		const label = "login history sync probe";
		const response = await this.sendReadReport({
			groupList: groups.map((groupId) => ({
				groupUin: BigInt(groupId),
				lastReadSeq: 0n
			})),
			c2cList: privateUsers.map((target) => ({
				uid: target.uid,
				lastReadTime: 0n,
				lastReadSeq: 0n
			}))
		}, label, LOGIN_HISTORY_SYNC_PROTOCOL_LIMITS.minimumGapMs, signal);
		return {
			groups: groups.map((groupId, index) => {
				const item = this.groupReadResponse(response, groupId, index, label);
				const readSeq = readSafeSequence(item.readSeq, `${label} group ${groupId} read sequence`);
				const latestSeq = readSafeSequence(item.latestSeq, `${label} group ${groupId} latest sequence`);
				if (latestSeq < readSeq) throw new Error(`${label} group ${groupId} latest sequence ${latestSeq} is before read sequence ${readSeq}`);
				return {
					groupId,
					readSeq,
					latestSeq
				};
			}),
			privateUsers: privateUsers.map((target, index) => {
				const item = this.c2cReadResponse(response, target, index, label);
				const targetUin = readSafeSequence(item.targetUin, `${label} private user ${target.userId} target uin`);
				if (targetUin !== 0 && targetUin !== target.userId) throw new Error(`${label} private user ${target.userId} response target ${targetUin} does not match`);
				const readSeq = readSafeSequence(item.readSeq, `${label} private user ${target.userId} read sequence`);
				const latestSeq = readSafeSequence(item.latestSeq, `${label} private user ${target.userId} latest sequence`);
				if (latestSeq < readSeq) throw new Error(`${label} private user ${target.userId} latest sequence ${latestSeq} is before read sequence ${readSeq}`);
				return {
					...target,
					readSeq,
					latestSeq,
					lastMsgTime: readSafeSequence(item.lastMsgTime, `${label} private user ${target.userId} last message time`)
				};
			})
		};
	}
	groupReadResponse(response, groupId, index, label) {
		const groupUin = BigInt(groupId);
		return requireReadResponseItem(response.groupList, index, (item) => item.groupUin === groupUin, `${label} group ${groupId}`);
	}
	c2cReadResponse(response, target, index, label) {
		return requireReadResponseItem(response.c2cList, index, (item) => item.uid === target.uid, `${label} private user ${target.userId}`);
	}
	async markReadBatch(groupIds, c2cTargets, batchIndex, totalBatches) {
		const batchLabel = `mark-read batch ${batchIndex}/${totalBatches}`;
		const probe = await this.sendReadReport({
			groupList: groupIds.map((groupId) => ({
				groupUin: BigInt(groupId),
				lastReadSeq: 0n
			})),
			c2cList: c2cTargets.map((target) => ({
				uid: target.uid,
				lastReadTime: 0n,
				lastReadSeq: 0n
			}))
		}, `${batchLabel} probe`);
		const groupList = [];
		for (let i = 0; i < groupIds.length; i++) {
			const groupId = groupIds[i];
			const item = this.groupReadResponse(probe, groupId, i, `${batchLabel} probe`);
			const readSeq = readUnsignedSequence(item.readSeq, `${batchLabel} group ${groupId} read sequence`);
			const latestSeq = readUnsignedSequence(item.latestSeq, `${batchLabel} group ${groupId} latest sequence`);
			if (latestSeq < readSeq) throw new Error(`${batchLabel} group ${groupId} latest sequence ${latestSeq} is before read sequence ${readSeq}`);
			if (latestSeq > readSeq) groupList.push({
				groupUin: BigInt(groupId),
				lastReadSeq: latestSeq
			});
		}
		const c2cList = [];
		const c2cConfirmTargets = [];
		for (let i = 0; i < c2cTargets.length; i++) {
			const target = c2cTargets[i];
			const item = this.c2cReadResponse(probe, target, i, `${batchLabel} probe`);
			const readSeq = readUnsignedSequence(item.readSeq, `${batchLabel} private user ${target.userId} read sequence`);
			const latestSeq = readUnsignedSequence(item.latestSeq, `${batchLabel} private user ${target.userId} latest sequence`);
			if (latestSeq < readSeq) throw new Error(`${batchLabel} private user ${target.userId} latest sequence ${latestSeq} is before read sequence ${readSeq}`);
			if (latestSeq > readSeq) {
				const lastMsgTime = requirePositiveSequence(item.lastMsgTime, `${batchLabel} private user ${target.userId} last message time`);
				c2cList.push({
					uid: target.uid,
					lastReadTime: lastMsgTime,
					lastReadSeq: latestSeq
				});
				c2cConfirmTargets.push(target);
			}
		}
		if (groupList.length === 0 && c2cList.length === 0) {
			log$27.debug("%s already current", batchLabel);
			return;
		}
		const confirm = await this.sendReadReport({
			groupList,
			c2cList
		}, `${batchLabel} confirm`);
		for (let i = 0; i < groupList.length; i++) {
			const requested = groupList[i];
			const groupId = Number(requested.groupUin);
			const readSeq = readUnsignedSequence(this.groupReadResponse(confirm, groupId, i, `${batchLabel} confirm`).readSeq, `${batchLabel} group ${groupId} confirmed read sequence`);
			if (readSeq < (requested.lastReadSeq ?? 0n)) throw new Error(`${batchLabel} group ${groupId} confirmed sequence ${readSeq} before requested ${requested.lastReadSeq}`);
		}
		for (let i = 0; i < c2cList.length; i++) {
			const requested = c2cList[i];
			const target = c2cConfirmTargets[i];
			const readSeq = readUnsignedSequence(this.c2cReadResponse(confirm, target, i, `${batchLabel} confirm`).readSeq, `${batchLabel} private user ${target.userId} confirmed read sequence`);
			if (readSeq < (requested.lastReadSeq ?? 0n)) throw new Error(`${batchLabel} private user ${target.userId} confirmed sequence ${readSeq} before requested ${requested.lastReadSeq}`);
		}
	}
	/**
	* Fetch real group history from the server (`SsoGetGroupMsg`), including the
	* anchor and walking backward or forward in small windows. Rate-limited and
	* capped so a hammering client cannot flood the server. Returns decoded
	* `group_message` events oldest→newest regardless of query direction.
	*/
	async getGroupHistory(groupUin, anchorSeq, count, selfUin = 0, reverseOrder = true) {
		if (!(groupUin > 0)) return [];
		const fetchWindow = (start, end) => fetchGroupMessageRange(this.ctx, this.ctx.identity, selfUin, groupUin, start, end);
		return reverseOrder ? walkBackHistory(anchorSeq, count, fetchWindow) : walkForwardHistory(anchorSeq, count, fetchWindow);
	}
	/**
	* Fetch exactly one bounded group-history window for automatic login sync.
	* Unlike the public history action this method never paginates or retries.
	*/
	async getGroupHistorySyncPage(groupUin, startSeq, endSeq, selfUin = 0, signal) {
		if (!Number.isSafeInteger(groupUin) || groupUin <= 0) throw new Error(`group history sync target is invalid: ${String(groupUin)}`);
		validateHistorySyncRange(startSeq, endSeq, `group ${groupUin} history sync`);
		const messages = await historyRequestGate.run(LOGIN_HISTORY_SYNC_PROTOCOL_LIMITS.minimumGapMs, () => fetchGroupMessageRange(this.ctx, this.ctx.identity, selfUin, groupUin, startSeq, endSeq), signal);
		return this.validateHistorySyncPage(messages, (message) => message.msgSeq, startSeq, endSeq, `group ${groupUin} history sync`);
	}
	/**
	* Fetch real private history from the server (`SsoGetC2cMsg`), including the
	* anchor in the requested direction. It shares the group variant's throttle
	* and data-volume guards. Returns decoded events oldest→newest.
	*/
	async getC2cHistory(friendUid, anchorSeq, count, selfUin = 0, reverseOrder = true) {
		if (!friendUid) return [];
		const fetchWindow = (start, end) => fetchC2cMessageRange(this.ctx, this.ctx.identity, selfUin, friendUid, start, end);
		const serverSequence = (message) => message.ntMsgSeq ?? 0;
		return reverseOrder ? walkBackHistory(anchorSeq, count, fetchWindow, serverSequence) : walkForwardHistory(anchorSeq, count, fetchWindow, serverSequence);
	}
	/**
	* Fetch exactly one bounded private-history sequence window for automatic
	* login sync. Sender-local message-head sequences are not valid here.
	*/
	async getC2cHistorySyncPage(friendUid, startSeq, endSeq, selfUin = 0, signal) {
		if (!friendUid.trim()) throw new Error("private history sync uid is required");
		validateHistorySyncRange(startSeq, endSeq, `private ${friendUid} history sync`);
		const messages = await historyRequestGate.run(LOGIN_HISTORY_SYNC_PROTOCOL_LIMITS.minimumGapMs, () => fetchC2cMessageRange(this.ctx, this.ctx.identity, selfUin, friendUid, startSeq, endSeq), signal);
		return this.validateHistorySyncPage(messages, (message) => message.ntMsgSeq ?? 0, startSeq, endSeq, `private ${friendUid} history sync`);
	}
	/**
	* Fetch one latest private roaming page for a session without a local
	* authoritative sequence. No cursor loop or retry is permitted.
	*/
	async getC2cLatestHistorySyncPage(friendUid, count, selfUin = 0, beforeTime = Math.floor(Date.now() / 1e3) + 1, signal) {
		if (!friendUid.trim()) throw new Error("private history sync uid is required");
		const maxMessages = LOGIN_HISTORY_SYNC_PROTOCOL_LIMITS.maxMessagesPerSession;
		if (!Number.isSafeInteger(count) || count < 1 || count > maxMessages) throw new Error(`private history sync may request at most ${maxMessages} messages`);
		const page = await historyRequestGate.run(LOGIN_HISTORY_SYNC_PROTOCOL_LIMITS.minimumGapMs, () => fetchC2cRoamMessagePage(this.ctx, this.ctx.identity, selfUin, friendUid, beforeTime, count, 0), signal);
		const messages = [...new Map(page.messages.map((message) => {
			const sequence = message.ntMsgSeq ?? 0;
			if (!Number.isSafeInteger(sequence) || sequence <= 0) throw new Error(`private ${friendUid} history sync returned invalid NT sequence ${String(sequence)}`);
			return [sequence, message];
		})).values()].sort((a, b) => (a.ntMsgSeq ?? 0) - (b.ntMsgSeq ?? 0) || a.time - b.time);
		if (messages.length > count) throw new Error(`private ${friendUid} history sync returned ${messages.length} messages for a ${count}-message request`);
		return messages;
	}
	/**
	* Fetch the latest private history page without relying on a locally cached
	* sequence. C2C field-5 sequences are sender-local, so only SsoGetRoamMsg's
	* timestamp cursor can safely bootstrap an unanchored conversation.
	*/
	async getC2cLatestHistory(friendUid, count, selfUin = 0, beforeTime = Math.floor(Date.now() / 1e3) + 1) {
		if (!friendUid) return [];
		const want = Math.min(Math.max(1, Math.trunc(count) || 0), HISTORY_MAX_COUNT);
		const collected = /* @__PURE__ */ new Map();
		let cursor = {
			time: beforeTime,
			random: 0
		};
		const seenCursors = /* @__PURE__ */ new Set([`${cursor.time}:${cursor.random}`]);
		let reachedEnd = false;
		for (let i = 0; i < HISTORY_MAX_REQUESTS && collected.size < want; i++) {
			const page = await historyRequestGate.run(HISTORY_MIN_GAP_MS, () => fetchC2cRoamMessagePage(this.ctx, this.ctx.identity, selfUin, friendUid, cursor.time, Math.min(want - collected.size, PRIVATE_HISTORY_PAGE_SIZE), cursor.random));
			for (const message of page.messages) {
				const sequence = message.ntMsgSeq ?? 0;
				if (!Number.isSafeInteger(sequence) || sequence <= 0) throw new Error(`private roam history returned invalid NT sequence ${String(sequence)}`);
				collected.set(sequence, message);
			}
			if (collected.size >= want) break;
			if (page.isComplete || page.cursor.time === 0 && page.cursor.random === 0) {
				reachedEnd = true;
				break;
			}
			const nextCursorKey = `${page.cursor.time}:${page.cursor.random}`;
			if (seenCursors.has(nextCursorKey)) throw new Error(`private roam history cursor did not advance from ${cursor.time}/${cursor.random}`);
			seenCursors.add(nextCursorKey);
			cursor = page.cursor;
		}
		if (collected.size < want && !reachedEnd) throw new Error(`private roam history request budget exhausted after ${HISTORY_MAX_REQUESTS} pages (requested=${want}, collected=${collected.size})`);
		return [...collected.values()].sort((a, b) => (a.ntMsgSeq ?? 0) - (b.ntMsgSeq ?? 0) || a.time - b.time).slice(-want);
	}
	/**
	* Fetch a single group message by its exact sequence — `SsoGetGroupMsg` over a
	* 1-wide `[seq, seq]` range, through the shared history throttle gate. Used to
	* back-fill a replied-to message the local store never saw. Returns the
	* matching `group_message`, or null if absent / on error.
	*/
	async getGroupMessageBySeq(groupUin, seq, selfUin = 0) {
		if (!(groupUin > 0) || !(seq > 0)) return null;
		try {
			return (await historyRequestGate.run(HISTORY_MIN_GAP_MS, () => fetchGroupMessageRange(this.ctx, this.ctx.identity, selfUin, groupUin, seq, seq))).find((m) => m.msgSeq === seq) ?? null;
		} catch {
			return null;
		}
	}
	/**
	* Fetch a single c2c message by its exact conversation-wide NT sequence —
	* `SsoGetC2cMsg` over a 1-wide `[seq, seq]` range, through the same throttle
	* gate. Sender-local reply/recall sequences must not be passed here.
	*/
	async getC2cMessageBySeq(friendUid, seq, selfUin = 0) {
		if (!friendUid || !(seq > 0)) return null;
		try {
			return (await historyRequestGate.run(HISTORY_MIN_GAP_MS, () => fetchC2cMessageRange(this.ctx, this.ctx.identity, selfUin, friendUid, seq, seq))).find((m) => m.ntMsgSeq === seq) ?? null;
		} catch {
			return null;
		}
	}
	validateHistorySyncPage(messages, sequenceOf, startSeq, endSeq, label) {
		const bySequence = /* @__PURE__ */ new Map();
		for (const message of messages) {
			const sequence = sequenceOf(message);
			if (!Number.isSafeInteger(sequence) || sequence < startSeq || sequence > endSeq) throw new Error(`${label} returned sequence ${String(sequence)} outside requested range ${startSeq}-${endSeq}`);
			bySequence.set(sequence, message);
		}
		return [...bySequence.values()].sort((a, b) => sequenceOf(a) - sequenceOf(b));
	}
};
