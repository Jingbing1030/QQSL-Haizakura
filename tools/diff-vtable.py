#!/usr/bin/env python3
"""
diff-vtable.py —— 对比两个 wrapper.node 版本的同名虚表，按【函数身份】而非槽位索引。

## 为什么不能只看槽位索引

假如腾讯在基类里插一个新虚函数，`v[19]` 之后的槽位全部后移一位。
这时「v[19] = SessionInit」这个断言就错了 —— 同一个索引指向了别的函数。
所以必须按「函数名 + 源文件」这个身份来对齐，再看它在两版的索引是否相同。

## 输出

对每个被对比的类：
  - 共同函数（身份相同）→ 比较槽位索引，标出偏移变化
  - 只在旧版有 → 被删除
  - 只在新版有 → 新增
  - 结论：结构是否兼容、偏移是否变了
"""
import json
import re
import subprocess
import sys
from pathlib import Path

# 从符号信息里提取「函数身份」：源文件 + 函数名
SRC_RE = re.compile(r'([\w/.\-]+\.(?:cc|cpp|c|h))$')
CALL_RE = re.compile(r'^[A-Za-z_][A-Za-z0-9_:~]*$')

# 这些不是函数名，是日志/格式串
NOISE = {
    'vector', 'perf', 'session', 'online', 'msf', 'MSF-NG', 'MSFService',
    'MSFCoreService', 'wrapper', 'msf_service.cc', 'msfcore_service.cc',
    'net_service.cc', 'external', 'modules', 'group_pro', 'internal',
}


def identify(sym_list):
    """从 dump-vtable 的符号信息里提取 (源文件, 函数名) 作为身份。

    符号信息是一串交替的字符串，形如：
      ['MSFService', 'msf_service.cc', 'Connect', 'connect to prod env.', ...]
    其中 .cc 是源文件，紧跟其后的第一个「像标识符」的串是函数名。
    """
    src = None
    for i, s in enumerate(sym_list):
        m = SRC_RE.search(s)
        if m:
            src = m.group(1).split('/')[-1]
        elif src and CALL_RE.match(s) and s not in NOISE and len(s) > 2:
            if not s[0].islower() or s[0].isupper() or '_' in s:
                return (src, s)
    return (src, None) if src else (None, None)


def load(path):
    d = json.loads(Path(path).read_text(encoding='utf-8'))
    out = {}
    for cls, slots in d.items():
        rows = []
        for s in slots:
            idx, vt_addr, fn_addr, sym = s[0], s[1], s[2], (s[3] if len(s) > 3 else [])
            src, fn = identify(sym)
            rows.append({
                'idx': idx,
                'vtable_addr': vt_addr,
                'fn_addr': fn_addr,
                'src': src,
                'fn': fn,
                'raw': sym[:6],
            })
        out[cls] = rows
    return out


def diff_class(cls, old_rows, new_rows):
    print(f"\n{'='*72}")
    print(f"  类: {cls}")
    print(f"  旧版 {len(old_rows)} 槽  →  新版 {len(new_rows)} 槽")
    print(f"{'='*72}")

    # 按身份（src, fn）建索引
    def keyed(rows):
        d = {}
        for r in rows:
            if r['fn']:
                d.setdefault((r['src'], r['fn']), []).append(r)
        return d

    ko, kn = keyed(old_rows), keyed(new_rows)

    only_old = sorted(set(ko) - set(kn), key=lambda x: ko[x][0]['idx'])
    only_new = sorted(set(kn) - set(ko), key=lambda x: kn[x][0]['idx'])
    both = sorted(set(ko) & set(kn), key=lambda x: ko[x][0]['idx'])

    # ① 共同函数：索引是否变了
    shifted, same = [], []
    for k in both:
        oi = [r['idx'] for r in ko[k]]
        ni = [r['idx'] for r in kn[k]]
        if oi == ni:
            same.append((k, oi))
        else:
            shifted.append((k, oi, ni))

    print(f"\n  ① 共同函数 {len(both)} 个")
    print(f"     索引不变: {len(same)}")
    print(f"     索引变了: {len(shifted)}")
    if shifted:
        print(f"\n     ⚠️ 索引发生变化的函数（这才是危险的）：")
        for (src, fn), oi, ni in shifted[:20]:
            delta = [n - o for o, n in zip(oi, ni)]
            print(f"       {fn:<34} {oi} → {ni}   Δ={delta}")
    if same:
        print(f"\n     ✓ 索引稳定的函数（可安全 hook）：")
        for (src, fn), idx in same[:14]:
            print(f"       v{idx}  {fn:<32} ({src})")

    # ② 增减
    print(f"\n  ② 仅旧版有 {len(only_old)} 个（新版删除或改名）")
    for src, fn in only_old[:14]:
        print(f"       v{ko[(src,fn)][0]['idx']}  {fn:<32} ({src})")
    print(f"\n  ③ 仅新版有 {len(only_new)} 个（新版新增）")
    for src, fn in only_new[:14]:
        print(f"       v{kn[(src,fn)][0]['idx']}  {fn:<32} ({src})")

    return {
        'class': cls,
        'same': len(same),
        'shifted': len(shifted),
        'only_old': len(only_old),
        'only_new': len(only_new),
        'shifted_detail': [
            {'fn': fn, 'src': src, 'old': oi, 'new': ni}
            for (src, fn), oi, ni in shifted
        ],
    }


def main():
    if len(sys.argv) < 3:
        print("用法: diff-vtable.py <旧版.json> <新版.json>", file=sys.stderr)
        sys.exit(1)
    old, new = load(sys.argv[1]), load(sys.argv[2])

    print(f"\n{'#'*72}")
    print(f"# wrapper.node 虚表对比（按函数身份对齐）")
    print(f"#   旧: {sys.argv[1]}")
    print(f"#   新: {sys.argv[2]}")
    print(f"{'#'*72}")

    results = []
    for cls in sorted(set(old) & set(new)):
        results.append(diff_class(cls, old[cls], new[cls]))

    print(f"\n{'#'*72}")
    print(f"# 汇总")
    print(f"{'#'*72}")
    print(f"  {'类':<20} {'共同':>5} {'索引变':>7} {'仅旧':>6} {'仅新':>6}   判定")
    for r in results:
        if r['shifted'] == 0 and r['only_old'] == 0:
            verdict = "✅ 完全兼容（偏移未变）"
        elif r['shifted'] == 0:
            verdict = "⚠️ 有删除但偏移未变"
        else:
            verdict = f"❌ 偏移已变（{r['shifted']} 个函数挪位）"
        print(f"  {r['class']:<20} {r['same']+r['shifted']:>5} {r['shifted']:>7} "
              f"{r['only_old']:>6} {r['only_new']:>6}   {verdict}")

    Path("vtable-diff.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f"\n  详细结果 → vtable-diff.json")


if __name__ == '__main__':
    main()
