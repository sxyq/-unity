/*
 * 日志格式标定工具
 * ---------------------------------------------------------------
 * 拿到一台跑过实验的 Windows 机器上的 Player.log，用它离线生成
 * client-agent 的解析规则，不用在 Windows 上装任何东西。
 *
 * 用法：
 *   node client-agent/calibrate.mjs /path/to/Player.log
 *   node client-agent/calibrate.mjs < Player.log
 *
 * 输出：
 *   - 命中阶段词的行（去重后按次数排序）
 *   - 建议的 rules.json
 */
import fs from 'node:fs';

const file = process.argv[2];
const text = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
const lines = text.split(/\r?\n/).filter(Boolean);

const PHASE_WORDS = [
  ['preop', ['术前', 'PreOp', 'Pre_Op']],
  ['intraop', ['术中', 'IntraOp', 'Intra_Op', 'Operation']],
  ['postop', ['术后', 'PostOp', 'Post_Op']],
  ['report', ['考核评价', '成绩', 'Score', 'Exam']]
];

const hits = { preop: [], intraop: [], postop: [], report: [] };

for (const line of lines) {
  for (const [phase, words] of PHASE_WORDS) {
    if (words.some((w) => line.includes(w))) {
      hits[phase].push(line.trim().slice(0, 160));
      break;
    }
  }
}

console.log(`总行数 ${lines.length}`);
for (const [phase, arr] of Object.entries(hits)) {
  console.log(`\n## ${phase}  (${arr.length} 行)`);
  const uniq = [...new Set(arr)].slice(0, 8);
  for (const l of uniq) console.log('   ', l);
}

/* 猜步骤号：3/10、第3步、step 3 */
const stepRe = /(\d{1,2})\s*[\/／]\s*(\d{1,2})|第\s*(\d{1,2})\s*步|step[^0-9]{0,3}(\d{1,2})/i;
const stepLines = lines.filter((l) => stepRe.test(l)).slice(0, 5);
if (stepLines.length) {
  console.log('\n## 可能的步骤行');
  for (const l of stepLines) console.log('   ', l.trim().slice(0, 160));
}

/* 生成建议规则：取命中行里最稳定的那个片段 */
function suggest(phase) {
  const arr = hits[phase];
  if (!arr.length) return null;
  // 取出现次数最多的中文/英文关键词作为锚点
  const words = PHASE_WORDS.find(([p]) => p === phase)[1];
  const found = words.find((w) => arr.some((l) => l.includes(w)));
  return found ? { re: found, phase } : null;
}

const rules = ['preop', 'intraop', 'postop', 'report'].map(suggest).filter(Boolean);
const dayMatch = lines.find((l) => /术后\s*第?\s*[1-7]\s*天/.test(l));

const out = {
  phase: rules.length ? rules : [
    { re: '术前', phase: 'preop' },
    { re: '术中', phase: 'intraop' },
    { re: '术后', phase: 'postop' },
    { re: '考核', phase: 'report' }
  ]
};
if (dayMatch) out.day = '术后\\s*第?\\s*([1-7])\\s*天';

console.log('\n## 建议写入 client-agent/rules.json');
console.log(JSON.stringify(out, null, 2));
