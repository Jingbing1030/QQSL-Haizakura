#!/usr/bin/env python3
"""
dump-vtable.py —— 从 wrapper.node 提取 C++ RTTI / vtable / 虚函数名

用途：SnowLuma 的 hook 依赖 QQ wrapper.node 的 RTTI 结构。
     QQ 升级后，用本工具 dump 新版本的结构，与历史基线 diff，
     就能算出需要更新哪些常量（多数情况只是字符串/数字）。

用法：
    python3 dump-vtable.py --wrapper wrapper.node --class 'nt::MSFService'
    python3 dump-vtable.py --wrapper wrapper.node --dump-all > baseline.json
    python3 dump-vtable.py --wrapper wrapper.node --diff baseline.json

核心原理（Itanium C++ ABI）：
    RTTI 名（mangled）  "N2nt10MSFServiceE"      ← 注意是 mangled，不是纯类名！
         ↓ 在 .data.rel.ro 里搜「指向该名的指针」，-8 即 typeinfo 起始
    typeinfo            { vtable_ptr, __type_name }
         ↓ 再搜「指向 typeinfo 的指针」
    vtable              v[-1]=offset_to_top, v[0]=typeinfo, v[1..]=虚函数指针

无第三方依赖（不需要 capstone/pyelftools），纯 Python + struct。
"""
import argparse
import json
import re
import struct
import sys

# ── ELF 解析（最小实现，只取节表 + 节名） ──────────────────────────


class ELF:
    def __init__(self, path):
        self.path = path
        with open(path, "rb") as f:
            self.data = f.read()
        d = self.data
        if d[:4] != b"\x7fELF":
            raise SystemExit("不是 ELF 文件")
        if d[4] != 2:
            raise SystemExit("只支持 ELF64")
        self.is_le = d[5] == 1
        E = "<" if self.is_le else ">"
        self.E = E
        # ELF64 header
        (self.e_type, self.e_machine) = struct.unpack_from(E + "HH", d, 16)
        self.e_shoff = struct.unpack_from(E + "Q", d, 0x28)[0]
        self.e_shentsize = struct.unpack_from(E + "H", d, 0x3A)[0]
        self.e_shnum = struct.unpack_from(E + "H", d, 0x3C)[0]
        self.e_shstrndx = struct.unpack_from(E + "H", d, 0x3E)[0]
        self.sections = self._read_sections()
        self.by_name = {s["name"]: s for s in self.sections}

    def _read_sections(self):
        d, E = self.data, self.E
        # 先取 shstrtab
        off = self.e_shoff + self.e_shstrndx * self.e_shentsize
        shstr_off = struct.unpack_from(E + "Q", d, off + 0x18)[0]
        shstr_size = struct.unpack_from(E + "Q", d, off + 0x20)[0]
        shstr = d[shstr_off:shstr_off + shstr_size]
        out = []
        for i in range(self.e_shnum):
            off = self.e_shoff + i * self.e_shentsize
            name_off = struct.unpack_from(E + "I", d, off)[0]
            name = shstr[name_off:shstr.find(b"\0", name_off)].decode("utf-8", "replace")
            sh_type = struct.unpack_from(E + "I", d, off + 4)[0]
            sh_addr = struct.unpack_from(E + "Q", d, off + 0x10)[0]
            sh_offset = struct.unpack_from(E + "Q", d, off + 0x18)[0]
            sh_size = struct.unpack_from(E + "Q", d, off + 0x20)[0]
            out.append({"idx": i, "name": name, "type": sh_type,
                        "addr": sh_addr, "offset": sh_offset, "size": sh_size})
        return out

    # vaddr → file offset
    def v2f(self, va):
        for s in self.sections:
            if s["type"] != 8 and s["addr"] and s["addr"] <= va < s["addr"] + s["size"]:
                return va - s["addr"] + s["offset"]
        return None

    def f2v(self, fo):
        for s in self.sections:
            if s["type"] != 8 and s["offset"] and s["offset"] <= fo < s["offset"] + s["size"]:
                return fo - s["offset"] + s["addr"]
        return None

    def read_va(self, va, n):
        fo = self.v2f(va)
        return self.data[fo:fo + n] if fo is not None else None


