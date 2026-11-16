# Haizakura WebUI


Haizakura 之瀏覧器 console 者、Vite + React 応用也、運行時状態、OneBot 設定、記録、storage、伺服器設定管理之用。

## 既定外観

新規 install 与外観 reset 者、mascot 之 lavender accent 使用也。Light 版者 button label 可読為濃紫使用、dark mode 者淡 lavender 使用。既存保存 accent 与 custom color 者保持也。元之 sky-blue accent 者設定中仍可用也。

既定 palette 中、page、card、input、popover、sidebar 各表面者、neutral light/dark 背景中少量有効 accent 混入也。文字者可読性為 neutral 不変也。Sidebar 専用之 accent 者唯 sidebar 着色也；OLED 者真黒 canvas 維持也。命名 palette、custom CSS 変数、host 外観 overlay 者、各自表面之制御保持也。

既定 accent 変更時者、伺服器既定値 `packages/core/src/webui/ui-config.ts`、frontend 既定値与 preset `src/contexts/ThemeContext.tsx`、mount 前 token `src/index.css`、三者整合保持必要也。

瀏覧器 favicon、home screen icon、app 内 logo 者、[`assets/brand/mascot-avatar.png`](../../assets/brand/mascot-avatar.png) 之 mascot avatar 共有也。其輸出尺寸者 `public/` 中：`logo.png`（512 px）、`favicon.png`（64 px）、`apple-touch-icon.png`（180 px）也。個別尺寸重描非為、master 自輸出也。

## Host 外観連携

`SNOWLUMA_WEBUI_TARGET=maibot` 者、該 deployment 可逆 millennium 外観 overlay 参加也。Standalone 既定値不変也。Host 者、個人偏好被覆或別 selector 追加無、light/dark live 更新驅動也。Target 起動、theme 所有権、host messaging、scoped style 変更前、[連携 contract 与擴張指南](INTEGRATIONS.md) 参照必要也。

## 操作規約

- 破壊性動作与二次確認者、modal dialog 内止也。
- 時間要可能之動作者、右下 running 状態表示也。
- 完成与失敗動作者、右下結果通知使用、可視 countdown 後自動閉也。
- 日常高頻調整者、中間編集毎通知生成無也。
- Foreground polling 者、非表示 tab 中停止、次回 scheduling 前各 request 完了待也。接続状態 polling 者、SSE 客端購読中唯実行也。
- Data-backed surface 者 Interior Skeleton Swap 既定値（120 ms 遅延、380 ms 最小表示時間）使用、故 local 高速応答 placeholder 閃無也。Submission、upload、其他明示操作 progress 者自前 spinner 保持也。
- 可変高度 content 者、準備完成後 skeleton 確保 box 解放必要也；page 内第二 scrolling region 導入不可也。
- Mobile navigation menu 者、視覚状態実際 drawer 状態追従之制御 Icon Morph 使用也。
- 失敗者、影響 control 内与操作結果中可視保持必要也；失敗応答成功 feedback 変換不可也。
- JSON endpoint 者 object 返却必要也。Malformed 或非 object 応答者、空 list 或既定設定表示而非、error 報告也。
- 設定応答者 `config` 含也；保存時更 `saved`、`applied`、`online`、`errors`、`message` 報告也。UI 者此等 field 使用、legacy alias 或保存後第二 request 無也。
- Password 変更 flow 者、floating label 与 inline validation 一貫使用也。
- Password 強度詳細者、新 password field focus 中有之時唯表示、focus 離去時同一 motion language 退場也。
- 初回起動 wizard 者、同意文主要読取面保持、各 step 動作単一 responsive footer 内整列也。設定中者、此 wizard 安全再実行与 page 級 crash screen 試行之可視 developer page 含也；再実行同意与 password 者永不 persist 也。

## Reverse proxy 背後之認証

認証済 WebUI request 者、session token `X-SnowLuma-Token` 中送信、`Authorization` 者 reverse proxy 之 HTTP 認証（Nginx Basic Auth 等）為保留也。Proxy 若 filter request header 者、`X-SnowLuma-Token` 不変転送必要也。Backend 者、専用 header 不存在時、既存 client 為 `Authorization: Bearer <token>` 仍受付也。両層者各自有効 credentials 必要也。

旧 session 之遅延認証失敗者、新 session sign out 無也。Live stream 者、切断時購読解放、page 与共停止也。Malformed stream data 者報告也；debug stream 呼出者静黙成功而非失敗也。

## Process 帳号検出

Process card 者、注入前 QQ local 帳号 data 使用、login 後 hook 確認身分使用也。Local data 欠落者帳号不明之意也。此者 QQ sign out 之証非也、且 local 検出単独永 bridge online 標記無也。手動 login probe 与 `/api/processes/:pid/probe-login` endpoint 者削除也。

Linux 者、各 QQ process 之 `XDG_CONFIG_HOME` 或 `HOME` 自 data root 解決也。Windows 者、同梱 addon 之 `getFileHoldersAsync` 使用、各帳号 database 保持 process 発見也。Query 失敗者、未 login 扱而非報告也。

## 帳号通知 template

Webhook body 与 email subject/body 者、`{uin}`、`{nickname}`、`{event}`（`offline` 或 `online`）、`{time}`、`{status}`（Hook process 状態）、`{pid}`、`{error}`（Hook process error）対応也。新 webhook 与 email 頻道者、既定 body 中 process 状態含也；既存保存 template 者保持也。JSON template 者、引用符、改行、制御文字含之置換文字列 escape 也。

Process facts 者、offline debounce 有之場合其後、通知 dispatch 時解決也。各 transition 者自身 process PID 携帯、帳号 offline 時切離之最終 PID 含也。Facts 者別 process 置換無、該 PID 与 UIN 為検索也。欠落 facts 者空 rendering、不明之意、QQ 終了之証非也。Hook 状態単独者 QQ login 失敗原因特定不能也。一帳号之通知者 transition 順序配信、遅 account 者他 account 遅延無也。

## Local 開発

Package 版 install 者、設定 → 版本情報中 download 与 restart control 有也。Download 者検証与 staging 行、file 者 app 起動前適用也。Restart 確認者共有 modal 使用、download 結果者 action feedback 使用也。

Windows 者、native API 者起動時一回 process token 与 EXE 整合性 label 記録也。Low（或以下）token 者 WebUI warning 引発也；file label 与 query 失敗単独者引発無也。「临时关闭」者 tab session 中（reload 含）持続也；「永久关闭」者此瀏覧器 site storage 中 persist 也。両者起動 log 抑制無也。失敗 query 与 preference 書込者可視保持也。

Repo root 自：

```bash
pnpm --filter webui dev
pnpm --filter webui typecheck
pnpm --filter webui lint
pnpm --filter webui test
pnpm --filter webui build
```
