/*
 * 本地大模型代理（零依赖，Node 18+）
 * ---------------------------------------------------------------
 * - API Key 只在 config.json / 环境变量，浏览器永远拿不到
 * - 未配置 Key 时自动「演示模式」：按病例知识库做意图匹配
 * - /api/health  服务与模型状态
 * - /api/chat    SSE 流式（支持非流式合成）
 * - /api/config  GET 安全子集 / POST 修改模型配置（不收 Key、不跨站）
 * - 静态目录：/demo、/src
 *
 * 2026-11 修订（Windows 实测后）：
 *   1) 客户端断开 → 立即中止上游请求（之前只有超时会断，学生点“停止”后
 *      上游还在烧 token，且连接会被挂住）。
 *   2) 非流式分支补上 HTTP 状态检查（之前 401/500 会被当成“返回为空”）。
 *   3) /api/config 与 /api/chat 增加 Origin 校验：只接受本机页面与扩展。
 *      否则任意网页都能把 baseUrl 改到自己的服务器，下一次请求就会把
 *      Authorization: Bearer <真 Key> 发过去——这是真实存在的 Key 外泄路径。
 *   4) 没有 Key 时不允许把 mode 置为 live，避免界面显示“已接入”实际是假的。
 *
 * 运行：node apps/model-gateway/server.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', 'extension');
const CONFIG_PATH = process.env.LLM_CONFIG_PATH || path.join(__dirname, 'config.json');

const DEFAULTS = {
  port: 8787,
  mode: 'auto',
  baseUrl: 'https://api.deepseek.com/v1',
  protocol: 'chat',                 // 'chat' = /chat/completions；'responses' = /responses（GPT-5/6 系）
  chatCompletionsPath: '/chat/completions',
  responsesPath: '/responses',
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
if (process.env.LLM_PORT !== undefined) base.port = Number(process.env.LLM_PORT);
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

/* ---------------- 来源校验 ----------------
 * 只有本机页面、浏览器扩展可以调用写接口。
 * 注意：Origin 由浏览器强制写入，页面脚本改不了，所以可以作为判据；
 * 不带 Origin 的是本机程序（curl / 悬浮窗的 WebView2 同源请求）也放行。 */
function originAllowed(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try {
    const u = new URL(o);
    if (u.protocol === 'chrome-extension:' || u.protocol === 'moz-extension:') return true;
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]';
  } catch (e) { return false; }
}

/* ---------------- 真实模型 ---------------- */
function composeSignal(outer, timeoutMs) {
  const ac = new AbortController();
  const state = { timedOut: false, clientGone: false };
  const onOuter = () => { state.clientGone = true; ac.abort(); };
  if (outer) {
    if (outer.aborted) onOuter();
    else outer.addEventListener('abort', onOuter, { once: true });
  }
  const timer = setTimeout(() => { state.timedOut = true; ac.abort(); }, timeoutMs || 60000);
  return {
    signal: ac.signal,
    state,
    done() {
      clearTimeout(timer);
      if (outer) outer.removeEventListener('abort', onOuter);
    }
  };
}

async function callLive(system, messages, stream, outer) {
  const isResponses = (CFG.protocol || 'chat') === 'responses';
  /* Responses 协议（GPT-5/6 系必用）：system → instructions，messages → input。
     实测该网关的 /v1/responses 会回默认 instructions（Codex 提示词），
     必须显式传 instructions 覆盖，否则模型会以为自己是写代码的。 */
  const body = isResponses
    ? {
        model: CFG.model,
        instructions: system,
        input: messages.map(m => ({ role: m.role, content: String(m.content || '') })),
        stream: !!stream,
        max_output_tokens: CFG.maxTokens
      }
    : {
        model: CFG.model,
        stream: !!stream,
        temperature: CFG.temperature,
        max_tokens: CFG.maxTokens,
        messages: [{ role: 'system', content: system }, ...messages]
      };
  const path = isResponses
    ? (CFG.responsesPath || '/responses')
    : (CFG.chatCompletionsPath || '/chat/completions');
  const url = CFG.baseUrl.replace(/\/$/, '') + path;
  const ctl = composeSignal(outer, CFG.timeoutMs);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + CFG.apiKey },
      body: JSON.stringify(body),
      signal: ctl.signal
    });
    return { resp, ctl };
  } catch (e) {
    ctl.done();
    e.btState = ctl.state;
    throw e;
  }
}

