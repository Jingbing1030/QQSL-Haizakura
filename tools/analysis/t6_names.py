#!/usr/bin/env python3
"""Task1 stage4: recover virtual-function NAMES for each vtable slot by finding
method-name strings referenced inside the slot's code (adrp+add scan)."""
import struct, json, re, sys
from elftools.elf.elffile import ELFFile
P='/tmp/wrapper.node'; OUT=open('/tmp/re/t6_names.log','w')
def log(*a): print(*a,file=OUT,flush=True)
f=open(P,'rb'); elf=ELFFile(f)
S={s.name:(s['sh_addr'],s['sh_offset'],s['sh_size']) for s in elf.iter_sections()}
RO_VA,RO_OFF,RO_SZ=S['.rodata']; DR_VA,DR_OFF,DR_SZ=S['.data.rel.ro']; TX_VA,TX_OFF,TX_SZ=S['.text']
D=DR_VA-DR_OFF
def inro(v): return RO_VA<=v<RO_VA+RO_SZ
def va2off(v):
    if inro(v): return v-RO_VA+RO_OFF
    if DR_VA<=v<DR_VA+DR_SZ: return v-D
    if TX_VA<=v<TX_VA+TX_SZ: return v-TX_VA+TX_OFF
    return None
def rdstr(va,maxl=200):
    o=va2off(va)
    if o is None: return None
    f.seek(o); b=f.read(maxl); z=b.find(b'\0')
    if z<=1: return None
    try: return b[:z].decode('ascii')
    except Exception: return None

# ---- build ADRP/ADD map with numpy ----
import numpy as np
f.seek(TX_OFF); code=np.fromfile(f, dtype=np.uint8, count=TX_SZ)
log(f'.text bytes={code.size}')
N=code.size//4
assert code.size%4==0
words=code[:N*4].view(np.uint32)
del code
idx=np.arange(N, dtype=np.int64)
pc = TX_VA + idx*4
pcpage = pc & ~0xFFF

is_adrp = (words & 0x9F000000) == 0x90000000
adrp_rd = (words & 0x1F).astype(np.int64)
immlo = ((words>>29) & 0x3).astype(np.int64)
immhi = ((words>>5) & 0x7FFFF).astype(np.int64)
imm = (immhi<<2)|immlo
imm = np.where(imm & (1<<20), imm-(1<<21), imm)
adrp_base = pcpage + (imm<<12)

# ADD (imm) 64-bit: sf=1 op=0 S=0 -> 0x91000000 mask 0xFF800000
is_add = (words & 0xFF800000) == 0x91000000
add_rd = (words & 0x1F).astype(np.int64)
add_rn = ((words>>5) & 0x1F).astype(np.int64)
add_imm = ((words>>10) & 0xFFF).astype(np.int64)
add_sh  = ((words>>22) & 1).astype(np.int64)
add_val = add_imm << np.where(add_sh==1, 12, 0)

# pair i (adrp), i+k (add) for k=1,2
pairs_va=[]; pairs_at=[]
for k in (1,2,3):
    a = is_adrp[:N-k]; b = is_add[k:]
    m = a & b & (add_rn[k:]==adrp_rd[:N-k])
    ii = idx[:N-k][m]
    va = adrp_base[:N-k][m] + add_val[k:][m]
    site = TX_VA + ii*4
    pairs_va.append(va); pairs_at.append(site)
pairs_va=np.concatenate(pairs_va); pairs_at=np.concatenate(pairs_at)
log(f'adrp+add pairs={pairs_va.size}')
ro = (pairs_va>=RO_VA)&(pairs_va<RO_VA+RO_SZ)
pairs_va=pairs_va[ro]; pairs_at=pairs_at[ro]
log(f'  of which point into .rodata: {pairs_va.size}')
np.save('/tmp/re/pairs_va.npy', pairs_va); np.save('/tmp/re/pairs_at.npy', pairs_at)

def strs_near(fn_va, span=0x1000):
    lo=fn_va; hi=fn_va+span
    m=(pairs_at>=lo)&(pairs_at<hi)
    out=[]
    for va in pairs_va[m][:60]:
        s=rdstr(int(va))
        if s and ('::' in s or 'MSF' in s or s.endswith('Ev')):
            out.append((int(va), s))
    return out

# ---- vtables ----
VT={'MSFService':(0x87173e0,0), 'MSFCoreService':(0x8718f58,0)}
# find end of each primary vtable: next 16-aligned offset_to_top pattern
for nm,(ap,_) in VT.items():
    others=[0x87173e0,0x8717550,0x8717748,0x87177a0,0x87177b8,0x8718f58,0x8719108,0x8719300,0x8719358,0x8719370,0x87193a0]
    nxt=min([o for o in others if o>ap], default=ap+0x800)
    nslots=(nxt-ap)//8
    log(f'\n===== {nm} primary vtable: vtable_sym=0x{ap-8:x} (v[0]=offset_to_top, v[1]=typeinfo) slots=1+{nslots}')
    log(f'      typeinfo=0x{ap:x}')
    for i in range(1, nslots):
        sv=ap+8*i
        f.seek(va2off(sv)); fn=struct.unpack('<Q',f.read(8))[0]
        if fn==0: log(f'  v[{i+1:3d}] slot@0x{sv:x} = 0  <pure virtual / end>'); break
        if not (TX_VA<=fn<TX_VA+TX_SZ):
            log(f'  v[{i+1:3d}] slot@0x{sv:x} = 0x{fn:x} (not text)'); continue
        names=strs_near(fn)
        nms=' | '.join(f'{s}' for _,s in names[:6])
        log(f'  v[{i+1:3d}] slot@0x{sv:x} fn=0x{fn:x}  names: {nms}')
OUT.close()
