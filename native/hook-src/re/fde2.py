import struct
data=open('/home/ubuntu/x64run/native/snowluma-linux-x64.so','rb').read()
off=0x5daa0; end=off+0x63c0
res=[]
while off<end:
    ln=struct.unpack_from('<I',data,off)[0]
    if ln==0: break
    cie=struct.unpack_from('<I',data,off+4)[0]
    if cie==0:  # this is a CIE
        off+=4+ln; continue
    # FDE
    pc_begin=struct.unpack_from('<I',data,off+8)[0]+off+4
    pc_range=struct.unpack_from('<I',data,off+12)[0]
    res.append((pc_begin,pc_range))
    off+=4+ln
res.sort()
open('funcs.txt','w').write('\n'.join(f"{a:x} {r:x}" for a,r in res))
print(len(res))
for t in (0x1eb10,0x1ed60,0x1e8b0,0xeca0,0xe8f0,0xe1d0,0xf4f0):
    for a,r in res:
        if a<=t<a+r: print(hex(t),'in func',hex(a),'range',hex(r),'end',hex(a+r))
