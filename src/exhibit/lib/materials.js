import * as THREE from 'three';
import { enamelTextures, brushedTextures, woodTexture, graniteTexture } from './textures.js';

const std = (name, o) => Object.assign(new THREE.MeshStandardMaterial(o), { name });
const phys = (name, o) => Object.assign(new THREE.MeshPhysicalMaterial(o), { name });

/** Biblioteca de materiais fisicamente plausíveis, compartilhada pelos seis modelos. */
export function createMaterials() {
  const cream = enamelTextures('#e6d9bc', 7, 1);
  const mint = enamelTextures('#bcd7c6', 19, 0.7);
  const steel = brushedTextures(3);

  const M = {
    // Esmaltes vitrificados (anos 1950)
    enamelCream: phys('Esmalte creme', {
      map: cream.map, roughness: 1, roughnessMap: cream.roughnessMap,
      clearcoat: 0.55, clearcoatRoughness: 0.16,
    }),
    enamelMint: phys('Esmalte verde-menta', {
      map: mint.map, roughness: 1, roughnessMap: mint.roughnessMap,
      clearcoat: 0.55, clearcoatRoughness: 0.14,
    }),
    enamelBlack: phys('Esmalte preto', { color: 0x141312, roughness: 0.38, clearcoat: 0.4, clearcoatRoughness: 0.3 }),
    granite: phys('Esmalte granitado', { map: graniteTexture(5), roughness: 0.42, clearcoat: 0.3 }),
    ovenDark: phys('Esmalte do forno', {
      map: graniteTexture(9, '#17191d', '#5d6269', 2200), roughness: 0.5, clearcoat: 0.2,
    }),
    porcelain: phys('Porcelana', { color: 0xf1ede2, roughness: 0.28, clearcoat: 0.4, clearcoatRoughness: 0.2 }),

    // Metais
    chrome: std('Cromado', { color: 0xeaeaea, metalness: 1, roughness: 0.07 }),
    chromeAged: std('Cromado envelhecido', { color: 0xd3cfc6, metalness: 1, roughness: 0.22 }),
    steel: phys('Aço inox escovado', {
      color: 0xffffff, map: steel.map, metalness: 1, roughness: 1, roughnessMap: steel.roughnessMap,
      anisotropy: 0.55,
    }),
    steelSatin: std('Aço acetinado', { color: 0xc8cbcf, metalness: 1, roughness: 0.32 }),
    galvanized: std('Chapa galvanizada', { color: 0x8e9295, metalness: 0.75, roughness: 0.55 }),
    paintedSilver: std('Pintura prata', { color: 0xb3b6ba, metalness: 0.55, roughness: 0.42 }),
    aluminum: std('Alumínio', { color: 0xb8bbbf, metalness: 1, roughness: 0.34 }),
    aluminumFrost: std('Alumínio fosco', { color: 0xd2d6da, metalness: 0.6, roughness: 0.58 }),
    darkMetal: std('Metal grafite', { color: 0x2a2c30, metalness: 0.85, roughness: 0.33 }),
    castIron: std('Ferro fundido', { color: 0x1c1c1e, metalness: 0.45, roughness: 0.78 }),
    castIronAged: std('Ferro fundido antigo', { color: 0x2b2724, metalness: 0.35, roughness: 0.82 }),
    copper: std('Cobre', { color: 0xb8703f, metalness: 1, roughness: 0.32 }),
    brass: std('Latão', { color: 0xa98a52, metalness: 1, roughness: 0.38 }),

    // Plásticos e borrachas
    bakelite: phys('Baquelite', { color: 0x1b1512, roughness: 0.28, clearcoat: 0.7, clearcoatRoughness: 0.15 }),
    plasticWhite: std('Plástico branco', { color: 0xf3f3f0, roughness: 0.36 }),
    plasticGray: std('Plástico cinza', { color: 0x8c9095, roughness: 0.45 }),
    plasticBlack: std('Plástico preto', { color: 0x121214, roughness: 0.5 }),
    plasticBlackGloss: phys('Plástico preto brilhante', { color: 0x0b0b0c, roughness: 0.18, clearcoat: 0.6 }),
    plasticCharcoal: std('Plástico grafite', { color: 0x2a2826, roughness: 0.5 }),
    plasticBrown: std('Plástico marrom texturizado', { color: 0x2c2018, roughness: 0.7 }),
    plasticBackTV: std('Plástico fosco', { color: 0x1c1d20, roughness: 0.68 }),
    plasticClear: phys('Plástico transparente', {
      color: 0xe6f0f4, roughness: 0.08, transparent: true, opacity: 0.32, depthWrite: false,
    }),
    rubber: std('Borracha', { color: 0x161616, roughness: 0.92 }),
    gasketGray: std('Borracha cinza', { color: 0x9a9ea3, roughness: 0.85 }),
    ceramic: std('Cerâmica', { color: 0xf4f2ec, roughness: 0.3 }),

    // Vidros
    blackGlass: phys('Vidro temperado preto', {
      color: 0x050506, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02,
    }),
    clearGlass: phys('Vidro', {
      color: 0xd8ecea, roughness: 0.03, transparent: true, opacity: 0.26, depthWrite: false,
    }),

    // Madeira, placa de circuito, revestimento do tubo
    wood: phys('Folheado de nogueira', {
      map: woodTexture(23), roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.35,
    }),
    pcb: std('Placa de circuito', { color: 0x2f5b3b, roughness: 0.6 }),
    aquadag: std('Grafite do tubo', { color: 0x1a1a1b, metalness: 0.2, roughness: 0.6 }),

    // Luzes embutidas
    ledWhite: std('LED branco', { color: 0xffffff, emissive: 0xf4f8ff, emissiveIntensity: 2.2 }),
    lampWarm: std('Lâmpada', { color: 0xfff3d6, emissive: 0xffd9a0, emissiveIntensity: 0.0 }),
  };
  return M;
}
