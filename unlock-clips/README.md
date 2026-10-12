# UNLOCK CLIPS

Ferramenta local para transformar vídeos longos (podcasts, entrevistas, debates, aulas) em cortes curtos
para TikTok, Instagram Reels e YouTube Shorts. Todo o processamento roda no seu computador, sem serviços
pagos.

- **Front-end:** React 19 + TypeScript + Tailwind CSS 4 (Vite)
- **Back-end:** Python + FastAPI, tarefas em segundo plano com progresso e cancelamento
- **Armazenamento:** arquivos locais (JSON + vídeos) em `backend/data/`
- **Vídeo:** FFmpeg e FFprobe (leitura da mídia, extração de áudio, miniaturas)
- **IA (próximas etapas):** faster-whisper com modelos locais, heurísticas explicáveis

## Situação do desenvolvimento

| Etapa | Conteúdo | Situação |
|------:|----------|----------|
| 1 | Estrutura, interface e envio de vídeos | ✅ Concluída |
| 2 | Integração com FFmpeg e extração de áudio | ✅ Concluída |
| 3 | Transcrição com timestamps (faster-whisper) | Pendente |
| 4 | Identificação e seleção de cortes | Pendente |
| 5 | Legendas e conversão para formatos verticais | Pendente |
| 6 | Editor, exportação MP4 e gerenciamento | Pendente |
| 7 | Testes, documentação e preparação para Windows | Pendente |

### O que a Etapa 1 entregou

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

### O que a Etapa 2 acrescentou

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

As configurações de corte já são salvas em cada projeto e serão usadas pelas Etapas 4 e 5. As etapas que
ainda não existem aparecem como **"em breve"** na tela do projeto — nada é simulado como concluído.

## Estrutura de pastas

```
unlock-clips/
├── README.md
├── backend/
│   ├── requirements.txt          dependências de execução
│   ├── requirements-dev.txt      + pytest
│   ├── pytest.ini
│   ├── app/
│   │   ├── __main__.py           `python -m app` inicia o servidor
│   │   ├── main.py               fábrica da aplicação FastAPI, CORS, erros, front-end compilado
│   │   ├── config.py             caminhos e variáveis de ambiente
│   │   ├── schemas.py            modelos Pydantic (projeto, tarefa, configurações)
│   │   ├── storage.py            persistência em JSON com gravação atômica
│   │   ├── jobs.py               fila de tarefas, progresso, cancelamento, subprocessos
│   │   ├── media.py              validação de arquivos de vídeo e SHA-256
│   │   ├── ffmpeg.py             FFprobe, FFmpeg com progresso/cancelamento, áudio e miniatura
│   │   ├── links.py              política de links autorizados e download
│   │   ├── services.py           regras de negócio dos projetos
│   │   └── api/                  rotas HTTP (projetos e sistema)
│   ├── tests/                    testes automatizados (pytest)
│   └── data/                     criada na execução: projetos, vídeos e settings.json (ignorada pelo git)
└── frontend/
    ├── package.json / package-lock.json
    ├── vite.config.ts            proxy /api → back-end e configuração do Vitest
    ├── index.html
    └── src/
        ├── api/                  cliente HTTP, tipos e envio com progresso
        ├── components/           layout, menu, painel de envio, formulários, progresso…
        ├── hooks/usePolling.ts   atualização periódica (rápida com tarefas ativas)
        ├── lib/                  formatação, validações e opções
        ├── pages/                Painel, Criar cortes, Projetos, Projeto, Exportados, Configurações
        └── test/                 utilitários de teste
```

Cada projeto fica em `backend/data/projects/<id>/` com `project.json`, o vídeo original (`source.<ext>`),
o áudio extraído (`audio.wav`), a miniatura (`thumbnail.jpg`) e, a partir da Etapa 6, a pasta `exports/`.

## Dependências

| Ferramenta | Versão | Observação |
|------------|--------|------------|
| Python | 3.10 ou superior (testado com 3.13) | back-end |
| Node.js | 20.19+ ou 22 LTS | front-end (exigência do Vite 7) |
| FFmpeg + FFprobe | 4.4 ou superior (testado com 6.1) | **obrigatório** a partir da Etapa 2 |

Pacotes Python: `fastapi`, `uvicorn[standard]`, `httpx` (e `pytest` para testes).
Pacotes npm: `react`, `react-dom`, `react-router-dom`, `lucide-react`; para desenvolvimento `vite`,
`typescript`, `tailwindcss`, `@tailwindcss/vite`, `vitest`, `jsdom` e Testing Library.

Nenhuma função depende de API paga.

## Instalação no Windows (PowerShell)

Instale os pré-requisitos (uma vez). Feche e reabra o PowerShell depois:

```powershell
winget install -e --id Python.Python.3.13
winget install -e --id OpenJS.NodeJS.LTS
winget install -e --id Gyan.FFmpeg
```

Confira se o FFmpeg está no PATH (em um PowerShell novo):

```powershell
ffmpeg -version
ffprobe -version
```

