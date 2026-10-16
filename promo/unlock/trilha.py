"""Trilha eletrônica original (sintetizada por código, livre de direitos) — 20 s, 120 BPM.

Os impactos coincidem com os cortes do vídeo: 1,5 s (título), 3 s, 11 s, 15 s,
16 s (frase final) e 18 s (marca).  Uso: python3 trilha.py saida.wav
"""
import sys
import wave
import numpy as np

SR = 44100
DUR = 20.0
N = int(SR * DUR)
BEAT = 0.5
rng = np.random.default_rng(42)

L = np.zeros(N)
R = np.zeros(N)
send = np.zeros(N)  # reverb bus (mono)


def idx(t):
    return int(round(t * SR))


def add(sig, t, gain=1.0, pan=0.0, rev=0.0):
    i = idx(t)
    if i >= N:
        return
    sig = sig[: N - i]
    lg = gain * np.sqrt(0.5 * (1 - pan))
    rg = gain * np.sqrt(0.5 * (1 + pan))
    L[i:i + len(sig)] += sig * lg
    R[i:i + len(sig)] += sig * rg
    if rev:
        send[i:i + len(sig)] += sig * gain * rev


def tt(d):
    return np.arange(int(d * SR)) / SR


def onepole_lp(x, fc):
    """One-pole low-pass; fc may be scalar or per-sample array."""
    fc = np.broadcast_to(np.asarray(fc, dtype=float), x.shape)
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a[i]) * x[i] + a[i] * acc
        y[i] = acc
    return y


def saw(f, t):
    return 2 * ((f * t) % 1.0) - 1


def note(n):  # MIDI → Hz
    return 440.0 * 2 ** ((n - 69) / 12)


# ---------------- instruments ----------------
def kick(gain=1.0):
    t = tt(0.45)
    f = 45 + 95 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t * 7.5)
    click = rng.standard_normal(len(t)) * np.exp(-t * 300) * 0.25
    return (body + click) * gain


def hat(dec=55, gain=1.0):
    t = tt(0.12)
    n = rng.standard_normal(len(t))
    n = np.diff(np.concatenate([[0], n]))  # crude high-pass
    return n * np.exp(-t * dec) * 0.22 * gain


def clap():
    t = tt(0.35)
    n = rng.standard_normal(len(t))
    env = np.exp(-t * 18) + 0.6 * np.exp(-((t - 0.012) % 0.011) * 400) * (t < 0.035)
    n = n - onepole_lp(n, 900)
    return n * env * 0.35


def boom(d=2.5, gain=1.0):
    t = tt(d)
    f = 38 + 70 * np.exp(-t * 10)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.2)
    n = rng.standard_normal(len(t)) * np.exp(-t * 9)
    n = onepole_lp(n, 2500 * np.exp(-t * 3) + 200)
    return (s * 0.9 + n * 0.6) * gain


def whoosh(d, up=True, gain=1.0):
    t = tt(d)
    k = t / d
    fc = (300 + 7000 * k ** 2) if up else (7000 * (1 - k) ** 2 + 300)
    n = onepole_lp(rng.standard_normal(len(t)), fc)
    env = (k ** 1.5) if up else np.sin(np.pi * np.minimum(k * 1.6, 1)) * (1 - k)
    return n * env * gain


def riser(d, gain=1.0):
    t = tt(d)
    k = t / d
    f = 180 * 2 ** (k * 2.5)
    tone = saw(1, np.cumsum(f) / SR)
    tone = onepole_lp(tone, 600 + 5000 * k)
    return (tone * 0.35 + whoosh(d, True) * 0.8) * k ** 2 * gain


def pluck(f, d=0.22, gain=1.0):
    t = tt(d)
    s = 0.6 * np.sign(np.sin(2 * np.pi * f * t)) + 0.4 * saw(f * 1.005, t)
    s = onepole_lp(s, 1200 + 5000 * np.exp(-t * 25))
    return s * np.exp(-t * 14) * gain


def blip(f, gain=1.0):
    t = tt(0.18)
    return np.sin(2 * np.pi * f * t) * np.exp(-t * 30) * gain


# chord progression (A minor): Am – F – C – G, one chord per bar (2 s)
CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]
ROOTS = [33, 29, 36, 31]


