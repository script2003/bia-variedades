import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

import { createMaterials } from './lib/materials.js';
import { mesh, rboxGeo, extrudeGeo, roundedRectShape, roundedRectHole } from './lib/geo.js';
import { drawTexture } from './lib/textures.js';
import { zipSingleFile } from './lib/zip.js';
import { createStoveOld } from './models/stoveOld.js';
import { createStoveModern } from './models/stoveModern.js';
import { createFridgeOld } from './models/fridgeOld.js';
import { createFridgeModern } from './models/fridgeModern.js';
import { createTvOld } from './models/tvOld.js';
import { createTvModern } from './models/tvModern.js';
import { AREAS, MODELS } from './data.js';
import { initUI } from './ui.js';

// Posição de cada aparelho na cena: antigos à esquerda, atuais à direita de cada área.
const AREA_X = { fogoes: -4.4, geladeiras: 0, televisoes: 4.4 };
const LAYOUT = {
  stoveOld: { dx: -0.85, plinth: [1.1, 0.06, 1.25, -0.1], make: createStoveOld },
  stoveModern: { dx: 0.85, plinth: [1.1, 0.06, 1.25, -0.1], make: createStoveModern },
  fridgeOld: { dx: -0.8, plinth: [1.05, 0.06, 1.3, -0.12], make: createFridgeOld },
  fridgeModern: { dx: 0.85, plinth: [1.25, 0.06, 1.35, -0.1], make: createFridgeModern },
  tvOld: { dx: -0.95, plinth: [0.86, 0.5, 1.05, -0.15], make: createTvOld },
  tvModern: { dx: 0.85, plinth: [1.5, 0.5, 0.82, -0.1], make: createTvModern },
};

const stage = document.getElementById('stage');
const coarse = matchMedia('(pointer: coarse)').matches;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, coarse ? 1.75 : 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.className = 'labels';
stage.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 140);
camera.position.set(0, 5, 14);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.8;

// Iluminação de estúdio: luz principal com sombra suave, contraluz e preenchimento
scene.add(new THREE.HemisphereLight(0xffffff, 0xb7b0a6, 0.5));
const key = new THREE.DirectionalLight(0xfff5ea, 1.9);
key.position.set(-3.5, 11, 6.5);
key.castShadow = true;
key.shadow.mapSize.set(coarse ? 1536 : 2048, coarse ? 1536 : 2048);
Object.assign(key.shadow.camera, { left: -7.5, right: 7.5, top: 5, bottom: -5, near: 1, far: 30 });
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
scene.add(key);
const rim = new THREE.DirectionalLight(0xdfe7ff, 0.75);
rim.position.set(4, 5, -8);
scene.add(rim);
const fill = new THREE.DirectionalLight(0xffffff, 0.3);
fill.position.set(7, 3, 6);
scene.add(fill);

const floorMat = new THREE.MeshStandardMaterial({ color: 0xdcd8d2, roughness: 0.92 });
const floor = new THREE.Mesh(new THREE.CircleGeometry(70, 72), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
scene.fog = new THREE.Fog(0xe7e4df, 24, 64);

// Materiais e modelos
const M = createMaterials();
const plinthMat = new THREE.MeshStandardMaterial({ color: 0xf2f0ec, roughness: 0.7 });
const ringMat = new THREE.MeshBasicMaterial({ color: 0x2456c9, transparent: true, opacity: 0, depthWrite: false });
const proxyMat = new THREE.MeshBasicMaterial({ visible: false });

const items = {};
const proxies = [];
for (const [id, L] of Object.entries(LAYOUT)) {
  const info = MODELS[id];
  const x = AREA_X[info.area] + L.dx;
  const [pw, ph, pd, pz] = L.plinth;
  const plinth = mesh(rboxGeo(pw, ph, pd, 0.012, 2), plinthMat, x, ph / 2, pz);
  scene.add(plinth);
  const ringShape = roundedRectShape(pw + 0.1, pd + 0.1, 0.05);
  ringShape.holes.push(roundedRectHole(pw + 0.03, pd + 0.03, 0.02));
  const ring = new THREE.Mesh(extrudeGeo(ringShape, 0.002, { curveSegments: 6 }), ringMat.clone());
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.002, pz);
  ring.renderOrder = 1;
  scene.add(ring);

  const model = L.make(M);
  model.object.position.set(x, ph, 0);
  model.object.userData.modelId = id;
  scene.add(model.object);
  model.object.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(model.object, true);
  const size = bbox.getSize(new THREE.Vector3());
  const proxy = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), proxyMat);
  bbox.getCenter(proxy.position);
  proxy.userData.modelId = id;
  scene.add(proxy);
  proxies.push(proxy);

  const chip = document.createElement('button');
  chip.className = `chip chip-${info.kind}`;
  chip.type = 'button';
  chip.dataset.model = id;
  chip.innerHTML = `<span class="chip-era">${info.kind === 'old' ? 'Antigo' : 'Atual'}</span><span class="chip-name">${info.chip}</span>`;
  const label = new CSS2DObject(chip);
  label.position.set(bbox.getCenter(new THREE.Vector3()).x, bbox.max.y + 0.16, 0);
  scene.add(label);

  items[id] = { id, info, model, plinth, ring, bbox, label, chip };
}

