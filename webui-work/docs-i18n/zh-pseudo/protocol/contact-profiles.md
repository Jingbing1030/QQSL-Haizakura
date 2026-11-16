# 連絡先資料


`get_friend_list` 与 `get_friends_with_category` 者既存結果形状保持、且各好友対任意公開資料字段追加也。
既定者僅頁送名簿読取、全好友対資料請求発行之事無也。両者 `with_profile: true` 受、追加詳細明示照会也。
大列表者客端超時較長必要可能性有也。

明示的充実者当前帳号所属之五分間緩存使用、同時照会去重、且資料集約並行四制限也。名簿既提供之値優先也（空文字列、零、false 含）。充実失敗者当前批次処理尽後動作失敗為、記録残留、緩存無、自動再試無也。
後続呼出者再試可能性有也。普通平坦列表者、名簿更新不可場合緩存済好友回退之既存挙動（記録付）保持也。

好友之行者 `user_id`、`nickname`、`remark`、及可用場合 `category_id` 含也。公開字段者 QQ 提供場合 `get_stranger_info` 中亦現也：

| 字段 | 含義 |
| --- | --- |
| `long_nick`、`sex`、`age`、`level` | 個性署名、性別、年齢、QQ 等級 |
| `birthday_year`、`birthday_month`、`birthday_day` | 誕生日；非公開之年者省略也 |
| `phone_num`、`email` | 資料既公開之連絡先 |
| `country`、`province`、`city`、`college` | 所在地与学校 |
| `is_qq_vip`、`is_vip`、`is_years_vip`、`vip_level` | 通常会員、超級会員（`is_vip` 之既存含義）、年費会員、等級 |
| `privilege_icons` | 提供済場合 `jump_url`、加 `open` 与 `closed` 図標列表 |

各特権条目者 `type`、`level`、`flag`、`is_big`、`jump_url`、`icon_url` 与 `deluxe_icon_url` 含可能性有也。二図標 URL 者共存可能也。flag 者伺服器之値其儘保持、年費或高級会員含義推測之事無也。
本地下載済図標之路徑者応答中不含也。

欠落資料者 false、零、空列表依置換而非省略也。
明示空図標列表本体返却場合 `open: [], closed: []` 生成也；図標資料不可用場合 `privilege_icons` 省略也。既存必須之陌生人字段与別名者以前之既定値保持也。不正任意誕生日者値不記録而記録残留、不正文本或特権荷載者復号失敗也。

SDK 呼出者既存選択肢引数保持也：

```ts
const friends = await client.getFriendList({ withProfile: true, timeoutMs: 120_000 });
const categories = await client.call('get_friends_with_category', { with_profile: true });
```

導出之 `FriendInfo`、`StrangerInfo`、`PublicProfileFields` 与 `ProfilePrivilege` 類型者此等字段記述也。返却可用性者 QQ 与帳号之訪問権限依存、充実請求者全字段存在保証無也。