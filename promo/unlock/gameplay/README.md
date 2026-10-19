# Alpha Mouse Pro — Play Store no celular + gameplay (9:16)

59,3 s, 1080 × 1920, 30 fps. Arquivo final: `output/alpha-mouse-pro-gameplay.mp4`.

1. **0–12,8 s:** o vídeo da Play Store dentro do celular (`../modelo-celular/output/alpha-mouse-pro-no-celular.mp4`),
   até o clique em **Abrir** (12,5 s) e a onda do clique.
2. **12,8–13,3 s:** whip vertical. O celular sobe e sai de cena empurrado pela gameplay, que entra
   por baixo já rodando (aceleração suave, desfoque de movimento com 32 subquadros) e um whoosh sutil
   no meio do movimento.
3. **13,3 s até o fim:** a gameplay inteira (`fonte/gameplay.mp4`, 46,5 s, termina no BOOYAH). Ela é
   quadrada, então fica inteira no meio, com uma cópia dela desfocada e um pouco mais escura
   preenchendo em cima e embaixo.

Som: os cliques do vídeo do celular, o whoosh (sintetizado em `montar.py`) e o som original do jogo,
que entra junto com o corte e foi nivelado (a gravação estava em −34 LUFS). Final: −16 LUFS, pico −1 dBFS.

```bash
cd promo/unlock/gameplay
python3 montar.py
```
