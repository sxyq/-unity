# Unity 本地测试副本：原生场景状态输出与十场景联动

2026-11-15 Windows 实机。本文是 `docs/Windows实测记录.md` 的续篇，不重复 MSI / 网页接口分析。

## 1. 两个 Skill 已安装并实际使用

| Skill | 来源 | 配置 | 本轮实际产出 |
|---|---|---|---|
| **REA（Reverse Engineer Anything）** | SkillHub `reverse-engineer-anything`，`rea setup --client workbuddy --yes` 更新到内置 v62 | `rea-agents@6.9.0` 全局安装到 `C:\Tools\node24`（Node **v24.22.3**，因 6.9.0 要求 `^22.23.4 \|\| ^24.22.1 \|\| >=26.12.1`，本机原 Node 22.22.2 不满足）；MCP 注册进 `~/.workbuddy/mcp.json` | `rea inspect-managed-artifact` 对加密的 `Assembly-CSharp.dll` 返回 `unsupported_target / unsupported binary format`；`inspect-managed-members` 对 `MengooPlatform.dll` 产出 1.15 MB 成员证据，含 `/api/open/ProcessUpload`、`SaveExperimentResult` 等端点 |
| **Craft Anything** | SkillHub `houyer-craft-anything-2026`（上游 `github.com/storytold/craft-anything` v0.6.1） | Windows x64 portable zip → `C:\Tools\craft-anything-0.6.1-windows-x64-portable\craft-anything-cli.exe`；`setup --client workbuddy --yes` 注册 MCP | `craft-anything-cli --deep game-unity-list` 明确判定 `data.unity3d` 不是标准 Unity 序列化文件（与手工检查的文件头一致）；`commands` 列出 323 个工具，含 `game_unity_*` / `managed_*` |

两个 MCP 均写入 `~/.workbuddy/mcp.json`（原有 `siemens-nx`、`cua_repl` 保留，生成 `.rea.backup` / `.craft-anything.backup`）。
**按 WorkBuddy 规则，新 MCP 需要在连接器管理页点「信任」并重启会话后才会作为工具出现**；本轮分析全部通过两者自带的 CLI 完成，不虚构 MCP 工具调用。

## 2. 运行时类型与可修改程度（实证）

| 项 | 结论 |
|---|---|
| Unity | 2021.3.6f1，**Mono**（`MonoBleedingEdge/`，无 `GameAssembly.dll` / `il2cpp_data` / `global-metadata.dat`） |
| 业务程序集 | `Assembly-CSharp.dll`（665 KB）、`Assembly-CSharp-firstpass.dll`（58 KB）**被厂商加密**：固定魔数 `2f306b35`、非 PE、无 `BSJB`；磁盘上不可静态反编译。REA 也判定 `unsupported binary format` |
| 其余 155 个 DLL | 正常 PE/CLI，可静态分析（`MengooPlatform.dll`、`QFramework.Log.dll` 等） |
| `data.unity3d` | 293 MB，厂商自定义打包，Craft Anything 判定非标准 Unity bundle |
| 完整性校验 | `ScriptingAssemblies.json`（names/types）、`RuntimeInitializeOnLoads.json` 均为明文 JSON；`Patch.json` 是下载清单，运行时未发现签名/哈希校验 |

**关键判断**：磁盘加密只防静态分析；**运行时内存里是普通 .NET 类型**。实测 `AppDomain` 中 `Assembly-CSharp` 可反射出 **488 个类型**。
因此选择「**不改任何厂商 DLL，新增一个只读 observer 程序集**」的路径，避免解密、重打包、破坏完整性。

## 3. 实际修改/新增的文件

仓库里只放源码与脚本，**不含任何厂商二进制或资源**：

| 文件 | 作用 |
|---|---|
| `tools/unity-observer/` | `GqyStateObserver.dll` 源码（`GqyObserver.cs` + csproj，netstandard2.0，仅引用 `UnityEngine.CoreModule.dll`） |
| `tools/deploy-unity-observer.mjs` | 一键部署：复制实验包到独立测试目录 → 编译 → 注册两个 JSON → 打印命令 |
| `tools/unity-probe/` | REA 之外的补充：Mono.Cecil 只读程序集元数据查看器（本机正常 PE 用） |
| `tools/fetch-launch-url.mjs` | 从已登录学习页抓 `Experiment/Launch` 的票据 URL，只写本机临时文件，不打印票据 |
| `client-agent/agent.mjs` | 新增 `parseUnityEvent` / `mapUnityEvent`，解析 `GQY_STATE:`，输出 `contextSource:'unity-event'` 与 `unity` 原始字段 |
| `apps/extension/src/ui/panel.js` | 新增 `unity-event` 来源标签；Unity 高可信事件优先于页面 DOM 推断，驱动自动切换 |

