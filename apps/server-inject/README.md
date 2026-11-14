# 服务端植入包（server-hook）

把智能交互组件挂到**学校服务器上**，学生不需要装扩展。
原理只有两条：注入一行 `<script>`，再给 `/mengoo/__ai/` 一个反代入口。

```
┌────────────┐   ① 注入一行 script   ┌──────────────────┐
│  学生浏览器 │ ◄──────────────────── │ nginx / IIS 反代 │
│            │                        │  （或改 index.html）│
│  /mengoo/  │   ② /mengoo/__ai/*    │                  │
│  + hook.js │ ────────────────────►  │  → 127.0.0.1:8788 │
└────────────┘                        └──────────────────┘
                                              │
                                       ③ 转发对话（SSE）
                                              ▼
                                   apps/model-gateway/server.mjs（模型网关）
```

## 目录

| 文件 | 作用 |
|---|---|
| `src/web-shim.js` | 用 fetch+SSE 顶替扩展的 `chrome.runtime`，前端代码零改动 |
| `build.mjs` | 把 `apps/apps/extension/src/*` 打成一个 `public/hook.js`（约 94 KB） |
| `service.mjs` | 静态托管 + `/api/chat` 转发 + 限流 + 可选登录校验 |
| `local-proxy.mjs` | 本地预演：给真实站点注入脚本，不动服务器 |
| `conf/nginx-mengoo.conf` | nginx 版配置（sub_filter + 反代） |
| `conf/iis-web.config` | IIS 版配置（URL Rewrite 出站规则 + ARR） |

## 本地预演（已验证）

```bash
# 1. 模型网关（已有）
node apps/model-gateway/server.mjs                     # 127.0.0.1:8787

# 2. 构建 + 起服务
node apps/server-inject/build.mjs
node apps/server-inject/service.mjs              # 127.0.0.1:8788

# 3. 起预演代理（模拟 nginx 的 sub_filter）
node apps/server-inject/local-proxy.mjs          # 127.0.0.1:8899

# 4. 打开（走预演代理，看到的就是注入后的真实站点）
open http://127.0.0.1:8899/mengoo/
```

预期：页面右侧出现「智能助教」竖条 → 点开 → 未识别场景时列出 10 张场景卡 → 选一个即可对话。

## 学校服务器部署（任选其一）

### A. nginx（推荐）

1. `nginx -V 2>&1 | grep -o with-http_sub_module` 确认有 sub 模块
2. 把 `conf/nginx-mengoo.conf` 的两段 `location` 合进现有 server 块
3. 改 `mengoo_origin` 为原站真实地址
4. `nginx -t && nginx -s reload`

### B. IIS

1. 装 URL Rewrite 2.0 + ARR，开 proxy
2. 把 `conf/iis-web.config` 合并进站点 `web.config`
3. 关掉静态压缩（出站规则匹配不到压缩后的 HTML）

### C. 最省事：只改一个文件

如果拿得到站点目录，直接把 `public/hook.js`、`public/src/`、`public/assets/`
放到 `mengoo/__ai/` 下，并在 `mengoo/index.html` 的 `</head>` 前加：

```html
<script src="/mengoo/__ai/hook.js" defer></script>
```

再把 `/mengoo/__ai/api/*` 反代到 8788 即可。

## 服务端环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 8788 | 只监听 127.0.0.1 |
| `UPSTREAM` | `http://127.0.0.1:8787` | 模型网关地址 |
| `AUTH_CHECK` | `0` | `1` = 调平台 `/api/Auth/Info` 校验登录，未登录返回 401 |
| `PLATFORM_BASE` | 空 | `AUTH_CHECK=1` 时必填 |
| `RATE_PER_MIN` | 20 | 单 IP 每分钟对话次数 |

模型 Key 只在 `apps/model-gateway/config.json` 或 `LLM_API_KEY` 环境变量，前端永远拿不到。

## 必须注意的三个坑

1. **PWA Service Worker 会缓存 index.html**
   平台注册了 `/mengoo/sw.js`，precache 里就有 `index.html`。
   只做 HTML 注入的话，老用户会拿到缓存里的旧页面，注入不生效。
   → 处理：要么让 `/mengoo/sw.js` 返回 404（放弃离线能力，实验室场景无影响），
   要么在 sw.js 的 precache 清单里加我们的脚本并升 revision。

2. **sub_filter 必须关上游压缩**：`proxy_set_header Accept-Encoding "";`

3. **SSE 必须关缓冲**：`proxy_buffering off;`（nginx）/ `X-Accel-Buffering: no`（已由服务端返回）

## 回滚

- nginx/IIS：删掉配置里的 `location /mengoo/__ai/` 与 `sub_filter` / `outboundRules`，reload 即可
- 改文件方式：删掉 `mengoo/__ai/` 目录和 index.html 里那一行
- 服务：`kill` 掉 8788 进程，页面只是不再弹面板，原系统不受影响
