/**
 * settings-plugin.js — Haizakura WebUI 设置页（原子化 / 插件化 / 服务端状态驱动）
 * =============================================================================
 * 这是对编译后 146KB `settings-page-g7oqVkPg.js` 的重写：一个插件文件，
 * 内部按「分区」拆开，每个分区用共享 Resource 驱动 loading / error / ready / empty 四态。
 *
 * 复用（不重复造轮子）
 * -----------------------------------------------------------------------------
 *   ./atoms.js       el / Card / Button / Badge / Toggle / ProgressBar /
 *                    KeyValueList / EmptyState / ErrorState / Spinner / Icon /
 *                    stateView / formatBytes / formatDuration / formatTime / display
 *   ./data-layer.js  Resource（自带 loading/error/ready 快照 + subscribe）/
 *                    request / ApiError / readToken
 *   ./plugin.js      definePlugin / registerPlugin
 *
 * 设计约束
 * -----------------------------------------------------------------------------
 * 1) 原子化：所有可见控件都来自 atoms.js；本文件只做「组合 + 数据接线」。
 * 2) 插件化：导出一个 definePlugin({id,title,mount,unmount,refresh})，
 *    并用 registerSettingsPlugins() 注册（重复注册被容忍）。
 * 3) 服务端状态驱动：每个区块读 Resource 快照，四态真实反映服务端结果，
 *    **不伪造数据**：字段缺失显示「—」，不猜默认值。
 * 4) 语言挂载点：外观区块末尾固定渲染 <div data-hz-slot="language">。
 *    该节点在 mount 时创建一次，跨分区切换 / 重渲染始终复用同一个 DOM 节点
 *    （重挂载不会清空其子节点，因此外部模块注入的选择器不会被冲掉）。
 *    本文件**不实现**任何语言切换逻辑，只留位置。
 *
 * 数据源（均已在 snowluma-hz 容器上真实探针验证，字段名逐一对齐）
 * -----------------------------------------------------------------------------
 *   GET  /api/ui                     → { config: { version, appearance, layout, pages } }
 *   POST /api/ui                     → { success, config }        （按 appearance/layout/pages 区块合并）
 *   POST /api/ui/background          → { success, config }        （multipart 字段名 file，≤5MB）
 *   DEL  /api/ui/background          → { success, config }
 *   GET  /api/system/settings        → { settings:{webuiPort,webuiHost,tlsEnabled,trustProxy},
 *                                        hasCert, envOverrides[], listeningPort, restartRequiredToApply }
 *   POST /api/system/settings        → { success, settings, restartRequiredToApply }
 *   POST /api/system/tls/cert        → { success }                （{cert,key} PEM 字符串）
 *   DEL  /api/system/tls/cert        → { success }                （TLS 开启时服务端拒绝）
 *   GET  /api/system/storage         → { settings:{saved,effective,envOverrides[]},
 *                                        snapshot:{logs,temporary,accounts[],totals}, lastCleanup }
 *   POST /api/system/storage/settings→ { success, settings, status, snapshot }
 *   POST /api/system/storage/cleanup → { success, scope, cleanup, snapshot, lastCleanup }
 *                                        scope: logs | temporary | account{category,uin}
 *                                               | allAccounts{category,confirmation:'清理全部账号'}
 *   GET  /api/system/backup/export?credentials=1 → 备份包 JSON
 *   POST /api/system/backup/import   → { success, restored[], skipped[], migrated[] }
 *   GET  /api/auth/totp              → { enabled, remainingRecoveryCodes?, label? }
 *   POST /api/auth/totp/{begin,confirm,disable,recovery-codes}
 *   POST /api/auth/check-strength    → { rules:[{...}], valid }
 *   POST /api/auth/change-password   → { success, message }
 *   GET  /api/notifications/config   → { config:{version,debounceSeconds,channels[]} }
 *   POST /api/notifications/config   → { success, config }
 *   POST /api/notifications/test     → { success, status, message }   （{channelId}）
 *   GET  /api/global-config          → { config:{rkey:{fallbackServers[]},musicSignUrl,videoUploadConcurrency} }
 *   POST /api/global-config          → { success, config }
 *   GET  /api/update/check?force=1   → { current, latest, hasUpdate, htmlUrl, notes, error }
 *   GET  /api/update/status          → { current, phase, message }
 *   GET  /api/update/sources         → { config:{mode,mirror,mirrors[]} }
 *   POST /api/update/sources         → { config, saved, message }
 *   POST /api/update/sources/test    → { results[] }
 *   POST /api/update/download        → { ...status }
 *   POST /api/update/restart         → { ...status }
 *   GET  /api/system                 → 主机 / 运行时信息
 *
 * 未实现（明确保留为 TODO，不假装支持）
 * -----------------------------------------------------------------------------
 *   TODO: 界面配置导出 / 导入（仅存在于编译产物，属「高级」分区）
 *   TODO: 开发者分区（崩溃测试、首次使用引导重入）
 *   TODO: 自定义 CSS 变量逐项微调（cssVars）、布局拖拽（layout.overviewBlocks）
 *   TODO: 语言切换本身 —— 由外部模块挂到 data-hz-slot="language"
 *
 * @module settings-plugin
 */

import {
  el,
  display,
  formatBytes,
  formatDuration,
  formatTime,
  Card,
  Button,
  Badge,
  Toggle,
  Spinner,
  EmptyState,
  ErrorState,
  ProgressBar,
  KeyValueList,
  Icon,
  stateView,
  STRINGS as A,
} from './atoms.js';

import { Resource, request } from './data-layer.js';

import { definePlugin, registerPlugin } from './plugin.js';

/* ========================================================================== *
 * STRINGS — 设置页全部用户可见文案（i18n 单一替换点）
 * 文案取自编译产物 settings-page-g7oqVkPg.js 的原始中文（452 条中的设置页部分）。
 * ========================================================================== */

export const STRINGS = {
  /* ---- 插件 ---- */
  pluginTitle: '设置',
  loading: '正在读取…',
  retry: '重试',
  refresh: '刷新',
  cancel: '取消',
  close: '关闭',
  save: '保存',
  savingShort: '保存中',
  saved: '已保存',
  saveFailed: '保存失败，请检查服务器日志',
  remove: '删除',
  edit: '编辑',
  add: '新建',
  done: '完成',

  /* ---- 导航分组（编译产物 Ei 常量） ---- */
  navGroupConsole: '控制台',
  navGroupHaizakura: 'Haizakura',
  navGroupPlatform: '平台',
  navLabel: '设置导航',

  /* ---- 分区标题 ---- */
  tabAppearance: '外观',
  tabData: '数据与格式',
  tabAccount: '账号安全',
  tabGlobalConfig: '全局配置',
  tabStorage: '存储管理',
  tabNotifications: '通知',
  tabSystem: '服务',
  tabAbout: '关于',

  /* ================= 外观 ================= */
  theme: '主题',
  themeHint: '配色方案、明暗模式与深色风格。所有改动立即生效并保存到服务器，跨设备同步。',
  palette: '配色方案',
  paletteHint: '“默认”跟随下方明暗模式；Catppuccin 为整套配色，会自行决定明暗。',
  paletteLightResolved: '当前由 {label} 配色决定明暗。',
  displayMode: '显示模式',
  modeSystem: '跟随系统',
  modeLight: '浅色',
  modeDark: '深色',
  darkIntensity: '深色强度',
  darkIntensityHint: '“纯黑”将深色背景压到接近纯黑，适合 OLED 屏幕（仅深色模式下可见）。',
  darkSoft: '柔和',
  darkBlack: '纯黑 (OLED)',

  accent: '强调色',
  accentHint: '按钮、链接与高亮使用的主色调；默认配色下，界面底色也会轻微跟随。',
  accentPreset: '预设色',
  accentCustom: '自定义颜色',
  accentCustomAria: '自定义强调色',
  accentScope: '应用范围',
  accentScopeHint: '“仅侧栏”时，主区域保持默认色，仅调整侧栏的底色与高亮。',
  accentScopeGlobal: '全局',
  accentScopeSidebar: '仅侧栏',
  sidebarStyle: '侧栏样式',
  sidebarFollow: '跟随背景',
  sidebarPanel: '浅色面板',
  sidebarAccent: '强调色',

  typography: '排版与界面',
  typographyHint: '字体、圆角、缩放与密度。',
  fontAndRadius: '字体与圆角',
  fontSans: '界面字体',
  fontSansCustom: '自定义界面字体',
  fontSansPlaceholder: '例如：LXGW WenKai, PingFang SC',
  fontMono: '等宽字体',
  fontMonoHint: '用于日志与代码。',
  fontMonoCustom: '自定义等宽字体',
  fontMonoPlaceholder: '例如：Cascadia Code, Sarasa Mono SC',
  radius: '圆角',
  uiScale: '界面缩放',
  uiScaleHint: '整体放大或缩小界面，适合高分屏或视力需要。',
  density: '显示密度',
  densityCozy: '舒适',
  densityCompact: '紧凑',

  interaction: '交互与无障碍',
  interactionHint: '光标、动效、对比度与侧栏行为。',
  customContextMenu: '自定义右键菜单',
  customContextMenuHint: '默认开启；关闭后立即恢复浏览器原生右键菜单。',
  customPointer: '自定义光标',
  customPointerHint: '默认关闭；开启后使用主题化自适应光标。',
  reduceMotion: '减弱动效',
  reduceMotionHint: '弱化页面切换、弹簧等装饰性动画（保留轻微淡入），对低端设备与晕动敏感者更友好。',
  disableMotion: '关闭全部动效',
  disableMotionHint: '比“减弱动效”更彻底：移除所有界面动画，包括入场淡入与状态点闪烁。',
  highContrast: '高对比模式',
  highContrastHint: '加强边框与次要文字的对比度。',
  sidebarPinned: '钉住侧栏展开',
  sidebarPinnedHint: '侧栏常驻展开，不再收成图标轨、也不随悬停自动收起。',

  background: '背景',
  backgroundHint: '纯色、渐变或自定义壁纸，会显示在卡片之间与登录页。',
  backgroundType: '背景类型',
  bgNone: '无',
  bgSolid: '纯色',
  bgGradient: '渐变',
  bgImage: '图片',
  backgroundColor: '背景颜色',
  gradientPreset: '渐变预设',
  wallpaper: '壁纸',
  wallpaperHint: '支持 PNG / JPEG / WebP，最大 5MB。',
  wallpaperUpload: '上传壁纸',
  wallpaperRemove: '移除壁纸',
  wallpaperNone: '尚未上传壁纸。',
  wallpaperPresent: '已上传壁纸（{mime}，版本 {version}）。',
  wallpaperUploading: '正在上传壁纸…',
  wallpaperUploaded: '壁纸已更新。',
  wallpaperUploadFailed: '壁纸上传失败',
  wallpaperTooLarge: '图片过大（上限 5MB）',
  wallpaperRemoved: '壁纸已移除。',
  wallpaperRemoveFailed: '移除壁纸失败',
  imageOpacity: '遮罩强度',
  imageOpacityHint: '越高越能盖住壁纸、提升前景可读性。',
  imageBlur: '背景模糊',
  imageBlurUnit: '{n} 像素',

  /* ---- 语言挂载点 ---- */
  languageSlotLabel: '语言 / Language',
  languageSlotHint: '语言选择器由独立模块挂载到此容器。',

  /* ================= 数据与格式 ================= */
  dataRefresh: '数据刷新',
  dataRefreshHint: '总览页轮询刷新 QQ 列表、进程列表与系统状态的间隔。',
  pollInterval: '轮询间隔',
  pollPaused: '已暂停轮询',
  pollCurrent: '当前 {ms} 毫秒',
  landingPage: '登录后落地页',
  landingPageHint: '登录后默认打开的页面。',
  defaultPage: '默认页面',
  timeFormat: '时制',
  timeFormatHint: '日志与告警等时间戳的显示方式。',
  time24: '24 小时制',
  time12: '12 小时制',
  customCss: '自定义 CSS',
  customCssHint: '高级用户可注入自定义样式，登录后全局生效（登录页不受影响）。',
  customCssPlaceholder: '/* 例如：放大侧栏字号 */\n.text-sidebar-foreground { font-size: 1.05em; }',

  /* ================= 账号安全 ================= */
  accountTitle: '账号安全',
  accountHint: 'WebUI 仅有 admin 一个账号，密码以 scrypt 哈希持久化到 config/webui.json。',
  accessPassword: '访问密码',
  accessPasswordHint: '修改后其他设备的会话将立即失效。',
  changePassword: '修改密码',
  changePasswordTitle: '修改访问密码',
  changePasswordHint: '设置一个全新的强密码后，其它会话将被立即下线，需要重新登录。',
  oldPassword: '当前访问密码',
  newPassword: '新密码',
  confirmPassword: '确认新密码',
  passwordMismatch: '两次输入的新密码不一致',
  passwordEmpty: '请填写当前密码与新密码',
  passwordStrengthOk: '密码强度符合要求。',
  passwordStrengthBad: '尚未满足：{list}',
  passwordChanged: '访问密码已更新。',
  passwordChangeFailed: '修改密码失败',
  totpTitle: '双重验证',
  totpHint: '登录时在访问密码之外再验证 Authenticator 一次性密码。默认关闭。',
  totpStatus: '状态',
  totpEnabledDetail: '已绑定 {label} · 剩余 {n} 个恢复码',
  totpDisabled: '未启用',
  totpEnable: '开启 2FA',
  totpDisable: '关闭 2FA',
  totpEnableTitle: '开启双重验证',
  totpEnableHint: '用 Authenticator 扫描二维码，或手动输入密钥，然后输入当前访问密码和 6 位验证码。',
  totpDisableTitle: '关闭双重验证',
  totpDisableHint: '关闭后，只需访问密码即可登录。其他已登录会话会立即失效。',
  totpSecret: '密钥',
  totpOtpauth: 'otpauth 链接',
  totpCode: '6 位验证码',
  totpCodeOrRecovery: '6 位验证码或恢复码',
  totpConfirm: '确认开启',
  totpEnableFailed: '2FA 绑定失败',
  totpBeginFailed: '无法开始 2FA 绑定',
  totpDisableFailed: '关闭 2FA 失败',
  recoveryCodes: '恢复码',
  recoveryCodesHint: '这些恢复码只显示一次。丢失 Authenticator 时用它们登录。',
  recoveryCodesWarning: '每个恢复码只能用一次。请立刻抄写或保存到离线位置，关闭后将无法再查看。',
  recoveryCodesAck: '我已把恢复码保存到安全的地方',
  recoveryCodesCopyAll: '复制全部',
  copied: '已复制',
  copyFailed: '复制失败，请手动选择并拷贝。',
  totpStatusFailed: '无法读取 2FA 状态',

  /* ================= 全局配置 ================= */
  globalConfigTitle: '全局配置',
  globalConfigHint: '跨账号生效的 OneBot 全局设置。分区保存，只提交改动过的区块。',
  rkeyFallback: 'rkey 回退服务器',
  rkeyFallbackHint: '内核无法获取 rkey 时，依次请求下列服务器。留空关闭，建议使用自建服务。每行一个 HTTP(S) 地址。',
  rkeyAdd: '新增服务器',
  musicSignUrl: '音乐签名端点',
  musicSignUrlHint: '端点需返回有效的签名结果，仅支持 HTTP(S)。',
  videoUploadConcurrency: '视频上传连接数',
  globalInvalidUrl: '存在无效的 HTTP(S) 地址，已保留原值。',

  /* ================= 存储 ================= */
  storageOverview: '存储概览',
  storageHint: '只统计 Haizakura 管理的日志、账号数据库和文件传输临时数据。',
  storageLoadFailed: '加载存储信息失败',
  managedTotal: '受管数据总量',
  logsLabel: '日志',
  accountDbLabel: '账号数据库',
  tempLabel: '传输临时数据',
  logCapacity: '日志容量',
  logCapacityUsage: '日志容量使用率',
  fileCountUnit: '{n} 个文件',
  activeFileCountUnit: '{n} 个活动文件',
  droppedLinesUnit: '丢弃 {n} 行磁盘日志',
  stateHealthy: '正常',
  stateNearLimit: '接近上限',
  stateWarning: '清理异常',
  stateDegraded: '磁盘写入已暂停',
  stateDisabled: '文件日志已关闭',
  logPolicy: '日志策略',
  logPolicyHint: '总量上限始终生效；保留天数设为 0 时仅按总量淘汰。保存后立即应用。',
  logMaxTotalMb: '日志总量上限（MB）',
  logRetainDays: '保留天数',
  logPerUin: '按账号拆分日志',
  saveAndApply: '保存并应用',
  logMaxInvalid: '日志总量上限必须是大于 0 的整数',
  logRetainInvalid: '保留天数必须是大于或等于 0 的整数',
  logPolicyUpdated: '日志策略已更新并立即生效。',
  logPolicyFailed: '日志策略更新失败',
  envLocked: '由环境变量锁定：{fields}',
  globalCleanup: '全局数据清理',
  cleanupHint: '日志清理会轮转活动文件；临时数据清理会自动跳过正在进行的上传和下载。',
  cleanupLogs: '清理全部日志',
  cleanupTemp: '清理传输临时数据',
  cleanupLogsTitle: '清理全部日志？',
  cleanupLogsBody: 'Haizakura 会先轮转活动日志，再删除旧日志，只保留新建的空文件。',
  cleanupTempTitle: '清理传输临时数据？',
  cleanupTempBody: '将删除非活动的传输临时文件；正在进行的上传与下载会被跳过。',
  cleanup: '清理',
  cleanupAccountData: '账号数据',
  cleanupAccountHint: '仅清理选中的数据库分类。账号必须离线，配置、凭据和聊天内容导出不在此页面提供。',
  cleanupNoAccounts: '尚未发现账号数据库。',
  cleanupCategoryMessages: '消息历史',
  cleanupCategoryMessagesHint: 'OneBot 消息与回复索引',
  cleanupCategoryMedia: '媒体索引',
  cleanupCategoryMediaHint: '图片、语音与视频的元数据',
  cleanupCategoryReactions: '表情回应',
  cleanupCategoryReactionsHint: '群消息表情回应记录',
  cleanupAccountTitle: '清理账号 {uin} 的{category}？',
  cleanupAccountBody: '将删除账号 {uin} 的{category}数据库及其边车文件，其他分类和配置不受影响。',
  cleanupAllAccountsTitle: '清理全部账号的{category}？',
  cleanupAllAccountsBody: '该操作会删除所有离线账号的对应数据库及边车文件，无法撤销。请输入 {phrase} 继续。',
  cleanupAllAccounts: '清理全部',
  cleanupAllAccountsPhrase: '清理全部账号',
  cleanupConfirmPhrase: '确认短语',
  cleanupOnlineBlocked: '{n} 个账号仍在线，全部账号清理暂不可用。',
  cleanupAccountOnline: '账号在线，必须先下线后才能清理数据库。',
  cleanupScopeRequired: '选择一个分类，并在弹窗中输入确认短语。',
  cleanupDone: '存储数据清理完成：删除 {files} 个文件，释放 {bytes}。',
  cleanupSkippedActive: '跳过 {n} 个活动传输',
  cleanupFailureCount: '{n} 项失败',
  cleanupFailed: '存储数据清理失败',
  cleanupLastAt: '最近清理：{time}，删除 {files} 个文件，释放 {bytes}',
  online: '在线',
  offline: '离线',
  accountDataScope: '数据',

  /* ================= 通知 ================= */
  notificationsTitle: '通知',
  notificationsHint: '在此管理通知渠道，再到账号「配置」页选择启用。',
  notificationsLoadFailed: '加载通知配置失败',
  channels: '通知渠道',
  channelAdd: '新增渠道',
  channelEdit: '编辑通知渠道',
  channelCreate: '新增通知渠道',
  channelId: '渠道 ID',
  channelName: '名称',
  channelType: '类型',
  channelTypeWebhook: 'Webhook',
  channelTypeEmail: '邮件',
  channelEnabled: '启用',
  channelUrl: 'Webhook URL',
  channelBody: '请求体模板',
  channelHeaders: '请求头',
  channelHeaderName: '名称',
  channelHeaderValue: '值',
  channelHeaderAdd: '新增请求头',
  channelSmtpHost: 'SMTP 主机',
  channelSmtpPort: 'SMTP 端口',
  channelSmtpSecure: '隐式 TLS',
  channelSmtpUser: 'SMTP 用户名',
  channelSmtpPass: 'SMTP 密码',
  channelFrom: '发件人',
  channelTo: '收件人',
  channelSubject: '主题模板',
  channelTest: '测试',
  channelTesting: '正在测试通知渠道',
  channelTestOk: '测试发送成功',
  channelTestFail: '测试发送失败',
  channelDelete: '删除',
  channelEmpty: '尚未配置通知渠道。',
  channelIdInvalid: '只能用字母 / 数字 / . _ - ，≤64 字符',
  channelIdDuplicate: 'ID 与其它渠道重复',
  channelUrlRequired: '请填写 Webhook URL',
  channelUrlInvalid: '必须是 http(s) 地址',
  channelSmtpRequired: '请填写 SMTP 主机、发件人与收件人',
  channelToInvalid: '收件人地址无效',
  debounce: '去抖窗口（秒）',
  debounceHint: '下线持续超过此时长才通知，恢复时再通知。0 表示立即通知。',
  debounceInvalid: '去抖窗口必须是 0–3600 的整数',
  notificationsSaved: '通知配置已更新。',
  notificationsSaveFailed: '通知配置更新失败',
  templateVars: '可用变量：{event} {nickname} {uin} {status} {time}',

  /* ================= 服务（系统设置 + TLS + 备份） ================= */
  systemTitle: '服务监听',
  systemHint: 'WebUI 当前监听端口：{port}',
  webuiPort: '端口',
  webuiPortInvalid: '端口必须是 1–65535 的整数',
  webuiHost: '绑定地址',
  webuiHostHint: '默认仅本机访问；也可填写其他明确的绑定地址。',
  hostLoopback: '仅本机',
  hostAll: '所有网卡',
  hostAllWarn: '所有网卡会允许局域网访问；建议同时启用 HTTPS，并设置强访问凭据。',
  trustProxy: '信任代理 (trust-proxy)',
  trustProxyHint: '仅在 WebUI 位于受信任反向代理之后时才设为 1 / loopback / IP 列表。留空=只信任 socket 对端；1=信任反代头。',
  tlsEnable: '启用 HTTPS',
  tlsCertInstalled: '已安装证书。',
  tlsCertMissing: '尚未安装证书。',
  tlsPairHint: '启用 TLS 需先安装有效的证书与私钥（PEM）。',
  tlsCertLabel: '证书 (PEM)',
  tlsKeyLabel: '私钥 (PEM)',
  tlsUpload: '上传证书',
  tlsDelete: '删除证书',
  tlsBothRequired: '请同时填入证书与私钥',
  tlsUpdating: '正在更新 TLS 证书',
  tlsUpdated: 'TLS 证书已更新。',
  tlsUpdateFailed: 'TLS 证书更新失败',
  tlsDeleted: '证书已删除。',
  tlsDeleteFailed: '删除证书失败',
  serviceSaved: '服务设置已更新。',
  serviceRestart: '重启 Haizakura 后生效。',
  serviceSaveFailed: '服务设置更新失败',
  serviceLoadFailed: '加载系统设置失败',

  backupTitle: '配置备份 / 恢复',
  backupHint: '备份外观、系统设置和证书等配置；通知渠道与 OneBot 配置仅在包含敏感配置时导出。不含消息数据库。',
  backupIncludeCreds: '导出时包含敏感配置',
  backupIncludeCredsWarn: '⚠ 将额外包含 WebUI 登录状态、TLS 私钥、通知渠道地址与 OneBot 访问令牌，请妥善保管。',
  backupExport: '导出备份',
  backupExporting: '正在导出配置备份',
  backupExported: '已导出备份。',
  backupExportFailed: '导出失败',
  backupRestoreCreds: '恢复时一并恢复敏感配置',
  backupRestoreCredsWarn: '⚠ 将覆盖当前 WebUI 登录状态、TLS 私钥、通知渠道地址与 OneBot 访问令牌；若备份口令未知可能登不进。',
  backupImport: '恢复配置备份',
  backupImportHint: '将从所选文件覆盖当前系统配置，成功后需要重启 Haizakura。',
  backupConfirmTitle: '恢复配置备份？',
  backupInvalidJson: '文件不是有效的 JSON',
  backupImporting: '正在恢复配置备份',
  backupRestoredCount: '已恢复 {n} 项',
  backupNothing: '没有可恢复的配置',
  backupSkippedCount: '跳过 {n} 项（敏感配置，含 OneBot 配置）',
  backupMigratedCount: '兼容转换 {n} 项',
  backupImported: '配置备份已恢复',
  backupImportFailed: '配置备份恢复失败',
  backupFileName: 'snowluma-backup-{ts}.json',

  /* ================= 关于（更新 + 运行时） ================= */
  updateTitle: '更新状态',
  updateOriginHint: '检测从 Haizakura 所在服务器发起，非浏览器。',
  updateChecking: '正在检查更新',
  updateCheckDone: '更新检查完成',
  updateCurrent: '当前版本 v{version}',
  updateAvailable: '发现新版本 v{version}',
  updateUpToDate: '当前已是最新版本',
  updateFailed: '更新检查失败',
  updateDisabled: '更新检查已关闭',
  updateNoResult: '更新检查未返回结果',
  updateNotes: '发布说明',
  updateDownload: '下载更新',
  updateDownloading: '正在下载更新',
  updateDownloadFailed: '下载失败',
  updateReady: '更新已就绪，重启后生效。',
  updateRestart: '重启更新',
  updateRestarting: '正在重启',
  updateRestartRequested: '已请求重启',
  updateRestartHint: '稍后刷新页面',
  updateRestartFailed: '重启失败',
  updateCheck: '重新检查',
  updateSources: '更新来源',
  updateSourcesHint: '检测从 Haizakura 所在服务器发起；下次检查和下载时生效。',
  updateSourceMode: '下载来源模式',
  sourceAuto: '自动切换',
  sourceGithub: 'GitHub 直连',
  sourceMirror: '指定镜像',
  sourceMirrorUrl: '指定镜像地址',
  sourceMirrors: '候选镜像地址',
  sourceMirrorsHint: '每行一个地址；地址后会追加完整 GitHub 链接，支持带路径的代理前缀。',
  sourceTest: '检测可用性',
  sourceSave: '保存来源',
  sourceTesting: '正在检测更新来源',
  sourceTestDone: '来源检测完成（检测结果不代表下载速度）',
  sourceSaved: '更新来源已保存。',
  sourceSaveFailed: '更新来源保存失败',
  sourceTestFailed: '来源检测失败',
  sourceInvalid: '镜像地址必须是 HTTP(S) URL，且不能含账号、密码、查询参数或片段。',
  sourceAvailable: '可用 · {ms} ms',
  sourceUnavailable: '不可用',
  runtimeTitle: '运行时信息',
  runtimeHostname: '主机名',
  runtimePlatform: '平台',
  runtimeNode: 'Node.js',
  runtimeUptime: '系统运行时长',
  runtimeProcessUptime: '进程运行时长',
  runtimeCpu: 'CPU',
  runtimeCores: '核心数',
  runtimeMemory: '内存占用',
  runtimeLoad: '平均负载',
  runtimeFailed: '无法获取系统信息',
  version: '版本',

  /* ---- 备份恢复的按钮文案（复用） ---- */
  confirmRestore: '恢复',
};

