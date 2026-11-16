# Haizakura WebUI 多语言内核 — 安装说明

本文说明如何把 5 个文件注入到 WebUI，让界面支持 **5 种语言**：

| 代码 | 显示名 | 说明 |
| --- | --- | --- |
| `ja` | 日本語 | 标准日语 |
| `zh-pseudo` | 中國語 | 伪中国语：全汉字、无假名，配日语文言语法（〜也 / 〜之 / 〜者 / 〜為） |
| `zh-cn` | 简体中文 | 现有默认语言，也是 chunk 里写死的原文语言 |
| `zh-tw` | 繁體中文 | 繁体中文（台湾用词） |
| `en` | English | 英语 |

---

## 1. 文件清单

全部位于 `/app/runtime/client/assets/`（容器 `snowluma-hz` 内）：

| 文件 | 作用 | 依赖 |
| --- | --- | --- |
| `hz-i18n-boot.js` | **引导入口**。唯一需要在 `index.html` 里引用的文件 | core / dom / settings-language |
| `i18n-core.js` | 语言内核：`LANGS` / `getLang` / `setLang` / `t` / `onLangChange` | messages |
| `i18n-messages.js` | 文案表：1007 条 key × 5 语言 | 无 |
| `i18n-dom.js` | DOM 运行时翻译器：反向索引 + MutationObserver | core / messages |
| `settings-language.js` | 设置页「外观 → 语言」选择器 | core / messages / dom |

依赖关系（全部是相对路径的 ES module import，**不需要额外的 `<script>` 标签**）：

```
index.html
  └─ <script type="module" src="/assets/hz-i18n-boot.js">
       ├─ i18n-core.js ──→ i18n-messages.js
       ├─ i18n-dom.js  ──→ i18n-core.js, i18n-messages.js
       └─ settings-language.js ──→ i18n-core.js, i18n-dom.js
```

---

## 2. 安装步骤

### 2.1 复制文件

把 5 个 `.js` 放进容器的 WebUI 静态资源目录（与其它 chunk 同级）：

```bash
docker cp i18n-core.js        snowluma-hz:/app/runtime/client/assets/
docker cp i18n-messages.js    snowluma-hz:/app/runtime/client/assets/
docker cp i18n-dom.js         snowluma-hz:/app/runtime/client/assets/
docker cp settings-language.js snowluma-hz:/app/runtime/client/assets/
docker cp hz-i18n-boot.js     snowluma-hz:/app/runtime/client/assets/
```

宿主机上如果有绑定的部署目录，直接拷进去也可以。**注意不要覆盖任何已有 chunk**，
这 5 个文件名都是新增的。

### 2.2 修改 `index.html`

在 `</body>` 前插入一行：

```html
    <div id="root"></div>
    <script type="module" src="/assets/hz-i18n-boot.js"></script>
  </body>
</html>
```

建议放在**最后**（`#root` 之后），这样模块脚本执行时页面容器已经存在；
即使放在更早的位置也能工作 —— 引导脚本自己会等 `DOMContentLoaded`。

### 2.3 生效

- **不需要重启容器**，也不需要重启 QQ。刷新浏览器即可。
- 如果 WebUI 有 Service Worker 或强缓存，用 `Ctrl+Shift+R` 强制刷新，
  或在 DevTools → Application → Cache Storage 里清掉。

> ⚠️ `index.html` 与 `assets/` 是编译产物。如果之后重新构建 WebUI，
> 这两处改动会被覆盖，需要重新执行 2.1 / 2.2。

---

## 3. `hz-i18n-boot.js` 的引导逻辑

引导脚本刻意做得**很薄**，只负责时序，不负责具体翻译。执行顺序：

