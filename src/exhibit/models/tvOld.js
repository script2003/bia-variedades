import * as THREE from 'three';
import {
  rbox, box, cyl, cylAlong, lathe, mesh, extrude, merged, boxG, tube,
  roundedRectShape, roundedRectHole, superellipsePoints, bulgedScreenGeo, funnelGeo,
  taperedBoxGeo, decal, Toggle, noCast, plug,
} from '../lib/geo.js';
import { drawTexture, colorBarsTexture } from '../lib/textures.js';

// Televisor em cores de tubo (CRT) de 20", fim dos anos 1970 / início dos 1980.
export function createTvOld(M) {
  const g = new THREE.Group();
  g.name = 'TV_antiga_tubo_CRT';
  const CY = 0.252, ZF = 0.15;
  const SX = -0.07, SY = CY + 0.012;
  const A = 0.218, Bv = 0.168, N = 5;

  // Gabinete de madeira (casca aberta na frente e atrás)
  const ws = roundedRectShape(0.632, 0.472, 0.008);
  ws.holes.push(roundedRectHole(0.596, 0.436, 0.003));
  const wood = extrude(ws, 0.292, M.wood, { bevel: 0.004, bevelSeg: 3, curveSegments: 6 });
  wood.position.set(0, CY, 0);
  g.add(wood);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cyl(0.015, 0.017, 0.012, M.rubber, sx * 0.27, 0.006, sz * 0.11, 16));

  // Moldura frontal de plástico com abertura da tela
  const bz = roundedRectShape(0.6, 0.44, 0.006);
  bz.holes.push(new THREE.Path(superellipsePoints(A - 0.006, Bv - 0.006, N, 96, SX, 0.012)));
  const bezel = extrude(bz, 0.012, M.plasticCharcoal, { bevel: 0.003, bevelSeg: 2, curveSegments: 4 });
  bezel.position.set(0, CY, ZF + 0.009);
  g.add(bezel);

  // Tela de vidro convexa
  const crtScreen = new THREE.MeshPhysicalMaterial({
    name: 'Vidro da tela CRT', color: 0x1c2220, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03,
    emissive: 0xffffff, emissiveMap: colorBarsTexture(), emissiveIntensity: 0,
  });
  const zs = 0.131;
  const screen = mesh(bulgedScreenGeo(A, Bv, N, 0.035, 48), crtScreen, SX, SY, zs);
  g.add(screen);

  // Painel de controles (alumínio escovado)
  const PX = 0.222;
  g.add(rbox(0.15, 0.42, 0.005, 0.003, M.steel, PX, CY, ZF + 0.0205));
  const PZ = ZF + 0.0232;
  const yToC = (y) => ((CY + 0.21 - y) / 0.42) * 840;
  const labels = drawTexture(300, 840, (c, w) => {
    c.clearRect(0, 0, w, 840);
    c.fillStyle = '#1b1b1b';
    c.textAlign = 'center';
    c.font = 'bold 24px Arial, sans-serif';
    c.fillText('VHF', w / 2, yToC(0.452));
    c.fillText('UHF', w / 2, yToC(0.33));
    c.font = 'bold 17px Arial, sans-serif';
    c.fillText('VOLUME', w * 0.29, yToC(0.178));
    c.fillText('BRILHO', w * 0.72, yToC(0.178));
    c.fillText('LIGA', w * 0.29, yToC(0.158) + 4);
    c.font = '15px Arial, sans-serif';
    c.fillText('PUXE', w * 0.29, yToC(0.158) + 22);
    c.font = 'italic bold 18px Georgia, serif';
    c.fillText('em cores', w / 2, yToC(0.142) + 22);
  });
  g.add(decal(0.15, 0.42, labels, { x: PX, y: CY, z: PZ + 0.0002 }));

  const vhfTex = drawTexture(256, 256, (c, w) => {
    c.fillStyle = '#d9d9d6';
    c.beginPath(); c.arc(w / 2, w / 2, w / 2, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#151515';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = 'bold 26px Arial, sans-serif';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      c.fillText(String(i + 2), w / 2 + Math.cos(a) * 100, w / 2 + Math.sin(a) * 100);
    }
  });
  g.add(mesh(new THREE.CircleGeometry(0.05, 48), new THREE.MeshStandardMaterial({ map: vhfTex, roughness: 0.35, metalness: 0.3 }), PX, 0.39, PZ));
  g.add(mesh(new THREE.TorusGeometry(0.051, 0.003, 10, 56), M.chrome, PX, 0.39, PZ));
  g.add(cylAlong('z', 0.026, 0.02, M.plasticBlack, PX, 0.39, PZ + 0.01, 32));
  const bar = rbox(0.016, 0.07, 0.026, 0.006, M.plasticBlack, PX, 0.39, PZ + 0.022);
  bar.rotation.z = -0.52;
  g.add(bar);
  g.add(cylAlong('z', 0.012, 0.003, M.chrome, PX, 0.39, PZ + 0.0355, 24));

  const uhfTex = drawTexture(192, 192, (c, w) => {
    c.fillStyle = '#d9d9d6';
    c.beginPath(); c.arc(w / 2, w / 2, w / 2, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#222';
    c.fillStyle = '#151515';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = 'bold 18px Arial, sans-serif';
    const nums = [14, 20, 30, 40, 50, 60, 70, 83];
    nums.forEach((n, i) => {
      const a = -Math.PI * 1.25 + (i / (nums.length - 1)) * Math.PI * 1.5;
      c.fillText(String(n), w / 2 + Math.cos(a) * 74, w / 2 + Math.sin(a) * 74);
    });
    for (let i = 0; i <= 40; i++) {
      const a = -Math.PI * 1.25 + (i / 40) * Math.PI * 1.5;
      c.beginPath();
      c.moveTo(w / 2 + Math.cos(a) * 52, w / 2 + Math.sin(a) * 52);
      c.lineTo(w / 2 + Math.cos(a) * (i % 5 ? 58 : 62), w / 2 + Math.sin(a) * (i % 5 ? 58 : 62));
      c.stroke();
    }
  });
  g.add(mesh(new THREE.CircleGeometry(0.034, 40), new THREE.MeshStandardMaterial({ map: uhfTex, roughness: 0.35, metalness: 0.3 }), PX, 0.28, PZ));
  g.add(mesh(new THREE.TorusGeometry(0.035, 0.0025, 10, 48), M.chrome, PX, 0.28, PZ));
  g.add(cylAlong('z', 0.015, 0.02, M.plasticBlack, PX, 0.28, PZ + 0.01, 28));
  g.add(cylAlong('z', 0.016, 0.022, M.plasticBlack, 0.19, 0.205, PZ + 0.011, 28));
  g.add(cylAlong('z', 0.012, 0.02, M.plasticBlack, 0.255, 0.205, PZ + 0.01, 24));
  for (const [x, r] of [[0.19, 0.016], [0.255, 0.012]]) g.add(box(0.002, r * 0.9, 0.002, M.chrome, x, 0.205 + r * 0.45, PZ + 0.0215));
  const ledMat = new THREE.MeshStandardMaterial({ name: 'LED vermelho', color: 0x3a0606, emissive: 0xff2010, emissiveIntensity: 0 });
  g.add(cylAlong('z', 0.003, 0.004, ledMat, 0.255, 0.16, PZ + 0.002, 12));
  const slots = [];
  for (let i = 0; i < 8; i++) slots.push(boxG(0.12, 0.004, 0.003, 0, i * 0.0105, 0));
  g.add(merged(slots, M.plasticBlack, PX, 0.052, PZ + 0.001));

  // Interior: tubo de imagem, bobina defletora, placa principal e alto-falante
  const inside = new THREE.Group();
  const zsF = zs + 0.004, L = 0.25, zE = zsF - L;
  const funnel = mesh(funnelGeo(A, Bv, N, 0.026, L), M.aquadag, SX, SY, zsF);
  inside.add(funnel);
  const bandShape = new THREE.Shape(superellipsePoints(A + 0.007, Bv + 0.007, N, 96));
  bandShape.holes.push(new THREE.Path(superellipsePoints(A + 0.001, Bv + 0.001, N, 96)));
  const bandMesh = extrude(bandShape, 0.022, M.steelSatin, { curveSegments: 4 });
  bandMesh.position.set(SX, SY, zsF - 0.012);
  inside.add(bandMesh);
  for (const [cx, cy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    inside.add(box(0.02, 0.02, 0.022, M.steelSatin, SX + cx * (A - 0.012), SY + cy * (Bv - 0.012), zsF - 0.012));
  }
  inside.add(cylAlong('z', 0.018, 0.12, M.clearGlass, SX, SY, zE - 0.06, 24));
  inside.add(cylAlong('z', 0.044, 0.055, M.copper, SX, SY, zE + 0.005, 32));
  for (const dz of [-0.026, 0.033]) inside.add(cylAlong('z', 0.048, 0.008, M.plasticBlack, SX, SY, zE + dz, 32));
  inside.add(cylAlong('z', 0.012, 0.09, M.galvanized, SX, SY, zE - 0.07, 16));
  inside.add(cylAlong('z', 0.021, 0.02, M.plasticBlack, SX, SY, zE - 0.13, 24));
  const cup = cyl(0.018, 0.02, 0.008, M.rubber, SX, SY + 0.104, zsF - 0.0875, 20);
  cup.rotation.x = -0.5;
  inside.add(cup);
  inside.add(box(0.52, 0.004, 0.4, M.pcb, -0.02, 0.05, -0.08));
  inside.add(rbox(0.05, 0.06, 0.05, 0.006, M.plasticBlack, 0.12, 0.082, -0.13));
  inside.add(tube([[SX, SY + 0.11, zsF - 0.09], [0.0, 0.3, -0.1], [0.12, 0.2, -0.14], [0.12, 0.112, -0.13]], 0.004, M.enamelBlack, 30));
  const fins = [];
  for (let i = 0; i < 7; i++) fins.push(boxG(0.002, 0.05, 0.08, i * 0.008, 0, 0));
  inside.add(merged(fins, M.aluminum, -0.2, 0.077, -0.04));
  const caps = [[-0.05, -0.02, 0.012, 0.035], [-0.02, -0.03, 0.009, 0.025], [0.03, 0.05, 0.015, 0.04], [0.18, -0.2, 0.01, 0.03], [-0.12, -0.2, 0.008, 0.02]];
  const capMat = new THREE.MeshStandardMaterial({ name: 'Capacitor', color: 0x1f3e7a, roughness: 0.4 });
  for (const [x, z, r, h] of caps) inside.add(cyl(r, r, h, capMat, x, 0.052 + h / 2, z, 16));
  inside.add(box(0.07, 0.11, 0.11, M.galvanized, PX, 0.36, 0.08));
  inside.add(cylAlong('z', 0.035, 0.04, M.castIron, PX, 0.1, 0.12, 24));
  g.add(noCast(inside));

  // Tampa traseira cônica (pode ficar transparente para mostrar o tubo)
  const hoodMat = M.plasticBrown.clone();
  const slotMat = M.plasticBlack.clone();
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  const cover = new THREE.Group();
  const hood = mesh(taperedBoxGeo(0.586, 0.426, 0.34, 0.26, 0.22, -0.05, 0), [hoodMat, hoodMat, hoodMat, hoodMat, hidden, hoodMat], 0, CY, -0.14);
  cover.add(hood);
  const hs = [];
  for (let r = 0; r < 5; r++) for (const dx of [-0.07, 0.07]) hs.push(boxG(0.12, 0.006, 0.006, -0.05 + dx, CY + 0.015 + r * 0.02, 0));
  cover.add(merged(hs, slotMat, 0, 0, -0.362));
  const ts = [];
  const slope = Math.atan2(0.083, 0.22);
  for (const t of [0.22, 0.36, 0.5, 0.64]) {
    const z = -0.14 - 0.22 * t, y = CY + 0.213 - 0.083 * t + 0.002;
    const w = 0.42 - 0.2 * t;
    ts.push(boxG(w, 0.004, 0.014).rotateX(-slope).translate(-0.05 * t, y, z));
  }
  cover.add(merged(ts, slotMat));
  const plate = drawTexture(320, 140, (c, w, h) => {
    c.fillStyle = '#d8d2c2'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#7a1b12'; c.fillRect(0, 0, w, 34);
    c.fillStyle = '#fff'; c.font = 'bold 19px Arial'; c.textAlign = 'center';
    c.fillText('ATENÇÃO — ALTA TENSÃO', w / 2, 24);
    c.fillStyle = '#222'; c.font = '15px Arial';
    ['Não remova a tampa traseira.', 'Serviço somente por técnico.', '127 V ~ 60 Hz · 90 W · PAL-M'].forEach((t, i) => c.fillText(t, w / 2, 62 + i * 24));
  });
  const plateDecal = decal(0.15, 0.066, plate, { x: -0.13, y: CY - 0.075, z: -0.3605, transparent: false });
  plateDecal.rotateY(Math.PI);
  cover.add(plateDecal);
  cover.add(rbox(0.06, 0.04, 0.008, 0.003, M.bakelite, 0.04, CY - 0.075, -0.362));
  for (const [x, y] of [[0.025, 0.01], [0.055, 0.01], [0.025, -0.01], [0.055, -0.01]]) {
    cover.add(cylAlong('z', 0.004, 0.006, M.chrome, x, CY - 0.075 + y, -0.367, 12));
  }
  g.add(cover);
  const fadeMats = [hoodMat, slotMat, plateDecal.material];
  g.add(tube([[-0.18, CY - 0.1, -0.355], [-0.19, CY - 0.13, -0.4], [-0.2, 0.03, -0.45], [-0.22, 0.006, -0.6]], 0.0035, M.plasticBlack, 24));
  g.add(plug(-0.22, 0, -0.6, M.plasticBlack, M.chrome));

  // Antena interna "orelha de coelho" com aro de UHF
  const ant = new THREE.Group();
  ant.position.set(0.02, 0.492, -0.06);
  ant.add(lathe([[0, 0], [0.055, 0], [0.056, 0.006], [0.04, 0.028], [0.02, 0.038], [0, 0.04]], M.plasticBlack, 40));
  ant.add(cyl(0.057, 0.057, 0.004, M.chrome, 0, 0.002, 0, 40));
  ant.add(mesh(new THREE.SphereGeometry(0.01, 16, 12), M.chrome, 0, 0.042, 0));
  for (const s of [-1, 1]) {
    const rod = new THREE.Group();
    rod.position.set(0, 0.042, 0);
    rod.rotation.set(-0.22, 0, s * 0.55);
    [[0.0045, 0.2, 0.1], [0.0034, 0.2, 0.29], [0.0024, 0.2, 0.48]].forEach(([r, l, y]) => rod.add(cyl(r, r, l, M.chrome, 0, y, 0, 10)));
    rod.add(mesh(new THREE.SphereGeometry(0.006, 12, 10), M.chrome, 0, 0.585, 0));
    ant.add(rod);
  }
  ant.add(cyl(0.003, 0.003, 0.04, M.chrome, 0, 0.055, -0.03, 8));
  ant.add(mesh(new THREE.TorusGeometry(0.075, 0.0025, 8, 64), M.chrome, 0, 0.15, -0.03));
  g.add(ant);

  // Ligar/desligar (aquecimento do tubo) e raio X da tampa traseira
  let on = 0;
  const power = new Toggle((e) => {
    on = e;
    crtScreen.emissiveIntensity = e * 1.35;
    ledMat.emissiveIntensity = e * 3;
  }, 1.4);
  const xray = new Toggle((e) => {
    for (const m of fadeMats) {
      m.transparent = e > 0;
      m.opacity = 1 - e * 0.8;
      m.depthWrite = e < 0.5;
      m.needsUpdate = true;
    }
    hood.castShadow = e < 0.5;
  }, 0.9);
  return {
    object: g,
    actions: [
      { id: 'power', label: 'Ligar TV', activeLabel: 'Desligar TV', toggle: power },
      { id: 'xray', label: 'Ver tubo de imagem', activeLabel: 'Fechar tampa traseira', toggle: xray, view: 'back' },
    ],
    update: (dt) => {
      const a = power.update(dt) | xray.update(dt);
      if (on > 0.99) {
        crtScreen.emissiveIntensity = 1.35 * (0.975 + Math.random() * 0.05);
        return true;
      }
      return a;
    },
  };
}
