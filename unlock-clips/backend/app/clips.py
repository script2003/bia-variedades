"""Identificação de bons cortes a partir da transcrição.

Como funciona (tudo local e explicável):

1. **Frases**: as palavras da transcrição (com tempos) são agrupadas em frases pela
   pontuação e pelas pausas.
2. **Assuntos**: mudanças de assunto são detectadas pela queda de semelhança de
   vocabulário entre janelas de frases (método inspirado no TextTiling) e por
   expressões como "mudando de assunto".
3. **Candidatos**: todo trecho que começa e termina em limites de frase e cabe na
   faixa de duração escolhida é avaliado.
4. **Pontuação**: cada critério gera um valor de 0 a 1 e uma explicação; a nota final
   (0–100) é a média ponderada pelos pesos configurados. É uma **heurística** que
   descreve características do trecho — não é uma previsão de visualizações.
5. **Seleção**: os melhores candidatos sem sobreposição relevante, até o limite
   configurado. Cortes aprovados ou criados manualmente são preservados.
"""

from __future__ import annotations

import math
import re
import unicodedata
from bisect import bisect_left, bisect_right
from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .clip_lexicon import Lexicon, has_lexicon, lexicon_for
from .schemas import (
    SCORING_CRITERIA_DEFAULTS,
    Clip,
    ClipSet,
    ScoreComponent,
    ScoringCriterion,
    Transcript,
    utcnow,
)

DURATION_RANGES: dict[str, tuple[float, float]] = {"15-30": (15.0, 30.0), "30-60": (30.0, 60.0), "60-90": (60.0, 90.0)}

CRITERIA: dict[str, tuple[str, str]] = {
    "hook": ("Gancho inicial", "Os primeiros segundos prendem a atenção: pergunta, afirmação forte, número ou fala direta com o público."),
    "impact": ("Frases de impacto", "Expressões fortes, superlativos e números ao longo do trecho."),
    "opinion": ("Opinião e debate", "Opiniões explícitas, concordâncias, discordâncias e contraste de ideias."),
    "qa": ("Pergunta e resposta", "Começa com uma pergunta e traz a resposta dentro do próprio corte."),
    "story": ("História completa", "Marcas de início, desenvolvimento e conclusão de uma história."),
    "clarity": ("Clareza da fala", "Confiança da transcrição, ritmo de fala, poucos vícios de linguagem e poucas pausas longas."),
    "context": ("Contexto completo", "Começa e termina em frases completas, sem depender do que veio antes e sem atravessar mudanças de assunto."),
    "emphasis": ("Ênfase na voz", "Volume da fala acima da média do vídeo, um indício de entusiasmo."),
    "duration": ("Duração", "Proximidade do meio da faixa de duração escolhida."),
}

MAX_OVERLAP = 0.2  # fração máxima de sobreposição entre cortes selecionados
# Sugestões precisam de pelo menos esta pontuação absoluta e esta fração da melhor do vídeo.
MIN_SCORE = 25.0
MIN_RELATIVE_SCORE = 0.45
MAX_CANDIDATES = 150_000
SENTENCE_GAP = 1.0  # pausa (s) que encerra uma frase mesmo sem pontuação
SENTENCE_MAX = 30.0
CONTEXT_PAUSE = 0.35
LONG_PAUSE = 1.5

_TERMINAL = re.compile(r"[.!?…]+[\"')\]»”]*$")
_NON_WORD = re.compile(r"[^\w?!]+", re.UNICODE)
_DIGIT = re.compile(r"\d")


def criteria() -> list[ScoringCriterion]:
    return [
        ScoringCriterion(key=key, label=label, description=description, default_weight=SCORING_CRITERIA_DEFAULTS[key])
        for key, (label, description) in CRITERIA.items()
    ]


def normalize(text: str) -> str:
    """Minúsculas, sem acentos e sem pontuação (exceto ? e !), com espaços nas pontas."""
    decomposed = unicodedata.normalize("NFD", text.lower())
    stripped = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    collapsed = _NON_WORD.sub(" ", stripped).replace("?", " ? ").replace("!", " ! ")
    return f" {' '.join(collapsed.split())} "


