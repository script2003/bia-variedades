"""Áudio do vídeo da Play Store (sintetizado por código, livre de direitos): 16 s.

Música leve a 120 BPM + efeitos no tempo das ações do vídeo (toques, teclas, whoosh,
progresso e um som de sucesso quando a instalação termina).
Uso: python3 audio.py saida.wav
"""
import sys
import wave
import numpy as np

SR = 44100
DUR = 16.0
N = int(SR * DUR)
rng = np.random.default_rng(11)
L = np.zeros(N); R = np.zeros(N); send = np.zeros(N)


def idx(t): return int(round(t * SR))
def tt(d): return np.arange(int(d * SR)) / SR
def note(n): return 440.0 * 2 ** ((n - 69) / 12)
def saw(f, t): return 2 * ((f * t) % 1.0) - 1


def add(sig, t, g=1.0, pan=0.0, rev=0.0):
    i = idx(t)
    if not 0 <= i < N:
        return
    sig = sig[: N - i]
    L[i:i + len(sig)] += sig * g * np.sqrt(.5 * (1 - pan))
    R[i:i + len(sig)] += sig * g * np.sqrt(.5 * (1 + pan))
    if rev:
        send[i:i + len(sig)] += sig * g * rev


def lp(x, fc):
    fc = np.broadcast_to(np.asarray(fc, dtype=float), x.shape)
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x); acc = 0.0
    for i in range(len(x)):
        acc = (1 - a[i]) * x[i] + a[i] * acc
        y[i] = acc
    return y


def hp(x, fc): return x - lp(x, fc)


def kick(g=1.0):
    t = tt(.35); f = 50 + 100 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9) * g


def hat(g=1.0):
    t = tt(.07); return hp(rng.standard_normal(len(t)), 6500) * np.exp(-t * 80) * .25 * g


def snap(g=1.0):
    t = tt(.18); return hp(rng.standard_normal(len(t)), 1500) * np.exp(-t * 32) * .35 * g


def tap(g=1.0):  # screen touch: soft "tock"
    t = tt(.08); f = 900 * np.exp(-t * 30) + 500
    return (np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 60) + hp(rng.standard_normal(len(t)), 3000) * np.exp(-t * 300) * .3) * g


def key(g=1.0):  # keyboard click
    t = tt(.035); return (hp(rng.standard_normal(len(t)), 2500) * np.exp(-t * 260) * .5 + np.sin(2 * np.pi * 1900 * t) * np.exp(-t * 200) * .3) * g


def whoosh(d=.35, g=1.0):
    t = tt(d); k = t / d
    return lp(rng.standard_normal(len(t)), 400 + 6000 * np.sin(np.pi * k)) * np.sin(np.pi * k) ** 1.5 * g


def pop(f0=900, f1=300, g=1.0):
    t = tt(.12); f = f1 + (f0 - f1) * np.exp(-t * 45)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 26) * g


def bell(f, d=1.2, g=1.0):
    t = tt(d)
    return (np.sin(2 * np.pi * f * t) + .4 * np.sin(2 * np.pi * f * 2.01 * t) + .15 * np.sin(2 * np.pi * f * 3 * t)) * np.exp(-t * 4.5) * g


# ---------- music: C – Am – F – G, 120 BPM ----------
CH = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]]
RT = [36, 33, 29, 31]
t_all = np.arange(N) / SR
for b in range(int(DUR / .5)):
    t0 = b * .5
    if 1.4 <= t0 < 15.0:
        add(kick(.8), t0)
        add(hat(), t0 + .25, pan=.25)
        if b % 2:
            add(snap(.7), t0, rev=.2)
duck = np.ones(N)
for b in range(int(DUR / .5)):
    t0 = b * .5
    if 1.4 <= t0 < 15.0:
        i = idx(t0); seg = np.arange(min(idx(.25), N - i)) / SR
        duck[i:i + len(seg)] = np.minimum(duck[i:i + len(seg)], 1 - .5 * np.exp(-seg * 14))
pad = np.zeros(N); bass = np.zeros(N)
for bar in range(int(np.ceil(DUR / 2))):
    i0, i1 = idx(bar * 2.0), min(N, idx(bar * 2.0 + 2.0)); seg = t_all[i0:i1]
    for n in CH[bar % 4]:
        for det in (-.08, .08):
            pad[i0:i1] += saw(note(n) * 2 ** (det / 12), seg) * .07
for e in range(int(DUR / .25)):
    st = e * .25
    if not 1.4 <= st < 15.0:
        continue
    f = note(RT[int(st // 2) % 4] + (12 if e % 2 else 0)); seg = tt(.2)
    s = (saw(f, seg) * .5 + np.sin(2 * np.pi * f * seg) * .7) * np.minimum(1, seg * 400) * np.exp(-seg * 8)
    i = idx(st); bass[i:i + len(s)] += s[: N - i]
pad = lp(pad, 2200) * np.interp(t_all, [0, .4, 15, 16], [.4, .7, .7, 0]) * duck
bass = lp(bass, 800) * duck
L += (pad + bass * .55) * .8; R += (np.roll(pad, 250) + bass * .55) * .8; send += pad * .2

# ---------- sound effects synced to the picture (seconds of the video) ----------
add(pop(700, 230), .05, .8, rev=.3)
add(whoosh(.5, .5), 1.3)
for at in (2.65, 3.72, 7.65, 9.2):
    add(tap(), at, .9)
for i in range(15):  # one click per typed letter (typing is shown 4.4 -> 7.5 s)
    add(key(.6), 4.6 + i * (2.7 / 14), pan=.2 * np.sin(i))
add(whoosh(.45, .6), 7.85)
for i in range(8):  # gentle ticks while the download fills
    add(pop(1200 + 60 * i, 900, .12), 9.8 + i * .26)
for i, n in enumerate([76, 79, 84]):  # success when the install completes
    add(bell(note(n), 1.4, .28), 12.45 + i * .09, pan=-.2 + .2 * i, rev=.5)
add(whoosh(.5, .45), 14.15)
add(pop(700, 230), 14.4, .7, rev=.3)
stab = np.zeros(idx(1.6)); st_t = tt(1.6)
for n in [60, 64, 67, 72]:
    stab += saw(note(n), st_t) * .08 + saw(note(n) * 1.004, st_t) * .08
add(lp(stab, 3000 * np.exp(-st_t * 1.8) + 300) * np.exp(-st_t * 2), 14.5, .8, rev=.5)

# ---------- reverb + master ----------
ir_t = tt(1.4); ir = lp(rng.standard_normal(len(ir_t)) * np.exp(-ir_t * 3.5), 5000); ir /= np.sqrt(np.sum(ir ** 2))
nfft = 1 << int(np.ceil(np.log2(N + len(ir))))
wet = np.fft.irfft(np.fft.rfft(send, nfft) * np.fft.rfft(ir, nfft), nfft)[:N]
L += wet * .3; R += np.roll(wet, 400) * .3
mix = np.stack([L, R], 1) * np.interp(t_all, [0, .02, 15.3, 16], [0, 1, 1, 0])[:, None]
mix = np.tanh(mix * 1.3) / np.tanh(1.3); mix /= np.max(np.abs(mix)) + 1e-9; mix *= .89
out = sys.argv[1] if len(sys.argv) > 1 else "audio.wav"
with wave.open(out, "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype("<i2").tobytes())
print("áudio:", out)
