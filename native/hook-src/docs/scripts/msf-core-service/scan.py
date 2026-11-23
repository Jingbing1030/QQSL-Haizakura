import sys, struct; sys.path.insert(0,'.')
from reloc import Image
im=Image('/home/ubuntu/hzwork/wrapper-arm64.node'); e=im.e; d=e.data
t=e.text; LO,HI=t['addr'],t['addr']+t['size']
def intext(x): return LO<=x<HI
def reloc_sites_pointing_to(target):
    return sorted([site for site,add in im.rel.items() if add==target])

print('=== every site whose R_AARCH64_RELATIVE addend is a given typeinfo ===')
for cls,ti in (('nt::MSFService',0x87177e0),('nt::MSFCoreService',0x87193f8)):
    sites=reloc_sites_pointing_to(ti)
    print('\n%s  typeinfo=%#x  referenced by %d sites'%(cls,ti,len(sites)))
    for s in sites:
        # candidate vtable: s+8 must be first slot
        first=im.q(s+8)
        if first is None or not intext(first):
            print('   %#x  (not a vtable: next word %r not in .text)'%(s,first)); continue
        n=0; v=s+8
        while intext(im.q(v) or 0):
            n+=1; v+=8
        ott=struct.unpack('<q',struct.pack('<Q',im.q(s-8) or 0))[0]
        print('   vtable=%#x  slots=%d  offset-to-top=%d   first=%#x last=%#x'%(s+8,n,ott,im.q(s+8),im.q(s+8+(n-1)*8)))
