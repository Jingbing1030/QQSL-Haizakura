# 聯絡人個人檔案


`get_friend_list` 與 `get_friends_with_category` 保留其既有的結果結構，並為每個好友新增選用的公開個人檔案欄位。預設情況下它們只會讀取分頁式名冊：不會為每個好友發出個人檔案請求。兩者都接受 `with_profile: true`，以明確查詢額外細節。大型清單可能需要更長的用戶端逾時。

明確的補充資料使用屬於目前帳號的五分鐘快取，會去除同時進行的重複查詢，並把個人檔案的彙總並行度限制為四。名冊已提供的值優先，包括空字串、零與 false。補充資料失敗會先耗盡目前批次，然後讓動作失敗；失敗會被記錄、不會被快取，也不會自動重試。之後的呼叫可以重試它。當名冊無法重新整理時，一般平面清單會保留其既有的、記錄於日誌的退回快取好友行為。

好友資料列在可用時包含 `user_id`、`nickname`、`remark` 與 `category_id`。當 QQ 提供時，公開欄位也會出現在 `get_stranger_info` 中：

| 欄位 | 意義 |
| --- | --- |
| `long_nick`、`sex`、`age`、`level` | 簽名、性別、年齡與 QQ 等級 |
| `birthday_year`、`birthday_month`、`birthday_day` | 生日；隱藏的年份會被省略 |
| `phone_num`、`email` | 個人檔案所提供的聯絡細節 |
| `country`、`province`、`city`、`college` | 所在地與學校 |
| `is_qq_vip`、`is_vip`、`is_years_vip`、`vip_level` | 一般會員、超級會員（`is_vip` 的既有意義）、年度會員與等級 |
| `privilege_icons` | 若有提供則為 `jump_url`，加上 `open` 與 `closed` 圖示清單 |

每個特權項目可能包含 `type`、`level`、`flag`、`is_big`、`jump_url`、`icon_url` 與 `deluxe_icon_url`。這兩個圖示 URL 可以並存。旗標保留其伺服器值；不會被猜測為代表年度或付費會員。本機下載的圖示路徑不屬於回應的一部分。

缺少的資料會被省略，而不是以 false、零或空清單取代。明確回傳的空圖示清單主體會產生 `open: [], closed: []`；無法取得的圖示資料會省略 `privilege_icons`。既有的必要陌生人欄位與別名保留其先前的預設值。格式錯誤的選用生日會被記錄，但不記錄其值；格式錯誤的文字或特權承載資料會使解碼失敗。

SDK 呼叫保留既有的選項引數：

```ts
const friends = await client.getFriendList({ withProfile: true, timeoutMs: 120_000 });
const categories = await client.call('get_friends_with_category', { with_profile: true });
```

匯出的 `FriendInfo`、`StrangerInfo`、`PublicProfileFields` 與 `ProfilePrivilege` 型別描述這些欄位。回傳的可用性取決於 QQ 與該帳號的存取權；請求補充資料並不保證每個欄位都會存在。