#!/usr/bin/env python3
"""Enumerate typeinfo __type_name strings in wrapper.node that contain the fragments
used by the .so: MSF, Msf, SSO, Session, Wrapper, Kernel, NodeI."""
import struct, re
from elftools.elf.elffile import ELFFile
P='/tmp/wrapper.node'; raw=open(P,'rb').read()
elf=ELFFile(open(P,'rb'))
S={s.name:(s['sh_addr'],s['sh_offset'],s['sh_size']) for s in elf.iter_sections()}
RO=S['.rodata']; DR=S['.data.rel.ro']; D=DR[0]-DR[1]
REL=1027
# gather all RELATIVE relocs pointing into .rodata, whose target looks like a mangled name
namemap={}   # name_va -> name string
cands=[]
n=0
for r in elf.get_section_by_name('.rela.dyn').iter_relocations():
    n+=1
    if n>400000: break
    if r['r_info_type']!=REL: continue
    v=r['r_addend']
    if not (RO[0]<=v<RO[0]+RO[2]): continue
    if v in namemap: s=namemap[v]
    else:
        o=RO[1]+v-RO[0]; b=raw[o:o+240]; z=b.find(b'\0')
        if z<3: namemap[v]=None; continue
        try: s=b[:z].decode('ascii')
        except Exception: namemap[v]=None; continue
        namemap[v]=s
    if s: cands.append((r['r_offset'], v, s))
print(f'RELATIVE->rodata refs: {len(cands)}')
FRAG=['MSF','Msf','SSO','Session','Wrapper','Kernel','NodeI']
for f in FRAG:
    m=[(o,v,s) for o,v,s in cands if f in s and s.endswith('E') and re.match(r'^(?:\d+[A-Za-z_][A-Za-z0-9_]*)+E$', s)]
    print(f'\n=== fragment {f!r}: {len(m)} mangled typeinfo names ===')
    for o,v,s in m[:40]:
        print(f'    ti_va=0x{o-8:x} name_va=0x{v:x}  {s}')
