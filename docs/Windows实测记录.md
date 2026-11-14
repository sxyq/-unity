# Windows 实机接管记录（2026-11-14）

> 环境：Windows 11 家庭版 26200 ｜ AMD Ryzen 9 7845HX ｜ 32 GB
> 工具链：git 2.55.0 ｜ Node v22.22.2 ｜ npm 10.9.7 ｜ .NET SDK 8.0.417 ｜ Edge 156
> 仓库：`C:\Projects\gouqianyin-ai`，起点提交 `977e469`

本轮目标不是再写一份调研，而是把「能在 Windows 上跑起来的部分」跑起来、把「跑不起来的」定位清楚。
下面每一条都区分**实测**与**未验证**，不把样例当真实实验。

---

## 1. 两个 Skill 的实际状态（结论：本机不可用）

| 项 | 实测结果 |
|---|---|
| REA 技能目录 | `~/.workbuddy/skills/` 30 个技能，**无** `reverse-engineer-anything` |
| REA 安装尝试 | 技能市场能检索到「逆向工程任何目标」，`install` 返回 **refused: not in the marketplace catalog** |
| REA MCP | `~/.workbuddy/mcp.json` 只有 `siemens-nx`、`cua_repl`，**无 `rea`** |
| REA CLI | `~/.local/bin/rea`、`~/.local/opt/rea-cache` 均不存在（那是 macOS 上的装法） |
| `reverse-skill-router` | 存在，但 `SKILL.md` 指向 `/Users/sunyiyang/.codex/skills/reverse-skill-suite`，**Windows 上没有这个路径**，且其索引里没有 REA 模块 |
| Craft Anything | 全盘技能/插件缓存检索**无同名技能**；市场检索只返回 browser-session / rpa-automation 等替代品 |

因此本轮**没有伪造任何 REA / Craft Anything 调用结果**。替代方案是同等能力的两条本机链路：

| 原计划能力 | 本轮实际用的 |
|---|---|
| 浏览器目标发现 / 运行时状态 / 页面截图 | `tools/cdp.mjs`（零依赖 CDP 探针，Node 22 原生 WebSocket） |
| 请求-响应观察 | CDP `Network.responseReceived` + 平台接口直接复核（curl） |
| 前端结构与启动链路 | 沿用仓库已有 bundle 分析结论，并用线上 bundle 哈希复核「平台没变」 |
| 进程/日志观察 | `client-agent` 的 `/scan`、`/procs`、`/raw`（PowerShell 只读） |

> 说明：如果之后要在这台机器上用 REA，需要先把技能装进 `~/.workbuddy/skills/` 并注册 MCP；
> 本机 Node 22.22.2 低于 REA 声明的 `^22.23.4`，装之前要先升级 Node。

---

## 2. 现有系统在本机启动情况

| 组件 | 命令 | 结果 |
|---|---|---|
| 模型网关 | `node apps/model-gateway/server.mjs` | ✅ 8787 起来，`mode=mock`，`hasKey=false`，明确显示「演示模式 · 未接入模型」 |
| 客户端代理 | `node client-agent/agent.mjs` | ✅ 8790 起来，`/health` `/state` `/raw` `/scan` `/procs` 可用 |
| 浏览器扩展 | Edge 加载 `apps/extension` | ⚠️ 本机 Edge 打不开校内站点（见 §5），未完成线上验证；本地页验证通过 |
| 悬浮窗 | `dotnet build ... -c Release` | ✅ **0 错误 0 警告**，exe 可运行并加载面板（见 §4） |
| 统一面板 | `/demo/panel.html` | ✅ 10 个场景、4 个统一功能名、角色头像、模型状态徽章全部正常 |

模型网关实测：

```
GET  /api/health      → {"ok":true,"mode":"mock","model":"演示知识库","hasKey":false}
POST /api/chat        → SSE 正常分片，内容来自 lib/mock.mjs
POST /api/config 带 Origin: https://evil.example → 403（跨站写配置被拒）
POST /api/config {"mode":"live"}（无 Key）      → 仍返回 mock（不假装接通）
```

---

## 3. 客户端状态代理：一个确定性误报，已修

### 3.1 现象（改动前，本机复现）

```
GET http://127.0.0.1:8790/state
{"phase":"intraop", "confidence":"medium",
 "evidence":["vulkan device extension:, VK_EXT_blend_operation_advanced"],
 "logs":[{"file":"...LocalLow\\Hypergryph\\Endfield\\Player.log", ...}]}
```

本机根本没装 Mengoo，代理却报「术中」。原因有三层，都是真问题：

