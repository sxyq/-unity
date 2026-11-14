/*
 * 预览用垫片：让扩展的 content script 能在普通网页里运行
 * 仅在 demo/preview.html 中使用，真实安装扩展时不会加载本文件。
 */
(function () {
  if (window.chrome && window.chrome.runtime && window.chrome.runtime.id) return; // 已装扩展，不覆盖

  // demo 页面位于 /demo/ 下，扩展源码在上一层；以前写成 '../extension/' 会 404
  const BASE = '../';

  function emit(listeners, msg) {
    for (const fn of listeners) {
      try { fn(msg); } catch (e) { console.warn(e); }
    }
  }

  function parseSSE(chunk, onEvent) {
    let buf = chunk;
    return {
      push(text) {
        buf += text;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, i);
          buf = buf.slice(i + 2);
          for (const line of raw.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const p = line.slice(5).trim();
            if (!p) continue;
            if (p === '[DONE]') { onEvent({ done: true }); continue; }
            try { onEvent(JSON.parse(p)); } catch (e) { /* ignore */ }
          }
        }
      }
    };
  }

  window.chrome = window.chrome || {};
  window.chrome.runtime = {
    id: 'preview-shim',
    getURL(p) { return BASE + p; },
    connect() {
      const listeners = [];
      return {
        onMessage: { addListener(fn) { listeners.push(fn); } },
        onDisconnect: { addListener() {} },
        postMessage(msg) {
          if (msg.type === 'health') {
            fetch('/api/health')
              .then(r => r.json())
              .then(h => emit(listeners, { type: 'health', health: h }))
              .catch(() => emit(listeners, { type: 'health', health: { mode: 'offline' } }));
            return;
          }
          if (msg.type !== 'chat') return;

          fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ system: msg.system, messages: msg.messages })
          }).then(async res => {
            if (!res.ok || !res.body) {
              emit(listeners, { type: 'error', message: '本地服务返回 ' + res.status });
              return;
            }
            const reader = res.body.getReader();
            const dec = new TextDecoder('utf-8');
            const parser = parseSSE('', (ev) => {
              if (ev.done) { emit(listeners, { type: 'done' }); return; }
              if (ev.t) emit(listeners, { type: 'chunk', text: ev.t });
              if (ev.error) emit(listeners, { type: 'error', message: ev.error });
              if (ev.mode) emit(listeners, { type: 'health', health: { mode: ev.mode, model: ev.model } });
            });
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              parser.push(dec.decode(value, { stream: true }));
            }
            emit(listeners, { type: 'done' });
          }).catch(e => emit(listeners, { type: 'error', message: e.message }));
        }
      };
    }
  };
})();