# ── mangled 名处理 ────────────────────────────────────────────────


def demangle_simple(mangled):
    """极简 Itanium demangle：够用于提取类名（不依赖 c++filt）。"""
    if not mangled.startswith("_Z"):
        return mangled
    s = mangled[2:]
    if s.startswith("TV") or s.startswith("TI") or s.startswith("TS"):
        s = s[2:]
    # N ... E 嵌套名
    if s.startswith("N"):
        s = s[1:]
        parts, i = [], 0
        while i < len(s) and s[i] != "E":
            m = re.match(r"(\d+)", s[i:])
            if not m:
                break
            n = int(m.group(1))
            i += len(m.group(1))
            parts.append(s[i:i + n])
            i += n
        return "::".join(p for p in parts if p)
    return mangled


def mangle_class(cls):
    """把 'nt::MSFService' 编码成 RTTI 名 'N2nt10MSFServiceE'。"""
    parts = cls.split("::")
    return "N" + "".join(f"{len(p)}{p}" for p in parts) + "E"


# ── RTTI 解析 ─────────────────────────────────────────────────────


def find_typeinfo(elf, cls):
    """返回 (mangled_name, name_va, typeinfo_va, type_info_vtable) 列表。"""
    mangled = mangle_class(cls)
    needle = mangled.encode() + b"\0"
    results = []
    start = 0
    while True:
        i = elf.data.find(needle, start)
        if i < 0:
            break
        start = i + 1
        name_va = elf.f2v(i)
        if name_va is None:
            continue
        # 在 .data.rel.ro 里搜指向该名的指针
        drr = elf.by_name.get(".data.rel.ro")
        if not drr:
            continue
        ptr = struct.pack(elf.E + "Q", name_va)
        for sec in (".data.rel.ro", ".data"):
            s = elf.by_name.get(sec)
            if not s:
                continue
            p = s["offset"]
            end = p + s["size"]
            while True:
                j = elf.data.find(ptr, p, end)
                if j < 0:
                    break
                p = j + 8
                ti_fo = j - 8                       # __type_name 是第 2 个字段
                ti_va = elf.f2v(ti_fo)
                if ti_va is None:
                    continue
                vt = struct.unpack(elf.E + "Q", elf.data[ti_fo:ti_fo + 8])[0]
                results.append({
                    "class": cls, "mangled": mangled,
                    "name_va": name_va, "typeinfo_va": ti_va,
                    "type_info_vtable": vt,
                })
    # 去重
    seen, uniq = set(), []
    for r in results:
        if r["typeinfo_va"] in seen:
            continue
        seen.add(r["typeinfo_va"])
        uniq.append(r)
    return uniq


def find_vtables(elf, ti_va):
    """搜所有指向 typeinfo 的指针 → 那就是 vtable[0]（typeinfo 槽）。"""
    ptr = struct.pack(elf.E + "Q", ti_va)
    out = []
    for sec in (".data.rel.ro", ".data"):
        s = elf.by_name.get(sec)
        if not s:
            continue
        p, end = s["offset"], s["offset"] + s["size"]
        while True:
            j = elf.data.find(ptr, p, end)
            if j < 0:
                break
            p = j + 8
            ap_fo = j                          # address point（v[0] 的位置）
            ap_va = elf.f2v(ap_fo)
            if ap_va is None:
                continue
            raw = elf.data[ap_fo - 8:ap_fo]
            off_top = struct.unpack(elf.E + "q", raw)[0] if len(raw) == 8 else None
            out.append({"address_point": ap_va, "offset_to_top": off_top})
    return out


def read_slots(elf, ap_va, max_slots=200):
    """读 vtable 槽位（v[1..]），遇到非法地址停止。"""
    slots = []
    for k in range(1, max_slots):
        va = ap_va + k * 8
        raw = elf.read_va(va, 8)
        if not raw or len(raw) < 8:
            break
        fn = struct.unpack(elf.E + "Q", raw)[0]
        if fn == 0xDEADBEEF or fn > 0x7FFFFFFFFFFF:
            break
        # 只有落在可执行段才算
        ok = False
        for s in elf.sections:
            if s["addr"] and s["addr"] <= fn < s["addr"] + s["size"] and s["type"] == 1:
                ok = True
                break
        if not ok and fn != 0:
            # 允许连续的 data 引用（部分槽是 typeinfo），但不无限读
            if k > 4 and not any(s["addr"] <= fn < s["addr"] + s["size"] for s in elf.sections):
                break
        slots.append({"slot": k, "byte_offset": k * 8, "fn_va": fn,
                      "is_code": ok})
    return slots


