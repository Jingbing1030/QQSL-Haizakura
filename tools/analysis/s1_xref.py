#!/usr/bin/env python3
"""Task2: find adrp+add xrefs to given .rodata strings in snowluma .so; print surrounding insns."""
import struct
from elftools.elf.elffile import ELFFile
P='/tmp/sl/snowluma-linux-arm64.so'
elf=ELFFile(open(P,'rb')); raw=open(P,'rb').read()
S={s.name:(s['sh_addr'],s['sh_offset'],s['sh_size']) for s in elf.iter_sections()}
TX_VA,TX_OFF,TX_SZ=S['.text']; RO_VA,RO_OFF,RO_SZ=S['.rodata']
def inro(v): return RO_VA<=v<RO_VA+RO_SZ
def rdstr(va,maxl=300):
    if not inro(va): return None
    o=RO_OFF+(va-RO_VA); b=raw[o:o+maxl]; z=b.find(b'\0')
    return b[:z].decode('ascii','replace') if z>0 else None
TARGETS=[0x442b4,0x44994,0x449c2,0x44a2b,0x44a58,0x44a8a,0x44ac5,0x44af6,0x44b32,
         0x43fbe,0x45175,0x45584,0x455a6,0x4568e,0x437f0]
T=set(TARGETS)
N=TX_SZ//4
words=struct.unpack_from('<%dI'%N, raw, TX_OFF)
def dec_adrp(w,pc):
    if (w & 0x9F000000)!=0x90000000: return None
    rd=w&0x1F; immlo=(w>>29)&3; immhi=(w>>5)&0x7FFFF
    imm=(immhi<<2)|immlo
    if imm&(1<<20): imm-=(1<<21)
    return rd,(pc&~0xFFF)+(imm<<12)
hits=[]
for i in range(N-4):
    pc=TX_VA+i*4
    r=dec_adrp(words[i],pc)
    if not r: continue
    rd,base=r
    for k in (1,2,3,4,5):
        if i+k>=N: break
        w2=words[i+k]
        if (w2 & 0xFF800000)==0x91000000 and ((w2>>5)&0x1F)==rd and (w2&0x1F)==rd:
            imm12=(w2>>10)&0xFFF; sh=(w2>>22)&1
            va=base+(imm12<<(12 if sh else 0))
            if va in T and k<6:
                hits.append((pc,va,i,k))
for pc,va,i,k in hits:
    print(f'XREF str@0x{va:x} ({rdstr(va)!r})  site=0x{pc:x}  (adrp idx {i}, +{k*4})')
print(f'total hits {len(hits)}')
import json; json.dump([[hex(a),hex(b)] for a,b,_,_ in hits], open('/tmp/re/sl_xrefs.json','w'))
