/*
 * 极简 CDP 工具（零依赖，Node 22+ 自带 WebSocket）
 * ---------------------------------------------------------------
 * 两种用法：
 *   probe  —— 自己拉起一个浏览器，打开页面，等它跑完，取状态/截图/网络
 *   attach —— 连接已经在跑的浏览器（带 --remote-debugging-port 的那个），
 *             用于观察用户自己登录后的真实会话（不复用、不读取任何凭据）
 *
 * 用法：
 *   node tools/cdp.mjs probe <url> [--headless] [--ext=dir] [--wait=ms]
 *                                  [--shot=file] [--eval=js] [--size=WxH]
 *                                  [--proxy=http://127.0.0.1:7897] [--ignore-cert]
 *
 *   node tools/cdp.mjs attach [--port=9333] [--match=mengoo] [--wait=ms]
 *                             [--shot=file] [--eval=js] [--reload]
 *
 * 说明：eval 的返回值会以 JSON 输出；只记录 /api/ 的 URL 与状态码，不记录请求头与 body。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const EDGE_CANDIDATES = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean);

const BIN = EDGE_CANDIDATES.find((p) => fs.existsSync(p));

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = {};
const positional = [];
for (const a of argv.slice(1)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) opt[m[1]] = m[2] === undefined ? true : m[2];
  else positional.push(a);
}

const isProbe = cmd === 'probe';
const isAttach = cmd === 'attach';
if (!isProbe && !isAttach) {
  console.log('用法: node tools/cdp.mjs probe <url> [选项]  |  node tools/cdp.mjs attach [--port=9333]');
  process.exit(1);
}
if (isProbe && !positional[0]) {
  console.log('probe 需要 url');
  process.exit(1);
}

const PORT = Number(opt.port || 9333);
const WAIT = Number(opt.wait || (isProbe ? 8000 : 1500));
const [W, H] = String(opt.size || '1440x900').split('x').map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function listTargets() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  if (!r.ok) throw new Error('调试端口不可用');
  return r.json();
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
    }
  });
  return {
    events,
    ready: new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    }),
    send(method, params = {}) {
      const mid = ++id;
      return new Promise((resolve, reject) => {
        pending.set(mid, { resolve, reject });
        ws.send(JSON.stringify({ id: mid, method, params }));
      });
    },
    close() { try { ws.close(); } catch (e) {} }
  };
}

const DEFAULT_EVAL = `(() => {
  const host = document.getElementById('bt-assistant-host');
  const sr = host && host.shadowRoot;
  const pick = (sel) => sr && sr.querySelector(sel) ? (sr.querySelector(sel).textContent || '').trim() : null;
  const visible = (el) => !!el && !el.classList.contains('bt-hidden');
  return {
    url: location.href,
    title: document.title,
    panelMounted: !!host,
    panelVisible: visible(sr && sr.querySelector('.bt-panel')),
    panelTitle: pick('.bt-title'),
    subtitle: pick('.bt-subtitle'),
    sceneHint: pick('.bt-scene-hint'),
    scenarioValue: sr && sr.querySelector('.bt-scene-select') ? sr.querySelector('.bt-scene-select').value : null,
    options: sr ? Array.from(sr.querySelectorAll('.bt-scene-select option')).map(o => o.value) : [],
    modeBadge: pick('.bt-foot-note .bt-badge'),
    bodyText: sr && sr.querySelector('.bt-body') ? (sr.querySelector('.bt-body').innerText || '').slice(0, 300) : null
  };
})()`;

async function report(cdp, evalRes) {
  const consoleMsgs = cdp.events
    .filter((e) => e.method === 'Runtime.consoleAPICalled' || e.method === 'Log.entryAdded')
    .map((e) => {
      if (e.method === 'Log.entryAdded') return '[log] ' + e.params.entry.level + ': ' + e.params.entry.text;
      const p = e.params;
      return '[' + p.type + '] ' + (p.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
    })
    .filter((s) => s && !/favicon/i.test(s))
    .slice(-15);

  const net = cdp.events
    .filter((e) => e.method === 'Network.responseReceived')
    .map((e) => ({ url: e.params.response.url, status: e.params.response.status }))
    .filter((x) => /\/api\//i.test(x.url))
    .map((x) => `${x.status} ${x.url.replace(/^https?:\/\/[^/]+/, '')}`)
    .slice(-40);

  const failed = cdp.events
    .filter((e) => e.method === 'Network.loadingFailed' && !e.params.canceled)
    .map((e) => `${e.params.errorText} (${e.params.type})`)
    .slice(-8);

  console.log(JSON.stringify({
    ok: true,
    value: evalRes && evalRes.result ? evalRes.result.value : null,
    exception: evalRes && evalRes.exceptionDetails ? evalRes.exceptionDetails.text : null,
    console: consoleMsgs,
    failed,
    api: net
  }, null, 2));
}

async function shoot(cdp, file) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const out = path.resolve(String(file));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('截图: ' + out);
}

async function runProbe() {
  if (!BIN) { console.error('找不到 Edge/Chrome，可用 EDGE_PATH 指定'); process.exit(2); }

  const url = positional[0];
  const profile = path.join(process.env.TEMP || '.', 'bt-cdp-' + Date.now());
  const disableFeatures = ['Translate', 'MediaRouter'];
  if (opt['no-pq']) disableFeatures.push('PostQuantumKyber', 'EnableKyber');
  if (opt.disable) disableFeatures.push(...String(opt.disable).split(',').filter(Boolean));

  const chromeArgs = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    `--window-size=${W},${H}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--disable-features=${disableFeatures.join(',')}`,
    '--disable-background-networking',
    'about:blank'
  ];
  if (opt.headless) chromeArgs.unshift('--headless=new', '--disable-gpu');
  if (opt['ignore-cert']) chromeArgs.unshift('--ignore-certificate-errors');
  if (opt.proxy) chromeArgs.unshift(`--proxy-server=${opt.proxy}`);
  if (opt.extra) chromeArgs.unshift(...String(opt.extra).split(' ').filter(Boolean));
  if (opt.ext) {
    const extDir = path.resolve(String(opt.ext));
    chromeArgs.unshift(`--load-extension=${extDir}`, `--disable-extensions-except=${extDir}`);
  }

  const proc = spawn(BIN, chromeArgs, { stdio: 'ignore', windowsHide: false });
  let cdp = null;
  try {
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch (e) { /* wait */ }
      await sleep(250);
    }
    const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
    cdp = connect(t.webSocketDebuggerUrl);
    await cdp.ready;

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

    await cdp.send('Page.navigate', { url });
    await sleep(WAIT);

    const evalRes = await cdp.send('Runtime.evaluate', {
      expression: String(opt.eval || DEFAULT_EVAL),
      returnByValue: true,
      awaitPromise: true
    });
    if (opt.shot) await shoot(cdp, opt.shot);
    await report(cdp, evalRes);
  } finally {
    if (cdp) cdp.close();
    try { proc.kill(); } catch (e) {}
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
}

