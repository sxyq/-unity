/* 本地 TTS 服务：微软 Edge 神经语音（真人感强、免费、无 Key）
 * 用法：node tools/tts/server.mjs [端口=8791]
 *   GET /tts?text=...&voice=zh-CN-XiaoxiaoNeural&rate=0
 *   GET /voices
 *
 * 面板侧：window.BT_TTS_URL = 'http://127.0.0.1:8791/tts'
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const PORT = Number(process.argv[2] || 8791);
const CACHE_DIR = path.join(os.tmpdir(), 'gqy-tts-cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const VOICES = {
  'zh-CN-XiaoxiaoNeural': '晓晓（女·自然，推荐）',
  'zh-CN-YunxiNeural': '云希（男·青年）',
  'zh-CN-XiaoyiNeural': '晓伊（女·温柔）',
  'zh-CN-YunyangNeural': '云扬（男·播音）',
  'zh-CN-YunjianNeural': '云健（男·浑厚）',
  'zh-CN-liaoning-XiaobeiNeural': '晓北（女·东北）',
};

/* 单例：每次请求新建连接开销大，复用同一个实例（串行化） */
let chain = Promise.resolve();

function synth(text, voice, ratePct) {
  const job = async () => {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    return await new Promise((resolve, reject) => {
      const chunks = [];
      const timer = setTimeout(() => reject(new Error('tts timeout')), 25000);
      let stream;
      try {
        const r = tts.toStream(text, { rate: ratePct, pitch: 0, volume: 0 });
        stream = r.audioStream;
      } catch (e) { clearTimeout(timer); return reject(e); }
      stream.on('data', (c) => chunks.push(Buffer.from(c)));
      stream.on('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
      stream.on('error', (e) => { clearTimeout(timer); reject(e); });
      setTimeout(() => { try { tts.close(); } catch { } }, 26000);
    });
  };
  const p = chain.then(job, job);
  chain = p.catch(() => { });
  return p;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (u.pathname === '/voices') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify(VOICES));
  }
  if (u.pathname === '/health') { return res.end('ok'); }
  if (u.pathname !== '/tts') { res.statusCode = 404; return res.end('not found'); }

  const text = (u.searchParams.get('text') || '').trim().slice(0, 400);
  if (!text) { res.statusCode = 400; return res.end('text required'); }
  const voice = u.searchParams.get('voice') || 'zh-CN-XiaoxiaoNeural';
  const rate = Number(u.searchParams.get('rate') || 0) || 0;

  const key = crypto.createHash('md5').update(`${voice}|${rate}|${text}`).digest('hex');
  const cacheFile = path.join(CACHE_DIR, key + '.mp3');

  try {
    if (fs.existsSync(cacheFile)) {
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.end(fs.readFileSync(cacheFile));
    }
    const buf = await synth(text, voice, rate);
    if (!buf.length) throw new Error('empty audio');
    fs.writeFileSync(cacheFile, buf);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.end(buf);
    console.log(`[tts] ${voice} ${text.slice(0, 20)}… ${buf.length}B`);
  } catch (e) {
    console.error('[tts] fail', e.message);
    res.statusCode = 502;
    res.end('tts failed: ' + e.message);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`TTS 服务 http://127.0.0.1:${PORT}  （${Object.keys(VOICES).length} 个中文音色）`);
});
