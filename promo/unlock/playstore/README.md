# Alpha Mouse Pro — Play Store (9:16)

19 s, 1080 × 1920, 30 fps. Arquivo final: `output/alpha-mouse-pro-playstore.mp4`.

1. **Play Store** (`fonte/1-pesquisa.mp4`, velocidade real): um mouse entra (o primeiro quadro fica
   parado 0,9 s para isso), clica em Pesquisa e na barra de busca. O teclado da tela fica escondido:
   aparece só o texto "alpha mouse pro" sendo digitado (com som de tecla em cada letra) e as
   sugestões. O mouse clica na 1ª sugestão para pesquisar.
2. **Resultados**: o Alpha Mouse Pro aparece em 1º na lista (só dados reais: ícone, nome e
   "Fera Alpha", com as letras recortadas da própria Play Store); a lista real desce uma linha.
   O mouse clica nele.
3. **Instalação** (`fonte/2-app.mp4`): o mouse clica em Instalar; Pendente… → 0–100% →
   Instalando… são simulados por cima da página real, que depois aparece com o app instalado.

A câmera (janela de 1920 px sobre a tela de 2400 px) segue o mouse, sem zoom.
Clique: a seta afunda e solta uma onda branca. Som (sem música): sintetizado em `sons.py`, modelado
na referência de efeitos enviada (sem usar o áudio dela). O clique é um "toc" tonal de toque em
tela, com batida em ~500 Hz e, 50 ms depois, uma batida grave em ~177 Hz. A digitação é um clique
fino de teclado de notebook (1–3 kHz e ~7,5 kHz).

```bash
cd promo/unlock/playstore
NODE_PATH=$(npm root -g) node render.cjs
```
