import re,sys,struct,bisect
sys.path.insert(0,'/home/ubuntu/hook-rewrite/re')
import emu
D=open('/home/ubuntu/x64run/native/snowluma-linux-x64.so','rb').read()
RECS=[]
for l in open('/home/ubuntu/hook-rewrite/re/dis/full.asm'):
    m=re.match(r'^\s+([0-9a-f]+):\t(.*)$',l.rstrip('\n'))
    if m:
        a=int(m.group(1),16)
        RECS.append((a,m.group(2)))
ADDR=[a for a,b in RECS]
def ins(a0,a1):
    lo=bisect.bisect_left(ADDR,a0)
    return [(a,b.split('#')[0].strip(),b) for a,b in RECS[lo:] if a<a1]
f=[l.split() for l in open('/home/ubuntu/hook-rewrite/re/funcs.txt')]
FS={int(a,16):int(r,16) for a,r in f}
FSTART=sorted(FS)
def fnend(a):
    i=bisect.bisect_right(FSTART,a)
    return FSTART[i] if i<len(FSTART) else 0x56540
RSP=0x7fff0000
def emulate(fs,end,src,seed,ln):
    mem={}
    for i in range(ln+64):
        if src+i<len(D): mem[src+i]=D[src+i]
    for i,b in enumerate(struct.pack('<Q',seed)): mem[RSP+0x48+i]=b
    for i,b in enumerate(struct.pack('<Q',0x4000)): mem[RSP+0x88+i]=b
    for i,b in enumerate(struct.pack('<Q',0x4200)): mem[RSP+0x98+i]=b
    out,m=emu.decode_custom(fs,end,{'rdi':src,'rsi':RSP+0x88,'rdx':RSP+0x48},mem,outbuf=0x4000,outlen=ln)
    return out
def find_seed(fs,end):
    for a,b,c in ins(fs,end):
        m=re.match(r'^movabs\s+(\w+),(0x[0-9a-f]+)$',b)
        if m: return int(m.group(2),16), int(m.group(1).replace('r','').replace('a','') if False else 0,16) if False else 0
    return 0,None
def analyze_decoder(fs):
    """returns (ndecoded_len, seed, seed_reg, kind) or None"""
    end=None
    for a,b,c in ins(fs,fnend(fs)):
        if b=='ret': end=a+1; break
    if end is None: return None
    ln=None; seed=None; sreg=None
    for a,b,c in ins(fs,end):
        m=re.match(r'^mov\s+esi,(0x[0-9a-f]+)$',b)
        if m and ln is None: ln=int(m.group(1),16)
        m=re.match(r'^movabs\s+(\w+),(0x[0-9a-f]+)$',b)
        if m and seed is None: sreg=m.group(1); seed=int(m.group(2),16)
    if ln is None: return None
    # figure where the seed is stored: search 'mov QWORD PTR [rsp+0xNN],<sreg>'
    stoff=None
    if sreg:
        for a,b,c in ins(fs,end):
            m=re.match(r'^mov\s+QWORD PTR \[rsp\+(0x[0-9a-f]+)\],'+sreg+'$',b)
            if m: stoff=int(m.group(1),16); break
    return dict(end=end,ln=ln,seed=seed or 0,sreg=sreg,stoff=stoff)
