import { describe, expect, it } from "vitest";
import { cropSize, displaySize, localFraming, manualCrop } from "./framing";

describe("enquadramento (mesmas regras do back-end)", () => {
  it("calcula o maior recorte de cada formato", () => {
    expect(cropSize(1920, 1080, "9:16")).toEqual([608, 1080]);
    expect(cropSize(1280, 720, "9:16")).toEqual([404, 720]); // 405 → par mais próximo, como no Python
    expect(cropSize(1920, 1080, "16:9")).toEqual([1920, 1080]);
    expect(cropSize(1080, 1920, "16:9")).toEqual([1080, 608]);
    expect(cropSize(1920, 1080, "1:1")).toEqual([1080, 1080]);
  });

  it("posiciona o recorte manual com zoom", () => {
    expect(manualCrop(1920, 1080, "9:16", { x: 0, y: 0.5, zoom: 1 })).toEqual({ x: 0, y: 0, width: 608, height: 1080 });
    expect(manualCrop(1920, 1080, "9:16", { x: 1, y: 0.5, zoom: 1 }).x).toBe(1312);
    expect(manualCrop(1920, 1080, "9:16", { x: 0.5, y: 0, zoom: 2 })).toEqual({ x: 808, y: 0, width: 304, height: 540 });
    // valores fora da faixa são limitados
    expect(manualCrop(1920, 1080, "9:16", { x: 3, y: -1, zoom: 9 })).toEqual(manualCrop(1920, 1080, "9:16", { x: 1, y: 0, zoom: 3 }));
  });

  it("monta o enquadramento local para a prévia", () => {
    const center = localFraming(1920, 1080, "9:16", null);
    expect([center.mode, center.x, center.crop_width]).toEqual(["centro", 656, 608]);
    const manual = localFraming(1920, 1080, "9:16", { mode: "manual", x: 0, y: 0.5, zoom: 1 });
    expect([manual.mode, manual.x]).toEqual(["manual", 0]);
  });

  it("considera a rotação do vídeo", () => {
    expect(displaySize({ width: 1920, height: 1080, rotation: 90 })).toEqual([1080, 1920]);
    expect(displaySize({ width: 1920, height: 1080, rotation: 180 })).toEqual([1920, 1080]);
  });
});
