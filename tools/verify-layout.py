#!/usr/bin/env python3
"""
verify-layout.py —— 打 build-ID 补丁【之前】的布局校验。

## 为什么需要它

`hz-fix-compat` 做的是：把新版 wrapper.node 的 GNU build ID 改成 payload
认识的那个值，让 payload 用旧的 RTTI 偏移表去挂钩。

这在「新版布局与旧版一致」时正确，在「布局变了」时【静默出错】：
payload 会按旧偏移挂钩，而旧偏移在新版里指向【别的函数】。后果可能是
崩溃、也可能是行为诡异而不报错 —— 后者更糟。

实测过：只改 build ID 就能让 reporting 变成 available，所以
「hook 成功」这个信号【不足以】证明偏移是对的。

## 本脚本做什么

按【函数身份】（源文件 + 函数名）对齐新旧两版的虚表，逐槽比对：

  - 同名函数在两者里的槽位索引是否相同
  - 有没有函数被删除 / 新增
  - 汇报有多少槽位【无法识别】（这些是未验证的盲区）

结论只有两种：
  ✅ 可以补丁 —— 所有可识别的函数槽位完全一致
  ❌ 拒绝补丁 —— 有函数挪位，说明布局真的变了，必须重新逆向

## 用法

  python3 verify-layout.py \
      --old wrapper-node-baseline.node \
      --new /opt/QQ/resources/app/wrapper.node \
      --dump-tool dump-vtable.py

  # 只看两版的类列表差异（快，不逐槽）
  python3 verify-layout.py --old A --new B --quick
"""
import argparse
import json
import re
import subprocess
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

# 提取函数身份时要忽略的噪声（日志 tag、命名空间、目录名）
NOISE = {
    'vector', 'perf', 'session', 'online', 'msf', 'MSF-NG',
    'MSFService', 'MSFCoreService', 'wrapper', 'external', 'modules',
    'group_pro', 'internal', 'MSFCore_Service_Log', 'MSF_Service_Log',
    'true', 'false', 'nullptr', 'std', 'nt',
}

# 这些是 hook 真正依赖的槽位，任何一个挪位都必须拒绝
CRITICAL = [
    'SessionInit', 'SendSSORequestInternal', 'onMSFPacketState',
    'ResetSessionId', 'Connect', 'getMsfStatus', 'SetDefaultUin',
    'Disconnect', 'OnNetworkChange', 'OnConnectivityChanged',
]

CLASSES = ['MSFService', 'MSFCoreService']


def run_dump(tool, wrapper, out_json):
    """调用 dump-vtable.py 生成 {类名: [{idx, vtable_addr, fn_addr, names}]}"""
    code = f'''
import json, sys
sys.argv = ["dump-vtable.py", "--wrapper", {wrapper!r}, "--dump-named", {out_json!r}]
exec(open({tool!r}).read())
'''
    # dump-vtable.py 没有 --dump-named 模式，改用它已有的 --class 输出解析
    result = {}
    for cls in CLASSES:
        p = subprocess.run(
            [sys.executable, tool, '--wrapper', wrapper, '--class', f'nt::{cls}'],
            capture_output=True, text=True, timeout=600)
        rows = []
        for line in p.stdout.splitlines():
            m = re.match(r'\s*v\[\s*(\d+)\]\s+\+0x[0-9a-f]+\s+->\s+(0x[0-9a-f]+)', line)
            if m:
                rows.append({'idx': int(m.group(1)), 'fn_addr': m.group(2), 'names': []})
        if rows:
            result[cls] = rows
    return result


def load_named(path):
    """从 t7-style 的 name.json 读（含每个槽位的字符串特征）"""
    d = json.loads(Path(path).read_text())
    out = {}
    for cls, slots in d.items():
        rows = []
        for s in slots:
            rows.append({
                'idx': s[0],
                'vtable_addr': s[1] if len(s) > 1 else None,
                'fn_addr': s[2] if len(s) > 2 else None,
                'names': s[3] if len(s) > 3 else [],
            })
        out[cls] = rows
    return out


def ident(names):
    """从字符串特征里提取 (源文件, 函数名)"""
    src = fn = None
    for s in names:
        if s.endswith(('.cc', '.cpp', '.c', '.h')):
            src = s.split('/')[-1]
        elif src and fn is None and s not in NOISE and len(s) > 3:
            if s[0].isupper() or '_' in s:
                fn = s
    return src, fn


