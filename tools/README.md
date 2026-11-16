# 工具与逆向产物

## 补丁工具（可直接用）

| 文件 | 用途 |
|---|---|
| `hz-fix-compat` | **一键修复新版 QQ 兼容性**。读 payload 支持的 build ID，改写 `wrapper.node` 的对应 20 字节，备份原文件，只重启 runtime 不动 QQ 进程。 |
| `patch-wrapper-bid.py` | 上面那个脚本的核心逻辑，可单独调用：`--show-supported` 查 payload 支持的 ID、`--from-payload` 自动补丁、`--set` 显式指定。 |
| `dump-vtable.py` | 从 `wrapper.node` 提取 `MSFService` / `MSFCoreService` 的 VTable 槽位与对应函数名。 |

## 分析脚本（`analysis/`）

早前逆向 `wrapper.node` 时写的一次性脚本，留档供复现：

| 脚本 | 做什么 |
|---|---|
| `a64dis.py` / `az.py` | AArch64 反汇编辅助 |
| `reloc_rtti.py` | 从重定位表还原 RTTI 结构 |
| `s1_xref.py` ~ `s8_*.py` | 分阶段扫描：节表 → 符号 → vtable → 类型名 → 槽位映射 |
| `t2_vtable.py` / `t4_strings.py` / `t5_final.py` | VTable 导出、字符串提取、最终汇总 |
| `calls.py` / `fde.py` / `analyze.py` | 调用图、FDE 展开、总入口 |

## 结果（`results/`）

| 文件 | 内容 |
|---|---|
| `typeinfo_names.json` | **22,902 个 RTTI 类型名 → 地址**（`wrapper.node` 全表）。适配新 QQ 版本时的核心索引。 |
| `vtable_named.json` | `MSFService` / `MSFCoreService` 的 **VTable 槽位 → 函数名**映射。 |
| `*.log` | 各阶段扫描日志（节表、符号表、槽位）。 |

## 与 QQ 版本的关系

`typeinfo_names.json` 与 `vtable_named.json` 提取自 **QQ 3.2.32-52194** 的 `wrapper.node`
（build ID `89c36b520f97c88081a9453bd6abb70c3452f156`）。

**用途**：若要真正适配新版 QQ（而非用 build-ID 补丁），需要重新提取新版的这两张表并对比，
找出 VTable 槽位偏移的变化。分析方法见 `docs-internals/RTTI-ANALYSIS.md`。
