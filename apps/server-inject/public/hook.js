/*!
 * 骨牵引护理情境化智能交互系统 · 服务端注入版
 * 由 server-hook/build.mjs 自动生成，请勿手改。
 * 生成时间: 2026-11-14T11:49:43.804Z
 * 来源: extension/src/{web-shim.js,data/case-data.js,data/prompt.js,core/instrument.js,platform/bridge.js,platform/score-parse.js,scene/rules.js,scene/detect.js,ui/template.js,ui/panel.js,boot/main.js}
 */

/* ===== web-shim.js ===== */
(function(){
/*
 * Web 版运行时垫片（服务端植入专用）
 * ---------------------------------------------------------------
 * 浏览器扩展里有 chrome.runtime（取资源 URL + 长连接后台）；
 * 直接注入网页时没有这些 API，这里用等价实现顶上：
 *
 *   chrome.runtime.getURL(p)  → /mengoo/__ai/p
 *   chrome.runtime.connect()  → 一个假 Port，用 fetch + SSE 直连
 *                               /mengoo/__ai/api/chat
 *
 * 协议与 background.js 完全一致：chunk / done / aborted / error / health。
 * 这样 ui.js、main.js 一行都不用改，扩展与服务端注入共用同一套前端。
 */
(function () {
  'use strict';

  const WEB = window.__BT_WEB__ || {};
  const BASE = WEB.base || '/mengoo/__ai';
  const API = WEB.api || (BASE + '/api');

  if (window.chrome && window.chrome.runtime && window.chrome.runtime.connect) return;

  function sseParse(chunk, onEvent) {
    // 与 background.js 相同的解析规则：按空行分帧，只认 data: 行
    let buffer = chunk;
    return {
      push(text) {
        buffer += text;
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of raw.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            if (payload === '[DONE]') { onEvent({ done: true }); continue; }
            try { onEvent(JSON.parse(payload)); } catch (e) { /* 坏帧忽略 */ }
          }
        }
      }
    };
  }

  function createPort() {
    const msgListeners = [];
    const discListeners = [];
    const inflight = new Map(); // id -> AbortController
    let closed = false;

    const port = {
      postMessage(msg) {
        if (closed) return;
        if (msg.type === 'health') { probeHealth(); return; }
        if (msg.type === 'cancel') {
          const c = inflight.get(msg.id);
          if (c) { c.abort(); inflight.delete(msg.id); }
          return;
        }
        if (msg.type === 'chat') { chat(msg); return; }
      },
      onMessage: { addListener(f) { msgListeners.push(f); } },
      onDisconnect: { addListener(f) { discListeners.push(f); } },
      disconnect() { closed = true; discListeners.forEach(f => { try { f(); } catch (e) {} }); },
      _emit(m) { if (closed) return; msgListeners.forEach(f => { try { f(m); } catch (e) {} }); }
    };

    async function probeHealth() {
      try {
        const r = await fetch(API + '/health', { cache: 'no-store', credentials: 'same-origin' });
        if (!r.ok) { port._emit({ type: 'health', health: { mode: 'offline' } }); return; }
        port._emit({ type: 'health', health: await r.json() });
      } catch (e) {
        port._emit({ type: 'health', health: { mode: 'offline' } });
      }
    }

    async function chat(msg) {
      const id = msg.id || Date.now();
      const ctrl = new AbortController();
      inflight.set(id, ctrl);

      let resp;
      try {
        resp = await fetch(API + '/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ system: msg.system, messages: msg.messages, stream: msg.stream !== false }),
          signal: ctrl.signal
        });
      } catch (e) {
        inflight.delete(id);
        if (e.name === 'AbortError') { port._emit({ type: 'aborted', id }); return; }
        port._emit({ type: 'error', id, message: '无法连接智能服务（' + API + '）' });
        return;
      }

      if (!resp.ok || !resp.body) {
        inflight.delete(id);
        port._emit({ type: 'error', id, message: '智能服务返回 ' + resp.status });
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      const parser = sseParse('', (obj) => {
        if (obj.done) { port._emit({ type: 'done', id }); return; }
        if (obj.t) port._emit({ type: 'chunk', id, text: obj.t });
        if (obj.error) port._emit({ type: 'error', id, message: obj.error });
        if (obj.mode) port._emit({ type: 'health', health: { mode: obj.mode, model: obj.model } });
      });

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.push(decoder.decode(value, { stream: true }));
        }
      } catch (e) {
        if (e.name === 'AbortError') { port._emit({ type: 'aborted', id }); inflight.delete(id); return; }
        port._emit({ type: 'error', id, message: e.message || '流读取失败' });
        inflight.delete(id);
        return;
      }

      inflight.delete(id);
      port._emit({ type: 'done', id });
    }



    // 服务端模式：轮询客户端状态代理（service.mjs 转发到本机 8790）
    let lastState = '';
    setInterval(async () => {
      try {
        const r = await fetch(API + '/state', { cache: 'no-store', credentials: 'same-origin' });
        if (!r.ok) return;
        const st = await r.json();
        const key = String(st && st.phase) + '|' + String(st && st.postopDay) + '|' + String(st && st.confidence);
        if (key === lastState) return;
        lastState = key;
        port._emit({ type: 'client-state', state: st });
      } catch (e) { /* 代理没开 */ }
    }, 4000);

    return port;
  }

  window.chrome = window.chrome || {};
  window.chrome.runtime = {
    id: 'gouqianyin-server-hook',
    getURL(p) { return BASE + '/' + String(p).replace(/^\/+/, ''); },
    connect() { return createPort(); },
    lastError: null
  };
})();

})();