/* Responses 协议的非流式结果：output[].content[].text 依次拼接 */
function responsesText(j) {
  if (!j) return '';
  if (typeof j.output_text === 'string' && j.output_text) return j.output_text;
  const out = [];
  for (const item of (j.output || [])) {
    for (const c of (item.content || [])) {
      if (c && typeof c.text === 'string') out.push(c.text);
    }
  }
  return out.join('');
}

function errText(e) {
  const st = e && e.btState;
  if (st && st.clientGone) return null;             // 学生点了停止，不必再报错
  if (st && st.timedOut) return '模型请求超时（' + Math.round((CFG.timeoutMs || 60000) / 1000) + 's）';
  if (e && e.name === 'AbortError') return '模型请求已中止';
  return '连接模型失败：' + (e && e.message ? e.message : e);
}

async function streamLive(res, system, messages, outer) {
  let r, ctl;
  try {
    ({ resp: r, ctl } = await callLive(system, messages, true, outer));
  } catch (e) {
    const msg = errText(e);
    if (msg) sse(res, { error: msg });
    sse(res, { t: '', done: true });
    return;
  }
  if (!r.ok || !r.body) {
    const txt = await r.text().catch(() => '');
    ctl.done();
    sse(res, { error: `模型接口返回 ${r.status} ${txt.slice(0, 160)}` });
    sse(res, '[DONE]');
    return;
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
          /* chat 协议：choices[0].delta.content
             responses 协议：{type:'response.output_text.delta', delta:'…'} */
          const t = (o.choices && o.choices[0] && o.choices[0].delta && o.choices[0].delta.content)
            || (o.type === 'response.output_text.delta' ? o.delta : null);
          if (t) sse(res, { t });
        } catch (e) { /* ignore */ }
      }
    }
  } catch (e) {
    const msg = errText(e);
    if (msg) sse(res, { error: '流读取中断：' + msg });
  } finally {
    ctl.done();
  }
  sse(res, '[DONE]');
  res.end();
}

async function nonStreamLive(res, system, messages, outer) {
  let r, ctl;
  try {
    ({ resp: r, ctl } = await callLive(system, messages, false, outer));
  } catch (e) {
    const msg = errText(e);
    if (msg) sse(res, { error: msg });
    sse(res, '[DONE]');
    return;
  }
  ctl.done();

  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    sse(res, { error: `模型接口返回 ${r.status} ${txt.slice(0, 160)}` });
    sse(res, '[DONE]');
    return;
  }

  const j = await r.json().catch(() => null);
  const txt = (CFG.protocol === 'responses')
    ? responsesText(j)
    : (j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content);
  if (!txt) sse(res, { error: '模型返回为空或格式不符' });
  else sse(res, { t: txt });
  sse(res, '[DONE]');
  res.end();
}