// Títulos das áreas impressos no piso
const floorTitles = [];
function titleTexture(area, dark) {
  return drawTexture(1024, 256, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    const ink = dark ? 'rgba(236,235,232,0.9)' : 'rgba(31,33,36,0.82)';
    const soft = dark ? 'rgba(236,235,232,0.55)' : 'rgba(31,33,36,0.5)';
    c.textAlign = 'center';
    c.fillStyle = soft;
    c.font = '600 34px "IBM Plex Mono", ui-monospace, monospace';
    c.fillText(`ÁREA ${area.n}`, w / 2, 58);
    c.fillStyle = ink;
    c.font = '700 104px "Bricolage Grotesque", "Arial Narrow", sans-serif';
    c.fillText(area.title.toUpperCase(), w / 2, 160);
    c.fillStyle = soft;
    c.font = '500 32px "IBM Plex Mono", ui-monospace, monospace';
    c.fillText('ANTIGO  ←        →  ATUAL', w / 2, 222);
  });
}
for (const area of AREAS) {
  const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), mat);
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(AREA_X[area.id], 0.003, 1.2);
  scene.add(plane);
  floorTitles.push({ area, mat });
}

// Tema claro/escuro acompanha o visualizador
function isDark() {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return matchMedia('(prefers-color-scheme: dark)').matches;
}
function applyTheme() {
  const dark = isDark();
  const bg = new THREE.Color(dark ? 0x232427 : 0xe7e4df);
  scene.background = bg;
  scene.fog.color.copy(bg);
  floorMat.color.set(dark ? 0x2b2c30 : 0xdcd8d2);
  plinthMat.color.set(dark ? 0x3a3b40 : 0xf2f0ec);
  scene.environmentIntensity = dark ? 0.7 : 0.8;
  for (const it of Object.values(items)) it.ring.material.color.set(dark ? 0x7da2ff : 0x2456c9);
  for (const f of floorTitles) {
    f.mat.map?.dispose();
    f.mat.map = titleTexture(f.area, dark);
    f.mat.needsUpdate = true;
  }
  invalidate();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
document.fonts?.ready.then(applyTheme);

// Câmera e controles
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;
controls.minDistance = 0.45;
controls.maxDistance = 32;
controls.maxPolarAngle = Math.PI * 0.495;
controls.autoRotateSpeed = 1.2;
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

let dirty = 2;
function invalidate() { dirty = 2; }
controls.addEventListener('change', invalidate);

let tween = null;
controls.addEventListener('start', () => { tween = null; ui.onUserMove(); });

// Área visível (o painel lateral/inferior cobre parte da tela)
let inset = { top: 0, right: 0, bottom: 0 };
function viewSize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  return { w, h, vw: Math.max(200, w - inset.right), vh: Math.max(160, h - inset.bottom - inset.top) };
}
function resize() {
  const { w, h, vw, vh } = viewSize();
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.setViewOffset(w, h, inset.right / 2, (inset.bottom - inset.top) / 2, w, h);
  camera.userData.visibleAspect = vw / vh;
  camera.userData.visibleScale = vh / h;
  camera.updateProjectionMatrix();
  invalidate();
}
window.addEventListener('resize', resize);

function frame(box, dir, pad = 1.2) {
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * (camera.userData.visibleScale || 1);
  const tanH = tanV * (camera.userData.visibleAspect || camera.aspect);
  const d = dir.clone().normalize();
  const horiz = Math.abs(d.x) > 0.6 ? Math.max(size.z, size.x * 0.6) : Math.max(size.x, size.z * 0.5);
  const dist = Math.max(size.y / 2 / tanV, horiz / 2 / tanH) * pad + Math.max(size.x, size.z) * 0.5 * (Math.abs(d.x) > 0.6 ? 1 : 0.4);
  return { pos: center.clone().add(d.multiplyScalar(dist)), target: center };
}

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function flyTo({ pos, target }, dur = 1.1) {
  if (reduceMotion) dur = 0.0001;
  tween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target, t: 0, dur };
  invalidate();
}

function boxOf(ids, withPlinth = true) {
  const b = new THREE.Box3();
  for (const id of ids) {
    b.union(items[id].bbox);
    if (withPlinth) b.union(new THREE.Box3().setFromObject(items[id].plinth));
  }
  return b;
}

