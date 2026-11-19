import re
ASM='/home/ubuntu/hook-rewrite/re/dis/full.asm'
_lines=open(ASM,encoding='utf-8',errors='replace').read().splitlines()
R64=['rax','rbx','rcx','rdx','rsi','rdi','rbp','rsp','r8','r9','r10','r11','r12','r13','r14','r15']
SUB={'eax':('rax',4),'ebx':('rbx',4),'ecx':('rcx',4),'edx':('rdx',4),
 'esi':('rsi',4),'edi':('rdi',4),'ebp':('rbp',4),'esp':('rsp',4),
 'al':('rax',1),'bl':('rbx',1),'cl':('rcx',1),'dl':('rdx',1),
 'sil':('rsi',1),'dil':('rdi',1),'bpl':('rbp',1),'spl':('rsp',1),
 'ax':('rax',2),'bx':('rbx',2),'cx':('rcx',2),'dx':('rdx',2),
 'r8b':('r8',1),'r9b':('r9',1),'r10b':('r10',1),'r11b':('r11',1),'r12b':('r12',1),'r13b':('r13',1),'r14b':('r14',1),'r15b':('r15',1),
 'r8d':('r8',4),'r9d':('r9',4),'r10d':('r10',4),'r11d':('r11',4),'r12d':('r12',4),'r13d':('r13',4),'r14d':('r14',4),'r15d':('r15',4),
 'r8w':('r8',2),'r9w':('r9',2),'r10w':('r10',2),'r11w':('r11',2),'r12w':('r12',2),'r13w':('r13',2),'r14w':('r14',2),'r15w':('r15',2)}
M32=(1<<32)-1
def load(a0,a1):
    out=[]
    for l in _lines:
        m=re.match(r'^\s+([0-9a-f]+):\t(.*)$',l)
        if not m: continue
        a=int(m.group(1),16)
        if a0<=a<a1:
            body=m.group(2).split('#')[0].strip()
            out.append((a,body.rstrip()))
    return out
def split_ops(s):
    out=[];depth=0;cur=''
    for ch in s:
        if ch=='[':depth+=1
        elif ch==']':depth-=1
        if ch==',' and depth==0: out.append(cur.strip());cur=''
        else: cur+=ch
    if cur.strip(): out.append(cur.strip())
    return out
class M:
    def __init__(s):
        s.r={k:0 for k in R64}; s.r['rsp']=0x7fff0000; s.mem={}
    def get(s,n):
        if n in s.r: return s.r[n]
        if n in SUB:
            b,sz=SUB[n]; return s.r[b]&((1<<(8*sz))-1)
        raise KeyError(n)
    def set(s,n,v):
        if n in s.r: s.r[n]=v&0xffffffffffffffff; return
        if n in SUB:
            b,sz=SUB[n]; mask=(1<<(8*sz))-1
            if sz==4: s.r[b]=v&M32
            else: s.r[b]=(s.r[b]&~mask)|(v&mask)
            return
        raise KeyError(n)
def opnd(t):
    t=t.strip()
    m=re.match(r'^(BYTE|WORD|DWORD|QWORD) PTR \[(.*)\]$',t)
    if m: return ('mem',m.group(1),m.group(2))
    if re.match(r'^(-?0x[0-9a-f]+|-?\d+)$',t): return ('imm',int(t,0))
    if t in SUB or t in R64: return ('reg',t)
    raise ValueError('opnd:'+t)