/* ========================================================================== *
 * 常量 — 外观可选项（全部取自 LayoutContext-D4-NFqCh.js / settings-page 的真实定义）
 * ========================================================================== */

/** 显示模式（Ni）。 */
export const MODE_OPTIONS = [
  { value: 'system', label: STRINGS.modeSystem },
  { value: 'light', label: STRINGS.modeLight },
  { value: 'dark', label: STRINGS.modeDark },
];

/** 深色强度（Pi）。 */
export const DARK_INTENSITY_OPTIONS = [
  { value: 'soft', label: STRINGS.darkSoft },
  { value: 'black', label: STRINGS.darkBlack },
];

/** 强调色应用范围（Fi）。 */
export const ACCENT_SCOPE_OPTIONS = [
  { value: 'global', label: STRINGS.accentScopeGlobal },
  { value: 'sidebar', label: STRINGS.accentScopeSidebar },
];

/** 侧栏样式（Ii）。 */
export const SIDEBAR_STYLE_OPTIONS = [
  { value: 'follow', label: STRINGS.sidebarFollow },
  { value: 'panel', label: STRINGS.sidebarPanel },
  { value: 'accent', label: STRINGS.sidebarAccent },
];

/** 显示密度（Ri）。 */
export const DENSITY_OPTIONS = [
  { value: 'cozy', label: STRINGS.densityCozy },
  { value: 'compact', label: STRINGS.densityCompact },
];

/** 背景类型（Li）。 */
export const BACKGROUND_TYPE_OPTIONS = [
  { value: 'none', label: STRINGS.bgNone },
  { value: 'solid', label: STRINGS.bgSolid },
  { value: 'gradient', label: STRINGS.bgGradient },
  { value: 'image', label: STRINGS.bgImage },
];

/** 圆角（LayoutContext ie）。 */
export const RADIUS_OPTIONS = [
  { value: 0.375, label: '紧凑' },
  { value: 0.5, label: '默认' },
  { value: 0.75, label: '舒适' },
  { value: 1, label: '圆润' },
];

/** 轮询间隔（LayoutContext ae）。 */
export const POLL_INTERVAL_OPTIONS = [
  { value: 1000, label: '1 秒（实时）' },
  { value: 3000, label: '3 秒（默认）' },
  { value: 5000, label: '5 秒（节能）' },
  { value: 10000, label: '10 秒（省电）' },
  { value: 0, label: '已暂停' },
];

/** 界面字体（LayoutContext oe）。 */
export const FONT_SANS_OPTIONS = [
  { value: 'default', label: '默认（本地系统）' },
  { value: 'system', label: '平台原生' },
  { value: 'rounded', label: '圆润（平台字体）' },
  { value: 'serif', label: '衬线（本地字体）' },
];

/** 等宽字体（LayoutContext P）。 */
export const FONT_MONO_OPTIONS = [
  { value: 'default', label: '默认（系统等宽）' },
  { value: 'system', label: '平台等宽' },
];

/** 渐变预设（LayoutContext F）。 */
export const GRADIENT_PRESETS = [
  { id: 'none', label: '无', css: '' },
  { id: 'aurora', label: '极光', css: 'linear-gradient(135deg, #1e3a8a 0%, #0ea5e9 50%, #22d3ee 100%)' },
  { id: 'sunset', label: '日落', css: 'linear-gradient(135deg, #f97316 0%, #db2777 50%, #7c3aed 100%)' },
  { id: 'forest', label: '森野', css: 'linear-gradient(135deg, #064e3b 0%, #10b981 55%, #84cc16 100%)' },
  { id: 'dusk', label: '暮色', css: 'linear-gradient(160deg, #0f172a 0%, #334155 55%, #64748b 100%)' },
  { id: 'rose', label: '霞光', css: 'linear-gradient(135deg, #9f1239 0%, #fb7185 55%, #fda4af 100%)' },
];

/** 强调色预设（LayoutContext N，8 项，与服务端 accentPreset 白名单一致）。 */
export const ACCENT_PRESETS = [
  { id: 'lavender', label: '薰衣草', swatch: '#8561bd' },
  { id: 'sky', label: '天蓝', swatch: '#38bdf8' },
  { id: 'blue', label: '靛蓝', swatch: '#3b82f6' },
  { id: 'violet', label: '紫罗兰', swatch: '#8b5cf6' },
  { id: 'rose', label: '玫瑰', swatch: '#f43f5e' },
  { id: 'emerald', label: '翡翠', swatch: '#10b981' },
  { id: 'amber', label: '琥珀', swatch: '#f59e0b' },
  { id: 'orange', label: '夕橙', swatch: '#f97316' },
];

/** 配色方案预览（LayoutContext ve，11 项，与服务端 palette 白名单一致）。 */
export const PALETTE_PRESETS = [
  { id: 'default', label: '默认', preview: { bg: '#f1f5f9', surface: '#ffffff', dots: ['#8561bd', '#10b981', '#f43f5e'] } },
  { id: 'catppuccin-latte', label: 'Latte', preview: { bg: '#eff1f5', surface: '#ffffff', dots: ['#8839ef', '#40a02b', '#d20f39'] } },
  { id: 'catppuccin-frappe', label: 'Frappé', preview: { bg: '#303446', surface: '#414559', dots: ['#ca9ee6', '#a6d189', '#e78284'] } },
  { id: 'catppuccin-macchiato', label: 'Macchiato', preview: { bg: '#24273a', surface: '#363a4f', dots: ['#c6a0f6', '#a6da95', '#ed8796'] } },
  { id: 'catppuccin-mocha', label: 'Mocha', preview: { bg: '#1e1e2e', surface: '#313244', dots: ['#cba6f7', '#a6e3a1', '#f38ba8'] } },
  { id: 'rose-pine', label: 'Rosé Pine', preview: { bg: '#191724', surface: '#1f1d2e', dots: ['#c4a7e7', '#9ccfd8', '#eb6f92'] } },
  { id: 'rose-pine-moon', label: 'Rosé Pine Moon', preview: { bg: '#232136', surface: '#2a273f', dots: ['#c4a7e7', '#9ccfd8', '#eb6f92'] } },
  { id: 'rose-pine-dawn', label: 'Rosé Pine Dawn', preview: { bg: '#faf4ed', surface: '#fffaf3', dots: ['#907aa9', '#286983', '#b4637a'] } },
  { id: 'nord', label: 'Nord', preview: { bg: '#2e3440', surface: '#3b4252', dots: ['#81a1c1', '#a3be8c', '#bf616a'] } },
  { id: 'everforest-dark', label: 'Everforest 暗', preview: { bg: '#2d353b', surface: '#343f44', dots: ['#a7c080', '#7fbbb3', '#e67e80'] } },
  { id: 'everforest-light', label: 'Everforest 亮', preview: { bg: '#efebd4', surface: '#fdf6e3', dots: ['#8da101', '#3a94c5', '#f85552'] } },
];

/** 自带亮色主题的配色（LayoutContext he）。 */
export const LIGHT_PALETTES = ['catppuccin-latte', 'rose-pine-dawn', 'everforest-light'];

