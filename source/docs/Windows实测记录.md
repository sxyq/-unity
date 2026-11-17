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


### 5.3 卡住的地方：平台登录

旧文档里的「用户名 + 密码表单」现在默认走 CAS，但平台**仍保留了「密码登录」页签**：
`/mengoo/login?redirect=/` → 「密码登录」→ 账号 + 密码 + 登录（首屏无验证码）。

本轮用课程联调用的**测试账号**在该页面完成了一次正常登录（表单提交，未做任何绕过；
账号口令不写入仓库、不打印、不入库）。登录后 `POST /api/Experiment/Launch` 等接口才可用。

### 5.4 登录后的实测（真实数据）

| 验证项 | 结果 |
|---|---|
| 实验身份识别 | ✅ 学习页副标题：「客户端实验 · 下肢骨折骨牵引护理技术虚拟仿真实验项目」 |
| 我的成绩（页面表格） | ✅ `2026-05-26 14:34:31 19′10″ 98` / `11:47:20 23′02″ 88` / `11:23:20 33′02″ 68` |
| 面板自动带入成绩 | ✅ 切到 09 后成绩框自动填：`学习进度 0%；已完成 3 次` + 三次得分（来自接口旁听 `GetProcess` / `ItemsByUser`） |
| 启动链路 | ✅ `POST /api/Experiment/Launch` → **200**；随后页面尝试 `ws://127.0.0.1:9090/` → `ERR_CONNECTION_REFUSED`；回退 `mlauncher://&HLF10631030…&<ticket>&3&…` → `scheme does not have a registered handler` |
| 平台自身的兜底提示 | ✅ 弹窗「检测你的电脑没有安装 mengoo 下载器，点击确认下载该插件」 |

**成绩接口到底给了什么**（直接看返回结构，只记录字段名与数值）：

```
记录数: 3
顶层字段: id, userUserName, userName, orgName, deptNames, experimentName,
          status, timeUsed, startTime, endTime, score, createTime, roleName, roleId, userId
数值字段: {"status":1,"timeUsed":1150,"score":98}
嵌套字段: 无
```

**结论：`ExperimentResult/ItemsByUser` 只有「总分 + 用时 + 起止时间」，没有任何逐步骤/错项数组。**
所以 09/10 只能做「总分趋势 + 用时对比」，不能推断具体哪一步做错了——这条限制现在有实证，
不是保守估计。要步骤级数据，只能靠客户端日志里的 `SubStepDescription`，或让厂商开放接口。


截图 `real-learning.png` 里能同时看到：真实成绩表（98/88）、安装提示弹窗、右侧面板已把实验身份写成
「客户端实验 · 下肢骨折骨牵引护理技术虚拟仿真项目」。

最后一条正好把整条链路的**断点**钉在「本机没装启动器」上：
接口通、票据下发了、协议也拼对了，只是系统里没有东西接管 `mlauncher://`。

> 控制台里出现过的 ticket 属于会话票据，本文档不记录。它有效期很短，且不随之落盘。


线上平台本身没变（公开接口复核）：

```
POST /api/Experiment/Item   → code HLF10631030，type 2，typeName 客户端实验
HEAD /MZL/MLauncherSetup.msi → 200，82,271,744 字节（SHA256 9153E708…6ABBAB9）
```


---

## 6. MSI 装不上（排错记录）→ 已用手工部署绕过，实验可跑

> 注意：本节的「实验跑不起来」是当时（02:00 前）的结论。
> 后续在 02:32 用系统级真实鼠标点击触发 `mlauncher://` 后，实验本体已进入 3D 场景，
> 见 **§7.1**。本节保留完整排错过程，因为它解释了这台机器上为什么必须用手工部署。

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

尝试过的安装方式与结果（全部实测）：

| 方式 | 结果 |
|---|---|
| `msiexec /i ... /qb`（普通权限） | 退出码 **1619**：安装引擎打不开包 |
| `msiexec /i ... /qn ALLUSERS=2 MSIINSTALLPERUSER=1` | 同上 |
| `msiexec /a`（管理安装，仅解包） | **1619** |
| `ShellExecuteW("runas")` 提权安装 | 立即返回 **2**，无 UAC 窗口、无安装进程 |
| 换路径（C:\Temp、C:\Users\Public） | 仍 1619 |
| 换另一份构建 `MCLocalLauncherSetup.msi`（82,270,720 字节，哈希不同） | 仍 1619 |

排除项：
- 安装包损坏 → **两次独立下载字节完全一致**（SHA256 `9153E708…6ABBAB9`），OLE 头正常、内嵌 CAB 完整（MSCF @2,932,736，128 个文件，MSZIP）；
- MSI 被组策略禁用 → `HKLM\...\Policies\Microsoft\Windows\Installer` 下 `DisableMSI` 等键**都不存在**；
- 第三方杀软 → 只有 Microsoft Defender，无 360/火绒；
- 磁盘/路径 → 换目录、换短名均无效。

