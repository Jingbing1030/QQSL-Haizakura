#!/usr/bin/env python3
"""Find all adrp+add xref sites in wrapper.node .text for a set of target VAs (strings)."""
import struct, sys
from elftools.elf.elffile import ELFFile
P='/tmp/wrapper.node'; raw=open(P,'rb').read()
elf=ELFFile(open(P,'rb'))
S={s.name:(s['sh_addr'],s['sh_offset'],s['sh_size']) for s in elf.iter_sections()}
TX_VA,TX_OFF,TX_SZ=S['.text']
TARGETS={}
for a in sys.argv[1:]:
    TARGETS[int(a,0)]=a
T=set(TARGETS)
N=TX_SZ//4
print(f'text words={N}', flush=True)
words=struct.unpack_from('<%dI'%N, raw, TX_OFF)
# pass 1: collect adrp positions
import array
cand=array.array('i')
for i in range(N):
    if (words[i] & 0x9F000000)==0x90000000: cand.append(i)
print(f'adrp count={len(cand)}', flush=True)
def imm_of(w):
    immlo=(w>>29)&3; immhi=(w>>5)&0x7FFFF
    imm=(immhi<<2)|immlo
    return imm-(1<<21) if imm&(1<<20) else imm
res=[]
for i in cand:
    w=words[i]; rd=w&0x1F
    base=((TX_VA+i*4)&~0xFFF)+(imm_of(w)<<12)
    for k in (1,2,3,4):
        if i+k>=N: break
        w2=words[i+k]
        if (w2 & 0xFF800000)==0x91000000 and ((w2>>5)&0x1F)==rd and (w2&0x1F)==rd:
            imm12=(w2>>10)&0xFFF; sh=(w2>>22)&1
            va=base+(imm12<<(12 if sh else 0))
            if va in T:
                pc=TX_VA+i*4
                res.append((pc,va,k))
                break
for pc,va,k in res:
    print(f'  target 0x{va:x} <- site 0x{pc:x} (+{k*4} bytes)')
print('total', len(res))
