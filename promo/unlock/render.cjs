// Renderiza index.html quadro a quadro e gera os MP4 finais.
//
//   NODE_PATH=$(npm root -g) node render.cjs            -> com textos + sem textos
//   NODE_PATH=$(npm root -g) node render.cjs --so-com   -> apenas a versão com textos
//
// Requer: Playwright (Chromium), ffmpeg e python3 com numpy (para a trilha).
const { chromium } = require("playwright");
const { spawn, execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const FPS = 30;
const DIR = __dirname;
const OUT = path.join(DIR, "output");
fs.mkdirSync(OUT, { recursive: true });

async function renderVideo(page, query, file, audio) {
  const url = "file://" + path.join(DIR, "index.html") + "?render" + query;
  await page.goto(url);
  await page.evaluate(() => window.ready);
  const dur = await page.evaluate(() => window.DURATION);
  const frames = Math.round(dur * FPS);

  const ff = spawn("ffmpeg", [
    "-y", "-v", "error",
    "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
    "-i", audio,
    "-map", "0:v", "-map", "1:a",
    "-c:v", "libx264", "-preset", "slow", "-crf", "19", "-maxrate", "12M", "-bufsize", "24M", "-pix_fmt", "yuv420p", "-profile:v", "high",
    "-r", String(FPS), "-g", String(FPS),
    "-c:a", "aac", "-b:a", "192k", "-af", "loudnorm=I=-14:TP=-1.0:LRA=9",
    "-shortest", "-movflags", "+faststart", file,
  ], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((res, rej) => ff.on("close", c => (c ? rej(new Error("ffmpeg " + c)) : res())));

  for (let f = 0; f < frames; f++) {
    await page.evaluate(t => window.renderAt(t), f / FPS);
    const buf = await page.screenshot({ type: "jpeg", quality: 96, animations: "disabled", caret: "hide" });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once("drain", r));
    if (f % 30 === 0) process.stdout.write(`\r${path.basename(file)}  ${f}/${frames}`);
  }
  ff.stdin.end();
  await done;
  process.stdout.write(`\r${path.basename(file)}  ${frames}/${frames}  ok\n`);
}

(async () => {
  const audio = path.join(OUT, "trilha-unlock.wav");
  execFileSync("python3", [path.join(DIR, "trilha.py"), audio], { stdio: "inherit" });

  const browser = await chromium.launch({ args: ["--allow-file-access-from-files", "--font-render-hinting=none"] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await renderVideo(page, "", path.join(OUT, "unlock-promo-com-textos.mp4"), audio);
  if (!process.argv.includes("--so-com")) {
    await renderVideo(page, "&semtexto", path.join(OUT, "unlock-promo-sem-textos.mp4"), audio);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
