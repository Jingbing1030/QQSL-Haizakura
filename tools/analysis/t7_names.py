#!/usr/bin/env python3
"""Task1 stage4b: name each vtable slot by decoding adrp+add inside that slot's function only."""
import struct, json
from elftools.elf.elffile import ELFFile
P='/tmp/wrapper.node'; OUT=open('/tmp/re/t7_names.log','w')
def log(*a): print(*a,file=OUT,flush=True)
f=open(P,'rb'); elf=ELFFile(f)
S={s.name:(s['sh_addr'],s['sh_offset'],s['sh_size']) for s in elf.iter_sections()}
RO_VA,RO_OFF,RO_SZ=S['.rodata']; DR_VA,DR_OFF,DR_SZ=S['.data.rel.ro']; TX_VA,TX_OFF,TX_SZ=S['.text']
D=DR_VA-DR_OFF
f.seek(TX_OFF); TEXT=f.read(TX_SZ)
def inro(v): return RO_VA<=v<RO_VA+RO_SZ
def intx(v): return TX_VA<=v<TX_VA+TX_SZ
def rdstr(va,maxl=220):
    if not inro(va): return None
    o=va-RO_VA
    z=TEXT if False else None
    f.seek(RO_OFF+(va-RO_VA)); b=f.read(maxl); z=b.find(b'\0')
    if z<=1: return None
    try: return b[:z].decode('ascii')
    except Exception: return None
def word(va):
    if intx(va): return struct.unpack('<I',TEXT[va-TX_VA:va-TX_VA+4])[0]
    return None
def word64(va):
    if intx(va): return struct.unpack('<Q',TEXT[va-TX_VA:va-TX_VA+8])[0]
    if DR_VA<=va<DR_VA+DR_SZ:
        f.seek(va-D); return struct.unpack('<Q',f.read(8))[0]
    return None

def decode_adrp(w,pc):
    if (w & 0x9F000000)!=0x90000000: return None
    rd=w&0x1F; immlo=(w>>29)&3; immhi=(w>>5)&0x7FFFF
    imm=(immhi<<2)|immlo
    if imm&(1<<20): imm-=(1<<21)
    return rd, (pc & ~0xFFF)+(imm<<12)

def follow(fn, depth=0):
    """if fn is a thunk (b/bl imm), follow once"""
    w=word(fn)
    if w is None: return fn
    if (w & 0xFC000000) in (0x14000000, 0x94000000):
        imm=w & 0x03FFFFFF
        if imm & (1<<25): imm-=(1<<26)
        return fn+imm*4
    return fn

def scan_fn(fn):
    """return list of (site, stringva, string) for adrp+add into .rodata within 0x600 bytes"""
    out=[]
    for i in range(0, 0x600, 4):
        pc=fn+i
        w=word(pc)
        if w is None: break
        r=decode_adrp(w,pc)
        if not r: continue
        rd,base=r
        for k in (1,2,3,4):
            w2=word(pc+4*k)
            if w2 is None: break
            if (w2 & 0xFF800000)==0x91000000 and ((w2>>5)&0x1F)==rd and (w2&0x1F)==rd:
                imm12=(w2>>10)&0xFFF; sh=(w2>>22)&1
                va=base+(imm12<<(12 if sh else 0))
                if inro(va): out.append((pc,va,rdstr(va)))
    return out

VTS={'MSFService':0x87173e0,'MSFCoreService':0x8718f58}
VTS_SYM={'MSFService':0x87173d8,'MSFCoreService':0x8718f50}
ALL_AP=[0x87173e0,0x8717550,0x8717748,0x87177a0,0x87177b8,0x8718f58,0x8719108,0x8719300,0x8719358,0x8719370,0x87193a0]
summary={}
for nm,ap in VTS.items():
    nxt=min([o for o in ALL_AP if o>ap], default=ap+0x800)
    n=(nxt-ap)//8
    log(f'\n===== {nm}  _ZTV sym @0x{VTS_SYM[nm]:x}  address_point=0x{ap:x}  slots=1+{n}')
    log(f'      vtable[0](offset_to_top) = {word64(ap-8) if False else struct.unpack("<q",open(P,"rb").read(0) or b"\0"*8)[0] if False else ""}')
    f.seek(ap-16-D); o2t=struct.unpack('<q',f.read(8))[0]; ti=struct.unpack('<Q',f.read(8))[0]
    log(f'      v[-1](offset_to_top)={o2t}  v[0](typeinfo)=0x{ti:x}')
    lst=[]
    for i in range(1,n):
        sv=ap+8*i
        f.seek(sv-D); fn=struct.unpack('<Q',f.read(8))[0]
        if fn==0: log(f'  v[{i:3d}] slot=0x{sv:x} -> 0  (pure/end)'); break
        if not intx(fn):
            log(f'  v[{i:3d}] slot=0x{sv:x} -> 0x{fn:x} NOT-TEXT'); lst.append((i,sv,fn,[])); continue
        tgt=follow(fn)
        hits=scan_fn(tgt)
        if tgt!=fn and not hits: hits=scan_fn(fn)
        names=[s for _,_,s in hits if s]
        lst.append((i,sv,fn,names))
        disp=' | '.join(names[:8])
        log(f'  v[{i:3d}] slot=0x{sv:x} fn=0x{fn:x}'+(' ->0x%x'%tgt if tgt!=fn else '')+f'  strs: {disp}')
    summary[nm]=[(i,hex(sv),hex(fn),names) for i,sv,fn,names in lst]
json.dump(summary, open('/tmp/re/vtable_named.json','w'), indent=1)
log('DONE')
OUT.close()
