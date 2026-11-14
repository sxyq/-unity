/*
 * 极简 CDP 探针（零依赖，Node 22+ 自带 WebSocket）
 * ---------------------------------------------------------------
 * 用途：在真实浏览器里打开页面、等它跑完、取状态、截图、记录控制台与网络。
 *      不注入被测站点，只做“看”和“点”。
 *
 * 用法：
 *   node tools/cdp.mjs probe <url> [--headless] [--ext=<解压扩展目录>]
 *                                  [--wait=8000] [--shot=out.png]
 *                                  [--eval="(() => ({...}))()"]
 *                                  [--size=1440x900]
 *
 * 例子：
 *   node tools/cdp.mjs probe http://127.0.0.1:8787/demo/panel.html --shot=panel.png
 *   node tools/cdp.mjs probe https://skeletaltraction.cqmu.edu.cn/mengoo/ \
 *        --ext=apps/extension --wait=12000 --shot=platform.png
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

function findBrowser() {
  for (const p of EDGE_CANDIDATES) if (fs.existsSync(p)) return p;
  return null;
}

const args = process.argv.slice(2);
const cmd = args[0];
const url = args[1];
const opt = {};
for (const a of args.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (!m) continue;
  opt[m[1]] = m[2] === undefined ? true : m[2];
}

if (cmd !== 'probe' || !url) {
  console.log('用法: node tools/cdp.mjs probe <url> [--headless] [--ext=dir] [--wait=ms] [--shot=file] [--eval=js] [--size=WxH]');
  process.exit(1);
}

const PORT = Number(opt.port || 9333);
const WAIT = Number(opt.wait || 8000);
const [W, H] = String(opt.size || '1440x900').split('x').map(Number);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitEndpoint(retries = 60) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch (e) { /* not ready */ }
    await sleep(250);
  }
  throw new Error('浏览器调试端口未就绪');
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
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  return {
    ready,
    events,
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

const browser = findBrowser();
if (!browser) {
  console.error('找不到 Edge/Chrome，可用 EDGE_PATH 指定');
  process.exit(2);
}

const profile = path.join(process.env.TEMP || '.', 'bt-cdp-' + Date.now());
const disableFeatures = ['Translate', 'MediaRouter'];
// 某些校园 WAF / 中间盒会被 Chromium 的后量子密钥交换握手打挂，表现为 ERR_EMPTY_RESPONSE
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
if (opt.ext) {
  const extDir = path.resolve(String(opt.ext));
  chromeArgs.unshift(`--load-extension=${extDir}`, `--disable-extensions-except=${extDir}`);
}
if (opt['ignore-cert']) chromeArgs.unshift('--ignore-certificate-errors');
if (opt.proxy) chromeArgs.unshift(`--proxy-server=${opt.proxy}`);
if (opt.extra) chromeArgs.unshift(...String(opt.extra).split(' ').filter(Boolean));

const proc = spawn(browser, chromeArgs, { stdio: 'ignore', windowsHide: false });
let cdp = null;

try {
  await waitEndpoint();
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  cdp = connect(t.webSocketDebuggerUrl);
  await cdp.ready;

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: W, height: H, deviceScaleFactor: 1, mobile: false
  });

  await cdp.send('Page.navigate', { url });
  await sleep(WAIT);

  // 控制台与页面错误
  const consoleMsgs = cdp.events
    .filter(e => e.method === 'Runtime.consoleAPICalled' || e.method === 'Log.entryAdded')
    .map(e => {
      if (e.method === 'Log.entryAdded') return '[log] ' + e.params.entry.level + ': ' + e.params.entry.text;
      const p = e.params;
      return '[' + p.type + '] ' + (p.args || []).map(a => a.value ?? a.description ?? '').join(' ');
    })
    .filter(s => s && !/favicon/i.test(s))
    .slice(-15);

  // 只看业务接口，不记录请求头
  const net = cdp.events
    .filter(e => e.method === 'Network.responseReceived')
    .map(e => ({ url: e.params.response.url, status: e.params.response.status }))
    .filter(x => /\/api\//i.test(x.url))
    .map(x => `${x.status} ${x.url.replace(/^https?:\/\/[^/]+/, '')}`)
    .slice(-40);

  const defaultEval = `(() => {
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

  const evalRes = await cdp.send('Runtime.evaluate', {
    expression: String(opt.eval || defaultEval),
    returnByValue: true,
    awaitPromise: true
  });

  if (opt.shot) {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const out = path.resolve(String(opt.shot));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log('截图: ' + out);
  }

  const failed = cdp.events
    .filter(e => e.method === 'Network.loadingFailed' && !e.params.canceled)
    .map(e => `${e.params.errorText} (${e.params.type})`)
    .slice(-8);

  console.log(JSON.stringify({
    ok: true,
    value: evalRes.result ? evalRes.result.value : null,
    exception: evalRes.exceptionDetails ? evalRes.exceptionDetails.text : null,
    console: consoleMsgs,
    failed,
    api: net
  }, null, 2));
} catch (e) {
  console.error('CDP 失败: ' + (e && e.message ? e.message : e));
  process.exitCode = 3;
} finally {
  if (cdp) cdp.close();
  try { proc.kill(); } catch (e) {}
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
}
