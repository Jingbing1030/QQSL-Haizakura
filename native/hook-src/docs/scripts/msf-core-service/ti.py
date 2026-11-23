import sys, struct; sys.path.insert(0,'.')
from reloc import Image
im=Image('/home/ubuntu/hzwork/wrapper-arm64.node'); e=im.e; d=e.data
def q(v): return im.q(v)
def dump_ti(ti,label):
    flags,=struct.unpack_from('<I', d, e.v2o(ti+0x10))
    cnt,  =struct.unpack_from('<I', d, e.v2o(ti+0x14))
    print('%s  typeinfo=%#x'%(label,ti))
    print('   vptr       = %#x   (class type_info vtable)'%q(ti))
    print('   name       = %#x -> %r'%(q(ti+8), e.cstr(q(ti+8))))
    print('   __flags    = %#x    __base_count = %d   => __vmi_class_type_info'%(flags,cnt))
    for i in range(cnt):
        bt=q(ti+0x18+i*16)
        off_fl,=struct.unpack_from('<q', d, e.v2o(ti+0x18+i*16+8))
        nm=e.cstr(q(bt+8)) if bt else None
        print('   base[%d] type=%#x off_flags=%#x  name=%r'%(i,bt,off_fl,nm))
    print()
dump_ti(0x87177e0,'nt::MSFService')
dump_ti(0x87193f8,'nt::MSFCoreService')
print('vptr 0x871e698 minus 16 = %#x'%(0x871e698-16))
for v in (0x871e698-16,):
    o=e.v2o(v); print('   words:', ['%#x'%x for x in struct.unpack_from('<4Q',d,o)])
    for k in range(4):
        print('     +%d -> %#x'%(k*8, q(v+k*8)))
