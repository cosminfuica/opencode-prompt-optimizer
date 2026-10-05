# README asset generators

The launch-page + bento assets in `..` (every file except the banners, which `BRIEF.md` documents) come from these
scripts. Fonts are not committed: `bash fonts.sh` fetches them from the npm registry (Fontsource, OFL-1.1).

```bash
bash fonts.sh                       # tools/fonts/*.woff2
pip install fonttools brotli        # gen_svg.py subsets and embeds the fonts
python3 gen_svg.py                  # cta-*, rule-*, spec-*, contribute-*, outro-* (dark and light)
for t in preview stack-1-2 feature-3 feature-4 feature-5 code list; do
  for theme in dark light; do node tiles.cjs $t $theme ../tile-$t-$theme.webp; done
done                                # needs playwright (Chromium) and ffmpeg with libwebp
```

`tiles.html` holds every animated tile as a `setTime(t)` scene, so frames are deterministic; `tiles.cjs` steps it at
10 fps and encodes an animated WebP with a transparent half-gutter baked in. Open `tiles.html?tile=preview&theme=dark`
in a browser and call `setTime(3)` from the console to inspect a frame.
