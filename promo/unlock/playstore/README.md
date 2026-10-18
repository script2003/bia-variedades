# Alpha Mouse Pro — "como baixar na Play Store" (9:16)

16 s, 1080 × 1920, 30 fps. Arquivo final: `output/alpha-mouse-pro-playstore.mp4`.

| Tempo | O que aparece |
|---|---|
| 0–1,6 s | Abertura: ícone + "Como baixar o Alpha Mouse Pro pela Play Store" |
| 1,6 s | **1 · Abra a Play Store**: tela inicial, toque em "Pesquisa" e na barra de busca |
| 3,9 s | **2 · Pesquise "Alpha Mouse Pro"**: zoom na busca enquanto o nome é digitado |
| 7,9 s | Abre a página do Alpha Mouse Pro |
| 8,4 s | **3 · Toque em Instalar**: botão Instalar → Pendente… → 0–100% → Instalando… |
| 12,5 s | **Pronto! App instalado**: a página real com "Desinstalar / Abrir" |
| 14,3 s | Encerramento: "Baixe agora na Play Store (acesso antecipado)" |

## O que é gravação real e o que é simulado

- **Real** (`fonte/`): a tela inicial da Play Store, a busca e a digitação de "alpha mouse pro",
  e a página do app já instalado.
- **Simulado**: o momento da instalação. A gravação 2 começa com o app já instalado, então o
  botão "Instalar", o anel de progresso e os textos "Pendente… / % / Instalando…" são desenhados
  por cima da página real. O texto "Instalar" usa as letras do próprio botão "Desinstalar" da
  gravação, para ficar com a mesma fonte.
- O vídeo passa da busca direto para a página do app, porque o Alpha Mouse Pro (acesso antecipado)
  não aparece na lista de resultados da gravação.

## Editar e gerar de novo

Textos em `textos.js`. Prévia: abrir `index.html` no navegador (`?t=9.5` congela num instante).

```bash
cd promo/unlock/playstore
NODE_PATH=$(npm root -g) node render.cjs
```