def find_phrases(norm: str, phrases: Sequence[str]) -> list[str]:
    """Retorna as expressões encontradas (com repetições), respeitando limites de palavra.

    As expressões mais longas têm prioridade e o trecho encontrado é "consumido", para que
    "o maior erro" não seja contado também como "maior erro" e "erro".
    """
    found: list[str] = []
    work = norm
    keyed = {normalize(p): p.strip() for p in phrases}
    for key in sorted(keyed, key=len, reverse=True):
        count = work.count(key)
        if count:
            found.extend([keyed[key]] * count)
            work = work.replace(key, " | ")
    return found


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


def _quote(text: str, limit: int = 70) -> str:
    text = " ".join(text.split())
    if len(text) > limit:
        text = text[: limit - 1].rsplit(" ", 1)[0] + "…"
    return f"“{text}”"


def _fmt(number: float, digits: int = 1) -> str:
    return f"{number:.{digits}f}".replace(".", ",")


# ---------------------------------------------------------------------- frases


@dataclass
class Word:
    start: float
    end: float
    text: str
    probability: float | None
    segment_end: bool = False  # última palavra de um segmento do Whisper


@dataclass
class Sentence:
    index: int
    start: float
    end: float
    text: str
    words: list[Word]
    norm: str
    is_question: bool
    terminal: bool
    first_word: str
    pause_before: float = 0.0
    pause_after: float = 0.0
    topic: int = 0
    topic_start: bool = False
    tokens: list[str] = field(default_factory=list)


def _transcript_words(transcript: Transcript) -> list[Word]:
    words: list[Word] = []
    for segment in transcript.segments:
        if segment.words:
            current = [Word(w.start, w.end, w.text, w.probability) for w in segment.words]
        else:
            # Sem tempos por palavra: distribui o trecho igualmente entre as palavras.
            parts = segment.text.split()
            step = max(segment.end - segment.start, 0.01) / max(len(parts), 1)
            current = [
                Word(segment.start + k * step, segment.start + (k + 1) * step, " " + part, None)
                for k, part in enumerate(parts)
            ]
        if current:
            current[-1].segment_end = True
            words.extend(current)
    words.sort(key=lambda w: w.start)
    return words


def build_sentences(transcript: Transcript, lexicon: Lexicon) -> list[Sentence]:
    words = _transcript_words(transcript)
    has_punctuation = any(_TERMINAL.search(w.text.strip()) for w in words)
    groups: list[list[Word]] = []
    current: list[Word] = []
    for index, word in enumerate(words):
        current.append(word)
        token = word.text.strip()
        next_start = words[index + 1].start if index + 1 < len(words) else None
        gap = (next_start - word.end) if next_start is not None else math.inf
        length = word.end - current[0].start
        next_token = words[index + 1].text.strip() if index + 1 < len(words) else ""
        # Fim de segmento do Whisper com pausa, ou maiúscula após uma pausa curta em texto sem
        # pontuação, também encerram a frase (evita "grudar" falas diferentes).
        segment_break = word.segment_end and (gap >= 0.25 or length >= 8)
        capital_break = not has_punctuation and gap >= 0.2 and next_token[:1].isupper() and length >= 3
        if (
            _TERMINAL.search(token)
            or gap >= SENTENCE_GAP
            or length >= SENTENCE_MAX
            or segment_break
            or capital_break
            or (length >= 20 and token.endswith((",", ";", ":")))
        ):
            groups.append(current)
            current = []
    if current:
        groups.append(current)

    sentences: list[Sentence] = []
    for group in groups:
        text = "".join(w.text for w in group).strip()
        if not text:
            continue
        norm = normalize(text)
        tokens_all = norm.split()
        first = next((t for t in tokens_all if t not in ("?", "!")), "")
        terminal = bool(_TERMINAL.search(text))
        question = text.rstrip("\"')]»” ").endswith("?") or (
            not has_punctuation and any(norm.startswith(normalize(q)) for q in lexicon.question_starts)
        )
        sentences.append(
            Sentence(
                index=len(sentences),
                start=group[0].start,
                end=max(group[-1].end, group[0].start + 0.01),
                text=text,
                words=group,
                norm=norm,
                is_question=question,
                terminal=terminal,
                first_word=first,
                tokens=[t[:6] for t in tokens_all if len(t) >= 3 and t not in lexicon.stopwords and t.isalpha()],
            )
        )
    for k, sentence in enumerate(sentences):
        sentence.pause_before = sentence.start - (sentences[k - 1].end if k else 0.0)
        sentence.pause_after = (sentences[k + 1].start - sentence.end) if k + 1 < len(sentences) else 10.0
    return sentences


