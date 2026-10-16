"""Trilha original da versão 2 (sintetizada por código, livre de direitos): 20 s, 120 BPM.

Pop eletrônico leve, com efeitos sonoros sincronizados a cada animação
(pops, cliques, whooshes, ticks do contador, impactos).
Uso: python3 trilha.py saida.wav
"""
import json
import os
import sys
import wave
import numpy as np

SR = 44100
# mapa de tempo gerado por narracao.py (pausas esticadas para a narração caber)
_tp = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tempo.json")
TEMPO = json.load(open(_tp)) if os.path.exists(_tp) else {"dur": 20.0, "knots": [[0, 0], [20, 20]]}
_ko, _kn = zip(*TEMPO["knots"])


def W(t):
    """instante da animação original -> instante no vídeo final"""
    return float(np.interp(t, _ko, _kn))


DUR = float(TEMPO["dur"])
N = int(SR * DUR)
BEAT = 0.5
rng = np.random.default_rng(7)
L = np.zeros(N); R = np.zeros(N); send = np.zeros(N)


def idx(t): return int(round(t * SR))
def tt(d): return np.arange(int(d * SR)) / SR
def note(n): return 440.0 * 2 ** ((n - 69) / 12)
def saw(f, t): return 2 * ((f * t) % 1.0) - 1


def add(sig, t, gain=1.0, pan=0.0, rev=0.0):
    i = idx(t)
    if i >= N or i < 0:
        return
    sig = sig[: N - i]
    L[i:i + len(sig)] += sig * gain * np.sqrt(0.5 * (1 - pan))
    R[i:i + len(sig)] += sig * gain * np.sqrt(0.5 * (1 + pan))
    if rev:
        send[i:i + len(sig)] += sig * gain * rev


def lp(x, fc):
    fc = np.broadcast_to(np.asarray(fc, dtype=float), x.shape)
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x); acc = 0.0
    for i in range(len(x)):
        acc = (1 - a[i]) * x[i] + a[i] * acc
        y[i] = acc
    return y


def hp(x, fc): return x - lp(x, fc)


# ---------------- drums ----------------
def kick(g=1.0):
    t = tt(0.4)
    f = 48 + 110 * np.exp(-t * 32)
    return (np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 8) + rng.standard_normal(len(t)) * np.exp(-t * 350) * .2) * g


def snap(g=1.0):
    t = tt(0.22)
    n = hp(rng.standard_normal(len(t)), 1400)
    env = np.exp(-t * 30) + 0.5 * (t < 0.03) * np.exp(-((t % 0.009) * 500))
    return n * env * 0.4 * g


def hat(g=1.0, d=70):
    t = tt(0.08)
    return hp(rng.standard_normal(len(t)), 6000) * np.exp(-t * d) * 0.3 * g


# ---------------- SFX ----------------
def pop(f0=900, f1=280, g=1.0):
    t = tt(0.12)
    f = f1 + (f0 - f1) * np.exp(-t * 45)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 28) * g


def click(g=1.0):
    t = tt(0.05)
    return (hp(rng.standard_normal(len(t)), 3000) * np.exp(-t * 400) * .6 + np.sin(2 * np.pi * 3200 * t) * np.exp(-t * 180) * .4) * g


def tick(f=2600, g=1.0):
    t = tt(0.03)
    return np.sin(2 * np.pi * f * t) * np.exp(-t * 220) * g


def whoosh(d=0.3, up=False, g=1.0, lo=400, hi=7000):
    t = tt(d); k = t / d
    fc = lo + (hi - lo) * (k ** 2 if up else np.sin(np.pi * k))
    env = (k ** 1.6) if up else np.sin(np.pi * k) ** 1.5
    return lp(rng.standard_normal(len(t)), fc) * env * g


def swell(d=0.5, g=1.0):
    t = tt(d); k = t / d
    f = 160 * 2 ** (k * 2.2)
    tone = lp(saw(1, np.cumsum(f) / SR), 500 + 5000 * k)
    return (tone * .3 + whoosh(d, True) * .8) * k ** 2 * g


def impact(d=1.6, g=1.0):
    t = tt(d)
    f = 40 + 80 * np.exp(-t * 12)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 3)
    n = lp(rng.standard_normal(len(t)), 3000 * np.exp(-t * 4) + 200) * np.exp(-t * 8)
    return (s + n * .5) * g


