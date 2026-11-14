/*
 * 平台桥接（postMessage 协议解析）
 * ---------------------------------------------------------------
 * 依据：平台学习页 BaseLearning 组件里有一段 window.addEventListener("message", ...)
 * 的处理逻辑，实验内容（iframe 内的 Unity 页面 / 客户端网页壳）用它向平台上报：
 *
 *   "…///<data>"   → 平台调用 ScormDataUpload（步骤上报）
 *   "…***<json>"   → 平台调用 JsDataUpload（结果/成绩上报，JSON）
 *   "…$$$"         → 平台刷新实验信息
 *   "…￥￥￥"       → 平台刷新成绩
 *   "…~~~"         → 平台重置计时
 *
 * 我们只“旁听”这些同源消息，不拦截、不修改、不伪造，也不主动发送。
 * 有了它，在 iframe / 网页壳形态下就能拿到真实的步骤与成绩信号。
 */
(function () {
  'use strict';

  const T = window.BT_TRACE;

  const state = {
    active: false,
    lastAt: 0,
    lastKind: null,
    stepCount: 0,
    lastStep: null,
    lastResult: null,
    log: []
  };

  const ACTIVE_WINDOW = 5 * 60 * 1000; // 5 分钟内收到过消息才算“活着”

  function push(rec) {
    state.active = true;
    state.lastAt = Date.now();
    state.lastKind = rec.kind;
    state.log.push(rec);
    if (state.log.length > 50) state.log = state.log.slice(-50);
    if (T) {
      try { T.log('bridge', { kind: rec.kind, size: rec.raw ? String(rec.raw).length : 0 }); } catch (e) {}
    }
  }

  /* 尽量从字符串里读出结构化信息，读不出就保留原文 */
  function parseLoose(text) {
    const s = String(text || '').trim();
    if (!s) return null;
    if (s[0] === '{' || s[0] === '[') {
      try { return JSON.parse(s); } catch (e) { /* 继续 */ }
    }
    try {
      const dec = decodeURIComponent(s);
      if (dec !== s && (dec[0] === '{' || dec[0] === '[')) return JSON.parse(dec);
    } catch (e) { /* 继续 */ }
    return null;
  }

  /* 从任意对象里捞出可能表示“分数/步骤/场景”的字段 */
  function extract(obj) {
    if (!obj || typeof obj !== 'object') return {};
    const out = {};
    const keys = Object.keys(obj);
    const pick = (names) => {
      for (const n of names) {
        for (const k of keys) {
          if (k.toLowerCase() === n) return obj[k];
        }
      }
      return undefined;
    };
    const score = pick(['score', 'totalscore', 'grade', 'result']);
    if (score !== undefined) out.score = Number(score);
    const step = pick(['step', 'stepindex', 'stepno', 'stepnumber', 'currentstep']);
    if (step !== undefined) out.step = Number(step);
    const total = pick(['steptotal', 'totalstep', 'steps', 'total']);
    if (total !== undefined) out.total = Array.isArray(total) ? total.length : Number(total);
    const scene = pick(['sceneid', 'scene', 'taskid', 'task']);
    if (scene !== undefined) out.scene = scene;
    const day = pick(['day', 'postopday']);
    if (day !== undefined) out.day = Number(day);
    return out;
  }

  function handle(e) {
    const d = e.data;
    if (typeof d !== 'string' || d.length > 20000) return;

    if (d.indexOf('///') !== -1) {
      const raw = d.split('///')[1];
      const parsed = parseLoose(raw);
      const rec = { kind: 'step', at: Date.now(), raw, parsed, meta: extract(parsed) };
      state.stepCount++;
      state.lastStep = rec;
      push(rec);
      return;
    }
    if (d.indexOf('***') !== -1) {
      const raw = d.split('***')[1];
      const parsed = parseLoose(raw);
      const rec = { kind: 'result', at: Date.now(), raw, parsed, meta: extract(parsed) };
      state.lastResult = rec;
      push(rec);
      return;
    }
    if (d.indexOf('$$$') !== -1) { push({ kind: 'reload-info', at: Date.now() }); return; }
    if (d.indexOf('￥￥￥') !== -1) { push({ kind: 'reload-score', at: Date.now() }); return; }
    if (d.indexOf('~~~') !== -1) { push({ kind: 'reset-timer', at: Date.now() }); return; }
  }

  function isActive() {
    return state.active && (Date.now() - state.lastAt) < ACTIVE_WINDOW;
  }

  function snapshot() {
    return {
      active: isActive(),
      stepCount: state.stepCount,
      lastKind: state.lastKind,
      lastStep: state.lastStep ? { meta: state.lastStep.meta, parsed: state.lastStep.parsed, raw: String(state.lastStep.raw).slice(0, 200) } : null,
      lastResult: state.lastResult ? { meta: state.lastResult.meta, parsed: state.lastResult.parsed } : null
    };
  }

  /* 成绩对象（若平台上报里带 steps 数组，也一并保留） */
  function getScorePayload() {
    const r = state.lastResult;
    if (!r || !r.parsed) return null;
    return r.parsed;
  }

  function start() {
    window.addEventListener('message', handle, false);
    // 同源 iframe 的 postMessage 会到达这里；跨域也一样（postMessage 本就跨域）
  }


  /* ------------------------------------------------------------------
   * 平台接口旁听结果（来自 MAIN world 的 api-capture.js）
   * 只存结构化字段：成绩、进度、实验身份。不含 token、Cookie、请求头。
   * ------------------------------------------------------------------ */
  const api = { scores: [], process: null, experiment: null, updatedAt: 0 };

  function normScores(body) {
    const out = [];
    const d = body && body.data;
    if (!d) return out;
    // ItemsMineScore: { data: { data: [ {experimentName, score, timeUsed, endTime} ] } }
    const list = Array.isArray(d) ? d : (Array.isArray(d.data) ? d.data : (Array.isArray(d.items) ? d.items : null));
    if (!list) return out;
    for (const it of list.slice(0, 30)) {
      if (!it || typeof it !== 'object') continue;
      const score = Number(it.score != null ? it.score : it.totalScore);
      if (!Number.isFinite(score)) continue;
      out.push({
        name: it.experimentName || it.name || '',
        score,
        used: it.timeUsed != null ? Math.round(Number(it.timeUsed) / 60) + '′' : '',
        time: it.endTime || it.createTime || ''
      });
    }
    return out;
  }

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (d && d.__bt_poll__ === true && d.process) {
      api.process = d.process;
      api.updatedAt = Date.now();
      if (typeof window.__btOnProgress === 'function') window.__btOnProgress(d.process);
      return;
    }
    if (!d || d.__bt_api__ !== true) return;
    const url = String(d.url || '');
    const body = d.body;
    api.updatedAt = Date.now();

    if (/ItemsMineScore|ItemsByUser|ExperimentResult\/Items/i.test(url)) {
      const rows = normScores(body);
      if (rows.length) api.scores = rows;
    }
    if (/GetProcess/i.test(url) && body && body.data) {
      api.process = {
        ppv: body.data.ppv,
        studyeds: body.data.studyeds,
        timeUsed: body.data.timeUsed
      };
    }
    if (/\/api\/Experiment\/Item(\?|$)/i.test(url) && body && body.data) {
      api.experiment = {
        id: body.data.id, name: body.data.name, type: body.data.type,
        typeName: body.data.typeName, code: body.data.code
      };
    }
  }, false);

  function apiSnapshot() {
    return {
      active: api.scores.length > 0 || !!api.process,
      scores: api.scores.slice(0, 10),
      process: api.process,
      experiment: api.experiment,
      updatedAt: api.updatedAt
    };
  }

  window.BT_BRIDGE = { start, isActive, snapshot, getScorePayload, apiSnapshot, state };
})();