```js
1. applyHtmlLang()
   立刻读 localStorage['haizakura_lang']，把结果写进
   <html lang="…">、<html data-hz-lang="…">、以及
   .hz-lang-ja / .hz-lang-zh 两个排印提示类。
   （此时 DOM 可能还没解析完，所以先不翻译，只登记语言。）

2. 等 DOM ready
   document.readyState === 'loading'
     ? 监听 DOMContentLoaded
     : 立即执行

3. startDomI18n()            ← i18n-dom.js
   全量扫一遍 DOM：文本节点 + placeholder / title / aria-label /
   alt / data-tooltip / input[value]，然后挂上 MutationObserver
   持续处理 React 之后渲染出来的节点。

4. startSettingsLanguage()   ← settings-language.js
   定位设置页「外观」区块，把「语言」小节插到「主题」卡片之后；
   找不到就逐级降级（详见第 5 节）。

5. watchRouteChanges()
   包装 history.pushState / replaceState，并监听 popstate / hashchange，
   路由切换后用 requestAnimationFrame 合并成一次补扫。

6. window.HaizakuraI18n = { LANGS, getLang, setLang, rescan }
   方便在 DevTools 里手动切语言与排查。
```

### 失败隔离

每一步都包在 `try / catch` 里，出错只 `console.warn('[hz-i18n] …')`。
**任何一步失败都不会影响宿主 bundle 的渲染** —— 最坏情况就是界面回到纯中文。

### 幂等

`window.__HZ_I18N_BOOTED__` 保证重复引入只执行一次。

---

## 4. 翻译是怎么工作的（重要）

WebUI 是**编译后的 chunk**，中文原文写死在 bundle 里，无法修改产物。
所以 `i18n-dom.js` 反过来工作：

```
DOM 文本「总览」
   ↓ normalizeKey()（统一空白、去首尾）
   ↓ buildReverseIndex() 建立的 Map：中文原文 → key
key = "nav.overview"
   ↓ MESSAGES[当前语言]["nav.overview"]
DOM 文本改写为「Overview」
```

三个关键机制：

1. **可逆**
   命中的节点会把 `{ key, groups }` 记进 `WeakMap`。切回中文时直接用记下的 key
   重新渲染，**不依赖「译文 → key」的反查**（那样在日语和伪中国语同形时会出错）。

2. **动态模板**
   原文里含 `${...}` 的条目（例如 `` `进程 ${n}` ``）会被编译成正则，
   运行时的真实值（`进程 79`）被捕获后，按目标语言的槽位回填：
   `进程 79` → `Process 79`。

3. **跳过区**
   `script` / `style` / `code` / `pre` / `textarea` / `svg` 内容、`contenteditable`、
   `translate="no"`，以及带 `data-hz-i18n-skip` 的子树**一律不翻译** ——
   日志正文、代码块和语言选择器自身都要保持原样。

### 性能

- MutationObserver 只把脏节点塞进队列，用 `requestAnimationFrame` 在下一帧批量处理；
- 单帧预算 220 个节点，超出部分自动排到下一帧；
- 已翻译的节点打 `data-hz-i18n` 标记，重复扫描时**先读后写**，
  写过的值不会再写一次（避免「写属性 → 触发观察器 → 再写」的自激循环）。

---

## 5. 设置页语言选择器的定位策略

设置页的 DOM 结构（来自编译后的 `settings-page` chunk）：

```
<div class="flex flex-col gap-5">                  ← 外观页根
  <fieldset aria-label="主题、配色与背景">
    <section><h3>主题</h3>
      <div class="divide-y …border-t…">
        <div>配色方案…</div>
        <div>显示模式（跟随系统/浅色/深色）…</div>   ← 语言小节插在「主题」卡片之后
        <div>深色强度…</div>
      </div>
    </section>
    <section><h3>强调色</h3>…</section>
  </fieldset>
  …
</div>
```

定位按可靠性**逐级降级**，并在 `<html data-hz-lang-picker-mode="…">` 上记录实际用的是哪一级：

| 顺序 | 策略值 | 做法 |
| --- | --- | --- |
| 1 | `theme-card` | 找标题为「主题」的 `section`，插到它后面（最贴近「主题选择器之后」的要求） |
| 2 | `appearance-section` | 找标题为「外观」的区块，插到它内部末尾 |
| 3 | `appearance-root` | 插到外观页根容器最前面 |
| 4 | `settings-root` | 插到 `<main>` 或 `[class*="settings"]` 最前面 |
| 5 | `floating` | **兜底**：在页面右上角挂一个浮动语言切换条，保证功能一定可用 |

排查时在控制台执行：

