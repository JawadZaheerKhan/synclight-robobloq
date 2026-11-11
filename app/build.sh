#!/bin/bash
# Builds "SyncLight 2.app" (with icon, server and helper bundled) and installs it into ~/Applications
# (or $INSTALL_DIR).
set -euo pipefail
cd "$(dirname "$0")"
NAME="SyncLight 2"
APP="build/$NAME.app"
rm -rf build && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" build/icon.iconset

swiftc -O main.swift -o "$APP/Contents/MacOS/SyncLight2"

# Bundle the controller (JavaScript + UI + screen-capture helper + native HID module) so the app is self-contained.
SRV="$APP/Contents/Resources/server"
mkdir -p "$SRV/helper"
cp -R ../src ../public ../package.json "$SRV/"
cp -R ../node_modules "$SRV/node_modules"
cp ../helper/capture "$SRV/helper/capture"
swiftc -O make-icon.swift -o build/make-icon && build/make-icon build/icon1024.png
for s in 16 32 128 256 512; do
  sips -z $s $s build/icon1024.png --out build/icon.iconset/icon_${s}x${s}.png >/dev/null
  sips -z $((s*2)) $((s*2)) build/icon1024.png --out build/icon.iconset/icon_${s}x${s}@2x.png >/dev/null
done
iconutil -c icns build/icon.iconset -o "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>SyncLight 2.0</string>
  <key>CFBundleDisplayName</key><string>SyncLight 2.0</string>
  <key>CFBundleIdentifier</key><string>com.user.synclight2.app</string>
  <key>CFBundleExecutable</key><string>SyncLight2</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>2.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PL
# Sign inner code first (the helper needs its own signature for Screen Recording), then the app.
codesign --force -s - "$SRV/helper/capture"
codesign --force --deep -s - "$APP"

DEST="${INSTALL_DIR:-$HOME/Applications}"
mkdir -p "$DEST"
rm -rf "$DEST/$NAME.app"
cp -R "$APP" "$DEST/$NAME.app"
echo "Installed: $DEST/$NAME.app"
