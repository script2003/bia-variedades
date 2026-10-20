# A evolução da tecnologia dentro de casa

Exposição digital interativa em 3D, feita com [Three.js](https://threejs.org/), que coloca lado a lado
seis eletrodomésticos modelados em geometria tridimensional real:

| Área | Antigo (à esquerda) | Atual (à direita) |
| --- | --- | --- |
| 1 · Fogões | Fogão a gás esmaltado, anos 1940–1960 | Fogão inox de 5 bocas com mesa de vidro |
| 2 · Geladeiras | Geladeira de porta única, anos 1950 | Geladeira French Door Frost Free |
| 3 · Televisões | Televisor de tubo (CRT) em cores, anos 1970–1980 | Smart TV LED de 55″ 4K |

Todos os modelos são construídos por código (sem imagens prontas): malhas, materiais PBR
(esmalte, cromado, inox escovado, vidro, madeira) e texturas procedurais desenhadas em canvas.

## O que dá para fazer

- Girar, aproximar e mover a câmera com mouse ou toque (arrastar, roda/pinça, botão direito/dois dedos).
- Clicar ou tocar em um aparelho para selecioná-lo e ver ficha técnica e destaques.
- Ver a comparação antigo × atual de cada área (materiais, design, tamanho, controles, tecnologia).
- Abrir as portas dos fornos e das geladeiras e a gaveta do freezer; fechar a tampa de vidro do fogão.
- Ligar as TVs, ver o tubo de imagem da TV antiga e separar as camadas da tela da TV moderna.
- Redefinir a câmera, ativar o giro automático e usar links diretos (`#fogoes`, `#tv-antiga` etc.).
- Baixar qualquer modelo em **GLB** no estado atual (botão “Baixar modelo 3D”).

Os seis GLB também estão prontos em [`public/models/`](public/models) (validados com o
glTF Validator do Khronos, sem erros).

## Rodar localmente

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # gera dist/ (publicado pelo Netlify)
```

Para regenerar os GLB depois de alterar um modelo:

```bash
npm run build && npx vite preview --port 4173   # em um terminal
npx -p playwright node scripts/export-glb.mjs    # em outro
```

## Estrutura

```
index.html                 página da exposição
src/exhibit/main.js        cena, iluminação, câmera, seleção, exportação GLB
src/exhibit/ui.js          painel, navegação e comandos
src/exhibit/data.js        textos em português
src/exhibit/models/        os seis modelos (um arquivo por aparelho)
src/exhibit/lib/           geometria, materiais e texturas procedurais
public/models/             modelos exportados em GLB
loja.html, src/loja/       página anterior da loja BIA VARIEDADES
```
