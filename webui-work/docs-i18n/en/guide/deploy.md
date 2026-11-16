# Deployment methods


Deployment
Comparison and selection of Haizakura deployment methods

Haizakura runs in many environments, but the core requirements are always the same: it must run QQ, inject a hook into the QQ process, and support QR-code login. Difficulty varies widely between environments; the table below helps you pick a suitable path.

Not sure which to choose? See the decision table in Quick start, or just pick **Docker on Linux**.

## Deployment comparison

| Method | Platform | Difficulty | Recommended | Suitable for |
|---|---|---|---|---|
| Docker | Linux | Low | ✅ Most recommended | Long-term server operation, works out of the box |
| One-click install | Linux | Low | ⚠️ Alpha experimental | Install Docker / sidecar / host mode with one command; still in testing |
| Windows manual | Windows | Medium | Optional | A local Windows machine without Docker |
| Windows · Docker Desktop | Windows | Medium | Optional | Container isolation on Windows |
| WSL2 | Windows + WSL | Medium | Optional | Run the container in a Linux subsystem on Windows |
| Linux manual | Linux | High | ⚠️ Advanced/unofficial | Understand the Docker image internals, or when Docker is unavailable |
| Phone | Android | Very high | ⚠️ Advanced/experimental | You only have an Android phone; tight resources and possibly restricted injection |
| aaPanel | Linux | Low | Community option | aaPanel already installed; one-click import from the Docker app store |

Tip

**On Linux, Docker is the most recommended and least effort approach** — the image bundles QQ + Xvfb + VNC + noVNC + supervisord, so the host only needs Docker.

Warning

**Linux manual** and **phone** deployments are advanced / unofficial paths: many steps, many pitfalls, and injection may be unavailable in restricted environments such as proot. Unless you know exactly what you are doing, prefer Docker.

## Upgrading

Upgrade procedures differ by deployment path, and all of them assume **login state and configuration are preserved**. See Updating for the details.

## After deployment

- Configuration reference — adapters, ports and access tokens.

- MCP access / SDK — connect an AI client or write code.

Was this page helpful?

Yes / No · Last updated

Quick start

Find out which deployment path to take and complete the most common Docker setup on a single page

Docker deployment

Run Haizakura on Linux with the official Docker image
