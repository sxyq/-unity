/*
 * Unity 状态映射回放（离线）
 * ---------------------------------------------------------------
 * 把 2026-11-15 真实运行时抓到的 GQY_STATE 字段写进临时 Player.log，
 * 启动一个独立 client-agent（8799），逐一查询 /state，核对
 * phase / taskId / postopDay / mode 是否与当时一致。
 *
 * 这不是"Unity 正在运行"的证据，只证明**状态映射层**没有回归。
 * 运行：node tools/replay-unity-states.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(ROOT, 'tools/fixtures/unity-events.json');
const PORT = 8799;
const DIR = path.join(os.tmpdir(), 'gqy-replay-' + Date.now());
const LOG = path.join(DIR, 'Player.log');

const fx = JSON.parse(fs.readFileSync(FIX, 'utf8'));

function writeLog(ev) {
  fs.mkdirSync(DIR, { recursive: true });
  const body = [
    'Initialize engine version: 2021.3.6f1 (fake replay header)',
    'HLF10631030 replay fixture',
    'GQY_STATE:' + JSON.stringify(ev),
    ''
  ].join('\n');
  fs.writeFileSync(LOG, body, 'utf8');
}

const child = spawn(process.execPath, ['client-agent/agent.mjs'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    LOG_DIRS: DIR,
    ACTIVE_MS: '999999999',
    RECENT_MS: '999999999'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', () => { });
child.stderr.on('data', (d) => process.stderr.write('[agent] ' + d));

async function waitHealth() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (r.ok) return true;
    } catch (e) { /* not yet */ }
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

const rows = [];
try {
  if (!await waitHealth()) throw new Error('回放 agent 未启动');
  for (const c of fx.cases) {
    writeLog(c.unity);
    await new Promise(r => setTimeout(r, 120));
    const st = await (await fetch(`http://127.0.0.1:${PORT}/state`)).json();
    const got = { phase: st.phase, taskId: st.taskId, postopDay: st.postopDay, mode: st.mode };
    const exp = c.expected;
    const ok = got.phase === exp.phase
      && got.taskId === exp.taskId
      && (exp.postopDay == null || got.postopDay === exp.postopDay)
      /* mode 只校验「必须是考核」的方向：答题面板出现时必须锁考核；
         学习模式下也弹题时，不把 study 当成硬期望。 */
      && (exp.mode !== 'exam' || got.mode === 'exam');
    rows.push({ name: c.name, source: c.source, expected: exp, got, ok });
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${c.name.padEnd(18)} 期望 ${exp.phase}/${exp.taskId} 实际 ${got.phase}/${got.taskId}`);
  }
} finally {
  child.kill();
}

const pass = rows.filter(r => r.ok).length;
const out = {
  at: new Date().toISOString(),
  note: '离线回放 2026-11-15 真实 GQY_STATE；证明映射层，不证明 Unity 当前在运行。',
  pass, total: rows.length, rows
};
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs/unity-replay.json'), JSON.stringify(out, null, 2), 'utf8');
console.log(`\n结果：${pass}/${rows.length}`);
process.exit(pass === rows.length ? 0 : 1);
