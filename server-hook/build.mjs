/*
 * 构建服务端注入用的单文件 hook.js
 * ---------------------------------------------------------------
 * 把扩展里的前端模块按依赖顺序拼成一个普通 <script>，
 * 再把 web-shim.js 放在最前面，顶替 chrome.runtime。
 *
 * 运行：node server-hook/build.mjs
 * 产物：server-hook/public/hook.js + public/src/panel.css + public/assets/*.svg
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'extension', 'src');
const PUB = path.join(__dirname, 'public');

const ORDER = [
  'web-shim.js',      // 必须在最前：定义 chrome.runtime
  'case-data.js',
  'prompt.js',
  'instrument.js',
  'bridge.js',
  'score-parse.js',
  'scene-detect.js',
  'ui.js',
  'main.js'
];

function read(name) {
  const base = name === 'web-shim.js' ? __dirname : SRC;
  const p = name === 'web-shim.js' ? path.join(__dirname, 'src', name) : path.join(SRC, name);
  if (!fs.existsSync(p)) throw new Error('缺少源文件: ' + p);
  return fs.readFileSync(p, 'utf8');
}

const banner = `/*!
 * 骨牵引护理情境化智能交互系统 · 服务端注入版
 * 由 server-hook/build.mjs 自动生成，请勿手改。
 * 生成时间: ${new Date().toISOString()}
 * 来源: extension/src/{${ORDER.join(',')}}
 */`;

const body = ORDER.map((n) => {
  const code = read(n);
  return `\n/* ===== ${n} ===== */\n(function(){\n${code}\n})();`;
}).join('\n');

fs.mkdirSync(PUB, { recursive: true });
fs.mkdirSync(path.join(PUB, 'src'), { recursive: true });
fs.mkdirSync(path.join(PUB, 'assets'), { recursive: true });

// 每个模块用 IIFE 包一层会破坏它们之间的全局挂载？不会：它们都挂在 window.BT_* 上。
fs.writeFileSync(path.join(PUB, 'hook.js'), banner + '\n' + body, 'utf8');

fs.copyFileSync(path.join(SRC, 'panel.css'), path.join(PUB, 'src', 'panel.css'));

const assets = path.join(ROOT, 'extension', 'assets');
for (const f of fs.readdirSync(assets)) {
  fs.copyFileSync(path.join(assets, f), path.join(PUB, 'assets', f));
}

const size = fs.statSync(path.join(PUB, 'hook.js')).size;
console.log(`hook.js  ${(size / 1024).toFixed(1)} KB`);
console.log('panel.css / assets 已同步到 server-hook/public');
