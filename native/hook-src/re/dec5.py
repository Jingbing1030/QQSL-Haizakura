"""Generic deobfuscator for the .so's per-string decoder functions.

Each decoder is  decode(std::string* out /*rdi*/, const char* src /*rsi*/):
  * `mov esi,<len>` + `call _M_constructEmc` sizes `out`
  * per-byte: compute cl, write `out->ptr[i] = cl`, then update a 64-bit state
    held in a stack slot (seeded either inline or from a movabs constant)
  * some decoders finish by calling a *continuation* helper that emits the
    remaining bytes (e.g. 1df50 -> 1e2a0, 1eb10 -> ..., 1ed60 -> ...)

The emulator here supports nested `call` by recursing with the same memory and
sharing the 64-bit state slot, which is what the real code does.
"""
import re, sys, struct
sys.path.insert(0, '/home/ubuntu/hook-rewrite/re')
import emu

SO = '/home/ubuntu/x64run/native/snowluma-linux-x64.so'
D = open(SO, 'rb').read()

FUNC = {}
for ln in open('/home/ubuntu/hook-rewrite/re/funcs.txt'):
    a, b = ln.split()
    FUNC[int(a, 16)] = int(b, 16)

OUTBUF = 0x1010          # std::string SSO buffer
OBJ    = 0x1000          # std::string object


def end_of(fn, ok=lambda a: True):
    """First `ret` at or after fn (bounded search)."""
    for a, body in emu.load(fn, fn + 0x900):
        if body == 'ret' and ok(a):
            return a + 1
    raise RuntimeError('no ret in %#x' % fn)


def _step(m, op, o, body):
    if op in ('mov', 'movabs'):
        emu.wr(m, emu.opnd(o[0]), emu.rd(m, emu.opnd(o[1])))
    elif op == 'movzx':
        emu.wr(m, emu.opnd(o[0]), emu.rd(m, emu.opnd(o[1])) & 0xFF)
    elif op == 'movsx':
        emu.wr(m, emu.opnd(o[0]), emu.rd(m, emu.opnd(o[1])))
    elif op == 'lea':
        m.set(o[0], emu.ea(m, o[1].strip().lstrip('[').rstrip(']')))
    elif op in ('add', 'sub', 'xor', 'or', 'and'):
        d = emu.opnd(o[0]); v = emu.rd(m, d); w = emu.rd(m, emu.opnd(o[1]))
        emu.wr(m, d, {'add': v + w, 'sub': v - w, 'xor': v ^ w,
                      'or': v | w, 'and': v & w}[op])
    elif op == 'imul':
        if len(o) == 3:
            emu.wr(m, emu.opnd(o[0]), emu.rd(m, emu.opnd(o[1])) * emu.rd(m, emu.opnd(o[2])))
        else:
            d = emu.opnd(o[0]); emu.wr(m, d, emu.rd(m, d) * emu.rd(m, emu.opnd(o[1])))
    elif op in ('rol', 'ror'):
        d = emu.opnd(o[0]); bits = emu.width(d) * 8; mask = (1 << bits) - 1
        v = emu.rd(m, d) & mask; c = emu.rd(m, emu.opnd(o[1])) % bits
        if c:
            v = ((v << c) | (v >> (bits - c))) & mask if op == 'rol' \
                else ((v >> c) | (v << (bits - c))) & mask
        emu.wr(m, d, v)
    elif op in ('shr', 'shl', 'sar'):
        d = emu.opnd(o[0]); bits = emu.width(d) * 8; mask = (1 << bits) - 1
        v = emu.rd(m, d) & mask; c = emu.rd(m, emu.opnd(o[1]))
        emu.wr(m, d, (v >> c) if op in ('shr', 'sar') else ((v << c) & mask))
    elif op in ('shrd', 'shld'):
        d = emu.opnd(o[0]); dst = emu.rd(m, d) & emu.M32
        s2 = emu.rd(m, emu.opnd(o[1])) & emu.M32
        c = emu.rd(m, emu.opnd(o[2])) % 32
        if c:
            dst = ((dst >> c) | (s2 << (32 - c))) & emu.M32 if op == 'shrd' \
                else ((dst << c) | (s2 >> (32 - c))) & emu.M32
        emu.wr(m, d, dst)
    elif op in ('bt', 'test', 'cmp'):
        pass                      # only flags; no dataflow needed here
    else:
        raise ValueError('%s :: %s' % (op, body))


