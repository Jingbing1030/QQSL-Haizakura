import sys, struct; sys.path.insert(0,'.')
from reloc import Image
im=Image('/home/ubuntu/hzwork/wrapper-arm64.node'); e=im.e; d=e.data
LO=e.text['addr']; HI=LO+e.text['size']
def refs(fn_start, limit=0x2000):
    out=[]; o=fn_start
    while o+8<=min(fn_start+limit,HI):
        w0,=struct.unpack_from('<I',d,o)
        if (w0&0x9f000000)==0x90000000:
            w1,=struct.unpack_from('<I',d,o+4)
            if (w1&0xffc00000)==0x91000000:
                rd=w0&0x1f; rn=w1&0x1f
                if rd==rn:
                    immlo=(w0>>29)&3; immhi=(w0>>5)&0x7ffff
                    imm=((immhi<<2)|immlo)
                    if imm&(1<<20): imm-=1<<21
                    page=((o>>12)<<12)+(imm<<12)
                    a12=(w1>>10)&0xfff
                    if (w1>>22)&1: a12<<=12
                    s=e.cstr(page+a12,120)
                    if s: out.append((o,page+a12,s))
        o+=4
    return out
for lbl,fn in (('slot 36 SendSSORequest',0x139f69c),('slot 37 NoResponse',0x139fb08),('slot 38 SendMsfRequest',0x13a03c0)):
    print('=== %s @ %#x ==='%(lbl,fn))
    seen=set()
    for o,t,s in refs(fn):
        if s in seen: continue
        seen.add(s); print('   %#x  %r'%(t,s))
    print()
