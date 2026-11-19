import re,sys
lines=open('/home/ubuntu/hook-rewrite/re/dis/full.asm').read().splitlines()
target=sys.argv[1]
for l in lines:
    m=re.match(r'^\s+([0-9a-f]+):\t(.*)',l)
    if not m: continue
    a=int(m.group(1),16); b=m.group(2).split('#')[0].strip()
    if re.match(rf'^call\s+{target} <',b): print(hex(a), b)