**测试副本内**（`C:\Temp\gqy-unity-test\HLF10631030`，原始安装目录 `C:\Program Files (x86)\Mengoo\MCLocalLauncher\HLF10631030` 未改动）：
`_Data/Managed/GqyStateObserver.dll`、`_Data/ScriptingAssemblies.json`（+1 项）、`_Data/RuntimeInitializeOnLoads.json`（+5 条）。

> 踩坑记录：新增程序集的 `[RuntimeInitializeOnLoadMethod]` **不会**自动执行——Unity 把初始化方法固化在 `RuntimeInitializeOnLoads.json`。
> 且早期阶段创建的 MonoBehaviour 会被清理，最终改用 Unity 主线程 `SynchronizationContext` + Timer 采样。

## 4. 真实业务状态（反射实证）

`%TEMP%\gqy-runtime-dump.txt`（2808 行）与 `GQY_STATE` 事件给出：

| 原程序类型 | 真实字段 | 用途 |
|---|---|---|
| `Nurse.Logic.GameManager` | `currentSenceState`（`SenceState` 枚举 11 值：`MainSence01/02`、`ChildSence01..040103`）、`isStudyModel`、`isFirstDay`、`isFirstProgress`、`isGetProgressSuccess`、`openPanelList` | 场景状态 / 学习或考核模式 / 第一天 |
| `Nurse.Logic.UITaskOptPanel` | `dayTime`（术后第 N 天）、`uITaskOpts / uITaskOpts02 / 03 / 07`（第 1/2/3/7 天任务表） | 术后日期与每日任务 |
| `Nurse.Logic.UISkeletaTractionOptPanel` | `weightValue`（牵引重量） | 真实操作参数 |
| `Nurse.Logic.ScoreMgr` | `ScoreDatas`（39 项）、`TypeScores`（4 类：基础理论/技能操作/完成效率/综合应用）、`TotalScore` | 分项成绩 |
| `Nurse.Logic.UISelectPanel` | `m_currnetSenceState`、按钮组 | 教学模块选择 |
| `Nurse.QUIManager` / `QUIPanelStack` | `mAllUI` / `mAllStack` | 当前打开的 UI 面板 |
| 业务面板 | `UIHistoryTakingPanel`（病史采集）、`UICasePanel`、`UISkeletaTractionOptPanel`、`UITaskOptPanel` | 任务级识别依据 |

### 4.1 厂商平台层的数据模型（Craft Anything + ILSpy 反编译实证）

`managed-ilspy-decompile` 反编译 `MengooPlatform.dll`（需 `dotnet tool install -g ilspycmd --version 9.1.0.7988`，新版包要求更高 SDK）：

- `MengooCx` 暴露**原程序自己的步骤事件钩子**：`StartStepHook` / `EndStepHook`（`Action<int>`）、
  `AddTaskQuestionHook`、`DataUploadHook` —— 证明内部存在清晰的步骤事件模型（Invoke 在加密的
  Assembly-CSharp 内，因此 observer 选择轮询状态而不是订阅钩子，避免干扰原流程）。
- **`ExperimentTask { No, Name }` 就是 27 个计分步骤的真实名称与序号**，挂在
  `MengooCx.uploadData.ExperimentTaskList`；`iLabStep { seq, title, done, score, timeUsed }`
  是步骤执行状态（`MengooCx.iLabSteps`）。
- 其余：`pass`（模式）、`progressData { maxPv, pv, data }` + `hasProgress`、`tokenid/ProgressId/ExperimentId`
  由 `MLauncher://` 参数第 13/14/15/18 段填充（`ConvertEnvironmentParam` 实证）。
- observer 据此新增输出 `taskList`（`[No:Name,…]`）、`iLabSteps`（`[seq|title|done|score|timeUsed,…]`）、
  `mengooPass`、`uploadScore`、`hasProgress` —— **原任务 ID → 智能场景 ID 的映射从此有了真实主数据**，
  不再依赖文字匹配猜测。此输出的真实验证待下一次实验会话。

**主界面实测事件**（测试副本真实运行，`scene=NurseMain`）：

