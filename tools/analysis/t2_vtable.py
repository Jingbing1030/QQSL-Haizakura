#!/usr/bin/env python3
"""Task1 stage2: typeinfo -> vtable -> slots. Relocation-driven, bounded."""
import re, struct, json, sys
from elftools.elf.elffile import ELFFile
P='/tmp/wrapper.node'; OUT=open('/tmp/re/t2_vtable.log','w')
def log(*a): print(*a,file=OUT,flush=True)
f=open(P,'rb'); elf=ELFFile(f)
S={s.name:(s['sh_addr'],s['sh_offset'],s['sh_size']) for s in elf.iter_sections()}
RO_VA,RO_OFF,RO_SZ=S['.rodata']; DR_VA,DR_OFF,DR_SZ=S['.data.rel.ro']
TX_VA,TX_OFF,TX_SZ=S['.text']
def inro(v): return RO_VA<=v<RO_VA+RO_SZ
def indr(v): return DR_VA<=v<DR_VA+DR_SZ
def intx(v): return TX_VA<=v<TX_VA+TX_SZ
def va2off(v):
    if inro(v): return v-RO_VA+RO_OFF
    if indr(v): return v-DR_OFF if False else v-(DR_VA-DR_OFF)
    if intx(v): return v-TX_VA+TX_OFF
    return None
def rdstr(va,maxl=200):
    o=va2off(va)
    if o is None: return None
    f.seek(o); b=f.read(maxl); z=b.find(b'\0')
    if z<0: return None
    try: return b[:z].decode('ascii')
    except Exception: return None
def u64(va):
    o=va2off(va)
    if o is None: return None
    f.seek(o); return struct.unpack('<Q', f.read(8))[0]

REL=1027
relmap={}; n=0
for r in elf.get_section_by_name('.rela.dyn').iter_relocations():
    n+=1
    if n>400000: break
    if r['r_info_type']==REL: relmap[r['r_offset']]=r['r_addend']
log(f'RELATIVE relocs: {len(relmap)}')

# --- known typeinfo VAs from stage1 (recompute by name) ---
targets={}
for off,val in relmap.items():
    if not inro(val): continue
    s=rdstr(val)
    if s in ('N2nt10MSFServiceE','N2nt14MSFCoreServiceE','N2nt13IMSFInterfaceE','N2nt7wrapper17IKernelMSFServiceE'):
        targets[s]=off-8-(DR_VA-DR_OFF)   # ti vaddr
log('target typeinfo VAs: '+json.dumps({k:hex(v) for k,v in targets.items()}))

# --- what is the typeinfo's own vtable? ---
for name,ti in targets.items():
    vt = relmap.get(ti-(DR_VA-DR_OFF))
    log(f'{name}: ti_va={hex(ti)} vtbl_field_reloc={hex(vt) if vt else None}')
    if vt:
        nm = rdstr(vt+16) if inro(vt+16) else None
        # type_info vtable[-1] is usually its own type name "N10__cxxabiv117__class_type_infoE"
        log(f'    -> its class_type_info name = {rdstr(vt+16)!r}')
        # read the 3 slots of the abi vtable
        log(f'    -> abi vtbl entries: {[hex(relmap.get(vt-(DR_VA-DR_OFF)+8*i, 0xdead)) for i in (0,1,2,3)]}')

# --- find vtables: find DR slots whose value == ti_va  (that is vtable[-1] i.e. address point +0) ---
# In Itanium, vtable symbol address = &vtable[2]; vtable[0]=offset_to_top, vtable[1]=typeinfo.
# So file has at [ap-16]=offset_to_top(0 for primary), [ap-8]=typeinfo.
ti2name = {v:k for k,v in targets.items()}
log('--- scanning for vtable address-points (slot==typeinfo, slot-8==0) ---')
hits={}
for off,val in relmap.items():
    if val in ti2name:
        prev = relmap.get(off-8, None)
        if prev is not None and (prev & 0xffffffffffff) == 0 and prev==0:
            hits.setdefault(ti2name[val],[]).append(off)
for name,offs in hits.items():
    log(f'{name}: {len(offs)} vtable address-point(s)')
    for off in offs:
        va = off-(DR_VA-DR_OFF)+DR_VA
        log(f'    address_point=0x{va:x} (file 0x{off:x})  vtable_header=0x{va-16:x}')
json.dump({k:[hex(o) for o in v] for k,v in hits.items()}, open('/tmp/re/vtables.json','w'))
log('DONE')
OUT.close()
