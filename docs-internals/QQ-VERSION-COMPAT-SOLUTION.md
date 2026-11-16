# ✅ 解决方案：20 字节修好 QQ 3.2.33+ 兼容性

**时间**：2026-11-16 16:20
**状态**：**已验证，可复现，4/4 成功**

---

## 一、根因（精确定位）

Haizakura 的注入 payload 用 **`wrapper.node` 的 GNU build ID** 作为判据，
确认自己面对的是哪个版本的 QQ，然后才能定位 `MSFService` 的 RTTI 结构。

```
payload 内嵌的 build ID:  89c36b520f97c88081a9453bd6abb70c3452f156
                          = wrapper.node 3.2.32 的真实 build ID  ✓ 匹配

QQ 3.2.33+ 的 wrapper.node: aa5304f33095d52f1baa013e21468bfc00fa1d83（3.2.35）
                          ≠ 89c36b52...                            ✗ 不匹配
```

**不匹配的后果**：
```
payload 找不到它认识的 wrapper.node
  → RTTI 链解析失败（MSFService SessionInit / receive anchor / MSFCoreService ...）
  → op22 一直返回 status=-1
  → OneBot / Satori 收不到消息
```
注意：`pipe connected` 仍会成功（管道建立不受影响），所以**症状很隐蔽** —— 日志只有一行 WARN。

---

## 二、解决方案（20 字节）

把 `wrapper.node` 的 build ID 改成 payload 支持的值：

```bash
python3 patch-wrapper-bid.py --from-payload /app/runtime/native/snowluma-linux-arm64.so \
    --in /opt/QQ/resources/app/wrapper.node --out /tmp/wrapper-patched.node
```

**实测：只改 20 字节（build ID 那 20 字节），其它 147,183,012 字节全不动。**

### 验证矩阵（A/B/A/B，4 次零失败）

| 测试 | wrapper.node build ID | available | 结果 |
|---|---|---|---|
| ① 补丁版（第 1 次） | 89c36b52...（3.2.32 值） | 1 | ✅ 成功 |
| ② 补丁版（第 2 次） | 89c36b52... | 1 | ✅ 成功 |
| ③ **原版**（对照） | aa5304f3...（3.2.35 值） | **0** | ❌ 失败 |
| ④ 补丁版（第 3 次） | 89c36b52... | 1 | ✅ 成功 |

**因果完全确立**：唯一变量是 build ID，且可逆复现。

### 与原生文件的差异
```
cmp -l wrapper-patched.node wrapper-native-3.2.35.node
  → 差异字节数: 20（就是 build ID 那 20 字节）
  → 文件大小不变: 147,183,032
```

### QQ 仍是原版
```
dpkg 版本:        3.2.35-54395（未变）
package.json:     3.2.35-54395（未变）
wrapper.node 大小: 147,183,032（未变）
QQ 功能:          正常（界面、联网、59 线程）
```

---

## 三、完整补丁工具

```python
#!/usr/bin/env python3
# patch-wrapper-bid.py
# 用法：
#   读取 payload 支持的 build ID:
#     python3 patch-wrapper-bid.py --show-supported <payload.so>
#   用 payload 的值补丁 wrapper.node:
#     python3 patch-wrapper-bid.py --from-payload <payload.so> \
#         --in <wrapper.node> --out <wrapper-patched.node>
#   或显式指定:
#     python3 patch-wrapper-bid.py --set <hex40> --in ... --out ...
```

原理：找 `GNU\0` note（`namesz=4 descsz=20 type=3`）后的 20 字节，
替换成目标值。payload 里内嵌了 3 个 note，第一个（偏移 0x1d8）是 payload 自己的，
后两个（0x443fe / 0x44fe0）是它**支持的 wrapper.node build ID**。

---

## 四、应用步骤

```bash
# 1. 确定 payload 支持的 build ID
python3 patch-wrapper-bid.py --show-supported /app/runtime/native/snowluma-linux-arm64.so
#   → 88ef895d...（payload 自己的）
#   → 89c36b52...（它支持的 wrapper.node）★ 用这个

# 2. 备份并补丁 wrapper.node
cp /opt/QQ/resources/app/wrapper.node /opt/QQ/resources/app/wrapper.node.orig
python3 patch-wrapper-bid.py --set 89c36b520f97c88081a9453bd6abb70c3452f156 \
    --in /opt/QQ/resources/app/wrapper.node.orig \
    --out /opt/QQ/resources/app/wrapper.node

# 3. 重启（注意：只重启 snowluma runtime，**不要重启容器**）
supervisorctl restart snowluma

# 4. 验证
grep "reporting is available" /app/data/logs/*.log | tail -1
```

---

## 五、优势与局限

### ✅ 优势
| 项 | 说明 |
|---|---|
| **改动极小** | 只改 20 字节，其余 147MB 全不动 |
| **可逆** | 备份原文件即可完全回滚 |
| **不碰 payload** | 无需逆向/修改 Haizakura 的二进制 |
| **通用** | 工具支持任意版本（只要 payload 支持某个 ID） |
| **绕过监测** | 仍然不改代码逻辑，只改 ELF note 元数据 |
| **已验证** | 4/4 成功，A/B/A/B 因果确立 |

### ⚠️ 局限
| 项 | 说明 |
|---|---|
| **依赖 payload 的 ID 表** | 只能用 payload **已经支持**的 build ID。若 payload 只支持 3.2.32，那 3.2.33+ 的 QQ 都要改成 3.2.32 的 ID |
| **跨度过大的风险未测** | 3.2.32 与 3.2.35 的 `MSFService` 结构相近，所以能工作。若跨度更大（如 3.1.x → 3.3.x），RTTI 结构可能真的不兼容 |
| **QQ 自身行为未验证** | 只验证了 hook 成功，未验证 QQ 全部功能（尤其新版本特性） |
| **升级会失效** | QQ 升级会覆盖 wrapper.node，需重新应用 |

