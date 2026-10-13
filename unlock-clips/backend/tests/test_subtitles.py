import subprocess

import pytest

from app.subtitles import (
    TEMPLATES,
    CueWord,
    _ass_color,
    balance_lines,
    build_cues,
    layout_for,
    to_ass,
    to_srt,
)

from .conftest import requires_ffmpeg

SPEECH = (
    "Por que a maioria das pessoas nunca consegue guardar dinheiro? A resposta é mais simples do que parece, "
    "e você vai entender agora porque isso acontece com quase todo mundo que trabalha. Fim."
)


def words_from(text: str, start: float = 10.0, step: float = 0.35, pause_after: dict[int, float] | None = None):
    words, t = [], start
    for index, token in enumerate(text.split()):
        words.append((t, t + step - 0.05, " " + token))
        t += step + (pause_after or {}).get(index, 0.0)
    return words


def test_layout_depends_on_format_and_position():
    tpl = TEMPLATES["classico"]
    vertical = layout_for(tpl, 1080, 1920, 64, "inferior")
    assert (vertical.font_size, vertical.alignment, vertical.margin_v) == (64, 2, 384)  # 20% para fugir dos botões
    assert layout_for(tpl, 1920, 1080, 64, "inferior").margin_v == round(1080 * 0.08)
    assert layout_for(tpl, 1080, 1920, 64, "superior").alignment == 8
    assert layout_for(tpl, 1080, 1080, 64, "centro").alignment == 5
    assert layout_for(tpl, 1080, 1920, 96, "inferior").max_chars < vertical.max_chars
    assert layout_for(TEMPLATES["minimalista"], 1080, 1920, 64, "inferior").font_size == round(64 * 0.85)


def test_cues_are_readable_and_synchronized():
    words = words_from(SPEECH)
    layout = layout_for(TEMPLATES["destaque"], 1080, 1920, 64, "inferior")
    cues = build_cues(words, 10.0, 10.0 + 60, layout.max_chars, uppercase=True)
    assert cues[0].start == 0.0  # relativo ao início do corte
    for cue in cues:
        assert 1 <= len(cue.lines) <= 2
        assert all(sum(len(w.text) for w in line) + len(line) - 1 <= layout.max_chars for line in cue.lines)
        assert cue.end - cue.start <= 4.6
        assert cue.text == cue.text.upper()
    for a, b in zip(cues, cues[1:]):
        assert a.end <= b.start + 1e-6  # sem sobreposição
    texts = [c.text.replace("\n", " ") for c in cues]
    # A pergunta termina um bloco (não mistura duas frases) e nenhum bloco fica com uma palavra solta.
    assert any(t.endswith("DINHEIRO?") for t in texts)
    assert all(len(c.words) >= 2 for c in cues[:-1])
    # Ponto e vírgula no fim da linha são removidos; "?" fica.
    assert not any(w.text.endswith((".", ",")) for c in cues for w in c.words)


def test_cues_only_include_words_inside_the_clip_and_break_on_pauses():
    words = words_from("primeira parte aqui. segunda parte depois da pausa", pause_after={2: 1.2})
    cues = build_cues(words, 10.0 + 0.35, 20.0, 40)
    assert cues[0].words[0].text == "parte"  # "primeira" ficou antes do início
    assert [c.text for c in cues] == ["parte aqui", "segunda parte depois da pausa"]


def test_balance_lines_prefers_even_lengths():
    words = [CueWord(0, 1, t) for t in "um dois três quatro cinco seis sete".split()]
    first, second = balance_lines(words, 20)
    assert abs(len(" ".join(w.text for w in first)) - len(" ".join(w.text for w in second))) <= 6
    assert balance_lines(words[:2], 20) == [words[:2]]


def test_ass_colors_and_highlight_events():
    assert _ass_color("#C4F34A") == "&H004AF3C4"
    assert _ass_color("#000000", 0.6) == "&H66000000"
    words = words_from("Olá {mundo} \\ teste.", start=0)
    tpl = TEMPLATES["destaque"]
    layout = layout_for(tpl, 1080, 1920, 64, "inferior")
    cues = build_cues(words, 0, 10, layout.max_chars, uppercase=True)
    ass = to_ass(cues, tpl, layout, highlight_words=True)
    assert "PlayResX: 1080" in ass and "PlayResY: 1920" in ass
    events = [line for line in ass.splitlines() if line.startswith("Dialogue:")]
    assert len(events) == len(cues[0].words)
    assert all("\\1c&H004AF3C4" in e for e in events)
    assert "{MUNDO}" not in ass and "(MUNDO)" in ass  # chaves escapadas
    times = [(e.split(",")[1], e.split(",")[2]) for e in events]
    assert all(times[k][1] == times[k + 1][0] for k in range(len(times) - 1))  # contínuo, sem piscar

    plain = to_ass(cues, TEMPLATES["caixa"], layout, highlight_words=False)
    assert len([l for l in plain.splitlines() if l.startswith("Dialogue:")]) == len(cues)
    style_line = next(l for l in plain.splitlines() if l.startswith("Style: Main"))
    assert style_line.split(",")[15] == "3"  # BorderStyle 3 = caixa


def test_time_offset_shifts_and_drops_past_events():
    words = words_from("um dois. três quatro.", start=0, pause_after={1: 1.0})
    layout = layout_for(TEMPLATES["classico"], 1080, 1920, 64, "inferior")
    cues = build_cues(words, 0, 10, layout.max_chars)
    shifted = to_ass(cues, TEMPLATES["classico"], layout, highlight_words=False, time_offset=-cues[1].start)
    events = [l for l in shifted.splitlines() if l.startswith("Dialogue:")]
    assert len(events) == 1 and events[0].split(",")[1] == "0:00:00.00"


def test_srt_export():
    cues = build_cues(words_from("Olá pessoal. Tudo bem?", start=0), 0, 5, 30)
    assert to_srt(cues).startswith("1\n00:00:00,000 --> 00:00:0")
    assert "Tudo bem?" in to_srt(cues)


@requires_ffmpeg
@pytest.mark.parametrize("style", list(TEMPLATES))
def test_libass_accepts_every_template(tmp_path, style):
    tpl = TEMPLATES[style]
    layout = layout_for(tpl, 540, 960, 64, "inferior")
    cues = build_cues(words_from(SPEECH, start=0), 0, 8, layout.max_chars, uppercase=tpl.uppercase)
    (tmp_path / "s.ass").write_text(to_ass(cues, tpl, layout, highlight_words=True), encoding="utf-8")
    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=gray:s=540x960:d=2",
         "-vf", "ass=s.ass", "-frames:v", "1", "out.png"],
        cwd=tmp_path, capture_output=True, text=True,
    )  # fmt: skip
    assert result.returncode == 0, result.stderr
    assert (tmp_path / "out.png").stat().st_size > 0