async function runAttach() {
  const targets = await listTargets();
  const pages = targets.filter((t) => t.type === 'page' && !/^(devtools|edge|chrome-extension):/.test(t.url));
  const match = opt.match ? String(opt.match) : '';
  const target = (match ? pages.find((t) => t.url.includes(match)) : pages[0]) || pages[0];
  if (!target) throw new Error('没有可附着的页面（浏览器是否带 --remote-debugging-port 启动？）');

  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  if (opt.reload) { await cdp.send('Page.reload', { ignoreCache: false }); }
  await sleep(WAIT);

  // 内容脚本跑在隔离世界：页面 window 上看不到 BT_UI，
  // 需要拿到 isolated world 的 executionContextId 才能取到扩展内部状态。
  let contextId = undefined;
  if (opt.isolated) {
    for (let i = 0; i < 20; i++) {
      const ctxs = cdp.events
        .filter((e) => e.method === 'Runtime.executionContextCreated')
        .map((e) => e.params.context);
      const iso = ctxs.filter((c) => c.auxData && c.auxData.isDefault === false);
      const pick = iso.find((c) => String(c.origin || '').startsWith('chrome-extension://')) || iso[iso.length - 1];
      if (pick) { contextId = pick.id; break; }
      await sleep(250);
    }
    if (contextId === undefined) console.error('（没找到隔离世界上下文，回退到主世界）');
  }

  const evalRes = await cdp.send('Runtime.evaluate', {
    expression: String(opt.eval || DEFAULT_EVAL),
    returnByValue: true,
    awaitPromise: true,
    ...(contextId !== undefined ? { contextId } : {})
  });
  if (opt.shot) await shoot(cdp, opt.shot);
  console.log('附着页面: ' + target.url);
  await report(cdp, evalRes);
  cdp.close();
}

try {
  if (isProbe) await runProbe();
  else await runAttach();
} catch (e) {
  console.error('CDP 失败: ' + (e && e.message ? e.message : e));
  process.exitCode = 3;
}
