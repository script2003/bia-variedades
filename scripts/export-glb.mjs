// Exporta os seis modelos 3D da exposição para arquivos GLB em public/models/.
// Uso: npm run build && npx vite preview --port 4173 (em outro terminal) e depois
//      npx -p playwright node scripts/export-glb.mjs [url]
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url = process.argv[2] || 'http://localhost:4173/';
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public/models');
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__exhibit && document.body.classList.contains('ready'), null, { timeout: 120000 });

const ids = await page.evaluate(() => Object.keys(window.__exhibit.items));
for (const id of ids) {
  const { file, b64 } = await page.evaluate(async (id) => {
    const buf = await window.__exhibit.exportGLB(id);
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { file: window.__exhibit.MODELS[id].file, b64: btoa(bin) };
  }, id);
  const data = Buffer.from(b64, 'base64');
  await writeFile(resolve(outDir, file), data);
  console.log(`${file}  ${(data.length / 1024 / 1024).toFixed(2)} MB`);
}
await browser.close();
