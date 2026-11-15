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
    examLock: false,            // 一旦确认为考核，任何手动选择都不能解除
    client: null, clientScene: null, clientTs: 0,
    clientEvidence: null,       // 客户端日志里的真实 UI 生命周期 / 逐步骤成绩
    scoreSource: '', scoreCleared: false,
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
    if (!s) return 'unknown';
    if (s.scenarioId) {
      // 术后不同日期是不同病程，对话上下文必须分开，不能串台
      const day = s.phase === 'postop' ? ('@d' + (s.postopDay || '?')) : '';
      return s.scenarioId + day;
    }
    // 只识别到阶段、还没选任务时，用阶段占位，不伪造任务
    return s.phase ? ('phase:' + s.phase) : 'unknown';
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
    if (!s || !s.phase) {
      return '我还没识别出当前实验阶段。请在下方选择“阶段 · 任务”，我会按对应角色和你交流。';
    }
    if (!s.scenarioId) {
      const ph = PFX[s.phase] || s.phase;
      return `我已经识别到当前是「${ph}阶段」，但还不能确定具体任务（日志/页面只给到阶段）。`
        + '请在下方选一个具体任务，我再按对应角色开始；选之前我不会替你猜。';
    }
    const sc = C.byId[s.scenarioId];

    if (sc.role === 'patient') {
      const who = `${C.patient.name}`;
      const bed = C.patient.bed.replace(/^.*?(\d+\s*床)$/, '$1');
      return s.phase === 'preop'
        ? `您好，我是 ${bed}${who}。${sc.id === 'preop-history' ? '您想了解我这次受伤的情况，直接问就行。' : '手术前的事我还想再问问您。'}`
        : `我是${who}。${sc.id === 'postop-psych' ? '这几天躺着，心里有点烦，您能陪我聊会儿吗？' : '您有什么要交代的，我听着。'}`;
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

  const SOURCE_LABEL = {
    page: '页面识别', 'client-log': '客户端日志', 'window-title': '窗口标题',
    bridge: '实验事件', api: '平台接口', manual: '手动指定',
    'unity-event': 'Unity 原生事件'
  };
  const CONF_LABEL = { high: '高可信', medium: '中可信', low: '低可信', none: '无证据' };

  /* 三级导航：阶段 → 场景 → 当前 Unity 任务
     下拉框保留为权威取值来源，卡片点击后写回并触发 change，不破坏既有逻辑。 */
  const PHASES = ['preop', 'intraop', 'postop', 'report'];
  function renderNav() {
    if (!els.phases || !els.cards) return;
    const s = activeScene() || {};
    const g = state.game || {};
    let phase = s.phase || null;
    if (!phase && g.scen) {
      const byId = C.byId[g.scen];
      phase = byId ? byId.phase : null;
    }
    if (!phase) phase = 'preop';

    els.phases.innerHTML = PHASES.map((ph) =>
      `<button class="bt-phase${ph === phase ? ' on' : ''}${s.phase && s.phase !== ph ? ' dim' : ''}" data-phase="${ph}">${PFX[ph]}</button>`
    ).join('');

    const list = C.scenarios.filter((x) => x.phase === phase);
    els.cards.innerHTML = list.map((sc) =>
      `<button class="bt-card${s.scenarioId === sc.id ? ' on' : ''}" data-scene="${sc.id}">
         <b>${sc.no} ${sc.functionName}</b>
         <span>${sc.taskName}</span>
       </button>`
    ).join('') || '<div style="grid-column:1/-1;color:var(--bt-sub);font-size:12px">该阶段暂无智能场景</div>';

    // 当前 Unity 任务（真实任务名，来自 observer）
    const tasks = g.dayTasks || [];
    if (tasks.length) {
      els.current.classList.add('show');
      els.current.innerHTML = `<b>当前实验任务</b>：<span class="sub">${tasks.slice(0, 3).join(' · ')}</span>`
        + (tasks.length > 3 ? ` 等 ${tasks.length} 项` : '');
    } else if (g.subtitle) {
      els.current.classList.add('show');
      els.current.innerHTML = `<b>游戏当前</b>：<span class="sub">${g.subtitle.slice(0, 26)}</span>`;
    } else {
      els.current.classList.remove('show');
    }
  }

  function renderScene() {
    const s = activeScene();
    const conf = state.override ? 'medium' : (s && s.phase ? s.confidence : 'none');
    els.dot.className = 'bt-dot ' + (s && s.phase ? conf : 'none');

    if (!s || !s.phase) {
      // 客户端日志能证明「实验正在跑、当前是哪个 UI」，但证明不了业务阶段。
      // 如实显示运行证据，仍然要求手动选任务，不拿界面名猜场景。
      const lc = state.clientEvidence && state.clientEvidence.lifecycle;
      const subTxt = (state.game && state.game.subtitle) ? `　「${state.game.subtitle.slice(0, 20)}」` : '';
      els.hint.textContent = (lc
        ? `客户端已运行 · ${lc.label} · 任务请手动选`
        : '未识别，请手动选择') + subTxt;
    } else if (state.override) {
      els.hint.textContent = '手动指定' + (state.examLock ? ' · 考核保护中' : '');
    } else {
      const src = SOURCE_LABEL[s.contextSource] || '自动识别';
      const sub = (state.game && state.game.subtitle) ? `　「${state.game.subtitle.slice(0, 22)}」` : '';
      els.hint.textContent = src + ' · ' + (CONF_LABEL[s.confidence] || '已识别')
        + (s.scenarioId ? '' : ' · 仅到阶段') + sub;
    }

    els.select.innerHTML = sceneOptions();
    if (!state.override && !s) els.select.value = 'auto';
    if (state.override && s && s.scenarioId) els.select.value = s.scenarioId;

    const sc = s && s.scenarioId ? C.byId[s.scenarioId] : null;
    els.title.textContent = sc ? sc.functionName : '智能护理助教';
    if (sc) {
      els.subtitle.textContent = `${sc.taskName}${s.postopDay ? ' · 术后第 ' + s.postopDay + ' 天' : ''}${s.mode === 'exam' && s.phase !== 'report' ? ' · 考核中' : ''}`;
    } else if (s && s.phase) {
      els.subtitle.textContent = `已识别到${PFX[s.phase] || ''}阶段`
        + (s.postopDay ? ' · 术后第 ' + s.postopDay + ' 天' : '')
        + ' · 请选择具体任务';
    } else {
      els.subtitle.textContent = (s && s.experiment) ? `${s.experiment.typeName} · ${s.experiment.name}` : '请选择当前实验任务';
    }

    const rs = window.BT_PROMPT.ROLE_SPEC[roleOfScene()] || {};
    els.headAvatar.src = AV[rs.avatar] || AV.nurse;

    renderNav();

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

    // 报告阶段最高优先级：客户端日志里原程序打印的逐步骤成绩（含错项）
    if (sc && sc.phase === 'report' && state.clientEvidence && state.clientEvidence.score) {
      fillClientScore(state.clientEvidence.score, state.clientEvidence.lifecycle);
    }

    // 其次：旁听平台自己接口拿到的结构化成绩（不碰 token）
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
    const realTasks = (state.game && state.game.dayTasks) || [];
    if (realTasks.length) {
      chips = realTasks.slice(0, 6).map((t) => `${t}要注意什么？`);
    }
    if (sc && sc.phase === 'report') chips = ['读取本页成绩'].concat(chips, ['粘贴我的成绩']);
    els.chips.innerHTML = chips.map(c => `<button class="bt-chip" data-q="${c}">${c}</button>`).join('');
    els.chips.classList.toggle('bt-hidden', !sc);
  }

  function senderName(roleKey) {
    const map = { patient: C.patient.name + '（患者）', nurse: '责任护士', tutor: '带教老师', coach: '学习反馈' };
    return map[roleKey] || '责任护士';
  }

  function renderPicker(onlyPhase) {
    const groups = [
      ['preop', '术前'],
      ['intraop', '术中'],
      ['postop', '术后'],
      ['report', '个性化报告']
    ].filter(([ph]) => !onlyPhase || ph === onlyPhase);
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

    const hint = onlyPhase
      ? `已识别到「${PFX[onlyPhase] || onlyPhase}阶段」，但日志只给到阶段。选一个具体任务，我按对应角色开始：`
      : '没识别到当前场景。选一个，我按对应角色开始：';

    els.body.innerHTML = `<div class="bt-picker">
      <div class="bt-picker-hint">${hint}</div>
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
          // 术后日期不默认填 3：不知道就是不知道，由学生自己选
          postopDay: sc.phase === 'postop' ? ((cur && cur.phase === 'postop' && cur.postopDay) || null) : null,
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
      renderPicker(activeScene() && activeScene().phase);
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

  /* 客户端状态（本机代理读 Unity 日志）：页面识别不到时的第二来源
     ---------------------------------------------------------------
     原则：
       1) 只有日志明确给出“当前任务”才设 taskId；只给到阶段就只到阶段。
       2) 页面识别优先于客户端；客户端之间按新到旧覆盖。
       3) 一旦出现考核信号，锁存 examLock，手动选择也不解除。 */
  const PAGE_SOURCES = { page: 1, bridge: 1, api: 1 };

  /* 客户端 Player.log 里原程序自己打印的逐步骤成绩。
   * 平台 ItemsByUser 只有总分；分项只在客户端进度回包里，所以这里优先级最高。
   * 只陈述日志里有的字段，不推断「哪一步做错了」以外的结论。 */
  function formatClientScore(sd, lc) {
    const L = [];
    L.push('【来源：客户端 Player.log · 原程序打印的逐步骤进度记录】');
    L.push(`分项 ${sd.totalItems} 项，正确 ${sd.rightItems} 项，累计 ${sd.totalScore} 分；进度标记 ${sd.currentExpProgress}${sd.isDone ? '（已完成）' : '（未完成）'}`);
    const secs = Object.entries(sd.bySection || {});
    if (secs.length) {
      L.push('分章节：' + secs.map(([k, v]) =>
        `${k} ${v.right}/${v.total}，${Math.round(v.score * 10) / 10} 分`).join('；'));
    }
    const wrong = sd.wrongItems || [];
    if (wrong.length) {
      L.push('未得分／未完成项：');
      for (const w of wrong.slice(0, 10)) L.push(`- ${w.sn}（${w.section}）：${w.feedback || '未完成'}`);
    } else {
      L.push('未得分／未完成项：日志里没有记录到。');
    }
    if (lc && lc.label) L.push(`客户端界面：${lc.label}`);
    L.push('说明：以上是原实验写入日志的分项记录，不代表本次实时作答；日志未记录的步骤无法推断。');
    return L.join('\n');
  }

  function fillClientScore(sd, lc) {
    if (state.scoreCleared || !sd || !sd.totalItems) return;
    const sig = [sd.totalItems, sd.rightItems, sd.totalScore, sd.currentExpProgress, (sd.wrongItems || []).length].join('|');
    if (state.scoreSource === 'client-log' && state.scoreSignature === sig) return;  // 去重
    let txt = formatClientScore(sd, lc);
    const wrongs = (state.game && state.game.commData || []).filter((x) => x && x.wrong);
    if (wrongs.length) {
      txt += '\n\n**本次真实错项**\n' + wrongs.slice(0, 12)
        .map((x) => `- 第${x.sn ?? '?'}步：${x.wrong}`).join('\n');
    }
    state.scoreText = txt;
    state.scoreSource = 'client-log';
    state.scoreSignature = sig;
    state.scoreOpen = true;
    if (els.scoreInput) els.scoreInput.value = txt.slice(0, 2000);
    if (els.scoreBox) els.scoreBox.classList.add('show');
    T.log('score-source', {
      from: 'client-log', items: sd.totalItems,
      wrong: (sd.wrongItems || []).length
    });
  }

  let lastClientAt = 0;
  function onClientState(cs) {
    state.client = cs;
    lastClientAt = Date.now();
    // 真实实验本体日志里没有「术前/术中/术后」阶段词，但会打印 UI 生命周期
    // 和整份逐步骤成绩。这些证据与 phase 无关，必须单独收下。
    if (!cs || !cs.ok) {
      // 客户端没在跑：解除上一轮的任务展示，避免界面继续显示过期任务
      if (Date.now() - lastClientAt > 90000) {
        state.clientEvidence = null;
        if (!state.override && state.scene && state.scene.contextSource !== 'manual') {
          state.scene = null;
          renderedKey = '';
          renderScene();
        }
      }
    }
    if (cs && cs.ok && (cs.scoreDetails || cs.lifecycle)) {
      state.clientEvidence = { score: cs.scoreDetails || null, lifecycle: cs.lifecycle || null };
      const sc0 = activeScene();
      if (sc0 && sc0.phase === 'report' && cs.scoreDetails) fillClientScore(cs.scoreDetails, cs.lifecycle);
    }
    if (!cs || !cs.ok || !cs.phase) return;
    if (cs.ts) {
      if (cs.ts === state.clientTs) return;   // 后台推送与面板轮询会重复，去重
      state.clientTs = cs.ts;
    }
    if (cs.mode === 'exam') {
      state.examLock = true;
      // 页面已经先给出了场景时，也要把考核状态立刻贴到当前场景上
      if (state.scene && state.scene.mode !== 'exam') {
        state.scene.mode = 'exam';
        if (state.override) state.override.mode = 'exam';
        if (els.panel) renderScene();
      }
    }
    if (state.override) return;
    const cur = state.scene;
    // Unity 测试副本的结构化事件来自原程序运行时状态，优先于页面 DOM 推断。
    const unityAuthoritative = cs.contextSource === 'unity-event' && cs.confidence !== 'low';
    if (!unityAuthoritative && cur && cur.phase && PAGE_SOURCES[cur.contextSource]) return;

    const sc = cs.taskId ? C.byId[cs.taskId] : null;
    const taskKnown = !!(sc && cs.taskName);

    state.clientScene = {
      phase: cs.phase,
      postopDay: cs.postopDay || null,
      taskId: taskKnown ? cs.taskId : null,
      taskName: taskKnown ? cs.taskName : null,
      scenarioId: taskKnown ? cs.taskId : null,
      functionName: taskKnown ? sc.functionName : null,
      mode: state.examLock ? 'exam' : (cs.mode || 'study'),
      patientId: C.patient.id,
      contextSource: cs.contextSource || 'client-log',
      confidence: cs.confidence || 'medium',
      evidence: (cs.evidence || []).map(e => '客户端：' + String(e).slice(0, 60))
    };
    applyScene(state.clientScene, true);
    toast(taskKnown
      ? ('已从客户端识别：' + cs.taskName)
      : ('已从客户端识别：' + (PFX[cs.phase] || cs.phase) + '阶段（任务请手动选）'));
    T.log('scene', { from: 'client', phase: cs.phase, task: cs.taskId || null, conf: cs.confidence, live: cs.live });
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

  /* —— TTS 语音播报 ——
     默认用系统中文语音（WebView2/Chromium 内置）。若配置了 BT_TTS_URL，
     改为请求外部 TTS 服务返回音频，便于替换成真正的语音模型。 */
  let ttsOn = localStorage.getItem('bt_tts') !== '0';
  function speak(text) {
    if (!ttsOn || !text) return;
    const clean = String(text).replace(/[*#`>]/g, '').slice(0, 300);
    const url = window.BT_TTS_URL;
    if (url) {
      try {
        const a = new Audio(url + (url.includes('?') ? '&' : '?') + 'text=' + encodeURIComponent(clean));
        a.play().catch(() => { });
        return;
      } catch { }
    }
    if (!window.speechSynthesis) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(clean);
      u.lang = 'zh-CN';
      u.rate = 1.05;
      const v = (speechSynthesis.getVoices() || []).find((x) => /zh|Chinese/i.test(x.lang));
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    } catch { }
  }

  /* 与游戏同步：每 2 秒拉一次 /state，拿到字幕、今日任务、识别结果。
     面板因此能显示「游戏里正在说什么」「今天要做哪几项」，而不是固定菜单。 */
  let gameTimer = null;
  function startGameSync() {
    if (gameTimer) return;
    const pull = async () => {
      try {
        const r = await fetch('http://127.0.0.1:8790/state', { cache: 'no-store' });
        const cs = await r.json();
        const u = cs.unity || {};
        const next = {
          subtitle: (u.subtitle || '').trim(),
          dayTasks: String(u.dayTaskNames || '').split('|').filter(Boolean),
          commData: Array.isArray(u.commDatas) ? u.commDatas : [],
          tipButtons: u.tipOptButtons || '',
          scen: cs.scenarioId || null,
          conf: cs.confidence || null,
          day: cs.postopDay || null,
        };
        const prev = state.game || {};
        const changed = next.subtitle !== prev.subtitle || next.dayTasks.join() !== (prev.dayTasks || []).join();
        state.game = next;
        if (changed) renderScene();
      } catch { /* agent 没开就静默 */ }
    };
    pull();
    gameTimer = setInterval(pull, 2000);
  }

  function finishStream(reason) {
    const th = currentThread();
    const last = th[th.length - 1];
    if (last && last.streaming) {
      last.streaming = false;
      T.log('answer', { reason, chars: (last.text || '').length });
    }
    if (last && last.role === 'assistant' && last.text) speak(last.text);
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
    if (els.modeBadge) {
      els.modeBadge.title = '点击切换语音播报';
      els.modeBadge.onclick = () => {
        ttsOn = !ttsOn;
        localStorage.setItem('bt_tts', ttsOn ? '1' : '0');
        if (!ttsOn && window.speechSynthesis) speechSynthesis.cancel();
        renderFooter();
      };
    }
    if (m === 'mock') { els.modeBadge.className = 'bt-badge mock'; els.modeBadge.textContent = '未接入模型 · 不会回答' + (ttsOn ? ' · 🔊' : ' · 🔇'); }
    else if (m === 'live') { els.modeBadge.className = 'bt-badge live'; els.modeBadge.textContent = '已接入 ' + (state.health.model || '模型') + (ttsOn ? ' · 🔊' : ' · 🔇'); }
    else { els.modeBadge.className = 'bt-badge mock'; els.modeBadge.textContent = '未连接本地服务'; }
  }

  function send(text) {
    const s = activeScene();
    if (!s || !s.phase) { toast('请先选择当前实验场景'); T.log('block', { why: 'no-scene' }); return; }
    /* 没有真实模型时不做任何本地规则回答：直接告诉学生为什么不能问 */
    if (state.health && state.health.mode && state.health.mode !== 'live') {
      toast('未接入真实模型：请在本地网关配置 API Key');
      T.log('block', { why: 'no-live-model' });
      return;
    }
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
    /* 切换前先中断在跑的请求：否则旧请求的 chunk 会写进新场景的会话。
       activeReqId 递增使迟到的消息被 onBg 的 id 校验丢弃。 */
    if (state.busy) {
      try { cancel(); } catch (e) { }
      state.activeReqId = ++state.reqId;
      state.busy = false;
      state.streaming = false;
      if (els.send) {
        els.send.classList.remove('stop');
        const sp = els.send.querySelector('span');
        if (sp) sp.textContent = '发送';
        els.send.disabled = false;
      }
    }
    // 考核保护：一旦确认过考核，后续任何来源（含手动选择）都不能把它改回普通问答
    if (scene && (scene.mode === 'exam' || scene.phase === 'report')) state.examLock = true;
    // 就地改，保证 state.override 与 state.scene 两个引用看到同一个 mode
    if (scene && state.examLock && scene.phase) scene.mode = 'exam';

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

    if (state.settingsTab === 'score') {
      const cs = (state.clientEvidence && state.clientEvidence.score) || null;
      if (!cs || !cs.totalItems) {
        els.setBody.innerHTML = `
          <div class="bt-field">
            <label>还没有成绩数据</label>
            <div class="hint">完成一次实验（或原程序写入 39 项评分）后，这里会显示总分、分类正确率与错项。</div>
          </div>`;
        return;
      }
      const rows = Object.entries(cs.bySection || {}).map(([k, v]) =>
        `<div>${k}：<b>${v.right}/${v.total}</b> 正确，${v.score} 分</div>`).join('');
      const wrong = (cs.wrongItems || []).slice(0, 10).map((w) =>
        `<li><b>${w.sn}</b>${w.section ? ' · ' + w.section : ''}${w.feedback ? '：' + w.feedback : ''}</li>`).join('');
      els.setBody.innerHTML = `
        <div class="bt-field">
          <label>总分：<b>${cs.totalScore}</b> / 正确 ${cs.rightItems}/${cs.totalItems}</label>
          <div class="hint">进度 PV ${cs.pv}/${cs.maxPV}${cs.isDone ? ' · 已完成' : ''}${cs.isStudyModel ? ' · 学习模式' : ''}</div>
        </div>
        <div class="bt-field">
          <label>分类得分</label>
          <div style="font-size:12px;line-height:1.9">${rows || '无'}</div>
        </div>
        <div class="bt-field">
          <label>错项（${(cs.wrongItems || []).length}）</label>
          <ul class="bt-score-wrong">${wrong || '<li>没有错项</li>'}</ul>
        </div>`;
      return;
    }

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

  /* 通知外层悬浮窗改变真实尺寸（不是只藏内容） */
  function setForm(m) { try { window.__BT_FORM = m; } catch (e) { } }

  function collapse() {
    setForm('launcher');
    state.open = false; state.mini = false;
    els.panel.classList.add('bt-hidden');
    els.mini.classList.add('bt-hidden');
    els.launcher.classList.remove('bt-hidden');
    try { localStorage.setItem('bt_open', '0'); } catch (e) {}
    T.log('panel', { action: 'collapse' });
  }

  function closeAll() {
    setForm('mini');
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
      phases: root.querySelector('.bt-phases'),
      cards: root.querySelector('.bt-cards'),
      current: root.querySelector('.bt-current'),
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
      if (state.settingsTab === 'score') {
        fetch('http://127.0.0.1:8790/state', { cache: 'no-store' })
          .then((r) => r.json())
          .then((cs) => { state.clientEvidence = { score: cs.scoreDetails || null, lifecycle: cs.lifecycle || null }; renderSettings(); })
          .catch(() => { });
      }
      renderSettings();
    });

    els.phases && els.phases.addEventListener('click', (e) => {
      const b = e.target.closest('.bt-phase');
      if (!b) return;
      const ph = b.dataset.phase;
      const first = C.scenarios.find((x) => x.phase === ph);
      if (first) {
        els.select.value = first.id;
        els.select.dispatchEvent(new Event('change'));
      }
    });

    els.cards && els.cards.addEventListener('click', (e) => {
      const b = e.target.closest('.bt-card');
      if (!b) return;
      els.select.value = b.dataset.scene;
      els.select.dispatchEvent(new Event('change'));
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
        postopDay: sc.phase === 'postop' ? ((cur && cur.phase === 'postop' && cur.postopDay) || null) : null,
        taskId: sc.id, taskName: sc.taskName, scenarioId: sc.id,
        functionName: sc.functionName, mode: state.examLock ? 'exam' : sc.mode,
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
      // 术后不同日期是不同病程：切日期 = 切会话上下文
      applyScene(next, false);
    });

    startGameSync();
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
      state.scoreCleared = true;      // 学生自己粘贴/改过，不再被自动数据覆盖
      T.log('score', { chars: v.length });
      send('这是我的考核成绩/错项，请基于它帮我分析：\n' + v);
    });
    root.querySelector('[data-act="clear-score"]').addEventListener('click', () => {
      state.scoreText = '';
      state.scoreCleared = true;
      state.scoreSource = '';
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
      setForm('panel');
      state.open = true;
      /* 重启后恢复上次手动选择的场景（只恢复手动指定，不覆盖自动识别） */
      try {
        const savedScene = localStorage.getItem('bt_scene_manual');
        if (savedScene && C.byId[savedScene]) {
          state.override = C.byId[savedScene];
          state.scene = state.override;
        }
      } catch (e) { }
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

    // 客户端状态的两种取法：
    //   1) 本机页面（悬浮窗、demo）直接轮询 8790；
    //   2) 真实 https 站点上，浏览器把「公网页面 → 127.0.0.1」当作 Private Network Access
    //      直接拦掉（实测 "blocked by CORS policy ... loopback address space"），
    //      所以改由后台 service worker 拉取再推给面板（后台有 host_permissions，不受此限）。
    let lastClient = '';
    const applyClient = (cs) => {
      const key = [cs.phase, cs.postopDay, cs.taskId, cs.confidence, cs.mode].join('|');
      if (key === lastClient) return;
      lastClient = key;
      onClientState(cs);
    };
    const isLocalPage = /^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname);
    if (isLocalPage) {
      const pollClient = async () => {
        try {
          const r = await fetch('http://127.0.0.1:8790/state', { cache: 'no-store' });
          if (!r.ok) return;
          applyClient(await r.json());
        } catch (e) { /* 代理没开 */ }
      };
      pollClient();
      setInterval(pollClient, 4000);
    }

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

    // 客户端状态到期失效：实验结束/日志不再更新时，不能让上一次的"术后第2天"一直挂着。
    // 30 秒没有新的客户端状态，就退回页面识别（识别不到即"未识别"）。
    const CLIENT_TTL = 30000;
    setInterval(() => {
      if (state.override) return;
      const s = state.scene;
      if (!s || s.contextSource !== 'client-log') return;
      if (Date.now() - state.clientTs < CLIENT_TTL) return;
      state.clientScene = null;
      T.log('scene', { from: 'client-stale', phase: s.phase, ageMs: Date.now() - state.clientTs });
      let next = null;
      try { next = window.BT_SCENE.detect(); } catch (e) { next = null; }
      applyScene(next, true);
      toast('客户端状态已超时，回到自动识别');
    }, 5000);

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

  function debug() {
    return {
      scene: activeScene(),
      override: !!state.override,
      examLock: state.examLock,
      clientTs: state.clientTs,
      clientPhase: state.client ? state.client.phase : null,
      clientSource: state.client ? state.client.contextSource : null,
      clientEvidence: state.clientEvidence
        ? { hasScore: !!state.clientEvidence.score, lifecycle: state.clientEvidence.lifecycle && state.clientEvidence.lifecycle.label }
        : null,
      scoreSource: state.scoreSource,
      scoreCleared: state.scoreCleared,
      thread: threadKey(),
      threads: Object.keys(state.threads)
    };
  }

  window.BT_UI = { mount, setClientState: onClientState, debug };
})();
