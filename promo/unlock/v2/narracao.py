"""Narração da versão 2 — voz neural Kokoro-82M (Apache-2.0), português do Brasil.

1. Gera cada frase em velocidade natural.
2. Calcula quanto tempo extra cada cena precisa para a fala caber, adicionando tempo só
   nas pausas das cenas (as entradas e transições continuam no ritmo original). O tempo
   extra é sempre múltiplo de 0,5 s (uma batida da música a 120 BPM) para manter o ritmo.
3. Salva o mapa de tempo em tempo.js / tempo.json (usado pela animação e pela trilha)
   e a narração já posicionada.

A pronúncia está escrita em IPA (fonemas), assim não depende de pacotes externos.

Uso:  python3 narracao.py saida.wav
Requer: numpy, onnxruntime e o modelo kokoro-fp32.onnx (veja README.md).
"""
import json
import os
import sys
import unicodedata
import wave

import numpy as np
import onnxruntime as ort

HERE = os.path.dirname(os.path.abspath(__file__))
VOZES = os.path.join(HERE, "..", "assets", "vozes")
MODELO = os.environ.get("KOKORO_MODEL", os.path.join(VOZES, "kokoro-fp32.onnx"))
VOZ = os.environ.get("VOZ", "pf_dora")  # pf_dora (feminina) · pm_alex · pm_santa (masculinas)
SR = 24000
ORIG_DUR = 20.0  # duração da animação sem as pausas extras
GAP = 0.18       # respiro mínimo depois de cada fala

# Pausas onde dá para esticar o tempo: (instante na animação original, meia-largura em s)
PAUSAS = [(1.00, .20), (2.82, .12), (4.70, .25), (6.20, .40), (7.55, .20), (9.32, .07),
          (10.55, .04), (11.62, .06), (12.20, .04), (12.68, .03), (13.45, .07), (14.15, .20),
          (15.30, .10), (16.90, .40), (18.35, .15), (19.20, .20)]

# (início e fim permitido, em tempo da animação original; fonemas; texto falado)
FALAS = [
    (0.10, 1.55, "kˈɛɾ mˈajs ˈɛfi pˈe ˈɛsi?", "Quer mais FPS?"),
    (1.60, 3.00, "ʤi fˈɔɾmɐ flˈujdɐ, i pɾesˈizɐ.", "De forma fluida, e precisa."),
    (3.62, 5.15, "kõɲˈesɐ a ɐ̃nlˈɔki kˈõfiɡi.", "Conheça a Unlock Config."),
    (5.25, 6.90, "a sˈuɐ komunidˈaʤi nʊ ʤiskˈɔɾʤi.", "A sua comunidade no Discord."),
    (7.05, 7.95, "pɾa vosˈe ʒoɡˈaɾ sˈẽj limˈiʧis.", "Pra você jogar sem limites."),
    (8.12, 9.55, "ʒˈa sˈɐ̃w̃ mˈajs ʤi mˈiw mˈẽbɾʊs.", "Já são mais de mil membros."),
    (9.62, 11.70, "kõ ʊ mˈɛtodʊ ʤi sˈẽtʊ i vˈĩʧi, i sˈẽtʊ i kwaɾˈẽtɐ i kwˈatɾʊ ˈɛfi pˈe ˈɛsi,",
     "Com o método de cento e vinte, e cento e quarenta e quatro FPS,"),
    (11.82, 12.40, "ʊ ˈɛsi ˈɛsi kimˈawzi pɾˈo,", "o SS Keymouse Pro,"),
    (12.45, 13.50, "i a oʧimizasˈɐ̃w̃ estɾˈemɐ,", "e a Otimização Extrema,"),
    (13.72, 14.42, "pɾa mˈajs dezẽpˈeɲʊ…", "pra mais desempenho..."),
    (14.75, 15.42, "i mˈajs vitˈɔɾjɐs.", "e mais vitórias."),
    (15.86, 17.40, "ɐ̃nlˈɔki kˈõfiɡi. ʒˈɔɡi sˈẽj limˈiʧis.", "Unlock Config. Jogue sem limites."),
    (17.65, 18.55, "ʧi espeɾˈɐmʊz nʊ ʤiskˈɔɾʤi!", "Te esperamos no Discord!"),
]

vocab = json.load(open(os.path.join(VOZES, "kokoro-config.json"), encoding="utf-8"))["vocab"]
pack = np.load(os.path.join(VOZES, f"{VOZ}.npy"))
sess = ort.InferenceSession(MODELO, providers=["CPUExecutionProvider"])


