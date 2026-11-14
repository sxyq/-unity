/*
 * 客户端状态采集代理（Windows 端运行，macOS 也能跑，用于测试）
 * ---------------------------------------------------------------
 * 为什么需要它：
 *   实验是 MLauncher 拉起的 Unity 客户端，浏览器读不到它的内部状态。
 *   但 Unity 会把运行日志写到本机磁盘，客户端窗口标题也在系统里。
 *   这个代理只做两件事：**读日志**、**读窗口标题**，然后暴露一个
 *   本机 HTTP 接口给浏览器扩展 / 服务端去取。
 *
 * 它不注入进程、不改客户端、不读内存。
 *
 * 运行：
 *   node client-agent/agent.mjs
 *   GET http://127.0.0.1:8790/state
 *
 * 环境变量：
 *   PORT        默认 8790
 *   LOG_DIRS    额外日志目录，分号分隔
 *   TITLE_CMD   自定义取窗口标题的命令（默认走 PowerShell）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';

const PORT = Number(process.env.PORT || 8790);
const IS_WIN = process.platform === 'win32';

/* ---------------- 日志位置 ---------------- */
function defaultLogDirs() {
  const home = os.homedir();
  if (IS_WIN) {
    return [
      path.join(home, 'AppData', 'LocalLow', 'Mengoo', 'MCLocalLauncher'),
      path.join(home, 'AppData', 'LocalLow')
    ];
  }
  // macOS：Unity 日志在 ~/Library/Logs/<Company>/<Product>
  return [
    path.join(home, 'Library', 'Logs', 'Mengoo', 'MCLocalLauncher'),
    path.join(home, 'Library', 'Logs')
  ];
}

const extra = (process.env.LOG_DIRS || '').split(';').filter(Boolean);
// 显式给了 LOG_DIRS 就只扫这些目录，避免把别的日志混进来
const ROOTS = extra.length ? extra : defaultLogDirs();

function findLogs() {
  const out = [];
  for (const root of ROOTS) {
    if (!fs.existsSync(root)) continue;
    // 直接是产品目录
    const direct = path.join(root, 'Player.log');
    if (fs.existsSync(direct)) { out.push(direct); continue; }
    // 上层目录：找 */ */Player.log
    let subs = [];
    try { subs = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { continue; }
    for (const s of subs) {
      if (!s.isDirectory()) continue;
      const p1 = path.join(root, s.name, 'Player.log');
      if (fs.existsSync(p1)) { out.push(p1); continue; }
      let subs2 = [];
      try { subs2 = fs.readdirSync(path.join(root, s.name), { withFileTypes: true }); } catch (e) { continue; }
      for (const s2 of subs2) {
        if (!s2.isDirectory()) continue;
        const p2 = path.join(root, s.name, s2.name, 'Player.log');
        if (fs.existsSync(p2)) out.push(p2);
      }
    }
  }
  return [...new Set(out)];
}

/* ---------------- 日志解析 ---------------- */
/* 可选：client-agent/rules.json 覆盖内置规则
   { "phase": [{"re":"...","phase":"intraop"}], "day":"术后第?([1-7])天" } */
let CUSTOM = null;
try {
  const rp = path.join(path.dirname(new URL(import.meta.url).pathname), 'rules.json');
  if (fs.existsSync(rp)) CUSTOM = JSON.parse(fs.readFileSync(rp, 'utf8'));
} catch (e) { CUSTOM = null; }

const PHASE_RULES = CUSTOM && Array.isArray(CUSTOM.phase) ? CUSTOM.phase.map(r => ({ re: new RegExp(r.re, 'i'), phase: r.phase })) : [
  { re: /术前|preop|pre_op|scene[_\s-]?0?[12]\b/i, phase: 'preop' },
  { re: /术中|intraop|intra_op|operation|scene[_\s-]?0?[345]\b/i, phase: 'intraop' },
  { re: /术后|postop|post_op|scene[_\s-]?0?[678]\b/i, phase: 'postop' },
  { re: /考核评价|成绩|score.?report|exam/i, phase: 'report' }
];

const DAY_RE = /术后\s*第?\s*([1-7])\s*天|postop[_\s-]?day[_\s-]?([1-7])/i;

function parseLines(lines) {
  const ev = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    for (const r of PHASE_RULES) {
      if (r.re.test(t)) { ev.push({ phase: r.phase, line: t.slice(0, 160) }); break; }
    }
  }
  const last = ev.length ? ev[ev.length - 1] : null;
  let day = null;
  if (last && last.phase === 'postop') {
    const m = last.line.match(DAY_RE);
    if (m) day = Number(m[1] || m[2]);
  }
  return { last, day, count: ev.length };
}

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

