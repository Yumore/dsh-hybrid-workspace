#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-${DSH_HOME:-$HOME/.dsh}/hybrid-workspace-v2/HybridWorkspaceShell.app}"
MACOS="$DEST/Contents/MacOS"

rm -rf "$DEST"
mkdir -p "$MACOS" "$DEST/Contents/Resources"

swiftc "$ROOT/shell/macos/main.swift" \
  -O -framework Cocoa -framework WebKit \
  -o "$MACOS/HybridWorkspaceShell"

cat > "$DEST/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>HybridWorkspaceShell</string>
  <key>CFBundleDisplayName</key><string>工作区控制台</string>
  <key>CFBundleIdentifier</key><string>com.zuoyuan.hybrid-workspace-shell</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleExecutable</key><string>HybridWorkspaceShell</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

codesign --force --deep --sign - "$DEST" >/dev/null 2>&1 || true
printf '%s\n' "$DEST"
