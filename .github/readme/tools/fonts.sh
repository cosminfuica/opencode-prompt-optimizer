#!/usr/bin/env bash
# Fetches the BRIEF.md typefaces (Fraunces 700, Instrument Sans 400/600, JetBrains Mono 400/700; all OFL-1.1) from the
# Fontsource packages on the npm registry into tools/fonts/, where gen_svg.py and tiles.html look for them.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p fonts && cd fonts
for pkg in fraunces instrument-sans jetbrains-mono; do
  tgz=$(npm pack "@fontsource/$pkg@latest" --silent)
  tar -xzf "$tgz" --wildcards 'package/files/*latin-*-normal.woff2'
  rm -f "$tgz"
done
mv package/files/fraunces-latin-700-normal.woff2 fraunces-700.woff2
mv package/files/instrument-sans-latin-400-normal.woff2 instrument-sans-400.woff2
mv package/files/instrument-sans-latin-600-normal.woff2 instrument-sans-600.woff2
mv package/files/jetbrains-mono-latin-400-normal.woff2 jetbrains-mono-400.woff2
mv package/files/jetbrains-mono-latin-700-normal.woff2 jetbrains-mono-700.woff2
rm -rf package
ls -la