/* ---------------- 工具 ---------------- */
function sse(res, obj) {
  if (res.writableEnded || res.destroyed) return;
  const payload = typeof obj === 'string' ? obj : JSON.stringify(obj);
  try { res.write('data: ' + payload + '\n\n'); } catch (e) { /* 客户端已断开 */ }
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve) => {
    let data = '';
    let over = false;
    req.on('data', c => {
      if (over) return;
      data += c;
      if (data.length > limit) { over = true; req.destroy(); }
    });
    req.on('end', () => {
      if (over) return resolve({});
      try { resolve(JSON.parse(data || '{}')); } catch (e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function safeConfig() {
  return {
    mode: CFG.mode, baseUrl: CFG.baseUrl, model: CFG.model, protocol: CFG.protocol,
    chatCompletionsPath: CFG.chatCompletionsPath, responsesPath: CFG.responsesPath, stream: CFG.stream,
    timeoutMs: CFG.timeoutMs, temperature: CFG.temperature, maxTokens: CFG.maxTokens,
    hasKey: !!CFG.apiKey
  };
}

/* ---------------- 路由 ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;
  const t0 = Date.now();

  // 极简访问日志：本机排错用（谁在请求面板、模型是否真的被调）
  // BT_VERBOSE=1 时连静态资源也记，用于确认悬浮窗真的把面板加载全了
  const VERBOSE = process.env.BT_VERBOSE === '1';
  res.on('finish', () => {
    if (p === '/api/health') return;
    if (!VERBOSE && (p.startsWith('/src/') || p.startsWith('/assets/'))) return;
    console.log(`[${res.statusCode}] ${req.method} ${p} ${Date.now() - t0}ms`);
  });

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (p === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: true, mode: CFG.mode,
      model: CFG.mode === 'live' ? CFG.model : null,
      provider: CFG.mode === 'live' ? CFG.baseUrl : 'mock',
      hasKey: !!CFG.apiKey
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
      if (!originAllowed(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '只接受本机页面或浏览器扩展的配置请求' }));
        return;
      }
      const patch = await readBody(req, 16 * 1024);
      const allow = ['baseUrl', 'model', 'protocol', 'chatCompletionsPath', 'responsesPath', 'stream', 'timeoutMs', 'temperature', 'maxTokens', 'mode'];

      if (typeof patch.baseUrl === 'string' && patch.baseUrl) {
        try {
          const u = new URL(patch.baseUrl);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad');
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'baseUrl 必须是 http(s) 地址' }));
          return;
        }
      }
      if (patch.mode === 'live' && !CFG.apiKey) patch.mode = 'mock';   // 没 Key 不许假装接通

      for (const k of allow) {
        if (patch[k] === undefined) continue;
        if (k === 'timeoutMs' || k === 'maxTokens') CFG[k] = Math.max(1000, Number(patch[k]) || CFG[k]);
        else if (k === 'temperature') CFG[k] = Math.min(2, Math.max(0, Number(patch[k]) || 0));
        else if (k === 'stream') CFG[k] = !!patch[k];
        else CFG[k] = patch[k];
      }
      if (CFG.mode === 'auto') CFG.mode = CFG.apiKey ? 'live' : 'mock';
      if (CFG.mode === 'live' && !CFG.apiKey) CFG.mode = 'mock';

      const out = { ...raw, ...CFG, apiKey: raw.apiKey || '' };
      try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(out, null, 2)); } catch (e) { /* ignore */ }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(safeConfig()));
      return;
    }
  }

  if (p === '/api/chat' && req.method === 'POST') {
    if (!originAllowed(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '只接受本机页面或浏览器扩展的对话请求' }));
      return;
    }

    const { system, messages, stream } = await readBody(req);
    const safeMessages = Array.isArray(messages)
      ? messages
        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-12)
        .map(m => ({ role: m.role, content: String(m.content).slice(0, 4000) }))
      : [];

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    // 学生点“停止”/关页面 → 立刻中止上游
    const clientAbort = new AbortController();
    res.on('close', () => { if (!res.writableEnded) clientAbort.abort(); });

    sse(res, { mode: CFG.mode, model: CFG.mode === 'live' ? CFG.model : null });

    if (CFG.mode === 'live') {
      if (stream === false || CFG.stream === false) await nonStreamLive(res, String(system || ''), safeMessages, clientAbort.signal);
      else await streamLive(res, String(system || ''), safeMessages, clientAbort.signal);
      return;
    }

    /* 未配置真实模型时**不做任何模拟回答**：
       以前这里会用知识库做意图匹配生成一段“看起来像回答”的文字，
       学生无法分辨那是模型说的还是规则拼的。现在直接报错，把边界说清楚。 */
    sse(res, { error: '未接入真实模型：请在 apps/model-gateway/config.json 填写 apiKey 与 model，并把 mode 设为 live。' });
    sse(res, '[DONE]');
    res.end();
    return;
  }

  serveStatic(req, res, p);
});

server.listen(CFG.port, '127.0.0.1', () => {
  const port = server.address().port;
  if (process.env.LLM_CONFIG_PATH) console.log('UNITY_GATEWAY_PORT=' + port);
  const modeText = CFG.mode === 'live' ? `真实模型（${CFG.model}）` : '未接入模型（不会回答，仅报错）';
  console.log('');
  console.log('  骨牵引智能交互组件 · 本地服务已启动');
  console.log('  ---------------------------------------------');
  console.log('  地址：http://127.0.0.1:' + port);
  console.log('  模式：' + modeText);
  console.log('  演示：http://127.0.0.1:' + port + '/demo/preview.html');
  console.log('');
});
