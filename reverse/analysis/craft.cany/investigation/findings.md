# Findings

- **fnd_1** 启动器 globalgamemanagers 可按 Unity 2019.3.14f1 Windows 32-bit 序列化格式读取，共 18 个对象；该版本属于启动器。 (Seen it; evidence: ev_d1e6061405f5c3d784ef7b663ea871049c7eb54211063e83f2e843506fc1e5b4)
- **fnd_2** 实验 data.unity3d 为 293663279 字节，内置格式识别为 unknown；标准 UnityFS 与 Serialized 解析均不支持该文件。 (Seen it; evidence: ev_77aadf75c82f3ab8cb6fa00c7bc3b40507d6a953b27174fc783712e1c987b097)
- **fnd_3** MengooPlatform.dll 包含 29 类型、193 字段、171 方法、155 个 CIL 方法体和 815 个调用位置，步骤钩子是委托字段。 (Seen it; evidence: ev_2b5d2f0dc0b566323fb9b1e4793ca6978b8e5052037e54e0dd5165efb96d7f3d)
- **fnd_4** 原游戏MengooPlatform字符串AddTaskQuestion按任务Name和题目Content比较，新增No分别为列表Count+1；整数重载按iLabStep.seq定位，已有项仅更新startTime、endTime、timeUsed、score，首次添加才写其余步骤参数。 (Worked it out; evidence: ev_2b5d2f0dc0b566323fb9b1e4793ca6978b8e5052037e54e0dd5165efb96d7f3d)
- **fnd_5** 原版本地游戏HLF10631030.exe.mengoo的PE资源包含9幅图标、1个图标组、1项版本和1项manifest；版本字符串Unity Version为2021.3.6f1_7da38d85baf6。 (Seen it; evidence: ev_a221cfd3882fa6f8849ee7f512ae0dac42900eb16d44ccd099a38af55a76e1b6)
- **fnd_6** StartStep与EndStep仅在钩子存在且正常返回后读取hookOverride；异常分支记录错误后继续平台计时。stepTimes保存Unix毫秒，iLabStep.timeUsed转为整数秒且零值写1；seq与timeIndex分别传入。 (Worked it out; evidence: ev_2b5d2f0dc0b566323fb9b1e4793ca6978b8e5052037e54e0dd5165efb96d7f3d)
