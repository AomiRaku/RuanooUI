#!/usr/bin/env node
/* ==========================================================================
   RuanooUI — 一致性审计
   --------------------------------------------------------------------------
   交叉比对 ruanoo-ui.css / ruanoo-ui.js / index.html，抓出"引用了但不存在"
   的断裂（类名、CSS 变量、关键帧、data-* 钩子），并列出"定义了但没人用"
   的残留。

     node tools/audit.mjs          报告
     node tools/audit.mjs --strict 有 ERROR 时以退出码 1 结束（供 CI 使用）
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const js = read('ruanoo-ui.js');
const html = read('index.html');

// 注释里会出现 `document.documentElement.dataset.theme` 这类文本，
// 全文扫 .foo 会把 .theme / .dataset 误当成类名 —— 先剥掉注释。
const css = read('ruanoo-ui.css').replace(/\/\*[\s\S]*?\*\//g, '');

// 示例页的代码块是转义后的展示文本，里面的 class="..." 不算真实使用
const liveHtml = html.replace(/<div class="g-code">[\s\S]*?<\/div>/g, '');

const uniq = (a) => [...new Set(a)];
const match = (src, re, i = 1) => [...src.matchAll(re)].map((m) => m[i]);

/* ---------- 收集 ---------- */

const cssClasses = uniq(match(css, /\.(-?[A-Za-z_][\w-]*)/g));
const cssVarsDef = uniq(match(css, /(--[\w-]+)\s*:/g));
const cssVarsUse = uniq([
  ...match(css, /var\(\s*(--[\w-]+)/g),
  ...match(liveHtml, /var\(\s*(--[\w-]+)/g),
]);
const cssKeyframes = uniq(match(css, /@keyframes\s+([\w-]+)/g));
const ANIM_KEYWORDS = new Set(['none', 'inherit', 'initial', 'unset', 'revert']);
const cssAnimUse = uniq(match(css, /animation:\s*([\w-]+)/g)).filter((k) => !ANIM_KEYWORDS.has(k));
const cssProps = uniq(match(css, /@property\s+(--[\w-]+)/g));
const cssDataAttr = uniq(match(css, /\[(data-[\w-]+)/g));

const htmlClasses = uniq(
  match(liveHtml, /class="([^"]*)"/g)
    .flatMap((c) => c.trim().split(/\s+/))
    .filter(Boolean),
);
const htmlDataAttr = uniq(match(liveHtml, /\s(data-[\w-]+)/g));

// 脚本里用内部包装 all(selector, root) 取值，两种写法都要认
const jsSelectors = uniq(match(js, /(?:querySelector|querySelectorAll|\ball)\(\s*'([^']+)'/g));
const jsClasses = uniq(jsSelectors.flatMap((s) => match(s, /\.(-?[A-Za-z_][\w-]*)/g)));
const jsDataAttr = uniq(
  match(js, /dataset\.(\w+)/g).map((k) => 'data-' + k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())),
);

/* ---------- 判定 ---------- */

// 示例页自身的框架样式（g- 前缀）不属于组件库，豁免
const isDemoOwn = (c) => c.startsWith('g-');
// .idx-N 是一组滑块位移状态，idx-0 即"不位移"的默认态，本身不需要规则
const isSliderState = (c) => /^idx-\d$/.test(c);

const errors = [];
const warns = [];
const notes = [];

const missingInCss = [...htmlClasses, ...jsClasses].filter(
  (c) => !cssClasses.includes(c) && !isDemoOwn(c) && !isSliderState(c),
);
if (missingInCss.length) {
  errors.push(`HTML/JS 用到但 CSS 未定义：${uniq(missingInCss).join(', ')}`);
}

const undefVars = cssVarsUse.filter((v) => !cssVarsDef.includes(v));
if (undefVars.length) {
  errors.push(`var() 引用但未定义：${undefVars.join(', ')}`);
}

const missingKeyframes = cssAnimUse.filter((k) => !cssKeyframes.includes(k));
if (missingKeyframes.length) {
  errors.push(`animation 引用但未定义 @keyframes：${missingKeyframes.join(', ')}`);
}

const unusedVars = cssVarsDef.filter((v) => !cssVarsUse.includes(v));
if (unusedVars.length) {
  warns.push(`变量已定义但从未被引用（疑似残留）：${unusedVars.join(', ')}`);
}

// 状态类/钩子由使用方按需添加，示例页不一定出现，只作提示
const unusedCssClasses = cssClasses.filter(
  (c) => !htmlClasses.includes(c) && !jsClasses.includes(c) && !isDemoOwn(c),
);
if (unusedCssClasses.length) {
  notes.push(`CSS 有规则但示例页未演示（使用方按需启用）：${unusedCssClasses.join(', ')}`);
}

const orphanData = uniq([...cssDataAttr, ...jsDataAttr]).filter((d) => !htmlDataAttr.includes(d));
if (orphanData.length) {
  notes.push(`脚本/样式读取但示例页未提供的 data-* 钩子：${orphanData.join(', ')}`);
}

const unusedProps = cssProps.filter((p) => !cssVarsUse.includes(p));
if (unusedProps.length) {
  notes.push(`已注册 @property 但未用 var() 引用：${unusedProps.join(', ')}`);
}

/* ---------- 报告 ---------- */

const line = (s) => console.log(s);
line('');
line('  RuanooUI 一致性审计');
line('  ' + '─'.repeat(58));
line(`  CSS  : ${cssClasses.length} 类 / ${cssVarsDef.length} 变量 / ${cssProps.length} @property`);
line(`  HTML : ${htmlClasses.length} 类 / ${htmlDataAttr.length} data-*`);
line(`  JS   : ${jsSelectors.length} 选择器 / ${jsDataAttr.length} data-*`);
line('');

const section = (title, items, tag) => {
  if (!items.length) return;
  line(`  ${tag} ${title}`);
  for (const it of items) line(`      · ${it}`);
  line('');
};

section('ERROR', errors, '✗');
section('WARN', warns, '!');
section('NOTE', notes, 'i');

if (!errors.length) line('  ✓ 未发现断裂引用');
line('');

process.exit(process.argv.includes('--strict') && errors.length ? 1 : 0);