# ---------------------------------------------------------------------- assuntos


def _cosine(a: Counter, b: Counter) -> float:
    if not a or not b:
        return 0.0
    dot = sum(a[k] * b[k] for k in a.keys() & b.keys())
    norm = math.sqrt(sum(v * v for v in a.values())) * math.sqrt(sum(v * v for v in b.values()))
    return dot / norm if norm else 0.0


def assign_topics(sentences: list[Sentence], lexicon: Lexicon, window: int = 4, min_spacing: float = 30.0) -> list[int]:
    """Marca o início de cada assunto. Retorna os índices das frases que iniciam um novo assunto."""
    n = len(sentences)
    forced = [k for k in range(1, n) if find_phrases(sentences[k].norm, lexicon.topic_shift)]
    scored: list[tuple[float, int]] = []
    if n >= 2 * window + 1:
        sims = [0.0] * n
        for gap in range(window, n - window + 1):
            left = Counter(t for s in sentences[gap - window : gap] for t in s.tokens)
            right = Counter(t for s in sentences[gap : gap + window] for t in s.tokens)
            sims[gap] = _cosine(left, right)
        depths: list[tuple[float, int]] = []
        for gap in range(window, n - window + 1):
            lo, hi = max(window, gap - window), min(n - window, gap + window)
            depth = (max(sims[lo : gap + 1]) - sims[gap]) + (max(sims[gap : hi + 1]) - sims[gap])
            depths.append((depth, gap))
        values = [d for d, _ in depths]
        threshold = float(np.mean(values) + 0.5 * np.std(values)) if values else math.inf
        scored = sorted(((d, g) for d, g in depths if d > threshold and d > 0.1), reverse=True)

    # Mudanças anunciadas ("mudando de assunto") sempre contam; as detectadas pelo vocabulário
    # precisam ficar a pelo menos `min_spacing` segundos das demais.
    chosen: list[int] = sorted(set(forced))
    for _, gap in scored:
        if gap not in chosen and all(abs(sentences[gap].start - sentences[c].start) >= min_spacing for c in chosen):
            chosen.append(gap)
    chosen.sort()
    topic = 0
    boundaries = set(chosen)
    for k, sentence in enumerate(sentences):
        if k in boundaries:
            topic += 1
        sentence.topic = topic
        sentence.topic_start = k == 0 or k in boundaries
    return chosen


# ---------------------------------------------------------------------- energia do áudio


@dataclass
class EnergyProfile:
    """Volume (dB) por segundo do áudio extraído e a referência (mediana da fala)."""

    db: np.ndarray
    reference_db: float

    def mean_db(self, start: float, end: float) -> float | None:
        a, b = int(start), max(int(start) + 1, int(math.ceil(end)))
        values = self.db[a:b]
        values = values[~np.isnan(values)]
        return float(values.mean()) if len(values) else None


def energy_profile(wav_path: Path, sentences: list[Sentence], block_seconds: int = 60) -> EnergyProfile | None:
    from .transcription import SAMPLE_RATE, TranscriptionError, WavReader

    try:
        reader = WavReader(wav_path)
    except TranscriptionError:
        return None
    with reader:
        values: list[np.ndarray] = []
        block = block_seconds * SAMPLE_RATE
        for start in range(0, reader.frames, block):
            samples = reader.read(start, start + block)
            seconds = len(samples) // SAMPLE_RATE
            if seconds:
                chunk = samples[: seconds * SAMPLE_RATE].reshape(seconds, SAMPLE_RATE)
                rms = np.sqrt(np.square(chunk).mean(axis=1))
                values.append(20 * np.log10(rms + 1e-6))
    if not values:
        return None
    db = np.concatenate(values)
    speech = [db[int(s.start) : max(int(s.start) + 1, int(math.ceil(s.end)))] for s in sentences]
    speech_db = np.concatenate([v for v in speech if len(v)]) if any(len(v) for v in speech) else db
    return EnergyProfile(db=db, reference_db=float(np.median(speech_db)))


