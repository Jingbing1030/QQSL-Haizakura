# Haizakura<picture><img align="right" src="./assets/readme/mascot.png" width="34%" alt="" /></picture>


**Connect your applications to native QQ sessions.**

A TypeScript interop runtime for the QQ desktop client.<br>
OneBot v11 · WebUI · SDK · MCP

<p>
  <a href="https://github.com/Haizakura/Haizakura/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/Haizakura/Haizakura?label=release&style=flat-square"></a>
  <a href="https://github.com/Haizakura/Haizakura/actions/workflows/dev-build.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/Haizakura/Haizakura/dev-build.yml?branch=dev&style=flat-square&label=build"></a>
  <a href="https://www.npmjs.com/package/@snowluma/sdk"><img alt="Haizakura SDK version" src="https://img.shields.io/npm/v/%40snowluma%2Fsdk?style=flat-square&label=sdk&color=287fb8"></a>
  <a href="https://www.npmjs.com/package/@snowluma/mcp"><img alt="Haizakura MCP version" src="https://img.shields.io/npm/v/%40snowluma%2Fmcp?style=flat-square&label=mcp&color=7658c7"></a>
  <a href="https://hub.docker.com/r/motricseven7/snowluma"><img alt="Docker pulls" src="https://img.shields.io/docker/pulls/motricseven7/snowluma?style=flat-square&label=docker%20pulls"></a>
  <a href="https://github.com/Haizakura/Haizakura/stargazers"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/Haizakura/Haizakura?style=flat-square"></a>
</p>

Converts native QQ sessions into [OneBot v11](https://github.com/botuniverse/onebot-11) actions and events, and exposes a single entry point through WebSocket, HTTP, WebUI, SDK and MCP.

Multi-account sessions, messages and media, connection configuration and live logs are all managed in one runtime.

**[Download releases](https://github.com/Haizakura/Haizakura/releases)** · **[Quick start](#quick-start)**<br>
[Deployment guide](guide/deploy.md) · [Action reference](protocol/actions.md) · [Report an issue](https://github.com/Haizakura/Haizakura/issues)

<sub>Windows x64 · Linux x64 / arm64</sub>

<br clear="both" />

> [!CAUTION]
> Haizakura is an independent third-party project with no affiliation with or authorization from Tencent / QQ. It is intended for study and technical research only. Please comply with the QQ Terms of Service and applicable law; the software is provided “as is”, and you use it at your own risk.

> **Disclaimer:** Haizakura is independent of Tencent / QQ and is provided for study and research only, “as is” and without warranty.

## Core capabilities

| Scenario | Capability |
| --- | --- |
| OneBot access | OneBot v11 actions and events; WebSocket server / client and HTTP server / reporting |
| Messages and media | Text, images, voice, video, files, replies, mentions, forwards and common cards |
| Multi-account operation | Each account keeps its own sessions, identity mappings, message storage and network configuration |
| WebUI management | Account status, live logs, connection configuration, action debugging and storage management |
| Developer tooling | [`@snowluma/sdk`](dev/sdk.md) and [`@snowluma/mcp`](dev/mcp.md) |

## Runtime path

<p align="center">
  <img src="./assets/readme/runtime-map.svg" width="100%" alt="QQ sessions bridged and normalized through OneBot to WebSocket, HTTP, WebUI, SDK and MCP" />
</p>

Session access, protocol decoding, identity mapping, OneBot conversion and network adaptation keep independent boundaries; multiple QQ accounts can run in parallel.

## Quick start

1. Download the full release package for your platform from [Releases](https://github.com/Haizakura/Haizakura/releases) and extract it. The Lite build requires Node.js 24+.
2. On Windows run `launcher.bat`; on Linux run:

   ```bash
   chmod +x launcher.sh
   ./launcher.sh
   ```

3. Open [`http://localhost:5099`](http://localhost:5099), sign in to the WebUI with the initial password from the startup log, then follow the guide to attach a QQ process and configure an OneBot connection.

Account detection is triggered by login database file changes, process and login events, or manual action; there is no periodic polling. Unloaded QQ processes are also not continuously queried through the Windows Restart Manager; use the refresh/reconnect action on the WebUI process row when you need to recheck.

## Access and documentation

| Entry point | Documentation |
| --- | --- |
| WebSocket / HTTP | [OneBot action reference](protocol/actions.md) |
| Deployment (Docker / Windows) | [Deployment guide](guide/deploy.md) |
| TypeScript SDK | [`dev/sdk.md`](dev/sdk.md) |
| MCP | [`dev/mcp.md`](dev/mcp.md) |

JSON message segments accept the standard `data.data` string, and are also compatible with a non-array `data.data` object and the `{ type: "json", data: "..." }` shorthand; `data` is required, and the final content must be a JSON object.

## Development

Node.js 24+ and pnpm 11.25.0 are required; day-to-day development is based on the `dev` branch:

```bash
git clone https://github.com/Haizakura/Haizakura.git
cd Haizakura
git checkout dev
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the contribution workflow and [`RoadMap.md`](RoadMap.md) for development direction.

## Community and acknowledgements

- [Report an issue](https://github.com/Haizakura/Haizakura/issues)
- [QQ group](https://qm.qq.com/q/g3UMLpWALe)
- [Telegram](https://t.me/napcatqq)

The project references the protocol definitions of [LagrangeV2](https://github.com/LagrangeDev/LagrangeV2) and the implementation approach of [NapCatQQ](https://github.com/NapNeko/NapCatQQ).

<p align="center">
  <a href="https://github.com/Haizakura/Haizakura/graphs/contributors"><img src="https://contrib.rocks/image?repo=Haizakura/Haizakura" alt="Haizakura contributors" /></a>
</p>
