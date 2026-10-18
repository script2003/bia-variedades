"""Sons de clique e de teclado (sintetizados por código, livres de direitos).

Lê os cliques exportados pela animação (tempo + tipo) e gera:
  - mouse: clique de mouse em duas etapas (aperta e solta), seco e "estalado";
  - key:   tecla de teclado mecânico, com "thock" grave e um leve "clack" ao subir;
  - space: barra de espaço, mais grave e mais longa.
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
rng = np.random.default_rng(5)
L = np.zeros(N); R = np.zeros(N); send = np.zeros(N)


def tt(d): return np.arange(int(d * SR)) / SR


def lp(x, fc):
    a = np.exp(-2 * np.pi * fc / SR); y = np.empty_like(x); acc = 0.0
    for i in range(len(x)):
        acc = (1 - a) * x[i] + a * acc; y[i] = acc
    return y


def hp(x, fc): return x - lp(x, fc)


def ping(f, dec, d=0.12):
    t = tt(d); return np.sin(2 * np.pi * f * t) * np.exp(-t / dec)


def burst(d, lo, hi, dec):
    t = tt(d); n = rng.standard_normal(len(t))
    return lp(hp(n, lo), hi) * np.exp(-t / dec)


def mix(*parts):
    """sum sounds of different lengths: parts are (signal, gain) pairs"""
    n = max(len(x) for x, _ in parts); out = np.zeros(n)
    for x, g in parts:
        out[:len(x)] += x * g
    return out


def place(sig, at, g, pan, rev=0.12):
    i = int(at * SR)
    if not 0 <= i < N:
        return
    sig = sig[: N - i] * g
    L[i:i + len(sig)] += sig * np.sqrt(.5 * (1 - pan)); R[i:i + len(sig)] += sig * np.sqrt(.5 * (1 + pan))
    send[i:i + len(sig)] += sig * rev


def mouse_click(at, pan):
    v = rng.uniform(.96, 1.04)
    press = mix((burst(.012, 2000, 9000, .0012), .9), (ping(3100 * v, .006), .5), (ping(1250 * v, .012), .35), (ping(160, .02), .25))
    release = mix((burst(.01, 2500, 10000, .001), .6), (ping(3600 * v, .005), .35), (ping(1500 * v, .009), .2))
    place(press, at, 2.4, pan); place(release, at + .055, 1.6, pan)


def key(at, pan, space=False):
    v = rng.uniform(.94, 1.06)
    if space:
        body = mix((ping(150 * v, .045, .25), .9), (ping(330 * v, .03, .2), .5), (burst(.06, 300, 2500, .012), .5))
        top = mix((burst(.03, 900, 5000, .004), .35), (ping(620 * v, .012), .25))
        place(body, at, .9, pan, .18); place(top, at + .09, .55, pan)
    else:
        body = mix((ping(230 * v, .028, .18), .8), (ping(470 * v, .016), .5), (burst(.02, 700, 3500, .0035), .7), (ping(2100 * v, .004), .2))
        top = mix((burst(.012, 1200, 6000, .0018), .4), (ping(1800 * v, .006), .2))
        place(body, at, rng.uniform(.85, 1.0), pan, .15); place(top, at + rng.uniform(.06, .08), .5, pan)


for c in clicks:
    pan = float(np.clip((c.get("x", 540) - 540) / 540 * .45, -.45, .45))
    if c["kind"] == "mouse":
        mouse_click(c["t"], pan)
    else:
        key(c["t"], pan, space=(c["kind"] == "space"))

# small room so the clicks sound full, not dry
ir_t = tt(.25); ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t * 22); ir = lp(ir, 6000); ir /= np.sqrt(np.sum(ir ** 2))
nfft = 1 << int(np.ceil(np.log2(N + len(ir))))
wet = np.fft.irfft(np.fft.rfft(send, nfft) * np.fft.rfft(ir, nfft), nfft)[:N]
L += wet * .5; R += np.roll(wet, 220) * .5
mix = np.stack([L, R], 1)
mix /= np.max(np.abs(mix)) + 1e-9
mix *= .84
with wave.open(sys.argv[3], "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype("<i2").tobytes())
print("sons:", sys.argv[3], len(clicks), "cliques")
