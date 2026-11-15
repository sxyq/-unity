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

          <div class="bt-nav">
            <div class="bt-phases"></div>
            <div class="bt-cards"></div>
            <div class="bt-current"></div>
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
              <button class="bt-tab" data-tab="score">成绩</button>
            </div>
            <div class="bt-set-body"></div>
          </div>

          <div class="bt-toast"></div>
        </section>
      </div>
    `;
  };
})();