def ea(m,e):
    e=e.replace(' ','')
    m2=re.fullmatch(r'([a-z0-9]+)([+-](?:0x[0-9a-f]+|\d+))?',e)
    if m2:
        b=m2.group(1); off=int(m2.group(2),0) if m2.group(2) else 0
        return (m.get(b)+off)&0xffffffffffffffff
    m2=re.fullmatch(r'([a-z0-9]+)\+([a-z0-9]+)\*(\d+)([+-](?:0x[0-9a-f]+|\d+))?',e)
    if m2:
        return (m.get(m2.group(1))+m.get(m2.group(2))*int(m2.group(3))+(int(m2.group(4),0) if m2.group(4) else 0))&0xffffffffffffffff
    m2=re.fullmatch(r'([a-z0-9]+)\*\d+([+-](?:0x[0-9a-f]+|\d+))?',e)
    if m2:
        return (m.get(m2.group(1))*int(re.search(r'\*(\d+)',e).group(1))+(int(m2.group(2),0) if m2.group(2) else 0))&0xffffffffffffffff
    m2=re.fullmatch(r'([a-z0-9]+)\+([a-z0-9]+)([+-](?:0x[0-9a-f]+|\d+))?',e)
    if m2:
        return (m.get(m2.group(1))+m.get(m2.group(2))+(int(m2.group(3),0) if m2.group(3) else 0))&0xffffffffffffffff
    raise ValueError('ea:'+e)
def rd(m,o):
    if o[0]=='imm': return o[1]
    if o[0]=='reg': return m.get(o[1])
    sz={'BYTE':1,'WORD':2,'DWORD':4,'QWORD':8}[o[1]]
    a=ea(m,o[2]); v=0
    for i in range(sz):
        x=m.mem.get(a+i,0)
        if isinstance(x,tuple): x=x[1]
        v |= (x&0xff)<<(8*i)
    return v
def wr(m,o,v):
    if o[0]=='reg': m.set(o[1],v); return
    if o[0]=='mem':
        sz={'BYTE':1,'WORD':2,'DWORD':4,'QWORD':8}[o[1]]
        a=ea(m,o[2]); v=v&((1<<(8*sz))-1)
        for i in range(sz): m.mem[a+i]=(v>>(8*i))&0xff
        return
    raise ValueError('wr'+str(o))
def width(o):
    if o[0]=='reg':
        n=o[1]
        if n in SUB: return SUB[n][1]
        return 8
    return {'BYTE':1,'WORD':2,'DWORD':4,'QWORD':8}[o[1]]
NEST={}
def run(a0,a1,inbuf,outlen=0,verbose=False,inherit=None):
    ins=load(a0,a1); m=inherit or M()
    if inherit is None:
        m.r['rdi']=0x1000; m.r['rsi']=0x2000
        for i,b in enumerate(inbuf): m.mem[0x2000+i]=b
    for a,body in ins:
        if verbose: print(f"{a:06x}  {body}")
        p=body.split(None,1); op=p[0]; rest=p[1] if len(p)>1 else ''
        if op=='ret': break
        if op in ('push','pop','nop','xchg','cs'): continue
        if op.startswith('nop') or op.startswith('cs nop'): continue
        if op=='call':
            tgt=re.match(r'^([0-9a-f]+) <',rest)
            t=tgt.group(1) if tgt else None
            ti=int(t,16) if t else 0
            if ti in NEST:
                sub=run(ti,NEST[ti],b'',0,inherit=m)
                m.r['rax']=sub.r['rax']
                continue
            m.mem[m.r['rdi']]=0x3000; m.mem[m.r['rdi']+8]=outlen; continue
        o=split_ops(rest)
        if op in ('mov','movabs'):
            wr(m,opnd(o[0]),rd(m,opnd(o[1])))
        elif op=='movzx':
            wr(m,opnd(o[0]),rd(m,opnd(o[1]))&0xff)
        elif op=='movsx':
            wr(m,opnd(o[0]),rd(m,opnd(o[1])))
        elif op=='lea': m.set(o[0],ea(m,o[1].strip().lstrip('[').rstrip(']')))
        elif op in ('add','sub','xor','or','and'):
            d=opnd(o[0]); v=rd(m,d); w=rd(m,opnd(o[1]))
            r={'add':v+w,'sub':v-w,'xor':v^w,'or':v|w,'and':v&w}[op]
            wr(m,d,r)
        elif op=='imul':
            if len(o)==3: wr(m,opnd(o[0]),rd(m,opnd(o[1]))*rd(m,opnd(o[2])))
            else:
                d=opnd(o[0]); wr(m,d,rd(m,d)*rd(m,opnd(o[1])))
        elif op in ('rol','ror'):
            d=opnd(o[0]); bits=width(d)*8; mask=(1<<bits)-1
            v=rd(m,d)&mask; n=rd(m,opnd(o[1]))%bits
            if n: v=((v<<n)|(v>>(bits-n)))&mask if op=='rol' else ((v>>n)|(v<<(bits-n)))&mask
            wr(m,d,v)
        elif op in ('shr','shl','sar'):
            d=opnd(o[0]); bits=width(d)*8; mask=(1<<bits)-1
            v=rd(m,d)&mask; n=rd(m,opnd(o[1]))
            v=(v>>n) if op in('shr','sar') else ((v<<n)&mask)
            wr(m,d,v)
        elif op in ('shrd','shld'):
            d=opnd(o[0]); dst=rd(m,d)&M32; src=rd(m,opnd(o[1]))&M32; n=rd(m,opnd(o[2]))
            if n: dst=((dst>>n)|(src<<(32-n)))&M32 if op=='shrd' else ((dst<<n)|(src>>(32-n)))&M32
            wr(m,d,dst)
        else: raise ValueError('op:'+op+' :: '+body)
    return m
