# Introduction


What Haizakura is, what it can do, and its three usage modes and release layout

Haizakura is a **remote protocol framework** for NTQQ (the QQ desktop client). It bridges QQ into the OneBot v11 ecosystem: a native addon injects a hook into the running QQ process (process name `qq` on Linux, `QQ.exe` on Windows) at ptrace level, decodes its internal packets, and exposes them in OneBot v11 form over HTTP / WebSocket / reverse WS / HTTP reporting.

Around that core, Haizakura also provides:

- OneBot v11 adapters — HTTP API server, WebSocket server, reverse WebSocket and HTTP event reporting, in any combination.

- NTQQ bridging — talks to a real QQ client directly; no protocol implementation, no separate login.

- Multi-account — one OneBot instance per UIN, detected and attached automatically, with no manual configuration.

- Built-in WebUI — manage accounts, configuration and status in a browser.

- TypeScript SDK — `@snowluma/sdk` for writing fully typed OneBot clients.

- MCP server — `@snowluma/mcp`, letting MCP-capable AI clients query and invoke OneBot actions.

## Three usage modes

| Your goal | Mode | Entry point |
|---|---|---|
| Run a bot on a server long-term | Docker (recommended) | Docker deployment |
| Let an AI client call QQ | MCP | MCP access |
| Try it quickly on your own machine | Prebuilt tarball | Choosing a deployment method |

For client code, see the TypeScript SDK.

## Release layout

Each platform publishes two tarballs on GitHub Releases:

| Package | Bundles Node.js | Suitable for |
|---|---|---|
| `Haizakura---.tar.gz` (full) | Bundled Node.js runtime | Machines without Node; works out of the box |
| `Haizakura----lite.tar.gz` (lite) | No Node.js bundle (much smaller) | Machines with Node.js ≥ 22 already installed (Node 24 LTS recommended) |

Published platforms / architectures: `linux-x64`, `linux-arm64`, `win-x64`.

Info

Haizakura requires **Node.js ≥ 22**. In 2026, **Node 24 ("Krypton") is the Active LTS**, while 22 ("Jod") has moved to Maintenance LTS, so the lite package recommends **Node 24 LTS** (22 still works). The full package ships its own runtime and needs no installation. Source: nodejs.org.

Approximate structure of the unpacked `dist/`:

```
dist/
├── index.mjs          # entry point: node ./index.mjs
├── launcher.bat       # Windows launcher script (node ./index.mjs + pause)
├── webui/             # built-in WebUI static assets
└── native/            # native addon + websocket native module
    ├── snowluma-win32-x64.{node,dll}
    ├── snowluma-linux-x64.{node,so}
    ├── snowluma-linux-arm64.{node,so}
    └── websocket--.node
```

To run: unpack and execute `node ./index.mjs`; on Windows you can also double-click `launcher.bat`.

## Default services

| Service | Default listen | Description |
|---|---|---|
| OneBot HTTP | `0.0.0.0:3000` | OneBot v11 HTTP API |
| OneBot WS | `0.0.0.0:3001` | OneBot v11 WebSocket |
| WebUI | `0.0.0.0:5099` | Built-in management interface |
| VNC | `5900` | Docker internal only: native remote desktop. The official template does not publish it |
| noVNC | `6081` | Docker only: browser remote desktop for QR-code login |

Ports, listen addresses and similar settings are configurable; see the configuration reference.

Warning

**Do not** expose the noVNC / WebUI / OneBot ports directly to the public internet. The Docker remote desktop has **no** fixed default password: one is generated randomly on first start and printed once in the container log.

## Project status

Warning

Haizakura is still in **early development**; interfaces, configuration structure and release layout may change between versions. For production, pin a specific version tag and read the release notes before upgrading.

## Next steps

- Quick start — not sure where to begin? Start here.

- Choosing a deployment method — compare all deployment paths and pick the one that fits you.

Was this page helpful?

Yes / No · Last updated

Quick start

Find out which deployment path to take and complete the most common Docker setup on a single page
