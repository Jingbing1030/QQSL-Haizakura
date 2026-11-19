import sys,re,struct,bisect
sys.path.insert(0,'/home/ubuntu/hook-rewrite/re')
import emu
D=open('/home/ubuntu/x64run/native/snowluma-linux-x64.so','rb').read()
recs=[]
for l in open('/home/ubuntu/hook-rewrite/re/dis/full.asm'):
    m=re.match(r'^\s+([0-9a-f]+):\t(.*)$',l.rstrip())
    if m: recs.append((int(m.group(1),16), m.group(2).split('#')[0].strip()))
def endof(fs,limit=0x600):
    for a,b in recs:
        if fs<=a<fs+limit and b=='ret': return a+1
def strlen_hint(fs):
    for a,b in recs:
        if fs<=a<fs+0x60:
            m=re.match(r'^mov\s+esi,(0x[0-9a-f]+)$',b)
            if m: return int(m.group(1),16)
def decode(src,fn,n):
    end=endof(fn)
    mem={}
    for i in range(n+96):
        if src+i<len(D): mem[src+i]=D[src+i]
    mem[0x1000]=0x1010
    out,m=emu.decode_custom(fn,end,{'rdi':0x1000,'rsi':src},mem,outbuf=0x1010,outlen=n)
    return bytes(out)
