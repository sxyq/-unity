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

## 5. 真实平台：协议层可用，浏览器层被卡

| 访问方式 | 结果 |
|---|---|
| curl / Node（经本机代理 127.0.0.1:7897） | ✅ 200，`Server: rump/e`（nginx unit） |
| Edge（同一代理，headless） | ❌ `ERR_EMPTY_RESPONSE`（换 relay 后 `ERR_CONNECTION_CLOSED`） |
| Edge 访问 baidu.com | ✅ 正常，说明代理与浏览器网络本身没问题 |
| Edge 访问本机面板 | ✅ 正常 |

已排除：代理不可用、证书问题（`--ignore-certificate-errors`）、HTTP/2、后量子密钥交换（`--disable-features=PostQuantumKyber`）、ECH/DoH、TLS 版本（强制 1.2）。
现象更像是**该站点（nginx unit）对 Chromium 系握手/连接处理异常**，而 curl/Node 的握手能过。

线上平台本身没变（复核）：

```
GET  /mengoo/                     → <title>虚拟仿真实验教学平台</title>
                                    bundle: index.175edf541731381347754.js（与旧分析一致）
POST /api/Experiment/Item         → code HLF10631030，type 2，typeName 客户端实验
HEAD /MZL/MLauncherSetup.msi      → 200，82,271,744 字节
```

**因此，浏览器扩展在真实站点上的「面板挂载 / 身份识别 / 成绩读取」本轮未复验**，
只在本地等价页面验证了同一套代码路径（§3、§4 与下节）。

---

## 6. 最大的硬阻塞：本机没有 Mengoo 客户端

```
HKCR\MLauncher                     → 不存在
%LOCALAPPDATA% / Program Files     → 无 Mengoo / MLauncher / MCLocalLauncher
%USERPROFILE%\AppData\LocalLow     → 无 Mengoo 目录
client-agent /procs                → 0 个相关进程
```

没有客户端 → 没有 `Player.log` → 无法确认真实日志里的阶段/任务标记 → 十场景的「真实操作状态」无法观察。

这不是代码问题，是环境缺一步：**用有权限的账号登录平台 → 下载 `MLauncherSetup.msi` → 安装 → 启动实验**。
安装 MSI 需要管理员确认，登录需要人工过验证码，两者都必须由使用者完成。

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
| 09 | 成绩与能力分析 | ✅ 学习反馈角色 | ◐ 旁听 `ItemsMineScore/ItemsByUser/GetProcess` + 读页面成绩表 | ✗ 本轮未登录复验 | 依赖登录后的页面数据；不碰 token |
| 10 | 个性化复习建议 | ✅ 同上 | ◐ 由 09 的成绩数据驱动 | ✗ | 只有总分时只做趋势分析，不推断具体错项 |

**能明确回答的：**

- 能真正自动识别的：**阶段**（术前/术中/术后/报告）——前提是有客户端日志；
- 只能到阶段的：03/04/05、07/08 在日志只打印阶段时；
- 能真实读取操作结果的：**目前没有**，需要日志里出现 `CurrentTask` / `SubStepDescription` 之类的标记；
- 仍需手动选择：任务级场景（当前全部）；
- 是否必须厂商开放：**若要稳定的任务级状态，需要厂商开放**（客户端回调/本地接口/结构化日志三者之一）；
- 距离完整目标还缺：① 装客户端并跑一次 ② 拿到真实 `Player.log` 样本 ③ 按真实格式补 `rules.json`。

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
```
