#!/usr/bin/env python3
"""Final: (a) name every vtable slot with all Class::method strings it references
(b) map every .so diagnostic string to its xref site and enclosing function."""
import struct, re, json
from elftools.elf.elffile import ELFFile

def load(P):
    raw=open(P,'rb').read(); elf=ELFFile(open(P,'rb'))
    S={s.name:(s['sh_addr'],s['sh_offset'],s['sh_size']) for s in elf.iter_sections()}
    return raw,elf,S

def mk(raw,S):
    TX=S['.text']; RO=S['.rodata']
    def word(va):
        if TX[0]<=va<TX[0]+TX[2]: return struct.unpack_from('<I',raw,TX[1]+va-TX[0])[0]
        return None
    def rdstr(va,maxl=260):
        if not (RO[0]<=va<RO[0]+RO[2]): return None
        o=RO[1]+va-RO[0]; b=raw[o:o+maxl]; z=b.find(b'\0')
        if z<=1: return None
        try: return b[:z].decode('ascii')
        except Exception: return None
    return word,rdstr

def adrp_add_in(word, fn, span=0x1400):
    """yield (site, target_va) for adrp+add pairs inside [fn, fn+span)"""
    out=[]
    for i in range(0,span,4):
        pc=fn+i; w=word(pc)
        if w is None: break
        if (w & 0x9F000000)!=0x90000000: continue
        rd=w&0x1F; immlo=(w>>29)&3; immhi=(w>>5)&0x7FFFF
        imm=(immhi<<2)|immlo
        if imm&(1<<20): imm-=(1<<21)
        base=(pc&~0xFFF)+(imm<<12)
        for k in (1,2,3,4):
            w2=word(pc+4*k)
            if w2 is None: break
            if (w2 & 0xFF800000)==0x91000000 and ((w2>>5)&0x1F)==rd and (w2&0x1F)==rd:
                imm12=(w2>>10)&0xFFF; sh=(w2>>22)&1
                out.append((pc, base+(imm12<<(12 if sh else 0))))
                break
    return out

METH=re.compile(r'^[A-Za-z_~][A-Za-z0-9_:<>,$]*::[A-Za-z_~][A-Za-z0-9_]*$')
SRC =re.compile(r'\.cc$|\.cpp$|\.h$')

# ---------- (a) wrapper.node vtable slots ----------
raw,elf,S=load('/tmp/wrapper.node'); word,rdstr=mk(raw,S)
D=S['.data.rel.ro'][0]-S['.data.rel.ro'][1]
def vr(va):
    if S['.data.rel.ro'][0]<=va<S['.data.rel.ro'][0]+S['.data.rel.ro'][2]:
        return struct.unpack_from('<Q',raw,va-D)[0]
    return None
OUT=open('/tmp/re/s3_vtables.log','w')
def log(*a): print(*a,file=OUT,flush=True)
AP={'nt::MSFService':0x87173e0,'nt::MSFCoreService':0x8718f58}
ALL=[0x87173e0,0x8717550,0x8717748,0x87177a0,0x87177b8,0x8718f58,0x8719108,0x8719300,0x8719358,0x8719370,0x87193a0]
for nm,ap in AP.items():
    nxt=min([o for o in ALL if o>ap],default=ap+0x200)
    n=(nxt-ap)//8
    log(f'\n########## {nm}  _ZTV=0x{ap-8:x}  ap=0x{ap:x}  typeinfo=0x{vr(ap):x}  slots=1+{n}')
    for i in range(1,n):
        sv=ap+8*i; fn=vr(sv)
        if fn is None: log(f'  v[{i:3d}] off=0x{8*i:#x} slot=0x{sv:x} -> <non-reloc>'); break
        if not (S['.text'][0]<=fn<S['.text'][0]+S['.text'][2]):
            log(f'  v[{i:3d}] off=0x{8*i:#x} -> 0x{fn:x} NOT-TEXT'); break
        tgt=fn
        w0=word(fn)
        if w0 is not None and (w0 & 0xFC000000) in (0x14000000,0x94000000):
            im=w0&0x03FFFFFF
            if im&(1<<25): im-=(1<<26)
            tgt=fn+im*4
        meths=[]; srcs=[]
        for site,va in adrp_add_in(word,tgt):
            s=rdstr(va)
            if not s: continue
            if METH.match(s): meths.append(s)
            elif SRC.search(s) and len(s)<90: srcs.append(s)
        m1=[]; 
        for m in meths:
            if m not in m1: m1.append(m)
        best = m1[-1] if m1 else ''
        log(f'  v[{i:3d}] off=0x{8*i:#x} slot=0x{sv:x} fn=0x{fn:x}'+('->0x%x'%tgt if tgt!=fn else '')+
            f'  METHOD="{best}"  all={m1[:5]} src={srcs[:1]}')
OUT.close()
print('vtables done')

# ---------- (b) .so diagnostic-string -> xref site ----------
raw2,elf2,S2=load('/tmp/sl/snowluma-linux-arm64.so'); word2,rdstr2=mk(raw2,S2)
strs=[]
for l in open('/tmp/re/sl.strings'):
    p=l.split(None,1)
    if len(p)<2: continue
    try: o=int(p[0],16)
    except: continue
    if 0x437b0<=o<0x456a0: strs.append((o,p[1]))
T={o for o,_ in strs}
N2=S2['.text'][2]//4
words2=struct.unpack_from('<%dI'%N2,raw2,S2['.text'][1])
sites={}
for i in range(N2-5):
    w=words2[i]
    if (w & 0x9F000000)!=0x90000000: continue
    rd=w&0x1F; immlo=(w>>29)&3; immhi=(w>>5)&0x7FFFF
    imm=(immhi<<2)|immlo
    if imm&(1<<20): imm-=(1<<21)
    pc=S2['.text'][0]+i*4
    base=(pc&~0xFFF)+(imm<<12)
    for k in (1,2,3,4):
        if i+k>=N2: break
        w2=words2[i+k]
        if (w2 & 0xFF800000)==0x91000000 and ((w2>>5)&0x1F)==rd and (w2&0x1F)==rd:
            imm12=(w2>>10)&0xFFF; sh=(w2>>22)&1
            va=base+(imm12<<(12 if sh else 0))
            if va in T: sites.setdefault(va,[]).append(pc)
            break
def findfn(site):
    for j in range(0, 0x3000, 4):
        w=word2(site-j)
        if w is None: break
        if (w & 0xFFC00000)==0xA9800000 and ((w>>10)&0x1F)==30 and ((w>>5)&0x1F)==31:
            return site-j
    return None
L=open('/tmp/re/s3_somap.log','w')
for o,s in strs:
    ss=sites.get(o,[])
    fns=sorted({findfn(x) for x in ss if findfn(x)})
    print(f'0x{o:x}  sites={[hex(x) for x in ss]}  fn={[hex(x) for x in fns]}  {s!r}', file=L, flush=True)
L.close()
print('so map done')
