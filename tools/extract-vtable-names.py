#!/usr/bin/env python3
"""
extract-vtable-names.py —— 从 wrapper.node 提取虚表槽位的函数身份。

**无第三方依赖**（自带极简 ELF64 解析，不需要 pyelftools/capstone）。
这点是刻意的：目标容器里既没有 pip 也没有 pyelftools，不能要求安装。

原理（Itanium C++ ABI + AArch64）：
  1. 在 .rodata 里找到 RTTI 名字符串，如 "N2nt10MSFServiceE"
  2. 在 .data.rel.ro 里找指向它的指针 → -8 处是 typeinfo
  3. 再找指向 typeinfo 的指针 → +8 处是 vtable 的 address point
  4. 逐槽读出目标函数地址
  5. 扫目标函数体里的 adrp+add，取出它引用的字符串
     —— 源文件名 + 函数名 + 日志文案 = 该槽位的「身份」

输出：{类名: [[槽位号, vtable槽地址, 目标函数地址, [字符串...]], ...]}
"""
import argparse
import json
import re
import struct
import sys
from pathlib import Path

PT_LOAD = 1


class MiniELF:
    """只解析我们需要的部分：节表 + 节名。"""

    def __init__(self, path):
        self.path = path
        self.fh = open(path, 'rb')
        self.data = self.fh.read()
        d = self.data
        if d[:4] != b'\x7fELF':
            raise SystemExit('不是 ELF 文件')
        if d[4] != 2:
            raise SystemExit('只支持 ELF64')
        if d[5] != 1:
            raise SystemExit('只支持小端')

        # ELF64 header
        e_shoff = struct.unpack_from('<Q', d, 0x28)[0]
        e_shentsize = struct.unpack_from('<H', d, 0x3a)[0]
        e_shnum = struct.unpack_from('<H', d, 0x3c)[0]
        e_shstrndx = struct.unpack_from('<H', d, 0x3e)[0]

        # 先取节名字符串表
        def sh(i):
            o = e_shoff + i * e_shentsize
            name, typ = struct.unpack_from('<II', d, o)
            flags, addr, off, size = struct.unpack_from('<QQQQ', d, o + 8)
            link = struct.unpack_from('<I', d, o + 0x28)[0]
            return dict(name_off=name, type=typ, flags=flags,
                        addr=addr, off=off, size=size, link=link)

        shstr = sh(e_shstrndx)
        strtab = d[shstr['off']:shstr['off'] + shstr['size']]

        def nm(off):
            z = strtab.find(b'\0', off)
            return strtab[off:z].decode('utf-8', 'replace')

        self.S = {}
        for i in range(e_shnum):
            s = sh(i)
            s['name'] = nm(s['name_off'])
            self.S[s['name']] = s

    def get(self, name):
        s = self.S.get(name)
        if not s:
            raise SystemExit(f'缺少节 {name}')
        return s

    def read(self, name, off, n):
        s = self.get(name)
        self.fh.seek(s['off'] + off)
        return self.fh.read(n)


