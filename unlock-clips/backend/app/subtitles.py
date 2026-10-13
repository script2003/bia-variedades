"""Legendas dos cortes: divisão em blocos legíveis, modelos visuais e arquivo ASS.

* As legendas usam os tempos de cada palavra da transcrição, relativos ao início do corte.
* Cada bloco tem no máximo duas linhas, que cabem na largura útil do vídeo, e é
  encerrado no fim de frases, em pausas e após ~4 segundos.
* Duas linhas são equilibradas (comprimentos parecidos), como em legendas profissionais.
* O destaque da palavra atual é feito com um evento ASS por palavra: o texto do bloco
  inteiro fica na tela e só a palavra falada muda de cor (e cresce levemente).
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

from .schemas import SubtitlePosition, SubtitleStyle

MAX_LINES = 2
MAX_CUE_SECONDS = 4.0
PAUSE_BREAK = 0.5
MIN_CUE_SECONDS = 0.6
HOLD_SECONDS = 0.25
REFERENCE_SIZE = 1080  # o tamanho da fonte configurado vale para a menor dimensão de 1080 px

_SENTENCE_END = re.compile(r"[.!?…]+[\"')\]»”]*$")
_TRAILING_SOFT = re.compile(r"[.,;:]+$")


@dataclass(frozen=True)
class SubtitleTemplate:
    key: SubtitleStyle
    label: str
    description: str
    font: str
    bold: bool
    uppercase: bool
    primary: str  # cor do texto (#RRGGBB)
    highlight: str  # cor da palavra atual
    outline_color: str
    outline: float  # espessura do contorno (px na referência de 1080)
    shadow: float
    box: bool  # texto sobre uma caixa
    box_color: str = "#000000"
    box_opacity: float = 0.0
    size_factor: float = 1.0
    highlight_scale: int = 100  # % de aumento da palavra atual


TEMPLATES: dict[str, SubtitleTemplate] = {
    "destaque": SubtitleTemplate(
        key="destaque",
        label="Destaque",
        description="Letras grandes em caixa-alta, contorno grosso e palavra atual em verde-limão.",
        font="Arial",
        bold=True,
        uppercase=True,
        primary="#FFFFFF",
        highlight="#C4F34A",
        outline_color="#000000",
        outline=6,
        shadow=2,
        box=False,
        highlight_scale=108,
    ),
    "classico": SubtitleTemplate(
        key="classico",
        label="Clássico",
        description="Texto branco com contorno fino e sombra, palavra atual em amarelo.",
        font="Arial",
        bold=True,
        uppercase=False,
        primary="#FFFFFF",
        highlight="#FFD60A",
        outline_color="#000000",
        outline=3,
        shadow=2,
        box=False,
    ),
    "caixa": SubtitleTemplate(
        key="caixa",
        label="Caixa",
        description="Texto branco sobre uma faixa escura semitransparente.",
        font="Arial",
        bold=True,
        uppercase=False,
        primary="#FFFFFF",
        highlight="#FFD60A",
        outline_color="#000000",
        outline=10,
        shadow=0,
        box=True,
        box_color="#000000",
        box_opacity=0.6,
    ),
    "minimalista": SubtitleTemplate(
        key="minimalista",
        label="Minimalista",
        description="Texto mais discreto, sem contorno, apenas uma sombra suave.",
        font="Arial",
        bold=False,
        uppercase=False,
        primary="#FFFFFF",
        highlight="#C4F34A",
        outline_color="#000000",
        outline=0,
        shadow=2,
        box=False,
        size_factor=0.85,
    ),
}


# ---------------------------------------------------------------------- blocos


@dataclass
class CueWord:
    start: float
    end: float
    text: str


@dataclass
class Cue:
    start: float
    end: float
    lines: list[list[CueWord]] = field(default_factory=list)

    @property
    def words(self) -> list[CueWord]:
        return [w for line in self.lines for w in line]

    @property
    def text(self) -> str:
        return "\n".join(" ".join(w.text for w in line) for line in self.lines)


@dataclass(frozen=True)
class SubtitleLayout:
    width: int
    height: int
    font_size: int
    alignment: int  # numeração ASS: 2 = embaixo, 5 = meio, 8 = em cima
    margin_v: int
    margin_h: int
    max_chars: int


def layout_for(
    template: SubtitleTemplate, width: int, height: int, font_size: int, position: SubtitlePosition
) -> SubtitleLayout:
    scale = min(width, height) / REFERENCE_SIZE
    size = max(12, round(font_size * template.size_factor * scale))
    vertical = height > width
    margin_h = round(width * 0.07)
    if position == "inferior":
        # Em vídeos verticais, a parte de baixo é coberta pelos botões das redes sociais.
        alignment, margin_v = 2, round(height * (0.2 if vertical else 0.08))
    elif position == "superior":
        alignment, margin_v = 8, round(height * (0.12 if vertical else 0.08))
    else:
        alignment, margin_v = 5, 0
    char_width = size * (0.62 if template.uppercase else 0.54) * (1.06 if template.bold else 1.0)
    max_chars = max(8, int((width - 2 * margin_h) / char_width))
    return SubtitleLayout(width, height, size, alignment, margin_v, margin_h, max_chars)


def _display(text: str, uppercase: bool) -> str:
    text = text.strip()
    return text.upper() if uppercase else text


def _length(words: list[CueWord]) -> int:
    return sum(len(w.text) for w in words) + max(0, len(words) - 1)


def balance_lines(words: list[CueWord], max_chars: int) -> list[list[CueWord]]:
    """Distribui as palavras em até duas linhas com comprimentos parecidos."""
    if _length(words) <= max_chars or len(words) < 2:
        return [words]
    best_cut, best_key = 1, (10**9, 10**9)
    for cut in range(1, len(words)):
        first, second = _length(words[:cut]), _length(words[cut:])
        # Primeiro evita ultrapassar a largura; depois busca linhas de tamanho parecido.
        key = (max(0, first - max_chars) + max(0, second - max_chars), abs(first - second))
        if key < best_key:
            best_cut, best_key = cut, key
    return [words[:best_cut], words[best_cut:]]


def _split_evenly(words: list[CueWord], capacity: int, max_seconds: float) -> list[list[CueWord]]:
    """Divide uma frase em blocos de tamanho parecido (evita sobras como uma palavra sozinha)."""
    total = _length(words)
    duration = words[-1].end - words[0].start
    parts = max(1, math.ceil(total / capacity), math.ceil(duration / max_seconds))
    while parts <= len(words):
        target = total / parts
        chunks: list[list[CueWord]] = [[]]
        for word in words:
            current = chunks[-1]
            remaining_chunks = parts - len(chunks)
            if current and remaining_chunks > 0 and _length(current + [word]) > target * 1.15:
                chunks.append([word])
            else:
                current.append(word)
        fits = all(_length(c) <= capacity and c[-1].end - c[0].start <= max_seconds + 0.5 for c in chunks)
        if fits or parts == len(words):
            return chunks
        parts += 1
    return [[w] for w in words]


def build_cues(
    words: list[tuple[float, float, str]],
    clip_start: float,
    clip_end: float,
    max_chars: int,
    *,
    uppercase: bool = False,
    max_lines: int = MAX_LINES,
    max_seconds: float = MAX_CUE_SECONDS,
) -> list[Cue]:
    """Gera os blocos de legenda (tempos relativos ao início do corte)."""
    duration = clip_end - clip_start
    selected = [
        (max(0.0, s - clip_start), min(duration, e - clip_start), t.strip())
        for s, e, t in words
        if t.strip() and clip_start <= (s + e) / 2 <= clip_end
    ]
    capacity = max_chars * max_lines

    # 1) Frases: terminam na pontuação final, em pausas ou em vírgulas de frases longas.
    phrases: list[list[CueWord]] = []
    current: list[CueWord] = []
    for index, (start, end, raw) in enumerate(selected):
        word = CueWord(start, max(end, start + 0.05), _display(raw, uppercase))
        if current and word.start - current[-1].end >= PAUSE_BREAK:
            phrases.append(current)
            current = []
        current.append(word)
        ends_sentence = bool(_SENTENCE_END.search(raw))
        soft_break = raw.endswith((",", ";", ":")) and _length(current) >= max_chars
        if ends_sentence or soft_break or index == len(selected) - 1:
            phrases.append(current)
            current = []
    if current:
        phrases.append(current)

    # 2) Cada frase vira um ou mais blocos equilibrados.
    groups = [chunk for phrase in phrases for chunk in _split_evenly(phrase, capacity, max_seconds)]

    cues: list[Cue] = []
    for k, group in enumerate(groups):
        for w in group:
            # Pontuação leve no fim das linhas polui a legenda; "?" e "!" são mantidos.
            w.text = _TRAILING_SOFT.sub("", w.text) or w.text
        next_start = groups[k + 1][0].start if k + 1 < len(groups) else duration
        end = min(max(group[-1].end + HOLD_SECONDS, group[0].start + MIN_CUE_SECONDS), next_start, duration)
        cues.append(Cue(start=group[0].start, end=max(end, group[-1].end), lines=balance_lines(group, max_chars)))
    return cues


# ---------------------------------------------------------------------- ASS


def _ass_color(hex_color: str, opacity: float = 1.0) -> str:
    value = hex_color.lstrip("#")
    r, g, b = value[0:2], value[2:4], value[4:6]
    alpha = round((1 - opacity) * 255)
    return f"&H{alpha:02X}{b}{g}{r}".upper()


def _ass_time(seconds: float) -> str:
    cs = max(0, round(seconds * 100))
    h, rem = divmod(cs, 360_000)
    m, rem = divmod(rem, 6000)
    s, cs = divmod(rem, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _escape(text: str) -> str:
    return text.replace("\\", "/").replace("{", "(").replace("}", ")")


def _cue_text(cue: Cue, highlight_index: int | None, template: SubtitleTemplate) -> str:
    color = _ass_color(template.highlight)
    lines: list[str] = []
    index = 0
    for line in cue.lines:
        parts: list[str] = []
        for word in line:
            text = _escape(word.text)
            if index == highlight_index:
                scale = template.highlight_scale
                pop = f"\\fscx{scale}\\fscy{scale}" if scale != 100 else ""
                text = f"{{\\1c{color}{pop}}}{text}{{\\r}}"
            parts.append(text)
            index += 1
        lines.append(" ".join(parts))
    return "\\N".join(lines)


def to_ass(
    cues: list[Cue],
    template: SubtitleTemplate,
    layout: SubtitleLayout,
    *,
    highlight_words: bool,
    time_offset: float = 0.0,
) -> str:
    """Gera o arquivo ASS. ``time_offset`` desloca os tempos (usado na prévia de um quadro)."""
    scale = min(layout.width, layout.height) / REFERENCE_SIZE
    back = _ass_color(template.box_color, template.box_opacity) if template.box else _ass_color("#000000", 0.6)
    style = ",".join(
        str(v)
        for v in (
            "Main",
            template.font,
            layout.font_size,
            _ass_color(template.primary),
            _ass_color(template.highlight),
            _ass_color(template.outline_color),
            back,
            -1 if template.bold else 0,
            0,
            0,
            0,
            100,
            100,
            0,
            0,
            3 if template.box else 1,
            round(template.outline * scale, 1),
            round(template.shadow * scale, 1),
            layout.alignment,
            layout.margin_h,
            layout.margin_h,
            layout.margin_v,
            1,
        )
    )
    events: list[str] = []

    def add(start: float, end: float, text: str) -> None:
        start, end = start + time_offset, end + time_offset
        if end <= 0 or end - start < 0.01:
            return
        events.append(f"Dialogue: 0,{_ass_time(max(0.0, start))},{_ass_time(end)},Main,,0,0,0,,{text}")

    for cue in cues:
        words = cue.words
        if not highlight_words or not words:
            add(cue.start, cue.end, _cue_text(cue, None, template))
            continue
        # Um evento por palavra; os limites são compartilhados para não haver sobreposição nem piscadas.
        bounds = [cue.start] + [w.start for w in words[1:]] + [cue.end]
        for k in range(len(words)):
            if bounds[k + 1] > bounds[k]:
                add(bounds[k], bounds[k + 1], _cue_text(cue, k, template))

    header = [
        "[Script Info]",
        "; Gerado pelo UNLOCK CLIPS",
        "ScriptType: v4.00+",
        f"PlayResX: {layout.width}",
        f"PlayResY: {layout.height}",
        "WrapStyle: 2",
        "ScaledBorderAndShadow: yes",
        "YCbCr Matrix: TV.709",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
        "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, "
        "MarginR, MarginV, Encoding",
        f"Style: {style}",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    return "\n".join(header + events) + "\n"


def to_srt(cues: list[Cue]) -> str:
    def stamp(seconds: float) -> str:
        ms = max(0, round(seconds * 1000))
        h, rem = divmod(ms, 3_600_000)
        m, rem = divmod(rem, 60_000)
        s, ms = divmod(rem, 1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

    blocks = [f"{i}\n{stamp(c.start)} --> {stamp(c.end)}\n{c.text}\n" for i, c in enumerate(cues, start=1)]
    return "\n".join(blocks)
