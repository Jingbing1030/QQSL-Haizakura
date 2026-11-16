# Networks in mainland China


Working with Docker Hub, GitHub and the QQ installer behind the mainland China network

The installer already handles failures hop by hop: it tells you which leg is unreachable and what to do next. You can also do the same manually.

## Docker images

Official image: `motricseven7/snowluma`.

When the Hub times out or rate-limits you, pull through a prefix and retag:

```
docker pull docker.1ms.run/motricseven7/snowluma:latest
docker tag docker.1ms.run/motricseven7/snowluma:latest motricseven7/snowluma:latest
```

You can also try `docker.xuanyuan.me/` and `docker.m.daocloud.io/`. These public prefixes change, so do not hard-code one as the only source.

On cloud provider machines, prefer the image accelerator configured in the console. For **1Panel / aaPanel**, configure it in the panel; do not let a script modify `daemon.json`.

## Installing Docker Engine

Do not use one-click scripts from unknown Gitee repositories.

- Ubuntu/Debian: the Alibaba Cloud / Tsinghua `docker-ce` repositories

- The installer uses those repositories; if they fail, try `get.docker.com --mirror Aliyun`

- On OpenCloudOS / openEuler, do not use the extremely old docker shipped in the distribution repositories

## Installer script

When `raw.githubusercontent.com` in the one-liner is unreachable:

```
curl -fsSL https://ghfast.top/https://raw.githubusercontent.com/Haizakura/Haizakura.Docker.Framework/main/install.sh | bash
```

Template files then go through jsDelivr / ghfast. Do not switch to a one-click script from an unknown Gitee repository.

## GitHub Releases (lite package, host mode)

`github.com` / `objects.githubusercontent.com` may be very slow. In host mode the installer tries ghfast, gh-proxy and direct GitHub in order, and verifies the hash after download whenever a hash is available.

Do not put GitHub acceleration prefixes into Docker's `registry-mirrors`.

## Linux QQ installer

It comes from the Tencent CDN `qqdl.gtimg.cn`, which is normally reachable directly from mainland China. The Docker image build likewise uses the current official filename plus a pinned backup address rather than following `latest`.

Was this page helpful?

Yes / No · Last updated

Troubleshooting

Common failures with QR codes, passwords, ports, injection and image pulls

Developer documentation

Monorepo structure, core startup path and contribution notes
