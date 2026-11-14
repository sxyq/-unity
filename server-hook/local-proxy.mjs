/*
 * 本地反向代理 —— 用来「预演」学校服务器上的注入效果
 * ---------------------------------------------------------------
 * 它模拟 nginx 的两件事：
 *   1. location /mengoo/__ai/  → 转发给本机 8788（我们的 hook 服务）
 *   2. sub_filter               → 在返回的 HTML 里插一行 <script>
 *
 * 除了这两点，其余请求一字节不改地转发给真实站点。
 * 原服务器不需要任何改动，也不会有任何写入。
 *
 * 运行：node server-hook/local-proxy.mjs
 * 访问：http://127.0.0.1:8899/mengoo/
 */
import http from 'node:http';
import https from 'node:https';

const PORT = Number(process.env.PORT || 8899);
const TARGET = process.env.TARGET || 'https://skeletaltraction.cqmu.edu.cn';
const HOOK = process.env.HOOK || 'http://127.0.0.1:8788';
const INJECT = '<script src="/mengoo/__ai/hook.js" defer></script>';
// 校内站点的 WAF 会拦 HeadlessChrome 之类的 UA，这里统一成正常 Chrome
const UA = process.env.UA || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

// 不复用到上游的长连接：预演代理只求稳，避免个别响应挂住把浏览器连接池占满
const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: false });

function proxyHook(req, res) {
  const u = new URL(req.url.replace(/^\/mengoo\/__ai/, '') || '/', HOOK);
  const r = http.request(
    { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: req.method, headers: { ...req.headers, host: u.host } },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    }
  );
  r.on('error', () => { res.writeHead(502); res.end('hook service down'); });
  req.pipe(r);
}

function proxySite(req, res) {
  const u = new URL(TARGET);
  const headers = { ...req.headers, host: u.host, 'accept-encoding': 'identity', 'user-agent': UA };
  const r = https.request(
    { hostname: u.hostname, port: 443, path: req.url, method: req.method, headers, agent },
    (up) => {
      const ct = String(up.headers['content-type'] || '');
      up.on('aborted', () => { try { res.destroy(); } catch (e) {} });

      // 非 HTML：原样流式转发
      if (!/text\/html/i.test(ct)) {
        res.writeHead(up.statusCode || 502, up.headers);
        up.pipe(res);
        return;
      }

      // HTML：缓冲后注入一行 script
      const chunks = [];
      up.on('data', (c) => chunks.push(c));
      up.on('end', () => {
        let html = Buffer.concat(chunks).toString('utf8');
        if (html.includes('</head>') && !html.includes('/__ai/hook.js')) {
          html = html.replace('</head>', INJECT + '</head>');
        }
        const buf = Buffer.from(html, 'utf8');
        const out = { ...up.headers };
        delete out['content-length'];
        delete out['content-encoding'];
        delete out['transfer-encoding'];
        out['content-length'] = String(buf.length);
        out['cache-control'] = 'no-store';
        res.writeHead(up.statusCode || 200, out);
        res.end(buf);
      });
    }
  );
  r.setTimeout(25000, () => { r.destroy(new Error('upstream timeout')); });
  r.on('error', (e) => {
    if (res.headersSent) { try { res.destroy(); } catch (_) {} return; }
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('上游不可达: ' + e.message);
  });
  req.pipe(r);
}

http.createServer((req, res) => {
  if (req.url.startsWith('/mengoo/__ai')) return proxyHook(req, res);
  return proxySite(req, res);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[local-proxy] http://127.0.0.1:${PORT}  →  ${TARGET}`);
  console.log(`[local-proxy] 注入: ${INJECT}`);
});
