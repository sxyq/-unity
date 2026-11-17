# 骨牵引护理虚拟仿真独立 Unity 工程

2026-11-17 后续路线已改为 `../godot-rebuild/` 的 Godot + Blender。当前目录保留已有源码作为迁移资料；Unity 工具已经移到外置 APFS 卷 `/Volumes/HospitalTools/Applications/Unity/6000.0.85f2/Unity.app`，本机 `/Applications` 不再安装 Unity 或 Hub。以下为此前 Unity 源码阶段记录。

Unity 6000.0.85f2；工程位置 `/Volumes/Lexar/Project/医院仿真/unity-rebuild`。

2026-11-17：课程与运行源码已实现，并通过 Unity 自带 Roslyn 编译器编译。Unity Editor 实际启动返回 `No valid Unity Editor license found`，尚待许可激活后导入、打包与实际运行。

最近源码编译（包含限速器）平均 CPU 29.04% 单核，编译进程峰值常驻内存 133 MiB，耗时 3.74 秒，输出见 `../work/logs/source-compile.log`。应用运行内存与帧率尚待实际应用测量。

| 部分 | 当前实现 |
| --- | --- |
| 三维场景 | 自主构造病房、病床、患者网格、患肢、护理车、牵引针、绳索、滑轮、砝码；环视、缩放、漫游、选中、操作动画 |
| 四个模块 | 术前准备、操作方法及原理、术后病情观察、知识点学习 |
| 任务与评分 | R01–R27、C01–C39；开始、操作、判断、时间、操作错误、作答历史、总分；术后项目按 1/2/3/7 天分别记录后平均 |
| 十场景助教 | 复用既有病例和角色提示词，按任务自动关联，可按模块手动选择；流式返回、取消、日期隔离和考核保护 |
| 学习反馈 | 正确/错误/未完成分列，关联知识，复习任务排序，复习前后变化，报告导出 |
| 模型接入 | 内置 Node 网关，支持 Responses/Chat Completions；应用内模型设置，凭据存本机应用数据目录 |
| 资源用量 | 45 FPS 目标，Node 堆 128 MiB；记录应用与网关常驻内存、帧率及峰值，运行预算 2 GB |

原程序证据与重建设计：

- 原始四模块、术后日期、患者病例、操作项目与心理护理入口来自已有 Windows 运行时和 UI 记录；完整出处在 `../reverse/静态分析交付.md` 与 `../source/docs/Unity逆向-业务流程.md`。
- 原 27 步的完整名称编号和 39 项逐项映射尚缺原始导出；R/C 编号、分值分配、题目、操作判定和逐日症状是独立课程设计。5 kg 与 0.20～0.35 m 是本课程情境参数。
- 新系统评分为 39 项等权，完成操作且答对才能得分；考核操作错误每次扣该项 10%，正确完成后最低保留该项 50%。学习模式可再次作答，历次选择均保存。
- 原 `Assembly-CSharp` 与 `data.unity3d` 为非标准格式；本工程的模型、材质与动画由源码生成。

源码入口：`HospitalSimulation.cs` 负责会话与操作；`Course.cs` 为任务和题目；`WardScene.cs` 为三维场景；`TrainingUI.cs` 为界面；`ClinicalAssistant.cs` 为流式对话；`NativeGateway.cs` 为本地网关；`RuntimeUsage.cs` 为实际资源用量；`BuildProduct.cs` 为两平台构建。

编辑器与 Windows Mono 支持已迁到 `/Volumes/HospitalTools/Applications/Unity/6000.0.85f2/Unity.app`，Unity Hub 4.0.1 在同一外置工具卷。Mac/Windows 的 Node 22.23.5 放在 `../work/gateway/`，Noto Sans CJK SC 字体授权在 `Assets/Resources/Fonts/OFL.txt`。

激活 Unity 许可后，从项目根目录依次执行（每次只运行一个）：

```sh
python3 source/tools/limit-build.py /Volumes/HospitalTools/Applications/Unity/6000.0.85f2/Unity.app/Contents/MacOS/Unity -batchmode -nographics -quit -job-worker-count 1 -projectPath "$PWD/unity-rebuild" -executeMethod TractionCare.Editor.BuildProduct.Mac -logFile "$PWD/work/logs/unity-mac.log"
python3 source/tools/limit-build.py /Volumes/HospitalTools/Applications/Unity/6000.0.85f2/Unity.app/Contents/MacOS/Unity -batchmode -nographics -quit -job-worker-count 1 -projectPath "$PWD/unity-rebuild" -executeMethod TractionCare.Editor.BuildProduct.Windows -logFile "$PWD/work/logs/unity-windows.log"
```

构建目标：`../builds/macOS/TractionCare.app` 与 `../builds/Windows/TractionCare.exe`。构建函数会生成初始场景、保留所需着色器、复制已有网关和对应平台 Node；Mac 应用完成本机签名。

待完成：Unity 许可激活、实际导入与两平台打包、真实应用完整流程与资源用量、真实模型对话、Windows 实机运行。当前没有可用模型凭据或 Windows 运行入口。

静态源码编译使用 Unity 发行版自带 `NetCoreRuntime/dotnet`、`DotNetSdkRoslyn/csc.dll` 和同版本引擎/UI 引用程序集，未执行原厂 Windows 程序。模型网关已经启动成功，`/api/health` 返回 `ok:true, hasKey:false`；在线对话待填写本地模型配置后验证。

原静态分析结论继续沿用；项目级 REA/Craft Anything 位于 `../source/.agents/skills/`，MCP 配置位于 `../source/.codex/config.toml`，直接使用既有 CLI。
