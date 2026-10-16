// Renderiza a versão 2 com motion blur real (4 subquadros por quadro).
//
//   NODE_PATH=$(npm root -g) node render.cjs
//
// Gera output/unlock-v2.mp4 (~7 MB, alta qualidade).
// Requer: Playwright (Chromium), ffmpeg e python3 com numpy.
const { chromium } = require("playwright");
const { spawn, execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const FPS = 30, SUB = 4;
const DIR = __dirname, OUT = path.join(DIR, "output");
fs.mkdirSync(OUT, { recursive: true });
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });

(async () => {
  const audio = path.join(OUT, "trilha-v2.wav");
  run("python3", [path.join(DIR, "trilha.py"), audio]);

  const browser = await chromium.launch({ args: ["--allow-file-access-from-files", "--font-render-hinting=none"] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on("pageerror", e => console.error("page error:", e.message));
  await page.goto("file://" + path.join(DIR, "index.html") + "?render");
  await page.evaluate(() => window.ready);
  const dur = await page.evaluate(() => window.DURATION);
  const total = Math.round(dur * FPS) * SUB;

  const file = path.join(OUT, "unlock-v2.mp4");
  // tmix averages each group of SUB subframes -> real motion blur
  const ff = spawn("ffmpeg", [
    "-y", "-v", "error",
    "-f", "image2pipe", "-framerate", String(FPS * SUB), "-c:v", "mjpeg", "-i", "-",
    "-i", audio, "-map", "0:v", "-map", "1:a",
    "-vf", `tmix=frames=${SUB},select='eq(mod(n\\,${SUB})\\,${SUB - 1})',setpts=N/(${FPS}*TB)`,
    "-r", String(FPS),
    "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-maxrate", "12M", "-bufsize", "24M", "-pix_fmt", "yuv420p", "-profile:v", "high", "-g", String(FPS),
    "-c:a", "aac", "-b:a", "192k", "-af", "loudnorm=I=-14:TP=-1.0:LRA=9",
    "-shortest", "-movflags", "+faststart", file,
  ], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((res, rej) => ff.on("close", c => (c ? rej(new Error("ffmpeg " + c)) : res())));

  for (let i = 0; i < total; i++) {
    await page.evaluate(t => window.renderAt(t), i / (FPS * SUB));
    const buf = await page.screenshot({ type: "jpeg", quality: 95, animations: "disabled", caret: "hide" });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once("drain", r));
    if (i % 120 === 0) process.stdout.write(`\rsubquadros ${i}/${total}`);
  }
  ff.stdin.end();
  await done;
  await browser.close();
  process.stdout.write(`\rsubquadros ${total}/${total}  ok\n`);

  console.log("pronto:", file);
})().catch(e => { console.error(e); process.exit(1); });