def partial_energy(wav_path: Path, start: float, end: float, reference_db: float) -> EnergyProfile | None:
    """Mede apenas o intervalo pedido (usado ao recalcular um corte editado)."""
    from .transcription import SAMPLE_RATE, TranscriptionError, WavReader

    try:
        reader = WavReader(wav_path)
    except TranscriptionError:
        return None
    with reader:
        first, last = int(start), int(math.ceil(end))
        samples = reader.read(first * SAMPLE_RATE, last * SAMPLE_RATE)
    seconds = len(samples) // SAMPLE_RATE
    if not seconds:
        return None
    rms = np.sqrt(np.square(samples[: seconds * SAMPLE_RATE].reshape(seconds, SAMPLE_RATE)).mean(axis=1))
    db = np.full(first + seconds, np.nan)
    db[first:] = 20 * np.log10(rms + 1e-6)
    return EnergyProfile(db=db, reference_db=reference_db)


# ---------------------------------------------------------------------- análise


@dataclass
class _Evaluation:
    score: float
    components: list[ScoreComponent]
    highlights: list[str]
    warnings: list[str]


class ClipAnalyzer:
    def __init__(
        self,
        transcript: Transcript,
        weights: dict[str, float],
        duration_preset: str,
        energy: EnergyProfile | None = None,
    ) -> None:
        self.lexicon = lexicon_for(transcript.language)
        self.weights = {**SCORING_CRITERIA_DEFAULTS, **weights}
        self.min_duration, self.max_duration = DURATION_RANGES[duration_preset]
        self.energy = energy
        self.sentences = build_sentences(transcript, self.lexicon)
        self.topic_starts = assign_topics(self.sentences, self.lexicon)
        self._starts = [s.start for s in self.sentences]
        self._ends = [s.end for s in self.sentences]
        self._sentence_cache: dict[int, dict[str, list[str]]] = {}

    # ------------------------------------------------------------- utilidades

    def _phrases(self, index: int) -> dict[str, list[str]]:
        cached = self._sentence_cache.get(index)
        if cached is None:
            norm = self.sentences[index].norm
            lex = self.lexicon
            cached = {
                "impact": find_phrases(norm, lex.impact),
                "opinion": find_phrases(norm, lex.opinion),
                "contrast": find_phrases(norm, lex.contrast),
                "story_start": find_phrases(norm, lex.story_start),
                "story_middle": find_phrases(norm, lex.story_middle),
                "story_end": find_phrases(norm, lex.story_end),
                "address": find_phrases(norm, lex.direct_address),
                "fillers": [t for t in norm.split() if t in lex.fillers],
            }
            self._sentence_cache[index] = cached
        return cached

    def _collect(self, i: int, j: int, key: str) -> list[str]:
        return [phrase for k in range(i, j + 1) for phrase in self._phrases(k)[key]]

    def sentence_range(self, start: float, end: float) -> tuple[int, int] | None:
        """Frases que se sobrepõem ao intervalo [start, end]."""
        i = bisect_right(self._ends, start)
        j = bisect_left(self._starts, end) - 1
        if i >= len(self.sentences) or j < i:
            return None
        return i, j

    # ------------------------------------------------------------- critérios

    def _evaluate(self, i: int, j: int, start: float | None = None, end: float | None = None) -> _Evaluation:
        S = self.sentences
        first, last = S[i], S[j]
        start = first.start if start is None else start
        end = last.end if end is None else end
        duration = max(end - start, 0.01)
        values: dict[str, tuple[float | None, list[str], list[str]]] = {}

        # Gancho: primeiras frases (até ~6 s, no máximo 3).
        hook_end = i
        while hook_end < j and hook_end - i < 2 and S[hook_end].end - start < 6:
            hook_end += 1
        hook_text = " ".join(S[k].text for k in range(i, hook_end + 1))
        hook_value, hook_details = 0.0, []
        hook_question = next((S[k] for k in range(i, hook_end + 1) if S[k].is_question), None)
        if hook_question:
            hook_value += 0.45
            hook_details.append(f"Abre com uma pergunta: {_quote(hook_question.text)}")
        hook_impact = self._collect(i, hook_end, "impact")
        if hook_impact:
            hook_value += min(0.45, 0.25 * len(hook_impact))
            hook_details.append(f"Frase forte logo no início: {', '.join(_quote(p, 30) for p in dict.fromkeys(hook_impact))}")
        hook_story = self._collect(i, hook_end, "story_start")
        if hook_story:
            hook_value += 0.3
            hook_details.append(f"Abre contando uma história: {_quote(hook_story[0], 30)}")
        if self._collect(i, hook_end, "address"):
            hook_value += 0.15
            hook_details.append("Fala diretamente com o público")
        if _DIGIT.search(hook_text):
            hook_value += 0.15
            hook_details.append("Usa números logo no início")
        values["hook"] = (_clamp(hook_value), hook_details, [])

        # Frases de impacto ao longo do trecho.
        impact = self._collect(i, j, "impact")
        exclamations = sum(S[k].text.count("!") for k in range(i, j + 1))
        per_minute = (len(impact) + 0.5 * exclamations) / (duration / 60)
        impact_details = [f"Expressões de impacto: {', '.join(_quote(p, 30) for p in list(dict.fromkeys(impact))[:4])}"] if impact else []
        values["impact"] = (_clamp(per_minute / 4), impact_details, [])

        # Opinião e debate.
        opinions, contrasts = self._collect(i, j, "opinion"), self._collect(i, j, "contrast")
        opinion_details = []
        if opinions:
            opinion_details.append(f"Opinião explícita: {', '.join(_quote(p, 30) for p in list(dict.fromkeys(opinions))[:3])}")
        if contrasts:
            opinion_details.append(f"Contraste de ideias ({len(contrasts)}× “{contrasts[0]}” e similares)")
        values["opinion"] = (_clamp(0.35 * len(opinions) + 0.12 * min(len(contrasts), 3)), opinion_details, [])

        # Pergunta e resposta.
        qa_value, qa_details, qa_warnings = 0.0, [], []
        question_index = next((k for k in range(i, min(i + 2, j + 1)) if S[k].is_question), None)
        if question_index is None:
            middle = start + duration / 2
            question_index = next((k for k in range(i, j + 1) if S[k].is_question and S[k].end <= middle), None)
            weight = 0.6
        else:
            weight = 1.0
        if question_index is not None and question_index < j:
            answer = end - S[question_index].end
            answered = any(not S[k].is_question for k in range(question_index + 1, j + 1))
            if answered and answer >= 6:
                qa_value = weight
                qa_details.append(f"Pergunta {_quote(S[question_index].text, 50)} respondida em {_fmt(answer, 0)} s")
        if last.is_question:
            qa_warnings.append("Termina com uma pergunta sem resposta")
        values["qa"] = (qa_value, qa_details, qa_warnings)

        # História: início, desenvolvimento e conclusão.
        third = start + duration * 0.35
        last_part = end - duration * 0.4
        story_start = [p for k in range(i, j + 1) if S[k].start <= third for p in self._phrases(k)["story_start"]]
        story_end = [p for k in range(i, j + 1) if S[k].end >= last_part for p in self._phrases(k)["story_end"]]
        story_middle = self._collect(i, j, "story_middle")
        story_value, story_details = 0.0, []
        if story_start:
            story_value += 0.4
            story_details.append(f"Começo de história: {_quote(story_start[0], 30)}")
        if story_middle:
            story_value += 0.2
            story_details.append(f"Desenvolvimento: {', '.join(_quote(p, 20) for p in list(dict.fromkeys(story_middle))[:3])}")
        if story_end:
            story_value += 0.4
            story_details.append(f"Conclusão: {_quote(story_end[-1], 30)}")
        values["story"] = (_clamp(story_value), story_details, [])

        # Clareza da fala.
        words = [w for k in range(i, j + 1) for w in S[k].words if start - 0.05 <= w.start and w.end <= end + 0.05]
        word_count = max(len(words), 1)
        probabilities = [w.probability for w in words if w.probability is not None]
        clarity_details, clarity_warnings = [], []
        if probabilities:
            mean_p = sum(probabilities) / len(probabilities)
            c1 = _clamp((mean_p - 0.55) / 0.35)
            (clarity_details if c1 >= 0.6 else clarity_warnings).append(
                f"Confiança média da transcrição: {_fmt(mean_p * 100, 0)}%"
            )
        else:
            c1 = 0.7
        wps = word_count / duration
        c2 = 1.0 if 1.8 <= wps <= 4.2 else (wps / 1.8 if wps < 1.8 else _clamp(1 - (wps - 4.2) / 2))
        if c2 >= 1:
            clarity_details.append(f"Ritmo de fala natural ({_fmt(wps)} palavras/s)")
        else:
            clarity_warnings.append(f"Ritmo de fala {'lento' if wps < 1.8 else 'muito rápido'} ({_fmt(wps)} palavras/s)")
        fillers = len(self._collect(i, j, "fillers"))
        filler_ratio = fillers / word_count
        c3 = _clamp(1 - filler_ratio * 8)
        if filler_ratio >= 0.06:
            clarity_warnings.append(f"Muitos vícios de linguagem ({_fmt(filler_ratio * 100, 0)}% das palavras)")
        long_pauses = sum(1 for k in range(i, j) if S[k].pause_after >= LONG_PAUSE)
        c4 = _clamp(1 - 0.25 * long_pauses)
        if long_pauses:
            clarity_warnings.append(f"{long_pauses} pausa(s) longa(s) no meio do trecho")
        values["clarity"] = (0.4 * c1 + 0.25 * c2 + 0.2 * c3 + 0.15 * c4, clarity_details, clarity_warnings)

        # Contexto completo.
        context_value, context_details, context_warnings = 0.0, [], []
        mid_start = start > first.start + 0.3
        mid_end = end < last.end - 0.3
        if mid_start:
            context_warnings.append("Começa no meio de uma frase")
        elif i == 0 or first.pause_before >= CONTEXT_PAUSE:
            context_value += 0.25
        else:
            context_warnings.append("Começa logo depois de outra fala, sem pausa")
        if not mid_start:
            if first.first_word in self.lexicon.dependent_starts:
                context_warnings.append(f"Começa com “{first.first_word}”, pode depender do que foi dito antes")
            else:
                context_value += 0.25
        if mid_end:
            context_warnings.append("Termina no meio de uma frase")
        else:
            if last.terminal:
                context_value += 0.2
            if last.is_question:
                context_value -= 0.3  # termina em suspenso: falta a resposta
            else:
                context_value += 0.1
            if j == len(S) - 1 or last.pause_after >= CONTEXT_PAUSE:
                context_value += 0.2
            else:
                context_warnings.append("Corta enquanto a fala continua")
        crossings = sum(1 for b in self.topic_starts if i < b <= j)
        if crossings:
            # Atravessar uma mudança de assunto deixa o corte incoerente: penalidade forte.
            context_value *= 0.3 if crossings == 1 else 0.0
            context_warnings.append(f"Atravessa {crossings} mudança(s) de assunto")
        elif first.topic_start and i > 0:
            context_details.append("Começa junto com um novo assunto")
        if context_value >= 0.9:
            context_details.append("Começa e termina em frases completas")
        values["context"] = (_clamp(context_value), context_details, context_warnings)

        # Ênfase na voz (volume relativo).
        if self.energy is not None and (clip_db := self.energy.mean_db(start, end)) is not None:
            delta = clip_db - self.energy.reference_db
            emphasis_details = [f"Volume {_fmt(abs(delta))} dB {'acima' if delta >= 0 else 'abaixo'} da média da fala"]
            values["emphasis"] = (_clamp((delta + 2) / 6), emphasis_details if delta >= 1 else [], [])
        else:
            values["emphasis"] = (None, [], [])

        # Duração.
        center = (self.min_duration + self.max_duration) / 2
        half = (self.max_duration - self.min_duration) / 2
        duration_warnings = []
        if duration < self.min_duration - 0.5 or duration > self.max_duration + 0.5:
            duration_value = 0.0
            duration_warnings.append(
                f"Fora da faixa configurada ({_fmt(self.min_duration, 0)}–{_fmt(self.max_duration, 0)} s): {_fmt(duration)} s"
            )
        else:
            duration_value = _clamp(1 - 0.6 * abs(duration - center) / half)
        values["duration"] = (duration_value, [], duration_warnings)

        return self._combine(values)

    def _combine(self, values: dict[str, tuple[float | None, list[str], list[str]]]) -> _Evaluation:
        active = {k: v for k, v in values.items() if v[0] is not None and self.weights.get(k, 0) > 0}
        total_weight = sum(self.weights[k] for k in active) or 1.0
        components: list[ScoreComponent] = []
        warnings: list[str] = []
        score = 0.0
        for key, (value, details, warns) in values.items():
            label = CRITERIA[key][0]
            weight = float(self.weights.get(key, 0))
            if value is None:
                components.append(
                    ScoreComponent(key=key, label=label, weight=weight, value=0, points=0, details=["Sem áudio para medir"])
                )
                continue
            points = weight * value / total_weight * 100 if key in active else 0.0
            score += points
            components.append(
                ScoreComponent(key=key, label=label, weight=weight, value=round(value, 3), points=round(points, 1), details=details)
            )
            warnings.extend(warns)
        ranked = sorted((c for c in components if c.points > 0 and c.details), key=lambda c: c.points, reverse=True)
        highlights = [detail for c in ranked for detail in c.details][:5]
        return _Evaluation(round(score, 1), components, highlights, warnings)

    # ------------------------------------------------------------- textos

    def text_between(self, start: float, end: float) -> str:
        words = [
            w.text
            for s in self.sentences
            if s.end > start and s.start < end
            for w in s.words
            if w.end > start + 0.05 and w.start < end - 0.05
        ]
        return "".join(words).strip()

    def make_title(self, i: int, j: int) -> str:
        S = self.sentences
        # Uma pergunta que fecha o corte (sem resposta) nunca vira título.
        candidates = [k for k in range(i, min(i + 3, j + 1)) if not (S[k].is_question and k == j)] or [i]
        # A pergunta só vira título se for respondida dentro do próprio corte.
        question = next((k for k in candidates if k < i + 2 and k < j and S[k].is_question), None)
        if question is not None:
            chosen = S[question].text
        else:
            best = max(candidates, key=lambda k: (len(self._phrases(k)["impact"]), -k))
            chosen = S[best].text
        words = [w for w in chosen.split() if normalize(w).strip() not in self.lexicon.fillers]
        title = " ".join(words).strip(" ,;:-").rstrip(".")
        if len(title) > 80:
            title = title[:79].rsplit(" ", 1)[0].rstrip(",;:") + "…"
        return (title[:1].upper() + title[1:]) if title else "Corte sem título"

    # ------------------------------------------------------------- geração

    def candidates(self, progress: Callable[[float], None] | None = None) -> list[tuple[float, int, int]]:
        S = self.sentences
        n = len(S)
        pairs: list[tuple[int, int]] = []
        for i in range(n):
            for j in range(i, n):
                length = S[j].end - S[i].start
                if length > self.max_duration:
                    break
                if length >= self.min_duration:
                    pairs.append((i, j))
        if len(pairs) > MAX_CANDIDATES:
            # Vídeos muito longos: prioriza inícios que já têm contexto (após pausa ou novo assunto).
            pairs = [(i, j) for i, j in pairs if S[i].topic_start or S[i].pause_before >= CONTEXT_PAUSE]
        results: list[tuple[float, int, int]] = []
        total = len(pairs)
        for index, (i, j) in enumerate(pairs):
            results.append((self._evaluate(i, j).score, i, j))
            if progress and index % 500 == 0:
                progress(index / total)
        return results

    def build_clip(self, i: int, j: int, *, start: float | None = None, end: float | None = None, **fields) -> Clip:
        evaluation = self._evaluate(i, j, start, end)
        start = self.sentences[i].start if start is None else start
        end = self.sentences[j].end if end is None else end
        return Clip(
            title=fields.pop("title", None) or self.make_title(i, j),
            start=round(start, 3),
            end=round(end, 3),
            score=evaluation.score,
            components=evaluation.components,
            highlights=evaluation.highlights,
            warnings=evaluation.warnings,
            text=self.text_between(start, end),
            **fields,
        )

    def snap(self, start: float, end: float) -> tuple[float, float]:
        """Ajusta os limites para não cortar palavras: o início recua até o começo da palavra
        em que cai e o fim avança até o término da palavra (no máximo 0,6 s)."""
        words = [w for s in self.sentences for w in s.words]
        if not words:
            return start, end
        starts = [w.start for w in words]
        k = bisect_right(starts, start) - 1
        new_start = words[k].start if k >= 0 and start - words[k].start <= 0.6 and start < words[k].end + 0.05 else start
        ends = [w.end for w in words]
        m = bisect_left(ends, end)
        new_end = words[m].end if m < len(words) and words[m].end - end <= 0.6 and words[m].start < end else end
        return (new_start, new_end) if new_end > new_start else (start, end)

    def evaluate_range(self, start: float, end: float, **fields) -> Clip:
        """Pontua um intervalo arbitrário (cortes manuais ou ajustados pelo usuário)."""
        start, end = self.snap(start, end)
        found = self.sentence_range(start, end)
        if found is None:
            return Clip(
                title=fields.pop("title", None) or "Corte sem fala",
                start=round(start, 3),
                end=round(end, 3),
                score=0.0,
                warnings=["Não há fala transcrita neste intervalo"],
                **fields,
            )
        i, j = found
        return self.build_clip(i, j, start=start, end=end, **fields)


