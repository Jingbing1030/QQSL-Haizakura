# 部署方式


部署
Haizakura 各部署方式的对比与选择

Haizakura 可以在多种环境里运行，但核心要求都一样：能跑 QQ、能向 QQ 进程注入 hook、能扫码登录。不同环境的难度差别很大，下面这张表帮你挑一条合适的路。

不知道选哪条？直接看 快速开始 的决策表，或者无脑选 **Docker on Linux**。

## 部署方式对比

| 方式 | 平台 | 难度 | 是否推荐 | 适用场景 |
|---|---|---|---|---|
| Docker | Linux | 低 | ✅ 最推荐 | 服务器长期运行，开箱即用 |
| 一键安装 | Linux | 低 | ⚠️ Alpha 实验 | 一条命令装 Docker / sidecar / 本机，仍在测试 |
| Windows 手动 | Windows | 中 | 可选 | Windows 本机，不想装 Docker |
| Windows · Docker Desktop | Windows | 中 | 可选 | Windows 上想用容器隔离 |
| WSL2 | Windows + WSL | 中 | 可选 | Windows 里用 Linux 子系统跑容器 |
| Linux 手动 | Linux | 高 | ⚠️ 进阶/非官方 | 想理解 Docker 镜像内部，或不能用 Docker |
| 手机 | Android | 很高 | ⚠️ 进阶/实验性 | 只有安卓手机，资源吃紧，注入可能受限 |
| 宝塔面板 | Linux | 低 | 社区方案 | 已装宝塔面板，通过 Docker 应用商店一键导入 |

Tip

**Linux 上 Docker 是最推荐、最省事的方式** —— 镜像把 QQ + Xvfb + VNC + noVNC + supervisord 全打包好了，宿主机只需要 Docker。

Warning

**Linux 手动**和**手机**部署属于进阶 / 非官方路径：步骤多、坑多、注入在受限环境（如 proot）下可能不可用。除非你清楚自己在做什么，否则优先走 Docker。

## 升级

升级方式按部署路径不同而不同，且都以**不丢登录态和配置**为前提。统一见 更新。

## 部署之后

- 配置参考 —— 适配器、端口、access token。

- MCP 接入 / SDK —— 接 AI 客户端或写代码。
这篇文档有帮助吗？

有帮助没帮助最后更新于

快速开始

一页弄清楚该走哪条部署路径，并完成最常见的 Docker 上手

Docker 部署

在 Linux 上用官方 Docker 镜像运行 Haizakura
