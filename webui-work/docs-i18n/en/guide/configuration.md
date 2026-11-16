# Configuration reference


OneBot instance configuration and the runtime configuration file structure

Haizakura configuration is split into two parts, both JSON:

- `config/onebot.json` + `config/onebot_.json` — OneBot network adapters (HTTP / WebSocket listeners, reverse WS, HTTP reporting).

- `config/runtime.json` — process-level Haizakura runtime settings (WebUI port, auto-injection toggle).

The first run generates both files automatically and normalizes their fields on load.

## OneBot configuration

### File locations

```
config/onebot.json          # global defaults
config/onebot_.json    # per-account overrides
```

- Global configuration: `config/onebot.json`, used as the default for every account.

- Account configuration: `config/onebot_.json`, which overrides the global configuration.

- Auto-generation: when the account configuration is missing or lacks an access token, Haizakura writes a normalized default configuration.

### Default configuration

Adapters are grouped by type under the `networks` object:

```
{
  "networks": {
    "httpServers": [
      {
        "name": "http-default",
        "enabled": true,
        "host": "0.0.0.0",
        "port": 3000,
        "path": "/",
        "accessToken": "自动生成",
        "messageFormat": "array",
        "reportSelfMessage": false
      }
    ],
    "httpClients": [],
    "wsServers": [
      {
        "name": "ws-default",
        "enabled": true,
        "host": "0.0.0.0",
        "port": 3001,
        "path": "/",
        "role": "Universal",
        "accessToken": "自动生成",
        "messageFormat": "array",
        "reportSelfMessage": false
      }
    ],
    "wsClients": []
  },
  "musicSignUrl": ""
}
```

Info

**Migrating from the old format:** earlier versions placed arrays such as `httpServers` / `wsServers` at the top level, with `httpPostEndpoints` used for reporting. When Haizakura detects that structure it automatically migrates to the new `networks` object, renames `httpPostEndpoints` to `httpClients`, and writes the result back to disk. When maintaining configuration by hand, use the new format directly.

### Common fields

All adapters share the following fields (`NetworkBase`):

| Field | Type | Default | Description |
|---|---|---|---|
| `name` | string | required | Unique identifier within its type's array; hot reload addresses adapters by `(kind, name)`. |
| `enabled` | bool | `true` | Set to `false` to keep the configuration without starting the adapter. |
| `accessToken` | string | auto-generated | Authentication token; OneBot Bearer / `?access_token=`. |
| `messageFormat` | string | `array` | `array` or `string`; determines whether the `message` field in events is a segment array or a string. |
| `reportSelfMessage` | bool | `false` | When `true`, this adapter also receives its own messages with `post_type='message_sent'`. |

### `httpServers`

Starts the OneBot HTTP API server.

| Field | Type | Default | Description |
|---|---|---|---|
| `host` | string | `0.0.0.0` | Listen address. |
| `port` | number | `3000` | Listen port. |
| `path` | string | `/` | API path prefix. |

### `httpClients`

Actively POSTs events to external endpoints (formerly `httpPostEndpoints`).

| Field | Type | Default | Description |
|---|---|---|---|
| `url` | string | required | Reporting URL. |
| `timeoutMs` | number | `5000` | Request timeout. |

### `wsServers`

Starts the OneBot WebSocket server.

| Field | Type | Default | Description |
|---|---|---|---|
| `host` | string | `0.0.0.0` | Listen address. |
| `port` | number | `3001` | Listen port. |
| `path` | string | `/` | WebSocket path. |
| `role` | string | `Universal` | `Api`, `Event` or `Universal` (upper camel case; the old lowercase spelling is deprecated). |

### `wsClients`

Actively connects to reverse WebSocket servers.

| Field | Type | Default | Description |
|---|---|---|---|
| `url` | string | required | Reverse WebSocket address. |
| `role` | string | `Universal` | Same as `wsServers.role`. |
| `reconnectIntervalMs` | number | `5000` | Reconnect interval; values below the minimum are normalized to `1000`. |

### `musicSignUrl`

Optional; a custom music card signing service address. An empty string disables it.

## Runtime configuration (`runtime.json`)

`config/runtime.json` holds Haizakura process-level settings and is **not per-account**.

```
{
  "webuiPort": 5099,
  "hookAutoLoad": false
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `webuiPort` | number | `5099` | WebUI listen port; values outside `1-65535` fall back to the default. |
| `hookAutoLoad` | bool | `false` | Whether to inject the Hook into newly discovered QQ processes automatically. Enabled by default in the Docker image. |

## Environment variables

| Variable | Description |
|---|---|
| `SNOWLUMA_HOOK_AUTOLOAD` | `1` / `true` forces auto-injection on; `0` / `false` turns it off. Takes precedence over `runtime.json`, which makes it convenient for Docker overrides. |
| `SNOWLUMA_LOG_LEVEL` | Sets the log level (`error` / `warn` / `info` / `debug`). |
| `SNOWLUMA_VERBOSE_WARMUP=1` | Emits more detailed warm-up logs for friends, groups and group members. |
| `SNOWLUMA_DEV_MODE=1` | Enables development mode (relaxed WebUI authentication for local debugging). |
| `SNOWLUMA_DEV_WEBUI=1` | Forces the built-in WebUI on while in dev mode. |

## Port conflicts

If `3000` / `3001` / `5099` are already in use, change `port` / `webuiPort` in the corresponding configuration file and restart Haizakura. Docker users can also map host ports to different ports directly (see Docker deployment).

Was this page helpful?

Yes / No · Last updated

Connecting a bot

Connect Haizakura's OneBot HTTP / WebSocket to MaiBot, AstrBot or NoneBot

Troubleshooting

Common failures with QR codes, passwords, ports, injection and image pulls
