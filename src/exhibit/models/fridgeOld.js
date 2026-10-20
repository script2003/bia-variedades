import * as THREE from 'three';
import {
  rbox, box, cyl, cylAlong, mesh, extrude, extrudeGeo, merged, boxG, rodG, wireRackG, tube, plug,
  roundedRectShape, roundedRectHole, invert, Toggle, noCast,
} from '../lib/geo.js';
import { drawTexture } from '../lib/textures.js';

// Geladeira doméstica, anos 1950: gabinete arredondado esmaltado, porta única com trinco de alavanca.
export function createFridgeOld(M) {
  const g = new THREE.Group();
  g.name = 'Geladeira_antiga_anos_1950';
  const E = M.enamelMint;
  const B = 0.02;
  const OW = 0.66, OH = 1.38, R = [0.1, 0.1, 0.02, 0.02];
  const CY = 0.8;
  const zf = 0.3;

  // Gabinete: casca extrudada com abertura frontal (paredes grossas, isolamento da época)
  const shell = roundedRectShape(OW, OH, R);
  shell.holes.push(roundedRectHole(0.58, 1.28, [0.07, 0.07, 0.015, 0.015]));
  const body = extrude(shell, 0.56, E, { bevel: B, bevelSeg: 5, curveSegments: 24 });
  body.position.set(0, CY, 0);
  g.add(body);
  const back = mesh(new THREE.ShapeGeometry(roundedRectShape(OW - 0.01, OH - 0.01, R), 16), M.galvanized, 0, CY, -zf - 0.001);
  back.rotation.y = Math.PI;
  g.add(back);

  // Revestimento interno de porcelana
  const linerGeo = invert(extrudeGeo(roundedRectShape(0.534, 1.234, [0.05, 0.05, 0.004, 0.004]), 0.56, { curveSegments: 16 }));
  const liner = mesh(linerGeo, M.porcelain, 0, CY, 0.02);
  liner.castShadow = false;
  g.add(liner);

  // Base, grelha frontal e pés
  g.add(box(0.62, 0.072, 0.52, M.enamelBlack, 0, 0.054, -0.02));
  g.add(rbox(0.6, 0.068, 0.02, 0.006, M.plasticCharcoal, 0, 0.052, 0.25));
  const slats = [];
  for (let i = 0; i < 5; i++) slats.push(boxG(0.54, 0.005, 0.004, 0, 0.026 + i * 0.012, 0));
  g.add(merged(slats, M.chrome, 0, 0, 0.262));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cyl(0.02, 0.024, 0.02, M.rubber, sx * 0.27, 0.01, sz * 0.22 - 0.02));

  // Dobradiças cromadas aparentes
  for (const y of [0.2, 1.38]) {
    g.add(rbox(0.008, 0.085, 0.06, 0.003, M.chrome, -0.354, y, 0.31));
    g.add(cyl(0.008, 0.008, 0.095, M.chrome, -0.356, y, 0.338, 16));
  }

  // Porta (articulada à esquerda)
  const doorPivot = new THREE.Group();
  doorPivot.position.set(-0.352, CY, zf + 0.002);
  g.add(doorPivot);
  const DX = 0.352;
  const door = extrude(roundedRectShape(OW, OH, R), 0.036, E, { bevel: 0.022, bevelSeg: 6, curveSegments: 24 });
  door.position.set(DX, 0, 0.04);
  doorPivot.add(door);
  const gs = roundedRectShape(0.6, 1.32, [0.07, 0.07, 0.015, 0.015]);
  gs.holes.push(roundedRectHole(0.55, 1.27, [0.05, 0.05, 0.01, 0.01]));
  const gasket = extrude(gs, 0.012, M.rubber, { curveSegments: 12 });
  gasket.position.set(DX, 0, -0.006);
  doorPivot.add(gasket);
  doorPivot.add(rbox(0.48, 1.16, 0.03, 0.02, M.porcelain, DX, 0, -0.015));
  for (const y of [-0.38, -0.05, 0.28]) {
    const shelf = new THREE.Group();
    shelf.add(box(0.44, 0.008, 0.075, M.porcelain, 0, 0, -0.0675));
    shelf.add(cylAlong('x', 0.004, 0.44, M.chrome, 0, 0.05, -0.103, 12));
    for (const s of [-1, 1]) {
      shelf.add(box(0.008, 0.06, 0.075, M.porcelain, s * 0.216, 0.026, -0.0675));
    }
    shelf.position.set(DX, y, 0);
    doorPivot.add(noCast(shelf));
  }
  // Puxador com alavanca (trinco mecânico)
  const handle = new THREE.Group();
  handle.position.set(0.63, 0.12, 0.081);
  handle.add(rbox(0.05, 0.24, 0.016, 0.008, M.chrome, 0, 0, 0));
  const lever = [[0, 0.09, 0.006], [0, 0.088, 0.04], [0, 0.03, 0.06], [0, -0.05, 0.058], [0, -0.1, 0.036]];
  handle.add(tube(lever, 0.012, M.chrome, 40));
  handle.add(mesh(new THREE.SphereGeometry(0.012, 16, 12), M.chrome, 0, -0.1, 0.036));
  doorPivot.add(handle);
  doorPivot.add(rbox(0.25, 0.026, 0.008, 0.004, M.chrome, DX, 0.5, 0.082));
  doorPivot.add(rbox(0.12, 0.008, 0.006, 0.003, M.chrome, DX, 0.47, 0.082));

  // Interior: congelador, bandeja de degelo, termostato, prateleiras e gaveta de legumes
  const inside = new THREE.Group();
  inside.add(rbox(0.38, 0.16, 0.36, 0.01, M.aluminumFrost, -0.06, 1.3, -0.08));
  inside.add(rbox(0.38, 0.16, 0.012, 0.006, M.aluminumFrost, -0.06, 1.3, 0.106));
  inside.add(rbox(0.04, 0.02, 0.012, 0.004, M.chrome, 0.1, 1.3, 0.116));
  inside.add(box(0.4, 0.015, 0.38, M.aluminum, -0.06, 1.205, -0.07));
  inside.add(rbox(0.08, 0.12, 0.12, 0.01, M.porcelain, 0.21, 1.31, 0));
  const thermoTex = drawTexture(128, 128, (c, w) => {
    c.fillStyle = '#f4efe2';
    c.beginPath(); c.arc(w / 2, w / 2, w / 2, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#3a3a3a';
    c.font = 'bold 15px Georgia, serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let i = 1; i <= 7; i++) {
      const a = -Math.PI * 1.25 + ((i - 1) / 6) * Math.PI * 1.5;
      c.fillText(String(i), w / 2 + Math.cos(a) * 50, w / 2 + Math.sin(a) * 50);
    }
    c.font = '11px Georgia, serif';
    c.fillText('FRIO', w / 2, w / 2 + 40);
  });
  inside.add(mesh(new THREE.CircleGeometry(0.026, 32), new THREE.MeshStandardMaterial({ map: thermoTex, roughness: 0.4 }), 0.21, 1.31, 0.0605));
  inside.add(cylAlong('z', 0.012, 0.014, M.bakelite, 0.21, 1.31, 0.068, 24));
  const lampMat = M.lampWarm.clone();
  inside.add(mesh(new THREE.SphereGeometry(0.016, 16, 12), lampMat, 0.21, 1.235, 0.02));
  for (const y of [0.7, 1.0]) {
    inside.add(mesh(wireRackG(0.52, 0.42, 0.0025, 13), M.chrome, 0, y, -0.06));
    for (const s of [-1, 1]) inside.add(box(0.012, 0.01, 0.4, M.porcelain, s * 0.262, y - 0.008, -0.06));
  }
  inside.add(rbox(0.5, 0.15, 0.4, 0.012, M.porcelain, 0, 0.265, -0.06));
  inside.add(box(0.52, 0.006, 0.42, M.clearGlass, 0, 0.35, -0.06));
  inside.add(rbox(0.1, 0.018, 0.012, 0.005, M.chrome, 0, 0.29, 0.146));
  g.add(noCast(inside));
  const light = new THREE.PointLight(0xfff1d8, 0, 1.6, 2);
  light.position.set(0.1, 1.12, 0.1);
  g.add(light);

  // Traseira: condensador em serpentina, compressor e tubulação
  const coil = [];
  const rows = 11, y0 = 0.36, dy = 0.095, xr = 0.24, cr = 0.0055;
  for (let i = 0; i < rows; i++) coil.push(rodG([-xr, y0 + i * dy, 0], [xr, y0 + i * dy, 0], cr, 10));
  for (let i = 0; i < rows - 1; i++) {
    const right = i % 2 === 0;
    const t = new THREE.TorusGeometry(dy / 2, cr, 8, 14, Math.PI);
    t.rotateZ(right ? -Math.PI / 2 : Math.PI / 2);
    t.translate(right ? xr : -xr, y0 + i * dy + dy / 2, 0);
    coil.push(t);
  }
  for (let x = -0.225; x <= 0.226; x += 0.025) coil.push(rodG([x, y0 - 0.02, -0.007], [x, y0 + (rows - 1) * dy + 0.02, -0.007], 0.0016, 6));
  g.add(merged(coil, M.castIron, 0, 0, -zf - 0.035));
  for (const [x, y] of [[-0.2, 0.4], [0.2, 0.4], [-0.2, 1.2], [0.2, 1.2]]) g.add(box(0.012, 0.02, 0.035, M.galvanized, x, y, -zf - 0.017));
  g.add(box(0.32, 0.01, 0.2, M.galvanized, 0.05, 0.02, -zf - 0.09));
  const comp = new THREE.Group();
  comp.add(cyl(0.085, 0.085, 0.12, M.enamelBlack, 0, 0.085, 0, 36));
  const domeTop = mesh(new THREE.SphereGeometry(0.085, 36, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.enamelBlack, 0, 0.145, 0);
  domeTop.scale.y = 0.55;
  comp.add(domeTop);
  comp.position.set(0.1, 0, -zf - 0.1);
  g.add(comp);
  g.add(tube([[0.1, 0.22, -zf - 0.1], [0.08, 0.3, -zf - 0.06], [0.24, 0.33, -zf - 0.04], [0.24, 0.36, -zf - 0.035]], 0.004, M.copper, 32));
  g.add(tube([[0.04, 0.12, -zf - 0.1], [-0.05, 0.1, -zf - 0.07], [-0.2, 0.2, -zf - 0.03], [-0.22, 0.6, -zf - 0.02]], 0.0035, M.copper, 32));
  g.add(tube([[0.17, 0.08, -zf - 0.1], [0.24, 0.06, -zf - 0.2], [0.26, 0.012, -zf - 0.26], [0.28, 0.006, -0.6]], 0.0035, M.rubber, 24));
  g.add(plug(0.28, 0, -0.6, M.bakelite, M.chrome));

  const doorT = new Toggle((e) => {
    doorPivot.rotation.y = -e * 1.92;
    lampMat.emissiveIntensity = e * 2;
    light.intensity = e * 0.5;
  }, 1.2);
  return {
    object: g,
    actions: [{ id: 'door', label: 'Abrir porta', activeLabel: 'Fechar porta', toggle: doorT }],
    update: (dt) => doorT.update(dt),
  };
}