/* ===== data/case-data.js ===== */
(function(){
/*
 * 病例 · 场景 · 知识库（唯一事实来源）
 * ---------------------------------------------------------------
 * 本文件同时承担三件事：
 *   1) 病例事实边界（患者只能回答 facts 里的内容）
 *   2) 十场景配置（四个统一功能名 + 任务名 + 角色 + 上下文）
 *   3) 术后时间线（第 1/2/3/7 天，患者状态不同）
 *
 * 修改约定：
 *   - 四个统一功能名只允许是：智能病史问诊 / 智能情境化护患交流 /
 *     智能护理导学 / 智能个性化学习反馈
 *   - 窗口标题 = functionName + '｜' + taskName
 */
(function () {
  'use strict';

  /* ---------------- 四个统一功能名 ---------------- */
  const FN = {
    HISTORY: '智能病史问诊',
    COMMUNICATE: '智能情境化护患交流',
    GUIDE: '智能护理导学',
    FEEDBACK: '智能个性化学习反馈'
  };

  /* ---------------- 病例事实 ---------------- */
  const CASE = {
    id: 'HLF10631030',
    systemTitle: '下肢骨折骨牵引护理技术虚拟仿真实验',
    school: '重庆医科大学护理学院',

    patient: {
      id: 'case-patient-01',
      name: '王建国',
      sex: '男',
      age: 38,
      height: 170,
      weight: 70,
      bed: '创伤骨科 3 床',
      diagnose: '右股骨干骨折（闭合性）',
      allergy: '磺胺类药物过敏'
    },

    facts: [
      { k: '受伤经过', v: '骑电动车摔倒，右大腿外侧着地，伤后右大腿剧痛、肿胀，不能站立行走，被家人送来急诊。', source: '教学病例设定' },
      { k: '受伤时间', v: '入院前约 2 小时。', source: '教学病例设定' },
      { k: '疼痛', v: '右大腿持续性胀痛，活动时明显加重，目前 NRS 评分 6 分。', source: '原系统考核题' },
      { k: '疼痛评分', v: '采用 NRS 数字评分法，现在是 6 分，属于中度疼痛。', source: '原系统考核题' },
      { k: '伴随症状', v: '受伤后没有昏迷，没有胸闷、气促，没有开放伤口，没有明显出血。', source: '教学病例设定' },
      { k: '既往病史', v: '平时身体一般，没有糖尿病、心脏病，没有手术史。', source: '教学病例设定' },
      { k: '过敏史', v: '对磺胺类药物过敏，以前吃过磺胺类药起过皮疹。', source: '原系统考核题' },
      { k: '体重身高', v: '体重 70kg，身高 170cm。', source: '原系统考核题' },
      { k: '术前准备', v: '已经禁食禁饮，做过皮试，建立了静脉通路，备皮完成，牵引架和砝码已备好。', source: '教学病例设定' }
    ],

    unknowns: [
      '具体的手术方案和主刀医生',
      '化验单、X 光片的具体数值与报告原文',
      '住院费用、出院时间',
      '家族里其他人的疾病情况'
    ],

    /* ---------------- 术后时间线 ---------------- */
    postopDays: {
      1: {
        label: '术后第 1 天',
        pain: '切口和牵引侧大腿胀痛，NRS 5 分，活动时加重。',
        psych: '麻醉刚过，人有点烦躁，怕疼，不太敢动。',
        focus: ['疼痛护理', '患肢血运观察', '体位与翻身']
      },
      2: {
        label: '术后第 2 天',
        pain: '疼痛比昨天轻，NRS 3 分，主要是酸胀。',
        psych: '情绪平稳一些，开始问什么时候能坐起来。',
        focus: ['针眼护理', '早期床上活动', '皮肤压力性损伤预防']
      },
      3: {
        label: '术后第 3 天',
        pain: '牵引侧大腿酸胀，针眼处偶尔有牵拉感，NRS 2 分。',
        psych: '躺了几天有点烦躁，担心拖累家里人，晚上睡不好。',
        focus: ['心理护理', '睡眠', '并发症观察']
      },
      7: {
        label: '术后第 7 天',
        pain: '疼痛明显缓解，NRS 1 分，主要是活动时不适。',
        psych: '情绪好转，关心康复进度和出院时间。',
        focus: ['康复指导', '牵引有效性复核', '出院准备']
      }
    }
  };

  /* ---------------- 护理知识库 ---------------- */
  CASE.knowledge = [
    { id: 'traction-principle', title: '骨牵引的原理', tags: ['牵引原理', '为什么', '原理'], body: '骨牵引通过牵引绳、支架与滑车连接砝码，沿肢体纵轴持续施加拉力，对抗肌肉痉挛与收缩，使骨折断端复位并保持稳定；牵引针直接作用于骨骼，牵引力比皮肤牵引更大、更持久。' },
    { id: 'traction-weight', title: '牵引重量怎么定', tags: ['牵引重量', '砝码', '多少公斤', '重量'], body: '下肢骨牵引重量一般为体重的 1/7～1/10。本例体重 70kg，对应约 7～10kg；具体数值按医嘱和复位情况调整，不可随意增减，也不可随意放松或提拉砝码。' },
    { id: 'traction-position', title: '体位与装置要求', tags: ['体位', '患肢体位', '牵引架', '滑轮'], body: '患肢保持外展中立位，牵引绳与患肢长轴在同一直线上，滑轮灵活、砝码悬空不触地、不靠床；重量一经设定不得随意改变，床上避免堆放物品压迫牵引绳。' },
    { id: 'neurovascular', title: '患肢血运与感觉观察', tags: ['血运', '末梢', '感觉', '足背动脉', '麻木'], body: '牵引后需复测患肢感觉与末梢血运：观察皮肤颜色、温度、毛细血管充盈时间，触摸足背动脉搏动，询问有无麻木、发凉、剧痛。发现苍白、发凉、麻木或搏动减弱，立即报告医生。' },
    { id: 'pin-care', title: '牵引针眼护理', tags: ['针眼', '感染', '进针处'], body: '针眼处每日用 75% 乙醇滴注消毒，保持清洁干燥，不随意擦拭或覆盖不洁敷料；观察红肿、渗液、疼痛加剧及体温升高，警惕针道感染。' },
    { id: 'complication', title: '常见并发症观察', tags: ['并发症', '观察什么', '风险'], body: '重点观察：针眼感染、足下垂（腓总神经受压）、关节僵硬与肌肉萎缩、深静脉血栓、过牵导致的疼痛加剧或肢体麻木、坠积性肺炎与压疮等卧床相关并发症。' },
    { id: 'pain-nrs', title: '疼痛评估与再评估', tags: ['疼痛', 'NRS', '评分', '评估'], body: 'NRS 数字评分法 0～10 分：1～3 轻度，4～6 中度，7～10 重度。本例 6 分为中度疼痛。静脉给药镇痛后一般 15～30 分钟内再次评估并记录。' },
    { id: 'analgesia', title: '镇痛用药注意', tags: ['镇痛', '用药', '凯纷', '氟比洛芬'], body: '本例使用 0.9% 氯化钠 100ml + 凯纷（氟比洛芬酯）50mg 静脉注射。用药前核对过敏史（本例磺胺类过敏），给药后观察镇痛效果与不良反应，并按医嘱时限复评疼痛。' },
    { id: 'communication', title: '牵引期间的护患沟通要点', tags: ['沟通', '宣教', '怎么跟病人说'], body: '用患者能听懂的话说明目的与配合方法：为什么要牵引、会有什么感觉、需要怎样配合、出现什么情况要按铃。每次操作前先告知、操作中安抚、操作后交代注意事项。' },
    { id: 'psych-care', title: '术后心理护理', tags: ['心理', '情绪', '烦躁', '焦虑'], body: '长期卧床与活动受限易出现烦躁、焦虑。引导患者说出担心的事，解释牵引周期与康复计划，鼓励家属参与陪伴，安排可行的床上活动与作息，必要时请心理护理专科会诊。' },
    { id: 'dvt', title: '深静脉血栓观察', tags: ['血栓', 'DVT', '肿胀', '小腿'], body: '观察患肢有无突发肿胀、疼痛、皮温升高、浅静脉扩张，测量双下肢周径并对比。怀疑血栓时禁止按摩和热敷，立即制动并报告医生。' },
    { id: 'skin', title: '压力性损伤预防', tags: ['压疮', '皮肤', '翻身'], body: '每 2 小时协助翻身，骶尾、足跟、肩胛等骨突处减压；保持床单位平整干燥，观察皮肤有无发红、破损，使用减压垫。' }
  ];

  /* ---------------- 十场景配置 ---------------- */
  const SCENARIOS = [
    {
      id: 'preop-history', no: '01', phase: 'preop',
      functionName: FN.HISTORY, taskName: '病史采集与症状问诊',
      role: 'patient', mode: 'study',
      tags: ['病史回顾', '病史采集', '问诊', '护理评估', '入院'],
      chips: ['您是怎么受伤的？', '现在哪里最疼，疼到什么程度？', '以前有没有药物过敏？', '受伤以后有没有别的不舒服？'],
      goal: '学生主动询问受伤经过、时间、疼痛性质、伴随症状、既往史与过敏史'
    },
    {
      id: 'preop-talk', no: '02', phase: 'preop',
      functionName: FN.COMMUNICATE, taskName: '术前沟通与疑问交流',
      role: 'patient', mode: 'study',
      tags: ['术前准备', '术前访视', '知情同意', '术前沟通'],
      chips: ['您对牵引最担心什么？', '术前为什么要禁食禁水？', '牵引的时候会疼吗？', '您还有哪里没听明白？'],
      goal: '学生解释术前准备与注意事项，回应患者担忧'
    },
    {
      id: 'intraop-communicate', no: '03', phase: 'intraop',
      functionName: FN.COMMUNICATE, taskName: '术中沟通与宣教',
      role: 'nurse', mode: 'study',
      tags: ['术中沟通', '沟通与宣教', '身份核对', '术中准备'],
      chips: ['帮我示范一句术前告知', '牵引时患者应该怎么配合？', '患者说很痛，我该怎么回应？', '怎么确认牵引部位？'],
      goal: '学生在操作中完成告知、安抚与配合指导'
    },
    {
      id: 'intraop-principle', no: '04', phase: 'intraop',
      functionName: FN.GUIDE, taskName: '牵引原理',
      role: 'tutor', mode: 'study',
      tags: ['牵引原理', '牵引装置', '砝码', '滑轮', '反牵引'],
      chips: ['为什么需要持续牵引？', '为什么牵引方向要和肢体长轴一致？', '反牵引起什么作用？', '砝码为什么必须悬空？'],
      goal: '学生理解牵引的力学原理与装置作用'
    },
    {
      id: 'intraop-observe', no: '05', phase: 'intraop',
      functionName: FN.GUIDE, taskName: '操作观察与效果判断',
      role: 'tutor', mode: 'study',
      tags: ['复测患肢感觉', '末梢血运', '牵引效果', '观察'],
      chips: ['怎么判断牵引有效？', '要观察哪些血运指标？', '牵引重量怎么核对？', '出现麻木说明什么？'],
      goal: '学生根据已确认的观察项判断牵引状态，而不是凭感觉下结论'
    },
    {
      id: 'postop-psych', no: '06', phase: 'postop',
      functionName: FN.COMMUNICATE, taskName: '术后心理护理',
      role: 'patient', mode: 'study',
      tags: ['心理护理', '情绪', '焦虑', '烦躁', '睡眠'],
      chips: ['您现在最担心的是什么？', '晚上睡不好是因为疼吗？', '担心拖累家里人吗？', '想不想聊聊康复计划？'],
      goal: '学生开展心理护理与人文关怀，患者回应随沟通方式变化'
    },
    {
      id: 'postop-care', no: '07', phase: 'postop',
      functionName: FN.GUIDE, taskName: '术后护理指导',
      role: 'tutor', mode: 'study',
      tags: ['日常护理', '生活护理', '翻身', '体位', '有效咳嗽', '康复'],
      chips: ['翻身时要注意什么？', '怎么指导有效咳嗽？', '皮肤怎么观察？', '什么时候可以开始活动？'],
      goal: '学生掌握术后日常护理与早期活动要点'
    },
    {
      id: 'postop-complication', no: '08', phase: 'postop',
      functionName: FN.GUIDE, taskName: '并发症观察',
      role: 'tutor', mode: 'study',
      tags: ['并发症观察', '病情观察', '肿胀', '血栓', '牵引失效'],
      chips: ['要警惕哪些并发症？', '怎么 early 发现血栓？', '牵引失效有什么表现？', '针眼感染看什么？'],
      goal: '学生依据患者陈述与既有资料判断，答题后才给错因解释'
    },
    {
      id: 'report-score', no: '09', phase: 'report',
      functionName: FN.FEEDBACK, taskName: '成绩与能力分析',
      role: 'coach', mode: 'exam',
      tags: ['考核评价', '成绩', '得分', '能力'],
      chips: ['我哪些能力掌握得比较好？', '哪些操作需要加强？', '为什么这项护理判断容易出错？'],
      goal: '基于真实成绩分析，无成绩时只给一般性建议'
    },
    {
      id: 'report-review', no: '10', phase: 'report',
      functionName: FN.FEEDBACK, taskName: '个性化复习建议',
      role: 'coach', mode: 'exam',
      tags: ['学习反馈', '复习', '成绩分析', '下一步'],
      chips: ['下一次应该重点复习什么？', '怎么提升牵引护理能力？', '推荐哪些练习顺序？'],
      goal: '给出可执行的复习路径'
    }
  ];

  CASE.FN = FN;
  CASE.scenarios = SCENARIOS;
  CASE.byId = Object.fromEntries(SCENARIOS.map(s => [s.id, s]));

  window.BT_CASE = CASE;
})();

})();

/* ===== data/prompt.js ===== */
(function(){
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

})();

/* ===== core/instrument.js ===== */
(function(){
/*
 * 埋点模块（本地闭环，不上传）
 * ---------------------------------------------------------------
 * 记录：场景识别、场景切换、面板开合、提问、回答完成、错误、设置变更。
 * 每条事件都带当时的场景快照，便于事后分析「学生走到哪一步、问了什么」。
 * 存储：localStorage 环形缓冲（默认 600 条），可导出 JSON / CSV。
 * 注意：不写原系统任何数据，不向任何服务器发送。
 */
(function () {
  'use strict';

  const KEY = 'bt_trace_v1';
  const MAX = 600;

  const state = {
    sessionId: 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
    buf: [],
    listeners: [],
    scene: null
  };

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) state.buf = JSON.parse(raw) || [];
    } catch (e) { state.buf = []; }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state.buf.slice(-MAX)));
    } catch (e) { /* 存储满时忽略 */ }
  }

  function sceneSnapshot() {
    const s = state.scene;
    if (!s) return null;
    return {
      phase: s.phase || null,
      postopDay: s.postopDay || null,
      scenarioId: s.scenarioId || null,
      functionName: s.functionName || null,
      mode: s.mode || null,
      contextSource: s.contextSource || null,
      confidence: s.confidence || null
    };
  }

  function log(event, payload) {
    const rec = {
      t: Date.now(),
      iso: new Date().toISOString(),
      sid: state.sessionId,
      ev: event,
      scene: sceneSnapshot(),
      ...(payload ? { d: payload } : {})
    };
    state.buf.push(rec);
    if (state.buf.length > MAX) state.buf = state.buf.slice(-MAX);
    save();
    for (const fn of state.listeners) {
      try { fn(rec); } catch (e) { /* ignore */ }
    }
    return rec;
  }

  function setScene(scene) {
    state.scene = scene || null;
  }

  function all() {
    return state.buf.slice();
  }

  function summary() {
    const byEvent = {};
    const byScenario = {};
    for (const r of state.buf) {
      byEvent[r.ev] = (byEvent[r.ev] || 0) + 1;
      const k = (r.scene && r.scene.scenarioId) || 'unknown';
      byScenario[k] = (byScenario[k] || 0) + 1;
    }
    return {
      sessionId: state.sessionId,
      total: state.buf.length,
      byEvent,
      byScenario,
      first: state.buf[0] ? state.buf[0].iso : null,
      last: state.buf[state.buf.length - 1] ? state.buf[state.buf.length - 1].iso : null
    };
  }

  function toCSV() {
    const head = ['time', 'iso', 'session', 'event', 'phase', 'postopDay', 'scenarioId', 'functionName', 'mode', 'contextSource', 'confidence', 'data'];
    const rows = state.buf.map(r => {
      const s = r.scene || {};
      return [
        r.t, r.iso, r.sid, r.ev,
        s.phase || '', s.postopDay || '', s.scenarioId || '', s.functionName || '',
        s.mode || '', s.contextSource || '', s.confidence || '',
        r.d ? JSON.stringify(r.d).replace(/"/g, "'").replace(/,/g, ';') : ''
      ].join(',');
    });
    return [head.join(','), ...rows].join('\n');
  }

  function clear() {
    state.buf = [];
    save();
  }

  function subscribe(fn) {
    state.listeners.push(fn);
    return () => {
      state.listeners = state.listeners.filter(f => f !== fn);
    };
  }

  load();

  window.BT_TRACE = { log, setScene, all, summary, toCSV, clear, subscribe, get sessionId() { return state.sessionId; } };
})();

})();