1. 默认扫描 `LocalLow` 下**所有** `*\*\Player.log`，把无关 Unity 游戏日志当成实验日志；
2. 阶段规则里有 `/operation/i`，命中了 `VK_EXT_blend_operation_advanced` 这种标识符；
3. 解析整份日志（历史上千行），没有区分「本次会话」与「上次会话」。

### 3.2 修法（`client-agent/agent.mjs` 重写）

| 措施 | 说明 |
|---|---|
| 产品目录白名单 | 只认 `Mengoo` / `MCLocalLauncher` / `HLF10631030` / 项目名；非白名单日志必须正文出现 `HLF10631030`、校内域名等锚点才收 |
| 会话切片 | 只解析最后一根 `Initialize engine version` 之后的行，历史会话不参与 |
| 规则收紧 | 英文只认 `PreOp/IntraOp/PostOp` 带词边界；去掉裸 `operation`、裸 `score` |
| 阶段 ≠ 任务 | 只有 `CurrentTask / 当前任务 / SubStepDescription…` 这类“明确宣告当前任务”的行，且任务词命中，才给 `taskId`；否则为 `null` |
| 任务必须新于阶段 | 任务事件索引 < 最近阶段事件索引时丢弃（上一阶段残留） |
| 新鲜度 | 日志 5 分钟内有更新才算 `live`；超过 60 分钟降为 `low` 可信 |
| 术后天数 | 逐行收集「术后第 N 天」，取本会话内最后一处，不跨会话继承 |
| 新端点 | `/scan`（候选日志与是否 live）、`/procs`（启动器/实验进程，只读）、`/raw?file=` |

### 3.3 样例输入验证（**样例，不是真实实验**）

临时目录 `C:\Temp\gqy-fix`，用 `LOG_DIRS` 指向它：

| 输入 | 期望 | 实际 |
|---|---|---|
| 无关游戏日志（含 `VK_EXT_blend_operation_advanced`） | 不采纳 | ✅ `logs: []`，`phase: null` |
| `术中阶段` + `LoadSceneStart 04_IntraOp` | 只到阶段 | ✅ `phase=intraop`，`taskId=null`，`medium` |
| `CurrentTask: 牵引原理` | 到任务 | ✅ `taskId=intraop-principle`，`high`，evidence 带原文 |
| 旧会话「术后第3天/心理护理」+ 新会话「术前阶段」 | 新会话优先 | ✅ `phase=preop`，`taskId=null` |
| `CurrentTask: 体位护理与翻身指导` + `术后第 7 天` | 任务+天数 | ✅ `postop-care`，`day=7` |

> 这些只能证明**解析逻辑正确**，不能证明真实实验日志里存在这些标记。
> 真实标记长什么样，必须等 Mengoo 客户端在本机跑起来（见 §6）。

---

## 4. Windows 悬浮窗：从「源码未验证」到「能构建、能加载面板」

### 4.1 修掉的编译/运行问题

| 问题 | 处理 |
|---|---|
| `Timer` 二义性（`System.Threading.Timer` vs `Forms.Timer`，ImplicitUsings 引入前者 → CS0104） | 显式写 `System.Windows.Forms.Timer`，并用 `Forms` 别名 |
| 默认面板地址指向 `127.0.0.1:8788/panel.html`（服务端注入服务，未启动时白屏） | 默认改为 `127.0.0.1:8787/demo/panel.html`（模型网关直接托管），可用 `GQY_PANEL_URL` 覆盖 |
| WebView2 用户数据目录在程序目录，可能不可写 | 改到 `%LOCALAPPDATA%\GouQianYinOverlay\WebView2` |
| 只跟随**前台**窗口，焦点在浏览器时不动 | 改 `EnumWindows` 找标题匹配、面积最大的可见窗口 |
| 全屏时不可避免覆盖场景，鼠标会被面板吃掉 | 新增 `Ctrl+Alt+T` 鼠标穿透（`WS_EX_TRANSPARENT`）；`Ctrl+Alt+P` 固定/跟随；`Ctrl+Alt+A` 显隐 |
| 网关没起时一次导航失败就永久白屏 | `NavigationCompleted` 失败重试（3 秒 × 3 次） |

### 4.2 实测

```
dotnet build client-agent/overlay/Overlay.csproj -c Release
→ 已成功生成。0 个警告，0 个错误

运行 GouQianYinOverlay.exe 后，网关访问日志（BT_VERBOSE=1）：
[200] GET /demo/panel.html
[200] GET /demo/shim.js
[200] GET /src/data/case-data.js / prompt.js / instrument.js
[200] GET /src/platform/bridge.js / score-parse.js / scene/rules.js / scene/detect.js
[200] GET /src/ui/template.js / panel.js / panel.css
[200] GET /assets/nurse.svg
```

