import * as THREE from 'three';
import {
  rbox, box, cylAlong, mesh, extrude, extrudeGeo, merged, boxG, tube,
  roundedRectShape, roundedRectHole, taperedBoxGeo, decal, Toggle, plug,
} from '../lib/geo.js';
import { drawTexture, landscapeTexture, ledGridTexture, lcdTexture } from '../lib/textures.js';

// Smart TV LED de 55" 4K: perfil fino, bordas estreitas, pés de apoio e conexões traseiras.
export function createTvModern(M) {
  const g = new THREE.Group();
  g.name = 'TV_atual_LED_55';
  const PW = 1.232, PH = 0.712, CY = 0.07 + PH / 2;
  const SW = 1.222, SH = 0.694, SCY = 0.003;

  // Moldura de alumínio escuro
  const fs = roundedRectShape(PW, PH, 0.004);
  fs.holes.push(roundedRectHole(SW, SH, 0.001, 0, SCY));
  const frame = extrude(fs, 0.024, M.darkMetal, { curveSegments: 4 });
  frame.position.set(0, CY, 0);
  g.add(frame);
  g.add(rbox(1.228, 0.708, 0.006, 0.003, M.plasticBackTV, 0, CY, -0.013));

  // Camadas do painel (da frente para trás)
  const screenMat = new THREE.MeshPhysicalMaterial({
    name: 'Tela', color: 0x07080a, roughness: 0.14, clearcoat: 0.35, clearcoatRoughness: 0.2,
    emissive: 0xffffff, emissiveMap: landscapeTexture(), emissiveIntensity: 0, transparent: true,
  });
  const lcdMat = new THREE.MeshStandardMaterial({
    name: 'Painel LCD', map: lcdTexture(), transparent: true, opacity: 0.85, side: THREE.DoubleSide, roughness: 0.3,
  });
  const filmMat = new THREE.MeshPhysicalMaterial({
    name: 'Filme Quantum Dot', color: 0x8fd6c4, transparent: true, opacity: 0.35, side: THREE.DoubleSide, roughness: 0.2,
  });
  const diffMat = new THREE.MeshStandardMaterial({
    name: 'Difusor', color: 0xf4f6f8, transparent: true, opacity: 0.6, side: THREE.DoubleSide, roughness: 0.9,
  });
  const ledTex = ledGridTexture();
  const ledMat = new THREE.MeshStandardMaterial({
    name: 'Retroiluminação LED', map: ledTex, emissiveMap: ledTex, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.6,
  });
  const layer = (mat, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(SW, SH), mat);
    m.position.set(0, CY + SCY, z);
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const layers = [
    { m: layer(screenMat, 0.0105), z0: 0.0105, z1: 0.42 },
    { m: layer(lcdMat, 0.0085), z0: 0.0085, z1: 0.31 },
    { m: layer(filmMat, 0.0065), z0: 0.0065, z1: 0.2 },
    { m: layer(diffMat, 0.0045), z0: 0.0045, z1: 0.1 },
  ];
  layer(ledMat, 0.0015);

  // Sensor de controle remoto e LED de espera
  g.add(rbox(0.03, 0.006, 0.003, 0.0012, M.plasticBlackGloss, 0, 0.07 + 0.006, 0.0125));
  const standby = new THREE.MeshStandardMaterial({ name: 'LED de espera', color: 0x220303, emissive: 0xff1a0a, emissiveIntensity: 1.6 });
  g.add(mesh(new THREE.SphereGeometry(0.0015, 8, 6), standby, 0.008, 0.076, 0.0138));

  // Traseira: módulo mais espesso com eletrônica, VESA, conexões e alto-falantes
  const HY = CY - 0.09, HZ = -0.016, HD = 0.034, HB = HZ - HD;
  g.add(mesh(taperedBoxGeo(1.0, 0.46, 0.94, 0.4, HD), M.plasticBackTV, 0, HY, HZ));
  for (const dx of [-0.15, 0.15]) for (const dy of [-0.15, 0.15]) {
    g.add(cylAlong('z', 0.009, 0.004, M.darkMetal, dx, HY + dy, HB - 0.0015, 20));
    g.add(cylAlong('z', 0.0035, 0.002, M.plasticBlack, dx, HY + dy, HB - 0.0035, 12));
  }
  // Painel de conexões (coordenadas vistas por quem olha a traseira: vx positivo = direita)
  const PX = 0.32, PY = HY + 0.02, PZ = HB - 0.0015;
  g.add(rbox(0.2, 0.12, 0.003, 0.002, M.plasticBlack, PX, PY, PZ));
  const ports = [
    { t: 'hdmi', vx: -0.07, vy: 0.035, l: 'HDMI 1', l2: '(eARC)' },
    { t: 'hdmi', vx: -0.035, vy: 0.035, l: 'HDMI 2' },
    { t: 'hdmi', vx: 0.0, vy: 0.035, l: 'HDMI 3' },
    { t: 'usb', vx: 0.04, vy: 0.035, l: 'USB' },
    { t: 'usb', vx: 0.07, vy: 0.035, l: 'USB' },
    { t: 'lan', vx: -0.065, vy: -0.02, l: 'LAN' },
    { t: 'opt', vx: -0.02, vy: -0.02, l: 'ÓPTICA' },
    { t: 'ant', vx: 0.03, vy: -0.02, l: 'ANT/CABO' },
  ];
  const pz = PZ - 0.0045;
  for (const p of ports) {
    const x = PX - p.vx, y = PY + p.vy;
    if (p.t === 'hdmi') {
      g.add(rbox(0.016, 0.0065, 0.006, 0.001, M.steelSatin, x, y, pz));
      g.add(box(0.012, 0.0032, 0.002, M.plasticBlack, x, y, pz - 0.003));
    } else if (p.t === 'usb') {
      g.add(box(0.013, 0.0055, 0.006, M.steelSatin, x, y, pz));
      g.add(box(0.009, 0.0016, 0.002, M.plasticWhite, x, y + 0.0008, pz - 0.003));
    } else if (p.t === 'lan') {
      g.add(box(0.017, 0.014, 0.006, M.plasticBlack, x, y, pz));
      g.add(box(0.012, 0.009, 0.002, M.rubber, x, y - 0.001, pz - 0.003));
    } else if (p.t === 'opt') {
      g.add(box(0.01, 0.01, 0.006, M.plasticBlack, x, y, pz));
    } else {
      g.add(cylAlong('z', 0.005, 0.01, M.brass, x, y, pz - 0.002, 16));
      g.add(cylAlong('z', 0.0008, 0.012, M.steelSatin, x, y, pz - 0.003, 8));
    }
  }
  const portLabels = drawTexture(500, 300, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = '#e8e8e8';
    c.textAlign = 'center';
    c.font = '600 15px Arial, sans-serif';
    for (const p of ports) {
      const cx = (p.vx / 0.2 + 0.5) * w;
      const cy = (0.5 - p.vy / 0.12) * h + 34;
      c.fillText(p.l, cx, cy);
      if (p.l2) c.fillText(p.l2, cx, cy + 17);
    }
  });
  g.add(decal(0.2, 0.12, portLabels, { x: PX, y: PY, z: PZ - 0.0016 }).rotateY(Math.PI));
  // Cabo HDMI conectado e cabo de energia
  const h1x = PX + 0.07, h1y = PY + 0.035;
  g.add(rbox(0.022, 0.012, 0.034, 0.003, M.plasticBlack, h1x, h1y, pz - 0.02));
  g.add(tube([[h1x, h1y, pz - 0.036], [h1x, h1y - 0.02, pz - 0.07], [h1x - 0.02, 0.2, -0.1], [h1x - 0.04, 0.012, -0.14], [h1x - 0.05, 0.006, -0.42]], 0.0035, M.plasticBlack, 40));
  g.add(plug(h1x - 0.05, 0, -0.42, M.plasticBlack, M.brass));
  const pwx = -0.4, pwy = HY - 0.12;
  g.add(rbox(0.024, 0.012, 0.006, 0.002, M.plasticBlack, pwx, pwy, PZ));
  g.add(rbox(0.022, 0.011, 0.028, 0.003, M.plasticBlack, pwx, pwy, PZ - 0.016));
  g.add(tube([[pwx, pwy, PZ - 0.03], [pwx, pwy - 0.03, PZ - 0.06], [pwx + 0.02, 0.05, -0.1], [pwx + 0.03, 0.008, -0.15], [pwx + 0.05, 0.006, -0.42]], 0.003, M.plasticBlack, 40));
  g.add(plug(pwx + 0.05, 0, -0.42, M.plasticBlack, M.steelSatin));
  // Alto-falantes e ventilação
  const grille = [];
  for (const sx of [-1, 1]) for (let r = 0; r < 5; r++) grille.push(boxG(0.13, 0.003, 0.002, sx * 0.3, HY - 0.17 + r * 0.01, 0));
  for (let i = 0; i < 16; i++) grille.push(boxG(0.03, 0.004, 0.002, -0.3 + i * 0.04, HY + 0.18, 0));
  g.add(merged(grille, M.plasticBlack, 0, 0, HB - 0.001));
  const sticker = drawTexture(300, 170, (c, w) => {
    c.fillStyle = '#efefec'; c.fillRect(0, 0, w, 170);
    c.fillStyle = '#1b1b1b'; c.font = 'bold 19px Arial';
    c.fillText('SMART TV LED 55" 4K UHD', 14, 32);
    c.font = '15px Arial';
    ['Resolução: 3840 × 2160 pixels', 'Entrada: 100–240 V ~ 50/60 Hz', 'Consumo típico: 120 W', 'Wi-Fi · Bluetooth · HDMI 2.1'].forEach((t, i) => c.fillText(t, 14, 62 + i * 25));
  });
  g.add(decal(0.15, 0.085, sticker, { x: -0.15, y: HY + 0.05, z: HB - 0.0008, transparent: false }).rotateY(Math.PI));

  // Pés de apoio em lâmina
  const fp = new THREE.Shape();
  fp.moveTo(-0.13, 0); fp.lineTo(0.17, 0); fp.lineTo(0.17, 0.008); fp.lineTo(0.015, 0.014);
  fp.lineTo(0.008, 0.088); fp.lineTo(-0.008, 0.088); fp.lineTo(-0.02, 0.014); fp.lineTo(-0.13, 0.008);
  fp.closePath();
  const footGeo = extrudeGeo(fp, 0.018, { curveSegments: 2 }).rotateY(-Math.PI / 2);
  for (const s of [-1, 1]) {
    g.add(mesh(footGeo, M.darkMetal, s * 0.48, 0, 0));
    g.add(box(0.016, 0.003, 0.28, M.rubber, s * 0.48, 0.0015, 0.02));
  }

  const power = new Toggle((e) => {
    screenMat.emissiveIntensity = e * 1.05;
    standby.emissiveIntensity = (1 - e) * 1.6;
    ledMat.emissiveIntensity = 0.25 + e * 1.1;
  }, 0.6);
  const explode = new Toggle((e) => {
    for (const L of layers) L.m.position.z = L.z0 + (L.z1 - L.z0) * e;
    screenMat.opacity = 1 - e * 0.55;
    lcdMat.opacity = 0.85 - e * 0.15;
    screenMat.depthWrite = e < 0.5;
  }, 1.2);
  return {
    object: g,
    actions: [
      { id: 'power', label: 'Ligar TV', activeLabel: 'Desligar TV', toggle: power },
      { id: 'explode', label: 'Separar camadas da tela', activeLabel: 'Juntar camadas', toggle: explode, view: 'side' },
    ],
    update: (dt) => power.update(dt) | explode.update(dt),
  };
}
