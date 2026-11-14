#!/bin/bash
# 启动虚拟显示 → 初始化 Wine 前缀 → 跑客户端 → 收集日志
set -x
Xvfb :99 -screen 0 1280x800x24 >/tmp/xvfb.log 2>&1 &
sleep 2

wineboot -u >/tmp/wineboot.log 2>&1 || true

cd /app
timeout 180 wine MCLocalLauncher.exe \
  -screen-fullscreen 0 -screen-width 1280 -screen-height 800 \
  -logFile /tmp/unity.log
echo "wine exit=$?"

mkdir -p /out
cp -v /tmp/unity.log /out/ 2>/dev/null
find /wine/drive_c/users -ipath '*LocalLow*' -name 'Player.log' -exec cp -v {} /out/ \; 2>/dev/null
echo '--- /out ---'
ls -la /out
