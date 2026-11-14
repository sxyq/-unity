/*
 * 成绩页解析（只读 DOM，不碰 token）
 * ---------------------------------------------------------------
 * 数据来源：学生在平台上「我的成绩 / 课程成绩 / 考试成绩」页面里
 * 已经渲染出来的表格或卡片。扩展只读取这些用户可见文本，
 * 不读 token、不调鉴权接口、不提交任何数据。
 *
 * 解析结果缓存到 localStorage（7 天），报告阶段可直接取用。
 *
 * 页面路由依据 REA 静态分析的平台路由表（136 条），相关的是：
 *   /MyScore、/CurriculumScore、/MyExam/ExamScores/preview、
 *   /Exam/scoreInfo、/ScoreManage、/teach/expermyment/scoremanage
 */
(function () {
  'use strict';

  const T = window.BT_TRACE;
  const CACHE_KEY = 'bt_score_cache';
  const TTL = 7 * 24 * 3600 * 1000;

  const SCORE_ROUTES = [
    /\/MyScore(\/|$|\?)/i,
    /\/CurriculumScore(\/|$|\?)/i,
    /\/MyExam\/ExamScores/i,
    /\/Exam\/scoreInfo/i,
    /\/ScoreManage(\/|$|\?)/i,
    /\/expermyment\/scoremanage/i
  ];

  function onScorePage() {
    const p = location.pathname + location.search;
    return SCORE_ROUTES.some(re => re.test(p));
  }

  function clean(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  function isScoreHeader(text) {
    return /成绩|分数|得分|评分/.test(text) && !/成绩管理|成绩分析/.test(text);
  }

  /* ---------- 表格解析 ---------- */
  function parseTables() {
    const rows = [];
    const tables = document.querySelectorAll('table');
    for (const t of tables) {
      let head = [];
      const ths = t.querySelectorAll('thead th, thead td');
      if (ths.length) head = [...ths].map(x => clean(x.innerText));

      const trs = t.querySelectorAll('tbody tr');
      const list = trs.length ? trs : t.querySelectorAll('tr');

      for (const tr of list) {
        const tds = [...tr.querySelectorAll('td')];
        if (tds.length < 2) continue;
        const cells = tds.map(x => clean(x.innerText));
        if (!cells.some(Boolean)) continue;

        // 表头行（td 版本）跳过
        if (cells.some(isScoreHeader) && cells.length === head.length) continue;

        let name = '', score = null, time = '', used = '';
        for (let i = 0; i < cells.length; i++) {
          const c = cells[i];
          const col = head[i] || '';
          if (!name && /实验|项目|课程|名称|试卷|任务/.test(col) && c) { name = c; continue; }
          if (score === null && /成绩|分数|得分|评分/.test(col)) {
            const m = c.match(/-?\d{1,3}(\.\d+)?/);
            if (m) { score = Number(m[0]); continue; }
          }
          if (!time && /\d{4}-\d{2}-\d{2}/.test(c)) { time = c; continue; }
          if (!used && /\d+\s*[′']\s*\d+\s*[″"]/.test(c)) { used = c; continue; }
        }

        // 表头缺失时的兜底
        if (score === null) {
          for (const c of cells) {
            const m = c.match(/^(\d{1,3}(\.\d+)?)\s*分?$/);
            if (m) { score = Number(m[1]); break; }
          }
        }
        if (score === null) continue;
        if (!name) name = cells.find(c => c && !/^\d/.test(c)) || '（未命名）';
        rows.push({ name: name.slice(0, 60), score, time, used });
        if (rows.length >= 30) return rows;
      }
    }
    return rows;
  }

  /* ---------- 卡片式兜底：「xx 86 分」 ---------- */
  function parseCards() {
    const rows = [];
    let text = '';
    try { text = clean(document.body.innerText); } catch (e) { return rows; }

    // 「下肢骨折骨牵引护理技术虚拟仿真实验项目 … 86 分」
    const re = /([\u4e00-\u9fa5A-Za-z0-9（）()·\-]{6,60}?)\s*(?:成绩|得分)?\s*[：:]?\s*(\d{1,3}(?:\.\d+)?)\s*分/g;
    let m;
    while ((m = re.exec(text)) && rows.length < 20) {
      const name = m[1].trim();
      if (/满分|总分|平均/.test(name)) continue;
      const score = Number(m[2]);
      if (score > 100) continue;
      rows.push({ name, score, time: '', used: '' });
    }
    return rows;
  }

  /* ---------- 汇总成一段可读文本 ---------- */
  function buildSummary(rows) {
    if (!rows.length) return null;
    const lines = rows.slice(0, 12).map((r, i) => {
      const parts = [`${i === 0 ? '记录' : '第' + (i + 1) + '条'}：${r.name}`];
      parts.push(`得分 ${r.score}`);
      if (r.used) parts.push(`用时 ${r.used}`);
      if (r.time) parts.push(r.time);
      return parts.join('，');
    });
    const avg = rows.reduce((a, b) => a + b.score, 0) / rows.length;
    return `从成绩页读到 ${rows.length} 条记录：\n${lines.join('\n')}\n平均分 ${avg.toFixed(1)}`;
  }

  function parse(force) {
    const rows = parseTables();
    const finalRows = rows.length ? rows : parseCards();
    const summary = buildSummary(finalRows);
    const payload = { at: Date.now(), url: location.href, rows: finalRows, summary };
    if (summary) {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(payload)); } catch (e) {}
      if (T) { try { T.log('score-parse', { rows: finalRows.length, page: location.pathname }); } catch (e) {} }
    }
    return summary ? payload : null;
  }

  function cached() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || !o.summary) return null;
      if (Date.now() - (o.at || 0) > TTL) return null;
      return o;
    } catch (e) { return null; }
  }

  let started = false;
  function start() {
    if (started) return;
    started = true;
    if (!onScorePage()) return;
    // 页面是异步渲染的，等表格出现后再解析一次
    let tries = 0;
    const tick = () => {
      tries++;
      const p = parse();
      if (!p && tries < 8) setTimeout(tick, 800);
    };
    setTimeout(tick, 1200);
  }

  window.BT_SCORE = { start, parse, cached, onScorePage, buildSummary };
})();
