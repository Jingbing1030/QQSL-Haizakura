import sys, struct; sys.path.insert(0,'.')
from reloc import Image
im=Image('/home/ubuntu/hzwork/wrapper-arm64.node'); e=im.e; d=e.data

def row(v, label=''):
    o=e.v2o(v)
    raw=d[o:o+8]
    add=im.rel.get(v)
    return '%#010x  %s  %-22s %s'%(v, raw.hex(' '), ('->%#x'%add) if add is not None else '', label)

print('=== MSFCoreService primary vtable 0x8718f60 : prologue ===')
for i,v in enumerate([0x8718f60-0x18,0x8718f60-0x10,0x8718f60-0x8]+[0x8718f60+j*8 for j in range(4)]):
    print(row(v))
print()
print('=== slots 34..38 (SendSSORequest family) ===')
for j in range(34,39):
    print(row(0x8718f60+j*8, 'slot %d (+%#x)'%(j,j*8)))
print()
print('=== typeinfo 0x87193f8 ===')
for k in range(4):
    print(row(0x87193f8+k*8, ['vtable(ptr)','name(ptr)','flags','_'] if k<4 else ''))
print()
print('=== 0x871e698 (shared first word of both typeinfos) ===')
print(row(0x871e698), '  ->', e.cstr(im.q(0x871e698)))
