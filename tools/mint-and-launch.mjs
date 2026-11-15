/* 一体化：取票 → 小写规范化 → 交换 16/18 段 → 秒级启动测试副本。
 * 票据一次性且很快过期，取票和启动必须在同一条命令里完成。
 */
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

const PORT = '9336';
const EXE = 'C:\\Temp\\gqy-unity-test\\HLF10631030\\HLF10631030.exe';
const HOST = 'https://skeletaltraction.cqmu.edu.cn';

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === 'page' && t.url.includes('CourseLearning'));
if (!page) { console.log('no course page'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
let id = 0; const pending = new Map(); let launchReq = null; let consoleUrl = null;
const CLICK_AT = Date.now();
const RE = new RegExp('mlauncher://[^\\s\'"]+', 'i');
ws.addEventListener('message', ev => {
  let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.j(new Error(m.error.message)) : p.r(m.result); return; }
  if (m.method === 'Network.responseReceived' && /Experiment\/Launch/i.test(m.params.response.url)) launchReq = m.params.requestId;
  if (m.method === 'Runtime.consoleAPICalled') {
    for (const a of m.params.args || []) {
      const s = String(a.value ?? a.description ?? '');
      const hit = s.match(RE);
      if (hit && m.params.timestamp > CLICK_AT) consoleUrl = hit[0];
    }
  }
});
const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; pending.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Network.enable'); await send('Runtime.enable');

const clicked = await send('Runtime.evaluate', {
  expression: `(()=>{const b=[...document.querySelectorAll('button,div[class*=btn]')].find(e=>/启动虚拟实验/.test(e.innerText||''));if(b){b.click();return true}return false})()`,
  returnByValue: true
});
if (!clicked.result.value) { console.log('按钮没找到'); ws.close(); process.exit(1); }
console.log('clicked, 等响应...');
// 「启动虚拟实验」会弹确认框，必须点「确定」才会真正发起 Launch 请求
await new Promise(r => setTimeout(r, 1200));
const confirmed = await send('Runtime.evaluate', {
  expression: `(()=>{const b=[...document.querySelectorAll('button,div[class*=btn]')].find(e=>/^确定$/.test((e.innerText||'').trim()));if(b){b.click();return true}return false})()`,
  returnByValue: true
});
console.log('confirm:', confirmed.result.value);
for (let i = 0; i < 100; i++) { await new Promise(r => setTimeout(r, 1000)); if (launchReq || consoleUrl) break; }

let url = null;
if (launchReq) {
  try {
    const body = await send('Network.getResponseBody', { requestId: launchReq });
    const raw = body.body || '';
    let json = null;
    try { json = JSON.parse(raw); } catch { }
    url = json && (json.data && json.data.url || json.url || (json.data && json.data.Data && json.data.Data.url));
    if (!url) {
      // 结构变了：打印前 400 字便于定位
      console.log('body-sample:', raw.slice(0, 400).replace(/\s+/g, ' '));
    }
    console.log('via network');
  } catch (e) { console.log('body err:', e.message); }
}
if (!url && consoleUrl) { url = consoleUrl; console.log('via console'); }
ws.close();
if (!url) { console.log('no url'); process.exit(1); }

// 保留原始 scheme 大小写（实测成功日志为 MLauncher://，游戏端区分大小写，勿改）
const parts = url.split('&');
let ticket = parts[16];
if (ticket.startsWith('http')) ticket = parts[18];
if (!/^[0-9a-f]{8}-/i.test(ticket)) { console.log('票号格式异常'); process.exit(1); }
parts[16] = HOST;
parts[18] = ticket;
const gameUrl = parts.join('&');
fs.writeFileSync('C:\\Temp\\mlaunch-url.txt', url, 'utf8');
fs.writeFileSync('C:\\Temp\\mlaunch-url-game.txt', gameUrl, 'utf8');

if (!fs.existsSync(EXE)) { console.log('测试副本不存在'); process.exit(1); }
// 清场必须**同步**完成后再启动：异步 taskkill 会迟到，把新实例一起 /IM 杀掉（实测）
spawnSync('taskkill', ['/F', '/IM', 'MCLocalLauncher.exe'], { stdio: 'ignore' });
spawnSync('taskkill', ['/F', '/IM', 'HLF10631030.exe'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 500));
if (process.argv.includes('--no-launch')) { console.log('已写票，跳过启动（--no-launch）| 票号前 8 位:', ticket.slice(0, 8)); process.exit(0); }
const child = spawn(EXE, [gameUrl], { detached: true, stdio: 'ignore', cwd: 'C:\\Temp\\gqy-unity-test\\HLF10631030' });
child.unref();
console.log('测试副本已启动 pid=', child.pid, '| 票号前 8 位:', ticket.slice(0, 8));
