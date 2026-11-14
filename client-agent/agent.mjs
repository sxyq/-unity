/*
 * 客户端状态采集代理（Windows 原生 / macOS 可跑）
 * ---------------------------------------------------------------
 * 只做三件事：**读 Unity 日志**、**读窗口标题**、**看进程**，
 * 然后通过本机 HTTP 暴露给浏览器扩展 / 服务端注入 / 悬浮窗。
 * 不注入进程、不读内存、不改客户端、不发外部请求。
 *
 * 运行：node client-agent/agent.mjs
 *   GET /health   服务与发现到的日志数量
 *   GET /state    统一场景状态（扩展消费的就是这个）
 *   GET /raw      某个日志的末尾若干行（排错用）
 *   GET /scan     发现到的日志候选清单（含产品名、大小、修改时间、是否算“活着”）
 *   GET /procs    与实验相关的进程（只读，用于确认启动器/实验本体）
 *
 * 环境变量：
 *   PORT        默认 8790
 *   LOG_DIRS    显式日志目录，分号分隔；给了就只扫这些目录
 *   RECENT_MS   日志多久内更新算“正在运行”，默认 5 分钟
 *   STALE_MS    超过多久算历史日志（降为低可信），默认 60 分钟
 *
 * 关键设计（2026-11 修订）：
 *   1) **不再把 LocalLow 下所有游戏日志都当实验日志**。
 *      之前会把《明日方舟：终末地》里的 `VK_EXT_blend_operation_advanced`
 *      匹配成“术中”，属于确定性误报。现在先按产品目录过滤，
 *      非 Mengoo 产品必须日志正文里出现本实验锚点（HLF10631030 / 校内域名）才收。
 *   2) **只看本次会话**。Unity 每次启动都会写 `Initialize engine version`，
 *      只解析最后一根之后的行，历史会话不会压过当前实验。
 *   3) **阶段 ≠ 任务**。只有明确出现“当前任务/CurrentTask/SubStepDescription”
 *      这类标记，并且任务词命中时才给 taskId；否则 taskId 为 null，
 *      由面板提示用户在该阶段内选择，绝不拿阶段猜任务。
 *   4) 每一条结论都带 evidence 原文与 confidence，面板照实显示。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';

const PORT = Number(process.env.PORT || 8790);
const IS_WIN = process.platform === 'win32';
const RECENT_MS = Number(process.env.RECENT_MS || 5 * 60 * 1000);
const STALE_MS = Number(process.env.STALE_MS || 60 * 60 * 1000);

/* ---------------- 日志位置 ---------------- */
function defaultLogDirs() {
  const home = os.homedir();
  if (IS_WIN) {
    return [
      path.join(home, 'AppData', 'LocalLow', 'Mengoo', 'MCLocalLauncher'),
      path.join(home, 'AppData', 'LocalLow')
    ];
  }
  return [
    path.join(home, 'Library', 'Logs', 'Mengoo', 'MCLocalLauncher'),
    path.join(home, 'Library', 'Logs')
  ];
}

const extra = (process.env.LOG_DIRS || '').split(';').filter(Boolean);
const ROOTS = extra.length ? extra : defaultLogDirs();

/* 产品目录命中：启动器本体，或名字里带实验代码/项目名 */
const PRODUCT_RE = /(^|[\\/])(Mengoo|MCLocalLauncher|HLF10631030|gouqianyin|骨牵引)/i;
/* 正文锚点：只有本实验才会出现的字符串 */
const CONTENT_ANCHORS = [
  /HLF10631030/i,
  /skeletaltraction\.cqmu\.edu\.cn/i,
  /下肢骨折骨牵引/i,
  /MCLocalLauncher/i
];

function expand(p) {
  return p.replace(/^~/, os.homedir());
}

