// Coloca o vídeo da Play Store (tela inteira 1080 × 2400) dentro do celular do modelo.
//
//   NODE_PATH=$(npm root -g) node render-com-video.cjs
//
// Usa ../playstore/index.html?render&full, o modelo output/modelo-celular-tela-verde.mp4 e os sons
// ../playstore/output/sons.wav. Gera output/alpha-mouse-pro-no-celular.mp4.
const { chromium } = require("playwright");
const { spawn, execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const FPS = 30, DIR = __dirname, PS = path.join(DIR, "..", "playstore");
const OUT = path.join(DIR, "output");
// green screen of the template: x 224, y 278, 632 × 1362; the mask is 2 px larger to hide the green edge
const SX = 222, SY = 276, SW = 636, SH = 1366;

(async () => {
  if (!fs.existsSync(path.join(PS, "frames", "b_0001.jpg")) || !fs.existsSync(path.join(PS, "output", "sons.wav"))) {
    execFileSync("node", [path.join(PS, "render.cjs")], { stdio: "inherit", env: process.env });   // builds frames + sounds
  }
  const browser = await chromium.launch({ args: ["--allow-file-access-from-files", "--font-render-hinting=none"] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 2400 }, deviceScaleFactor: 1 });
  page.on("pageerror", e => console.error("page error:", e.message));
  await page.goto("file://" + path.join(PS, "index.html") + "?render&full");
  await page.evaluate(() => window.ready);
  const dur = await page.evaluate(() => window.DURATION);
  const frames = Math.round(dur * FPS);
  const file = path.join(OUT, "alpha-mouse-pro-no-celular.mp4");
  const ff = spawn("ffmpeg", [
    "-y", "-v", "error",
    "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
    "-i", path.join(OUT, "modelo-celular-tela-verde.mp4"),
    "-i", path.join(PS, "output", "sons.wav"),
    "-loop", "1", "-i", path.join(DIR, "mascara-tela.png"),
    "-filter_complex",
    // cover the screen (scale to its width, trim top/bottom evenly), round the corners, place it in the phone
    `[0:v]scale=${SW}:-2:flags=lanczos,crop=${SW}:${SH},format=yuva420p[scr];[3:v]format=gray,scale=${SW}:${SH}[m];[scr][m]alphamerge[scrm];` +
    `[1:v][scrm]overlay=${SX}:${SY}:shortest=1,format=yuv420p[v]`,
    "-map", "[v]", "-map", "2:a",
    "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-maxrate", "12M", "-bufsize", "24M", "-pix_fmt", "yuv420p", "-profile:v", "high", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "192k", "-af", "alimiter=level_in=4.2:limit=0.6:attack=0.3:release=25:level=false", "-ar", "44100",
    "-t", dur.toFixed(3), "-movflags", "+faststart", file,
  ], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((res, rej) => ff.on("close", c => (c ? rej(new Error("ffmpeg " + c)) : res())));
  for (let i = 0; i < frames; i++) {
    await page.evaluate(async t => { await window.renderAt(t); }, i / FPS);
    const buf = await page.screenshot({ type: "jpeg", quality: 95, animations: "disabled", caret: "hide" });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once("drain", r));
    if (i % 60 === 0) process.stdout.write(`\rquadros ${i}/${frames}`);
  }
  ff.stdin.end(); await done; await browser.close();
  console.log(`\rquadros ${frames}/${frames}  ok\npronto: ${file}`);
})().catch(e => { console.error(e); process.exit(1); });
