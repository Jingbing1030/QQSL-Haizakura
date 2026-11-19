import re,sys,struct,bisect
sys.path.insert(0,'/home/ubuntu/hook-rewrite/re')
import emu
D=open('/home/ubuntu/x64run/native/snowluma-linux-x64.so','rb').read()
lines=open('/home/ubuntu/hook-rewrite/re/dis/full.asm').read().splitlines()
ins=[]
for l in lines:
    m=re.match(r'^\s+([0-9a-f]+):\t(.*)',l)
    if m:
        a=int(m.group(1),16); body=m.group(2)
        ins.append((a, body.split('#')[0].strip(), body))
f=[l.split() for l in open('/home/ubuntu/hook-rewrite/re/funcs.txt')]
starts=sorted(int(a,16) for a,r in f)
# map addr -> next function start
def fnend(a):
    i=bisect.bisect_right(starts,a)
    return starts[i] if i<len(starts) else 0x56540
# index instructions by address
addrs=[a for a,b,c in ins]
def ins_range(a0,a1): 
    lo=bisect.bisect_left(addrs,a0); return [(a,b) for a,b,c in ins[lo:] if a<a1]

NEST={}
for fs in []: pass

def decode_fn(fs,ln):
    """Emulate decoder function from fs to its first ret, source = the lea rsi/rdi target."""
    end=None
    for a,b in ins_range(fs,fnend(fs)):
        if b=='ret': end=a+1; break
    if end is None: return None
    # find the source lea: instruction 'lea rsi,[rip+...]' or movabs seed
    src=None
    for a,b,c in [(x[0],x[1],x[1]) for x in ins_range(fs,end)]:
        m=re.search(r'#\s+([0-9a-f]+) <',c)
        mm=re.match(r'^lea\s+(rsi|rdi),\[rip',b)
        if m and mm: src=int(m.group(1),16); break
    if src is None: return None
    # find seed movabs into stack
    seed=0
    for a,b in ins_range(fs,end):
        m=re.match(r'^movabs\s+rax,(0x[0-9a-f]+)$',b)
        if m: seed=int(m.group(1),16); break
    # determine out ptr: string obj at [rsp+0x88] style is unknown; instead give rsi->obj pointing to 0x4000
    # run emulation with rdi=src, rsi=obj(0x1000)->buf 0x4000; seed at 0x5000
    RSP=0x7fff0000
    mem={}
    for i in range(256): mem[src+i]=D[src+i]
    for i,b in enumerate(struct.pack('<Q',seed)): mem[RSP+0x48+i]=b
    for i,b in enumerate(struct.pack('<Q',0x4000)): mem[RSP+0x88+i]=b
    # obj at 0x1000
    out,m=emu.decode_custom(fs,end,{'rdi':src,'rsi':RSP+0x88,'rdx':RSP+0x48},mem,outbuf=0x4000,outlen=ln)
    return out
def decode_all():
    res={}
    for fs,ln in [(0x1d820,25),(0x1df50,15),(0x1e560,14),(0x1cc40,26),(0x1d3f0,10)]:
        try: res[hex(fs)]=decode_fn(fs,ln)
        except Exception as e: res[hex(fs)]='ERR '+str(e)
    return res
if __name__=='__main__':
    for k,v in sorted(decode_all().items()): print(k, repr(v))