def plink(f, g=1.0):
    t = tt(0.4)
    s = np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * f * 2 * t)
    return s * np.exp(-t * 9) * g


def pluck(f, d=0.2, g=1.0):
    t = tt(d)
    s = 0.55 * saw(f, t) + 0.45 * np.sign(np.sin(2 * np.pi * f * 1.003 * t))
    return lp(s, 1500 + 6000 * np.exp(-t * 28)) * np.exp(-t * 15) * g


# ---------------- harmony: C – G – Am – F (1 bar = 2 s) ----------------
CH = [[60, 64, 67], [59, 62, 67], [57, 60, 64], [57, 60, 65]]
RT = [36, 31, 33, 29]
def bar(t): return int(t // 2) % 4


t_all = np.arange(N) / SR
groove = lambda t: (0 <= t < W(3.0)) or (W(3.5) <= t < W(15.5)) or (W(15.82) <= t < W(18.5))
NB, N16 = int(DUR / BEAT), int(DUR / 0.125)

# drums
kicks = [b * BEAT for b in range(NB) if groove(b * BEAT)]
for kt in kicks:
    add(kick(0.75 if kt < W(3.0) else 1.0), kt)
for b in range(NB):
    t0 = b * BEAT
    if groove(t0) and b % 2 == 1:
        add(snap(), t0, 0.8, rev=0.2)
    if groove(t0 + 0.25):
        add(hat(), t0 + 0.25, 0.9, pan=0.25)
for s16 in range(N16):
    t0 = s16 * 0.125
    if W(3.5) <= t0 < W(15.5) and s16 % 2:
        add(hat(0.45, 110), t0, pan=-0.3)

# sidechain
duck = np.ones(N)
for kt in kicks:
    i = idx(kt); seg = np.arange(min(idx(0.3), N - i)) / SR
    duck[i:i + len(seg)] = np.minimum(duck[i:i + len(seg)], 1 - 0.6 * np.exp(-seg * 13))

# bass (8ths)
bass = np.zeros(N)
for e in range(int(DUR / 0.25)):
    st = e * 0.25
    if not groove(st):
        continue
    f = note(RT[bar(st)] + (12 if e % 2 else 0))
    seg = tt(0.22)
    s = (saw(f, seg) * .6 + np.sin(2 * np.pi * f * seg) * .7) * np.minimum(1, seg * 400) * np.exp(-seg * 7)
    i = idx(st); bass[i:i + len(s)] += s[: N - i]
bass = lp(bass, 900) * duck
L += bass * .5; R += bass * .5

# pad
pad = np.zeros(N)
for b in range(int(np.ceil(DUR / 2.0))):
    i0, i1 = idx(b * 2.0), min(N, idx(b * 2.0 + 2.0)); seg = t_all[i0:i1]
    for n in CH[b % 4]:
        for det in (-0.1, 0.1):
            pad[i0:i1] += saw(note(n) * 2 ** (det / 12), seg) * .09
pad = lp(pad, np.interp(t_all, [W(x) for x in [0, 3, 3.5, 15.5, 15.82, 18.5, 20]], [1800, 2500, 1200, 3200, 900, 3500, 800]))
pad *= np.interp(t_all, [0, .2, W(18.5), W(19.8), DUR], [0, .6, .6, 0, 0]) * duck
L += pad; R += np.roll(pad, 280); send += pad * .2

# arp (16ths) through the main groove
for s16 in range(N16):
    st = s16 * 0.125
    if not (W(3.5) <= st < W(15.5) or W(15.82) <= st < W(18.5)):
        continue
    ch = CH[bar(st)]
    n = (ch + [ch[0] + 12, ch[1] + 12])[[0, 2, 1, 3, 4, 2, 3, 1][s16 % 8]] + 12
    add(pluck(note(n), g=.13), st, pan=.4 * np.sin(s16 * .9), rev=.3)

# ---------------- SFX synced to the picture ----------------
fx = [
    (pop(700, 220), 0.0, .7), (pop(800, 260), 0.12, .6), (whoosh(.25, g=.5), 0.25, 1), (pop(1100, 400), 0.32, .5),
    (tick(2200), .12, .5), (tick(2400), .24, .5), (tick(2600), .36, .5),
    (whoosh(.3, True, .5), 1.28, 1),
    (pop(900, 300), 1.6, .7), (tick(2800), 1.7, .4), (tick(3000), 1.78, .4), (tick(3200), 1.86, .4),
    (swell(.22, .6), 1.98, 1), (whoosh(.3, g=.55, lo=600), 2.12, 1),
    (whoosh(.35, g=.6), 2.52, 1), (swell(.4, .7), 2.62, 1), (impact(1.2, .8), 3.0, 1), (whoosh(.5, True, .5), 3.1, 1),
    (pop(700, 240), 3.62, .8), (whoosh(.3, True, .5), 4.98, 1),
    (whoosh(.45, g=.6), 5.12, 1), (whoosh(.25, g=.5, lo=800), 6.78, 1), (swell(.25, .6), 6.83, 1), (impact(.8, .5), 7.08, 1),
    (whoosh(.3, True, .5, lo=300, hi=3000), 7.78, 1), (pop(500, 160), 8.08, .7),
    (pop(900, 300), 9.0, .6), (pop(800, 300), 9.6, .6), (click(), 10.3, .9), (whoosh(.3, True, .5), 10.8, 1),
    (whoosh(.35, g=.6), 10.95, 1), (whoosh(.25, g=.5), 11.68, 1), (whoosh(.25, g=.5), 12.22, 1), (whoosh(.3, True, .5), 12.7, 1),
    (pop(900, 300), 11.32, .45), (pop(950, 320), 11.9, .45), (pop(1000, 340), 12.45, .45),
    (pop(800, 260), 12.88, .6), (click(), 13.15, .9), (whoosh(.35, True, .6, lo=300), 13.45, 1), (impact(1.0, .6), 13.75, 1),
    (whoosh(.3, True, .5), 14.42, 1), (tick(3000), 14.65, .4), (pop(700, 230), 14.78, .7),
    (plink(note(84)), 14.9, .25), (plink(note(88)), 14.96, .25), (plink(note(91)), 15.02, .25),
    (swell(.3, .7), 15.52, 1), (impact(2.4, 1.1), 15.82, 1), (pop(700, 240), 15.95, .6),
    (whoosh(.3, g=.4), 17.4, 1), (pop(700, 240), 18.72, .7),
]
for sig, at, g in fx:
    add(sig, W(at), g, rev=.25)
# counter ticks (follow the eased count 8.1 → 9.0 s)
for i in range(1, 26):
    k = i / 26
    tk = 8.1 + 0.9 * (1 - (1 - k) ** (1 / 3))
    add(tick(2200 + 40 * i, .35), W(tk))
# sparkle on the invitation text
for i, n in enumerate([84, 88, 91, 96]):
    add(plink(note(n), .18), W(17.65) + i * 0.06, pan=-.3 + .2 * i, rev=.5)
# final chord
stab = np.zeros(idx(2.2)); st_t = tt(2.2)
for n in [60, 64, 67, 72, 76]:
    stab += saw(note(n), st_t) * .1 + saw(note(n) * 1.004, st_t) * .1
stab = lp(stab, 3500 * np.exp(-st_t * 1.6) + 300) * np.exp(-st_t * 1.7)
add(stab, W(18.72), .9, rev=.6)

# ---------------- reverb + master ----------------
ir_t = tt(1.6)
ir = lp(rng.standard_normal(len(ir_t)) * np.exp(-ir_t * 3.2), 5000)
ir /= np.sqrt(np.sum(ir ** 2))
nfft = 1 << int(np.ceil(np.log2(N + len(ir))))
wet = np.fft.irfft(np.fft.rfft(send, nfft) * np.fft.rfft(ir, nfft), nfft)[:N]
L += wet * .3; R += np.roll(wet, 400) * .3

mix = np.stack([L, R], axis=1)
mix *= np.interp(t_all, [0, .02, W(19.3), DUR], [0, 1, 1, 0])[:, None]
mix = np.tanh(mix * 1.4) / np.tanh(1.4)
mix /= np.max(np.abs(mix)) + 1e-9
mix *= .89
out = sys.argv[1] if len(sys.argv) > 1 else "trilha-v2.wav"
with wave.open(out, "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype("<i2").tobytes())
print("trilha:", out)