/** 收集 Player.log（最多三层），带上产品名与时间信息 */
function discoverLogs() {
  const out = [];
  const seen = new Set();

  const push = (file) => {
    const key = path.resolve(file).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    let st;
    try { st = fs.statSync(file); } catch (e) { return; }
    if (!st.isFile()) return;

    const rel = path.relative(rootOf(file), file).split(/[\\/]/);
    const company = rel.length >= 3 ? rel[rel.length - 3] : '';
    const product = rel.length >= 2 ? rel[rel.length - 2] : '';

    out.push({
      file,
      company,
      product,
      size: st.size,
      mtime: st.mtimeMs,
      inProductDir: PRODUCT_RE.test(file)
    });
  };

  const roots = [];
  for (const r of ROOTS) {
    const abs = expand(r);
    if (fs.existsSync(abs)) roots.push(abs);
  }

  function rootOf(file) {
    let best = roots[0] || path.dirname(file);
    for (const r of roots) {
      if (file.toLowerCase().startsWith(r.toLowerCase()) && r.length > best.length) best = r;
    }
    return best;
  }

  for (const root of roots) {
    const direct = path.join(root, 'Player.log');
    if (fs.existsSync(direct)) { push(direct); continue; }

    let subs = [];
    try { subs = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { continue; }
    for (const s of subs) {
      if (!s.isDirectory()) continue;
      const p1 = path.join(root, s.name, 'Player.log');
      if (fs.existsSync(p1)) { push(p1); continue; }
      let subs2 = [];
      try { subs2 = fs.readdirSync(path.join(root, s.name), { withFileTypes: true }); } catch (e) { continue; }
      for (const s2 of subs2) {
        if (!s2.isDirectory()) continue;
        const p2 = path.join(root, s.name, s2.name, 'Player.log');
        if (fs.existsSync(p2)) push(p2);
      }
    }
  }

  // 过滤：产品目录命中；或正文出现本实验锚点
  return out.filter((x) => {
    if (x.inProductDir) return true;
    const tail = readTail(x.file, 64 * 1024).join('\n');
    return CONTENT_ANCHORS.some((re) => re.test(tail));
  });
}

/* ---------------- 日志解析 ---------------- */
let CUSTOM = null;
try {
  const rp = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'rules.json');
  if (fs.existsSync(rp)) CUSTOM = JSON.parse(fs.readFileSync(rp, 'utf8'));
} catch (e) { CUSTOM = null; }

/* 阶段规则：中文优先，英文只认带词边界的缩写，避免 operation/score 这类词误伤 */
const PHASE_RULES = CUSTOM && Array.isArray(CUSTOM.phase) ? CUSTOM.phase.map(r => ({ re: new RegExp(r.re, 'i'), phase: r.phase })) : [
  { re: /术前阶段|术前访视|PreOp\b|Pre_Op\b/i, phase: 'preop' },
  { re: /术中阶段|术中操作|手术进行中|IntraOp\b|Intra_Op\b/i, phase: 'intraop' },
  { re: /术后阶段|术后病情观察|PostOp\b|Post_Op\b/i, phase: 'postop' },
  { re: /考核评价|考核成绩|成绩单|ScoreReport|ExamResult/i, phase: 'report' }
];

/* 只有这些“明确宣告当前任务”的行才允许推出 taskId */
const TASK_MARK = /(CurrentTask|TaskName|当前任务|当前步骤|当前环节|任务名称|SubStepDescription|StepDescription)\s*[:：=]?\s*(.{0,90})/i;

/* 任务词表：顺序即优先级，先具体后宽泛 */
const TASK_LIB = [
  { id: 'preop-history', phase: 'preop', words: ['病史采集', '病史回顾', '护理评估', '问诊'] },
  { id: 'preop-talk', phase: 'preop', words: ['术前谈话', '术前沟通', '知情同意', '术前访视'] },
  { id: 'intraop-communicate', phase: 'intraop', words: ['身份核对', '部位确认', '术中沟通', '沟通与宣教', '术前宣教'] },
  { id: 'intraop-principle', phase: 'intraop', words: ['牵引原理', '牵引装置', '砝码', '滑轮', '反牵引'] },
  { id: 'intraop-observe', phase: 'intraop', words: ['患肢感觉', '末梢血运', '牵引效果', '效果判断', '血运观察'] },
  { id: 'postop-psych', phase: 'postop', words: ['心理护理', '情绪安抚', '焦虑'] },
  { id: 'postop-care', phase: 'postop', words: ['护理指导', '体位护理', '翻身', '有效咳嗽', '皮肤护理', '日常生活指导'] },
  { id: 'postop-complication', phase: 'postop', words: ['并发症', '深静脉血栓', '患肢肿胀', '牵引失效'] }
];

