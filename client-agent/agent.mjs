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

    const root = rootOf(file);
    // 统一按 LocalLow\<company>\<product>\Player.log 的结构取名，避免相对路径算出 ".."
    const segs = path.resolve(file).split(/[\\/]/);
    const li = segs.findIndex((s) => s.toLowerCase() === 'locallow');
    let company = '';
    let product = '';
    if (li >= 0 && segs.length >= li + 4) {
      company = segs[li + 1];
      product = segs[li + 2];
    } else {
      const rel = path.relative(root, file).split(/[\\/]/);
      if (rel.length >= 3) { company = rel[rel.length - 3]; product = rel[rel.length - 2]; }
      else { product = path.basename(root); company = path.basename(path.dirname(root)); }
    }

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

function readText(file, maxBytes = 512 * 1024) {
  try {
    const st = fs.statSync(file);
    const start = Math.max(0, st.size - maxBytes);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(Math.min(maxBytes, st.size - start));
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch (e) { return ''; }
}

function readTail(file, maxBytes = 256 * 1024) {
  const s = readText(file, maxBytes);
  return s ? s.split(/\r?\n/) : [];
}

/* ---------------- 真实客户端：UI 生命周期 ----------------
 * 骨牵引实验本体（Unity 2021.3）不打印「术前/术中/术后」这类阶段词，
 * 只打印自己加载/隐藏的 UI 面板路径。这些是可以证实的运行事件，
 * 但**不等于**业务阶段，所以只作为 lifecycle 输出，不拿来推 phase/taskId。 */
const LIFECYCLE_RULES = [
  { re: /userInfovalue\s*MLauncher:\/\//i, stage: 'launched', label: '实验已启动' },
  { re: /获取进度成功/i, stage: 'progress-loaded', label: '已读取上次进度' },
  { re: /Resources\/Prefabs\/UI\/Load\/UILoadPanel/i, stage: 'loading', label: '资源加载中' },
  { re: /Resources\/Prefabs\/UI\/Share\/UIVideoPlayPanel/i, stage: 'intro-video', label: '实验介绍视频' },
  { re: /打开UICasePanel/i, stage: 'case-panel', label: '病例/任务主界面' },
  { re: /UISampleBingLiPanel/i, stage: 'case-history', label: '示例病历面板' },
  { re: /上传进度成功/i, stage: 'progress-saved', label: '客户端已上报进度' },
  { re: /上传成绩成功|提交成绩成功|实验完成|isDone\\?":true/i, stage: 'finished', label: '实验完成' }
];

function parseLifecycle(lines) {
  const events = [];
  lines.forEach((raw, idx) => {
    const t = String(raw).trim();
    for (const r of LIFECYCLE_RULES) {
      if (r.re.test(t)) { events.push({ stage: r.stage, label: r.label, line: t.slice(0, 160), idx }); break; }
    }
  });
  return events;
}

/* ---------------- Unity 测试副本：结构化状态事件 ----------------
 * tools/unity-observer 在**独立测试副本**里输出 GQY_STATE:{...}，
 * 字段全部来自原程序运行时反射（SenceState / DayTime / isStudyModel / WeightValue ...）。
 * 这里只做「可证实的映射」，不把任务列表里出现过的词当成当前任务。
 */
const UNITY_PANEL_RULES = [
  /* 2026-11-15 实测：原程序结束后的综合表现记录面板（成绩单）→ 报告阶段 */
  { re: /UIComprehensivePerformanceRecordPanel/i, phase: 'report', taskId: 'report-score', taskName: '成绩与能力分析', why: '原程序 UIComprehensivePerformanceRecordPanel（综合表现记录/成绩）' },
  { re: /UIHistoryTakingPanel/i, phase: 'preop', taskId: 'preop-history', taskName: '病史采集与症状问诊', why: '原程序 UIHistoryTakingPanel（病史采集面板）' },
  { re: /UISkeletaTractionOptPanel/i, phase: 'intraop', taskId: 'intraop-principle', taskName: '牵引原理', why: '原程序 UISkeletaTractionOptPanel（牵引重量操作面板）' },
  { re: /UITaskOptPanel/i, phase: 'postop', taskId: null, why: '原程序 UITaskOptPanel（术后每日任务面板）' },
  /* 2026-11-15 实机实测：真实客户端的入院记录病历面板（热点「1.入院记录」） */
  { re: /UISampleBingLiPanel/i, phase: 'preop', taskId: 'preop-history', taskName: '病史采集与症状问诊', why: '实测 UISampleBingLiPanel+RecordPanel（入院记录病历：主诉/现病史/辅助检查/专科检查）' }
];
const UNITY_TASK_RULES = [
  /* 2026-11-15 实机实测：真实客户端热点/病历页签的 selectedTasks 任务名 */
  { re: /^入院记录$/, phase: 'preop', taskId: 'preop-history', taskName: '病史采集与症状问诊' },
  { re: /^辅助检查$/, phase: 'preop', taskId: 'preop-history', taskName: '病史采集与症状问诊' },
  { re: /^专科检查$/, phase: 'preop', taskId: 'preop-history', taskName: '病史采集与症状问诊' },
  { re: /^术前准备$/, phase: 'preop', taskId: null, taskName: '术前准备' },
  { re: /病史采集|病史回顾|主诉|现病史|问诊/, phase: 'preop', taskId: 'preop-history', taskName: '病史采集与症状问诊' },
  { re: /术前谈话|术前沟通|知情同意/, phase: 'preop', taskId: 'preop-talk', taskName: '术前沟通与疑问交流' },
  { re: /身份核对|部位确认|宣教/, phase: 'intraop', taskId: 'intraop-communicate', taskName: '术中沟通与宣教' },
  { re: /牵引原理|砝码|滑轮|牵引方向|反牵引/, phase: 'intraop', taskId: 'intraop-principle', taskName: '牵引原理' },
  { re: /牵引有效性|患肢感觉|血液循环|末梢血运|牵引效果/, phase: 'intraop', taskId: 'intraop-observe', taskName: '操作观察与效果判断' },
  { re: /心理护理|情绪安抚|焦虑/, phase: 'postop', taskId: 'postop-psych', taskName: '术后心理护理' },
  { re: /体位护理|翻身|有效咳嗽|皮肤护理|日常生活指导|排便/, phase: 'postop', taskId: 'postop-care', taskName: '术后护理指导' },
  { re: /深静脉血栓|牵引失效|患肢肿胀|创口出血|牵引针道|压力性损伤|肺部感染|并发症/, phase: 'postop', taskId: 'postop-complication', taskName: '并发症观察' }
];
const UNITY_FUNCTIONS = {
  /* 只允许四个统一功能名（与 case-data.js 的 FN 对齐） */
  'preop-history': '智能病史问诊',
  'preop-talk': '智能情境化护患交流',
  'intraop-communicate': '智能情境化护患交流',
  'intraop-principle': '智能护理导学',
  'intraop-observe': '智能护理导学',
  'postop-psych': '智能情境化护患交流',
  'postop-care': '智能护理导学',
  'postop-complication': '智能护理导学',
  'report-score': '智能个性化学习反馈',
  'report-review': '智能个性化学习反馈'
};

/* 术后每日任务项 → 智能场景（2026-11-15 实测任务栏文字）
 * 依据：术后任务栏的条目名（uiTexts / taskCurrentText），不是猜阶段 */
const POSTOP_ITEM_RULES = [
  { re: /心理|情绪|焦虑|睡眠/, taskId: 'postop-psych', taskName: '术后心理护理' },
  { re: /深静脉血栓|创口出血|肺部感染|神经损伤|肢端血供|牵引针道|压力性损伤|并发症/, taskId: 'postop-complication', taskName: '并发症观察' },
  { re: /牵引有效性|疼痛|排泄|体位|翻身|皮肤|活动|咳嗽|康复/, taskId: 'postop-care', taskName: '术后护理指导' }
];

/* 字幕劫持用：从面板文本里挑出「最像一句台词」的那条
   规则：含中文、长度 6~80、排除按钮词与纯数字 */
function pickSubtitle(texts) {
  const BAN = /^(确定|取消|提交|关闭|返回|跳过|是|否|下一|上一|我已知道|提示|退出|答题测试|任务栏)$/;
  let best = '';
  for (const raw of (texts || [])) {
    const t = String(raw || '').trim();
    if (!t || t.length < 6 || t.length > 80) continue;
    if (BAN.test(t)) continue;
    if (!/[\u4e00-\u9fa5]/.test(t)) continue;
    if (/^[\d\s.,%/]+$/.test(t)) continue;
    if (t.length > best.length) best = t;
  }
  return best || null;
}

function parseUnityEvent(text) {
  const marker = 'GQY_STATE:';
  let from = 0, last = null;
  for (;;) {
    const i = text.indexOf(marker, from);
    if (i < 0) break;
    const s = i + marker.length;
    let e = text.indexOf('\n', s);
    if (e < 0) e = text.length;
    const raw = text.slice(s, e).trim();
    try { const v = JSON.parse(raw); if (v && typeof v === 'object') last = v; } catch (e2) { /* 半行忽略 */ }
    from = e + 1;
  }
  return last;
}

function strArray(v) { return Array.isArray(v) ? v.map(String) : (v ? [String(v)] : []); }

function mapUnityEvent(ev) {
  const panels = strArray(ev.panels).join(' ');
  const uTexts = strArray(ev.uiTexts);
  const uiJoined = uTexts.join(' ');   // 面板文字带序号前缀（如「7.穿刺」），必须用包含匹配
  const selected = strArray(ev.selectedTasks);
  let phase = null, taskId = null, taskName = null, why = '';

  for (const r of UNITY_PANEL_RULES) {
    if (!r.re.test(panels)) continue;
    phase = r.phase; taskId = r.taskId; taskName = r.taskName || null; why = r.why;
  }

  /* 实测坑：`panels` 是「已加载」的面板，关闭后仍留在列表里（UIDialoogConentPanel 就是如此）。
     用面板自身的特征文字判断它是否真的开着，避免把旧面板当成当前任务：
       - 电子病历开着 → uiTexts 有「退出病历」
       - 护患对白开着 → uiTexts 有「跳过」 */
  if (taskId === 'preop-history' && !uiJoined.includes('退出病历')) {
    taskId = null; taskName = null; why = '';
  }
  // 只有「当前选中」的任务才允许推出 taskId；uiTexts 里列着的任务不算
  const sence = String(ev.senceState || '');
  for (const s of selected) {
    for (const r of UNITY_TASK_RULES) {
      if (!r.re.test(s)) continue;
      /* 实测坑：ChildSence02 里病历页签同样会写 selectedTasks=["入院记录"]，
         但那时它只是「电子病历的当前页签」，不是场景 01 的任务。
         因此病历页签类任务名只在 ChildSence01 生效。 */
      if (/^(入院记录|辅助检查|专科检查)$/.test(s) && !/ChildSence01/i.test(sence)) continue;
      phase = r.phase; taskId = r.taskId; taskName = r.taskName; why = '当前选中任务：' + s;
      break;
    }
    if (taskId) break;
  }

  /* 模块 2「骨牵引的操作方法及原理」的真实任务（2026-11-15 实测热点）：
     1.医患沟通 / 2.体格检查 / 3.辅助检查 / 4.手术治疗
     - 体格检查 → UISecondSenceOptPanel（视诊/触诊/动诊/量诊）
     - 手术治疗 → UISkeletaTractionOptPanel（牵引重量操作）
     这两个面板在别的场景不出现，因此按面板识别即可，但要限定在 ChildSence02。 */
  if (/ChildSence02/i.test(sence)) {
    /* 实测：体格检查与手术治疗都用 UISecondSenceOptPanel 作为底部动作条，
       只能靠动作条里的项目文字区分：
         体格检查 = 视诊/触诊/动诊/量诊
         手术治疗 = 确认穿刺部位/打开穿刺包/戴无菌手套/消毒/铺巾/麻醉/穿刺/调节肢体高度/牵引 */
    const opSteps = ['穿刺', '铺巾', '消毒', '戴无菌手套', '调节肢体高度'].filter(t => uiJoined.includes(t)).length;
    if (opSteps >= 2) {
      phase = 'intraop'; taskId = 'intraop-principle'; taskName = '牵引原理';
      why = '模块2·手术治疗（骨牵引操作步骤条：确认穿刺部位→穿刺→牵引）';
    } else if (/UISkeletaTractionOptPanel/i.test(panels)) {
      phase = 'intraop'; taskId = 'intraop-principle'; taskName = '牵引原理';
      why = '模块2·手术治疗（UISkeletaTractionOptPanel 牵引重量操作）';
    } else if (/UISecondSenceOptPanel/i.test(panels) && uiJoined.includes('量诊')) {
      phase = 'intraop'; taskId = 'intraop-observe'; taskName = '操作观察与效果判断';
      why = '模块2·体格检查（UISecondSenceOptPanel：视诊/触诊/动诊/量诊）';
    } else if (/UIDialoogConentPanel/i.test(panels) && uiJoined.includes('跳过')) {
      phase = 'intraop'; taskId = 'intraop-communicate'; taskName = '术中沟通与宣教';
      why = '模块2·医患沟通（护患对白）';
    }
  }

  /* 术后任务栏的「当前选中项」是任务级真实来源（UITaskOptPanel.currentTarget 的子 Text）。
     它比 selectedTasks（术后只给「第一天」这种日期标签）细一级。 */
  const curText = String(ev.taskCurrentText || '');
  if (curText) {
    for (const r of POSTOP_ITEM_RULES) {
      if (!r.re.test(curText)) continue;
      phase = 'postop'; taskId = r.taskId; taskName = r.taskName;
      why = '术后任务栏当前项：' + curText;
      break;
    }
  }

  /* 答题面板的题干（UISelectionExamPanel.questionTip）能直接定位任务主题：
     点「下肢深静脉血栓」出的题是「术后预防深静脉血栓的最佳运动方式」。
     这是术后任务项最可靠的一条证据。 */
  const examQ = String(ev.examQuestion || '');
  if (examQ) {
    for (const r of POSTOP_ITEM_RULES) {
      if (!r.re.test(examQ)) continue;
      phase = 'postop'; taskId = r.taskId; taskName = r.taskName;
      why = '术后答题题干：' + examQ.slice(0, 40);
      break;
    }
  }
  /* 3D 模型菜单（UITipOptPanel）上真实可见的按钮：逆向确认「心理护理」就在这个菜单里，
     点病人模型才会出现。按钮文字是运行时可读的真值，不需要再靠题干反推。 */
  const tipBtns = String(ev.tipOptButtons || '');
  if (tipBtns) {
    if (/心理护理/.test(tipBtns)) {
      phase = 'postop'; taskId = 'postop-psych'; taskName = '术后心理护理';
      why = '3D 病人菜单按钮：心理护理';
    } else if (/术前谈话/.test(tipBtns)) {
      phase = 'preop'; taskId = 'preop-talk'; taskName = '术前沟通与疑问交流';
      why = '3D 菜单按钮：术前谈话';
    } else if (/入院记录/.test(tipBtns)) {
      phase = 'preop'; taskId = 'preop-history'; taskName = '病史采集与症状问诊';
      why = '3D 菜单按钮：入院记录';
    }
  }

  /* 术后综合评估面板（UISelectionOtherExamPanel）的选项组本身就是任务特征：
     examList2 是压疮分期（1期..5期）、examList3 是压疮好发部位（骶尾部/足跟…），
     只要出现这两组，就确定学生在做「压力性损伤」观察 → 08 并发症观察。 */
  const exLists = [ev.examList1, ev.examList2, ev.examList3].filter(Boolean).join('|');
  if (exLists && /骶尾部|枕骨粗隆|足跟部|1期|2期|3期/.test(exLists) && phase !== 'report') {
    phase = 'postop'; taskId = 'postop-complication'; taskName = '并发症观察（压力性损伤）';
    why = '术后评估选项组：压疮分期/好发部位';
  }

  /* 术后考核面板里按天分的 ToggleList（panel01/02/03ToggleList），
     每项写成「序号:名称:是否选中」，isOn=1 的那项就是学生此刻在做的观察项。
     实测 currentTarget 指的是天数按钮组，靠不住；这条才是任务级来源。 */
  const listRaw = String(ev.examList1 || ev.examList2 || ev.examList3 || '');
  if (listRaw) {
    const item = listRaw.split('|').map(x => x.split(':')).find(p => p[2] === '1');
    const curItem = item && item[1] ? item[1] : null;
    if (curItem) {
      for (const r of POSTOP_ITEM_RULES) {
        if (!r.re.test(curItem)) continue;
        phase = 'postop'; taskId = r.taskId; taskName = r.taskName;
        why = '术后考核面板当前项：' + curItem;
        break;
      }
    }
  }

  let postopDay = null;
  const dt = Number(ev.dayTime);
  if (Number.isFinite(dt) && dt >= 1 && dt <= 7) postopDay = dt;
  else if (String(ev.isFirstDay) === 'true') postopDay = 1;

  /* 模块 2 的「3.辅助检查」也会打开同一份电子病历（RecordPanel/UISampleBingLiPanel），
     但它不是场景 01 的病史问诊——面板名相同而已。此时只保留阶段，不认领任务。 */
  if (/ChildSence02/i.test(sence) && taskId === 'preop-history') {
    phase = 'intraop'; taskId = null; taskName = null;
    why = '模块2·辅助检查（复用了电子病历面板，非场景01）';
  }
  /* 术前谈话（2026-11-15 实测）：点「3.术前谈话」热点不写 selectedTasks，
     但会打开 UIDialoogConentPanel 对白，且动作栏出现「同意书」。
     用「对白面板 + 同意书」作为证据，避免把普通对白误判成术前谈话。 */
  if (uTexts.some(t => /同意书/.test(t)) && /ChildSence01/i.test(String(ev.senceState || ''))) {
    phase = 'preop'; taskId = 'preop-talk'; taskName = '术前沟通与疑问交流';
    why = '术前谈话：对白面板 + 知情同意书';
  }

  /* 原系统答题测试：UISelectionExamPanel（是/否选择题，提交后判分）
   * 只要这个面板在，就按考核处理——模型不得直接给答案。 */
  const quizOn = /UISelectionExamPanel|UISelectionOtherExamPanel|UIPaperModelPanel|errorPanel/i.test(panels);
  if (quizOn) why = (why ? why + '；' : '') + '原系统答题测试进行中（考核保护）';

  const mode = quizOn ? 'exam' : (String(ev.isStudyModel) === 'false' ? 'exam' : 'study');
  return {
    phase,
    postopDay: phase === 'postop' ? postopDay : null,
    taskId, taskName,
    functionName: taskId ? (UNITY_FUNCTIONS[taskId] || taskName) : null,
    mode,
    contextSource: 'unity-event',
    confidence: taskId ? 'high' : (phase ? 'medium' : 'low'),
    evidence: [why || ('Unity 事件：senceState=' + (ev.senceState || '?') + ' scene=' + (ev.scene || '?'))],
    unity: {
      scene: ev.scene || null,
      senceState: ev.senceState || null,
      panels: strArray(ev.panels),
      uiTexts: strArray(ev.uiTexts).slice(0, 20),
      selectedTasks: selected,
      taskCurrentText: ev.taskCurrentText || null,
      sence3Order: ev.sence3Order != null ? Number(ev.sence3Order) : null,
      examQuestion: ev.examQuestion || null,
      subtitle: pickSubtitle(ev.uiTexts),
      tipOptButtons: ev.tipOptButtons || null,
      dayTaskNames: ev.dayTaskNames || null,
      huLiDone: String(ev.huLiDone) === 'true',
      quizOn,
      dayTime: Number.isFinite(dt) ? dt : null,
      isFirstDay: String(ev.isFirstDay) === 'true',
      isStudyModel: mode === 'study',
      isGetProgressSuccess: String(ev.isGetProgressSuccess) === 'true',
      tractionWeight: ev.tractionWeight != null ? Number(ev.tractionWeight) : null,
      totalScore: ev.totalScore != null ? Number(ev.totalScore) : null,
      scoreDatas: ev.scoreDatas || null,
      typeScores: ev.typeScores || null
    }
  };
}

/* ---------------- 真实客户端：逐步骤成绩 ----------------
 * 切换任务/进入病例界面时，客户端把整份进度以
 *   progress requestBody: { "maxPV":…, "pv":…, "data": "{\"currentExpProgress\":…,\"ScoreDatas\":[…]}" }
 * 打进 Player.log。这是原程序自己写的**只读证据**，不是我们上报或伪造的。
 * 一条日志里可能有多份（断点续做），取最后一次解析成功的。 */
function parseProgress(text) {
  if (!text) return null;
  const marker = 'progress requestBody:';
  let from = 0, found = null;
  for (;;) {
    const i = text.indexOf(marker, from);
    if (i < 0) break;
    const start = text.indexOf('{', i + marker.length);
    if (start < 0) break;
    // 外层 JSON 的 data 是字符串，内层的 } 不会提前终止；用括号配平 + 引号状态扫描
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let k = start; k < text.length && k < start + 2 * 1024 * 1024; k++) {
      const c = text[k];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { end = k + 1; break; } }
    }
    if (end > 0) {
      try {
        const outer = JSON.parse(text.slice(start, end));
        let inner = typeof outer.data === 'string' ? JSON.parse(outer.data) : outer.data;
        if (inner && Array.isArray(inner.ScoreDatas)) found = { outer, inner };
      } catch (e) { /* 半截块，忽略 */ }
      from = end;
    } else break;
  }
  if (!found) return null;

  const { inner, outer } = found;
  const items = inner.ScoreDatas.map((s) => ({
    sn: String(s.SN || ''),
    section: String(s.section || ''),
    score: Number(s.score) || 0,
    right: s.isRight === true,
    feedback: String(s.feedbackInfo || '').slice(0, 160),
    time: Number(s.time) || 0
  })).filter((x) => x.sn);

  const bySection = {};
  for (const it of items) {
    const k = it.section || '未分章节';
    if (!bySection[k]) bySection[k] = { total: 0, right: 0, score: 0 };
    bySection[k].total++;
    if (it.right) bySection[k].right++;
    bySection[k].score += it.score;
  }
  const wrong = items.filter((x) => !x.right).map((x) => ({ sn: x.sn, section: x.section, feedback: x.feedback }));

  return {
    source: 'client-log',
    currentExpProgress: Number(inner.currentExpProgress) || 0,
    isDone: inner.isDone === true,
    isStudyModel: inner.isStudyModel === true,
    pv: Number(outer.pv) || 0,
    maxPV: Number(outer.maxPV) || 0,
    totalItems: items.length,
    rightItems: items.filter((x) => x.right).length,
    totalScore: Math.round(items.reduce((a, b) => a + b.score, 0) * 10) / 10,
    bySection,
    wrongItems: wrong,
    // 只给结构化明细，不生成任何结论性文字（由上层 prompt 决定怎么解读）
    items
  };
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

  // 用 tasklist 而不是 PowerShell：后者在受限环境里经常起不来，且更慢。
  // /v（带窗口标题）在部分受限会话里会直接失败，所以先试 /v，失败退回普通 /fo csv。
  const run = (args) => new Promise((resolve) => {
    execFile('tasklist', args, { timeout: 8000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => resolve(err ? '' : String(stdout || '')));
  });
  let raw = await run(['/v', '/fo', 'csv']);
  let verbose = raw.includes('窗口标题') || /"CPU/.test(raw) || raw.split(/\r?\n/).length > 3 && /窗口|Window Title|CPU 时间/.test(raw);
  if (!verbose) {
    const simple = await run(['/fo', 'csv']);
    if (simple) { raw = simple; verbose = false; }
  }

  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('"')) continue;
    const cols = line.slice(1, -1).split('","');
    if (cols.length < 5) continue;
    const name = cols[0];
    if (!/MCLocal|Mengoo|MLauncher|HLF|骨牵引|VirtualSim/i.test(name)) continue;
    out.push({
      pid: Number(cols[1]),
      name,
      title: verbose && cols.length >= 9 ? (cols[8] || '') : '',
      path: '',
      started: '',
      mem: cols[4]
    });
  }
  procCache = { at: Date.now(), value: out };
  return out;
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
  const procs = await listProcs();
  // 实验本体进程还在 = 会话仍在继续；Unity 静默时日志可能几分钟不更新，
  // 不能因此把真实状态判成「历史」，否则面板 30 秒后就过期了。
  const gameRunning = procs.some((p) => /HLF10631030|MCLocalLauncher/i.test(p.name));
  let best = null;
  let progressBest = null;
  let lifecycleBest = null;
  let unityBest = null;
  const detail = [];

  for (const meta of logs) {
    const lines = lastSession(readTail(meta.file));
    if (!lines.length) continue;
    const p = parseLines(lines);
    const ageMs = now - meta.mtime;
    // 只把「本实验的两份日志」视为可延续的会话，别的游戏日志不因进程同名被带活
    const isOurLog = /Mengoo|MCLocalLauncher|HLF10631030/i.test([meta.company, meta.product].join('/'));
    const live = ageMs <= RECENT_MS || (isOurLog && gameRunning);

    // 真实实验本体日志里的两种额外证据：UI 生命周期、逐步骤成绩
    const text = readText(meta.file);
    const lc = parseLifecycle(lines);
    const pd = parseProgress(text);
    const ue = parseUnityEvent(text);
    const lastLc = lc.length ? lc[lc.length - 1] : null;

    detail.push({
      file: meta.file,
      product: [meta.company, meta.product].filter(Boolean).join('/'),
      size: meta.size,
      ageSec: Math.round(ageMs / 1000),
      live,
      phase: p.phase,
      taskId: p.task ? p.task.taskId : null,
      events: p.phaseCount,
      lifecycle: lastLc ? lastLc.stage : null,
      scoreItems: pd ? pd.totalItems : 0,
      stepCode: p.stepCode
    });

    if (lastLc) {
      const lcRank = (live ? 1000 : 0) + lastLc.idx;
      if (!lifecycleBest || lcRank > lifecycleBest.rank) {
        lifecycleBest = { rank: lcRank, stage: lastLc.stage, label: lastLc.label, evidence: [lastLc.line], live };
      }
    }
    if (pd) {
      const pdRank = (live ? 10000 : 0) + Math.min(pd.totalItems, 999) + pd.currentExpProgress;
      if (!progressBest || pdRank > progressBest.rank) progressBest = { rank: pdRank, value: pd, live };
    }
    if (ue) {
      const ueRank = (live ? 20000 : 0) + text.length % 1000;
      if (!unityBest || ueRank > unityBest.rank) unityBest = { rank: ueRank, value: ue, live };
    }

    if (!p.phase) continue;
    // 活着的日志优先，其次看证据条数
    const rank = (live ? 1000 : 0) + Math.min(p.phaseCount, 20) * 10 + (p.task ? 5 : 0);
    const bestRank = best ? best.rank : -1;
    if (rank > bestRank) best = { ...p, meta, rank, live, ageMs };
  }

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

  let examMode = (best && best.exam) || /考核|考试|exam/i.test(title || '');

  // Unity 测试副本的结构化事件优先级最高：它直接来自原程序运行时状态，
  // 比日志正则、窗口标题都可靠。没有事件时退回上面的只读证据。
  const uni = unityBest ? mapUnityEvent(unityBest.value) : null;
  if (uni) {
    source = uni.contextSource;                 // 即使没映射到任务，也如实标注事件来源
    evidence = uni.evidence.slice();
    if (uni.phase) {
      phase = uni.phase;
      postopDay = uni.postopDay;
      if (unityBest.live) {
        taskId = uni.taskId;
        taskName = uni.taskName;
        confidence = uni.confidence;
      } else {
        // 客户端事件已过期（退出/卡死）：不再展示"当前任务"，避免误导学生
        taskId = null;
        taskName = null;
        confidence = 'low';
        evidence = ['客户端状态已过期，请重新进入实验任务'];
      }
    } else {
      confidence = 'low';                       // 只有运行事件，不能证明业务阶段
    }
    if (uni.mode === 'exam') examMode = true;
  }

  return {
    ok: true,
    phase,
    functionName: uni && uni.taskId ? uni.functionName : null,
    unity: uni ? uni.unity : null,
    postopDay: phase === 'postop' ? postopDay : null,
    taskId,
    taskName,
    scenarioId: taskId,
    mode: examMode ? 'exam' : (phase ? 'study' : null),
    contextSource: source,
    confidence,
    evidence: evidence.filter(Boolean).slice(0, 4),
    stepCode: best ? best.stepCode : null,
    // 真实客户端证据：只描述「运行到哪一步 UI」与「原程序自己打印的分项成绩」，
    // 不据此推断业务阶段/任务（phase、taskId 仍只由明确标记产生）。
    lifecycle: lifecycleBest ? {
      stage: lifecycleBest.stage,
      label: lifecycleBest.label,
      evidence: lifecycleBest.evidence,
      live: lifecycleBest.live
    } : null,
    scoreDetails: progressBest ? progressBest.value : null,
    live: (best ? best.live : false) || !!(lifecycleBest && lifecycleBest.live) ||
          !!(progressBest && progressBest.live) || !!(unityBest && unityBest.live),
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
