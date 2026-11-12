#!/usr/bin/env python3
"""Exact function bounds from .eh_frame_hdr (binary-search table), pure Python.
Then re-attribute every vtable slot's string-xrefs with EXACT function spans."""
import struct, re, json, bisect
from elftools.elf.elffile import ELFFile
P='/tmp/wrapper.node'; raw=open(P,'rb').read()
elf=ELFFile(open(P,'rb'))
S={s.name:(s['sh_addr'],s['sh_offset'],s['sh_size']) for s in elf.iter_sections()}
TX=S['.text']; RO=S['.rodata']; DR=S['.data.rel.ro']; D=DR[0]-DR[1]
EH=S['.eh_frame_hdr']
ehva, ehoff, ehsz = EH
b=raw[ehoff:ehoff+ehsz]
ver,ptr_enc,cnt_enc,tbl_enc=b[0],b[1],b[2],b[3]
print(f'.eh_frame_hdr ver={ver} ptr_enc={ptr_enc:#x} cnt_enc={cnt_enc:#x} tbl_enc={tbl_enc:#x} size={ehsz}')
off=4
def read_enc(enc, o, base):
    fmt = enc & 0x0f
    app = enc & 0x70
    if app == 0x10:      # pcrel: relative to the address of this field
        bias = base + o
    elif app == 0x30:    # datarel
        bias = base
    else:
        bias = 0
    if   fmt == 0x03: v = struct.unpack_from('<I', b, o)[0]; o += 4
    elif fmt == 0x0b: v = struct.unpack_from('<i', b, o)[0]; o += 4
    elif fmt == 0x04: v = struct.unpack_from('<Q', b, o)[0]; o += 8
    elif fmt == 0x0c: v = struct.unpack_from('<q', b, o)[0]; o += 8
    elif fmt == 0x00: v = struct.unpack_from('<Q', b, o)[0]; o += 8
    else: raise SystemExit(f'unsupported fmt {enc:#x}')
    return (v + bias if app else v), o
ehptr,off=read_enc(ptr_enc,off,ehva)
cnt,off=read_enc(cnt_enc,off,ehva)
print(f'eh_frame_ptr={ehptr:#x} fde_count={cnt}')
ent=off
starts=[]
for i in range(cnt):
    loc,o2 = read_enc(tbl_enc, ent+8*i, ehva)
    starts.append(loc)
starts.sort()
print(f'function starts: {len(starts)}  first={starts[0]:#x} last={starts[-1]:#x}')

def fn_bounds(va):
    i=bisect.bisect_right(starts, va)-1
    if i<0: return None
    lo=starts[i]
    hi=starts[i+1] if i+1<len(starts) else lo+0x10000
    if not (lo<=va<hi): return None
    return lo,hi

json.dump(starts[:5], open('/tmp/re/fde_probe.json','w'))

# ---- string xref map (adrp+add, full .text) ----
N=TX[2]//4
words=struct.unpack_from('<%dI'%N,raw,TX[1])
def dec(w,pc):
    rd=w&0x1F; immlo=(w>>29)&3; immhi=(w>>5)&0x7FFFF
    imm=(immhi<<2)|immlo
    if imm&(1<<20): imm-=(1<<21)
    return rd,(pc&~0xFFF)+(imm<<12)
site2str={}
for i in range(N-5):
    w=words[i]
    if (w & 0x9F000000)!=0x90000000: continue
    rd,base=dec(w,TX[0]+i*4)
    for k in (1,2,3,4):
        if i+k>=N: break
        w2=words[i+k]
        if (w2 & 0xFF800000)==0x91000000 and ((w2>>5)&0x1F)==rd and (w2&0x1F)==rd:
            imm12=(w2>>10)&0xFFF; sh=(w2>>22)&1
            va=base+(imm12<<(12 if sh else 0))
            if RO[0]<=va<RO[0]+RO[2]:
                o=RO[1]+va-RO[0]; bb=raw[o:o+200]; z=bb.find(b'\0')
                if z>=2:
                    try:
                        s=bb[:z].decode('ascii')
                        site2str[TX[0]+i*4]=s
                    except Exception: pass
            break
print(f'resolved string-xref sites: {len(site2str)}')

# ---- per-function collected names ----
import collections
fnn=collections.defaultdict(list)
for site,s in site2str.items():
    fb=fn_bounds(site)
    if fb: fnn[fb[0]].append((site,s))

METH=re.compile(r'^[A-Za-z_~][\w:<>,$]*::[A-Za-z_~]\w*$')
def names_of(fnva):
    """names of fn and (if it is a thunk) its target"""
    out=[]
    for key in (fnva, thunk_target(fnva)):
        if key is None: continue
        for site,s in fnn.get(key,[]):
            if METH.match(s): out.append((site,s))
    return out
def thunk_target(fn):
    o=TX[1]+fn-TX[0]
    if o+4>len(raw): return None
    w=struct.unpack_from('<I',raw,o)[0]
    if (w & 0xFC000000) in (0x14000000,0x94000000):
        im=w&0x03FFFFFF
        if im&(1<<25): im-=(1<<26)
        t=fn+im*4
        if TX[0]<=t<TX[0]+TX[2]: return t
    return None

def vr(va):
    if DR[0]<=va<DR[0]+DR[2]: return struct.unpack_from('<Q',raw,va-D)[0]
    return None

OUT=open('/tmp/re/s8_slots.log','w')
def log(*a): print(*a,file=OUT,flush=True)
AP={'nt::MSFService':(0x87173e0,0x8717550),'nt::MSFCoreService':(0x8718f58,0x8719108)}
for nm,(ap,nxt) in AP.items():
    n=(nxt-ap)//8
    log(f'\n######## {nm}  ap=0x{ap:x}  slots=1+{n}')
    for i in range(1,n):
        sv=ap+8*i; fn=vr(sv)
        if fn is None or not (TX[0]<=fn<TX[0]+TX[2]):
            log(f'  v[{i:3d}] off=0x{8*i:#x} fn={hex(fn) if fn else None} <END/NOTEXT>'); break
        nl=names_of(fn)
        src=[s for _,s in [(a,site2str.get(a)) for a in []] ]
        # source file strings in same function
        srcs=[s for site,s in fnn.get(fn,[]) if s.endswith('.cc') or s.endswith('.cpp')]
        tgt=thunk_target(fn)
        tag=' '.join(f'{s}@{site:#x}' for site,s in nl) if nl else ''
        log(f'  v[{i:3d}] off=0x{8*i:#x} slot=0x{sv:x} fn=0x{fn:x}'+(f' ->0x{tgt:x}' if tgt else '')+
            f'  NAMES[{tag}]  SRC={list(dict.fromkeys(srcs))[:2]}')
OUT.close()
print('done')
