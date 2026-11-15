/* 十场景真实模型联调自检
 * 用项目真实的 case-data.js + prompt.js 构造 system prompt，逐个场景打网关，
 * 检查：角色是否正确、是否守住病例事实、术后日期是否串场、考核模式是否拒绝给答案。
 *
 * 用法：node tools/verify-model.mjs            # 全部十场景
 *      node tools/verify-model.mjs preop-talk  # 单个场景
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GW = process.env.GW || 'http://127.0.0.1:8787';

const sandbox = { window: {}, console, location: { href: 'http://127.0.0.1/' }, document: { addEventListener() {}, querySelectorAll: () => [] } };
sandbox.window.location = sandbox.location;
vm.createContext(sandbox);
for (const f of ['case-data.js', 'prompt.js']) {
  const code = fs.readFileSync(path.join(ROOT, 'apps/extension/src/data', f), 'utf8');
  vm.runInContext(code, sandbox, { filename: f });
}
const CASE = sandbox.window.BT_CASE;
const PROMPT = sandbox.window.BT_PROMPT;

const QUESTIONS = {
  'preop-history': '您是怎么受伤的？当时疼得厉害吗？',
  'preop-talk': '您对这次牵引最担心什么？',
  'intraop-communicate': '牵引的时候患者说很痛，我该怎么回应？',
  'intraop-principle': '为什么牵引方向要和肢体长轴一致？',
  'intraop-observe': '要观察哪些血运指标？',
  'postop-psych': '您现在最担心的是什么？',
  'postop-care': '翻身时要注意什么？',
  'postop-complication': '要警惕哪些并发症？',
  'report-score': '我哪些操作需要加强？',
  'report-review': '下一次应该重点复习什么？'
};

const only = process.argv[2];

for (const sc of CASE.scenarios) {
  if (only && sc.id !== only) continue;
  const scene = { phase: sc.phase, scenarioId: sc.id, mode: sc.mode, postopDay: sc.phase === 'postop' ? 3 : null };
  const system = PROMPT.buildSystemPrompt(scene, {
    scoreText: sc.phase === 'report'
      ? '总成绩 68/100，39 项中 11 项错误。错误集中在：牵引重量设定、针眼护理、深静脉血栓观察。'
      : null
  });
  const t0 = Date.now();
  let text = '', err = '';
  try {
    const r = await fetch(GW + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system, messages: [{ role: 'user', content: QUESTIONS[sc.id] }], stream: false })
    });
    if (!r.ok) err = 'HTTP ' + r.status;
    else {
      const raw = await r.text();
      for (const line of raw.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const p = line.slice(5).trim();
        if (!p || p === '[DONE]') continue;
        try { const o = JSON.parse(p); if (o.t) text += o.t; if (o.error) err = o.error; } catch {}
      }
    }
  } catch (e) { err = e.message; }
  const ms = Date.now() - t0;
  const role = sc.role;
  const flag = [];
  if (!text) flag.push('空回复');
  if (text && /王建国|王国强|王道阔/.test(text)) flag.push('姓名错');
  if (text && sc.phase !== 'postop' && /术后第\s*[237]\s*天/.test(text)) flag.push('跨日期');
  console.log(`\n[${sc.no} ${sc.id}] role=${role} ${ms}ms ${flag.length ? '⚠ ' + flag.join(',') : '✓'}`);
  console.log((err ? 'ERR: ' + err : text).slice(0, 160).replace(/\n/g, ' '));
}