/* ===== platform/bridge.js ===== */
(function(){
/*
 * 平台桥接（postMessage 协议解析）
 * ---------------------------------------------------------------
 * 依据：平台学习页 BaseLearning 组件里有一段 window.addEventListener("message", ...)
 * 的处理逻辑，实验内容（iframe 内的 Unity 页面 / 客户端网页壳）用它向平台上报：
 *
 *   "…///<data>"   → 平台调用 ScormDataUpload（步骤上报）
 *   "…***<json>"   → 平台调用 JsDataUpload（结果/成绩上报，JSON）
 *   "…$$$"         → 平台刷新实验信息
 *   "…￥￥￥"       → 平台刷新成绩
 *   "…~~~"         → 平台重置计时
 *
 * 我们只“旁听”这些同源消息，不拦截、不修改、不伪造，也不主动发送。
 * 有了它，在 iframe / 网页壳形态下就能拿到真实的步骤与成绩信号。
 */
(function () {
  'use strict';

  const T = window.BT_TRACE;

  const state = {
    active: false,
    lastAt: 0,
    lastKind: null,
    stepCount: 0,
    lastStep: null,
    lastResult: null,
    log: []
  };

  const ACTIVE_WINDOW = 5 * 60 * 1000; // 5 分钟内收到过消息才算“活着”

  function push(rec) {
    state.active = true;
    state.lastAt = Date.now();
    state.lastKind = rec.kind;
    state.log.push(rec);
    if (state.log.length > 50) state.log = state.log.slice(-50);
    if (T) {
      try { T.log('bridge', { kind: rec.kind, size: rec.raw ? String(rec.raw).length : 0 }); } catch (e) {}
    }
  }

  /* 尽量从字符串里读出结构化信息，读不出就保留原文 */
  function parseLoose(text) {
    const s = String(text || '').trim();
    if (!s) return null;
    if (s[0] === '{' || s[0] === '[') {
      try { return JSON.parse(s); } catch (e) { /* 继续 */ }
    }
    try {
      const dec = decodeURIComponent(s);
      if (dec !== s && (dec[0] === '{' || dec[0] === '[')) return JSON.parse(dec);
    } catch (e) { /* 继续 */ }
    return null;
  }

  /* 从任意对象里捞出可能表示“分数/步骤/场景”的字段 */
  function extract(obj) {
    if (!obj || typeof obj !== 'object') return {};
    const out = {};
    const keys = Object.keys(obj);
    const pick = (names) => {
      for (const n of names) {
        for (const k of keys) {
          if (k.toLowerCase() === n) return obj[k];
        }
      }
      return undefined;
    };
    const score = pick(['score', 'totalscore', 'grade', 'result']);
    if (score !== undefined) out.score = Number(score);
    const step = pick(['step', 'stepindex', 'stepno', 'stepnumber', 'currentstep']);
    if (step !== undefined) out.step = Number(step);
    const total = pick(['steptotal', 'totalstep', 'steps', 'total']);
    if (total !== undefined) out.total = Array.isArray(total) ? total.length : Number(total);
    const scene = pick(['sceneid', 'scene', 'taskid', 'task']);
    if (scene !== undefined) out.scene = scene;
    const day = pick(['day', 'postopday']);
    if (day !== undefined) out.day = Number(day);
    return out;
  }

  function handle(e) {
    const d = e.data;
    if (typeof d !== 'string' || d.length > 20000) return;

    if (d.indexOf('///') !== -1) {
      const raw = d.split('///')[1];
      const parsed = parseLoose(raw);
      const rec = { kind: 'step', at: Date.now(), raw, parsed, meta: extract(parsed) };
      state.stepCount++;
      state.lastStep = rec;
      push(rec);
      return;
    }
    if (d.indexOf('***') !== -1) {
      const raw = d.split('***')[1];
      const parsed = parseLoose(raw);
      const rec = { kind: 'result', at: Date.now(), raw, parsed, meta: extract(parsed) };
      state.lastResult = rec;
      push(rec);
      return;
    }
    if (d.indexOf('$$$') !== -1) { push({ kind: 'reload-info', at: Date.now() }); return; }
    if (d.indexOf('￥￥￥') !== -1) { push({ kind: 'reload-score', at: Date.now() }); return; }
    if (d.indexOf('~~~') !== -1) { push({ kind: 'reset-timer', at: Date.now() }); return; }
  }

  function isActive() {
    return state.active && (Date.now() - state.lastAt) < ACTIVE_WINDOW;
  }

  function snapshot() {
    return {
      active: isActive(),
      stepCount: state.stepCount,
      lastKind: state.lastKind,
      lastStep: state.lastStep ? { meta: state.lastStep.meta, parsed: state.lastStep.parsed, raw: String(state.lastStep.raw).slice(0, 200) } : null,
      lastResult: state.lastResult ? { meta: state.lastResult.meta, parsed: state.lastResult.parsed } : null
    };
  }

  /* 成绩对象（若平台上报里带 steps 数组，也一并保留） */
  function getScorePayload() {
    const r = state.lastResult;
    if (!r || !r.parsed) return null;
    return r.parsed;
  }

  function start() {
    window.addEventListener('message', handle, false);
    // 同源 iframe 的 postMessage 会到达这里；跨域也一样（postMessage 本就跨域）
  }


  /* ------------------------------------------------------------------
   * 平台接口旁听结果（来自 MAIN world 的 api-capture.js）
   * 只存结构化字段：成绩、进度、实验身份。不含 token、Cookie、请求头。
   * ------------------------------------------------------------------ */
  const api = { scores: [], process: null, experiment: null, updatedAt: 0 };

  function normScores(body) {
    const out = [];
    const d = body && body.data;
    if (!d) return out;
    // ItemsMineScore: { data: { data: [ {experimentName, score, timeUsed, endTime} ] } }
    const list = Array.isArray(d) ? d : (Array.isArray(d.data) ? d.data : (Array.isArray(d.items) ? d.items : null));
    if (!list) return out;
    for (const it of list.slice(0, 30)) {
      if (!it || typeof it !== 'object') continue;
      const score = Number(it.score != null ? it.score : it.totalScore);
      if (!Number.isFinite(score)) continue;
      out.push({
        name: it.experimentName || it.name || '',
        score,
        used: it.timeUsed != null ? Math.round(Number(it.timeUsed) / 60) + '′' : '',
        time: it.endTime || it.createTime || ''
      });
    }
    return out;
  }

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (d && d.__bt_poll__ === true && d.process) {
      api.process = d.process;
      api.updatedAt = Date.now();
      if (typeof window.__btOnProgress === 'function') window.__btOnProgress(d.process);
      return;
    }
    if (!d || d.__bt_api__ !== true) return;
    const url = String(d.url || '');
    const body = d.body;
    api.updatedAt = Date.now();

    if (/ItemsMineScore|ItemsByUser|ExperimentResult\/Items/i.test(url)) {
      const rows = normScores(body);
      if (rows.length) api.scores = rows;
    }
    if (/GetProcess/i.test(url) && body && body.data) {
      api.process = {
        ppv: body.data.ppv,
        studyeds: body.data.studyeds,
        timeUsed: body.data.timeUsed
      };
    }
    if (/\/api\/Experiment\/Item(\?|$)/i.test(url) && body && body.data) {
      api.experiment = {
        id: body.data.id, name: body.data.name, type: body.data.type,
        typeName: body.data.typeName, code: body.data.code
      };
    }
  }, false);

  function apiSnapshot() {
    return {
      active: api.scores.length > 0 || !!api.process,
      scores: api.scores.slice(0, 10),
      process: api.process,
      experiment: api.experiment,
      updatedAt: api.updatedAt
    };
  }

  window.BT_BRIDGE = { start, isActive, snapshot, getScorePayload, apiSnapshot, state };
})();

})();

/* ===== platform/score-parse.js ===== */
(function(){
/*
 * 成绩页解析（只读 DOM，不碰 token）
 * ---------------------------------------------------------------
 * 数据来源：学生在平台上「我的成绩 / 课程成绩 / 考试成绩」页面里
 * 已经渲染出来的表格或卡片。扩展只读取这些用户可见文本，
 * 不读 token、不调鉴权接口、不提交任何数据。
 *
 * 解析结果缓存到 localStorage（7 天），报告阶段可直接取用。
 *
 * 页面路由依据 REA 静态分析的平台路由表（136 条），相关的是：
 *   /MyScore、/CurriculumScore、/MyExam/ExamScores/preview、
 *   /Exam/scoreInfo、/ScoreManage、/teach/expermyment/scoremanage
 */
(function () {
  'use strict';

  const T = window.BT_TRACE;
  const CACHE_KEY = 'bt_score_cache';
  const TTL = 7 * 24 * 3600 * 1000;

  const SCORE_ROUTES = [
    /\/MyScore(\/|$|\?)/i,
    /\/CurriculumScore(\/|$|\?)/i,
    /\/MyExam\/ExamScores/i,
    /\/Exam\/scoreInfo/i,
    /\/ScoreManage(\/|$|\?)/i,
    /\/expermyment\/scoremanage/i
  ];

  function onScorePage() {
    const p = location.pathname + location.search;
    return SCORE_ROUTES.some(re => re.test(p));
  }

  function clean(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  function isScoreHeader(text) {
    return /成绩|分数|得分|评分/.test(text) && !/成绩管理|成绩分析/.test(text);
  }

  /* ---------- 表格解析 ---------- */
  function parseTables() {
    const rows = [];
    const tables = document.querySelectorAll('table');
    for (const t of tables) {
      let head = [];
      const ths = t.querySelectorAll('thead th, thead td');
      if (ths.length) head = [...ths].map(x => clean(x.innerText));

      const trs = t.querySelectorAll('tbody tr');
      const list = trs.length ? trs : t.querySelectorAll('tr');

      for (const tr of list) {
        const tds = [...tr.querySelectorAll('td')];
        if (tds.length < 2) continue;
        const cells = tds.map(x => clean(x.innerText));
        if (!cells.some(Boolean)) continue;

        // 表头行（td 版本）跳过
        if (cells.some(isScoreHeader) && cells.length === head.length) continue;

        let name = '', score = null, time = '', used = '';
        for (let i = 0; i < cells.length; i++) {
          const c = cells[i];
          const col = head[i] || '';
          if (!name && /实验|项目|课程|名称|试卷|任务/.test(col) && c) { name = c; continue; }
          if (score === null && /成绩|分数|得分|评分/.test(col)) {
            const m = c.match(/-?\d{1,3}(\.\d+)?/);
            if (m) { score = Number(m[0]); continue; }
          }
          if (!time && /\d{4}-\d{2}-\d{2}/.test(c)) { time = c; continue; }
          if (!used && /\d+\s*[′']\s*\d+\s*[″"]/.test(c)) { used = c; continue; }
        }

        // 表头缺失时的兜底
        if (score === null) {
          for (const c of cells) {
            const m = c.match(/^(\d{1,3}(\.\d+)?)\s*分?$/);
            if (m) { score = Number(m[1]); break; }
          }
        }
        if (score === null) continue;
        if (!name) name = cells.find(c => c && !/^\d/.test(c)) || '（未命名）';
        rows.push({ name: name.slice(0, 60), score, time, used });
        if (rows.length >= 30) return rows;
      }
    }
    return rows;
  }

  /* ---------- 卡片式兜底：「xx 86 分」 ---------- */
  function parseCards() {
    const rows = [];
    let text = '';
    try { text = clean(document.body.innerText); } catch (e) { return rows; }

    // 「下肢骨折骨牵引护理技术虚拟仿真实验项目 … 86 分」
    const re = /([\u4e00-\u9fa5A-Za-z0-9（）()·\-]{6,60}?)\s*(?:成绩|得分)?\s*[：:]?\s*(\d{1,3}(?:\.\d+)?)\s*分/g;
    let m;
    while ((m = re.exec(text)) && rows.length < 20) {
      const name = m[1].trim();
      if (/满分|总分|平均/.test(name)) continue;
      const score = Number(m[2]);
      if (score > 100) continue;
      rows.push({ name, score, time: '', used: '' });
    }
    return rows;
  }

  /* ---------- 汇总成一段可读文本 ---------- */
  function buildSummary(rows) {
    if (!rows.length) return null;
    const lines = rows.slice(0, 12).map((r, i) => {
      const parts = [`${i === 0 ? '记录' : '第' + (i + 1) + '条'}：${r.name}`];
      parts.push(`得分 ${r.score}`);
      if (r.used) parts.push(`用时 ${r.used}`);
      if (r.time) parts.push(r.time);
      return parts.join('，');
    });
    const avg = rows.reduce((a, b) => a + b.score, 0) / rows.length;
    return `从成绩页读到 ${rows.length} 条记录：\n${lines.join('\n')}\n平均分 ${avg.toFixed(1)}`;
  }

  function parse(force) {
    const rows = parseTables();
    const finalRows = rows.length ? rows : parseCards();
    const summary = buildSummary(finalRows);
    const payload = { at: Date.now(), url: location.href, rows: finalRows, summary };
    if (summary) {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(payload)); } catch (e) {}
      if (T) { try { T.log('score-parse', { rows: finalRows.length, page: location.pathname }); } catch (e) {} }
    }
    return summary ? payload : null;
  }

  function cached() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || !o.summary) return null;
      if (Date.now() - (o.at || 0) > TTL) return null;
      return o;
    } catch (e) { return null; }
  }

  let started = false;
  function start() {
    if (started) return;
    started = true;
    if (!onScorePage()) return;
    // 页面是异步渲染的，等表格出现后再解析一次
    let tries = 0;
    const tick = () => {
      tries++;
      const p = parse();
      if (!p && tries < 8) setTimeout(tick, 800);
    };
    setTimeout(tick, 1200);
  }

  window.BT_SCORE = { start, parse, cached, onScorePage, buildSummary };
})();

})();

