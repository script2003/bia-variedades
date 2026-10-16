# Unlock — vídeo promocional (TikTok 9:16)

Vídeo de 20 s em 1080 × 1920, 30 fps, com motion graphics em preto, branco e roxo.

## Arquivos prontos

| Arquivo | Uso |
|---|---|
| `output/unlock-promo-com-textos.mp4` | Versão final com os textos promocionais |
| `output/unlock-promo-sem-textos.mp4` | Mesma animação **sem nenhum texto**: escreva os seus textos depois no CapCut ou no próprio TikTok |

## Roteiro

| Tempo | Cena | O que acontece |
|---|---|---|
| 0–3 s | Abertura | Linha de luz roxa → icosaedro 3D que gira e atravessa a câmera → título |
| 3–7 s | Produtos | Os 3 produtos como cartões flutuantes em 3D, a câmera passa por cada um e recua |
| 7–11 s | Destaque | SS Keymouse Pro no centro, com halo, partículas, linhas geométricas e zoom nos detalhes |
| 11–15 s | Comunidade | Transição hexagonal → captura do Discord em painel 3D, com destaque no nome e no número de membros |
| 15–20 s | Encerramento | Transição triangular → ícone + produto → frase final no impacto (16 s) → marca (18 s) → fade para preto |

As imagens dos produtos e a captura do Discord aparecem **sem alteração** (só recorte e
moldura com luz). A trilha (`trilha.py`) é original, sintetizada por código, e não tem
direitos de terceiros.

## Como editar os textos

1. Abra `textos.js` e troque as frases (use `\n` para quebrar linha; `""` esconde o texto).
2. Para ver o resultado, abra `index.html` no navegador. A barra de espaço pausa a prévia, e `index.html?t=16.5` congela o vídeo em 16,5 s.
3. Para gerar os MP4 de novo (requer Node + Playwright, ffmpeg e Python com numpy):

```bash
cd promo/unlock
NODE_PATH=$(npm root -g) node render.cjs            # gera as duas versões
NODE_PATH=$(npm root -g) node render.cjs --so-com   # gera só a versão com textos
```

Para trocar o produto em destaque, troque a imagem de `#c1` em `index.html`.