```json
GQY_STATE:{"scene":"NurseMain","panels":["…/UISelectPanel", "…/UIFunctionPanel", "startPanel", "…/TipPanel"],
"uiTexts":["是","否","是否读取进度","考核模式","学习模式","请根据以下教学模块依次学习：",…],
"selectSenceState":"MainSence01","senceState":"ChildSence01","isStudyModel":"true",
"isFirstDay":"true","isGetProgressSuccess":"true","typeScores":"count=4 keys=[基础理论,技能操作,完成效率,综合应用]"…}
```

## 5. 接入结果与十场景映射

`client-agent` 的映射**只依据原程序真实类型名与当前选中任务文本**，不用章节名、不用日志正则、不用常识推断：

| 依据 | 映射到 |
|---|---|
| `UIHistoryTakingPanel` | `preop-history` 病史采集与症状问诊 |
| `UISkeletaTractionOptPanel`（含 `weightValue`） | `intraop-principle` 牵引原理 |
| `UITaskOptPanel` + `dayTime` | 仅给 `phase=postop` + `postopDay`，任务仍需选中项 |
| `selectedTasks`（Toggle.isOn 的真实文本） | 按 8 条任务词规则映射到 01–08；**任务列表里列着但没选中的不算** |
| `09 / 10` | 继续用 `ScoreDatas` 39 项真实分项（含 `M14` 未点击心理护理） |

`GET /state` 实测输出：`contextSource:"unity-event"`、`unity.scene=NurseMain`、
`unity.senceState=ChildSence01`、`unity.panels=[…UISelectPanel]`、`confidence:"low"`（只有主界面，没有具体任务面板，因此**不伪造阶段/任务**）。

**明确区分验证等级**：
- ✅ 真实实验：observer 加载、`GQY_STATE` 连续输出、真实字段进入 `/state`；
- ✅ 代码单元验证：向面板注入一条 `unity-event` 高可信状态，标题变为「智能护理导学」、副标题「牵引原理」、提示「Unity 原生事件 · 高可信」、下拉选中 `intraop-principle`；
- ✅ **2026-11-15 二次实测（真机鼠标驱动）**：进入病房场景并点开「1.入院记录」任务（见下节）；
- ❌ 未验证：02–08 各任务面板的自动切换（考核锁按设计拦截未完成任务，见下节）。**不把单元验证冒充真实十场景实测**。

## 5.5 2026-11-15 真机实测：真实客户端的任务级状态（新增）

本节是**真机鼠标驱动**（Windows 桌面自动化逐键点击）在独立测试副本里跑出来的实测记录。

### 启动链路的四个坑（全部修复并有复现脚本）

| 坑 | 症状 | 修复 |
|---|---|---|
| URL scheme 大小写 | 游戏静默退出在 QUIPanelStack init（无 userInfovalue/GetToken 行） | 保留平台原始 `MLauncher://`（实测成功日志为**大写**，游戏端区分大小写）`tools/mint-and-launch.mjs` |
| 异步 taskkill 竞态 | 残留进程清理迟到，把刚启动的新实例按镜像名杀掉 | `spawnSync` 同步清场后再启动 |
| 9090 桥回复触发协议跳转 | 页面 `window.location=MLauncher://` 拉起原版启动器，抢票据/杀副本 | `local-bridge.mjs --silent`（只记录不回复不断连） |
| 工具调用结束回收进程树 | 游戏/浏览器随 Bash/PowerShell 调用结束被连带杀死 | 长驻后台任务（`run_in_background` + sleep 保活） |

取票→启动（秒级衔接）：`node tools/fetch-launch-url.mjs 9336` → `node tools/mint-and-launch.mjs`。

### 真实 UI 流程（从「否-重新开始」到病房）

`是否读取进度`（否 1075,935 / 是 1510,935）→ `实验目的`（确定 2310,1280）→
介绍视频（UIVideoPlayPanel，约 5 分钟，右上 ↺返回/✕退出/⋯）→ 导学 5 页（底部圆点+我已知道 2240,1325）→
病房 3D 场景 + 三个任务热点：**1.入院记录** (505,640)、**2.术前准备** (1115,575)、**3.术前谈话** (1250,245)。

### 任务级数据实测（observer 抓到的真实值）

| 操作 | selectedTasks | panels |
|---|---|---|
| 点热点「1.入院记录」 | `["入院记录"]` | `RecordPanel,ButtonPanel,UISampleBingLiPanel` |
| 点病历页签「辅助检查」 | `["辅助检查"]` | 同上（页签内容：左侧股骨CT、血常规） |
| 点病历页签「专科检查」 | `["专科检查"]` | 同上（视诊/触诊/动诊/腿围测量） |

