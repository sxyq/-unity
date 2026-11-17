/* 纯本地 TTS 服务（sherpa-onnx + 中文 VITS）
 * 无网络、无 API Key、无 Python 依赖；CPU 实时。
 * 用法：node tools/tts/local-server.mjs [端口=8791]
 *   GET /tts?text=...&speed=1.0   → audio/wav
 *   GET /voices                   → 音色列表
 *   GET /health
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || 8791);
const MODEL_DIR = path.join(__dirname, 'models');
const CACHE_DIR = path.join(os.tmpdir(), 'gqy-tts-local');
fs.mkdirSync(CACHE_DIR, { recursive: true });

let sherpa = null;
try {
  sherpa = (await import('sherpa-onnx-node')).default;
} catch (e) {
  console.error('未安装 sherpa-onnx-node：', e.message);
  process.exit(1);
}

/* 找模型目录（解压后名字不固定，取第一个含 model.onnx 的子目录） */
function findModelDir() {
  if (!fs.existsSync(MODEL_DIR)) return null;
  for (const d of fs.readdirSync(MODEL_DIR)) {
    const p = path.join(MODEL_DIR, d);
    if (!fs.statSync(p).isDirectory()) continue;
    for (const f of fs.readdirSync(p)) {
      if (f.endsWith('.onnx')) return p;
    }
  }
  return null;
}

const dir = findModelDir();
if (!dir) {
  console.error('模型未就绪：请把模型解压到 tools/tts/models/<任意名>/ 下（含 *.onnx + tokens.txt）');
  process.exit(1);
}

const files = fs.readdirSync(dir);
const onnx = files.find((f) => f.endsWith('.onnx'));
const tokens = files.find((f) => f === 'tokens.txt') || files.find((f) => f.endsWith('tokens.txt'));
const lexicon = files.find((f) => f.startsWith('lexicon') && f.endsWith('.txt'));
const dictDir = files.includes('dict') ? path.join(dir, 'dict') : '';
const dataDir = files.includes('espeak-ng-data') ? path.join(dir, 'espeak-ng-data') : '';

const ttsConfig = {
  model: {
    vits: {
      model: path.join(dir, onnx),
      tokens: path.join(dir, tokens),
      lexicon: lexicon ? path.join(dir, lexicon) : '',
      dictDir,
      dataDir,
    },
    numThreads: 2,
    debug: 0,
    provider: 'cpu',
  },
  maxNumSentences: 1,
};

console.log('加载模型：', onnx, '| lexicon:', lexicon || '(无)', '| dataDir:', dataDir || '(无)');
const tts = new sherpa.OfflineTts(ttsConfig);
console.log('模型就绪，采样率', tts.sampleRate);

/* Float32 → 16bit PCM WAV */
function toWav(samples, sampleRate) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE((s * 32767) | 0, 44 + i * 2);
  }
  return buf;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (u.pathname === '/health') return res.end('ok');
  if (u.pathname === '/voices') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ 'local-vits-zh': '本地中文女声（sherpa-onnx VITS）' }));
  }
  if (u.pathname !== '/tts') { res.statusCode = 404; return res.end('not found'); }

  const text = (u.searchParams.get('text') || '').trim().slice(0, 300);
  if (!text) { res.statusCode = 400; return res.end('text required'); }
  const speed = Number(u.searchParams.get('speed') || 1.0) || 1.0;
  const sid = Number(u.searchParams.get('sid') || 0) || 0;

  const key = crypto.createHash('md5').update(`${speed}|${text}`).digest('hex');
  const cacheFile = path.join(CACHE_DIR, key + '.wav');

  try {
    if (fs.existsSync(cacheFile)) {
      res.setHeader('Content-Type', 'audio/wav');
      return res.end(fs.readFileSync(cacheFile));
    }
    const t0 = Date.now();
    const audio = tts.generate({ text, sid: Math.max(0, Math.min(tts.numSpeakers - 1, sid)), speed });
    const wav = toWav(audio.samples, audio.sampleRate);
    fs.writeFileSync(cacheFile, wav);
    res.setHeader('Content-Type', 'audio/wav');
    res.end(wav);
    console.log(`[tts] ${text.slice(0, 18)}… ${wav.length}B ${Date.now() - t0}ms`);
  } catch (e) {
    console.error('[tts] fail', e.message);
    res.statusCode = 500;
    res.end('tts failed: ' + e.message);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`本地 TTS 服务 http://127.0.0.1:${PORT}（离线，CPU）`);
});
