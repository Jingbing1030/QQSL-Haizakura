# 逆向脚本

纯 objdump 输出 + 手写 x86-64 模拟器，无 gdb/radare2/Ghidra。

## 复验

```
python3 dec5.py      # 7 个混淆字符串，应输出 ALL PASS
```

`dec5.py` 是**修好之后**的版本。之前的通用解码脚本有两个 bug（见
`docs/reverse-socket-protocol.md` §5.2）：

1. `std::string` 的 `_M_p` 是 8 字节指针，当成 1 字节写 → 解出全 `\x00`
2. 嵌套 `call` 的 end 是 `起始+长度`，误传成长度 → 只解出前 8 字符

结论本身没受影响（那些是手工核对过的），但脚本错误会让复验失败。

## 文件

| 文件 | 用途 |
|---|---|
| `dec5.py` | 字符串解码器，带 7 条断言 |
| `alldec.py` / `dec2.py`–`dec4.py` | 迭代过程中的版本 |
| `calls.py` | 调用图提取 |
| `deob.py` | 反混淆 |
| `dis.txt` / `dis_raw.txt` / `funcs.txt` / `str.txt` | 反汇编留档（复用，未重新生成） |

脚本只读 `/home/ubuntu/x64run/native/snowluma-linux-x64.so`，未加载、未执行、未改动。
