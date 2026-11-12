#!/usr/bin/env python3
"""Dump raw bytes around known RTTI-related file offsets. .rodata vaddr==fileoff, so trivial."""
P='/tmp/wrapper.node'; f=open(P,'rb')
OFFS=[0x677e7b0,0x677ec94,0x677ecaa,0x67811d0,0x67811e5,0x67818e1,0x677fb47,0x6781f13,0x67e54fe,0x6847424,0x6722d67,0x67591a8]
for o in OFFS:
    f.seek(o-96); b=f.read(400)
    # print chain of NUL-separated strings around o
    parts=b.split(b'\0')
    print(f'--- file 0x{o:x} ---')
    print('   RAW:', repr(b[80:80+120]))
    print()
