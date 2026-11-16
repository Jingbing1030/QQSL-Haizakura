# 宿主外観覆蓋層


於 **Haizakura 工程**設定 `SNOWLUMA_WEBUI_TARGET=maibot` 者、可用 MaiBot 之
millennium 外観也。同発布包支持単体与嵌入両配置。未設定或空値者維持既存
Haizakura 体験、未知値者 WebUI 起動失敗並提示明確診断也。

此初回適配器僅実装 **millennium**、支持明暗二模式也。其他 MaiBot 様式未実装。
Haizakura 中無新外観選択器。主題変更者宿主所有、管理中既存主題控制不可用、
設定頁説明何設定被保持也。

## 運行時与所有権

1. 核心於起動時読取環境変数。[静的文档配信](../core/src/webui/static-frontend.ts)
   注入検証済公開 JSON 起動載入於 `/`、`/index.html` 及 SPA 回退文档。
   文档用 `Cache-Control: no-store`。密碼或任意環境変数不到達瀏覧器也。
2. [前端起動載入](src/appearance/runtime.ts) 僅於 React 掛載前載入選択目標
   之資産。単体配置不載目標様式表、字型或宿主監聴器。Vite 開発時、其工程有此
   環境変数者配信同起動載入、本番構築中立也。
3. [ThemeContext](src/contexts/ThemeContext.tsx) 保持 `savedAppearance` 与実効
   `appearance` 分離。僅保存済設定進入 localStorage 或 `config/ui.json`。
   目標更新決不呼出持久化 API 也。
4. 色、字型、円角、壁紙、CSS 変数覆蓋、自定義 CSS 及自定義遊標表示者、
   目標所有也。此等保存値保持但一時停止。UI 縮尺、密度、動画 / 無障碍、
   導航佈局及資料設定仍可用。回帰原生外観時、安全模式制限仍適用也。
5. 適用実効外観之佈局効果僅一個也。変更不重載文档、不変 React 鍵、
   不重啓会話。全部目標規則範囲於 `html[data-webui-target]`、
   含 `body` 下之 portal 也。

## 宿主協議、版本 1

契約在 [common/webui-target.ts](../common/src/webui-target.ts)。
配置環境者 opt-in 而非**実時伝送**也。既存啓動器須実装下記送信側、
僅設定環境変数不能伝達他工程当前主題也。

同一文档嵌入橋（例如 Electron `executeJavaScript`）於派遣事件前公開最新快照:

```js
const appearance = {
    version: 1,
    target: 'maibot',
    style: 'millennium',
    mode: 'dark', // 'light' | 'dark' | 'system'
};
window.__SNOWLUMA_HOST_APPEARANCE__ = appearance;
window.dispatchEvent(new CustomEvent('snowluma:host-appearance', { detail: appearance }));
```

此快照処理 React 或遅延資産載入器準備前送出之消息。毎回宿主 `dom-ready`
及宿主解決亮度変化時公開。已追従 MaiBot 之宿主応転送自身解決之 `light`/`dark`
状態、依此避真実源競合。注入前検証宿主期待 origin、値以 `JSON.stringify`
序列化、且不於宿主啓用 Node 統合也。

用同機制送出 `{ version: 1, target: null }` 以解除当前文档之覆蓋。
原本外観即時回帰。opt-in 文档保持其宿主訂閲、故宿主後可再適用目標。
監聴器於 provider 卸載時解放。此不変更起動環境、
亦不於単体配置啓用目標也。

当前適配器於宿主快照到達前、以 millennium 与系統亮度開始。宿主停止送出時、
最後有効快照仍活動。快照不持久化、不跨 origin / 分頁共有。重載者須宿主再公開。
不支持之版本、目標、様式或模式、以 `[Haizakura appearance]` 控制台診断拒否、
直前有効快照残存。宿主不能経此協議提供 CSS、URL 或可執行内容。
不導入未認証 HTTP 写入端点也。

## 目標追加

- 於共有契約之 `WEBUI_TARGETS` 追加其識別子、様式及既定様式。検証留此境界、
  不接受任意字符串也。
- 於網羅之[前端登記表](src/appearance/registry.ts)追加一個遅延載入器。
  於 `src/appearance/targets` 下実装純粋之保存至実効解析器及範囲付様式表。
  字型者与再頒布許可証共留本地也。
- 用語義色変数、共有組件類及中立 `data-ui-surface` 標記。
  不於業務頁追加目標名検査也。
- 決不持久化解決済覆蓋、不変更保存設定、不導入第二 DOM 主題写入器、
  不為切換表示重掛載応用也。
- 試験既定資産 / 監聴器隔離、初期文档路由、畸形消息、急速更新、清理及
  保存設定之正確復元。以隔離後端検証表単、焦点、滾動、portal 及移動佈局。
  Electron 統合須別途実宿主検査也。

## 源与検査

此適配器従 MaiBot 主倉庫之
[millennium 様式表](https://github.com/Mai-with-u/MaiBot/blob/5c7637e6913c84d1c3d5e742fa9e95a7e70d3501/dashboard/src/styles/millennium.css)、
而非归档之単体 WebUI。色与材質亦合
[OneKey 殻](https://github.com/Mai-with-u/MaiBotOneKey/blob/e8073b0bce35c8c4da973b06156602e14c42fee5/src/renderer/src/styles/millennium.css)。
同梱 Jersey 20 字型来自該 MaiBot 修訂、著作権 The Soft Type Project Authors、
依 [SIL Open Font License](src/appearance/targets/assets/Jersey20-OFL.txt) 提供。
其許可証於本番資産与字型同時輸出也。

集中検査（従倉庫根目録）:

```sh
pnpm --filter @snowluma/common exec vitest run tests/webui-target.test.ts
pnpm --filter @snowluma/core exec vitest run tests/webui-static-frontend.test.ts
pnpm --filter webui exec vitest run tests/target-appearance.test.ts
```

引渡変更前、実行 `AGENTS.md` 之通常工作区検査也。