def chord_at(t):
    return int(t // 2) % 4


# ---------------- pad (whole track) ----------------
t_all = np.arange(N) / SR
pad = np.zeros(N)
for b in range(10):
    i0, i1 = idx(b * 2.0), idx(b * 2.0 + 2.0)
    seg = t_all[i0:i1]
    for n in CHORDS[b % 4]:
        for det in (-0.12, 0.12):
            pad[i0:i1] += saw(note(n + 12) * 2 ** (det / 12), seg) * 0.12
cut = np.interp(t_all, [0, 1.5, 3, 15, 16, 18, 20], [500, 1400, 2200, 2600, 900, 2800, 600])
pad = onepole_lp(pad, cut)
pad_env = np.interp(t_all, [0, 0.4, 1.5, 3, 15, 16, 18, 19.6, 20], [0, 0.55, 0.7, 0.55, 0.75, 0.6, 0.7, 0.0, 0.0])
pad *= pad_env

# sidechain envelope from the kick pattern
duck = np.ones(N)
kick_times = [b * BEAT for b in range(6, 30)] + [b * BEAT for b in range(32, 36)] + [2.0, 2.5]
for kt in kick_times:
    i = idx(kt)
    seg = np.arange(min(idx(0.32), N - i)) / SR
    duck[i:i + len(seg)] = np.minimum(duck[i:i + len(seg)], 1 - 0.65 * np.exp(-seg * 12))
pad *= duck
L += pad * 0.8
R += np.roll(pad, 300) * 0.8  # tiny Haas widening
send += pad * 0.25

# ---------------- drums ----------------
for kt in kick_times:
    add(kick(0.55 if kt < 3 else 1.0), kt)
for b in range(6, 30):  # hats on the off-beats, 3 → 15 s
    add(hat(), b * BEAT + 0.25, 0.9, pan=0.2)
for b in range(32, 36):
    add(hat(), b * BEAT + 0.25, 0.9, pan=0.2)
for s16 in range(int(7 / 0.125), int(15 / 0.125)):  # 16th hats in scenes 3–4
    if s16 % 2:
        add(hat(90, 0.5), s16 * 0.125, pan=-0.25)
for b in list(range(14, 30)) + list(range(32, 36)):  # clap on 2 & 4
    if b % 2 == 1:
        add(clap(), b * BEAT, 0.9, rev=0.25)
# snare roll in the 15–16 s break
for i, st in enumerate(np.arange(15.5, 16.0, 0.0625)):
    add(clap(), st, 0.15 + i * 0.07, rev=0.2)

# ---------------- bass (8ths, 3–15 s and 16–18 s) ----------------
bass = np.zeros(N)
for e in range(int(3 / 0.25), int(18 / 0.25)):
    st = e * 0.25
    if 15 <= st < 16:
        continue
    f = note(ROOTS[chord_at(st)] + (12 if e % 4 == 3 else 0))
    seg = tt(0.24)
    s = saw(f, seg) * 0.7 + np.sin(2 * np.pi * f / 2 * seg) * 0.6
    s *= np.minimum(1, seg * 300) * np.exp(-seg * 6)
    i = idx(st)
    bass[i:i + len(s)] += s[: N - i]
bass = onepole_lp(bass, 700) * duck
L += bass * 0.55
R += bass * 0.55

# ---------------- arp (7–15 s) ----------------
for s16 in range(int(7 / 0.125), int(15 / 0.125)):
    st = s16 * 0.125
    ch = CHORDS[chord_at(st)]
    n = (ch + [ch[0] + 12])[s16 % 4] + 12
    add(pluck(note(n), gain=0.16), st, pan=0.35 * np.sin(s16 * 0.7), rev=0.35)

# ---------------- FX synced to the picture ----------------
add(whoosh(0.8, False, 0.55), 0.1, rev=0.3)          # light line
add(riser(0.7, 0.6), 0.8)                           # wireframe spin
add(boom(2.2, 0.9), 1.5, rev=0.5)                   # title reveal
add(riser(0.5, 0.6), 2.5)
add(boom(1.6, 0.8), 3.0, rev=0.3)                   # cut to products
for wt in (3.7, 4.7, 5.7):                          # camera whips
    add(whoosh(0.32, False, 0.45), wt, pan=0.0, rev=0.2)
add(whoosh(0.6, True, 0.55), 6.6, rev=0.2)          # dive to hero
add(boom(1.2, 0.5), 7.0, rev=0.3)
add(riser(0.5, 0.45), 9.0)                          # detail zoom
add(riser(0.4, 0.55), 10.6)
add(boom(1.6, 0.8), 11.0, rev=0.4)                  # cut to Discord
add(blip(1760, 0.25), 12.0, pan=-0.3, rev=0.4)      # highlight 1
add(blip(2093, 0.25), 12.5, pan=0.3, rev=0.4)       # highlight 2
add(riser(0.5, 0.5), 14.5)
add(boom(1.4, 0.6), 15.0, rev=0.4)                  # cut to finale
add(riser(1.0, 0.8), 15.0)                          # build to the final line
add(boom(3.0, 1.15), 16.0, rev=0.6)                 # final phrase impact
add(riser(0.5, 0.4), 17.5)
add(boom(3.5, 1.2), 18.0, rev=0.8)                  # brand hit
# brand chord stab
stab = np.zeros(idx(2.0))
st_t = tt(2.0)
for n in [57, 64, 69, 72]:
    stab += saw(note(n), st_t) * 0.18 + saw(note(n) * 1.004, st_t) * 0.18
stab = onepole_lp(stab, 3000 * np.exp(-st_t * 1.5) + 300) * np.exp(-st_t * 1.8)
add(stab, 18.0, 0.8, rev=0.7)

# ---------------- reverb (FFT convolution with decaying noise) ----------------
ir_t = tt(2.2)
ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t * 2.6)
ir = onepole_lp(ir, 4500)
ir /= np.sqrt(np.sum(ir ** 2))
nfft = 1 << int(np.ceil(np.log2(N + len(ir))))
wet = np.fft.irfft(np.fft.rfft(send, nfft) * np.fft.rfft(ir, nfft), nfft)[:N]
L += wet * 0.35
R += np.roll(wet, 450) * 0.35

# ---------------- master ----------------
mix = np.stack([L, R], axis=1)
fade = np.interp(t_all, [0, 0.05, 19.2, 20.0], [0, 1, 1, 0])[:, None]
mix *= fade
mix = np.tanh(mix * 1.3) / np.tanh(1.3)
mix /= np.max(np.abs(mix)) + 1e-9
mix *= 0.89

out = sys.argv[1] if len(sys.argv) > 1 else "trilha-unlock.wav"
with wave.open(out, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype("<i2").tobytes())
print("trilha:", out)