/* ---------------- 窗口标题（只读） ---------------- */
let titleCache = { at: 0, value: '' };
function getWindowTitle() {
  return new Promise((resolve) => {
    if (Date.now() - titleCache.at < 2000) return resolve(titleCache.value);
    if (!IS_WIN) { titleCache = { at: Date.now(), value: '' }; return resolve(''); }
    const cmd = process.env.TITLE_CMD ||
      'powershell -NoProfile -Command "Add-Type -Namespace W -Name U -MemberDefinition \'[DllImport(\\"user32.dll\\")] public static extern IntPtr GetForegroundWindow();[DllImport(\\"user32.dll\\")] public static extern int GetWindowText(IntPtr h,System.Text.StringBuilder s,int n);\'; $b=New-Object System.Text.StringBuilder 512;[void][W.U]::GetWindowText([W.U]::GetForegroundWindow(),$b,512);$b.ToString()"';
    exec(cmd, { timeout: 4000, windowsHide: true }, (err, stdout) => {
      const v = err ? '' : String(stdout || '').trim();
      titleCache = { at: Date.now(), value: v };
      resolve(v);
    });
  });
}

/* ---------------- 汇总 ---------------- */
async function buildState() {
  const logs = findLogs();
  let best = null;
  const detail = [];

  for (const f of logs) {
    const lines = readTail(f);
    if (!lines.length) continue;
    const p = parseLines(lines);
    detail.push({ file: f, events: p.count, phase: p.last ? p.last.phase : null });
    if (p.last) {
      const score = p.count;
      if (!best || score > best.count) best = { ...p, file: f };
    }
  }

  const title = await getWindowTitle();
  let phase = best ? best.last.phase : null;
  let day = best ? best.day : null;
  let source = best ? 'client-log' : null;
  let confidence = best ? (best.count >= 3 ? 'high' : 'medium') : 'none';
  let evidence = best ? [best.last.line] : [];

  // 日志没写，就退一步看窗口标题
  if (!phase && title) {
    for (const r of PHASE_RULES) {
      if (r.re.test(title)) { phase = r.phase; source = 'window-title'; confidence = 'low'; evidence = [title]; break; }
    }
    if (phase === 'postop') {
      const m = title.match(DAY_RE);
      if (m) day = Number(m[1] || m[2]);
    }
  }

  return {
    ok: true,
    phase,
    postopDay: day,
    taskName: null,
    mode: /考核|考试|exam/i.test(title || '') ? 'exam' : (phase ? 'study' : null),
    contextSource: source,
    confidence,
    evidence,
    logs: detail,
    windowTitle: title,
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
    'Cache-Control': 'no-store'
  };

  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }

  if (u.pathname === '/health') {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, platform: process.platform, logs: findLogs().length }));
    return;
  }

  if (u.pathname === '/raw') {
    const n = Math.min(500, Number(u.searchParams.get('n') || 120));
    const logs = findLogs();
    const lines = logs.length ? readTail(logs[0], 512 * 1024).slice(-n) : [];
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ file: logs[0] || null, total: logs.length, lines }, null, 1));
    return;
  }

  if (u.pathname === '/state') {
    const s = await buildState();
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(s));
    return;
  }

  res.writeHead(404, cors); res.end('404');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[client-agent] http://127.0.0.1:${PORT}/state`);
  console.log(`[client-agent] 日志目录: ${ROOTS.join(' | ')}`);
});
