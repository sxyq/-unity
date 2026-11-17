# 在 Linux 上运行实验客户端：实测记录

> 时间：2026-11-14 01:55–02:58
> 环境：macOS（Apple M5, arm64）→ Docker（colima，aarch64 VM）→ Debian bookworm **amd64 模拟**
> 目标：不找 Windows 机器，先在 Linux 里把 `MCLocalLauncher.exe` 跑起来，拿到 `Player.log` 的真实格式。

---

## 1. 结论

**能跑起来，但跑不到出日志那一步。**

> 更新（2026-11-14 04:00）：在真 x86_64 的 A6000 服务器上用便携版 Wine 已**跑通**，
> 详见 `docs/A6000运行记录.md`。本文结论只适用于「ARM + Docker 模拟 x86」这一种环境。

| 阶段 | 结果 |
|---|---|
| 容器里模拟 x86_64 | ✅ `uname -m` 返回 `x86_64` |
| 安装 wine32 + i386 多架构 | ✅ wine 8.0（Debian 打包） |
| 启动 `MCLocalLauncher.exe` | ✅ 进程起来了 |
| Unity 初始化 | ⚠️ **只到 Mono 加载**，随后段错误 / 卡死 |
| 生成 `Player.log` | ❌ 没有（`LocalLow` 目录为空） |

Unity 日志（`-logFile`）里只有两行：

```
Mono path[0] = 'Z:/app/MCLocalLauncher_Data/Managed'
Mono config path = 'Z:/app/MonoBleedingEdge/etc'
```

之后 `Segmentation fault (exit 139)`，无论 `-force-glcore`、`-force-d3d9`、
`LIBGL_ALWAYS_SOFTWARE=1`、16/24 位色深都试过。

开着 `WINEDEBUG=+loaddll` 时能看到最后加载的模块是
`UnityPlayer.dll`（native）与 `winex11.drv`，说明它死在**图形设备初始化**，
而不是查版本、连服务器那一步。

---

## 2. 为什么不是"再调调就行"

1. **架构不对**：客户端是 **32 位 x86**（PE 头 `0x014c`），在 ARM 上要经过
   Linux 容器模拟 + Wine 的 WoW64 两层，性能和兼容性都打折；
2. **显卡不对**：容器里没有 GPU，Unity 2021 只能用 llvmpipe 软件 OpenGL，
   初始化本身就很容易崩；
3. **就算成功，也拿不到关键日志**：能出日志的是"登录/主界面"阶段，
   而我们要的是**实验内部步骤**（`术中阶段 3/10`），那要真正进实验、下完资源包才写。

第 3 条是决定性的：**在 Linux 里跑通，也只能证明路径，证明不了业务日志格式。**

---

## 3. 顺手确证的三件事（这趟没白跑）

| 发现 | 证据 |
|---|---|
| MSI 里的 `mono-2.0-bdwgc.dll` 实际文件名是 `mono2.0bdwgc.dll` | 直接启动报 `Unable to load mono library`，改名后加载成功 |
| 客户端数据目录结构是 `MCLocalLauncher_Data/` + `MonoBleedingEdge/` | 按 `Version.json` 的 `fullName` 还原后，Unity 能读到 Mono 配置 |
| `data.unity3d` 在 `StreamingAssets/` 下，是资源包而非主数据 | 解包路径可见 |

这三条对"在 Windows 上跑一次"也有用：至少知道目录该怎么摆。

---

## 4. 替代方案：不用 Windows 也能把日志格式对准

既然拿日志只为了写解析规则，就把这一步做成**离线标定**：

```bash
node client-agent/calibrate.mjs /path/to/Player.log
```

它会输出：

- 每个阶段（术前/术中/术后/考核）命中的行（去重、截断）
- 可能的步骤行（`3/10`、`第3步`、`step 3`）
- 一份可直接落盘的 `client-agent/rules.json`

也就是说：**谁手上有一台跑过实验的 Windows（学生自己的电脑就行），
把 `Player.log` 发过来/拷过来，我们这边 1 分钟就能标定完**，
不需要在 Windows 上装 Node、装扩展、跑代理。

已用模拟日志验证：输入 9 行，正确识别出 2 条术前、3 条术中，并生成规则。

---

## 5. 如果坚持要在 Linux 上跑

`client-agent/linux-wine/` 里给了 x86_64 专用的镜像与脚本：

```bash
docker build -t mengoo-wine .
docker run --rm -v "$PWD/app:/app" -v "$PWD/out:/out" mengoo-wine
ls out/          # Player.log / unity.log
```

在**真 x86_64 + 有 GPU（或至少 llvmpipe 可用）** 的 Linux 上，
成功率比 ARM 模拟高得多；但仍受第 2 节第 3 条限制：
只能拿到启动阶段日志，拿不到实验内部步骤。

---

## 6. 环境清理

实验用的容器 `winebuild`（约 2 GB）与镜像已在本机删除，
只保留 `client-agent/linux-wine/` 的 Dockerfile 与脚本，随时可重建。