即：**observer 的 `selectedTasks` 随任务/页签点击实时变化**，agent 已按真实任务名补齐
映射（`入院记录/辅助检查/专科检查→preop-history`、`术前谈话→preop-talk`、`术前准备→preop` 阶段），
`UISampleBingLiPanel` 面板规则同步补齐。

**端到端自动切换验证（01 场景，真机完成）**：点热点「1.入院记录」→
`/state` 返回 `scenarioId:"preop-history"`、`taskName:"病史采集与症状问诊"`、
`confidence:"high"`、`contextSource:"unity-event"`、evidence「当前选中任务：入院记录」→
面板 demo 页自动切到 **「智能病史问诊」**（下拉选中 01，提示行「Unity 原生事件 · 高可信」，
患者角色王道阔开场「您好，我是 3 床王国强…」+ 问诊快捷问题就绪）。
此前所有会话缺失的「学生点进任务后面板自动切换」验证项，本轮以真实数据闭环完成。

### 考核锁实测（按设计工作，不绕过）

点击「退出病历」弹出：**「提示：有考核点未做完，请完成后退出。」**（单「确定」按钮，仅确认不放行）。
看完全部页签仍拦截 → 游戏**按设计禁止跳过未完成的任务**（考核保护），02–08 的面板实测
必须按游戏流程先完成当前任务考核点。本轮实测止步于此，未绕过、未修改计分逻辑。

因此 01–08 仍是「映射已接通、需进入具体面板才能触发」，不能宣称全部已自动识别。

## 6. AI UI 是否嵌进 Unity 3D 窗口

**结果 B：没有嵌入 Unity 原生 UI。**
理由（有事实依据，不是"逆向复杂"）：业务 UI 预制体全部封装在厂商自定义打包的 293 MB `data.unity3d` 里（Craft Anything 已判定非标准 bundle），
`Assembly-CSharp.dll` 加密，缺少可安全修改的 UI 源码/场景资产；强行改 bundle 会破坏资源引用与完整性校验。
保留已经实跑的 WinForms+WebView2 悬浮窗「骨牵引智能交互 · 外部组件」，它现在通过 `unity-event` 自动跟随状态（同一 `panel.js` 代码路径）。

## 7. 原实验与成绩是否保持原样

- 原始安装目录零改动；所有注入只在 `C:\Temp\gqy-unity-test` 副本。
- observer 只读 `Debug.Log` / 反射，不改任何业务方法、不写回平台、不改 27 个计分步骤与 `ScoreDatas`。
- 平台真实分项 39 项 / 98 分读取链路保持可用（本轮测试副本新会话的 `scoreDatas` 是初始 12 条，历史 39 项来自原实验进度回包）。
- 票据只在内存 / 本机临时文件，未写入仓库、日志或截图。

## 8. 真实 Chat Completions 模型

**仍是演示模式**：`/api/health` 返回 `{"mode":"mock","hasKey":false}`，没有配置 Key，未声称接通真实模型。

## 9. 复现命令

```powershell
# 0) Skill 运行时（一次性）
#    Node v24.22.3 -> C:\Tools\node24；npm i -g rea-agents@6.9.0
#    Craft portable  -> C:\Tools\craft-anything-0.6.1-windows-x64-portable
rea doctor --client workbuddy --json
craft-anything-cli --deep game-unity-list --path "<...>_Data\data.unity3d"

# 1) 部署 observer 到独立测试副本（不碰原安装）
cd C:\Projects\gouqianyin-ai
node tools/deploy-unity-observer.mjs

# 2) 起服务
node apps/model-gateway/server.mjs
node client-agent/agent.mjs
node tools/local-bridge.mjs
.\client-agent\overlay\bin\Release\net8.0-windows\GouQianYinOverlay.exe

# 3) 已登录的平台学习页取票据，启动测试副本
node tools/fetch-launch-url.mjs 9336     # 写 C:\Temp\mlaunch-url.txt
#   把 URL 第 16/18 段按实验本体顺序交换后作为 HLF10631030.exe 的启动参数

# 4) 看状态
curl http://127.0.0.1:8790/state
type "%TEMP%\gqy-runtime-dump.txt"
findstr GQY_STATE "%USERPROFILE%\AppData\LocalLow\Mengoo\HLF10631030\Player.log"
```

> MCP 注册后需在 WorkBuddy 连接器管理页「信任」`rea` 与 `craft-anything` 并重启会话，工具才会出现在会话内；
> 不重启也能用上表的 CLI 完成同类分析。

---

## 6. 2026-11-15 真机补充实测（病例事实 / 术前谈话 / 术后任务 / 答题测试 / 成绩）

### 6.1 真实病例事实（以原实验电子病历为准）

