# Connecting a bot


Connect Haizakura's OneBot HTTP / WebSocket to MaiBot, AstrBot or NoneBot

Haizakura is a protocol implementation, not a bot framework. The bot process just connects to it.

In the Docker image, OneBot listens on `0.0.0.0` by default so that other containers on the same Docker network can reach it. Non-Docker installations still default to loopback.

Authentication: `Authorization: Bearer ` or `?access_token=`. The token is in the WebUI or in `config/onebot.json` / `onebot_.json`. HTTP and WS may each have their own token.

## Forward: the bot connects to Haizakura

Suited to **MaiBot** (its Haizakura / NapCat adapter is the client).

|  |  |
|---|---|
| HTTP API | `http://snowluma:3000/` |
| WebSocket | `ws://snowluma:3001/` |

Inside the bot container use the service name `snowluma`, not `127.0.0.1` (which is the bot's own loopback).

Clients on the host use `http://127.0.0.1:3000/` (when the port is mapped).

## Reverse: Haizakura connects to the bot

Suited to **AstrBot** and **NoneBot2**. Add `wsClients` to the Haizakura configuration ("Reverse WebSocket" in the WebUI):

| Framework | Typical URL |
|---|---|
| AstrBot | `ws://astrbot:6199/ws` |
| NoneBot2 | `ws://nonebot:8080/onebot/v11/ws` |

The exact paths follow the other side's documentation; Haizakura only dials out.

For event HTTP POST use `httpClients`, again with the other side's reporting URL.

## Sidecar installation

If you already have a MaiBot / AstrBot compose file:

```
./install.sh --mode compose --network maim_bot --yes
```

Replace `maim_bot` with the actual network name from `docker network ls`. The installer **does not modify** the other side's YAML.

Then point the bot adapter at `snowluma:3001` (forward), or fill in the reverse URL inside Haizakura.

## Multiple accounts

One `onebot_.json` per UIN. By default they all want `3000` / `3001`, so a second account needs different ports, or a reverse WS pointing at a different bot entry point.

See the configuration reference for all fields.

Was this page helpful?

Yes / No · Last updated

Docker persistent data migration

Safely migrate existing Docker data to the current persistence layout

Configuration reference

OneBot instance configuration and the runtime configuration file structure
