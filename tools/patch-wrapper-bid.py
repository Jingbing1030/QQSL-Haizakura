#!/usr/bin/env python3
"""
把 wrapper.node 的 GNU build ID 改成目标值。

原理：Haizakura 的注入 payload 通过 wrapper.node 的 build ID 判据定位
MSFService 的 RTTI 结构。payload 内嵌了它支持的 build ID（当前是 3.2.32 的
89c36b52...）。新版 QQ 的 wrapper.node build ID 不同 → 判据不匹配 →
RTTI 链解析失败 → reporting 一直 status=-1（OneBot/Satori 收不到消息）。

用法：
  # 读取 payload 支持的 build ID
  python3 patch-wrapper-bid.py --show-supported /path/to/snowluma-linux-arm64.so

  # 把新版的 wrapper.node 改成 payload 支持的值
  python3 patch-wrapper-bid.py --from-payload /path/to/snowluma-linux-arm64.so \
      --in /opt/QQ/resources/app/wrapper.node --out /tmp/wrapper-patched.node

  # 或显式指定
  python3 patch-wrapper-bid.py --set 89c36b520f97c88081a9453bd6abb70c3452f156 \
      --in wrapper.node --out wrapper-patched.node
"""
import sys, struct, argparse, re

NOTE_FMT = "<III"          # namesz, descsz, ntype
GNU_NOTE_TYPE = 3          # NT_GNU_BUILD_ID

def find_build_ids(data):
    """返回 [(offset_of_desc, bytes20), ...]"""
    out = []
    for m in re.finditer(rb'\x04\x00\x00\x00\x14\x00\x00\x00\x03\x00\x00\x00GNU\x00', data):
        off = m.end()
        if off + 20 <= len(data):
            out.append((off, data[off:off+20]))
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--show-supported", metavar="PAYLOAD")
    ap.add_argument("--from-payload", metavar="PAYLOAD")
    ap.add_argument("--set", metavar="HEX40")
    ap.add_argument("--in", dest="inp", required=False)
    ap.add_argument("--out", dest="outp", required=False)
    a = ap.parse_args()

    if a.show_supported:
        d = open(a.show_supported, "rb").read()
        ids = find_build_ids(d)
        print(f"payload 内嵌 {len(ids)} 个 build ID:")
        for off, b in ids:
            print(f"  偏移 0x{off:x}  {b.hex()}")
        return

    if a.from_payload:
        d = open(a.from_payload, "rb").read()
        ids = find_build_ids(d)
        if not ids:
            print("错误：payload 里没有 build ID note", file=sys.stderr); sys.exit(1)
        # 取第一个（payload 用它做 wrapper.node 判据）
        target = ids[0][1].hex()
        print(f"payload 支持的 build ID: {target}")
    elif a.set:
        target = a.set.strip().lower()
        if len(target) != 40:
            print("错误：--set 需要 40 位 hex", file=sys.stderr); sys.exit(1)
    else:
        print("错误：需要 --show-supported / --from-payload / --set 之一", file=sys.stderr); sys.exit(1)

    if not a.inp or not a.outp:
        print("错误：需要 --in 和 --out", file=sys.stderr); sys.exit(1)

    data = open(a.inp, "rb").read()
    ids = find_build_ids(data)
    if not ids:
        print("错误：目标文件里没有 build ID note", file=sys.stderr); sys.exit(1)

    want = bytes.fromhex(target)
    patched = bytearray(data)
    n = 0
    for off, cur in ids:
        if cur == want:
            print(f"  偏移 0x{off:x} 已是目标值，跳过")
            continue
        print(f"  偏移 0x{off:x}  {cur.hex()} → {target}")
        patched[off:off+20] = want
        n += 1
    open(a.outp, "wb").write(bytes(patched))
    print(f"✓ 已写出 {a.outp}（替换 {n} 处，文件大小 {len(patched)}）")

if __name__ == "__main__":
    main()
