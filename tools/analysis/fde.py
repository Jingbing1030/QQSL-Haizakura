import struct
from elftools.elf.elffile import ELFFile
f=ELFFile(open('/tmp/re/snowluma-linux-arm64.so','rb'))
h=f.get_section_by_name('.eh_frame_hdr')
d=h.data(); base=h['sh_addr']
print("eh_frame_hdr", hex(base), len(d), d[:8].hex())
ver,ehptr_enc,cnt_enc,tbl_enc = d[0],d[1],d[2],d[3]
print("ver",ver,"ehptr_enc",hex(ehptr_enc),"cnt_enc",hex(cnt_enc),"tbl_enc",hex(tbl_enc))
# decode pointer per DW_EH_PE
def rd(off, enc, base_=base):
    fmt = enc & 0x0f; app = enc & 0x70
    sizes={0x01:1,0x02:2,0x03:4,0x04:8,0x09:2,0x0a:4,0x0b:8}
    n=sizes.get(fmt)
    v=int.from_bytes(d[off:off+n],'little')
    if fmt in (0x09,0x0a,0x0b):  # signed
        v=int.from_bytes(d[off:off+n],'little',signed=True)
    # app: 0x00 abs, 0x10 pcrel
    if app==0x10: v = base_+off+v
    return v, off+n
off=4
ehptr,off2=rd(off,ehptr_enc)
cnt,off3=rd(off2,cnt_enc)
print("eh_frame ptr",hex(ehptr),"fde count",cnt,"tbl starts",hex(off3))
ents=[]
o=off3
for i in range(cnt):
    loc,o=rd(o,0x1b if (tbl_enc&0x0f)==0x0b else tbl_enc)
    fde,o=rd(o,tbl_enc)
    ents.append((loc,fde))
print("first",hex(ents[0][0]),hex(ents[0][1]),"last",hex(ents[-1][0]),hex(ents[-1][1]))
import json
json.dump(ents,open('/tmp/re/fde_locs.json','w'))
print("saved", len(ents))
