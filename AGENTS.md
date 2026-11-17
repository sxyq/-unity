# 医院仿真

当前正式开发路线为 Godot + Blender，按完整护理流程逐项实现。目标与实际进度见 `godot-rebuild/README.md`，复用 `source/` 原项目和 `reverse/` 已有证据。`unity-rebuild/` 保留已完成源码作为迁移依据。

当前优先逐项对照原版完成一个功能及对应模型；开发应用默认小窗，不自动进入全屏。主代理负责整合，独立的资料与建模参照工作使用子代理。

当前分析目标为 `reverse/experiment/raw/HLF10631030.exe.mengoo`、同目录 `UnityPlayer.dll` 和 `HLF10631030_Data/`。先追原版本地游戏的入口、资源与业务调用；已完成静态结果见 `reverse/静态分析交付.md`。保留重建源码，按原版证据继续逐项实现。

- 原厂文件保持只读，留在 `reverse/`，不加入 Git。
- 原事实与重建设计分开标识；原 27/39 完整映射缺失时保持明确标注。
- 应用及子进程运行内存不超过 2 GB；编译进程树 CPU 总占用低于一个逻辑核心的 80%，使用 `source/tools/limit-build.py`，一次一个构建。
- 两个 Skill 位于 `.agents/skills/reverse-engineer-anything/SKILL.md` 和 `.agents/skills/craft-anything/SKILL.md`；MCP 使用根目录 `.codex/config.toml`，Windows模板为 `.codex/config.windows.toml`。直接读取 Skill 并调用现有 CLI，不以重启 Agent 为执行前提。
- 不读取全局模型敏感配置；模型凭据仅在本机应用数据目录配置。
- 工具、缓存、下载、临时文件和运行数据全部使用外置盘。APFS 工具映像为 `toolchain/HospitalTools.sparsebundle`，挂载后路径 `/Volumes/HospitalTools`；用 `source/tools/open-hospital-tools.command` 按需挂载及启动，无持久调度。

WJSGFMTHZ
