/* 本地 TTS 服务：微软 Edge 神经语音（Neural），真人感强、免费、无需 API Key。
 * 用法：node tools/tts-server.mjs [端口，默认 8791]
 *   GET /tts?text=今天感觉怎么样&voice=zh-CN-XiaoxiaoNeural  → audio/mpeg
 *   GET /voices                                              → 可选音色列表
 *
 * 面板侧：window.BT_TTS_URL = 'http://127.0.0.1:8791/tts'
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PORT = Number(process.argv[2] || 8791);
const TRUSTED = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CACHE_DIR = path.join(os.tmpdir(), 'gqy-tts-cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

/* 常用中文音色：晓晓最自然，云希男声，晓伊温柔 */
const VOICES = {
  'zh-CN-XiaoxiaoNeural': '晓晓（女·自然，推荐）',
  'zh-CN-YunxiNeural': '云希（男·青年）',
  'zh-CN-XiaoyiNeural': '晓伊（女·温柔）',
  'zh-CN-YunyangNeural': '云扬（男·播音）',
  'zh-CN-liaoning-XiaobeiNeural': '晓北（女·东北）',
  'zh-CN-shaanxi-XiaoniNeural': '晓妮（女·陕西）',
};

function uuid() { return crypto.randomUUID().replace(/-/g, ''); }

/* 微软新版 Edge TTS 需要 Sec-MS-GEC 令牌：对「300 秒对齐的 Windows 时间戳 + 客户端令牌」做两次 SHA256 */
function secMsGec() {
  const ticks = Date.now() / 1000 + 11644473600;
  let t = ticks - (ticks % 300);
  t = Math.floor(t * 1e7);
  const h1 = crypto.createHash('sha256').update(`${t}${TRUSTED}`).digest('hex').toUpperCase();
  return crypto.createHash('sha256').update(h1 + TRUSTED).digest('hex').toUpperCase();
}
function stamp() {
  // Edge 需要 Windows FILETIME 风格的时间戳
  return new Date().toISOString();
}

/** 调 Edge TTS，返回 mp3 Buffer */
function synth(text, voice, rate = '+0%', pitch = '+0Hz') {
  return new Promise((resolve, reject) => {
    const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED}`
      + `&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=1-130.0.2849.68&ConnectionId=${uuid()}`;
    let ws;
    try {
      ws = new WebSocket(url, {
        headers: {
          'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
        },
      });
    } catch (e) { return reject(e); }

    const chunks = [];
    const timer = setTimeout(() => { try { ws.close(); } catch { } reject(new Error('tts timeout')); }, 20000);

    ws.addEventListener('open', () => {
      const cfg = {
        context: {
          synthesis: {
            audio: {
              metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' },
              outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
            },
          },
        },
      };
      ws.send(
        `X-Timestamp:${stamp()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
        JSON.stringify(cfg)
      );
      const ssml =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>` +
        `<voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}' volume='+0%'>` +
        text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') +
        `</prosody></voice></speak>`;
      ws.send(
        `X-RequestId:${uuid()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${stamp()}\r\nPath:ssml\r\n\r\n` + ssml
      );
    });

    ws.addEventListener('message', async (ev) => {
      const d = ev.data;
      if (typeof d === 'string') {
        if (d.includes('Path:turn.end')) {
          clearTimeout(timer);
          try { ws.close(); } catch { }
          if (!chunks.length) return reject(new Error('empty audio'));
          resolve(Buffer.concat(chunks));
        }
        return;
      }
      // 二进制：前 2 字节是大端 header 长度
      const buf = Buffer.from(await new Response(d).arrayBuffer());
      if (buf.length < 2) return;
      const headLen = buf.readUInt16BE(0);
      const audio = buf.subarray(2 + headLen);
      if (audio.length) chunks.push(audio);
    });

    ws.addEventListener('error', (e) => { clearTimeout(timer); reject(new Error('ws error ' + (e.message || ''))); });
    ws.addEventListener('close', () => { clearTimeout(timer); });
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (u.pathname === '/voices') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify(VOICES));
  }

  if (u.pathname !== '/tts') { res.statusCode = 404; return res.end('not found'); }

  const text = (u.searchParams.get('text') || '').trim().slice(0, 400);
  if (!text) { res.statusCode = 400; return res.end('text required'); }
  const voice = u.searchParams.get('voice') || 'zh-CN-XiaoxiaoNeural';
  const rate = u.searchParams.get('rate') || '+0%';

  const key = crypto.createHash('md5').update(`${voice}|${rate}|${text}`).digest('hex');
  const cacheFile = path.join(CACHE_DIR, key + '.mp3');

  try {
    if (fs.existsSync(cacheFile)) {
      const buf = fs.readFileSync(cacheFile);
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.end(buf);
    }
    const buf = await synth(text, voice, rate);
    fs.writeFileSync(cacheFile, buf);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.end(buf);
    console.log(`[tts] ${voice} ${text.slice(0, 24)}… ${buf.length}B`);
  } catch (e) {
    console.error('[tts] fail', e.message);
    res.statusCode = 502;
    res.end('tts failed: ' + e.message);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`TTS 服务已启动 http://127.0.0.1:${PORT}`);
  console.log('  试听：/tts?text=您好，我是您的责任护士');
  console.log('  音色：' + Object.keys(VOICES).join(', '));
});
