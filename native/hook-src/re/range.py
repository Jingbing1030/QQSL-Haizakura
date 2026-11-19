import sys,re
start=int(sys.argv[1],16); end=int(sys.argv[2],16)
lines=open('/home/ubuntu/hook-rewrite/re/dis/full.asm',encoding='utf-8',errors='replace').read().splitlines()
out=[];on=False
for l in lines:
    m=re.match(r'^\s+([0-9a-f]+):',l)
    if m:
        a=int(m.group(1),16)
        if start<=a<end: out.append(l)
print('\n'.join(out))