def exec_fn(m, fn, end, depth=0):
    """Execute [fn,end), following local `call`s recursively (shared memory)."""
    if depth > 4:
        raise RuntimeError('nesting too deep')
    for a, body in emu.load(fn, end):
        p = body.split(None, 1); op = p[0]; rest = p[1] if len(p) > 1 else ''
        if op in ('push', 'pop', 'nop', 'xchg', 'cs') or op.startswith('nop'):
            continue
        if op == 'ret':
            return
        if op == 'call':
            t = re.match(r'^([0-9a-f]+) <', rest)
            ti = int(t.group(1), 16) if t else 0
            if ti in FUNC and ti != 0x44e0:          # skip _M_constructEmc
                exec_fn(m, ti, ti + FUNC[ti], depth + 1)
            continue
        _step(m, op, emu.split_ops(rest), body)


def reads_src_from_rdi(fn):
    """Type-B decoders (1eb10/1ed60) take the byte source in rdi and the
    std::string* in rsi; type-A decoders (rdi=out, rsi=src) are the majority."""
    for a, body in emu.load(fn, fn + 0x60):
        m = re.search(r'BYTE PTR \[rdi\+?(0x[0-9a-f]+)?\]', body)
        if m:
            return True
        if re.search(r'BYTE PTR \[rsi', body):
            return False
    return False


def decode(src, fn, length, end=None, seed=None, seed_slot=0x7fff0048):
    mem = {}
    for i in range(length + 0x180):
        if src + i < len(D):
            mem[src + i] = D[src + i]
    for i, b in enumerate(struct.pack('<Q', OUTBUF)):      # std::string::_M_p
        mem[OBJ + i] = b
    # default 64-bit state seed; decoders that use movabs overwrite it themselves
    if seed is not None:
        for i, b in enumerate(struct.pack('<Q', seed)):
            mem[seed_slot + i] = b
    m = emu.M()
    for k, v in mem.items():
        m.mem[k] = v
    if reads_src_from_rdi(fn):
        m.r['rdi'] = src
        m.r['rsi'] = OBJ
    else:
        m.r['rdi'] = OBJ
        m.r['rsi'] = src
    if seed is not None:
        m.r['rdx'] = seed_slot
    exec_fn(m, fn, end or end_of(fn))
    return bytes(m.mem.get(OUTBUF + i, 0) & 0xFF for i in range(length))


if __name__ == '__main__':
    CASES = [
        ('SNOWLUMA_HOOK_RUNTIME_DIR', 0x57bd9, 0x1d820, 25, None, None),
        ('XDG_RUNTIME_DIR',           0x57bf2, 0x1df50, 15, None, None),
        ('/tmp/snowluma-',            0x57c01, 0x1e560, 14, None, None),
        ('SNOWLUMA_HOOK_SERVICE_MODE',0x57bb5, 0x1cc40, 26, None, None),
        ('in-process',                0x57bcf, 0x1d3f0, 10, None, None),
        ('/mojo.',                    0x57c0f, 0x1eb10, 6, 0xb0ff16b3120d4999, 0x7fff0048),
        ('.sock',                     0x57c16, 0x1ed60, 5, 0x078057181ff3e666, 0x7fff0048),
    ]
    bad = 0
    for name, src, fn, n, seed, slot in CASES:
        try:
            got = decode(src, fn, n, seed=seed)
        except Exception as e:
            print('ERR ', name, type(e).__name__, e); bad += 1; continue
        ok = got.decode('utf-8', 'replace') == name
        bad += not ok
        print('PASS' if ok else 'FAIL', f'{name:28s}', repr(got))
    print('ALL PASS' if not bad else f'{bad} FAILURES')
