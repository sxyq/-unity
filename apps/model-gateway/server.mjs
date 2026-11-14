/*
 * 本地大模型代理（零依赖，Node 18+）
 * ---------------------------------------------------------------
 * - API Key 只在 config.json / 环境变量，浏览器永远拿不到
 * - 未配置 Key 时自动「演示模式」：按病例知识库做意图匹配
 * - /api/health  服务与模型状态
 * - /api/chat    SSE 流式（支持非流式合成）
 * - /api/config  GET 安全子集 / POST 修改模型配置（不接收 Key）
 * - 静态目录：/demo、/extension
 *
 * 运行：node proxy/server.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', 'extension');
const CONFIG_PATH = path.join(__dirname, 'config.json');

const DEFAULTS = {
  port: 8787,
  mode: 'auto',
  baseUrl: 'https://api.deepseek.com/v1',
  chatCompletionsPath: '/chat/completions',
  apiKey: '',
  model: 'deepseek-chat',
  stream: true,
  timeoutMs: 60000,
  temperature: 0.6,
  maxTokens: 900
};

let raw = {};
if (fs.existsSync(CONFIG_PATH)) {
  try { raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (e) { console.warn('[config] 解析失败，用默认值'); }
}
const base = { ...DEFAULTS, ...raw };
if (process.env.LLM_API_KEY) base.apiKey = process.env.LLM_API_KEY;
if (process.env.LLM_BASE_URL) base.baseUrl = process.env.LLM_BASE_URL;
if (process.env.LLM_MODEL) base.model = process.env.LLM_MODEL;
if (base.mode === 'auto') base.mode = base.apiKey ? 'live' : 'mock';

let CFG = base;

/* ---------------- 静态 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/demo/run.html' : pathname;
  const abs = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!abs.startsWith(ROOT) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
    return;
  }
  const ext = path.extname(abs).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(abs).pipe(res);
}

import { mockAnswer } from './lib/mock.mjs';

/* ---------------- 真实模型 ---------------- */
async function callLive(system, messages, stream) {
  const body = {
    model: CFG.model,
    stream: !!stream,
    temperature: CFG.temperature,
    max_tokens: CFG.maxTokens,
    messages: [{ role: 'system', content: system }, ...messages]
  };
  const url = CFG.baseUrl.replace(/\/$/, '') + (CFG.chatCompletionsPath || '/chat/completions');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), CFG.timeoutMs || 60000);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + CFG.apiKey },
      body: JSON.stringify(body),
      signal: ac.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function streamLive(res, system, messages) {
  let r;
  try {
    r = await callLive(system, messages, true);
  } catch (e) {
    sse(res, { error: e.name === 'AbortError' ? '模型请求超时' : ('连接模型失败：' + e.message) });
    sse(res, '[DONE]'); res.end(); return;
  }
  if (!r.ok || !r.body) {
    const txt = await r.text().catch(() => '');
    sse(res, { error: `模型接口返回 ${r.status} ${txt.slice(0, 160)}` });
    sse(res, '[DONE]'); res.end(); return;
  }

  const reader = r.body.getReader();
  const dec = new TextDecoder('utf-8');
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const p = line.slice(5).trim();
        if (!p || p === '[DONE]') continue;
        try {
          const o = JSON.parse(p);
          const t = o.choices && o.choices[0] && o.choices[0].delta && o.choices[0].delta.content;
          if (t) sse(res, { t });
        } catch (e) { /* ignore */ }
      }
    }
  } catch (e) {
    sse(res, { error: '流读取中断：' + (e.message || '') });
  }
  sse(res, '[DONE]');
  res.end();
}

async function nonStreamLive(res, system, messages) {
  let r;
  try {
    r = await callLive(system, messages, false);
  } catch (e) {
    sse(res, { error: e.name === 'AbortError' ? '模型请求超时' : ('连接模型失败：' + e.message) });
    sse(res, '[DONE]'); res.end(); return;
  }
  const j = await r.json().catch(() => null);
  const txt = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  if (!txt) sse(res, { error: '模型返回为空或格式不符' });
  else sse(res, { t: txt });
  sse(res, '[DONE]');
  res.end();
}

/* ---------------- 工具 ---------------- */
function sse(res, obj) {
  const payload = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.write('data: ' + payload + '\n\n');
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 2e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

function safeConfig() {
  return {
    mode: CFG.mode, baseUrl: CFG.baseUrl, model: CFG.model,
    chatCompletionsPath: CFG.chatCompletionsPath, stream: CFG.stream,
    timeoutMs: CFG.timeoutMs, temperature: CFG.temperature, maxTokens: CFG.maxTokens,
    hasKey: !!CFG.apiKey
  };
}

/* ---------------- 路由 ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (p === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: true, mode: CFG.mode,
      model: CFG.mode === 'live' ? CFG.model : '演示知识库',
      provider: CFG.mode === 'live' ? CFG.baseUrl : 'mock'
    }));
    return;
  }

  if (p === '/api/config') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(safeConfig()));
      return;
    }
    if (req.method === 'POST') {
      const patch = await readBody(req);
      const allow = ['baseUrl', 'model', 'chatCompletionsPath', 'stream', 'timeoutMs', 'temperature', 'maxTokens', 'mode'];
      for (const k of allow) {
        if (patch[k] === undefined) continue;
        if (k === 'timeoutMs' || k === 'maxTokens') CFG[k] = Number(patch[k]) || CFG[k];
        else if (k === 'temperature') CFG[k] = Number(patch[k]);
        else CFG[k] = patch[k];
      }
      if (CFG.mode === 'auto') CFG.mode = CFG.apiKey ? 'live' : 'mock';
      const out = { ...raw, ...CFG, apiKey: raw.apiKey || '' };
      try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(out, null, 2)); } catch (e) { /* ignore */ }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(safeConfig()));
      return;
    }
  }

  if (p === '/api/chat' && req.method === 'POST') {
    const { system, messages, stream } = await readBody(req);
    const safeMessages = Array.isArray(messages) ? messages.slice(-12) : [];

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    sse(res, { mode: CFG.mode, model: CFG.mode === 'live' ? CFG.model : '演示知识库' });

    if (CFG.mode === 'live') {
      if (stream === false || CFG.stream === false) await nonStreamLive(res, system || '', safeMessages);
      else await streamLive(res, system || '', safeMessages);
      return;
    }

    const answer = mockAnswer(system || '', safeMessages);
    const parts = answer.match(/[\s\S]{1,18}/g) || [answer];
    let i = 0;
    const timer = setInterval(() => {
      if (i >= parts.length) {
        clearInterval(timer);
        sse(res, '[DONE]');
        res.end();
        return;
      }
      sse(res, { t: parts[i++] });
    }, 24);
    req.on('close', () => clearInterval(timer));
    return;
  }

  serveStatic(req, res, p);
});

server.listen(CFG.port, '127.0.0.1', () => {
  const modeText = CFG.mode === 'live' ? `真实模型（${CFG.model}）` : '演示模式（未配置 API Key）';
  console.log('');
  console.log('  骨牵引智能交互组件 · 本地服务已启动');
  console.log('  ---------------------------------------------');
  console.log('  地址：http://127.0.0.1:' + CFG.port);
  console.log('  模式：' + modeText);
  console.log('  演示：http://127.0.0.1:' + CFG.port + '/demo/preview.html');
  console.log('');
});
