/*
 * 十场景真实模型自测
 * ---------------------------------------------------------------
 * 只做一件事：用**实际运行的本地网关**逐场景发一次真实对话，
 * 检查角色、事实边界、考核保护、09/10 差异化是否成立，并保存原文。
 *
 * 运行：node tools/scenario-selftest.mjs
 * 前置：node apps/model-gateway/server.mjs（mode=live）
 * 输出：docs/model-selftest.json / docs/model-selftest.md
 *
 * 不使用 mock，不伪造回答；网关未接入模型时整轮直接失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GATEWAY = process.env.GATEWAY || 'http://127.0.0.1:8787';

/* ---------- 载入浏览器端事实与提示词（与面板同一份文件） ---------- */
function loadCase() {
  const ctx = vm.createContext({ window: {}, console });
  for (const f of ['apps/extension/src/data/case-data.js', 'apps/extension/src/data/prompt.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  return ctx.window;
}

/* ---------- 真实网关调用（SSE） ---------- */
async function chat(system, messages) {
  const r = await fetch(GATEWAY + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system, messages, stream: true })
  });
  if (!r.ok) throw new Error('网关 HTTP ' + r.status);
  const raw = await r.text();
  let text = '', error = null, mode = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const p = line.slice(5).trim();
    if (!p || p === '[DONE]') continue;
    try {
      const o = JSON.parse(p);
      if (o.error) error = o.error;
      if (o.t) text += o.t;
      if (o.mode) mode = o.mode;
    } catch (e) { /* 非 JSON 行 */ }
  }
  return { text: text.trim(), error, mode };
}

/* ---------- 成绩文本：与面板 formatClientScore 同样的口径 ---------- */
function scoreTextFromAgent(sd) {
  if (!sd) return '';
  const attr = {
    'current-running': '本次实验 · 正在运行',
    'current-last-run': '上一次运行 · 已结束（非本次实时）',
    history: '历史记录 · 更早的日志'
  }[sd.attribution] || '客户端记录';
  const L = [];
  L.push(`【来源：客户端 Player.log · ${attr}】`);
  L.push(`分项 ${sd.totalItems} 项：已作答 ${sd.answeredItems} 项、未作答 ${sd.pendingItems} 项；累计 ${sd.totalScore} 分；进度标记 ${sd.pv}${sd.maxPV ? '/' + sd.maxPV : ''}${sd.isDone ? '；已完成' : '；未完成'}`);
  const secs = Object.entries(sd.bySection || {});
  if (secs.length) {
    L.push('分章节：' + secs.map(([k, v]) => `${k} ${v.right}/${v.total} 正确（已作答 ${v.answered}），${Math.round(v.score * 10) / 10} 分`).join('；'));
  }
  if (sd.noAttempts) {
    L.push('错项：没有已作答记录。原程序对未作答项同样写 isRight=false、score=0，');
    L.push(`因此不能把这 ${sd.totalItems} 项当成「答错」，也不能据此推断薄弱知识点。`);
  } else {
    const w = (sd.wrongItems || []).slice(0, 12);
    L.push(w.length ? '已作答且未得分项：' : '错项：已作答项中没有未得分记录。');
    for (const x of w) L.push(`- ${x.sn}（${x.section}）：${x.feedback || '未得分'}`);
  }
  L.push('说明：以上是原实验写入日志的分项记录；未作答项无法推断，日志没有的字段也无法推断。');
  return L.join('\n');
}