原实验「1.入院记录 → 电子病历」面板里的患者与代码早期假设完全不同，已按实测改正
（`apps/extension/src/data/case-data.js`）：

| 项目 | 原实验真实值 |
|---|---|
| 姓名 / 性别 / 年龄 | 李波 / 男 / 33 岁 |
| 床号 / 入院 | 2 床，2020-08-18 经急诊入院 |
| 诊断 | 左侧股骨中下段骨折（断端错位，远端向后向上移位） |
| 主诉 | 外伤致全身多处损伤 6 小时 |
| 现病史 | 乘坐降落伞降落时与围墙相撞致左侧大腿肿胀疼痛；120 送入；CT 后以「左侧股骨中段骨折」收入院 |
| 既往史 | 慢性胃炎 10+ 年；否认高血压/糖尿病/冠心病/传染病；**否认食物、药物过敏史**；否认手术外伤史、输血史 |
| 个人史 | 吸烟 15 年每日约 20 支；饮酒 15 年每日约 500ml 啤酒 |
| 专科检查 | 左大腿外旋、膝屈曲肿胀畸形；骨擦感/骨擦音；轴向叩击痛(+); 足背动脉可扪及；左下肢短缩约 2cm；肢端血运良好 |
| 辅助检查 | 左股骨干中下段骨折、断端错位；WBC 14.03×10⁹/L↑、中性粒 83.6%↑ |

患者信息面板（模块 3 开场）另有：T 36.6℃、P 78、R 21、BP 120/72；职业公司职员；未婚；
社会心理「受伤在异地治疗，常感担忧、焦虑，希望早日返回家乡」；护理级别一级护理。

> 早期代码里的「王建国 / 38 岁 / 3 床 / 右股骨干 / 磺胺过敏」全部是虚构，已删除。
> 病历未记录身高体重，牵引重量必须按医嘱，模型不得声称「本例 70kg」。

### 6.2 场景 02「术前谈话」的真实触发证据

点病房热点「3.术前谈话」后 **`selectedTasks` 为空**（这一点和「1.入院记录」不同），
但会连续出现两级真实状态：

```text
点击热点 3.术前谈话
  → panels += UIDialoogConentPanel（护患对白，含「跳过」）
  → 跳过后 panels += UIFirstSenceOptPanel，动作栏出现「同意书」
  → uiTexts 含「同意书」「完成返回」
```

因此 02 的判定规则是「对白面板 + 同意书 + ChildSence01」，写在
`client-agent/agent.mjs` 的 `mapUnityEvent` 里；实测 `/state` 返回
`scenarioId=preop-talk`、`confidence=high`、`functionName=智能情境化护患交流`。

### 6.3 术后模块的真实结构（场景 07/08 与术后日期）

模块 3「骨牵引术后的病情观察」进入后：

- `UITaskOptPanel` 提供任务栏：**第一天 / 第二天 / 第三天 / 第七天**；
- observer 输出 `dayTime`（1/2/3/7）——这是**真实术后日期字段**，不是 UI 标签猜测；
- 每一天有自己的任务清单：
  - 第一天任务：牵引有效性、疼痛、患肢神经损伤、患肢肢端血供、下肢深静脉血栓、
    创口出血、牵引针道、压力性损伤、肺部感染、排泄；
- 点任一条 → `UIThirdSenceOptPanel`（视诊/触诊/动诊/听诊 + 完成返回），
  同时 observer 新增输出 `sence3Day`、`sence3Order`；
- `UITaskOptPanel.currentTarget` 指向当前选中按钮，observer 新增 `taskCurrent` /
  `taskCurrentText`（其子 Text 就是任务名）。

任务项到场景的映射（`POSTOP_ITEM_RULES`）：

| 任务项 | scenarioId |
|---|---|
| 疼痛、牵引有效性、排泄 | postop-care（07 术后护理指导） |
| 下肢深静脉血栓、创口出血、肺部感染、患肢神经损伤、患肢肢端血供、牵引针道、压力性损伤 | postop-complication（08 并发症观察） |
| 含「心理/情绪/焦虑/睡眠」的项 | postop-psych（06 术后心理护理） |

### 6.4 原系统「答题测试」= 真正的考核点（必须保护）

点「完成返回」不是结束，而是进入 `UISelectionExamPanel`：

```text
答题测试 01/01
患者是否存在左下肢肢端血供问题？  A 是  B 否   [提交]
```

- 提交后弹 `errorPanel`/`TipPanel`：「很遗憾！操作失败」+「再次操作」，
  或「恭喜你！操作成功。」+「确定」；
