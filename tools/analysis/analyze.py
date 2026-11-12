#!/usr/bin/env python3
"""Function recovery via .eh_frame FDE + rich annotation + call-site index."""
import sys, subprocess, bisect, re
from elftools.elf.elffile import ELFFile
from capstone import *
from capstone.arm64 import *

PATH='/tmp/re/snowluma-linux-arm64.so'
data=open(PATH,'rb').read()
elf=ELFFile(open(PATH,'rb'))
secs={}
for s in elf.iter_sections():
    secs[s.name]=(s['sh_addr'],s['sh_offset'],s['sh_size'])
def read_va(a,n):
    for name,(x,o,sz) in secs.items():
        if x and x<=a<x+sz: return data[o+(a-x):o+(a-x)+n]
    return b''
def sec_of(a):
    for n,(x,o,sz) in secs.items():
        if x and x<=a<x+sz: return n
    return None

got2sym={}
for sn in ('.rela.dyn','.rela.plt'):
    s=elf.get_section_by_name(sn)
    if not s: continue
    st=elf.get_section(s['sh_link'])
    for r in s.iter_relocations():
        nm=st.get_symbol(r['r_info_sym']).name
        if nm: got2sym[r['r_offset']]=nm
s=elf.get_section_by_name('.rela.plt'); st=elf.get_section(s['sh_link'])
order=[st.get_symbol(r['r_info_sym']).name for r in s.iter_relocations()]
plt_map={secs['.plt'][0]+0x20+i*16:nm for i,nm in enumerate(order)}

# ---- function boundaries from .eh_frame ----
funcs=[]
def cb(name, n):
    if name=='eh_frame': return True
    return True
from elftools.elf.sections import SymbolTableSection
eh=elf.get_section_by_name('.eh_frame')
try:
    for F in eh.get_fde():
        try:
            f=F.fde
            lo=f['initial_location']; hi=lo+f['address_range']
            if lo: funcs.append((lo,hi))
        except Exception: pass
except Exception as e:
    print("eh_frame err",e,file=sys.stderr)
funcs=sorted(set(funcs))
fstart=[f[0] for f in funcs]
def func_of(a):
    i=bisect.bisect_right(fstart,a)-1
    if i>=0 and funcs[i][0]<=a<funcs[i][1]: return funcs[i]
    return None
def fname(a):
    f=func_of(a)
    return f"sub_{f[0]:x}" if f else f"unk_{a:x}"

def cstr(va, maxn=200):
    b=read_va(va,maxn)
    if not b: return None
    e=b.find(b'\0')
    if e<0: return None
    try: t=b[:e].decode('utf-8')
    except Exception: return None
    return t if t and all(31<ord(c)<127 or c in '\t\n' for c in t) else None

# codestr: find nearest preceding C-string covering va
codestrs=[]
for m in re.finditer(rb'[ -~]{3,}', data):
    codestrs.append((m.start(), m.group().decode()))
def hardstr_of_va(va):
    """map a va to a string if it's inside a printable run in rodata"""
    for name,(x,o,sz) in secs.items():
        if x and x<=va<x+sz and name in ('.rodata','.data.rel.ro','.data'):
            off=o+(va-x)
            st=off
            while st>o and 32<=data[st-1]<127: st-=1
            en=off
            while en<o+sz and 32<=data[en]<127: en+=1
            if en>st: 
                return data[st:en].decode('latin1')
    return None

md=Cs(CS_ARCH_ARM64,CS_MODE_LITTLE_ENDIAN); md.detail=True

def dis_func(addr, show_hex=True):
    f=func_of(addr)
    if not f: 
        print(f"no FDE for {addr:#x}"); return
    lo,hi=f
    # widen slightly
    hi=max(hi, lo+4)
    code=read_va(lo, hi-lo)
    print(f"===== {fname(lo)}  [{lo:#x}..{hi:#x})  size={hi-lo} =====")
    pending_adrp={}
    lines=[]
    for insn in md.disasm(code, lo):
        notes=[]
        ops=insn.operands
        # adrp tracking
        if insn.mnemonic=='adrp':
            pending_adrp[insn.operands[0].reg]=insn.operands[1].imm
        elif insn.mnemonic=='add' and len(ops)==3 and ops[2].type==ARM64_OP_IMM and ops[1].type==ARM64_OP_REG:
            base=pending_adrp.get(ops[1].reg)
            if base is not None:
                va=base+ops[2].imm
                s_=hardstr_of_va(va)
                if s_: notes.append(f'STR "{s_[:70]}"')
                else: notes.append(f'@{va:#x}')
                pending_adrp.pop(ops[1].reg,None)
        if insn.mnemonic in ('ldr','ldrb','ldrh','str','ldar','ldarb','ldxr') and ops:
            for op in ops:
                if op.type==ARM64_OP_MEM and op.mem.base==ARM64_REG_X8 and 'adrp' in str(pending_adrp): pass
        for op in ops:
            if op.type==ARM64_OP_MEM and op.mem.disp:
                d=op.mem.disp
                if d in got2sym: notes.append(f'GOT:{got2sym[d]}')
                elif d in secs:
                    s_=hardstr_of_va(d)
                    notes.append(f'[{d:#x}]'+(f' "{s_[:50]}"' if s_ else ''))
        for op in ops:
            if op.type==ARM64_OP_IMM and op.imm:
                t=op.imm
                if t in plt_map: notes.append(f'PLT:{plt_map[t]}')
                elif lo<=t<hi: notes.append(f'.L_{t:x}')
                elif func_of(t): notes.append(f'call {fname(t)}')
                elif t>0x1000: notes.append(f'{t:#x}')
        if insn.mnemonic in ('adrp',) and insn.operands[1].type==ARM64_OP_IMM:
            va=insn.operands[1].imm
            s_=hardstr_of_va(va)
            if s_: notes.append(f'~"{s_[:60]}"')
        hx=f"{insn.bytes.hex():<8}" if show_hex else ""
        lines.append(f"  {insn.address:06x}:  {hx} {insn.mnemonic:<9} {insn.op_str}"+(f"   ; {' | '.join(notes)}" if notes else ""))
    print("\n".join(lines))
    print()

if __name__=='__main__':
    for a in sys.argv[1:]:
        dis_func(int(a,0))