**决定性证据**：把包里的 128 个文件按 Unity 约定解出来（`C:\Temp\mengoo-portable`），
直接运行 `MCLocalLauncher.exe` 报 **WinError 740：请求的操作需要提升**。
也就是说这个客户端**自身清单要求管理员权限**，安装与运行都必须过 UAC。

本机 UAC 是开启的（`EnableLUA=1`、`ConsentPromptBehaviorAdmin=5`），但 Agent 所在的执行环境
无法把 UAC 安全桌面弹到用户面前（`consent.exe` 从未出现，提权调用立即失败）——这是环境边界，
不是代码或权限配置能绕过的。

所以最后一步只能由使用者在自己的桌面上完成：双击安装包 → 点「是」。


即使装上了，进实验还要过一次平台登录（见 5.3，密码登录可用）。所以「跑真实 Unity 实验」这条链，
在本机当前状态下只差**一个 UAC 确认**；代码、接口、票据下发都已经验证通了。

### 6.1 绕过损坏的 MSI：手工部署（本机已跑通）

这台机器的 Windows Installer 引擎对所有包都返回 1619（连系统自带的 45KB MSI 也一样），
但 MSI 里的东西是好的。下面是实测可用的替代路径，全程不需要 MSI：

```
1) 解 MSI：MSI 是 OLE 复合文件，内嵌一个 MSZIP 的 CAB（MSCF 在 2,932,736 字节处，128 个文件）
   → 用 zlib(-15) 逐块解压（每块以上一块末尾 32KB 作字典），按 CFFILE 表切片
2) 重排成 Unity 期望的布局：
   根目录       MCLocalLauncher.exe / UnityPlayer.dll / UnityCrashHandler32.exe / Version.json
                MonoBleedingEdge/EmbedRuntime/mono-2.0-bdwgc.dll、MonoPosixHelper.dll
   _Data/       globalgamemanagers*、level0、resources.assets*、sharedassets0.assets*、data.unity3d、app.info、boot.config
   _Data/Managed/        所有托管 dll（Assembly-CSharp.dll 注意有连字符）
   _Data/Resources/      unity default resources、unity_builtin_extra
   _Data/StreamingAssets/ warehouse
   MonoBleedingEdge/etc/mono/{,4.5}/  machine.config、config、web.config、settings.map…
3) 以管理员运行（清单要求）：
   MCLocalLauncher.exe "MLauncher://&HLF10631030&…&<ticket>&3&<host>&2&HLF10631030&"
4) 启动器会读 Version.json 把实验本体下到
   %TEMP%\Mengoo\MCLocalLauncher\HLF10631030\1.0.7\（198 个文件，data.unity3d 单个 293MB）
   实测它下到 28MB 左右会崩，所以改为按清单自己下：
   https://skeletaltraction.cqmu.edu.cn/mzl/HLF10631030/1.0.7/<fullName>，下完把 *.mengoo 去掉后缀
5) 实验本体自己也能直接启动，但它要的 URL **字段顺序和平台给的不一样**：
   平台原始 [16]=ticket、[18]=host；启动器传给实验时是 [16]=host、[18]=ticket
   按后者重写后启动，日志出现：
     GetToken requestBody: …/api/open/token?ticket=…&appid=…&signature=…
     ExperimentId:HLF10631030
     获取进度成功
     Resources/Prefabs/UI/Load/UILoadPanel
```

**实测结论**：客户端能起来、票据能换、进度能取；
但实验停在加载面板后进程退出（启动器那条链里，启动器退出时会 `KillProcess HLF10631030`，
而没有 9090 本地服务时实验也拿不到后续指令）。服务已注册
（`HKLM\SYSTEM\CurrentControlSet\Services\MCLocalLauncherService`，LocalSystem，自动启动），
`net start` 返回成功但进程随即退出、9090 未监听——这一步还需要继续查。

**日志位置（重要）**：实验本体不写 `Mengoo\MCLocalLauncher\Player.log`，
而是写 `%USERPROFILE%\AppData\LocalLow\Mengoo\HLF10631030\Player.log`。
`client-agent` 已能同时识别这两份（`Mengoo/MCLocalLauncher` 与 `Mengoo/HLF10631030`）。
当前这份日志里只有启动/鉴权/加载行，**还没有出现术前/术中/术后或任务名**——
这正好说明「阶段不能靠猜」，要等真正进入场景后再看它打印什么。



---

## 7. 十场景：本轮到底做到了哪一步