Se preferir não usar o PATH, baixe o FFmpeg, descompacte (por exemplo em `C:\ffmpeg`) e informe a pasta
`C:\ffmpeg\bin` em **Configurações → FFmpeg**.

Na pasta onde o repositório foi clonado:

```powershell
# Back-end
cd unlock-clips\backend
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt

# Front-end
cd ..\frontend
npm ci
```

> Os comandos chamam `.\.venv\Scripts\python.exe` diretamente para não depender de `Activate.ps1`,
> que costuma ser bloqueado pela política de execução do PowerShell.

## Executar

### Modo desenvolvimento (dois terminais)

Terminal 1 — back-end em http://127.0.0.1:8000:

```powershell
cd unlock-clips\backend
.\.venv\Scripts\python.exe -m app --reload
```

Terminal 2 — front-end em http://localhost:5173 (encaminha `/api` para o back-end):

```powershell
cd unlock-clips\frontend
npm run dev
```

Abra **http://localhost:5173** no navegador.

### Modo aplicação (um único servidor)

```powershell
cd unlock-clips\frontend
npm run build
cd ..\backend
.\.venv\Scripts\python.exe -m app
```

Abra **http://127.0.0.1:8000**. O back-end serve a interface compilada de `frontend\dist`.

## Testes

```powershell
cd unlock-clips\backend
.\.venv\Scripts\python.exe -m pytest

cd ..\frontend
npm test              # testes da interface (Vitest)
npm run typecheck     # verificação de tipos TypeScript
npm run build         # compilação de produção
```

Os testes do back-end geram pequenos vídeos reais com o FFmpeg para testar leitura da mídia, extração de
áudio, miniaturas e cancelamento do processo. Se o FFmpeg não estiver no PATH, esses testes são pulados
(e aparecem como `skipped` no resultado).

## Primeiro uso

1. Abra o **Painel** (ou **Criar cortes**, para escolher as configurações do projeto).
2. Arraste um vídeo ou clique em **Escolher arquivo**, informe um título opcional e clique em **Analisar vídeo**.
3. Acompanhe o envio; em seguida, a página do projeto mostra o processamento em segundo plano
   (verificação → leitura da mídia → extração de áudio) com a porcentagem real. Use **Cancelar** para
   interromper a tarefa.
4. Quando o status ficar **Pronto**, confira as informações da mídia e ouça o áudio extraído. As
   configurações dos cortes podem ser ajustadas e salvas.

Para importar por link: em **Configurações → Links autorizados**, cadastre os domínios das fontes que você
tem direito de usar (por exemplo, o armazenamento do seu site). Depois, na aba **Usar link**, informe o
link **direto** do arquivo de vídeo e confirme a autorização.

> A geração dos cortes propriamente dita (transcrição, seleção, legendas e exportação) será adicionada
> nas Etapas 3 a 6.

## Variáveis de ambiente (opcionais)

| Variável | Padrão | Uso |
|----------|--------|-----|
| `UNLOCK_DATA_DIR` | `backend\data` | onde ficam projetos, vídeos e configurações |
| `UNLOCK_FRONTEND_DIST` | `frontend\dist` | interface compilada servida pelo back-end |
| `UNLOCK_CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | origens liberadas no CORS |
| `UNLOCK_MAX_WORKERS` | `2` | tarefas simultâneas em segundo plano |

Exemplo no PowerShell: `$env:UNLOCK_DATA_DIR = "D:\UnlockClips\dados"` antes de iniciar o back-end.

## API (resumo)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/health` | versão, pasta de dados, caminhos e versão do FFmpeg/FFprobe |
| GET | `/api/stats` | totais do painel |
| GET/PUT | `/api/settings` | configurações globais |
| GET | `/api/projects` | lista de projetos |
| POST | `/api/projects/upload?filename=…&title=…&settings=…` | envio do vídeo como corpo bruto |
| POST | `/api/projects/from-link` | importação de link autorizado |
| GET/PATCH/DELETE | `/api/projects/{id}` | consultar, editar título/configurações, excluir |
| POST | `/api/projects/{id}/cancel` | cancelar a tarefa em andamento |
| POST | `/api/projects/{id}/retry` | tentar novamente após erro/cancelamento/interrupção, ou extrair o áudio de projetos da Etapa 1 |
| GET | `/api/projects/{id}/source` | vídeo original (com suporte a `Range`) |
| GET | `/api/projects/{id}/audio` | áudio extraído (WAV mono 16 kHz, com suporte a `Range`) |
| GET | `/api/projects/{id}/thumbnail` | miniatura JPEG |
| GET | `/api/exports` | vídeos exportados |

Documentação interativa: http://127.0.0.1:8000/docs

## Uso responsável

Use apenas conteúdos que você produziu ou que tem autorização para editar e publicar. A importação por
link aceita somente arquivos diretos de domínios cadastrados por você e não implementa nenhum mecanismo
para contornar DRM, autenticação ou restrições de acesso de plataformas.
