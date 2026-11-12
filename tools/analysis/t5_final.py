#!/usr/bin/env python3
"""DEFINITIVE Itanium RTTI chain resolver for wrapper.node. All keys are VADDRs."""
import struct, json
from elftools.elf.elffile import ELFFile
P='/tmp/wrapper.node'; OUT=open('/tmp/re/t5_final.log','w')
def log(*a): print(*a,file=OUT,flush=True)
f=open(P,'rb'); elf=ELFFile(f)
S={s.name:(s['sh_addr'],s['sh_offset'],s['sh_size']) for s in elf.iter_sections()}
RO_VA,RO_OFF,RO_SZ=S['.rodata']; DR_VA,DR_OFF,DR_SZ=S['.data.rel.ro']; TX_VA,TX_OFF,TX_SZ=S['.text']
D=DR_VA-DR_OFF
def inro(v): return RO_VA<=v<RO_VA+RO_SZ
def indr(v): return DR_VA<=v<DR_VA+DR_SZ
def intx(v): return TX_VA<=v<TX_VA+TX_SZ
def va2off(v):
    if inro(v): return v-RO_VA+RO_OFF
    if indr(v): return v-D
    if intx(v): return v-TX_VA+TX_OFF
    return None
def rdstr(va,maxl=240):
    o=va2off(va)
    if o is None: return None
    f.seek(o); b=f.read(maxl); z=b.find(b'\0')
    if z<=0: return None
    try: return b[:z].decode('ascii')
    except Exception: return None
def w(va):
    o=va2off(va); f.seek(o); return struct.unpack('<Q',f.read(8))[0]

REL=1027; relmap={}; n=0
for r in elf.get_section_by_name('.rela.dyn').iter_relocations():
    n+=1
    if n>400000: break
    if r['r_info_type']==REL: relmap[r['r_offset']]=r['r_addend']
log(f'RELATIVE relocs = {len(relmap)} (keyed by VADDR)')

# index: for fast "who points at X"
log('\n===== [A] locate typeinfo by EXACT mangled RTTI name =====')
WANT=['N2nt10MSFServiceE','N2nt14MSFCoreServiceE','N3msf11IMSFServiceE','N3msf12IMSFCallbackE',
      'N2nt13IMSFInterfaceE','N2nt7wrapper17IKernelMSFServiceE','N3msf6MSFSDKE','N3MSF6MSFSDKE']
byname={}
for off,val in relmap.items():          # off=VADDR of field, val=target VADDR
    if val<RO_VA or val>=RO_VA+RO_SZ: continue
    s=rdstr(val)
    if s in WANT: byname.setdefault(s,[]).append((off,val))
TI={}
for nm,lst in byname.items():
    for field_va,str_va in lst:
        ti = field_va-8
        log(f'  {nm:35s} __type_name field @0x{field_va:x}  str @0x{str_va:x}  ==> typeinfo VADDR = 0x{ti:x}')
        TI.setdefault(nm,[]).append((ti,field_va,str_va))

# [B] ABI vtable of each typeinfo (to learn RTTI class kind)
log('\n===== [B] typeinfo ABI vtable (= RTTI class kind) =====')
for nm,lst in TI.items():
    for ti,field,strva in lst:
        abi=relmap.get(ti)
        if abi is None:
            log(f'  {nm} @0x{ti:x}: no reloc at ti+0'); continue
        nmf = rdstr(abi+16)
        sig = [w(abi+8*i) for i in range(4)]
        log(f'  {nm} @0x{ti:x}: __vptr=0x{abi:x} RTTIclass={nmf!r}')
        # class name field of the ABI type_info (own type name)
        log(f'      abi_sig_words={[hex(x) for x in sig]}')

# [C] vtable discovery: DR word == ti  => address_point
log('\n===== [C] vtables (address_point: word==typeinfo) =====')
VT={}
for nm,lst in TI.items():
    for ti,field,strva in lst:
        hits=[]
        for o in range(DR_OFF, DR_OFF+DR_SZ, 8):
            f.seek(o)
            if struct.unpack('<Q',f.read(8))[0]==ti:
                va=o+D
                f.seek(o-8); prev=struct.unpack('<Q',f.read(8))[0]
                hits.append((va,prev))
        VT[(nm,ti)]=hits
        log(f'  {nm} ti=0x{ti:x}: {len(hits)} address_point(s)')
        for va,prev in hits:
            log(f'      address_point=0x{va:x}  offset_to_top([ap-8])=0x{prev:x}  header=0x{va-16:x}')

# [D] dump slots of each vtable
log('\n===== [D] vtable slot dump =====')
for (nm,ti),hits in VT.items():
    for va,prev in hits:
        log(f'  --- {nm} vtable @0x{va:x} (offset_to_top=0x{prev:x}) ---')
        for i in range(0,40):
            sv=va+8*i
            if not indr(sv): break
            v=relmap.get(sv)
            if v is None:
                raw=w(sv)
                if raw==0: log(f'      [{i:3d}] 0  <END>'); break
                log(f'      [{i:3d}] 0x{raw:x} (not a reloc)'); continue
            tag = 'TEXT' if intx(v) else ('??' )
            log(f'      [{i:3d}] 0x{v:x} {tag}')
json.dump({f'{k[0]}@{hex(k[1])}':[hex(a) for a,_ in v] for k,v in VT.items()}, open('/tmp/re/vtables_final.json','w'))
log('\nDONE')
OUT.close()
