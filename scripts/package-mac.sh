#!/bin/bash
# 课后服务管理 —— macOS 版打包脚本
#
# 在哪跑：任意一台 Mac（Apple Silicon 或 Intel 都行，脚本会自己判断）
# 怎么跑：bash scripts/package-mac.sh
#
# 它做的事：构建 → 在本机装运行期依赖（better-sqlite3 会下载/编译出 darwin 版）→
#           组装成「课后服务管理.app」→ 打好 tar.gz 放到 release/
# 产物：release/mac/after-school-<版本>-macos-<arm64|x64>.tar.gz

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

APPNAME="课后服务管理"
VERSION="$(grep -o '"[0-9][0-9.]*"' src/lib/version.ts | head -1 | tr -d '"')"
VERSION="${VERSION:-0.0.0}"

case "$(uname -m)" in
  arm64|aarch64) ARCH="arm64" ;;
  x86_64|amd64)  ARCH="x64" ;;
  *) echo "不认识的架构：$(uname -m)"; exit 1 ;;
esac

OUT="$ROOT/build/mac"
APP="$OUT/$APPNAME.app"
RES="$APP/Contents/Resources"
APPDIR="$RES/app"

echo "== 1/8 环境检查"
NODE_VER_NEEDED="24.22.0"
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo "   本机没有 Node，临时下载一个（不改动系统，装在临时目录里）"
  TMPN="$(mktemp -d)"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VER_NEEDED/node-v$NODE_VER_NEEDED-darwin-$ARCH.tar.gz" | tar -xz -C "$TMPN"
  NODEDIR="$(ls -d "$TMPN"/node-v*-darwin-* | head -1)"
  export PATH="$NODEDIR/bin:$PATH"
  export npm_config_cache="$TMPN/npm-cache"
fi
command -v node >/dev/null || { echo "node 还是没起来，网络问题？"; exit 1; }
echo "   node $(node -v) · npm $(npm -v) · $(uname -m) → $ARCH"

echo "== 2/8 安装开发依赖（装过就很快）"
npm install --no-audit --no-fund

echo "== 3/8 构建前端与接口"
npx next build

echo "== 4/8 组装 .app 骨架"
rm -rf "$OUT"
mkdir -p "$APP/Contents/MacOS" "$APPDIR"
cp -R .next "$APPDIR/.next"
rm -rf "$APPDIR/.next/cache" "$APPDIR/.next/trace"
cp -R public "$APPDIR/public"
rm -f "$APPDIR/public/README.md"

cat > "$APPDIR/package.json" <<'JSON'
{
  "name": "after-school-runtime",
  "private": true,
  "version": "1.0.0",
  "dependencies": {
    "better-sqlite3": "12.11.1",
    "next": "15.5.29",
    "react": "19.3.1",
    "react-dom": "19.3.1"
  }
}
JSON

cat > "$APPDIR/next.config.js" <<'JS'
module.exports = { serverExternalPackages: ["better-sqlite3"] };
JS

echo "== 5/8 安装运行期依赖（better-sqlite3 会拿到 darwin-$ARCH 的原生模块）"
( cd "$APPDIR" && npm install --omit=dev --no-audit --no-fund --no-package-lock )
# 万一预编译包没下来（网络问题），就地用本机工具链编一个
if ! ls "$APPDIR"/node_modules/better-sqlite3/build/Release/*.node >/dev/null 2>&1; then
  echo "   预编译没下来，改用本机编译（需要 Xcode Command Line Tools：xcode-select --install）"
  ( cd "$APPDIR" && npm rebuild better-sqlite3 --build-from-source )
fi

echo "== 6/8 放入 node 可执行文件"
LOCAL_NODE="$(command -v node)"
if file "$LOCAL_NODE" | grep -q "Mach-O"; then
  cp "$LOCAL_NODE" "$APPDIR/node"
  echo "   用本机 node：$(node -v)"
else
  TMP="$(mktemp -d)"
  URL="https://nodejs.org/dist/v$(node -v | tr -d 'v')/node-v$(node -v | tr -d 'v')-darwin-$ARCH.tar.gz"
  echo "   下载 $URL"
  curl -fsSL "$URL" | tar -xz -C "$TMP"
  cp "$TMP"/node-v*/bin/node "$APPDIR/node"
  rm -rf "$TMP"
fi
chmod +x "$APPDIR/node"

echo "== 7/8 写入启动/停止脚本、Info.plist、图标"
cp launcher/mac/start.sh "$APP/Contents/MacOS/start"
cp launcher/mac/stop.sh  "$APP/Contents/MacOS/stop"
chmod +x "$APP/Contents/MacOS/start" "$APP/Contents/MacOS/stop"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$APPNAME</string>
  <key>CFBundleDisplayName</key><string>$APPNAME</string>
  <key>CFBundleIdentifier</key><string>com.nekoosu.after-school</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>start</string>
  <key>CFBundleIconFile</key><string>app-icon</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

if [ -f public/app-icon.png ] && command -v sips >/dev/null && command -v iconutil >/dev/null; then
  ICONSET="$(mktemp -d)/app-icon.iconset"
  mkdir -p "$ICONSET"
  for s in 16 32 64 128 256 512; do
    sips -z $s $s public/app-icon.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
    sips -z $((s*2)) $((s*2)) public/app-icon.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$RES/app-icon.icns"
  rm -rf "$(dirname "$ICONSET")"
else
  echo "   跳过图标（缺 sips/iconutil 或 png）"
fi

cp launcher/使用说明-mac.txt "$OUT/使用说明.txt"
cp launcher/mac/停止课后服务.command "$OUT/停止课后服务.command"
chmod +x "$OUT/停止课后服务.command"

echo "== 8/8 打包"
mkdir -p release/mac
TARBALL="release/mac/after-school-$VERSION-macos-$ARCH.tar.gz"
rm -f "$TARBALL"
tar -czf "$TARBALL" -C "$OUT" "$APPNAME.app" "使用说明.txt" "停止课后服务.command"
SIZE="$(du -sh "$TARBALL" | cut -f1)"

# .dmg 只能在 Mac 上生成（hdiutil 是 macOS 自带的）；这里顺手就打一个
if command -v hdiutil >/dev/null; then
  DMG="release/mac/after-school-$VERSION-macos-$ARCH.dmg"
  rm -f "$DMG"
  hdiutil create -volname "$APPNAME" -srcfolder "$OUT" -ov -format UDZO "$DMG" >/dev/null
  echo "DONE   $DMG  ($(du -sh "$DMG" | cut -f1))"
fi

echo ""
echo "DONE   $TARBALL  ($SIZE)"
echo "双击 $APPNAME.app 即可使用；第一次如被拦住：右键 →「打开」，或运行"
echo "      xattr -dr com.apple.quarantine \"$OUT/$APPNAME.app\""
