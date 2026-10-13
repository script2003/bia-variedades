# Histórico das etapas

O que cada etapa do desenvolvimento entregou.

## O que a Etapa 1 entregou

- Interface escura em português com menu: Painel, Criar cortes, Meus projetos, Vídeos exportados e Configurações.
- **Envio de vídeo** (arrastar e soltar ou escolher arquivo) com barra de progresso real e botão para cancelar.
  O arquivo é enviado e gravado em disco em blocos — nunca é carregado inteiro na memória.
- **Validação** da extensão (`.mp4 .m4v .mov .mkv .webm .avi`), do tamanho máximo e da assinatura binária do
  contêiner (um arquivo renomeado para `.mp4` que não é vídeo é recusado).
- **Verificação em segundo plano**: releitura do arquivo com cálculo de SHA-256, progresso real, cancelamento
  e aviso de vídeos duplicados.
- **Importação por link** restrita a domínios que você autoriza em Configurações, com confirmação de direitos
  de uso. Cada redirecionamento é revalidado. Páginas HTML, playlists de streaming (HLS/DASH) e conteúdo
  com DRM são recusados — a ferramenta não contorna proteções de nenhum tipo.
- **Projetos persistentes**: ficam salvos em disco e continuam disponíveis depois de fechar a aplicação.
  Tarefas interrompidas por um encerramento aparecem como "Interrompido" com o botão **Tentar novamente**.
- Página do projeto com player (com suporte a busca no vídeo via requisições `Range`), título editável,
  configurações de corte editáveis, detalhes do arquivo e etapas do fluxo.
- Configurações persistentes: padrões dos cortes (duração 15–30/30–60/60–90 s, formato 9:16/1:1/16:9,
  idioma, estilo, tamanho e posição das legendas, destaque da palavra, enquadramento central/rosto,
  quantidade máxima de cortes), domínios autorizados e tamanho máximo do arquivo.

## O que a Etapa 2 acrescentou

- **Processamento automático** após o envio (ou o download do link), em uma única tarefa em segundo plano:
  1. verificação do arquivo (assinatura + SHA-256);
  2. **leitura da mídia com FFprobe**: duração, resolução, orientação (inclusive rotação de vídeos de
     celular), fps, codecs, taxa de bits e trilhas de áudio (idioma e trilha padrão);
  3. **miniatura** JPEG exibida na lista de projetos e como capa do player;
  4. **extração do áudio com FFmpeg** para `audio.wav` — PCM 16 bits, mono, 16 kHz, o formato usado pelo
     faster-whisper na Etapa 3. Quando há várias trilhas, é usada a trilha marcada como padrão.
- **Progresso real** da extração, calculado a partir do tempo já processado pelo FFmpeg (`-progress`).
- **Cancelamento imediato**: o processo do FFmpeg é encerrado e o arquivo parcial é apagado.
- **Erros claros**: FFmpeg ausente (com o comando de instalação), arquivo ilegível, vídeo sem trilha de áudio
  ou sem trilha de vídeo. Depois de corrigir o problema, use **Tentar novamente**.
- **Pasta do FFmpeg configurável** em Configurações (para quem não quer mexer no PATH), com diagnóstico da
  versão e dos caminhos encontrados.
- Página do projeto com as informações da mídia e um **player do áudio extraído**.
- Projetos criados na Etapa 1 continuam funcionando: eles mostram o botão **Extrair áudio**.

> Espaço em disco: o WAV ocupa cerca de **115 MB por hora** de vídeo (é removido junto com o projeto).

## O que a Etapa 3 acrescentou

- **Transcrição local com faster-whisper**, iniciada automaticamente depois da extração do áudio (pode ser
  desligada) ou pelo botão **Transcrever agora** / **Transcrever novamente**.
- **Timestamps por trecho e por palavra**, salvos em `transcript.json` — base para a detecção de cortes
  (Etapa 4) e para as legendas com destaque da palavra atual (Etapa 5).
