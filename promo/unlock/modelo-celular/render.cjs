// Modelo: fundo com grade animada + celular com tela verde (9:16, 1080 × 1920, 30 fps, 30 s, sem som).
//
//   NODE_PATH=$(npm root -g) node render.cjs
//
// Gera output/modelo-celular-tela-verde.mp4 (loop perfeito) e output/previa.png.
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const FPS = 30, DIR = __dirname, OUT = path.join(DIR, "output");
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await page.goto("file://" + path.join(DIR, "index.html") + "?render");
  const frames = Math.round((await page.evaluate(() => window.DURATION)) * FPS);
  const file = path.join(OUT, "modelo-celular-tela-verde.mp4");
  const ff = spawn("ffmpeg", ["-y", "-v", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
    "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-profile:v", "high", "-r", String(FPS), "-movflags", "+faststart", file],
    { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((res, rej) => ff.on("close", c => (c ? rej(new Error("ffmpeg " + c)) : res())));
  for (let i = 0; i < frames; i++) {
    await page.evaluate(t => window.renderAt(t), i / FPS);
    const buf = await page.screenshot({ type: "png" });
    if (i === 0) fs.writeFileSync(path.join(OUT, "previa.png"), buf);
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once("drain", r));
  }
  ff.stdin.end(); await done; await browser.close();
  console.log("pronto:", file);
})().catch(e => { console.error(e); process.exit(1); });
