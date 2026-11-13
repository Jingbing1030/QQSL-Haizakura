# OneBot v11 动作参考（actions）

> [!WARNING]
> 本内容完全由 AI 编写，请谨慎查看。

> **数据来源**：运行实例的 `GET /api/debug/actions` 与源码
> `packages/onebot/src/actions/*.ts` **双向核对**，动作名 222/222 完全一致。
> 参数表全部由源码 `params` / `inputSchema` 提取，非人工转述。

## 1. 总览

| 项目 | 数量 |
| --- | --- |
| **声明式动作总数** | **222** |
| 可执行名（含兼容别名） | 228 |
| 隐藏 raw 动作 | 1（`.handle_quick_operation`） |
| 该 raw 动作的别名 | 1（`.handle_quick_operation_async`） |
| **可调用名字合计** | **230** |
| 流式（stream）动作 | 5 |
| 只读动作（无副作用） | 91 |
| 有副作用动作 | 131 |
| 带兼容别名的动作 | 5 |
| 未实现 / 不支持 | 5 |
| 文档显式标注权限要求 | 30 |

> ### 关于「196 个动作」
>
> 上游 `README.md` 中的 **196** 是**过时数字**。当前源码与运行实例
> 均为 **222 个声明式动作 / 228 个可执行名**。
> 复核方法（可自行重现）：
>
> ```bash
> # ① 源码计数：四类定义脚手架分别统计
> grep -c 'defineAction({'        packages/onebot/src/actions/*.ts
> grep -c 'groupAction({'         packages/onebot/src/actions/*.ts
> grep -c 'groupUserAction({'     packages/onebot/src/actions/*.ts
> grep -c 'defineStreamAction({'  packages/onebot/src/actions/*.ts
> # ② 运行实例计数
> curl -H "Authorization: Bearer <token>" http://<host>:5199/api/debug/actions \
>   | jq '.actions | length'      # => 222
> ```
>
> ⚠️ 直接 `grep -c 'defineAction'` 会把**函数定义本身**也计入（`function defineAction(`），
> 得到偏大的 229 之类的数字。必须匹配 `defineAction({` 形式，
> 并以运行实例的 `222` 为准。

### 1.1 分类分布（源码 `ACTION_GROUPS`，权威分类）

