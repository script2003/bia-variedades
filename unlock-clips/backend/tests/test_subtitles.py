import subprocess

import pytest

from app.subtitles import (
    TEMPLATES,
    CueWord,
    TextCue,
    _ass_color,
    auto_text_cues,
    balance_lines,
    build_cues,
    cues_from_text,
    layout_for,
    merge_edits,
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


# ---------------------------------------------------------------------- edição (Etapa 6)


def test_auto_text_cues_keep_punctuation_and_absolute_times():
    words = words_from(SPEECH)
    cues = auto_text_cues(words, 10.0, 40.0, 30)
    assert cues[0].start == pytest.approx(10.0) and any(c.text.endswith("dinheiro?") for c in cues)
    assert any("," in c.text for c in cues)  # o editor mostra a pontuação original
    assert " ".join(c.text for c in cues) == " ".join(w[2].strip() for w in words)
    assert all(not c.edited and not c.hidden for c in cues)


def test_merge_edits_keeps_edits_and_fills_gaps_from_transcript():
    words = words_from(SPEECH)
    auto = auto_text_cues(words, 10.0, 40.0, 30)
    edit = TextCue(auto[1].start, auto[1].end, "Texto  corrigido pelo usuário")
    merged = merge_edits(words, 10.0, 40.0, 30, [edit])
    assert [c.text for c in merged] == [auto[0].text, "Texto corrigido pelo usuário", *[c.text for c in auto[2:]]]
    assert merged[1].edited and not merged[0].edited

    # Bloco igual à transcrição não conta como editado; bloco oculto conta.
    same = merge_edits(words, 10.0, 40.0, 30, [TextCue(auto[0].start, auto[0].end, auto[0].text)])
    assert not same[0].edited
    hidden = merge_edits(words, 10.0, 40.0, 30, [TextCue(auto[0].start, auto[0].end, auto[0].text, hidden=True)])
    assert hidden[0].edited and hidden[0].hidden

    # Corte encurtado: a edição fora do trecho some; a que fica é limitada ao novo fim.
    shorter = merge_edits(words, 10.0, auto[1].start + 0.5, 30, [edit])
    assert shorter[-1].text == "Texto corrigido pelo usuário" and shorter[-1].end == pytest.approx(auto[1].start + 0.5)


def test_cues_from_text_reuses_word_timings_when_word_count_matches():
    words = words_from(SPEECH)
    auto = auto_text_cues(words, 10.0, 40.0, 30)
    first = auto[0]
    tokens = first.text.split()
    edited = TextCue(first.start, first.end, " ".join(t.upper() if k == 0 else t for k, t in enumerate(tokens)), edited=True)
    [cue] = cues_from_text([edited], words, 10.0, 40.0, 30)
    original = [w for w in words if first.start <= (w[0] + w[1]) / 2 < first.end]
    assert [round(w.start, 3) for w in cue.words] == [round(o[0] - 10.0, 3) for o in original]
    assert cue.words[0].text == tokens[0].upper() and cue.words[-1].text == tokens[-1]  # mantém a pontuação editada
    assert cue.start == pytest.approx(first.start - 10.0) and cue.end == pytest.approx(first.end - 10.0)


def test_cues_from_text_distributes_new_words_and_splits_long_text():
    words = words_from(SPEECH)
    text = "uma frase completamente nova escrita pelo usuário para substituir o trecho original inteiro agora"
    cue_in = TextCue(12.0, 16.0, text, edited=True)
    cues = cues_from_text([cue_in], words, 10.0, 40.0, 20, uppercase=True)
    assert len(cues) > 1  # não cabe em duas linhas de 20 caracteres
    assert cues[0].start == pytest.approx(2.0) and cues[-1].end == pytest.approx(6.0)
    all_words = [w for c in cues for w in c.words]
    assert " ".join(w.text for w in all_words) == text.upper()
    starts = [w.start for w in all_words]
    assert starts == sorted(starts) and starts[0] >= 2.0 and all_words[-1].end <= 6.0 + 1e-6
    assert all(len(c.lines) <= 2 for c in cues)
    for a, b in zip(cues, cues[1:]):
        assert a.end <= b.start + 1e-6


def test_cues_from_text_skips_hidden_and_empty_blocks():
    words = words_from(SPEECH)
    cues = cues_from_text(
        [TextCue(10.0, 12.0, "visível"), TextCue(12.0, 14.0, "oculta", hidden=True), TextCue(14.0, 15.0, "  ")],
        words, 10.0, 40.0, 30,
    )  # fmt: skip
    assert [c.text for c in cues] == ["visível"]
