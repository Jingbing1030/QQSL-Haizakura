#!/usr/bin/env python3
"""Find the relocation slots (table entries) in .so whose target is a section-name string."""
from elftools.elf.elffile import ELFFile
P='/tmp/sl/snowluma-linux-arm64.so'; raw=open(P,'rb').read()
elf=ELFFile(open(P,'rb'))
S={s.name:(s['sh_addr'],s['sh_offset'],s['sh_size']) for s in elf.iter_sections()}
RO=S['.rodata']
WANT=[b'.rodata',b'.data.rel.ro',b'.rela.dyn',b'.dynsym',b'.got',b'.text',b'.plt',b'.data',b'.eh_frame_hdr',b'.note.gnu.build-id',b'.dynstr',b'.bss',b'.gcc_except_table',b'.init_array']
tg={}
for w in WANT:
    i=raw.find(w)
    while i>=0:
        if RO[1]<=i<RO[1]+RO[2]: tg.setdefault(RO[0]+i-RO[1],w.decode())
        i=raw.find(w,i+1)
print('targets:',{hex(k):v for k,v in tg.items()})
import struct
def name_of(secname):
    s=elf.get_section_by_name(secname)
    return s
for secname in ('.rela.dyn','.rela.plt'):
    s=elf.get_section_by_name(secname)
    if not s: continue
    st=elf.get_section(s['sh_link'])
    for r in s.iter_relocations():
        if r['r_info_type']!=1027: continue
        if r['r_addend'] in tg:
            sym=''
            print(f'  {secname}: slot_va=0x{r["r_offset"]:x} -> 0x{r["r_addend"]:x} = {tg[r["r_addend"]]!r}')
print('--- all relocs target in .rodata and pointing at a printable short string, first 80 sorted by slot ---')
s=elf.get_section_by_name('.rela.dyn')
rows=[]
for r in s.iter_relocations():
    if r['r_info_type']!=1027: continue
    a=r['r_addend']
    if not (RO[0]<=a<RO[0]+RO[2]): continue
    o=RO[1]+a-RO[0]; b=raw[o:o+64]; z=b.find(b'\0')
    if 2<=z<=40 and all(32<=c<127 for c in b[:z]):
        rows.append((r['r_offset'],a,b[:z].decode()))
for sl,a,t in sorted(rows)[:120]:
    print(f'   slot_va=0x{sl:x}  ->0x{a:x}  {t!r}')
