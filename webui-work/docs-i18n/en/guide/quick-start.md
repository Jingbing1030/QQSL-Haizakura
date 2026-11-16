# Quick start


Find out which deployment path to take and complete the most common Docker setup on a single page

The first step is not installing anything, but **deciding which path to take**. Haizakura works by injecting a hook into a real QQ process, so you need an environment that can run QQ, perform the injection, and complete a QR-code login. The table below recommends a path directly from the environment you have — just follow the link.

## Which path should I take?

| Your situation | Recommended path | Link |
|---|---|---|
| You have a Linux server | Docker (most recommended, least effort) | Docker deployment |
| A local Windows machine | Windows manual / Docker Desktop | Windows deployment |
| You want WSL2 | Run the container inside WSL2 | WSL2 deployment |
| You only have an Android phone | Termux + proot (advanced/experimental) | Phone deployment |
| A Linux server with aaPanel installed | One-click import from the panel's Docker app store | aaPanel deployment |
| You want to connect an AI client | MCP server | MCP access |
| You want to write client code | TypeScript SDK | SDK |

If you are unsure, choose **Docker on Linux** — the officially recommended and easiest way to get running. For the full comparison, see Choosing a deployment method.

## Fastest setup (Docker)

On Linux the official recommendation is to run the official image yourself. Three steps:

**1. Start the container**

```
docker run -d \
  --name snowluma \
  --restart unless-stopped \
  --shm-size=1g \
  --cap-add=SYS_PTRACE \
  --security-opt seccomp=unconfined \
  -p 6081:6081 -p 5099:5099 -p 3000:3000 -p 3001:3001 \
  -v qq-gateway-data:/app/data \
  -v qq-client-config:/app/.config \
  -v qq-client-data:/app/.local/share \
  motricseven7/snowluma:latest
```

Danger

`--cap-add=SYS_PTRACE` and `--security-opt seccomp=unconfined` are **mandatory**: the default seccomp profile blocks the injection, and QQ (Chromium) also needs `--shm-size=1g`. The remote desktop password is generated randomly on first start and printed only once in the log.

**2. QR-code login**

Open `http://:6081/` (noVNC) in a browser. The password is:

```
docker logs snowluma 2>&1 | grep -E "远程桌面密码:|remote desktop password:" | tail -n 1
```

QQ starts automatically inside the remote desktop; scan the code with QQ on your phone.

**3. Open the WebUI**

Open `http://:5099/` in a browser. For the full Compose setup and multiple accounts, see Docker deployment.

## Experimental: one-click install script (Alpha)

Warning

**Not the primary recommendation.** It is in Alpha testing, so commands and default behavior may change. If you can run Docker, prefer the previous section. If you are willing to help shake out bugs, try:

```
curl -fsSL https://raw.githubusercontent.com/Haizakura/Haizakura.Docker.Framework/main/install.sh | bash
```

```
curl -fsSL https://raw.githubusercontent.com/Haizakura/Haizakura.Docker.Framework/main/install.sh | bash -s -- --mode docker --yes
```

The interactive prompt asks for a mode; with `--yes` and no `--mode`, it defaults to docker. For details, sidecars and host mode, see One-click install (experimental).

## Login and first access

Whichever path you take, the first run always comes down to these steps:

- QR-code login: Haizakura supports QR-code login only; there is no CLI login. In a headless environment you must see the QQ window through VNC / noVNC to scan the code.

- Finding the temporary WebUI password: on the first start with a brand-new data directory, a one-time administrator password is printed to the log. For Docker:

```
docker logs snowluma 2>&1 | grep -E "临时密码|initial credentials" | tail -n 1
```

InfoThe temporary password is printed once, only on the first start with a brand-new data directory; restarts or reusing existing data do not regenerate it.

- Opening ports: for external access, allow the WebUI port (`5099`) and whichever OneBot ports you use (`3000` / `3001`).

Warning

**Do not** expose the noVNC / WebUI / OneBot ports directly to the public internet. The remote desktop has no fixed default password; read it from the container log.

## Passwordless login (URL token)

Tired of typing your password every time? The WebUI supports putting the **login password** in the address to go straight in:

```
http://:5099/?token=
```

- The parameter name is `token`, and its value is the password you normally use to sign in to the WebUI. Haizakura uses it against the login endpoint; a correct password takes you straight to the home page.

- Cleared after use: the password is removed from the address bar immediately after it is read (`history.replaceState`), so it cannot leak through browser history / access logs / the Referer header.

- The server still validates as usual; a wrong password only sends you back to the login page. There is no bypass.

Warning

A password in a URL carries **considerable risk** (it enters browser history and may be recorded by intermediaries or proxies). Use it only in a trusted local or intranet environment; do not share links containing the password, do not paste them into chats or issues, and do not use it on public devices.

## Next steps

- Choosing a deployment method — detailed comparison of each path.

- Configuration reference — change ports, access token and adapters.

- Updating — upgrade without losing your login state.

Was this page helpful?

Yes / No · Last updated

Introduction

What Haizakura is, what it can do, and its three usage modes and release layout

Deployment

Comparison and selection of Haizakura deployment methods
