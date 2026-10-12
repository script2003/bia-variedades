import type { AspectRatio, DurationPreset, FramingMode, SubtitlePosition, SubtitleStyle } from "../api/types";

export interface Option<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export const DURATION_OPTIONS: Option<DurationPreset>[] = [
  { value: "15-30", label: "15–30 s", hint: "Ganchos rápidos" },
  { value: "30-60", label: "30–60 s", hint: "Equilíbrio entre contexto e ritmo" },
  { value: "60-90", label: "60–90 s", hint: "Histórias e explicações" },
];

export const ASPECT_OPTIONS: Option<AspectRatio>[] = [
  { value: "9:16", label: "9:16", hint: "TikTok, Reels, Shorts" },
  { value: "1:1", label: "1:1", hint: "Feed quadrado" },
  { value: "16:9", label: "16:9", hint: "Horizontal" },
];

export const SUBTITLE_STYLE_OPTIONS: Option<SubtitleStyle>[] = [
  { value: "destaque", label: "Destaque", hint: "Texto grande com contorno" },
  { value: "classico", label: "Clássico", hint: "Branco com sombra" },
  { value: "caixa", label: "Caixa", hint: "Texto sobre fundo escuro" },
  { value: "minimalista", label: "Minimalista", hint: "Discreto, sem contorno" },
];

export const SUBTITLE_POSITION_OPTIONS: Option<SubtitlePosition>[] = [
  { value: "inferior", label: "Inferior" },
  { value: "centro", label: "Centro" },
  { value: "superior", label: "Superior" },
];

export const FRAMING_OPTIONS: Option<FramingMode>[] = [
  { value: "centro", label: "Central", hint: "Recorte fixo no centro do quadro" },
  { value: "rosto", label: "Acompanhar rosto", hint: "Usa detecção facial quando houver rostos" },
];

export const LANGUAGE_OPTIONS: Option<string>[] = [
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "pt", label: "Português (Portugal)" },
  { value: "en", label: "Inglês" },
  { value: "es", label: "Espanhol" },
  { value: "fr", label: "Francês" },
  { value: "it", label: "Italiano" },
  { value: "de", label: "Alemão" },
];