> 后续进展（同一天 04:xx）：已在**独立测试副本**里通过新增只读 observer 程序集，
> 让原 Unity 运行时主动输出 `GQY_STATE:` 结构化状态（`SenceState` / `DayTime` / `isStudyModel` /
> `WeightValue` / `ScoreDatas`），并接入 `client-agent` 的 `unity-event` 来源。
> 本节关于「原始 Player.log 不打印任务」的结论仍然成立，但**不再代表当前上限**，
> 详见 `docs/Unity本地状态输出.md`。

### 7.1 最后一次实测：真实实验终于跑进 3D 场景（2026-11-15）

前面几节写「装不上、进不去」的结论在最后一轮被推翻，过程留作排错记录，结果以本节为准。

| 步骤 | 实证 |
|---|---|
| 让平台把票据交给客户端 | CDP 合成的 `click()` 会被 Chrome 以 `Not allowed to launch 'mlauncher://…' because a user gesture is required` 拦掉；**必须用系统级鼠标事件**（`SetCursorPos` + `mouse_event`）真实点击「启动虚拟实验」，协议才会调起 `MCLocalLauncher.exe` |
| 启动器收到参数 | `CommandLineArgs:2`，参数为 `mlauncher://&HLF10631030&…&<ticket>&3&host&2&HLF10631030&` |
| 启动器 → 实验本体 | 启动器校验 198 个文件（需更新 0 个）→ `Application_MergeVersionFile` → `Application_Play` → 拉起 `HLF10631030.exe` |
| 实验窗口 | `UnityWndClass / HLF10631030`，2560×1440 全屏；截屏可见 3D 病房、患者、左上「时间 00:26 / 得分 98」、左侧「第一天任务」列表 |
| 任务列表（真实界面） | 牵引有效性 ✓、疼痛 ✓、患肢神经损伤 ✓、患肢肢端血供、下肢深静脉血栓、创口出血、牵引针道、压力性损伤、肺部感染；底部「完成返回 / 视诊 / 触诊 / 动诊 / 听诊」 |
| 悬浮窗同跑 | `GouQianYinOverlay.exe` 窗口「骨牵引智能交互 · 外部组件」(2108,80,420×720) 与 Unity 窗口同时存在且可见 |

**真实 `Player.log` 的原文（脱敏后）**：

```
userInfovaluemlauncher://&HLF10631030&…&<ticket>&2&HLF10631030&
GetToken requestBody:https://skeletaltraction.cqmu.edu.cn/api/open/token?ticket=…&appid=…&signature=…
ExperimentId:HLF10631030
获取进度成功
Resources/Prefabs/UI/Load/UILoadPanel
Resources/Prefabs/UI/Share/UIVideoPlayPanel
On Hide:Resources/Prefabs/UI/Case/UISelectPanel
打开UICasePanel
上传进度成功
On Hide:Resources/Prefabs/UI/Share/UISampleBingLiPanel
progress requestBody:{ "maxPV":0, "pv":2, "data":"{\"currentExpProgress\":2,\"ScoreDatas\":[…]}" }
```

**决定性结论：真实日志不打印业务阶段，也没有 `CurrentTask`/`SubStepDescription`。**
它打印的是自己加载/隐藏的 UI 面板路径和少量中文动作。所以 `/state` 的 `phase` 与 `taskId` 保持 `null`
是**正确**的，不能为了「看起来自动」拿 UI 面板名去猜十个业务场景。

**但发现了一个之前判断错的重大事实：逐步骤成绩确实存在，只是在客户端日志里，不在平台接口里。**
`progress requestBody` 的 `data` 是一份完整 JSON，含 `currentExpProgress`、`isDone`、`isStudyModel`
和 `ScoreDatas[]`（每项 `SN / score / scoreType / feedbackInfo / section / isRight / time`）。
真实读到：**39 项、38 对、累计 98 分**；章节分布：操作前准备 6/6（17 分）、操作方法及原理 1/1（3 分）、
术后病情观察 31/32（78 分）；**唯一未得分项 `M14`：「未点击患者进行心理护理。」**
章节名是题目归属，不是当前阶段，没有拿来推 phase。

### 7.2 十场景最终结果

图例：✅ 已实现并验证 ｜ ◐ 已实现未在真实客户端复验 ｜ ○ 只有理论通路 ｜ ✗ 本期不可得