- 实测第一天「患肢肢端血供」正确答案是**「是」**（患者确实存在血供问题），
  选「否」判错——说明术后病情并非「一切正常」，模型不得替学生假定正常；
- agent 已把 `UISelectionExamPanel` 判为 `mode=exam`，提示词进入考核保护，
  **不直接给答案**。

### 6.5 成绩数据的真实来源：原程序自己打印的 ScoreDatas

`Player.log` 里有一条完整成绩 JSON（`"data": "{...ScoreDatas...}"`），字段：

```json
{"SN":"M1_01","scoreType":null,"score":0.0,"time":0.0,
 "feedbackInfo":"…选择错误，正确的答案是ABDE。",
 "section":"骨牵引的操作前准备","isRight":false}
```

- 共 **39 条**分项，按 `section` 分为四大模块；
- agent 已解析为 `/state.scoreDetails`：`items[39]`、`totalItems`、`rightItems`、
  `totalScore`、`bySection`、`wrongItems`；
- 这是场景 09/10 的唯一真实数据源，且包含正确答案解释——
  **只能在报告阶段使用，考核/操作阶段不得下发给学生**。

### 6.6 场景 01 的考核锁（准确阻塞描述）

「1.入院记录」打开病历后，点「退出病历」必弹
「有考核点未做完，请完成后退出。」，看完三个页签（入院记录/辅助检查/专科检查）
仍然拦截。原因是该任务的考核点是**答题测试**，而病历面板本身不提供答题入口；
必须完成对应答题才放行。**没有绕过**（未改 ScoreDatas、未伪造完成事件），
改用顶部「返回」回到教学模块列表继续调查其他模块——这是原程序允许的正常导航。

### 6.7 报告阶段

原程序结束时打开 `UIComprehensivePerformanceRecordPanel`（综合表现记录）。
agent 已把它映射为 `phase=report`、`scenarioId=report-score`；
场景 10 目前由学生在面板下拉切换（同一份成绩，不同提示策略），
**不声称是 Unity 自动识别**。

### 6.8 模块 2 真实任务与识别结果（2026-11-15 实测）

模块 2「骨牵引的操作方法及原理」的病房里是四个热点，不是原先假设的「牵引原理」一个：

| 热点 | 打开的真实面板 | 面板内文字 | scenarioId | 实测置信度 |
|---|---|---|---|---|
| 1.医患沟通 | `UIDialoogConentPanel` | 「2床李先生，您好，我是您…」+ 跳过 | intraop-communicate | high |
| 2.体格检查 | `UISecondSenceOptPanel` | 视诊/触诊/动诊/量诊 | intraop-observe | high |
| 3.辅助检查 | `RecordPanel`+`UISampleBingLiPanel` | 电子病历（记录日期 2020-08-19） | 只报 intraop，不认领任务 | medium |
| 4.手术治疗 | `UISecondSenceOptPanel`+`OptPanel` | 1.确认穿刺部位 2.打开穿刺包 3.戴无菌手套 4.消毒 5.铺巾 6.麻醉 7.穿刺 8.调节肢体高度 9.牵引 | intraop-principle | high |

要点：

- 体格检查与手术治疗**共用同一个底部动作条面板**，只能靠动作条文字区分（量诊 vs 穿刺/铺巾/消毒）；
- 模块 2 的「3.辅助检查」会打开和场景 01 一模一样的电子病历面板，
  此时 `selectedTasks` 会写成 `["入院记录"]`——**这是病历页签，不是场景 01 的任务**，
  已按 `senceState` 分域，避免误判；
- `panels` 列表里的面板关闭后仍留在列表（`UIDialoogConentPanel` 实测），
  observer 已加 `CanvasGroup.alpha > 0.01` 过滤；即便如此，判断仍以「面板内文字」为准。

### 6.9 尚未验证的部分（不得当成已完成）

| 场景 | 现状 | 缺什么 |
|---|---|---|
| 06 术后心理护理 | 任务栏第一天清单里没有心理项；规则已写（含心理/情绪/焦虑/睡眠） | 需要术后第 2/3/7 天里出现心理任务时的真实点击 |
| 07 术后护理指导 | 规则按真实任务项（疼痛/牵引有效性/排泄…）编写 | `taskCurrentText` 尚未在真实点击中取到值 |
| 08 并发症观察 | 同上（血栓/出血/感染/神经/血供…）+ 已实测第 1 天肢端血供答题 | 同上 |
| 09/10 成绩与复习 | 39 条 ScoreDatas 已解析进 `/state.scoreDetails`；`UIComprehensivePerformanceRecordPanel` 已映射 | 需要一次完整做完实验后验证报告阶段自动切换 |
| 全部场景真实模型 | 网关仍是 mock（无 Key） | 用户提供 OpenAI-compatible Key 后逐一联调 |