---

## 六、为什么 build ID 是唯一的判据

**证据链**：
1. payload 内嵌 `89c36b52...`（3.2.32 的 wrapper.node build ID）—— 已确认
2. 把 payload 里的 ID 改成 3.2.35 的值 → **仍然失败**
   - 说明 payload **不只是比对**，而是用这个 ID 作为「我知道怎么解析这个版本」的凭据
   - 改 payload 的 ID 等于告诉它「这是 3.2.35」，但它的解析逻辑仍是 3.2.32 的 → 失败
3. 反方向：把 **wrapper.node** 的 ID 改成 3.2.32 的值 → **成功**
   - 等于让 payload 认为「这就是我认识的 3.2.32」→ 它用 3.2.32 的解析逻辑
   - 而 3.2.32 的解析逻辑对 3.2.35 的 `MSFService` 结构**恰好仍然适用**

**结论**：build ID 是 payload 选择「用哪套解析逻辑」的开关。
因为 3.2.32→3.2.35 的 MSF 结构没有实质变化（`nt::` 符号移除 0 个，
RTTI 差异只是 `wifiphoto` 迁移），所以 3.2.32 的逻辑能用在 3.2.35 上。

---

## 七、待验证

- [ ] 3.2.33 / 3.2.34 是否同样适用（理论上是）
- [ ] QQ 长时间运行稳定性（>24h）
- [ ] 实际收发消息功能（需登录）
- [ ] QQ 新版特性是否正常（如 wifiphoto 相关）

---

## 八、跨版本验证（全部通过）

| QQ 版本 | 原 build ID | 补丁后 | available | 结果 |
|---|---|---|---|---|
| 3.2.33-52892 | `ed36ba59feca2eb9dddb4650c9b22792a3efee55` | `89c36b52...` | 1 | ✅ |
| 3.2.34-53644 | `c2448b3ff94a50f0a92c84be567cd11de3c0c771` | `89c36b52...` | 1 | ✅ |
| 3.2.35-54395 | `aa5304f33095d52f1baa013e21468bfc00fa1d83` | `89c36b52...` | 1 | ✅ |

**三个版本、每个都清空状态重测 —— 全部从 ❌ 变成 ✅。**

关键观察：**这三个版本的 wrapper.node build ID 各不相同**，说明腾讯每个版本都重新构建。
但只要改成 payload 认识的那个值，RTTI 解析就能走通 —— 印证了「MSF 结构在这些版本间保持兼容」。

---

## 九、一键补丁脚本（可直接用）

```bash
#!/bin/bash
# fix-haizakura-qq-compat.sh
# 让 Haizakura 支持新版 QQ（20 字节补丁）
set -e

PAYLOAD=/app/runtime/native/snowluma-linux-arm64.so
WRAPPER=/opt/QQ/resources/app/wrapper.node
BACKUP="$WRAPPER.orig-$(date +%Y%m%d-%H%M%S)"

echo "① 读取 payload 支持的 build ID"
SUPPORTED=$(python3 - <<'PY'
import re
d=open("/app/runtime/native/snowluma-linux-arm64.so","rb").read()
ids=[]
for m in re.finditer(rb'\x04\x00\x00\x00\x14\x00\x00\x00\x03\x00\x00\x00GNU\x00(.{20})', d, re.S):
    ids.append(m.group(1).hex())
# 第 1 个是 payload 自己的，后面的是它支持的 wrapper build ID
print(ids[1] if len(ids)>1 else ids[0])
PY
)
echo "   payload 支持: $SUPPORTED"

echo "② 读取当前 wrapper.node 的 build ID"
CURRENT=$(python3 - <<'PY'
import re
d=open("/opt/QQ/resources/app/wrapper.node","rb").read()
m=re.search(rb'\x04\x00\x00\x00\x14\x00\x00\x00\x03\x00\x00\x00GNU\x00(.{20})', d, re.S)
print(m.group(1).hex() if m else "NONE")
PY
)
echo "   当前:        $CURRENT"

if [ "$CURRENT" = "$SUPPORTED" ]; then
  echo "③ 已是兼容值，无需补丁"
  exit 0
fi

echo "③ 备份 → $BACKUP"
cp "$WRAPPER" "$BACKUP"

echo "④ 补丁（只改 build ID 那 20 字节）"
python3 - "$SUPPORTED" <<'PY'
import re, sys
want=bytes.fromhex(sys.argv[1])
p="/opt/QQ/resources/app/wrapper.node"
d=bytearray(open(p,"rb").read())
n=0
for m in re.finditer(rb'\x04\x00\x00\x00\x14\x00\x00\x00\x03\x00\x00\x00GNU\x00(.{20})', bytes(d), re.S):
    off=m.start(1)
    if bytes(d[off:off+20])!=want:
        d[off:off+20]=want; n+=1
open(p,"wb").write(bytes(d))
print(f"   替换 {n} 处")
PY

echo "⑤ 重启 Haizakura runtime（不重启 QQ）"
supervisorctl restart snowluma

echo "⑥ 等待并验证"
sleep 30
if grep -q "reporting is available" /app/data/logs/*.log 2>/dev/null; then
  echo "   ✅ 成功！"
  grep "reporting is available" /app/data/logs/*.log | tail -1
else
  echo "   ❌ 未成功，检查日志"
  grep -E "reporting|pipe" /app/data/logs/*.log | tail -5
fi
```

**回滚**：`cp <backup> /opt/QQ/resources/app/wrapper.node && supervisorctl restart snowluma`
