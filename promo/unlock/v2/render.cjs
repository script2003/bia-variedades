// Renderiza a versão 2 com motion blur real (4 subquadros por quadro).
//
//   NODE_PATH=$(npm root -g) node render.cjs
//
// Gera output/unlock-v2.mp4 (só música) e output/unlock-v2-narrado.mp4 (com narração).
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

  // narrated copy: voice + music that ducks under the voice
  const voz = path.join(OUT, "narracao.wav"), narrado = path.join(OUT, "unlock-v2-narrado.mp4");
  run("python3", [path.join(DIR, "narracao.py"), voz]);
  // light processing only: echo and heavy compression made the voice sound synthetic
  const vf = "aresample=44100,highpass=f=80,equalizer=f=2800:t=q:w=1.5:g=1.5," +
    "acompressor=threshold=-18dB:ratio=2:attack=10:release=150:makeup=2,pan=stereo|c0=c0|c1=c0";
  const duck = "sidechaincompress=threshold=0.02:ratio=4:attack=10:release=300:makeup=1";
  run("ffmpeg", ["-y", "-v", "error", "-i", file, "-i", audio, "-i", voz, "-filter_complex",
    `[2:a]${vf},asplit=2[v][sc];[1:a]volume=0.75[m0];[m0][sc]${duck}[m];[m][v]amix=inputs=2:normalize=0,alimiter=limit=0.95,loudnorm=I=-14:TP=-1.0:LRA=9[a]`,
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-shortest", "-movflags", "+faststart", narrado]);

  console.log("pronto:", file, narrado);
})().catch(e => { console.error(e); process.exit(1); });
