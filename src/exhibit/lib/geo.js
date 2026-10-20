import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Unidades em metros. Cada modelo tem origem no centro da base, com a frente voltada para +Z.

export function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function rboxGeo(w, h, d, r, seg = 3) {
  const rr = Math.max(0.0005, Math.min(r, Math.min(w, h, d) / 2 - 0.0002));
  return new RoundedBoxGeometry(w, h, d, seg, rr);
}

export const rbox = (w, h, d, r, mat, x, y, z, seg) => mesh(rboxGeo(w, h, d, r, seg), mat, x, y, z);
export const box = (w, h, d, mat, x, y, z) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
export const cyl = (rt, rb, h, mat, x, y, z, seg = 32) =>
  mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z);

/** Cilindro deitado ao longo de um eixo ('x' ou 'z'). */
export function cylAlong(axis, r, len, mat, x, y, z, seg = 24) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  else if (axis === 'z') g.rotateX(Math.PI / 2);
  return mesh(g, mat, x, y, z);
}

export function lathe(points, mat, seg = 40) {
  const g = new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), seg);
  return mesh(g, mat);
}

/** Geometrias transladadas para mesclar em uma única malha. */
export function boxG(w, h, d, x = 0, y = 0, z = 0) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

export function rodG(a, b, r, seg = 8) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const v = B.clone().sub(A);
  const len = v.length();
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize()));
  g.translate(A.x, A.y, A.z);
  return g;
}

export function merge(geos) {
  const list = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  list.forEach((g) => { if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); });
  return mergeGeometries(list, false);
}

export const merged = (geos, mat, x, y, z) => mesh(merge(geos), mat, x, y, z);

/** Grade de arame (prateleira de forno/geladeira), no plano XZ, centrada na origem. */
export function wireRackG(w, d, r = 0.0025, rods = 12, frameR = r * 1.6) {
  const geos = [];
  const hw = w / 2, hd = d / 2;
  geos.push(rodG([-hw, 0, hd], [hw, 0, hd], frameR));
  geos.push(rodG([-hw, 0, -hd], [hw, 0, -hd], frameR));
  geos.push(rodG([-hw, 0, -hd], [-hw, 0, hd], frameR));
  geos.push(rodG([hw, 0, -hd], [hw, 0, hd], frameR));
  for (let i = 1; i < rods; i++) {
    const x = -hw + (w * i) / rods;
    geos.push(rodG([x, 0, -hd], [x, 0, hd], r));
  }
  geos.push(rodG([-hw, 0, 0], [hw, 0, 0], r));
  return merge(geos);
}

/** Retângulo arredondado com raio por canto: [superior esq., superior dir., inferior dir., inferior esq.]. */
export function roundedRectPath(path, w, h, r, cx = 0, cy = 0) {
  const [tl, tr, br, bl] = Array.isArray(r) ? r : [r, r, r, r];
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
  path.moveTo(x0 + bl, y0);
  path.lineTo(x1 - br, y0);
  if (br) path.absarc(x1 - br, y0 + br, br, -Math.PI / 2, 0, false);
  path.lineTo(x1, y1 - tr);
  if (tr) path.absarc(x1 - tr, y1 - tr, tr, 0, Math.PI / 2, false);
  path.lineTo(x0 + tl, y1);
  if (tl) path.absarc(x0 + tl, y1 - tl, tl, Math.PI / 2, Math.PI, false);
  path.lineTo(x0, y0 + bl);
  if (bl) path.absarc(x0 + bl, y0 + bl, bl, Math.PI, Math.PI * 1.5, false);
  return path;
}

export function roundedRectShape(w, h, r, cx, cy) {
  return roundedRectPath(new THREE.Shape(), w, h, r, cx, cy);
}

export function roundedRectHole(w, h, r, cx, cy) {
  return roundedRectPath(new THREE.Path(), w, h, r, cx, cy);
}

/** Superelipse |x/a|^n + |y/b|^n = 1 (formato de tela de tubo). */
export function superellipsePoints(a, b, n = 4, count = 96, cx = 0, cy = 0) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    pts.push(new THREE.Vector2(
      cx + a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n),
      cy + b * Math.sign(s) * Math.pow(Math.abs(s), 2 / n),
    ));
  }
  return pts;
}

/** Extrusão centrada em Z (a espessura total inclui o chanfro). */
export function extrudeGeo(shape, depth, { bevel = 0, bevelSeg = 3, curveSegments = 18 } = {}) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, curveSegments,
    bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: bevelSeg,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

export const extrude = (shape, depth, mat, opts) => mesh(extrudeGeo(shape, depth, opts), mat);