/* ===== scene/rules.js ===== */
(function(){
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

})();

/* ===== scene/detect.js ===== */
(function(){
/*
 * 场景适配器（与 UI 完全解耦，只读）
 * ---------------------------------------------------------------
 * 输出统一结构：
 * {
 *   phase, postopDay, taskId, taskName, scenarioId,
 *   functionName, mode, patientId, contextSource, confidence, evidence
 * }
 *
 * 证据分级（强 → 弱）：
 *   1. 页面明确阶段标注（术前阶段 / 术中阶段 / 术后阶段 / 考核评价）
 *   2. URL 中的场景参数与路由
 *   3. 页面任务条文字
 *   4. 页面已发生的业务请求（performance entries，只读取，不重放）
 * 找不到就返回 phase: null，绝不猜。
 */
(function () {
  'use strict';

  const C = window.BT_CASE;

  const { PHASE_RULES, URL_HINTS, HEAD_SELECTORS, BODY_SELECTORS } = window.BT_SCENE_RULES;

  function readRegion(doc, selector, budget) {
    let out = '';
    let used = 0;
    try {
      for (const el of doc.querySelectorAll(selector)) {
        if (used >= budget) break;
        if (el.children.length > 40) continue;
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!t || t.length > 400) continue;
        out += ' ' + t;
        used += t.length;
      }
    } catch (e) { /* 跨域忽略 */ }
    return out;
  }

  function readDoc(doc) {
    const head = (doc.title || '') + readRegion(doc, HEAD_SELECTORS.join(','), 1200);
    const body = readRegion(doc, BODY_SELECTORS.join(','), 2000);
    return { head, body };
  }

  /* ---------- 读取页面可见的成绩与进度（不碰 token、不调接口） ---------- */
  function readVisibleScores() {
    const out = { scores: [], progress: null, studyCount: null, timeUsed: null };
    let text = '';
    try { text = (document.body.innerText || '').replace(/\s+/g, ' '); } catch (e) { return out; }

    // 「2026-05-26 14:34:31 19′10″ 98」
    const re = /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+(\d+)\s*[′']\s*(\d+)\s*[″"]\s+(\d{1,3})/g;
    let m;
    while ((m = re.exec(text)) && out.scores.length < 20) {
      out.scores.push({ time: m[1], used: `${m[2]}′${m[3]}″`, score: Number(m[4]) });
    }

    const pm = text.match(/学习进度[：:]\s*(\d{1,3})\s*%/);
    if (pm) out.progress = Number(pm[1]);

    const cm = text.match(/已完成\s*(\d+)\s*次/);
    if (cm) out.studyCount = Number(cm[1]);

    const tm = text.match(/学习总用时\s*(\d+)\s*分钟/);
    if (tm) out.timeUsed = Number(tm[1]);

    return out;
  }

  /* 只读取页面已发生的资源请求，不发起、不重放 */
  function readNetworkTraces() {
    const traces = [];
    try {
      for (const e of performance.getEntriesByType('resource')) {
        const n = e.name || '';
        if (n.includes('/api/Experiment/Item')) traces.push(n);
        else if (n.includes('/api/Experiment/Launch')) traces.push(n);
        else if (n.includes('/api/ExperimentResult/')) traces.push(n);
      }
    } catch (e) { /* ignore */ }
    return traces;
  }

  /* ---------- 实验身份：从 URL 的 ?id= 读，再调同源公开接口补全 ---------- */
  let expInfo = null;
  let expLoading = false;

  function experimentIdFromUrl() {
    try {
      const u = new URL(location.href);
      const id = u.searchParams.get('id') || u.searchParams.get('experimentId');
      if (id) return id;
      // 平台也可能用路径参数
      const m = location.pathname.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      return m ? m[1] : null;
    } catch (e) { return null; }
  }

  function ensureExperimentInfo() {
    if (expInfo || expLoading) return;
    const id = experimentIdFromUrl();
    if (!id) return;
    expLoading = true;
    fetch('/api/Experiment/Item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id })
    })
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (j && j.data) {
          expInfo = {
            id: j.data.id,
            orgId: j.data.orgExperimentId,
            code: j.data.code,
            name: j.data.name,
            type: j.data.type,
            typeName: j.data.typeName,
            isScore: j.data.isScore
          };
        }
      })
      .catch(() => {})
      .finally(() => { expLoading = false; });
  }

  function collect() {
    let head = '';
    let body = '';

    const main = readDoc(document);
    head += main.head;
    body += main.body;

    let frames = document.querySelectorAll('iframe');
    for (let i = 0; i < frames.length && i < 4; i++) {
      try {
        const d = frames[i].contentDocument;
        if (d) {
          const sub = readDoc(d);
          head += sub.head;
          body += sub.body;
        }
      } catch (e) { /* 跨域 */ }
    }

    let hasCanvas = false;
    try {
      hasCanvas = !!document.querySelector('canvas');
      if (!hasCanvas) {
        for (const f of frames) {
          try { if (f.contentDocument && f.contentDocument.querySelector('canvas')) { hasCanvas = true; break; } } catch (e) {}
        }
      }
    } catch (e) { /* ignore */ }

    head = head.replace(/\s+/g, ' ').slice(0, 2400);
    body = body.replace(/\s+/g, ' ').slice(0, 3000);

    return {
      head,
      body,
      text: (head + ' ' + body).slice(0, 6000),
      hasCanvas,
      traces: readNetworkTraces()
    };
  }

  /* 从文本里读术后天数：「术后第 3 天」「术后3天」「DAY 3」 */
  function readPostopDay(text) {
    let m = text.match(/术后\s*第?\s*([1-7])\s*天/);
    if (m) return Number(m[1]);
    m = text.match(/DAY\s*([1-7])/i);
    if (m) return Number(m[1]);
    return null;
  }

  /* 在阶段内挑最匹配的场景
     顶部区域（标题/阶段栏）里出现的任务词权重更高：
     任务条会列出全部任务，只有当前任务才会出现在顶部标签里。 */
  function pickScenario(phase, head, text) {
    const list = C.scenarios.filter(s => s.phase === phase);
    if (!list.length) return null;
    let best = null, bestScore = 0;
    for (const s of list) {
      let score = 0;
      for (const t of s.tags) {
        if (head.includes(t)) score += t.length * 4;
        else if (text.includes(t)) score += 1;
      }
      if (score > bestScore) { bestScore = score; best = s; }
    }
    if (best) return { scenario: best, score: bestScore };
    // 该阶段没有任何标签命中时，若只有一个场景则直接选它，否则交给 UI 让用户选
    return list.length === 1 ? { scenario: list[0], score: 0 } : null;
  }

  function detect() {
    const { head, body, text, hasCanvas, traces } = collect();
    ensureExperimentInfo();
    const score = { preop: 0, intraop: 0, postop: 0, report: 0 };
    const explicit = { preop: false, intraop: false, postop: false, report: false };
    const evidence = [];

    // 实验介绍页（CourseInfo / 详情页）不是"实验进行中"：
    // 描述文字里出现"考核/并发症/术中"会造成高可信误判，这里只认强步骤标记。
    const isIntroPage = /\/CourseInfo(\?|$)|\/Experiment\/Detail(\?|$)/i.test(location.pathname);
    const hasStepMark = /第\s*\d+\s*步|术中阶段|术前阶段|术后第\s*\d+\s*天|\d+\s*\/\s*10/.test(text);
    if (isIntroPage && !hasStepMark) {
      evidence.push('实验介绍页，不做阶段推断');
    }

    for (const rule of (isIntroPage && !hasStepMark ? [] : PHASE_RULES)) {
      for (const w of rule.primary) {
        if (text.includes(w)) { score[rule.phase] += 5; explicit[rule.phase] = true; evidence.push('阶段标注「' + w + '」'); }
      }
      let n = 0;
      for (const w of rule.secondary) {
        if (text.includes(w) && n < 2) { score[rule.phase] += 1; n++; evidence.push('场景词「' + w + '」'); }
      }
    }

    for (const h of URL_HINTS) {
      if (h.test.test(location.href) && score[h.phase] === 0) { score[h.phase] += 1; evidence.push('URL 特征'); break; }
    }

    let phase = null, best = 0, bestExplicit = false;
    for (const k of ['preop', 'intraop', 'postop', 'report']) {
      if (score[k] === 0) continue;
      if ((explicit[k] && !bestExplicit) || (explicit[k] === bestExplicit && score[k] > best)) {
        phase = k; best = score[k]; bestExplicit = explicit[k];
      }
    }

    let confidence = phase ? (bestExplicit ? 'high' : best >= 2 ? 'medium' : 'low') : 'none';
    let contextSource = 'page';

    // 平台桥接：实验内容通过 postMessage 上报过步骤/成绩
    const pageData = readVisibleScores();

    const bridge = window.BT_BRIDGE ? window.BT_BRIDGE.snapshot() : null;
    if (bridge && bridge.active) {
      evidence.push('收到实验事件 ' + bridge.stepCount + ' 条');
      if (!phase) { contextSource = 'bridge'; confidence = 'medium'; }
      else if (confidence === 'low') confidence = 'medium';
    }

    if (pageData.scores.length) evidence.push('页面成绩 ' + pageData.scores.length + ' 条');

    // 业务请求痕迹（只读）
    if (traces.length) {
      evidence.push('检测到 ' + traces.length + ' 条实验相关请求');
      if (phase && confidence !== 'high') { confidence = 'medium'; contextSource = 'api'; }
    }

    const postopDay = phase === 'postop' ? readPostopDay(text) : null;

    let scenario = null;
    if (phase) {
      const picked = pickScenario(phase, head, text);
      if (picked) {
        scenario = picked.scenario;
        if (picked.score > 0) evidence.push('任务词匹配「' + scenario.taskName + '」');
      }
    }

    // 模式：考核字样出现即视为考核，报告阶段默认考核
    let mode = null;
    if (isIntroPage && !hasStepMark) mode = null;
    else if (phase === 'report') mode = 'exam';
    else if (/考核模式|考试模式|提交试卷|答题/.test(text)) { mode = 'exam'; evidence.push('考核模式词'); }
    else if (phase) mode = 'study';

    return {
      phase,
      postopDay,
      experiment: expInfo,
      pageData: (pageData.scores.length || pageData.progress !== null) ? pageData : null,
      bridge: bridge && bridge.active ? { stepCount: bridge.stepCount, lastKind: bridge.lastKind } : null,
      taskId: scenario ? scenario.id : null,
      taskName: scenario ? scenario.taskName : null,
      scenarioId: scenario ? scenario.id : null,
      functionName: scenario ? scenario.functionName : null,
      mode,
      patientId: C.patient.id,
      contextSource,
      confidence,
      evidence: [...new Set(evidence)].slice(0, 6),
      hasCanvas
    };
  }

  /* 轮询 + 变化回调 */
  function start(onChange, intervalMs) {
    let last = '';
    let timer = null;
    let stopped = false;

    const tick = () => {
      if (stopped) return;
      let r;
      try { r = detect(); } catch (e) { r = { phase: null, confidence: 'none', evidence: [] }; }
      const key = [
        r.phase, r.postopDay, r.scenarioId, r.mode, r.confidence,
        r.bridge ? 'b' : '-',
        r.experiment ? r.experiment.id : '-'
      ].join('|');
      if (key !== last) { last = key; onChange(r); }
      timer = setTimeout(tick, intervalMs || 1500);
    };

    const reset = () => { last = ''; };
    window.addEventListener('popstate', reset);
    window.addEventListener('hashchange', reset);
    document.addEventListener('visibilitychange', reset);

    tick();

    return function stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('popstate', reset);
      window.removeEventListener('hashchange', reset);
      document.removeEventListener('visibilitychange', reset);
    };
  }

  window.BT_SCENE = { detect, start };
})();

})();

