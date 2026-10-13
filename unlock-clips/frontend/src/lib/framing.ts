import type { AspectRatio, ClipFraming, FramingOverride } from "../api/types";

/** Tamanhos de saída (iguais aos do back-end). */
export const OUTPUT_SIZES: Record<AspectRatio, [number, number]> = {
  "9:16": [1080, 1920],
  "1:1": [1080, 1080],
  "16:9": [1920, 1080],
};

/** Arredondamento "meio para o par", igual ao `round()` do Python usado no back-end. */
export function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  if (Math.abs(value - floor - 0.5) < 1e-9) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(value);
}

const even = (value: number) => Math.max(2, roundHalfEven(value / 2) * 2);

/** Maior recorte com a proporção de saída que cabe no quadro original (mesma regra do FFmpeg no back-end). */
export function cropSize(srcW: number, srcH: number, aspect: AspectRatio): [number, number] {
  const [outW, outH] = OUTPUT_SIZES[aspect];
  const ratio = outW / outH;
  if (srcW / srcH > ratio) return [Math.min(srcW, even(srcH * ratio)), srcH - (srcH % 2)];
  return [srcW - (srcW % 2), Math.min(srcH, even(srcW / ratio))];
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Recorte do modo "posição fixa": x/y de 0 a 1 no espaço livre e zoom de 1 a 3. */
export function manualCrop(srcW: number, srcH: number, aspect: AspectRatio, override: Pick<FramingOverride, "x" | "y" | "zoom">): CropRect {
  const [baseW, baseH] = cropSize(srcW, srcH, aspect);
  const zoom = Math.min(Math.max(override.zoom, 1), 3);
  const width = Math.min(baseW, even(baseW / zoom));
  const height = Math.min(baseH, even(baseH / zoom));
  const clamp = (v: number) => Math.min(Math.max(v, 0), 1);
  return { x: roundHalfEven((srcW - width) * clamp(override.x)), y: roundHalfEven((srcH - height) * clamp(override.y)), width, height };
}

/** Posição horizontal do recorte no instante `t` (interpolação linear entre os pontos-chave). */
export function cropXAt(framing: ClipFraming, t: number): number {
  const keys = framing.keyframes;
  if (keys.length === 0) return framing.x;
  if (t <= keys[0]![0]) return keys[0]![1];
  for (let k = 1; k < keys.length; k++) {
    const [t1, x1] = keys[k]!;
    if (t <= t1) {
      const [t0, x0] = keys[k - 1]!;
      return x0 + ((x1 - x0) * (t - t0)) / (t1 - t0 || 1);
    }
  }
  return keys[keys.length - 1]![1];
}

export function cropRectAt(framing: ClipFraming, t: number): CropRect {
  return { x: cropXAt(framing, t), y: framing.y, width: framing.crop_width, height: framing.crop_height };
}

/**
 * Posição e tamanho do `<video>` (absoluto, dentro de uma caixa com a proporção de saída) para que
 * apenas o recorte apareça — o mesmo resultado do filtro `crop` + `scale` do FFmpeg.
 */
export function videoCropStyle(rect: CropRect, srcW: number, srcH: number, boxWidth: number) {
  const scale = boxWidth / rect.width;
  return {
    position: "absolute" as const,
    left: -rect.x * scale,
    top: -rect.y * scale,
    width: srcW * scale,
    height: srcH * scale,
    maxWidth: "none",
  };
}

/** Enquadramento local (sem consultar o servidor) para os modos central e manual. */
export function localFraming(
  srcW: number,
  srcH: number,
  aspect: AspectRatio,
  override: FramingOverride | null,
): ClipFraming {
  const mode = override?.mode === "manual" ? "manual" : "centro";
  const rect =
    mode === "manual" && override
      ? manualCrop(srcW, srcH, aspect, override)
      : (() => {
          const [w, h] = cropSize(srcW, srcH, aspect);
          return { x: Math.floor((srcW - w) / 2), y: Math.floor((srcH - h) / 2), width: w, height: h };
        })();
  return {
    mode,
    requested: override?.mode ?? "centro",
    override,
    source_width: srcW,
    source_height: srcH,
    crop_width: rect.width,
    crop_height: rect.height,
    x: rect.x,
    y: rect.y,
    keyframes: [],
    notes: [],
  };
}

/** Dimensões do vídeo como aparece na tela (considera a rotação gravada pelo celular). */
export function displaySize(video: { width: number; height: number; rotation: number }): [number, number] {
  return Math.abs(video.rotation) % 180 === 90 ? [video.height, video.width] : [video.width, video.height];
}
