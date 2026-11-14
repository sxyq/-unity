/*
 * 场景识别规则表（纯数据，便于单独调整）
 * ---------------------------------------------------------------
 * 强证据：页面明确阶段标注；弱证据：场景词、URL、任务条。
 * 改这里不需要动识别逻辑。
 */
(function () {
  'use strict';

  const PHASE_RULES = [
    { phase: 'report', primary: ['考核评价', '实验报告', '实验结果与结论', '成绩上传'], secondary: ['考核', '题目', '提交试卷'] },
    { phase: 'preop', primary: ['术前阶段', '术前访视'], secondary: ['术前准备', '病史回顾', '护理评估', '问诊'] },
    { phase: 'postop', primary: ['术后阶段', '术后病情观察'], secondary: ['术后第', '并发症观察', '心理护理', '日常护理'] },
    { phase: 'intraop', primary: ['术中阶段', '术中沟通'], secondary: ['牵引重量', '皮肤透明度', '牵引操作'] }
  ];

  const URL_HINTS = [
    { phase: 'report', test: /curriculumscore|myscore|examscores|scoreinfo/i },
    { phase: 'preop', test: /[?&](phase|stage)=(preop|pre)/i },
    { phase: 'intraop', test: /[?&](phase|stage)=(intraop|op)/i },
    { phase: 'postop', test: /[?&](phase|stage)=(postop|post|day\d)/i }
  ];

  // 顶部区域：阶段/标题/步骤条——当前任务的权威来源
  const HEAD_SELECTORS = [
    'header', '[class*="header"]', '[class*="Header"]',
    '[class*="top-bar"]', '[class*="topbar"]', '[class*="Topbar"]',
    '[class*="title"]', '[class*="Title"]',
    '[class*="step"]', '[class*="Step"]',
    '[class*="phase"]', '[class*="Phase"]',
    '[class*="stage"]', '[class*="Stage"]'
  ];
  // 主体区域：任务条、面板、菜单——会列出全部任务，只能作弱证据
  const BODY_SELECTORS = [
    '[class*="task"]', '[class*="Task"]', '[class*="panel"]', '[class*="Panel"]',
    '[class*="nav"]', '[class*="menu"]', '[class*="content"]', '[class*="list"]'
  ];

  window.BT_SCENE_RULES = { PHASE_RULES, URL_HINTS, HEAD_SELECTORS, BODY_SELECTORS };
})();
