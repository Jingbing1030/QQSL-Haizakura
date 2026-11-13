# WebUI frontend patches

The WebUI frontend ships **only as minified Vite output**; its source is not part
of this repository. The files here are the patched artifacts, kept for reference
and for re-deploying into a container.

## What was patched

| File | Change |
| --- | --- |
| `assets/router-DihNZCdp.js` | sidebar gets a **文档 (Docs)** entry after 调试, opening `/docs` as a plain `<a>` because that route is served by the backend, not the SPA router |
| `assets/config-page-B0emcOKR.js` | product name `SnowLuma` → `Haizakura`; stale trigger literal `#sl` → `#hz` |
| `assets/LayoutContext-D4-NFqCh.js`, `index-CbgqmStD.js`, `maibot-*.js`, `overview-page-*.js`, `processes-page-*.js`, `settings-page-*.js` | product name rebrand |
| `logo.png` (512²), `favicon.png` (64²), `apple-touch-icon.png` (180²) | replaced icons |

## Deployment

`client/` is **not** a bind mount, so patches must be copied into a running
container:

```bash
docker cp assets/router-DihNZCdp.js <container>:/app/runtime/client/assets/
docker cp logo.png <container>:/app/runtime/client/
```

Take a backup first: `docker exec <c> cp -a /app/runtime/client /app/runtime/client.bak`