const TASK_NAMES = {
  'preop-history': '病史采集与症状问诊',
  'preop-talk': '术前沟通与疑问交流',
  'intraop-communicate': '术中沟通与宣教',
  'intraop-principle': '牵引原理',
  'intraop-observe': '操作观察与效果判断',
  'postop-psych': '术后心理护理',
  'postop-care': '术后护理指导',
  'postop-complication': '并发症观察',
  'report-score': '成绩与能力分析',
  'report-review': '个性化复习建议'
};

const DAY_RE = /术后\s*第?\s*([1-7])\s*天|postop[_\s-]?day[_\s-]?([1-7])/i;
const SESSION_MARK = /Initialize engine version/i;

function readTail(file, maxBytes = 256 * 1024) {
  try {
    const st = fs.statSync(file);
    const start = Math.max(0, st.size - maxBytes);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(Math.min(maxBytes, st.size - start));
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString('utf8').split(/\r?\n/);
  } catch (e) { return []; }
}

/** 只保留最后一根会话：Unity 每次启动都会写 Initialize engine version */
function lastSession(lines) {
  let start = -1;
  for (let i = 0; i < lines.length; i++) if (SESSION_MARK.test(lines[i])) start = i;
  return start >= 0 ? lines.slice(start) : lines;
}

/* 自定义任务规则（rules.json 里的 task 数组）优先于内置词表 */
const CUSTOM_TASKS = (() => {
  if (!CUSTOM || !Array.isArray(CUSTOM.task)) return null;
  const out = [];
  for (const r of CUSTOM.task) {
    if (!r || !r.re || !r.taskId || !r.phase) continue;
    try { out.push({ re: new RegExp(r.re, 'i'), taskId: r.taskId, phase: r.phase, taskName: r.taskName || r.taskId }); }
    catch (e) { /* 坏正则忽略 */ }
  }
  return out.length ? out : null;
})();

function matchTask(text) {
  if (CUSTOM_TASKS) {
    for (const t of CUSTOM_TASKS) {
      const m = text.match(t.re);
      if (m) return { id: t.taskId, phase: t.phase, name: t.taskName, word: m[0] };
    }
  }
  for (const t of TASK_LIB) {
    for (const w of t.words) {
      if (text.includes(w)) return { id: t.id, phase: t.phase, name: TASK_NAMES[t.id] || t.id, word: w };
    }
  }
  return null;
}

function parseLines(lines) {
  const phaseEvents = [];
  const taskEvents = [];
  const dayEvents = [];
  let stepCode = null;
  let exam = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t) continue;

    if (/考核模式|考试模式|开始考试|exam\s*mode/i.test(t)) exam = true;

    // 术后天数常常单独占一行（“术后第 3 天”），必须逐行收集，不能只看任务行
    const dm = t.match(DAY_RE);
    if (dm) dayEvents.push({ day: Number(dm[1] || dm[2]), idx: i });

    for (const r of PHASE_RULES) {
      if (r.re.test(t)) { phaseEvents.push({ phase: r.phase, line: t.slice(0, 180), idx: i }); break; }
    }

    const tm = t.match(TASK_MARK);
    if (tm) {
      const payload = (tm[2] || '').trim();
      const hit = matchTask(payload) || matchTask(t);
      if (hit) {
        taskEvents.push({
          taskId: hit.id,
          phase: hit.phase,
          name: hit.name,
          word: hit.word,
          line: t.slice(0, 180),
          idx: i
        });
      }
      const code = t.match(/(70\d{3})/);
      if (code) stepCode = code[1];
    }
  }

  const lastPhase = phaseEvents.length ? phaseEvents[phaseEvents.length - 1] : null;
  const lastTask = taskEvents.length ? taskEvents[taskEvents.length - 1] : null;

  // 任务必须出现在最近一条阶段证据之后，否则视为上一阶段的残留
  const taskFresh = lastTask && (!lastPhase || lastTask.idx >= lastPhase.idx) ? lastTask : null;

  let phase = taskFresh ? taskFresh.phase : (lastPhase ? lastPhase.phase : null);
  // 取本会话内“最后一次”出现的术后天数；不跨会话、不跨阶段继承
  const anchor = taskFresh ? taskFresh.idx : (lastPhase ? lastPhase.idx : -1);
  const dayAfter = dayEvents.filter((x) => x.idx >= anchor);
  const dayEvent = dayAfter.length ? dayAfter[dayAfter.length - 1] : (dayEvents.length ? dayEvents[dayEvents.length - 1] : null);
  const postopDay = dayEvent ? dayEvent.day : null;

  return {
    phase,
    postopDay: phase === 'postop' ? postopDay : null,
    task: taskFresh,
    stepCode,
    exam,
    phaseCount: phaseEvents.length,
    taskCount: taskEvents.length,
    lastPhase,
    phaseEvents,
    taskEvents
  };
}