即：悬浮窗内的 WebView2 把完整面板（脚本 + 样式 + 头像）都加载成功了。

> 未验证：贴靠位置与穿透效果需要真实 Unity 窗口才看得出。本机没有 Mengoo，只能确认窗口存在、页面加载完整。

---

## 5. 真实平台：已经能看到、点到，但进不去实验

### 5.1 浏览器打不开站点（已定位并绕过）

| 访问方式 | 结果 |
|---|---|
| curl / Node（经本机代理） | ✅ 200，`Server: rump/e`（nginx unit） |
| Edge（同一代理） | ❌ `ERR_EMPTY_RESPONSE` / `ERR_CONNECTION_CLOSED` |
| Edge 访问 baidu.com、本机面板 | ✅ 正常（代理与浏览器网络没问题） |
| 本机 TLS 中转后再用 Edge | ❌ 文档拿不到，白页 |

已排除：代理不可用、证书、HTTP/2、后量子密钥交换、ECH/DoH、TLS 版本。
**关键发现**：站点对 `HeadlessChrome` 的 User-Agent 会直接断连（同一请求换成普通 Chrome UA 立即 200）。

最终可用的方式：`tools/cdp-mirror.mjs` —— 浏览器只负责渲染，目标域名的请求在 CDP
`Fetch` 域里拦下，由 Node 代取（UA 换成普通 Chrome）再 fulfil 回去。
这样域名、Cookie、脚本执行环境都是真的，扩展照常工作。

### 5.2 真实站点上已经验证到的

```
[200] GET  /mengoo/                       5423B
[200] POST /api/OrgInfo/item              804B
[200] POST /api/Navbar/Items              513B
[200] POST /api/Home/Banners              154B
[200] POST /api/Stat/OrgStats             226B
[200] POST /api/Pageview/Access           273B
```

| 验证项 | 结果 |
|---|---|
| 页面正常渲染（重医护理学院 / 虚拟仿真实验教学平台） | ✅ 截图 `platform-mirror.png` |
| 扩展在真实域名挂载 | ✅ `#bt-assistant-host` 存在 |
| 面板可打开、10 个场景齐全 | ✅ 截图 `platform-panel-open.png`，选项 11 个（含"自动识别"） |
| 首页不误判阶段 | ✅ 显示「未识别，请手动选择」，而不是硬猜一个场景 |
| 模型网关连接状态 | ✅ 「演示模式 · 未接入模型」与 `/api/health` 一致 |

### 5.2.1 真实站点上的「客户端日志 → 面板」整条链路（用样例日志验证）

在真实 https 页面上，扩展原本**拿不到** 8790：Chrome 的 Private Network Access 会拦掉
「公网页面 → 127.0.0.1」，控制台报
`blocked by CORS policy: Permission was denied for this request to access the loopback address space`。
这是只在真实域名上才会暴露的问题（本地 demo 页同地址空间，看不出来）。

修法两条一起上：

1. `agent.mjs` 所有响应与 OPTIONS 预检都带 `Access-Control-Allow-Private-Network: true`；
2. `panel.js` 不再在公网页面直连 8790，改由**后台 service worker** 拉取后推送（后台有 host_permissions，不受 PNA 限制）。

用一份**明确标注为样例**的日志（`C:\Temp\gqy-fix`，`LOG_DIRS` 指向它）在真实站点上验证：

```
agent /state:  phase=postop  postopDay=2  taskId=postop-psych  confidence=high
面板 debug:     phase=postop  task=postop-psych  day=2
                src=client-log  thread=postop-psych@d2
```

即：真实站点 → 后台 → 本机代理 → 面板自动换角色（智能情境化护患交流｜术后心理护理 · 术后第 2 天），
并且**会话 key 带上了术后天数**（`@d2`），换日期不会串台。

随后停掉样例日志、恢复真实模式（本机没有客户端）：

```
36 秒后：phase=null  src=page  hint=未识别，请手动选择
```

说明新增的 **30 秒过期**生效：客户端不再上报时，面板不会被上一次的「术后第 2 天」长期占住。


### 5.3 卡住的地方：平台已改成 CAS 单点登录

旧文档里的「用户名 + 密码表单」现在不适用了。实测：

```
GET /mengoo/                                → 302 → /rump_frontend/login/?next=...
GET /mengoo/CourseInfo?id=...               → 302 → 同上
/rump_frontend/login/                       → 302 → https://cas.cqmu.edu.cn/cas/login?service=...
```