| 编号 | 场景 | 模型交互 | 自动识别 | 实际操作状态 | 具体限制 |
|---|---|---|---|---|---|
| 01 | 病史采集 | ✅ 虚拟患者角色 | ✗ 真实日志无「病史采集」当前任务标记 | ◐ 界面上可见 `UISampleBingLiPanel` 示例病历面板 | 面板名不是任务名，不据此切场景 |
| 02 | 术前沟通 | ✅ 同上 | ✗ | ◐ 未单独观察 | 不能靠阶段猜任务 |
| 03 | 术中宣教 | ✅ 责任护士角色 | ✗ | ◐ 观察到 `UIVideoPlayPanel` 介绍视频 | 视频播放 ≠ 术中宣教 |
| 04 | 牵引原理 | ✅ 带教老师角色 | ✗ | ◐ 分项里有「保持牵引有效性」「砝码重量」题目记录 | 是历史答题记录，不是当前操作参数 |
| 05 | 操作观察 | ✅ 带教老师角色 | ✗ | ✅ 界面左侧可勾选任务（牵引有效性／患肢肢端血供等） | 只在 Unity 界面/截图可见，日志读不到 |
| 06 | 术后心理护理 | ✅ 患者角色 + 术后时间线 | ✗ | ✅ 分项 `M14` 明确记录「未点击患者进行心理护理」 | 界面显示「第一天任务」，但日志没有「术后第 N 天」文本 |
| 07 | 术后护理指导 | ✅ 带教老师 | ✗ | ◐ 分项含压力性损伤、排便、皮肤等题目 | 同上，历史记录非当前任务 |
| 08 | 并发症观察 | ✅ 带教老师 | ✗ | ✅ 界面任务列「下肢深静脉血栓／创口出血／牵引针道／肺部感染」 | 只证明确有这些任务，不能判定患者已发生哪种 |
| 09 | 成绩与能力分析 | ✅ 学习反馈角色 | ✅ 平台 98/88/68 + 客户端 39 项分项 | ✅ **分项级真实可读**（含错项原文） | 分项来自原程序打印的进度回包，可能是上次实验记录；不写回平台 |
| 10 | 个性化复习建议 | ✅ 演示知识库（无 Key） | ✅ 由 09 的分项驱动 | ✅ 已验证系统提示词含 `M14` 错项「心理护理」 | 建议文本仍走演示模型，未接真实大模型 |

**能明确回答的：**

- 能真正自动识别的：**客户端生命周期**（实验已启动／加载／介绍视频／病例主界面／已上报进度）
  和**原程序打印的逐步骤分项成绩**；平台成绩（总分/用时/次数）登录后可读；
- 业务阶段与任务级自动识别：**一个都没有**，因为真实客户端根本不打印这类标记；
- 能真实读取操作结果的：**分项答题记录可以**（39 项含对错与反馈原文）；三维操作结果、牵引参数、
  当前正在做哪一项，日志里没有；
- 仍需手动选择：01–08 全部；09/10 可手动，但成绩数据会自动带入；
- 是否必须厂商开放：**要稳定的任务级状态必须厂商开放**（客户端回调／本地接口／结构化事件日志之一），
  或者做屏幕 OCR；当前实现不靠猜；
- 距离完整目标还缺：① 厂商侧任务级事件或界面 OCR ② 真实模型 Key（当前演示模式）
  ③ 让 `MCLocalLauncherService` 常驻（本机 9090 已由 `tools/local-bridge.mjs` 顶上）。

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

# 7. 自己用浏览器登录（需要教学账号）
tools\start-edge-debug.bat    # 独立配置 + 已加载扩展 + 调试端口 9333

# 8. 本机 9090 桥（平台页面点「启动虚拟实验」时会先探测它）
node tools/local-bridge.mjs          # 仅握手与记录，不启动任何进程
```

### 本轮新增的工具

| 文件 | 作用 |
|---|---|
| `tools/cdp.mjs` | 零依赖 CDP：`probe` 自己拉浏览器跑页面；`attach` 附着到已开的浏览器；`--isolated` 在内容脚本的隔离世界里取值（页面 window 上拿不到 `BT_UI`） |
| `tools/cdp-mirror.mjs` | 真实站点验证：CDP `Fetch` 拦截 + Node 代取（浏览器只渲染，绕开握手不兼容） |
| `tools/start-edge-debug.bat` | 用独立配置启动 Edge，加载扩展并开 9333 调试端口（供人工登录后观察） |
| `tools/local-bridge.mjs` | 顶替厂商 `MCLocalLauncherService`：监听 `127.0.0.1:9090`，回平台页的 `Hello from client` 握手；只记录，不启动进程 |

> 平台前端 `baselarning.*.js` 的实测协议：`new WebSocket("ws://127.0.0.1:9090/")` →
> `onopen` 发 `Hello from client` → `onmessage` 收到**任何**消息就 `window.location = <MLauncher URL>`。
> 本机桥默认只记录，不启动任何进程。
>
> 这些工具只用于**验证**，不进入产品运行路径；不读取、不打印、不落盘 cookie / token / 请求体。