/* ---------------- 进程与窗口（只读） ---------------- */
function psJson(script, timeout = 6000) {
  return new Promise((resolve) => {
    if (!IS_WIN) return resolve(null);
    const enc = Buffer.from(script, 'utf16le').toString('base64');
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc],
      { timeout, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve(null);
        try { resolve(JSON.parse(String(stdout || 'null'))); } catch (e) { resolve(null); }
      });
  });
}

let procCache = { at: 0, value: null };
async function listProcs() {
  if (!IS_WIN) return [];
  if (Date.now() - procCache.at < 5000 && procCache.value) return procCache.value;
  const script = `
$pat = 'MCLocal|Mengoo|MLauncher|HLF|骨牵引|VirtualSim'
$list = @()
try {
  $list = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match $pat } | ForEach-Object {
    $p = $_
    [pscustomobject]@{
      pid = $p.Id
      name = $p.ProcessName
      title = $(try { $p.MainWindowTitle } catch { '' })
      path = $(try { $p.Path } catch { '' })
      started = $(try { $p.StartTime.ToString('HH:mm:ss') } catch { '' })
    }
  }
} catch {}
if ($list -eq $null) { $list = @() }
$list | ConvertTo-Json -Depth 3 -Compress
`;
  const r = await psJson(script);
  const arr = r == null ? [] : (Array.isArray(r) ? r : [r]);
  procCache = { at: Date.now(), value: arr };
  return arr;
}

let titleCache = { at: 0, value: '' };
function getWindowTitle() {
  if (!IS_WIN) return Promise.resolve('');
  if (Date.now() - titleCache.at < 2000) return Promise.resolve(titleCache.value);
  const script = `
Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h,System.Text.StringBuilder s,int n);'
$b = New-Object System.Text.StringBuilder 512
[void][W.U]::GetWindowText([W.U]::GetForegroundWindow(), $b, 512)
ConvertTo-Json -Compress -InputObject $b.ToString()
`;
  return psJson(script, 4000).then((v) => {
    const s = typeof v === 'string' ? v : '';
    titleCache = { at: Date.now(), value: s };
    return s;
  });
}

