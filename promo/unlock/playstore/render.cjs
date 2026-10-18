// Vídeo da Play Store em 9:16 (1080 × 1920, 30 fps): Play Store → pesquisa → instalação, com mouse.
// Som: só cliques de mouse e teclas (sons.py).
//
//   NODE_PATH=$(npm root -g) node render.cjs
//
// Usa as gravações em fonte/ e gera output/alpha-mouse-pro-playstore.mp4.
const { chromium } = require("playwright");
const { spawn, execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const FPS = 30;
const DIR = __dirname, OUT = path.join(DIR, "output"), FR = path.join(DIR, "frames");
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(FR, { recursive: true });
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });

(async () => {
  if (!fs.existsSync(path.join(FR, "b_0001.jpg"))) {
    run("ffmpeg", ["-v", "error", "-y", "-i", path.join(DIR, "fonte", "1-pesquisa.mp4"), "-vf", "fps=30", "-q:v", "2", path.join(FR, "a_%04d.jpg")]);
    run("ffmpeg", ["-v", "error", "-y", "-i", path.join(DIR, "fonte", "2-app.mp4"), "-vf", "fps=30", "-q:v", "2", path.join(FR, "b_%04d.jpg")]);
  }
  const browser = await chromium.launch({ args: ["--allow-file-access-from-files", "--font-render-hinting=none"] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on("pageerror", e => console.error("page error:", e.message));
  await page.goto("file://" + path.join(DIR, "index.html") + "?render");
  await page.evaluate(() => window.ready);
  const dur = await page.evaluate(() => window.DURATION);
  const frames = Math.round(dur * FPS);
  const cliques = path.join(OUT, "cliques.json"), sons = path.join(OUT, "sons.wav");
  fs.writeFileSync(cliques, JSON.stringify(await page.evaluate(() => window.CLICKS)));
  run("python3", [path.join(DIR, "sons.py"), cliques, String(dur), sons]);

  const file = path.join(OUT, "alpha-mouse-pro-playstore.mp4");
  const ff = spawn("ffmpeg", [
    "-y", "-v", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
    "-i", sons, "-map", "0:v", "-map", "1:a",
    "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-maxrate", "12M", "-bufsize", "24M", "-pix_fmt", "yuv420p", "-profile:v", "high",
    "-r", String(FPS), "-g", String(FPS), "-c:a", "aac", "-b:a", "192k", "-af", "alimiter=level_in=3:limit=0.84:attack=0.3:release=25:level=false", "-ar", "44100", "-shortest", "-movflags", "+faststart", file,
  ], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((res, rej) => ff.on("close", c => (c ? rej(new Error("ffmpeg " + c)) : res())));
  for (let i = 0; i < frames; i++) {
    await page.evaluate(async t => { await window.renderAt(t); }, i / FPS);
    const buf = await page.screenshot({ type: "jpeg", quality: 95, animations: "disabled", caret: "hide" });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once("drain", r));
    if (i % 60 === 0) process.stdout.write(`\rquadros ${i}/${frames}`);
  }
  ff.stdin.end();
  await done;
  await browser.close();
  console.log(`\rquadros ${frames}/${frames}  ok\npronto: ${file}`);
})().catch(e => { console.error(e); process.exit(1); });
