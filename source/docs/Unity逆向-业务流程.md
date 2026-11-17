# 原实验逆向：业务流程与埋点（代码级）

> 磁盘上的 `Assembly-CSharp.dll` 被厂商加密，ILSpy 只能读出空文件。
> 但运行时它是普通 .NET 程序集，所以在注入的 observer 里做 **IL 摘要导出**
> （每个方法的字符串常量 / 调用目标 / 字段访问），得到 396 个类型的可读清单。
> 全程只读，不修改游戏逻辑。

导出位置：`%TEMP%\gqy-il\`（`_index.txt` 是类型清单）。

## 1. 3D 交互与菜单（这是「心理护理」的唯一入口）

```
RayModelManager.Update
  → Physics.Raycast(cameraRay, out hit)
  → SetCurrentHitOpt(hit)
      hit 物体名 ∈ {nurse, drive, Player} → SetClickPanient()
      → UIMgr.OpenPanel(UITipOptPanel) + UITipOptPanel.SetPanelChildShow()
```

`UITipOptPanel.TranslateType` 是菜单文案真值表：

```
2.术前准备 | 3.术前谈话 | 1.入院记录 | 2.体格检查 | 1.医患沟通 | 3.辅助检查 | 4.手术治疗 | 心理护理
```

按钮按场景/完成度动态组装：`SetUITipOptPanelBtnOptType` 会引用
`recordList / firstOptIndex / opt01..opt05 / SenceModelManager.m_BeiZi`。

**心理护理**（拼音缩写 XLHL）就在这个菜单里：

```
SetXLHLDialoog01 → ScoreMgr.SendExamScore("M14", …)   // 埋点 M14
SetXLHLDialoog02 → "xlhl-hz01"
SetXLHLDialoog03 → "xlhl-hs02"
… 共 7 段（xlhl-hs01..hs04 / hz01..hz03），最终置 IsHuLiDone = true
```

结论：**心理护理不是术后任务栏里的一项，而是「点病人 → 菜单 → 心理护理」**。
这也解释了切天数时的「心理护理未完成」——它是天数推进的前置条件。

## 2. 术后任务与天数

`UITaskOptPanel`：

- 字段：`dayTime`、`uITaskOpts`（第 1 天）、`uITaskOpts02/03/07`、`contentView`、`endButton`
- `ChangeDay`：`SetPanelMoveBack` → `CameraChangeManager.SendCameraChange` →
  `SenceModelManager.ChangeFutieTexture`（换床单/患肢贴图）
- `JudgeOptNumber`：判定当天任务是否做完 → `GameManager.SetTip("第N天任务完成！")`
  → `GameManager.UploadExpProgress`

任务项点开后的两种考核面板：

| 面板 | 关键字段 | 用途 |
|---|---|---|
| `UISelectionExamPanel` | `questionTip`（题干）、`currIndex`、`communicationDatas` | 是/否选择题 |
| `UISelectionOtherExamPanel` | `panel01/02/03ToggleList`、`dayTime` | 术后按天任务勾选表 |

术后观察评估：`UIThirdSenceOptPanel`（`dayTime` + `orderIndex`，视诊/触诊/动诊/听诊）。

## 3. 术前与术中

| 面板 | 关键字段 | 对应任务 |
|---|---|---|
| `UISampleBingLiPanel` | `firstDayClick/senondDayClick/timeValue` | 电子病历（入院记录 / 辅助检查） |
| `UIFirstSenceOptPanel` | 动作条：同意书 | 术前谈话 |
| `UISecondSenceOptPanel` | 视诊/触诊/动诊/量诊；1.确认穿刺部位…9.牵引 | 体格检查 / 手术治疗 |
| `UISkeletaTractionOptPanel` | `weightValue` | 牵引重量 |

## 4. 评分

`ScoreMgr`：`ScoreDatas`（39 条）、`TypeScores`（基础理论/技能操作/完成效率/综合应用）、
`TotalScore`、`TakeScoreValue`、`ChangeScore`、`SendExamScore(SN, …)`。
任务完成时按 SN 记分（如心理护理 = M14）。

## 5. 按实现驱动（不再靠截图点击）

`tools/unity-observer/CmdChannel.cs`：读 `%TEMP%\gqy-cmd.txt`，结果写 `gqy-cmd-result.txt`。

| 指令 | 作用 |
|---|---|
| `find\|Player` | 物体世界坐标 + 屏幕坐标 |
| `call\|类型\|方法\|参数…` | 反射调用（实例或静态） |
| `inst\|类型\|字段` | 读实例字段；数组会逐项输出坐标 |
| `stat\|类型\|字段` | 读静态字段 |

实测：

- `call|Nurse.Logic.GameManager|HidoOpenPanelList` → 关闭当前所有面板（panels 变空）
- `call|Nurse.Logic.GameManager|ShowOpenPanelList` → 恢复
- `inst|Nurse.Logic.SenceModelManager|modelPos` → `0:pos screen=1018,550`（病人位置）

## 6. 已加入的状态字段

`GQY_STATE` 新增：

- `tipOptButtons`：3D 菜单上**当前真实可见**的按钮文字（含「心理护理」）
- `dayTaskNames`：当日任务按钮的真实名称
- `huLiDone`：心理护理是否完成
- `examQuestion`：当前题干
- `playerScreen`：病人模型屏幕坐标（供精确定位）

agent 已接入：`tipOptButtons` 含「心理护理」→ `postop-psych`（高可信）。

---

## 7. 心理护理（场景 06）实测闭环 —— 2026-11-15 夜

### 7.1 卡点与解法

之前点病人没反应，不是坐标不对，而是 **`RayModelManager.isCloseRaycast = True`**：
此时射线交互被游戏自己关掉了（通常在有模态面板/未到交互时机时为 true）。

指令通道实测：

```
inst|Nurse.Logic.RayModelManager|isCloseRaycast        → True
call|Nurse.Logic.RayModelManager|set_IsCloseRaycast|false → ok void
```

关掉后点病人模型（`modelPos[0]` 屏幕坐标 `1018,550`，或头部 `747,284`）：

```
GQY_STATE.tipOptButtons = "心理护理"
panels += Resources/Prefabs/UI/TopTipItem/UITipOptPanel
/state → scenarioId=postop-psych, task=术后心理护理, confidence=high
        evidence=["3D 病人菜单按钮：心理护理"]
