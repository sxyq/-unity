/*
 * 场景适配器（与 UI 完全解耦，只读）
 * ---------------------------------------------------------------
 * 输出统一结构：
 * {
 *   phase, postopDay, taskId, taskName, scenarioId,
 *   functionName, mode, patientId, contextSource, confidence, evidence
 * }
 *
 * 证据分级（强 → 弱）：
 *   1. 页面明确阶段标注（术前阶段 / 术中阶段 / 术后阶段 / 考核评价）
 *   2. URL 中的场景参数与路由
 *   3. 页面任务条文字
 *   4. 页面已发生的业务请求（performance entries，只读取，不重放）
 * 找不到就返回 phase: null，绝不猜。
 */
(function () {
  'use strict';

  const C = window.BT_CASE;

  const { PHASE_RULES, URL_HINTS, HEAD_SELECTORS, BODY_SELECTORS } = window.BT_SCENE_RULES;

  function readRegion(doc, selector, budget) {
    let out = '';
    let used = 0;
    try {
      for (const el of doc.querySelectorAll(selector)) {
        if (used >= budget) break;
        if (el.children.length > 40) continue;
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!t || t.length > 400) continue;
        out += ' ' + t;
        used += t.length;
      }
    } catch (e) { /* 跨域忽略 */ }
    return out;
  }

  function readDoc(doc) {
    const head = (doc.title || '') + readRegion(doc, HEAD_SELECTORS.join(','), 1200);
    const body = readRegion(doc, BODY_SELECTORS.join(','), 2000);
    return { head, body };
  }

  /* ---------- 读取页面可见的成绩与进度（不碰 token、不调接口） ---------- */
  function readVisibleScores() {
    const out = { scores: [], progress: null, studyCount: null, timeUsed: null };
    let text = '';
    try { text = (document.body.innerText || '').replace(/\s+/g, ' '); } catch (e) { return out; }

    // 「2026-05-26 14:34:31 19′10″ 98」
    const re = /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+(\d+)\s*[′']\s*(\d+)\s*[″"]\s+(\d{1,3})/g;
    let m;
    while ((m = re.exec(text)) && out.scores.length < 20) {
      out.scores.push({ time: m[1], used: `${m[2]}′${m[3]}″`, score: Number(m[4]) });
    }

    const pm = text.match(/学习进度[：:]\s*(\d{1,3})\s*%/);
    if (pm) out.progress = Number(pm[1]);

    const cm = text.match(/已完成\s*(\d+)\s*次/);
    if (cm) out.studyCount = Number(cm[1]);

    const tm = text.match(/学习总用时\s*(\d+)\s*分钟/);
    if (tm) out.timeUsed = Number(tm[1]);

    return out;
  }

  /* 只读取页面已发生的资源请求，不发起、不重放 */
  function readNetworkTraces() {
    const traces = [];
    try {
      for (const e of performance.getEntriesByType('resource')) {
        const n = e.name || '';
        if (n.includes('/api/Experiment/Item')) traces.push(n);
        else if (n.includes('/api/Experiment/Launch')) traces.push(n);
        else if (n.includes('/api/ExperimentResult/')) traces.push(n);
      }
    } catch (e) { /* ignore */ }
    return traces;
  }

  /* ---------- 实验身份：从 URL 的 ?id= 读，再调同源公开接口补全 ---------- */
  let expInfo = null;
  let expLoading = false;

  function experimentIdFromUrl() {
    try {
      const u = new URL(location.href);
      const id = u.searchParams.get('id') || u.searchParams.get('experimentId');
      if (id) return id;
      // 平台也可能用路径参数
      const m = location.pathname.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      return m ? m[1] : null;
    } catch (e) { return null; }
  }

  function ensureExperimentInfo() {
    if (expInfo || expLoading) return;
    const id = experimentIdFromUrl();
    if (!id) return;
    expLoading = true;
    fetch('/api/Experiment/Item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id })
    })
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (j && j.data) {
          expInfo = {
            id: j.data.id,
            orgId: j.data.orgExperimentId,
            code: j.data.code,
            name: j.data.name,
            type: j.data.type,
            typeName: j.data.typeName,
            isScore: j.data.isScore
          };
        }
      })
      .catch(() => {})
      .finally(() => { expLoading = false; });
  }

  function collect() {
    let head = '';
    let body = '';

    const main = readDoc(document);
    head += main.head;
    body += main.body;

    let frames = document.querySelectorAll('iframe');
    for (let i = 0; i < frames.length && i < 4; i++) {
      try {
        const d = frames[i].contentDocument;
        if (d) {
          const sub = readDoc(d);
          head += sub.head;
          body += sub.body;
        }
      } catch (e) { /* 跨域 */ }
    }

    let hasCanvas = false;
    try {
      hasCanvas = !!document.querySelector('canvas');
      if (!hasCanvas) {
        for (const f of frames) {
          try { if (f.contentDocument && f.contentDocument.querySelector('canvas')) { hasCanvas = true; break; } } catch (e) {}
        }
      }
    } catch (e) { /* ignore */ }

    head = head.replace(/\s+/g, ' ').slice(0, 2400);
    body = body.replace(/\s+/g, ' ').slice(0, 3000);

    return {
      head,
      body,
      text: (head + ' ' + body).slice(0, 6000),
      hasCanvas,
      traces: readNetworkTraces()
    };
  }

  /* 从文本里读术后天数：「术后第 3 天」「术后3天」「DAY 3」 */
  function readPostopDay(text) {
    let m = text.match(/术后\s*第?\s*([1-7])\s*天/);
    if (m) return Number(m[1]);
    m = text.match(/DAY\s*([1-7])/i);
    if (m) return Number(m[1]);
    return null;
  }

  /* 在阶段内挑最匹配的场景
     顶部区域（标题/阶段栏）里出现的任务词权重更高：
     任务条会列出全部任务，只有当前任务才会出现在顶部标签里。 */
  function pickScenario(phase, head, text) {
    const list = C.scenarios.filter(s => s.phase === phase);
    if (!list.length) return null;
    let best = null, bestScore = 0;
    for (const s of list) {
      let score = 0;
      for (const t of s.tags) {
        if (head.includes(t)) score += t.length * 4;
        else if (text.includes(t)) score += 1;
      }
      if (score > bestScore) { bestScore = score; best = s; }
    }
    if (best) return { scenario: best, score: bestScore };
    // 该阶段没有任何标签命中时，若只有一个场景则直接选它，否则交给 UI 让用户选
    return list.length === 1 ? { scenario: list[0], score: 0 } : null;
  }

  function detect() {
    const { head, body, text, hasCanvas, traces } = collect();
    ensureExperimentInfo();
    const score = { preop: 0, intraop: 0, postop: 0, report: 0 };
    const explicit = { preop: false, intraop: false, postop: false, report: false };
    const evidence = [];

    // 实验介绍页（CourseInfo / 详情页）不是"实验进行中"：
    // 描述文字里出现"考核/并发症/术中"会造成高可信误判，这里只认强步骤标记。
    const isIntroPage = /\/CourseInfo(\?|$)|\/Experiment\/Detail(\?|$)/i.test(location.pathname);
    const hasStepMark = /第\s*\d+\s*步|术中阶段|术前阶段|术后第\s*\d+\s*天|\d+\s*\/\s*10/.test(text);
    if (isIntroPage && !hasStepMark) {
      evidence.push('实验介绍页，不做阶段推断');
    }

    for (const rule of (isIntroPage && !hasStepMark ? [] : PHASE_RULES)) {
      for (const w of rule.primary) {
        if (text.includes(w)) { score[rule.phase] += 5; explicit[rule.phase] = true; evidence.push('阶段标注「' + w + '」'); }
      }
      let n = 0;
      for (const w of rule.secondary) {
        if (text.includes(w) && n < 2) { score[rule.phase] += 1; n++; evidence.push('场景词「' + w + '」'); }
      }
    }

    for (const h of URL_HINTS) {
      if (h.test.test(location.href) && score[h.phase] === 0) { score[h.phase] += 1; evidence.push('URL 特征'); break; }
    }

    let phase = null, best = 0, bestExplicit = false;
    for (const k of ['preop', 'intraop', 'postop', 'report']) {
      if (score[k] === 0) continue;
      if ((explicit[k] && !bestExplicit) || (explicit[k] === bestExplicit && score[k] > best)) {
        phase = k; best = score[k]; bestExplicit = explicit[k];
      }
    }

    let confidence = phase ? (bestExplicit ? 'high' : best >= 2 ? 'medium' : 'low') : 'none';
    let contextSource = 'page';

    // 平台桥接：实验内容通过 postMessage 上报过步骤/成绩
    const pageData = readVisibleScores();

    const bridge = window.BT_BRIDGE ? window.BT_BRIDGE.snapshot() : null;
    if (bridge && bridge.active) {
      evidence.push('收到实验事件 ' + bridge.stepCount + ' 条');
      if (!phase) { contextSource = 'bridge'; confidence = 'medium'; }
      else if (confidence === 'low') confidence = 'medium';
    }

    if (pageData.scores.length) evidence.push('页面成绩 ' + pageData.scores.length + ' 条');

    // 业务请求痕迹（只读）
    if (traces.length) {
      evidence.push('检测到 ' + traces.length + ' 条实验相关请求');
      if (phase && confidence !== 'high') { confidence = 'medium'; contextSource = 'api'; }
    }

    const postopDay = phase === 'postop' ? readPostopDay(text) : null;

    let scenario = null;
    if (phase) {
      const picked = pickScenario(phase, head, text);
      if (picked) {
        scenario = picked.scenario;
        if (picked.score > 0) evidence.push('任务词匹配「' + scenario.taskName + '」');
      }
    }

    // 模式：考核字样出现即视为考核，报告阶段默认考核
    let mode = null;
    if (isIntroPage && !hasStepMark) mode = null;
    else if (phase === 'report') mode = 'exam';
    else if (/考核模式|考试模式|提交试卷|答题/.test(text)) { mode = 'exam'; evidence.push('考核模式词'); }
    else if (phase) mode = 'study';

    return {
      phase,
      postopDay,
      experiment: expInfo,
      pageData: (pageData.scores.length || pageData.progress !== null) ? pageData : null,
      bridge: bridge && bridge.active ? { stepCount: bridge.stepCount, lastKind: bridge.lastKind } : null,
      taskId: scenario ? scenario.id : null,
      taskName: scenario ? scenario.taskName : null,
      scenarioId: scenario ? scenario.id : null,
      functionName: scenario ? scenario.functionName : null,
      mode,
      patientId: C.patient.id,
      contextSource,
      confidence,
      evidence: [...new Set(evidence)].slice(0, 6),
      hasCanvas
    };
  }

  /* 轮询 + 变化回调 */
  function start(onChange, intervalMs) {
    let last = '';
    let timer = null;
    let stopped = false;

    const tick = () => {
      if (stopped) return;
      let r;
      try { r = detect(); } catch (e) { r = { phase: null, confidence: 'none', evidence: [] }; }
      const key = [
        r.phase, r.postopDay, r.scenarioId, r.mode, r.confidence,
        r.bridge ? 'b' : '-',
        r.experiment ? r.experiment.id : '-'
      ].join('|');
      if (key !== last) { last = key; onChange(r); }
      timer = setTimeout(tick, intervalMs || 1500);
    };

    const reset = () => { last = ''; };
    window.addEventListener('popstate', reset);
    window.addEventListener('hashchange', reset);
    document.addEventListener('visibilitychange', reset);

    tick();

    return function stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('popstate', reset);
      window.removeEventListener('hashchange', reset);
      document.removeEventListener('visibilitychange', reset);
    };
  }

  window.BT_SCENE = { detect, start };
})();
