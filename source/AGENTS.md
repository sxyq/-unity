# 医院仿真项目约束

- 当前正式路线为 Godot + Blender 的完整跨平台产品重建：四大模块、27 个步骤、39 项成绩、十场景助教、macOS 与 Windows 构建及实际运行。复用已有 Unity 源码，按流程逐项迁移。
- 当前先逐项1:1复刻原版功能与对应模型，开发默认小窗，不自动全屏；独立资料工作由子代理协作，主代理统一实现。
- 最终应用运行内存不得超过 2 GB，包含应用子进程。
- 编译期间整个编译进程树的 CPU 总占用不得超过单个核心的 80%；单线程本身不能满足这个上限，实际编译须采用限速方式。
- REA 与 Craft Anything 的 Skill 和 MCP 仅在本项目配置。
- 当前会话可直接读取项目 Skill 并使用现有官方 CLI；继续分析不以 Agent 重启为前提。
- 原厂二进制保存在工程外的 `../reverse/`，不加入 Git、不改写原始文件、不绕过认证、不保存认证资料。自主重建部分与原程序证据分别标注。
- 工具和缓存放外置盘，Unity 编辑器、Hub 和 Godot 均在 `/Volumes/HospitalTools`；映像位于项目 `toolchain/HospitalTools.sparsebundle`。

WJSGFMTHZ