/* ---------------- 汇总 ---------------- */
async function buildState() {
  const logs = discoverLogs();
  const now = Date.now();
  let best = null;
  const detail = [];

  for (const meta of logs) {
    const lines = lastSession(readTail(meta.file));
    if (!lines.length) continue;
    const p = parseLines(lines);
    const ageMs = now - meta.mtime;
    const live = ageMs <= RECENT_MS;

    detail.push({
      file: meta.file,
      product: [meta.company, meta.product].filter(Boolean).join('/'),
      size: meta.size,
      ageSec: Math.round(ageMs / 1000),
      live,
      phase: p.phase,
      taskId: p.task ? p.task.taskId : null,
      events: p.phaseCount,
      stepCode: p.stepCode
    });

    if (!p.phase) continue;
    // 活着的日志优先，其次看证据条数
    const rank = (live ? 1000 : 0) + Math.min(p.phaseCount, 20) * 10 + (p.task ? 5 : 0);
    const bestRank = best ? best.rank : -1;
    if (rank > bestRank) best = { ...p, meta, rank, live, ageMs };
  }

  const procs = await listProcs();
  const title = await getWindowTitle();

  let phase = best ? best.phase : null;
  let postopDay = best ? best.postopDay : null;
  let taskId = best && best.task ? best.task.taskId : null;
  let taskName = best && best.task ? best.task.name : null;
  let source = best ? 'client-log' : null;
  let evidence = [];

  if (best) {
    if (best.task) evidence.push(best.task.line);
    if (best.lastPhase && (!best.task || best.lastPhase.line !== best.task.line)) evidence.push(best.lastPhase.line);
    if (best.stepCode) evidence.push('步骤码 ' + best.stepCode);
  }

  let confidence = 'none';
  if (best) {
    if (!best.live) confidence = 'low';                                   // 历史日志，只能当参考
    else if (best.task) confidence = 'high';                              // 明确任务标记
    else if (best.phaseCount >= 3) confidence = 'high';
    else confidence = 'medium';
  }

  // 日志没有阶段，再退一步看窗口标题：只能给到“阶段”，且低可信
  if (!phase && title) {
    for (const r of PHASE_RULES) {
      if (r.re.test(title)) { phase = r.phase; source = 'window-title'; confidence = 'low'; evidence = [title]; break; }
    }
    if (phase === 'postop') {
      const m = title.match(DAY_RE);
      if (m) postopDay = Number(m[1] || m[2]);
    }
  }

  // 日志和标题都给不出任务时，taskId 必须为 null —— 不拿阶段猜任务
  if (source !== 'client-log') { taskId = null; taskName = null; }

  const examMode = (best && best.exam) || /考核|考试|exam/i.test(title || '');

  return {
    ok: true,
    phase,
    postopDay: phase === 'postop' ? postopDay : null,
    taskId,
    taskName,
    scenarioId: taskId,
    mode: examMode ? 'exam' : (phase ? 'study' : null),
    contextSource: source,
    confidence,
    evidence: evidence.filter(Boolean).slice(0, 4),
    stepCode: best ? best.stepCode : null,
    live: best ? best.live : false,
    ageSec: best ? Math.round(best.ageMs / 1000) : null,
    logs: detail,
    windowTitle: title,
    procs,
    ts: Date.now()
  };
}

/* ---------------- HTTP ---------------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    // Chrome 的 Private Network Access：https 公网页面访问 127.0.0.1 需要显式许可，
    // 否则浏览器直接拦掉（实测在真实平台页面上报 "blocked by CORS policy ... loopback"）。
    'Access-Control-Allow-Private-Network': 'true',
    'Cache-Control': 'no-store'
  };
  const json = (code, obj) => {
    res.writeHead(code, { ...cors, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };

  if (req.method === 'OPTIONS') {
    const h = { ...cors };
    if (req.headers['access-control-request-private-network']) h['Access-Control-Allow-Private-Network'] = 'true';
    res.writeHead(204, h);
    res.end();
    return;
  }

  if (u.pathname === '/health') {
    json(200, { ok: true, platform: process.platform, logs: discoverLogs().length, ts: Date.now() });
    return;
  }

  if (u.pathname === '/raw') {
    const n = Math.min(500, Number(u.searchParams.get('n') || 120));
    const logs = discoverLogs();
    const target = u.searchParams.get('file') || (logs[0] && logs[0].file);
    const lines = target ? readTail(target, 512 * 1024).slice(-n) : [];
    json(200, { file: target || null, total: logs.length, lines });
    return;
  }

  if (u.pathname === '/scan') {
    json(200, {
      roots: ROOTS,
      productRule: String(PRODUCT_RE),
      logs: discoverLogs().map((x) => ({
        file: x.file,
        product: [x.company, x.product].filter(Boolean).join('/'),
        size: x.size,
        mtime: new Date(x.mtime).toISOString(),
        ageSec: Math.round((Date.now() - x.mtime) / 1000),
        live: Date.now() - x.mtime <= RECENT_MS,
        inProductDir: x.inProductDir
      }))
    });
    return;
  }

  if (u.pathname === '/procs') {
    json(200, { platform: process.platform, procs: await listProcs() });
    return;
  }

  if (u.pathname === '/state') {
    json(200, await buildState());
    return;
  }

  res.writeHead(404, cors); res.end('404');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[client-agent] http://127.0.0.1:${PORT}/state`);
  console.log(`[client-agent] 日志目录: ${ROOTS.join(' | ')}`);
  console.log(`[client-agent] 只认 Mengoo/MCLocalLauncher 产品目录，或正文含 HLF10631030 的日志`);
});