也就是说：**没有校园统一身份账号，就无法进入学习页/成绩页/实验启动页**。
用 curl 直接请求这些路径会返回 200（那是 SPA 外壳），但页面内的接口仍要鉴权。

因此本轮：
- ✅ 能证明扩展在真实站点上正常工作、不误判；
- ❌ 不能复验「实验身份自动识别」「成绩读取」（都需要登录后的页面）；
- ❌ 不能拿到 `Experiment/Launch` 的 ticket（需要登录）。

线上平台本身没变（公开接口复核）：

```
POST /api/Experiment/Item   → code HLF10631030，type 2，typeName 客户端实验
HEAD /MZL/MLauncherSetup.msi → 200，82,271,744 字节（SHA256 9153E708…6ABBAB9）
```


---

## 6. 硬阻塞：Mengoo 客户端装不上，实验跑不起来

```
HKCR\MLauncher                     → 不存在
%LOCALAPPDATA% / Program Files     → 无 Mengoo / MLauncher / MCLocalLauncher
%USERPROFILE%\AppData\LocalLow     → 无 Mengoo 目录
client-agent /procs                → 0 个相关进程
```

安装包已经下好并校验：

| 项 | 值 |
|---|---|
| 文件 | `C:\Temp\MLauncherSetup.msi` |
| 大小 | 82,271,744 字节（与服务器 Content-Length 一致） |
| SHA256 | `9153E7086CECEEBC274A1A5E861AF59EC5E90A9A527879C46C57BD5B06ABBAB9` |
| 签名 | **未签名**（NotSigned，校方原始包就是这样） |

尝试过的安装方式：

| 方式 | 结果 |
|---|---|
| `msiexec /i ... /qb` | 被当前执行沙箱终止（进程刚起就被杀，无 MSI 日志、无残留） |
| `msiexec /i ... /qn ALLUSERS=2 MSIINSTALLPERUSER=1`（按用户装） | 同上 |
| 解包后直接跑 `MCLocalLauncher.exe` | 本机没有 7-Zip / WinRAR / Python msilib，MSI 里的 CAB 取不出来 |

最后一步卡在 Windows 的 UAC：本机 `EnableLUA=1`、`ConsentPromptBehaviorAdmin=5`，
安装 MSI 必须在**安全桌面**上点一次「是」。这一步是操作系统的安全边界，
自动化无法也不应该代点。

即使装上了，进实验还要过 5.3 说的 CAS 登录。所以「跑真实 Unity 实验」这条链，
在本机当前状态下缺的是**两个人工动作**（UAC 确认 + 校园账号登录），不是代码。


---

## 7. 十场景：本轮到底做到了哪一步

图例：✅ 已实现并验证 ｜ ◐ 已实现未在真实客户端复验 ｜ ○ 只有理论通路 ｜ ✗ 本期不可得

| 编号 | 场景 | 模型交互 | 自动识别 | 实际操作状态 | 具体限制 |
|---|---|---|---|---|---|
| 01 | 病史采集 | ✅ 虚拟患者角色可用 | ◐ 页面/日志给到 `preop` 即可进；任务需日志出现「病史采集」等当前任务标记 | ✗ | 无客户端，未见真实标记 |
| 02 | 术前沟通 | ✅ 同上 | ◐ 依赖「术前谈话/知情同意」标记，与 01 靠任务标记区分 | ✗ | 不能靠阶段猜任务（已强制 `taskId=null`） |
| 03 | 术中宣教 | ✅ 责任护士角色 | ◐ 依赖「身份核对/部位确认/术中沟通」标记 | ✗ | 同上 |
| 04 | 牵引原理 | ✅ 带教老师角色 | ◐ 依赖「牵引原理/砝码/滑轮」标记 | ✗ | 牵引重量等参数只在日志打印时才可得 |
| 05 | 操作观察 | ✅ 带教老师角色 | ◐ 依赖「末梢血运/牵引效果」标记 | ✗ | 需要真实结果事件，不能凭阶段推断 |
| 06 | 术后心理护理 | ✅ 患者角色 + 术后时间线 | ◐ 可自动读「术后第 N 天」；任务需「心理护理」标记 | ✗ | 天数未知时不假定为第 3 天（已改） |
| 07 | 术后护理指导 | ✅ 带教老师 | ◐ 依赖「体位/翻身/有效咳嗽/皮肤护理」标记 | ✗ | 同上 |
| 08 | 并发症观察 | ✅ 带教老师 | ◐ 依赖「并发症/血栓/肿胀/牵引失效」标记 | ✗ | 不根据常识判定患者发生了哪种并发症 |
| 09 | 成绩与能力分析 | ✅ 学习反馈角色 | ◐ 旁听 `ItemsMineScore/ItemsByUser/GetProcess` + 读页面成绩表 | ✗ 平台已改 CAS 登录，本轮进不去 | 依赖登录后的页面数据；不碰 token |
| 10 | 个性化复习建议 | ✅ 同上 | ◐ 由 09 的成绩数据驱动 | ✗ | 只有总分时只做趋势分析，不推断具体错项 |

