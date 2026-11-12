#!/usr/bin/env python3
# Bounded xref finder: adrp+add / adrp+ldr pairs resolving to target VAs. Linear, no big allocs.
import sys
from elftools.elf.elffile import ELFFile
md_cache={}
PATH='/tmp/re/snowluma-linux-arm64.so'
data=open(PATH,'rb').read()
elf=ELFFile(open(PATH,'rb'))
secs={s.name:(s['sh_addr'],s['sh_offset'],s['sh_size']) for s in elf.iter_sections()}

# GOT slot -> symbol
got2sym={}
for sn in ('.rela.dyn','.rela.plt'):
    s=elf.get_section_by_name(sn)
    if not s: continue
    st=elf.get_section(s['sh_link'])
    for r in s.iter_relocations():
        nm=st.get_symbol(r['r_info_sym']).name
        if nm: got2sym[r['r_offset']]=nm
sym2got={}
for g,n in got2sym.items(): sym2got.setdefault(n,[]).append(g)

lo,off,sz=secs['.text']
code=data[off:off+sz]
N=len(code)//4
words=[int.from_bytes(code[i*4:i*4+4],'little') for i in range(N)]

def decode_adrp(w, pc):
    # ADRP: op=1, immlo bits30-29, immhi bits23-5, Rd bits4-0
    if (w & 0x9F000000) != 0x90000000: return None
    rd = w & 0x1F
    immlo = (w >> 29) & 0x3
    immhi = (w >> 5) & 0x7FFFF
    imm = (immhi << 2) | immlo
    if imm & (1<<20): imm -= (1<<21)
    base = (pc & ~0xFFF) + (imm << 12)
    return rd, base

targets = {}
for a in sys.argv[1:]:
    targets[int(a,0)] = a
# also: resolve GOT symbol names passed as NAME
got_targets = {}
rest=[a for a in sys.argv[1:] if not a.startswith('0x')]
for nm in rest:
    for g in sym2got.get(nm,[]): got_targets[g]=nm

found={}
for i in range(N-3):
    pc = lo + i*4
    r = decode_adrp(words[i], pc)
    if not r: continue
    rd, base = r
    for j in (1,2,3):
        w2 = words[i+j]
        # ADD (imm) 64-bit: 0x91000000 mask 0x7F800000==0x11000000 ; Rd==rd ; Rn==rd
        if (w2 & 0x7F800000) == 0x11000000 and ((w2>>5)&0x1F)==rd and (w2&0x1F)==rd:
            imm12 = (w2>>10)&0xFFF
            sh = (w2>>22)&1
            va = base + (imm12<<(12 if sh else 0))
            if va in targets: found.setdefault(va,[]).append(pc)
        # LDR (imm) 64-bit unsigned: 0xF9400000
        if (w2 & 0xFFC00000) == 0xF9400000 and ((w2>>5)&0x1F)==rd:
            imm12=(w2>>10)&0xFFF
            va = base + imm12*8
            if va in got_targets: found.setdefault(got_targets[va],[]).append(pc)

for k,v in sorted(found.items(), key=lambda x:str(x[0])):
    print(f"{k}: {len(v)} xrefs -> " + " ".join(hex(x) for x in sorted(set(v))[:25]))
missing=[a for a in sys.argv[1:] if (int(a,0) if a.startswith('0x') else a) not in found]
if missing: print("NO XREF:", missing)
