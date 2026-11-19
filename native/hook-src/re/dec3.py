import re,struct,sys
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
BUFOUT=0x2000
def decode(src,fn,length,seed=None,seedreg='rdx'):
    end=endof(fn)
    mem={}
    for i in range(length+64): mem[src+i]=D[src+i]
    mem[0x1000]=0x1010
    regs={'rdi':0x1000,'rsi':src}
    if seed is not None:
        regs[seedreg]=0x5000
        for i,b in enumerate(struct.pack('<Q',seed)): mem[0x5000+i]=b
    ins=emu.load(fn,end)
    m=emu.M()
    for k,v in mem.items(): m.mem[k]=v
    for k,v in regs.items(): m.r[k]=v
    for a,body in ins:
        p=body.split(None,1); op=p[0]; rest=p[1] if len(p)>1 else ''
        if op=='ret': break
        if op in ('push','pop','nop','xchg','cs'): continue
        if op.startswith('nop'): continue
        if op=='call':
            t=re.match(r'^([0-9a-f]+) <',rest)
            ti=int(t.group(1),16) if t else 0
            if ti in (0x44e0,0x4810):   # _M_construct / _M_create
                m.mem[m.r['rdi']]=BUFOUT
                m.r['rax']=BUFOUT
            continue
        o=emu.split_ops(rest)
        if op in ('mov','movabs'): emu.wr(m,emu.opnd(o[0]),emu.rd(m,emu.opnd(o[1])))
        elif op=='movzx': emu.wr(m,emu.opnd(o[0]),emu.rd(m,emu.opnd(o[1]))&0xff)
        elif op=='lea': m.set(o[0],emu.ea(m,o[1].strip().lstrip('[').rstrip(']')))
        elif op in ('add','sub','xor','or','and'):
            d=emu.opnd(o[0]); v=emu.rd(m,d); w=emu.rd(m,emu.opnd(o[1]))
            emu.wr(m,d,{'add':v+w,'sub':v-w,'xor':v^w,'or':v|w,'and':v&w}[op])
        elif op=='imul':
            if len(o)==3: emu.wr(m,emu.opnd(o[0]),emu.rd(m,emu.opnd(o[1]))*emu.rd(m,emu.opnd(o[2])))
            else:
                d=emu.opnd(o[0]); emu.wr(m,d,emu.rd(m,d)*emu.rd(m,emu.opnd(o[1])))
        elif op in ('rol','ror'):
            d=emu.opnd(o[0]); bits=emu.width(d)*8; mask=(1<<bits)-1
            v=emu.rd(m,d)&mask; n=emu.rd(m,emu.opnd(o[1]))%bits
            if n: v=((v<<n)|(v>>(bits-n)))&mask if op=='rol' else ((v>>n)|(v<<(bits-n)))&mask
            emu.wr(m,d,v)
        elif op in ('shr','shl','sar'):
            d=emu.opnd(o[0]); bits=emu.width(d)*8; mask=(1<<bits)-1
            v=emu.rd(m,d)&mask; n=emu.rd(m,emu.opnd(o[1]))
            emu.wr(m,d,(v>>n) if op in('shr','sar') else ((v<<n)&mask))
        elif op in ('shrd','shld'):
            d=emu.opnd(o[0]); dst=emu.rd(m,d)&emu.M32; s2=emu.rd(m,emu.opnd(o[1]))&emu.M32; n=emu.rd(m,emu.opnd(o[2]))
            if n: dst=((dst>>n)|(s2<<(32-n)))&emu.M32 if op=='shrd' else ((dst<<n)|(s2>>(32-n)))&emu.M32
            emu.wr(m,d,dst)
        else: raise ValueError(op+' :: '+body)
    # The std::string SSO buffer is a stack-ish address supplied by _M_construct;
    # collect all bytes written to heap-ish region and return the first length chars
    cands=sorted({k for k,v in m.mem.items() if 0x100<k<0x100000 and isinstance(v,int)})
    # find a run of >=length contiguous addrs that look like text
    best=None
    byaddr={}
    for k in cands: byaddr[k]=m.mem[k]
    for start in cands:
        ok=True; buf=bytearray()
        for i in range(length):
            v=byaddr.get(start+i)
            if v is None: ok=False;break
            buf.append(v&0xff)
        if ok and all(32<=c<127 for c in buf):
            best=bytes(buf); break
    return best if best else bytes(m.mem.get(BUFOUT+i,0)&0xff for i in range(length))
