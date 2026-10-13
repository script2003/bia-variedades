import wave
from pathlib import Path

import numpy as np
import pytest

from app.clip_lexicon import PT
from app.clips import (
    ClipAnalyzer,
    assign_topics,
    build_sentences,
    criteria,
    detect_clips,
    energy_profile,
    find_phrases,
    normalize,
)
from app.schemas import SCORING_CRITERIA_DEFAULTS, Clip, Transcript, TranscriptSegment

from .clip_fixtures import BORING, OPINION, PODCAST, QA, SHIFT, STORY, make_transcript


def component(clip: Clip, key: str):
    return next(c for c in clip.components if c.key == key)


def starting_with(clip_set, text: str) -> Clip:
    return next(c for c in clip_set.clips if c.text.startswith(text))


# ------------------------------------------------------------------ texto


def test_normalize_and_phrase_matching_respect_word_boundaries():
    assert normalize("Você PRECISA, já!") == " voce precisa ja ! "
    norm = normalize("A massa estava boa, mas o maior erro foi o sal.")
    # A expressão mais longa tem prioridade e não é contada de novo como "erro".
    assert find_phrases(norm, ["mas", "maior erro", "erro"]) == ["maior erro", "mas"]
    assert find_phrases(normalize("Erro aqui, erro ali"), ["erro"]) == ["erro", "erro"]
    assert find_phrases(normalize("Massa demais"), ["mas"]) == []


def test_lexicon_matches_without_accents_but_explains_with_them():
    assert find_phrases(normalize("NA MINHA OPINIAO, voce precisa ver"), PT.opinion + PT.impact) == [
        "na minha opinião",
        "você precisa",
    ]
    sentences = build_sentences(make_transcript([("sera que isso funciona sem ponto", 0.5)]), PT)
    assert sentences[0].is_question  # sem pontuação: usa o início "será que"


def test_build_sentences_from_words():
    transcript = make_transcript([("Olá pessoal, tudo bem?", 0.2), ("e aí vamos começar", 1.5), ("Bora.", 0.3)])
    sentences = build_sentences(transcript, PT)
    assert [s.text for s in sentences] == ["Olá pessoal, tudo bem?", "e aí vamos começar", "Bora."]
    assert sentences[0].is_question and sentences[0].terminal
    assert not sentences[1].terminal and sentences[1].first_word == "e"
    assert sentences[1].pause_after == pytest.approx(1.55, abs=0.01)
    assert sentences[2].pause_after == 10.0


def test_long_pause_splits_sentence_without_punctuation():
    transcript = make_transcript([("primeira parte sem ponto", 1.2), ("segunda parte", 0.2)])
    # As duas frases estão no mesmo segmento? Não: mas a pausa de 1,2 s separaria mesmo assim.
    assert len(build_sentences(transcript, PT)) == 2


def test_segments_without_word_timestamps_are_supported():
    transcript = Transcript(
        model="m",
        language="pt",
        duration_seconds=10,
        segments=[TranscriptSegment(id=0, start=1, end=5, text="Isso funciona sem palavras. Mesmo assim?")],
    )
    sentences = build_sentences(transcript, PT)
    assert [s.text for s in sentences] == ["Isso funciona sem palavras.", "Mesmo assim?"]
    assert sentences[0].start == 1 and sentences[-1].end == pytest.approx(5)


# ------------------------------------------------------------------ assuntos


def test_topics_detect_announced_and_lexical_shifts():
    finance = [(f"O investimento em ações rende juros compostos com dinheiro aplicado número {k}.", 0.4) for k in range(10)]
    football = [(f"O jogador chutou a bola no gol durante a partida número {k}.", 0.4) for k in range(10)]
    transcript = make_transcript(finance + football)
    sentences = build_sentences(transcript, PT)
    boundaries = assign_topics(sentences, PT, min_spacing=10)
    assert any(8 <= b <= 12 for b in boundaries), boundaries
    assert sentences[0].topic == 0 and sentences[-1].topic >= 1

    announced = make_transcript(QA + SHIFT)
    sentences = build_sentences(announced, PT)
    assert assign_topics(sentences, PT) == [len(QA)]
    assert sentences[len(QA)].topic_start


# ------------------------------------------------------------------ pontuação


@pytest.fixture(scope="module")
def podcast_clips():
    return detect_clips(make_transcript(PODCAST), duration_preset="15-30", max_clips=10, weights={})