| 分类 | 动作数 |
| --- | --- |
| [信息](#信息) | 5 |
| [消息](#消息) | 6 |
| [好友](#好友) | 3 |
| [群信息](#群信息) | 7 |
| [群管理](#群管理) | 24 |
| [群文件](#群文件) | 12 |
| [请求](#请求) | 2 |
| [扩展](#扩展) | 115 |
| [群相册](#群相册) | 9 |
| [空间](#空间) | 29 |
| [系统表情](#系统表情) | 4 |
| [流式接口](#流式接口) | 6 |
| **合计** | **222** |

### 1.2 全部动作主表

按源码分类排序。**状态**列：`✅` 可用 / `⚠️` 未实现（调用必失败）。

| 动作名 | 分类 | 说明 | 只读 | 权限 | 状态 |
| --- | --- | --- | --- | --- | --- |
| [`can_send_image`](#action-can_send_image) | 信息 |  | ✔ | — | ✅ |
| [`can_send_record`](#action-can_send_record) | 信息 |  | ✔ | — | ✅ |
| [`get_login_info`](#action-get_login_info) | 信息 |  | ✔ | — | ✅ |
| [`get_status`](#action-get_status) | 信息 |  | ✔ | — | ✅ |
| [`get_version_info`](#action-get_version_info) | 信息 |  | ✔ | — | ✅ |
| [`delete_msg`](#action-delete_msg) | 消息 | 撤回消息 |  | — | ✅ |
| [`get_msg`](#action-get_msg) | 消息 | 获取消息 | ✔ | — | ✅ |
| [`send_custom_face`](#action-send_custom_face) | 消息 | 发送账号收藏表情（emoji_id 或 MD5），保留表情显示样式 |  | — | ✅ |
| [`send_group_msg`](#action-send_group_msg) | 消息 | 发送群消息 |  | — | ✅ |
| [`send_msg`](#action-send_msg) | 消息 | 发送消息（按 message_type/群号 自动路由群聊或私聊） |  | — | ✅ |
| [`send_private_msg`](#action-send_private_msg) | 消息 | 发送私聊消息 |  | — | ✅ |
| [`delete_friend`](#action-delete_friend) | 好友 | 删除好友 |  | — | ✅ |
| [`get_friend_list`](#action-get_friend_list) | 好友 | 获取好友列表 | ✔ | — | ✅ |
| [`get_stranger_info`](#action-get_stranger_info) | 好友 | 获取陌生人信息 | ✔ | — | ✅ |
| [`get_group_honor_info`](#action-get_group_honor_info) | 群信息 | 获取群荣誉信息 | ✔ | — | ✅ |
| [`get_group_info`](#action-get_group_info) | 群信息 | 获取群信息 | ✔ | — | ✅ |
| [`get_group_list`](#action-get_group_list) | 群信息 | 获取群列表 | ✔ | — | ✅ |
| [`get_group_member_info`](#action-get_group_member_info) | 群信息 | 获取群成员信息 | ✔ | — | ✅ |
| [`get_group_member_list`](#action-get_group_member_list) | 群信息 | 获取群成员列表 | ✔ | — | ✅ |
| [`get_group_share_link`](#action-get_group_share_link) | 群信息 | 获取群分享链接 | ✔ | — | ✅ |
| [`get_group_system_msg`](#action-get_group_system_msg) | 群信息 | 获取群系统消息 | ✔ | — | ✅ |
| [`add_group_tag`](#action-add_group_tag) | 群管理 | 向某个群分类添加资料标签 |  | 需权限 | ✅ |
| [`delete_group_tag`](#action-delete_group_tag) | 群管理 | 从某个群分类移除资料标签 |  | 需权限 | ✅ |
| [`get_group_admin_permissions`](#action-get_group_admin_permissions) | 群管理 | 读取指定管理员的撤回、移除成员、每日移除上限及接收验证消息状态 | ✔ | 需权限 | ✅ |
| [`get_group_admin_settings`](#action-get_group_admin_settings) | 群管理 | 获取群管理设置的当前值 | ✔ | — | ✅ |
| [`get_group_tags`](#action-get_group_tags) | 群管理 | 读取某个群分类下的资料标签 | ✔ | — | ✅ |
| [`set_group_add_option`](#action-set_group_add_option) | 群管理 | 设置加群选项 |  | — | ✅ |
| [`set_group_admin`](#action-set_group_admin) | 群管理 | 设置/取消管理员 |  | 需权限 | ✅ |
| [`set_group_admin_permissions`](#action-set_group_admin_permissions) | 群管理 | 设置指定管理员的撤回和移除成员权限 |  | 需权限 | ✅ |
| [`set_group_admin_receive_verify`](#action-set_group_admin_receive_verify) | 群管理 | 设置指定管理员是否接收加群验证消息 |  | 需权限 | ✅ |
| [`set_group_anonymous`](#action-set_group_anonymous) | 群管理 | 匿名开关（未实现，返回 ok） |  | — | ⚠️ 未实现 |
| [`set_group_anonymous_ban`](#action-set_group_anonymous_ban) | 群管理 | 匿名禁言（未实现，返回 ok） |  | — | ⚠️ 未实现 |
| [`set_group_ban`](#action-set_group_ban) | 群管理 | 禁言群成员（duration=0 解除） |  | 需权限 | ✅ |
| [`set_group_card`](#action-set_group_card) | 群管理 | 设置群名片（空字符串清除） |  | 需权限 | ✅ |
| [`set_group_kick`](#action-set_group_kick) | 群管理 | 踢出群成员 |  | 需权限 | ✅ |
| [`set_group_kick_members`](#action-set_group_kick_members) | 群管理 | 批量踢出群成员 |  | 需权限 | ✅ |
| [`set_group_leave`](#action-set_group_leave) | 群管理 | 退群 |  | — | ✅ |
| [`set_group_member_invite_policy`](#action-set_group_member_invite_policy) | 群管理 | 设置群成员邀请策略 |  | 需权限 | ✅ |
| [`set_group_member_permissions`](#action-set_group_member_permissions) | 群管理 | 设置群成员权限（仅群主可改） |  | 需权限 | ✅ |
| [`set_group_name`](#action-set_group_name) | 群管理 | 设置群名 |  | 需权限 | ✅ |
| [`set_group_new_member_history_visibility`](#action-set_group_new_member_history_visibility) | 群管理 | 设置新成员是否可查看历史消息 |  | 需权限 | ✅ |
| [`set_group_portrait`](#action-set_group_portrait) | 群管理 | 设置群头像 |  | — | ✅ |
| [`set_group_search`](#action-set_group_search) | 群管理 | 设置群被搜索方式（群指纹 / 群号搜索开关） |  | — | ✅ |
| [`set_group_special_title`](#action-set_group_special_title) | 群管理 | 设置群头衔 |  | 需权限 | ✅ |
| [`set_group_whole_ban`](#action-set_group_whole_ban) | 群管理 | 全员禁言开关 |  | 需权限 | ✅ |
| [`create_group_file_folder`](#action-create_group_file_folder) | 群文件 | 创建群文件夹 |  | — | ✅ |
| [`delete_group_file`](#action-delete_group_file) | 群文件 | 删除群文件 |  | 需权限 | ✅ |
| [`delete_group_file_folder`](#action-delete_group_file_folder) | 群文件 | 删除群文件夹 |  | — | ✅ |
| [`get_group_file_url`](#action-get_group_file_url) | 群文件 | 获取群文件下载链接 | ✔ | — | ✅ |
| [`get_group_files_by_folder`](#action-get_group_files_by_folder) | 群文件 | 获取群子目录文件列表 | ✔ | — | ✅ |
| [`get_group_root_files`](#action-get_group_root_files) | 群文件 | 获取群根目录文件列表 | ✔ | — | ✅ |
| [`get_private_file_url`](#action-get_private_file_url) | 群文件 | 获取私聊文件下载链接 | ✔ | — | ✅ |
| [`move_group_file`](#action-move_group_file) | 群文件 | 移动群文件 |  | — | ✅ |
| [`rename_group_file`](#action-rename_group_file) | 群文件 | 重命名群文件 |  | — | ✅ |
| [`rename_group_file_folder`](#action-rename_group_file_folder) | 群文件 | 重命名群文件夹 |  | — | ✅ |
| [`upload_group_file`](#action-upload_group_file) | 群文件 | 上传群文件 |  | — | ✅ |
| [`upload_private_file`](#action-upload_private_file) | 群文件 | 上传私聊文件 |  | — | ✅ |
| [`set_friend_add_request`](#action-set_friend_add_request) | 请求 | 处理好友添加请求 |  | — | ✅ |
| [`set_group_add_request`](#action-set_group_add_request) | 请求 | 处理加群请求 |  | — | ✅ |
| [`.get_word_slices`](#action-.get_word_slices) | 扩展 | 分词（未实现） | ✔ | — | ⚠️ 未实现 |
| [`_del_group_notice`](#action-_del_group_notice) | 扩展 | 删除群公告（fid 或 notice_id 二选一） |  | 需权限 | ✅ |
| [`_get_friend_dress`](#action-_get_friend_dress) | 扩展 | 获取指定 QQ 号正在使用的个性装扮（挂件/名片/来电/输入状态等） | ✔ | — | ✅ |
| [`_get_group_notice`](#action-_get_group_notice) | 扩展 | 获取群公告 | ✔ | — | ✅ |
| [`_get_model_show`](#action-_get_model_show) | 扩展 | 获取机型展示（兼容 mock） | ✔ | — | ✅ |
| [`_mark_all_as_read`](#action-_mark_all_as_read) | 扩展 | 标记全部已读 |  | — | ✅ |
| [`_send_group_notice`](#action-_send_group_notice) | 扩展 | 发送群公告（支持置顶、弹窗、新成员、群昵称引导与确认） |  | 需权限 | ✅ |
| [`_set_model_show`](#action-_set_model_show) | 扩展 | 设置机型展示（占位） |  | — | ✅ |
| [`add_custom_face`](#action-add_custom_face) | 扩展 | 添加收藏表情 |  | — | ✅ |
| [`bot_exit`](#action-bot_exit) | 扩展 | 退出机器人 |  | — | ✅ |
| [`cancel_group_todo`](#action-cancel_group_todo) | 扩展 | 取消群待办 |  | — | ✅ |
| [`check_url_safely`](#action-check_url_safely) | 扩展 | 检查链接安全性 | ✔ | — | ✅ |
| [`clean_cache`](#action-clean_cache) | 扩展 | 清理缓存 |  | — | ✅ |
| [`click_inline_keyboard_button`](#action-click_inline_keyboard_button) | 扩展 | 点击内联键盘按钮 |  | — | ✅ |
| [`complete_group_todo`](#action-complete_group_todo) | 扩展 | 完成群待办 |  | — | ✅ |
| [`create_collection`](#action-create_collection) | 扩展 | 创建收藏（未实现） |  | — | ⚠️ 未实现 |
| [`create_flash_task`](#action-create_flash_task) | 扩展 | 创建闪传任务 |  | — | ✅ |
| [`delete_custom_face`](#action-delete_custom_face) | 扩展 | 删除收藏表情 |  | — | ✅ |
| [`delete_essence_msg`](#action-delete_essence_msg) | 扩展 | 移除精华消息 |  | — | ✅ |
| [`delete_flash_file`](#action-delete_flash_file) | 扩展 | 删除闪传文件 |  | — | ✅ |
| [`delete_group_folder`](#action-delete_group_folder) | 扩展 | 删除群文件夹 |  | — | ✅ |
| [`download_file`](#action-download_file) | 扩展 | 下载文件（url 或 base64）到 data/downloads |  | — | ✅ |
| [`download_fileset`](#action-download_fileset) | 扩展 | 解析闪传文件下载直链（不下载，由调用方实现下载） |  | — | ✅ |
| [`fetch_custom_face`](#action-fetch_custom_face) | 扩展 | 获取自定义表情 | ✔ | — | ✅ |
| [`fetch_custom_face_detail`](#action-fetch_custom_face_detail) | 扩展 | 获取自定义表情详情 | ✔ | — | ✅ |
| [`fetch_emoji_like`](#action-fetch_emoji_like) | 扩展 | 获取表情回应用户（NapCat 分页） | ✔ | — | ✅ |
| [`fetch_ptt_text`](#action-fetch_ptt_text)<br>别名 `get_ptt_text`、`get_record_text` | 扩展 | 获取语音转文字结果 | ✔ | — | ✅ |
| [`forward_friend_single_msg`](#action-forward_friend_single_msg) | 扩展 | 转发单条消息给好友 |  | — | ✅ |
| [`forward_group_single_msg`](#action-forward_group_single_msg) | 扩展 | 转发单条消息到群 |  | — | ✅ |
| [`friend_poke`](#action-friend_poke) | 扩展 | 好友拍一拍 |  | — | ✅ |
| [`get_ai_characters`](#action-get_ai_characters) | 扩展 | 获取 AI 语音角色 | ✔ | — | ✅ |
| [`get_ai_record`](#action-get_ai_record) | 扩展 | 生成 AI 语音 |  | — | ✅ |
| [`get_clientkey`](#action-get_clientkey) | 扩展 | 获取 clientkey | ✔ | — | ✅ |
| [`get_collection_list`](#action-get_collection_list) | 扩展 | 获取收藏列表 | ✔ | — | ✅ |
| [`get_cookies`](#action-get_cookies) | 扩展 | 获取 Cookies | ✔ | — | ✅ |
| [`get_credentials`](#action-get_credentials) | 扩展 | 获取凭证 | ✔ | — | ✅ |
| [`get_csrf_token`](#action-get_csrf_token) | 扩展 | 获取 CSRF 令牌 | ✔ | — | ✅ |
| [`get_doubt_friends_add_request`](#action-get_doubt_friends_add_request) | 扩展 | 获取可疑好友申请 | ✔ | — | ✅ |
| [`get_emoji_likes`](#action-get_emoji_likes) | 扩展 | 获取表情回应用户 | ✔ | — | ✅ |
| [`get_essence_msg_list`](#action-get_essence_msg_list) | 扩展 | 获取精华消息列表 | ✔ | — | ✅ |
| [`get_file`](#action-get_file) | 扩展 | 获取文件信息（仅图片/语音缓存；群文件请用 get_group_file_url） | ✔ | — | ✅ |
| [`get_fileset_id`](#action-get_fileset_id) | 扩展 | 从 QQ 闪传分享码或官方分享链接获取 fileset_id | ✔ | — | ✅ |
| [`get_fileset_info`](#action-get_fileset_info) | 扩展 | 获取文件集信息 |  | — | ✅ |
| [`get_flash_file_list`](#action-get_flash_file_list) | 扩展 | 获取闪传文件列表 |  | — | ✅ |
| [`get_flash_file_url`](#action-get_flash_file_url) | 扩展 | 获取闪传文件链接 |  | — | ✅ |
| [`get_forward_msg`](#action-get_forward_msg) | 扩展 | 获取合并转发消息（id 或 message_id） | ✔ | — | ✅ |
| [`get_friend_msg_history`](#action-get_friend_msg_history) | 扩展 | 获取好友消息历史（无锚点时从服务器获取最新双向记录） | ✔ | — | ✅ |
| [`get_friends_with_category`](#action-get_friends_with_category) | 扩展 | 获取分组好友列表 | ✔ | — | ✅ |
| [`get_group_at_all_remain`](#action-get_group_at_all_remain) | 扩展 | 获取群 @全体成员 剩余次数 | ✔ | — | ✅ |
| [`get_group_detail_info`](#action-get_group_detail_info) | 扩展 | 获取群详细信息 | ✔ | — | ✅ |
| [`get_group_file_system_info`](#action-get_group_file_system_info) | 扩展 | 获取群文件系统信息 | ✔ | — | ✅ |
| [`get_group_ignore_add_request`](#action-get_group_ignore_add_request) | 扩展 | 获取被忽略的入群请求（NapCat） | ✔ | — | ✅ |
| [`get_group_ignored_notifies`](#action-get_group_ignored_notifies) | 扩展 | 获取被过滤的入群请求 | ✔ | — | ✅ |
| [`get_group_info_ex`](#action-get_group_info_ex) | 扩展 | 获取群信息（扩展） | ✔ | — | ✅ |
| [`get_group_msg_history`](#action-get_group_msg_history) | 扩展 | 获取群消息历史 | ✔ | — | ✅ |
| [`get_group_shut_list`](#action-get_group_shut_list) | 扩展 | 获取群禁言列表 | ✔ | — | ✅ |
| [`get_group_signed_list`](#action-get_group_signed_list) | 扩展 | 获取群今日打卡列表 | ✔ | — | ✅ |
| [`get_group_todo_list`](#action-get_group_todo_list) | 扩展 | 获取群待办列表 | ✔ | — | ✅ |
| [`get_image`](#action-get_image) | 扩展 | 获取图片信息 | ✔ | — | ✅ |
| [`get_mini_app_ark`](#action-get_mini_app_ark) | 扩展 | 获取小程序卡片 ark | ✔ | — | ✅ |
| [`get_msg_emoji_likes`](#action-get_msg_emoji_likes) | 扩展 | 获取一条消息的全部表情回应 | ✔ | — | ✅ |
| [`get_online_clients`](#action-get_online_clients) | 扩展 | 获取在线客户端 | ✔ | — | ✅ |
| [`get_profile_like`](#action-get_profile_like) | 扩展 | 获取资料点赞 | ✔ | — | ✅ |
| [`get_recent_contact`](#action-get_recent_contact) | 扩展 | 获取最近会话（占位） | ✔ | — | ✅ |
| [`get_record`](#action-get_record) | 扩展 | 获取语音信息；传 out_format 则服务端转码并附带 base64 | ✔ | — | ✅ |
| [`get_rkey`](#action-get_rkey)<br>别名 `nc_get_rkey` | 扩展 | 获取下载 rkey | ✔ | — | ✅ |
| [`get_rkey_server`](#action-get_rkey_server) | 扩展 | 获取 rkey 服务器信息 | ✔ | — | ✅ |
| [`get_share_link`](#action-get_share_link) | 扩展 | 获取文件分享链接 |  | — | ✅ |
| [`get_unidirectional_friend_list`](#action-get_unidirectional_friend_list) | 扩展 | 获取单向好友列表 | ✔ | — | ✅ |
| [`group_poke`](#action-group_poke) | 扩展 | 群拍一拍 |  | — | ✅ |
| [`list_filesets`](#action-list_filesets) | 扩展 | 列出当前账号的所有闪传文件集 |  | — | ✅ |
| [`mark_group_msg_as_read`](#action-mark_group_msg_as_read) | 扩展 | 标记群消息已读 |  | — | ✅ |
| [`mark_msg_as_read`](#action-mark_msg_as_read) | 扩展 | 标记消息已读（群聊/私聊自动路由） |  | — | ✅ |
| [`mark_private_msg_as_read`](#action-mark_private_msg_as_read) | 扩展 | 标记私聊消息已读 |  | — | ✅ |
| [`modify_custom_face`](#action-modify_custom_face) | 扩展 | 修改收藏表情备注 |  | — | ✅ |
| [`move_custom_face_to_front`](#action-move_custom_face_to_front) | 扩展 | 收藏表情移到最前 |  | — | ✅ |
| [`nc_get_packet_status`](#action-nc_get_packet_status) | 扩展 | 获取 packet 状态（占位） | ✔ | — | ✅ |
| [`nc_get_user_status`](#action-nc_get_user_status) | 扩展 | 获取用户在线/扩展状态 | ✔ | — | ✅ |
| [`ocr_image`](#action-ocr_image)<br>别名 `.ocr_image` | 扩展 | OCR 图片（服务端，需图片 URL 或已缓存的图片 file_id） | ✔ | — | ✅ |
| [`rename_flash_file`](#action-rename_flash_file) | 扩展 | 重命名闪传文件 |  | — | ✅ |
| [`request_decrypt_key`](#action-request_decrypt_key) | 扩展 | 请求数据库解密密钥 |  | — | ✅ |
| [`send_ark_share`](#action-send_ark_share) | 扩展 | 分享用户/群 Ark 卡片（NapCat 标准名） | ✔ | — | ✅ |
| [`send_flash_msg`](#action-send_flash_msg) | 扩展 | 发送闪传消息（私聊或群聊，引用 fileset_id 让对端下载） |  | — | ✅ |
| [`send_forward_msg`](#action-send_forward_msg) | 扩展 | 发送合并转发（按 message_type/群号自动路由） |  | — | ✅ |
| [`send_group_ai_record`](#action-send_group_ai_record) | 扩展 | 发送 AI 语音到群 |  | — | ✅ |
| [`send_group_ark_share`](#action-send_group_ark_share) | 扩展 | 分享群 Ark 卡片（NapCat 标准名） | ✔ | — | ✅ |
| [`send_group_forward_msg`](#action-send_group_forward_msg) | 扩展 | 发送群合并转发 |  | — | ✅ |
| [`send_like`](#action-send_like) | 扩展 | 点赞 |  | — | ✅ |
| [`send_packet`](#action-send_packet)<br>别名 `.send_packet` | 扩展 | 发送原始 SSO 包（cmd + hex data） |  | — | ✅ |
| [`send_poke`](#action-send_poke) | 扩展 | 拍一拍（群聊/私聊自动路由） |  | — | ✅ |
| [`send_private_forward_msg`](#action-send_private_forward_msg) | 扩展 | 发送私聊合并转发 |  | — | ✅ |
| [`send_tuwen_ark`](#action-send_tuwen_ark) | 扩展 | 发送图文 Ark 卡片（私聊/群聊） |  | — | ✅ |
| [`set_diy_online_status`](#action-set_diy_online_status) | 扩展 | 设置自定义在线状态 |  | — | ✅ |
| [`set_doubt_friends_add_request`](#action-set_doubt_friends_add_request) | 扩展 | 处理可疑好友申请 |  | — | ✅ |
| [`set_essence_msg`](#action-set_essence_msg) | 扩展 | 设置精华消息 |  | — | ✅ |
| [`set_friend_remark`](#action-set_friend_remark) | 扩展 | 设置好友备注 |  | — | ✅ |
| [`set_friends_category`](#action-set_friends_category) | 扩展 | 移动好友到指定分组 |  | — | ✅ |
| [`set_group_reaction`](#action-set_group_reaction) | 扩展 | 群聊表情回应 |  | — | ✅ |
| [`set_group_remark`](#action-set_group_remark) | 扩展 | 设置群备注 |  | — | ✅ |
| [`set_group_robot_add_option`](#action-set_group_robot_add_option) | 扩展 | 设置群机器人加群选项 |  | 需权限 | ✅ |
| [`set_group_sign`](#action-set_group_sign)<br>别名 `send_group_sign` | 扩展 | 群签到 |  | — | ✅ |
| [`set_group_todo`](#action-set_group_todo) | 扩展 | 设置群待办 |  | — | ✅ |
| [`set_input_status`](#action-set_input_status) | 扩展 | 设置输入状态 |  | — | ✅ |
| [`set_msg_emoji_like`](#action-set_msg_emoji_like) | 扩展 | 设置消息表情回应 |  | — | ✅ |
| [`set_online_status`](#action-set_online_status) | 扩展 | 设置在线状态 |  | — | ✅ |
| [`set_qq_avatar`](#action-set_qq_avatar) | 扩展 | 设置 QQ 头像 |  | — | ✅ |
| [`set_qq_profile`](#action-set_qq_profile) | 扩展 | 设置 QQ 资料 |  | — | ✅ |
| [`set_restart`](#action-set_restart) | 扩展 | 重启（不支持） |  | — | ⚠️ 未实现 |
| [`set_self_longnick`](#action-set_self_longnick) | 扩展 | 设置个性签名（longNick/long_nick，严格 string） |  | — | ✅ |
| [`share_group_ex`](#action-share_group_ex) | 扩展 | 分享群 Ark 卡片 | ✔ | — | ✅ |
| [`share_peer`](#action-share_peer) | 扩展 | 分享用户/群 Ark 卡片 | ✔ | — | ✅ |
| [`trans_group_file`](#action-trans_group_file) | 扩展 | 转存群文件 |  | 需权限 | ✅ |
| [`translate_en2zh`](#action-translate_en2zh) | 扩展 | 英译中 | ✔ | — | ✅ |
| [`upload_forward_msg`](#action-upload_forward_msg) | 扩展 | 上传转发消息 |  | — | ✅ |
| [`upload_foward_msg`](#action-upload_foward_msg) | 扩展 | 上传转发消息（别名拼写） |  | — | ✅ |
| [`cancel_group_album_media_like`](#action-cancel_group_album_media_like) | 群相册 |  |  | — | ✅ |
| [`del_group_album_media`](#action-del_group_album_media) | 群相册 | 删除群相册图片或视频 |  | — | ✅ |
| [`do_group_album_comment`](#action-do_group_album_comment) | 群相册 |  |  | — | ✅ |
| [`get_group_album_list`](#action-get_group_album_list) | 群相册 |  | ✔ | — | ✅ |
| [`get_group_album_media_list`](#action-get_group_album_media_list) | 群相册 |  | ✔ | — | ✅ |
| [`get_qun_album_list`](#action-get_qun_album_list) | 群相册 |  | ✔ | — | ✅ |
| [`set_group_album_media_like`](#action-set_group_album_media_like) | 群相册 |  |  | — | ✅ |
| [`upload_image_to_qun_album`](#action-upload_image_to_qun_album) | 群相册 |  |  | — | ✅ |
| [`upload_video_to_qun_album`](#action-upload_video_to_qun_album) | 群相册 | 上传视频到群相册 |  | — | ✅ |
| [`comment_qzone`](#action-comment_qzone) | 空间 | 评论说说或回复指定评论（普通评论支持带图，楼中楼仅支持文字） |  | 需权限 | ✅ |
| [`comment_qzone_public_feed`](#action-comment_qzone_public_feed) | 空间 | 评论推荐动态，支持文本或上游富文本条目 |  | — | ✅ |
| [`delete_qzone_msg`](#action-delete_qzone_msg) | 空间 | 删除一条说说（QQ 空间，按 tid） |  | 需权限 | ✅ |
| [`delete_qzone_public_comment`](#action-delete_qzone_public_comment) | 空间 | 删除推荐动态的一条评论（需有权限） |  | — | ✅ |
| [`delete_qzone_public_reply`](#action-delete_qzone_public_reply) | 空间 | 删除推荐动态评论下的一条回复（需有权限） |  | — | ✅ |
| [`forward_qzone_public_feed`](#action-forward_qzone_public_feed) | 空间 | 将推荐动态转发到当前账号空间 |  | — | ✅ |
| [`get_qzone_feed_detail`](#action-get_qzone_feed_detail) | 空间 | 按说说 tid 读取完整空间动态，可用于生成分享卡片 | ✔ | 需权限 | ✅ |
| [`get_qzone_feeds`](#action-get_qzone_feeds) | 空间 | 获取 QQ 空间好友动态，支持结构化正文与游标分页 | ✔ | — | ✅ |
| [`get_qzone_home_feeds`](#action-get_qzone_home_feeds) | 空间 | 读取自己或有权访问的空间主页动态，保留完整分享信息 | ✔ | — | ✅ |
| [`get_qzone_msg_detail`](#action-get_qzone_msg_detail) | 空间 | 获取 QQ 空间说说详情与一页评论（含服务端内联回复，需有访问权限） | ✔ | 需权限 | ✅ |
| [`get_qzone_msg_list`](#action-get_qzone_msg_list) | 空间 | 获取 QQ 空间说说列表（默认机器人自己的空间） | ✔ | 需权限 | ✅ |
| [`get_qzone_profile`](#action-get_qzone_profile) | 空间 | 获取 QQ 空间名称和说明（默认当前账号） | ✔ | 需权限 | ✅ |
| [`get_qzone_public_capabilities`](#action-get_qzone_public_capabilities) | 空间 | 读取当前账号的空友爱看入口与推权限 | ✔ | — | ✅ |
| [`get_qzone_public_comments`](#action-get_qzone_public_comments) | 空间 | 继续读取推荐动态评论 | ✔ | — | ✅ |
| [`get_qzone_public_feed_detail`](#action-get_qzone_public_feed_detail) | 空间 | 读取推荐动态详情及初始评论 | ✔ | — | ✅ |
| [`get_qzone_public_feeds`](#action-get_qzone_public_feeds) | 空间 | 读取空友爱看推荐动态，支持独立游标分页 | ✔ | — | ✅ |
| [`get_qzone_public_replies`](#action-get_qzone_public_replies) | 空间 | 继续读取指定评论的回复 | ✔ | — | ✅ |
| [`get_qzone_share_ark`](#action-get_qzone_share_ark) | 空间 | 生成空间动态分享卡片，返回原文及分享提示 |  | — | ✅ |
| [`like_qzone`](#action-like_qzone) | 空间 | 给一条说说点赞（QQ 空间） |  | 需权限 | ✅ |
| [`reply_qzone_public_feed`](#action-reply_qzone_public_feed) | 空间 | 回复推荐动态的评论或其中某条回复 |  | — | ✅ |
| [`send_qzone_msg`](#action-send_qzone_msg) | 空间 | 发表说说（QQ 空间，支持纯文字或带图；传 images 自动上传；可设置查看权限） |  | — | ✅ |
| [`set_qzone_ban`](#action-set_qzone_ban) | 空间 | 拉黑或解除拉黑某人（修改机器人自身 QQ 空间黑名单；enable=true 拉黑，false 解除） |  | — | ✅ |
| [`set_qzone_msg_right`](#action-set_qzone_msg_right) | 空间 | 修改一条已发说说的查看权限（QQ 空间，按 tid） |  | 需权限 | ✅ |
| [`set_qzone_profile`](#action-set_qzone_profile) | 空间 | 修改当前账号的 QQ 空间名称或说明 |  | — | ✅ |
| [`set_qzone_public_comment_like`](#action-set_qzone_public_comment_like) | 空间 | 点赞或取消赞推荐动态中的评论或回复 |  | — | ✅ |
| [`set_qzone_public_follow`](#action-set_qzone_public_follow) | 空间 | 蹲或取消蹲推荐动态作者 |  | — | ✅ |
| [`set_qzone_public_like`](#action-set_qzone_public_like) | 空间 | 点赞或取消赞推荐动态 |  | — | ✅ |
| [`set_qzone_public_upvote`](#action-set_qzone_public_upvote) | 空间 | 推或取消推空友爱看动态（独立于普通赞） |  | — | ✅ |
| [`unlike_qzone`](#action-unlike_qzone) | 空间 | 取消对一条说说的点赞（QQ 空间；取消赞端点待真机核实） |  | 需权限 | ✅ |
| [`fetch_face_entity`](#action-fetch_face_entity) | 系统表情 | 按编号查询 QQ 系统表情 | ✔ | — | ✅ |
| [`fetch_super_face_id`](#action-fetch_super_face_id) | 系统表情 | 判断 QQ 系统表情是否使用超级表情格式 | ✔ | — | ✅ |
| [`fetch_sys_faces`](#action-fetch_sys_faces) | 系统表情 | 获取 QQ 系统表情目录 | ✔ | — | ✅ |
| [`search_sys_faces`](#action-search_sys_faces) | 系统表情 | 搜索 QQ 系统表情 | ✔ | — | ✅ |
| [`clean_stream_temp_file`](#action-clean_stream_temp_file) | 流式接口 | 清理流式传输临时文件(仅清理 stream 上传/下载目录) |  | — | ✅ |
| [`download_file_image_stream`](#action-download_file_image_stream) | 流式接口 | 以流式方式下载图片(缓存图片 id / URL / stream 目录本地文件) |  | — | ✅ |
| [`download_file_record_stream`](#action-download_file_record_stream) | 流式接口 | 以流式方式下载语音(缓存语音 id / URL / stream 目录本地文件) |  | — | ✅ |
| [`download_file_stream`](#action-download_file_stream) | 流式接口 | 以流式方式下载文件(stream 目录本地文件 / URL / 缓存媒体) |  | — | ✅ |
| [`test_download_stream`](#action-test_download_stream) | 流式接口 | 测试下载流(推送 10 个数据帧,验证流式传输,不触达 QQ) |  | — | ✅ |
| [`upload_file_stream`](#action-upload_file_stream) | 流式接口 | 以流式分块方式上传文件到机器人本地(返回可用于发送的本地路径) |  | — | ✅ |

### 1.3 九分类对照索引

> ⚠️ **这是便于检索的衍生视图，不是源码分类。**
> 权威分类见 §1.1 与各动作详情。映射规则：源码 12 类为主，
> 少数动作按语义归入更贴切的一类（如 `friend_poke` 归「互动类」）。

| 类别 | 数量 |
| --- | --- |
| 消息类 | 26 |
| 群管理类 | 44 |
| 好友类 | 14 |
| 群文件类 | 27 |
| 账号类 | 7 |
| 多媒体类 | 22 |
| 互动类 | 10 |
| 扩展类 | 45 |
| 系统类 | 27 |
| **合计** | **222** |

#### 消息类（26）

[`add_custom_face`](#action-add_custom_face)、[`click_inline_keyboard_button`](#action-click_inline_keyboard_button)、[`delete_custom_face`](#action-delete_custom_face)、[`delete_msg`](#action-delete_msg)、[`fetch_custom_face`](#action-fetch_custom_face)、[`fetch_custom_face_detail`](#action-fetch_custom_face_detail)、[`get_forward_msg`](#action-get_forward_msg)、[`get_friend_msg_history`](#action-get_friend_msg_history)、[`get_group_msg_history`](#action-get_group_msg_history)、[`get_mini_app_ark`](#action-get_mini_app_ark)、[`get_msg`](#action-get_msg)、[`modify_custom_face`](#action-modify_custom_face)、[`move_custom_face_to_front`](#action-move_custom_face_to_front)、[`send_ark_share`](#action-send_ark_share)、[`send_custom_face`](#action-send_custom_face)、[`send_flash_msg`](#action-send_flash_msg)、[`send_forward_msg`](#action-send_forward_msg)、[`send_group_ark_share`](#action-send_group_ark_share)、[`send_group_forward_msg`](#action-send_group_forward_msg)、[`send_group_msg`](#action-send_group_msg)、[`send_msg`](#action-send_msg)、[`send_private_forward_msg`](#action-send_private_forward_msg)、[`send_private_msg`](#action-send_private_msg)、[`send_tuwen_ark`](#action-send_tuwen_ark)、[`upload_forward_msg`](#action-upload_forward_msg)、[`upload_foward_msg`](#action-upload_foward_msg)

#### 群管理类（44）

[`_del_group_notice`](#action-_del_group_notice)、[`_get_group_notice`](#action-_get_group_notice)、[`_send_group_notice`](#action-_send_group_notice)、[`add_group_tag`](#action-add_group_tag)、[`cancel_group_todo`](#action-cancel_group_todo)、[`complete_group_todo`](#action-complete_group_todo)、[`delete_group_tag`](#action-delete_group_tag)、[`get_group_admin_permissions`](#action-get_group_admin_permissions)、[`get_group_admin_settings`](#action-get_group_admin_settings)、[`get_group_at_all_remain`](#action-get_group_at_all_remain)、[`get_group_honor_info`](#action-get_group_honor_info)、[`get_group_ignore_add_request`](#action-get_group_ignore_add_request)、[`get_group_ignored_notifies`](#action-get_group_ignored_notifies)、[`get_group_info`](#action-get_group_info)、[`get_group_list`](#action-get_group_list)、[`get_group_member_info`](#action-get_group_member_info)、[`get_group_member_list`](#action-get_group_member_list)、[`get_group_share_link`](#action-get_group_share_link)、[`get_group_signed_list`](#action-get_group_signed_list)、[`get_group_system_msg`](#action-get_group_system_msg)、[`get_group_tags`](#action-get_group_tags)、[`get_group_todo_list`](#action-get_group_todo_list)、[`set_group_add_option`](#action-set_group_add_option)、[`set_group_admin`](#action-set_group_admin)、[`set_group_admin_permissions`](#action-set_group_admin_permissions)、[`set_group_admin_receive_verify`](#action-set_group_admin_receive_verify)、[`set_group_anonymous`](#action-set_group_anonymous)、[`set_group_anonymous_ban`](#action-set_group_anonymous_ban)、[`set_group_ban`](#action-set_group_ban)、[`set_group_card`](#action-set_group_card)、[`set_group_kick`](#action-set_group_kick)、[`set_group_kick_members`](#action-set_group_kick_members)、[`set_group_leave`](#action-set_group_leave)、[`set_group_member_invite_policy`](#action-set_group_member_invite_policy)、[`set_group_member_permissions`](#action-set_group_member_permissions)、[`set_group_name`](#action-set_group_name)、[`set_group_new_member_history_visibility`](#action-set_group_new_member_history_visibility)、[`set_group_portrait`](#action-set_group_portrait)、[`set_group_robot_add_option`](#action-set_group_robot_add_option)、[`set_group_search`](#action-set_group_search)、[`set_group_special_title`](#action-set_group_special_title)、[`set_group_todo`](#action-set_group_todo)、[`set_group_whole_ban`](#action-set_group_whole_ban)、[`share_group_ex`](#action-share_group_ex)

#### 好友类（14）

[`_get_friend_dress`](#action-_get_friend_dress)、[`delete_friend`](#action-delete_friend)、[`get_doubt_friends_add_request`](#action-get_doubt_friends_add_request)、[`get_friend_list`](#action-get_friend_list)、[`get_friends_with_category`](#action-get_friends_with_category)、[`get_recent_contact`](#action-get_recent_contact)、[`get_stranger_info`](#action-get_stranger_info)、[`get_unidirectional_friend_list`](#action-get_unidirectional_friend_list)、[`set_doubt_friends_add_request`](#action-set_doubt_friends_add_request)、[`set_friend_add_request`](#action-set_friend_add_request)、[`set_friend_remark`](#action-set_friend_remark)、[`set_friends_category`](#action-set_friends_category)、[`set_group_add_request`](#action-set_group_add_request)、[`share_peer`](#action-share_peer)

#### 群文件类（27）

[`create_flash_task`](#action-create_flash_task)、[`create_group_file_folder`](#action-create_group_file_folder)、[`delete_flash_file`](#action-delete_flash_file)、[`delete_group_file`](#action-delete_group_file)、[`delete_group_file_folder`](#action-delete_group_file_folder)、[`delete_group_folder`](#action-delete_group_folder)、[`download_file`](#action-download_file)、[`download_fileset`](#action-download_fileset)、[`get_file`](#action-get_file)、[`get_fileset_id`](#action-get_fileset_id)、[`get_fileset_info`](#action-get_fileset_info)、[`get_flash_file_list`](#action-get_flash_file_list)、[`get_flash_file_url`](#action-get_flash_file_url)、[`get_group_file_system_info`](#action-get_group_file_system_info)、[`get_group_file_url`](#action-get_group_file_url)、[`get_group_files_by_folder`](#action-get_group_files_by_folder)、[`get_group_root_files`](#action-get_group_root_files)、[`get_private_file_url`](#action-get_private_file_url)、[`get_share_link`](#action-get_share_link)、[`list_filesets`](#action-list_filesets)、[`move_group_file`](#action-move_group_file)、[`rename_flash_file`](#action-rename_flash_file)、[`rename_group_file`](#action-rename_group_file)、[`rename_group_file_folder`](#action-rename_group_file_folder)、[`trans_group_file`](#action-trans_group_file)、[`upload_group_file`](#action-upload_group_file)、[`upload_private_file`](#action-upload_private_file)

#### 账号类（7）

[`get_login_info`](#action-get_login_info)、[`set_diy_online_status`](#action-set_diy_online_status)、[`set_input_status`](#action-set_input_status)、[`set_online_status`](#action-set_online_status)、[`set_qq_avatar`](#action-set_qq_avatar)、[`set_qq_profile`](#action-set_qq_profile)、[`set_self_longnick`](#action-set_self_longnick)

#### 多媒体类（22）

[`cancel_group_album_media_like`](#action-cancel_group_album_media_like)、[`del_group_album_media`](#action-del_group_album_media)、[`do_group_album_comment`](#action-do_group_album_comment)、[`download_file_image_stream`](#action-download_file_image_stream)、[`download_file_record_stream`](#action-download_file_record_stream)、[`download_file_stream`](#action-download_file_stream)、[`fetch_ptt_text`](#action-fetch_ptt_text)、[`get_ai_characters`](#action-get_ai_characters)、[`get_ai_record`](#action-get_ai_record)、[`get_group_album_list`](#action-get_group_album_list)、[`get_group_album_media_list`](#action-get_group_album_media_list)、[`get_image`](#action-get_image)、[`get_qun_album_list`](#action-get_qun_album_list)、[`get_record`](#action-get_record)、[`ocr_image`](#action-ocr_image)、[`send_group_ai_record`](#action-send_group_ai_record)、[`set_group_album_media_like`](#action-set_group_album_media_like)、[`test_download_stream`](#action-test_download_stream)、[`translate_en2zh`](#action-translate_en2zh)、[`upload_file_stream`](#action-upload_file_stream)、[`upload_image_to_qun_album`](#action-upload_image_to_qun_album)、[`upload_video_to_qun_album`](#action-upload_video_to_qun_album)

#### 互动类（10）

[`fetch_emoji_like`](#action-fetch_emoji_like)、[`friend_poke`](#action-friend_poke)、[`get_emoji_likes`](#action-get_emoji_likes)、[`get_msg_emoji_likes`](#action-get_msg_emoji_likes)、[`get_profile_like`](#action-get_profile_like)、[`group_poke`](#action-group_poke)、[`send_like`](#action-send_like)、[`send_poke`](#action-send_poke)、[`set_group_reaction`](#action-set_group_reaction)、[`set_msg_emoji_like`](#action-set_msg_emoji_like)

#### 扩展类（45）

[`comment_qzone`](#action-comment_qzone)、[`comment_qzone_public_feed`](#action-comment_qzone_public_feed)、[`create_collection`](#action-create_collection)、[`delete_essence_msg`](#action-delete_essence_msg)、[`delete_qzone_msg`](#action-delete_qzone_msg)、[`delete_qzone_public_comment`](#action-delete_qzone_public_comment)、[`delete_qzone_public_reply`](#action-delete_qzone_public_reply)、[`fetch_face_entity`](#action-fetch_face_entity)、[`fetch_super_face_id`](#action-fetch_super_face_id)、[`fetch_sys_faces`](#action-fetch_sys_faces)、[`forward_friend_single_msg`](#action-forward_friend_single_msg)、[`forward_group_single_msg`](#action-forward_group_single_msg)、[`forward_qzone_public_feed`](#action-forward_qzone_public_feed)、[`get_collection_list`](#action-get_collection_list)、[`get_essence_msg_list`](#action-get_essence_msg_list)、[`get_group_detail_info`](#action-get_group_detail_info)、[`get_group_info_ex`](#action-get_group_info_ex)、[`get_group_shut_list`](#action-get_group_shut_list)、[`get_qzone_feed_detail`](#action-get_qzone_feed_detail)、[`get_qzone_feeds`](#action-get_qzone_feeds)、[`get_qzone_home_feeds`](#action-get_qzone_home_feeds)、[`get_qzone_msg_detail`](#action-get_qzone_msg_detail)、[`get_qzone_msg_list`](#action-get_qzone_msg_list)、[`get_qzone_profile`](#action-get_qzone_profile)、[`get_qzone_public_capabilities`](#action-get_qzone_public_capabilities)、[`get_qzone_public_comments`](#action-get_qzone_public_comments)、[`get_qzone_public_feed_detail`](#action-get_qzone_public_feed_detail)、[`get_qzone_public_feeds`](#action-get_qzone_public_feeds)、[`get_qzone_public_replies`](#action-get_qzone_public_replies)、[`get_qzone_share_ark`](#action-get_qzone_share_ark)、[`like_qzone`](#action-like_qzone)、[`reply_qzone_public_feed`](#action-reply_qzone_public_feed)、[`search_sys_faces`](#action-search_sys_faces)、[`send_qzone_msg`](#action-send_qzone_msg)、[`set_essence_msg`](#action-set_essence_msg)、[`set_group_remark`](#action-set_group_remark)、[`set_group_sign`](#action-set_group_sign)、[`set_qzone_ban`](#action-set_qzone_ban)、[`set_qzone_msg_right`](#action-set_qzone_msg_right)、[`set_qzone_profile`](#action-set_qzone_profile)、[`set_qzone_public_comment_like`](#action-set_qzone_public_comment_like)、[`set_qzone_public_follow`](#action-set_qzone_public_follow)、[`set_qzone_public_like`](#action-set_qzone_public_like)、[`set_qzone_public_upvote`](#action-set_qzone_public_upvote)、[`unlike_qzone`](#action-unlike_qzone)

#### 系统类（27）

[`.get_word_slices`](#action-.get_word_slices)、[`_get_model_show`](#action-_get_model_show)、[`_mark_all_as_read`](#action-_mark_all_as_read)、[`_set_model_show`](#action-_set_model_show)、[`bot_exit`](#action-bot_exit)、[`can_send_image`](#action-can_send_image)、[`can_send_record`](#action-can_send_record)、[`check_url_safely`](#action-check_url_safely)、[`clean_cache`](#action-clean_cache)、[`clean_stream_temp_file`](#action-clean_stream_temp_file)、[`get_clientkey`](#action-get_clientkey)、[`get_cookies`](#action-get_cookies)、[`get_credentials`](#action-get_credentials)、[`get_csrf_token`](#action-get_csrf_token)、[`get_online_clients`](#action-get_online_clients)、[`get_rkey`](#action-get_rkey)、[`get_rkey_server`](#action-get_rkey_server)、[`get_status`](#action-get_status)、[`get_version_info`](#action-get_version_info)、[`mark_group_msg_as_read`](#action-mark_group_msg_as_read)、[`mark_msg_as_read`](#action-mark_msg_as_read)、[`mark_private_msg_as_read`](#action-mark_private_msg_as_read)、[`nc_get_packet_status`](#action-nc_get_packet_status)、[`nc_get_user_status`](#action-nc_get_user_status)、[`request_decrypt_key`](#action-request_decrypt_key)、[`send_packet`](#action-send_packet)、[`set_restart`](#action-set_restart)

### 1.4 快速导航

- [信息](#信息)（5）
- [消息](#消息)（6）
- [好友](#好友)（3）
- [群信息](#群信息)（7）
- [群管理](#群管理)（24）
- [群文件](#群文件)（12）
- [请求](#请求)（2）
- [扩展](#扩展)（115）
- [群相册](#群相册)（9）
- [空间](#空间)（29）
- [系统表情](#系统表情)（4）
- [流式接口](#流式接口)（6）
- [只读动作清单](#只读动作清单)
- [兼容别名](#兼容别名)
- [未实现 / 不支持的动作](#未实现--不支持的动作)
- [需要特殊权限的动作](#需要特殊权限的动作)
- [调用约定与响应格式](#调用约定与响应格式)

---

## 2. 动作详情

## 信息

共 **5** 个动作。

<details><summary>展开目录</summary>

- [`can_send_image`](#action-can_send_image)
- [`can_send_record`](#action-can_send_record)
- [`get_login_info`](#action-get_login_info)
- [`get_status`](#action-get_status)
- [`get_version_info`](#action-get_version_info)

</details>

<a id="action-can_send_image"></a>
### `can_send_image`

只读



**参数**：无

**返回**：能力查询结果。

**示例**

- 基本调用

```json
{
  "action": "can_send_image",
  "params": {}
}
```


<a id="action-can_send_record"></a>
### `can_send_record`

只读



**参数**：无

**返回**：能力查询结果。

**示例**

- 基本调用

```json
{
  "action": "can_send_record",
  "params": {}
}
```


<a id="action-get_login_info"></a>
### `get_login_info`

只读



**参数**：无

**返回**：当前登录账号的 QQ 号与昵称。

**示例**

- 基本调用

```json
{
  "action": "get_login_info",
  "params": {}
}
```


<a id="action-get_status"></a>
### `get_status`

只读



**参数**：无

**返回**：运行状态。`online` 表示账号在线；`good` 表示已确认的收发链路健康状态；`time` 为当前账号服务实例运行秒数，与 #Haizakura 同源。

**示例**

- 基本调用

```json
{
  "action": "get_status",
  "params": {}
}
```


<a id="action-get_version_info"></a>
### `get_version_info`

只读



**参数**：无

**返回**：实现与协议版本信息。

**示例**

- 基本调用

```json
{
  "action": "get_version_info",
  "params": {}
}
```


## 消息

共 **6** 个动作。

<details><summary>展开目录</summary>

- [`delete_msg`](#action-delete_msg)
- [`get_msg`](#action-get_msg)
- [`send_custom_face`](#action-send_custom_face)
- [`send_group_msg`](#action-send_group_msg)
- [`send_msg`](#action-send_msg)
- [`send_private_msg`](#action-send_private_msg)

</details>

<a id="action-delete_msg"></a>
### `delete_msg`

有副作用

撤回消息

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `message_id` | messageId | ✔ | （源码未标注说明，类型见左栏） |

**返回**：null

**示例**

- 撤回消息

```json
{
  "action": "delete_msg",
  "params": {
    "message_id": -123456
  }
}
```

> 使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。


<a id="action-get_msg"></a>
### `get_msg`

只读

获取消息

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `message_id` | messageId | ✔ | （源码未标注说明，类型见左栏） |

**返回**：消息事件对象（去除 post_type/self_id，附带 real_id）；逐个尝试刷新图片、语音和视频 URL，成功使用新地址，失败保留该段原地址并继续返回消息；地址更新时同步 raw_message。

**示例**

- 获取消息

```json
{
  "action": "get_msg",
  "params": {
    "message_id": -123456
  }
}
```

> 使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。


<a id="action-send_custom_face"></a>
### `send_custom_face`

有副作用

发送账号收藏表情（emoji_id 或 MD5），保留表情显示样式

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `emoji_id` | string | ✔ | 当前账号收藏表情的完整 ID 或 32 位 MD5 |
| `group_id` | uint | — | 目标群号；与 user_id 二选一（min 1） |
| `user_id` | uint | — | 目标 QQ 号；与 group_id 二选一（min 1） |
| `reply_to` | messageId | — | 可选回复消息 ID |

**返回**：{ message_id: number }

**示例**

- 发送账号收藏表情（emoji_id 或 MD5），保留表情显示样式

```json
{
  "action": "send_custom_face",
  "params": {
    "group_id": 20001,
    "emoji_id": "<emoji-id-from-fetch_custom_face_detail>"
  }
}
```

> 群聊和私聊目标只能提供一个；emoji_id 来自 fetch_custom_face_detail。


<a id="action-send_group_msg"></a>
### `send_group_msg`

有副作用

发送群消息

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `message` | message | ✔ | OneBot message: string \| segment[] \| object. In segment arrays, text segments whose text field is exactly "" are compatibility placeholders and do not count as sendable segments; missing, null, and whitespace-only text remain subject to normal validation. |
| `auto_escape` | bool | — | （源码未标注说明，类型见左栏）；默认 `false` |

**返回**：{ message_id: number }

**示例**

- 发送群消息

```json
{
  "action": "send_group_msg",
  "params": {
    "group_id": 20001,
    "message": [
      {
        "type": "text",
        "data": {
          "text": "你好"
        }
      }
    ]
  }
}
```

> 替换目标群号；成功返回的 message_id 可为负值。


<a id="action-send_msg"></a>
### `send_msg`

有副作用

发送消息（按 message_type/群号 自动路由群聊或私聊）

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `message` | message | ✔ | OneBot message: string \| segment[] \| object. In segment arrays, text segments whose text field is exactly "" are compatibility placeholders and do not count as sendable segments; missing, null, and whitespace-only text remain subject to normal validation. |
| `message_type` | string | — | （源码未标注说明，类型见左栏） |
| `group_id` | uint | — | （源码未标注说明，类型见左栏）（min 1） |
| `user_id` | uint | — | （源码未标注说明，类型见左栏）（min 1） |
| `auto_escape` | bool | — | （源码未标注说明，类型见左栏）；默认 `false` |

**返回**：{ message_id: number }

**示例**

- 发送消息（按 message_type/群号 自动路由群聊或私聊）

```json
{
  "action": "send_msg",
  "params": {
    "message_type": "group",
    "group_id": 20001,
    "message": "你好"
  }
}
```

> 必须提供对应目标；私聊使用 message_type=private 和 user_id。


<a id="action-send_private_msg"></a>
### `send_private_msg`

有副作用

发送私聊消息

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `user_id` | uint | ✔ | （源码未标注说明，类型见左栏）（min 1） |
| `message` | message | ✔ | OneBot message: string \| segment[] \| object. In segment arrays, text segments whose text field is exactly "" are compatibility placeholders and do not count as sendable segments; missing, null, and whitespace-only text remain subject to normal validation. |
| `group_id` | int | — | （源码未标注说明，类型见左栏）（min 0） |
| `auto_escape` | bool | — | （源码未标注说明，类型见左栏）；默认 `false` |

**返回**：{ message_id: number }

**示例**

- 发送私聊消息

```json
{
  "action": "send_private_msg",
  "params": {
    "user_id": 10001,
    "message": "你好"
  }
}
```

> 替换目标好友 QQ 号；临时会话需另传来源 group_id。


## 好友

共 **3** 个动作。

<details><summary>展开目录</summary>

- [`delete_friend`](#action-delete_friend)
- [`get_friend_list`](#action-get_friend_list)
- [`get_stranger_info`](#action-get_stranger_info)

</details>

<a id="action-delete_friend"></a>
### `delete_friend`

有副作用

删除好友

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `user_id` | uint | ✔ | QQ 号（min 1） |
| `block` | bool | — | （源码未标注说明，类型见左栏）；默认 `false` |

**返回**：null

**示例**

- 删除好友

```json
{
  "action": "delete_friend",
  "params": {
    "user_id": 10001,
    "block": false
  }
}
```

> 会删除指定好友；仅在明确需要删除时调用。


<a id="action-get_friend_list"></a>
### `get_friend_list`

只读

获取好友列表

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `with_profile` | bool | — | 主动补查好友公开资料，按账号缓存五分钟；大列表可能耗时较长；默认 `false` |

**返回**：好友列表，包含账号、昵称、备注及回包已有的公开资料；with_profile=true 时主动补查，失败会报错。未返回的资料省略，零、空字符串和 false 保留。

**示例**

- 获取好友列表

```json
{
  "action": "get_friend_list",
  "params": {}
}
```


<a id="action-get_stranger_info"></a>
### `get_stranger_info`

只读

获取陌生人信息

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `user_id` | uint | ✔ | QQ 号（min 1） |

**返回**：用户资料，含账号标识、等级别名和可用的注册时间、生日、会员信息。注册时间、生日或会员信息未返回时省略对应字段，出生年份未公开时只省略年份；登录天数暂无可靠来源，不返回占位值。

**示例**

- 获取陌生人信息

```json
{
  "action": "get_stranger_info",
  "params": {
    "user_id": 10001
  }
}
```

> 替换为需要查询的 QQ 号。


## 群信息

共 **7** 个动作。

<details><summary>展开目录</summary>

- [`get_group_honor_info`](#action-get_group_honor_info)
- [`get_group_info`](#action-get_group_info)
- [`get_group_list`](#action-get_group_list)
- [`get_group_member_info`](#action-get_group_member_info)
- [`get_group_member_list`](#action-get_group_member_list)
- [`get_group_share_link`](#action-get_group_share_link)
- [`get_group_system_msg`](#action-get_group_system_msg)

</details>

<a id="action-get_group_honor_info"></a>
### `get_group_honor_info`

只读

获取群荣誉信息

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `type` | string | — | （源码未标注说明，类型见左栏） |

**返回**：object（`group_id`, `current_talkative`, `talkative_list`, `performer_list`, `legend_list`, `emotion_list`, `strong_newbie_list`）

**示例**

- 获取群荣誉信息

```json
{
  "action": "get_group_honor_info",
  "params": {
    "group_id": 20001,
    "type": "all"
  }
}
```

> 未请求的分类仍返回空数组；当前龙王可能为 null。


<a id="action-get_group_info"></a>
### `get_group_info`

只读

获取群信息

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `no_cache` | bool | — | （源码未标注说明，类型见左栏）；默认 `false` |

**返回**：群信息对象。

**示例**

- 获取群信息

```json
{
  "action": "get_group_info",
  "params": {
    "group_id": 20001
  }
}
```

> 将 group_id 替换为当前账号可访问的群号。


<a id="action-get_group_list"></a>
### `get_group_list`

只读

获取群列表

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `no_cache` | bool | — | （源码未标注说明，类型见左栏）；默认 `false` |

**返回**：群信息对象数组。

**示例**

- 获取群列表

```json
{
  "action": "get_group_list",
  "params": {
    "no_cache": false
  }
}
```


<a id="action-get_group_member_info"></a>
### `get_group_member_info`

只读

获取群成员信息

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `user_id` | uint | ✔ | QQ 号（min 1） |
| `no_cache` | bool | — | （源码未标注说明，类型见左栏）；默认 `false` |

**返回**：群成员信息对象。

**示例**

- 获取群成员信息

```json
{
  "action": "get_group_member_info",
  "params": {
    "group_id": 20001,
    "user_id": 10001
  }
}
```

> 将 group_id 替换为当前账号可访问的群号。


<a id="action-get_group_member_list"></a>
### `get_group_member_list`

只读

获取群成员列表

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `no_cache` | bool | — | （源码未标注说明，类型见左栏）；默认 `false` |

**返回**：群成员信息对象数组。

**示例**

- 获取群成员列表

```json
{
  "action": "get_group_member_list",
  "params": {
    "group_id": 20001
  }
}
```

> 将 group_id 替换为当前账号可访问的群号。


<a id="action-get_group_share_link"></a>
### `get_group_share_link`

只读

获取群分享链接

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `need_short_url` | bool | — | 是否获取短链接；默认 `true` |
| `src_id` | int | — | 来源标识（兼容参数）；默认 `73`（min 0, max 4294967295） |
| `additional_param` | string | — | 附加参数；默认 `` |

**返回**：用于分享或邀请加群的链接，可作为群二维码内容。

**示例**

- 获取群分享链接

```json
{
  "action": "get_group_share_link",
  "params": {
    "group_id": 20001,
    "need_short_url": true
  }
}
```

> 将 group_id 替换为当前账号可访问的群号。


<a id="action-get_group_system_msg"></a>
### `get_group_system_msg`

只读

获取群系统消息

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | — | （源码未标注说明，类型见左栏）（min 1） |
| `only_pending` | bool | — | （源码未标注说明，类型见左栏）；默认 `false` |
| `count` | int | — | 每个收件箱最多读取的记录数；默认 `50`（min 1, max 100） |

**返回**：群系统消息数组，可按群号或未处理状态过滤。

**示例**

- 获取群系统消息

```json
{
  "action": "get_group_system_msg",
  "params": {
    "group_id": 20001,
    "only_pending": true,
    "count": 20
  }
}
```

> 将 group_id 替换为当前账号可访问的群号。


## 群管理

共 **24** 个动作。

<details><summary>展开目录</summary>

- [`add_group_tag`](#action-add_group_tag)
- [`delete_group_tag`](#action-delete_group_tag)
- [`get_group_admin_permissions`](#action-get_group_admin_permissions)
- [`get_group_admin_settings`](#action-get_group_admin_settings)
- [`get_group_tags`](#action-get_group_tags)
- [`set_group_add_option`](#action-set_group_add_option)
- [`set_group_admin`](#action-set_group_admin)
- [`set_group_admin_permissions`](#action-set_group_admin_permissions)
- [`set_group_admin_receive_verify`](#action-set_group_admin_receive_verify)
- [`set_group_anonymous`](#action-set_group_anonymous) ⚠️
- [`set_group_anonymous_ban`](#action-set_group_anonymous_ban) ⚠️
- [`set_group_ban`](#action-set_group_ban)
- [`set_group_card`](#action-set_group_card)
- [`set_group_kick`](#action-set_group_kick)
- [`set_group_kick_members`](#action-set_group_kick_members)
- [`set_group_leave`](#action-set_group_leave)
- [`set_group_member_invite_policy`](#action-set_group_member_invite_policy)
- [`set_group_member_permissions`](#action-set_group_member_permissions)
- [`set_group_name`](#action-set_group_name)
- [`set_group_new_member_history_visibility`](#action-set_group_new_member_history_visibility)
- [`set_group_portrait`](#action-set_group_portrait)
- [`set_group_search`](#action-set_group_search)
- [`set_group_special_title`](#action-set_group_special_title)
- [`set_group_whole_ban`](#action-set_group_whole_ban)

</details>

<a id="action-add_group_tag"></a>
### `add_group_tag`

有副作用

向某个群分类添加资料标签

> **权限**：替换实际群分类和标签；需要当前账号有管理权限。

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_class` | int | ✔ | （源码未标注说明，类型见左栏）（min 0, max 4294967295） |
| `name` | string | ✔ | （源码未标注说明，类型见左栏） |

**返回**：null

**示例**

- 向某个群分类添加资料标签

```json
{
  "action": "add_group_tag",
  "params": {
    "group_class": 1,
    "name": "学习"
  }
}
```

> 替换实际群分类和标签；需要当前账号有管理权限。


<a id="action-delete_group_tag"></a>
### `delete_group_tag`

有副作用

从某个群分类移除资料标签

> **权限**：替换实际群分类和标签；需要当前账号有管理权限。

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_class` | int | ✔ | （源码未标注说明，类型见左栏）（min 0, max 4294967295） |
| `name` | string | ✔ | （源码未标注说明，类型见左栏） |

**返回**：null

**示例**

- 从某个群分类移除资料标签

```json
{
  "action": "delete_group_tag",
  "params": {
    "group_class": 1,
    "name": "学习"
  }
}
```

> 替换实际群分类和标签；需要当前账号有管理权限。


<a id="action-get_group_admin_permissions"></a>
### `get_group_admin_permissions`

只读

读取指定管理员的撤回、移除成员、每日移除上限及接收验证消息状态

> **权限**：user_id 为目标管理员 QQ 号；包含接收加群验证消息状态。

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `user_id` | uint | ✔ | QQ 号（min 1） |

**返回**：服务器返回的管理员权限；未返回或未指定的开关为 null。每日上限仅在移除权限开启时返回，0 表示不限。

**示例**

- 读取管理员权限

```json
{
  "action": "get_group_admin_permissions",
  "params": {
    "group_id": 20001,
    "user_id": 10001
  }
}
```

> user_id 为目标管理员 QQ 号；包含接收加群验证消息状态。


<a id="action-get_group_admin_settings"></a>
### `get_group_admin_settings`

只读

获取群管理设置的当前值

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |

**返回**：与对应设置接口字段对齐的当前群管理设置。

**示例**

- 获取群管理设置的当前值

```json
{
  "action": "get_group_admin_settings",
  "params": {
    "group_id": 20001
  }
}
```

> 将 group_id 替换为当前账号可访问的群号。


<a id="action-get_group_tags"></a>
### `get_group_tags`

只读

读取某个群分类下的资料标签

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_class` | int | ✔ | （源码未标注说明，类型见左栏）（min 0, max 4294967295） |

**返回**：该分类下的资料标签列表。

**示例**

- 读取某个群分类下的资料标签

```json
{
  "action": "get_group_tags",
  "params": {
    "group_class": 1
  }
}
```

> group_class 使用实际群分类编号。


<a id="action-set_group_add_option"></a>
### `set_group_add_option`

有副作用

设置加群选项

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `add_type` | int | — | （源码未标注说明，类型见左栏）；默认 `0`（min 0） |
| `group_question` | string | — | （源码未标注说明，类型见左栏） |
| `group_answer` | string | — | （源码未标注说明，类型见左栏） |

**返回**：null

**示例**

- 设置加群选项

```json
{
  "action": "set_group_add_option",
  "params": {
    "group_id": 20001,
    "add_type": 2,
    "group_question": "入群用途？",
    "group_answer": "学习交流"
  }
}
```

> 修改加群设置前先用 get_group_admin_settings 查看当前状态，并确认目标设置值。


<a id="action-set_group_admin"></a>
### `set_group_admin`

有副作用

设置/取消管理员

> **权限**：需要群主权限；会授予该成员管理员身份。

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `user_id` | uint | ✔ | QQ 号（min 1） |
| `enable` | bool | — | （源码未标注说明，类型见左栏）；默认 `true` |

**返回**：null

**示例**

- 设置/取消管理员

```json
{
  "action": "set_group_admin",
  "params": {
    "group_id": 20001,
    "user_id": 10001,
    "enable": true
  }
}
```

> 需要群主权限；会授予该成员管理员身份。


<a id="action-set_group_admin_permissions"></a>
### `set_group_admin_permissions`

有副作用

设置指定管理员的撤回和移除成员权限

> **权限**：需要当前账号具有修改权限；不会授予管理员角色。仅修改显式字段。开启移除必须提供上限，0 表示不限；修改上限需同时传 kick_member=true。

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `user_id` | uint | ✔ | QQ 号（min 1） |
| `recall_member_message` | bool | — | （源码未标注说明，类型见左栏） |
| `kick_member` | bool | — | （源码未标注说明，类型见左栏） |
| `kick_member_per_day` | int | — | （源码未标注说明，类型见左栏）（min 0, max 200） |

**返回**：null

**约束**

- at least one of: recall_member_message, kick_member
- kick_member=true requires kick_member_per_day: 0, 5, 10, 20, 50, 100 or 200
- kick_member_per_day requires kick_member=true

**示例**

- 允许管理员每日移除至多 10 人

```json
{
  "action": "set_group_admin_permissions",
  "params": {
    "group_id": 20001,
    "user_id": 10001,
    "kick_member": true,
    "kick_member_per_day": 10
  }
}
```

> 需要当前账号具有修改权限；不会授予管理员角色。仅修改显式字段。开启移除必须提供上限，0 表示不限；修改上限需同时传 kick_member=true。


<a id="action-set_group_admin_receive_verify"></a>
### `set_group_admin_receive_verify`

有副作用

设置指定管理员是否接收加群验证消息

> **权限**：user_id 为目标管理员 QQ 号；需要当前账号具有修改权限。独立于撤回和移除成员权限。

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `user_id` | uint | ✔ | QQ 号（min 1） |
| `enable` | bool | ✔ | （源码未标注说明，类型见左栏） |

**返回**：null

**示例**

- 开启接收验证消息

```json
{
  "action": "set_group_admin_receive_verify",
  "params": {
    "group_id": 20001,
    "user_id": 10001,
    "enable": true
  }
}
```

> user_id 为目标管理员 QQ 号；需要当前账号具有修改权限。独立于撤回和移除成员权限。


<a id="action-set_group_anonymous"></a>
### `set_group_anonymous`

有副作用　⚠️ **未实现 / 不支持**

匿名开关（未实现，返回 ok）

**参数**：无

**返回**：null

**示例**

- 匿名开关（未实现，返回 ok）

```json
{
  "action": "set_group_anonymous",
  "params": {}
}
```

> 兼容占位接口：当前返回成功但不会修改匿名设置。


<a id="action-set_group_anonymous_ban"></a>
### `set_group_anonymous_ban`

有副作用　⚠️ **未实现 / 不支持**

匿名禁言（未实现，返回 ok）

**参数**：无

**返回**：null

**示例**

- 匿名禁言（未实现，返回 ok）

```json
{
  "action": "set_group_anonymous_ban",
  "params": {}
}
```

> 兼容占位接口：当前返回成功但不会修改匿名设置。


<a id="action-set_group_ban"></a>
### `set_group_ban`

有副作用

禁言群成员（duration=0 解除）

> **权限**：替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。 duration 为秒，0 表示解除禁言。

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `user_id` | uint | ✔ | QQ 号（min 1） |
| `duration` | int | — | （源码未标注说明，类型见左栏）；默认 `1800`（min 0） |

**返回**：null

**示例**

- 禁言群成员（duration=0 解除）

```json
{
  "action": "set_group_ban",
  "params": {
    "group_id": 20001,
    "user_id": 10001,
    "duration": 600
  }
}
```

> 替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。 duration 为秒，0 表示解除禁言。


<a id="action-set_group_card"></a>
### `set_group_card`

有副作用

设置群名片（空字符串清除）

> **权限**：替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `user_id` | uint | ✔ | QQ 号（min 1） |
| `card` | string | — | （源码未标注说明，类型见左栏）；默认 `` |

**返回**：null

**示例**

- 设置群名片（空字符串清除）

```json
{
  "action": "set_group_card",
  "params": {
    "group_id": 20001,
    "user_id": 10001,
    "card": "示例群名片"
  }
}
```

> 替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。


<a id="action-set_group_kick"></a>
### `set_group_kick`

有副作用

踢出群成员

> **权限**：替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `user_id` | uint | ✔ | QQ 号（min 1） |
| `reject_add_request` | bool | — | （源码未标注说明，类型见左栏）；默认 `false` |

**返回**：null

**示例**

- 踢出群成员

```json
{
  "action": "set_group_kick",
  "params": {
    "group_id": 20001,
    "user_id": 10001,
    "reject_add_request": false
  }
}
```

> 替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。


<a id="action-set_group_kick_members"></a>
### `set_group_kick_members`

有副作用

批量踢出群成员

> **权限**：替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `user_id` | uint[] | ✔ | （源码未标注说明，类型见左栏） |
| `reject_add_request` | bool | — | （源码未标注说明，类型见左栏）；默认 `false` |

**返回**：null

**示例**

- 批量踢出群成员

```json
{
  "action": "set_group_kick_members",
  "params": {
    "group_id": 20001,
    "user_id": [
      10001,
      10002
    ],
    "reject_add_request": false
  }
}
```

> 替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。


<a id="action-set_group_leave"></a>
### `set_group_leave`

有副作用

退群

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |

**返回**：null

**示例**

- 退群

```json
{
  "action": "set_group_leave",
  "params": {
    "group_id": 20001
  }
}
```

> 会退出该群，请确认目标群号后调用。


<a id="action-set_group_member_invite_policy"></a>
### `set_group_member_invite_policy`

有副作用

设置群成员邀请策略

> **权限**：替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `policy` | enum | ✔ | （源码未标注说明，类型见左栏）；可选 `disabled`、`require_approval`、`no_approval`、`no_approval_under_100` |

**返回**：null

**示例**

- 设置群成员邀请策略

```json
{
  "action": "set_group_member_invite_policy",
  "params": {
    "group_id": 20001,
    "policy": "require_approval"
  }
}
```

> 替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。


<a id="action-set_group_member_permissions"></a>
### `set_group_member_permissions`

有副作用

设置群成员权限（仅群主可改）

> **权限**：至少传一个权限字段；仅修改传入的权限，其余保持原样。

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `allow_member_upload_album` | bool | — | （源码未标注说明，类型见左栏） |
| `allow_member_temporary_session` | bool | — | （源码未标注说明，类型见左栏） |
| `allow_member_create_group` | bool | — | （源码未标注说明，类型见左栏） |

**返回**：null

**约束**

- at least one of: allow_member_upload_album, allow_member_temporary_session, allow_member_create_group

**示例**

- 设置群成员权限（仅群主可改）

```json
{
  "action": "set_group_member_permissions",
  "params": {
    "group_id": 20001,
    "allow_member_upload_album": false
  }
}
```

> 至少传一个权限字段；仅修改传入的权限，其余保持原样。


<a id="action-set_group_name"></a>
### `set_group_name`

有副作用

设置群名

> **权限**：替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `group_name` | string | — | （源码未标注说明，类型见左栏）；默认 `` |

**返回**：null

**示例**

- 设置群名

```json
{
  "action": "set_group_name",
  "params": {
    "group_id": 20001,
    "group_name": "学习交流群"
  }
}
```

> 替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。


<a id="action-set_group_new_member_history_visibility"></a>
### `set_group_new_member_history_visibility`

有副作用

设置新成员是否可查看历史消息

> **权限**：替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `visible` | bool | ✔ | （源码未标注说明，类型见左栏） |

**返回**：null

**示例**

- 设置新成员是否可查看历史消息

```json
{
  "action": "set_group_new_member_history_visibility",
  "params": {
    "group_id": 20001,
    "visible": true
  }
}
```

> 替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。


<a id="action-set_group_portrait"></a>
### `set_group_portrait`

有副作用

设置群头像

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `file` | string | ✔ | （源码未标注说明，类型见左栏） |

**返回**：null

**示例**

- 设置群头像

```json
{
  "action": "set_group_portrait",
  "params": {
    "group_id": 20001,
    "file": "file:///path/to/avatar.png"
  }
}
```

> 示例路径位于 Haizakura 服务端，须替换为该服务可读取的实际文件。


<a id="action-set_group_search"></a>
### `set_group_search`

有副作用

设置群被搜索方式（群指纹 / 群号搜索开关）

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `no_finger_open` | int | — | （源码未标注说明，类型见左栏）（min 0） |
| `no_code_finger_open` | int | — | （源码未标注说明，类型见左栏）（min 0） |

**返回**：null

**示例**

- 设置群被搜索方式（群指纹 / 群号搜索开关）

```json
{
  "action": "set_group_search",
  "params": {
    "group_id": 20001,
    "no_finger_open": 0,
    "no_code_finger_open": 0
  }
}
```

> 替换群号；数值含义以当前群设置为准。


<a id="action-set_group_special_title"></a>
### `set_group_special_title`

有副作用

设置群头衔

> **权限**：替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `user_id` | uint | ✔ | QQ 号（min 1） |
| `special_title` | string | — | （源码未标注说明，类型见左栏）；默认 `` |

**返回**：null

**示例**

- 设置群头衔

```json
{
  "action": "set_group_special_title",
  "params": {
    "group_id": 20001,
    "user_id": 10001,
    "special_title": "学习委员"
  }
}
```

> 替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。


<a id="action-set_group_whole_ban"></a>
### `set_group_whole_ban`

有副作用

全员禁言开关

> **权限**：替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `enable` | bool | — | （源码未标注说明，类型见左栏）；默认 `true` |

**返回**：null

**示例**

- 全员禁言开关

```json
{
  "action": "set_group_whole_ban",
  "params": {
    "group_id": 20001,
    "enable": true
  }
}
```

> 替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。


## 群文件

共 **12** 个动作。

<details><summary>展开目录</summary>

- [`create_group_file_folder`](#action-create_group_file_folder)
- [`delete_group_file`](#action-delete_group_file)
- [`delete_group_file_folder`](#action-delete_group_file_folder)
- [`get_group_file_url`](#action-get_group_file_url)
- [`get_group_files_by_folder`](#action-get_group_files_by_folder)
- [`get_group_root_files`](#action-get_group_root_files)
- [`get_private_file_url`](#action-get_private_file_url)
- [`move_group_file`](#action-move_group_file)
- [`rename_group_file`](#action-rename_group_file)
- [`rename_group_file_folder`](#action-rename_group_file_folder)
- [`upload_group_file`](#action-upload_group_file)
- [`upload_private_file`](#action-upload_private_file)

</details>

<a id="action-create_group_file_folder"></a>
### `create_group_file_folder`

有副作用

创建群文件夹

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `name` | string | ✔ | （源码未标注说明，类型见左栏） |
| `parent_id` | string | — | （源码未标注说明，类型见左栏）；默认 `/` |

**返回**：{ result: { retCode, retMsg }, groupItem: { folderInfo: { folderId, folderName, folderPath, createTime, modifyTime, createUin, modifyUin } } }

**示例**

- 创建群文件夹

```json
{
  "action": "create_group_file_folder",
  "params": {
    "group_id": 20001,
    "name": "共享资料",
    "parent_id": "/"
  }
}
```

> 将 group_id 替换为当前账号可访问的群号。


<a id="action-delete_group_file"></a>
### `delete_group_file`

有副作用

删除群文件

> **权限**：替换群文件列表中的实际 file_id；需要对应文件操作权限。

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `file_id` | string | ✔ | （源码未标注说明，类型见左栏） |

**返回**：null

**示例**

- 删除群文件

```json
{
  "action": "delete_group_file",
  "params": {
    "group_id": 20001,
    "file_id": "<file-id-from-get_group_root_files>"
  }
}
```

> 替换群文件列表中的实际 file_id；需要对应文件操作权限。


<a id="action-delete_group_file_folder"></a>
### `delete_group_file_folder`

有副作用

删除群文件夹

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `folder_id` | string | ✔ | （源码未标注说明，类型见左栏） |

**返回**：null

**示例**

- 删除群文件夹

```json
{
  "action": "delete_group_file_folder",
  "params": {
    "group_id": 20001,
    "folder_id": "<folder-id-from-get_group_root_files>"
  }
}
```

> 会删除指定群文件夹，确认资源后调用。


<a id="action-get_group_file_url"></a>
### `get_group_file_url`

只读

获取群文件下载链接

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `file_id` | string | ✔ | （源码未标注说明，类型见左栏） |
| `busid` | raw | — | （源码未标注说明，类型见左栏） |

**返回**：群文件下载链接。

**示例**

- 获取群文件下载链接

```json
{
  "action": "get_group_file_url",
  "params": {
    "group_id": 20001,
    "file_id": "<file-id-from-get_group_root_files>"
  }
}
```

> 将 group_id 替换为当前账号可访问的群号。


<a id="action-get_group_files_by_folder"></a>
### `get_group_files_by_folder`

只读

获取群子目录文件列表

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `folder_id` | string | — | （源码未标注说明，类型见左栏）；默认 `` |
| `folder` | string | — | （源码未标注说明，类型见左栏）；默认 `` |

**返回**：群文件系统信息（文件与文件夹列表）。

**示例**

- 获取群子目录文件列表

```json
{
  "action": "get_group_files_by_folder",
  "params": {
    "group_id": 20001,
    "folder_id": "<folder-id-from-get_group_root_files>"
  }
}
```

> 将 group_id 替换为当前账号可访问的群号。


<a id="action-get_group_root_files"></a>
### `get_group_root_files`

只读

获取群根目录文件列表

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |

**返回**：群文件系统信息（文件与文件夹列表）。

**示例**

- 获取群根目录文件列表

```json
{
  "action": "get_group_root_files",
  "params": {
    "group_id": 20001
  }
}
```

> 将 group_id 替换为当前账号可访问的群号。


<a id="action-get_private_file_url"></a>
### `get_private_file_url`

只读

获取私聊文件下载链接

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `user_id` | uint | — | （源码未标注说明，类型见左栏）（min 1） |
| `file_id` | string | ✔ | （源码未标注说明，类型见左栏） |
| `file_hash` | string | — | （源码未标注说明，类型见左栏）；默认 `` |

**返回**：私聊文件下载链接。

**示例**

- 获取私聊文件下载链接

```json
{
  "action": "get_private_file_url",
  "params": {
    "user_id": 10001,
    "file_id": "<file-id-from-private-message>"
  }
}
```

> 使用私聊文件消息段中的 file_id，必要时原样传 file_hash。


<a id="action-move_group_file"></a>
### `move_group_file`

有副作用

移动群文件

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `file_id` | string | ✔ | （源码未标注说明，类型见左栏） |
| `parent_directory` | string | ✔ | （源码未标注说明，类型见左栏） |
| `target_directory` | string | ✔ | （源码未标注说明，类型见左栏） |

**返回**：null

**示例**

- 移动群文件

```json
{
  "action": "move_group_file",
  "params": {
    "group_id": 20001,
    "file_id": "<file-id>",
    "parent_directory": "/",
    "target_directory": "<target-folder-id>"
  }
}
```

> 目录和文件标识均来自该群文件列表。


<a id="action-rename_group_file"></a>
### `rename_group_file`

有副作用

重命名群文件

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `file_id` | string | ✔ | （源码未标注说明，类型见左栏） |
| `current_parent_directory` | string | — | （源码未标注说明，类型见左栏）；默认 `/` |
| `new_name` | string | ✔ | （源码未标注说明，类型见左栏） |

**返回**：object（`ok`）

**示例**

- 重命名群文件

```json
{
  "action": "rename_group_file",
  "params": {
    "group_id": 20001,
    "file_id": "<file-id>",
    "current_parent_directory": "/",
    "new_name": "新文件名.pdf"
  }
}
```

> file_id 来自群文件列表，目录必须是文件当前所在目录。


<a id="action-rename_group_file_folder"></a>
### `rename_group_file_folder`

有副作用

重命名群文件夹

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `folder_id` | string | ✔ | （源码未标注说明，类型见左栏） |
| `new_folder_name` | string | — | （源码未标注说明，类型见左栏）；默认 `` |
| `name` | string | — | （源码未标注说明，类型见左栏）；默认 `` |

**返回**：null

**示例**

- 重命名群文件夹

```json
{
  "action": "rename_group_file_folder",
  "params": {
    "group_id": 20001,
    "folder_id": "<folder-id>",
    "new_folder_name": "课程资料"
  }
}
```

> 将 group_id 替换为当前账号可访问的群号。


<a id="action-upload_group_file"></a>
### `upload_group_file`

有副作用

上传群文件

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `file` | string | ✔ | （源码未标注说明，类型见左栏） |
| `name` | string | — | （源码未标注说明，类型见左栏）；默认 `` |
| `folder` | string | — | （源码未标注说明，类型见左栏）；默认 `` |
| `folder_id` | string | — | （源码未标注说明，类型见左栏）；默认 `` |
| `upload_file` | bool | — | （源码未标注说明，类型见左栏）；默认 `true` |

**返回**：{ file_id: string }

**示例**

- 上传群文件

```json
{
  "action": "upload_group_file",
  "params": {
    "group_id": 20001,
    "file": "file:///path/to/report.pdf",
    "name": "报告.pdf"
  }
}
```

> 示例路径位于 Haizakura 服务端，须替换为该服务可读取的实际文件。


<a id="action-upload_private_file"></a>
### `upload_private_file`

有副作用

上传私聊文件

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `user_id` | uint | ✔ | （源码未标注说明，类型见左栏）（min 1） |
| `file` | string | ✔ | （源码未标注说明，类型见左栏） |
| `name` | string | — | （源码未标注说明，类型见左栏）；默认 `` |
| `upload_file` | bool | — | （源码未标注说明，类型见左栏）；默认 `true` |

**返回**：{ file_id: string }

**示例**

- 上传私聊文件

```json
{
  "action": "upload_private_file",
  "params": {
    "user_id": 10001,
    "file": "file:///path/to/report.pdf",
    "name": "报告.pdf"
  }
}
```

> 示例路径位于 Haizakura 服务端，须替换为该服务可读取的实际文件。 默认上传并发送给该好友。


## 请求

共 **2** 个动作。

<details><summary>展开目录</summary>

- [`set_friend_add_request`](#action-set_friend_add_request)
- [`set_group_add_request`](#action-set_group_add_request)

</details>

<a id="action-set_friend_add_request"></a>
### `set_friend_add_request`

有副作用

处理好友添加请求

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `flag` | string | ✔ | （源码未标注说明，类型见左栏） |
| `approve` | bool | — | （源码未标注说明，类型见左栏）；默认 `true` |

**返回**：null

**示例**

- 处理好友添加请求

```json
{
  "action": "set_friend_add_request",
  "params": {
    "flag": "<flag-from-friend-request-event>",
    "approve": true
  }
}
```

> flag 必须原样使用当前账号好友请求事件的 flag，不能根据 QQ 号构造。


<a id="action-set_group_add_request"></a>
### `set_group_add_request`

有副作用

处理加群请求

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `flag` | string | ✔ | （源码未标注说明，类型见左栏） |
| `sub_type` | string | — | （源码未标注说明，类型见左栏） |
| `type` | string | — | （源码未标注说明，类型见左栏） |
| `approve` | bool | — | （源码未标注说明，类型见左栏）；默认 `true` |
| `reason` | string | — | （源码未标注说明，类型见左栏）；默认 `` |

**返回**：null

**示例**

- 处理加群请求

```json
{
  "action": "set_group_add_request",
  "params": {
    "flag": "<flag-from-group-request-event>",
    "sub_type": "add",
    "approve": true
  }
}
```

> flag 和 sub_type 原样取自同一条群请求事件；邀请事件使用 invite。


## 扩展

共 **115** 个动作。

<details><summary>展开目录</summary>

- [`.get_word_slices`](#action-.get_word_slices) ⚠️
- [`_del_group_notice`](#action-_del_group_notice)
- [`_get_friend_dress`](#action-_get_friend_dress)
- [`_get_group_notice`](#action-_get_group_notice)
- [`_get_model_show`](#action-_get_model_show)
- [`_mark_all_as_read`](#action-_mark_all_as_read)
- [`_send_group_notice`](#action-_send_group_notice)
- [`_set_model_show`](#action-_set_model_show)
- [`add_custom_face`](#action-add_custom_face)
- [`bot_exit`](#action-bot_exit)
- [`cancel_group_todo`](#action-cancel_group_todo)
- [`check_url_safely`](#action-check_url_safely)
- [`clean_cache`](#action-clean_cache)
- [`click_inline_keyboard_button`](#action-click_inline_keyboard_button)
- [`complete_group_todo`](#action-complete_group_todo)
- [`create_collection`](#action-create_collection) ⚠️
- [`create_flash_task`](#action-create_flash_task)
- [`delete_custom_face`](#action-delete_custom_face)
- [`delete_essence_msg`](#action-delete_essence_msg)
- [`delete_flash_file`](#action-delete_flash_file)
- [`delete_group_folder`](#action-delete_group_folder)
- [`download_file`](#action-download_file)
- [`download_fileset`](#action-download_fileset)
- [`fetch_custom_face`](#action-fetch_custom_face)
- [`fetch_custom_face_detail`](#action-fetch_custom_face_detail)
- [`fetch_emoji_like`](#action-fetch_emoji_like)
- [`fetch_ptt_text`](#action-fetch_ptt_text)
- [`forward_friend_single_msg`](#action-forward_friend_single_msg)
- [`forward_group_single_msg`](#action-forward_group_single_msg)
- [`friend_poke`](#action-friend_poke)
- [`get_ai_characters`](#action-get_ai_characters)
- [`get_ai_record`](#action-get_ai_record)
- [`get_clientkey`](#action-get_clientkey)
- [`get_collection_list`](#action-get_collection_list)
- [`get_cookies`](#action-get_cookies)
- [`get_credentials`](#action-get_credentials)
- [`get_csrf_token`](#action-get_csrf_token)
- [`get_doubt_friends_add_request`](#action-get_doubt_friends_add_request)
- [`get_emoji_likes`](#action-get_emoji_likes)
- [`get_essence_msg_list`](#action-get_essence_msg_list)
- [`get_file`](#action-get_file)
- [`get_fileset_id`](#action-get_fileset_id)
- [`get_fileset_info`](#action-get_fileset_info)
- [`get_flash_file_list`](#action-get_flash_file_list)
- [`get_flash_file_url`](#action-get_flash_file_url)
- [`get_forward_msg`](#action-get_forward_msg)
- [`get_friend_msg_history`](#action-get_friend_msg_history)
- [`get_friends_with_category`](#action-get_friends_with_category)
- [`get_group_at_all_remain`](#action-get_group_at_all_remain)
- [`get_group_detail_info`](#action-get_group_detail_info)
- [`get_group_file_system_info`](#action-get_group_file_system_info)
- [`get_group_ignore_add_request`](#action-get_group_ignore_add_request)
- [`get_group_ignored_notifies`](#action-get_group_ignored_notifies)
- [`get_group_info_ex`](#action-get_group_info_ex)
- [`get_group_msg_history`](#action-get_group_msg_history)
- [`get_group_shut_list`](#action-get_group_shut_list)
- [`get_group_signed_list`](#action-get_group_signed_list)
- [`get_group_todo_list`](#action-get_group_todo_list)
- [`get_image`](#action-get_image)
- [`get_mini_app_ark`](#action-get_mini_app_ark)
- [`get_msg_emoji_likes`](#action-get_msg_emoji_likes)
- [`get_online_clients`](#action-get_online_clients)
- [`get_profile_like`](#action-get_profile_like)
- [`get_recent_contact`](#action-get_recent_contact)
- [`get_record`](#action-get_record)
- [`get_rkey`](#action-get_rkey)
- [`get_rkey_server`](#action-get_rkey_server)
- [`get_share_link`](#action-get_share_link)
- [`get_unidirectional_friend_list`](#action-get_unidirectional_friend_list)
- [`group_poke`](#action-group_poke)
- [`list_filesets`](#action-list_filesets)
- [`mark_group_msg_as_read`](#action-mark_group_msg_as_read)
- [`mark_msg_as_read`](#action-mark_msg_as_read)
- [`mark_private_msg_as_read`](#action-mark_private_msg_as_read)
- [`modify_custom_face`](#action-modify_custom_face)
- [`move_custom_face_to_front`](#action-move_custom_face_to_front)
- [`nc_get_packet_status`](#action-nc_get_packet_status)
- [`nc_get_user_status`](#action-nc_get_user_status)
- [`ocr_image`](#action-ocr_image)
- [`rename_flash_file`](#action-rename_flash_file)
- [`request_decrypt_key`](#action-request_decrypt_key)
- [`send_ark_share`](#action-send_ark_share)
- [`send_flash_msg`](#action-send_flash_msg)
- [`send_forward_msg`](#action-send_forward_msg)
- [`send_group_ai_record`](#action-send_group_ai_record)
- [`send_group_ark_share`](#action-send_group_ark_share)
- [`send_group_forward_msg`](#action-send_group_forward_msg)
- [`send_like`](#action-send_like)
- [`send_packet`](#action-send_packet)
- [`send_poke`](#action-send_poke)
- [`send_private_forward_msg`](#action-send_private_forward_msg)
- [`send_tuwen_ark`](#action-send_tuwen_ark)
- [`set_diy_online_status`](#action-set_diy_online_status)
- [`set_doubt_friends_add_request`](#action-set_doubt_friends_add_request)
- [`set_essence_msg`](#action-set_essence_msg)
- [`set_friend_remark`](#action-set_friend_remark)
- [`set_friends_category`](#action-set_friends_category)
- [`set_group_reaction`](#action-set_group_reaction)
- [`set_group_remark`](#action-set_group_remark)
- [`set_group_robot_add_option`](#action-set_group_robot_add_option)
- [`set_group_sign`](#action-set_group_sign)
- [`set_group_todo`](#action-set_group_todo)
- [`set_input_status`](#action-set_input_status)
- [`set_msg_emoji_like`](#action-set_msg_emoji_like)
- [`set_online_status`](#action-set_online_status)
- [`set_qq_avatar`](#action-set_qq_avatar)
- [`set_qq_profile`](#action-set_qq_profile)
- [`set_restart`](#action-set_restart) ⚠️
- [`set_self_longnick`](#action-set_self_longnick)
- [`share_group_ex`](#action-share_group_ex)
- [`share_peer`](#action-share_peer)
- [`trans_group_file`](#action-trans_group_file)
- [`translate_en2zh`](#action-translate_en2zh)
- [`upload_forward_msg`](#action-upload_forward_msg)
- [`upload_foward_msg`](#action-upload_foward_msg)

</details>

<a id="action-.get_word_slices"></a>
### `.get_word_slices`

只读　⚠️ **未实现 / 不支持**

分词（未实现）

**参数**：无

**返回**：（无成功值）

**示例**

- 分词（未实现）

```json
{
  "action": ".get_word_slices",
  "params": {}
}
```

> 当前未实现，调用返回失败；不要将其当作可用能力。


<a id="action-_del_group_notice"></a>
### `_del_group_notice`

有副作用

删除群公告（fid 或 notice_id 二选一）

> **权限**：notice_id 来自 _get_group_notice；删除需要管理权限。

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `fid` | string | — | （源码未标注说明，类型见左栏） |
| `notice_id` | string | — | （源码未标注说明，类型见左栏） |

**返回**：null

**示例**

- 删除群公告（fid 或 notice_id 二选一）

```json
{
  "action": "_del_group_notice",
  "params": {
    "group_id": 20001,
    "notice_id": "<notice-id-from-_get_group_notice>"
  }
}
```

> notice_id 来自 _get_group_notice；删除需要管理权限。


<a id="action-_get_friend_dress"></a>
### `_get_friend_dress`

只读

获取指定 QQ 号正在使用的个性装扮（挂件/名片/来电/输入状态等）

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `user_id` | uint | ✔ | 目标 QQ 号（min 1） |

**返回**：装扮信息；目标未使用任何可查询装扮时 items 为空数组。网络失败、未登录态/风控、页面改版、返回账号与请求不一致时返回失败并附具体原因

**示例**

- 获取指定 QQ 号正在使用的个性装扮（挂件/名片/来电/输入状态等）

```json
{
  "action": "_get_friend_dress",
  "params": {
    "user_id": 10001
  }
}
```

> 替换为需要查询的 QQ 号。


<a id="action-_get_group_notice"></a>
### `_get_group_notice`

只读

获取群公告

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |

**返回**：普通公告与新成员公告的合并数组；send_to_new_members 标识后者；图片含 id、url、宽高

**示例**

- 获取群公告

```json
{
  "action": "_get_group_notice",
  "params": {
    "group_id": 20001
  }
}
```

> 将 group_id 替换为当前账号可访问的群号。


<a id="action-_get_model_show"></a>
### `_get_model_show`

只读

获取机型展示（兼容 mock）

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | — | （源码未标注说明，类型见左栏）；默认 `` |

**返回**：数组，每项含 variants（回显请求的机型名与 need_pay 标记）。

**示例**

- 获取机型展示（兼容 mock）

```json
{
  "action": "_get_model_show",
  "params": {
    "model": "示例机型"
  }
}
```

> 兼容占位接口，仅将传入的 model（或默认值）放进展示结构，不查询设备机型。


<a id="action-_mark_all_as_read"></a>
### `_mark_all_as_read`

有副作用

标记全部已读

**参数**：无

**返回**：null

**示例**

- 标记全部已读

```json
{
  "action": "_mark_all_as_read",
  "params": {}
}
```

> 会将当前账号的会话标记为已读。


<a id="action-_send_group_notice"></a>
### `_send_group_notice`

有副作用

发送群公告（支持置顶、弹窗、新成员、群昵称引导与确认）

> **权限**：需要群公告管理权限；普通公告 type=1，新成员公告 type=20。

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `content` | string | ✔ | 公告正文 |
| `image` | string | — | 可选公告图片（本地路径、URL 或 base64）；默认 `` |
| `pinned` | int | — | 是否置顶：1=置顶，0=不置顶；默认 `0`（min 0, max 1） |
| `type` | int | — | 发布类型：1=普通公告，20=新成员公告；建议使用 send_to_new_members |
| `send_to_new_members` | bool | — | 是否在成员新加入群时发送（与 type=20 等价） |
| `is_show_edit_card` | int | — | 是否引导群成员修改群昵称：1=是，0=否；默认 `1`（min 0, max 1） |
| `tip_window_type` | int | — | 弹窗展示：0=开启弹窗，1=关闭弹窗（QQ 原始字段为反向语义）；默认 `1`（min 0, max 1） |
| `confirm_required` | int | — | 是否需要群成员确认收到：1=是，0=否；默认 `1`（min 0, max 1） |

**返回**：null

**约束**

- type must be 1 (regular) or 20 (new members)
- send_to_new_members conflicts with type

**示例**

- 发送群公告（支持置顶、弹窗、新成员、群昵称引导与确认）

```json
{
  "action": "_send_group_notice",
  "params": {
    "group_id": 20001,
    "content": "欢迎参加本周讨论",
    "type": 1,
    "pinned": 0
  }
}
```

> 需要群公告管理权限；普通公告 type=1，新成员公告 type=20。


<a id="action-_set_model_show"></a>
### `_set_model_show`

有副作用

设置机型展示（占位）

**参数**：无

**返回**：null

**示例**

- 设置机型展示（占位）

```json
{
  "action": "_set_model_show",
  "params": {}
}
```

> 兼容占位接口，当前返回成功但不修改机型展示。


<a id="action-add_custom_face"></a>
### `add_custom_face`

有副作用

添加收藏表情

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `file` | string | ✔ | （源码未标注说明，类型见左栏） |

**返回**：object（`emoji_id`）

**示例**

- 添加收藏表情

```json
{
  "action": "add_custom_face",
  "params": {
    "file": "file:///path/to/emoji.png"
  }
}
```

> 示例路径位于 Haizakura 服务端，须替换为该服务可读取的实际文件。


<a id="action-bot_exit"></a>
### `bot_exit`

有副作用

退出机器人

**参数**：无

**返回**：null

**示例**

- 退出机器人

```json
{
  "action": "bot_exit",
  "params": {}
}
```

> 会退出 Haizakura 进程，仅在明确需要停止服务时调用。


<a id="action-cancel_group_todo"></a>
### `cancel_group_todo`

有副作用

取消群待办

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `message_id` | messageId | ✔ | （源码未标注说明，类型见左栏） |

**返回**：null

**示例**

- 取消群待办

```json
{
  "action": "cancel_group_todo",
  "params": {
    "group_id": 20001,
    "message_id": -123456
  }
}
```

> 使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。 必须是该群的消息。


<a id="action-check_url_safely"></a>
### `check_url_safely`

只读

检查链接安全性

**参数**：无

**返回**：{ level }：安全等级（占位实现，恒为 1）。

**示例**

- 检查链接安全性

```json
{
  "action": "check_url_safely",
  "params": {}
}
```

> 兼容占位接口，当前固定返回 level=1，不能用来证明某个链接安全。


<a id="action-clean_cache"></a>
### `clean_cache`

有副作用

清理缓存

**参数**：无

**返回**：null

**示例**

- 清理缓存

```json
{
  "action": "clean_cache",
  "params": {}
}
```

> 兼容占位接口，当前返回成功但不执行清理。流式临时文件清理请使用 clean_stream_temp_file。


<a id="action-click_inline_keyboard_button"></a>
### `click_inline_keyboard_button`

有副作用

点击内联键盘按钮

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `bot_appid` | uint | ✔ | （源码未标注说明，类型见左栏）（min 1） |
| `msg_seq` | uint | ✔ | （源码未标注说明，类型见左栏）（min 1） |
| `button_id` | string | ✔ | （源码未标注说明，类型见左栏） |
| `callback_data` | string | — | （源码未标注说明，类型见左栏）；默认 `` |

**返回**：object（`result`, `errMsg`, `status`, `promptText`, `promptType`, `promptIcon`）

**示例**

- 点击内联键盘按钮

```json
{
  "action": "click_inline_keyboard_button",
  "params": {
    "group_id": 20001,
    "bot_appid": 10001,
    "msg_seq": 42,
    "button_id": "<button-id>",
    "callback_data": "<callback-data>"
  }
}
```

> 参数必须来自同一条机器人按钮消息；msg_seq 是消息序号，不是 message_id。


<a id="action-complete_group_todo"></a>
### `complete_group_todo`

有副作用

完成群待办

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `message_id` | messageId | ✔ | （源码未标注说明，类型见左栏） |

**返回**：null

**示例**

- 完成群待办

```json
{
  "action": "complete_group_todo",
  "params": {
    "group_id": 20001,
    "message_id": -123456
  }
}
```

> 使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。 必须是该群的消息。


<a id="action-create_collection"></a>
### `create_collection`

有副作用　⚠️ **未实现 / 不支持**

创建收藏（未实现）

**参数**：无

**返回**：（无成功值）

**示例**

- 创建收藏（未实现）

```json
{
  "action": "create_collection",
  "params": {}
}
```

> 当前未实现，调用返回失败；不要将其当作可用能力。


<a id="action-create_flash_task"></a>
### `create_flash_task`

有副作用

创建闪传任务

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `files` | raw | — | 路径、{ file, name }，或它们的数组 |
| `name` | string | — | （源码未标注说明，类型见左栏） |
| `thumb_path` | string | — | （源码未标注说明，类型见左栏） |

**返回**：object（`fileset_id`, `task_id`）

**示例**

- 创建闪传任务

```json
{
  "action": "create_flash_task",
  "params": {
    "files": [
      {
        "file": "file:///path/to/report.pdf",
        "name": "报告.pdf"
      }
    ],
    "name": "资料包"
  }
}
```

> 示例路径位于 Haizakura 服务端，须替换为该服务可读取的实际文件。 files 不能为空。


<a id="action-delete_custom_face"></a>
### `delete_custom_face`

有副作用

删除收藏表情

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `emoji_id` | string | ✔ | （源码未标注说明，类型见左栏） |

**返回**：null

**示例**

- 删除收藏表情

```json
{
  "action": "delete_custom_face",
  "params": {
    "emoji_id": "<emoji-id-from-fetch_custom_face_detail>"
  }
}
```

> emoji_id 来自 fetch_custom_face_detail。


<a id="action-delete_essence_msg"></a>
### `delete_essence_msg`

有副作用

移除精华消息

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `message_id` | messageId | ✔ | （源码未标注说明，类型见左栏） |

**返回**：null

**示例**

- 移除精华消息

```json
{
  "action": "delete_essence_msg",
  "params": {
    "message_id": -123456
  }
}
```

> 使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。


<a id="action-delete_flash_file"></a>
### `delete_flash_file`

有副作用

删除闪传文件

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `fileset_id` | string | ✔ | （源码未标注说明，类型见左栏） |

**返回**：null

**示例**

- 删除闪传文件

```json
{
  "action": "delete_flash_file",
  "params": {
    "fileset_id": "<fileset-id>"
  }
}
```

> fileset_id 来自 create_flash_task、get_fileset_id 或 list_filesets，替换为当前账号可访问的文件集。


<a id="action-delete_group_folder"></a>
### `delete_group_folder`

有副作用

删除群文件夹

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `folder_id` | string | ✔ | （源码未标注说明，类型见左栏） |

**返回**：null

**示例**

- 删除群文件夹

```json
{
  "action": "delete_group_folder",
  "params": {
    "group_id": 20001,
    "folder_id": "<folder-id-from-get_group_root_files>"
  }
}
```

> 会删除指定群文件夹，确认资源后调用。


<a id="action-download_file"></a>
### `download_file`

有副作用

下载文件（url 或 base64）到 data/downloads

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `url` | string | — | （源码未标注说明，类型见左栏）；默认 `` |
| `base64` | string | — | （源码未标注说明，类型见左栏）；默认 `` |
| `name` | string | — | （源码未标注说明，类型见左栏）；默认 `` |
| `headers` | raw | — | （源码未标注说明，类型见左栏） |

**返回**：{ file }

**示例**

- 下载文件（url 或 base64）到 data/downloads

```json
{
  "action": "download_file",
  "params": {
    "base64": "aGVsbG8=",
    "name": "hello.txt"
  }
}
```

> 保存到 Haizakura 服务端临时目录，返回服务端路径；不是 MCP 主机下载路径。


<a id="action-download_fileset"></a>
### `download_fileset`

有副作用

解析闪传文件下载直链（不下载，由调用方实现下载）

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `fileset_id` | string | ✔ | （源码未标注说明，类型见左栏） |
| `file_name` | string | — | （源码未标注说明，类型见左栏） |
| `file_index` | number | — | （源码未标注说明，类型见左栏） |

**返回**：{ url, file_name, file_size }

**示例**

- 解析闪传文件下载直链（不下载，由调用方实现下载）

```json
{
  "action": "download_fileset",
  "params": {
    "fileset_id": "<fileset-id>",
    "file_index": 0
  }
}
```

> fileset_id 来自 create_flash_task、get_fileset_id 或 list_filesets，替换为当前账号可访问的文件集。 file_index 从 0 开始。


<a id="action-fetch_custom_face"></a>
### `fetch_custom_face`

只读

获取自定义表情

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `count` | int | — | （源码未标注说明，类型见左栏）；默认 `10`（min 0） |
| `return_type` | string | — | （源码未标注说明，类型见左栏）；默认 `url` |

**返回**：字符串数组：return_type=url 时为图片 URL，return_type=id 时为 emoji_id。

**示例**

- 获取自定义表情

```json
{
  "action": "fetch_custom_face",
  "params": {
    "count": 10,
    "return_type": "url"
  }
}
```


<a id="action-fetch_custom_face_detail"></a>
### `fetch_custom_face_detail`

只读

获取自定义表情详情

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `count` | int | — | （源码未标注说明，类型见左栏）；默认 `48`（min 0） |

**返回**：自定义表情详情数组，包含资源标识、图片地址、摘要与描述。

**示例**

- 获取自定义表情详情

```json
{
  "action": "fetch_custom_face_detail",
  "params": {
    "count": 10
  }
}
```


<a id="action-fetch_emoji_like"></a>
### `fetch_emoji_like`

只读

获取表情回应用户（NapCat 分页）

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `message_id` | messageId | ✔ | （源码未标注说明，类型见左栏） |
| `emojiId` | string | ✔ | （源码未标注说明，类型见左栏） |
| `count` | int | — | （源码未标注说明，类型见左栏）；默认 `10`（min 0） |
| `cookie` | string | — | （源码未标注说明，类型见左栏）；默认 `` |

**返回**：分页的表情回应用户列表（NapCat 形状），含分页游标 cookie 与首/末页标记。

**示例**

- 获取表情回应用户（NapCat 分页）

```json
{
  "action": "fetch_emoji_like",
  "params": {
    "message_id": -123456,
    "emojiId": "128077",
    "count": 10
  }
}
```

> 使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。 后续页原样传回上页 cookie。


<a id="action-fetch_ptt_text"></a>
### `fetch_ptt_text` — 别名：`get_ptt_text`、`get_record_text`

只读

获取语音转文字结果

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `message_id` | messageId | ✔ | （源码未标注说明，类型见左栏） |

**返回**：{ text }：语音识别出的文本。

**示例**

- 获取语音转文字结果

```json
{
  "action": "fetch_ptt_text",
  "params": {
    "message_id": -123456
  }
}
```

> 使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。


<a id="action-forward_friend_single_msg"></a>
### `forward_friend_single_msg`

有副作用

转发单条消息给好友

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `message_id` | messageId | ✔ | （源码未标注说明，类型见左栏） |
| `user_id` | uint | ✔ | （源码未标注说明，类型见左栏）（min 1） |

**返回**：object（`message_id`）

**示例**

- 转发单条消息给好友

```json
{
  "action": "forward_friend_single_msg",
  "params": {
    "message_id": -123456,
    "user_id": 10001
  }
}
```

> 使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。


<a id="action-forward_group_single_msg"></a>
### `forward_group_single_msg`

有副作用

转发单条消息到群

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `message_id` | messageId | ✔ | （源码未标注说明，类型见左栏） |
| `group_id` | uint | ✔ | （源码未标注说明，类型见左栏）（min 1） |

**返回**：object（`message_id`）

**示例**

- 转发单条消息到群

```json
{
  "action": "forward_group_single_msg",
  "params": {
    "message_id": -123456,
    "group_id": 20001
  }
}
```

> 使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。


<a id="action-friend_poke"></a>
### `friend_poke`

有副作用

好友拍一拍

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `user_id` | uint | ✔ | （源码未标注说明，类型见左栏）（min 1） |
| `target_id` | uint | — | （源码未标注说明，类型见左栏）（min 1） |

**返回**：null

**示例**

- 好友拍一拍

```json
{
  "action": "friend_poke",
  "params": {
    "user_id": 10001
  }
}
```

> 戳一戳指定好友。


<a id="action-get_ai_characters"></a>
### `get_ai_characters`

只读

获取 AI 语音角色

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `chat_type` | int | — | （源码未标注说明，类型见左栏）；默认 `1`（min 0） |

**返回**：按分类分组的 AI 语音角色列表，每组含分类名与角色（id、名称、试听 URL）。

**示例**

- 获取 AI 语音角色

```json
{
  "action": "get_ai_characters",
  "params": {
    "group_id": 20001,
    "chat_type": 1
  }
}
```

> 将 group_id 替换为当前账号可访问的群号。


<a id="action-get_ai_record"></a>
### `get_ai_record`

有副作用

生成 AI 语音

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `character` | string | ✔ | （源码未标注说明，类型见左栏） |
| `text` | string | ✔ | （源码未标注说明，类型见左栏） |
| `chat_type` | int | — | （源码未标注说明，类型见左栏）；默认 `1`（min 0） |

**返回**：string

**示例**

- 生成 AI 语音

```json
{
  "action": "get_ai_record",
  "params": {
    "group_id": 20001,
    "character": "<character-id-from-get_ai_characters>",
    "text": "你好",
    "chat_type": 1
  }
}
```

> character 原样使用 get_ai_characters 的 character_id；send_group_ai_record 会直接发送语音。


<a id="action-get_clientkey"></a>
### `get_clientkey`

只读

获取 clientkey

**参数**：无

**返回**：{ clientKey, expireTime, keyIndex }：clientkey 及其过期时间与索引。

**示例**

- 获取 clientkey

```json
{
  "action": "get_clientkey",
  "params": {}
}
```

> 返回值可能包含凭据或临时下载密钥，请勿公开或记录到不受控日志。


<a id="action-get_collection_list"></a>
### `get_collection_list`

只读

获取收藏列表

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `category` | int | — | 收藏分类 ID；0 表示全部分类；默认 `0`（min 0） |
| `count` | int | — | 最多返回的收藏数量；默认 `50`（min 1, max 500） |

**返回**：返回收藏条目、是否还有更多数据及底部时间游标。

**示例**

- 获取收藏列表

```json
{
  "action": "get_collection_list",
  "params": {
    "category": 0,
    "count": 20
  }
}
```


<a id="action-get_cookies"></a>
### `get_cookies`

只读

获取 Cookies

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `domain` | string | — | （源码未标注说明，类型见左栏）；默认 `qun.qq.com` |

**返回**：{ cookies }：指定域名的 Cookie 字符串。

**示例**

- 获取 Cookies

```json
{
  "action": "get_cookies",
  "params": {
    "domain": "qun.qq.com"
  }
}
```

> 返回登录凭据，仅在有明确用途时读取，请勿公开。


<a id="action-get_credentials"></a>
### `get_credentials`

只读

获取凭证

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `domain` | string | — | （源码未标注说明，类型见左栏）；默认 `qun.qq.com` |

**返回**：{ cookies, token, csrf_token }：Cookie 字符串与 CSRF 令牌（token 与 csrf_token 同值）。

**示例**

- 获取凭证

```json
{
  "action": "get_credentials",
  "params": {
    "domain": "qun.qq.com"
  }
}
```

> 返回登录凭据，仅在有明确用途时读取，请勿公开。


<a id="action-get_csrf_token"></a>
### `get_csrf_token`

只读

获取 CSRF 令牌

**参数**：无

**返回**：{ token }：CSRF 令牌（bkn，数值）。

**示例**

- 获取 CSRF 令牌

```json
{
  "action": "get_csrf_token",
  "params": {}
}
```


<a id="action-get_doubt_friends_add_request"></a>
### `get_doubt_friends_add_request`

只读

获取可疑好友申请

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `count` | int | — | （源码未标注说明，类型见左栏）；默认 `50`（min 0） |

**返回**：可疑好友申请数组，每项含 uid（作为处理用 flag）、昵称、来源、留言与申请时间。

**示例**

- 获取可疑好友申请

```json
{
  "action": "get_doubt_friends_add_request",
  "params": {
    "count": 20
  }
}
```


<a id="action-get_emoji_likes"></a>
### `get_emoji_likes`

只读

获取表情回应用户

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `message_id` | messageId | ✔ | （源码未标注说明，类型见左栏） |
| `emoji_id` | string | ✔ | （源码未标注说明，类型见左栏） |

**返回**：{ emoji_like_list }：回应该表情的用户列表（nick_name 恒为空串）。

**示例**

- 获取表情回应用户

```json
{
  "action": "get_emoji_likes",
  "params": {
    "message_id": -123456,
    "emoji_id": "128077"
  }
}
```

> 使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。


<a id="action-get_essence_msg_list"></a>
### `get_essence_msg_list`

只读

获取精华消息列表

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |

**返回**：array&lt;object（`msg_seq`, `msg_random`, `sender_id`, `sender_nick`, `sender_time`, `operator_id`, `operator_nick`, `operator_time`, `message_id`, `content`）&gt;

**示例**

- 获取精华消息列表

```json
{
  "action": "get_essence_msg_list",
  "params": {
    "group_id": 20001
  }
}
```

> 将 group_id 替换为当前账号可访问的群号。


<a id="action-get_file"></a>
### `get_file`

只读

获取文件信息（仅图片/语音缓存；群文件请用 get_group_file_url）

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `file_id` | string | — | （源码未标注说明，类型见左栏）；默认 `` |
| `file` | string | — | （源码未标注说明，类型见左栏）；默认 `` |

**返回**：object（`file`, `url`, `file_size`, `file_name`）

**示例**

- 获取文件信息（仅图片/语音缓存；群文件请用 get_group_file_url）

```json
{
  "action": "get_file",
  "params": {
    "file_id": "<media-file-id-from-message>"
  }
}
```

> 仅查询已缓存的图片或语音，先尝试图片，再尝试语音。


<a id="action-get_fileset_id"></a>
### `get_fileset_id`

只读

从 QQ 闪传分享码或官方分享链接获取 fileset_id

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `share_code` | string | ✔ | QQ 闪传分享码，或 https://qfile.qq.com/q/... 官方分享链接 |

**返回**：{ fileset_id }：解析出的文件集 ID。

**示例**

- 从 QQ 闪传分享码或官方分享链接获取 fileset_id

```json
{
  "action": "get_fileset_id",
  "params": {
    "share_code": "<share-link-or-code>"
  }
}
```

> share_code 使用实际闪传分享链接或提取码。


<a id="action-get_fileset_info"></a>
### `get_fileset_info`

有副作用

获取文件集信息

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `fileset_id` | string | ✔ | （源码未标注说明，类型见左栏） |

**返回**：object（`fileset_id`, `file_list`）

**示例**

- 获取文件集信息

```json
{
  "action": "get_fileset_info",
  "params": {
    "fileset_id": "<fileset-id>"
  }
}
```

> fileset_id 来自 create_flash_task、get_fileset_id 或 list_filesets，替换为当前账号可访问的文件集。


<a id="action-get_flash_file_list"></a>
### `get_flash_file_list`

有副作用

获取闪传文件列表

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `fileset_id` | string | ✔ | （源码未标注说明，类型见左栏） |

**返回**：array&lt;object（`fileset_id`, `file_name`, `orig_name`, `size`, `share_url`, `file_id`, `download_url`）&gt;

**示例**

- 获取闪传文件列表

```json
{
  "action": "get_flash_file_list",
  "params": {
    "fileset_id": "<fileset-id>"
  }
}
```

> fileset_id 来自 create_flash_task、get_fileset_id 或 list_filesets，替换为当前账号可访问的文件集。


<a id="action-get_flash_file_url"></a>
### `get_flash_file_url`

有副作用

获取闪传文件链接

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `fileset_id` | string | ✔ | （源码未标注说明，类型见左栏） |
| `file_name` | string | — | （源码未标注说明，类型见左栏） |
| `file_index` | number | — | （源码未标注说明，类型见左栏） |

**返回**：object（`url`）

**示例**

- 获取闪传文件链接

```json
{
  "action": "get_flash_file_url",
  "params": {
    "fileset_id": "<fileset-id>",
    "file_index": 0
  }
}
```

> fileset_id 来自 create_flash_task、get_fileset_id 或 list_filesets，替换为当前账号可访问的文件集。 file_index 从 0 开始。


<a id="action-get_forward_msg"></a>
### `get_forward_msg`

只读

获取合并转发消息（id 或 message_id）

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | — | （源码未标注说明，类型见左栏） |
| `message_id` | string | — | （源码未标注说明，类型见左栏） |

**返回**：{ messages }：转发内的消息节点数组（每项为 OneBot 消息事件）；reply 保留 id，有内嵌引用内容时附带 message 和可用的 qq/time/seq，可作为转发节点 content 再次发送。

**示例**

- 获取合并转发消息（id 或 message_id）

```json
{
  "action": "get_forward_msg",
  "params": {
    "id": "<res-id-from-forward-message>"
  }
}
```

> id 是合并转发资源标识，通常来自转发消息段或上传结果 res_id，不是普通数值 message_id。


<a id="action-get_friend_msg_history"></a>
### `get_friend_msg_history`

只读

获取好友消息历史（无锚点时从服务器获取最新双向记录）

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `user_id` | uint | ✔ | （源码未标注说明，类型见左栏）（min 1） |
| `message_id` | int | — | （源码未标注说明，类型见左栏）；默认 `0` |
| `count` | int | — | 无锚点时从 QQ 服务器获取最新双向历史；服务器或身份解析失败时动作失败，不返回不完整的本地缓存；默认 `20`（min 0） |
| `reverse_order` | bool | — | 仅在 message_id 非 0 时生效；true 返回锚点及更旧消息，false 返回锚点及更新消息；默认 `true` |

**返回**：{ messages }：好友消息事件对象数组（每项为 OneBot 消息事件，内部字段不固定）。

**示例**

- 获取好友消息历史（无锚点时从服务器获取最新双向记录）

```json
{
  "action": "get_friend_msg_history",
  "params": {
    "user_id": 10001,
    "count": 20
  }
}
```

> 省略 message_id 从最新消息开始；只读取当前账号消息。


<a id="action-get_friends_with_category"></a>
### `get_friends_with_category`

只读

获取分组好友列表

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `with_profile` | bool | — | 主动补查好友公开资料，按账号缓存五分钟；大列表可能耗时较长；默认 `false` |

**返回**：好友分组数组；buddyList 与 get_friend_list 使用相同资料字段。默认只使用列表回包，with_profile=true 主动补查，失败会报错；未返回的资料省略。

**示例**

- 获取分组好友列表

```json
{
  "action": "get_friends_with_category",
  "params": {}
}
```


<a id="action-get_group_at_all_remain"></a>
### `get_group_at_all_remain`

只读

获取群 @全体成员 剩余次数

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |

**返回**：{ can_at_all, remain_at_all_count_for_group, remain_at_all_count_for_uin }：@全体可用性与剩余次数。

**示例**

- 获取群 @全体成员 剩余次数

```json
{
  "action": "get_group_at_all_remain",
  "params": {
    "group_id": 20001
  }
}
```

> 将 group_id 替换为当前账号可访问的群号。


<a id="action-get_group_detail_info"></a>
### `get_group_detail_info`

只读

获取群详细信息

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | （源码未标注说明，类型见左栏）（min 1） |
| `no_cache` | bool | — | （源码未标注说明，类型见左栏）；默认 `false` |

**返回**：object（`group_id`, `group_name`, `group_remark`, `member_count`, `max_member_count`, `group_create_time`, `group_level`, `group_memo`, `group_description`, `group_all_shut`）

**示例**

- 获取群详细信息

```json
{
  "action": "get_group_detail_info",
  "params": {
    "group_id": 20001
  }
}
```

> 将 group_id 替换为当前账号可访问的群号。


<a id="action-get_group_file_system_info"></a>
### `get_group_file_system_info`

只读

获取群文件系统信息

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |

**返回**：{ file_count, limit_count, used_space, total_space }：群文件数量与容量信息（均为服务端实际值）。

**示例**

- 获取群文件系统信息

```json
{
  "action": "get_group_file_system_info",
  "params": {
    "group_id": 20001
  }
}
```

> 将 group_id 替换为当前账号可访问的群号。


<a id="action-get_group_ignore_add_request"></a>
### `get_group_ignore_add_request`

只读

获取被忽略的入群请求（NapCat）

**参数**：无

**返回**：被忽略的入群请求数组（NapCat 字段命名），每项含请求序列、邀请人、群信息与处理标记。

**示例**

- 获取被忽略的入群请求（NapCat）

```json
{
  "action": "get_group_ignore_add_request",
  "params": {}
}
```


<a id="action-get_group_ignored_notifies"></a>
### `get_group_ignored_notifies`

只读

获取被过滤的入群请求

**参数**：无

**返回**：被过滤的入群请求数组，每项含群号、申请人、邀请人、留言与处理标记。

**示例**

- 获取被过滤的入群请求

```json
{
  "action": "get_group_ignored_notifies",
  "params": {}
}
```


<a id="action-get_group_info_ex"></a>
### `get_group_info_ex`

只读

获取群信息（扩展）

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | （源码未标注说明，类型见左栏）（min 1） |
| `no_cache` | bool | — | （源码未标注说明，类型见左栏）；默认 `false` |

**返回**：object（`group_id`, `group_name`, `group_remark`, `member_count`, `max_member_count`, `group_create_time`, `group_level`, `group_memo`, `group_description`, `group_all_shut`）

**示例**

- 获取群信息（扩展）

```json
{
  "action": "get_group_info_ex",
  "params": {
    "group_id": 20001
  }
}
```

> 将 group_id 替换为当前账号可访问的群号。


<a id="action-get_group_msg_history"></a>
### `get_group_msg_history`

只读

获取群消息历史

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `message_id` | int | — | （源码未标注说明，类型见左栏）；默认 `0` |
| `count` | int | — | （源码未标注说明，类型见左栏）；默认 `20`（min 0） |
| `reverse_order` | bool | — | 仅在 message_id 非 0 时生效；true 返回锚点及更旧消息，false 返回锚点及更新消息；默认 `true` |

**返回**：{ messages }：群消息事件对象数组（每项为 OneBot 消息事件，内部字段不固定）。

**示例**

- 获取群消息历史

```json
{
  "action": "get_group_msg_history",
  "params": {
    "group_id": 20001,
    "count": 20
  }
}
```

> 省略 message_id 从最新消息开始；翻页使用上一页实际 message_id，不要自行加减。


<a id="action-get_group_shut_list"></a>
### `get_group_shut_list`

只读

获取群禁言列表

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |

**返回**：仍在禁言中的成员数组，每项含 QQ 号、昵称与禁言到期时间戳（秒）。

**示例**

- 获取群禁言列表

```json
{
  "action": "get_group_shut_list",
  "params": {
    "group_id": 20001
  }
}
```

> 将 group_id 替换为当前账号可访问的群号。


<a id="action-get_group_signed_list"></a>
### `get_group_signed_list`

只读

获取群今日打卡列表

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |

**返回**：array&lt;object（`user_id`, `nick`, `time`, `rank`）&gt;

**示例**

- 获取群今日打卡列表

```json
{
  "action": "get_group_signed_list",
  "params": {
    "group_id": 20001
  }
}
```

> 将 group_id 替换为当前账号可访问的群号。


<a id="action-get_group_todo_list"></a>
### `get_group_todo_list`

只读

获取群待办列表

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |

**返回**：群待办数组，包含可用于待办操作的消息标识、服务端摘要与时间

**示例**

- 获取群待办列表

```json
{
  "action": "get_group_todo_list",
  "params": {
    "group_id": 20001
  }
}
```

> 将 group_id 替换为当前账号可访问的群号。


<a id="action-get_image"></a>
### `get_image`

只读

获取图片信息

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `file` | string | — | （源码未标注说明，类型见左栏）；默认 `` |
| `file_id` | string | — | （源码未标注说明，类型见左栏）；默认 `` |

**返回**：object（`file`, `url`, `file_size`, `file_name`）

**示例**

- 获取图片信息

```json
{
  "action": "get_image",
  "params": {
    "file": "<image-file-from-message>"
  }
}
```

> file 或 file_id 原样取自图片消息段，须在当前账号媒体缓存中存在。


<a id="action-get_mini_app_ark"></a>
### `get_mini_app_ark`

只读

获取小程序卡片 ark

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | string | — | （源码未标注说明，类型见左栏） |
| `title` | string | — | （源码未标注说明，类型见左栏） |
| `desc` | string | — | （源码未标注说明，类型见左栏） |
| `picUrl` | string | — | （源码未标注说明，类型见左栏） |
| `pic_url` | string | — | （源码未标注说明，类型见左栏） |
| `jumpUrl` | string | — | （源码未标注说明，类型见左栏） |
| `jump_url` | string | — | （源码未标注说明，类型见左栏） |

**返回**：object（`data`）

**示例**

- 获取小程序卡片 ark

```json
{
  "action": "get_mini_app_ark",
  "params": {
    "type": "bili",
    "title": "示例视频",
    "desc": "视频介绍",
    "pic_url": "https://example.com/cover.png",
    "jump_url": "https://www.bilibili.com/video/<video-id>"
  }
}
```

> 替换为实际分享地址；当前仅支持 bili 和 weibo。返回的 data 是卡片对象，不会自动发送。


<a id="action-get_msg_emoji_likes"></a>
### `get_msg_emoji_likes`

只读

获取一条消息的全部表情回应

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `message_id` | messageId | ✔ | （源码未标注说明，类型见左栏） |

**返回**：该消息上每个表情回应的编号、数量与用户列表。

**示例**

- 获取一条消息的全部表情回应

```json
{
  "action": "get_msg_emoji_likes",
  "params": {
    "message_id": -123456
  }
}
```

> 使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。


<a id="action-get_online_clients"></a>
### `get_online_clients`

只读

获取在线客户端

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `no_cache` | bool | — | 是否强制刷新；QQ 当前仅暴露本地快照，true 会明确失败；默认 `false` |

**返回**：{ clients }：QQ 本次会话最近推送的在线设备快照。

**示例**

- 获取在线客户端

```json
{
  "action": "get_online_clients",
  "params": {
    "no_cache": false
  }
}
```


<a id="action-get_profile_like"></a>
### `get_profile_like`

只读

获取资料点赞

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `user_id` | int | — | （源码未标注说明，类型见左栏）；默认 `0`（min 0） |
| `start` | int | — | （源码未标注说明，类型见左栏）；默认 `0`（min 0） |
| `count` | int | — | （源码未标注说明，类型见左栏）；默认 `10`（min 0） |

**返回**：点赞资料：uid、最近点赞时间、收藏与点赞统计及用户明细。

**示例**

- 获取资料点赞

```json
{
  "action": "get_profile_like",
  "params": {
    "user_id": 10001,
    "start": 0,
    "count": 10
  }
}
```


<a id="action-get_recent_contact"></a>
### `get_recent_contact`

只读

获取最近会话（占位）

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `count` | int | — | （源码未标注说明，类型见左栏）；默认 `10`（min 0） |

**返回**：占位实现，恒返回空数组。

**示例**

- 获取最近会话（占位）

```json
{
  "action": "get_recent_contact",
  "params": {
    "count": 10
  }
}
```

> 兼容占位接口，当前始终返回空数组，不能据此判断真实会话列表。


<a id="action-get_record"></a>
### `get_record`

只读

获取语音信息；传 out_format 则服务端转码并附带 base64

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `file` | string | — | （源码未标注说明，类型见左栏）；默认 `` |
| `file_id` | string | — | （源码未标注说明，类型见左栏）；默认 `` |
| `out_format` | enum | — | （源码未标注说明，类型见左栏）；可选 `mp3`、`amr`、`wma`、`m4a`、`spx`、`ogg`、`wav`、`flac` |

**返回**：语音信息（file/url 为向 QQ 获取的当前下载地址）；资源元数据缺失或远端获取失败时返回错误。out_format 指定时附带转码后的 base64。

**示例**

- 获取语音信息；传 out_format 则服务端转码并附带 base64

```json
{
  "action": "get_record",
  "params": {
    "file": "<record-file-from-message>",
    "out_format": "mp3"
  }
}
```

> file 来自语音消息段；格式转换依赖服务端可用的转换工具，成功时增加 out_format 和 base64。


<a id="action-get_rkey"></a>
### `get_rkey` — 别名：`nc_get_rkey`

只读

获取下载 rkey

**参数**：无

**返回**：array&lt;object（`rkey`, `type`, `ttl`, `create_time`）&gt;

**示例**

- 获取下载 rkey

```json
{
  "action": "get_rkey",
  "params": {}
}
```

> 返回值可能包含凭据或临时下载密钥，请勿公开或记录到不受控日志。


<a id="action-get_rkey_server"></a>
### `get_rkey_server`

只读

获取 rkey 服务器信息

**参数**：无

**返回**：{ expired_time, name, private_rkey?, group_rkey? }：rkey 过期时间与（存在时的）私聊/群聊 rkey。

**示例**

- 获取 rkey 服务器信息

```json
{
  "action": "get_rkey_server",
  "params": {}
}
```

> 返回值可能包含凭据或临时下载密钥，请勿公开或记录到不受控日志。


<a id="action-get_share_link"></a>
### `get_share_link`

有副作用

获取文件分享链接

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `fileset_id` | string | ✔ | （源码未标注说明，类型见左栏） |

**返回**：string

**示例**

- 获取文件分享链接

```json
{
  "action": "get_share_link",
  "params": {
    "fileset_id": "<fileset-id>"
  }
}
```

> fileset_id 来自 create_flash_task、get_fileset_id 或 list_filesets，替换为当前账号可访问的文件集。


<a id="action-get_unidirectional_friend_list"></a>
### `get_unidirectional_friend_list`

只读

获取单向好友列表

**参数**：无

**返回**：array&lt;object&gt;

**示例**

- 获取单向好友列表

```json
{
  "action": "get_unidirectional_friend_list",
  "params": {}
}
```


<a id="action-group_poke"></a>
### `group_poke`

有副作用

群拍一拍

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `user_id` | uint | ✔ | QQ 号（min 1） |

**返回**：null

**示例**

- 群拍一拍

```json
{
  "action": "group_poke",
  "params": {
    "group_id": 20001,
    "user_id": 10001
  }
}
```

> 将 group_id 替换为当前账号可访问的群号。


<a id="action-list_filesets"></a>
### `list_filesets`

有副作用

列出当前账号的所有闪传文件集

**参数**：无

**返回**：array&lt;object（`fileset_id`, `file_name`, `orig_name`, `size`, `share_url`, `file_id`, `download_url`）&gt;

**示例**

- 列出当前账号的所有闪传文件集

```json
{
  "action": "list_filesets",
  "params": {}
}
```


<a id="action-mark_group_msg_as_read"></a>
### `mark_group_msg_as_read`

有副作用

标记群消息已读

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `message_id` | messageId | ✔ | （源码未标注说明，类型见左栏） |
| `group_id` | uint | — | （源码未标注说明，类型见左栏）（min 1） |

**返回**：null

**示例**

- 标记群消息已读

```json
{
  "action": "mark_group_msg_as_read",
  "params": {
    "message_id": -123456,
    "group_id": 20001
  }
}
```

> 使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。


<a id="action-mark_msg_as_read"></a>
### `mark_msg_as_read`

有副作用

标记消息已读（群聊/私聊自动路由）

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `message_id` | messageId | ✔ | （源码未标注说明，类型见左栏） |
| `target_id` | uint | — | （源码未标注说明，类型见左栏）（min 1） |

**返回**：null

**示例**

- 标记消息已读（群聊/私聊自动路由）

```json
{
  "action": "mark_msg_as_read",
  "params": {
    "message_id": -123456
  }
}
```

> 使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。


<a id="action-mark_private_msg_as_read"></a>
### `mark_private_msg_as_read`

有副作用

标记私聊消息已读

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `message_id` | messageId | ✔ | （源码未标注说明，类型见左栏） |
| `user_id` | uint | — | （源码未标注说明，类型见左栏）（min 1） |

**返回**：null

**示例**

- 标记私聊消息已读

```json
{
  "action": "mark_private_msg_as_read",
  "params": {
    "message_id": -123456,
    "user_id": 10001
  }
}
```

> 使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。


<a id="action-modify_custom_face"></a>
### `modify_custom_face`

有副作用

修改收藏表情备注

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `emoji_id` | string | ✔ | （源码未标注说明，类型见左栏） |
| `desc` | string | — | （源码未标注说明，类型见左栏）；默认 `` |

**返回**：null

**示例**

- 修改收藏表情备注

```json
{
  "action": "modify_custom_face",
  "params": {
    "emoji_id": "<emoji-id>",
    "desc": "常用表情"
  }
}
```

> emoji_id 来自 fetch_custom_face_detail。


<a id="action-move_custom_face_to_front"></a>
### `move_custom_face_to_front`

有副作用

收藏表情移到最前

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `emoji_id` | string | ✔ | （源码未标注说明，类型见左栏） |

**返回**：null

**示例**

- 收藏表情移到最前

```json
{
  "action": "move_custom_face_to_front",
  "params": {
    "emoji_id": "<emoji-id-from-fetch_custom_face_detail>"
  }
}
```

> emoji_id 来自 fetch_custom_face_detail。


<a id="action-nc_get_packet_status"></a>
### `nc_get_packet_status`

只读

获取 packet 状态（占位）

**参数**：无

**返回**：占位实现，恒返回 null。

**示例**

- 获取 packet 状态（占位）

```json
{
  "action": "nc_get_packet_status",
  "params": {}
}
```

> 兼容占位接口，当前始终返回 null，不提供实际收发统计。


<a id="action-nc_get_user_status"></a>
### `nc_get_user_status`

只读

获取用户在线/扩展状态

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `user_id` | uint | ✔ | （源码未标注说明，类型见左栏）（min 1） |

**返回**：{ status, ext_status }：用户在线状态码与扩展状态码。

**示例**

- 获取用户在线/扩展状态

```json
{
  "action": "nc_get_user_status",
  "params": {
    "user_id": 10001
  }
}
```

> 替换为需要查询的 QQ 号。


<a id="action-ocr_image"></a>
### `ocr_image` — 别名：`.ocr_image`

只读

OCR 图片（服务端，需图片 URL 或已缓存的图片 file_id）

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `image` | string | ✔ | （源码未标注说明，类型见左栏） |

**返回**：{ texts, language }：识别文本数组（含置信度与坐标）与识别语言。

**示例**

- OCR 图片（服务端，需图片 URL 或已缓存的图片 file_id）

```json
{
  "action": "ocr_image",
  "params": {
    "image": "https://example.com/image.png"
  }
}
```

> 替换为实际可访问的图片地址或已缓存图片标识；不支持本地路径和 base64。


<a id="action-rename_flash_file"></a>
### `rename_flash_file`

有副作用

重命名闪传文件

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `fileset_id` | string | ✔ | （源码未标注说明，类型见左栏） |
| `new_name` | string | ✔ | （源码未标注说明，类型见左栏） |

**返回**：null

**示例**

- 重命名闪传文件

```json
{
  "action": "rename_flash_file",
  "params": {
    "fileset_id": "<fileset-id>",
    "new_name": "新资料包"
  }
}
```

> fileset_id 来自 create_flash_task、get_fileset_id 或 list_filesets，替换为当前账号可访问的文件集。


<a id="action-request_decrypt_key"></a>
### `request_decrypt_key`

有副作用

请求数据库解密密钥

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `db_path` | string | ✔ | （源码未标注说明，类型见左栏） |

**返回**：object（`db_key`）

**示例**

- 请求数据库解密密钥

```json
{
  "action": "request_decrypt_key",
  "params": {
    "db_path": "/path/to/account/nt_msg.db"
  }
}
```

> 路径位于 Haizakura 服务端，必须指向当前账号可用的数据库；返回值是敏感密钥。


<a id="action-send_ark_share"></a>
### `send_ark_share`

只读

分享用户/群 Ark 卡片（NapCat 标准名）

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `user_id` | uint | — | （源码未标注说明，类型见左栏）（min 1） |
| `group_id` | uint | — | （源码未标注说明，类型见左栏）（min 1） |
| `phone_number` | string | — | （源码未标注说明，类型见左栏）；默认 `` |

**返回**：{ arkMsg }：服务端生成的推荐联系人 Ark 卡片 JSON 字符串。

**示例**

- 分享用户/群 Ark 卡片（NapCat 标准名）

```json
{
  "action": "send_ark_share",
  "params": {
    "user_id": 10001
  }
}
```

> 生成联系人分享卡片；返回卡片数据，不等同于发送到聊天。


<a id="action-send_flash_msg"></a>
### `send_flash_msg`

有副作用

发送闪传消息（私聊或群聊，引用 fileset_id 让对端下载）

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `fileset_id` | string | ✔ | （源码未标注说明，类型见左栏） |
| `user_id` | uint | — | （源码未标注说明，类型见左栏）（min 1） |
| `group_id` | uint | — | （源码未标注说明，类型见左栏）（min 1） |

**返回**：{ message_id }

**示例**

- 发送闪传消息（私聊或群聊，引用 fileset_id 让对端下载）

```json
{
  "action": "send_flash_msg",
  "params": {
    "fileset_id": "<fileset-id>",
    "user_id": 10001
  }
}
```

> fileset_id 来自 create_flash_task、get_fileset_id 或 list_filesets，替换为当前账号可访问的文件集。 会发送分享消息；message_id=0 是占位值，不能用于撤回或查消息。


<a id="action-send_forward_msg"></a>
### `send_forward_msg`

有副作用

发送合并转发（按 message_type/群号自动路由）

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `messages` | message | — | 转发节点数组；节点 content 内的 reply.data.message 可提供自定义引用内容（字符串或消息段），qq/time/seq 可选；仅用于转发内引用预览。 |
| `message` | message | — | 转发节点数组；节点 content 内的 reply.data.message 可提供自定义引用内容（字符串或消息段），qq/time/seq 可选；仅用于转发内引用预览。 |
| `message_type` | string | — | （源码未标注说明，类型见左栏） |
| `group_id` | int | — | （源码未标注说明，类型见左栏）（min 0） |
| `user_id` | int | — | （源码未标注说明，类型见左栏）（min 0） |
| `source` | string | — | （源码未标注说明，类型见左栏） |
| `summary` | string | — | （源码未标注说明，类型见左栏） |
| `prompt` | string | — | （源码未标注说明，类型见左栏） |
| `news` | raw | — | （源码未标注说明，类型见左栏） |

**返回**：{ message_id, res_id, forward_id }

**示例**

- 发送合并转发（按 message_type/群号自动路由）

```json
{
  "action": "send_forward_msg",
  "params": {
    "group_id": 20001,
    "messages": [
      {
        "type": "node",
        "data": {
          "user_id": 10001,
          "nickname": "示例用户",
          "content": [
            {
              "type": "text",
              "data": {
                "text": "转发内容"
              }
            }
          ]
        }
      }
    ]
  }
}
```

> 替换目标群号；nodes 是自定义转发节点数组。send_forward_msg 不提供目标时仅上传资源并返回 message_id=0。


<a id="action-send_group_ai_record"></a>
### `send_group_ai_record`

有副作用

发送 AI 语音到群

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `character` | string | ✔ | （源码未标注说明，类型见左栏） |
| `text` | string | ✔ | （源码未标注说明，类型见左栏） |
| `chat_type` | int | — | （源码未标注说明，类型见左栏）；默认 `1`（min 0） |

**返回**：{ message_id }：已发送 AI 语音的 OneBot 消息 ID。

**示例**

- 发送 AI 语音到群

```json
{
  "action": "send_group_ai_record",
  "params": {
    "group_id": 20001,
    "character": "<character-id-from-get_ai_characters>",
    "text": "你好",
    "chat_type": 1
  }
}
```

> character 原样使用 get_ai_characters 的 character_id；send_group_ai_record 会直接发送语音。


<a id="action-send_group_ark_share"></a>
### `send_group_ark_share`

只读

分享群 Ark 卡片（NapCat 标准名）

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | （源码未标注说明，类型见左栏）（min 1） |

**返回**：服务端生成的群推荐 Ark 卡片 JSON 字符串。

**示例**

- 分享群 Ark 卡片（NapCat 标准名）

```json
{
  "action": "send_group_ark_share",
  "params": {
    "group_id": 20001
  }
}
```

> 生成群分享卡片；返回卡片数据，不等同于发送到聊天。


<a id="action-send_group_forward_msg"></a>
### `send_group_forward_msg`

有副作用

发送群合并转发

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `messages` | message | — | 转发节点数组；节点 content 内的 reply.data.message 可提供自定义引用内容（字符串或消息段），qq/time/seq 可选；仅用于转发内引用预览。 |
| `message` | message | — | 转发节点数组；节点 content 内的 reply.data.message 可提供自定义引用内容（字符串或消息段），qq/time/seq 可选；仅用于转发内引用预览。 |
| `source` | string | — | （源码未标注说明，类型见左栏） |
| `summary` | string | — | （源码未标注说明，类型见左栏） |
| `prompt` | string | — | （源码未标注说明，类型见左栏） |
| `news` | raw | — | （源码未标注说明，类型见左栏） |

**返回**：{ message_id, res_id, forward_id }

**示例**

- 发送群合并转发

```json
{
  "action": "send_group_forward_msg",
  "params": {
    "group_id": 20001,
    "messages": [
      {
        "type": "node",
        "data": {
          "user_id": 10001,
          "nickname": "示例用户",
          "content": [
            {
              "type": "text",
              "data": {
                "text": "转发内容"
              }
            }
          ]
        }
      }
    ]
  }
}
```

> 替换目标群号；nodes 是自定义转发节点数组。send_forward_msg 不提供目标时仅上传资源并返回 message_id=0。


<a id="action-send_like"></a>
### `send_like`

有副作用

点赞

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `user_id` | uint | ✔ | （源码未标注说明，类型见左栏）（min 1） |
| `times` | int | — | （源码未标注说明，类型见左栏）；默认 `1`（min 0） |

**返回**：null

**示例**

- 点赞

```json
{
  "action": "send_like",
  "params": {
    "user_id": 10001,
    "times": 1
  }
}
```


<a id="action-send_packet"></a>
### `send_packet` — 别名：`.send_packet`

有副作用

发送原始 SSO 包（cmd + hex data）

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `cmd` | string | ✔ | （源码未标注说明，类型见左栏） |
| `data` | string | — | （源码未标注说明，类型见左栏）；默认 `` |
| `rsp` | bool | — | （源码未标注说明，类型见左栏）；默认 `true` |

**返回**：string \| null

**示例**

- 发送原始 SSO 包（cmd + hex data）

```json
{
  "action": "send_packet",
  "params": {
    "cmd": "<command-from-validated-request>",
    "data": "<hex-encoded-request>",
    "rsp": true
  }
}
```

> 仅供有协议经验的调用方：cmd 和 data 必须成对替换为已验证的命令与十六进制请求；示例占位符不可直接发送。


<a id="action-send_poke"></a>
### `send_poke`

有副作用

拍一拍（群聊/私聊自动路由）

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `user_id` | uint | ✔ | （源码未标注说明，类型见左栏）（min 1） |
| `group_id` | uint | — | （源码未标注说明，类型见左栏）（min 1） |

**返回**：null

**示例**

- 拍一拍（群聊/私聊自动路由）

```json
{
  "action": "send_poke",
  "params": {
    "group_id": 20001,
    "user_id": 10001
  }
}
```

> 将 group_id 替换为当前账号可访问的群号。


<a id="action-send_private_forward_msg"></a>
### `send_private_forward_msg`

有副作用

发送私聊合并转发

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `user_id` | uint | ✔ | （源码未标注说明，类型见左栏）（min 1） |
| `messages` | message | — | 转发节点数组；节点 content 内的 reply.data.message 可提供自定义引用内容（字符串或消息段），qq/time/seq 可选；仅用于转发内引用预览。 |
| `message` | message | — | 转发节点数组；节点 content 内的 reply.data.message 可提供自定义引用内容（字符串或消息段），qq/time/seq 可选；仅用于转发内引用预览。 |
| `source` | string | — | （源码未标注说明，类型见左栏） |
| `summary` | string | — | （源码未标注说明，类型见左栏） |
| `prompt` | string | — | （源码未标注说明，类型见左栏） |
| `news` | raw | — | （源码未标注说明，类型见左栏） |

**返回**：{ message_id, res_id, forward_id }

**示例**

- 发送私聊合并转发

```json
{
  "action": "send_private_forward_msg",
  "params": {
    "user_id": 10001,
    "messages": [
      {
        "type": "node",
        "data": {
          "user_id": 10001,
          "nickname": "示例用户",
          "content": [
            {
              "type": "text",
              "data": {
                "text": "转发内容"
              }
            }
          ]
        }
      }
    ]
  }
}
```

> 替换目标好友 QQ 号。


<a id="action-send_tuwen_ark"></a>
### `send_tuwen_ark`

有副作用

发送图文 Ark 卡片（私聊/群聊）

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `user_id` | uint | — | （源码未标注说明，类型见左栏）（min 1） |
| `group_id` | uint | — | （源码未标注说明，类型见左栏）（min 1） |
| `title` | string | ✔ | （源码未标注说明，类型见左栏） |
| `desc` | string | ✔ | （源码未标注说明，类型见左栏） |
| `summary` | string | — | （源码未标注说明，类型见左栏）；默认 `[分享]` |
| `preview_url` | string | — | （源码未标注说明，类型见左栏）；默认 `https://tangram-1251316161.file.myqcloud.com/files/20210721/e50a8e37e08f29bf1ffc7466e1950690.png` |
| `jump_url` | string | ✔ | （源码未标注说明，类型见左栏） |

**返回**：null

**示例**

- 发送图文 Ark 卡片（私聊/群聊）

```json
{
  "action": "send_tuwen_ark",
  "params": {
    "group_id": 20001,
    "title": "学习资料",
    "desc": "本周课程资料",
    "jump_url": "https://example.com/course",
    "preview_url": "https://example.com/cover.png"
  }
}
```

> 替换目标群号及实际链接；会发送分享卡片。


<a id="action-set_diy_online_status"></a>
### `set_diy_online_status`

有副作用

设置自定义在线状态

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `face_id` | int | ✔ | （源码未标注说明，类型见左栏）（min 0） |
| `face_type` | int | — | （源码未标注说明，类型见左栏）；默认 `1`（min 0） |
| `wording` | string | — | （源码未标注说明，类型见左栏）；默认 `` |

**返回**：null

**示例**

- 设置自定义在线状态

```json
{
  "action": "set_diy_online_status",
  "params": {
    "face_id": 14,
    "face_type": 1,
    "wording": "学习中"
  }
}
```


<a id="action-set_doubt_friends_add_request"></a>
### `set_doubt_friends_add_request`

有副作用

处理可疑好友申请

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `flag` | string | ✔ | （源码未标注说明，类型见左栏） |
| `approve` | bool | — | （源码未标注说明，类型见左栏）；默认 `true` |

**返回**：null

**示例**

- 处理可疑好友申请

```json
{
  "action": "set_doubt_friends_add_request",
  "params": {
    "flag": "<uid-from-doubt-request>",
    "approve": true
  }
}
```

> flag 使用 get_doubt_friends_add_request 返回项的 uid。


<a id="action-set_essence_msg"></a>
### `set_essence_msg`

有副作用

设置精华消息

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `message_id` | messageId | ✔ | （源码未标注说明，类型见左栏） |

**返回**：null

**示例**

- 设置精华消息

```json
{
  "action": "set_essence_msg",
  "params": {
    "message_id": -123456
  }
}
```

> 使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。


<a id="action-set_friend_remark"></a>
### `set_friend_remark`

有副作用

设置好友备注

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `user_id` | uint | ✔ | （源码未标注说明，类型见左栏）（min 1） |
| `remark` | string | ✔ | （源码未标注说明，类型见左栏） |

**返回**：null

**示例**

- 设置好友备注

```json
{
  "action": "set_friend_remark",
  "params": {
    "user_id": 10001,
    "remark": "同学"
  }
}
```


<a id="action-set_friends_category"></a>
### `set_friends_category`

有副作用

移动好友到指定分组

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `uin` | uint | ✔ | 要移动的好友 QQ 号（min 1） |
| `categoryId` | int | — | 目标分组 ID（min 0） |
| `categoryName` | string | — | 目标分组名称（必须唯一且完全匹配） |

**返回**：成功时返回空数据。

**约束**

- exactly one of: categoryId \| categoryName

**示例**

- 移动好友到指定分组

```json
{
  "action": "set_friends_category",
  "params": {
    "uin": 10001,
    "categoryName": "同学"
  }
}
```

> categoryId 与 categoryName 二选一。


<a id="action-set_group_reaction"></a>
### `set_group_reaction`

有副作用

群聊表情回应

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | — | （源码未标注说明，类型见左栏）（min 1） |
| `message_id` | messageId | ✔ | （源码未标注说明，类型见左栏） |
| `code` | string | ✔ | （源码未标注说明，类型见左栏） |
| `is_set` | bool | — | （源码未标注说明，类型见左栏）；默认 `true` |

**返回**：null

**示例**

- 群聊表情回应

```json
{
  "action": "set_group_reaction",
  "params": {
    "message_id": -123456,
    "group_id": 20001,
    "code": "128077",
    "is_set": true
  }
}
```

> 使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。


<a id="action-set_group_remark"></a>
### `set_group_remark`

有副作用

设置群备注

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | （源码未标注说明，类型见左栏）（min 1） |
| `remark` | string | ✔ | （源码未标注说明，类型见左栏） |

**返回**：null

**示例**

- 设置群备注

```json
{
  "action": "set_group_remark",
  "params": {
    "group_id": 20001,
    "remark": "学习小组"
  }
}
```

> 将 group_id 替换为当前账号可访问的群号。


<a id="action-set_group_robot_add_option"></a>
### `set_group_robot_add_option`

有副作用

设置群机器人加群选项

> **权限**：替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `robot_member_switch` | int | — | （源码未标注说明，类型见左栏）（min 0） |
| `robot_member_examine` | int | — | （源码未标注说明，类型见左栏）（min 0） |

**返回**：null

**示例**

- 设置群机器人加群选项

```json
{
  "action": "set_group_robot_add_option",
  "params": {
    "group_id": 20001,
    "robot_member_switch": 1,
    "robot_member_examine": 1
  }
}
```

> 替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。


<a id="action-set_group_sign"></a>
### `set_group_sign` — 别名：`send_group_sign`

有副作用

群签到

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |

**返回**：object

**示例**

- 群签到

```json
{
  "action": "set_group_sign",
  "params": {
    "group_id": 20001
  }
}
```

> 将 group_id 替换为当前账号可访问的群号。


<a id="action-set_group_todo"></a>
### `set_group_todo`

有副作用

设置群待办

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `message_id` | messageId | ✔ | （源码未标注说明，类型见左栏） |

**返回**：null

**示例**

- 设置群待办

```json
{
  "action": "set_group_todo",
  "params": {
    "group_id": 20001,
    "message_id": -123456
  }
}
```

> 使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。 必须是该群的消息。


<a id="action-set_input_status"></a>
### `set_input_status`

有副作用

设置输入状态

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `user_id` | uint | ✔ | （源码未标注说明，类型见左栏）（min 1） |
| `event_type` | int | — | （源码未标注说明，类型见左栏）；默认 `0` |

**返回**：object

**示例**

- 设置输入状态

```json
{
  "action": "set_input_status",
  "params": {
    "user_id": 10001,
    "event_type": 0
  }
}
```


<a id="action-set_msg_emoji_like"></a>
### `set_msg_emoji_like`

有副作用

设置消息表情回应

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `message_id` | messageId | ✔ | （源码未标注说明，类型见左栏） |
| `emoji_id` | string | ✔ | （源码未标注说明，类型见左栏） |
| `set` | bool | — | （源码未标注说明，类型见左栏）；默认 `true` |

**返回**：null

**示例**

- 设置消息表情回应

```json
{
  "action": "set_msg_emoji_like",
  "params": {
    "message_id": -123456,
    "emoji_id": "128077",
    "set": true
  }
}
```

> 使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。


<a id="action-set_online_status"></a>
### `set_online_status`

有副作用

设置在线状态

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `status` | int | ✔ | （源码未标注说明，类型见左栏） |
| `ext_status` | int | — | （源码未标注说明，类型见左栏）；默认 `0`（min 0） |
| `battery_status` | int | — | （源码未标注说明，类型见左栏）；默认 `100`（min 0） |

**返回**：null

**示例**

- 设置在线状态

```json
{
  "action": "set_online_status",
  "params": {
    "status": 11,
    "ext_status": 0,
    "battery_status": 100
  }
}
```

> 修改当前账号状态；具体状态码须与目标状态对应。


<a id="action-set_qq_avatar"></a>
### `set_qq_avatar`

有副作用

设置 QQ 头像

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `file` | string | ✔ | （源码未标注说明，类型见左栏） |

**返回**：null

**示例**

- 设置 QQ 头像

```json
{
  "action": "set_qq_avatar",
  "params": {
    "file": "file:///path/to/avatar.png"
  }
}
```

> 示例路径位于 Haizakura 服务端，须替换为该服务可读取的实际文件。


<a id="action-set_qq_profile"></a>
### `set_qq_profile`

有副作用

设置 QQ 资料

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `nickname` | string | — | （源码未标注说明，类型见左栏） |
| `personal_note` | string | — | （源码未标注说明，类型见左栏） |
| `sex` | int | — | 0 未知，1 男，2 女（min 0, max 2） |

**返回**：null

**示例**

- 设置 QQ 资料

```json
{
  "action": "set_qq_profile",
  "params": {
    "nickname": "示例昵称"
  }
}
```

> 会修改当前账号的资料；只传入需要修改的字段。


<a id="action-set_restart"></a>
### `set_restart`

有副作用　⚠️ **未实现 / 不支持**

重启（不支持）

**参数**：无

**返回**：（无成功值）

**示例**

- 重启（不支持）

```json
{
  "action": "set_restart",
  "params": {}
}
```

> 当前未实现，调用返回失败；不要将其当作可用能力。


<a id="action-set_self_longnick"></a>
### `set_self_longnick`

有副作用

设置个性签名（longNick/long_nick，严格 string）

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `longNick` | string | — | （源码未标注说明，类型见左栏） |
| `long_nick` | string | — | （源码未标注说明，类型见左栏） |

**返回**：object

**示例**

- 设置个性签名（longNick/long_nick，严格 string）

```json
{
  "action": "set_self_longnick",
  "params": {
    "long_nick": "学习中"
  }
}
```


<a id="action-share_group_ex"></a>
### `share_group_ex`

只读

分享群 Ark 卡片

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | （源码未标注说明，类型见左栏）（min 1） |

**返回**：服务端生成的群推荐 Ark 卡片 JSON 字符串。

**示例**

- 分享群 Ark 卡片

```json
{
  "action": "share_group_ex",
  "params": {
    "group_id": 20001
  }
}
```

> 生成群分享卡片；返回卡片数据，不等同于发送到聊天。


<a id="action-share_peer"></a>
### `share_peer`

只读

分享用户/群 Ark 卡片

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `user_id` | uint | — | （源码未标注说明，类型见左栏）（min 1） |
| `group_id` | uint | — | （源码未标注说明，类型见左栏）（min 1） |
| `phone_number` | string | — | （源码未标注说明，类型见左栏）；默认 `` |

**返回**：{ arkMsg }：服务端生成的推荐联系人 Ark 卡片 JSON 字符串。

**示例**

- 分享用户/群 Ark 卡片

```json
{
  "action": "share_peer",
  "params": {
    "user_id": 10001
  }
}
```

> 生成联系人分享卡片；返回卡片数据，不等同于发送到聊天。


<a id="action-trans_group_file"></a>
### `trans_group_file`

有副作用

转存群文件

> **权限**：替换群文件列表中的实际 file_id；需要对应文件操作权限。

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | （源码未标注说明，类型见左栏）（min 1） |
| `file_id` | string | ✔ | （源码未标注说明，类型见左栏） |

**返回**：{ ok: true }

**示例**

- 转存群文件

```json
{
  "action": "trans_group_file",
  "params": {
    "group_id": 20001,
    "file_id": "<file-id-from-get_group_root_files>"
  }
}
```

> 替换群文件列表中的实际 file_id；需要对应文件操作权限。


<a id="action-translate_en2zh"></a>
### `translate_en2zh`

只读

英译中

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `words` | string[] | ✔ | （源码未标注说明，类型见左栏） |

**返回**：{ words }：与输入等长的中文译文字符串数组。

**示例**

- 英译中

```json
{
  "action": "translate_en2zh",
  "params": {
    "words": [
      "Hello"
    ]
  }
}
```


<a id="action-upload_forward_msg"></a>
### `upload_forward_msg`

有副作用

上传转发消息

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `messages` | message | — | 转发节点数组；节点 content 内的 reply.data.message 可提供自定义引用内容（字符串或消息段），qq/time/seq 可选；仅用于转发内引用预览。 |
| `message` | message | — | 转发节点数组；节点 content 内的 reply.data.message 可提供自定义引用内容（字符串或消息段），qq/time/seq 可选；仅用于转发内引用预览。 |
| `group_id` | uint | — | （源码未标注说明，类型见左栏）（min 1） |

**返回**：object（`res_id`, `forward_id`, `message_id`, `group_id`）

**示例**

- 上传转发消息

```json
{
  "action": "upload_forward_msg",
  "params": {
    "group_id": 20001,
    "messages": [
      {
        "type": "node",
        "data": {
          "user_id": 10001,
          "nickname": "示例用户",
          "content": [
            {
              "type": "text",
              "data": {
                "text": "转发内容"
              }
            }
          ]
        }
      }
    ]
  }
}
```

> 仅上传合并转发资源，不发送聊天消息；message_id=0 是占位值，后续使用 res_id。


<a id="action-upload_foward_msg"></a>
### `upload_foward_msg`

有副作用

上传转发消息（别名拼写）

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `messages` | message | — | 转发节点数组；节点 content 内的 reply.data.message 可提供自定义引用内容（字符串或消息段），qq/time/seq 可选；仅用于转发内引用预览。 |
| `message` | message | — | 转发节点数组；节点 content 内的 reply.data.message 可提供自定义引用内容（字符串或消息段），qq/time/seq 可选；仅用于转发内引用预览。 |
| `group_id` | uint | — | （源码未标注说明，类型见左栏）（min 1） |

**返回**：object（`res_id`, `forward_id`, `message_id`）

**示例**

- 上传转发消息（别名拼写）

```json
{
  "action": "upload_foward_msg",
  "params": {
    "messages": [
      {
        "type": "node",
        "data": {
          "user_id": 10001,
          "nickname": "示例用户",
          "content": [
            {
              "type": "text",
              "data": {
                "text": "转发内容"
              }
            }
          ]
        }
      }
    ]
  }
}
```

> 历史拼写兼容接口，仅上传资源；message_id=0，返回值没有 group_id。


## 群相册

共 **9** 个动作。

<details><summary>展开目录</summary>

- [`cancel_group_album_media_like`](#action-cancel_group_album_media_like)
- [`del_group_album_media`](#action-del_group_album_media)
- [`do_group_album_comment`](#action-do_group_album_comment)
- [`get_group_album_list`](#action-get_group_album_list)
- [`get_group_album_media_list`](#action-get_group_album_media_list)
- [`get_qun_album_list`](#action-get_qun_album_list)
- [`set_group_album_media_like`](#action-set_group_album_media_like)
- [`upload_image_to_qun_album`](#action-upload_image_to_qun_album)
- [`upload_video_to_qun_album`](#action-upload_video_to_qun_album)

</details>

<a id="action-cancel_group_album_media_like"></a>
### `cancel_group_album_media_like`

有副作用



**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `album_id` | string | ✔ | （源码未标注说明，类型见左栏） |
| `batch_id` | string | ✔ | （源码未标注说明，类型见左栏） |
| `lloc` | string | — | （源码未标注说明，类型见左栏） |

**返回**：object（`id`, `status`）

**示例**

- 基本调用

```json
{
  "action": "cancel_group_album_media_like",
  "params": {
    "group_id": 20001,
    "album_id": "<album-id>",
    "batch_id": "1700000000"
  }
}
```

> album_id 来自 get_group_album_list；lloc 或视频 id、batch_id 来自 get_group_album_media_list。替换群号及对应资源标识。 batch_id 必须是实际批次的十进制字符串。


<a id="action-del_group_album_media"></a>
### `del_group_album_media`

有副作用

删除群相册图片或视频

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `album_id` | string | ✔ | （源码未标注说明，类型见左栏） |
| `lloc` | string | ✔ | 图片长定位标识，或视频 id |

**返回**：object（`success`）

**示例**

- 删除群相册图片或视频

```json
{
  "action": "del_group_album_media",
  "params": {
    "group_id": 20001,
    "album_id": "<album-id>",
    "lloc": "<media-lloc-or-video-id>"
  }
}
```

> album_id 来自 get_group_album_list；lloc 或视频 id、batch_id 来自 get_group_album_media_list。替换群号及对应资源标识。


<a id="action-do_group_album_comment"></a>
### `do_group_album_comment`

有副作用



**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `album_id` | string | ✔ | （源码未标注说明，类型见左栏） |
| `lloc` | string | ✔ | （源码未标注说明，类型见左栏） |
| `content` | string | ✔ | （源码未标注说明，类型见左栏） |

**返回**：object（`id`, `user`, `content`, `time`, `clientKey`）

**示例**

- 基本调用

```json
{
  "action": "do_group_album_comment",
  "params": {
    "group_id": 20001,
    "album_id": "<album-id>",
    "lloc": "<media-lloc-or-video-id>",
    "content": "拍得很好"
  }
}
```

> album_id 来自 get_group_album_list；lloc 或视频 id、batch_id 来自 get_group_album_media_list。替换群号及对应资源标识。


<a id="action-get_group_album_list"></a>
### `get_group_album_list`

只读



**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |

**返回**：群相册列表数组，每项为一个相册的基本信息。

**示例**

- 基本调用

```json
{
  "action": "get_group_album_list",
  "params": {
    "group_id": 20001
  }
}
```

> 将 group_id 替换为当前账号可访问的群号。


<a id="action-get_group_album_media_list"></a>
### `get_group_album_media_list`

只读



**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `album_id` | string | ✔ | （源码未标注说明，类型见左栏） |
| `attach_info` | string | — | （源码未标注说明，类型见左栏）；默认 `` |

**返回**：相册图片/视频列表及下一页分页游标；视频项包含 id、url、cover、尺寸、时长和多规格地址。

**示例**

- 基本调用

```json
{
  "action": "get_group_album_media_list",
  "params": {
    "group_id": 20001,
    "album_id": "<album-id>",
    "attach_info": ""
  }
}
```

> album_id 来自 get_group_album_list；lloc 或视频 id、batch_id 来自 get_group_album_media_list。替换群号及对应资源标识。 下一页传回 nextAttachInfo。


<a id="action-get_qun_album_list"></a>
### `get_qun_album_list`

只读



**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `attach_info` | string | — | （源码未标注说明，类型见左栏）；默认 `` |

**返回**：NapCat 风格的相册列表封套：{album_list, attach_info, has_more}。

**示例**

- 基本调用

```json
{
  "action": "get_qun_album_list",
  "params": {
    "group_id": 20001,
    "attach_info": ""
  }
}
```

> 后续页原样传回上一页的 attach_info；has_more=false 表示结束。


<a id="action-set_group_album_media_like"></a>
### `set_group_album_media_like`

有副作用



**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `album_id` | string | ✔ | （源码未标注说明，类型见左栏） |
| `batch_id` | string | ✔ | （源码未标注说明，类型见左栏） |
| `lloc` | string | — | （源码未标注说明，类型见左栏） |

**返回**：object（`id`, `status`）

**示例**

- 基本调用

```json
{
  "action": "set_group_album_media_like",
  "params": {
    "group_id": 20001,
    "album_id": "<album-id>",
    "batch_id": "1700000000"
  }
}
```

> album_id 来自 get_group_album_list；lloc 或视频 id、batch_id 来自 get_group_album_media_list。替换群号及对应资源标识。 batch_id 必须是实际批次的十进制字符串。


<a id="action-upload_image_to_qun_album"></a>
### `upload_image_to_qun_album`

有副作用



**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `album_id` | string | ✔ | （源码未标注说明，类型见左栏） |
| `album_name` | string | ✔ | （源码未标注说明，类型见左栏） |
| `file` | string | ✔ | （源码未标注说明，类型见左栏） |

**返回**：null

**示例**

- 基本调用

```json
{
  "action": "upload_image_to_qun_album",
  "params": {
    "group_id": 20001,
    "album_id": "<album-id>",
    "album_name": "活动照片",
    "file": "file:///path/to/photo.png"
  }
}
```

> album_id 来自 get_group_album_list；lloc 或视频 id、batch_id 来自 get_group_album_media_list。替换群号及对应资源标识。 示例路径位于 Haizakura 服务端，须替换为该服务可读取的实际文件。


<a id="action-upload_video_to_qun_album"></a>
### `upload_video_to_qun_album`

有副作用

上传视频到群相册

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | uint | ✔ | 群号（min 1） |
| `album_id` | string | ✔ | 相册 id |
| `album_name` | string | ✔ | 相册名称 |
| `file` | string | ✔ | 视频文件 |

**返回**：{ id: string }

**示例**

- 上传视频到群相册

```json
{
  "action": "upload_video_to_qun_album",
  "params": {
    "group_id": 20001,
    "album_id": "<album-id>",
    "album_name": "活动视频",
    "file": "file:///path/to/video.mp4"
  }
}
```

> album_id 来自 get_group_album_list；lloc 或视频 id、batch_id 来自 get_group_album_media_list。替换群号及对应资源标识。 示例路径位于 Haizakura 服务端，须替换为该服务可读取的实际文件。


## 空间

共 **29** 个动作。

<details><summary>展开目录</summary>

- [`comment_qzone`](#action-comment_qzone)
- [`comment_qzone_public_feed`](#action-comment_qzone_public_feed)
- [`delete_qzone_msg`](#action-delete_qzone_msg)
- [`delete_qzone_public_comment`](#action-delete_qzone_public_comment)
- [`delete_qzone_public_reply`](#action-delete_qzone_public_reply)
- [`forward_qzone_public_feed`](#action-forward_qzone_public_feed)
- [`get_qzone_feed_detail`](#action-get_qzone_feed_detail)
- [`get_qzone_feeds`](#action-get_qzone_feeds)
- [`get_qzone_home_feeds`](#action-get_qzone_home_feeds)
- [`get_qzone_msg_detail`](#action-get_qzone_msg_detail)
- [`get_qzone_msg_list`](#action-get_qzone_msg_list)
- [`get_qzone_profile`](#action-get_qzone_profile)
- [`get_qzone_public_capabilities`](#action-get_qzone_public_capabilities)
- [`get_qzone_public_comments`](#action-get_qzone_public_comments)
- [`get_qzone_public_feed_detail`](#action-get_qzone_public_feed_detail)
- [`get_qzone_public_feeds`](#action-get_qzone_public_feeds)
- [`get_qzone_public_replies`](#action-get_qzone_public_replies)
- [`get_qzone_share_ark`](#action-get_qzone_share_ark)
- [`like_qzone`](#action-like_qzone)
- [`reply_qzone_public_feed`](#action-reply_qzone_public_feed)
- [`send_qzone_msg`](#action-send_qzone_msg)
- [`set_qzone_ban`](#action-set_qzone_ban)
- [`set_qzone_msg_right`](#action-set_qzone_msg_right)
- [`set_qzone_profile`](#action-set_qzone_profile)
- [`set_qzone_public_comment_like`](#action-set_qzone_public_comment_like)
- [`set_qzone_public_follow`](#action-set_qzone_public_follow)
- [`set_qzone_public_like`](#action-set_qzone_public_like)
- [`set_qzone_public_upvote`](#action-set_qzone_public_upvote)
- [`unlike_qzone`](#action-unlike_qzone)

</details>

<a id="action-comment_qzone"></a>
### `comment_qzone`

有副作用

评论说说或回复指定评论（普通评论支持带图，楼中楼仅支持文字）

> **权限**：tid 来自 get_qzone_msg_list；操作需有该说说的访问或管理权限。

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `tid` | string | ✔ | 说说 tid |
| `content` | string | ✔ | 评论内容 |
| `target_uin` | uint | — | 说说所属 QQ 号，省略则为机器人自己（min 1） |
| `comment_id` | string | — | 一级父评论 ID，与 comment_uin 同时提供；编号 0 有效，不能传二级回复自身的 ID |
| `comment_uin` | uint | — | 一级父评论作者 QQ 号，与 comment_id 同时提供；不是说说所属账号（min 1） |
| `reply_uin` | uint | — | 楼中楼中要回复的用户 QQ 号，与 reply_name 同时提供，需指定父评论（min 1） |
| `reply_name` | string | — | 要回复的用户昵称，来自评论详情的 name；与 reply_uin 同时提供 |
| `images` | string[] | — | 图片数组（可选），支持 file:// http:// base64://；自动上传 |

**返回**：object（`comment_id`, `parent_comment_id`, `parent_comment_uin`）

**约束**

- all or none of: comment_id, comment_uin
- all or none of: reply_uin, reply_name
- reply_uin/reply_name require comment_id/comment_uin
- images are not supported for comment replies
- comment_id, reply_name and reply content must not be blank
- comment_uin and reply_uin must be safe integers

**示例**

- 评论一条说说（QQ 空间，支持纯文字或带图；传 images 自动上传）

```json
{
  "action": "comment_qzone",
  "params": {
    "tid": "<tid-from-get_qzone_msg_list>",
    "target_uin": 10001,
    "content": "感谢分享"
  }
}
```

> tid 来自 get_qzone_msg_list；操作需有该说说的访问或管理权限。

**示例**

- 回复指定一级评论，保留说说所属账号

```json
{
  "action": "comment_qzone",
  "params": {
    "tid": "<tid-from-get_qzone_msg_detail>",
    "target_uin": 10001,
    "content": "感谢回复",
    "comment_id": "0",
    "comment_uin": 10002
  }
}
```

> comment_id 和 comment_uin 分别取 get_qzone_msg_detail 的一级评论 comment_id 和 uin；编号 0 有效。楼中楼仅支持文字。

**示例**

- 回复楼中楼中的某位评论者

```json
{
  "action": "comment_qzone",
  "params": {
    "tid": "<tid-from-get_qzone_msg_detail>",
    "target_uin": 10001,
    "content": "我也这么认为",
    "comment_id": "0",
    "comment_uin": 10002,
    "reply_uin": 10003,
    "reply_name": "评论者"
  }
}
```

> comment_id/comment_uin 使用该回复的 parent_comment_id/parent_comment_uin；reply_uin/reply_name 使用该回复的 uin/name，不把二级回复自身的 comment_id 当成父评论编号。


<a id="action-comment_qzone_public_feed"></a>
### `comment_qzone_public_feed`

有副作用

评论推荐动态，支持文本或上游富文本条目

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `feed` | object | ✔ | get_qzone_public_feeds 返回的完整 feeds 条目，保留所有原始 cell 字段 |
| `content` | string | object[] | ✔ | 非空文本，或非空上游 RichItem 对象数组；字符串始终原样发送，富文本请直接传对象数组，不是 OneBot 消息段 |

**返回**：上游评论结果，包含新评论，保留未知字段。

**示例**

- 评论推荐动态

```json
{
  "action": "comment_qzone_public_feed",
  "params": {
    "feed": {
      "cell_common": {
        "union_id": {
          "uf_key": "<uf_key-from-get_qzone_public_feeds>",
          "ugc_id": "<ugc_id>",
          "feed_id": "<feed_id>",
          "ext_ids": []
        },
        "cur_like_key": "<like-key>",
        "domain_type": 3
      },
      "cell_feed_transfer": {},
      "cell_user_info": {
        "user": {
          "uin": "10001",
          "uid": "<uid>",
          "nick": "<nick>"
        }
      }
    },
    "content": "感谢分享"
  }
}
```

> feed 必须原样取自 get_qzone_public_feeds 的 feeds 数组，不能用旧说说 tid 拼造；示例中的占位字段须整体替换。


<a id="action-delete_qzone_msg"></a>
### `delete_qzone_msg`

有副作用

删除一条说说（QQ 空间，按 tid）

> **权限**：tid 来自 get_qzone_msg_list；操作需有该说说的访问或管理权限。

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `tid` | string | ✔ | 说说 tid（来自 get_qzone_msg_list / send_qzone_msg） |

**返回**：null

**示例**

- 删除一条说说（QQ 空间，按 tid）

```json
{
  "action": "delete_qzone_msg",
  "params": {
    "tid": "<tid-from-get_qzone_msg_list>"
  }
}
```

> tid 来自 get_qzone_msg_list；操作需有该说说的访问或管理权限。


<a id="action-delete_qzone_public_comment"></a>
### `delete_qzone_public_comment`

有副作用

删除推荐动态的一条评论（需有权限）

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `feed` | object | ✔ | get_qzone_public_feeds 返回的完整 feeds 条目，保留所有原始 cell 字段 |
| `comment` | object | ✔ | 详情或评论页返回的完整评论对象，保留 user 等原始字段 |

**返回**：上游删除结果，保留未知字段。

**示例**

- 删除一条评论

```json
{
  "action": "delete_qzone_public_comment",
  "params": {
    "feed": {
      "cell_common": {
        "union_id": {
          "uf_key": "<uf_key-from-get_qzone_public_feeds>",
          "ugc_id": "<ugc_id>",
          "feed_id": "<feed_id>",
          "ext_ids": []
        },
        "cur_like_key": "<like-key>",
        "domain_type": 3
      },
      "cell_feed_transfer": {},
      "cell_user_info": {
        "user": {
          "uin": "10001",
          "uid": "<uid>",
          "nick": "<nick>"
        }
      }
    },
    "comment": {
      "id": "<comment-id-from-detail-or-comments>",
      "user": {
        "uin": "<uin>",
        "uid": "<uid>",
        "nick": "<nick>"
      },
      "like": {
        "id": "<like-id-from-comment>",
        "count": 0,
        "status": 0
      },
      "reply_attach_info": ""
    }
  }
}
```

> feed 必须原样取自 get_qzone_public_feeds 的 feeds 数组，不能用旧说说 tid 拼造；示例中的占位字段须整体替换。 comment 可取 get_qzone_public_feed_detail 返回的 feed.feed.cell_comment.comments，或后续评论页；保留完整对象。


<a id="action-delete_qzone_public_reply"></a>
### `delete_qzone_public_reply`

有副作用

删除推荐动态评论下的一条回复（需有权限）

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `feed` | object | ✔ | get_qzone_public_feeds 返回的完整 feeds 条目，保留所有原始 cell 字段 |
| `comment` | object | ✔ | 详情或评论页返回的完整评论对象，保留 user 等原始字段 |
| `reply` | object | ✔ | 评论或回复页返回的完整回复对象，保留 user 等原始字段 |

**返回**：上游删除结果，保留未知字段。

**示例**

- 删除一条回复

```json
{
  "action": "delete_qzone_public_reply",
  "params": {
    "feed": {
      "cell_common": {
        "union_id": {
          "uf_key": "<uf_key-from-get_qzone_public_feeds>",
          "ugc_id": "<ugc_id>",
          "feed_id": "<feed_id>",
          "ext_ids": []
        },
        "cur_like_key": "<like-key>",
        "domain_type": 3
      },
      "cell_feed_transfer": {},
      "cell_user_info": {
        "user": {
          "uin": "10001",
          "uid": "<uid>",
          "nick": "<nick>"
        }
      }
    },
    "comment": {
      "id": "<comment-id-from-detail-or-comments>",
      "user": {
        "uin": "<uin>",
        "uid": "<uid>",
        "nick": "<nick>"
      },
      "like": {
        "id": "<like-id-from-comment>",
        "count": 0,
        "status": 0
      },
      "reply_attach_info": ""
    },
    "reply": {
      "id": "<reply-id-from-comments-or-replies>",
      "user": {
        "uin": "<uin>",
        "uid": "<uid>",
        "nick": "<nick>"
      },
      "like": {
        "id": "<like-id-from-reply>",
        "count": 0,
        "status": 0
      }
    }
  }
}
```

> feed 必须原样取自 get_qzone_public_feeds 的 feeds 数组，不能用旧说说 tid 拼造；示例中的占位字段须整体替换。 comment 可取 get_qzone_public_feed_detail 返回的 feed.feed.cell_comment.comments，或后续评论页；保留完整对象。 reply 使用该评论下的完整回复对象。


<a id="action-forward_qzone_public_feed"></a>
### `forward_qzone_public_feed`

有副作用

将推荐动态转发到当前账号空间

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `feed` | object | ✔ | get_qzone_public_feeds 返回的完整 feeds 条目，保留所有原始 cell 字段 |
| `reason` | string | — | 转发附言，可为空；默认 `` |

**返回**：上游转发结果，保留未知字段。

**示例**

- 转发推荐动态到我的空间

```json
{
  "action": "forward_qzone_public_feed",
  "params": {
    "feed": {
      "cell_common": {
        "union_id": {
          "uf_key": "<uf_key-from-get_qzone_public_feeds>",
          "ugc_id": "<ugc_id>",
          "feed_id": "<feed_id>",
          "ext_ids": []
        },
        "cur_like_key": "<like-key>",
        "domain_type": 3
      },
      "cell_feed_transfer": {},
      "cell_user_info": {
        "user": {
          "uin": "10001",
          "uid": "<uid>",
          "nick": "<nick>"
        }
      }
    },
    "reason": "分享这条动态"
  }
}
```

> feed 必须原样取自 get_qzone_public_feeds 的 feeds 数组，不能用旧说说 tid 拼造；示例中的占位字段须整体替换。 只转发，不同时评论或发送给 QQ 联系人。


<a id="action-get_qzone_feed_detail"></a>
### `get_qzone_feed_detail`

只读

按说说 tid 读取完整空间动态，可用于生成分享卡片

> **权限**：将示例 tid 替换为 get_qzone_msg_list 或 send_qzone_msg 返回的 24 位十六进制说说编号。把结果的 feed 原样传给 get_qzone_share_ark；读取和分享均受空间权限限制。

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `tid` | string | ✔ | 24 位十六进制说说编号 |

**返回**：完整动态及上游详情字段。feed 保留图片、视频、分享信息和未知字段，可直接用于 get_qzone_share_ark；attach_info 保留上游评论游标，不自动翻页。

**约束**

- tid must be a 24-character hexadecimal post ID

**示例**

- 按说说编号获取完整动态

```json
{
  "action": "get_qzone_feed_detail",
  "params": {
    "tid": "1127000000f1536501000000"
  }
}
```

> 将示例 tid 替换为 get_qzone_msg_list 或 send_qzone_msg 返回的 24 位十六进制说说编号。把结果的 feed 原样传给 get_qzone_share_ark；读取和分享均受空间权限限制。


<a id="action-get_qzone_feeds"></a>
### `get_qzone_feeds`

只读

获取 QQ 空间好友动态，支持结构化正文与游标分页

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `page_num` | int | — | 页码（1 起）；不传 cursor 时从首页顺序定位，较深页可能耗时较长；默认 `1`（min 1） |
| `count` | int | — | 本页数量；默认 `10`（min 1, max 50） |
| `cursor` | string | — | 上一次返回的 next_cursor；原样传递，省略 page_num 或传入对应页码 |

**返回**：好友动态、可提取的正文与图片、统计值及下一页游标；未知内容或统计为 null，HTML 保留。

**示例**

- 获取 QQ 空间好友动态首页及结构化内容

```json
{
  "action": "get_qzone_feeds",
  "params": {
    "page_num": 1,
    "count": 10
  }
}
```

> 保留 html；content/images 为可提取的正文和图片，未知值为 null。续页使用 next_cursor。

**示例**

- 继续读取上一页之后的好友动态

```json
{
  "action": "get_qzone_feeds",
  "params": {
    "cursor": "<next_cursor-from-get_qzone_feeds>",
    "count": 10
  }
}
```

> cursor 原样使用上次返回的 next_cursor，仅适用于同一账号；has_more=false 时停止。


<a id="action-get_qzone_home_feeds"></a>
### `get_qzone_home_feeds`

只读

读取自己或有权访问的空间主页动态，保留完整分享信息

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `target_uin` | uint | — | 主页所属 QQ 号，省略则为当前账号（min 1） |
| `cursor` | string | — | 上次返回的 next_cursor，仅限同一账号及主页 |

**返回**：完整动态及分页状态；访问受空间权限限制，旧说说接口保持不变。

**示例**

- 读取自己的主页动态

```json
{
  "action": "get_qzone_home_feeds",
  "params": {}
}
```

**示例**

- 继续读取同一主页

```json
{
  "action": "get_qzone_home_feeds",
  "params": {
    "target_uin": 10001,
    "cursor": "<next_cursor-from-get_qzone_home_feeds>"
  }
}
```


<a id="action-get_qzone_msg_detail"></a>
### `get_qzone_msg_detail`

只读

获取 QQ 空间说说详情与一页评论（含服务端内联回复，需有访问权限）

> **权限**：tid 来自 get_qzone_msg_list；操作需有该说说的访问或管理权限。 replies 仅为服务端内联回复，不保证完整。

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `tid` | string | ✔ | 说说 tid（来自 get_qzone_msg_list / send_qzone_msg） |
| `target_uin` | uint | — | 说说所属 QQ 号，省略则取机器人自己（min 1） |
| `pos` | int | — | 一级评论起始偏移；默认 `0`（min 0） |
| `num` | int | — | 请求的一级评论数量，实际数量受服务端限制；默认 `20`（min 1, max 100） |

**返回**：说说详情、服务端报告的评论总数与本页评论；replies 仅含服务端内联返回的二级回复，不保证完整。

**示例**

- 获取 QQ 空间说说详情与一页评论（含服务端内联回复，需有访问权限）

```json
{
  "action": "get_qzone_msg_detail",
  "params": {
    "tid": "<tid-from-get_qzone_msg_list>",
    "pos": 0,
    "num": 20
  }
}
```

> tid 来自 get_qzone_msg_list；操作需有该说说的访问或管理权限。 replies 仅为服务端内联回复，不保证完整。


<a id="action-get_qzone_msg_list"></a>
### `get_qzone_msg_list`

只读

获取 QQ 空间说说列表（默认机器人自己的空间）

> **权限**：默认读取当前账号；指定 target_uin 时需有访问权限。

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `target_uin` | uint | — | 目标 QQ 号，省略则取机器人自己（min 1） |
| `pos` | int | — | 起始偏移；默认 `0`（min 0） |
| `num` | int | — | 本页数量；默认 `20`（min 1, max 100） |

**返回**：说说列表对象，含说说总数与本页说说数组。

**示例**

- 获取 QQ 空间说说列表（默认机器人自己的空间）

```json
{
  "action": "get_qzone_msg_list",
  "params": {
    "pos": 0,
    "num": 20
  }
}
```

> 默认读取当前账号；指定 target_uin 时需有访问权限。


<a id="action-get_qzone_profile"></a>
### `get_qzone_profile`

只读

获取 QQ 空间名称和说明（默认当前账号）

> **权限**：需要有该空间的访问权限。

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `target_uin` | uint | — | 目标 QQ 号，省略则取机器人自己（min 1） |

**返回**：空间名称和说明。

**示例**

- 获取当前账号的空间名称和说明

```json
{
  "action": "get_qzone_profile",
  "params": {}
}
```

**示例**

- 获取指定账号的空间名称和说明

```json
{
  "action": "get_qzone_profile",
  "params": {
    "target_uin": 10001
  }
}
```

> 需要有该空间的访问权限。


<a id="action-get_qzone_public_capabilities"></a>
### `get_qzone_public_capabilities`

只读

读取当前账号的空友爱看入口与推权限

**参数**：无

**返回**：当前账号的上游入口能力对象，保留未知字段。

**示例**

- 查询当前账号是否有空友爱看入口及推能力

```json
{
  "action": "get_qzone_public_capabilities",
  "params": {}
}
```


<a id="action-get_qzone_public_comments"></a>
### `get_qzone_public_comments`

只读

继续读取推荐动态评论

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `feed` | object | ✔ | get_qzone_public_feeds 返回的完整 feeds 条目，保留所有原始 cell 字段 |
| `cursor` | string | ✔ | 详情或上一评论页返回的 attach_info |

**返回**：上游评论页对象，保留评论、分页和未知字段。

**示例**

- 读取详情之后的下一页评论

```json
{
  "action": "get_qzone_public_comments",
  "params": {
    "feed": {
      "cell_common": {
        "union_id": {
          "uf_key": "<uf_key-from-get_qzone_public_feeds>",
          "ugc_id": "<ugc_id>",
          "feed_id": "<feed_id>",
          "ext_ids": []
        },
        "cur_like_key": "<like-key>",
        "domain_type": 3
      },
      "cell_feed_transfer": {},
      "cell_user_info": {
        "user": {
          "uin": "10001",
          "uid": "<uid>",
          "nick": "<nick>"
        }
      }
    },
    "cursor": "<attach_info-from-detail-or-comments>"
  }
}
```

> feed 必须原样取自 get_qzone_public_feeds 的 feeds 数组，不能用旧说说 tid 拼造；示例中的占位字段须整体替换。 先读详情获取初始评论及 attach_info，再原样传入 cursor。


<a id="action-get_qzone_public_feed_detail"></a>
### `get_qzone_public_feed_detail`

只读

读取推荐动态详情及初始评论

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `feed` | object | ✔ | get_qzone_public_feeds 返回的完整 feeds 条目，保留所有原始 cell 字段 |

**返回**：上游详情 data；初始评论位于 feed.feed.cell_comment.comments，续页使用 attach_info。

**示例**

- 读取推荐动态详情

```json
{
  "action": "get_qzone_public_feed_detail",
  "params": {
    "feed": {
      "cell_common": {
        "union_id": {
          "uf_key": "<uf_key-from-get_qzone_public_feeds>",
          "ugc_id": "<ugc_id>",
          "feed_id": "<feed_id>",
          "ext_ids": []
        },
        "cur_like_key": "<like-key>",
        "domain_type": 3
      },
      "cell_feed_transfer": {},
      "cell_user_info": {
        "user": {
          "uin": "10001",
          "uid": "<uid>",
          "nick": "<nick>"
        }
      }
    }
  }
}
```

> feed 必须原样取自 get_qzone_public_feeds 的 feeds 数组，不能用旧说说 tid 拼造；示例中的占位字段须整体替换。


<a id="action-get_qzone_public_feeds"></a>
### `get_qzone_public_feeds`

只读

读取空友爱看推荐动态，支持独立游标分页

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `cursor` | string | — | 上次返回的 next_cursor，省略则刷新首页 |

**返回**：推荐动态原始 cell 对象及分页状态，保留其余上游页面字段。

**示例**

- 读取空友爱看推荐首页

```json
{
  "action": "get_qzone_public_feeds",
  "params": {}
}
```

**示例**

- 继续读取推荐动态

```json
{
  "action": "get_qzone_public_feeds",
  "params": {
    "cursor": "<next_cursor-from-get_qzone_public_feeds>"
  }
}
```

> cursor 原样使用上次返回的 next_cursor，仅适用于同一账号；has_more=false 时停止。


<a id="action-get_qzone_public_replies"></a>
### `get_qzone_public_replies`

只读

继续读取指定评论的回复

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `feed` | object | ✔ | get_qzone_public_feeds 返回的完整 feeds 条目，保留所有原始 cell 字段 |
| `comment` | object | ✔ | 详情或评论页返回的完整评论对象，保留 user 等原始字段 |
| `cursor` | string | — | 上一回复页的 reply_attach_info；省略则使用评论自带游标；默认 `` |
| `page_size` | int | — | 请求的回复数量；默认 `20`（min 1） |

**返回**：上游回复页对象，保留回复、分页和未知字段。

**示例**

- 读取某条评论的后续回复

```json
{
  "action": "get_qzone_public_replies",
  "params": {
    "feed": {
      "cell_common": {
        "union_id": {
          "uf_key": "<uf_key-from-get_qzone_public_feeds>",
          "ugc_id": "<ugc_id>",
          "feed_id": "<feed_id>",
          "ext_ids": []
        },
        "cur_like_key": "<like-key>",
        "domain_type": 3
      },
      "cell_feed_transfer": {},
      "cell_user_info": {
        "user": {
          "uin": "10001",
          "uid": "<uid>",
          "nick": "<nick>"
        }
      }
    },
    "comment": {
      "id": "<comment-id-from-detail-or-comments>",
      "user": {
        "uin": "<uin>",
        "uid": "<uid>",
        "nick": "<nick>"
      },
      "like": {
        "id": "<like-id-from-comment>",
        "count": 0,
        "status": 0
      },
      "reply_attach_info": ""
    }
  }
}
```

> feed 必须原样取自 get_qzone_public_feeds 的 feeds 数组，不能用旧说说 tid 拼造；示例中的占位字段须整体替换。 comment 可取 get_qzone_public_feed_detail 返回的 feed.feed.cell_comment.comments，或后续评论页；保留完整对象。 首次续读使用评论自带的 reply_attach_info；之后传上一回复页的游标。


<a id="action-get_qzone_share_ark"></a>
### `get_qzone_share_ark`

有副作用

生成空间动态分享卡片，返回原文及分享提示

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `feed` | object | ✔ | 主页、详情或推荐列表返回的完整动态，保留所有原始字段 |

**返回**：生成卡片但不发送消息；后续发送仍返回普通消息编号。

**示例**

- 生成卡片后通过 JSON 消息发送

```json
{
  "action": "get_qzone_share_ark",
  "params": {
    "feed": {
      "cell_common": {
        "union_id": {
          "uf_key": "<uf_key-from-get_qzone_public_feeds>",
          "ugc_id": "<ugc_id>",
          "feed_id": "<feed_id>",
          "ext_ids": []
        },
        "cur_like_key": "<like-key>",
        "domain_type": 3
      },
      "cell_feed_transfer": "<original-cell_feed_transfer>",
      "cell_user_info": {
        "user": {
          "uin": "10001",
          "uid": "<uid>",
          "nick": "<nick>"
        }
      },
      "cell_operation": {
        "share_outside": {
          "share_access_resource": {
            "busi_id": "<original-busi_id>",
            "resource_id": "<original-resource_id>"
          }
        }
      }
    }
  }
}
```

> feed 原样取自 get_qzone_feed_detail 的 feed，或 get_qzone_home_feeds / get_qzone_public_feeds 的 feeds 条目。分享链接可能允许未登录者访问并包含作者 QQ 号；如 requires_confirmation=true，发送前展示 notice 并取得确认。将 ark 原文作为 JSON 消息发送，不要修改卡片内容。


<a id="action-like_qzone"></a>
### `like_qzone`

有副作用

给一条说说点赞（QQ 空间）

> **权限**：tid 来自 get_qzone_msg_list；操作需有该说说的访问或管理权限。

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `tid` | string | ✔ | 说说 tid |
| `target_uin` | uint | — | 说说所属 QQ 号，省略则为机器人自己（min 1） |
| `abstime` | int | — | 说说发表时间（unix 秒），传真实值更可靠；默认 `0`（min 0） |

**返回**：null

**示例**

- 给一条说说点赞（QQ 空间）

```json
{
  "action": "like_qzone",
  "params": {
    "tid": "<tid-from-get_qzone_msg_list>",
    "target_uin": 10001
  }
}
```

> tid 来自 get_qzone_msg_list；操作需有该说说的访问或管理权限。


<a id="action-reply_qzone_public_feed"></a>
### `reply_qzone_public_feed`

有副作用

回复推荐动态的评论或其中某条回复

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `feed` | object | ✔ | get_qzone_public_feeds 返回的完整 feeds 条目，保留所有原始 cell 字段 |
| `comment` | object | ✔ | 详情或评论页返回的完整评论对象，保留 user 等原始字段 |
| `content` | string | object[] | ✔ | 非空文本，或非空上游 RichItem 对象数组；字符串始终原样发送，富文本请直接传对象数组，不是 OneBot 消息段 |
| `reply` | object | — | 评论或回复页返回的完整回复对象，保留 user 等原始字段 |

**返回**：上游回复结果，包含新回复，保留未知字段。

**示例**

- 回复一条评论

```json
{
  "action": "reply_qzone_public_feed",
  "params": {
    "feed": {
      "cell_common": {
        "union_id": {
          "uf_key": "<uf_key-from-get_qzone_public_feeds>",
          "ugc_id": "<ugc_id>",
          "feed_id": "<feed_id>",
          "ext_ids": []
        },
        "cur_like_key": "<like-key>",
        "domain_type": 3
      },
      "cell_feed_transfer": {},
      "cell_user_info": {
        "user": {
          "uin": "10001",
          "uid": "<uid>",
          "nick": "<nick>"
        }
      }
    },
    "comment": {
      "id": "<comment-id-from-detail-or-comments>",
      "user": {
        "uin": "<uin>",
        "uid": "<uid>",
        "nick": "<nick>"
      },
      "like": {
        "id": "<like-id-from-comment>",
        "count": 0,
        "status": 0
      },
      "reply_attach_info": ""
    },
    "content": "感谢回复"
  }
}
```

> feed 必须原样取自 get_qzone_public_feeds 的 feeds 数组，不能用旧说说 tid 拼造；示例中的占位字段须整体替换。 comment 可取 get_qzone_public_feed_detail 返回的 feed.feed.cell_comment.comments，或后续评论页；保留完整对象。

**示例**

- 回复评论中的某条回复

```json
{
  "action": "reply_qzone_public_feed",
  "params": {
    "feed": {
      "cell_common": {
        "union_id": {
          "uf_key": "<uf_key-from-get_qzone_public_feeds>",
          "ugc_id": "<ugc_id>",
          "feed_id": "<feed_id>",
          "ext_ids": []
        },
        "cur_like_key": "<like-key>",
        "domain_type": 3
      },
      "cell_feed_transfer": {},
      "cell_user_info": {
        "user": {
          "uin": "10001",
          "uid": "<uid>",
          "nick": "<nick>"
        }
      }
    },
    "comment": {
      "id": "<comment-id-from-detail-or-comments>",
      "user": {
        "uin": "<uin>",
        "uid": "<uid>",
        "nick": "<nick>"
      },
      "like": {
        "id": "<like-id-from-comment>",
        "count": 0,
        "status": 0
      },
      "reply_attach_info": ""
    },
    "content": [
      {
        "type": 0,
        "content": "我也这么认为"
      }
    ],
    "reply": {
      "id": "<reply-id-from-comments-or-replies>",
      "user": {
        "uin": "<uin>",
        "uid": "<uid>",
        "nick": "<nick>"
      },
      "like": {
        "id": "<like-id-from-reply>",
        "count": 0,
        "status": 0
      }
    }
  }
}
```

> feed 必须原样取自 get_qzone_public_feeds 的 feeds 数组，不能用旧说说 tid 拼造；示例中的占位字段须整体替换。 comment 可取 get_qzone_public_feed_detail 返回的 feed.feed.cell_comment.comments，或后续评论页；保留完整对象。 reply 使用该评论下的完整回复对象。


<a id="action-send_qzone_msg"></a>
### `send_qzone_msg`

有副作用

发表说说（QQ 空间，支持纯文字或带图；传 images 自动上传；可设置查看权限）

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `content` | string | ✔ | 说说正文 |
| `images` | string[] | — | 图片数组（可选），支持 file:// http:// base64://；自动上传 |
| `ugc_right` | int | — | 查看权限：1=所有人可见，4=好友可见，16=部分好友可见，64=仅自己可见，128=部分好友不可见；默认 `1`（min 1） |
| `target_uins` | uint[] | — | 权限作用 QQ 号数组；ugc_right=16 时表示可见名单，128 时表示不可见名单 |

**返回**：object（`tid`, `time`）

**约束**

- ugc_right must be one of 1, 4, 16, 64, 128
- target_uins is required when ugc_right is 16 or 128

**示例**

- 发表说说（QQ 空间，支持纯文字或带图；传 images 自动上传；可设置查看权限）

```json
{
  "action": "send_qzone_msg",
  "params": {
    "content": "今天的学习记录",
    "ugc_right": 64
  }
}
```

> 会发布说说；ugc_right=64 仅自己可见。16/128 还必须提供 target_uins。


<a id="action-set_qzone_ban"></a>
### `set_qzone_ban`

有副作用

拉黑或解除拉黑某人（修改机器人自身 QQ 空间黑名单；enable=true 拉黑，false 解除）

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `user_id` | uint | ✔ | 目标 QQ 号（min 1） |
| `enable` | bool | — | true 拉黑，false 解除拉黑；默认 `true` |

**返回**：null

**示例**

- 拉黑或解除拉黑某人（修改机器人自身 QQ 空间黑名单；enable=true 拉黑，false 解除）

```json
{
  "action": "set_qzone_ban",
  "params": {
    "user_id": 10001,
    "enable": true
  }
}
```

> 修改当前账号空间黑名单。


<a id="action-set_qzone_msg_right"></a>
### `set_qzone_msg_right`

有副作用

修改一条已发说说的查看权限（QQ 空间，按 tid）

> **权限**：tid 来自 get_qzone_msg_list；操作需有该说说的访问或管理权限。 16 表示仅所选好友可见。

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `tid` | string | ✔ | 说说 tid（来自 get_qzone_msg_list / send_qzone_msg） |
| `ugc_right` | int | ✔ | 查看权限：1=所有人可见，4=好友可见，16=部分好友可见，64=仅自己可见，128=部分好友不可见（min 1） |
| `target_uins` | uint[] | — | 权限作用 QQ 号数组；ugc_right=16 时表示可见名单，128 时表示不可见名单 |

**返回**：更新后的权限对象。

**约束**

- ugc_right must be one of 1, 4, 16, 64, 128
- target_uins is required when ugc_right is 16 or 128

**示例**

- 修改一条已发说说的查看权限（QQ 空间，按 tid）

```json
{
  "action": "set_qzone_msg_right",
  "params": {
    "tid": "<tid-from-get_qzone_msg_list>",
    "ugc_right": 16,
    "target_uins": [
      10001
    ]
  }
}
```

> tid 来自 get_qzone_msg_list；操作需有该说说的访问或管理权限。 16 表示仅所选好友可见。


<a id="action-set_qzone_profile"></a>
### `set_qzone_profile`

有副作用

修改当前账号的 QQ 空间名称或说明

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | — | 新的空间名称，空字符串表示清空，省略则保留 |
| `description` | string | — | 新的空间说明，空字符串表示清空，省略则保留 |

**返回**：null

**约束**

- at least one of: name, description

**示例**

- 修改当前账号的空间名称和说明

```json
{
  "action": "set_qzone_profile",
  "params": {
    "name": "我的空间",
    "description": "记录日常"
  }
}
```

> 仅修改提供的字段；空字符串表示清空对应字段。

**示例**

- 清空当前账号的空间说明

```json
{
  "action": "set_qzone_profile",
  "params": {
    "description": ""
  }
}
```


<a id="action-set_qzone_public_comment_like"></a>
### `set_qzone_public_comment_like`

有副作用

点赞或取消赞推荐动态中的评论或回复

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `feed` | object | ✔ | get_qzone_public_feeds 返回的完整 feeds 条目，保留所有原始 cell 字段 |
| `comment` | object | ✔ | 详情或评论页返回的完整评论对象，保留 user 等原始字段 |
| `enable` | bool | — | true 点赞，false 取消赞；默认 `true` |
| `reply` | object | — | 评论或回复页返回的完整回复对象，保留 user 等原始字段 |

**返回**：上游普通赞操作结果，保留未知字段。

**示例**

- 点赞一条评论

```json
{
  "action": "set_qzone_public_comment_like",
  "params": {
    "feed": {
      "cell_common": {
        "union_id": {
          "uf_key": "<uf_key-from-get_qzone_public_feeds>",
          "ugc_id": "<ugc_id>",
          "feed_id": "<feed_id>",
          "ext_ids": []
        },
        "cur_like_key": "<like-key>",
        "domain_type": 3
      },
      "cell_feed_transfer": {},
      "cell_user_info": {
        "user": {
          "uin": "10001",
          "uid": "<uid>",
          "nick": "<nick>"
        }
      }
    },
    "comment": {
      "id": "<comment-id-from-detail-or-comments>",
      "user": {
        "uin": "<uin>",
        "uid": "<uid>",
        "nick": "<nick>"
      },
      "like": {
        "id": "<like-id-from-comment>",
        "count": 0,
        "status": 0
      },
      "reply_attach_info": ""
    }
  }
}
```

> feed 必须原样取自 get_qzone_public_feeds 的 feeds 数组，不能用旧说说 tid 拼造；示例中的占位字段须整体替换。 comment 可取 get_qzone_public_feed_detail 返回的 feed.feed.cell_comment.comments，或后续评论页；保留完整对象。 必须保留评论原始 like.id。

**示例**

- 取消赞某条回复

```json
{
  "action": "set_qzone_public_comment_like",
  "params": {
    "feed": {
      "cell_common": {
        "union_id": {
          "uf_key": "<uf_key-from-get_qzone_public_feeds>",
          "ugc_id": "<ugc_id>",
          "feed_id": "<feed_id>",
          "ext_ids": []
        },
        "cur_like_key": "<like-key>",
        "domain_type": 3
      },
      "cell_feed_transfer": {},
      "cell_user_info": {
        "user": {
          "uin": "10001",
          "uid": "<uid>",
          "nick": "<nick>"
        }
      }
    },
    "comment": {
      "id": "<comment-id-from-detail-or-comments>",
      "user": {
        "uin": "<uin>",
        "uid": "<uid>",
        "nick": "<nick>"
      },
      "like": {
        "id": "<like-id-from-comment>",
        "count": 0,
        "status": 0
      },
      "reply_attach_info": ""
    },
    "reply": {
      "id": "<reply-id-from-comments-or-replies>",
      "user": {
        "uin": "<uin>",
        "uid": "<uid>",
        "nick": "<nick>"
      },
      "like": {
        "id": "<like-id-from-reply>",
        "count": 0,
        "status": 0
      }
    },
    "enable": false
  }
}
```

> feed 必须原样取自 get_qzone_public_feeds 的 feeds 数组，不能用旧说说 tid 拼造；示例中的占位字段须整体替换。 reply 使用该评论下的完整回复对象，保留其原始 like.id。


<a id="action-set_qzone_public_follow"></a>
### `set_qzone_public_follow`

有副作用

蹲或取消蹲推荐动态作者

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `feed` | object | ✔ | get_qzone_public_feeds 返回的完整 feeds 条目，保留所有原始 cell 字段 |
| `enable` | bool | — | true 蹲，false 取消蹲；默认 `true` |

**返回**：上游关系操作结果，保留未知字段。

**示例**

- 蹲这条推荐动态的作者

```json
{
  "action": "set_qzone_public_follow",
  "params": {
    "feed": {
      "cell_common": {
        "union_id": {
          "uf_key": "<uf_key-from-get_qzone_public_feeds>",
          "ugc_id": "<ugc_id>",
          "feed_id": "<feed_id>",
          "ext_ids": []
        },
        "cur_like_key": "<like-key>",
        "domain_type": 3
      },
      "cell_feed_transfer": {},
      "cell_user_info": {
        "user": {
          "uin": "10001",
          "uid": "<uid>",
          "nick": "<nick>"
        }
      }
    },
    "enable": true
  }
}
```

> feed 必须原样取自 get_qzone_public_feeds 的 feeds 数组，不能用旧说说 tid 拼造；示例中的占位字段须整体替换。 feed 需保留作者 cell_user_info。


<a id="action-set_qzone_public_like"></a>
### `set_qzone_public_like`

有副作用

点赞或取消赞推荐动态

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `feed` | object | ✔ | get_qzone_public_feeds 返回的完整 feeds 条目，保留所有原始 cell 字段 |
| `enable` | bool | — | true 点赞，false 取消赞；默认 `true` |

**返回**：上游普通赞操作结果，保留未知字段。

**示例**

- 点赞推荐动态

```json
{
  "action": "set_qzone_public_like",
  "params": {
    "feed": {
      "cell_common": {
        "union_id": {
          "uf_key": "<uf_key-from-get_qzone_public_feeds>",
          "ugc_id": "<ugc_id>",
          "feed_id": "<feed_id>",
          "ext_ids": []
        },
        "cur_like_key": "<like-key>",
        "domain_type": 3
      },
      "cell_feed_transfer": {},
      "cell_user_info": {
        "user": {
          "uin": "10001",
          "uid": "<uid>",
          "nick": "<nick>"
        }
      }
    },
    "enable": true
  }
}
```

> feed 必须原样取自 get_qzone_public_feeds 的 feeds 数组，不能用旧说说 tid 拼造；示例中的占位字段须整体替换。


<a id="action-set_qzone_public_upvote"></a>
### `set_qzone_public_upvote`

有副作用

推或取消推空友爱看动态（独立于普通赞）

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `feed` | object | ✔ | get_qzone_public_feeds 返回的完整 feeds 条目，保留所有原始 cell 字段 |
| `enable` | bool | — | true 推，false 取消推；默认 `true` |

**返回**：上游推操作结果，保留未知字段。

**示例**

- 推一条推荐动态

```json
{
  "action": "set_qzone_public_upvote",
  "params": {
    "feed": {
      "cell_common": {
        "union_id": {
          "uf_key": "<uf_key-from-get_qzone_public_feeds>",
          "ugc_id": "<ugc_id>",
          "feed_id": "<feed_id>",
          "ext_ids": []
        },
        "cur_like_key": "<like-key>",
        "domain_type": 3
      },
      "cell_feed_transfer": {},
      "cell_user_info": {
        "user": {
          "uin": "10001",
          "uid": "<uid>",
          "nick": "<nick>"
        }
      }
    },
    "enable": true
  }
}
```

> feed 必须原样取自 get_qzone_public_feeds 的 feeds 数组，不能用旧说说 tid 拼造；示例中的占位字段须整体替换。


<a id="action-unlike_qzone"></a>
### `unlike_qzone`

有副作用

取消对一条说说的点赞（QQ 空间；取消赞端点待真机核实）

> **权限**：tid 来自 get_qzone_msg_list；操作需有该说说的访问或管理权限。

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `tid` | string | ✔ | 说说 tid |
| `target_uin` | uint | — | 说说所属 QQ 号，省略则为机器人自己（min 1） |
| `abstime` | int | — | 说说发表时间（unix 秒），传真实值更可靠；默认 `0`（min 0） |

**返回**：null

**示例**

- 取消对一条说说的点赞（QQ 空间；取消赞端点待真机核实）

```json
{
  "action": "unlike_qzone",
  "params": {
    "tid": "<tid-from-get_qzone_msg_list>",
    "target_uin": 10001
  }
}
```

> tid 来自 get_qzone_msg_list；操作需有该说说的访问或管理权限。


## 系统表情

共 **4** 个动作。

<details><summary>展开目录</summary>

- [`fetch_face_entity`](#action-fetch_face_entity)
- [`fetch_super_face_id`](#action-fetch_super_face_id)
- [`fetch_sys_faces`](#action-fetch_sys_faces)
- [`search_sys_faces`](#action-search_sys_faces)

</details>

<a id="action-fetch_face_entity"></a>
### `fetch_face_entity`

只读

按编号查询 QQ 系统表情

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `face_id` | int | ✔ | QQ 系统表情编号（min 0） |
| `refresh` | bool | — | 是否强制从 QQ 刷新目录；默认 `false` |

**返回**：表情详情；编号不存在时返回 null。

**示例**

- 按编号查询 QQ 系统表情

```json
{
  "action": "fetch_face_entity",
  "params": {
    "face_id": 14
  }
}
```


<a id="action-fetch_super_face_id"></a>
### `fetch_super_face_id`

只读

判断 QQ 系统表情是否使用超级表情格式

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `face_id` | int | ✔ | QQ 系统表情编号（min 0） |
| `refresh` | bool | — | 是否强制从 QQ 刷新目录；默认 `false` |

**返回**：是否使用超级表情格式。

**示例**

- 判断 QQ 系统表情是否使用超级表情格式

```json
{
  "action": "fetch_super_face_id",
  "params": {
    "face_id": 14
  }
}
```


<a id="action-fetch_sys_faces"></a>
### `fetch_sys_faces`

只读

获取 QQ 系统表情目录

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `refresh` | bool | — | 是否强制从 QQ 刷新目录；默认 `false` |

**返回**：按分组返回完整的 QQ 系统表情映射。

**示例**

- 获取 QQ 系统表情目录

```json
{
  "action": "fetch_sys_faces",
  "params": {
    "refresh": false
  }
}
```


<a id="action-search_sys_faces"></a>
### `search_sys_faces`

只读

搜索 QQ 系统表情

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `query` | string | ✔ | 编号、名称、别名或分组名 |

**返回**：匹配编号、名称、别名或分组名的表情列表。

**示例**

- 搜索 QQ 系统表情

```json
{
  "action": "search_sys_faces",
  "params": {
    "query": "微笑"
  }
}
```


## 流式接口

共 **6** 个动作。

<details><summary>展开目录</summary>

- [`clean_stream_temp_file`](#action-clean_stream_temp_file)
- [`download_file_image_stream`](#action-download_file_image_stream)
- [`download_file_record_stream`](#action-download_file_record_stream)
- [`download_file_stream`](#action-download_file_stream)
- [`test_download_stream`](#action-test_download_stream)
- [`upload_file_stream`](#action-upload_file_stream)

</details>

<a id="action-clean_stream_temp_file"></a>
### `clean_stream_temp_file`

有副作用

清理流式传输临时文件(仅清理 stream 上传/下载目录)

**参数**：无

**返回**：{ message, removed }

**示例**

- 清理流式传输临时文件(仅清理 stream 上传/下载目录)

```json
{
  "action": "clean_stream_temp_file",
  "params": {}
}
```

> 清理未使用的流式临时文件；不会清理正在传输的项目。


<a id="action-download_file_image_stream"></a>
### `download_file_image_stream`

**流式动作**　有副作用

以流式方式下载图片(缓存图片 id / URL / stream 目录本地文件)

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `file` | string | — | 文件路径(限 stream 临时目录)/ http(s) URL |
| `file_id` | string | — | 文件 ID(缓存的图片/语音 id) |
| `chunk_size` | int | — | 分块大小(字节,默认 64KB)（min 1） |

**返回**：流式帧:file_info → file_chunk* → file_complete

**示例**

- 以流式方式下载图片(缓存图片 id / URL / stream 目录本地文件)

```json
{
  "action": "download_file_image_stream",
  "params": {
    "file_id": "<image-file-from-message>",
    "chunk_size": 65536
  }
}
```

> file_id 来自当前账号图片消息；经 invoke_action 调用。


<a id="action-download_file_record_stream"></a>
### `download_file_record_stream`

**流式动作**　有副作用

以流式方式下载语音(缓存语音 id / URL / stream 目录本地文件)

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `file` | string | — | 文件路径(限 stream 临时目录)/ http(s) URL |
| `file_id` | string | — | 文件 ID(缓存的图片/语音 id) |
| `chunk_size` | int | — | 分块大小(字节,默认 64KB)（min 1） |

**返回**：流式帧:file_info → file_chunk* → file_complete

**示例**

- 以流式方式下载语音(缓存语音 id / URL / stream 目录本地文件)

```json
{
  "action": "download_file_record_stream",
  "params": {
    "file_id": "<record-file-from-message>",
    "chunk_size": 65536
  }
}
```

> file_id 来自当前账号语音消息；经 invoke_action 调用。


<a id="action-download_file_stream"></a>
### `download_file_stream`

**流式动作**　有副作用

以流式方式下载文件(stream 目录本地文件 / URL / 缓存媒体)

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `file` | string | — | 文件路径(限 stream 临时目录)/ http(s) URL |
| `file_id` | string | — | 文件 ID(缓存的图片/语音 id) |
| `chunk_size` | int | — | 分块大小(字节,默认 64KB)（min 1） |

**返回**：流式帧:file_info → file_chunk* → file_complete

**示例**

- 以流式方式下载文件(stream 目录本地文件 / URL / 缓存媒体)

```json
{
  "action": "download_file_stream",
  "params": {
    "file": "https://example.com/report.pdf",
    "chunk_size": 65536
  }
}
```

> 替换实际公开可访问地址；经 invoke_action 调用，文件保存到 MCP 下载目录。


<a id="action-test_download_stream"></a>
### `test_download_stream`

**流式动作**　有副作用

测试下载流(推送 10 个数据帧,验证流式传输,不触达 QQ)

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `error` | bool | — | 是否触发测试错误；默认 `false` |

**返回**：流式帧:data_chunk*10 → data_complete(error=true 时以 error 帧结束)

**示例**

- 测试下载流(推送 10 个数据帧,验证流式传输,不触达 QQ)

```json
{
  "action": "test_download_stream",
  "params": {
    "error": false
  }
}
```

> 经 invoke_action 调用，仅测试传输，不访问 QQ。


<a id="action-upload_file_stream"></a>
### `upload_file_stream`

**流式动作**　有副作用

以流式分块方式上传文件到机器人本地(返回可用于发送的本地路径)

**参数**

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `stream_id` | string | ✔ | 流 ID(客户端生成的 UUID,限 [A-Za-z0-9_-]) |
| `chunk_data` | string | — | 分块数据(Base64) |
| `chunk_index` | int | — | 分块索引(从 0 开始)（min 0） |
| `total_chunks` | int | — | 总分块数(新流必填)（min 1） |
| `file_size` | int | — | 文件总大小(字节)（min 0） |
| `expected_sha256` | string | — | 期望的整文件 SHA256(校验) |
| `is_complete` | bool | — | 是否为最后一个分块/触发合并 |
| `filename` | string | — | 文件名 |
| `reset` | bool | — | 重置并丢弃该流 |
| `verify_only` | bool | — | 仅查询当前流状态 |
| `file_retention` | int | — | 合并文件保留毫秒(0=不回收)；默认 `300000`（min 0） |

**返回**：流式帧:分块确认 type=stream、完成 type=response(含 file_path/file_name/file_size/sha256)

**示例**

- 上传分块

```json
{
  "action": "upload_file_stream",
  "params": {
    "stream_id": "example-upload-001",
    "filename": "hello.txt",
    "total_chunks": 1,
    "file_size": 5,
    "chunk_index": 0,
    "chunk_data": "aGVsbG8="
  }
}
```

> 第 1 步：每次上传生成新的 stream_id；这里上传 hello 的唯一分块。通过 invoke_action 调用，分块确认不等于整文件完成。

**示例**

- 完成同一上传

```json
{
  "action": "upload_file_stream",
  "params": {
    "stream_id": "example-upload-001",
    "is_complete": true
  }
}
```

> 第 2 步：等待全部分块确认后，用同一个 stream_id 单独请求完成；成功时返回 file_path。MCP 的 invoke_action 也可通过 execution.input_file 自动完成上传。


## 3. 只读动作清单

共 **91** 个动作标记为 `readOnly`，语义上**不产生副作用**（纯查询），适合轮询、只读账号与自动化巡检。

**信息**（5）：`can_send_image`、`can_send_record`、`get_login_info`、`get_status`、`get_version_info`

**消息**（1）：`get_msg`

**好友**（2）：`get_friend_list`、`get_stranger_info`

**群信息**（7）：`get_group_honor_info`、`get_group_info`、`get_group_list`、`get_group_member_info`、`get_group_member_list`、`get_group_share_link`、`get_group_system_msg`

**群管理**（3）：`get_group_admin_permissions`、`get_group_admin_settings`、`get_group_tags`

**群文件**（4）：`get_group_file_url`、`get_group_files_by_folder`、`get_group_root_files`、`get_private_file_url`

**扩展**（51）：`.get_word_slices`、`_get_friend_dress`、`_get_group_notice`、`_get_model_show`、`check_url_safely`、`fetch_custom_face`、`fetch_custom_face_detail`、`fetch_emoji_like`、`fetch_ptt_text`、`get_ai_characters`、`get_clientkey`、`get_collection_list`、`get_cookies`、`get_credentials`、`get_csrf_token`、`get_doubt_friends_add_request`、`get_emoji_likes`、`get_essence_msg_list`、`get_file`、`get_fileset_id`、`get_forward_msg`、`get_friend_msg_history`、`get_friends_with_category`、`get_group_at_all_remain`、`get_group_detail_info`、`get_group_file_system_info`、`get_group_ignore_add_request`、`get_group_ignored_notifies`、`get_group_info_ex`、`get_group_msg_history`、`get_group_shut_list`、`get_group_signed_list`、`get_group_todo_list`、`get_image`、`get_mini_app_ark`、`get_msg_emoji_likes`、`get_online_clients`、`get_profile_like`、`get_recent_contact`、`get_record`、`get_rkey`、`get_rkey_server`、`get_unidirectional_friend_list`、`nc_get_packet_status`、`nc_get_user_status`、`ocr_image`、`send_ark_share`、`send_group_ark_share`、`share_group_ex`、`share_peer`、`translate_en2zh`

**群相册**（3）：`get_group_album_list`、`get_group_album_media_list`、`get_qun_album_list`

**空间**（11）：`get_qzone_feed_detail`、`get_qzone_feeds`、`get_qzone_home_feeds`、`get_qzone_msg_detail`、`get_qzone_msg_list`、`get_qzone_profile`、`get_qzone_public_capabilities`、`get_qzone_public_comments`、`get_qzone_public_feed_detail`、`get_qzone_public_feeds`、`get_qzone_public_replies`

**系统表情**（4）：`fetch_face_entity`、`fetch_super_face_id`、`fetch_sys_faces`、`search_sys_faces`

> 注：`readOnly` 是**实现声明的语义标记**，不代表服务端一定无副作用，也不代表调用无成本（部分只读动作会真实请求 QQ 服务端）。

## 4. 兼容别名

别名与主名**解析到同一实现**，参数、返回值、校验完全相同。
以 `.` 开头的名字沿用 NapCat / go-cqhttp 历史约定。

| 主名 | 别名 | 分类 | 备注 |
| --- | --- | --- | --- |
| `fetch_ptt_text` | `get_ptt_text`、`get_record_text` | 扩展 | 语音转文字；两个历史名并存 |
| `get_rkey` | `nc_get_rkey` | 扩展 | 下载 rkey；`nc_` 前缀为历史名 |
| `ocr_image` | `.ocr_image` | 扩展 | `.` 前缀兼容名 |
| `send_packet` | `.send_packet` | 扩展 | `.` 前缀兼容名；原始 SSO 包发送，高危 |
| `set_group_sign` | `send_group_sign` | 扩展 | 群签到；原 OneBot 名与 QQ 客户端名并存 |

**以 `.` 开头的可调用名（共 3 个）**

| 名字 | 类型 | 说明 |
| --- | --- | --- |
| `.get_word_slices` | 主名 | ⚠️ **未实现**，调用返回 `100 not yet implemented` |
| `.ocr_image` | 别名 | 同 `ocr_image` |
| `.send_packet` | 别名 | 同 `send_packet` |

**隐藏 raw 动作**（不出现在 `get_supported_actions` 中，但可调用）

| 名字 | 角色 | 说明 |
| --- | --- | --- |
| `.handle_quick_operation` | 主名 | NoneBot 1 风格的“快速操作”：传入事件 + 操作，
由服务端决定调用 `send_group_msg` / `send_private_msg` |
| `.handle_quick_operation_async` | 别名 | 同上 |

## 5. 未实现 / 不支持的动作

以下动作**可以调用、有完整文档，但必定失败**。请在集成时排除。

| 动作 | 分类 | 实际行为 |
| --- | --- | --- |
| `.get_word_slices` | 扩展 | 返回 `100` / `wording: "not yet implemented"` |
| `create_collection` | 扩展 | 返回 `100` / `wording: "not yet implemented"` |
| `set_group_anonymous` | 群管理 | **未实现但返回成功**（`ok`）—— 调用方会误以为生效，需特别注意 |
| `set_group_anonymous_ban` | 群管理 | **未实现但返回成功**（`ok`）—— 调用方会误以为生效，需特别注意 |
| `set_restart` | 扩展 | 返回 `100` / `wording: "not supported"` |

> ⚠️ **`set_group_anonymous` / `set_group_anonymous_ban` 是静默失败**：
> 源码标注「未实现，返回 ok」，即**不报错但什么也没做**。
> 这比显式失败更危险，集成时必须单独规避。
>
> ✅ **已实测确认**（运行实例）：两者均返回
> `{"status":"ok","retcode":0,"data":null}` —— **成功响应但无任何效果**。
> 而 `create_collection` / `.get_word_slices` / `set_restart` 返回
> `100 not yet implemented` / `100 not supported`，属**显式失败**。

**条件性未实现**：`get_rkey` 与 `get_rkey_server` 在宿主未提供
`getDownloadRKeys` 能力时返回 `100 not implemented`。

> ✅ 实测：在本运行实例上 `get_rkey` **可用**，正常返回 rkey 数组
> （含 `rkey` / `type` / `ttl` / `create_time`）。上述回退仅在宿主能力缺失时发生。

### 5.1 标准动作的缺失项

与 OneBot v11 标准动作清单比对（39 个常用标准动作），**仅 1 个缺失**：

| 标准动作 | 状态 | 替代方案 |
| --- | --- | --- |
| `get_supported_actions` | ❌ **未提供**，返回 `1404 unknown action` | 使用 WebUI 的 `GET /api/debug/actions`（返回全部 222 个动作的完整文档） |

> 已实测：`POST /get_supported_actions` 与 `_get_supported_actions` 均返回
> `{"status":"failed","retcode":1404,"data":null,"wording":"unknown action"}`。
> 其余 38 个标准动作均已覆盖。

## 6. 需要特殊权限的动作

权限最终由 **QQ 服务端**判定，本实现不做本地鉴权。下表是源码文档中
**显式标注**了权限要求的动作（30 个）。
未列出的动作同样可能因账号身份不足而失败。

| 动作 | 分类 | 权限说明 |
| --- | --- | --- |
| [`_del_group_notice`](#action-_del_group_notice) | 扩展 | notice_id 来自 _get_group_notice；删除需要管理权限。 |
| [`_send_group_notice`](#action-_send_group_notice) | 扩展 | 需要群公告管理权限；普通公告 type=1，新成员公告 type=20。 |
| [`add_group_tag`](#action-add_group_tag) | 群管理 | 替换实际群分类和标签；需要当前账号有管理权限。 |
| [`comment_qzone`](#action-comment_qzone) | 空间 | tid 来自 get_qzone_msg_list；操作需有该说说的访问或管理权限。 |
| [`delete_group_file`](#action-delete_group_file) | 群文件 | 替换群文件列表中的实际 file_id；需要对应文件操作权限。 |
| [`delete_group_tag`](#action-delete_group_tag) | 群管理 | 替换实际群分类和标签；需要当前账号有管理权限。 |
| [`delete_qzone_msg`](#action-delete_qzone_msg) | 空间 | tid 来自 get_qzone_msg_list；操作需有该说说的访问或管理权限。 |
| [`get_group_admin_permissions`](#action-get_group_admin_permissions) | 群管理 | user_id 为目标管理员 QQ 号；包含接收加群验证消息状态。 |
| [`get_qzone_feed_detail`](#action-get_qzone_feed_detail) | 空间 | 将示例 tid 替换为 get_qzone_msg_list 或 send_qzone_msg 返回的 24 位十六进制说说编号。把结果的 feed 原样传给 get_qzone_share_ark；读取和分享均受空间权限限制。 |
| [`get_qzone_msg_detail`](#action-get_qzone_msg_detail) | 空间 | tid 来自 get_qzone_msg_list；操作需有该说说的访问或管理权限。 replies 仅为服务端内联回复，不保证完整。 |
| [`get_qzone_msg_list`](#action-get_qzone_msg_list) | 空间 | 默认读取当前账号；指定 target_uin 时需有访问权限。 |
| [`get_qzone_profile`](#action-get_qzone_profile) | 空间 | 需要有该空间的访问权限。 |
| [`like_qzone`](#action-like_qzone) | 空间 | tid 来自 get_qzone_msg_list；操作需有该说说的访问或管理权限。 |
| [`set_group_admin`](#action-set_group_admin) | 群管理 | 需要群主权限；会授予该成员管理员身份。 |
| [`set_group_admin_permissions`](#action-set_group_admin_permissions) | 群管理 | 需要当前账号具有修改权限；不会授予管理员角色。仅修改显式字段。开启移除必须提供上限，0 表示不限；修改上限需同时传 kick_member=true。 |
| [`set_group_admin_receive_verify`](#action-set_group_admin_receive_verify) | 群管理 | user_id 为目标管理员 QQ 号；需要当前账号具有修改权限。独立于撤回和移除成员权限。 |
| [`set_group_ban`](#action-set_group_ban) | 群管理 | 替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。 duration 为秒，0 表示解除禁言。 |
| [`set_group_card`](#action-set_group_card) | 群管理 | 替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。 |
| [`set_group_kick`](#action-set_group_kick) | 群管理 | 替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。 |
| [`set_group_kick_members`](#action-set_group_kick_members) | 群管理 | 替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。 |
| [`set_group_member_invite_policy`](#action-set_group_member_invite_policy) | 群管理 | 替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。 |
| [`set_group_member_permissions`](#action-set_group_member_permissions) | 群管理 | 至少传一个权限字段；仅修改传入的权限，其余保持原样。 |
| [`set_group_name`](#action-set_group_name) | 群管理 | 替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。 |
| [`set_group_new_member_history_visibility`](#action-set_group_new_member_history_visibility) | 群管理 | 替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。 |
| [`set_group_robot_add_option`](#action-set_group_robot_add_option) | 扩展 | 替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。 |
| [`set_group_special_title`](#action-set_group_special_title) | 群管理 | 替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。 |
| [`set_group_whole_ban`](#action-set_group_whole_ban) | 群管理 | 替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。 |
| [`set_qzone_msg_right`](#action-set_qzone_msg_right) | 空间 | tid 来自 get_qzone_msg_list；操作需有该说说的访问或管理权限。 16 表示仅所选好友可见。 |
| [`trans_group_file`](#action-trans_group_file) | 扩展 | 替换群文件列表中的实际 file_id；需要对应文件操作权限。 |
| [`unlike_qzone`](#action-unlike_qzone) | 空间 | tid 来自 get_qzone_msg_list；操作需有该说说的访问或管理权限。 |

**权限强度归类**（据源码 wording 归纳）：

| 强度 | 含义 | 典型动作 |
| --- | --- | --- |
| 群主 | 仅群主可执行 | `set_group_admin`、`set_group_member_permissions` |
| 管理员 | 需管理员或群主 | `set_group_kick`、`set_group_ban`、`set_group_card`、`set_group_name`、`add_group_tag` |
| 资源级 | 取决于目标对象归属 | `delete_group_file`、`comment_qzone`、`like_qzone` |
| 账号级 | 与当前账号自身状态相关 | `set_group_member_invite_policy` |

## 7. 调用约定与响应格式

### 7.1 响应信封

成功：

```json
{ "status": "ok", "retcode": 0, "data": { } }
```

失败：

```json
{ "status": "failed", "retcode": 100, "data": null, "wording": "具体原因" }
```

`data` 在失败时**恒为 `null`**；成功时的形状由各动作的
`returnsSchema` 决定（详见各动作的 **返回** 段）。

### 7.2 ⚠️ HTTP 状态码与 `retcode` 是两套体系

**动作层面的失败仍返回 HTTP `200`**，错误信息在响应体的
`status` / `retcode` / `wording` 中。只有**传输层**问题
（方法不允许、JSON 语法错误、未授权、体过大）才用非 200 状态码。

| 场景 | HTTP | retcode |
| --- | --- | --- |
| 动作成功 | `200` | `0` |
| 参数校验失败 | **`200`** | `1400` |
| 动作执行失败 | **`200`** | `100` |
| 动作不存在 | **`200`** | `1404` |
| 内部错误（动作内抛出） | **`200`** | `1200` |
| 未授权 | `401` | `1401` |
| 路径不存在 | `404` | `1404` |
| 方法不允许 | `405` | `1400` |
| JSON 语法错误 | `400` | `1400` |
| 请求体过大 | `413` | `1413` |
| 服务关闭中 | `503` | `1200` |

> **务必按 `retcode` 判断成败，不要只看 HTTP 状态码。**
> 若只检查 `response.ok`，所有业务错误都会被误判为成功。

已实测（运行实例）：

```text
POST /nonexistent_action  -> HTTP 200  {"retcode":1404,"wording":"unknown action"}
POST /get_msg {"message_id":-99999999} -> HTTP 200  {"retcode":100,"wording":"message not found"}
POST /.send_packet {}     -> HTTP 200  {"retcode":1400,"wording":"cmd: is required"}
POST /set_group_anonymous {"group_id":...,"anonymous":true} -> HTTP 200 {"retcode":0,"data":null}
```

### 7.3 retcode 取值

| retcode | 常量 | 含义 |
| --- | --- | --- |
| `0` | — | 成功 |
| `100` | `ACTION_FAILED` | 动作执行失败（含未实现） |
| `1200` | `INTERNAL_ERROR` | 内部错误 |
| `1400` | `BAD_REQUEST` | 参数校验失败 |
| `1401` | — | 未授权（access token 不匹配） |
| `1404` | `UNKNOWN_ACTION` | 动作不存在 |
| `1405` | — | 方法不允许（SSE 端点未用 GET） |

前四个常量定义于源码 `packages/onebot/src/types.ts`；
`1401` / `1404` / `1405` 由网络层直接返回。

### 7.3 参数校验语义

所有动作进入实现前先做 schema 校验。校验失败返回 `1400`，
`wording` 指出**具体字段**与原因（如 `group_id is required`）。

关键语义（源码 `action-kit.ts` 的 `MISSING` 哨兵）：

- **只有字段缺席**才会被判为「缺失必填」。
- `0`、`''`、`false` 都是**合法且会被保留**的值。
- 未传的可选字段使用其 `default`；未定义默认值则为 `undefined`。

`groupAction` 会自动为动作预置必填 `group_id`；
`groupUserAction` 额外预置必填 `user_id`。

## 8. 逆向还原声明

| 项目 | 状态 |
| --- | --- |
| 动作清单、参数表、返回描述 | **已核实**：源码与运行实例双向一致 |
| 动作数量 222 | **已核实**：源码 grep 与 API `actions.length` 一致 |
| 未实现动作清单 | **已核实**：源码中显式 `not yet implemented` / `not supported` |
| 权限标注 | **源码文档标注**，未逐条在真机验证 QQ 服务端返回 |
| 各动作实际返回字段 | 来自 `returnsSchema`；**未对全部 222 个动作逐一实测** |
| 示例中的 `group_id: 20001` 等 | 占位符，需替换为真实值 |

> 本文档**未**对全部 222 个动作做真机调用验证。已实测的仅有：
> `get_version_info`（未授权时返回 `1401`）与 `GET /api/debug/actions`。
> 其余动作的行为描述来自源码定义。

