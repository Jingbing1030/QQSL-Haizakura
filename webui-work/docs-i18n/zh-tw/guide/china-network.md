# 國內網路


Docker Hub、GitHub、QQ 安裝包在中國大陸網路下怎麼走

安裝器已經按「跳」處理失敗：哪一段不通，就說哪一段，並給出下一步。你也可以手動做同樣的事。

## Docker 映像

官方映像：`motricseven7/snowluma`。

Hub 逾時或限流時，加前綴拉取後再打標：

```
docker pull docker.1ms.run/motricseven7/snowluma:latest
docker tag docker.1ms.run/motricseven7/snowluma:latest motricseven7/snowluma:latest
```

也可試 `docker.xuanyuan.me/`、`docker.m.daocloud.io/`。這些公共前綴會變，不要寫死成唯一來源。

雲廠商機器優先使用主控台裡的映像加速。**1Panel / 寶塔**在面板裡設定，不要讓腳本改 `daemon.json`。

## 安裝 Docker Engine

不要用來路不明的 Gitee 一鍵腳本。

- Ubuntu/Debian：阿里雲 / 清華的 `docker-ce` 來源

- 安裝器會走這些來源；失敗再試 `get.docker.com --mirror Aliyun`

- OpenCloudOS / openEuler 不要用倉庫裡自帶的超舊 docker

## 安裝器腳本

一條指令裡的 `raw.githubusercontent.com` 打不開時：

```
curl -fsSL https://ghfast.top/https://raw.githubusercontent.com/Haizakura/Haizakura.Docker.Framework/main/install.sh | bash
```

範本檔案會再走 jsDelivr / ghfast。不要換成來路不明的 Gitee 一鍵腳本。

## GitHub Release（lite 套件、host 模式）

`github.com` / `objects.githubusercontent.com` 可能很慢。host 模式安裝器會依序試 ghfast、gh-proxy、GitHub 直連，下載後能校驗雜湊就校驗。

不要把 GitHub 加速前綴寫進 Docker 的 `registry-mirrors`。

## Linux QQ 安裝包

走騰訊 CDN `qqdl.gtimg.cn`，中國大陸一般可直連。Docker 映像建置也是官網目前檔名 + 釘死的備份位址，不跟 `latest`。

這篇文件有幫助嗎？

有幫助 / 沒幫助 · 最後更新於

排障

掃碼、密碼、連接埠、注入、映像拉取的常見失敗

開發者文件

Monorepo 結構、核心啟動鏈路與貢獻注意事項
