# 国内网络


Docker Hub、GitHub、QQ 安装包在大陆网络下怎么走

安装器已经按「跳」处理失败：哪一段不通，就说哪一段，并给出下一步。你也可以手动做同样的事。

## Docker 镜像

官方镜像：`motricseven7/snowluma`。

Hub 超时或限流时，前缀拉取再打标：

```
docker pull docker.1ms.run/motricseven7/snowluma:latest
docker tag docker.1ms.run/motricseven7/snowluma:latest motricseven7/snowluma:latest
```

也可试 `docker.xuanyuan.me/`、`docker.m.daocloud.io/`。这些公共前缀会变，不要写死成唯一来源。

云厂商机器优先用控制台里的镜像加速。**1Panel / 宝塔**在面板里配，不要让脚本改 `daemon.json`。

## 安装 Docker Engine

不要用来路不明的 Gitee 一键脚本。

- Ubuntu/Debian：阿里云 / 清华的 `docker-ce` 源

- 安装器会走这些源；失败再试 `get.docker.com --mirror Aliyun`

- OpenCloudOS / openEuler 不要用仓库里自带的超老 docker

## 安装器脚本

一条命令里的 `raw.githubusercontent.com` 打不开时：

```
curl -fsSL https://ghfast.top/https://raw.githubusercontent.com/Haizakura/Haizakura.Docker.Framework/main/install.sh | bash
```

模板文件会再走 jsDelivr / ghfast。不要换成来路不明的 Gitee 一键脚本。

## GitHub Release（lite 包、host 模式）

`github.com` / `objects.githubusercontent.com` 可能很慢。host 模式安装器会依次试 ghfast、gh-proxy、GitHub 直连，下载后能校验哈希就校验。

不要把 GitHub 加速前缀写进 Docker 的 `registry-mirrors`。

## Linux QQ 安装包

走腾讯 CDN `qqdl.gtimg.cn`，国内一般可直连。Docker 镜像构建也是官网当前文件名 + 钉死的备份地址，不跟 `latest`。

这篇文档有帮助吗？

有帮助没帮助最后更新于

排障

扫码、密码、端口、注入、镜像拉取的常见失败

开发者文档

Monorepo 结构、核心启动链路与贡献注意事项
