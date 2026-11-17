/*
 * 入口：延迟挂载，避免与原系统首屏渲染争抢
 */
(function () {
  'use strict';

  /* 本机端口：只在本机页面看起来像“骨牵引实验”时才挂载，避免污染其它本地页面 */
  function shouldMount() {
    const host = location.hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') return true;   // 校内域名直接挂
    if (location.port === '8787') return true;                        // 本地演示站
    const title = document.title || '';
    if (/骨牵引|创伤骨科|虚拟仿真/.test(title)) return true;
    try {
      const head = (document.body.innerText || '').slice(0, 2000);
      if (document.querySelector('canvas') && /骨牵引|牵引重量|术中阶段/.test(head)) return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  function boot() {
    if (!shouldMount()) return;
    try {
      window.BT_UI.mount();
    } catch (e) {
      console.warn('[智能助教] 挂载失败：', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 800), { once: true });
  } else {
    setTimeout(boot, 800);
  }

  // Alt+A 快速开合（不与原系统常用快捷键冲突）
  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'a' || e.key === 'A')) {
      const host = document.getElementById('bt-assistant-host');
      if (!host || !host.shadowRoot) return;
      const panel = host.shadowRoot.querySelector('.bt-panel');
      const launcher = host.shadowRoot.querySelector('.bt-launcher');
      if (panel && !panel.classList.contains('bt-hidden')) {
        launcher.classList.remove('bt-hidden');
        panel.classList.add('bt-hidden');
        host.shadowRoot.querySelector('.bt-mini').classList.add('bt-hidden');
      } else {
        panel.classList.remove('bt-hidden');
        launcher.classList.add('bt-hidden');
      }
    }
  });
})();