def synth(ph, speed=1.08):  # 1.08: ritmo de locução publicitária, ainda natural
    ph = unicodedata.normalize("NFD", ph)  # õ -> o + til combinante, como no vocabulário
    missing = [c for c in ph if c not in vocab]
    if missing:
        raise SystemExit(f"fonemas fora do vocabulário em {ph!r}: {missing}")
    ids = [vocab[c] for c in ph]
    style = pack[min(len(ids), len(pack) - 1)].astype(np.float32)
    out = sess.run(None, {
        "input_ids": np.array([[0, *ids, 0]], dtype=np.int64),
        "style": style,
        "speed": np.array([speed], dtype=np.float32),
    })[0][0]
    return trim(out)


def trim(w, thr=0.012):
    env = np.convolve(np.abs(w), np.ones(240) / 240, mode="same")
    on = np.where(env > thr)[0]
    if len(on) == 0:
        return w
    a, b = max(0, on[0] - 120), min(len(w), on[-1] + 720)
    w = w[a:b].copy()
    fade = min(240, len(w) // 4)
    w[:fade] *= np.linspace(0, 1, fade)
    w[-fade:] *= np.linspace(1, 0, fade)
    return w


# ---------- 1. falas em velocidade natural ----------
clips = [synth(ph) for _, _, ph, _ in FALAS]
durs = [len(c) / SR for c in clips]

# ---------- 2. tempo extra nas pausas ----------
extra = [0.0] * len(PAUSAS)
# TEMPO_FIXO=1 reaproveita o tempo.json existente (ex.: trocar só a voz sem renderizar o vídeo de novo)
FIXO = os.environ.get("TEMPO_FIXO") == "1"


def warp(t):
    """tempo da animação original -> tempo do vídeo final"""
    out = t
    for (p, w), h in zip(PAUSAS, extra):
        out += h * min(1.0, max(0.0, (t - (p - w)) / (2 * w)))
    return out


if FIXO:
    _t = json.load(open(os.path.join(HERE, "tempo.json")))
    _ko, _kn = zip(*_t["knots"])
    warp = lambda t: float(np.interp(t, _ko, _kn))  # noqa: E731
    for k, (a, b, ph, _) in enumerate(FALAS):
        room = warp(b) - warp(a) - GAP
        if durs[k] > room:  # fala mais longa nesta voz: acelera só ela, no máximo 1,25×
            clips[k] = synth(ph, min(1.25, 1.08 * durs[k] / room))
            durs[k] = len(clips[k]) / SR

for k, ((a, b, _, _), d) in enumerate(zip(FALAS, durs) if not FIXO else []):
    inside = [i for i, (p, w) in enumerate(PAUSAS) if a <= p - w and p + w <= b]
    if not inside:
        raise SystemExit(f"nenhuma pausa dentro da fala {k}")
    n = 0
    while warp(a) + d + GAP > warp(b):
        extra[inside[-1 - (n % len(inside))]] += 0.5
        n += 1

if FIXO:
    total = warp(ORIG_DUR)
else:
    knots = []
    for (p, w), h in zip(PAUSAS, extra):
        if h > 0:
            knots += [[round(p - w, 4), round(warp(p - w), 4)], [round(p + w, 4), round(warp(p + w), 4)]]
    knots = [[0.0, 0.0]] + knots + [[ORIG_DUR, round(warp(ORIG_DUR), 4)]]
    total = warp(ORIG_DUR)
    tempo = {"origDur": ORIG_DUR, "dur": total, "knots": knots}
    json.dump(tempo, open(os.path.join(HERE, "tempo.json"), "w"), indent=1)
    with open(os.path.join(HERE, "tempo.js"), "w") as f:
        f.write("// Gerado por narracao.py: mapa de tempo para a fala caber em cada cena.\n")
        f.write("window.TEMPO = " + json.dumps(tempo) + ";\n")

# ---------- 3. narração posicionada ----------
track = np.zeros(int(SR * total) + SR, dtype=np.float32)
for (a, b, _, txt), c, d in zip(FALAS, clips, durs):
    i = int(warp(a) * SR)
    track[i:i + len(c)] += c[: len(track) - i]
    print(f"{warp(a):6.2f}s  {d:4.2f}s  {txt}")
track = track[: int(SR * total)]
track /= max(1e-6, np.abs(track).max()) / 0.9
out = sys.argv[1] if len(sys.argv) > 1 else "narracao.wav"
with wave.open(out, "wb") as f:
    f.setnchannels(1)
    f.setsampwidth(2)
    f.setframerate(SR)
    f.writeframes((track * 32767).astype("<i2").tobytes())
print(f"duração do vídeo: {total:.1f} s  (pausas extras: {total - ORIG_DUR:.1f} s)")
print("narração:", out)