```js
document.documentElement.getAttribute('data-hz-lang-picker-mode')   // 看用了哪一级
document.getElementById('hz-language-picker')                        // 看选择器在不在
```

> 关于第 4 级：刻意**不回退到 `#root` / `document.body`**。
> 那样在任何页面上都能「找到」容器，兜底分支永远走不到，
> 反而会把语言小节插进登录页、日志页这类无关页面。

选择器外观与主题的 `跟随系统 / 浅色 / 深色` 三按钮组保持一致：
圆角药丸容器（`role="radiogroup"`）+ 每个选项一个带 icon 的按钮（`role="radio"`，
`aria-checked` 标记选中），选中项用 `--primary` / `--primary-foreground` 高亮。
点击即刻 `setLang()`，**无需刷新**。

---

## 6. 语言偏好的持久化

- 键名：`localStorage['haizakura_lang']`
- 默认值：`zh-cn`
- 无法识别的值一律回退 `zh-cn`
- 兼容 `zh_CN`、`ZH-CN`、`zh-Hans`、`zh-Hant`、`en-US` 等写法
- `setLang()` 后会在 `window` 上派发事件：

```js
window.addEventListener('haizakura:langchange', (e) => {
  console.log(e.detail.lang, e.detail.previous);
});
```

- **跨标签页同步**：别的标签页改了语言，本页通过 `storage` 事件自动跟随。
- localStorage 不可用时（隐私模式）会额外派发 `haizakura:langpersistfailed`，
  本次会话内仍然生效，只是不会记住。

---

## 7. 验证清单

### 7.1 语法检查

```bash
cd /app/runtime/client/assets
for f in i18n-core.js i18n-messages.js i18n-dom.js settings-language.js hz-i18n-boot.js; do
  node --check "$f" && echo "OK: $f"
done
```

### 7.2 浏览器控制台

```js
// 1. 模块是否加载
window.HaizakuraI18n.LANGS.map(l => l.code)      // ['ja','zh-pseudo','zh-cn','zh-tw','en']

// 2. 切语言应立即生效
HaizakuraI18n.setLang('zh-pseudo')               // 界面变成文言汉字
HaizakuraI18n.setLang('en')                      // 变英文
HaizakuraI18n.setLang('klingon')                 // 回退 zh-cn

// 3. 反向索引的覆盖率
const dom = await import('/assets/i18n-dom.js');
dom.indexStats()                                  // { exact, patterns, ambiguous }
```

### 7.3 逐页人工过一遍

7 个页面都要点一遍，确认没有大片残留中文：
总览 `/`、进程 `/processes`、日志 `/logs`、调试 `/debug`、
配置 `/config`、设置 `/settings`、文档 `/docs`。

日志页的**正文区域**应保持原文（那是数据，不是界面文案）。

---

## 8. 扩展与维护

### 加一条文案

在 `i18n-messages.js` 的 **5 个语言块**里同时加同一个 key。例如给 `zh-cn` 加：

```js
"my.new.key": "新文案",
```

其余四块也要补齐，否则切换语言时会回退到 `zh-cn` 原文。

### 改 `zh-cn` 列要小心

`zh-cn` 一列是 DOM 反向索引的**唯一依据**，与 chunk 里的中文字面量**逐字对应**。
改动其中任何一个字，都会让对应条目的 DOM 替换失效（界面表现为该处不再翻译）。
新增条目不影响 —— 反向索引是启动时构建的。

### 已知的歧义源

有 46 组中文原文对应多个 key（例如「保存」同时是 `common.save` 和
`settings.service.save`）。反向索引取**先出现**的那个 key，因此这几处会显示
第一个 key 的译文。因为文案表里这些同源条目的译文本来就一致，实际观感无差别。
需要排查时：

```js
const dom = await import('/assets/i18n-dom.js');
dom.ambiguousSources();     // [[ '保存', ['common.save','settings.service.save'] ], …]
```

---

## 9. 卸载

1. 从 `index.html` 删掉 `<script type="module" src="/assets/hz-i18n-boot.js"></script>`；
2. 删掉 `assets/` 里的 5 个文件；
3. 清掉偏好：`localStorage.removeItem('haizakura_lang')`。

页面立即恢复成原始中文，无需重启。
