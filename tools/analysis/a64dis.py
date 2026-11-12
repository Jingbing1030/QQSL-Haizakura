#!/usr/bin/env python3
"""AArch64 disassembler with PLT/reloc resolution."""
import sys, subprocess
from elftools.elf.elffile import ELFFile
from capstone import *
from capstone.arm64 import *

PATH = sys.argv[1] if len(sys.argv)>1 else '/tmp/re/snowluma-linux-arm64.so'
data = open(PATH,'rb').read()
elf = ELFFile(open(PATH,'rb'))
secs = {}
for s in elf.iter_sections():
    secs[s.name] = (s['sh_addr'], s['sh_offset'], s['sh_size'])

def sec_of(addr):
    for n,(a,o,sz) in secs.items():
        if a and a <= addr < a+sz: return n
    return None
def read_va(addr, n):
    for name,(a,o,sz) in secs.items():
        if a and a <= addr < a+sz:
            return data[o+(addr-a):o+(addr-a)+n]
    return None

got2sym = {}
for secname in ('.rela.dyn','.rela.plt'):
    s = elf.get_section_by_name(secname)
    if not s: continue
    symtab = elf.get_section(s['sh_link'])
    for r in s.iter_relocations():
        nm = symtab.get_symbol(r['r_info_sym']).name
        if nm: got2sym[r['r_offset']] = nm

s = elf.get_section_by_name('.rela.plt')
symtab = elf.get_section(s['sh_link'])
plt_addr = secs['.plt'][0]
order = [symtab.get_symbol(r['r_info_sym']).name for r in s.iter_relocations()]
plt_map = {plt_addr+0x20+i*16: nm for i,nm in enumerate(order)}  # .plt[0..1] = AArch64 resolver stub (32 bytes)
plt_rev = {v:k for k,v in plt_map.items()}

sym_by_addr = {}
st = elf.get_section_by_name('.dynsym')
for sym in st.iter_symbols():
    if sym['st_value'] and sym.name: sym_by_addr.setdefault(sym['st_value'], sym.name)

def dem(n):
    try: return subprocess.run(['c++filt',n],capture_output=True,text=True,timeout=5).stdout.strip()
    except Exception: return n

md = Cs(CS_ARCH_ARM64, CS_MODE_LITTLE_ENDIAN); md.detail = True

def annotate(insn, start, end):
    notes = []
    for op in insn.operands:
        if op.type == ARM64_OP_MEM and op.mem.disp:
            d = op.mem.disp
            if d in got2sym: notes.append(f"-> {got2sym[d]}@GOT")
            elif d in secs and secs[d][2]==0: notes.append(f"->[{d:#x}]")
    for op in insn.operands:
        if op.type == ARM64_OP_IMM and op.imm:
            t = op.imm
            if t in plt_map: notes.append(f"PLT-> {plt_map[t]}")
            elif t in sym_by_addr: notes.append(f"sym {sym_by_addr[t]}")
            elif start <= t < end: notes.append(f".L_{t:x}")
            elif t > 0x1000 and start not in (0,) and abs(t-start) < 0x20000: notes.append(f"sub_{t:x}")
    return ("   ; " + " | ".join(notes)) if notes else ""

def dis(start, end):
    code = read_va(start, end-start)
    print(f"===== {start:#x} .. {end:#x}  section={sec_of(start)} =====")
    for insn in md.disasm(code, start):
        print(f"  {insn.address:06x}:  {insn.bytes.hex():<8} {insn.mnemonic:<9} {insn.op_str}{annotate(insn,start,end)}")

for c in sys.argv[2:]:
    if ':' in c:
        a,b = c.split(':'); dis(int(a,0), int(b,0))
    else:
        a=int(c,0); dis(a, a+0x100)
if len(sys.argv)<3:
    print({k:(hex(v[0]),hex(v[2])) for k,v in secs.items() if v[2]})
    print("PLT map sample:", list(plt_map.items())[:5])
