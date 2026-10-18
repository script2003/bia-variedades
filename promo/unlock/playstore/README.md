# Alpha Mouse Pro — Play Store (9:16)

21,6 s, 1080 × 1920, 30 fps, sem som. Arquivo final: `output/alpha-mouse-pro-playstore.mp4`.

Só as gravações enviadas, na velocidade real e sem zoom:

1. **Play Store** (`fonte/1-pesquisa.mp4`): tela inicial, toque em Pesquisa, digitação de
   "alpha mouse pro" e a lista de resultados.
2. **Instalação**: na página do Alpha Mouse Pro (`fonte/2-app.mp4`), o botão Instalar →
   Pendente… → 0–100% → Instalando… é **simulado** por cima da página real, porque a gravação
   começa com o app já instalado. O texto "Instalar" usa as letras do próprio botão da Play Store.
3. A página real com o app instalado (Desinstalar / Abrir).

As gravações (1080 × 2400) são mais altas que 9:16, então o quadro de 1920 px sobe e desce
seguindo onde a ação está (botão Pesquisa embaixo, barra de busca em cima, teclado, tecla de
pesquisar, resultados). Os pontos da câmera ficam em `CAM_A` no `index.html`.

```bash
cd promo/unlock/playstore
NODE_PATH=$(npm root -g) node render.cjs
```