/* ===== ui/template.js ===== */
(function(){
/*
 * 面板 DOM 模板（纯字符串，不含逻辑）
 * ---------------------------------------------------------------
 * 由 ui/panel.js 调用：root.innerHTML = BT_TEMPLATE(cssUrl)
 * 拆出来只为让 panel.js 专注状态与交互。
 */
(function () {
  'use strict';

  window.BT_TEMPLATE = function (cssUrl) {
    return `
      <link rel="stylesheet" href="${cssUrl}">
      <div class="bt-root" data-theme="light" data-dock="right">
        <div class="bt-launcher"><span class="bt-launcher-dot"></span><span>智能助教</span></div>
        <div class="bt-mini bt-hidden" title="打开智能助教">AI</div>

        <section class="bt-panel bt-hidden" role="dialog" aria-label="智能护理助教">
          <div class="bt-head">
            <div class="bt-head-avatar"><img alt=""></div>
            <div class="bt-head-text">
              <div class="bt-title">智能护理助教</div>
              <div class="bt-subtitle">正在识别当前场景…</div>
            </div>
            <div class="bt-head-actions">
              <button class="bt-icon-btn" data-act="settings" title="设置">⚙</button>
              <button class="bt-icon-btn" data-act="min" title="收起">—</button>
              <button class="bt-icon-btn" data-act="close" title="关闭">✕</button>
            </div>
          </div>

          <div class="bt-scene">
            <span class="bt-dot none"></span>
            <select class="bt-scene-select" title="手动切换当前实验任务"></select>
            <span class="bt-scene-hint">识别中…</span>
          </div>

          <div class="bt-day">
            <span>时间线：</span>
            <select class="bt-day-select"></select>
            <span class="bt-scene-hint">（未识别时手动指定）</span>
          </div>

          <div class="bt-progress bt-hidden"><span class="bt-progress-text"></span></div>

          <div class="bt-body"></div>
          <div class="bt-chips"></div>

          <div class="bt-score-box">
            <label>粘贴本次考核成绩或错项，我按真实数据帮你分析（不填则只给一般性建议）</label>
            <textarea placeholder="例：术前准备 8/10，牵引重量选择错误，术后观察 6/8……"></textarea>
            <div class="bt-score-actions">
              <button class="bt-mini-btn" data-act="clear-score">清空</button>
              <button class="bt-mini-btn primary" data-act="use-score">用这份成绩分析</button>
            </div>
          </div>

          <div class="bt-foot">
            <div class="bt-input-row">
              <textarea class="bt-input" placeholder="请输入您的问题…"></textarea>
              <button class="bt-send" title="发送">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M3.4 11.2 20 4.2c.9-.4 1.8.5 1.4 1.4l-7 16.6c-.4.9-1.7.9-2.1 0l-2.4-6.1-6.5-2.6c-.9-.4-.9-1.8 0-2.2Z" fill="currentColor"/>
                </svg>
                <span>发送</span>
              </button>
            </div>
            <div class="bt-foot-note">
              <span class="bt-badge mock">未连接本地服务</span>
              <span class="bt-exam-badge bt-badge exam bt-hidden">考核中 · 不提供答案</span>
              <span class="bt-bridge-badge bt-badge live bt-hidden">已接入实验事件</span>
              <span class="bt-trace-count"></span>
            </div>
          </div>

          <div class="bt-settings">
            <div class="bt-set-head">
              <span>设置</span><span class="sp"></span>
              <button class="bt-icon-btn" data-act="set-close">✕</button>
            </div>
            <div class="bt-tabs">
              <button class="bt-tab on" data-tab="ui">界面</button>
              <button class="bt-tab" data-tab="model">模型</button>
              <button class="bt-tab" data-tab="trace">埋点</button>
            </div>
            <div class="bt-set-body"></div>
          </div>

          <div class="bt-toast"></div>
        </section>
      </div>
    `;
  };
})();

})();