```

点菜单里的「心理护理」（`buttons|Nurse.Logic.UITipOptPanel` → `心理护理@644,170`）
或直接调用同一方法：

```
call|Nurse.Logic.UITipOptPanel|SetXLHLDialoog01
→ panels += UIDialoogConentPanel
→ uiTexts: ["跳过","您的手术很顺利，","心理护理",…]
→ /state 仍为 postop-psych / high
```

### 7.2 为什么必须点病人，而不是任务栏

术后左栏 10 项是**并发症观察任务**（牵引有效性/疼痛/神经/血供/血栓/出血/针道/压伤/肺部感染/排泄），
心理护理不在其中。它在 **3D 病人菜单**里，且是推进术后天数的前置条件
（未完成时点「第三天」会提示「心理护理未完成。」）。

### 7.3 状态字段

- `tipOptButtons`：菜单上真实可见的按钮文字（运行时反射读 Button 子 Text）
- `huLiDone`：UITipOptPanel.IsHuLiDone
- agent 规则：`tipOptButtons` 含「心理护理」→ `postop-psych`（high）

### 7.4 仍未完成

- 09/10：需要学生真实做完整个实验（39 道题）才会弹出
  `UIComprehensivePerformanceRecordPanel`；**不会伪造答题或分数**去触发。
- 07/08 的「多选题第二问」等后续题，题干会变，agent 按题干关键词映射即可，未逐题记录。

### 7.5 术后任务项的「按实现」入口（UITaskOptPanel 方法表）

术后左栏每一项不是靠点像素，而是 `UITaskOptPanel` 上的一个命名方法，签名均为 `(int index)`：

| 方法 | 任务项 | 打开的面板组合 |
|---|---|---|
| `SetQYYX(int)` | 牵引有效性 | 对白 + `UIThirdSenceOptPanel` + 考核面板 |
| `SetTengTong(int)` | 疼痛 | `UIDialoogConentPanel`（"您今天感觉怎么样"）+ 视诊/触诊/动诊/听诊 + `UISelectionOtherExamPanel` |
| `SetHZZDXG(int)` | 患肢肢端血供 | 同上 |
| `SetHZSJSS(int)` | 患肢神经损伤 | 同上 |
| `SetCKCX(int)` | 创口出血 | 同上 |
| `SetQYZD(int)` | 牵引针道 | 同上 |
| `SetYLXSS(int)` | 压力性损伤 | 同上 |
| `SetFBGR(int)` | 肺部感染 | 同上 |
| `SetPX(int)` | 排泄 | 同上 |

实测（只调用、不答题）：

```
call|Nurse.Logic.UITaskOptPanel|SetTengTong|1
→ panels: UIDialoogConentPanel + UIThirdSenceOptPanel + UISelectionOtherExamPanel
→ uiTexts: ["跳过","您今天感觉怎么样","听诊","动诊","触诊","视诊","完成返回","确定",…]
```

结论：术后每一项都走「对白 → 四项评估（视/触/动/听）→ 选择题」，
这与通过 UI 点击观察到的行为一致；`index` 参数控制第几项，便于批量核对而不需要像素定位。

> 注意：调用这些方法**会推进任务流程**，因此仅用于识别校对；
> 真正的答题（提交）仍必须由学生完成，未做任何自动作答。

### 7.6 术后「综合评估面板」的真实结构（实测）

调用任一任务方法（如 `SetQYYX(0)`）打开的是同一个 `UISelectionOtherExamPanel`，
它不含文字题干，而是三组勾选项：

| 字段 | 内容 | 含义 |
|---|---|---|
| `examList1` | `A/是`、`B/否` | 判断题（如「钢针是否移位」） |
| `examList2` | `A/1期` … `E/5期` | 压疮分期 |
| `examList3` | 枕骨粗隆 / 肩胛部 / 肘部 / 骶尾部 / 足跟部 / 耳廓 / 面颊部 / 乳房 / 生殖器 / 足尖部 | 压疮好发部位 |

因此：**术后任务项没有统一题干字段**，识别靠三件事叠加——

1. `tipOptButtons`（3D 病人菜单）→ 心理护理（06）
2. `examQuestion`（`UISelectionExamPanel.questionTip`）→ 疼痛/血栓等选择题（07/08）
3. `examList2/3` 出现「1期…5期」或「骶尾部/足跟部」→ 压力性损伤（08）

agent 已按这三条实现。

### 7.7 两个操作坑（已处理/需注意）

- **Unity 会抢回最上层**：它获得焦点时重新 `SetWindowPos TOPMOST`，把悬浮窗压到后面。
  已在跟随 tick 内把自己拉回最上层（`NOMOVE|NOSIZE|NOACTIVATE`），实测面板稳定可见。
- **`HidoOpenPanelList()` 之后指令通道可能失联**：调用它会连 UI 根节点一起隐藏，
  observer 的同步上下文随场景/UI 重建失效，后续指令不再执行。
  目前只能重启游戏恢复；如需继续用它，应改为「按面板名 hide」而不是一键全关。
