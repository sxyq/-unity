#!/usr/bin/env node
/* 把 Unity 状态观察器部署到**独立测试副本**。
 * 不修改原始安装目录，不上传任何厂商二进制/资源到仓库。
 *
 * 用法：
 *   node tools/deploy-unity-observer.mjs ^
 *     --source "C:\Program Files (x86)\Mengoo\MCLocalLauncher\HLF10631030" ^
 *     --target "C:\Temp\gqy-unity-test\HLF10631030"
 *
 * 之后用平台下发的票据启动测试副本的 HLF10631030.exe（见 docs/Unity本地状态输出.md）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const opt = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const m = argv[i].match(/^--([^=]+)(?:=(.*))?$/);
  if (!m) continue;
  if (m[2] !== undefined) opt[m[1]] = m[2];                       // --key=value
  else if (argv[i + 1] && !argv[i + 1].startsWith('--')) opt[m[1]] = argv[++i]; // --key value
  else opt[m[1]] = true;
}
const SRC = String(opt.source || 'C:\\Program Files (x86)\\Mengoo\\MCLocalLauncher\\HLF10631030');
const DST = String(opt.target || 'C:\\Temp\\gqy-unity-test\\HLF10631030');
const DATA = path.join(DST, 'HLF10631030_Data');
const MANAGED = path.join(DATA, 'Managed');

if (!fs.existsSync(path.join(DST, 'HLF10631030.exe'))) {
  if (!fs.existsSync(SRC)) throw new Error('找不到实验本体目录: ' + SRC);
  console.log('复制实验包到测试目录（约 400MB）...');
  fs.mkdirSync(path.dirname(DST), { recursive: true });
  fs.cpSync(SRC, DST, { recursive: true });
} else {
  console.log('已有测试副本，跳过复制');
}
if (!fs.existsSync(MANAGED)) throw new Error('测试副本缺少 Managed 目录: ' + MANAGED);

// 1) 编译观察器（只引用 UnityEngine.CoreModule.dll，不引用厂商业务程序集）
//    把引用 DLL 放到项目内 ref/（csproj 的默认路径），避免 -p:UNITY_MANAGED=C:\...
//    在非 shell 的 execFileSync 里被 MSBuild 误解析。ref/ 已在 .gitignore 中忽略。
console.log('编译 GqyStateObserver ...');
const refDir = path.join(ROOT, 'tools/unity-observer/ref');
fs.mkdirSync(refDir, { recursive: true });
fs.copyFileSync(path.join(MANAGED, 'UnityEngine.CoreModule.dll'),
                path.join(refDir, 'UnityEngine.CoreModule.dll'));
execFileSync('dotnet', [
  'build', path.join(ROOT, 'tools/unity-observer/unity-observer.csproj'), '-c', 'Release'
], { stdio: 'inherit' });
const dll = path.join(ROOT, 'tools/unity-observer/bin/Release/GqyStateObserver.dll');
fs.copyFileSync(dll, path.join(MANAGED, 'GqyStateObserver.dll'));

// 2) 注册到 Unity 程序集清单
const saPath = path.join(DATA, 'ScriptingAssemblies.json');
const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
if (!sa.names.includes('GqyStateObserver.dll')) {
  sa.names.push('GqyStateObserver.dll');
  sa.types.push(2);                       // 2 = UserAssembly
  fs.writeFileSync(saPath, JSON.stringify(sa));
  console.log('  ScriptingAssemblies.json +GqyStateObserver.dll');
}

// 3) 注册到 Unity 初始化方法表
//    新增程序集的 [RuntimeInitializeOnLoadMethod] 不会被自动发现：
//    Unity 在构建时把初始化方法固化进这个 JSON。五种 loadTypes 各注册一条，
//    Bootstrap.Init 内部幂等，保证至少有一个阶段能成功启动。
const riPath = path.join(DATA, 'RuntimeInitializeOnLoads.json');
const ri = JSON.parse(fs.readFileSync(riPath, 'utf8'));
ri.root = ri.root.filter(x => x.assemblyName !== 'GqyStateObserver');
for (const loadTypes of [0, 1, 2, 3, 4]) {
  ri.root.push({
    assemblyName: 'GqyStateObserver', nameSpace: 'Gqy',
    className: 'Bootstrap', methodName: 'Init',
    loadTypes, isUnityClass: false
  });
}
fs.writeFileSync(riPath, JSON.stringify(ri));
console.log('  RuntimeInitializeOnLoads.json +5 条入口');

console.log('\n部署完成：', DST);
console.log('原始安装目录未改动：', SRC);
console.log('运行时侦察输出：%TEMP%\\gqy-runtime-dump.txt');
console.log('状态事件写入：%USERPROFILE%\\AppData\\LocalLow\\Mengoo\\HLF10631030\\Player.log');
