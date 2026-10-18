# Alpha Mouse Pro — Play Store (9:16)

19 s, 1080 × 1920, 30 fps. Arquivo final: `output/alpha-mouse-pro-playstore.mp4`.

1. **Play Store** (`fonte/1-pesquisa.mp4`, velocidade real): um mouse entra (o primeiro quadro fica
   parado 0,9 s para isso), clica em Pesquisa, na barra de busca e em cada letra de
   "alpha mouse pro" no momento em que ela aparece na gravação, e depois na tecla de pesquisar.
2. **Resultados**: o Alpha Mouse Pro aparece em 1º na lista (só dados reais: ícone, nome e
   "Fera Alpha", com as letras recortadas da própria Play Store); a lista real desce uma linha.
   O mouse clica nele.
3. **Instalação** (`fonte/2-app.mp4`): o mouse clica em Instalar; Pendente… → 0–100% →
   Instalando… são simulados por cima da página real, que depois aparece com o app instalado.

A câmera (janela de 1920 px sobre a tela de 2400 px) segue o mouse, sem zoom.
Clique: a seta afunda e solta uma onda branca. Som: só cliques de mouse (aperta e solta) e teclas
de teclado mecânico, sintetizados em `sons.py`. Sem música.

```bash
cd promo/unlock/playstore
NODE_PATH=$(npm root -g) node render.cjs
```
