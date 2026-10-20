import * as THREE from 'three';
import {
  rbox, box, cyl, cylAlong, lathe, merged, boxG, wireRackG, mesh, extrude,
  roundedRectShape, roundedRectHole, invert, decal, Toggle, noCast, tube, plug,
} from '../lib/geo.js';
import { drawTexture } from '../lib/textures.js';

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// Fogão de piso contemporâneo: 5 queimadores, mesa de vidro temperado, inox e porta de vidro.
export function createStoveModern(M) {
  const g = new THREE.Group();
  g.name = 'Fogao_atual_inox';
  const W = 0.76, D = 0.62, zf = D / 2;
  const TOP = 0.877;

  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(cyl(0.017, 0.019, 0.045, M.plasticBlack, sx * (W / 2 - 0.05), 0.0225, sz * (D / 2 - 0.07)));
  }
  g.add(box(W - 0.04, 0.055, 0.02, M.plasticBlack, 0, 0.0725, zf - 0.035));
  for (const s of [-1, 1]) g.add(rbox(0.012, 0.8, D, 0.004, M.steel, s * (W / 2 - 0.006), 0.445, 0));
  g.add(box(W - 0.024, 0.8, 0.015, M.galvanized, 0, 0.445, -zf + 0.0075));

  // Mesa: moldura de inox e vidro temperado preto
  g.add(rbox(W, 0.025, D, 0.005, M.steel, 0, 0.8575, 0));
  g.add(rbox(W - 0.012, 0.007, D - 0.05, 0.003, M.blackGlass, 0, 0.8735, 0.012));
  g.add(rbox(W, 0.045, 0.034, 0.006, M.steel, 0, 0.8925, -zf + 0.017));

  // Painel de comandos
  g.add(rbox(W - 0.024, 0.075, 0.04, 0.006, M.steel, 0, 0.8075, zf - 0.02));
  const knobXs = [-0.315, -0.225, -0.135, 0.135, 0.225, 0.315];
  const iconTex = drawTexture(1024, 100, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.strokeStyle = '#26282b';
    c.fillStyle = '#26282b';
    c.lineWidth = 2;
    const toPx = (x) => ((x + 0.368) / 0.736) * w;
    // posição de cada queimador no diagrama: [x, y] em -1..1
    const pos = [[-1, 1], [-1, -1], [0, 0], [1, -1], [1, 1]];
    knobXs.forEach((x, i) => {
      const px = toPx(x), py = h - 16;
      if (i === 5) {
        c.strokeRect(px - 11, py - 9, 22, 18);
        c.beginPath(); c.moveTo(px - 11, py - 3); c.lineTo(px + 11, py - 3); c.stroke();
        return;
      }
      c.strokeRect(px - 14, py - 10, 28, 20);
      pos.forEach(([bx, by], k) => {
        c.beginPath();
        c.arc(px + bx * 8, py + by * 5, k === 2 ? 3.5 : 2.6, 0, Math.PI * 2);
        if (k === i) c.fill(); else c.stroke();
      });
    });
  });
  g.add(decal(0.736, 0.072, iconTex, { y: 0.8075, z: zf + 0.0008 }));

  const knob = (x) => {
    const k = new THREE.Group();
    k.add(cylAlong('z', 0.025, 0.003, M.plasticBlack, 0, 0, 0.0015, 40));
    const inner = new THREE.Group();
    inner.rotation.x = Math.PI / 2;
    inner.add(lathe([[0, 0], [0.0205, 0], [0.021, 0.004], [0.0205, 0.022], [0.019, 0.026], [0, 0.0272]], M.steelSatin, 40));
    k.add(inner);
    k.add(box(0.003, 0.013, 0.002, M.plasticBlack, 0, 0.009, 0.0275));
    k.position.set(x, 0.8075, zf);
    return k;
  };
  knobXs.forEach((x) => g.add(knob(x)));

  // Relógio/timer digital discreto
  g.add(rbox(0.13, 0.044, 0.006, 0.003, M.blackGlass, 0, 0.8075, zf + 0.003));
  const dispTex = drawTexture(384, 128, (c, w, h) => {
    c.fillStyle = '#000';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#bfe6ff';
    c.font = '600 64px "Courier New", monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('12:45', w / 2, h / 2 + 2);
    c.font = '600 30px Arial, sans-serif';
    c.fillStyle = '#8fb6cf';
    c.fillText('−', 28, h / 2);
    c.fillText('+', w - 28, h / 2);
    c.beginPath(); c.arc(w / 2 + 112, 26, 9, 0, Math.PI * 2); c.lineWidth = 2; c.strokeStyle = '#8fb6cf'; c.stroke();
  });
  g.add(decal(0.12, 0.04, dispTex, { y: 0.8075, z: zf + 0.0062, emissive: true, transparent: false }));

  // Porta do forno com vidro serigrafado e visor
  const doorPivot = new THREE.Group();
  doorPivot.position.set(0, 0.1, zf);
  g.add(doorPivot);
  const DW = W - 0.03, DH = 0.66, WIN = { w: 0.52, h: 0.3, cy: 0.04 };
  const fShape = roundedRectShape(DW, DH, 0.006);
  fShape.holes.push(roundedRectHole(WIN.w, WIN.h, 0.02, 0, WIN.cy));
  const frame = extrude(fShape, 0.03, M.steel, { curveSegments: 6 });
  frame.position.set(0, DH / 2, -0.023);
  doorPivot.add(frame);

  const printTex = drawTexture(512, 464, (c, w, h) => {
    c.fillStyle = 'rgba(8,8,10,1)';
    c.fillRect(0, 0, w, h);
    const ww = (WIN.w / DW) * w, wh = (WIN.h / DH) * h;
    const cx = w / 2, cy = h / 2 - (WIN.cy / DH) * h;
    c.globalCompositeOperation = 'destination-out';
    roundRect(c, cx - ww / 2, cy - wh / 2, ww, wh, 14);
    c.fill();
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = 'rgba(14,14,16,0.5)';
    roundRect(c, cx - ww / 2, cy - wh / 2, ww, wh, 14);
    c.fill();
  });
  const doorGlass = new THREE.MeshPhysicalMaterial({
    name: 'Vidro serigrafado', map: printTex, transparent: true, roughness: 0.04, specularIntensity: 0.7, envMapIntensity: 0.7,
  });
  const pane = mesh(new THREE.BoxGeometry(DW, DH, 0.008),
    [M.blackGlass, M.blackGlass, M.blackGlass, M.blackGlass, doorGlass, doorGlass], 0, DH / 2, -0.004);
  doorPivot.add(pane);
  const innerPane = mesh(new THREE.PlaneGeometry(WIN.w, WIN.h), M.clearGlass, 0, DH / 2 + WIN.cy, -0.032);
  innerPane.castShadow = false;
  doorPivot.add(innerPane);
  doorPivot.add(cylAlong('x', 0.012, 0.62, M.steel, 0, DH - 0.045, 0.05));
  for (const s of [-1, 1]) doorPivot.add(cylAlong('z', 0.008, 0.05, M.steelSatin, s * 0.27, DH - 0.045, 0.025, 16));

  // Cavidade do forno
  const cav = { w: 0.62, h: 0.5, d: 0.5, y: 0.43, z: zf - 0.045 };
  const cavity = mesh(invert(new THREE.BoxGeometry(cav.w, cav.h, cav.d)), M.ovenDark, 0, cav.y, cav.z - cav.d / 2);
  cavity.castShadow = false;
  g.add(cavity);
  const ofShape = roundedRectShape(W - 0.024, 0.67, 0.004);
  ofShape.holes.push(roundedRectHole(cav.w, cav.h, 0.012));
  const oFrame = extrude(ofShape, 0.012, M.enamelBlack, { curveSegments: 6 });
  oFrame.position.set(0, cav.y, cav.z - 0.008);
  g.add(oFrame);
  const inside = new THREE.Group();
  for (const s of [-1, 1]) for (const yy of [0.28, 0.4, 0.52]) {
    inside.add(box(0.012, 0.008, cav.d - 0.06, M.ovenDark, s * (cav.w / 2 - 0.006), yy, cav.z - cav.d / 2));
  }
  for (const yy of [0.292, 0.412]) {
    inside.add(mesh(wireRackG(cav.w - 0.03, cav.d - 0.07, 0.0022, 16), M.chrome, 0, yy, cav.z - cav.d / 2 + 0.01));
  }
  inside.add(box(cav.w - 0.02, 0.006, cav.d - 0.04, M.ovenDark, 0, cav.y - cav.h / 2 + 0.008, cav.z - cav.d / 2));
  const lampMat = M.lampWarm.clone();
  inside.add(rbox(0.05, 0.035, 0.01, 0.004, lampMat, 0.23, 0.63, cav.z - cav.d + 0.006));
  g.add(noCast(inside));

  // Queimadores: 4 comuns + 1 tripla chama no centro
  const burnerG = new THREE.Group();
  const ports = (r, n, y) => {
    const list = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      list.push(boxG(0.005, 0.003, 0.004).rotateY(-a).translate(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    return list;
  };
  const regular = (x, z, r) => {
    const b = new THREE.Group();
    b.position.set(x, TOP, z);
    b.add(cyl(r + 0.013, r + 0.013, 0.002, M.steelSatin, 0, 0.001, 0, 40));
    b.add(cyl(r, r + 0.002, 0.016, M.aluminum, 0, 0.01, 0, 36));
    b.add(merged(ports(r, 20, 0.014), M.plasticBlack));
    const cap = lathe([[0, 0], [r - 0.003, 0], [r - 0.002, 0.003], [r - 0.007, 0.006], [0, 0.0072]], M.enamelBlack, 36);
    cap.position.y = 0.018;
    b.add(cap);
    b.add(cyl(0.0035, 0.0035, 0.016, M.ceramic, r + 0.008, 0.008, 0, 12));
    b.add(cyl(0.0012, 0.0012, 0.006, M.chrome, r + 0.008, 0.019, 0, 8));
    b.add(cyl(0.0022, 0.0022, 0.02, M.copper, -(r + 0.008), 0.01, 0, 10));
    burnerG.add(b);
  };
  regular(-0.21, 0.14, 0.04);
  regular(0.21, 0.14, 0.04);
  regular(-0.21, -0.13, 0.033);
  regular(0.21, -0.13, 0.033);
  {
    const b = new THREE.Group();
    b.position.set(0, TOP, 0.005);
    b.add(cyl(0.082, 0.082, 0.002, M.steelSatin, 0, 0.001, 0, 56));
    b.add(cyl(0.045, 0.045, 0.004, M.plasticBlack, 0, 0.003, 0, 40));
    b.add(lathe([[0.046, 0], [0.068, 0], [0.068, 0.016], [0.046, 0.016], [0.046, 0]], M.aluminum, 56));
    b.add(merged(ports(0.068, 32, 0.012), M.plasticBlack));
    b.add(lathe([[0.047, 0.016], [0.067, 0.016], [0.066, 0.02], [0.06, 0.023], [0.052, 0.023], [0.047, 0.02], [0.047, 0.016]], M.enamelBlack, 56));
    b.add(cyl(0.03, 0.031, 0.02, M.aluminum, 0, 0.01, 0, 32));
    b.add(merged(ports(0.03, 14, 0.016), M.plasticBlack));
    const cap = lathe([[0, 0], [0.027, 0], [0.028, 0.003], [0.023, 0.006], [0, 0.007]], M.enamelBlack, 32);
    cap.position.y = 0.02;
    b.add(cap);
    b.add(cyl(0.0035, 0.0035, 0.016, M.ceramic, 0.077, 0.008, 0, 12));
    b.add(cyl(0.0022, 0.0022, 0.02, M.copper, -0.077, 0.01, 0, 10));
    burnerG.add(b);
  }
  g.add(burnerG);

  // Grades de ferro fundido em três seções
  const T = 0.011, HB = 0.012, YB = TOP + 0.024;
  const grate = (x0, x1, z0, z1, cross, burners) => {
    const list = [];
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
    list.push(boxG(w, HB, T, cx, YB, z0 + T / 2), boxG(w, HB, T, cx, YB, z1 - T / 2));
    list.push(boxG(T, HB, d, x0 + T / 2, YB, cz), boxG(T, HB, d, x1 - T / 2, YB, cz));
    cross.forEach((zc) => list.push(boxG(w, HB, T, cx, YB, zc)));
    const zs = [z0, z1, ...cross].sort((a, b) => a - b);
    burners.forEach(([bx, bz, rin]) => {
      const zBelow = Math.max(...zs.filter((v) => v < bz - rin));
      const zAbove = Math.min(...zs.filter((v) => v > bz + rin));
      const seg = (a, b, axis) => {
        const len = Math.abs(b - a);
        if (len < 0.008) return;
        const m = (a + b) / 2;
        list.push(axis === 'x' ? boxG(len, HB + 0.004, T, m, YB + 0.002, bz) : boxG(T, HB + 0.004, len, bx, YB + 0.002, m));
      };
      seg(x0, bx - rin, 'x');
      seg(bx + rin, x1, 'x');
      seg(zBelow, bz - rin, 'z');
      seg(bz + rin, zAbove, 'z');
    });
    for (const [px, pz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      list.push(boxG(0.014, YB - TOP, 0.014, px + Math.sign(cx - px) * 0.01, TOP + (YB - TOP) / 2, pz + Math.sign(cz - pz) * 0.01));
    }
    g.add(merged(list, M.castIron));
  };
  grate(-0.372, -0.112, -0.268, 0.292, [0.005], [[-0.21, 0.14, 0.06], [-0.21, -0.13, 0.052]]);
  grate(0.112, 0.372, -0.268, 0.292, [0.005], [[0.21, 0.14, 0.06], [0.21, -0.13, 0.052]]);
  grate(-0.106, 0.106, -0.268, 0.292, [-0.125, 0.135], [[0, 0.005, 0.092]]);

  // Tampa de vidro temperado articulada na traseira
  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, 0.918, -zf + 0.02);
  g.add(lidPivot);
  const lidTex = drawTexture(512, 400, (c, w, h) => {
    c.fillStyle = 'rgba(10,10,12,0.95)';
    c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = 'destination-out';
    roundRect(c, 22, 22, w - 44, h - 44, 10);
    c.fill();
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = 'rgba(20,24,28,0.28)';
    roundRect(c, 22, 22, w - 44, h - 44, 10);
    c.fill();
  });
  const lidMat = new THREE.MeshPhysicalMaterial({
    name: 'Tampa de vidro', map: lidTex, transparent: true, roughness: 0.03, clearcoat: 1, depthWrite: false,
  });
  const lid = rbox(W - 0.012, 0.006, 0.585, 0.003, lidMat, 0, 0, 0.2925, 2);
  lid.castShadow = false;
  lidPivot.add(lid);
  for (const s of [-1, 1]) g.add(rbox(0.032, 0.03, 0.03, 0.006, M.steelSatin, s * 0.3, 0.912, -zf + 0.02));

  // Entrada de gás, cabo do acendimento elétrico e etiqueta traseira
  g.add(tube([[-0.3, 0.14, -zf - 0.004], [-0.31, 0.1, -zf - 0.04], [-0.32, 0.02, -zf - 0.12], [-0.33, 0.006, -0.6]], 0.0035, M.plasticBlack, 24));
  g.add(plug(-0.33, 0, -0.6, M.plasticWhite, M.steelSatin));
  g.add(cylAlong('z', 0.011, 0.05, M.brass, 0.28, 0.12, -zf - 0.025, 16));
  g.add(cylAlong('z', 0.016, 0.014, M.brass, 0.28, 0.12, -zf - 0.048, 6));
  const label = drawTexture(256, 160, (c, w, h) => {
    c.fillStyle = '#e9e9e6'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#222'; c.font = 'bold 18px Arial'; c.fillText('FOGÃO A GÁS · 5 QUEIMADORES', 12, 30);
    c.font = '15px Arial';
    ['Gás: GLP / GN (conversão)', 'Acendimento: 127/220 V ~ 60 Hz', 'Válvula de segurança no forno', 'Siga o manual de instalação'].forEach((t, i) => c.fillText(t, 12, 62 + i * 24));
  }, { srgb: true });
  g.add(decal(0.16, 0.1, label, { x: -0.18, y: 0.6, z: -zf - 0.0005, transparent: false }).rotateY(Math.PI));

  const door = new Toggle((e) => {
    doorPivot.rotation.x = e * 1.45;
    lampMat.emissiveIntensity = e * 2.6;
  }, 1.1);
  const lidT = new Toggle((e) => { lidPivot.rotation.x = -(Math.PI / 2 + 0.06) * (1 - e); }, 1.2);
  return {
    object: g,
    actions: [
      { id: 'door', label: 'Abrir forno', activeLabel: 'Fechar forno', toggle: door },
      { id: 'lid', label: 'Fechar tampa de vidro', activeLabel: 'Abrir tampa de vidro', toggle: lidT },
    ],
    update: (dt) => door.update(dt) | lidT.update(dt),
  };
}
