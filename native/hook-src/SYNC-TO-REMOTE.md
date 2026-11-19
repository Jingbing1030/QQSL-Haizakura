# 怎么把这些推到 GitHub

本机没有 GitHub 写凭据（`git@github.com` 报 `Permission denied (publickey)`，
HTTPS 没有 token），而 oracle 从 14:33 起 SSH 不通，之前那 10 个 commit 都是经
oracle 推的。所以下面这套步骤是把"能离线准备好的都准备好"，等网络恢复一条命令收尾。

远程当前状态（可读，已验证）：

```
HEAD = ca216e38d31b24d7400d0783c617d59f4932cb5e   (main)
native/hook-src/  35 个文件   ← T1–T6 阶段
native/hook-dist/haizakura-hook-linux-{x64,arm64}.node
restored/packages/**            ← 还原的 TS 源码
```

本机相对于远程 `native/hook-src/`：

| 类别 | 数量 |
| --- | --- |
| 远程有、本地无（覆盖会丢） | **0** |
| 两边都有（本地更新） | 35 |
| 本地有、远程无（新增） | 21 |

`test/payload.cc` 15,300 → 35,329 B，`src/addon.cc` 46,737 → 49,770 B，
`CMakeLists.txt` 7,404 → 10,408 B —— 都是本地更新，没有倒退。

## 推送方式

本机 `~/hook-rewrite` 已经是完整 git 仓库，含一个提交 `a04307a`，
56 个文件，无构建产物。布局与远程 `native/hook-src/` 一致，
所以只差把它挂到那个子目录下：

```bash
cd /home/ubuntu/hook-rewrite
git remote add origin https://github.com/Jingbing1030/QQSL-Haizakura.git
git fetch --depth 1 origin main          # 只取一层，875 个文件全取会很慢
git switch -c sync-r5 --track origin/main
git read-tree --prefix=native/hook-src/ -u HEAD   # 把提交树放进去
git commit -m "native/hook-src: T7-T14 (vtable hooking, payload, full-stack)"
git push origin sync-r5                  # 需要凭据
```

或者等 oracle 恢复后，走原来那条路（oracle 上有 key）：

```bash
tar czf /tmp/sync.tgz -C /home/ubuntu/hook-rewrite .
# 上传到 oracle，解到 ~/qqsl-hz/native/hook-src/，再 commit + push
```

## 推送前应重新跑的验证

```bash
cd /home/ubuntu/hook-rewrite/buildx && ctest            # 4/4
cd .. && node test/api_parity.mjs \
  ~/x64run/native/snowluma-linux-x64.node \
  buildx/haizakura-hook-linux-x64.node                  # IDENTICAL 5/5
sh test/run_full_stack.sh                               # 双周期 PASS
cd buildx-arm && make                                   # arm64 零警告
```

四样在写这份文档时都是通过的。
