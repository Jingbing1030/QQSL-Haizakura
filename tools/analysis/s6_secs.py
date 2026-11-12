#!/usr/bin/env python3
"""Find .so xref sites for ELF section-name strings (.rodata/.data.rel.ro/.rela.dyn/.dynsym/.got/.text/.plt/.data/.eh_frame_hdr/.note.gnu.build-id)."""
import struct
from elftools.elf.elffile import ELFFile
P='/tmp/sl/snowluma-linux-arm64.so'; raw=open(P,'rb').read()
elf=ELFFile(open(P,'rb'))
S={s.name:(s['sh_addr'],s['sh_offset'],s['sh_size']) for s in elf.iter_sections()}
TX=S['.text']; RO=S['.rodata']
WANT=[b'.rodata',b'.data.rel.ro',b'.rela.dyn',b'.dynsym',b'.got',b'.text',b'.plt',b'.data',b'.eh_frame_hdr',b'.note.gnu.build-id',b'.dynstr',b'.bss']
tg={}
for w in WANT:
    i=raw.find(w)
    while i>=0:
        if RO[1]<=i<RO[1]+RO[2]: tg[RO[0]+i-RO[1]]=w.decode()
        i=raw.find(w,i+1)
print('target strings:', {hex(k):v for k,v in tg.items()})
N=TX[2]//4
words=struct.unpack_from('<%dI'%N,raw,TX[1])
out={}
for i in range(N-5):
    w=words[i]
    if (w & 0x9F000000)!=0x90000000: continue
    rd=w&0x1F; immlo=(w>>29)&3; immhi=(w>>5)&0x7FFFF
    imm=(immhi<<2)|immlo
    if imm&(1<<20): imm-=(1<<21)
    pc=TX[0]+i*4; base=(pc&~0xFFF)+(imm<<12)
    for k in (1,2,3,4):
        if i+k>=N: break
        w2=words[i+k]
        if (w2 & 0xFF800000)==0x91000000 and ((w2>>5)&0x1F)==rd and (w2&0x1F)==rd:
            imm12=(w2>>10)&0xFFF; sh=(w2>>22)&1
            va=base+(imm12<<(12 if sh else 0))
            if va in tg: out.setdefault(tg[va],[]).append(pc)
            break
for k,v in sorted(out.items()):
    print(f'{k:22s} sites={[hex(x) for x in v]}')