def test_detected_clips_respect_duration_overlap_and_limit(podcast_clips):
    clips = podcast_clips.clips
    assert 3 <= len(clips) <= 10
    assert [c.score for c in clips] == sorted((c.score for c in clips), reverse=True)
    for clip in clips:
        assert 15 <= clip.end - clip.start <= 30
        assert clip.status == "suggested" and clip.origin == "auto"
        assert 0 <= clip.score <= 100
        assert sum(c.points for c in clip.components) == pytest.approx(clip.score, abs=0.3)
    for a in clips:
        for b in clips:
            if a is not b:
                inter = min(a.end, b.end) - max(a.start, b.start)
                assert inter <= 0.2 * min(a.end - a.start, b.end - b.start) + 0.01
    assert podcast_clips.candidates_evaluated > len(clips)


def test_question_and_answer_is_recognized_and_explained(podcast_clips):
    clip = starting_with(podcast_clips, "Por que a maioria")
    qa = component(clip, "qa")
    assert qa.value == 1.0 and "respondida" in qa.details[0]
    assert component(clip, "hook").value >= 0.6
    assert clip.title == "Por que a maioria das pessoas nunca consegue guardar dinheiro?"
    assert any("pergunta" in h.lower() for h in clip.highlights)


def test_story_and_opinion_are_recognized(podcast_clips):
    story = starting_with(podcast_clips, "Uma vez eu perdi")
    assert component(story, "story").value >= 0.8
    assert any("Conclusão" in d for d in component(story, "story").details)
    opinion = starting_with(podcast_clips, "Na minha opinião")
    assert component(opinion, "opinion").value >= 0.7


def test_strong_moments_outrank_filler_talk(podcast_clips):
    analyzer = ClipAnalyzer(make_transcript(PODCAST), {}, "15-30")
    question = next(s.index for s in analyzer.sentences if s.text.startswith("Por que"))
    boring = analyzer.build_clip(0, question - 1)
    assert boring.text.startswith("e aí tipo") and "Por que" not in boring.text
    qa = starting_with(podcast_clips, "Por que a maioria")
    story = starting_with(podcast_clips, "Uma vez eu perdi")
    assert qa.score > boring.score + 15
    assert story.score > boring.score + 15
    assert any("vícios de linguagem" in w for w in boring.warnings)
    assert any("pode depender do que foi dito antes" in w for w in boring.warnings)
    # Nenhum corte sugerido é formado só por enrolação.
    assert all(not c.text.startswith("e aí tipo") for c in podcast_clips.clips[:3])


def test_crossing_a_topic_change_is_penalized():
    analyzer = ClipAnalyzer(make_transcript(QA + SHIFT), {}, "30-60")
    inside = analyzer.build_clip(0, len(QA) - 1)
    across = analyzer.build_clip(len(QA) - 2, len(QA) + 2)
    assert any("mudança(s) de assunto" in w for w in across.warnings)
    assert component(across, "context").value < component(inside, "context").value


def test_weights_change_the_ranking():
    transcript = make_transcript(PODCAST)
    only_story = {key: 0 for key in SCORING_CRITERIA_DEFAULTS} | {"story": 10}
    clips = detect_clips(transcript, duration_preset="15-30", max_clips=3, weights=only_story).clips
    assert clips[0].text.startswith("Uma vez eu perdi")
    assert component(clips[0], "story").points == clips[0].score


def test_manual_ranges_are_snapped_and_warned():
    transcript = make_transcript(QA + STORY)
    analyzer = ClipAnalyzer(transcript, {}, "15-30")
    sentences = analyzer.sentences
    exact = analyzer.evaluate_range(sentences[0].start + 0.2, sentences[4].end - 0.1)
    assert exact.start == pytest.approx(sentences[0].start) and exact.end == pytest.approx(sentences[4].end)
    assert "Começa no meio de uma frase" not in exact.warnings

    middle = sentences[1].words[3]
    cut = analyzer.evaluate_range(middle.start + 0.1, sentences[6].end - 0.1)  # cai dentro de palavras
    assert cut.start == pytest.approx(middle.start) and cut.end == pytest.approx(sentences[6].end)
    assert "Começa no meio de uma frase" in cut.warnings
    assert cut.text.split()[0] == middle.text.strip()

    long = analyzer.evaluate_range(sentences[0].start, sentences[-1].end)
    assert any("Fora da faixa configurada" in w for w in long.warnings)
    assert component(long, "duration").value == 0

    silence = analyzer.evaluate_range(500, 520)
    assert silence.score == 0 and silence.warnings == ["Não há fala transcrita neste intervalo"]


def test_curated_clips_are_kept_and_rejected_regions_not_resuggested(podcast_clips):
    transcript = make_transcript(PODCAST)
    approved = starting_with(podcast_clips, "Por que a maioria").model_copy(update={"status": "approved", "title": "Meu título"})
    rejected = starting_with(podcast_clips, "Uma vez eu perdi").model_copy(update={"status": "rejected"})
    manual = Clip(title="Manual", start=1.0, end=12.0, score=0, origin="manual", status="approved")
    result = detect_clips(transcript, duration_preset="15-30", max_clips=3, weights={}, keep=[approved, rejected, manual])
    ids = {c.id: c for c in result.clips}
    assert ids[approved.id].title == "Meu título" and ids[approved.id].status == "approved"
    assert ids[rejected.id].status == "rejected"
    assert ids[manual.id].origin == "manual" and ids[manual.id].score > 0  # repontuado
    new = [c for c in result.clips if c.id not in (approved.id, rejected.id, manual.id)]
    assert len(new) == 1  # 3 vagas − 2 curados não descartados
    assert all(min(c.end, rejected.end) - max(c.start, rejected.start) <= 0.2 * (c.end - c.start) for c in new)


