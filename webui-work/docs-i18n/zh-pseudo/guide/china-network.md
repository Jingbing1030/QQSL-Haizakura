# 国内網絡


Docker Hub、GitHub、QQ 安装包、大陸網絡下如何経由

安装器既「跳」処理失敗也：何区間不通者、其区間報告、且次之歩提示。汝亦手動同一之事可能也。

## Docker 鏡像

公式鏡像：`motricseven7/snowluma`。

Hub 超時或限流時、前綴取得然後打標：

```
docker pull docker.1ms.run/motricseven7/snowluma:latest
docker tag docker.1ms.run/motricseven7/snowluma:latest motricseven7/snowluma:latest
```

`docker.xuanyuan.me/`、`docker.m.daocloud.io/` 亦試行可也。此等公共前綴者変化有、唯一来源固定不可也。

雲廠商機器者控制台之鏡像加速優先。**1Panel / 宝塔**者面板中設定、脚本 `daemon.json` 改不可也。

## Docker Engine 安装

来路不明之 Gitee 一鍵脚本使用不可也。

- Ubuntu/Debian：阿里雲 / 清華 `docker-ce` 源

- 安装器者此等源経由；失敗者 `get.docker.com --mirror Aliyun` 再試

- OpenCloudOS / openEuler 者倉庫自帯之超古 docker 使用不可也

## 安装器脚本

一命令中 `raw.githubusercontent.com` 開不可時：

```
curl -fsSL https://ghfast.top/https://raw.githubusercontent.com/Haizakura/Haizakura.Docker.Framework/main/install.sh | bash
```

模板文件者更 jsDelivr / ghfast 経由。来路不明之 Gitee 一鍵脚本代替不可也。

## GitHub Release（lite 包、host 模式）

`github.com` / `objects.githubusercontent.com` 甚遅可能性有。host 模式安装器者 ghfast、gh-proxy、GitHub 直結順次試、下載後哈希検証可能者検証。

GitHub 加速前綴、Docker 之 `registry-mirrors` 中記入不可也。

## Linux QQ 安装包

騰訊 CDN `qqdl.gtimg.cn` 経由、国内通常直結可能。Docker 鏡像建構亦官網現在文件名 + 固定備份地址使用、`latest` 追随無也。

此文档有用乎？

有用無用最終更新

排障

扫码、密碼、端口、注入、鏡像取得之常見失敗

開発者文档

Monorepo 結構、核心起動経路与貢献注意事項