#!/usr/bin/env python3
"""Task1: enumerate Itanium RTTI typeinfo structures in wrapper.node using .rela.dyn (authoritative)."""
import sys, re, struct, json
from elftools.elf.elffile import ELFFile

PATH='/tmp/wrapper.node'
OUT=open('/tmp/re/reloc_rtti.log','w')
def log(*a):
    print(*a, file=OUT, flush=True)

f=open(PATH,'rb'); elf=ELFFile(f)
secs={}
for s in elf.iter_sections():
    secs[s.name]=(s['sh_addr'], s['sh_offset'], s['sh_size'])
log('sections of interest:', {k:tuple(hex(x) for x in v) for k,v in secs.items() if k in ('.rodata','.data.rel.ro','.text','.rela.dyn','.got','.data')})

RO_VA,RO_OFF,RO_SZ = secs['.rodata']
DR_VA,DR_OFF,DR_SZ = secs['.data.rel.ro']
TX_VA,TX_OFF,TX_SZ = secs['.text']

def inro(v): return RO_VA <= v < RO_VA+RO_SZ
def indr(v): return DR_VA <= v < DR_VA+DR_SZ
def intx(v): return TX_VA <= v < TX_VA+TX_SZ

def rdstr(va, maxlen=160):
    if not inro(va): return None
    o = va-RO_VA+RO_OFF
    f.seek(o); b=f.read(maxlen)
    z=b.find(b'\0')
    if z<0: return None
    s=b[:z]
    if len(s)==0: return None
    try: return s.decode('ascii')
    except Exception: return None

# ---- Step B: R_AARCH64_RELATIVE relocations ----
rel = elf.get_section_by_name('.rela.dyn')
RELATIVE=1027
relmap={}
n=0
CAP=400000
for r in rel.iter_relocations():
    n+=1
    if n>CAP: log('CAP HIT'); break
    if r['r_info_type']==RELATIVE:
        relmap[r['r_offset']]=r['r_addend']
log(f'.rela.dyn entries={n} RELATIVE={len(relmap)}')

# ---- Step C: candidate __type_name pointers ----
# mangled-name regex: sequence of <len><ident> then E ; or plain global identifier
NSP = re.compile(r'^(?:\d+[A-Za-z_][A-Za-z0-9_]*)+E$')
GLB = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')

cands=[]   # (name_off, name_va, string, ti_off, ti_va, kind)
for off,val in relmap.items():
    if not inro(val): continue
    s = rdstr(val, 200)
    if not s: continue
    kind=None
    if NSP.match(s): kind='ns'
    elif GLB.match(s) and len(s)>2: kind='glb'
    else: continue
    ti_off = off-8
    if ti_off not in relmap and (ti_off < DR_OFF or ti_off >= DR_OFF+DR_SZ): continue
    cands.append((off, val, s, ti_off, ti_off-DR_OFF+DR_VA, kind))
log(f'candidate typeinfo structs: {len(cands)}')

# ---- focus: names containing MSF ----
msf=[c for c in cands if 'MSF' in c[2]]
log(f'--- typeinfo names containing "MSF": {len(msf)} ---')
for off,val,s,ti_off,ti_va,kind in sorted(msf, key=lambda c:c[2]):
    log(f'  name@{hex(val)} name_off={hex(off)} ti_va={hex(ti_va)} kind={kind} str={s!r}')

# any name equal to MSFService-ish
log('--- exact "MSFService"-family global names ---')
for off,val,s,ti_off,ti_va,kind in cands:
    if s in ('MSFService','MSFCoreService','MSFServiceV2','MSFCoreServiceV2') or re.fullmatch(r'(?:\d+[A-Za-z_][A-Za-z0-9_]*)*MSFServiceE', s) or 'MSFService' in s:
        log(f'  name@{hex(val)} ti_va={hex(ti_va)} kind={kind} str={s!r}')

json.dump([[hex(a),hex(b),c,hex(d),hex(e),g] for a,b,c,d,e,g in cands], open('/tmp/re/typeinfo_cands.json','w'))
log('TOTAL cands saved')
OUT.close()
