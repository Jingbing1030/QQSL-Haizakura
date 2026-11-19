import struct
data=open('/home/ubuntu/x64run/native/snowluma-linux-x64.so','rb').read()
HDR=0x5ccf8
b=data[HDR:HDR+0xda4]
def rd(enc,off):
    f=enc&0xf
    if f==0x03: return struct.unpack_from('<I',b,off)[0],off+4
    if f==0x0b: return struct.unpack_from('<i',b,off)[0],off+4
    raise Exception(hex(enc))
eh,o=rd(0x1b,4); cnt,o=rd(0x03,o)
print("eh_frame @",hex(HDR+eh),"count",cnt)
starts=[];p=o
for i in range(cnt):
    l,p=rd(0x3b,p); f,p=rd(0x3b,p)
    starts.append((HDR+l, HDR+f))
starts.sort()
open('func_starts.txt','w').write('\n'.join(f"{a:x} {f:x}" for a,f in starts)+'\n')
print("n=",len(starts),"first",[hex(a) for a,_ in starts[:6]],"last",hex(starts[-1][0]))
# sanity: do these look like function prologues?
for a,_ in starts[:5]:
    print(hex(a), data[a:a+8].hex(' '))