/* ===== ui/panel.js ===== */
(function(){
/*
 * 面板 UI（Shadow DOM 隔离）
 * - 自适应：右侧停靠 / 左侧 / 底部抽屉 / 窄屏全屏
 * - 界面可改：主题、宽度、字号、透明度、停靠位
 * - 模型可配：地址/模型/流式/超时（Key 只在本地服务，不经过前端）
 * - 埋点：BT_TRACE 记录全流程事件
 */
(function () {
  'use strict';

  const C = window.BT_CASE;
  const T = window.BT_TRACE;

  function asset(n) {
    try { return chrome.runtime.getURL('assets/' + n); } catch (e) { return '../extension/assets/' + n; }
  }
  const AV = { patient: asset('patient.svg'), nurse: asset('nurse.svg'), coach: asset('coach.svg') };

  const PFX = { preop: '术前', intraop: '术中', postop: '术后', report: '报告' };
  const DEFAULT_PREFS = { theme: 'light', width: 392, fontScale: 100, opacity: 100, dock: 'right' };

  const EMBED = !!window.__BT_EMBED__;

  const state = {
    open: false, mini: false,
    scene: null, override: null,
    health: { mode: 'unknown', model: '' },
    threads: {}, busy: false, scoreText: '', scoreOpen: false,
    prefs: { ...DEFAULT_PREFS },
    cfg: null,
    reqId: 0, activeReqId: null,
    settingsOpen: false, settingsTab: 'ui'
  };

  let root, els = {}, port = null, stopScene = null, toastTimer = null;
  let renderedKey = 'unknown';   // 上一次真正渲染过的会话 key

  /* ---------------- 偏好 ---------------- */
  function loadPrefs() {
    try {
      const raw = localStorage.getItem('bt_prefs');
      if (raw) state.prefs = { ...DEFAULT_PREFS, ...JSON.parse(raw) };
    } catch (e) { /* ignore */ }
  }
  function savePrefs() {
    try { localStorage.setItem('bt_prefs', JSON.stringify(state.prefs)); } catch (e) {}
  }
  function applyPrefs() {
    if (!els.panel) return;
    const r = els.root;
    r.dataset.theme = state.prefs.theme;
    r.dataset.dock = state.prefs.dock;
    els.panel.style.setProperty('--bt-w', state.prefs.width + 'px');
    // 宽屏才用行内定位；窄屏交给媒体查询接管
    const narrow = window.innerWidth <= 900;
    els.panel.style.setProperty('--bt-fs', (13 * state.prefs.fontScale / 100) + 'px');
    els.panel.style.setProperty('--bt-op', state.prefs.opacity / 100);

    if (narrow) {
      ['left', 'right', 'top', 'bottom'].forEach(k => { els.panel.style[k] = ''; });
      return;
    }
    const top = computeTop();

    if (state.prefs.dock === 'left') {
      els.panel.style.right = 'auto'; els.panel.style.left = '20px';
      els.panel.style.top = top + 'px'; els.panel.style.bottom = 'auto';
    } else if (state.prefs.dock === 'right') {
      els.panel.style.left = 'auto'; els.panel.style.right = '20px';
      els.panel.style.top = top + 'px'; els.panel.style.bottom = 'auto';
    } else {
      els.panel.style.left = '16px'; els.panel.style.right = '16px';
      els.panel.style.top = 'auto'; els.panel.style.bottom = '16px';
    }
  }

  /* ---------------- 场景 ---------------- */
  function activeScene() { return state.override || state.scene || null; }

  function threadKey() {
    const s = activeScene();
    return s && s.scenarioId ? s.scenarioId : (s && s.phase ? s.phase : 'unknown');
  }

  function currentThread() {
    const k = threadKey();
    if (!state.threads[k]) state.threads[k] = [];
    return state.threads[k];
  }

  function roleOfScene() {
    const s = activeScene();
    if (s && s.scenarioId && C.byId[s.scenarioId]) return C.byId[s.scenarioId].role;
    return 'nurse';
  }

  function greetingFor(s) {
    if (!s || !s.scenarioId) {
      return '我还没识别出当前实验阶段。请在下方选择“阶段 · 任务”，我会按对应角色和你交流。';
    }
    const sc = C.byId[s.scenarioId];

    if (sc.role === 'patient') {
      return s.phase === 'preop'
        ? `您好，我是 3 床王建国。${sc.id === 'preop-history' ? '您想了解我这次受伤的情况，直接问就行。' : '手术前的事我还想再问问您。'}`
        : `我是王建国。${sc.id === 'postop-psych' ? '这几天躺着，心里有点烦，您能陪我聊会儿吗？' : '您有什么要交代的，我听着。'}`;
    }
    if (sc.role === 'nurse') return '我是本次操作的责任护士。牵引的配合要点、装置和重量、要观察什么，你可以问我；需要我示范怎么跟患者说，也可以直接讲。';
    if (sc.role === 'tutor') return `我是护理带教老师。这一环节讲「${sc.taskName}」，你可以问原理、判断标准，或者让我解释你看到的现象。`;
    return '我是带教老师。你可以把这次考核的成绩或错项贴给我，我帮你分析哪块掌握得好、哪块要补；没有成绩我也会给一般性的复习建议。';
  }

  function ensureGreeting() {
    const th = currentThread();
    if (th.length) return;
    th.push({ role: 'assistant', roleKey: roleOfScene(), text: greetingFor(activeScene()) });
  }

  /* ---------------- 渲染 ---------------- */
  function sceneOptions() {
    const s = activeScene() || {};
    const out = ['<option value="auto">自动识别当前场景</option>'];
    for (const ph of ['preop', 'intraop', 'postop', 'report']) {
      out.push(`<optgroup label="${PFX[ph]}阶段">`);
      for (const sc of C.scenarios.filter(x => x.phase === ph)) {
        const sel = s.scenarioId === sc.id ? ' selected' : '';
        out.push(`<option value="${sc.id}"${sel}>${sc.no} ${sc.functionName}｜${sc.taskName}</option>`);
      }
      out.push('</optgroup>');
    }
    return out.join('');
  }

  function renderScene() {
    const s = activeScene();
    const conf = state.override ? 'medium' : (s && s.phase ? s.confidence : 'none');
    els.dot.className = 'bt-dot ' + (s && s.phase ? conf : 'none');

    els.hint.textContent = !s || !s.phase ? '未识别，请手动选择'
      : state.override ? '手动指定'
        : s.confidence === 'high' ? '自动 · 高可信'
          : s.confidence === 'medium' ? '自动 · 中可信' : '自动 · 低可信';

    els.select.innerHTML = sceneOptions();
    if (!state.override && !s) els.select.value = 'auto';

    const sc = s && s.scenarioId ? C.byId[s.scenarioId] : null;
    els.title.textContent = sc ? sc.functionName : '智能护理助教';
    els.subtitle.textContent = sc
      ? `${sc.taskName}${s.postopDay ? ' · 术后第 ' + s.postopDay + ' 天' : ''}${s.mode === 'exam' && s.phase !== 'report' ? ' · 考核中' : ''}`
      : (s && s.experiment ? `${s.experiment.typeName} · ${s.experiment.name}` : '请选择当前实验任务');

    const rs = window.BT_PROMPT.ROLE_SPEC[roleOfScene()] || {};
    els.headAvatar.src = AV[rs.avatar] || AV.nurse;

    const isPost = s && s.phase === 'postop';
    els.day.classList.toggle('show', !!isPost);
    if (isPost) {
      els.daySel.innerHTML = ['', 1, 2, 3, 7].map(d =>
        d === '' ? '<option value="">术后日期未知</option>'
          : `<option value="${d}"${String(s.postopDay) === String(d) ? ' selected' : ''}>${C.postopDays[d].label}</option>`
      ).join('');
    }

    els.examBadge.classList.toggle('bt-hidden', !(s && s.mode === 'exam' && s.phase !== 'report'));
    if (els.bridgeBadge) {
      const snap = window.BT_BRIDGE ? window.BT_BRIDGE.snapshot() : null;
      const on = !!(snap && snap.active);
      els.bridgeBadge.classList.toggle('bt-hidden', !on);
      if (on) els.bridgeBadge.textContent = '已接入实验事件 ' + snap.stepCount;
    }

    // 报告阶段最高优先级：旁听平台自己接口拿到的结构化成绩（不碰 token）
    if (sc && sc.phase === 'report' && !state.scoreText && window.BT_BRIDGE && window.BT_BRIDGE.apiSnapshot) {
      const snap = window.BT_BRIDGE.apiSnapshot();
      if (snap && snap.scores.length) {
        const lines = snap.scores.map((x, i) =>
          `${i === 0 ? '最近一次' : '第' + (i + 1) + '次'}：${x.name || '（未命名）'}，得分 ${x.score}${x.used ? '，用时 ' + x.used : ''}${x.time ? '，' + x.time : ''}`
        ).join('\n');
        const p2 = snap.process;
        const head = p2 ? `学习进度 ${p2.ppv != null ? p2.ppv + '%' : '—'}；已完成 ${p2.studyeds != null ? p2.studyeds : '—'} 次` : '';
        const txt = (head ? head + '\n' : '') + lines;
        state.scoreText = txt;
        state.scoreOpen = true;
        if (els.scoreInput) els.scoreInput.value = txt.slice(0, 1500);
        els.scoreBox.classList.add('show');
        T.log('score-source', { from: 'api-capture', rows: snap.scores.length });
      }
    }

    // 其次：页面可见的成绩文本

    if (sc && sc.phase === 'report' && !state.scoreText && s && s.pageData && s.pageData.scores.length) {
      const pd = s.pageData;
      const lines = pd.scores.map((x, i) =>
        `${i === 0 ? '最近一次' : '第' + (i + 1) + '次'}：${x.time}，用时 ${x.used}，得分 ${x.score}`
      ).join('\n');
      const head = [
        pd.progress !== null ? `当前学习进度：${pd.progress}%` : '',
        pd.studyCount !== null ? `已完成 ${pd.studyCount} 次` : '',
        pd.timeUsed !== null ? `学习总用时 ${pd.timeUsed} 分钟` : ''
      ].filter(Boolean).join('；');
      const txt = (head ? head + '\n' : '') + lines;
      state.scoreText = txt;
      state.scoreOpen = true;
      if (els.scoreInput) els.scoreInput.value = txt;
      els.scoreBox.classList.add('show');
      T.log('page-score', { count: pd.scores.length });
    }

    // 其次：成绩页缓存（学生自己打开过「我的成绩」）
    if (sc && sc.phase === 'report' && !state.scoreText && window.BT_SCORE) {
      const c = window.BT_SCORE.cached();
      if (c && c.summary) {
        state.scoreText = c.summary;
        state.scoreOpen = true;
        if (els.scoreInput) els.scoreInput.value = c.summary.slice(0, 1500);
        els.scoreBox.classList.add('show');
        T.log('score-source', { from: 'score-page-cache', rows: (c.rows || []).length });
      }
    }

    // 再次：平台 postMessage 上报过成绩
    if (sc && sc.phase === 'report' && !state.scoreText && window.BT_BRIDGE) {
      const payload = window.BT_BRIDGE.getScorePayload();
      if (payload && !state.scoreText) {
        const txt = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 1);
        state.scoreText = txt;
        state.scoreOpen = true;
        if (els.scoreInput) els.scoreInput.value = txt.slice(0, 1200);
        els.scoreBox.classList.add('show');
        T.log('bridge-score', { keys: Object.keys(payload).slice(0, 8) });
      }
    }
    els.scoreBox.classList.toggle('show', !!sc && sc.phase === 'report' && state.scoreOpen);

    let chips = sc ? sc.chips.slice() : ['我该做什么？'];
    if (sc && sc.phase === 'report') chips = ['读取本页成绩'].concat(chips, ['粘贴我的成绩']);
    els.chips.innerHTML = chips.map(c => `<button class="bt-chip" data-q="${c}">${c}</button>`).join('');
    els.chips.classList.toggle('bt-hidden', !sc);
  }

  function senderName(roleKey) {
    const map = { patient: C.patient.name + '（患者）', nurse: '责任护士', tutor: '带教老师', coach: '学习反馈' };
    return map[roleKey] || '责任护士';
  }

  function renderPicker() {
    const groups = [
      ['preop', '术前'],
      ['intraop', '术中'],
      ['postop', '术后'],
      ['report', '个性化报告']
    ];
    const html = groups.map(([ph, label]) => {
      const items = C.scenarios.filter(x => x.phase === ph).map(sc => `
        <button class="bt-pick-item" data-sid="${sc.id}">
          <span class="bt-pick-no">${sc.no}</span>
          <span class="bt-pick-text">
            <b>${sc.functionName}</b>
            <i>${sc.taskName}</i>
          </span>
        </button>`).join('');
      return `<div class="bt-pick-group"><div class="bt-pick-title">${label}</div>${items}</div>`;
    }).join('');

    els.body.innerHTML = `<div class="bt-picker">
      <div class="bt-picker-hint">没识别到当前场景。选一个，我按对应角色开始：</div>
      ${html}
    </div>`;
    els.body.querySelectorAll('.bt-pick-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const sc = C.byId[btn.dataset.sid];
        if (!sc) return;
        const cur = activeScene();
        state.override = {
          ...(state.scene || {}),
          phase: sc.phase,
          postopDay: sc.phase === 'postop' ? (cur && cur.postopDay) || 3 : null,
          taskId: sc.id, taskName: sc.taskName, scenarioId: sc.id,
          functionName: sc.functionName, mode: sc.mode,
          patientId: C.patient.id, contextSource: 'manual', confidence: 'high', evidence: ['面板选择']
        };
        applyScene(state.override, false);
      });
    });
  }

  function renderThread(scroll) {
    const th = currentThread();
    const frag = document.createDocumentFragment();
    let lastRole = null;

    for (const m of th) {
      if (m.type === 'divider') {
        const d = document.createElement('div');
        d.className = 'bt-divider';
        d.textContent = m.text;
        frag.appendChild(d);
        lastRole = null;
        continue;
      }
      const wrap = document.createElement('div');
      wrap.className = 'bt-msg' + (m.role === 'user' ? ' me' : '');
      if (m.role === 'assistant') {
        const av = document.createElement('div');
        av.className = 'bt-avatar';
        const rs = window.BT_PROMPT.ROLE_SPEC[m.roleKey] || {};
        av.innerHTML = `<img src="${AV[rs.avatar] || AV.nurse}" alt="">`;
        wrap.appendChild(av);
      }
      const bw = document.createElement('div');
      bw.className = 'bt-bubble-wrap';
      if (m.role === 'assistant' && lastRole !== 'assistant') {
        const sn = document.createElement('div');
        sn.className = 'bt-sender';
        sn.textContent = senderName(m.roleKey);
        bw.appendChild(sn);
      }
      const b = document.createElement('div');
      b.className = 'bt-bubble';
      if (m.streaming && !m.text) b.innerHTML = '<span class="bt-typing"><i></i><i></i><i></i></span>';
      else b.textContent = m.text;
      bw.appendChild(b);
      wrap.appendChild(bw);
      frag.appendChild(wrap);
      lastRole = m.role;
    }

    if (!activeScene() || !activeScene().scenarioId) {
      renderPicker();
      return;
    }

    els.body.innerHTML = '';
    els.body.appendChild(frag);
    if (scroll !== false) els.body.scrollTop = els.body.scrollHeight;
  }

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
  }

  /* ---------------- 通信 ---------------- */
  function ensurePort() {
    if (port) return port;
    try {
      port = chrome.runtime.connect({ name: 'bt-chat' });
      port.onMessage.addListener(onBg);
      port.onDisconnect.addListener(() => { port = null; });
    } catch (e) { port = null; }
    return port;
  }

  /* 客户端状态（来自本机代理读 Unity 日志）：页面识别不到时的第二来源 */
  function onClientState(cs) {
    state.client = cs;
    if (!cs || !cs.phase) return;
    if (state.override) return;                       // 手动选择优先
    const cur = state.scene;
    if (cur && cur.phase && cur.confidence !== 'none') return;  // 页面已识别

    const map = { preop: 'preop-history', intraop: 'intraop-communicate', postop: 'postop-psych', report: 'report-score' };
    const sc = C.byId[map[cs.phase]];
    if (!sc) return;

    const ev = (cs.evidence && cs.evidence[0]) ? String(cs.evidence[0]).slice(0, 60) : cs.phase;
    state.clientScene = {
      phase: cs.phase,
      postopDay: cs.postopDay || null,
      taskId: sc.id, taskName: sc.taskName, scenarioId: sc.id,
      functionName: sc.functionName, mode: cs.mode || 'study',
      patientId: C.patient.id,
      contextSource: cs.contextSource || 'client-log',
      confidence: cs.confidence || 'medium',
      evidence: ['客户端：' + ev]
    };
    applyScene(state.clientScene, true);
    toast('已从客户端识别：' + sc.functionName);
    T.log('scene', { from: 'client', phase: cs.phase, conf: cs.confidence });
  }

  function onBg(msg) {
    if (msg.type === 'client-state') { onClientState(msg.state); return; }
    if (msg.type === 'health') {
      state.health = msg.health || state.health;
      renderFooter();
      return;
    }
    if (msg.id && state.activeReqId && msg.id !== state.activeReqId) return;

    if (msg.type === 'chunk') {
      const th = currentThread();
      const last = th[th.length - 1];
      if (last && last.streaming) {
        last.text += msg.text;
        const bubbles = els.body.querySelectorAll('.bt-bubble');
        const node = bubbles[bubbles.length - 1];
        if (node) node.textContent = last.text;
        els.body.scrollTop = els.body.scrollHeight;
      }
      return;
    }
    if (msg.type === 'done') { finishStream('done'); return; }
    if (msg.type === 'aborted') { finishStream('aborted'); return; }
    if (msg.type === 'error') {
      const th = currentThread();
      const last = th[th.length - 1];
      if (last && last.streaming) {
        last.streaming = false;
        last.text = last.text || ('（没连上本地服务：' + (msg.message || '未知错误') + '）\n请先运行 proxy/server.mjs，再重试。');
      }
      T.log('error', { message: msg.message || '' });
      finishStream('error');
    }
  }

  function finishStream(reason) {
    const th = currentThread();
    const last = th[th.length - 1];
    if (last && last.streaming) {
      last.streaming = false;
      T.log('answer', { reason, chars: (last.text || '').length });
    }
    state.busy = false;
    state.activeReqId = null;
    els.send.classList.remove('stop');
    els.send.disabled = false;
    els.send.querySelector('span').textContent = '发送';
    renderThread();
    renderFooter();
  }

  function renderFooter() {
    const m = state.health.mode;
    if (m === 'mock') { els.modeBadge.className = 'bt-badge mock'; els.modeBadge.textContent = '演示模式 · 未接入模型'; }
    else if (m === 'live') { els.modeBadge.className = 'bt-badge live'; els.modeBadge.textContent = '已接入 ' + (state.health.model || '模型'); }
    else { els.modeBadge.className = 'bt-badge mock'; els.modeBadge.textContent = '未连接本地服务'; }
  }

  function send(text) {
    const s = activeScene();
    if (!s || !s.phase) { toast('请先选择当前实验场景'); T.log('block', { why: 'no-scene' }); return; }
    if (state.busy) return;
    text = (text || '').trim();
    if (!text) return;

    const th = currentThread();
    th.push({ role: 'user', text });
    th.push({ role: 'assistant', roleKey: roleOfScene(), text: '', streaming: true });
    state.busy = true;
    state.activeReqId = ++state.reqId;
    els.send.disabled = false;
    els.send.classList.add('stop');
    els.send.querySelector('span').textContent = '停止';
    els.input.value = '';
    autoGrow();
    renderThread();
    T.log('ask', { q: text.slice(0, 120), chars: text.length });

    const history = th.filter(m => m.role && m.text).slice(-12).map(m => ({ role: m.role, content: m.text }));
    const system = window.BT_PROMPT.buildSystemPrompt(s, { scoreText: state.scoreText });

    const p = ensurePort();
    if (!p) { onBg({ type: 'error', message: '扩展后台未就绪' }); return; }
    p.postMessage({ type: 'chat', id: state.activeReqId, system, messages: history });
  }

  function cancel() {
    if (!state.busy || !state.activeReqId) return;
    const p = ensurePort();
    if (p) p.postMessage({ type: 'cancel', id: state.activeReqId });
    T.log('cancel', {});
  }

  /* ---------------- 场景切换 ---------------- */
  function applyScene(scene, fromAuto) {
    const prev = renderedKey;
    const prevDay = state.scene ? state.scene.postopDay : null;
    state.scene = scene;
    T.setScene(scene);
    const next = threadKey();
    renderedKey = next;

    if (prev === next && scene && scene.postopDay && prevDay && scene.postopDay !== prevDay) {
      const th = currentThread();
      const d = C.postopDays[scene.postopDay];
      if (d) {
        th.push({ type: 'divider', text: `时间线更新为 ${d.label}` });
        renderThread();
        T.log('postop-day', { day: scene.postopDay, auto: !!fromAuto });
      }
    }

    if (prev !== next) {
      const th = currentThread();
      const s = activeScene();
      if (th.length > 0 && s && s.scenarioId) {
        const sc = C.byId[s.scenarioId];
        th.push({ type: 'divider', text: `已切换到 ${sc.no} ${sc.functionName}｜${sc.taskName}` });
      }
      T.log('scene', {
        from: prev, to: next, auto: !!fromAuto,
        source: (s && s.contextSource) || 'page',
        confidence: (s && s.confidence) || 'none'
      });
    }

    ensureGreeting();
    renderScene();
    renderThread();
  }


  /* 计算安全顶部：避开平台页头（可能还有一条二级导航） */
  function computeTop() {
    let top = 64;
    try {
      const vw = window.innerWidth;
      let bandBottom = 0;
      document.querySelectorAll('body *').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width < vw * 0.4) return;
        if (r.top > 12 || r.height < 24 || r.height > 240) return;
        bandBottom = Math.max(bandBottom, r.bottom);
      });
      if (bandBottom > 0) {
        // 紧贴页头下方的二级导航（如 navtab）也一起让开
        document.querySelectorAll('body *').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width < vw * 0.4) return;
          if (Math.abs(r.top - bandBottom) > 2 || r.height < 16 || r.height > 70) return;
          bandBottom = Math.max(bandBottom, r.bottom);
        });
        top = Math.max(top, Math.round(bandBottom + 8));
      }
    } catch (e) { /* ignore */ }
    return top;
  }

  /* ---------------- 拖动 ---------------- */
  function initDrag() {
    const head = els.head;
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;

    head.addEventListener('mousedown', (e) => {
      if (e.target.closest('.bt-icon-btn')) return;
      if (window.innerWidth <= 900) return;
      dragging = true;
      const r = els.panel.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      els.panel.classList.add('bt-dragging');
      els.panel.style.right = 'auto';
      els.panel.style.bottom = 'auto';
      els.panel.style.left = r.left + 'px';
      els.panel.style.top = r.top + 'px';
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      let nl = ox + (e.clientX - sx);
      let nt = oy + (e.clientY - sy);
      const w = els.panel.offsetWidth, h = els.panel.offsetHeight;
      nl = Math.max(4, Math.min(window.innerWidth - w - 4, nl));
      nt = Math.max(4, Math.min(window.innerHeight - h - 4, nt));
      els.panel.style.left = nl + 'px';
      els.panel.style.top = nt + 'px';
    });

    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      els.panel.classList.remove('bt-dragging');
      T.log('drag', { left: els.panel.offsetLeft, top: els.panel.offsetTop });
    });

    window.addEventListener('resize', () => {
      if (!state.open || window.innerWidth <= 900) return;
      const r = els.panel.getBoundingClientRect();
      if (r.right > window.innerWidth || r.bottom > window.innerHeight) {
        els.panel.style.left = Math.max(4, window.innerWidth - r.width - 20) + 'px';
        els.panel.style.top = Math.max(4, window.innerHeight - r.height - 20) + 'px';
      }
      if (state.settingsOpen && state.settingsTab === 'ui') renderSettings();
    });
  }

  /* ---------------- 设置 ---------------- */
  async function loadConfig() {
    try {
      const r = await fetch('http://127.0.0.1:8787/api/config');
      if (r.ok) { state.cfg = await r.json(); renderSettings(); }
    } catch (e) { /* 服务未启动 */ }
  }

  async function saveConfig(patch) {
    try {
      const r = await fetch('http://127.0.0.1:8787/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      if (r.ok) {
        state.cfg = await r.json();
        renderSettings();
        toast('已保存到本地服务');
        T.log('config', { patch });
        onBg({ type: 'health', health: state.cfg });
      } else {
        toast('保存失败：' + r.status);
      }
    } catch (e) {
      toast('本地服务未启动');
    }
  }

  function renderSettings() {
    if (!state.settingsOpen) return;
    els.setBody.innerHTML = '';

    if (state.settingsTab === 'ui') {
      els.setBody.innerHTML = `
        <div class="bt-field">
          <label>主题</label>
          <select data-p="theme">
            <option value="light"${state.prefs.theme === 'light' ? ' selected' : ''}>浅色（默认）</option>
            <option value="dark"${state.prefs.theme === 'dark' ? ' selected' : ''}>深色</option>
            <option value="warm"${state.prefs.theme === 'warm' ? ' selected' : ''}>暖白</option>
          </select>
        </div>
        <div class="bt-field">
          <label>面板宽度：<b>${state.prefs.width}px</b></label>
          <input type="range" min="300" max="520" step="4" value="${state.prefs.width}" data-p="width">
          <div class="hint">窄屏会自动切换为抽屉/全屏，无需手动调</div>
        </div>
        <div class="bt-field">
          <label>字号：<b>${state.prefs.fontScale}%</b></label>
          <input type="range" min="85" max="125" step="5" value="${state.prefs.fontScale}" data-p="fontScale">
        </div>
        <div class="bt-field">
          <label>不透明度：<b>${state.prefs.opacity}%</b></label>
          <input type="range" min="70" max="100" step="5" value="${state.prefs.opacity}" data-p="opacity">
        </div>
        <div class="bt-field">
          <label>停靠位置</label>
          <select data-p="dock">
            <option value="right"${state.prefs.dock === 'right' ? ' selected' : ''}>右侧停靠</option>
            <option value="left"${state.prefs.dock === 'left' ? ' selected' : ''}>左侧停靠</option>
            <option value="bottom"${state.prefs.dock === 'bottom' ? ' selected' : ''}>底部抽屉</option>
          </select>
        </div>
        <div class="bt-field">
          <label>当前视口</label>
          <div class="hint">${window.innerWidth} × ${window.innerHeight}px · ${window.innerWidth <= 620 ? '手机全屏模式' : window.innerWidth <= 900 ? '窄屏抽屉模式' : '桌面停靠模式'}</div>
        </div>`;
      els.setBody.querySelectorAll('[data-p]').forEach(el => {
        const ev = el.tagName === 'SELECT' ? 'change' : 'input';
        el.addEventListener(ev, () => {
          const k = el.dataset.p;
          state.prefs[k] = el.type === 'range' ? Number(el.value) : el.value;
          applyPrefs();
          savePrefs();
          if (el.type === 'range') {
            const lab = el.parentElement.querySelector('label');
            if (lab) lab.innerHTML = lab.innerHTML.replace(/<b>.*?<\/b>/, `<b>${el.value}${k === 'width' ? 'px' : '%'}</b>`);
          }
          T.log('ui', { key: k, value: state.prefs[k] });
        });
      });
      return;
    }

    if (state.settingsTab === 'model') {
      const c = state.cfg;
      if (!c) {
        els.setBody.innerHTML = '<div class="bt-field"><div class="hint">本地服务未启动，无法读取模型配置。先运行 node proxy/server.mjs。</div></div>';
        return;
      }
      els.setBody.innerHTML = `
        <div class="bt-field">
          <label>接口地址 baseUrl</label>
          <input type="text" data-c="baseUrl" value="${c.baseUrl || ''}" placeholder="https://api.deepseek.com/v1">
          <div class="hint">实际请求：baseUrl + /chat/completions</div>
        </div>
        <div class="bt-field">
          <label>模型名</label>
          <input type="text" data-c="model" value="${c.model || ''}" placeholder="deepseek-chat">
        </div>
        <div class="bt-row">
          <div class="bt-field">
            <label>超时（秒）</label>
            <input type="number" data-c="timeoutMs" value="${Math.round((c.timeoutMs || 60000) / 1000)}" min="5" max="300">
          </div>
          <div class="bt-field">
            <label>流式输出</label>
            <select data-c="stream"><option value="true"${c.stream ? ' selected' : ''}>开启</option><option value="false"${!c.stream ? ' selected' : ''}>关闭</option></select>
          </div>
        </div>
        <div class="bt-field">
          <label>API Key</label>
          <div class="hint">${c.hasKey ? '✅ 已配置（只存在本地服务，前端读不到）' : '⚠️ 未配置，当前为演示模式'}</div>
          <div class="hint">写入方式：编辑 proxy/config.json 的 apiKey 字段，或设置环境变量 LLM_API_KEY 后重启服务。Key 不会经过浏览器。</div>
        </div>
        <div class="bt-field"><div class="hint">当前状态：${c.mode === 'live' ? '真实模型' : '演示模式'}</div></div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="bt-mini-btn" data-act="reload">重新读取</button>
          <button class="bt-mini-btn primary" data-act="save-cfg">保存并测试</button>
        </div>`;
      els.setBody.querySelector('[data-act="reload"]').addEventListener('click', loadConfig);
      els.setBody.querySelector('[data-act="save-cfg"]').addEventListener('click', () => {
        const patch = {};
        els.setBody.querySelectorAll('[data-c]').forEach(el => {
          const k = el.dataset.c;
          let v = el.value;
          if (k === 'timeoutMs') v = Number(v) * 1000;
          if (k === 'stream') v = v === 'true';
          patch[k] = v;
        });
        saveConfig(patch);
      });
      return;
    }

    const sum = T.summary();
    const rows = T.all().slice(-40).reverse().map(r => {
      const s = r.scene || {};
      const d = r.d ? ' ' + JSON.stringify(r.d).slice(0, 60) : '';
      return `${r.iso.slice(11, 19)} ${r.ev}${s.scenarioId ? ' [' + s.scenarioId + ']' : ''}${d}`;
    }).join('\n');

    els.setBody.innerHTML = `
      <div class="bt-stat">
        <div><b>${sum.total}</b>事件</div>
        <div><b>${Object.keys(sum.byEvent).length}</b>类型</div>
        <div><b>${Object.keys(sum.byScenario).length}</b>场景</div>
      </div>
      <div class="bt-field">
        <label>最近事件（最新在上）</label>
        <div class="bt-trace">${rows || '暂无记录'}</div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
        <button class="bt-mini-btn" data-act="copy">复制 JSON</button>
        <button class="bt-mini-btn" data-act="csv">下载 CSV</button>
        <button class="bt-mini-btn" data-act="clear">清空</button>
      </div>
      <div class="bt-field" style="margin-top:10px">
        <div class="hint">埋点只存在本机 localStorage，不上传任何服务器，也不写入原系统。</div>
      </div>`;

    els.setBody.querySelector('[data-act="copy"]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(JSON.stringify(T.all(), null, 1)); toast('已复制'); }
      catch (e) { toast('复制失败'); }
    });
    els.setBody.querySelector('[data-act="csv"]').addEventListener('click', () => {
      const blob = new Blob(['\ufeff' + T.toCSV()], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'bt-trace-' + Date.now() + '.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    });
    els.setBody.querySelector('[data-act="clear"]').addEventListener('click', () => { T.clear(); renderSettings(); });
  }

  function openSettings(tab) {
    state.settingsOpen = true;
    state.settingsTab = tab || state.settingsTab || 'ui';
    els.settings.classList.add('show');
    els.tabs.querySelectorAll('.bt-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === state.settingsTab));
    if (state.settingsTab === 'model' && !state.cfg) loadConfig();
    renderSettings();
    T.log('settings', { tab: state.settingsTab });
  }

  function closeSettings() {
    state.settingsOpen = false;
    els.settings.classList.remove('show');
  }

  /* ---------------- 开合 ---------------- */
  function setOpen(open) {
    if (open) { try { applyPrefs(); } catch (e) {} }
    if (EMBED) open = true;
    state.open = open;
    state.mini = false;
    els.panel.classList.toggle('bt-hidden', !open);
    els.mini.classList.toggle('bt-hidden', open);
    els.launcher.classList.add('bt-hidden');
    try { localStorage.setItem('bt_open', open ? '1' : '0'); } catch (e) {}
    if (open) {
      ensureGreeting();
      renderScene();
      renderThread();
      setTimeout(() => els.input.focus(), 60);
      T.log('panel', { action: 'open' });
    }
  }

  function collapse() {
    state.open = false; state.mini = false;
    els.panel.classList.add('bt-hidden');
    els.mini.classList.add('bt-hidden');
    els.launcher.classList.remove('bt-hidden');
    try { localStorage.setItem('bt_open', '0'); } catch (e) {}
    T.log('panel', { action: 'collapse' });
  }

  function closeAll() {
    state.open = false; state.mini = true;
    els.panel.classList.add('bt-hidden');
    els.launcher.classList.add('bt-hidden');
    els.mini.classList.remove('bt-hidden');
    try { localStorage.setItem('bt_open', '0'); } catch (e) {}
    T.log('panel', { action: 'close' });
  }

  function autoGrow() {
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(96, Math.max(40, els.input.scrollHeight)) + 'px';
  }

  /* ---------------- 挂载 ---------------- */
  function mount() {
    if (document.getElementById('bt-assistant-host')) return;
    loadPrefs();

    const host = document.createElement('div');
    host.id = 'bt-assistant-host';
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483000;inset:0;width:0;height:0;';
    root = host.attachShadow({ mode: 'open' });

    const cssUrl = (function () {
      try { return chrome.runtime.getURL('src/ui/panel.css'); } catch (e) { return 'panel.css'; }
    })();

    root.innerHTML = window.BT_TEMPLATE(cssUrl);

    document.documentElement.appendChild(host);

    els = {
      root: root.querySelector('.bt-root'),
      launcher: root.querySelector('.bt-launcher'),
      mini: root.querySelector('.bt-mini'),
      panel: root.querySelector('.bt-panel'),
      head: root.querySelector('.bt-head'),
      headAvatar: root.querySelector('.bt-head-avatar img'),
      title: root.querySelector('.bt-title'),
      subtitle: root.querySelector('.bt-subtitle'),
      dot: root.querySelector('.bt-dot'),
      select: root.querySelector('.bt-scene-select'),
      hint: root.querySelector('.bt-scene-hint'),
      day: root.querySelector('.bt-day'),
      daySel: root.querySelector('.bt-day-select'),
      body: root.querySelector('.bt-body'),
      chips: root.querySelector('.bt-chips'),
      input: root.querySelector('.bt-input'),
      send: root.querySelector('.bt-send'),
      toast: root.querySelector('.bt-toast'),
      modeBadge: root.querySelector('.bt-foot-note .bt-badge'),
      examBadge: root.querySelector('.bt-exam-badge'),
      bridgeBadge: root.querySelector('.bt-bridge-badge'),
      traceCount: root.querySelector('.bt-trace-count'),
      scoreBox: root.querySelector('.bt-score-box'),
      scoreInput: root.querySelector('.bt-score-box textarea'),
      settings: root.querySelector('.bt-settings'),
      tabs: root.querySelector('.bt-tabs'),
      setBody: root.querySelector('.bt-set-body')
    };

    root.querySelector('.bt-launcher').addEventListener('click', () => setOpen(true));
    els.mini.addEventListener('click', () => setOpen(true));
    root.querySelector('[data-act="min"]').addEventListener('click', collapse);
    root.querySelector('[data-act="close"]').addEventListener('click', closeAll);
    root.querySelector('[data-act="settings"]').addEventListener('click', () => openSettings());
    root.querySelector('[data-act="set-close"]').addEventListener('click', closeSettings);

    els.tabs.addEventListener('click', (e) => {
      const b = e.target.closest('.bt-tab');
      if (!b) return;
      state.settingsTab = b.dataset.tab;
      els.tabs.querySelectorAll('.bt-tab').forEach(x => x.classList.toggle('on', x === b));
      if (state.settingsTab === 'model' && !state.cfg) loadConfig();
      renderSettings();
    });

    els.select.addEventListener('change', () => {
      const v = els.select.value;
      if (v === 'auto') {
        state.override = null;
        applyScene(window.BT_SCENE.detect(), true);
        toast('已恢复自动识别');
        return;
      }
      const sc = C.byId[v];
      if (!sc) return;
      const cur = activeScene();
      state.override = {
        ...(state.scene || {}),
        phase: sc.phase,
        postopDay: sc.phase === 'postop' ? (cur && cur.postopDay) || 3 : null,
        taskId: sc.id, taskName: sc.taskName, scenarioId: sc.id,
        functionName: sc.functionName, mode: sc.mode,
        patientId: C.patient.id, contextSource: 'manual', confidence: 'high', evidence: ['手动选择']
      };
      applyScene(state.override, false);
    });

    els.daySel.addEventListener('change', () => {
      const v = Number(els.daySel.value) || null;
      const s = activeScene();
      if (!s) return;
      const next = { ...s, postopDay: v };
      if (state.override) state.override = next; else state.scene = next;
      T.log('postop-day', { day: v });
      renderScene();
      const th = currentThread();
      if (v && C.postopDays[v]) {
        th.push({ type: 'divider', text: `时间线切换为 ${C.postopDays[v].label}` });
        renderThread();
      }
    });

    els.chips.addEventListener('click', (e) => {
      const btn = e.target.closest('.bt-chip');
      if (!btn) return;
      if (btn.dataset.q === '读取本页成绩') {
        const payload = window.BT_SCORE ? window.BT_SCORE.parse(true) : null;
        const got = payload || (window.BT_SCORE ? window.BT_SCORE.cached() : null);
        if (got && got.summary) {
          state.scoreText = got.summary;
          state.scoreOpen = true;
          els.scoreInput.value = got.summary.slice(0, 1500);
          els.scoreBox.classList.add('show');
          toast('已读取本页成绩');
          T.log('score-source', { from: 'manual-parse', rows: (got.rows || []).length });
        } else {
          toast('本页没找到成绩表格，请手动粘贴');
          state.scoreOpen = true;
          els.scoreBox.classList.add('show');
          els.scoreInput.focus();
        }
        return;
      }
      if (btn.dataset.q === '粘贴我的成绩') {
        state.scoreOpen = true;
        els.scoreBox.classList.add('show');
        els.scoreInput.focus();
        return;
      }
      send(btn.dataset.q);
    });

    els.send.addEventListener('click', () => {
      if (state.busy) { cancel(); return; }
      send(els.input.value);
    });

    els.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(els.input.value); }
    });
    els.input.addEventListener('input', autoGrow);

    root.querySelector('[data-act="use-score"]').addEventListener('click', () => {
      const v = els.scoreInput.value.trim();
      if (!v) { toast('请先粘贴成绩或错项'); return; }
      state.scoreText = v;
      T.log('score', { chars: v.length });
      send('这是我的考核成绩/错项，请基于它帮我分析：\n' + v);
    });
    root.querySelector('[data-act="clear-score"]').addEventListener('click', () => {
      state.scoreText = '';
      els.scoreInput.value = '';
      toast('已清空成绩信息');
    });

    initDrag();
    applyPrefs();

    if (window.BT_BRIDGE) window.BT_BRIDGE.start();
    if (window.BT_SCORE) window.BT_SCORE.start();

    if (EMBED) {
      els.root.classList.add('bt-embed');
      els.panel.classList.remove('bt-hidden');
      els.launcher.classList.add('bt-hidden');
      els.mini.classList.add('bt-hidden');
      state.open = true;
      ensureGreeting();
      renderScene();
      renderThread();
      T.log('mount', { embed: true, viewport: window.innerWidth + 'x' + window.innerHeight });
    }

    const p = ensurePort();
    if (p) p.postMessage({ type: 'health' });

    // 平台实时进度（来自 api-poll.js 的 GetProcess 轮询）
    window.__btOnProgress = (proc) => {
      const el = els.progress || root.querySelector('.bt-progress');
      const tx = root.querySelector('.bt-progress-text');
      if (!el || !tx || !proc) return;
      const pct = proc.ppv != null ? proc.ppv : null;
      const mins = proc.timeUsed != null ? Math.round(Number(proc.timeUsed) / 60) : null;
      tx.textContent = '平台实时进度 ' + (pct != null ? pct + '%' : '—')
        + ' · 已完成 ' + (proc.studyeds != null ? proc.studyeds : '—') + ' 次'
        + (mins != null ? ' · 累计 ' + mins + ' 分钟' : '');
      el.classList.remove('bt-hidden');
    };

    // 直接轮询本机客户端代理（内容脚本跨域访问环回地址，代理已允许 CORS）
    let lastClient = '';
    const pollClient = async () => {
      try {
        const r = await fetch('http://127.0.0.1:8790/state', { cache: 'no-store' });
        if (!r.ok) return;
        const cs = await r.json();
        const key = String(cs.phase) + '|' + String(cs.postopDay) + '|' + String(cs.confidence);
        if (key === lastClient) return;
        lastClient = key;
        onClientState(cs);
      } catch (e) { /* 代理没开 */ }
    };
    pollClient();
    setInterval(pollClient, 4000);

    stopScene = window.BT_SCENE.start((scene) => {
      if (state.override) { state.scene = scene; return; }
      const pageOk = !!(scene && scene.phase);
      if (pageOk) {
        state.clientScene = null;      // 页面识别优先
        applyScene(scene, true);
        return;
      }
      // 页面识别不到：如果客户端日志给出了阶段，就用它撑住，别被空结果冲掉
      if (state.clientScene) {
        const cur = state.scene;
        if (!cur || cur.phase !== state.clientScene.phase) applyScene(state.clientScene, true);
        return;
      }
      applyScene(scene, true);
    }, 1500);

    setInterval(() => {
      if (!els.bridgeBadge || !window.BT_BRIDGE) return;
      const snap = window.BT_BRIDGE.snapshot();
      els.bridgeBadge.classList.toggle('bt-hidden', !snap.active);
      if (snap.active) els.bridgeBadge.textContent = '已接入实验事件 ' + snap.stepCount;
    }, 4000);

    T.subscribe(() => {
      if (els.traceCount) els.traceCount.textContent = T.all().length + ' 事件';
      if (state.settingsOpen && state.settingsTab === 'trace') renderSettings();
    });
    els.traceCount.textContent = T.all().length + ' 事件';

    let wasOpen = false;
    try { wasOpen = localStorage.getItem('bt_open') === '1'; } catch (e) {}
    if (wasOpen) setOpen(true);

    T.log('mount', {
      url: location.href.slice(0, 120),
      viewport: window.innerWidth + 'x' + window.innerHeight,
      dock: state.prefs.dock
    });
  }

  window.BT_UI = { mount, setClientState: onClientState };
})();

})();

