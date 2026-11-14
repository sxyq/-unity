/*
 * Web 版运行时垫片（服务端植入专用）
 * ---------------------------------------------------------------
 * 浏览器扩展里有 chrome.runtime（取资源 URL + 长连接后台）；
 * 直接注入网页时没有这些 API，这里用等价实现顶上：
 *
 *   chrome.runtime.getURL(p)  → /mengoo/__ai/p
 *   chrome.runtime.connect()  → 一个假 Port，用 fetch + SSE 直连
 *                               /mengoo/__ai/api/chat
 *
 * 协议与 background.js 完全一致：chunk / done / aborted / error / health。
 * 这样 ui.js、main.js 一行都不用改，扩展与服务端注入共用同一套前端。
 */
(function () {
  'use strict';

  const WEB = window.__BT_WEB__ || {};
  const BASE = WEB.base || '/mengoo/__ai';
  const API = WEB.api || (BASE + '/api');

  if (window.chrome && window.chrome.runtime && window.chrome.runtime.connect) return;

  function sseParse(chunk, onEvent) {
    // 与 background.js 相同的解析规则：按空行分帧，只认 data: 行
    let buffer = chunk;
    return {
      push(text) {
        buffer += text;
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of raw.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            if (payload === '[DONE]') { onEvent({ done: true }); continue; }
            try { onEvent(JSON.parse(payload)); } catch (e) { /* 坏帧忽略 */ }
          }
        }
      }
    };
  }

  function createPort() {
    const msgListeners = [];
    const discListeners = [];
    const inflight = new Map(); // id -> AbortController
    let closed = false;

    const port = {
      postMessage(msg) {
        if (closed) return;
        if (msg.type === 'health') { probeHealth(); return; }
        if (msg.type === 'cancel') {
          const c = inflight.get(msg.id);
          if (c) { c.abort(); inflight.delete(msg.id); }
          return;
        }
        if (msg.type === 'chat') { chat(msg); return; }
      },
      onMessage: { addListener(f) { msgListeners.push(f); } },
      onDisconnect: { addListener(f) { discListeners.push(f); } },
      disconnect() { closed = true; discListeners.forEach(f => { try { f(); } catch (e) {} }); },
      _emit(m) { if (closed) return; msgListeners.forEach(f => { try { f(m); } catch (e) {} }); }
    };

    async function probeHealth() {
      try {
        const r = await fetch(API + '/health', { cache: 'no-store', credentials: 'same-origin' });
        if (!r.ok) { port._emit({ type: 'health', health: { mode: 'offline' } }); return; }
        port._emit({ type: 'health', health: await r.json() });
      } catch (e) {
        port._emit({ type: 'health', health: { mode: 'offline' } });
      }
    }

    async function chat(msg) {
      const id = msg.id || Date.now();
      const ctrl = new AbortController();
      inflight.set(id, ctrl);

      let resp;
      try {
        resp = await fetch(API + '/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ system: msg.system, messages: msg.messages, stream: msg.stream !== false }),
          signal: ctrl.signal
        });
      } catch (e) {
        inflight.delete(id);
        if (e.name === 'AbortError') { port._emit({ type: 'aborted', id }); return; }
        port._emit({ type: 'error', id, message: '无法连接智能服务（' + API + '）' });
        return;
      }

      if (!resp.ok || !resp.body) {
        inflight.delete(id);
        port._emit({ type: 'error', id, message: '智能服务返回 ' + resp.status });
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      const parser = sseParse('', (obj) => {
        if (obj.done) { port._emit({ type: 'done', id }); return; }
        if (obj.t) port._emit({ type: 'chunk', id, text: obj.t });
        if (obj.error) port._emit({ type: 'error', id, message: obj.error });
        if (obj.mode) port._emit({ type: 'health', health: { mode: obj.mode, model: obj.model } });
      });

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.push(decoder.decode(value, { stream: true }));
        }
      } catch (e) {
        if (e.name === 'AbortError') { port._emit({ type: 'aborted', id }); inflight.delete(id); return; }
        port._emit({ type: 'error', id, message: e.message || '流读取失败' });
        inflight.delete(id);
        return;
      }

      inflight.delete(id);
      port._emit({ type: 'done', id });
    }



    // 服务端模式：轮询客户端状态代理（service.mjs 转发到本机 8790）
    let lastState = '';
    setInterval(async () => {
      try {
        const r = await fetch(API + '/state', { cache: 'no-store', credentials: 'same-origin' });
        if (!r.ok) return;
        const st = await r.json();
        const key = String(st && st.phase) + '|' + String(st && st.postopDay) + '|' + String(st && st.confidence);
        if (key === lastState) return;
        lastState = key;
        port._emit({ type: 'client-state', state: st });
      } catch (e) { /* 代理没开 */ }
    }, 4000);

    return port;
  }

  window.chrome = window.chrome || {};
  window.chrome.runtime = {
    id: 'gouqianyin-server-hook',
    getURL(p) { return BASE + '/' + String(p).replace(/^\/+/, ''); },
    connect() { return createPort(); },
    lastError: null
  };
})();