/** 服务端 DEFAULT_APPEARANCE（字段名/默认值与 index.mjs 的 DEFAULT_APPEARANCE 一致）。 */
export const DEFAULT_APPEARANCE = {
  mode: 'system',
  accentMode: 'preset',
  accentPreset: 'lavender',
  accentCustom: '#8561bd',
  accentScope: 'global',
  darkIntensity: 'soft',
  palette: 'default',
  sidebarStyle: 'follow',
  background: {
    type: 'none', color: '#b99ae6', gradient: 'none', imageOpacity: 0.15,
    imageBlur: 0, hasImage: false, imageMime: '', imageVersion: 0,
  },
  fontSans: 'default', fontSansCustom: '',
  fontMono: 'default', fontMonoCustom: '',
  uiScale: 1, radius: 0.75, density: 'cozy',
  reduceMotion: false, disableMotion: false,
  customPointerSystem: false, customContextMenu: true,
  highContrast: false, sidebarPinned: false,
  timeFormat: '24h', pollInterval: 3000,
  customCss: '', cssVars: {},
};

/** 存储清理分类（服务端 parseCategory 白名单 + 快照字节字段）。 */
export const STORAGE_CATEGORIES = [
  { key: 'messages', label: STRINGS.cleanupCategoryMessages, hint: STRINGS.cleanupCategoryMessagesHint, bytesField: 'messagesBytes' },
  { key: 'media', label: STRINGS.cleanupCategoryMedia, hint: STRINGS.cleanupCategoryMediaHint, bytesField: 'mediaBytes' },
  { key: 'reactions', label: STRINGS.cleanupCategoryReactions, hint: STRINGS.cleanupCategoryReactionsHint, bytesField: 'reactionsBytes' },
];

/** 设置导航（编译产物 Ei 常量，本实现覆盖其中 8 个分区）。 */
export const SETTINGS_NAV = [
  { title: STRINGS.navGroupConsole, tabs: [
    { key: 'appearance', label: STRINGS.tabAppearance, icon: 'sliders' },
    { key: 'data', label: STRINGS.tabData, icon: 'refresh' },
    { key: 'account', label: STRINGS.tabAccount, icon: 'shield' },
  ] },
  { title: STRINGS.navGroupHaizakura, tabs: [
    { key: 'globalConfig', label: STRINGS.tabGlobalConfig, icon: 'plug' },
    { key: 'storage', label: STRINGS.tabStorage, icon: 'memory' },
    { key: 'notifications', label: STRINGS.tabNotifications, icon: 'bell' },
  ] },
  { title: STRINGS.navGroupPlatform, tabs: [
    { key: 'system', label: STRINGS.tabSystem, icon: 'server' },
    { key: 'about', label: STRINGS.tabAbout, icon: 'info' },
  ] },
];

/** 语言挂载点的 data 属性名（外部模块据此查询/插入）。 */
export const LANGUAGE_SLOT_ATTR = 'data-hz-slot';
export const LANGUAGE_SLOT_VALUE = 'language';

/* ========================================================================== *
 * 局部工具
 * ========================================================================== */

/** {name} 插值。atoms 的 STRINGS 是函数式，本文件保持同样风格。 */
export function fmt(template, vars) {
  if (typeof template !== 'string') return '';
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : m);
}

/** 空值兜底显示（不伪造数据）。 */
function dash(value) {
  if (value === undefined || value === null || value === '') return A.empty;
  return value;
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value).trim());
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.host.length > 0;
  } catch {
    return false;
  }
}

/** 归一化 appearance：服务端未返回的字段回落到服务端默认值。 */
export function normalizeAppearance(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const merged = { ...DEFAULT_APPEARANCE, ...source };
  merged.background = { ...DEFAULT_APPEARANCE.background, ...(source.background || {}) };
  return merged;
}

/**
 * 一行设置（label + hint + 控件）。atoms.js 没有 Row 原子，这里按它的
 * el() 约定组合，保持同样的 class 命名体系。
 */
export function fieldRow(label, control, hint, layout) {
  const text = el('div', { class: 'hz-row__text' }, [
    label ? el('span', { class: 'hz-row__label', text: label }) : null,
    hint ? el('p', { class: 'hz-row__hint', text: hint }) : null,
  ]);
  const controlBox = el('div', { class: 'hz-row__control' }, control);
  return el('div', { class: `hz-row hz-row--${layout || 'inline'}` }, [text, controlBox]);
}

/** 分段控件（单选按钮组）。atoms.js 有 ButtonGroup 但无 radiogroup 语义，故在此组合。 */
export function segmented(value, options, onChange, ariaLabel) {
  const group = el('div', { class: 'hz-segmented', role: 'radiogroup', 'aria-label': ariaLabel || null });
  for (const option of options) {
    const active = option.value === value;
    group.appendChild(el('button', {
      type: 'button',
      role: 'radio',
      'aria-checked': active ? 'true' : 'false',
      'aria-label': option.label,
      class: `hz-segmented__item${active ? ' is-active' : ''}`,
      title: option.label,
      onClick: () => onChange(option.value),
    }, [el('span', { text: option.label })]));
  }
  return group;
}

/** 原生 select（atoms.js 未提供 select 原子）。 */
export function selectControl(value, options, onChange, ariaLabel) {
  const node = el('select', { class: 'hz-select', 'aria-label': ariaLabel || null });
  for (const option of options) {
    const opt = el('option', { value: String(option.value), text: option.label });
    if (String(option.value) === String(value)) opt.selected = true;
    node.appendChild(opt);
  }
  node.addEventListener('change', () => onChange(node.value));
  return node;
}

/** 文本输入。 */
export function textInput(value, { placeholder, type, onInput, onEnter } = {}) {
  const node = el('input', {
    type: type || 'text',
    class: 'hz-input',
    placeholder: placeholder || null,
    autocomplete: 'off',
    spellcheck: 'false',
  });
  node.value = value === undefined || value === null ? '' : String(value);
  node.addEventListener('input', () => onInput && onInput(node.value));
  if (onEnter) node.addEventListener('keydown', (event) => { if (event.key === 'Enter') onEnter(node.value); });
  return node;
}

/** 数字输入。 */
export function numberInput(value, { min, max, step, onInput, placeholder } = {}) {
  const node = el('input', {
    type: 'number',
    class: 'hz-input hz-input--number',
    min: min === undefined ? null : String(min),
    max: max === undefined ? null : String(max),
    step: step === undefined ? null : String(step),
    placeholder: placeholder || null,
  });
  node.value = value === undefined || value === null ? '' : String(value);
  node.addEventListener('input', () => onInput && onInput(node.value));
  return node;
}

/** 多行文本。 */
export function textArea(value, { rows, placeholder, onInput } = {}) {
  const node = el('textarea', {
    class: 'hz-textarea',
    rows: String(rows || 4),
    placeholder: placeholder || null,
    spellcheck: 'false',
  });
  node.value = value === undefined || value === null ? '' : String(value);
  node.addEventListener('input', () => onInput && onInput(node.value));
  return node;
}

/** 带标签的表单字段（用于对话框）。 */
export function formField(label, control, hint) {
  return el('label', { class: 'hz-field' }, [
    el('span', { class: 'hz-field__label', text: label }),
    control,
    hint ? el('span', { class: 'hz-field__hint', text: hint }) : null,
  ]);
}

/** 提示条。 */
export function notice(tone, message, extra) {
  return el('div', { class: `hz-notice hz-notice--${tone || 'info'}`, role: tone === 'error' ? 'alert' : 'status' },
    [el('p', { class: 'hz-notice__text', text: message })].concat(extra || []));
}

/* --- 本插件专属布局样式（仅补 atoms.js 未覆盖的类名，幂等注入） --- */
const STYLE_ID = 'hz-settings-plugin-styles';

