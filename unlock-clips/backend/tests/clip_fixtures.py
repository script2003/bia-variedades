"""Transcrições sintéticas para testar a detecção de cortes."""

from __future__ import annotations

from app.schemas import Transcript, TranscriptSegment, TranscriptWord


def make_transcript(
    sentences: list[tuple[str, float]],
    *,
    start: float = 0.5,
    language: str = "pt",
    word_seconds: float = 0.35,
    probability: float = 0.92,
) -> Transcript:
    """Cria uma transcrição com uma frase por segmento; cada item é (texto, pausa depois)."""
    segments: list[TranscriptSegment] = []
    t = start
    for index, (text, pause) in enumerate(sentences):
        words = []
        for token in text.split():
            words.append(TranscriptWord(start=round(t, 3), end=round(t + word_seconds - 0.05, 3), text=" " + token, probability=probability))
            t += word_seconds
        segments.append(
            TranscriptSegment(id=index, start=words[0].start, end=words[-1].end, text=text, words=words)
        )
        t += pause
    return Transcript(model="teste", language=language, duration_seconds=round(t + 1, 3), segments=segments)


BORING = [
    ("e aí tipo né a gente foi lá e tipo voltou né", 0.1),
    ("e tal tipo assim né hum a gente ficou lá", 0.1),
    ("e depois tipo né a gente meio que voltou assim", 0.1),
    ("e aí hum né tipo foi isso aí mesmo", 0.1),
    ("então tipo assim né a gente continuou lá", 0.1),
    ("e aí ahn tipo né ficou tudo meio igual", 0.6),
]

QA = [
    ("Por que a maioria das pessoas nunca consegue guardar dinheiro?", 0.8),
    ("A resposta é mais simples do que parece.", 0.4),
    ("O maior erro é gastar primeiro e tentar poupar o que sobra.", 0.4),
    ("Você precisa separar uma parte do salário logo no primeiro dia.", 0.4),
    ("Eu acho que esse é o hábito mais importante de todos.", 0.9),
]

STORY = [
    ("Uma vez eu perdi todo o meu dinheiro em um investimento arriscado.", 0.4),
    ("Então eu decidi estudar finanças com calma durante um ano inteiro.", 0.4),
    ("Depois disso comecei a investir de novo aos poucos e sem pressa.", 0.4),
    ("No final aprendi que paciência vale muito mais do que sorte.", 0.9),
]

OPINION = [
    ("Na minha opinião a escola deveria ensinar finanças desde cedo.", 0.4),
    ("Mas muita gente discorda disso e diz que é papel da família.", 0.4),
    ("Sinceramente eu acho que ignorar esse assunto é um erro enorme.", 0.4),
    ("Pelo contrário, quanto antes aprender melhor para todo mundo.", 0.9),
]

SHIFT = [
    ("Mudando de assunto vamos falar de futebol agora.", 0.4),
    ("O campeonato deste ano está muito equilibrado entre os times.", 0.4),
    ("Os jogadores correram bastante na última rodada do torneio.", 0.4),
    ("O técnico mudou a escalação para o jogo de domingo.", 0.4),
    ("A torcida lotou o estádio mesmo com a chuva forte.", 0.9),
]

PODCAST = BORING + QA + BORING + STORY + BORING + OPINION + SHIFT
