# 在 Linux 上跑客户端（x86_64 专用）

> 这套东西是给**真正的 x86_64 Linux 机器**用的（学校机房、实验室服务器、装了 Ubuntu 的笔记本）。
> 在 Apple Silicon 上通过 Docker 模拟 x86_64 也能启动到 Unity 初始化，但会在图形初始化阶段崩溃，
> 详见 `docs/Linux运行尝试.md`。

## 为什么要在 Linux 上跑

只为拿一份 **Player.log**，看清客户端到底怎么写日志，从而把 `client-agent` 的解析规则对准。
不需要真的把实验做完，能进到登录界面/主界面就够了。

## 步骤

```bash
# 1. 准备客户端文件（从 MLauncherSetup.msi 解出来的目录，含 MCLocalLauncher.exe）
#    形如：
#      app/MCLocalLauncher.exe
#      app/MCLocalLauncher_Data/...
#      app/MonoBleedingEdge/EmbedRuntime/mono-2.0-bdwgc.dll

# 2. 构建镜像（x86_64 Linux 上不需要 --platform）
docker build -t mengoo-wine .

# 3. 运行（把客户端目录挂进去）
docker run --rm -v "$PWD/app:/app" -v "$PWD/out:/out" mengoo-wine

# 4. 取日志
ls out/
# Player.log / unity.log 会被复制到 out/
```

## 注意

1. `mono-2.0-bdwgc.dll` 在 MSI 里的文件名是 `mono2.0bdwgc.dll`，**必须重命名**后放进
   `MonoBleedingEdge/EmbedRuntime/`，否则报 `Unable to load mono library`。
2. 32 位 Unity 需要 wine32 + i386 多架构；镜像里已装。
3. 无 GPU 时用 `LIBGL_ALWAYS_SOFTWARE=1`；有 GPU 时可试 `-force-glcore`。
4. 客户端要联网（`res.cs-vstep.com` 与学校平台），容器默认走 NAT。
5. 拿到的日志请用 `node client-agent/calibrate.mjs out/Player.log` 标定规则。

---

## A6000 实测补充（2026-11-14）

在真 x86_64 + 无 root 的机器上，走"便携版 Wine"更省事，且有几个必踩的坑：

1. **Xvfb 必须显式开 GLX**，否则 Wine 连记事本都起不来：
   `Xvfb :103 +extension GLX +extension RANDR +render -noreset -screen 0 1280x800x24`
2. **强制 D3D11**：默认会先试 Vulkan，报 `apiVersion has value of 0` 后崩溃。
   `wine MCLocalLauncher.exe -force-d3d11`
3. 三个文件名要对齐：
   - `mono2.0bdwgc.dll` → `MonoBleedingEdge/EmbedRuntime/mono-2.0-bdwgc.dll`
   - `AssemblyCSharp.dll` → `MCLocalLauncher_Data/Managed/Assembly-CSharp.dll`
   - `unitydefaultresources` → `MCLocalLauncher_Data/Resources/unity default resources`
4. 便携版选 `wow64`（客户端是 32 位，Ubuntu 24.04 默认没有 i386 库）。

完整记录见 `docs/A6000运行记录.md`。
