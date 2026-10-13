import type { ClipSubtitles, EditableCue, SubtitleCue, SubtitleWord } from "../api/types";

/** Índice do bloco de legenda visível no instante `t` (segundos desde o início do corte). */
export function activeCueIndex(cues: SubtitleCue[], t: number): number {
  return cues.findIndex((cue) => t >= cue.start && t < cue.end);
}

/** Índice (na ordem do bloco) da palavra sendo falada; antes da 1ª palavra, destaca a 1ª. */
export function activeWordIndex(cue: SubtitleCue, t: number): number {
  const words = cue.lines.flat();
  let index = 0;
  words.forEach((word, k) => {
    if (t >= word.start) index = k;
  });
  return index;
}

/** Divide as palavras em até duas linhas de tamanho parecido. */
export function balanceLines(words: SubtitleWord[]): SubtitleWord[][] {
  if (words.length < 2) return [words];
  const length = (list: SubtitleWord[]) => list.reduce((sum, w) => sum + w.text.length, 0) + Math.max(0, list.length - 1);
  const total = length(words);
  if (total <= 22) return [words];
  let best = 1;
  let bestDiff = Infinity;
  for (let cut = 1; cut < words.length; cut++) {
    const diff = Math.abs(length(words.slice(0, cut)) - length(words.slice(cut)));
    if (diff < bestDiff) {
      best = cut;
      bestDiff = diff;
    }
  }
  return [words.slice(0, best), words.slice(best)];
}

/**
 * Legendas aproximadas a partir do rascunho do editor, para a prévia reagir enquanto o usuário digita.
 * Os tempos das palavras são distribuídos pelo tamanho; ao salvar, o servidor calcula a versão exata.
 */
export function draftSubtitles(saved: ClipSubtitles, draft: EditableCue[], clipStart: number): ClipSubtitles {
  const uppercase = saved.template.uppercase;
  const cues: SubtitleCue[] = [];
  for (const cue of draft) {
    const tokens = cue.text.split(/\s+/).filter(Boolean);
    if (cue.hidden || tokens.length === 0) continue;
    const start = cue.start - clipStart;
    const end = cue.end - clipStart;
    if (end - start <= 0) continue;
    const weights = tokens.map((t) => t.length + 1);
    const total = weights.reduce((a, b) => a + b, 0);
    let acc = 0;
    const words = tokens.map((token, k) => {
      const word = {
        start: start + ((end - start) * acc) / total,
        end: start + ((end - start) * (acc + weights[k]!)) / total,
        text: uppercase ? token.toLocaleUpperCase("pt-BR") : token,
      };
      acc += weights[k]!;
      return word;
    });
    cues.push({ start, end, lines: balanceLines(words) });
  }
  return { ...saved, cues };
}
