# WebUI frontend patches

The WebUI frontend ships **only as minified Vite output**; its source is not part
of this repository. The files here are the patched artifacts, kept for reference
and for re-deploying into a container.

## What was patched

| File | Change |
| --- | --- |
| `assets/router-DihNZCdp.js` | sidebar gets a **文档 (Docs)** entry after 调试, wired to a normal SPA route (`/docs`) that lazy-loads `docs-page-hz.js` |
| `assets/docs-nav-hz.js` | **new** shared module: the sidebar document tree (three collapse levels), the fetch helpers and the selected-document store. Both the sidebar and the page import it, so they share one instance. |
| `assets/docs-page-hz.js` | the article pane: breadcrumb, typography, mobile目录 panel, right-hand "本页目录" |
| `assets/docs-hz.css` | all `.hz-doc-*` / `.hz-nav-*` styling, loaded by an extra `<link>` in `index.html` (the frontend has no Tailwind typography plugin, so the article rules are hand-written). Delete this file and its `<link>` to roll the styling back. |
| `index.html` | gains `<link rel="stylesheet" href="/assets/docs-hz.css">` after the existing bundle stylesheet |
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