# ── 主流程 ────────────────────────────────────────────────────────


def dump_class(elf, cls, verbose=True):
    tis = find_typeinfo(elf, cls)
    if not tis:
        if verbose:
            print(f"[!] {cls}: 未找到 typeinfo"
                  f"（检查 mangled 名 {mangle_class(cls)}）", file=sys.stderr)
        return None
    out = []
    for ti in tis:
        vts = find_vtables(elf, ti["typeinfo_va"])
        entry = dict(ti)
        entry["vtables"] = []
        for vt in vts:
            slots = read_slots(elf, vt["address_point"])
            entry["vtables"].append({**vt, "slot_count": len(slots), "slots": slots})
        out.append(entry)
    if verbose:
        for e in out:
            print(f"\n{'='*72}")
            print(f"类: {e['class']}   (mangled: {e['mangled']})")
            print(f"{'='*72}")
            print(f"  RTTI 名 VA     : 0x{e['name_va']:x}")
            print(f"  typeinfo VA    : 0x{e['typeinfo_va']:x}")
            print(f"  type_info vtable: 0x{e['type_info_vtable']:x}")
            for vt in e["vtables"]:
                print(f"\n  vtable @ 0x{vt['address_point']:x}"
                      f"  offset_to_top={vt['offset_to_top']}"
                      f"  槽位={vt['slot_count']}")
                for s in vt["slots"]:
                    mark = "code" if s["is_code"] else "data"
                    print(f"    v[{s['slot']:3d}] +0x{s['byte_offset']:03x}"
                          f"  -> 0x{s['fn_va']:x}  [{mark}]")
    return out


def main():
    ap = argparse.ArgumentParser(description="从 wrapper.node dump C++ RTTI/vtable 结构")
    ap.add_argument("--wrapper", required=True, help="wrapper.node 路径")
    ap.add_argument("--class", dest="cls", help="类名，如 'nt::MSFService'")
    ap.add_argument("--classes", default="nt::MSFService,nt::MSFCoreService",
                    help="批量类名（逗号分隔）")
    ap.add_argument("--dump-all", action="store_true", help="输出 JSON 到 stdout")
    ap.add_argument("--diff", help="与基线 JSON 对比")
    args = ap.parse_args()

    elf = ELF(args.wrapper)
    print(f"[i] {args.wrapper}: {len(elf.data)} 字节", file=sys.stderr)
    for s in elf.sections:
        if s["name"] in (".rodata", ".data.rel.ro", ".text", ".dynsym", ".eh_frame"):
            print(f"    {s['name']:16s} addr=0x{s['addr']:x} off=0x{s['offset']:x} "
                  f"size=0x{s['size']:x}", file=sys.stderr)

    classes = [args.cls] if args.cls else args.classes.split(",")
    result = {}
    for c in classes:
        r = dump_class(elf, c.strip(), verbose=not args.dump_all)
        if r:
            result[c.strip()] = r

    if args.dump_all:
        json.dump(result, sys.stdout, indent=2, ensure_ascii=False)
        print()
    if args.diff:
        with open(args.diff) as f:
            base = json.load(f)
        for c, cur in result.items():
            old = base.get(c)
            if not old:
                print(f"[+] 新类 {c}")
                continue
            o_ap = {v["address_point"] for e in old for v in e["vtables"]}
            n_ap = {v["address_point"] for e in cur for v in e["vtables"]}
            print(f"\n[=] {c}: vtable 地址点 {len(o_ap)} -> {len(n_ap)}")
            for e in cur:
                for v in e["vtables"]:
                    print(f"    ap=0x{v['address_point']:x} 槽位={v['slot_count']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
