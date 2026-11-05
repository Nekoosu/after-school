#!/bin/bash
# 双击这个文件 = 停止课后服务管理（把后台的本地服务退掉，数据不会丢）
DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$DIR/课后服务管理.app/Contents/Resources/app"
DATA="$APP/data"

if [ -f "$DATA/.pid" ]; then
  PID="$(cat "$DATA/.pid" 2>/dev/null)"
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null
    for i in $(seq 1 20); do
      kill -0 "$PID" 2>/dev/null || break
      sleep 0.3
    done
    kill -9 "$PID" 2>/dev/null || true
  fi
  rm -f "$DATA/.pid" "$DATA/.port"
fi

if command -v pkill >/dev/null; then
  pkill -f "$APP/node_modules/next/dist/bin/next" 2>/dev/null || true
fi

osascript -e 'display notification "已经退出了，数据都在 app/data 里" with title "课后服务管理"' >/dev/null 2>&1 || true
