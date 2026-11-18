/**
 * hz-app.js —— 浏览器入口。
 *
 * 只做两件事：
 *   ① 多语言：把界面文本换成用户选的语言，并在设置页挂一个语言选择器
 *   ② 组件热加载（?hot 时启用）
 *
 * ⚠️ **不接管路由，不改页面结构。**
 *
 *   曾经重写过 6 个页面（总览/进程/日志/调试/设置/配置），但和原版在
 *   布局、数据流、交互上都不同 —— 原版进程页是卡片列表 + SSE 推送，
 *   重写版成了表格 + 轮询；原版总览有可拖拽网格，重写版是固定网格。
 *   用户看到的是「行为不一致」。
 *
 *   现在改成：原版 React 页面完全保留，只在它渲染出来的 DOM 上做文本替换。
 *   好处是交互、动画、布局、数据流全部与原版一致，没有重建误差。
 *   代价是多语言只能翻译文本，无法改变布局 —— 这正是想要的效果。
 */
import { boot as bootI18n } from './hz-i18n-boot.js';
import { getLang, onLangChange } from './hz-i18n-core.js';
import { translateNow } from './hz-i18n-dom.js';

async function main() {
  // ① 语言内核 + DOM 翻译 + 设置页语言选择器
  try {
    bootI18n();
  } catch (err) {
    console.warn('[haizakura] i18n 引导失败', err);
  }

  // ② 语言切换后重译整棵树
  onLangChange(() => {
    translateNow();
  });

  // ③ React 首屏渲染比我们晚，DOM 变化由 MutationObserver 处理
  //    （i18n-dom.js 内部已经在观察），这里只补一次首轮翻译
  const tryTranslate = () => {
    try { translateNow(); } catch { /* noop */ }
  };
  tryTranslate();
  setTimeout(tryTranslate, 800);
  setTimeout(tryTranslate, 2500);

  // ④ 热加载（显式开启才启用）
  const wantHot =
    new URLSearchParams(location.search).has('hot') ||
    localStorage.getItem('haizakura_hotload') === '1';
  if (wantHot) {
    try {
      const { watchManifest } = await import('./hz-hotload.js');
      watchManifest();
      console.log('[haizakura] 组件热加载已启用');
    } catch (err) {
      console.warn('[haizakura] 热加载不可用', err);
    }
  }

  console.log('[haizakura] i18n 就绪，语言 =', getLang());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}

// 调试入口
window.__hz = {
  getLang,
  retranslate: () => translateNow(),
  lang: () => getLang(),
};
