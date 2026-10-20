import * as THREE from 'three';
import {
  rbox, box, cylAlong, mesh, extrude, extrudeGeo, merged, boxG, tube, plug,
  roundedRectShape, roundedRectHole, invert, decal, Toggle, noCast,
} from '../lib/geo.js';
import { drawTexture } from '../lib/textures.js';

// Geladeira French Door contemporânea: duas portas superiores, gaveta de freezer, inox e LED.
export function createFridgeModern(M) {
  const g = new THREE.Group();
  g.name = 'Geladeira_atual_french_door';
  const CY = 0.92, zf = 0.333;

  const shape = roundedRectShape(0.9, 1.71, 0.012);
  shape.holes.push(roundedRectHole(0.83, 0.91, 0.02, 0, 0.365));
  shape.holes.push(roundedRectHole(0.83, 0.62, 0.02, 0, -0.48));
  const body = extrude(shape, 0.65, M.paintedSilver, { bevel: 0.005, bevelSeg: 3, curveSegments: 8 });
  body.position.set(0, CY, 0);
  g.add(body);
  const back = mesh(new THREE.ShapeGeometry(roundedRectShape(0.895, 1.705, 0.01), 6), M.galvanized, 0, CY, -0.331);
  back.rotation.y = Math.PI;
  g.add(back);
  for (const [h, cy] of [[0.894, 1.285], [0.614, 0.44]]) {
    const l = mesh(invert(extrudeGeo(roundedRectShape(0.814, h, 0.012), 0.6, { curveSegments: 6 })), M.plasticWhite, 0, cy, 0.03);
    l.castShadow = false;
    g.add(l);
  }

  // Rodapé com grelha de ventilação
  g.add(box(0.86, 0.055, 0.02, M.plasticCharcoal, 0, 0.03, 0.3));
  const kick = [];
  for (let i = 0; i < 14; i++) kick.push(boxG(0.035, 0.03, 0.004, -0.3 + i * 0.046, 0, 0));
  g.add(merged(kick, M.plasticBlack, 0, 0.03, 0.311));
  g.add(box(0.88, 0.055, 0.6, M.plasticBlack, 0, 0.03, -0.02));

  // Portas superiores (French Door)
  const DW = 0.4535, DH = 0.955, DY = 1.2925, DT = 0.065;
  const makeDoor = (side) => {
    // side = -1: porta esquerda (dobradiça à esquerda); +1: porta direita
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.455, DY, zf);
    const cx = -side * DW / 2;
    pivot.add(rbox(DW, DH, DT, 0.012, M.steel, cx, 0, DT / 2, 3));
    const gs = roundedRectShape(DW - 0.02, DH - 0.02, 0.02);
    gs.holes.push(roundedRectHole(DW - 0.05, DH - 0.05, 0.012));
    const gk = extrude(gs, 0.012, M.gasketGray, { curveSegments: 6 });
    gk.position.set(cx, 0, -0.006);
    pivot.add(gk);
    pivot.add(rbox(DW - 0.07, DH - 0.09, 0.02, 0.01, M.plasticWhite, cx, 0, -0.01));
    for (const y of [-0.32, -0.02, 0.27]) {
      const bin = new THREE.Group();
      const bw = DW - 0.1;
      bin.add(box(bw, 0.005, 0.085, M.plasticClear, 0, 0, -0.0625));
      bin.add(box(bw, 0.085, 0.004, M.plasticClear, 0, 0.04, -0.105));
      for (const s of [-1, 1]) bin.add(box(0.004, 0.085, 0.085, M.plasticClear, s * bw / 2, 0.04, -0.0625));
      bin.add(box(bw, 0.012, 0.007, M.plasticGray, 0, 0.085, -0.105));
      bin.position.set(cx, y, 0);
      pivot.add(noCast(bin));
    }
    const hx = -side * (DW - 0.045);
    pivot.add(rbox(0.022, 0.6, 0.028, 0.01, M.steelSatin, hx, 0, 0.1));
    for (const y of [-0.27, 0.27]) pivot.add(cylAlong('z', 0.009, 0.04, M.steelSatin, hx, y, 0.083, 16));
    g.add(pivot);
    return pivot;
  };
  const leftDoor = makeDoor(-1);
  const rightDoor = makeDoor(1);

  // Painel digital discreto na porta esquerda
  leftDoor.add(rbox(0.11, 0.064, 0.004, 0.004, M.blackGlass, 0.3, 0.25, DT + 0.001));
  const panelTex = drawTexture(330, 192, (c, w, h) => {
    c.fillStyle = '#000';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#e8f3ff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = '300 56px Arial, sans-serif';
    c.fillText('3°', w * 0.27, h * 0.42);
    c.fillText('-18°', w * 0.7, h * 0.42);
    c.font = '18px Arial, sans-serif';
    c.fillStyle = '#9fb3c8';
    c.fillText('REFRIGERADOR', w * 0.27, h * 0.75);
    c.fillText('FREEZER', w * 0.7, h * 0.75);
    c.fillRect(w * 0.49, h * 0.2, 1.5, h * 0.62);
  });
  leftDoor.add(decal(0.1, 0.058, panelTex, { x: 0.3, y: 0.25, z: DT + 0.0035, emissive: true, transparent: false }));

  // Gaveta do freezer (desliza para frente)
  const drawer = new THREE.Group();
  drawer.position.set(0, 0, zf);
  g.add(drawer);
  drawer.add(rbox(0.905, 0.66, DT, 0.012, M.steel, 0, 0.41, DT / 2, 3));
  drawer.add(rbox(0.62, 0.022, 0.028, 0.01, M.steelSatin, 0, 0.695, 0.1));
  for (const x of [-0.28, 0.28]) drawer.add(cylAlong('z', 0.009, 0.04, M.steelSatin, x, 0.695, 0.083, 16));
  const dgs = roundedRectShape(0.88, 0.64, 0.02);
  dgs.holes.push(roundedRectHole(0.85, 0.61, 0.012));
  const dgk = extrude(dgs, 0.012, M.gasketGray, { curveSegments: 6 });
  dgk.position.set(0, 0.41, -0.006);
  drawer.add(dgk);
  const basket = new THREE.Group();
  const bw = 0.78, bh = 0.4, bd = 0.5, by = 0.35, bz = -0.29;
  basket.add(box(bw, 0.008, bd, M.plasticGray, 0, by - bh / 2, bz));
  basket.add(box(bw, bh, 0.008, M.plasticGray, 0, by, bz - bd / 2));
  basket.add(box(bw, bh * 0.8, 0.008, M.plasticGray, 0, by - bh * 0.1, bz + bd / 2));
  for (const s of [-1, 1]) {
    basket.add(box(0.008, bh, bd, M.plasticGray, s * bw / 2, by, bz));
    basket.add(box(0.008, 0.018, 0.5, M.steelSatin, s * 0.397, 0.4, bz));
  }
  const tray = [];
  tray.push(boxG(0.76, 0.005, 0.46, 0, 0, 0), boxG(0.76, 0.07, 0.005, 0, 0.035, 0.23), boxG(0.76, 0.07, 0.005, 0, 0.035, -0.23));
  tray.push(boxG(0.005, 0.07, 0.46, 0.38, 0.035, 0), boxG(0.005, 0.07, 0.46, -0.38, 0.035, 0));
  basket.add(merged(tray, M.plasticClear, 0, 0.6, -0.28));
  drawer.add(noCast(basket));
  for (const s of [-1, 1]) g.add(box(0.006, 0.024, 0.55, M.paintedSilver, s * 0.405, 0.4, 0.03));

  // Interior do refrigerador
  const inside = new THREE.Group();
  inside.add(box(0.6, 0.006, 0.02, M.ledWhite, 0, 1.728, 0.2));
  for (const s of [-1, 1]) inside.add(box(0.006, 0.55, 0.018, M.ledWhite, s * 0.404, 1.3, 0.22));
  for (const y of [1.06, 1.25, 1.47]) {
    inside.add(box(0.8, 0.006, 0.48, M.clearGlass, 0, y, -0.04));
    inside.add(box(0.8, 0.018, 0.012, M.plasticGray, 0, y, 0.2));
    for (const s of [-1, 1]) inside.add(box(0.012, 0.012, 0.46, M.plasticWhite, s * 0.401, y - 0.009, -0.04));
  }
  for (const s of [-1, 1]) {
    inside.add(rbox(0.39, 0.16, 0.46, 0.01, M.plasticClear, s * 0.2, 0.93, -0.05));
    inside.add(box(0.34, 0.022, 0.012, M.plasticGray, s * 0.2, 0.995, 0.186));
  }
  inside.add(box(0.18, 0.75, 0.02, M.plasticWhite, 0, 1.33, -0.258));
  const vents = [];
  for (let i = 0; i < 10; i++) vents.push(boxG(0.12, 0.008, 0.004, 0, i * 0.06, 0));
  inside.add(merged(vents, M.plasticGray, 0, 1.06, -0.247));
  inside.add(box(0.5, 0.006, 0.02, M.ledWhite, 0, 0.733, 0.15));
  g.add(noCast(inside));
  const light = new THREE.PointLight(0xeef4ff, 0, 1.8, 2);
  light.position.set(0, 1.6, 0.12);
  g.add(light);

  // Tampas superiores das dobradiças
  for (const s of [-1, 1]) g.add(rbox(0.05, 0.016, 0.07, 0.006, M.paintedSilver, s * 0.43, 1.788, 0.31));

  // Traseira: tampa do compressor com aletas, cabo e etiqueta
  g.add(box(0.8, 0.22, 0.01, M.darkMetal, 0, 0.18, -0.336));
  const louvers = [];
  for (let r = 0; r < 6; r++) for (let c = 0; c < 8; c++) louvers.push(boxG(0.07, 0.008, 0.006, -0.315 + c * 0.09, 0.1 + r * 0.03, 0));
  g.add(merged(louvers, M.plasticBlack, 0, 0, -0.342));
  g.add(tube([[0.3, 0.12, -0.342], [0.32, 0.08, -0.37], [0.33, 0.02, -0.45], [0.36, 0.006, -0.6]], 0.004, M.plasticBlack, 24));
  g.add(plug(0.36, 0, -0.6, M.plasticWhite, M.steelSatin));
  const label = drawTexture(300, 200, (c, w) => {
    c.fillStyle = '#f2f2ef'; c.fillRect(0, 0, w, 200);
    c.fillStyle = '#1d1d1d'; c.font = 'bold 20px Arial';
    c.fillText('REFRIGERADOR FROST FREE', 14, 34);
    c.font = '16px Arial';
    ['Capacidade total: 550 L', 'Tensão: 127 V ~ 60 Hz', 'Fluido refrigerante: R600a', 'Compressor inverter', 'Eficiência energética: classe A'].forEach((t, i) => c.fillText(t, 14, 66 + i * 26));
  });
  g.add(decal(0.2, 0.133, label, { x: -0.2, y: 1.45, z: -0.3325, transparent: false }).rotateY(Math.PI));

  const doors = new Toggle((e) => {
    leftDoor.rotation.y = -e * 1.95;
    rightDoor.rotation.y = e * 1.95;
    light.intensity = e * 0.55;
  }, 1.2);
  const drawerT = new Toggle((e) => { drawer.position.z = zf + e * 0.42; }, 1.0);
  return {
    object: g,
    actions: [
      { id: 'doors', label: 'Abrir portas', activeLabel: 'Fechar portas', toggle: doors },
      { id: 'drawer', label: 'Abrir gaveta do freezer', activeLabel: 'Fechar gaveta do freezer', toggle: drawerT },
    ],
    update: (dt) => doors.update(dt) | drawerT.update(dt),
  };
}
