/*
 * MV3 后台：本地模型代理转发 + 流式回传 + 取消
 * API Key 只存在于本地 proxy/config.json，扩展内不含任何密钥。
 */
'use strict';

const ENDPOINT = 'http://127.0.0.1:8787';
// 客户端状态采集代理（Windows 端 / 本地测试）
const CLIENT_AGENT = 'http://127.0.0.1:8790';
globalThis.__btDbg = { push: 0, ok: 0, phase: null, err: null };

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'bt-chat') return;

  const inflight = new Map(); // id -> AbortController

  // 连上就推一次，之后每 3 秒推一次客户端状态（拿不到就推 none）
  let timer = null;
  const pushClient = async () => {
    let state = { ok: false, phase: null, confidence: 'none' };
    globalThis.__btDbg.push++;
    try {
      const r = await fetch(CLIENT_AGENT + '/state', { cache: 'no-store' });
      if (r.ok) { state = await r.json(); globalThis.__btDbg.ok++; globalThis.__btDbg.phase = state.phase; }
    } catch (e) { globalThis.__btDbg.err = String(e && e.message || e); }
    safePost(port, { type: 'client-state', state });
  };
  pushClient();
  timer = setInterval(pushClient, 3000);

  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'health') {
      safePost(port, { type: 'health', health: await probeHealth() });
      return;
    }

    if (msg.type === 'cancel') {
      const c = inflight.get(msg.id);
      if (c) { c.abort(); inflight.delete(msg.id); }
      return;
    }

    if (msg.type === 'chat') {
      const id = msg.id || Date.now();
      const ctrl = new AbortController();
      inflight.set(id, ctrl);
      try {
        await streamChat(port, id, msg, ctrl);
      } catch (e) {
        safePost(port, { type: 'error', id, message: String(e && e.message ? e.message : e) });
      } finally {
        inflight.delete(id);
      }
    }
  });

  port.onDisconnect.addListener(() => {
    if (timer) clearInterval(timer);
    for (const c of inflight.values()) c.abort();
    inflight.clear();
  });
});

function safePost(port, payload) {
  try { port.postMessage(payload); } catch (e) { /* 页面已关闭 */ }
}

async function probeHealth() {
  try {
    const r = await fetch(ENDPOINT + '/api/health', { cache: 'no-store' });
    if (!r.ok) return { mode: 'offline' };
    return await r.json();
  } catch (e) {
    return { mode: 'offline' };
  }
}

async function streamChat(port, id, msg, ctrl) {
  let resp;
  try {
    resp = await fetch(ENDPOINT + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system: msg.system, messages: msg.messages, stream: msg.stream !== false }),
      signal: ctrl.signal
    });
  } catch (e) {
    if (e.name === 'AbortError') { safePost(port, { type: 'aborted', id }); return; }
    safePost(port, { type: 'error', id, message: '无法连接本地服务 127.0.0.1:8787，请先运行 proxy/server.mjs' });
    return;
  }

  if (!resp.ok || !resp.body) {
    safePost(port, { type: 'error', id, message: '本地服务返回 ' + resp.status });
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of raw.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          if (payload === '[DONE]') { safePost(port, { type: 'done', id }); return; }
          try {
            const obj = JSON.parse(payload);
            if (obj.t) safePost(port, { type: 'chunk', id, text: obj.t });
            if (obj.error) safePost(port, { type: 'error', id, message: obj.error });
            if (obj.mode) safePost(port, { type: 'health', health: { mode: obj.mode, model: obj.model } });
          } catch (e) { /* 坏帧忽略 */ }
        }
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') { safePost(port, { type: 'aborted', id }); return; }
    safePost(port, { type: 'error', id, message: e.message || '流读取失败' });
    return;
  }

  safePost(port, { type: 'done', id });
}
