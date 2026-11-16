# V2.0.0 前計畫


- [x] 統一 Uid/Uin 提供一個 Service，並實作 Sqlite 持久化，群/好友/入群與好友申請皆取得新 Uid。
- [x] 最佳化 Debug 體驗，實作免打包 Debug，同時資料目錄正確。（Proton 兜底思路改成 ts+map 提取型別，用於 tsx 與 nodejs，vite 正常打包時剝離）
- [x] 拆分 core，架構為 Common（公共能力）、OneBot（外層封裝、協定轉換）、Core（Api raw 能力、基礎能力等功能）、Bridge（封裝與關鍵解析能力，以及 Event message/sent group/member_add ...）
- [x] 剝離 ProtocolBuffer 定義到獨立 package。
- [x] 整理傳送與解析訊息鏈路，提升效能。`packages/{bridge,onebot}/bench/*.bench.ts` 取得了基線數字。最大瓶頸不在 protobuf 解析（已經 sub-μs），而在兩處 SQLite 反覆 `db.prepare(sql)` 重新 parse —— 把 `node:sqlite`（實驗性）換成 `better-sqlite3`（穩定）＋ 快取 prepared statements 後：`group_member_join` 全鏈路 17.5μs → 4.7μs（**3.7x**），`storeMeta` 17μs → 11μs，`storeEvent` 23μs → 18μs，`findMeta` 5.4μs → 1.3μs（**4x**）。傳送側組合 hot path（storeMeta + storeEvent）單則訊息 40μs → 29μs。另外移除 `Buffer.from(pkt.body)` 的冗餘 alloc（pkt.body 本來就是 Uint8Array）。`elementsToJson` 同步快路徑 / WAL checkpoint 調參 / JSON 序列化替換 等次要最佳化點保留，待真有 throughput 壓力再做。
- [x] 對齊 NapCat 設計採用 Api 層，掛到 ctx，Core 與 OneBot 都這麼設計。
  - [x] Core 側：13 個 Api 類（message/contacts/groupAdmin/groupFile/groupAlbum/interaction/friend/profile/forward/misc/extras/web）已掛到 `bridge.apis.<area>.method()`，`BridgeInterface` + `actions/*` 全部刪除。
  - [x] OneBot 側：`ApiActionContext` 砍掉約 40 個純轉發欄位（groupAdmin / groupFile / groupAlbum / friend / interaction / message / profile / web 八區），actions 直接 `ctx.bridge.apis.<area>.method(...)` 呼叫 Core 的 Api 層。保留的約 30 個欄位全是真組合 helper（module-level send/forward、message store reads、meta-lookup composers）。完全 NapCat 化（class-per-action / TypeBox schema / actionName 列舉 / auto-register decorator）暫未做 —— profile 文件/工具鏈需求出現後再做。
