import struct

class ELF:
    def __init__(self, path):
        self.path = path
        self.data = d = open(path, 'rb').read()
        assert d[:4] == b'\x7fELF'
        e_shoff, = struct.unpack_from('<Q', d, 0x28)
        e_shentsize, e_shnum, e_shstrndx = struct.unpack_from('<HHH', d, 0x3a)
        self.secs = []
        for i in range(e_shnum):
            off = e_shoff + i * e_shentsize
            name, typ, flags, addr, offset, size = struct.unpack_from('<IIQQQQ', d, off)
            self.secs.append(dict(nameoff=name, typ=typ, flags=flags,
                                  addr=addr, off=offset, size=size))
        stroff = self.secs[e_shstrndx]['off']
        for s in self.secs:
            e = d.find(b'\0', stroff + s['nameoff'])
            s['name'] = d[stroff + s['nameoff']:e].decode()
        e_phoff, = struct.unpack_from('<Q', d, 0x20)
        e_phentsize, e_phnum = struct.unpack_from('<HH', d, 0x36)
        self.loads = []
        for i in range(e_phnum):
            off = e_phoff + i * e_phentsize
            (p_type, p_flags, p_offset, p_vaddr, p_paddr,
             p_filesz, p_memsz, p_align) = struct.unpack_from('<IIQQQQQQ', d, off)
            if p_type == 1:
                self.loads.append(dict(off=p_offset, vaddr=p_vaddr,
                                       filesz=p_filesz, memsz=p_memsz, flags=p_flags))
        self.text = next(s for s in self.secs if s['name'] == '.text')

    def v2o(self, v, n=1):
        for L in self.loads:
            if L['vaddr'] <= v and v + n <= L['vaddr'] + L['filesz']:
                return L['off'] + (v - L['vaddr'])
        return None

    def sec_of(self, v):
        for s in self.secs:
            if s['typ'] != 8 and s['addr'] and s['addr'] <= v < s['addr'] + s['size']:
                return s['name']
        return '?'

    def rd(self, v, n):
        o = self.v2o(v, n)
        return None if o is None else self.data[o:o + n]

    def q(self, v):
        b = self.rd(v, 8)
        return None if b is None else struct.unpack('<Q', b)[0]

    def w(self, v):
        b = self.rd(v, 4)
        return None if b is None else struct.unpack('<I', b)[0]

    def d(self, v):
        return self.w(v) or 0

    def cstr(self, v, limit=256):
        o = self.v2o(v)
        if o is None:
            return None
        e = self.data.find(b'\0', o, o + limit)
        return self.data[o:e].decode('latin1')

    def in_text(self, v):
        t = self.text
        return t['addr'] <= v < t['addr'] + t['size']