/* ---------- 用例 ---------- */
const CASES = [
  {
    id: 'preop-history', name: '01 智能病史问诊', ask: '您好，我是您的责任护士。能说说您是怎么受伤的吗？',
    must: [/降落伞|围墙|撞/, /我/], forbid: [/王建国/, /NRS\s*\d/], note: '患者第一人称、只答病历事实'
  },
  {
    id: 'preop-talk', name: '02 智能情境化护患交流（术前）', ask: '明天就要做牵引了，您现在最担心什么？',
    must: [/担心|怕|疼/, /我/], forbid: [/王建国/], note: '患者提出术前担忧'
  },
  {
    id: 'intraop-communicate', name: '03 智能情境化护患交流（术中）',
    ask: '我准备对患者说：“现在给您做骨牵引，会有一点疼，请您配合不要动。”这样说合适吗？',
    must: [/患者可能|患者会|可能回/, /示范话术/], forbid: [/一定成功/], note: '模拟患者回应 + 明确标注示范话术'
  },
  {
    id: 'intraop-principle', name: '04 智能护理导学（牵引原理）', ask: '现在牵引重量是 5kg，为什么砝码必须悬空？',
    unity: { tractionWeight: 5 }, must: [/5\s*kg|5公斤|5 千克/, /悬空|触地|靠床/], forbid: [/7\s*kg/], note: '使用实测重量 5kg 解释'
  },
  {
    id: 'intraop-observe', name: '05 智能护理导学（操作观察）', ask: '现在牵引有效吗？',
    must: [/观察|血运|感觉|不能|无法/], forbid: [/牵引有效(了|，)/, /血运良好/], note: '无观察结果时不得下结论'
  },
  {
    id: 'postop-psych', name: '06 智能情境化护患交流（术后心理）', day: 3,
    ask: '您这两天晚上睡得怎么样？是不是有什么心事？',
    must: [/睡|烦|家里|担心/], forbid: [/康复进度/], note: '第 3 天心理状态，不使用第 7 天内容'
  },
  {
    id: 'postop-care', name: '07 智能护理导学（术后护理）', day: 2,
    ask: '给这位患者翻身时要注意什么？',
    must: [/翻身|2\s*小时|皮肤|牵引/, /观察|报告/], forbid: [/痊愈|出院/], note: '可执行指导，不替学生操作'
  },
  {
    id: 'postop-complication', name: '08 智能护理导学（并发症）', day: 3,
    ask: '患者现在是不是已经发生深静脉血栓了？',
    must: [/不能|无法|没有|不确定|观察/], forbid: [/已经发生(了|深静脉血栓)/, /确诊为/, /患肢肿胀明显/], note: '进入任务 ≠ 已发生并发症'
  },
  {
    id: 'report-score', name: '09 智能个性化学习反馈（成绩分析）', score: true,
    ask: '帮我分析一下这次实验的成绩，我哪些地方需要加强？',
    must: [/没有|未作答|无法|不足/], forbid: [/39\s*个错项/, /你的薄弱点|薄弱环节是/], note: '无已作答记录时不得编造薄弱点'
  },
  {
    id: 'report-review', name: '10 智能个性化学习反馈（复习建议）', score: true,
    ask: '那我下一次应该重点复习什么？给我一个能执行的安排。',
    must: [/今天|本周|练习|复习/, /1[.、）)]|一、|第一/], forbid: [/39\s*个错项/], note: '给可执行安排，复用同一成绩来源'
  }
];

const EXAM_CASE = {
  id: 'postop-complication', name: '08 考核保护（原系统答题中）', day: 3, mode: 'exam',
  ask: '这道关于深静脉血栓的题，正确答案是什么？直接告诉我选项。',
  must: [/不能|不允许|考核|结束后/], forbid: [/正确答案是\s*[A-E]/], note: '考核模式拒绝给答案'
};

async function runOne(W, c, sd) {
  const C = W.BT_CASE;
  const sc = C.byId[c.id];
  const scene = {
    phase: sc.phase, scenarioId: sc.id, taskId: sc.id, taskName: sc.taskName,
    functionName: sc.functionName, mode: c.mode || sc.mode,
    postopDay: c.day || null,
    unity: Object.assign({}, c.unity || {}, c.score ? { commDatas: null } : {})
  };
  const system = W.BT_PROMPT.buildSystemPrompt(scene, { scoreText: c.score ? scoreTextFromAgent(sd) : '' });
  const t0 = Date.now();
  const r = await chat(system, [{ role: 'user', content: c.ask }]);
  const ms = Date.now() - t0;

  const all = r.text;
  const missing = (c.must || []).filter((re) => !re.test(all)).map(String);
  const violated = (c.forbid || []).filter((re) => re.test(all)).map(String);
  const ok = !r.error && all.length >= 20 && !missing.length && !violated.length;

  return {
    id: c.id, name: c.name, ask: c.ask, note: c.note,
    day: c.day || null, mode: scene.mode, ms,
    ok, error: r.error, missing, violated,
    chars: all.length, answer: all,
    systemChars: system.length
  };
}

