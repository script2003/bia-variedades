"""Junta o vídeo do celular com a gameplay.

Depois do clique em Abrir, o celular sobe e sai de cena empurrado pela gameplay, que entra por
baixo já rodando (whip vertical com desfoque de movimento e um whoosh sutil). A gameplay quadrada
fica inteira no meio, com uma cópia dela desfocada preenchendo em cima e embaixo.

    python3 montar.py

Usa ../modelo-celular/output/alpha-mouse-pro-no-celular.mp4 e fonte/gameplay.mp4.
Gera output/alpha-mouse-pro-gameplay.mp4.
"""
import os
import subprocess
import wave
import numpy as np

DIR = os.path.dirname(os.path.abspath(__file__))
CEL = os.path.join(DIR, "..", "modelo-celular", "output", "alpha-mouse-pro-no-celular.mp4")
GP = os.path.join(DIR, "fonte", "gameplay.mp4")
OUT = os.path.join(DIR, "output")
os.makedirs(OUT, exist_ok=True)

ABRIR = 12.5          # clique em Abrir no vídeo do celular
T0 = 12.8             # começo do corte (deixa a onda do clique aparecer)
D = 0.5               # duração do whip
SUB = 32              # subquadros por quadro para o desfoque de movimento
GANHO_JOGO = 17.9     # dB: a gravação está em -34 LUFS; leva o jogo para perto de -16 LUFS
SR = 44100


def dur(f):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]))


GD = dur(GP)
TOTAL = T0 + GD


def whoosh(path):
    """Ruído com filtro que abre e fecha, mais forte no meio do whip (quando o movimento é mais rápido)."""
    rng = np.random.default_rng(3)
    n = int(.75 * SR); t = np.arange(n) / SR; pk = .4
    e = np.where(t < pk, (t / pk) ** 2.2, np.exp(-(t - pk) / .09))
    fc = np.where(t < pk, 350 + 4200 * (t / pk) ** 2, 900 + 3650 * np.exp(-(t - pk) / .08))
    out = []
    for ch in range(2):
        x = rng.standard_normal(n); y = np.empty(n); lo = np.empty(n); a1 = a2 = 0.0
        al = np.exp(-2 * np.pi * 160 / SR)
        for i in range(n):
            a = np.exp(-2 * np.pi * fc[i] / SR)
            a1 = (1 - a) * x[i] + a * a1; a2 = (1 - a) * a1 + a * a2     # lowpass 2 polos, corte variável
            y[i] = a2
        acc = 0.0
        for i in range(n):
            acc = (1 - al) * y[i] + al * acc; lo[i] = acc               # tira o grave embolado
        out.append((y - lo) * e)
    s = np.stack(out, 1); s *= .32 / np.max(np.abs(s))
    with wave.open(path, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((s * 32767).astype("<i2").tobytes())
    return pk


wh = os.path.join(OUT, "whoosh.wav")
pico = whoosh(wh)
WH_AT = T0 + D / 2 - pico                 # pico do whoosh no meio do whip

# posição do corte: ease-in-out quártico (0 → 1920 px)
p = f"(t/{D})"
ease = f"if(lt({p},0.5),8*pow({p},4),1-8*pow(1-{p},4))"
T1 = T0 + D
vf = (
    # gameplay em 9:16: cópia desfocada no fundo + quadro inteiro no meio
    "[1:v]fps=30,setsar=1,split[gb][gf];"
    "[gb]scale=1920:1920,crop=1080:1920,gblur=sigma=40,eq=brightness=-0.12:saturation=1.15[bg];"
    "[gf]scale=1080:1080:flags=lanczos,unsharp=5:5:0.5:5:5:0[fg];"
    "[bg][fg]overlay=0:420,format=yuv420p,split[g1][g2];"
    f"[g1]trim=0:{D},setpts=PTS-STARTPTS[gt];"
    f"[g2]trim=start={D},setpts=PTS-STARTPTS[gc];"
    "[0:v]split[c1][c2];"
    f"[c1]trim=0:{T0},setpts=PTS-STARTPTS[ca];"
    f"[c2]trim={T0}:{T1},setpts=PTS-STARTPTS[ct];"
    # whip: celular em cima, gameplay embaixo, a janela desce; desfoque com subquadros
    f"[ct][gt]vstack,fps={30 * SUB},crop=1080:1920:0:'1920*{ease}',tmix=frames={SUB},fps=30[cw];"
    "[ca][cw][gc]concat=n=3:v=1:a=0,format=yuv420p[v]"
)
af = (
    "[0:a]apad[ac];"
    f"[1:a]volume={GANHO_JOGO}dB,afade=t=in:d=0.2,afade=t=out:st={GD - .3:.3f}:d=0.3,"
    f"adelay={int(T0 * 1000)}:all=1[aj];"
    f"[2:a]adelay={int(WH_AT * 1000)}:all=1[aw];"
    "[ac][aj][aw]amix=inputs=3:normalize=0:duration=longest,"
    "alimiter=level_in=1.2:limit=0.7:attack=1:release=60:level=false[a]"
)
arq = os.path.join(OUT, "alpha-mouse-pro-gameplay.mp4")
subprocess.run([
    "ffmpeg", "-y", "-v", "error", "-i", CEL, "-i", GP, "-i", wh,
    "-filter_complex", vf + ";" + af, "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-maxrate", "8M", "-bufsize", "16M",
    "-pix_fmt", "yuv420p", "-profile:v", "high", "-r", "30", "-g", "30",
    "-c:a", "aac", "-b:a", "192k", "-ar", str(SR), "-t", f"{TOTAL:.3f}", "-movflags", "+faststart", arq,
], check=True)
print("pronto:", arq, f"{TOTAL:.1f} s")