class Wrapper:
    CLASSES = ['MSFService', 'MSFCoreService']
    MANGLED = {'MSFService': b'N2nt10MSFServiceE',
               'MSFCoreService': b'N2nt14MSFCoreServiceE'}

    def __init__(self, path):
        self.e = MiniELF(path)
        self.fh = self.e.fh
        ro = self.e.get('.rodata')
        tx = self.e.get('.text')
        dr = self.e.get('.data.rel.ro')
        self.RA, self.RO, self.RS = ro['addr'], ro['off'], ro['size']
        self.TA, self.TO, self.TS = tx['addr'], tx['off'], tx['size']
        self.DA, self.DO, self.DS = dr['addr'], dr['off'], dr['size']
        self.DELTA = self.DA - self.DO          # VA 与 file offset 的固定差
        self.fh.seek(self.TO)
        self.TEXT = self.fh.read(self.TS)
        self.fh.seek(self.RO)
        self.RODATA = self.fh.read(self.RS)
        self.fh.seek(self.DO)
        self.DRR = self.fh.read(self.DS)

    def in_ro(self, va):
        return self.RA <= va < self.RA + self.RS

    def in_drr(self, va):
        return self.DA <= va < self.DA + self.DS

    def in_tx(self, va):
        return self.TA <= va < self.TA + self.TS

    def cstr_at(self, va, buf, base, maxlen=200):
        if not (base <= va < base + len(buf)):
            return None
        o = va - base
        z = buf.find(b'\0', o, o + maxlen)
        if z < 0 or z - o < 3:
            return None
        try:
            t = buf[o:z].decode('ascii')
        except UnicodeDecodeError:
            return None
        return t if all(32 <= ord(c) < 127 for c in t) else None

    def cstr(self, va):
        return self.cstr_at(va, self.RODATA, self.RA)

    def cstr_drr(self, va):
        return self.cstr_at(va, self.DRR, self.DA)

    def u32(self, va):
        if self.in_tx(va):
            return struct.unpack_from('<I', self.TEXT, va - self.TA)[0]
        return None

    def ptr_drr(self, va):
        if self.in_drr(va):
            return struct.unpack_from('<Q', self.DRR, va - self.DA)[0]
        return None

    def find_typeinfo(self, mangled):
        """RTTI 名 → typeinfo 地址（typeinfo.__type_name 指向该名）"""
        m = re.search(re.escape(mangled), self.RODATA)
        if not m:
            return None
        name_va = self.RA + m.start()
        pat = struct.pack('<Q', name_va)
        i = self.DRR.find(pat)
        if i < 0:
            return None
        return self.DA + i - 8        # __type_name 是 typeinfo 的第 2 个字段

    def find_vtable(self, ti_va):
        """typeinfo → vtable address point（指向 typeinfo 的指针 +8）"""
        pat = struct.pack('<Q', ti_va)
        i = self.DRR.find(pat)
        if i < 0:
            return None
        return self.DA + i + 8

    def slot_count(self, ap, maxslots=400):
        n = 0
        for i in range(0, maxslots):
            t = self.ptr_drr(ap + 8 * i)
            if t is None or not self.in_tx(t):
                break
            n = i + 1
        return n

    def follow(self, fn):
        """跟一次无条件跳转（b/bl 桩）"""
        w = self.u32(fn)
        if w is None:
            return fn
        if (w & 0xFC000000) in (0x14000000, 0x94000000):
            imm = w & 0x03FFFFFF
            if imm & (1 << 25):
                imm -= (1 << 26)
            return fn + imm * 4
        return fn

    def fn_strings(self, fn, span=0x600):
        """扫函数体，收集 adrp+add 指向的字符串（.rodata 与 .data.rel.ro）"""
        out = []
        if not self.in_tx(fn):
            return out
        base = fn - self.TA
        end = min(base + span, len(self.TEXT) - 16)
        i = base
        while i < end:
            w = struct.unpack_from('<I', self.TEXT, i)[0]
            if (w & 0x9F000000) == 0x90000000:            # ADRP
                rd = w & 0x1F
                lo = (w >> 29) & 3
                hi = (w >> 5) & 0x7FFFF
                imm = (hi << 2) | lo
                if imm & (1 << 20):
                    imm -= (1 << 21)
                pc = fn + (i - base)
                # adrp 的 imm 是【页数】—— 必须左移 12
                page = (pc & ~0xfff) + (imm << 12)
                for k in (1, 2, 3, 4):
                    j = i + 4 * k
                    if j + 4 > len(self.TEXT):
                        break
                    w2 = struct.unpack_from('<I', self.TEXT, j)[0]
                    # ADD (imm), 64-bit, 同寄存器
                    if (w2 & 0xFF800000) == 0x91000000 \
                       and ((w2 >> 5) & 0x1F) == rd and (w2 & 0x1F) == rd:
                        imm12 = (w2 >> 10) & 0xFFF
                        sh = (w2 >> 22) & 1
                        va = page + (imm12 << (12 if sh else 0))
                        s = self.cstr(va) or self.cstr_drr(va)
                        if s:
                            out.append(s)
            i += 4
        return out

    def extract(self, verbose=False):
        summary = {}
        for cls in self.CLASSES:
            mg = self.MANGLED[cls]
            ti = self.find_typeinfo(mg)
            if ti is None:
                print(f'[!] {cls}: 找不到 typeinfo', file=sys.stderr)
                continue
            vt = self.find_vtable(ti)
            if vt is None:
                print(f'[!] {cls}: 找不到 vtable', file=sys.stderr)
                continue
            n = self.slot_count(vt)
            print(f'[+] {cls}: typeinfo=0x{ti:x} vtable=0x{vt:x} 槽位={n}',
                  file=sys.stderr)
            rows = []
            for i in range(1, n + 1):
                sv = vt + 8 * (i - 1)
                fn = self.ptr_drr(sv)
                if fn is None:
                    break
                tgt = self.follow(fn)
                names = self.fn_strings(tgt) or self.fn_strings(fn)
                rows.append([i, hex(sv), hex(fn), names])
                if verbose:
                    print(f'      v[{i:3d}] 0x{fn:x}  {" | ".join(names[:4])}',
                          file=sys.stderr)
            summary[cls] = rows
        return summary


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('wrapper')
    ap.add_argument('--out', default='/tmp/hz-vtable-names.json')
    ap.add_argument('--verbose', action='store_true')
    a = ap.parse_args()

    print(f'[i] {a.wrapper}: {Path(a.wrapper).stat().st_size} 字节', file=sys.stderr)
    w = Wrapper(a.wrapper)
    print(f'    .text   0x{w.TA:x}-0x{w.TA+w.TS:x}', file=sys.stderr)
    print(f'    .rodata 0x{w.RA:x}-0x{w.RA+w.RS:x}', file=sys.stderr)
    summary = w.extract(a.verbose)
    if not summary:
        sys.exit('未能提取任何类')
    Path(a.out).write_text(json.dumps(summary, indent=1), encoding='utf-8')
    print(f'[✓] 写出 {a.out}', file=sys.stderr)


if __name__ == '__main__':
    main()
