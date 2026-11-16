# V2.0.0 までの計画


- [x] Uid/Uin を統一する Service を 1 つ提供し、Sqlite 永続化を実装、群 / 好友 / 入群と好友申請で新しい Uid を取得する。
- [x] Debug 体験を最適化し、パッケージ不要の Debug を実現、同時にデータディレクトリを正しくする。（Proton のフォールバック方針を ts+map による型抽出へ変更し、tsx と nodejs に用いる。vite が通常どおりパッケージする際には剥離する）
- [x] core を分割し、Common（共通機能）OneBot（外層ラップ・プロトコル変換）、Core（Api raw 機能、基盤機能など）、Bridge（ラップと要所の解析機能、および Event message/sent group/member_add ...）という構成にする。
- [x] ProtocolBuffer 定義を独立した package へ切り離す。
- [x] 送信と解析のメッセージ経路を整理し、性能を向上させる。`packages/{bridge,onebot}/bench/*.bench.ts` でベースラインの数値を取得した。最大のボトルネックは protobuf 解析（すでに sub-μs）ではなく、2 か所の SQLite が繰り返し `db.prepare(sql)` を再 parse している点だった —— `node:sqlite`（実験的）を `better-sqlite3`（安定）に置き換え、prepared statements をキャッシュした後は、`group_member_join` の全経路が 17.5μs → 4.7μs（**3.7x**）、`storeMeta` が 17μs → 11μs、`storeEvent` が 23μs → 18μs、`findMeta` が 5.4μs → 1.3μs（**4x**）となった。送信側の合成ホットパス（storeMeta + storeEvent）は 1 メッセージあたり 40μs → 29μs。さらに `Buffer.from(pkt.body)` の冗長な alloc を削除した（pkt.body はもともと Uint8Array）。`elementsToJson` の同期ファストパス / WAL checkpoint のチューニング / JSON シリアライズの置き換えなどの副次的な最適化項目は保留し、実際に throughput の圧力が出てから行う。
- [x] NapCat の設計に合わせて Api 層を採用し、ctx に載せる。Core と Onebot の双方をこの設計にする。
  - [x] Core 側：13 個の Api クラス（message/contacts/groupAdmin/groupFile/groupAlbum/interaction/friend/profile/forward/misc/extras/web）を `bridge.apis.<area>.method()` に載せ、`BridgeInterface` + `actions/*` はすべて削除した。
  - [x] OneBot 側：`ApiActionContext` から純粋な転送用フィールド約 40 個を削除し（groupAdmin / groupFile / groupAlbum / friend / interaction / message / profile / web の 8 領域）、actions は直接 `ctx.bridge.apis.<area>.method(...)` で Core の Api 層を呼び出す。残した約 30 個のフィールドはすべて実際の合成 helper（module-level の send/forward、message store の読み取り、meta-lookup の composer）である。完全な NapCat 化（class-per-action / TypeBox schema / actionName 列挙 / auto-register decorator）はまだ行っていない —— profile のドキュメントやツールチェーンの要求が出てから行う。