/** Inverte as faces: transforma um sólido fechado numa cavidade visível por dentro (compatível com glTF). */
export function invert(geo) {
  if (geo.index) {
    const idx = geo.index.array;
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  } else {
    for (const key of Object.keys(geo.attributes)) {
      const a = geo.attributes[key], s = a.itemSize, arr = a.array;
      for (let v = 0; v < a.count; v += 3) {
        for (let k = 0; k < s; k++) {
          const i1 = (v + 1) * s + k, i2 = (v + 2) * s + k;
          const t = arr[i1]; arr[i1] = arr[i2]; arr[i2] = t;
        }
      }
    }
  }
  const n = geo.attributes.normal;
  if (n) for (let i = 0; i < n.array.length; i++) n.array[i] *= -1;
  return geo;
}

/** Caixa com a face traseira menor que a frontal (tampa traseira de TV). Frente em z=0, fundo em z=-depth. */
export function taperedBoxGeo(w0, h0, w1, h1, depth, offX = 0, offY = 0) {
  const g = new THREE.BoxGeometry(1, 1, depth);
  g.translate(0, 0, -depth / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = -p.getZ(i) / depth;
    const w = w0 + (w1 - w0) * t, h = h0 + (h1 - h0) * t;
    p.setX(i, p.getX(i) * w + offX * t);
    p.setY(i, p.getY(i) * h + offY * t);
  }
  g.computeVertexNormals();
  return g;
}

/** Superfície convexa de vidro (tela CRT): grade quadrada mapeada para uma superelipse e abaulada. */
export function bulgedScreenGeo(a, b, n, bulge, seg = 48) {
  const g = new THREE.PlaneGeometry(2, 2, seg, seg);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i), v = p.getY(i);
    const m = Math.max(Math.abs(u), Math.abs(v));
    let x = 0, y = 0;
    if (m > 1e-6) {
      const ln = Math.pow(Math.pow(Math.abs(u), n) + Math.pow(Math.abs(v), n), 1 / n);
      x = (u * m) / ln; y = (v * m) / ln;
    }
    const d = x * x + y * y;
    p.setXYZ(i, x * a, y * b, bulge * (1 - Math.min(1, d * 0.5)));
    uv.setXY(i, (x + 1) / 2, (y + 1) / 2);
  }
  g.computeVertexNormals();
  return g;
}

/** Funil do tubo de imagem: da superelipse da tela até o pescoço circular. */
export function funnelGeo(a, b, n, neckR, length, rings = 18, seg = 64) {
  const pos = [], idx = [];
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const k = Math.pow(t, 0.7);
    const z = -length * t;
    for (let i = 0; i <= seg; i++) {
      const ang = (i / seg) * Math.PI * 2;
      const c = Math.cos(ang), s = Math.sin(ang);
      const sx = a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
      const sy = b * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
      pos.push(sx + (neckR * c - sx) * k, sy + (neckR * s - sy) * k, z);
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a0 = j * (seg + 1) + i, a1 = a0 + 1, b0 = a0 + seg + 1, b1 = b0 + 1;
      idx.push(a0, b0, a1, a1, b0, b1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Tubo ao longo de uma curva (cabos, alavancas). */
export function tube(points, r, mat, seg = 48) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return mesh(new THREE.TubeGeometry(curve, seg, r, 10, false), mat);
}

/** Plano com textura (etiquetas, mostradores impressos). */
export function decal(w, h, map, { x = 0, y = 0, z = 0, emissive = false, roughness = 0.4, transparent = true } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    map, transparent, roughness, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  if (emissive) {
    mat.emissiveMap = map;
    mat.emissive = new THREE.Color(0xffffff);
    mat.emissiveIntensity = 1;
    mat.color.set(0x000000);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z);
  m.receiveShadow = true;
  return m;
}

/** Animação suave entre fechado (0) e aberto (1). */
export class Toggle {
  constructor(apply, duration = 0.9) {
    this.t = 0;
    this.target = 0;
    this.apply = apply;
    this.speed = 1 / duration;
    apply(0);
  }
  set(on) { this.target = on ? 1 : 0; }
  toggle() { this.set(this.target === 0); return this.target === 1; }
  get on() { return this.target === 1; }
  update(dt) {
    if (this.t === this.target) return false;
    const dir = Math.sign(this.target - this.t);
    this.t = Math.min(1, Math.max(0, this.t + dir * dt * this.speed));
    const e = this.t < 0.5 ? 4 * this.t ** 3 : 1 - (-2 * this.t + 2) ** 3 / 2;
    this.apply(e, this.t);
    return true;
  }
}

/** Plugue de tomada no fim de um cabo, apontando para -Z. */
export function plug(x, y, z, mat, pinMat) {
  const p = new THREE.Group();
  p.add(rbox(0.028, 0.02, 0.04, 0.006, mat, 0, 0, 0));
  for (const s of [-1, 1]) p.add(cylAlong('z', 0.002, 0.018, pinMat, s * 0.0095, 0, -0.028, 8));
  p.position.set(x, y + 0.01, z - 0.02);
  return p;
}

/** Desliga sombras projetadas de peças internas pequenas (melhor desempenho). */
export function noCast(obj) {
  obj.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  return obj;
}
