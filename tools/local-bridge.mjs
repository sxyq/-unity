#!/usr/bin/env node
/* 本机桥：监听 127.0.0.1:9090，接管平台页面的 WebSocket 探测。
 *
 * 为什么需要它：
 *   平台学习页点「启动虚拟实验」时，先连 ws://127.0.0.1:9090 判断本机是否装了客户端，
 *   连不上才回退到 mlauncher:// 协议。浏览器对「非用户手势」的协议跳转是拦的，
 *   所以只要 9090 能连上，这条链路才稳定。
 *
 * 用法：
 *   node tools/local-bridge.mjs                 # 监听 9090，回复握手（默认）
 *   node tools/local-bridge.mjs --port=9090
 *
 * 实测平台前端（baselarning.*.js）：onopen 发 "Hello from client"，
 * onmessage 收到**任何**消息就 window.location = <MLauncher URL>。
 * 所以本桥只需要回一条消息，剩下的协议跳转由浏览器 + 已注册的 MLauncher:// 完成；
 * 页面不会在 ws 里下发 URL，本桥也绝不替页面启动进程。
 */
import http from 'node:http';
import crypto from 'node:crypto';

const opt = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) opt[m[1]] = m[2] === undefined ? true : m[2];
}
const PORT = Number(opt.port || 9090);
const LOG = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ---------------- 极简 WebSocket 服务端（RFC6455，够用即可） ---------------- */
function accept(key) {
  return crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
}

function encodeFrame(str, opcode = 1) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let head;
  if (len < 126) {
    head = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([head, payload]);
}

function decodeFrames(state, chunk, onText, onClose) {
  state.buf = Buffer.concat([state.buf, chunk]);
  for (;;) {
    const b = state.buf;
    if (b.length < 2) return;
    const fin = (b[0] & 0x80) !== 0;
    const opcode = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;
    if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
    const maskLen = masked ? 4 : 0;
    if (b.length < off + maskLen + len) return;
    const mask = masked ? b.subarray(off, off + 4) : null;
    const data = Buffer.from(b.subarray(off + maskLen, off + maskLen + len));
    if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
    state.buf = b.subarray(off + maskLen + len);
    if (opcode === 8) { onClose(); return; }
    if (opcode === 1) onText(data.toString('utf8'));
    if (!fin) return; // 不支持分片，够用
  }
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('local-bridge ok\n');
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept(key)}\r\n\r\n`
  );
  LOG('[ws] 页面已连接', req.url);
  const state = { buf: Buffer.alloc(0) };

  const send = (obj) => {
    const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
    socket.write(encodeFrame(text));
    LOG('[ws→页面]', text.slice(0, 300));
  };

  decodeFrames(state, Buffer.alloc(0), () => {}, () => {});

  socket.on('data', (chunk) => {
    decodeFrames(state, chunk, (text) => {
      LOG('[页面→ws]', text.slice(0, 500));
      // 回复任意消息即可让页面执行协议跳转；不解析、不落盘、不打印票据
      send({ code: 200, msg: 'ok', data: null });
    }, () => { LOG('[ws] 页面断开'); socket.destroy(); });
  });

  socket.on('error', () => {});
  socket.on('close', () => LOG('[ws] closed'));
});

server.listen(PORT, '127.0.0.1', () => {
  LOG(`local-bridge 监听 127.0.0.1:${PORT}（仅握手与记录，不启动进程）`);
});
