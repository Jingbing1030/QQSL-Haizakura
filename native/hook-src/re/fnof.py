import sys,bisect
f=[l.split() for l in open('/home/ubuntu/hook-rewrite/re/funcs.txt')]
starts=[int(a,16) for a,r in f]
rng=[int(r,16) for a,r in f]
def find(t):
    i=bisect.bisect_right(starts,t)-1
    if i>=0 and starts[i]<=t<starts[i]+rng[i]: return starts[i],rng[i]
    return None,None
for x in sys.argv[1:]:
    a,r=find(int(x,16)); print(x,'->',hex(a) if a else None,'size',hex(r) if r else None,'end',hex(a+r) if a else None)
