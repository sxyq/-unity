/*
 * 平台实时状态轮询（MAIN world）
 * ---------------------------------------------------------------
 * 背景：平台的 /api/Experiment/GetProcess 会返回**当前用户**的
 *       { ppv 学习进度, studyeds 完成次数, timeUsed 累计用时 }，
 *       但页面只在进入时拉一次，之后不再更新 —— 学生进客户端做实验时，
 *       网页上的"学习进度"永远停在 0%。
 *
 * 本脚本做两件事：
 *   1. 在页面自己发请求时，从请求头里拿到它自己的 token（只放内存，不落盘、不外传）
 *   2. 每 8 秒用这个 token 调一次 GetProcess，把结果 postMessage 给隔离世界
 *
 * 不读 Cookie，不写任何平台数据，退出页面即失效。
 */
(function () {
  'use strict';

  let token = '';
  let expId = '';
  const dbg = window.__btPollDbg = { token: false, expId: '', calls: 0, last: null };

  function currentExpId() {
    try {
      const u = new URL(location.href);
      return u.searchParams.get('id') || u.searchParams.get('experimentId') || '';
    } catch (e) { return ''; }
  }

  /* ---------- 从页面自己的请求头里取 token ---------- */
  const XO = XMLHttpRequest.prototype.open;
  const SH = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (m, u) {
    this.__bt_url = u;
    if (!expId && /\/CourseInfo|\/Experiment/i.test(String(u))) expId = currentExpId();
    return XO.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    if (String(k).toLowerCase() === 'token' && v) token = String(v);
    return SH.apply(this, arguments);
  };

  const of = window.fetch;
  if (of) {
    window.fetch = function (input, init) {
      try {
        const h = init && init.headers;
        if (h) {
          if (typeof h.get === 'function') { const t = h.get('token'); if (t) token = t; }
          else if (Array.isArray(h)) h.forEach(([k, v]) => { if (String(k).toLowerCase() === 'token' && v) token = v; });
          else Object.keys(h).forEach((k) => { if (k.toLowerCase() === 'token' && h[k]) token = h[k]; });
        }
      } catch (e) { /* ignore */ }
      return of.apply(this, arguments);
    };
  }

  /* ---------- 轮询 ---------- */
  async function poll() {
    expId = expId || currentExpId();
    dbg.token = !!token; dbg.expId = expId;
    if (!token || !expId) return;
    try {
      const r = await fetch('/api/Experiment/GetProcess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', token },
        body: JSON.stringify({ id: expId })
      });
      if (!r.ok) return;
      const j = await r.json();
      if (!j || !j.data) return;
      dbg.calls++; dbg.last = j.data;
      window.postMessage({
        __bt_poll__: true,
        id: expId,
        process: { ppv: j.data.ppv, studyeds: j.data.studyeds, timeUsed: j.data.timeUsed }
      }, '*');
    } catch (e) { /* 网络抖动忽略 */ }
  }

  setInterval(poll, 8000);
  setTimeout(poll, 2500);
})();
