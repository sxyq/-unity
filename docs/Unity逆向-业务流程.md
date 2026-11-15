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