const views = {
  overview: () => frame(boxOf(Object.keys(items)), new THREE.Vector3(0, 0.42, 1), 1.1),
  area: (areaId) => {
    const a = AREAS.find((x) => x.id === areaId);
    return frame(boxOf([a.old, a.modern]), new THREE.Vector3(0, 0.3, 1), 1.1);
  },
  model: (id, kind = 'front') => {
    const dirs = {
      front: new THREE.Vector3(items[id].info.kind === 'old' ? 0.42 : -0.42, 0.3, 1),
      side: new THREE.Vector3(1.25, 0.35, 0.75),
      back: new THREE.Vector3(-0.85, 0.45, -1),
    };
    return frame(items[id].bbox, dirs[kind] || dirs.front, 1.55);
  },
};

// Seleção e destaque
let hovered = null;
let selected = null;
function setRings() {
  for (const it of Object.values(items)) {
    const o = it.id === selected ? 0.9 : it.id === hovered ? 0.35 : 0;
    it.ring.material.opacity = o;
    it.ring.visible = o > 0;
  }
  invalidate();
}

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function pick(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(proxies, false)[0];
  return hit ? hit.object.userData.modelId : null;
}
let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  const quick = performance.now() - down.t < 600;
  down = null;
  if (moved < 6 && quick) {
    const id = pick(e);
    if (id) ui.selectModel(id);
  }
});
let hoverQueued = null;
renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || e.buttons) return;
  hoverQueued = e;
});
renderer.domElement.addEventListener('pointerleave', () => { hovered = null; setRings(); renderer.domElement.style.cursor = ''; });

// Exportação GLB (modelo na origem, no estado atual)
const exporter = new GLTFExporter();
async function exportGLB(id) {
  const obj = items[id].model.object;
  const pos = obj.position.clone();
  obj.position.set(0, 0, 0);
  obj.updateMatrixWorld(true);
  try {
    return await exporter.parseAsync(obj, { binary: true, onlyVisible: true, maxTextureSize: 1024 });
  } finally {
    obj.position.copy(pos);
    obj.updateMatrixWorld(true);
  }
}
// Dentro do visualizador do claude.ai o download passa pela capacidade "downloads",
// que aceita .zip mas não .glb; fora dele, o navegador baixa o .glb direto.
async function viewerDownloads() {
  if (!window.claude?.use) return null;
  try { return await window.claude.use('downloads'); } catch { return null; }
}
async function downloadGLB(id) {
  const buf = await exportGLB(id);
  const file = MODELS[id].file;
  const dl = await viewerDownloads();
  if (dl) {
    const name = file.replace(/\.glb$/, '.zip');
    await dl.save({ filename: name, data: zipSingleFile(file, new Uint8Array(buf)) });
    return name;
  }
  const url = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = file;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return file;
}

const ui = initUI({
  items,
  onView(kind, arg, opts = {}) {
    selected = kind === 'model' ? arg : null;
    setRings();
    const v = views[kind](arg, opts.angle);
    flyTo(v, opts.instant ? 0.0001 : 1.1);
    const showChips = kind === 'area' || (kind === 'overview' && stage.clientWidth > 700);
    for (const it of Object.values(items)) it.label.visible = showChips;
    invalidate();
  },
  onAction(id, action) {
    action.toggle.toggle();
    invalidate();
    return action.toggle.on;
  },
  onAutoRotate(on) { controls.autoRotate = on; invalidate(); },
  onInset(next) {
    if (['top', 'right', 'bottom'].every((k) => Math.abs(next[k] - inset[k]) < 1)) return;
    inset = next;
    resize();
  },
  downloadGLB,
});

window.__exhibit = { exportGLB, items, MODELS, camera, controls };

// Laço de renderização (só redesenha quando algo muda)
const clock = new THREE.Clock();
const TARGET_MIN = new THREE.Vector3(-8, 0.05, -4), TARGET_MAX = new THREE.Vector3(8, 2.6, 4);
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.1);
  if (tween) {
    tween.t = Math.min(1, tween.t + dt / tween.dur);
    const t = tween.t, e = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
    camera.position.lerpVectors(tween.p0, tween.p1, e);
    controls.target.lerpVectors(tween.t0, tween.t1, e);
    if (t >= 1) tween = null;
    invalidate();
  }
  for (const it of Object.values(items)) if (it.model.update(dt)) invalidate();
  if (controls.autoRotate) invalidate();
  controls.target.clamp(TARGET_MIN, TARGET_MAX);
  controls.update();
  if (hoverQueued) {
    const id = pick(hoverQueued);
    hoverQueued = null;
    if (id !== hovered) {
      hovered = id;
      renderer.domElement.style.cursor = id ? 'pointer' : '';
      setRings();
    }
  }
  if (dirty > 0) {
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    dirty--;
  }
}

applyTheme();
resize();
ui.start();
loop();
document.body.classList.add('ready');
