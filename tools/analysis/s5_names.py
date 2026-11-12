#!/usr/bin/env python3
"""Enumerate ALL Itanium typeinfo __type_name strings in wrapper.node (.rodata targets of RELATIVE relocs)."""
import struct, re, json
from elftools.elf.elffile import ELFFile
P='/tmp/wrapper.node'; raw=open(P,'rb').read()
elf=ELFFile(open(P,'rb'))
S={s.name:(s['sh_addr'],s['sh_offset'],s['sh_size']) for s in elf.iter_sections()}
RO=S['.rodata']; DR=S['.data.rel.ro']
REL=1027
NAMEOK=re.compile(r'^[A-Za-z0-9_]+$')
cache={}
cands=[]
n=0
for r in elf.get_section_by_name('.rela.dyn').iter_relocations():
    n+=1
    if n>400000: break
    if r['r_info_type']!=REL: continue
    v=r['r_addend']
    if not (RO[0]<=v<RO[0]+RO[2]): continue
    if v not in cache:
        o=RO[1]+v-RO[0]; b=raw[o:o+300]; z=b.find(b'\0')
        s=None
        if z>=2:
            try: s=b[:z].decode('ascii')
            except Exception: s=None
        cache[v]=s
    s=cache[v]
    if not s or not NAMEOK.match(s): continue
    cands.append((r['r_offset'], v, s))
print(f'total RELATIVE->.rodata refs = {len(cands)}')
# typeinfo candidates = field at ti+8 ; ti = field_va-8 must itself look like a struct (first word = ABI vtable ptr in .data.rel.ro)
names={}
for fv,v,s in cands:
    names.setdefault(s,[]).append((fv-8,v))
print(f'distinct candidate name strings = {len(names)}')
json.dump({k:[[hex(a),hex(b)] for a,b in v] for k,v in names.items()}, open('/tmp/re/typeinfo_names.json','w'))
FRAG=['MSF','Msf','SSO','Session','Wrapper','Kernel','NodeI','SessionShell','QrCode','wtlogin']
for f in FRAG:
    m=sorted(k for k in names if f in k)
    print(f'\n=== {f!r}: {len(m)} ===')
    for k in m[:40]:
        ti=[hex(a) for a,_ in names[k]]
        print(f'    ti_va={ti[0]}  {k}')
print('\n--- total distinct names written to /tmp/re/typeinfo_names.json ---')
