# 独立 Godot 路线

Godot 4.7.2 + Blender，工具安装在外置盘 `/Volumes/HospitalTools`，工程在 `/Volumes/Lexar/Project/医院仿真/godot-rebuild`。

这是 Unity 工程的替代实现路线：使用 Godot 负责跨平台应用、输入、UI、场景和导出；使用 Blender 负责病房、患者、病床、牵引设备及动画；模型使用 glTF/GLB 导入。开发应用默认 1280×720 小窗，不抢占桌面全屏。

病例、12 个知识点和十个助教场景来自 `data/CourseContent.json`；27 个自主重建设计任务和39项评分来自 `data/Tasks.json`。病例与提示词通过 `source/tools/export-course-content.mjs` 从现有正式数据迁入。

2026-11-17 实际进展：Blender 已生成可编辑 `../work/models/Ward.blend` 和 `assets/Ward.glb`，共168对象、11283面。床旁柜依据原客户端截图改为淡奶油台面、上抽屉与下柜门、弧形拉手及凹入门把位；原物理尺寸未取得，沿用现有场景尺度。打包 Mac 应用已真实完成身份核对和病史采集两个任务，含观察、答题、存档。现按原版证据复刻「1.入院记录」入口、三页签与返回教学模块；其病历实体模型与病历页面的准确原版视觉素材尚未取得。

项目使用 `training.gd` 管理任务和成绩，`ward.gd` 管理三维对象与操作动画，`interface.gd` 管理四模块与报告，`assistant.gd` 复用既有本地Node模型网关。UI、模型与任务为已实现源码，具体可用范围以实际运行记录为准。

工具全部在外置盘APFS映像 `../toolchain/HospitalTools.sparsebundle` 内，挂载名 `/Volumes/HospitalTools`。Godot编辑器及Mac/Windows导出模板位于 `/Volumes/HospitalTools/Godot`；Unity编辑器、Windows支持与Hub位于 `/Volumes/HospitalTools/Applications`。启动可双击 `../source/tools/open-hospital-tools.command`，无需常驻调度。

本轮 Blender 导出：平均单核CPU26.06%、峰值216MiB；Mac导出CPU采样峰值47.42%、峰值796MiB；Windows导出CPU采样峰值47.83%、峰值759MiB。均使用 `limit-build.py`，一次一个构建。实际 Mac 小窗显示45FPS，应用51.9MiB、网关20.5MiB、合计72.3MiB，记录位于 `/Volumes/HospitalTools/Runtime/runtime-usage.json`。运行数据和模型配置保存在同卷 Runtime 目录。

两平台已导出并装入Node网关：Mac应用 `/Volumes/HospitalTools/Products/TractionCare.app`，可分发ZIP位于 `../builds/macOS/TractionCare.zip`；Windows x86_64程序位于 `../builds/Windows/TractionCare.exe`，同目录Gateway须随程序分发。Mac已实际运行病历三页签、退出提示和返回模块；Windows运行环境尚未取得。

2026-11-17 后续：按原 `handel.mp4` 可见顺序实现一手已戴好、另一手套入、拉整袖口及放松，时长7.416667秒；三维双手含拇指、不同长度的四指、独立材质及翻折袖口，另有套入前的手套外壳。模块2显示四入口与手术治疗九项导航。已在新版 Mac 小窗实际选择穿刺包和手套，完成准备、动作和自主判断题；存档 `C15:0` 为 `performed/answered/correct=true`，`pack/gloves=true`。原手套动作的按钮回调、考核题和完成条件仍缺，因此本项完成判定与题目保留自主设计归属。

本次两平台产物均已更新。Mac导出CPU采样峰值44.87%、内存490MiB；Windows导出39.92%、551MiB。新版Mac在2026-11-17T13:24:07.694Z采样的应用与网关RSS合计46.625MiB；当前帧率未另采样。日志为 `/Volumes/HospitalTools/Logs/gloves-macos-build.log`、`gloves-windows-build.log`；窗口仍为1280×720。

后续血供对照：第1天恢复原实测的血供异常结论及“是/否”题目，颜色、皮温、足背动脉的具体状态标为未取得；第2、3、7天继续明确标为自主教学情境。考核提交前隐藏第1天结论与答案解析。Mac小窗实际完成第1天选“是”和第2天选“否”，两次均正确，存档 `1794922889-40496` 分别记录为 `C29:1`、`C29:2`。助教对话键已加入任务ID和实际日期，切任务及日期分别保留上下文；真实模型仍待项目凭据。

最新两平台文件均包含上述血供与会话改动。Mac导出CPU采样峰值46.93%、内存446MiB；Windows导出42.14%、394MiB；应用与网关在2026-11-17T13:47:29.240Z的RSS合计48.71875MiB。日志为 `circulation-macos-build.log`、`circulation-windows-build.log`，同在外置工具卷的Logs目录。

启动成品：`source/tools/open-hospital-tools.command app`。Mac和Windows默认小窗；应用内保留手动全屏选项。在线AI尚无模型凭据，模型配置界面支持本地保存；离线课程资料可以直接阅读。

### 当前逐项复刻：1.入院记录

| 原版已确认项目 | 当前实现 | 证据状态 |
|---|---|---|
| 病房入口「1.入院记录」打开 `RecordPanel`、`ButtonPanel`、`UISampleBingLiPanel` | 点击三维床尾病历对象，或患者交互菜单中的「1.入院记录」 | 导航和面板来自 Windows 实测；新模型拾取为自主实现 |
| 「入院记录 / 辅助检查 / 专科检查」三页签 | 三页签；分别呈现病例事实、CT与血常规、专科检查 | 页签和内容类别来自实测；精确布局及原始完整文本未取得 |
| 未完成时退出提示「有考核点未做完，请完成后退出。」 | 同文提示，确定后留在病历页 | 提示来自真实 UI；该任务题目及完成后退出流程未取得 |
| 返回教学模块列表 | 「返回」回到自主模块选择页 | 原版返回存在；新 UI 为小窗自主实现 |

本轮已在打包 Mac 小窗中实际点击三维病历，浏览三个页签，看到原文退出提示，确认后保持病历，最后返回模块列表。床旁柜依据原客户端截图重建可见轮廓及把手；原模型网格、尺寸、贴图和完整病历页面仍未取得，当前不可标为完整1:1。

原版模型参照：`../source/docs/evidence-real-experiment.png`；过场动画参照：`../work/original-reference-video/introduce-27s.png`。两名资料子代理分别整理业务与视觉，建模子代理修改柜体，主代理补齐弧形拉手、凹入门把位、导出及运行。

原程序证据：四模块、病例、操作项目、心理护理三维入口与术后1/2/3/7天来自已有Windows资料；完整原27编号名称及39逐项映射仍缺原始导出，R/C编号、题目、评分和逐日症状为自主重建设计。原厂文件只读保留在 `../reverse/`。
