#!/bin/bash
# Builds SyncLight 2 from source and installs it into ~/Applications.
# Needs: macOS 13+, Node.js 18+, and the Xcode Command Line Tools (for the Swift compiler).
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\033[31mError:\033[0m %s\n' "$1" >&2; exit 1; }

[ "$(uname)" = "Darwin" ] || fail "SyncLight 2 only runs on macOS."
command -v node  >/dev/null || fail "Node.js is not installed. Get it from https://nodejs.org or run: brew install node"
command -v swiftc >/dev/null || fail "Swift compiler not found. Install the Xcode Command Line Tools: xcode-select --install"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 18 ] || fail "Node.js 18 or newer is required (found $(node -v))."

say "Installing dependencies"
npm install --omit=dev --no-audit --no-fund

say "Building the screen-capture helper"
swiftc -O helper/capture.swift -o helper/capture

say "Building and installing the app"
./app/build.sh

cat <<MSG

Done. Open "SyncLight 2" from ~/Applications (or Spotlight).
  - Plug in your light(s) and use "+ Add light" to set them up.
  - Close the official SyncLight app first; only one program can control the lights at a time.
  - Screen sync needs permission: System Settings > Privacy & Security > Screen & System Audio Recording.
MSG
