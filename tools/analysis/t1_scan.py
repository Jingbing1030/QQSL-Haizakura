#!/usr/bin/env python3
import mmap, struct, sys, os, json
PATH = '/tmp/wrapper.node'
f = open(PATH, 'rb')
mm = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
FILESZ = len(mm)
RODATA_VA, RODATA_OFF, RODATA_SZ = 0x665d900, 0x665d900, 0x994a46
DRR_VA, DRR_OFF, DRR_SZ         = 0x86acb60, 0x869cb60, 0x32e5a8
TEXT_VA, TEXT_OFF, TEXT_SZ      = 0x83d780, 0x83d780, 0x5e1ff10
DRR_DELTA = DRR_VA - DRR_OFF
NAMES = [b'MSFService', b'MSFCoreService', b'MSFSDK', b'MSFModuleAlloc']
name_vas = {}
for nm in NAMES:
    hits=[]; start=0; cnt=0
    while cnt < 500:
        i = mm.find(nm, start)
        if i < 0: break
        hits.append(i); start=i+1; cnt+=1
    vas=[h-RODATA_OFF+RODATA_VA for h in hits if RODATA_OFF<=h<RODATA_OFF+RODATA_SZ]
    name_vas[nm.decode()]=vas
    print(f'{nm.decode():18s} filehits={len(hits)} rodataVAs={[hex(v) for v in vas]}')
    for v in vas[:6]:
        o=mm.find(b'\0', v-RODATA_VA+RODATA_OFF, v-RODATA_VA+RODATA_OFF+120)
        s=mm[v-RODATA_VA+RODATA_OFF:o].decode('utf-8','replace')
        print(f'    @{hex(v)} -> {s!r}')
json.dump(name_vas, open('/tmp/re/name_vas.json','w'), indent=1)
print('SAVED')
