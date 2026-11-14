/*
 * CDP 请求镜像（仅用于验证）
 * ---------------------------------------------------------------
 * 背景：校内平台（nginx unit）对 Chromium 的 TLS 连接直接空响应，
 *      改用本机代理中转也拿不到文档，最终表现为白页。
 * 做法：让浏览器只负责渲染，把目标域名的每个请求在 CDP 的 Fetch 域里
 *      拦下来，由本进程用 Node 去取（Node 的握手能过），再把响应原样
 *      fulfil 回去。浏览器看到的是真实域名、真实 HTML/JS，扩展照常工作。
 *
 * 边界：
 *   - 只拦 --host 指定域名，其它域名（含扩展自己的 127.0.0.1）不碰；
 *   - 不打印、不落盘 cookie / token / 请求体；
 *   - 只在本机验证时使用，不属于产品运行路径。
 *
 * 用法：
 *   node tools/cdp-mirror.mjs <url> [--host=...] [--ext=dir] [--wait=15000]
 *                             [--shot=file] [--eval=js] [--size=1400x900] [--keep]
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { spawn } from 'node:child_process';

const EDGE = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean).find((p) => fs.existsSync(p));

const argv = process.argv.slice(2);
const url = argv[0];
const opt = {};
for (const a of argv.slice(1)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) opt[m[1]] = m[2] === undefined ? true : m[2];
}
if (!url || !EDGE) {
  console.log('用法: node tools/cdp-mirror.mjs <url> [--host=域名] [--ext=目录] [--wait=ms] [--shot=文件] [--eval=js]');
  process.exit(1);
}

const HOST = String(opt.host || new URL(url).hostname);
const PORT = Number(opt.port || 9334);
const WAIT = Number(opt.wait || 15000);
const [W, H] = String(opt.size || '1400x900').split('x').map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = path.join(process.env.TEMP || '.', 'bt-mirror-' + Date.now());
const args = [
  '--headless=new', '--disable-gpu',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  `--window-size=${W},${H}`,
  '--no-first-run', '--no-default-browser-check',
  '--disable-features=Translate,MediaRouter',
  'about:blank'
];
if (opt.ext) {
  const extDir = path.resolve(String(opt.ext));
  args.unshift(`--load-extension=${extDir}`, `--disable-extensions-except=${extDir}`);
}

const browser = spawn(EDGE, args, { stdio: 'ignore', windowsHide: false });

let ws, id = 0;
const pending = new Map();
const events = [];
function send(method, params = {}) {
  const mid = ++id;
  return new Promise((resolve, reject) => {
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

function b64(buf) { return Buffer.from(buf).toString('base64'); }

/* 只转发必要的请求头：
 *   - 去掉 accept-encoding，让服务端返回未压缩内容（否则 fulfil 回去的是 gzip 字节）；
 *   - 去掉 sec-fetch 系、sec-ch-ua 系、priority、connection 这类浏览器私有头，
 *     它们对站点无意义，却会让部分 WAF 直接断连（实测 socket hang up）。 */
const KEEP_HEADERS = new Set([
  'accept', 'accept-language', 'user-agent', 'referer', 'origin',
  'cookie', 'content-type', 'authorization', 'x-requested-with',
  'if-none-match', 'if-modified-since', 'range'
]);

function headerObj(h) {
  const out = {};
  if (!h) return out;
  const add = (k, v) => {
    if (!KEEP_HEADERS.has(String(k).toLowerCase())) return;
    out[k] = v;
  };
  if (Array.isArray(h)) for (const x of h) add(x.name, x.value);
  else for (const [k, v] of Object.entries(h)) add(k, v);
  return out;
}

/* Node 自带的 fetch 会校验证书，而本机 TUN 是中间人证书 → 这里用 https.request 关闭校验。
   只搬运真实站点的响应，不做缓存、不改内容。 */
function nodeRequest(url, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method,
      headers,
      rejectUnauthorized: false,
      timeout: 20000
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 502, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body && body.length) req.write(body);
    req.end();
  });
}