**能明确回答的：**

- 能真正自动识别的：**阶段**（术前/术中/术后/报告）——前提是有客户端日志；
- 只能到阶段的：03/04/05、07/08 在日志只打印阶段时；
- 能真实读取操作结果的：**目前没有**，需要日志里出现 `CurrentTask` / `SubStepDescription` 之类的标记；
- 仍需手动选择：任务级场景（当前全部）；
- 是否必须厂商开放：**若要稳定的任务级状态，需要厂商开放**（客户端回调/本地接口/结构化日志三者之一）；
- 距离完整目标还缺：① UAC 确认安装客户端 ② CAS 账号登录 ③ 跑一次实验拿真实 `Player.log` ④ 按真实格式补 `rules.json`。

---

## 8. 本轮对十场景之外的行为约束（已写进代码）

| 约束 | 实现位置 |
|---|---|
| 阶段已知但任务未知时，不伪造任务 | `agent.mjs`（taskId 只在有任务标记时给）+ `panel.js`（无 scenarioId 时只显示该阶段的任务选择器） |
| 手动选择不能解除考核保护 | `panel.js` `state.examLock`，`applyScene` 强制 `mode='exam'`，面板显示「考核中 · 不提供答案」 |
| 不同术后日期不混用上下文 | `threadKey()` 对术后场景追加 `@dN`，切日期即切会话 |
| 历史日志不压当前实验 | `lastSession()` 只取最后一根会话 |
| 页面识别优先于客户端 | `PAGE_SOURCES` 判断，页面有证据时不接受客户端覆盖 |
| 自动识别标注来源与可信度 | `contextSource` + `confidence` 直接显示在面板提示行（如「客户端日志 · 高可信 · 仅到阶段」） |
| 客户端状态会过期 | 30 秒没有新状态就退回页面识别（`panel.js` 里的 `CLIENT_TTL`），不让旧状态长期挂着 |
| 公网页面不能直连 127.0.0.1 | 代理补 `Access-Control-Allow-Private-Network`；面板改走后台推送（`panel.js` 的 `isLocalPage` 分支） |

---

## 9. 复现命令

```powershell
# 1. 服务
node apps/model-gateway/server.mjs        # 8787
node client-agent/agent.mjs               # 8790

# 2. 看客户端状态（没有客户端时应该是空的，不再误报）
curl http://127.0.0.1:8790/state
curl http://127.0.0.1:8790/scan
curl http://127.0.0.1:8790/procs

# 3. 面板
start http://127.0.0.1:8787/demo/panel.html

# 4. 悬浮窗
dotnet build client-agent/overlay/Overlay.csproj -c Release
.\client-agent\overlay\bin\Release\net8.0-windows\GouQianYinOverlay.exe

# 5. 浏览器探针（本机排错用）
node tools/cdp.mjs probe http://127.0.0.1:8787/demo/panel.html --headless --shot=panel.png

# 6. 在真实站点上看扩展（本机专用：绕过 Chromium 与站点握手不兼容）
node tools/cdp-mirror.mjs "https://skeletaltraction.cqmu.edu.cn/mengoo/" ^
  --ext=apps/extension --wait=16000 --shot=platform.png
# 常驻并按步操作：加 --keep --port=9335，然后用
node tools/cdp.mjs attach --port=9335 --eval="(()=>({url:location.href}))()"

# 7. 自己用浏览器登录（需要 CAS 账号）
tools\start-edge-debug.bat    # 独立配置 + 已加载扩展 + 调试端口 9333
```

### 本轮新增的三个小工具

| 文件 | 作用 |
|---|---|
| `tools/cdp.mjs` | 零依赖 CDP：`probe` 自己拉浏览器跑页面；`attach` 附着到已开的浏览器；`--isolated` 在内容脚本的隔离世界里取值（页面 window 上拿不到 `BT_UI`） |
| `tools/cdp-mirror.mjs` | 真实站点验证：CDP `Fetch` 拦截 + Node 代取（浏览器只渲染，绕开握手不兼容） |
| `tools/start-edge-debug.bat` | 用独立配置启动 Edge，加载扩展并开 9333 调试端口（供人工登录后观察） |

> 这三个都只用于**验证**，不进入产品运行路径；不读取、不打印、不落盘 cookie / token / 请求体。

