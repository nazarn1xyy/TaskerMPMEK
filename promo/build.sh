#!/usr/bin/env bash
# Builds out/mpmek-loop.mp4: 1440×1440, 60 fps, 14 s (7 bars at 120 BPM), loops seamlessly.
set -euo pipefail
cd "$(dirname "$0")"
[ -d node_modules ] || PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --silent
# Music: "House Vibes" by Alejandro Magaña (A. M.), Mixkit Stock Music Free License
[ -f audio/house-vibes.mp3 ] || curl -sSL -o audio/house-vibes.mp3 https://assets.mixkit.co/music/129/129.mp3
node render.mjs beats out/beats                        # one still per beat, for review
node render.mjs full out/frames "${WORKERS:-6}"          # 240 subframes per second
python3 audio.py mix out/sounds.json out/mix.wav         # beat grid + UI sounds on their peaks
# 4 subframes → 1 frame (motion blur), centred on each frame's own time
ffmpeg -v error -y -framerate 240 -i out/frames/f%05d.png -i out/mix.wav \
  -filter_complex "[0:v]tmix=frames=4,select='eq(mod(n\,4)\,3)',setpts=N/(60*TB),format=yuv420p[v]" \
  -map "[v]" -map 1:a -r 60 -c:v libx264 -preset slow -crf 14 -tune animation -movflags +faststart \
  -c:a aac -b:a 256k -shortest out/mpmek-loop.mp4
echo "→ out/mpmek-loop.mp4"
