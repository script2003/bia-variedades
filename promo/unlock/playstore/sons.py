"""Sons de clique e de digitação (sintetizados por código, livres de direitos).

Modelados a partir da referência enviada (sem usar o áudio dela):
  - mouse: "toc" curto e tonal, como um toque em tela de celular: batida em ~520 Hz com um
           grave em ~290 Hz e, 50 ms depois, uma segunda batida em ~790 Hz com grave em ~200 Hz;
  - key:   clique fino e seco de teclado de notebook (energia em 1–3 kHz e ~7,5 kHz, poucos ms),
           com um clique bem fraco ao soltar a tecla;
  - space: igual à tecla, um pouco mais encorpado.
Uso: python3 sons.py cliques.json duracao saida.wav
"""
import json
import sys
import wave
import numpy as np

SR = 44100
clicks = json.load(open(sys.argv[1]))
DUR = float(sys.argv[2])
N = int(SR * DUR)
rng = np.random.default_rng(8)
L = np.zeros(N); R = np.zeros(N); send = np.zeros(N)


def tt(d): return np.arange(int(d * SR)) / SR


def bandpass(x, f0, q):
    """RBJ biquad band-pass (constant peak gain)."""
    w = 2 * np.pi * f0 / SR; al = np.sin(w) / (2 * q)
    b0, b1, b2 = al, 0.0, -al
    a0, a1, a2 = 1 + al, -2 * np.cos(w), 1 - al
    b0, b1, b2, a1, a2 = b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0
    y = np.zeros_like(x); x1 = x2 = y1 = y2 = 0.0
    for i in range(len(x)):
        v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, x[i], y1, v
        y[i] = v
    return y


def lowpass(x, fc, passes=2):
    a = np.exp(-2 * np.pi * fc / SR)
    for _ in range(passes):
        y = np.empty_like(x); acc = 0.0
        for i in range(len(x)):
            acc = (1 - a) * x[i] + a * acc; y[i] = acc
        x = y
    return x


def env(t, tau, attack=0.0004):
    return np.minimum(1, t / attack) * np.exp(-t / tau)


def tone(f0, f1, tau, d=0.06):
    t = tt(d); f = f1 + (f0 - f1) * np.exp(-t / 0.004)   # tiny downward glide, like a soft knock
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(t, tau)


def place(sig, at, g, pan, rev=0.08):
    i = int(at * SR)
    if not 0 <= i < N:
        return
    sig = sig[: N - i] * g
    L[i:i + len(sig)] += sig * np.sqrt(.5 * (1 - pan)); R[i:i + len(sig)] += sig * np.sqrt(.5 * (1 + pan))
    send[i:i + len(sig)] += sig * rev


def mix(*parts):
    n = max(len(x) for x, _ in parts); out = np.zeros(n)
    for x, g in parts:
        out[:len(x)] += x * g
    return out


def tap(at, pan):
    v = rng.uniform(.97, 1.03)
    t = tt(.003); tick = bandpass(rng.standard_normal(len(t)), 2500, 1.0) * env(t, .0006)
    # press: ~500 Hz knock, almost no low end; release 50 ms later: soft ~177 Hz thump + a bit of ~780 Hz
    down = mix((tone(540 * v, 497 * v, .0045), 1.0), (tone(300 * v, 290 * v, .005), .12), (tick, .2))
    up = mix((tone(185 * v, 177 * v, .009), 1.0), (tone(800 * v, 780 * v, .004), 1.1))
    place(down, at, 1.0, pan); place(up, at + .05, .62, pan)


def key(at, pan, space=False):
    v = rng.uniform(.93, 1.07); g = rng.uniform(.7, 1.0)
    t = tt(.03); n = rng.standard_normal(len(t))
    body = bandpass(n, 1500 * v, .9) * 1.25 + bandpass(n, 2500 * v, 2.2) * 1.0 + bandpass(n, 7600 * v, 3.2) * 2.3 + bandpass(n, 5400 * v, 2.5) * .45
    press = body * env(t, .0032 if not space else .0045)
    if space:
        tl = tt(.04); press = mix((press, 1.0), (bandpass(rng.standard_normal(len(tl)), 700, .8) * env(tl, .006), .6))
    t2 = tt(.012); rel = (bandpass(rng.standard_normal(len(t2)), 2400 * v, 1.6) + bandpass(rng.standard_normal(len(t2)), 7600, 3) * .6) * env(t2, .0018)
    press, rel = lowpass(press, 10000, 3), lowpass(rel, 10000, 3)   # the reference has almost nothing above ~9 kHz
    place(press, at, g, pan); place(rel, at + rng.uniform(.03, .05), g * .3, pan)


for c in clicks:
    pan = float(np.clip((c.get("x", 540) - 540) / 540 * .35, -.35, .35))
    if c["kind"] == "mouse":
        tap(c["t"], pan)
    else:
        key(c["t"], rng.uniform(-.15, .15), space=(c["kind"] == "space"))

# very small room, just to round the clicks off
ir_t = tt(.12); ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t * 40); ir /= np.sqrt(np.sum(ir ** 2))
nfft = 1 << int(np.ceil(np.log2(N + len(ir))))
wet = np.fft.irfft(np.fft.rfft(send, nfft) * np.fft.rfft(ir, nfft), nfft)[:N]
L += wet * .4; R += np.roll(wet, 180) * .4
mix_ = np.stack([L, R], 1)
mix_ /= np.max(np.abs(mix_)) + 1e-9
mix_ *= .84
with wave.open(sys.argv[3], "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix_ * 32767).astype("<i2").tobytes())
print("sons:", sys.argv[3], len(clicks), "eventos")