def _overlap(a: tuple[float, float], b: tuple[float, float]) -> float:
    inter = min(a[1], b[1]) - max(a[0], b[0])
    if inter <= 0:
        return 0.0
    return inter / max(min(a[1] - a[0], b[1] - b[0]), 1e-6)


def detect_clips(
    transcript: Transcript,
    *,
    duration_preset: str,
    max_clips: int,
    weights: dict[str, float],
    energy_source: Path | None = None,
    keep: Sequence[Clip] = (),
    progress: Callable[[float, str], None] | None = None,
) -> ClipSet:
    """Gera a lista de cortes sugeridos (mais os cortes preservados em ``keep``)."""
    report = progress or (lambda fraction, message: None)
    report(0.02, "Organizando frases e assuntos")
    analyzer = ClipAnalyzer(transcript, weights, duration_preset)
    if energy_source is not None:
        report(0.08, "Medindo a ênfase da voz")
        analyzer.energy = energy_profile(energy_source, analyzer.sentences)

    notes: list[str] = []
    kept: list[Clip] = []
    for clip in keep:
        rescored = analyzer.evaluate_range(
            clip.start, clip.end, title=clip.title, status=clip.status, origin=clip.origin, edited=clip.edited
        )
        rescored.id = clip.id
        rescored.created_at = clip.created_at
        rescored.render = clip.render
        kept.append(rescored)

    sentences = analyzer.sentences
    speech = (sentences[-1].end - sentences[0].start) if sentences else 0.0
    candidates: list[tuple[float, int, int]] = []
    if not sentences:
        notes.append("Não há falas na transcrição para sugerir cortes.")
    elif speech < analyzer.min_duration:
        notes.append(
            f"O trecho com fala ({_fmt(speech, 0)} s) é mais curto que a duração mínima escolhida "
            f"({_fmt(analyzer.min_duration, 0)} s). Escolha uma faixa menor nas configurações dos cortes."
        )
    else:
        candidates = analyzer.candidates(lambda f: report(0.1 + 0.8 * f, "Avaliando trechos candidatos"))

    report(0.92, "Selecionando os melhores trechos")
    selected: list[Clip] = []
    taken = [(c.start, c.end) for c in kept]
    taken_ranges = [r for c in kept if (r := analyzer.sentence_range(c.start, c.end)) is not None]
    # Cortes descartados continuam bloqueando o trecho (para não serem sugeridos de novo),
    # mas não ocupam vagas.
    slots = max(0, max_clips - sum(1 for c in kept if c.status != "rejected"))
    best = max((c[0] for c in candidates), default=0.0)
    threshold = max(MIN_SCORE, best * MIN_RELATIVE_SCORE)
    skipped_low = 0
    for score, i, j in sorted(candidates, key=lambda c: (-c[0], c[1])):
        if len(selected) >= slots:
            break
        bounds = (sentences[i].start, sentences[j].end)
        if any(_overlap(bounds, other) > MAX_OVERLAP for other in taken):
            continue
        # Dois cortes não podem começar pela mesma frase (evita sugestões repetidas).
        if any(a <= i <= b or i <= a <= j for a, b in taken_ranges):
            continue
        if score < threshold:
            skipped_low += 1
            continue
        taken.append(bounds)
        taken_ranges.append((i, j))
        selected.append(analyzer.build_clip(i, j))
    if skipped_low:
        notes.append(
            f"{skipped_low} trecho(s) com pontuação baixa (abaixo de {_fmt(threshold, 0)} pontos) não foram sugeridos. "
            "Você pode criar cortes manualmente em qualquer ponto do vídeo."
        )
    if candidates and len(selected) < slots and not skipped_low:
        notes.append(
            f"Foram encontrados {len(selected)} trechos sem sobreposição dentro da duração escolhida "
            f"(limite: {max_clips})."
        )
    if not has_lexicon(transcript.language):
        notes.append("Idioma sem lista de expressões própria: as expressões em português foram usadas.")

    clips = sorted(kept + selected, key=lambda c: -c.score)
    return ClipSet(
        generated_at=utcnow(),
        language=transcript.language,
        duration_preset=duration_preset,
        max_clips=max_clips,
        weights=analyzer.weights,
        candidates_evaluated=len(candidates),
        audio_reference_db=None if analyzer.energy is None else round(analyzer.energy.reference_db, 2),
        notes=notes,
        clips=clips,
    )