---

## 7. 真实大模型接入（Responses 协议）

### 7.1 协议差异（GPT-5/6 系必须用 Responses）

网关新增 `protocol` 字段：

| protocol | 路径 | 请求体 | 流式事件 |
|---|---|---|---|
| `chat`（旧） | `/chat/completions` | `messages: [{role:'system'},…]` | `choices[0].delta.content` |
| `responses`（现用） | `/responses` | `instructions` + `input:[{role,content}]` + `max_output_tokens` | `response.output_text.delta` 的 `delta` |

实现要点（`apps/model-gateway/server.mjs`）：

- system 必须放 `instructions`，不能塞进 input；
- 该网关默认会注入一段 Codex 的 instructions，**必须显式覆盖**，否则模型会以为自己在写代码；
- 非流式从 `output[].content[].text` 拼接，兼容 `output_text`；
- 温度等参数该网关会忽略（回显 1.0），不影响业务。

### 7.2 本地配置（不入库）

`apps/model-gateway/config.json` 已在 `.gitignore`：

```json
{
  "mode": "live",
  "protocol": "responses",
  "baseUrl": "https://fast.qianxing.pro/v1",
  "responsesPath": "/responses",
  "model": "gpt-5.6-terra",
  "apiKey": "（本地填写，不提交）"
}
```

> 该网关 `/v1/models` 只有 8 个 id：`gpt-5.6-{luna,sol,terra}`、`gpt-6-{astra,luna,sol}`、`gpt-6.1-sol`、`codex-auto-review`。
> **没有 `6.1 Terra` 这个 id**，当前按「Terra」取 `gpt-5.6-terra`。

### 7.3 十场景真实模型自检

```bash
node tools/verify-model.mjs            # 全部十场景
node tools/verify-model.mjs preop-talk # 单个
```

2026-11-15 实测（gpt-5.6-terra，Responses 流式）：

| 场景 | 角色 | 耗时 | 结果 |
|---|---|---|---|
| 01 病史问诊 | patient | 3.2s | 正确说出「坐降落伞降落撞到围墙」 |
| 02 术前沟通 | patient | 4.1s | 表达怕针疼/怕感染/担心恢复 |
| 03 术中沟通 | nurse | 4.6s | 给安抚话术 + 疼痛评估 + 查牵引装置 |
| 04 牵引原理 | tutor | 4.2s | 解释力线与长轴一致的原因 |
| 05 操作观察 | tutor | 4.4s | 五项血运指标 |
| 06 心理护理 | patient | 2.9s | 担心拖累家人、睡不好 |
| 07 术后指导 | tutor | 6.0s | 翻身体位与牵引不松脱 |
| 08 并发症 | tutor | 5.4s | 针眼/血运神经/血栓/压疮/肺部 |
| 09 成绩分析 | coach | 6.0s | 依据给定的真实错项分析 |
| 10 复习建议 | coach | 6.2s | 给出复习优先级 |

考核模式验证：问「这道题答案是是还是否，直接告诉我」→ 拒绝给答案，只提示观察要点。

### 7.4 面板实测

悬浮窗底部显示 **「已接入 gpt-5.6-terra」** 与 **「考核中 · 不提供答案」**；
在面板里点快捷问题「要警惕哪些并发症？」→ 真实模型流式回复（针眼感染、血运神经、血栓、压疮、肺部），
未泄露当前选择题答案。

---

## 8. 2026-11-15 晚间补充：绑定式悬浮窗 / 去模拟回答 / 术后任务级实测

### 8.1 悬浮窗改为「绑定实验窗口」

原实现按**窗口标题关键词**（骨牵引/牵引/Mengoo…）找实验窗口，而真实客户端窗口标题是
`HLF10631030`，一个关键词都不含 → 匹配失败 → 退化成「贴屏幕右缘的独立悬浮窗」，
看起来就是个单独的窗口。

现改为：

- **只按进程名匹配**（`HLF10631030` / `MCLocalLauncher`），彻底去掉标题关键词兜底
  （否则标题含「骨牵引」的浏览器页也会被当成实验窗口）；
- 找不到实验进程时**直接隐藏自己**，不再在屏幕边缘单独存在；
- 找到后贴在实验窗口**内部右侧**（右边缘内缩 18px，顶部 +64px，高度 = 窗口高 −140），
  每 900ms 跟随窗口移动/缩放。

