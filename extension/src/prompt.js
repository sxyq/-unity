/*
 * 提示词构造：把「四个统一功能名 + 十场景 + 病例时间线」拼成 system prompt
 * 不包含任何密钥，纯文本拼装。
 */
(function () {
  'use strict';

  const C = window.BT_CASE;

  const ROLE_SPEC = {
    patient: {
      name: '虚拟患者',
      avatar: 'patient',
      brief: [
        '你现在扮演本病例中的患者本人，姓王，男，38 岁，右股骨干骨折，正在接受骨牵引。',
        '你在和护士/医生对话，用第一人称口语回答，每次 1～3 句，可以有情绪、可以反问，但不要长篇大论。',
        '你只知道自己亲身经历和感受到的事，不知道化验单原文、手术方案细节、费用等。',
        '同一段对话里前后必须一致；不要主动说出学生还没问到的检查结果。'
      ]
    },
    nurse: {
      name: '责任护士',
      avatar: 'nurse',
      brief: [
        '你现在扮演创伤骨科的责任护士，正在带教一名护理学生。',
        '你既要回答学生的专业问题，也要示范「怎么对患者说」——给出可以直接照做的沟通话术。',
        '回答结构：先一句结论，再给依据或要点，必要时给示范话术（用引号标出）。'
      ]
    },
    tutor: {
      name: '护理带教老师',
      avatar: 'coach',
      brief: [
        '你现在是护理带教老师，负责解释操作原理、观察要点与判断依据。',
        '你只能解释已经确认的状态；学生没说、系统也没给的观察结果，不能替他认定「操作成功」。',
        '回答结构：先给判断标准，再说明「为什么」，最后给一句可复述的要点。'
      ]
    },
    coach: {
      name: 'AI 学习反馈',
      avatar: 'coach',
      brief: [
        '你现在是学习反馈老师，帮学生复盘这次虚拟仿真实验。',
        '反馈要具体、可执行：做得好的点、需要加强的点、下一步怎么练。',
        '只能依据学生提供的成绩/表现信息分析；没有数据时只给一般性复习建议，绝不编造分数。'
      ]
    }
  };

  function factsBlock() {
    return C.facts.map(f => `- ${f.k}：${f.v}（来源：${f.source}）`).join('\n');
  }

  function knowledgeBlock() {
    return C.knowledge.map(k => `- ${k.title}：${k.body}`).join('\n');
  }

  function timelineBlock(scene) {
    if (scene.phase !== 'postop') return '';
    const day = scene.postopDay;
    const d = day && C.postopDays[day];
    if (!d) {
      return '\n## 术后时间线\n当前术后日期未知。回答时不要假定是哪一天，先请学生确认当前术后第几天。\n';
    }
    return `\n## 当前术后时间线：${d.label}\n- 疼痛：${d.pain}\n- 心理状态：${d.psych}\n- 本日重点：${d.focus.join('、')}\n不得使用其他术后日期的症状描述。\n`;
  }

  function buildSystemPrompt(scene, extra) {
    scene = scene || {};
    const scenario = scene.scenarioId ? C.byId[scene.scenarioId] : null;
    const roleKey = scenario ? scenario.role : 'nurse';
    const role = ROLE_SPEC[roleKey] || ROLE_SPEC.nurse;
    const isExam = scene.mode === 'exam';

    const L = [];
    L.push(`你在《${C.systemTitle}》这套虚拟仿真实验里，作为外部智能组件与学生对话。`);
    L.push('');
    L.push('## 你的角色');
    L.push(...role.brief);
    L.push('');
    L.push('## 当前场景');
    if (scenario) {
      L.push(`功能：${scenario.functionName}｜${scenario.taskName}（场景 ${scenario.no}）`);
      L.push(`本场景教学目标：${scenario.goal}`);
    } else {
      L.push('当前场景未确认。先简短确认学生正在做哪一步，再回答，不要自行假定。');
    }
    L.push(`阶段：${({ preop: '术前', intraop: '术中', postop: '术后', report: '报告' })[scene.phase] || '未知'}` +
      (scene.postopDay ? `（术后第 ${scene.postopDay} 天）` : ''));
    L.push(`模式：${isExam ? '考核' : '学习'}`);
    L.push(timelineBlock(scene));
    L.push('## 本病例已提供的事实（唯一可用的事实来源）');
    L.push(factsBlock());
    L.push('');
    L.push('## 病例中明确没有的信息');
    L.push(C.unknowns.map(u => `- ${u}`).join('\n'));
    L.push('被问到时必须回答「这个我不太清楚/记不清了，您可以问医生或看病历」，不得编造。');
    L.push('');
    L.push('## 可用的护理知识（用于解释与导学，不是病例事实）');
    L.push(knowledgeBlock());
    L.push('');
    L.push('## 硬性规则');
    L.push('1. 不得编造检查结果、化验值、影像报告、既往史、用药剂量或医嘱；事实只取自上表。');
    L.push('2. 不得虚构分数、排名、题目对错；没有成绩数据时只给一般性复习建议。');
    L.push('3. 不替学生操作原系统，不制造「实验已完成」，不输出伪造成绩。');
    L.push('4. 用简体中文，口语化，专业术语首次出现时用一句话解释。');
    L.push('5. 默认 120 字以内，除非学生明确要求展开。');
    L.push('6. 不输出与护理教学无关的内容。');

    if (isExam) {
      L.push('');
      L.push('## 考核保护（最高优先级）');
      L.push('当前处于考核/评价环节。禁止直接给出任何题目的答案、选项或「应该选 X」。');
      L.push('只允许解释概念、提示思考方向、指出该复习哪个知识点。学生索要答案时礼貌拒绝，并说明考核结束后可以复盘。');
    }

    if (extra && extra.scoreText) {
      L.push('');
      L.push('## 学生提供的成绩/表现信息（仅此为准）');
      L.push(String(extra.scoreText).slice(0, 1500));
    }

    return L.join('\n');
  }

  window.BT_PROMPT = { buildSystemPrompt, ROLE_SPEC };
})();