async function handlePaused(p) {
  const req = p.request;
  try {
    const headers = headerObj(req.headers);
    // 站点对 HeadlessChrome 的 UA 会直接断连（实测 socket hang up），这里换成普通桌面 UA
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === 'user-agent' && /Headless/i.test(headers[k])) {
        headers[k] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0';
      }
    }
    const init = { method: req.method, headers, body: req.postData ? Buffer.from(req.postData, 'base64') : null };
    const r = await nodeRequest(req.url, init);
    const respHeaders = [];
    for (const [k, v] of Object.entries(r.headers)) {
      if (k === 'content-encoding' || k === 'content-length' || k === 'transfer-encoding') continue;
      respHeaders.push({ name: k, value: Array.isArray(v) ? v.join(', ') : String(v) });
    }
    await send('Fetch.fulfillRequest', {
      requestId: p.requestId,
      responseCode: r.status,
      responseHeaders: respHeaders,
      body: b64(r.body)
    });
    if (!/\.(js|css|png|jpg|jpeg|svg|woff2?|ico)$/i.test(req.url)) {
      console.log(`[${r.status}] ${req.method} ${req.url.replace(/^https?:\/\/[^/]+/, '')} ${r.body.length}B`);
    }
  } catch (e) {
    console.log('[fail] ' + req.url + ' ' + (e.message || ''));
    if (opt.debug) console.log('  headers=' + JSON.stringify(headerObj(req.headers)));
    try { await send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'Failed' }); } catch (e2) {}
  }
}

try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch (e) {}
    await sleep(250);
  }
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();

  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      return;
    }
    if (msg.method === 'Fetch.requestPaused') { handlePaused(msg.params); return; }
    if (msg.method) events.push(msg);
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Fetch.enable', {
    patterns: [{ urlPattern: `https://${HOST}/*`, requestStage: 'Request' }]
  });
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

  await send('Page.navigate', { url });
  await sleep(WAIT);

  const evalRes = await send('Runtime.evaluate', {
    expression: String(opt.eval || `(() => {
      const host = document.getElementById('bt-assistant-host');
      const sr = host && host.shadowRoot;
      const pick = (s) => sr && sr.querySelector(s) ? (sr.querySelector(s).textContent || '').trim() : null;
      return {
        url: location.href, title: document.title,
        panelMounted: !!host,
        panelTitle: pick('.bt-title'), subtitle: pick('.bt-subtitle'),
        sceneHint: pick('.bt-scene-hint'),
        scenario: sr && sr.querySelector('.bt-scene-select') ? sr.querySelector('.bt-scene-select').value : null,
        options: sr ? Array.from(sr.querySelectorAll('.bt-scene-select option')).map(o => o.value) : [],
        modeBadge: pick('.bt-foot-note .bt-badge'),
        bodyText: sr && sr.querySelector('.bt-body') ? sr.querySelector('.bt-body').innerText.slice(0, 300) : null
      };
    })()`),
    returnByValue: true,
    awaitPromise: true
  });

  if (opt.shot) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const out = path.resolve(String(opt.shot));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log('截图: ' + out);
  }

  const errs = events
    .filter((e) => e.method === 'Runtime.consoleAPICalled' || e.method === 'Log.entryAdded')
    .map((e) => e.method === 'Log.entryAdded' ? '[log] ' + e.params.entry.level + ': ' + e.params.entry.text : '[' + e.params.type + '] ' + (e.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '))
    .filter((s) => s && !/favicon/i.test(s))
    .slice(-12);

  console.log(JSON.stringify({
    ok: true,
    value: evalRes.result ? evalRes.result.value : null,
    exception: evalRes.exceptionDetails ? evalRes.exceptionDetails.text : null,
    console: errs
  }, null, 2));

  if (opt.keep) { console.log('浏览器保留在 ' + PORT + ' 端口，按 Ctrl+C 结束'); await new Promise(() => {}); }
} catch (e) {
  console.error('失败: ' + (e && e.message ? e.message : e));
  process.exitCode = 3;
} finally {
  if (!opt.keep) {
    try { ws && ws.close(); } catch (e) {}
    try { browser.kill(); } catch (e) {}
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
}
