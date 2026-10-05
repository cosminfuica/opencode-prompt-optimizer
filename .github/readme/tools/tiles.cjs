// node tiles.cjs <tile> <theme> <out.webp> [fps]  : renders tiles.html frame by frame (deterministic, setTime(t)) and encodes an animated WebP
const { chromium } = (() => { try { return require("playwright"); } catch { return require(require("child_process").execSync("npm root -g").toString().trim() + "/playwright"); } })();
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const [tile, theme, outWebp, fpsArg, qArg] = process.argv.slice(2);
const FPS = +(fpsArg || 10), Q = qArg || "85";
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 1 });
  p.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
  p.on("console", (m) => { if (m.type() === "error") console.error("CONSOLE", m.text()); });
  await p.goto(`file://${__dirname}/tiles.html?tile=${tile}&theme=${theme}`);
  await p.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 200));
  const info = await p.evaluate(() => window.TILE_INFO);
  const n = Math.round(info.D * FPS);
  const dir = `${require("os").tmpdir()}/readme-tiles/${tile}-${theme}`;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < n; i++) {
    await p.evaluate((t) => window.setTime(t), i / FPS);
    await p.screenshot({ path: `${dir}/f${String(i).padStart(4, "0")}.png`, clip: { x: 0, y: 0, width: info.w, height: info.h }, omitBackground: true });
  }
  await b.close();
  if (outWebp) {
    execFileSync("ffmpeg", ["-y", "-v", "error", "-framerate", String(FPS), "-i", `${dir}/f%04d.png`, "-c:v", "libwebp_anim", "-lossless", "0", "-q:v", Q, "-compression_level", "6", "-pix_fmt", "bgra", "-loop", "0", outWebp]);
    console.log(`${path.basename(outWebp)}: ${info.w}x${info.h}, ${n} frames @ ${FPS} fps, ${(fs.statSync(outWebp).size / 1024).toFixed(0)} KB`);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
