#!/bin/bash
# macOS: double-click to start. (First time: right-click → Open, if macOS asks.)
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js isn't installed. Opening the download page — install it, then double-click this file again."
  open "https://nodejs.org/en/download"
  read -p "Press Enter to close."
  exit 1
fi
npm run go
