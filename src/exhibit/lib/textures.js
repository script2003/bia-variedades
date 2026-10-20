import * as THREE from 'three';

// Texturas procedurais geradas em <canvas>: nenhuma imagem externa é necessária
// e todas são exportadas junto com os modelos GLB.

export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d') };
}

export function toTexture(canvas, { srgb = true, repeat = null, anisotropy = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

/** Desenha numa textura com uma função livre. */
export function drawTexture(w, h, draw, opts) {
  const { c, g } = makeCanvas(w, h);
  draw(g, w, h);
  return toTexture(c, opts);
}

// Ruído de valor simples para veios de madeira
function valueNoise(seed) {
  const r = rng(seed);
  const N = 256;
  const perm = new Uint8Array(N * 2);
  const vals = new Float32Array(N);
  for (let i = 0; i < N; i++) { perm[i] = i; vals[i] = r(); }
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < N; i++) perm[N + i] = perm[i];
  const sm = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const a = vals[perm[X + perm[Y]]], b = vals[perm[X + 1 + perm[Y]]];
    const c = vals[perm[X + perm[Y + 1]]], d = vals[perm[X + 1 + perm[Y + 1]]];
    const u = sm(xf), v = sm(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

/** Esmalte vitrificado envelhecido: cor com manchas leves, pontos e lascas. */
export function enamelTextures(base, seed, wear = 1) {
  const S = 512;
  const r = rng(seed);
  const col = makeCanvas(S, S);
  const rough = makeCanvas(S, S);
  col.g.fillStyle = base;
  col.g.fillRect(0, 0, S, S);
  rough.g.fillStyle = 'rgb(62,62,62)';
  rough.g.fillRect(0, 0, S, S);

  for (let i = 0; i < 260; i++) {
    const x = r() * S, y = r() * S, rad = 12 + r() * 70;
    const a = 0.03 * r() * wear + 0.01;
    const warm = r() < 0.55;
    const gc = col.g.createRadialGradient(x, y, 0, x, y, rad);
    gc.addColorStop(0, warm ? `rgba(150,120,70,${a})` : `rgba(255,255,250,${a})`);
    gc.addColorStop(1, 'rgba(0,0,0,0)');
    col.g.fillStyle = gc;
    col.g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    const gr = rough.g.createRadialGradient(x, y, 0, x, y, rad);
    const v = warm ? 110 : 40;
    gr.addColorStop(0, `rgba(${v},${v},${v},${0.25 * wear})`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    rough.g.fillStyle = gr;
    rough.g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // micro riscos (aparecem só no brilho)
  rough.g.lineWidth = 0.6;
  for (let i = 0; i < 160 * wear; i++) {
    const x = r() * S, y = r() * S, a = r() * Math.PI, l = 8 + r() * 50;
    rough.g.strokeStyle = `rgba(170,170,170,${0.15 + r() * 0.25})`;
    rough.g.beginPath();
    rough.g.moveTo(x, y);
    rough.g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    rough.g.stroke();
  }
  // pontinhos
  for (let i = 0; i < 1400 * wear; i++) {
    col.g.fillStyle = `rgba(70,58,44,${0.08 + r() * 0.2})`;
    col.g.fillRect(r() * S, r() * S, 1, 1);
  }
  // lascas do esmalte mostrando o ferro
  for (let i = 0; i < 9 * wear; i++) {
    const x = r() * S, y = r() * S, rad = 0.9 + r() * 2.2;
    col.g.fillStyle = 'rgba(255,250,240,0.5)';
    blob(col.g, x, y, rad * 1.6, r);
    col.g.fillStyle = '#2e2924';
    blob(col.g, x, y, rad, r);
    rough.g.fillStyle = 'rgb(220,220,220)';
    blob(rough.g, x, y, rad, r);
  }
  return {
    map: toTexture(col.c),
    roughnessMap: toTexture(rough.c, { srgb: false }),
  };
}

function blob(g, x, y, rad, r) {
  g.beginPath();
  const n = 9;
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * Math.PI * 2;
    const rr = rad * (0.6 + r() * 0.6);
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath();
  g.fill();
}

/** Aço inoxidável escovado: riscos horizontais finos na cor e na rugosidade. */
export function brushedTextures(seed) {
  const W = 512, H = 512;
  const r = rng(seed);
  const col = makeCanvas(W, H);
  const rough = makeCanvas(W, H);
  col.g.fillStyle = 'rgb(206,208,211)';
  col.g.fillRect(0, 0, W, H);
  rough.g.fillStyle = 'rgb(78,78,78)';
  rough.g.fillRect(0, 0, W, H);
  for (let i = 0; i < 3200; i++) {
    const y = r() * H, x = r() * W, l = 40 + r() * 400;
    const v = Math.floor(150 + r() * 105);
    col.g.strokeStyle = `rgba(${v},${v + 1},${v + 3},${0.08 + r() * 0.18})`;
    col.g.lineWidth = r() < 0.8 ? 0.6 : 1.2;
    col.g.beginPath(); col.g.moveTo(x, y); col.g.lineTo(x + l, y); col.g.stroke();
    if (x + l > W) { col.g.beginPath(); col.g.moveTo(x - W, y); col.g.lineTo(x + l - W, y); col.g.stroke(); }
    const rv = Math.floor(40 + r() * 90);
    rough.g.strokeStyle = `rgba(${rv},${rv},${rv},${0.2 + r() * 0.3})`;
    rough.g.lineWidth = 0.7;
    rough.g.beginPath(); rough.g.moveTo(x, y); rough.g.lineTo(x + l, y); rough.g.stroke();
  }
  return {
    map: toTexture(col.c, { repeat: [2, 2] }),
    roughnessMap: toTexture(rough.c, { srgb: false, repeat: [2, 2] }),
  };
}

/** Folheado de madeira (nogueira) para o gabinete da TV de tubo. */
export function woodTexture(seed) {
  const W = 512, H = 512;
  const { c, g } = makeCanvas(W, H);
  const img = g.createImageData(W, H);
  const n = valueNoise(seed);
  const fbm = (x, y) => n(x, y) * 0.55 + n(x * 2.1, y * 2.1) * 0.3 + n(x * 4.3, y * 4.3) * 0.15;
  const light = [132, 84, 48], dark = [58, 33, 18];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const warp = fbm(x * 0.006, y * 0.02) * 9;
      const v = y * 0.075 + warp;
      let ring = (Math.sin(v) + 1) / 2;
      ring = Math.pow(ring, 2.6);
      const fine = n(x * 0.35, y * 0.9);
      const pore = n(x * 0.9, y * 3.2) > 0.86 ? 0.25 : 0;
      const t = Math.min(1, ring * 0.55 + fine * 0.22 + pore + fbm(x * 0.01, y * 0.01) * 0.2);
      const i = (y * W + x) * 4;
      img.data[i] = light[0] + (dark[0] - light[0]) * t;
      img.data[i + 1] = light[1] + (dark[1] - light[1]) * t;
      img.data[i + 2] = light[2] + (dark[2] - light[2]) * t;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return toTexture(c, { repeat: [3.2, 3.2] });
}

/** Esmalte granitado (interior de forno antigo): fundo escuro com pintas claras. */
export function graniteTexture(seed, base = '#26303c', speck = '#c9d3dd', count = 5000) {
  const S = 256;
  const r = rng(seed);
  return drawTexture(S, S, (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < count; i++) {
      g.fillStyle = r() < 0.7 ? speck : '#0d1116';
      g.globalAlpha = 0.25 + r() * 0.6;
      const s = r() < 0.9 ? 1 : 2;
      g.fillRect(r() * S, r() * S, s, s);
    }
    g.globalAlpha = 1;
  }, { repeat: [3, 3] });
}

/** Barras de cores (padrão de teste analógico) com linhas de varredura. */
export function colorBarsTexture() {
  return drawTexture(512, 384, (g, w, h) => {
    const bars = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
    const bw = w / bars.length;
    bars.forEach((c, i) => { g.fillStyle = c; g.fillRect(i * bw, 0, bw + 1, h * 0.67); });
    const mid = ['#0000c0', '#131313', '#c000c0', '#131313', '#00c0c0', '#131313', '#c0c0c0'];
    mid.forEach((c, i) => { g.fillStyle = c; g.fillRect(i * bw, h * 0.67, bw + 1, h * 0.08); });
    const low = ['#00214c', '#ffffff', '#32006a', '#131313', '#090909', '#131313', '#1d1d1d'];
    const lw = w / low.length;
    low.forEach((c, i) => { g.fillStyle = c; g.fillRect(i * lw, h * 0.75, lw + 1, h * 0.25); });
    g.fillStyle = 'rgba(0,0,0,0.28)';
    for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
    // vinheta típica do tubo
    const v = g.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.62);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = v;
    g.fillRect(0, 0, w, h);
  });
}

/** Paisagem ao entardecer para a TV moderna (imagem nítida em 16:9). */
export function landscapeTexture() {
  const r = rng(42);
  return drawTexture(1280, 720, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h * 0.62);
    sky.addColorStop(0, '#0e2a5c');
    sky.addColorStop(0.45, '#3f6fb0');
    sky.addColorStop(0.8, '#f2a46a');
    sky.addColorStop(1, '#ffd59a');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h * 0.62);
    const sx = w * 0.64, sy = h * 0.56;
    const sun = g.createRadialGradient(sx, sy, 0, sx, sy, h * 0.4);
    sun.addColorStop(0, 'rgba(255,250,225,1)');
    sun.addColorStop(0.08, 'rgba(255,236,180,0.95)');
    sun.addColorStop(0.3, 'rgba(255,190,120,0.35)');
    sun.addColorStop(1, 'rgba(255,170,110,0)');
    g.fillStyle = sun;
    g.fillRect(0, 0, w, h * 0.62);
    // nuvens
    for (let i = 0; i < 26; i++) {
      const cx = r() * w, cy = h * (0.1 + r() * 0.35), cw = 80 + r() * 260;
      g.fillStyle = `rgba(255,${200 + r() * 40},${170 + r() * 50},${0.08 + r() * 0.14})`;
      g.beginPath(); g.ellipse(cx, cy, cw, 8 + r() * 14, 0, 0, Math.PI * 2); g.fill();
    }
    const ridge = (base, amp, color, seed) => {
      const rr = rng(seed);
      const pts = [];
      let y = base;
      for (let x = 0; x <= w; x += 8) {
        y += (rr() - 0.5) * amp;
        y = Math.min(base + amp * 2, Math.max(base - amp * 3, y));
        pts.push([x, y]);
      }
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(0, h * 0.62);
      pts.forEach(([x, yy]) => g.lineTo(x, yy));
      g.lineTo(w, h * 0.62);
      g.closePath();
      g.fill();
      return pts;
    };
    ridge(h * 0.44, 14, '#8a6f8f', 3);
    ridge(h * 0.5, 12, '#5b4a70', 5);
    ridge(h * 0.56, 9, '#2f2b45', 9);
    // lago com reflexo
    const water = g.createLinearGradient(0, h * 0.62, 0, h);
    water.addColorStop(0, '#f0b27c');
    water.addColorStop(0.25, '#6f6f9a');
    water.addColorStop(1, '#121a33');
    g.fillStyle = water;
    g.fillRect(0, h * 0.62, w, h * 0.38);
    g.fillStyle = 'rgba(255,240,200,0.55)';
    for (let i = 0; i < 70; i++) {
      const yy = h * 0.63 + Math.pow(r(), 1.6) * h * 0.3;
      const ww = (1 - (yy - h * 0.62) / (h * 0.38)) * 120 * r() + 10;
      g.fillRect(sx - ww / 2 + (r() - 0.5) * 40, yy, ww, 2);
    }
    // margem com árvores
    g.fillStyle = '#10131f';
    g.beginPath();
    g.moveTo(0, h);
    const shore = w * 0.4;
    for (let x = 0; x <= shore; x += 6) {
      const f = 1 - Math.pow(x / shore, 2.5);
      g.lineTo(x, h - (h * 0.2 + Math.sin(x * 0.01) * 18 + r() * 30) * f);
    }
    g.lineTo(shore, h);
    g.closePath();
    g.fill();
  });
}

