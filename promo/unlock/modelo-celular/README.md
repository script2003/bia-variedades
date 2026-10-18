# Modelo: celular com tela verde + fundo de grade

`output/modelo-celular-tela-verde.mp4`: 9:16 (1080 × 1920), 30 fps, 30 s, sem som, loop perfeito.
Fundo preto com grade branca em perspectiva (em cima e embaixo) que se afasta devagar, e celular
prateado parado no centro, igual ao vídeo de referência. A tela é verde puro (#00FF00).
`output/previa.png` mostra um quadro.

Área da tela verde (para encaixar o vídeo): x 224 a 856, y 278 a 1640 (632 × 1362 px), cantos
arredondados. Proporção ≈ 9:19,4: gravações de tela de celular (ex.: 1080 × 2400) cabem quase sem
sobra.

## Como usar no CapCut

1. Coloque a sua gravação de tela na trilha principal.
2. Adicione `modelo-celular-tela-verde.mp4` como **Sobreposição** por cima, ocupando a tela toda.
3. Na sobreposição: **Recortar → Remoção de croma (Chroma key)** → escolha o verde da tela → ajuste
   a intensidade até o verde sumir.
4. Selecione a sua gravação e diminua/posicione até ela preencher a tela do celular.
5. Se o vídeo for mais longo que 30 s, duplique o modelo (ele emenda sem salto).

## Gerar de novo

```bash
cd promo/unlock/modelo-celular
NODE_PATH=$(npm root -g) node render.cjs
```
Cores e medidas ficam em `index.html` (`GREEN`, `PH`, `PLANES`, `STEP`, `LINE_EVERY`).
