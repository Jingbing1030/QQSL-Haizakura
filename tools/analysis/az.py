#!/usr/bin/env python3
# Bounded annotated AArch64 disassembler + function-boundary finder.  SAFE: no unbounded loops.
import sys, bisect
from elftools.elf.elffile import ELFFile
from capstone import *
from capstone.arm64 import *

PATH = '/tmp/re/snowluma-linux-arm64.so'
data = open(PATH,'rb').read()          # 335KB, fine
elf  = ELFFile(open(PATH,'rb'))
secs = {}
for s in elf.iter_sections():
    secs[s.name] = (s['sh_addr'], s['sh_offset'], s['sh_size'])

def sec_of(a):
    for n,(x,o,sz) in secs.items():
        if x and x <= a < x+sz: return n
def read_va(a,n):
    for name,(x,o,sz) in secs.items():
        if x and x <= a < x+sz and a+n <= x+sz:
            return data[o+(a-x):o+(a-x)+n]
    return b''

got2sym = {}
for sn in ('.rela.dyn','.rela.plt'):
    s = elf.get_section_by_name(sn)
    if not s: continue
    st = elf.get_section(s['sh_link'])
    for r in s.iter_relocations():
        nm = st.get_symbol(r['r_info_sym']).name
        if nm: got2sym[r['r_offset']] = nm
s  = elf.get_section_by_name('.rela.plt'); st = elf.get_section(s['sh_link'])
order = [st.get_symbol(r['r_info_sym']).name for r in s.iter_relocations()]
plt_map = {secs['.plt'][0]+0x20+i*16: nm for i,nm in enumerate(order)}   # +0x20 = resolver stub

sym_by_addr = {}
for sym in elf.get_section_by_name('.dynsym').iter_symbols():
    if sym['st_value'] and sym.name: sym_by_addr.setdefault(sym['st_value'], sym.name)

def hardstr(va, cap=120):
    for name,(x,o,sz) in secs.items():
        if x and x <= va < x+sz and name in ('.rodata','.data.rel.ro','.data'):
            off = o+(va-x); stt = off
            while stt > o and 32 <= data[stt-1] < 127: stt -= 1
            en = off
            while en < o+sz and 32 <= data[en] < 127: en += 1
            if en > stt:
                t = data[stt:en].decode('latin1')
                if len(t) >= 2: return t[:cap]
    return None

md = Cs(CS_ARCH_ARM64, CS_MODE_LITTLE_ENDIAN); md.detail = True

# ---------- function boundaries: linear prologue scan (one pass, stores only addrs) ----------
def find_funcs():
    lo, off, sz = secs['.text']
    code = data[off:off+sz]
    starts = [lo]
    i = 0
    # prologue patterns: stp x29,x30,[sp,#-N]!  /  sub sp,sp,#N  /  stp x29,x30,[sp,#-N]
    while i + 4 <= len(code):
        w = int.from_bytes(code[i:i+4],'little')
        # stp x29,x30,[sp,#imm]! : 0xA9Bx7BFD  (pre-index, 64-bit)
        if (w & 0xFFC07FFF) == 0xA9807BFD or (w & 0xFFC07FFF) == 0xA9007BFD:
            starts.append(lo+i)
            i += 4; continue
        i += 4
    return sorted(set(starts))

FUNCS = find_funcs()
def func_extent(a):
    """extent from prologue scan (approximate upper bound)"""
    i = bisect.bisect_right(FUNCS, a) - 1
    if i < 0: return (a, a+0x100)
    lo = FUNCS[i]
    hi = FUNCS[i+1] if i+1 < len(FUNCS) else secs['.text'][0]+secs['.text'][2]
    return (lo, hi)

def dis(addr, end=None, maxinsn=4000):
    if end is None:
        end = func_extent(addr)[1]
    end = min(end, addr + maxinsn*4)
    code = read_va(addr, end-addr)
    if not code:
        print(f"  <no data at {addr:#x}>"); return
    adrp = {}
    out = []
    n = 0
    for insn in md.disasm(code, addr):
        n += 1
        if n > maxinsn: break
        notes = []
        ops = insn.operands
        if insn.mnemonic == 'adrp' and len(ops) == 2 and ops[1].type == ARM64_OP_IMM:
            adrp[ops[0].reg] = ops[1].imm
            t = hardstr(ops[1].imm)
            if t: notes.append(f'~"{t}"')
        elif insn.mnemonic in ('add','ldr','ldrb','str','ldrh','ldur') and ops:
            # adrp+add / adrp+ldr  resolution
            if len(ops) >= 3 and ops[1].type == ARM64_OP_REG and ops[2].type == ARM64_OP_IMM \
               and ops[1].reg in adrp:
                va = adrp[ops[1].reg] + ops[2].imm
                t = hardstr(va)
                notes.append(f'@{va:#x}' + (f' "{t}"' if t else ''))
                adrp.pop(ops[1].reg, None)
            elif len(ops) >= 2 and ops[1].type == ARM64_OP_MEM and ops[1].mem.base in adrp:
                va = adrp[ops[1].mem.base] + ops[1].mem.disp
                t = hardstr(va)
                notes.append(f'@{va:#x}' + (f' "{t}"' if t else ''))
                adrp.pop(ops[1].mem.base, None)
        for op in ops:
            if op.type == ARM64_OP_MEM and op.mem.disp:
                d = op.mem.disp
                if d in got2sym and op.mem.base in (ARM64_REG_X8,ARM64_REG_X16,ARM64_REG_X17,ARM64_REG_X19):
                    notes.append(f'GOT:{got2sym[d]}')
        for op in ops:
            if op.type == ARM64_OP_IMM and op.imm > 0x4000:
                t = op.imm
                if t in plt_map: notes.append(f'PLT:{plt_map[t]}')
                elif t in sym_by_addr: notes.append(f'sym:{sym_by_addr[t]}')
                elif addr <= t < end: notes.append(f'.L_{t:x}')
                elif t in FUNCS: notes.append(f'call sub_{t:x}')
                elif t > 0x43000: notes.append(f'data_{t:x}')
        out.append(f"  {insn.address:06x}: {insn.bytes.hex():<8} {insn.mnemonic:<9} {insn.op_str}" + (f"   ; {' | '.join(notes)}" if notes else ""))
    print(f"===== disasm {addr:#x} .. {end:#x}  (section {sec_of(addr)}, {n} insns) =====")
    print("\n".join(out)); print()

if __name__ == '__main__':
    args = sys.argv[1:]
    if args and args[0] == 'FUNCS':
        print(f"total prologue-discovered funcs: {len(FUNCS)}")
        print(" ".join(f"{f:x}" for f in FUNCS[:80]))
    elif args and args[0] == 'EXT':
        for a in args[1:]:
            lo,hi = func_extent(int(a,0)); print(f"{a} -> sub_{lo:x} .. {hi:x} (size {hi-lo})")
    else:
        for c in args:
            if ':' in c:
                a,b = c.split(':'); dis(int(a,0), int(b,0))
            else:
                dis(int(c,0))