export function ensureSettingsStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.hz-settings{display:flex;flex-direction:column;gap:20px}
.hz-settings__layout{display:flex;flex-direction:column;gap:20px}
@media (min-width:1024px){.hz-settings__layout{flex-direction:row;align-items:flex-start;gap:24px}}
.hz-settings__nav{display:flex;flex-wrap:wrap;gap:4px;border:1px solid var(--border);border-radius:12px;background:var(--card);padding:6px}
@media (min-width:1024px){.hz-settings__nav{flex-direction:column;flex-wrap:nowrap;width:208px;flex-shrink:0;position:sticky;top:16px;max-height:calc(100dvh - 6rem);overflow-y:auto}}
.hz-settings__nav-group{display:contents}
@media (min-width:1024px){.hz-settings__nav-group{display:flex;flex-direction:column;gap:4px}}
.hz-settings__nav-title{margin:0;padding:2px 12px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted-foreground);opacity:.7}
.hz-settings__nav-item{display:flex;align-items:center;gap:8px;border:0;background:transparent;border-radius:8px;padding:7px 11px;font-size:13px;text-align:left;color:var(--muted-foreground);cursor:pointer;min-height:36px}
.hz-settings__nav-item:hover{background:var(--accent);color:var(--foreground)}
.hz-settings__nav-item.is-active{background:color-mix(in oklab, var(--primary) 14%, transparent);color:var(--primary)}
.hz-settings__body{display:flex;flex-direction:column;gap:16px;min-width:0;flex:1}
.hz-settings__heading{margin:0;font-size:16px;font-weight:600;letter-spacing:-.01em}
.hz-settings__panel{display:flex;flex-direction:column;gap:16px}
.hz-section{display:flex;flex-direction:column;gap:16px}
.hz-section__status{display:flex;justify-content:flex-end;min-height:0}
.hz-card__body{display:flex;flex-direction:column}
.hz-row{display:flex;gap:12px;padding:14px 20px;border-bottom:1px solid color-mix(in oklab, var(--border) 60%, transparent)}
.hz-row:last-child{border-bottom:0}
.hz-row--inline{flex-direction:column}
.hz-row--stack{flex-direction:column}
@media (min-width:640px){.hz-row--inline{flex-direction:row;align-items:center;justify-content:space-between;gap:24px}}
.hz-row__text{display:flex;flex-direction:column;gap:3px;min-width:0}
.hz-row__label{font-size:13px;font-weight:500}
.hz-row__hint{margin:0;font-size:12px;line-height:1.5;color:var(--muted-foreground)}
.hz-row__control{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
@media (min-width:640px){.hz-row--inline .hz-row__control{flex-shrink:0}}
.hz-segmented{display:inline-flex;gap:4px;border:1px solid var(--border);border-radius:10px;padding:2px;background:var(--background)}
.hz-segmented__item{border:0;background:transparent;color:var(--muted-foreground);border-radius:7px;padding:5px 10px;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:5px}
.hz-segmented__item.is-active{background:color-mix(in oklab, var(--primary) 16%, transparent);color:var(--primary)}
.hz-input,.hz-select,.hz-textarea{border:1px solid var(--border);border-radius:8px;background:var(--background);color:var(--foreground);padding:7px 9px;font-size:13px;width:100%;max-width:22rem}
.hz-textarea{max-width:100%;min-height:5rem;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;line-height:1.5}
.hz-input--number{max-width:9rem}
.hz-field{display:flex;flex-direction:column;gap:6px;padding:14px 20px;border-bottom:1px solid color-mix(in oklab, var(--border) 60%, transparent)}
.hz-field:last-child{border-bottom:0}
.hz-field__label{font-size:12px;font-weight:500}
.hz-field__hint{font-size:11px;color:var(--muted-foreground);line-height:1.5}
.hz-notice{margin:14px 20px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:12px;line-height:1.55}
.hz-notice--error{border-color:var(--destructive);color:var(--destructive)}
.hz-notice--warning{border-color:var(--warning,#d97706);color:var(--warning,#d97706)}
.hz-notice--success{border-color:var(--success,#16a34a);color:var(--success,#16a34a)}
.hz-notice__text{margin:0}
.hz-palette-grid{display:flex;flex-wrap:wrap;gap:10px}
.hz-palette{display:flex;flex-direction:column;align-items:center;gap:6px;border:1px solid var(--border);border-radius:12px;padding:6px;width:88px;cursor:pointer;background:transparent;color:var(--foreground)}
.hz-palette.is-active{border-color:var(--primary);box-shadow:0 0 0 2px color-mix(in oklab, var(--primary) 30%, transparent)}
.hz-palette__preview{display:flex;align-items:center;justify-content:center;height:44px;width:100%;border-radius:8px}
.hz-palette__surface{display:flex;gap:4px;border-radius:6px;padding:4px 6px;box-shadow:0 1px 2px rgb(0 0 0 / .1)}
.hz-palette__dot{width:6px;height:6px;border-radius:999px}
.hz-palette__label{font-size:12px;font-weight:500}
.hz-swatches{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.hz-swatch{position:relative;width:36px;height:36px;border-radius:999px;border:1px solid var(--border);cursor:pointer;padding:0;overflow:hidden;display:inline-flex;align-items:center;justify-content:center}
.hz-swatch.is-active{border-color:var(--foreground);box-shadow:0 0 0 2px var(--primary)}
.hz-swatch__check{color:#fff;font-size:14px;line-height:1;text-shadow:0 1px 2px rgb(0 0 0 / .35)}
.hz-swatch input[type=color]{position:absolute;inset:0;opacity:0;cursor:pointer;border:0;padding:0}
.hz-slot{display:flex;flex-direction:column;gap:4px}
.hz-slot__label{font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--muted-foreground);opacity:.75}
.hz-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.6;word-break:break-all;white-space:pre-wrap}
.hz-channel-list{display:flex;flex-direction:column}
.hz-sources-result{display:flex;flex-direction:column;gap:4px;margin:0;padding:0;list-style:none}
.hz-dialog-overlay{position:fixed;inset:0;z-index:80;display:none;align-items:center;justify-content:center;background:rgb(0 0 0 / .45);padding:16px}
.hz-dialog-overlay.is-open{display:flex}
.hz-dialog{width:min(34rem,100%);max-height:85vh;overflow:auto;border:1px solid var(--border);border-radius:12px;background:var(--card);padding:16px;display:flex;flex-direction:column;gap:10px}
.hz-dialog__title{margin:0;font-size:15px;font-weight:600}
.hz-dialog__hint{margin:0;font-size:12px;color:var(--muted-foreground);line-height:1.5}
.hz-dialog__content{display:flex;flex-direction:column;gap:8px}
.hz-dialog__content .hz-field{padding:8px 0;border-bottom:0}
.hz-dialog__footer{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
.hz-logbar{display:flex;flex-direction:column;gap:8px;width:100%;max-width:26rem}
`;
  document.head.appendChild(style);
}

/* ========================================================================== *
 * 数据源 — 每个分区一个 Resource（loading/error/ready 由 data-layer 统一管理）
 * ========================================================================== */

/** 设置页用到的全部 Resource。延迟创建，便于测试注入。 */
export function createSettingsResources() {
  return {
    /** GET /api/ui → config（appearance / layout / pages） */
    uiConfig: new Resource('settingsUiConfig', {
      endpoint: '/api/ui',
      select: (payload) => payload.config,
    }),
    /** GET /api/system/settings → { settings, hasCert, envOverrides, listeningPort } */
    systemSettings: new Resource('settingsSystemSettings', {
      endpoint: '/api/system/settings',
    }),
    /** GET /api/system/storage → { settings, snapshot, lastCleanup } */
    storage: new Resource('settingsStorage', {
      endpoint: '/api/system/storage',
    }),
    /** GET /api/notifications/config → config */
    notifications: new Resource('settingsNotifications', {
      endpoint: '/api/notifications/config',
      select: (payload) => payload.config,
    }),
    /** GET /api/global-config → config */
    globalConfig: new Resource('settingsGlobalConfig', {
      endpoint: '/api/global-config',
      select: (payload) => payload.config,
    }),
    /** GET /api/auth/totp → { enabled, ... } */
    totp: new Resource('settingsTotp', {
      endpoint: '/api/auth/totp',
    }),
    /** GET /api/update/check?force=true */
    updateInfo: new Resource('settingsUpdateInfo', {
      endpoint: '/api/update/check?force=true',
    }),
    /** GET /api/update/sources → config */
    updateSources: new Resource('settingsUpdateSources', {
      endpoint: '/api/update/sources',
      select: (payload) => payload.config,
    }),
    /** GET /api/system → 主机 / 运行时 */
    systemInfo: new Resource('settingsSystemInfo', {
      endpoint: '/api/system',
    }),
  };
}

/* ========================================================================== *
 * 外观写入（POST /api/ui 是「区块合并」语义，只提交 appearance）
 * ========================================================================== */

/** 保存 appearance（服务端会 normalize，返回落库后的完整 config）。 */
export async function saveAppearance(appearance) {
  const payload = await request('/api/ui', { method: 'POST', body: { appearance } });
  return payload && payload.config ? payload.config : null;
}

/** 保存 pages 区块（用于「登录后落地页」）。 */
export async function savePages(pages) {
  const payload = await request('/api/ui', { method: 'POST', body: { pages } });
  return payload && payload.config ? payload.config : null;
}

/* ========================================================================== *
 * 极简模态框（原生 <dialog> 的替代：受控 div，零依赖）
 * ========================================================================== */

/**
 * 打开一个模态框。
 * @param {Object} options
 * @param {string} options.title
 * @param {string} [options.hint]
 * @param {Node[]} [options.content]
 * @param {string} [options.confirmLabel]
 * @param {boolean} [options.destructive]
 * @param {(close: () => void) => void|Promise<void>} [options.onConfirm]
 * @returns {{close: () => void, node: HTMLElement}}
 */
export function openDialog({ title, hint, content = [], confirmLabel, destructive, onConfirm, cancelLabel } = {}) {
  const overlay = el('div', { class: 'hz-dialog-overlay' });
  const box = el('div', { class: 'hz-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  box.appendChild(el('h3', { class: 'hz-dialog__title', text: title }));
  if (hint) box.appendChild(el('p', { class: 'hz-dialog__hint', text: hint }));

  const contentBox = el('div', { class: 'hz-dialog__content' });
  for (const node of content) if (node) contentBox.appendChild(node);
  box.appendChild(contentBox);

  const close = () => {
    overlay.classList.remove('is-open');
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (event) => { if (event.key === 'Escape') close(); };

  const footer = el('div', { class: 'hz-dialog__footer' }, [
    Button({ label: cancelLabel || STRINGS.cancel, variant: 'ghost', onClick: close }),
    Button({
      label: confirmLabel || STRINGS.save,
      variant: destructive ? 'danger' : 'primary',
      onClick: () => { if (onConfirm) onConfirm(close); },
    }),
  ]);
  box.appendChild(footer);

  overlay.appendChild(box);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  overlay.classList.add('is-open');
  return { close, node: overlay };
}

/* ========================================================================== *
 * 各分区渲染函数（纯函数：输入快照，输出 DOM；副作用通过回调注入）
 * ========================================================================== */

/**
 * 外观区块。
 *
 * 语言挂载点：由调用方传入已创建的 slot 节点（`languageSlot`），
 * 本函数**只负责把它放在外观区块末尾**，不创建也不清空它。
 *
 * @param {Object} appearance   归一化后的 appearance
 * @param {Object} handlers     { patch, uploadBackground, removeBackground }
 * @param {Node} languageSlot   语言挂载点（跨渲染复用）
 * @returns {HTMLElement}
 */
export function renderAppearanceSection(appearance, handlers, languageSlot) {
  const { patch, uploadBackground, removeBackground } = handlers;
  const wrap = el('div', { class: 'hz-section', 'data-hz-section': 'appearance' });

  /* ---- 主题 ---- */
  const paletteGrid = el('div', { class: 'hz-palette-grid', role: 'radiogroup', 'aria-label': STRINGS.palette });
  for (const preset of PALETTE_PRESETS) {
    const active = appearance.palette === preset.id;
    const button = el('button', {
      type: 'button',
      role: 'radio',
      'aria-checked': active ? 'true' : 'false',
      'aria-label': preset.label,
      class: `hz-palette${active ? ' is-active' : ''}`,
      onClick: () => patch({ palette: preset.id }),
    }, [
      el('span', { class: 'hz-palette__preview', style: { 'background-color': preset.preview.bg } }, [
        el('span', { class: 'hz-palette__surface', style: { 'background-color': preset.preview.surface } },
          preset.preview.dots.map((color) => el('span', { class: 'hz-palette__dot', style: { 'background-color': color } }))),
      ]),
      el('span', { class: 'hz-palette__label', text: preset.label }),
    ]);
    paletteGrid.appendChild(button);
  }
  const paletteHint = LIGHT_PALETTES.indexOf(appearance.palette) >= 0
    ? fmt(STRINGS.paletteLightResolved, { label: (PALETTE_PRESETS.find((p) => p.id === appearance.palette) || {}).label })
    : STRINGS.paletteHint;

  wrap.appendChild(Card({
    title: STRINGS.theme,
    hint: STRINGS.themeHint,
    children: [
      fieldRow(STRINGS.palette, paletteGrid, paletteHint, 'stack'),
      fieldRow(STRINGS.displayMode,
        segmented(appearance.mode, MODE_OPTIONS, (value) => patch({ mode: value }), STRINGS.displayMode)),
      fieldRow(STRINGS.darkIntensity,
        segmented(appearance.darkIntensity, DARK_INTENSITY_OPTIONS, (value) => patch({ darkIntensity: value }), STRINGS.darkIntensity),
        STRINGS.darkIntensityHint),
    ],
  }));

  /* ---- 强调色 ---- */
  const swatches = el('div', { class: 'hz-swatches' });
  for (const preset of ACCENT_PRESETS) {
    const active = appearance.accentMode === 'preset' && appearance.accentPreset === preset.id;
    swatches.appendChild(el('button', {
      type: 'button',
      title: preset.label,
      'aria-label': preset.label,
      'aria-pressed': active ? 'true' : 'false',
      class: `hz-swatch${active ? ' is-active' : ''}`,
      style: { 'background-color': preset.swatch },
      onClick: () => patch({ accentMode: 'preset', accentPreset: preset.id }),
    }, active ? [el('span', { class: 'hz-swatch__check', text: '✓' })] : []));
  }
  const customColor = el('input', { type: 'color', 'aria-label': STRINGS.accentCustomAria });
  customColor.value = /^#[0-9a-fA-F]{6}$/.test(appearance.accentCustom) ? appearance.accentCustom : DEFAULT_APPEARANCE.accentCustom;
  customColor.addEventListener('input', () => patch({ accentMode: 'custom', accentCustom: customColor.value }));
  swatches.appendChild(el('label', {
    class: `hz-swatch${appearance.accentMode === 'custom' ? ' is-active' : ''}`,
    title: STRINGS.accentCustom,
    style: { background: appearance.accentMode === 'custom' ? appearance.accentCustom : 'conic-gradient(from 0deg, #f43f5e, #f59e0b, #10b981, #0ea5e9, #8b5cf6, #f43f5e)' },
  }, [customColor, appearance.accentMode === 'custom' ? el('span', { class: 'hz-swatch__check', text: '✓' }) : null]));

  wrap.appendChild(Card({
    title: STRINGS.accent,
    hint: STRINGS.accentHint,
    children: [
      fieldRow(STRINGS.accentPreset, swatches, null, 'stack'),
      fieldRow(STRINGS.accentScope,
        segmented(appearance.accentScope, ACCENT_SCOPE_OPTIONS, (value) => patch({ accentScope: value }), STRINGS.accentScope),
        STRINGS.accentScopeHint),
      fieldRow(STRINGS.sidebarStyle,
        segmented(appearance.sidebarStyle, SIDEBAR_STYLE_OPTIONS, (value) => patch({ sidebarStyle: value }), STRINGS.sidebarStyle)),
    ],
  }));

  /* ---- 排版与界面 ---- */
  wrap.appendChild(Card({
    title: STRINGS.typography,
    hint: STRINGS.typographyHint,
    children: [
      fieldRow(STRINGS.fontSans,
        selectControl(appearance.fontSans, FONT_SANS_OPTIONS, (value) => patch({ fontSans: value }), STRINGS.fontSans)),
      fieldRow(STRINGS.fontSansCustom,
        textInput(appearance.fontSansCustom, { placeholder: STRINGS.fontSansPlaceholder, onInput: (value) => patch({ fontSansCustom: value }) })),
      fieldRow(STRINGS.fontMono,
        selectControl(appearance.fontMono, FONT_MONO_OPTIONS, (value) => patch({ fontMono: value }), STRINGS.fontMono),
        STRINGS.fontMonoHint),
      fieldRow(STRINGS.fontMonoCustom,
        textInput(appearance.fontMonoCustom, { placeholder: STRINGS.fontMonoPlaceholder, onInput: (value) => patch({ fontMonoCustom: value }) })),
      fieldRow(STRINGS.radius,
        segmented(appearance.radius, RADIUS_OPTIONS, (value) => patch({ radius: value }), STRINGS.radius)),
      fieldRow(STRINGS.uiScale,
        numberInput(appearance.uiScale, {
          min: 0.9, max: 1.2, step: 0.05,
          onInput: (raw) => {
            const n = Number(raw);
            if (Number.isFinite(n) && n >= 0.9 && n <= 1.2) patch({ uiScale: n });
          },
        }),
        STRINGS.uiScaleHint),
      fieldRow(STRINGS.density,
        segmented(appearance.density, DENSITY_OPTIONS, (value) => patch({ density: value }), STRINGS.density)),
    ],
  }));

  /* ---- 交互与无障碍 ---- */
  wrap.appendChild(Card({
    title: STRINGS.interaction,
    hint: STRINGS.interactionHint,
    children: [
      fieldRow(STRINGS.customContextMenu,
        Toggle({ checked: appearance.customContextMenu === true, label: STRINGS.customContextMenu, onChange: (next) => patch({ customContextMenu: next }) }),
        STRINGS.customContextMenuHint),
      fieldRow(STRINGS.customPointer,
        Toggle({ checked: appearance.customPointerSystem === true, label: STRINGS.customPointer, onChange: (next) => patch({ customPointerSystem: next }) }),
        STRINGS.customPointerHint),
      fieldRow(STRINGS.reduceMotion,
        Toggle({ checked: appearance.reduceMotion === true, label: STRINGS.reduceMotion, onChange: (next) => patch({ reduceMotion: next }) }),
        STRINGS.reduceMotionHint),
      fieldRow(STRINGS.disableMotion,
        Toggle({ checked: appearance.disableMotion === true, label: STRINGS.disableMotion, onChange: (next) => patch({ disableMotion: next }) }),
        STRINGS.disableMotionHint),
      fieldRow(STRINGS.highContrast,
        Toggle({ checked: appearance.highContrast === true, label: STRINGS.highContrast, onChange: (next) => patch({ highContrast: next }) }),
        STRINGS.highContrastHint),
      fieldRow(STRINGS.sidebarPinned,
        Toggle({ checked: appearance.sidebarPinned === true, label: STRINGS.sidebarPinned, onChange: (next) => patch({ sidebarPinned: next }) }),
        STRINGS.sidebarPinnedHint),
    ],
  }));

  /* ---- 背景 ---- */
  const bg = appearance.background;
  const bgDetail = el('div', {});
  const bgFeedback = el('p', { class: 'hz-row__hint' });
  const fileInput = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp' });
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      bgFeedback.textContent = STRINGS.wallpaperTooLarge;
      fileInput.value = '';
      return;
    }
    bgFeedback.textContent = STRINGS.wallpaperUploading;
    try {
      await uploadBackground(file);
      bgFeedback.textContent = STRINGS.wallpaperUploaded;
    } catch (error) {
      bgFeedback.textContent = `${STRINGS.wallpaperUploadFailed}：${error.message || A.unknown}`;
    } finally {
      fileInput.value = '';
    }
  });

  const drawBackground = (type) => {
    while (bgDetail.firstChild) bgDetail.removeChild(bgDetail.firstChild);
    bgFeedback.textContent = bg.hasImage
      ? fmt(STRINGS.wallpaperPresent, { mime: dash(bg.imageMime), version: dash(bg.imageVersion) })
      : STRINGS.wallpaperNone;

    if (type === 'solid' || type === 'gradient' || type === 'image') {
      const colorInput = el('input', { type: 'color', 'aria-label': STRINGS.backgroundColor });
      colorInput.value = /^#[0-9a-fA-F]{6}$/.test(bg.color) ? bg.color : DEFAULT_APPEARANCE.background.color;
      colorInput.addEventListener('input', () => patch({ background: { color: colorInput.value } }));
      bgDetail.appendChild(fieldRow(STRINGS.backgroundColor, colorInput));
    }
    if (type === 'gradient') {
      bgDetail.appendChild(fieldRow(STRINGS.gradientPreset, selectControl(
        bg.gradient,
        GRADIENT_PRESETS.map((g) => ({ value: g.id, label: g.label })),
        (value) => patch({ background: { gradient: value } }),
        STRINGS.gradientPreset,
      )));
    }
    if (type === 'image') {
      bgDetail.appendChild(fieldRow(STRINGS.wallpaper, [
        Button({ label: STRINGS.wallpaperUpload, variant: 'outline', onClick: () => fileInput.click() }),
        Button({ label: STRINGS.wallpaperRemove, variant: 'danger', disabled: bg.hasImage !== true, onClick: async () => {
          try {
            await removeBackground();
            bgFeedback.textContent = STRINGS.wallpaperRemoved;
          } catch (error) {
            bgFeedback.textContent = `${STRINGS.wallpaperRemoveFailed}：${error.message || A.unknown}`;
          }
        } }),
        fileInput,
      ], STRINGS.wallpaperHint, 'stack'));
      bgDetail.appendChild(fieldRow(STRINGS.imageOpacity, numberInput(bg.imageOpacity, {
        min: 0, max: 1, step: 0.05,
        onInput: (raw) => { const n = Number(raw); if (Number.isFinite(n)) patch({ background: { imageOpacity: n } }); },
      }), STRINGS.imageOpacityHint));
      bgDetail.appendChild(fieldRow(STRINGS.imageBlur, numberInput(bg.imageBlur, {
        min: 0, max: 40, step: 1,
        onInput: (raw) => { const n = Number(raw); if (Number.isFinite(n)) patch({ background: { imageBlur: n } }); },
      }), fmt(STRINGS.imageBlurUnit, { n: dash(bg.imageBlur) })));
    }
    bgDetail.appendChild(el('div', { class: 'hz-row' }, [bgFeedback]));
  };
  drawBackground(bg.type);

  wrap.appendChild(Card({
    title: STRINGS.background,
    hint: STRINGS.backgroundHint,
    children: [
      fieldRow(STRINGS.backgroundType,
        segmented(bg.type, BACKGROUND_TYPE_OPTIONS, (value) => { patch({ background: { type: value } }); drawBackground(value); }, STRINGS.backgroundType),
        null, 'stack'),
      bgDetail,
    ],
  }));

  /* ---- 自定义 CSS ---- */
  wrap.appendChild(Card({
    title: STRINGS.customCss,
    hint: STRINGS.customCssHint,
    children: [fieldRow(STRINGS.customCss, textArea(appearance.customCss, {
      rows: 8,
      placeholder: STRINGS.customCssPlaceholder,
      onInput: (value) => patch({ customCss: value }),
    }), null, 'stack')],
  }));

  /* ---- 语言挂载点（外观区块末尾，务必保留） ---- */
  if (languageSlot) wrap.appendChild(languageSlot);
  return wrap;
}

/**
 * 数据与格式区块。
 * @param {Object} appearance
 * @param {Object|undefined} pages
 * @param {Object} handlers { patchAppearance, patchPages }
 */
export function renderDataSection(appearance, pages, handlers) {
  const { patchAppearance, patchPages } = handlers;
  const wrap = el('div', { class: 'hz-section', 'data-hz-section': 'data' });

  wrap.appendChild(Card({
    title: STRINGS.dataRefresh,
    hint: STRINGS.dataRefreshHint,
    children: [
      fieldRow(STRINGS.pollInterval,
        selectControl(appearance.pollInterval, POLL_INTERVAL_OPTIONS, (value) => patchAppearance({ pollInterval: Number(value) }), STRINGS.pollInterval),
        appearance.pollInterval === 0 ? STRINGS.pollPaused : fmt(STRINGS.pollCurrent, { ms: appearance.pollInterval })),
      fieldRow(STRINGS.timeFormat,
        segmented(appearance.timeFormat, [
          { value: '24h', label: STRINGS.time24 },
          { value: '12h', label: STRINGS.time12 },
        ], (value) => patchAppearance({ timeFormat: value }), STRINGS.timeFormat),
        STRINGS.timeFormatHint),
    ],
  }));

  const defaultRoute = (pages && pages.defaultRoute) || '/';
  wrap.appendChild(Card({
    title: STRINGS.landingPage,
    hint: STRINGS.landingPageHint,
    children: [
      fieldRow(STRINGS.defaultPage, selectControl(defaultRoute, [
        { value: '/', label: '总览' },
        { value: '/processes', label: '进程' },
        { value: '/config', label: '配置' },
        { value: '/logs', label: '日志' },
        { value: '/settings', label: '设置' },
      ], (value) => patchPages({ defaultRoute: value }), STRINGS.defaultPage)),
    ],
  }));

  wrap.appendChild(Card({
    title: STRINGS.customCss,
    hint: STRINGS.customCssHint,
    children: [fieldRow(STRINGS.customCss, textArea(appearance.customCss, {
      rows: 10,
      placeholder: STRINGS.customCssPlaceholder,
      onInput: (value) => patchAppearance({ customCss: value }),
    }), null, 'stack')],
  }));
  return wrap;
}

/**
 * 账号安全区块（修改密码 + 2FA 状态）。
 * @param {Object} snapshot   totp Resource 快照
 * @param {Object} handlers   { onChangePassword, onCheckStrength, onTotpEnable,
 *                              onTotpDisable, onReloadTotp }
 * @param {string} slotId     外观语言挂载点之外的独立容器 id 前缀不需要 —— 保留参数位
 */
export function renderAccountSection(snapshot, handlers) {
  const { onChangePassword, onCheckStrength, onTotpEnable, onTotpDisable, onReloadTotp } = handlers;
  const wrap = el('div', { class: 'hz-section', 'data-hz-section': 'account' });

  /* ---- 修改密码 ---- */
  const feedback = el('p', { class: 'hz-row__hint' });
  const dialogContent = [];
  const oldInput = textInput('', { type: 'password' });
  const newInput = textInput('', { type: 'password' });
  const confirmInput = textInput('', { type: 'password' });
  const strengthHint = el('p', { class: 'hz-row__hint' });

  newInput.addEventListener('input', async () => {
    const value = newInput.value;
    if (!value) { strengthHint.textContent = ''; return; }
    try {
      const result = await onCheckStrength(value);
      const failed = (result && Array.isArray(result.rules) ? result.rules : [])
        .filter((rule) => rule && rule.passed === false)
        .map((rule) => rule.label || rule.id || rule.message || '')
        .filter(Boolean);
      strengthHint.textContent = result && result.valid
        ? STRINGS.passwordStrengthOk
        : fmt(STRINGS.passwordStrengthBad, { list: failed.join('、') || A.unknown });
    } catch {
      strengthHint.textContent = '';
    }
  });

  dialogContent.push(formField(STRINGS.oldPassword, oldInput));
  dialogContent.push(formField(STRINGS.newPassword, newInput));
  dialogContent.push(formField(STRINGS.confirmPassword, confirmInput));
  dialogContent.push(strengthHint);

  wrap.appendChild(Card({
    title: STRINGS.accountTitle,
    hint: STRINGS.accountHint,
    children: [
      fieldRow(STRINGS.accessPassword, Button({
        label: STRINGS.changePassword,
        variant: 'outline',
        onClick: () => openDialog({
          title: STRINGS.changePasswordTitle,
          hint: STRINGS.changePasswordHint,
          content: dialogContent,
          confirmLabel: STRINGS.save,
          onConfirm: async (close) => {
            if (!oldInput.value || !newInput.value) { strengthHint.textContent = STRINGS.passwordEmpty; return; }
            if (newInput.value !== confirmInput.value) { strengthHint.textContent = STRINGS.passwordMismatch; return; }
            try {
              const result = await onChangePassword(oldInput.value, newInput.value);
              if (result && result.success) {
                feedback.textContent = STRINGS.passwordChanged;
                feedback.className = 'hz-row__hint hz-text--success';
                close();
              } else {
                strengthHint.textContent = (result && result.message) || STRINGS.passwordChangeFailed;
              }
            } catch (error) {
              strengthHint.textContent = `${STRINGS.passwordChangeFailed}：${error.message || A.unknown}`;
            }
          },
        }),
      }), STRINGS.accessPasswordHint),
      el('div', { class: 'hz-row' }, [feedback]),
    ],
  }));

  /* ---- 双重验证 ---- */
  const totpBody = stateView({
    resource: { get: () => snapshot },
    isEmpty: () => false,
    loadingLabel: STRINGS.loading,
    onRetry: onReloadTotp,
    render: (data) => {
      const enabled = data && data.enabled === true;
      return [
        fieldRow(STRINGS.totpStatus, Badge({
          text: enabled
            ? fmt(STRINGS.totpEnabledDetail, { label: dash(data.label), n: dash(data.remainingRecoveryCodes) })
            : STRINGS.totpDisabled,
          tone: enabled ? 'ok' : 'idle',
        })),
        fieldRow(STRINGS.totpTitle, Button({
          label: enabled ? STRINGS.totpDisable : STRINGS.totpEnable,
          variant: enabled ? 'danger' : 'outline',
          onClick: enabled ? onTotpDisable : onTotpEnable,
        })),
      ];
    },
  });
  wrap.appendChild(Card({ title: STRINGS.totpTitle, hint: STRINGS.totpHint, children: [totpBody] }));
  return wrap;
}

/**
 * 全局配置区块（rkey 回退服务器 / 音乐签名端点 / 视频上传连接数）。
 * @param {Object} config
 * @param {Object} handlers { onSave }
 */
export function renderGlobalConfigSection(config, handlers) {
  const { onSave } = handlers;
  const wrap = el('div', { class: 'hz-section', 'data-hz-section': 'global-config' });

  const rkeyList = (config.rkey && Array.isArray(config.rkey.fallbackServers)) ? config.rkey.fallbackServers.slice() : [];
  const feedback = el('p', { class: 'hz-row__hint' });

  const commit = async (patch, successText) => {
    try {
      await onSave(patch);
      feedback.textContent = successText;
      feedback.className = 'hz-row__hint';
    } catch (error) {
      feedback.textContent = `${STRINGS.saveFailed}：${error.message || A.unknown}`;
      feedback.className = 'hz-row__hint hz-text--error';
    }
  };

  /* rkey 列表：逐行编辑（每行一个 URL），失焦时提交 */
  const listBox = el('div', { class: 'hz-channel-list' });
  const renderList = (items) => {
    while (listBox.firstChild) listBox.removeChild(listBox.firstChild);
    items.forEach((item, index) => {
      const input = textInput(item, {
        placeholder: 'https://example.com/rkey',
        onInput: () => {},
      });
      input.style.maxWidth = '20rem';
      input.addEventListener('blur', () => {
        const next = rkeyList.slice();
        const value = input.value.trim();
        if (value && !isHttpUrl(value)) { feedback.textContent = STRINGS.globalInvalidUrl; input.value = item; return; }
        next[index] = value;
        const cleaned = next.filter(Boolean);
        if (JSON.stringify(cleaned) !== JSON.stringify(rkeyList)) {
          rkeyList.length = 0;
          rkeyList.push(...cleaned);
          commit({ rkey: { fallbackServers: rkeyList } }, STRINGS.saved);
        }
      });
      listBox.appendChild(el('div', { class: 'hz-row__control' }, [
        input,
        Button({
          label: STRINGS.remove,
          variant: 'ghost',
          onClick: () => {
            rkeyList.splice(index, 1);
            commit({ rkey: { fallbackServers: rkeyList } }, STRINGS.saved);
            renderList(rkeyList);
          },
        }),
      ]));
    });
    if (items.length === 0) listBox.appendChild(el('p', { class: 'hz-row__hint', text: A.empty }));
    listBox.appendChild(el('div', { class: 'hz-row__control' }, [
      Button({
        label: STRINGS.rkeyAdd,
        variant: 'outline',
        onClick: () => { rkeyList.push(''); renderList(rkeyList); },
      }),
    ]));
  };
  renderList(rkeyList);

  const musicInput = textInput(config.musicSignUrl || '', {
    placeholder: 'https://example.com/sign',
    onInput: () => {},
  });
  musicInput.addEventListener('blur', () => {
    const value = musicInput.value.trim();
    if (value && !isHttpUrl(value)) { feedback.textContent = STRINGS.globalInvalidUrl; musicInput.value = config.musicSignUrl || ''; return; }
    if (value !== (config.musicSignUrl || '')) commit({ musicSignUrl: value }, STRINGS.saved);
  });

  const concurrency = numberInput(config.videoUploadConcurrency, {
    min: 1, max: 32, step: 1,
    onInput: () => {},
  });
  concurrency.addEventListener('blur', () => {
    const n = Number(concurrency.value);
    if (Number.isSafeInteger(n) && n >= 1 && n !== config.videoUploadConcurrency) {
      commit({ videoUploadConcurrency: n }, STRINGS.saved);
    }
  });

  wrap.appendChild(Card({
    title: STRINGS.globalConfigTitle,
    hint: STRINGS.globalConfigHint,
    children: [
      fieldRow(STRINGS.rkeyFallback, listBox, STRINGS.rkeyFallbackHint, 'stack'),
      fieldRow(STRINGS.musicSignUrl, musicInput, STRINGS.musicSignUrlHint),
      fieldRow(STRINGS.videoUploadConcurrency, concurrency),
      el('div', { class: 'hz-row' }, [feedback]),
    ],
  }));
  return wrap;
}

/**
 * 存储区块。
 * @param {Object} payload  { settings, snapshot, lastCleanup }
 * @param {Object} handlers { onSaveSettings, onCleanup, onReload }
 */
export function renderStorageSection(payload, handlers) {
  const { onSaveSettings, onCleanup, onReload } = handlers;
  const wrap = el('div', { class: 'hz-section', 'data-hz-section': 'storage' });

  const settings = payload.settings || {};
  const effective = settings.effective || settings.saved || {};
  const envOverrides = Array.isArray(settings.envOverrides) ? settings.envOverrides : [];
  const snapshot = payload.snapshot || {};
  const logs = snapshot.logs || {};
  const totals = snapshot.totals || {};
  const feedback = el('p', { class: 'hz-row__hint' });

  if (envOverrides.length > 0) {
    wrap.appendChild(notice('warning', fmt(STRINGS.envLocked, { fields: envOverrides.join('、') })));
  }

  /* ---- 概览 ---- */
  const stateBadge = (() => {
    if (logs.state === 'degraded') return Badge({ text: STRINGS.stateDegraded, tone: 'error' });
    if (logs.state === 'warning') return Badge({ text: STRINGS.stateWarning, tone: 'warn' });
    if (logs.state === 'disabled') return Badge({ text: STRINGS.stateDisabled, tone: 'idle' });
    const percent = logs.maxTotalBytes > 0 ? (logs.totalBytes / logs.maxTotalBytes) * 100 : 0;
    if (percent >= 80) return Badge({ text: STRINGS.stateNearLimit, tone: 'warn' });
    return Badge({ text: STRINGS.stateHealthy, tone: 'ok' });
  })();

  const logMeta = [
    fmt(STRINGS.fileCountUnit, { n: dash(logs.fileCount) }),
    fmt(STRINGS.activeFileCountUnit, { n: dash(logs.activeFileCount) }),
    logs.droppedLines > 0 ? fmt(STRINGS.droppedLinesUnit, { n: logs.droppedLines }) : null,
  ].filter(Boolean).join(' · ');

  wrap.appendChild(Card({
    title: STRINGS.storageOverview,
    hint: STRINGS.storageHint,
    actions: [Button({ label: STRINGS.refresh, variant: 'ghost', icon: Icon('refresh'), onClick: onReload })],
    children: [
      KeyValueList([
        { label: STRINGS.managedTotal, value: formatBytes(totals.managedBytes) },
        { label: STRINGS.logsLabel, value: formatBytes(totals.logsBytes) },
        { label: STRINGS.accountDbLabel, value: formatBytes(totals.accountDataBytes) },
        { label: STRINGS.tempLabel, value: formatBytes(totals.temporaryBytes) },
      ]),
      fieldRow(STRINGS.logCapacity,
        el('div', { class: 'hz-logbar' }, [
          stateBadge,
          ProgressBar({
            value: logs.totalBytes,
            max: logs.maxTotalBytes,
            tone: (logs.state === 'warning' || logs.state === 'degraded') ? 'error' : undefined,
            showLabel: true,
          }),
        ]),
        logMeta, 'stack'),
    ],
  }));

  /* ---- 日志策略 ---- */
  const maxMbInput = numberInput(effective.logMaxTotalMb, { min: 1, step: 1 });
  const retainInput = numberInput(effective.logRetainDays, { min: 0, step: 1 });
  const perUinState = { value: effective.logPerUin === true };
  const perUinToggle = Toggle({
    checked: perUinState.value,
    label: STRINGS.logPerUin,
    onChange: (next) => { perUinState.value = next; },
  });
  const applyButton = Button({
    label: STRINGS.saveAndApply,
    variant: 'primary',
    onClick: async () => {
      const maxMb = Number(maxMbInput.value);
      const retain = Number(retainInput.value);
      if (!Number.isSafeInteger(maxMb) || maxMb < 1) { feedback.textContent = STRINGS.logMaxInvalid; return; }
      if (!Number.isSafeInteger(retain) || retain < 0) { feedback.textContent = STRINGS.logRetainInvalid; return; }
      try {
        await onSaveSettings({ logMaxTotalMb: maxMb, logRetainDays: retain, logPerUin: perUinState.value });
        feedback.textContent = STRINGS.logPolicyUpdated;
      } catch (error) {
        feedback.textContent = `${STRINGS.logPolicyFailed}：${error.message || A.unknown}`;
      }
    },
  });

  wrap.appendChild(Card({
    title: STRINGS.logPolicy,
    hint: STRINGS.logPolicyHint,
    children: [
      fieldRow(STRINGS.logMaxTotalMb, maxMbInput),
      fieldRow(STRINGS.logRetainDays, retainInput),
      fieldRow(STRINGS.logPerUin, perUinToggle),
      fieldRow('', applyButton, null, 'stack'),
    ],
  }));

  /* ---- 全局清理 ---- */
  const confirmPhrase = { value: '' };
  wrap.appendChild(Card({
    title: STRINGS.globalCleanup,
    hint: STRINGS.cleanupHint,
    children: [
      fieldRow(STRINGS.cleanupLogs, Button({
        label: STRINGS.cleanup,
        variant: 'danger',
        onClick: () => openDialog({
          title: STRINGS.cleanupLogsTitle,
          hint: STRINGS.cleanupLogsBody,
          confirmLabel: STRINGS.cleanup,
          destructive: true,
          onConfirm: async (close) => {
            try {
              const result = await onCleanup({ scope: 'logs' });
              const cleanup = (result && result.cleanup) || {};
              const parts = [
                fmt(STRINGS.cleanupDone, { files: dash(cleanup.deletedFiles), bytes: formatBytes(cleanup.freedBytes) }),
              ];
              if (cleanup.skippedActiveItems > 0) parts.push(fmt(STRINGS.cleanupSkippedActive, { n: cleanup.skippedActiveItems }));
              if (Array.isArray(cleanup.failures) && cleanup.failures.length) parts.push(fmt(STRINGS.cleanupFailureCount, { n: cleanup.failures.length }));
              feedback.textContent = parts.join(' ');
              close();
            } catch (error) {
              feedback.textContent = `${STRINGS.cleanupFailed}：${error.message || A.unknown}`;
            }
          },
        }),
      })),
      fieldRow(STRINGS.cleanupTemp, Button({
        label: STRINGS.cleanup,
        variant: 'danger',
        onClick: () => openDialog({
          title: STRINGS.cleanupTempTitle,
          hint: STRINGS.cleanupTempBody,
          confirmLabel: STRINGS.cleanup,
          destructive: true,
          onConfirm: async (close) => {
            try {
              const result = await onCleanup({ scope: 'temporary' });
              const cleanup = (result && result.cleanup) || {};
              feedback.textContent = fmt(STRINGS.cleanupDone, { files: dash(cleanup.deletedFiles), bytes: formatBytes(cleanup.freedBytes) });
              close();
            } catch (error) {
              feedback.textContent = `${STRINGS.cleanupFailed}：${error.message || A.unknown}`;
            }
          },
        }),
      })),
      el('div', { class: 'hz-row' }, [feedback]),
    ],
  }));

  /* ---- 账号数据清理 ---- */
  const accounts = Array.isArray(snapshot.accounts) ? snapshot.accounts : [];
  if (accounts.length === 0) {
    wrap.appendChild(Card({
      title: STRINGS.cleanupAccountData,
      hint: STRINGS.cleanupAccountHint,
      children: [EmptyState({ title: STRINGS.cleanupNoAccounts, icon: Icon('inbox', { size: 28 }) })],
    }));
  } else {
    const rows = [];
    const onlineCount = accounts.filter((account) => account.online === true).length;
    if (onlineCount > 0) {
      rows.push(notice('warning', fmt(STRINGS.cleanupOnlineBlocked, { n: onlineCount })));
    }
    for (const account of accounts) {
      rows.push(fieldRow(
        `${dash(account.nickname)} (${dash(account.uin)})`,
        Badge({ text: account.online ? STRINGS.online : STRINGS.offline, tone: account.online ? 'ok' : 'idle' }),
        formatBytes(account.totalBytes),
      ));
      for (const category of STORAGE_CATEGORIES) {
        rows.push(fieldRow(
          category.label,
          Button({
            label: STRINGS.cleanup,
            variant: 'danger',
            disabled: account.online === true,
            title: account.online === true ? STRINGS.cleanupAccountOnline : null,
            onClick: () => openDialog({
              title: fmt(STRINGS.cleanupAccountTitle, { uin: account.uin, category: category.label }),
              hint: fmt(STRINGS.cleanupAccountBody, { uin: account.uin, category: category.label }),
              confirmLabel: STRINGS.cleanup,
              destructive: true,
              onConfirm: async (close) => {
                try {
                  const result = await onCleanup({ scope: 'account', category: category.key, uin: account.uin });
                  const cleanup = (result && result.cleanup) || {};
                  feedback.textContent = fmt(STRINGS.cleanupDone, { files: dash(cleanup.deletedFiles), bytes: formatBytes(cleanup.freedBytes) });
                  close();
                } catch (error) {
                  feedback.textContent = `${STRINGS.cleanupFailed}：${error.message || A.unknown}`;
                }
              },
            }),
          }),
          `${formatBytes(account[category.bytesField])} · ${category.hint}`,
        ));
      }
    }

    /* 全部账号清理（服务端要求 confirmation === '清理全部账号'） */
    const allBox = el('div', { class: 'hz-row__control' });
    for (const category of STORAGE_CATEGORIES) {
      allBox.appendChild(Button({
        label: `${STRINGS.cleanupAllAccounts}·${category.label}`,
        variant: 'danger',
        disabled: onlineCount > 0,
        onClick: () => {
          const phraseInput = textInput('', { placeholder: STRINGS.cleanupAllAccountsPhrase, onInput: (value) => { confirmPhrase.value = value; } });
          const hintNode = el('p', { class: 'hz-row__hint', text: fmt(STRINGS.cleanupAllAccountsBody, { category: category.label, phrase: STRINGS.cleanupAllAccountsPhrase }) });
          openDialog({
            title: fmt(STRINGS.cleanupAllAccountsTitle, { category: category.label }),
            confirmLabel: STRINGS.cleanup,
            destructive: true,
            content: [hintNode, formField(STRINGS.cleanupConfirmPhrase, phraseInput)],
            onConfirm: async (close) => {
              if (confirmPhrase.value !== STRINGS.cleanupAllAccountsPhrase) {
                hintNode.textContent = fmt(STRINGS.cleanupAllAccountsBody, { category: category.label, phrase: STRINGS.cleanupAllAccountsPhrase });
                return;
              }
              try {
                const result = await onCleanup({ scope: 'allAccounts', category: category.key, confirmation: STRINGS.cleanupAllAccountsPhrase });
                const cleanup = (result && result.cleanup) || {};
                feedback.textContent = fmt(STRINGS.cleanupDone, { files: dash(cleanup.deletedFiles), bytes: formatBytes(cleanup.freedBytes) });
                close();
              } catch (error) {
                feedback.textContent = `${STRINGS.cleanupFailed}：${error.message || A.unknown}`;
              }
            },
          });
        },
      }));
    }
    rows.push(fieldRow(STRINGS.cleanupAllAccounts, allBox, STRINGS.cleanupScopeRequired, 'stack'));
    wrap.appendChild(Card({ title: STRINGS.cleanupAccountData, hint: STRINGS.cleanupAccountHint, children: rows }));
  }

  if (payload.lastCleanup) {
    const last = payload.lastCleanup;
    wrap.appendChild(notice('info', fmt(STRINGS.cleanupLastAt, {
      time: formatTime(last.at),
      files: dash(last.deletedFiles),
      bytes: formatBytes(last.freedBytes),
    })));
  }
  return wrap;
}

/**
 * 通知区块（去抖窗口 + 渠道增删改 + 测试发送）。
 * @param {Object} config   { version, debounceSeconds, channels[] }
 * @param {Object} handlers { onSave, onTest }
 */
export function renderNotificationsSection(config, handlers) {
  const { onSave, onTest } = handlers;
  const wrap = el('div', { class: 'hz-section', 'data-hz-section': 'notifications' });
  const channels = Array.isArray(config.channels) ? config.channels.slice() : [];
  const debounce = typeof config.debounceSeconds === 'number' ? config.debounceSeconds : 30;
  const feedback = el('p', { class: 'hz-row__hint' });

  const commit = async (patch) => {
    try {
      await onSave(patch);
      feedback.textContent = STRINGS.notificationsSaved;
    } catch (error) {
      feedback.textContent = `${STRINGS.notificationsSaveFailed}：${error.message || A.unknown}`;
    }
  };

  const debounceInput = numberInput(debounce, {
    min: 0, max: 3600, step: 1,
    onInput: () => {},
  });
  debounceInput.addEventListener('change', () => {
    const n = Number(debounceInput.value);
    if (!Number.isSafeInteger(n) || n < 0 || n > 3600) { feedback.textContent = STRINGS.debounceInvalid; return; }
    if (n !== debounce) commit({ debounceSeconds: n });
  });

  /* ---- 渠道编辑对话框 ---- */
  const openChannelDialog = (existing, index) => {
    const draft = existing
      ? JSON.parse(JSON.stringify(existing))
      : { id: '', name: '', type: 'webhook', url: '', enabled: true };
    const message = el('p', { class: 'hz-row__hint' });
    const fieldsBox = el('div', { class: 'hz-dialog__content' });

    const idInput = textInput(draft.id, { onInput: (value) => { draft.id = value; } });
    const nameInput = textInput(draft.name, { onInput: (value) => { draft.name = value; } });
    const typeSelect = selectControl(draft.type || 'webhook', [
      { value: 'webhook', label: STRINGS.channelTypeWebhook },
      { value: 'email', label: STRINGS.channelTypeEmail },
    ], (value) => { draft.type = value; drawFields(); });
    const enabledState = { value: draft.enabled !== false };
    const enabledToggle = Toggle({
      checked: enabledState.value,
      label: STRINGS.channelEnabled,
      onChange: (next) => { enabledState.value = next; },
    });

    const drawFields = () => {
      while (fieldsBox.firstChild) fieldsBox.removeChild(fieldsBox.firstChild);
      if ((draft.type || 'webhook') === 'email') {
        fieldsBox.appendChild(formField(STRINGS.channelSmtpHost, textInput(draft.smtpHost || '', { onInput: (v) => { draft.smtpHost = v; } })));
        fieldsBox.appendChild(formField(STRINGS.channelSmtpPort, numberInput(draft.smtpPort === undefined ? 465 : draft.smtpPort, { min: 1, max: 65535, onInput: (v) => { draft.smtpPort = Number(v); } })));
        fieldsBox.appendChild(formField(STRINGS.channelSmtpSecure, Toggle({ checked: draft.smtpSecure !== false, label: STRINGS.channelSmtpSecure, onChange: (v) => { draft.smtpSecure = v; } })));
        fieldsBox.appendChild(formField(STRINGS.channelSmtpUser, textInput(draft.smtpUser || '', { onInput: (v) => { draft.smtpUser = v; } })));
        fieldsBox.appendChild(formField(STRINGS.channelSmtpPass, textInput('', { type: 'password', onInput: (v) => { draft.smtpPass = v; } })));
        fieldsBox.appendChild(formField(STRINGS.channelFrom, textInput(draft.from || '', { onInput: (v) => { draft.from = v; } })));
        fieldsBox.appendChild(formField(STRINGS.channelTo, textInput(draft.to || '', { onInput: (v) => { draft.to = v; } })));
        fieldsBox.appendChild(formField(STRINGS.channelSubject, textInput(draft.subjectTemplate || '账号{event}：{nickname} ({uin})', { onInput: (v) => { draft.subjectTemplate = v; } })));
        fieldsBox.appendChild(formField(STRINGS.channelBody, textArea(draft.bodyTemplate || '', { rows: 4, onInput: (v) => { draft.bodyTemplate = v; } }), STRINGS.templateVars));
      } else {
        fieldsBox.appendChild(formField(STRINGS.channelUrl, textInput(draft.url || '', { onInput: (v) => { draft.url = v; } })));
        fieldsBox.appendChild(formField(STRINGS.channelBody, textArea(draft.bodyTemplate || '', { rows: 4, onInput: (v) => { draft.bodyTemplate = v; } }), STRINGS.templateVars));
      }
      fieldsBox.appendChild(formField(STRINGS.channelEnabled, enabledToggle));
    };
    drawFields();

    openDialog({
      title: existing ? STRINGS.channelEdit : STRINGS.channelCreate,
      hint: STRINGS.notificationsHint,
      content: [
        formField(STRINGS.channelId, idInput),
        formField(STRINGS.channelName, nameInput),
        formField(STRINGS.channelType, typeSelect),
        fieldsBox,
        message,
      ],
      confirmLabel: existing ? STRINGS.save : STRINGS.add,
      onConfirm: async (close) => {
        draft.id = String(idInput.value || '').trim();
        draft.name = String(nameInput.value || '').trim() || draft.id;
        draft.enabled = enabledState.value;
        if (!/^[\w.-]+$/.test(draft.id) || draft.id.length > 64) { message.textContent = STRINGS.channelIdInvalid; return; }
        const duplicate = channels.some((channel, i) => channel.id === draft.id && i !== index);
        if (duplicate) { message.textContent = STRINGS.channelIdDuplicate; return; }
        if ((draft.type || 'webhook') === 'webhook') {
          if (!draft.url) { message.textContent = STRINGS.channelUrlRequired; return; }
          if (!isHttpUrl(draft.url)) { message.textContent = STRINGS.channelUrlInvalid; return; }
        } else if (!draft.smtpHost || !draft.from || !draft.to) {
          message.textContent = STRINGS.channelSmtpRequired;
          return;
        }
        const next = channels.slice();
        if (typeof index === 'number') next[index] = draft; else next.push(draft);
        try {
          await onSave({ channels: next });
          close();
        } catch (error) {
          message.textContent = `${STRINGS.notificationsSaveFailed}：${error.message || A.unknown}`;
        }
      },
    });
  };

  /* ---- 渠道列表 ---- */
  const listBox = el('div', { class: 'hz-channel-list' });
  if (channels.length === 0) {
    listBox.appendChild(EmptyState({ title: STRINGS.channelEmpty, icon: Icon('bell', { size: 28 }) }));
  } else {
    channels.forEach((channel, index) => {
      const summary = channel.type === 'email'
        ? `${dash(channel.smtpHost)} → ${dash(channel.to)}`
        : dash(channel.url);
      listBox.appendChild(fieldRow(
        `${dash(channel.name || channel.id)} · ${channel.type === 'email' ? STRINGS.channelTypeEmail : STRINGS.channelTypeWebhook}`,
        [
          Badge({ text: channel.enabled === false ? A.toggleOff : A.toggleOn, tone: channel.enabled === false ? 'idle' : 'ok' }),
          Button({
            label: STRINGS.channelTest,
            variant: 'outline',
            onClick: async (event) => {
              const button = event.currentTarget;
              button.disabled = true;
              feedback.textContent = STRINGS.channelTesting;
              try {
                const result = await onTest(channel.id);
                feedback.textContent = result && result.success
                  ? STRINGS.channelTestOk
                  : `${STRINGS.channelTestFail}：${(result && result.message) || A.unknown}`;
              } catch (error) {
                feedback.textContent = `${STRINGS.channelTestFail}：${error.message || A.unknown}`;
              } finally {
                button.disabled = false;
              }
            },
          }),
          Button({ label: STRINGS.edit, variant: 'outline', onClick: () => openChannelDialog(channel, index) }),
          Button({
            label: STRINGS.channelDelete,
            variant: 'danger',
            onClick: async () => {
              const next = channels.filter((_, i) => i !== index);
              try {
                await onSave({ channels: next });
                feedback.textContent = STRINGS.notificationsSaved;
              } catch (error) {
                feedback.textContent = `${STRINGS.notificationsSaveFailed}：${error.message || A.unknown}`;
              }
            },
          }),
        ],
        summary,
      ));
    });
  }

  wrap.appendChild(Card({
    title: STRINGS.notificationsTitle,
    hint: STRINGS.notificationsHint,
    children: [
      fieldRow(STRINGS.debounce, debounceInput, STRINGS.debounceHint),
      fieldRow(STRINGS.channels, Button({
        label: STRINGS.channelAdd,
        variant: 'outline',
        icon: Icon('bell'),
        onClick: () => openChannelDialog(null, undefined),
      }), null, 'stack'),
      listBox,
      el('div', { class: 'hz-row' }, [feedback]),
    ],
  }));
  return wrap;
}

/**
 * 服务区块（监听设置 + TLS + 备份恢复）。
 * @param {Object} info     GET /api/system/settings 响应
 * @param {Object} handlers { onSaveSettings, onUploadCert, onDeleteCert, onExport, onImport }
 * @param {Array}  backupNodes 备份卡片节点（由 buildBackupCard 生成）
 */
export function renderSystemSection(info, handlers, backupNodes) {
  const { onSaveSettings, onUploadCert, onDeleteCert } = handlers;
  const wrap = el('div', { class: 'hz-section', 'data-hz-section': 'system' });
  const settings = info.settings || {};
  const envOverrides = Array.isArray(info.envOverrides) ? info.envOverrides : [];
  const feedback = el('p', { class: 'hz-row__hint' });
  const tlsFeedback = el('p', { class: 'hz-row__hint' });

  if (envOverrides.indexOf('webuiPort') >= 0) {
    wrap.appendChild(notice('warning', fmt(STRINGS.envLocked, { fields: 'webuiPort (SNOWLUMA_WEBUI_PORT)' })));
  }

  /* ---- 服务监听 ---- */
  const portInput = numberInput(settings.webuiPort, { min: 1, max: 65535, step: 1 });
  const hostInput = textInput(settings.webuiHost, {});
  const trustProxyInput = textInput(settings.trustProxy, {});
  const tlsState = { value: settings.tlsEnabled === true };
  const tlsToggle = Toggle({
    checked: tlsState.value,
    label: STRINGS.tlsEnable,
    onChange: (next) => { tlsState.value = next; },
  });
  const hostHint = el('p', { class: 'hz-row__hint', text: settings.webuiHost === '0.0.0.0' ? STRINGS.hostAllWarn : STRINGS.webuiHostHint });

  wrap.appendChild(Card({
    title: STRINGS.systemTitle,
    hint: fmt(STRINGS.systemHint, { port: dash(info.listeningPort) }),
    children: [
      fieldRow(STRINGS.webuiPort, portInput),
      fieldRow(STRINGS.webuiHost, [
        hostInput,
        segmented(settings.webuiHost === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1', [
          { value: '127.0.0.1', label: STRINGS.hostLoopback },
          { value: '0.0.0.0', label: STRINGS.hostAll },
        ], (value) => { hostInput.value = value; }, STRINGS.webuiHost),
      ], null, 'stack'),
      fieldRow('', hostHint, null, 'stack'),
      fieldRow(STRINGS.trustProxy, trustProxyInput, STRINGS.trustProxyHint, 'stack'),
      fieldRow(STRINGS.tlsEnable, tlsToggle, info.hasCert ? STRINGS.tlsCertInstalled : STRINGS.tlsCertMissing),
      fieldRow('', Button({
        label: STRINGS.save,
        variant: 'primary',
        onClick: async () => {
          const port = Number(portInput.value);
          if (!Number.isInteger(port) || port < 1 || port > 65535) { feedback.textContent = STRINGS.webuiPortInvalid; return; }
          try {
            const result = await onSaveSettings({
              webuiPort: port,
              webuiHost: String(hostInput.value || '').trim(),
              trustProxy: String(trustProxyInput.value || ''),
              tlsEnabled: tlsState.value,
            });
            feedback.textContent = result && result.restartRequiredToApply
              ? `${STRINGS.serviceSaved} ${STRINGS.serviceRestart}`
              : STRINGS.serviceSaved;
          } catch (error) {
            feedback.textContent = `${STRINGS.serviceSaveFailed}：${error.message || A.unknown}`;
          }
        },
      }), null, 'stack'),
      el('div', { class: 'hz-row' }, [feedback]),
    ],
  }));

  /* ---- TLS 证书 ---- */
  const certArea = textArea('', { rows: 6, placeholder: '-----BEGIN CERTIFICATE-----' });
  const keyArea = textArea('', { rows: 6, placeholder: '-----BEGIN PRIVATE KEY-----' });
  wrap.appendChild(Card({
    title: STRINGS.tlsCertLabel,
    hint: info.hasCert ? STRINGS.tlsCertInstalled : STRINGS.tlsCertMissing,
    children: [
      fieldRow(STRINGS.tlsCertLabel, certArea, null, 'stack'),
      fieldRow(STRINGS.tlsKeyLabel, keyArea, null, 'stack'),
      fieldRow('', [
        Button({
          label: STRINGS.tlsUpload,
          variant: 'primary',
          onClick: async () => {
            if (!certArea.value.trim() || !keyArea.value.trim()) { tlsFeedback.textContent = STRINGS.tlsBothRequired; return; }
            tlsFeedback.textContent = STRINGS.tlsUpdating;
            try {
              await onUploadCert(certArea.value, keyArea.value);
              tlsFeedback.textContent = STRINGS.tlsUpdated;
            } catch (error) {
              tlsFeedback.textContent = `${STRINGS.tlsUpdateFailed}：${error.message || A.unknown}`;
            }
          },
        }),
        Button({
          label: STRINGS.tlsDelete,
          variant: 'danger',
          disabled: settings.tlsEnabled === true,
          onClick: async () => {
            try {
              await onDeleteCert();
              tlsFeedback.textContent = STRINGS.tlsDeleted;
            } catch (error) {
              tlsFeedback.textContent = `${STRINGS.tlsDeleteFailed}：${error.message || A.unknown}`;
            }
          },
        }),
      ], STRINGS.tlsPairHint, 'stack'),
      el('div', { class: 'hz-row' }, [tlsFeedback]),
    ],
  }));

  for (const node of backupNodes || []) wrap.appendChild(node);
  return wrap;
}

/**
 * 备份 / 恢复卡片。
 * @param {Object} handlers { onExport, onImport }
 */
export function buildBackupCard(handlers) {
  const { onExport, onImport } = handlers;
  const feedback = el('p', { class: 'hz-row__hint' });
  const includeState = { value: false };
  const restoreState = { value: false };
  const fileInput = el('input', { type: 'file', accept: 'application/json' });
  fileInput.style.display = 'none';

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    feedback.textContent = STRINGS.backupImporting;
    try {
      const text = await file.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        feedback.textContent = STRINGS.backupInvalidJson;
        return;
      }
      const result = await onImport(parsed, restoreState.value);
      const parts = [];
      if (result && Array.isArray(result.restored)) parts.push(fmt(STRINGS.backupRestoredCount, { n: result.restored.length }));
      if (result && Array.isArray(result.skipped) && result.skipped.length) parts.push(fmt(STRINGS.backupSkippedCount, { n: result.skipped.length }));
      if (result && Array.isArray(result.migrated) && result.migrated.length) parts.push(fmt(STRINGS.backupMigratedCount, { n: result.migrated.length }));
      feedback.textContent = parts.length ? parts.join('；') : STRINGS.backupNothing;
    } catch (error) {
      feedback.textContent = `${STRINGS.backupImportFailed}：${error.message || A.unknown}`;
    } finally {
      fileInput.value = '';
    }
  });

  return Card({
    title: STRINGS.backupTitle,
    hint: STRINGS.backupHint,
    children: [
      fieldRow(STRINGS.backupIncludeCreds,
        Toggle({ checked: includeState.value, label: STRINGS.backupIncludeCreds, onChange: (next) => { includeState.value = next; } }),
        STRINGS.backupIncludeCredsWarn),
      fieldRow('', Button({
        label: STRINGS.backupExport,
        variant: 'outline',
        onClick: async () => {
          feedback.textContent = STRINGS.backupExporting;
          try {
            const bundle = await onExport(includeState.value);
            const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const anchor = el('a', {
              href: url,
              download: fmt(STRINGS.backupFileName, { ts: new Date().toISOString().replace(/[:.]/g, '-') }),
            });
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
            URL.revokeObjectURL(url);
            feedback.textContent = STRINGS.backupExported;
          } catch (error) {
            feedback.textContent = `${STRINGS.backupExportFailed}：${error.message || A.unknown}`;
          }
        },
      }), null, 'stack'),
      fieldRow(STRINGS.backupRestoreCreds,
        Toggle({ checked: restoreState.value, label: STRINGS.backupRestoreCreds, onChange: (next) => { restoreState.value = next; } }),
        STRINGS.backupRestoreCredsWarn),
      fieldRow(STRINGS.backupImport, [
        Button({
          label: STRINGS.backupImport,
          variant: 'danger',
          onClick: () => openDialog({
            title: STRINGS.backupConfirmTitle,
            hint: STRINGS.backupImportHint,
            confirmLabel: STRINGS.confirmRestore,
            destructive: true,
            onConfirm: () => fileInput.click(),
          }),
        }),
        fileInput,
      ], null, 'stack'),
      el('div', { class: 'hz-row' }, [feedback]),
    ],
  });
}

/**
 * 关于区块（更新状态 + 更新来源 + 运行时信息）。
 * @param {Object} updateSnapshot  updateInfo Resource 快照
 * @param {Object} sourcesSnapshot updateSources Resource 快照
 * @param {Object} systemSnapshot  systemInfo Resource 快照
 * @param {Object} handlers        { onCheckUpdate, onDownload, onRestart,
 *                                   onSaveSources, onTestSources, onReloadSources,
 *                                   onReloadSystem }
 */
export function renderAboutSection(updateSnapshot, sourcesSnapshot, systemSnapshot, handlers) {
  const {
    onCheckUpdate, onDownload, onRestart,
    onSaveSources, onTestSources, onReloadSources, onReloadSystem,
  } = handlers;
  const wrap = el('div', { class: 'hz-section', 'data-hz-section': 'about' });

  /* ---- 更新状态 ---- */
  wrap.appendChild(Card({
    title: STRINGS.updateTitle,
    hint: STRINGS.updateOriginHint,
    children: [stateView({
      resource: { get: () => updateSnapshot },
      isEmpty: (data) => !data,
      emptyTitle: STRINGS.updateNoResult,
      loadingLabel: STRINGS.updateChecking,
      onRetry: onCheckUpdate,
      render: (data) => {
        const nodes = [];
        const disabled = data.error === 'disabled';
        const tone = disabled ? 'idle' : (data.hasUpdate ? 'warn' : 'ok');
        const text = disabled
          ? STRINGS.updateDisabled
          : data.hasUpdate
            ? fmt(STRINGS.updateAvailable, { version: dash(data.latest) })
            : STRINGS.updateUpToDate;
        nodes.push(fieldRow(fmt(STRINGS.updateCurrent, { version: dash(data.current) }), Badge({ text, tone })));

        if (data.error && !disabled) {
          nodes.push(notice('warning', `${STRINGS.updateFailed}：${data.error}`));
        }
        if (data.notes) {
          nodes.push(fieldRow(STRINGS.updateNotes, el('div', { class: 'hz-mono', text: String(data.notes) }), null, 'stack'));
        }
        const actions = [Button({ label: STRINGS.updateCheck, variant: 'outline', onClick: onCheckUpdate })];
        if (data.hasUpdate && data.latest) {
          actions.push(Button({
            label: STRINGS.updateDownload,
            variant: 'primary',
            onClick: async () => {
              try {
                await onDownload(data.latest);
                nodes.push(notice('success', STRINGS.updateReady));
              } catch (error) {
                nodes.push(notice('error', `${STRINGS.updateDownloadFailed}：${error.message || A.unknown}`));
              }
            },
          }));
          actions.push(Button({
            label: STRINGS.updateRestart,
            variant: 'danger',
            onClick: async () => {
              try {
                await onRestart();
              } catch (error) {
                /* 重启会让连接断开，失败也不阻塞 UI */
                console.error('[settings-plugin] restart failed:', error);
              }
            },
          }));
        }
        nodes.push(fieldRow('', actions, null, 'stack'));
        return nodes;
      },
    })],
  }));

  /* ---- 更新来源 ---- */
  wrap.appendChild(Card({
    title: STRINGS.updateSources,
    hint: STRINGS.updateSourcesHint,
    children: [stateView({
      resource: { get: () => sourcesSnapshot },
      isEmpty: (data) => !data,
      emptyTitle: A.emptyTitle,
      loadingLabel: STRINGS.loading,
      onRetry: onReloadSources,
      render: (data) => {
        const feedback = el('p', { class: 'hz-row__hint' });
        const model = {
          mode: data.mode || 'auto',
          mirror: data.mirror || '',
          mirrors: Array.isArray(data.mirrors) ? data.mirrors.slice() : [],
        };
        const mirrorInput = textInput(model.mirror, { placeholder: 'https://ghfast.top', onInput: (value) => { model.mirror = value.trim(); } });
        const mirrorsArea = textArea(model.mirrors.join('\n'), {
          rows: 6,
          onInput: (value) => { model.mirrors = value.split('\n').map((line) => line.trim()).filter(Boolean); },
        });
        return [
          fieldRow(STRINGS.updateSourceMode, selectControl(model.mode, [
            { value: 'auto', label: STRINGS.sourceAuto },
            { value: 'github', label: STRINGS.sourceGithub },
            { value: 'mirror', label: STRINGS.sourceMirror },
          ], (value) => { model.mode = value; }, STRINGS.updateSourceMode)),
          fieldRow(STRINGS.sourceMirrorUrl, mirrorInput, STRINGS.sourceInvalid),
          fieldRow(STRINGS.sourceMirrors, mirrorsArea, STRINGS.sourceMirrorsHint, 'stack'),
          fieldRow('', [
            Button({
              label: STRINGS.sourceSave,
              variant: 'primary',
              onClick: async () => {
                if (model.mode === 'mirror' && model.mirror && !isHttpUrl(model.mirror)) { feedback.textContent = STRINGS.sourceInvalid; return; }
                try {
                  await onSaveSources(model);
                  feedback.textContent = STRINGS.sourceSaved;
                } catch (error) {
                  feedback.textContent = `${STRINGS.sourceSaveFailed}：${error.message || A.unknown}`;
                }
              },
            }),
            Button({
              label: STRINGS.sourceTest,
              variant: 'outline',
              onClick: async () => {
                feedback.textContent = STRINGS.sourceTesting;
                try {
                  const results = await onTestSources(model);
                  const list = el('ul', { class: 'hz-sources-result' });
                  for (const item of (results || [])) {
                    list.appendChild(el('li', {
                      class: 'hz-mono',
                      text: `${dash(item.url || item.mirror)} → ${item.ok ? fmt(STRINGS.sourceAvailable, { ms: dash(item.latencyMs) }) : STRINGS.sourceUnavailable}`,
                    }));
                  }
                  feedback.textContent = STRINGS.sourceTestDone;
                  feedback.parentNode.appendChild(list);
                } catch (error) {
                  feedback.textContent = `${STRINGS.sourceTestFailed}：${error.message || A.unknown}`;
                }
              },
            }),
          ], null, 'stack'),
          el('div', { class: 'hz-row' }, [feedback]),
        ];
      },
    })],
  }));

  /* ---- 运行时信息 ---- */
  wrap.appendChild(Card({
    title: STRINGS.runtimeTitle,
    children: [stateView({
      resource: { get: () => systemSnapshot },
      isEmpty: (data) => !data,
      emptyTitle: A.emptyTitle,
      loadingLabel: STRINGS.loading,
      onRetry: onReloadSystem,
      render: (data) => [
        KeyValueList([
          { label: STRINGS.runtimeHostname, value: dash(data.hostname) },
          { label: STRINGS.runtimePlatform, value: `${dash(data.distro || data.platform)} · ${dash(data.archLabel || data.arch)}` },
          { label: STRINGS.runtimeNode, value: dash(data.nodeVersion) },
          { label: STRINGS.runtimeUptime, value: formatDuration(data.uptime) },
          { label: STRINGS.runtimeProcessUptime, value: formatDuration(data.processUptime) },
          { label: STRINGS.runtimeCpu, value: data.cpu ? dash(data.cpu.model) : A.empty },
          { label: STRINGS.runtimeCores, value: data.cpu ? dash(data.cpu.cores) : A.empty },
          { label: STRINGS.runtimeLoad, value: data.cpu && Array.isArray(data.cpu.loadAvg) ? data.cpu.loadAvg.map((n) => Number(n).toFixed(2)).join(' / ') : A.empty },
          {
            label: STRINGS.runtimeMemory,
            value: data.memory
              ? `${formatBytes(data.memory.used)} / ${formatBytes(data.memory.total)}（${Number(data.memory.usagePercent || 0).toFixed(1)}%）`
              : A.empty,
          },
        ]),
      ],
    })],
  }));
  return wrap;
}

/* ========================================================================== *
 * 插件本体
 * ========================================================================== */

/**
 * 宿主元素 → Resource 集合。用 WeakMap 而非插件对象属性，因为
 * definePlugin() 返回的对象被 Object.freeze，无法在其上挂自定义方法。
 * @type {WeakMap<HTMLElement, Object>}
 */
const resourcesByHost = new WeakMap();

/**
 * 创建设置页插件。
 *
 * @param {Object} [options]
 * @param {Object} [options.resources]  覆盖默认 Resource 集合（测试注入用）
 * @param {string} [options.initialTab] 初始分区 key
 * @returns {Object} definePlugin 归一化后的插件
 */
export function createSettingsPlugin(options = {}) {
  /** 每次挂载的运行时状态（卸载时清空，避免跨挂载泄漏） */
  let runtime = null;

  const tabs = SETTINGS_NAV.flatMap((group) => group.tabs);

  /** 重新加载当前分区的数据。 */
  const reloadCurrent = () => {
    if (!runtime) return;
    const resource = runtime.resources[runtime.tabResource];
    if (resource) resource.load({ silent: true });
  };

  /** 整块重绘当前分区。 */
  const draw = () => {
    if (!runtime) return;
    const { host, ctx, resources, tab, languageSlot } = runtime;
    while (host.firstChild) host.removeChild(host.firstChild);

    const heading = tab.label;
    const titleNode = el('h2', { class: 'hz-settings__heading', text: heading });
    const panel = el('div', { class: 'hz-settings__panel', 'data-hz-panel': tab.key });

    /* 每个分区用自己的 Resource 快照驱动四态 */
    const snapshotOf = (key) => {
      const resource = resources[key];
      return resource ? resource.get() : { status: 'idle', data: null, error: null };
    };

    let sectionNode;
    try {
      switch (tab.key) {
        case 'appearance': {
          const snap = snapshotOf('uiConfig');
          sectionNode = stateView({
            resource: { get: () => snap },
            isEmpty: (data) => !data,
            loadingLabel: STRINGS.loading,
            onRetry: () => resources.uiConfig.load(),
            render: (data) => [renderAppearanceSection(
              normalizeAppearance(data.appearance),
              {
                patch: (partial) => queueAppearancePatch(partial),
                uploadBackground: async (file) => {
                  const form = new FormData();
                  form.append('file', file);
                  await request('/api/ui/background', { method: 'POST', body: form });
                  await resources.uiConfig.load({ silent: true });
                },
                removeBackground: async () => {
                  await request('/api/ui/background', { method: 'DELETE' });
                  await resources.uiConfig.load({ silent: true });
                },
              },
              languageSlot,
            )],
          });
          break;
        }
        case 'data': {
          const snap = snapshotOf('uiConfig');
          sectionNode = stateView({
            resource: { get: () => snap },
            isEmpty: (data) => !data,
            loadingLabel: STRINGS.loading,
            onRetry: () => resources.uiConfig.load(),
            render: (data) => [renderDataSection(
              normalizeAppearance(data.appearance),
              data.pages,
              {
                patchAppearance: (partial) => queueAppearancePatch(partial),
                patchPages: (partial) => queuePagesPatch(partial),
              },
            )],
          });
          break;
        }
        case 'account': {
          sectionNode = renderAccountSection(snapshotOf('totp'), {
            onCheckStrength: (password) => request('/api/auth/check-strength', { method: 'POST', body: { password } }),
            onChangePassword: (oldPassword, newPassword) =>
              request('/api/auth/change-password', { method: 'POST', body: { oldPassword, newPassword } })
                .catch((error) => ({ success: false, message: error.message })),
            onTotpEnable: () => openTotpEnableDialog(resources),
            onTotpDisable: () => openTotpDisableDialog(resources),
            onReloadTotp: () => resources.totp.load(),
          });
          break;
        }
        case 'globalConfig': {
          const snap = snapshotOf('globalConfig');
          sectionNode = stateView({
            resource: { get: () => snap },
            isEmpty: (data) => !data,
            loadingLabel: STRINGS.loading,
            onRetry: () => resources.globalConfig.load(),
            render: (data) => [renderGlobalConfigSection(data, {
              onSave: async (patch) => {
                await request('/api/global-config', { method: 'POST', body: patch });
                await resources.globalConfig.load({ silent: true });
              },
            })],
          });
          break;
        }
        case 'storage': {
          const snap = snapshotOf('storage');
          sectionNode = stateView({
            resource: { get: () => snap },
            isEmpty: (data) => !data || !data.snapshot,
            emptyTitle: STRINGS.cleanupNoAccounts,
            loadingLabel: STRINGS.loading,
            onRetry: () => resources.storage.load(),
            render: (data) => [renderStorageSection(data, {
              onSaveSettings: async (patch) => {
                await request('/api/system/storage/settings', { method: 'POST', body: patch });
                await resources.storage.load({ silent: true });
              },
              onCleanup: async (body) => {
                const result = await request('/api/system/storage/cleanup', { method: 'POST', body });
                await resources.storage.load({ silent: true });
                return result;
              },
              onReload: () => resources.storage.load(),
            })],
          });
          break;
        }
        case 'notifications': {
          const snap = snapshotOf('notifications');
          sectionNode = stateView({
            resource: { get: () => snap },
            isEmpty: (data) => !data,
            loadingLabel: STRINGS.loading,
            onRetry: () => resources.notifications.load(),
            render: (data) => [renderNotificationsSection(data, {
              onSave: async (patch) => {
                await request('/api/notifications/config', { method: 'POST', body: patch });
                await resources.notifications.load({ silent: true });
              },
              onTest: (channelId) => request('/api/notifications/test', { method: 'POST', body: { channelId } })
                .catch((error) => ({ success: false, message: error.message })),
            })],
          });
          break;
        }
        case 'system': {
          const snap = snapshotOf('systemSettings');
          sectionNode = stateView({
            resource: { get: () => snap },
            isEmpty: (data) => !data || !data.settings,
            emptyTitle: STRINGS.serviceLoadFailed,
            loadingLabel: STRINGS.loading,
            onRetry: () => resources.systemSettings.load(),
            render: (data) => [renderSystemSection(data, {
              onSaveSettings: async (patch) => {
                const result = await request('/api/system/settings', { method: 'POST', body: patch });
                await resources.systemSettings.load({ silent: true });
                return result;
              },
              onUploadCert: async (cert, key) => request('/api/system/tls/cert', { method: 'POST', body: { cert, key } }),
              onDeleteCert: async () => {
                await request('/api/system/tls/cert', { method: 'DELETE' });
                await resources.systemSettings.load({ silent: true });
              },
            }, [buildBackupCard({
              onExport: (includeCredentials) => request(`/api/system/backup/export${includeCredentials ? '?credentials=1' : ''}`),
              onImport: (backup, restoreCredentials) =>
                request('/api/system/backup/import', { method: 'POST', body: { backup, restoreCredentials: restoreCredentials === true } }),
            })])],
          });
          break;
        }
        case 'about': {
          sectionNode = renderAboutSection(
            snapshotOf('updateInfo'),
            snapshotOf('updateSources'),
            snapshotOf('systemInfo'),
            {
              onCheckUpdate: () => resources.updateInfo.load(),
              onDownload: (version) => request('/api/update/download', { method: 'POST', body: { version } }),
              onRestart: () => request('/api/update/restart', { method: 'POST' }),
              onSaveSources: async (model) => {
                await request('/api/update/sources', { method: 'POST', body: model });
                await resources.updateSources.load({ silent: true });
              },
              onTestSources: (model) => request('/api/update/sources/test', { method: 'POST', body: model }).then((r) => r.results),
              onReloadSources: () => resources.updateSources.load(),
              onReloadSystem: () => resources.systemInfo.load(),
            },
          );
          break;
        }
        default:
          sectionNode = EmptyState({ title: A.emptyTitle });
      }
    } catch (error) {
      sectionNode = ErrorState({
        message: error instanceof Error ? error.message : String(error),
        retry: () => draw(),
      });
      console.error(`[settings-plugin] render "${tab.key}" failed:`, error);
    }

    panel.appendChild(sectionNode);

    /* 导航 */
    const nav = el('nav', { class: 'hz-settings__nav', 'aria-label': STRINGS.navLabel });
    SETTINGS_NAV.forEach((group, groupIndex) => {
      const groupBox = el('div', { class: 'hz-settings__nav-group', role: 'group', 'aria-labelledby': `hz-settings-nav-${groupIndex}` });
      groupBox.appendChild(el('p', { id: `hz-settings-nav-${groupIndex}`, class: 'hz-settings__nav-title', text: group.title }));
      for (const item of group.tabs) {
        const active = item.key === tab.key;
        groupBox.appendChild(el('button', {
          type: 'button',
          class: `hz-settings__nav-item${active ? ' is-active' : ''}`,
          'data-hz-tab': item.key,
          'aria-current': active ? 'page' : null,
          onClick: () => selectTab(item.key),
        }, [
          item.icon ? Icon(item.icon, { size: 16 }) : null,
          el('span', { text: item.label }),
        ]));
      }
      nav.appendChild(groupBox);
    });

    const body = el('div', { class: 'hz-settings__body' }, [titleNode, panel]);
    const layout = el('div', { class: 'hz-settings__layout' }, [nav, body]);
    const root = el('div', { class: 'hz-settings', 'data-hz-plugin': 'settings' }, [layout]);
    host.appendChild(root);
    runtime.root = root;

    void ctx;
  };

  /** 切换分区。 */
  /**
   * 分区 → 该分区渲染所依赖的全部 Resource 名。
   * 「关于」分区同时依赖 3 个数据源（更新信息 / 更新来源 / 系统信息），
   * 因此这里用数组而不是单个 key —— 否则切到关于页会缺数据、卡片空白。
   */
  const TAB_RESOURCES = {
    appearance: ['uiConfig'],
    data: ['uiConfig'],
    account: ['totp'],
    globalConfig: ['globalConfig'],
    storage: ['storage'],
    notifications: ['notifications'],
    system: ['systemSettings'],
    about: ['updateInfo', 'updateSources', 'systemInfo'],
  };

  /** 当前分区关心的全部 Resource。 */
  const resourcesForTab = (runtimeState, key) =>
    (TAB_RESOURCES[key] || [])
      .map((name) => runtimeState.resources[name])
      .filter(Boolean);

  /** 切换分区。 */
  const selectTab = (key) => {
    if (!runtime) return;
    const tab = tabs.find((item) => item.key === key);
    if (!tab) return;
    runtime.tab = tab;
    draw();
    /* 进入分区时确保依赖数据都已加载（idle 才发起，避免每次切换都打服务端） */
    for (const resource of resourcesForTab(runtime, key)) {
      if (resource.get().status === 'idle') resource.load();
    }
  };

  /** 外观改动合并 + 去抖保存（服务端按区块合并，只需提交 appearance）。 */
  const queueAppearancePatch = (partial) => {
    if (!runtime) return;
    const uiResource = runtime.resources.uiConfig;
    const snapshot = uiResource.get();
    const current = normalizeAppearance(snapshot.data && snapshot.data.appearance);
    if (partial.background) {
      current.background = { ...current.background, ...partial.background };
      delete partial.background;
    }
    const next = { ...current, ...partial };
    runtime.pendingAppearance = next;
    uiResource.data = { ...(snapshot.data || {}), appearance: next };
    uiResource.notify();

    if (runtime.appearanceTimer) clearTimeout(runtime.appearanceTimer);
    runtime.appearanceTimer = setTimeout(async () => {
      runtime.appearanceTimer = null;
      try {
        await saveAppearance(runtime.pendingAppearance);
        await uiResource.load({ silent: true });
      } catch (error) {
        runtime.saveError = error;
        await uiResource.load({ silent: true });
        console.error('[settings-plugin] save appearance failed:', error);
      }
    }, 350);
  };

  /** pages 改动（登录后落地页）。 */
  const queuePagesPatch = (partial) => {
    if (!runtime) return;
    const uiResource = runtime.resources.uiConfig;
    const snapshot = uiResource.get();
    const nextPages = { ...((snapshot.data && snapshot.data.pages) || {}), ...partial };
    uiResource.data = { ...(snapshot.data || {}), pages: nextPages };
    uiResource.notify();
    if (runtime.pagesTimer) clearTimeout(runtime.pagesTimer);
    runtime.pagesTimer = setTimeout(async () => {
      runtime.pagesTimer = null;
      try {
        await savePages(nextPages);
        await uiResource.load({ silent: true });
      } catch (error) {
        console.error('[settings-plugin] save pages failed:', error);
      }
    }, 350);
  };

  return definePlugin({
    id: 'settings',
    title: STRINGS.pluginTitle,
    icon: 'sliders',
    order: 10,
    description: '设置页（外观 / 数据 / 账号安全 / 全局配置 / 存储 / 通知 / 服务 / 关于）',

    mount(host, ctx) {
      ensureSettingsStyles();
      const resources = options.resources || createSettingsResources();

      /* 语言挂载点：**只创建一次**，跨分区切换复用同一节点。
         外部模块往里插入的选择器不会被重绘清掉（重绘只移动节点、不清空子节点）。 */
      const languageSlot = el('div', {
        class: 'hz-row hz-row--stack hz-slot',
        [LANGUAGE_SLOT_ATTR]: LANGUAGE_SLOT_VALUE,
        id: 'hz-language-slot',
      }, [
        el('span', { class: 'hz-slot__label', text: STRINGS.languageSlotLabel }),
        el('p', { class: 'hz-row__hint', text: STRINGS.languageSlotHint }),
      ]);

      runtime = {
        host,
        ctx,
        resources,
        languageSlot,
        tab: tabs.find((item) => item.key === (options.initialTab || 'appearance')) || tabs[0],
        unsubscribers: [],
        appearanceTimer: null,
        pagesTimer: null,
        pendingAppearance: null,
        saveError: null,
        root: null,
      };

      /* 外部按宿主元素取回 Resource 的通道（见 getSettingsResources） */
      resourcesByHost.set(host, resources);

      /* 订阅全部 Resource：任何数据变化都重绘当前分区（服务端状态驱动）。
         只对「当前分区关心」的资源重绘，避免无关刷新造成闪烁。 */
      for (const resource of Object.values(resources)) {
        runtime.unsubscribers.push(resource.subscribe(() => {
          if (!runtime) return;
          if (!resourcesForTab(runtime, runtime.tab.key).includes(resource)) return;
          draw();
        }));
      }

      /* 首次加载当前分区依赖的全部数据。 */
      for (const resource of resourcesForTab(runtime, runtime.tab.key)) resource.load();

      draw();
    },

    unmount() {
      if (!runtime) return;
      for (const unsubscribe of runtime.unsubscribers) {
        try {
          unsubscribe();
        } catch (error) {
          console.error('[settings-plugin] unsubscribe failed:', error);
        }
      }
      if (runtime.appearanceTimer) clearTimeout(runtime.appearanceTimer);
      if (runtime.pagesTimer) clearTimeout(runtime.pagesTimer);
      for (const resource of Object.values(runtime.resources)) resource.abort();
      if (runtime.languageSlot && runtime.languageSlot.parentNode) {
        runtime.languageSlot.parentNode.removeChild(runtime.languageSlot);
      }
      if (runtime.host) {
        resourcesByHost.delete(runtime.host);
        while (runtime.host.firstChild) runtime.host.removeChild(runtime.host.firstChild);
      }
      runtime = null;
    },

    /** 主动刷新：重载当前分区依赖的全部 Resource。 */
    refresh() {
      if (!runtime) return;
      for (const resource of resourcesForTab(runtime, runtime.tab.key)) {
        resource.load({ silent: true });
      }
    },

    /** 声明数据源，便于内核统一刷新 / 统计错误。 */
    resources() {
      return runtime ? Object.values(runtime.resources) : [];
    },
  });
}

/**
 * 按宿主元素取回本插件使用的 Resource 集合。
 *
 * 存在的理由：`definePlugin()` 会把插件对象归一化并 **冻结**，未知字段会被丢弃，
 * 因此不能在插件对象上挂自定义方法。这里用 WeakMap 做外部访问通道，
 * 供语言模块等协作者复用同一批 Resource（避免重复请求），宿主元素回收即自动释放。
 *
 * @param {HTMLElement} host 传给 mount() 的宿主元素
 * @returns {Object|null} { uiConfig, systemSettings, ... } 或 null（未挂载/已卸载）
 */
export function getSettingsResources(host) {
  if (!host) return null;
  return resourcesByHost.get(host) || null;
}

/* ========================================================================== *
 * 2FA 对话框（与分区渲染分开，保持渲染函数纯粹）
 * ========================================================================== */

/** 开启 2FA：begin → 展示密钥/otpauth → confirm → 展示恢复码。 */
export function openTotpEnableDialog(resources) {
  const qrBox = el('div', { class: 'hz-mono', text: STRINGS.loading });
  const secretBox = el('p', { class: 'hz-mono' });
  const passwordInput = textInput('', { type: 'password' });
  const codeInput = textInput('', { inputmode: 'numeric' });
  const message = el('p', { class: 'hz-row__hint' });
  let otpauthUrl = '';

  const dialog = openDialog({
    title: STRINGS.totpEnableTitle,
    hint: STRINGS.totpEnableHint,
    content: [
      qrBox,
      formField(STRINGS.totpSecret, secretBox),
      formField(STRINGS.totpOtpauth, el('p', { class: 'hz-mono', text: '' })),
      formField(STRINGS.oldPassword, passwordInput),
      formField(STRINGS.totpCode, codeInput),
      message,
    ],
    confirmLabel: STRINGS.totpConfirm,
    onConfirm: async (close) => {
      try {
        const result = await request('/api/auth/totp/confirm', {
          method: 'POST',
          body: { password: passwordInput.value, code: codeInput.value },
        });
        if (!result || result.success !== true) {
          message.textContent = (result && result.message) || STRINGS.totpEnableFailed;
          return;
        }
        close();
        openRecoveryCodesDialog(Array.isArray(result.recoveryCodes) ? result.recoveryCodes : []);
        if (resources && resources.totp) await resources.totp.load({ silent: true });
      } catch (error) {
        message.textContent = `${STRINGS.totpEnableFailed}：${error.message || A.unknown}`;
      }
    },
  });

  request('/api/auth/totp/begin', { method: 'POST', body: {} })
    .then((begin) => {
      if (!begin || begin.success !== true) {
        qrBox.textContent = (begin && begin.message) || STRINGS.totpBeginFailed;
        return;
      }
      otpauthUrl = begin.otpauthUrl || '';
      secretBox.textContent = dash(begin.secret);
      const otpauthNode = dialog.node.querySelectorAll('.hz-mono')[1];
      if (otpauthNode) otpauthNode.textContent = otpauthUrl;
      qrBox.textContent = otpauthUrl || dash(begin.secret);
    })
    .catch((error) => {
      qrBox.textContent = `${STRINGS.totpBeginFailed}：${error.message || A.unknown}`;
    });

  return dialog;
}

/** 关闭 2FA：需要当前密码 + 验证码/恢复码。 */
export function openTotpDisableDialog(resources) {
  const passwordInput = textInput('', { type: 'password' });
  const codeInput = textInput('', { inputmode: 'numeric' });
  const message = el('p', { class: 'hz-row__hint' });

  return openDialog({
    title: STRINGS.totpDisableTitle,
    hint: STRINGS.totpDisableHint,
    destructive: true,
    content: [
      formField(STRINGS.oldPassword, passwordInput),
      formField(STRINGS.totpCodeOrRecovery, codeInput),
      message,
    ],
    confirmLabel: STRINGS.totpDisable,
    onConfirm: async (close) => {
      try {
        const result = await request('/api/auth/totp/disable', {
          method: 'POST',
          body: { password: passwordInput.value, code: codeInput.value, recoveryCode: codeInput.value },
        });
        if (result && result.success) {
          close();
          if (resources && resources.totp) await resources.totp.load({ silent: true });
          return;
        }
        message.textContent = (result && result.message) || STRINGS.totpDisableFailed;
      } catch (error) {
        message.textContent = `${STRINGS.totpDisableFailed}：${error.message || A.unknown}`;
      }
    },
  });
}

/** 恢复码展示（只显示一次，需勾选确认）。 */
export function openRecoveryCodesDialog(codes) {
  const listNode = el('div', { class: 'hz-mono', text: codes.join('\n') });
  const ackState = { value: false };
  const copyFeedback = el('p', { class: 'hz-row__hint' });

  const dialog = openDialog({
    title: STRINGS.recoveryCodes,
    hint: STRINGS.recoveryCodesHint,
    content: [
      notice('warning', STRINGS.recoveryCodesWarning),
      listNode,
      el('div', { class: 'hz-row__control' }, [
        Button({
          label: STRINGS.recoveryCodesCopyAll,
          variant: 'outline',
          onClick: async () => {
            try {
              await navigator.clipboard.writeText(codes.join('\n'));
              copyFeedback.textContent = STRINGS.copied;
            } catch {
              copyFeedback.textContent = STRINGS.copyFailed;
            }
          },
        }),
      ]),
      copyFeedback,
      formField(STRINGS.recoveryCodesAck, Toggle({
        checked: ackState.value,
        label: STRINGS.recoveryCodesAck,
        onChange: (next) => { ackState.value = next; },
      })),
    ],
    confirmLabel: STRINGS.done,
    onConfirm: (close) => {
      if (!ackState.value) return;
      close();
    },
  });
  return dialog;
}

/* ========================================================================== *
 * 注册
 * ========================================================================== */

/** 默认插件实例（列表渲染器用）。 */
export const settingsPlugin = createSettingsPlugin();

/**
 * 注册设置页插件。重复注册（内核已注册过）被容忍，不抛错。
 * @param {Object} [registryApi] { registerPlugin }
 * @returns {Object} 插件
 */
export function registerSettingsPlugins(registryApi) {
  const api = registryApi ?? { registerPlugin };
  try {
    api.registerPlugin(settingsPlugin);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('插件 id 重复')) throw error;
  }
  return settingsPlugin;
}

/**
 * 组装设置页：注册插件并挂载到容器。
 *
 * 用法：
 *   const page = createSettingsPage(container);
 *   page.refresh();   // 手动刷新
 *   page.destroy();   // 卸载（会解绑订阅与定时器）
 *
 * @param {HTMLElement} container
 * @param {Object} [options] { initialTab, resources }
 * @returns {{plugin: Object, host: HTMLElement, ctx: Object, refresh: Function, destroy: Function}}
 */
export function createSettingsPage(container, options = {}) {
  if (!container) throw new TypeError('createSettingsPage(container): container 必填');

  const ctx = {
    root: container,
    resources: options.resources || createSettingsResources(),
    services: {},
    emit() {},
    on() { return () => {}; },
  };

  const plugin = createSettingsPlugin({ resources: ctx.resources, initialTab: options.initialTab });
  const host = el('div', { class: 'hz-settings-host' });
  container.appendChild(host);
  plugin.mount(host, ctx);

  return {
    plugin,
    host,
    ctx,
    refresh: () => plugin.refresh(),
    destroy: () => {
      plugin.unmount();
      if (host.parentNode) host.parentNode.removeChild(host);
    },
  };
}

/* ========================================================================== *
 * 默认导出
 * ========================================================================== */

export default {
  STRINGS,
  // 常量
  MODE_OPTIONS,
  DARK_INTENSITY_OPTIONS,
  ACCENT_SCOPE_OPTIONS,
  SIDEBAR_STYLE_OPTIONS,
  DENSITY_OPTIONS,
  BACKGROUND_TYPE_OPTIONS,
  RADIUS_OPTIONS,
  POLL_INTERVAL_OPTIONS,
  FONT_SANS_OPTIONS,
  FONT_MONO_OPTIONS,
  GRADIENT_PRESETS,
  ACCENT_PRESETS,
  PALETTE_PRESETS,
  LIGHT_PALETTES,
  DEFAULT_APPEARANCE,
  STORAGE_CATEGORIES,
  SETTINGS_NAV,
  LANGUAGE_SLOT_ATTR,
  LANGUAGE_SLOT_VALUE,
  // 纯函数
  fmt,
  normalizeAppearance,
  fieldRow,
  segmented,
  selectControl,
  textInput,
  numberInput,
  textArea,
  formField,
  notice,
  openDialog,
  ensureSettingsStyles,
  // 数据
  createSettingsResources,
  saveAppearance,
  savePages,
  // 分区渲染
  renderAppearanceSection,
  renderDataSection,
  renderAccountSection,
  renderGlobalConfigSection,
  renderStorageSection,
  renderNotificationsSection,
  renderSystemSection,
  renderAboutSection,
  buildBackupCard,
  // 对话框
  openTotpEnableDialog,
  openTotpDisableDialog,
  openRecoveryCodesDialog,
  // 页面
  createSettingsPlugin,
  settingsPlugin,
  registerSettingsPlugins,
  createSettingsPage,
};
