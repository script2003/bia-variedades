# Unlock — vídeo promocional, versão 2

Feito com base no segundo vídeo de referência: fundo claro, uma cor de marca (roxo),
tipografia cinética palavra por palavra, telas inteiras de cor, elementos de interface
(botões, seletor, chave, cursor clicando), contador, mockup de celular e revelação da
marca com círculos concêntricos. 20 s, 1080 × 1920, 30 fps, com motion blur real
(4 subquadros por quadro).

## Arquivos

| Arquivo | Uso |
|---|---|
| `output/unlock-v2-narrado.mp4` | **Com narração** (voz feminina) + música, ~7 MB |
| `output/unlock-v2.mp4` | Só música e efeitos, ~7 MB |

## Narração

Como no vídeo de referência, uma voz fala as mesmas palavras que aparecem na tela, no mesmo
instante. A música abaixa sozinha enquanto a voz fala.

- Voz: **Dora** (feminina, português do Brasil) do modelo aberto **Kokoro-82M** (licença Apache-2.0).
  Também há duas vozes masculinas: `VOZ=pm_alex` ou `VOZ=pm_santa`.
- O roteiro e a pronúncia de cada fala estão em `narracao.py` (lista `FALAS`). Para mudar uma fala,
  troque o texto e os fonemas e ajuste o horário de início.
- O modelo (92 MB) não fica no repositório. Para baixá-lo:

```bash
cd promo/unlock/assets/vozes
npm pack kokoro-q8-shards@1.0.0 && tar xzf kokoro-q8-shards-1.0.0.tgz
cat package/kokoro-q8.part{0..5}.bin > kokoro-q8.onnx && rm -r package kokoro-q8-shards-1.0.0.tgz
```

## Roteiro

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
