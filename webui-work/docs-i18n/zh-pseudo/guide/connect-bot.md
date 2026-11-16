# 機械人対接


Haizakura 之 OneBot HTTP / WebSocket、MaiBot、AstrBot、NoneBot 接続

Haizakura 者協議端也、機械人框架非也。機械人工程接続来即可也。

Docker 鏡像中、OneBot 既定 `0.0.0.0` 聴取、同一 Docker 網中他容器接続可能也。非 Docker 安装者既定仍回環也。

鑑権：`Authorization: Bearer ` 或 `?access_token=`。Token 者 WebUI 或 `config/onebot.json` / `onebot_.json` 中在。HTTP 与 WS 各自 token 有可能性有。

## 正向：機械人 Haizakura 接続

**MaiBot** 適合（其 Haizakura / NapCat 適配器者客端也）。

|  |  |
|---|---|
| HTTP API | `http://snowluma:3000/` |
| WebSocket | `ws://snowluma:3001/` |

機械人容器中者服務名 `snowluma` 使用、`127.0.0.1` 使用不可（彼者機械人自身之回環也）。

宿主機上之客端者 `http://127.0.0.1:3000/` 使用（端口既映射時）。

## 反向：Haizakura 機械人接続

**AstrBot**、**NoneBot2** 適合。Haizakura 設定中 `wsClients` 追加（WebUI 中「逆方向 WebSocket」）：

| 框架 | 常見 URL |
|---|---|
| AstrBot | `ws://astrbot:6199/ws` |
| NoneBot2 | `ws://nonebot:8080/onebot/v11/ws` |

経路者相手文档準拠。Haizakura 者接続外出仅担当也。

事件 HTTP POST 者 `httpClients` 使用、同様相手之上報地址記入。

## sidecar 安装

既 MaiBot / AstrBot 之 compose 有場合：

```
./install.sh --mode compose --network maim_bot --yes
```

`maim_bot` 者 `docker network ls` 中実際之網名替換。安装器者相手 yaml **変更無**也。

然後機械人適配器 `snowluma:3001` 指向（正向）、或 Haizakura 中反向 URL 記入。

## 複数帳号

毎 UIN 一份 `onebot_.json`。既定皆 `3000` / `3001` 占有希望、第二帳号者端口変更、或反向 WS 依別機械人入口指向。

完全字段者 設定参照 参照。

此文档有用乎？

有用無用最終更新

Docker 永続資料移行

既存 Docker 資料、現在永続配置安全移行

設定参照

OneBot 実例設定与運行時設定文件結構