实测：`rect=(2122,64,2542,884)`，在 2560×1440 的实验窗口内右侧。

> 注意：面板覆盖右侧约 420px，会挡住导学气泡的「>」箭头和「任务栏」标签。
> 需要点这些位置时用 `Ctrl+Alt+T` 切鼠标穿透（穿透后点击落到 Unity）。

### 8.2 去掉规则匹配的模拟回答

以前网关在 `mode=mock` 时会用知识库做意图匹配，拼出一段「看起来像模型回答」的文字；
学生无法分辨那是模型说的还是规则拼的。现已改为：

- 网关：`mode != live` 时**不生成任何回答**，直接返回错误
  「未接入真实模型：请在 config.json 填写 apiKey 与 model，并把 mode 设为 live」；
- 面板：状态徽标改为「未接入模型 · 不会回答」，发送前直接拦截并提示，不再本地编答案。

### 8.3 模型切换为 gpt-6.1-sol

`apps/model-gateway/config.json`：`model = gpt-6.1-sol`（Responses 协议）。
实测 `/api/health` → `{"mode":"live","model":"gpt-6.1-sol"}`；病史问诊 4.3s 返回正确病例事实。

### 8.4 术后任务级识别实测结果

术后左栏任务（第一天）：牵引有效性 / 疼痛 / 患肢神经损伤 / 患肢肢端血供 /
下肢深静脉血栓 / 创口出血 / 牵引针道 / 压力性损伤 / 肺部感染 / 排泄。
右侧「任务栏」提供 **第一天 / 第二天 / 第三天 / 第七天**。

| 点击项 | 真实题干 | scenarioId | 置信度 |
|---|---|---|---|
| 下肢深静脉血栓 | 该患者术后预防深静脉血栓的最佳运动方式是 | postop-complication | high |
| 疼痛 | 患者是否存在疼痛的护理问题？ | postop-care | high |

- 疼痛题选「是」→「恭喜你！操作成功。」（患者确实存在疼痛护理问题）；
- 每题提交后会出现下一题（同一任务含多题），题干字段 `examQuestion` 随题变化。

### 8.5 场景 06 的真实入口（新发现，未打通）

在术后第一天点右侧「第三天」时被拦截，提示 **「心理护理未完成。」**
——证明**术后心理护理是原系统的真实任务**，且是切换天数的前置条件。
但第一天左栏清单里没有心理护理项，点病人面部/身体也未打开面板，
入口尚未定位（候选：`UIHuLiPanel` / `UIHealthGuidePanel`，由 3D 射线点击触发）。
**该场景暂不宣称自动识别完成。**

---

## 9. 窗口化运行（2026-11-15 深夜）

原实验以独占全屏启动（2560×1600），悬浮窗只能覆盖在场景上，挡住「提交」「任务栏」等按钮。

### 9.1 改成窗口模式

Unity 把显示设置写在注册表 `HKCU\Software\Mengoo\HLF10631030`：

| 值 | 含义 | 改为 |
|---|---|---|
| `Screenmanager Fullscreen mode_h3630240806` | 0=独占全屏 3=窗口 | **3** |
| `Screenmanager Resolution Use Native_h1405027254` | 是否用原生分辨率 | **0** |
| `Screenmanager Resolution Width_h182942802` | 宽 | **1600** |
| `Screenmanager Resolution Height_h2627697771` | 高 | **900** |

重启后游戏以窗口运行（实测窗口 1622×956，内部渲染 1600×900）。

### 9.2 悬浮窗改为贴窗口外侧

实验窗口化后，面板不再覆盖场景，改为贴在**窗口右侧外部**（`targetRect.Right + 16`），
屏幕放不下时才回退到窗口内部右下。实测面板 `(1091,0)-(1511,637)`，与游戏窗口并排。

### 9.3 新坑：窗口化后合成鼠标事件失效

- 系统 DPI = 144（150%），`SetCursorPos` 落点会被系统放大 1.5 倍
  → 已给点击脚本加 `SetProcessDPIAware()`，光标落点恢复准确；
- 但即便光标正确、命中窗口正确，`SendInput`（相对/绝对模式）都**不再被 Unity 接收**，
  全屏时同样的脚本可以点中。
- 已尝试：给 exe 加 `~ HIGHDPIAWARE` 兼容标记、先激活窗口再点、绝对坐标归一化——均无效。

**结论**：窗口化后目前只能靠代码调用（指令通道）推进流程，鼠标自动化仅在独占全屏下可用。
