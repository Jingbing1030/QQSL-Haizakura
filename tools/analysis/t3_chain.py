#!/usr/bin/env python3
"""Task1 stage3 (corrected, VA-keyed): typeinfo -> class_type_info vtable -> vtable -> slots."""
import struct, json
from elftools.elf.elffile import ELFFile
P='/tmp/wrapper.node'; OUT=open('/tmp/re/t3_chain.log','w')
def log(*a): print(*a,file=OUT,flush=True)
f=open(P,'rb'); elf=ELFFile(f)
S={s.name:(s['sh_addr'],s['sh_offset'],s['sh_size']) for s in elf.iter_sections()}
RO_VA,RO_OFF,RO_SZ=S['.rodata']; DR_VA,DR_OFF,DR_SZ=S['.data.rel.ro']
TX_VA,TX_OFF,TX_SZ=S['.text']
D=DR_VA-DR_OFF
def inro(v): return RO_VA<=v<RO_VA+RO_SZ
def indr(v): return DR_VA<=v<DR_VA+DR_SZ
def intx(v): return TX_VA<=v<TX_VA+TX_SZ
def va2off(v):
    if inro(v): return v-RO_VA+RO_OFF
    if indr(v): return v-D
    if intx(v): return v-TX_VA+TX_OFF
    return None
def rdstr(va,maxl=220):
    o=va2off(va)
    if o is None: return None
    f.seek(o); b=f.read(maxl); z=b.find(b'\0')
    if z<0 or z==0: return None
    try: return b[:z].decode('ascii')
    except Exception: return None
def word(va):
    o=va2off(va)
    if o is None: return None
    f.seek(o); return struct.unpack('<Q',f.read(8))[0]

REL=1027; relmap={}; n=0
for r in elf.get_section_by_name('.rela.dyn').iter_relocations():
    n+=1
    if n>400000: break
    if r['r_info_type']==REL: relmap[r['r_offset']]=r['r_addend']
log(f'RELATIVE relocs={len(relmap)}  (VA-keyed)')

# 1) locate TIs by exact mangled name
WANT={'N2nt10MSFServiceE':'MSFService','N2nt14MSFCoreServiceE':'MSFCoreService',
      'N2nt13IMSFInterfaceE':'IMSFInterface','N2nt7wrapper17IKernelMSFServiceE':'IKernelMSFService'}
TI={}
for off,val in relmap.items():
    if not inro(val): continue
    s=rdstr(val)
    if s in WANT: TI[WANT[s]]=(off,val)   # off = VA of __type_name field
for k,(nameva,tiva) in TI.items():
    log(f'{k}: __type_name@{hex(nameva)}  typeinfo_va={hex(tiva)}')

# 2) resolve each typeinfo's own ABI vtable + full raw dump
for k,(nameva,ti) in TI.items():
    log(f'\n===== {k}  typeinfo @0x{ti:x} =====')
    log(f'  [ti+0x00] __vptr (reloc) = {hex(relmap.get(ti,0))}' if ti in relmap else '  [ti+0x00] no reloc')
    log(f'  [ti+0x08] __type_name ptr = 0x{word(ti+8):x} -> {rdstr(word(ti+8))!r}')
    log(f'  [ti+0x10] (class_type_name for __si/__vmi_class_type_info) = 0x{word(ti+16):x} -> {rdstr(word(ti+16))!r}')
    for i in (0x18,0x20,0x28,0x30,0x38):
        v=word(ti+i); log(f'  [ti+0x{i:02x}] = 0x{v:x} -> {rdstr(v)!r}')
    abi=relmap.get(ti)
    if abi:
        log(f'  ABI vtable @0x{abi:x}:')
        for i in range(0,5):
            v=word(abi+8*i); nm=rdstr(v+16) if v and inro(v+16) else None
            mesg = rdstr(v) if v and inro(v) else None
            log(f'    [{i}] = 0x{v:x} namefield->{rdstr(v+16)!r}' if (v and inro(v+16) and rdstr(v+16)) else f'    [{i}] = 0x{v:x}')
        log(f'    abi_vtable_name = {rdstr(abi+16)!r}')

# 3) find vtables: DR word == ti  (address point; vtable[1]==typeinfo, vtable[0]=offset_to_top)
log('\n===== vtable address-point search (word==typeinfo) =====')
res={}
for k,(nameva,ti) in TI.items():
    found=[]
    o0=DR_OFF; o1=DR_OFF+DR_SZ
    step=8
    for o in range(o0, o1, step):
        f.seek(o); w=struct.unpack('<Q',f.read(8))[0]
        if w==ti:
            va=o+D
            f.seek(o-8); prev=struct.unpack('<Q',f.read(8))[0]
            found.append((va,prev))
    res[k]=found
    log(f'{k}: {len(found)} hit(s)')
    for va,prev in found:
        log(f'    address_point=0x{va:x}  [ap-8](offset_to_top)=0x{prev:x}  vtable_symbol=0x{va-16:x}')
json.dump({k:[hex(v) for v,_ in l] for k,l in res.items()}, open('/tmp/re/vtables.json','w'))
log('DONE')
OUT.close()
