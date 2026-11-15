/* 自动跑通原实验 UI（测试账号，允许答错）
 * 原则：不猜像素——每步读 GQY_STATE + 真实按钮坐标（buttons 指令）再点。
 * 用法：node tools/auto-play.mjs [最大步数]
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const LOG = 'C:/Users/syy/AppData/LocalLow/Mengoo/HLF10631030/Player.log';
const TMP = 'C:/Users/syy/AppData/Local/Temp';
const CMD = TMP + '/gqy-cmd.txt';
const RES = TMP + '/gqy-cmd-result.txt';
const MAX = Number(process.argv[2] || 150);

const sleepSync = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function state() {
  try {
    const raw = fs.readFileSync(LOG, 'utf8');
    const lines = raw.split('\n').filter((l) => l.startsWith('GQY_STATE:'));
    if (!lines.length) return null;
    return JSON.parse(lines[lines.length - 1].slice('GQY_STATE:'.length));
  } catch { return null; }
}

let nudge = 0;
function cmd(text, waitMs = 1200) {
  // 扰动：让 _last 变化，真正的指令才会被执行
  try { fs.writeFileSync(CMD, 'find|__nudge' + (++nudge)); } catch { }
  sleepSync(220);
  try { fs.writeFileSync(CMD, text); } catch { return ''; }
  const t0 = Date.now();
  let best = '';
  while (Date.now() - t0 < waitMs) {
    sleepSync(150);
    try {
      const s = fs.readFileSync(RES, 'utf8');
      const line = s.split('\n')[1] || '';
      if (line) best = line;
      if (line && !/^ERR /.test(line)) return line;
    } catch { }
  }
  return best;
}

function btns(type) {
  return String(cmd('buttons|' + type)).split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = s.match(/^(.*)@(-?\d+),(-?\d+)$/);
    return m ? { label: m[1], x: Number(m[2]), y: Number(m[3]) } : null;
  }).filter(Boolean);
}

function click(x, y) {
  try { execFileSync('python', ['C:/Temp/click.py', String(x), String(y)], { stdio: 'ignore' }); } catch { }
}

const has = (st, re) => (st.panels || []).some((p) => re.test(p));

const POPUP_TYPES = [
  'Nurse.Logic.UITipPanel', 'Nurse.Logic.UITipOptPanel', 'Nurse.Logic.UIDialoogConentPanel',
  'Nurse.Logic.UIPromptPanel', 'Nurse.Logic.UIErrorPanel', 'Nurse.Logic.UISelectionExamPanel',
];
function clickByText(re) {
  // 先用全类型扫描（返回物理坐标，需 /1.5）
  const out = String(cmd('scan|' + (re.source.includes('确定') ? '确定' : '再次操作')));
  const m = out.match(/\|([^@|]+)@(\d+),(\d+)/);
  if (m) { click(Math.round(Number(m[2]) / 1.5), Math.round(Number(m[3]) / 1.5)); return m[1]; }
  for (const tp of POPUP_TYPES) {
    const b = btns(tp).find((x) => re.test(x.label));
    if (b) { click(b.x, b.y); return b.label; }
  }
  return null;
}

async function main() {
  let same = 0, prev = '', failCount = 0;
  let qKey = '', tryIdx = 0, examStep = 0, lastThird = false;
  for (let i = 0; i < MAX; i++) {
    const st = state();
    if (!st) { await sleep(800); continue; }
    const sig = JSON.stringify([st.panels, (st.uiTexts || []).slice(0, 3), st.totalScore]);
    same = sig === prev ? same + 1 : 0;
    prev = sig;

    if (has(st, /ComprehensivePerformance|ReportScore|ScorePanel/)) {
      console.log('[完成] 出现成绩/报告面板');
      return;
    }

    // 操作失败弹窗：必须点「再次操作」，否则会卡死
    const txtAll = (st.uiTexts || []).join('|');
    if (/恭喜|操作成功/.test(txtAll)) {
      const hit = clickByText(/确定/);
      if (!hit) click(853, 737);
      sleepSync(900);
      failCount = 0; tryIdx = 0; qKey = '';   // 下一题重新开始
      console.log('成功确认');
      continue;
    }
    if (/操作失败|很遗憾/.test(txtAll)) {
      const hit2 = clickByText(/再次操作/);
      if (!hit2) click(721, 646);
      sleepSync(900);
      failCount++; tryIdx++;
      console.log('失败重试 第' + (tryIdx + 1) + '次尝试');
      continue;
    }

    // 综合评估面板（是/否 + 压疮分期 + 部位）：勾选第一项再确定
    if (has(st, /UISelectionOtherExamPanel/)) {
      const bs = btns('Nurse.Logic.UISelectionOtherExamPanel');
      const ok = bs.find((b) => /确定/.test(b.label));
      const opts = bs.filter((b) => !/确定/.test(b.label));
      if (opts.length) { const o = opts[0]; click(Math.round(o.x / 1.5), Math.round(o.y / 1.5)); sleepSync(700); }
      if (ok) { click(Math.round(ok.x / 1.5), Math.round(ok.y / 1.5)); }
      else { const hit = clickByText(/确定/); if (!hit) click(738, 923); }
      sleepSync(1300);
      console.log('评估提交');
      continue;
    }

    if (has(st, /UISelectionExamPanel/)) {
      const type = has(st, /UISelectionOtherExamPanel/) ? 'Nurse.Logic.UISelectionOtherExamPanel' : 'Nurse.Logic.UISelectionExamPanel';
      const bs = btns(type);
      const ok = bs.find((b) => /确定|提交/.test(b.label));
      const opts = bs.filter((b) => !/确定|提交|关闭|返回/.test(b.label));
      // 选错就换一个：按失败次数轮换 A/B
      // 用题号+题干做 key；题变了就重置尝试次数
      const qText = (st.uiTexts || []).find((t) => t.length > 4 && !/确定|提交|恭喜|遗憾|再次操作|^[A-D]$/.test(t)) || '';
      const prog = (st.uiTexts || []).find((t) => /^\d+\/\d+$/.test(t)) || '';
      const key = prog + '|' + qText;
      if (key !== qKey) { qKey = key; tryIdx = 0; }
      const FIXED = [[183, 385], [183, 488], [183, 588], [183, 685]];   // A/B/C/D（实测校准）
      const pick = opts.length >= 2 ? opts[tryIdx % opts.length] : null;
      if (pick) click(pick.x, pick.y);
      else { const f = FIXED[tryIdx % FIXED.length]; click(f[0], f[1]); }
      sleepSync(700);
      if (ok) click(ok.x, ok.y);
      else {
        // 选中后「提交」才会出现，位置固定在右上
        const sub = btns(type).find((b) => /提交/.test(b.label));
        click(sub ? Math.round(sub.x / 1.5) : 1431, sub ? Math.round(sub.y / 1.5) : 202);
      }
      sleepSync(1100);
      console.log('答题', prog, qText.slice(0, 14), 'opt=' + (pick ? pick.label : (tryIdx % 2 === 0 ? 'A' : 'B')));
      continue;
    }

    if (has(st, /UIDialoogConentPanel/)) {
      const bs = btns('Nurse.Logic.UIDialoogConentPanel');
      const skip = bs.find((b) => /跳过/.test(b.label));
      if (skip) click(skip.x, skip.y); else click(1600, 1200);
      sleepSync(700);
      console.log('对话', i);
      continue;
    }

    // 术后观察评估：视诊→触诊→动诊→听诊→完成返回
    const hasThird = has(st, /UIThirdSenceOptPanel/);
    if (hasThird !== lastThird) { examStep = 0; lastThird = hasThird; }
    if (hasThird) {
      const bs = btns('Nurse.Logic.UIThirdSenceOptPanel');
      const seq = ['视诊', '触诊', '动诊', '听诊', '完成返回'];
      const target = seq[Math.min(examStep, seq.length - 1)];
      const b = bs.find((x) => x.label === target);
      if (b) { click(b.x, b.y); examStep++; sleepSync(1100); console.log('评估', target); continue; }
    }

    if (has(st, /UITaskOptPanel/)) {
      let all = btns('Nurse.Logic.UITaskOptPanel');
      let tasks = all.filter((b) => b.label && !/任务栏/.test(b.label));
      if (!tasks.length) {
        // 列表未展开：先点「任务栏」标签把它拉出来
        const tab = all.find((b) => /任务栏/.test(b.label));
        click(tab ? Math.min(tab.x, 2500) : 2500, tab ? tab.y : 720);
        sleepSync(1200);
        all = btns('Nurse.Logic.UITaskOptPanel');
        tasks = all.filter((b) => b.label && !/任务栏/.test(b.label));
      }
      if (tasks.length) {
        const t = tasks[i % tasks.length];
        click(90, Math.round(t.y / 1.5));
        sleepSync(1500);
        console.log('任务', t.label, i);
        continue;
      }
    }

    let acted = false;
    for (const tp of ['Nurse.Logic.UIGuidePanel02', 'Nurse.Logic.UIGuidePanel', 'Nurse.Logic.UIPanientInfoPanel']) {
      const bs = btns(tp);
      const b = bs.find((x) => /我已知道|确定|下一|继续/.test(x.label));
      if (b) { click(b.x, b.y); sleepSync(800); console.log('点', b.label, i); acted = true; break; }
    }
    if (acted) continue;

    if (same > 5) {
      for (const nm of ['UIGuidePanel02', 'UIGuidePanel', 'UIPanientInfoPanel', 'UIDialoogConentPanel']) cmd('hide|' + nm, 500);
      same = 0;
    }
    await sleep(500);
  }
  console.log('结束：达到最大步数');
}

main().catch((e) => console.error('ERR', e.message));
