# Unlock — vídeo promocional, versão 2

Feito com base no segundo vídeo de referência: fundo claro, uma cor de marca (roxo),
tipografia cinética palavra por palavra, telas inteiras de cor, elementos de interface
(botões, seletor, chave, cursor clicando), contador, mockup de celular e revelação da
marca com círculos concêntricos. 33 s, 1080 × 1920, 30 fps, com motion blur real
(4 subquadros por quadro).

## Arquivos

| Arquivo | Uso |
|---|---|
| `output/unlock-v2-narrado.mp4` | **Com narração** (voz feminina) + música, ~7 MB |
| `output/unlock-v2-narrado-masculino.mp4` | Com narração (voz masculina) + música, ~7 MB |
| `output/unlock-v2.mp4` | Só música e efeitos, ~7 MB |

## Narração

Como no vídeo de referência, a voz acompanha as cenas. As frases são faladas em velocidade natural,
e o vídeo **ganha tempo só nas pausas** de cada cena até a fala caber (as entradas e transições
continuam rápidas). Por isso o vídeo passou de 20 s para ~33 s. O tempo extra é sempre múltiplo
de 0,5 s, uma batida da música, para manter o ritmo. A música abaixa sozinha enquanto a voz fala.

O roteiro falado:

> Quer mais FPS? De forma fluida, e precisa. Conheça a Unlock Config. A sua comunidade no Discord.
> Pra você jogar sem limites. Já são mais de mil membros. Com o método de cento e vinte, e cento e
> quarenta e quatro FPS, o SS Keymouse Pro, e a Otimização Extrema, pra mais desempenho... e mais
> vitórias. Unlock Config. Jogue sem limites. Te esperamos no Discord!

`narracao.py` gera a voz e grava o mapa de tempo em `tempo.js`/`tempo.json`; a animação
(`index.html`) e a trilha (`trilha.py`) leem esse mapa. Com `TEMPO_FIXO=1`, dá para trocar só a
voz sem mudar o tempo (é assim que a versão masculina é feita).

- Voz: **Dora** (feminina, português do Brasil) do modelo aberto **Kokoro-82M** (licença Apache-2.0).
  Também há duas vozes masculinas: `VOZ=pm_alex` ou `VOZ=pm_santa`.
- O roteiro e a pronúncia de cada fala estão em `narracao.py` (lista `FALAS`). Para mudar uma fala,
  troque o texto e os fonemas e ajuste o horário de início.
- Usa o modelo **completo** (fp32, 326 MB), que soa bem mais natural que a versão comprimida.
  Ele não fica no repositório. Para baixá-lo:

```bash
cd promo/unlock/assets/vozes
for p in a b c; do npm pack kokoro-fp32$p-shards@1.0.0 && tar xzf kokoro-fp32$p-shards-1.0.0.tgz && mv package/*.bin . && rm -r package kokoro-fp32$p-shards-1.0.0.tgz; done
for i in $(seq 0 18); do cat kokoro-fp32.part$i.bin; done > kokoro-fp32.onnx && rm kokoro-fp32.part*.bin
```

## Roteiro

Os tempos abaixo são da animação original (20 s); no vídeo final cada cena fica um pouco mais longa.

| Tempo | Cena |
|---|---|
| 0,0 s | "Quer mais FPS?" + formas roxas com ícones (mira, raio, gráfico) |
| 1,6 s | "De forma..." → o ponto vira tela roxa → "Fluida!" → cartão branco "Precisa." |
| 3,0 s | Explosão de raios roxos |
| 3,6 s | "Conheça a UNLOCK CONFIG" com o ícone do servidor |
| 5,2 s | Celular 3D com a captura do Discord |
| 7,0 s | Tela roxa "Jogue sem limites", que encolhe e vira o contador |
| 8,0 s | Contador até 1.291 membros + "56 online" |
| 9,6 s | Seletor "120 FPS / 144 FPS" com cursor clicando |
| 11,0 s | Carrossel com os 3 produtos |
| 12,9 s | Chave "Desligado / Ligado" (Otimização extrema) |
| 13,6 s | Painel roxo "Mais desempenho." |
| 14,6 s | "Mais vitórias" |
| 15,8 s | Revelação da marca + "Jogue sem limites" |
| 17,6 s | "Te esperamos no Discord!" → ícone final → fade |

Todos os textos e números vêm das imagens enviadas (miniaturas e captura do Discord).

## Editar

Os textos ficam em `textos.js`. Se uma frase ficar longa, o tamanho da fonte diminui sozinho.
Para ver a prévia, abra `index.html` no navegador. Para gerar o vídeo de novo (com e sem narração):

```bash
cd promo/unlock/v2
NODE_PATH=$(npm root -g) node render.cjs
```
