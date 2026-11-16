# V2.0.0 前計画


- [x] Uid/Uin 統一之 Service 提供、且 Sqlite 永続化実装、群/好友/入群与好友申請之新 Uid 取得也。
- [x] Debug 体験最適化、免打包 Debug 実現、同時之資料目録正確也。（Proton 兜底思路改為 ts+map 抽出型、用於 tsx 与 nodejs、vite 正常打包之時剥離）
- [x] core 拆分、架構為 Common（公共能力）OneBot（外層封装 協議変換）、Core（Api raw 能力、基礎能力等機能）、Bridge（封装与關鍵解析能力及 Event message/sent group/member_add ...）也。
- [x] ProtocolBuffer 定義剥離至単独 package。
- [x] 送信与解析消息鏈路整理、性能向上也。`packages/{bridge,onebot}/bench/*.bench.ts` 得基準数字。最大瓶頸非 protobuf 解析（既 sub-μs）、而在両処 SQLite 反復 `db.prepare(sql)` 重 parse —— `node:sqlite`（実験性）換為 `better-sqlite3`（安定）+ 緩存 prepared statements 後：`group_member_join` 全鏈路 17.5μs → 4.7μs（**3.7x**）、`storeMeta` 17μs → 11μs、`storeEvent` 23μs → 18μs、`findMeta` 5.4μs → 1.3μs（**4x**）。送側合成 hot path（storeMeta + storeEvent）単条消息 40μs → 29μs。另外除去 `Buffer.from(pkt.body)` 之冗長 alloc（pkt.body 本来即 Uint8Array）。`elementsToJson` 同步快路径 / WAL checkpoint 調参 / JSON 序列化置換 等次要最適化点保留、待真有 throughput 圧力再行也。
- [x] 対齐 NapCat 設計採用 Api 層、掛於 ctx、Core 与 Onebot 皆此設計也。
  - [x] Core 側：13 個 Api 類（message/contacts/groupAdmin/groupFile/groupAlbum/interaction/friend/profile/forward/misc/extras/web）既掛於 `bridge.apis.<area>.method()`、`BridgeInterface` + `actions/*` 全部削除也。
  - [x] OneBot 側：`ApiActionContext` 削除約 40 個純転送字段（groupAdmin / groupFile / groupAlbum / friend / interaction / message / profile / web 八区）、actions 直接 `ctx.bridge.apis.<area>.method(...)` 呼出 Core 之 Api 層也。保留之約 30 個字段全為真組合 helper（module-level send/forward、message store reads、meta-lookup composers）。完全 NapCat 化（class-per-action / TypeBox schema / actionName 列挙 / auto-register decorator）暫未行 —— profile 文档/工具鏈需求出現後再行也。