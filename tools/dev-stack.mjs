/* 开发栈看板：一条命令管起 4 个本地服务，只占一个后台任务。
 *
 *   node tools/dev-stack.mjs          启动/守护（前台常驻）
 *   node tools/dev-stack.mjs --status 查看端口状态
 *   node tools/dev-stack.mjs --stop   全部停止
 *
 * 设计：按端口判活，缺谁补谁；子进程退出自动重启（最多 5 次）。
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SERVICES = [
  { name: 'gateway', port: 8787, args: ['apps/model-gateway/server.mjs'], cwd: ROOT },
  { name: 'agent', port: 8790, args: ['client-agent/agent.mjs'], cwd: ROOT },
  { name: 'bridge', port: 9090, args: ['tools/local-bridge.mjs', '--silent'], cwd: ROOT },
  { name: 'tts', port: 8791, args: ['local-server.mjs'], cwd: path.join(ROOT, 'tools/tts') },
];

const children = new Map();
const restarts = new Map();

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    const done = (v) => { try { s.destroy(); } catch { } resolve(v); };
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    s.setTimeout(800, () => done(false));
  });
}

async function status() {
  const rows = [];
  for (const s of SERVICES) rows.push(`${(await portOpen(s.port)) ? '✅' : '❌'} ${s.name.padEnd(8)} :${s.port}`);
  console.log(rows.join('\n'));
}

async function startOne(svc) {
  if (await portOpen(svc.port)) return;
  const n = restarts.get(svc.name) || 0;
  if (n >= 5) { console.log(`[stack] ${svc.name} 重启次数过多，放弃`); return; }
  restarts.set(svc.name, n + 1);

  const child = spawn(process.execPath, svc.args, {
    cwd: svc.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  children.set(svc.name, child);

  child.stdout.on('data', (d) => process.stdout.write(`[${svc.name}] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[${svc.name}!] ${d}`));
  child.on('exit', (code) => {
    children.delete(svc.name);
    if (code !== 0) {
      console.log(`[stack] ${svc.name} 退出(${code})，3s 后重启`);
      setTimeout(() => startOne(svc), 3000);
    }
  });
  console.log(`[stack] 启动 ${svc.name} :${svc.port}`);
}

async function main() {
  const mode = process.argv[2] || '';
  if (mode === '--status') { await status(); return; }
  if (mode === '--stop') {
    for (const [name, c] of children) { try { c.kill(); } catch { } console.log('停止', name); }
    return;
  }

  console.log('[stack] 守护启动');
  for (const s of SERVICES) await startOne(s);
  await status();

  // 每 5 秒巡检一次
  setInterval(async () => {
    for (const s of SERVICES) {
      if (!children.has(s.name) && !(await portOpen(s.port))) await startOne(s);
    }
  }, 5000);

  process.on('SIGINT', () => {
    for (const [, c] of children) { try { c.kill(); } catch { } }
    process.exit(0);
  });
}

main();
