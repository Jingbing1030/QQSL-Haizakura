import re,struct,sys,bisect
sys.path.insert(0,'/home/ubuntu/hook-rewrite/re')
import emu
D=open('/home/ubuntu/x64run/native/snowluma-linux-x64.so','rb').read()
recs=[]
for l in open('/home/ubuntu/hook-rewrite/re/dis/full.asm'):
    m=re.match(r'^\s+([0-9a-f]+):\t(.*)$',l.rstrip())
    if m: recs.append((int(m.group(1),16), m.group(2).split('#')[0].strip()))
def endof(fs):
    for a,b in recs:
        if a>=fs and b=='ret': return a+1
HDR=0x5ccf8
def decode(src,fn,length,seed=None,verbose=False):
    end=endof(fn)
    mem={}
    for i in range(length+64):
        if src+i<len(D): mem[src+i]=D[src+i]
    for i,b in enumerate(struct.pack('<Q',0x4000)): mem[0x1000+i]=b
    regs={'rdi':0x1000,'rsi':src}
    if seed is not None:
        regs['rdx']=0x5000
        for i,b in enumerate(struct.pack('<Q',seed)): mem[0x5000+i]=b
    out,_=emu.decode_custom(fn,end,regs,mem,outbuf=0x4000,outlen=length)
    return bytes(out)
