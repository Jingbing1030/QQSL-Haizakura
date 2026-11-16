# 對接機器人


把 Haizakura 的 OneBot HTTP / WebSocket 接到 MaiBot、AstrBot、NoneBot

Haizakura 是協定端，不是機器人框架。機器人行程連過來即可。

Docker 映像裡，OneBot 預設聽 `0.0.0.0`，這樣同一個 Docker 網路裡的其它容器才能連上。非 Docker 安裝預設仍是回送位址。

驗證：`Authorization: Bearer ` 或 `?access_token=`。Token 在 WebUI 或 `config/onebot.json` / `onebot_.json` 裡。HTTP 和 WS 可能各有各的 token。

## 正向：機器人連 Haizakura

適合 **MaiBot**（它的 Haizakura / NapCat 配接器是客戶端）。

|  |  |
|---|---|
| HTTP API | `http://snowluma:3000/` |
| WebSocket | `ws://snowluma:3001/` |

在機器人容器裡用服務名 `snowluma`，不要用 `127.0.0.1`（那是機器人自己的回送位址）。

主機上的用戶端用 `http://127.0.0.1:3000/`（連接埠已對應時）。

## 反向：Haizakura 連機器人

適合 **AstrBot**、**NoneBot2**。在 Haizakura 設定裡加 `wsClients`（WebUI 裡「反向 WebSocket」）：

| 框架 | 常見 URL |
|---|---|
| AstrBot | `ws://astrbot:6199/ws` |
| NoneBot2 | `ws://nonebot:8080/onebot/v11/ws` |

路徑以對方文件為準。Haizakura 只負責連出去。

事件 HTTP POST 用 `httpClients`，同樣填對方的上報位址。

## sidecar 安裝

已經有 MaiBot / AstrBot 的 compose 時：

```
./install.sh --mode compose --network maim_bot --yes
```

把 `maim_bot` 換成 `docker network ls` 裡實際的網路名稱。安裝器**不會改**對方的 yaml。

然後讓機器人配接器指向 `snowluma:3001`（正向）或在 Haizakura 裡填反向 URL。

## 多帳號

每個 UIN 一份 `onebot_.json`。預設都想佔 `3000` / `3001`，第二個帳號要換連接埠，或用反向 WS 指到不同的機器人入口。

完整欄位見設定參考。

這篇文件有幫助嗎？

有幫助 / 沒幫助 · 最後更新於

Docker 持久化資料遷移

將現有 Docker 資料安全遷移到目前持久化佈局

設定參考

OneBot 實例設定與執行環境設定檔結構
