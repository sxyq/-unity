# client-agent

采集实验客户端的运行状态，暴露成本机 HTTP 接口，给浏览器扩展 / 服务端注入用。

**只读**：读 Unity 的 `Player.log`、读前台窗口标题。不注入、不改文件、不读内存。

## 运行

```bash
node client-agent/agent.mjs
# GET http://127.0.0.1:8790/health
# GET http://127.0.0.1:8790/state
```

环境变量：

| 变量 | 说明 |
|---|---|
| `PORT` | 默认 8790，只监听 127.0.0.1 |
| `LOG_DIRS` | 额外日志目录，分号分隔 |
| `TITLE_CMD` | 自定义取窗口标题的命令 |

## 日志位置

Windows：

```
%USERPROFILE%\AppData\LocalLow\Mengoo\MCLocalLauncher\Player.log
```

依据：安装包内 `MCLocalLauncher_Data/app.info` 的内容是 `Mengoo` / `MCLocalLauncher`，
Unity 的日志规则就是 `LocalLow\<company>\<product>\Player.log`。
代理也会扫 `LocalLow\*\*\Player.log`，所以实验本体如果单独打包，也能自动找到。

## 输出

```json
{
  "phase": "intraop",
  "postopDay": null,
  "mode": "study",
  "contextSource": "client-log",
  "confidence": "high",
  "evidence": ["Operation_SubStepDescription_70101 皮肤消毒"],
  "windowTitle": "",
  "logs": [{ "file": "...Player.log", "events": 5, "phase": "intraop" }]
}
```

## 悬浮窗（可选）

`overlay/` 是一个 WinForms + WebView2 的小程序，把面板贴在实验窗口右侧。

```bash
cd client-agent/overlay
dotnet build -c Release
```

> 未在 Windows 实机验证，需 .NET 8 SDK + WebView2 Runtime。
> 环境变量 `GQY_PANEL_URL` 可改面板地址，默认 `http://127.0.0.1:8788/panel.html`。

## 免责与边界

- 不改客户端、不注入、不 Hook 图形接口
- 拿不到日志里没有的东西（如牵引重量、观察结果）
- 解析不到就返回 `confidence: none`，界面回落到手动选择