/* ===== boot/main.js ===== */
(function(){
/*
 * 入口：延迟挂载，避免与原系统首屏渲染争抢
 */
(function () {
  'use strict';

  /* 本机端口：只在本机页面看起来像“骨牵引实验”时才挂载，避免污染其它本地页面 */
  function shouldMount() {
    const host = location.hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') return true;   // 校内域名直接挂
    if (location.port === '8787') return true;                        // 本地演示站
    const title = document.title || '';
    if (/骨牵引|创伤骨科|虚拟仿真/.test(title)) return true;
    try {
      const head = (document.body.innerText || '').slice(0, 2000);
      if (document.querySelector('canvas') && /骨牵引|牵引重量|术中阶段/.test(head)) return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  function boot() {
    if (!shouldMount()) return;
    try {
      window.BT_UI.mount();
    } catch (e) {
      console.warn('[智能助教] 挂载失败：', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 800), { once: true });
  } else {
    setTimeout(boot, 800);
  }

  // Alt+A 快速开合（不与原系统常用快捷键冲突）
  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'a' || e.key === 'A')) {
      const host = document.getElementById('bt-assistant-host');
      if (!host || !host.shadowRoot) return;
      const panel = host.shadowRoot.querySelector('.bt-panel');
      const launcher = host.shadowRoot.querySelector('.bt-launcher');
      if (panel && !panel.classList.contains('bt-hidden')) {
        launcher.classList.remove('bt-hidden');
        panel.classList.add('bt-hidden');
        host.shadowRoot.querySelector('.bt-mini').classList.add('bt-hidden');
      } else {
        panel.classList.remove('bt-hidden');
        launcher.classList.add('bt-hidden');
      }
    }
  });
})();

})();