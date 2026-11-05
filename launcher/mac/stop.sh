#!/bin/bash
# 课后服务管理 · macOS 停止脚本
# 会先按记录里的进程号正常结束服务；不放心再兜底扫一遍（只匹配本 .app 里的 next）。

APP="$(cd "$(dirname "$0")/../Resources/app" && pwd)"
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
