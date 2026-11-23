import struct
from elf import ELF

R_AARCH64_RELATIVE = 1027

class Image:
    """wrapper.node with .rela.dyn applied (R_AARCH64_RELATIVE addends)."""
    def __init__(self, path):
        self.e = ELF(path)
        self.rel = {}          # vaddr -> addend   (R_AARCH64_RELATIVE only)
        self.rel_sym = {}      # vaddr -> (sym, addend, type)
        self._parse_rel()
    def _parse_rel(self):
        e = self.e
        for sec in e.secs:
            if sec['name'] not in ('.rela.dyn', '.rela.plt'):
                continue
            base = sec['off']; n = sec['size'] // 24
            for i in range(n):
                off, info, add = struct.unpack_from('<QQq', e.data, base + i * 24)
                rt = info & 0xffffffff
                rs = info >> 32
                if rt == R_AARCH64_RELATIVE:
                    self.rel[off] = add
                else:
                    self.rel_sym[off] = (rs, add, rt)
    def q(self, v):
        """pointer word at vaddr v, with relocation applied"""
        if v in self.rel:
            return self.rel[v]
        return self.e.q(v)
    def reloc_targets(self):
        """all things R_AARCH64_RELATIVE points at, as a reverse index"""
        rev = {}
        for site, add in self.rel.items():
            rev.setdefault(add, []).append(site)
        return rev
