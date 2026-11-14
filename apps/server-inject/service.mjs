/*
 * 服务端智能交互服务（零依赖，Node 18+）
 * ---------------------------------------------------------------
 * 职责只有三件：
 *   1. 静态托管注入脚本  /hook.js、/src/panel.css、/assets/*.svg
 *   2. 转发对话          POST /api/chat   → 上游模型网关（SSE 原样透传）
 *   3. 健康检查          GET  /api/health → 上游或 offline
 *
 * 部署形态：本服务只监听 127.0.0.1，由 nginx / IIS 反代到
 *   https://<校内域名>/mengoo/__ai/
 * 浏览器侧看到的路径就是同源的，不产生跨域，也不需要 CORS。
 *
 * 环境变量：
 *   PORT            监听端口（默认 8788）
 *   UPSTREAM        模型网关（默认 http://127.0.0.1:8787，即现有 proxy/server.mjs）
 *   AUTH_CHECK      1 = 调平台 /api/Auth/Info 校验登录态（默认 0）
 *   PLATFORM_BASE   平台地址（AUTH_CHECK=1 时必填，如 https://skeletaltraction.cqmu.edu.cn）
 *   RATE_PER_MIN    单 IP 每分钟对话次数上限（默认 20）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(__dirname, 'public');

const PORT = Number(process.env.PORT || 8788);
const UPSTREAM = process.env.UPSTREAM || 'http://127.0.0.1:8787';
const AUTH_CHECK = process.env.AUTH_CHECK === '1';
const PLATFORM_BASE = process.env.PLATFORM_BASE || '';
const RATE_PER_MIN = Number(process.env.RATE_PER_MIN || 20);

const MIME = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8'
};

/* ---------------- 简易限流：单 IP 每分钟 N 次 ---------------- */
const buckets = new Map();
function allow(ip) {
  const now = Date.now();
  const b = buckets.get(ip) || { reset: now + 60000, n: 0 };
  if (now > b.reset) { b.reset = now + 60000; b.n = 0; }
  b.n++;
  buckets.set(ip, b);
  return b.n <= RATE_PER_MIN;
}

/* ---------------- 登录态校验：借用平台自己的接口 ---------------- */
async function loggedIn(req) {
  if (!AUTH_CHECK) return true;
  if (!PLATFORM_BASE) return false;
  try {
    const r = await fetch(PLATFORM_BASE.replace(/\/$/, '') + '/api/Auth/Info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: req.headers.cookie || '' },
      body: '{}'
    });
    if (!r.ok) return false;
    const j = await r.json();
    return j && (j.code === 0 || j.code === 200);
  } catch (e) {
    return false;
  }
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  const rel = pathname.replace(/^\/+/, '');
  const abs = path.join(PUB, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!abs.startsWith(PUB) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
    return;
  }
  const ext = path.extname(abs).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    // hook.js 更新后必须立刻生效，避免学校浏览器缓存旧版
    'Cache-Control': rel === 'hook.js' ? 'no-cache' : 'public, max-age=3600'
  });
  fs.createReadStream(abs).pipe(res);
}

async function relayHealth(res) {
  try {
    const r = await fetch(UPSTREAM + '/api/health', { cache: 'no-store' });
    const j = await r.json();
    send(res, 200, j);
  } catch (e) {
    send(res, 200, { mode: 'offline', model: '', provider: '', note: '上游模型网关不可达' });
  }
}

async function relayChat(req, res, body) {
  let r;
  try {
    r = await fetch(UPSTREAM + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
  } catch (e) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' });
    res.write('data: ' + JSON.stringify({ error: '模型网关不可达' }) + '\n\n');
    res.end();
    return;
  }

  const ct = r.headers.get('content-type') || 'text/event-stream; charset=utf-8';
  res.writeHead(r.status, {
    'Content-Type': ct,
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no'   // 关键：让 nginx 不缓冲 SSE
  });

  if (!r.body) { res.end(); return; }
  const reader = r.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } catch (e) {
    /* 客户端中断，静默结束 */
  }
  res.end();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (req.method === 'GET' && (p === '/api/health' || p === '/health')) return relayHealth(res);

  if (req.method === 'GET' && p === '/api/state') {
    // 客户端状态代理（Windows 端 client-agent），拿不到就返回 none
    try {
      const r = await fetch('http://127.0.0.1:8790/state', { cache: 'no-store' });
      const j = await r.json();
      send(res, 200, j);
    } catch (e) {
      send(res, 200, { ok: false, phase: null, confidence: 'none' });
    }
    return;
  }

  if (req.method === 'POST' && p === '/api/chat') {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    if (!allow(String(ip))) return send(res, 429, { error: '请求过于频繁，请稍后再试' });
    if (!(await loggedIn(req))) return send(res, 401, { error: '请先登录平台再使用智能助教' });

    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 256 * 1024) { req.destroy(); }
    });
    req.on('end', () => relayChat(req, res, body));
    return;
  }

  if (req.method === 'GET') return serveStatic(req, res, p);

  send(res, 405, { error: 'method not allowed' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[hook] http://127.0.0.1:${PORT}  upstream=${UPSTREAM} auth=${AUTH_CHECK ? 'on' : 'off'}`);
});
