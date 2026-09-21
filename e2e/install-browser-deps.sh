#!/usr/bin/env bash
# Playwright's Chromium needs a handful of system libraries. On a machine
# without root, fetch them as .deb files and unpack them into a user prefix,
# then point LD_LIBRARY_PATH at it. Run once; the test script reads the path
# from .env.e2e.
set -euo pipefail
PREFIX="${1:-$HOME/.local/lib/playwright-deps}"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

PKGS=(libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libasound2t64
      libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64 libgbm1
      libxkbcommon0 libpango-1.0-0 libcairo2 libcups2t64 libnss3 libnspr4
      libdrm2 libxshmfence1 libwayland-client0 libxi6 libxrender1 libxtst6)

cd "$WORK"
apt-get download "${PKGS[@]}"
for deb in *.deb; do dpkg-deb -x "$deb" "$WORK/root"; done
mkdir -p "$PREFIX"
cp -r "$WORK"/root/usr/lib/x86_64-linux-gnu/. "$PREFIX"/ 2>/dev/null || true
cp -r "$WORK"/root/lib/x86_64-linux-gnu/. "$PREFIX"/ 2>/dev/null || true
echo "Unpacked $(ls "$PREFIX" | wc -l) files into $PREFIX"