def test_short_or_empty_transcripts_produce_notes():
    short = detect_clips(make_transcript(QA[:2]), duration_preset="30-60", max_clips=5, weights={})
    assert short.clips == [] and "mais curto que a duração mínima" in short.notes[0]
    empty = detect_clips(Transcript(model="m", language="pt", duration_seconds=5), duration_preset="15-30", max_clips=5, weights={})
    assert empty.clips == [] and "Não há falas" in empty.notes[0]
    other = detect_clips(make_transcript(QA * 3, language="ja"), duration_preset="15-30", max_clips=2, weights={})
    assert any("Idioma sem lista" in n for n in other.notes)


def test_english_lexicon_is_used():
    transcript = make_transcript(
        [
            ("Why do most people never save money?", 0.8),
            ("The answer is simpler than you think.", 0.4),
            ("The biggest mistake is spending first and saving later.", 0.4),
            ("In my opinion this is the most important habit of all.", 0.9),
        ],
        language="en",
    )
    clip = ClipAnalyzer(transcript, {}, "15-30").build_clip(0, 3)
    assert component(clip, "qa").value == 1.0
    assert component(clip, "opinion").value > 0
    assert component(clip, "impact").details


def test_emphasis_uses_audio_volume(tmp_path: Path):
    transcript = make_transcript(QA + STORY)
    analyzer = ClipAnalyzer(transcript, {}, "15-30")
    sentences = analyzer.sentences
    seconds = int(sentences[-1].end) + 2
    t = np.arange(seconds * 16000) / 16000
    amplitude = np.full_like(t, 0.05)
    loud_start, loud_end = sentences[len(QA)].start, sentences[-1].end
    amplitude[(t >= loud_start) & (t <= loud_end)] = 0.4
    samples = (amplitude * np.sin(2 * np.pi * 200 * t) * 32767).astype("<i2")
    wav_path = tmp_path / "audio.wav"
    with wave.open(str(wav_path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(samples.tobytes())
    analyzer.energy = energy_profile(wav_path, sentences)
    quiet = analyzer.build_clip(0, len(QA) - 1)
    loud = analyzer.build_clip(len(QA), len(QA) + len(STORY) - 1)
    assert component(loud, "emphasis").value > component(quiet, "emphasis").value
    assert any("dB acima" in d for d in component(loud, "emphasis").details)

    without_audio = ClipAnalyzer(transcript, {}, "15-30").build_clip(0, len(QA) - 1)
    assert component(without_audio, "emphasis").details == ["Sem áudio para medir"]


def test_criteria_catalog_matches_defaults():
    keys = [c.key for c in criteria()]
    assert keys == list(SCORING_CRITERIA_DEFAULTS)
    assert all(c.label and c.description for c in criteria())


def test_low_scores_are_not_suggested_and_noted(podcast_clips):
    best = podcast_clips.clips[0].score
    assert all(c.score >= max(25, best * 0.45) for c in podcast_clips.clips)
    assert not any(c.text.startswith("e aí tipo") for c in podcast_clips.clips)
    assert any("pontuação baixa" in n for n in podcast_clips.notes)


def test_clips_never_share_the_opening_sentence(podcast_clips):
    analyzer = ClipAnalyzer(make_transcript(PODCAST), {}, "15-30")
    ranges = [analyzer.sentence_range(c.start, c.end) for c in podcast_clips.clips]
    for a in ranges:
        for b in ranges:
            if a is not b:
                assert not (a[0] <= b[0] <= a[1]), (a, b)
    assert len({c.title for c in podcast_clips.clips}) == len(podcast_clips.clips)


def test_unanswered_question_is_not_the_title_and_is_penalized():
    analyzer = ClipAnalyzer(make_transcript(BORING + QA), {}, "15-30")
    question = next(s.index for s in analyzer.sentences if s.text.startswith("Por que"))
    ends_on_question = analyzer.build_clip(question - 1, question)
    answered = analyzer.build_clip(question, question + 2)
    assert not ends_on_question.title.startswith("Por que")
    assert "Termina com uma pergunta sem resposta" in ends_on_question.warnings
    assert component(ends_on_question, "context").value < component(answered, "context").value
    assert answered.title.startswith("Por que")
