/*
 * 埋点模块（本地闭环，不上传）
 * ---------------------------------------------------------------
 * 记录：场景识别、场景切换、面板开合、提问、回答完成、错误、设置变更。
 * 每条事件都带当时的场景快照，便于事后分析「学生走到哪一步、问了什么」。
 * 存储：localStorage 环形缓冲（默认 600 条），可导出 JSON / CSV。
 * 注意：不写原系统任何数据，不向任何服务器发送。
 */
(function () {
  'use strict';

  const KEY = 'bt_trace_v1';
  const MAX = 600;

  const state = {
    sessionId: 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
    buf: [],
    listeners: [],
    scene: null
  };

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) state.buf = JSON.parse(raw) || [];
    } catch (e) { state.buf = []; }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state.buf.slice(-MAX)));
    } catch (e) { /* 存储满时忽略 */ }
  }

  function sceneSnapshot() {
    const s = state.scene;
    if (!s) return null;
    return {
      phase: s.phase || null,
      postopDay: s.postopDay || null,
      scenarioId: s.scenarioId || null,
      functionName: s.functionName || null,
      mode: s.mode || null,
      contextSource: s.contextSource || null,
      confidence: s.confidence || null
    };
  }

  function log(event, payload) {
    const rec = {
      t: Date.now(),
      iso: new Date().toISOString(),
      sid: state.sessionId,
      ev: event,
      scene: sceneSnapshot(),
      ...(payload ? { d: payload } : {})
    };
    state.buf.push(rec);
    if (state.buf.length > MAX) state.buf = state.buf.slice(-MAX);
    save();
    for (const fn of state.listeners) {
      try { fn(rec); } catch (e) { /* ignore */ }
    }
    return rec;
  }

  function setScene(scene) {
    state.scene = scene || null;
  }

  function all() {
    return state.buf.slice();
  }

  function summary() {
    const byEvent = {};
    const byScenario = {};
    for (const r of state.buf) {
      byEvent[r.ev] = (byEvent[r.ev] || 0) + 1;
      const k = (r.scene && r.scene.scenarioId) || 'unknown';
      byScenario[k] = (byScenario[k] || 0) + 1;
    }
    return {
      sessionId: state.sessionId,
      total: state.buf.length,
      byEvent,
      byScenario,
      first: state.buf[0] ? state.buf[0].iso : null,
      last: state.buf[state.buf.length - 1] ? state.buf[state.buf.length - 1].iso : null
    };
  }

  function toCSV() {
    const head = ['time', 'iso', 'session', 'event', 'phase', 'postopDay', 'scenarioId', 'functionName', 'mode', 'contextSource', 'confidence', 'data'];
    const rows = state.buf.map(r => {
      const s = r.scene || {};
      return [
        r.t, r.iso, r.sid, r.ev,
        s.phase || '', s.postopDay || '', s.scenarioId || '', s.functionName || '',
        s.mode || '', s.contextSource || '', s.confidence || '',
        r.d ? JSON.stringify(r.d).replace(/"/g, "'").replace(/,/g, ';') : ''
      ].join(',');
    });
    return [head.join(','), ...rows].join('\n');
  }

  function clear() {
    state.buf = [];
    save();
  }

  function subscribe(fn) {
    state.listeners.push(fn);
    return () => {
      state.listeners = state.listeners.filter(f => f !== fn);
    };
  }

  load();

  window.BT_TRACE = { log, setScene, all, summary, toCSV, clear, subscribe, get sessionId() { return state.sessionId; } };
})();
