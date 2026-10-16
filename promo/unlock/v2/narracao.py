"""Narração da versão 2 — voz neural Kokoro-82M (Apache-2.0), português do Brasil.

Cada fala entra no mesmo instante do texto na tela (estilo do vídeo de referência).
A pronúncia está escrita em IPA (fonemas) para não depender de pacotes externos.
Se uma fala não couber na janela, a velocidade aumenta só naquela fala.

Uso:  python3 narracao.py saida.wav
Requer: numpy, onnxruntime e o modelo kokoro-q8.onnx (veja README.md).
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
MODELO = os.environ.get("KOKORO_MODEL", os.path.join(VOZES, "kokoro-q8.onnx"))
VOZ = os.environ.get("VOZ", "pf_dora")  # pf_dora (feminina) · pm_alex · pm_santa (masculinas)
SR = 24000
DUR = 20.0

# (início em s, duração máxima em s, fonemas, texto falado)
FALAS = [
    (0.10, 1.35, "kˈɛɾ mˈajs ˈɛfi pˈe ˈɛsi?", "Quer mais FPS?"),
    (1.58, 0.55, "ʤi fˈɔɾmɐ…", "De forma..."),
    (2.12, 0.45, "flˈujdɐ!", "Fluida!"),
    (2.62, 0.60, "pɾesˈizɐ.", "Precisa."),
    (3.62, 1.50, "kõɲˈesɐ a ɐ̃nlˈɔki kˈõfiɡi.", "Conheça a Unlock Config."),
    (5.25, 1.60, "ˈumɐ komunidˈaʤi nʊ ʤiskˈɔɾʤi.", "Uma comunidade no Discord."),
    (7.05, 1.05, "ʒˈɔɡi sˈẽj limˈiʧis!", "Jogue sem limites!"),
    (8.12, 1.35, "mˈajs ʤi mˈiw mˈẽbɾʊs.", "Mais de mil membros."),
    (9.62, 1.60, "sˈẽtʊ i kwaɾˈẽtɐ i kwˈatɾʊ ˈɛfi pˈe ˈɛsi.", "Cento e quarenta e quatro FPS."),
    (11.25, 0.55, "mˈɛtodʊ,", "Método,"),
    (11.82, 0.62, "kimˈawzi pɾˈo,", "Keymouse Pro,"),
    (12.42, 1.20, "oʧimizasˈɐ̃w̃ estɾˈemɐ.", "Otimização extrema."),
    (13.72, 0.95, "mˈajs dezẽpˈeɲʊ.", "Mais desempenho."),
    (14.88, 0.85, "mˈajs vitˈɔɾjɐs.", "Mais vitórias."),
    (15.86, 0.82, "ɐ̃nlˈɔki kˈõfiɡi.", "Unlock Config."),
    (16.72, 0.90, "ʒˈɔɡi sˈẽj limˈiʧis.", "Jogue sem limites."),
    (17.65, 1.30, "ʧi espeɾˈɐmʊz nʊ ʤiskˈɔɾʤi!", "Te esperamos no Discord!"),
]

vocab = json.load(open(os.path.join(VOZES, "kokoro-config.json"), encoding="utf-8"))["vocab"]
pack = np.load(os.path.join(VOZES, f"{VOZ}.npy"))
sess = ort.InferenceSession(MODELO, providers=["CPUExecutionProvider"])


def synth(ph, speed):
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


track = np.zeros(int(SR * DUR), dtype=np.float32)
for start, maxd, ph, txt in FALAS:
    speed = 1.12
    w = synth(ph, speed)
    if len(w) / SR > maxd:
        speed = min(1.4, speed * (len(w) / SR) / maxd * 1.02)
        w = synth(ph, speed)
    i = int(start * SR)
    w = w[: len(track) - i]
    track[i:i + len(w)] += w
    over = " (passa da janela)" if len(w) / SR > maxd + 0.05 else ""
    print(f"{start:5.2f}s  {len(w) / SR:4.2f}s  vel {speed:.2f}  {txt}{over}")

track /= max(1e-6, np.abs(track).max()) / 0.9
out = sys.argv[1] if len(sys.argv) > 1 else "narracao.wav"
with wave.open(out, "wb") as f:
    f.setnchannels(1)
    f.setsampwidth(2)
    f.setframerate(SR)
    f.writeframes((track * 32767).astype("<i2").tobytes())
print("narração:", out)