- O idioma usado é o **idioma das legendas** do projeto (ex.: `pt-BR` → português).
- **Vídeos longos sem estourar a memória**: o áudio é lido do disco em blocos de ~10 minutos, cortados no
  trecho mais silencioso perto do limite (para não partir palavras), e o fim de cada bloco é passado como
  contexto ao próximo.
- **Progresso real** (minutos já transcritos / duração) e **cancelamento** verificado a cada trecho.
  Se a transcrição falhar ou for cancelada, **Tentar novamente** refaz só a transcrição.
- **Filtro de voz (VAD)** opcional, que ignora trechos sem fala, acelera o processo e evita textos inventados
  no silêncio. Os tempos continuam alinhados ao vídeo original.
- **Modelos**: tiny, base, small (padrão, recomendado para CPU), medium, large-v3-turbo e large-v3. O modelo
  é baixado uma única vez para `backend\data\models` e depois funciona offline; também é possível apontar
  uma pasta com um modelo baixado manualmente.
- **CPU ou GPU NVIDIA (CUDA)**, precisão numérica e *beam size* configuráveis.
- Painel de transcrição no projeto: busca (ignora acentos), clique no trecho para pular o vídeo até ele,
  destaque do trecho que está sendo falado e download em **SRT**, **VTT** e **TXT**.

Tempo de processamento (estimativa para CPU moderna, modelo *small*, int8): aproximadamente de 0,3× a 1× a
duração do áudio. Modelos maiores são mais precisos e mais lentos; com GPU NVIDIA ficam muitas vezes mais rápidos.

## O que a Etapa 4 acrescentou

- **Sugestão automática de cortes** depois da transcrição (pode ser desligada) ou pelo botão
  **Sugerir cortes** / **Gerar novamente**, respeitando a **duração** (15–30, 30–60 ou 60–90 s) e a
  **quantidade máxima** definidas no projeto.
- Como funciona:
  1. as palavras com tempo viram **frases** (pontuação, pausas e limites de segmento do Whisper);
  2. **mudanças de assunto** são detectadas pela queda de semelhança de vocabulário entre trechos e por
     expressões como "mudando de assunto";
  3. todo trecho que começa e termina em frase e cabe na duração escolhida é avaliado (um vídeo de 80 min
     é analisado em cerca de 1 s);
  4. os melhores são escolhidos sem sobreposição relevante e sem repetir a frase de abertura; trechos com
     pontuação muito baixa em relação ao melhor do vídeo não são sugeridos (uma nota informa quantos).
- **Pontuação heurística explicável (0–100)**, somando critérios com pesos ajustáveis em Configurações:

  | Critério | O que observa |
  |----------|---------------|
  | Gancho inicial | pergunta, frase forte, número, história ou fala direta ao público nos primeiros segundos |
  | Frases de impacto | expressões fortes e superlativos ("o maior erro", "ninguém fala", "nunca"…) |
  | Opinião e debate | "na minha opinião", "eu discordo", contrastes ("mas", "por outro lado") |
  | Pergunta e resposta | começa com pergunta e traz a resposta dentro do corte |
  | História completa | marcas de início ("uma vez"), desenvolvimento ("então", "decidi") e conclusão ("no final", "aprendi") |
  | Clareza da fala | confiança da transcrição, ritmo, vícios de linguagem ("né", "tipo") e pausas longas |
  | Contexto completo | frases inteiras, sem começar com "mas"/"e"/"isso", sem terminar em pergunta sem resposta e sem atravessar mudança de assunto |
  | Ênfase na voz | volume da fala acima da média do próprio vídeo |
  | Duração | proximidade do meio da faixa escolhida |

  Cada corte mostra os **motivos** (✓), os **avisos** (⚠) e, em "Por que esta pontuação?", a contribuição
  de cada critério. **A pontuação compara trechos do mesmo vídeo; ela não prevê visualizações.**
