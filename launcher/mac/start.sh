#!/bin/bash
# 课后服务管理 · macOS 启动器
# 双击 .app 时由系统调用本脚本：起本地服务 → 等它就绪 → 用默认浏览器打开。
# 已经是开着的时候，只切回浏览器，不会起第二个。

APP="$(cd "$(dirname "$0")/../Resources/app" && pwd)"
DATA="$APP/data"
LOG="$DATA/server.log"
mkdir -p "$DATA"

NODE="$APP/node"
[ -x "$NODE" ] || NODE="$(command -v node)"
if [ -z "$NODE" ]; then
  osascript -e 'display alert "找不到 node" message "这个包里应该自带 node；如果被删了，重装一次这个 .app 就好。"' >/dev/null 2>&1
  exit 1
fi

# 1. 已经在跑？直接开浏览器
if [ -f "$DATA/.port" ]; then
  P="$(cat "$DATA/.port" 2>/dev/null)"
  if [ -n "$P" ] && curl -fsS --max-time 2 "http://127.0.0.1:$P/api/health" 2>/dev/null | grep -q 'after-school'; then
    open "http://127.0.0.1:$P"
    exit 0
  fi
fi

# 2. 挑一个没人用的端口（3210 起）
PORT=""
for i in $(seq 0 98); do
  p=$((3210 + i))
  if ! lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
    PORT="$p"
    break
  fi
done
if [ -z "$PORT" ]; then
  osascript -e 'display alert "启动失败" message "3210~3308 都被占用了，先关掉占用的程序再试。"' >/dev/null 2>&1
  exit 1
fi

# 3. 起服务（日志超过 1MB 就先滚掉旧的）
if [ -f "$LOG" ] && [ "$(wc -c <"$LOG" | tr -d ' ')" -gt 1048576 ]; then
  mv -f "$LOG" "$LOG.old"
fi
cd "$APP" || exit 1
NODE_ENV=production nohup "$NODE" "$APP/node_modules/next/dist/bin/next" start -H 127.0.0.1 -p "$PORT" >>"$LOG" 2>&1 &
PID=$!
disown 2>/dev/null || true
echo "$PID" >"$DATA/.pid"
echo "$PORT" >"$DATA/.port"

# 4. 等它答话（最多 90 秒）
READY=""
for i in $(seq 1 90); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep -q '"ok":true'; then
    READY="1"
    break
  fi
  sleep 1
done

if [ -n "$READY" ]; then
  open "http://127.0.0.1:$PORT"
  osascript -e "display notification \"已在浏览器打开（端口 $PORT）。关掉页面不会退出，要退出请双击「停止课后服务」\" with title \"课后服务管理\"" >/dev/null 2>&1 || true
else
  osascript -e "display alert \"启动失败\" message \"看看这个文件：$LOG\"" >/dev/null 2>&1 || true
fi
