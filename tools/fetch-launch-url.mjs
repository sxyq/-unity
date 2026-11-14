/* 从平台学习页点「启动虚拟实验」，抓 Experiment/Launch 返回的 URL。
 * 只把 URL 写到本机临时文件，不打印、不上传票据。
 * 合成 click 足以触发接口；协议跳转会被 Chrome 拦，正好不影响我们拿 URL。
 */
import fs from 'node:fs';

const PORT = process.argv[2] || '9336';
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === 'page' && t.url.includes('mengoo'));
if (!page) { console.log('no platform page'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
let id = 0; const pending = new Map(); let launchReq = null; let consoleUrl = null; let consoleTs = 0;
ws.addEventListener('message', ev => {
  let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.j(new Error(m.error.message)) : p.r(m.result); return; }
  if (m.method === 'Network.responseReceived' && /Experiment\/Launch/i.test(m.params.response.url)) launchReq = m.params.requestId;
  // 兜底：Chrome 拦截协议跳转时会把完整 URL 打进 console。
  // Runtime.enable 会回放历史条目，所以必须用时间戳过滤，只认本次点击之后的。
  if (m.method === 'Runtime.consoleAPICalled' && m.params.timestamp > CLICK_AT) {
    for (const a of m.params.args || []) {
      const s = String(a.value ?? a.description ?? '');
      const hit = s.match(/mlauncher:\/\/[^\s'"]+/i);
      if (hit) { consoleUrl = hit[0]; consoleTs = m.params.timestamp; }
    }
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.timestamp > CLICK_AT) {
    const s = String(m.params.entry.text || '');
    const hit = s.match(/mlauncher:\/\/[^\s'"]+/i);
    if (hit) { consoleUrl = hit[0]; consoleTs = m.params.entry.timestamp; }
  }
});
const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; pending.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params })); });

await send('Network.enable');
await send('Runtime.enable');
await send('Log.enable');
const CLICK_AT = Date.now();
const clicked = await send('Runtime.evaluate', {
  expression: `(()=>{const b=[...document.querySelectorAll('button,div[class*=btn]')].find(e=>/启动虚拟实验/.test(e.innerText||''));if(b){b.click();return true}return false})()`,
  returnByValue: true
});
console.log('clicked:', clicked.result.value);
await new Promise(r => setTimeout(r, 4000));
let url = null;
if (launchReq) {
  try {
    const body = await send('Network.getResponseBody', { requestId: launchReq });
    const json = JSON.parse(body.body);
    url = json && json.data && json.data.url;
  } catch (e) { /* 响应体已释放或解压失败，走 console 兜底 */ }
}
if (!url && consoleUrl) url = consoleUrl;
if (!url) { console.log('no url'); ws.close(); process.exit(1); }
fs.writeFileSync('C:\\Temp\\mlaunch-url.txt', url, 'utf8');
console.log('url saved, length:', url.length, 'via', launchReq ? 'network' : 'console');
ws.close();