- **Ajuste manual**: pré-visualizar (o vídeo toca só o trecho e pausa no fim), aprovar, descartar, restaurar,
  editar título, ajustar início e fim (±0,5 s ou "usar tempo atual do vídeo"; os limites são ajustados para
  não cortar palavras e a pontuação é recalculada), adicionar corte manual e excluir.
- **Gerar novamente** mantém cortes aprovados, descartados, ajustados e manuais; descartados não voltam a ser
  sugeridos.
- Expressões em **português**, **inglês** e **espanhol** (outros idiomas usam a lista em português e recebem
  um aviso).

> Refinamento por IA generativa (LLM) não foi incluído para manter tudo gratuito e local. A arquitetura
> permite acrescentá-lo como etapa opcional (ver "Próximos passos").

## O que a Etapa 5 acrescentou

- **Geração do vídeo final** de cada corte (botão **Gerar vídeo**) ou de todos os aprovados de uma vez, em
  segundo plano, com progresso real e cancelamento. Um único comando FFmpeg corta o trecho, enquadra, redimensiona,
  incorpora as legendas e codifica em **MP4 H.264 + AAC** (compatível com TikTok, Reels e Shorts):
  - **9:16** → 1080×1920 · **1:1** → 1080×1080 · **16:9** → 1920×1080.
- **Legendas sincronizadas** a partir dos tempos de cada palavra:
  - blocos de no máximo **2 linhas** que cabem na largura útil, divididos de forma equilibrada (sem palavras
    soltas), encerrados no fim de frases, em pausas e após ~4 s;
  - **destaque da palavra falada** (opcional), com cor própria e leve aumento;
  - **4 modelos**: Destaque (caixa-alta, contorno grosso, verde-limão), Clássico, Caixa (faixa escura) e
    Minimalista; tamanho e posição (inferior, centro, superior) configuráveis — no 9:16, "inferior" fica a 20% da
    borda para não ficar sob os botões das redes sociais;
  - em português (ou no idioma do projeto) e **embutidas no vídeo** (libass).
- **Enquadramento**:
  - **Central**: recorte fixo no centro;
  - **Acompanhar rosto**: detecção com o modelo **YuNet** (OpenCV, incluído em `app/assets`, funciona offline),
    2 amostras por segundo, filtro contra detecções isoladas e "câmera virtual" com zona morta — só se move quando
    o rosto sai do centro, sem tremer. Sem rosto na maior parte do trecho, usa o enquadramento central e avisa.
- **Prévia no formato** (antes de gerar): no navegador, com o mesmo recorte (inclusive o acompanhamento do rosto) e
  a legenda sincronizada; e a aba **Quadro final (exato)**, que gera com o FFmpeg a imagem idêntica à do vídeo final.
- Cada corte mostra **Vídeo pronto** / **Vídeo desatualizado** (quando o corte ou a configuração mudou depois da
  geração), **Assistir** e **Baixar MP4**. Os arquivos também aparecem em **Vídeos exportados**.

> O detector de rostos YuNet é distribuído sob licença MIT (`app/assets/face_detection_yunet_LICENSE.txt`).

## O que a Etapa 6 acrescentou

