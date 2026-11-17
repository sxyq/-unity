# 骨牵引护理仿真：Windows 接续

当前开发路线为 Godot 4.7.2 + Blender，默认1280×720小窗。Unity源码保留作为迁移依据。分支 `handoff/windows-2026-11-17` 保存本轮源码、模型、分析结果及两平台成品。

## 在 Windows 获取

安装 Git for Windows 与 Git LFS 后，在 PowerShell 执行。以下 `D:\Project` 为外置盘路径示例，按实际盘符替换。

```powershell
git lfs install
git clone --branch handoff/windows-2026-11-17 https://github.com/sxyq/-unity.git 'D:\Project\医院仿真'
Set-Location 'D:\Project\医院仿真'
git lfs pull
& '.\builds\Windows\TractionCare.exe'
```

`builds\Windows\Gateway` 须与EXE一起保留。安装文件和Node运行文件使用Git LFS；仅下载源码ZIP会缺少实际大文件。

## 工程与资料

| 路径 | 内容 |
|---|---|
| `godot-rebuild/project.godot` | 当前正式应用，在Godot 4.7.2中打开 |
| `godot-rebuild/scripts/`、`data/` | 四模块、护理操作、评分、助教、任务数据 |
| `work/models/Ward.blend` | 可编辑病房模型；GLB在 `godot-rebuild/assets/` |
| `unity-rebuild/` | 已完成的Unity源码，保留迁移依据 |
| `source/` | 原GitHub工程、Windows记录、只读observer、模型网关 |
| `reverse/静态分析交付.md`、`reverse/analysis/` | 原EXE/DLL静态结果、字段、方法、调用位置及Craft项目 |
| `reverse/input/experiment-Version.json` | 原实验1.0.7版本文件清单 |
| `.agents/skills/` | REA与Craft项目级Skill |
| `.codex/config.windows.toml` | Windows项目MCP配置模板 |
| `docs/任务目标.md` | 完整目标与后续用户要求 |
| `work/learning-state/` | Mac独立应用的学习记录导出，含当前记录指针 |

原Git工作树从 `source/` 上移到项目根目录，已有提交历史保留；原工程文件仍在 `source/`。

## 当前真实进度

- Mac已实际操作病历导航、穿刺包、手套及第1/2天血供判断；Windows产物已导出，实机运行待在Windows完成。
- 助教会话按实验、任务、场景、日期分别保存；真实模型需在应用“设置”中配置。配置保存在Windows成品旁的 `runtime/model-config.json`，不提交。
- 原第1天血供问题及“是/否”题目有Windows实测来源；其他日期仍是标明来源的自主教学情境。
- 完整原27步骤与39成绩对应、原病历完整页面及完成条件、原资源对象目录仍缺原Windows导出。R/C编号及当前多数评分规则为自主实现，完整1:1尚未完成。
- 最近构建CPU采样峰值为单核46.93%；Mac应用含网关内存采样48.7MiB。Windows性能尚待实测。

恢复导出的学习记录时，在首次打开应用前执行：

```powershell
New-Item -ItemType Directory -Force '.\builds\Windows\runtime' | Out-Null
Copy-Item '.\work\learning-state\*' '.\builds\Windows\runtime\' -Recurse -Force
```

## Windows继续顺序

1. 读取根目录 `AGENTS.md`、`godot-rebuild/README.md`、`reverse/静态分析交付.md` 和 `source/docs/Unity本地状态输出.md`。
2. 先复用原Windows上已有 `%TEMP%\gqy-runtime-dump.txt`、`%TEMP%\gqy-il\`，提取原27项 `No/Name`、39项 `SN`、`ScoreMgr.SendExamScore` 的调用实参。保持账号、密码、Cookie和ticket在仓库之外。
3. 先逐项对齐原版入口、任务、题目、完成条件与模型，再推进下一项。分析对象是本地 `HLF10631030.exe.mengoo`、`UnityPlayer.dll` 和 `HLF10631030_Data`。
4. 在本机正常配置模型服务，实际验证流式回答、任务和日期上下文；运行Windows成品完成实际交互与内存记录。

原安装包及实验二进制按原要求留在Mac本机，未进入此分支。官方MSI为 https://skeletaltraction.cqmu.edu.cn/MZL/MLauncherSetup.msi ，实验版本目录为 https://skeletaltraction.cqmu.edu.cn/mzl/HLF10631030/1.0.7/ 。分析目录保留原文件结构、大小与SHA256，便于在Windows对应已有文件。不要运行新取得的原厂EXE、使用Wine、改写或解密原文件。

## 工具与资源约束

所有工具、缓存和临时文件放项目所在外置盘。运行内存含子进程不超过2GB；编译进程树CPU总量不超过一个逻辑核心的80%，一次一个构建。`source/tools/limit-build.py` 使用macOS进程接口，Windows编译需采用本机适用的限速方式。

两个Skill保持项目级。REA 6.9.0使用Node 22.23.4及以上的22.x；Craft官方CLI需加入Windows PATH。准备好CLI后，从项目根目录使用 `.codex/config.windows.toml`，将其复制为 `.codex/config.toml`，并把Craft的 `--project` 改为本机该项目的绝对路径。不要运行会写全局配置的setup。

Windows成品运行数据写入 `builds/Windows/runtime/`。Mac编辑器、Hub、Godot、SDK、缓存及APFS工具映像属于本机工具环境，不随Git传输。

WJSGFMTHZ
