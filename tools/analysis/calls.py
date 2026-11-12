#!/usr/bin/env python3
# One bounded linear pass over .text: PLT call index, syscall numbers (svc + mov x8), svc sites.
import sys
from elftools.elf.elffile import ELFFile
from capstone import *
from capstone.arm64 import *

PATH='/tmp/re/snowluma-linux-arm64.so'
data=open(PATH,'rb').read()
elf=ELFFile(open(PATH,'rb'))
secs={s.name:(s['sh_addr'],s['sh_offset'],s['sh_size']) for s in elf.iter_sections()}
s=elf.get_section_by_name('.rela.plt'); st=elf.get_section(s['sh_link'])
order=[st.get_symbol(r['r_info_sym']).name for r in s.iter_relocations()]
plt_addr=secs['.plt'][0]+0x20
plt_map={plt_addr+i*16:nm for i,nm in enumerate(order)}

lo,off,sz=secs['.text']
code=data[off:off+sz]
md=Cs(CS_ARCH_ARM64,CS_MODE_LITTLE_ENDIAN); md.detail=True

def is_prologue(insn):
    if insn.mnemonic=='sub' and insn.op_str.startswith('sp, sp, #'): return True
    if insn.mnemonic=='stp' and 'x29, x30, [sp, #-' in insn.op_str: return True
    if insn.mnemonic=='stp' and 'x29, x30, [sp,' in insn.op_str: return True
    return False

cur=None
callidx={}
svcsites=[]
last_mov_x8=None
prologues=[]
for insn in md.disasm(code, lo):
    if is_prologue(insn):
        cur=insn.address; prologues.append(insn.address)
    if insn.mnemonic=='mov' and insn.operands and insn.operands[0].type==ARM64_OP_REG \
       and insn.operands[0].reg in (ARM64_REG_X8,ARM64_REG_W8) and len(insn.operands)>1 \
       and insn.operands[1].type==ARM64_OP_IMM:
        last_mov_x8=(insn.address, insn.operands[1].imm)
    if insn.mnemonic=='bl' and insn.operands and insn.operands[0].type==ARM64_OP_IMM:
        t=insn.operands[0].imm
        if t in plt_map:
            callidx.setdefault(plt_map[t],{}).setdefault(cur,[]).append(insn.address)
    if insn.mnemonic=='svc':
        svcsites.append((insn.address, cur, last_mov_x8))

mode=sys.argv[1] if len(sys.argv)>1 else 'all'
if mode in ('all','sym'):
    for nm in sorted(callidx):
        tot=sum(len(v) for v in callidx[nm].values())
        print(f"\n### {nm}  ({tot} callsites, {len(callidx[nm])} funcs)")
        for f in sorted(callidx[nm]):
            print(f"    sub_{f if f else 0:x}: "+" ".join(hex(a) for a in sorted(callidx[nm][f])[:12]))
if mode in ('all','svc'):
    print(f"\n=== svc sites: {len(svcsites)} ===")
    for a,f,mi in svcsites:
        print(f"  svc @{a:#x} in sub_{f if f else 0:x}  last mov x8 = {mi}")
if mode=='pro':
    print(f"prologues: {len(prologues)}")
    print(" ".join(f"{p:x}" for p in prologues))
