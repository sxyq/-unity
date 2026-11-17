/* 用平台下发的票据启动独立测试副本（C:\Temp\gqy-unity-test，带 GQY_STATE observer）。
 * 前置：先跑 fetch-launch-url.mjs / get-launch-url.mjs 拿到新票（写 C:\Temp\mlaunch-url.txt）。
 * 票据一次有效且很快过期，取票后必须立即调用本脚本。
 *
 * 参数顺序修正（实测结论）：
 *   平台原始 URL：[16]=ticket [18]=host
 *   实验本体要求：[16]=host  [18]=ticket
 * 整段 URL 作为一个引号参数传给 HLF10631030.exe。
 * 只输出脱敏信息（票号前 8 位），不打印完整票据。
 */
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const SRC = 'C:\\Temp\\mlaunch-url.txt';
const EXE = 'C:\\Temp\\gqy-unity-test\\HLF10631030\\HLF10631030.exe';
const GAME_URL_FILE = 'C:\\Temp\\mlaunch-url-game.txt';

const raw = fs.readFileSync(SRC, 'utf8').trim();
// 保留原始 scheme 大小写（实测成功日志为 MLauncher://，游戏端区分大小写，勿改）
if (!/^mlauncher:\/\//i.test(raw)) { console.log('mlaunch-url.txt 不是 mlauncher:// URL，先取票'); process.exit(1); }
const parts = raw.split('&');
if (parts.length < 19) { console.log('URL 段数异常:', parts.length); process.exit(1); }

const host = 'https://skeletaltraction.cqmu.edu.cn';
let ticket = parts[16];
if (ticket.startsWith('http')) ticket = parts[18]; // 平台顺序：16=host 18=ticket
if (!/^[0-9a-f]{8}-/i.test(ticket)) { console.log('票号格式异常，停止'); process.exit(1); }
parts[16] = host;
parts[18] = ticket;
const gameUrl = parts.join('&');
fs.writeFileSync(GAME_URL_FILE, gameUrl, 'utf8');

if (!fs.existsSync(EXE)) { console.log('测试副本不存在:', EXE); process.exit(1); }

const child = spawn(EXE, [gameUrl], { detached: true, stdio: 'ignore', cwd: 'C:\\Temp\\gqy-unity-test\\HLF10631030' });
child.unref();
console.log('测试副本已启动 pid=', child.pid, '| 票号前 8 位:', ticket.slice(0, 8), '| 段16=host 段18=ticket');