def decode(fn,a0,a1,seed,outlen,inbuf):
    m=run(a0,a1,inbuf,outlen)
    return bytes(m.mem.get(0x3000+i,0)&0xff for i in range(outlen))


def decode_custom(a0,a1,regs,mementries,outbuf=0x3000,outlen=32):
    m=M()
    for k,v in regs.items(): m.r[k]=v
    for a,v in mementries.items(): m.mem[a]=v
    ins=load(a0,a1)
    for a,body in ins:
        p=body.split(None,1); op=p[0]; rest=p[1] if len(p)>1 else ''
        if op=='ret': break
        if op in ('push','pop','nop','xchg','cs'): continue
        if op.startswith('nop'): continue
        if op=='call':
            continue
        o=split_ops(rest)
        if op in ('mov','movabs'): wr(m,opnd(o[0]),rd(m,opnd(o[1])))
        elif op=='movzx': wr(m,opnd(o[0]),rd(m,opnd(o[1]))&0xff)
        elif op=='lea': m.set(o[0],ea(m,o[1].strip().lstrip('[').rstrip(']')))
        elif op in ('add','sub','xor','or','and'):
            d=opnd(o[0]); v=rd(m,d); w=rd(m,opnd(o[1]))
            wr(m,d,{'add':v+w,'sub':v-w,'xor':v^w,'or':v|w,'and':v&w}[op])
        elif op=='imul':
            if len(o)==3: wr(m,opnd(o[0]),rd(m,opnd(o[1]))*rd(m,opnd(o[2])))
            else:
                d=opnd(o[0]); wr(m,d,rd(m,d)*rd(m,opnd(o[1])))
        elif op in ('rol','ror'):
            d=opnd(o[0]); bits=width(d)*8; mask=(1<<bits)-1
            v=rd(m,d)&mask; n=rd(m,opnd(o[1]))%bits
            if n: v=((v<<n)|(v>>(bits-n)))&mask if op=='rol' else ((v>>n)|(v<<(bits-n)))&mask
            wr(m,d,v)
        elif op in ('shr','shl','sar'):
            d=opnd(o[0]); bits=width(d)*8; mask=(1<<bits)-1
            v=rd(m,d)&mask; n=rd(m,opnd(o[1]))
            v=(v>>n) if op in('shr','sar') else ((v<<n)&mask)
            wr(m,d,v)
        elif op in ('shrd','shld'):
            d=opnd(o[0]); dst=rd(m,d)&M32; src=rd(m,opnd(o[1]))&M32; n=rd(m,opnd(o[2]))
            if n: dst=((dst>>n)|(src<<(32-n)))&M32 if op=='shrd' else ((dst<<n)|(src>>(32-n)))&M32
            wr(m,d,dst)
        else: raise ValueError(op+' :: '+body)
    return bytes(m.mem.get(outbuf+i,0)&0xff for i in range(outlen)), m
