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
