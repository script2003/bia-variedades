import { describe, expect, it } from "vitest";
import { sampleSubtitles } from "../test/fixtures";
import { balanceLines, draftSubtitles } from "./subtitles";

const word = (text: string) => ({ start: 0, end: 1, text });

describe("rascunho das legendas na prévia", () => {
  it("equilibra as linhas", () => {
    expect(balanceLines([word("curta")])).toHaveLength(1);
    const lines = balanceLines("uma frase bem mais comprida que cabe em duas linhas".split(" ").map(word));
    expect(lines).toHaveLength(2);
    const lengths = lines.map((l) => l.map((w) => w.text).join(" ").length);
    expect(Math.abs(lengths[0]! - lengths[1]!)).toBeLessThan(10);
  });

  it("aplica o texto editado, a caixa-alta do modelo e oculta blocos", () => {
    const draft = draftSubtitles(
      sampleSubtitles,
      [
        { start: 21.9, end: 23.9, text: "olá mundo", hidden: false, edited: true },
        { start: 24, end: 25, text: "escondida", hidden: true, edited: true },
        { start: 25, end: 26, text: "   ", hidden: false, edited: true },
      ],
      21.9,
    );
    expect(draft.cues).toHaveLength(1);
    const [cue] = draft.cues;
    expect(cue!.start).toBeCloseTo(0);
    expect(cue!.end).toBeCloseTo(2);
    expect(cue!.lines.flat().map((w) => w.text)).toEqual(["OLÁ", "MUNDO"]);
    // tempo distribuído pelo tamanho das palavras (4 e 6 caracteres incluindo o espaço)
    expect(cue!.lines.flat()[1]!.start).toBeCloseTo(0.8);
    expect(draft.template).toBe(sampleSubtitles.template);
  });
});