/** Pontos de LED da retroiluminação. */
export function ledGridTexture() {
  return drawTexture(512, 288, (g, w, h) => {
    g.fillStyle = '#16181c';
    g.fillRect(0, 0, w, h);
    const cols = 32, rows = 18;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = (i + 0.5) * (w / cols), y = (j + 0.5) * (h / rows);
        const gr = g.createRadialGradient(x, y, 0, x, y, 6);
        gr.addColorStop(0, 'rgba(255,255,255,1)');
        gr.addColorStop(0.35, 'rgba(200,225,255,0.8)');
        gr.addColorStop(1, 'rgba(120,160,255,0)');
        g.fillStyle = gr;
        g.fillRect(x - 6, y - 6, 12, 12);
      }
    }
  });
}

/** Subpixels RGB do painel LCD. */
export function lcdTexture() {
  return drawTexture(96, 96, (g, w, h) => {
    g.fillStyle = '#060606';
    g.fillRect(0, 0, w, h);
    const cell = 12;
    for (let x = 0; x < w; x += cell) {
      for (let y = 0; y < h; y += cell) {
        g.fillStyle = '#d0262a'; g.fillRect(x + 1, y + 1, 3, cell - 2);
        g.fillStyle = '#20b84a'; g.fillRect(x + 5, y + 1, 3, cell - 2);
        g.fillStyle = '#2a5ae0'; g.fillRect(x + 9, y + 1, 2, cell - 2);
      }
    }
  }, { repeat: [26, 15] });
}