- **Editor de cada corte** (botão **Abrir no editor** no painel de cortes; endereço `/projetos/<id>/cortes/<corte>`):
  - **pré-visualização** ao vivo no formato final (recorte + legenda), **quadro exato** gerado pelo FFmpeg e o
    **vídeo gerado**;
  - **título** editável, **aprovar / descartar** e navegação para o corte anterior/próximo;
  - **início e fim** com ajuste fino (±0,5 s) e "usar tempo atual" — a pontuação e as legendas são recalculadas;
  - **legendas editáveis**: corrigir o texto de cada bloco, ocultar blocos, ajustar os tempos (validados: dentro
    do corte e sem sobreposição), ouvir o trecho de cada bloco, voltar às legendas automáticas e baixar o `.srt`.
    A prévia reage enquanto você digita; o vídeo usa o texto editado com o modelo de legenda do projeto (caixa-alta,
    cores, destaque da palavra, quebra em até 2 linhas). Se o número de palavras do bloco não mudar, o destaque
    segue o tempo real de cada palavra; se mudar, o tempo é distribuído pelo tamanho das palavras;
  - **ajuste de enquadramento** por corte: padrão do projeto, central, acompanhar rosto ou **posição fixa (manual)**
    com posição horizontal, vertical e **zoom até 3×**, visto na hora na prévia (aviso quando o zoom deixa a imagem
    desfocada);
  - **Exportar MP4** / **Gerar novamente** (salva antes as alterações pendentes) com progresso real e cancelamento,
    e **Baixar MP4**. O vídeo fica "desatualizado" sempre que o trecho, as legendas, o enquadramento ou a
    configuração mudam depois da geração.
- As edições ficam salvas no projeto (`clips.json`) e são mantidas ao **gerar novas sugestões** (cortes curados) e ao
  mudar o trecho (blocos editados fora do novo trecho são descartados; trechos novos recebem legendas automáticas).
- **Vídeos exportados**: busca, filtro por projeto, formato, duração, aviso de desatualizado, **assistir** no
  navegador, **baixar**, **abrir no editor**, **excluir** um vídeo ou todos de um projeto (os cortes continuam salvos
  e podem ser exportados de novo) e a pasta onde os arquivos ficam no computador.
- **Meus projetos**: espaço em disco de cada projeto e total, ordenação (recentes, antigos, nome, espaço),
  contagem de cortes/aprovados/vídeos e exclusão direto na lista. Na página do projeto, o quadro **Espaço em disco**
  detalha vídeo original, áudio, vídeos exportados e permite excluir os vídeos exportados para liberar espaço.
- Todas as etapas do fluxo agora são reais na tela do projeto, inclusive **Revisão e edição** e **Legendas, formato
  e MP4** — nada é simulado como concluído.

## O que a Etapa 7 acrescentou

- **Preparação para o Windows**:
  - `Instalar UNLOCK CLIPS.bat` / `scripts\instalar.ps1`: verifica (e, com `-InstalarDependencias`, instala pelo
    winget) Python, Node.js e FFmpeg, cria o ambiente do back-end, instala os pacotes, compila a interface e cria
    um atalho na Área de Trabalho;
  - `Iniciar UNLOCK CLIPS.bat` / `scripts\iniciar.ps1`: inicia o servidor e abre o navegador;
  - `scripts\testar.ps1` (todos os testes) e `scripts\desenvolver.ps1` (modo desenvolvimento);
  - `python -m app --abrir`, detecção de porta ocupada (e de uma instância já aberta), verificação da versão do
    Python, log rotativo em `data\logs\unlock-clips.log`;
  - aviso de pouco espaço em disco no Painel e recusa clara antes de enviar ou gerar vídeos sem espaço;
  - mensagem clara quando o MP4 está aberto em outro programa (o Windows bloqueia a substituição);
  - nomes de arquivo reservados do Windows (`CON`, `NUL`, `COM1`…) tratados.
- **Testes**: fluxo completo pela API (envio → MP4 → reabertura → exclusão), testes da preparação para Windows,
  cobertura medida (`pytest --cov`, `npm run test:coverage`), `scripts/teste_completo.py` (ponta a ponta com o
  servidor rodando) e **integração contínua no GitHub Actions** em Windows e Linux, incluindo instalação pelos
  scripts e o fluxo completo no Windows com transcrição por modelo Whisper real.
- Correção encontrada pelos novos testes: o botão **Cancelar** de uma tarefa não enviava o pedido quando o
  componente era usado sem a função de atualização (caso que ainda não ocorria nas telas atuais).
- Documentação reorganizada: guia de uso (README), arquitetura e API (`docs/ARQUITETURA.md`) e este histórico.
