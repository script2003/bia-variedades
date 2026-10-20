import * as THREE from 'three';
import {
  rbox, box, cyl, cylAlong, lathe, merged, boxG, rodG, wireRackG, mesh, extrude,
  roundedRectShape, roundedRectHole, invert, decal, Toggle, noCast,
} from '../lib/geo.js';
import { drawTexture } from '../lib/textures.js';

// Fogão a gás doméstico, anos 1950: chapa de aço esmaltada, cromados e baquelite.
export function createStoveOld(M) {
  const g = new THREE.Group();
  g.name = 'Fogao_antigo_anos_1950';
  const W = 0.76, D = 0.62, TOP = 0.9, BASE = 0.085;
  const zf = D / 2;
  const E = M.enamelCream;

  // Base recuada e pés
  g.add(box(W - 0.09, BASE - 0.012, D - 0.1, M.enamelBlack, 0, 0.012 + (BASE - 0.012) / 2, -0.03));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(cyl(0.02, 0.024, 0.014, M.rubber, sx * (W / 2 - 0.07), 0.007, sz * (D / 2 - 0.09) - 0.02));
  }

  // Laterais, fundo e mesa
  const sideH = TOP - 0.035 - BASE;
  for (const s of [-1, 1]) g.add(rbox(0.04, sideH, D, 0.014, E, s * (W / 2 - 0.02), BASE + sideH / 2, 0));
  g.add(box(W - 0.06, sideH, 0.02, M.galvanized, 0, BASE + sideH / 2, -zf + 0.012));
  g.add(rbox(W, 0.035, D, 0.015, E, 0, TOP - 0.0175, 0, 4));

  // Painel frontal dos registros
  g.add(rbox(W - 0.078, 0.066, 0.03, 0.008, E, 0, 0.832, zf - 0.015));
  g.add(box(W - 0.08, 0.007, 0.008, M.chrome, 0, 0.796, zf - 0.003));

  const panelTex = drawTexture(1024, 80, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.strokeStyle = '#5a4630';
    c.fillStyle = '#5a4630';
    c.lineWidth = 2;
    const xs = [-0.27, -0.17, 0.17, 0.27];
    const toPx = (x) => ((x + 0.34) / 0.68) * w;
    // pequeno diagrama indicando qual queimador cada registro comanda
    const which = [[0, 1], [0, 0], [1, 0], [1, 1]];
    xs.forEach((x, i) => {
      const px = toPx(x) + 63, py = h / 2;
      const [cx, cz] = which[i];
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
        c.beginPath();
        c.arc(px - 7 + a * 14, py - 7 + b * 14, 4.5, 0, Math.PI * 2);
        if (a === cx && b === cz) c.fill(); else c.stroke();
      }
    });
    c.font = '600 22px Georgia, serif';
    c.textAlign = 'center';
    c.fillText('FORNO', toPx(0) + 100, h / 2 + 8);
  });
  g.add(decal(0.68, 0.053, panelTex, { y: 0.832, z: zf + 0.0012 }));

  // Registros de baquelite com saia cromada
  const knob = (x, y, z, scale = 1) => {
    const k = new THREE.Group();
    const inner = new THREE.Group();
    inner.rotation.x = Math.PI / 2;
    inner.add(lathe([[0, 0], [0.025, 0], [0.026, 0.002], [0.025, 0.006], [0, 0.006]], M.chrome, 36));
    inner.add(lathe([[0, 0.006], [0.018, 0.006], [0.0186, 0.02], [0.0168, 0.028], [0.012, 0.031], [0, 0.0316]], M.bakelite, 36));
    k.add(inner);
    k.add(rbox(0.008, 0.036, 0.014, 0.003, M.bakelite, 0, 0, 0.026));
    k.position.set(x, y, z);
    k.scale.setScalar(scale);
    return k;
  };
  for (const x of [-0.27, -0.17, 0.17, 0.27]) g.add(knob(x, 0.832, zf));

  // Termostato do forno com mostrador graduado
  const dialTex = drawTexture(256, 256, (c, w) => {
    c.fillStyle = '#efe6cf';
    c.beginPath(); c.arc(w / 2, w / 2, w / 2, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#3a2c1d';
    c.font = 'bold 20px Georgia, serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const labels = ['DESL', '1', '2', '3', '4', '5', '6', '7', 'MÁX'];
    labels.forEach((t, i) => {
      const a = -Math.PI * 0.75 + (i / (labels.length - 1)) * Math.PI * 1.5 - Math.PI / 2;
      c.fillText(t, w / 2 + Math.cos(a) * 98, w / 2 + Math.sin(a) * 98);
      c.fillRect(w / 2 + Math.cos(a) * 76 - 2, w / 2 + Math.sin(a) * 76 - 2, 4, 4);
    });
  });
  g.add(mesh(new THREE.CircleGeometry(0.031, 40), new THREE.MeshPhysicalMaterial({ map: dialTex, roughness: 0.3, clearcoat: 0.5 }), 0, 0.832, zf + 0.0015));
  const bezel = mesh(new THREE.TorusGeometry(0.0315, 0.0025, 10, 48), M.chrome, 0, 0.832, zf + 0.002);
  g.add(bezel);
  g.add(knob(0, 0.832, zf + 0.002, 0.82));

  // Porta do forno (abre para baixo)
  const doorPivot = new THREE.Group();
  doorPivot.position.set(0, 0.278, zf);
  g.add(doorPivot);
  const DW = W - 0.082, DH = 0.505, DT = 0.045;
  doorPivot.add(rbox(DW, DH, DT, 0.014, E, 0, DH / 2, -DT / 2, 4));
  doorPivot.add(rbox(DW - 0.11, DH - 0.17, 0.01, 0.005, E, 0, DH / 2 - 0.035, 0.003));
  const trimShape = roundedRectShape(DW - 0.1, DH - 0.16, 0.012);
  trimShape.holes.push(roundedRectHole(DW - 0.112, DH - 0.172, 0.008));
  const trim = extrude(trimShape, 0.004, M.chrome, { curveSegments: 8 });
  trim.position.set(0, DH / 2 - 0.035, 0.006);
  doorPivot.add(trim);
  doorPivot.add(cylAlong('x', 0.011, DW - 0.13, M.chrome, 0, DH - 0.048, 0.047));
  for (const s of [-1, 1]) doorPivot.add(rbox(0.024, 0.032, 0.05, 0.008, M.chrome, s * (DW / 2 - 0.085), DH - 0.048, 0.024));
  // emblema decorativo de época (sem marca)
  doorPivot.add(rbox(0.16, 0.012, 0.006, 0.003, M.chrome, 0, DH - 0.11, 0.006));
  doorPivot.add(box(DW - 0.06, DH - 0.06, 0.004, M.granite, 0, DH / 2, -DT - 0.001));

  // Cavidade do forno
  const cav = { w: 0.62, h: 0.46, d: 0.5, y: 0.535, z: zf - 0.05 };
  const cavity = mesh(invert(new THREE.BoxGeometry(cav.w, cav.h, cav.d)), M.granite, 0, cav.y, cav.z - cav.d / 2);
  cavity.castShadow = false;
  g.add(cavity);
  const frameShape = roundedRectShape(W - 0.08, 0.51, 0.004);
  frameShape.holes.push(roundedRectHole(cav.w, cav.h, 0.01));
  const frame = extrude(frameShape, 0.012, E, { curveSegments: 6 });
  frame.position.set(0, cav.y, cav.z - 0.006);
  g.add(frame);
  const inside = new THREE.Group();
  for (const s of [-1, 1]) for (const yy of [0.4, 0.52, 0.64]) {
    inside.add(box(0.012, 0.008, cav.d - 0.06, M.granite, s * (cav.w / 2 - 0.006), yy, cav.z - cav.d / 2));
  }
  for (const yy of [0.41, 0.53]) {
    const rack = mesh(wireRackG(cav.w - 0.03, cav.d - 0.07, 0.0022, 14), M.chromeAged, 0, yy + 0.012, cav.z - cav.d / 2 + 0.01);
    inside.add(rack);
  }
  const slots = [];
  for (let i = 0; i < 9; i++) slots.push(boxG(0.018, 0.004, 0.16, -0.16 + i * 0.04, 0, 0));
  inside.add(box(cav.w - 0.02, 0.006, cav.d - 0.04, M.granite, 0, cav.y - cav.h / 2 + 0.008, cav.z - cav.d / 2));
  inside.add(merged(slots, M.enamelBlack, 0, cav.y - cav.h / 2 + 0.012, cav.z - cav.d / 2 + 0.08));
  g.add(noCast(inside));

  // Gaveta inferior (estufa)
  g.add(rbox(DW, 0.168, 0.035, 0.012, E, 0, 0.182, zf - 0.0175, 4));
  g.add(cylAlong('x', 0.0075, 0.16, M.chrome, 0, 0.214, zf + 0.03));
  for (const s of [-1, 1]) g.add(rbox(0.016, 0.022, 0.036, 0.006, M.chrome, s * 0.07, 0.214, zf + 0.013));

  // Mesa: bacias cromadas, queimadores de ferro e grelhas individuais
  const burners = [[-0.175, 0.1], [0.175, 0.1], [-0.175, -0.14], [0.175, -0.14]];
  for (const [bx, bz] of burners) {
    const b = new THREE.Group();
    b.position.set(bx, TOP, bz);
    b.add(cyl(0.098, 0.1, 0.004, M.chromeAged, 0, 0.002, 0, 48));
    b.add(cyl(0.06, 0.06, 0.002, M.enamelBlack, 0, 0.0045, 0, 40));
    b.add(cyl(0.043, 0.047, 0.018, M.castIronAged, 0, 0.013, 0, 32));
    const ports = [];
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      ports.push(boxG(0.006, 0.004, 0.004).rotateY(-a).translate(Math.cos(a) * 0.043, 0, Math.sin(a) * 0.043));
    }
    b.add(merged(ports, M.enamelBlack, 0, 0.019, 0));
    b.add(cyl(0.034, 0.039, 0.007, M.castIron, 0, 0.0255, 0, 32));
    const gr = [];
    const S = 0.2, T = 0.012, Y = 0.036;
    gr.push(boxG(S, T, T, 0, Y, S / 2 - T / 2), boxG(S, T, T, 0, Y, -S / 2 + T / 2));
    gr.push(boxG(T, T, S, S / 2 - T / 2, Y, 0), boxG(T, T, S, -S / 2 + T / 2, Y, 0));
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const len = S / 2 - 0.052;
      gr.push(boxG(dx ? len : T, T, dz ? len : T, dx * (0.052 + len / 2), Y + 0.002, dz * (0.052 + len / 2)));
    }
    for (const [cx, cz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      gr.push(boxG(T, Y - T / 2, T, cx * (S / 2 - T / 2), (Y - T / 2) / 2, cz * (S / 2 - T / 2)));
    }
    b.add(merged(gr, M.enamelBlack));
    g.add(b);
  }

  // Painel traseiro com relógio, timer e tomada auxiliar
  const bgH = 0.22, bgZ = -zf + 0.028;
  g.add(rbox(W, bgH, 0.055, 0.018, E, 0, TOP + bgH / 2 - 0.004, bgZ, 4));
  g.add(rbox(W + 0.004, 0.012, 0.06, 0.005, M.chrome, 0, TOP + bgH - 0.004, bgZ));
  const faceZ = bgZ + 0.028;
  const clockTex = drawTexture(256, 256, (c, w) => {
    c.fillStyle = '#f6efdc';
    c.beginPath(); c.arc(w / 2, w / 2, w / 2, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#2f261c';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = 'bold 30px Georgia, serif';
    for (let i = 1; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      if (i % 3 === 0) c.fillText(String(i), w / 2 + Math.cos(a) * 96, w / 2 + Math.sin(a) * 96);
      else c.fillRect(w / 2 + Math.cos(a) * 100 - 3, w / 2 + Math.sin(a) * 100 - 3, 6, 6);
    }
    const hand = (ang, len, wd) => {
      c.save(); c.translate(w / 2, w / 2); c.rotate(ang);
      c.fillRect(-wd / 2, -len, wd, len + 12); c.restore();
    };
    hand((10 / 12) * Math.PI * 2 + (10 / 60) * (Math.PI / 6), 58, 7);
    hand((10 / 60) * Math.PI * 2, 86, 5);
    c.fillStyle = '#9a2b1f';
    hand((40 / 60) * Math.PI * 2, 92, 2);
    c.beginPath(); c.arc(w / 2, w / 2, 8, 0, Math.PI * 2); c.fill();
  });
  g.add(mesh(new THREE.CircleGeometry(0.058, 48), new THREE.MeshStandardMaterial({ map: clockTex, roughness: 0.4 }), 0, TOP + 0.11, faceZ + 0.001));
  g.add(mesh(new THREE.TorusGeometry(0.06, 0.006, 12, 56), M.chrome, 0, TOP + 0.11, faceZ + 0.003));
  const dome = mesh(new THREE.SphereGeometry(0.09, 40, 8, 0, Math.PI * 2, 0, 0.73), M.clearGlass, 0, TOP + 0.11, faceZ + 0.004 - 0.0671);
  dome.rotation.x = Math.PI / 2;
  dome.castShadow = false;
  g.add(dome);

  const timerTex = drawTexture(256, 256, (c, w) => {
    c.fillStyle = '#f6efdc';
    c.beginPath(); c.arc(w / 2, w / 2, w / 2, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#2f261c';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = 'bold 26px Georgia, serif';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      c.fillText(String(i * 10), w / 2 + Math.cos(a) * 92, w / 2 + Math.sin(a) * 92);
    }
    c.font = '18px Georgia, serif';
    c.fillText('MINUTOS', w / 2, w / 2 + 50);
  });
  g.add(mesh(new THREE.CircleGeometry(0.036, 40), new THREE.MeshStandardMaterial({ map: timerTex, roughness: 0.4 }), 0.25, TOP + 0.11, faceZ + 0.001));
  g.add(mesh(new THREE.TorusGeometry(0.037, 0.004, 10, 48), M.chrome, 0.25, TOP + 0.11, faceZ + 0.002));
  g.add(knob(0.25, TOP + 0.11, faceZ + 0.002, 0.6));

  g.add(rbox(0.07, 0.09, 0.006, 0.006, M.chrome, -0.25, TOP + 0.11, faceZ + 0.002));
  for (const s of [-1, 1]) g.add(cylAlong('z', 0.0045, 0.004, M.enamelBlack, -0.25 + s * 0.011, TOP + 0.11, faceZ + 0.005, 16));

  // Entrada de gás na traseira
  g.add(cylAlong('z', 0.011, 0.06, M.brass, 0.27, 0.62, -zf - 0.02, 16));
  g.add(cylAlong('z', 0.016, 0.014, M.brass, 0.27, 0.62, -zf - 0.052, 6));

  // Detalhes das laterais: friso cromado
  for (const s of [-1, 1]) g.add(box(0.004, 0.006, D - 0.06, M.chrome, s * W / 2, 0.5, 0));

  const door = new Toggle((e) => { doorPivot.rotation.x = e * 1.42; }, 1.1);
  return {
    object: g,
    actions: [{ id: 'door', label: 'Abrir forno', activeLabel: 'Fechar forno', toggle: door }],
    update: (dt) => door.update(dt),
  };
}
