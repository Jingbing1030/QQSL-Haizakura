# Haizakura — 仓库结构

> 版本 0.2.5.0 ・ Linux arm64 / x64 ・ Docker

## 这是什么

Haizakura 是 SnowLuma 的开源重写。它寄生在官方 QQ 客户端的 MSF 会话上，
通过 VTable 钩子注入，对外提供 OneBot v11 / Satori 接口。

```
官方 QQ (已登录)
      ↓ VTable 钩子注入
   Haizakura 运行时 (Node.js)
      ↓
   OneBot v11 / Satori / WebUI
```

## 目录结构

| 路径 | 内容 | 语言 |
| --- | --- | --- |
| `native/hook-src/` | **本项目的核心**：钩子注入器、payload、Node 侧策略层 | C++ / TypeScript |
| `native/hook-src/ts/` | 策略层 —— 协议编解码、Bridge API、OneBot 动作、Satori 适配器 | TypeScript |
| `native/hook-src/src/` | 机制层 —— VTable 钩子、手动加载器、槽位中继、payload | C++ |
| `native/hook-dist/` | 预编译的钩子二进制（x64 + arm64） | 二进制 |
| `restored/` | **参考实现的可读还原源码**（SnowLuma 2.4.2 逆向） | TypeScript |
| `restored/packages/core/src/` | 参考实现的 core 包：bridge / notifications / webui / update | TypeScript |
| `restored/client-frontend/` | 参考实现的 WebUI 前端（生产构建产物） | JS / CSS |
| `restored/dist/index.mjs` | 参考实现的完整 bundle（374,166 行） | JS |
| `docs/` | 协议规范、架构说明、部署指南 | Markdown |
| `docs-internals/` | 逆向分析报告（RTTI、内部结构、还原记录） | Markdown |
| `webui-work/` | WebUI 国际化文案与样式工作区 | Markdown / JS |
| `archive/` | SnowLuma 核心源码归档 | 压缩包 |

## 为什么 `restored/` 在仓库里

`restored/` 是**参考实现的反编译还原源码**。把它入库有三个理由：

1. **可审计**：对照移植是否忠实，不用去啃 374K 行的单文件 bundle。
2. **可测试**：大量字节级对照测试直接 `import` 它作为黄金参照
   （`ts/test/helpers/actions-oracle.ts` 等）。
3. **可追溯**：每个协议字段的编号、每条错误文案的出处，都能指到行。

`restored/dist/index.mjs` 与 `native/hook-src/reference/index.mjs` 是同一份
bundle 的两个入口（后者是指向前者的符号链接），避免重复存储 13 MB。

## 分层约束

```
onebot/  ──→  host/  ──→  bridge/  ──→  oidb/  ──→  highway/
   ↑            ↑           ↑
  动作层      运行时       策略层      协议编解码    传输层
```

**依赖只能向下**。`bridge/` 不允许 `import host/`（那会倒置分层）；
需要共享的纯函数放 `oidb/`，两个层都已依赖它。

## 构建

```bash
# C++ 机制层
cd native/hook-src && cmake -B build && make -j2 payload

# TypeScript 策略层
cd native/hook-src/ts && npm install && npm run build

# 测试
cd native/hook-src/ts && node --test "build/test/*.test.js"
```

## 凭据

本仓库**不含任何凭据**。运行期配置（`config/*.json`，含 WebUI 密码哈希与盐）
被 `.gitignore` 排除，只提交 `config/*.example.json` 脱敏模板。

环境变量同时接受 `HAIZAKURA_*` 和 `SNOWLUMA_*` 两种前缀（新名优先），
所以已有的 SnowLuma 部署不需要改配置。