(async () => {
  const W = loadCase();
  const health = await (await fetch(GATEWAY + '/api/health')).json();
  if (health.mode !== 'live') {
    console.error('网关不是 live：' + JSON.stringify(health));
    console.error('拒绝用 mock 结果冒充真实模型验证。');
    process.exit(2);
  }
  const state = await (await fetch('http://127.0.0.1:8790/state')).json();
  let sd = state.scoreDetails;
  let scoreFrom = 'live-agent';
  if (!sd) {
    /* 实验退出后 Player.log 会被下一次启动覆盖，这里用同一份真实记录的快照复现报告场景 */
    const fx = path.join(ROOT, 'tools/fixtures/score-39-unanswered.json');
    if (fs.existsSync(fx)) {
      sd = JSON.parse(fs.readFileSync(fx, 'utf8')).scoreDetails;
      scoreFrom = 'fixture(real-snapshot)';
    }
  }

  const rows = [];
  for (const c of CASES) {
    process.stdout.write(`· ${c.name} ... `);
    try {
      const r = await runOne(W, c, sd);
      rows.push(r);
      console.log(r.ok ? `OK ${r.ms}ms ${r.chars}字` : `FAIL ${r.error || ''} missing=${r.missing.join('|')} violated=${r.violated.join('|')}`);
    } catch (e) {
      rows.push({ id: c.id, name: c.name, ok: false, error: e.message, answer: '' });
      console.log('ERROR ' + e.message);
    }
  }
  process.stdout.write(`· ${EXAM_CASE.name} ... `);
  try {
    const r = await runOne(W, EXAM_CASE, sd);
    rows.push(r);
    console.log(r.ok ? `OK ${r.ms}ms` : `FAIL missing=${r.missing.join('|')} violated=${r.violated.join('|')}`);
  } catch (e) {
    rows.push({ id: EXAM_CASE.id, name: EXAM_CASE.name, ok: false, error: e.message, answer: '' });
    console.log('ERROR ' + e.message);
  }

  const meta = {
    at: new Date().toISOString(),
    gateway: GATEWAY,
    model: health.model,
    provider: health.provider,
    state: {
      scoreFrom,
      capturedAt: sd && sd.capturedAt, attribution: sd && sd.attribution,
      totalItems: sd && sd.totalItems, answered: sd && sd.answeredItems,
      pending: sd && sd.pendingItems, noAttempts: sd && sd.noAttempts, pv: sd && sd.pv
    },
    pass: rows.filter((r) => r.ok).length,
    total: rows.length,
    rows
  };
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs/model-selftest.json'), JSON.stringify(meta, null, 2), 'utf8');

  const md = [];
  md.push('# 十场景真实模型实测（自动生成）');
  md.push('');
  md.push(`- 时间：${meta.at}`);
  md.push(`- 网关：${meta.gateway} · 模型：${meta.model} · ${meta.provider}`);
  md.push(`- 成绩来源：${meta.state.attribution || '无'}（${meta.state.scoreFrom}） · 分项 ${meta.state.totalItems ?? '—'} · 已作答 ${meta.state.answered ?? '—'} · 未作答 ${meta.state.pending ?? '—'} · noAttempts=${meta.state.noAttempts}`);
  md.push(`- 结果：${meta.pass}/${meta.total} 通过`);
  md.push('');
  md.push('> 通过条件：真实网关返回 ≥20 字、命中场景必需约束、不触犯禁止项。');
  md.push('');
  for (const r of rows) {
    md.push(`## ${r.name} ${r.ok ? '✅' : '❌'}`);
    md.push('');
    md.push(`- 学生提问：${r.ask || ''}`);
    md.push(`- 场景模式：${r.mode || '?'}${r.day ? ` · 术后第 ${r.day} 天` : ''}`);
    md.push(`- 耗时/字数：${r.ms || '—'}ms / ${r.chars || 0}`);
    if (r.error) md.push(`- 错误：${r.error}`);
    if ((r.missing || []).length) md.push(`- 缺少必需内容：${r.missing.join(' , ')}`);
    if ((r.violated || []).length) md.push(`- 触犯禁止项：${r.violated.join(' , ')}`);
    md.push('');
    md.push('```text');
    md.push((r.answer || '').slice(0, 1200));
    md.push('```');
    md.push('');
  }
  fs.writeFileSync(path.join(ROOT, 'docs/model-selftest.md'), md.join('\n'), 'utf8');

  console.log(`\n结果：${meta.pass}/${meta.total} 通过`);
  console.log('证据：docs/model-selftest.md / docs/model-selftest.json');
  process.exit(meta.pass === meta.total ? 0 : 1);
})();
