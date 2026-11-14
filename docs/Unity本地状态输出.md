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
- ❌ 未验证：学生点进某个具体护理任务后面板的自动切换（本轮 Unity 会话在模块选择界面结束）。**不把单元验证冒充真实十场景实测**。

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