def compare(old, new, verbose=True):
    verdict_ok = True
    report = []

    for cls in CLASSES:
        ra, rb = old.get(cls, []), new.get(cls, [])
        if not ra or not rb:
            report.append(f"  {cls}: ⚠️ 缺少数据（旧 {len(ra)} 槽 / 新 {len(rb)} 槽）")
            continue

        def keyed(rows):
            d = defaultdict(list)
            for r in rows:
                src, fn = ident(r['names'])
                if fn:
                    d[(src, fn)].append(r['idx'])
            return d

        ka, kb = keyed(ra), keyed(rb)
        both = set(ka) & set(kb)
        only_a = set(ka) - set(kb)
        only_b = set(kb) - set(ka)
        moved = [(k, ka[k], kb[k]) for k in both if ka[k] != kb[k]]

        identified_a = len(ka)
        report.append(f"\n  ── {cls} ──")
        # 关键：没有任何可识别函数 → 无从验证，绝不能判为兼容
        if identified_a == 0 and len(kb) == 0:
            report.append(f"     ❌ 两侧都无法识别出函数名 —— 无法验证布局")
            report.append(f"        没有证据不等于兼容。检查 extract-vtable-names.py 是否正常。")
            verdict_ok = False
            continue
        report.append(f"     槽位: 旧 {len(ra)} / 新 {len(rb)}")
        report.append(f"     可识别函数: 旧 {identified_a} / 新 {len(kb)}"
                      f"  （未识别 {len(ra)-identified_a} 槽 = 未验证盲区）")

        if len(ra) != len(rb):
            report.append(f"     ❌ 槽位数不同 —— 布局已变")
            verdict_ok = False

        if moved:
            report.append(f"     ❌ {len(moved)} 个同名函数槽位挪动：")
            for (src, fn), ia, ib in sorted(moved)[:12]:
                report.append(f"          {fn:<32} {ia} → {ib}")
            verdict_ok = False
        elif both:
            report.append(f"     ✅ {len(both)} 个同名函数槽位全部一致")

        # 覆盖率过低时明确警告（未识别槽位属盲区）
        cov = identified_a / max(1, len(ra))
        if cov < 0.5:
            report.append(f"     ⚠️ 可识别覆盖率仅 {cov:.0%} —— 大半槽位未验证")
        if only_a:
            report.append(f"     ⚠️ 旧版独有 {len(only_a)} 个："
                          + ', '.join(f for _, f in sorted(only_a)[:6]))
            verdict_ok = False
        if only_b:
            report.append(f"     ⚠️ 新版独有 {len(only_b)} 个："
                          + ', '.join(f for _, f in sorted(only_b)[:6]))
            verdict_ok = False

        # 关键 hook 点单独核对
        crit_hits = []
        for probe in CRITICAL:
            ia = [r['idx'] for r in ra if ident(r['names'])[1] == probe]
            ib = [r['idx'] for r in rb if ident(r['names'])[1] == probe]
            if ia or ib:
                if ia != ib:
                    crit_hits.append(f"          ❌ {probe}: {ia} → {ib}")
                    verdict_ok = False
                else:
                    crit_hits.append(f"          ✅ {probe}: v{ia}")
        if crit_hits:
            report.append(f"     hook 关键点：")
            report.extend(crit_hits)

    return verdict_ok, report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--old', help='基线 wrapper.node（可选；给了指纹就不需要）')
    ap.add_argument('--new', help='要打补丁的 wrapper.node（可选）')
    ap.add_argument('--old-names', help='基线的 name.json（有则用它，含函数名，更准）')
    ap.add_argument('--new-names', help='新版的 name.json')
    ap.add_argument('--dump-tool', default='dump-vtable.py')
    ap.add_argument('--quick', action='store_true', help='只比类列表，不逐槽')
    a = ap.parse_args()

    print("=" * 78)
    print("  wrapper.node 布局校验（按函数身份对齐，决定是否允许打补丁）")
    print("=" * 78)
    print(f"  基线: {a.old_names or a.old}")
    print(f"  新版: {a.new_names or a.new}")

    # 指纹模式：两份指纹都在，无需 .node 文件
    if a.old_names and a.new_names:
        old = load_named(a.old_names)
        new = load_named(a.new_names)
        ok, report = compare(old, new)
        print("\n".join(report))
        print("\n" + "=" * 78)
        if ok:
            print("  ✅ 判定：布局兼容，可以打 build-ID 补丁")
            print("     依据：所有【可识别】的函数槽位在两版里索引一致。")
            print("     边界：未能识别的槽位不在验证范围内 —— 见上方覆盖率。")
        else:
            print("  ❌ 判定：布局不兼容，【拒绝】打补丁")
            print("     说明出现了函数挪位/增删。继续打补丁会让 hook 挂到错函数上。")
            print("     正确做法：重新提取新版的虚表，更新 payload 的偏移表。")
        print("=" * 78)
        sys.exit(0 if ok else 2)

    if a.quick:
        for f, tag in [(a.old, '基线'), (a.new, '新版')]:
            p = subprocess.run(
                [sys.executable, a.dump_tool, '--wrapper', f, '--dump-all'],
                capture_output=True, text=True, timeout=600)
            try:
                d = json.loads(p.stdout)
                print(f"  {tag} 类数: {len(d)}   {list(d)[:6]}")
            except Exception:
                print(f"  {tag} 解析失败")
        return

    print("\n  （未提供指纹，改用 dump-vtable 提取，只能比槽位数）\n")
    old = run_dump(a.dump_tool, a.old, None)
    new = run_dump(a.dump_tool, a.new, None)

    ok, report = compare(old, new)
    print("\n".join(report))

    print("\n" + "=" * 78)
    if ok:
        print("  ✅ 判定：布局兼容，可以打 build-ID 补丁")
        print("     依据：所有【可识别】的函数槽位在两版里索引一致。")
        print("     边界：未能识别的槽位不在验证范围内 —— 见上方覆盖率。")
    else:
        print("  ❌ 判定：布局不兼容，【拒绝】打补丁")
        print("     说明出现了函数挪位/增删。继续打补丁会让 hook 挂到错函数上。")
        print("     正确做法：重新提取新版的虚表，更新 payload 的偏移表。")
        print("     参考 docs-internals/RTTI-ANALYSIS.md")
    print("=" * 78)
    sys.exit(0 if ok else 2)


if __name__ == '__main__':
    main()
