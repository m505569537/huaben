#!/usr/bin/env bash
# 本地开发服务器。存档依赖 http 协议，所以别双击 html 文件。
#
#   ./serve.sh            打开 games/zhiwei
#   ./serve.sh my-game    打开指定游戏
#
set -euo pipefail
cd "$(dirname "$0")"

GAME="${1:-zhiwei}"
PORT="${2:-8765}"
URL="http://127.0.0.1:${PORT}/engine/index.html?game=${GAME}"

if [ ! -f "games/${GAME}/story.js" ]; then
  echo "找不到 games/${GAME}/story.js"
  echo "现有游戏：$(ls games | tr '\n' ' ')"
  exit 1
fi

echo "游戏：${GAME}"
echo "地址：${URL}"
echo "按 Ctrl+C 停止"

( sleep 1; open "$URL" 2>/dev/null || true ) &
exec python3 -m http.server "$PORT" --bind 127.0.0.1
