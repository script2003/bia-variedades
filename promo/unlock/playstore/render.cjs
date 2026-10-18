// Vídeo "como baixar na Play Store" (9:16, 1080 × 1920, 30 fps).
//
//   NODE_PATH=$(npm root -g) node render.cjs
//
// Usa as gravações em fonte/, gera output/alpha-mouse-pro-playstore.mp4.
// Requer: Playwright (Chromium), ffmpeg e python3 com numpy.
const { chromium } = require("playwright");
const { spawn, execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const FPS = 30, SUB = 2;
const DIR = __dirname, OUT = path.join(DIR, "output"), FR = path.join(DIR, "frames");
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(FR, { recursive: true });
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });

(async () => {
  if (!fs.existsSync(path.join(FR, "b_0001.jpg"))) {
    run("ffmpeg", ["-v", "error", "-y", "-i", path.join(DIR, "fonte", "1-pesquisa.mp4"), "-vf", "fps=30", "-q:v", "2", path.join(FR, "a_%04d.jpg")]);
    run("ffmpeg", ["-v", "error", "-y", "-i", path.join(DIR, "fonte", "2-app.mp4"), "-vf", "fps=30", "-q:v", "2", path.join(FR, "b_%04d.jpg")]);
  }
  const audio = path.join(OUT, "audio.wav");
  run("python3", [path.join(DIR, "audio.py"), audio]);

  const browser = await chromium.launch({ args: ["--allow-file-access-from-files", "--font-render-hinting=none"] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on("pageerror", e => console.error("page error:", e.message));
  await page.goto("file://" + path.join(DIR, "index.html") + "?render");
  await page.evaluate(() => window.ready);
  const dur = await page.evaluate(() => window.DURATION);
  const total = Math.round(dur * FPS) * SUB;

  const file = path.join(OUT, "alpha-mouse-pro-playstore.mp4");
  const ff = spawn("ffmpeg", [
    "-y", "-v", "error",
    "-f", "image2pipe", "-framerate", String(FPS * SUB), "-c:v", "mjpeg", "-i", "-",
    "-i", audio, "-map", "0:v", "-map", "1:a",
    "-vf", `tmix=frames=${SUB},select='eq(mod(n\\,${SUB})\\,${SUB - 1})',setpts=N/(${FPS}*TB)`,
    "-r", String(FPS),
    "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-maxrate", "12M", "-bufsize", "24M", "-pix_fmt", "yuv420p", "-profile:v", "high", "-g", String(FPS),
    "-c:a", "aac", "-b:a", "192k", "-af", "loudnorm=I=-14:TP=-1.5:LRA=9,alimiter=limit=0.7:level=false",
    "-ar", "44100", "-shortest", "-movflags", "+faststart", file,
  ], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((res, rej) => ff.on("close", c => (c ? rej(new Error("ffmpeg " + c)) : res())));

  for (let i = 0; i < total; i++) {
    await page.evaluate(async t => { await window.renderAt(t); }, i / (FPS * SUB));
    const buf = await page.screenshot({ type: "jpeg", quality: 95, animations: "disabled", caret: "hide" });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once("drain", r));
    if (i % 60 === 0) process.stdout.write(`\rsubquadros ${i}/${total}`);
  }
  ff.stdin.end();
  await done;
  await browser.close();
  console.log(`\rsubquadros ${total}/${total}  ok\npronto: ${file}`);
})().catch(e => { console.error(e); process.exit(1); });
