# 方法驱动 API（已实测）

> 不点鼠标，直接反射调用游戏自己的方法推进流程。坐标/DPI 问题都绕开了。
> 指令格式：`%TEMP%\gqy-cmd.txt` 写 `call|<类型>|<方法>|<参数…>`

## 实测可用的调用

| 调用 | 效果 | 备注 |
|---|---|---|
| `UISelectPanel.OpenChildCase01()` | **跳过「实验目的」页和开场视频，直接进 ChildSence03** | 最有价值的一条，省掉两次点击 |
| `UIVideoPlayPanel.Back()` | 关闭视频面板 | 等价于点返回 |
| `RayModelManager.set_IsCloseRaycast(false)` | 打开 3D 射线交互 | 否则点病人无反应 |
| `UITipOptPanel.SetXLHLDialoog01()` | 启动心理护理对话链（埋点 M14） | 场景 06 的核心 |
| `UICasePanelFirst.CloseSence()` | 返回 void（面板未彻底移除） | 可能只隐藏内容 |
| `GameManager.HidoOpenPanelList()` | 关闭全部面板 | ⚠️ 之后指令通道会失联 |
| `GameManager.ShowOpenPanelList()` | 恢复面板 | 同上 |

## 方法签名（methods 指令查询）

```
UISelectionExamPanel:
  SetCurrentCurrentDatas(Int32)   设当前题
  SumitSelectOpt()                提交选择
  NextExam() / NextTopicOpt(Transform)
  LoadSelectItem(Int32,Transform,Int32,List`1)
  JudgeContions(String) / RecordSection(Int32)

UISelectPanel:
  OpenChildCase01() / OpenChildCase02()
  OpenVideo() / OpenCasePanel() / CloseCasePanel()
  LoadCase1Panel(Slider,SenceState)
  SetCaseSenceState(SenceState)

UICasePanelFirst:
  InitUI(IUIData) / SetOpenSence(Int32) / CloseSence() / SetModelMove(Boolean)

UITaskOptPanel:
  SetQYYX / SetTengTong / SetHZZDXG / SetHZSJSS / SetCKCX
  SetQYZD / SetYLXSS / SetFBGR / SetPX      （均 (Int32)）
  ChangeDay() / JudgeOptNumber()
```

## 答题的可编程路径（下一步验证）

```
1. 进入某任务：UITaskOptPanel.SetTengTong(0)
2. 等面板就绪：UISelectionExamPanel 出现
3. 选题：      SetCurrentCurrentDatas(0)   ← 选第 0 项
4. 提交：      SumitSelectOpt()
5. 下一题：    NextExam()
```

> 若 3 只切换数据不改选中态，则退回到「buttons 读选项坐标 + 点击」，
> 但只在 `UISelectionExamPanel` 上做，坐标源统一，不再全局换算。

## 通道稳定性修复（重要）

原来用 `SynchronizationContext.Post` + Timer 驱动，**场景切换后上下文失效，指令不再执行**。
现改为 `DontDestroyOnLoad` 的隐藏 GameObject + `Update()` 每帧驱动（`Runner.cs`），
实测跨场景、跨模式切换都能持续响应。

---

## 坐标规律（彻底搞清，2026-11-16 02:00）

| 来源 | 坐标空间 | 用法 |
|---|---|---|
| 截图（2560×1600） | 物理 | ÷1.5 |
| `buttons` / `scan` 返回值 | **物理** | ÷1.5 后用于点击 |
| `click.py` 入参 | 逻辑（1707×1067） | 直接传换算值 |
| 部分面板 `buttons`（如 UISelectPanel 早期值） | 可能已是逻辑 | 试一次即可判断 |

根因：系统 DPI = 144（150%），游戏以 1707×1067 逻辑分辨率渲染，屏幕上放大到 2560×1600。

## 已完整跑通的任务（实测）

**「牵引有效性」（术后第一天第 1 项）**：

```
点任务项 (90,275)
→ UISelectionOtherExamPanel（综合评估：是/否 + 压疮分期 + 部位）
→ 勾选 (641,485) → 确定 (738,923)
→ UISelectionExamPanel 01/02「患者的牵引是否有效？」选 A(183,385) → 提交(1431,202)
→ 「恭喜你！操作成功」→ 确定(853,683)
→ 02/02「70kg 患者牵引重量？」选 C 7kg (183,588) → 提交
→ 「恭喜你！操作成功」+ 知识点 → 确定(853,789)
→ 回到任务面板，该项完成
```

## 弹窗按钮位置会变

「确定」按钮的 y 坐标随弹窗内容长度变化（实测 1024 / 1184 两种），
**必须用 `scan|确定` 实时取**，不能写死。

## 待补的自动化分支

- `UISelectionOtherExamPanel`：需要"勾选 + 确定"，与选择题分支不同
- 跨天切换（任务栏 → 第二天/第三天/第七天）
- 跨章（模块 1 / 2）

## UI 文本劫持（已实证）

指令：`text|旧文字|新文字` —— 遍历 `UnityEngine.UI.Text`，命中即改写。

实测：

```
text|是否读取进度|我是AI助教，已接管本次实验
→ replaced 1
```

截图确认：游戏原生提示框的标题被替换成我们的文案。

意义：**不需要改 DLL、不需要脱壳后的 IL**，运行时反射就能改界面文字。
这是「字幕劫持」的正确实现方式（比叠加字幕条更彻底）：
1. observer 读 `uiTexts` → agent 判断场景
2. 模型生成新台词
3. `text|原文|新台词` 直接替换游戏内文本
4. 本地 TTS 朗读新台词

## 脱壳结论（补充）

`tools/dump-assembly.py` 可从内存导出 35 个 .NET 映像，主逻辑 665KB / 395 类型 / 271 个 `Nurse.*` 类。
但**IL 字节是加密的**（反编译报 `Unknown opcode: 0xF8`），元数据明文。
明文 IL 只在 Mono 托管堆里 → 改逻辑要走运行时调用，改 DLL 行不通。
