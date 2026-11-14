/*
 * 平台接口旁听（运行在页面主世界 MAIN world）
 * ---------------------------------------------------------------
 * 目的：拿到平台"自己请求自己"的返回值，从而读到真实成绩/进度，
 *       全程**不读取、不保存、不外传 token**。
 *
 * 原理：内容脚本声明 world:"MAIN" 后与页面同处一个 JS 环境，
 *       可以包裹 window.fetch 与 XMLHttpRequest，
 *       在页面收到响应时复制一份（clone），再 postMessage 给隔离世界。
 *
 * 只旁听白名单接口；只保留结构化字段；不记录请求头与 Cookie。
 */
(function () {
  'use strict';

  const WHITELIST = [
    /\/api\/StudentCenter\/ItemsMineScore/i,
    /\/api\/ExperimentResult\/ItemsByUser/i,
    /\/api\/ExperimentResult\/Items/i,
    /\/api\/Experiment\/GetProcess/i,
    /\/api\/Experiment\/Item(\?|$)/i,
    /\/api\/Auth\/Info/i,
    /\/api\/StudentCenter\//i
  ];

  const seen = new Set();

  function hit(url) {
    try {
      const u = new URL(url, location.href);
      return WHITELIST.some((re) => re.test(u.pathname + u.search));
    } catch (e) { return false; }
  }

  function post(url, status, text) {
    if (!text || text.length > 200000) return;
    let json = null;
    try { json = JSON.parse(text); } catch (e) { return; }
    const key = url + '|' + (json && json.data ? JSON.stringify(json.data).length : 0);
    if (seen.has(key)) return;
    seen.add(key);
    try {
      window.postMessage({ __bt_api__: true, url, status, body: json }, '*');
    } catch (e) { /* ignore */ }
  }

  /* ---------- fetch ---------- */
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function () {
      const args = arguments;
      return origFetch.apply(this, args).then((resp) => {
        try {
          const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url);
          if (url && hit(url) && resp.ok) {
            resp.clone().text().then((t) => post(url, resp.status, t)).catch(() => {});
          }
        } catch (e) { /* ignore */ }
        return resp;
      });
    };
  }

  /* ---------- XMLHttpRequest ---------- */
  const XO = XMLHttpRequest.prototype.open;
  const XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) {
    this.__bt_url = u;
    return XO.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    const self = this;
    this.addEventListener('load', function () {
      try {
        if (self.__bt_url && hit(self.__bt_url)) post(self.__bt_url, self.status, self.responseText);
      } catch (e) { /* ignore */ }
    });
    return XS.apply(this, arguments);
  };
})();
