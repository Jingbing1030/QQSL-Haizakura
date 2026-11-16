# 連絡先プロフィール


`get_friend_list` と `get_friends_with_category` は既存の結果形状を保ち、各フレンドに任意の公開プロフィールフィールドを追加します。
既定ではページングされた名簿を読むだけで、すべてのフレンドに対してプロフィール要求を発行することはありません。どちらも `with_profile: true` を受け付け、追加の詳細を明示的に照会します。
大きなリストではクライアントのタイムアウトを長めにする必要があるかもしれません。

明示的なエンリッチメントは現在のアカウントに属する 5 分間のキャッシュを使い、同時クエリを重複排除し、プロフィールの集約並列度を 4 に制限します。名簿がすでに提供している値が優先されます（空文字列、ゼロ、false を含む）。エンリッチメントの失敗は現在のバッチを処理しきった後にアクションを失敗させ、ログに記録され、キャッシュされず、自動的に再試行されません。
後の呼び出しで再試行されることはあります。通常のフラットなリストは、名簿を更新できない場合にキャッシュ済みフレンドへフォールバックする既存の挙動（ログ記録付き）を維持します。

フレンドの行には `user_id`、`nickname`、`remark`、および利用可能な場合は `category_id` が含まれます。公開フィールドは QQ が提供する場合には `get_stranger_info` にも現れます。

| フィールド | 意味 |
| --- | --- |
| `long_nick`、`sex`、`age`、`level` | 個性署名、性別、年齢、QQ レベル |
| `birthday_year`、`birthday_month`、`birthday_day` | 誕生日。非公開の年は省略される |
| `phone_num`、`email` | プロフィールが公開している連絡先 |
| `country`、`province`、`city`、`college` | 所在地と学校 |
| `is_qq_vip`、`is_vip`、`is_years_vip`、`vip_level` | 通常メンバーシップ、スーパーメンバーシップ（`is_vip` の既存の意味）、年費メンバーシップ、レベル |
| `privilege_icons` | 提供されていれば `jump_url`、加えて `open` と `closed` のアイコンリスト |

各特権エントリには `type`、`level`、`flag`、`is_big`、`jump_url`、`icon_url`、`deluxe_icon_url` が含まれることがあります。2 つのアイコン URL は共存できます。flag はサーバーの値をそのまま保持し、年費やプレミアムメンバーシップを意味すると推測されることはありません。
ローカルにダウンロードされたアイコンのパスは応答には含まれません。

欠落したデータは false、ゼロ、空リストで置き換えるのではなく省略されます。
明示的に空のアイコンリスト本体が返された場合は `open: [], closed: []` を生成します。アイコンデータが利用できない場合は `privilege_icons` を省略します。既存の必須の見知らぬユーザーフィールドとエイリアスは以前の既定値を保持します。不正な任意の誕生日は値を記録せずにログに記録され、不正なテキストや特権のペイロードはデコードに失敗します。

SDK の呼び出しは既存のオプション引数を保ちます。

```ts
const friends = await client.getFriendList({ withProfile: true, timeoutMs: 120_000 });
const categories = await client.call('get_friends_with_category', { with_profile: true });
```

エクスポートされる `FriendInfo`、`StrangerInfo`、`PublicProfileFields`、`ProfilePrivilege` の各型がこれらのフィールドを記述します。返却される可用性は QQ とアカウントのアクセス権に依存し、エンリッチメントを要求してもすべてのフィールドが存在することは保証されません。