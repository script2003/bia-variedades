# Arquitetura e API

## Visão geral

```
Navegador (React)  ──HTTP /api──▶  FastAPI (Python)  ──▶  Tarefas em segundo plano (ThreadPool)
                                        │                     ├─ verificação (SHA-256) e FFprobe
                                        │                     ├─ FFmpeg: áudio WAV 16 kHz, miniatura
                                        │                     ├─ faster-whisper (transcrição local)
                                        │                     ├─ detecção de cortes (regras explicáveis)
                                        │                     └─ FFmpeg: recorte + legendas ASS + MP4
                                        ▼
                         backend/data/  (JSON + arquivos de mídia, gravação atômica)
```

- **Um projeto = uma pasta** em `data/projects/<id>/` com `project.json` (estado, configurações, resumo de cada
  etapa e a tarefa atual), o vídeo original, `audio.wav`, `thumbnail.jpg`, `transcript.json`, `clips.json` (cortes,
  pontuação, edições) e `exports/` com os MP4.
- **Tarefas**: cada etapa longa roda em segundo plano com progresso real, cancelamento (o processo do FFmpeg é
  encerrado) e encadeamento automático (processamento → transcrição → sugestão de cortes). Se a aplicação for
  fechada no meio, a tarefa aparece como *Interrompida* e **Tentar novamente** retoma só a etapa que faltou.
- **Interface**: React + TypeScript; consulta o projeto a cada segundo enquanto há tarefa ativa. A prévia "ao vivo"
  reproduz o recorte e a legenda no navegador com as mesmas medidas do FFmpeg; a aba "Quadro final" pede ao
  servidor a imagem exata.
- **Sem serviços pagos**: transcrição, detecção de rostos (YuNet, incluído) e análise rodam no computador.

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
│   │   ├── transcription.py      faster-whisper: blocos, progresso, modelos, SRT/VTT/TXT
│   │   ├── clips.py              detecção e pontuação explicável dos cortes
│   │   ├── clip_lexicon.py       expressões usadas pelos critérios (pt, en, es)
│   │   ├── subtitles.py          blocos de legenda, modelos visuais e arquivo ASS
│   │   ├── framing.py            recorte 9:16/1:1/16:9 e acompanhamento de rosto (YuNet)
│   │   ├── render.py             geração do MP4 final e do quadro de prévia
│   │   ├── assets/               modelo de detecção de rostos (YuNet, MIT)
│   │   ├── links.py              política de links autorizados e download
│   │   ├── services.py           regras de negócio dos projetos (inclui edição, exportados e espaço em disco)
│   │   └── api/                  rotas HTTP (projetos e sistema)
│   ├── tests/                    testes automatizados (pytest); tiny_whisper.py gera um modelo de teste
│   └── data/                     criada na execução: projetos, modelos e settings.json (ignorada pelo git)
└── frontend/
    ├── package.json / package-lock.json
    ├── vite.config.ts            proxy /api → back-end e configuração do Vitest
    ├── index.html
    └── src/
        ├── api/                  cliente HTTP, tipos e envio com progresso
        ├── components/           layout, menu, painel de envio, formulários, progresso, prévia (LivePlayer)…
        │   └── editor/           edição de legendas e de enquadramento
        ├── hooks/usePolling.ts   atualização periódica (rápida com tarefas ativas)
        ├── lib/                  formatação, validações, opções, cálculo do recorte e das legendas da prévia
        ├── pages/                Painel, Criar cortes, Projetos, Projeto, Editor do corte, Exportados, Configurações
        └── test/                 utilitários de teste
```

Cada projeto fica em `backend/data/projects/<id>/` com `project.json`, o vídeo original (`source.<ext>`),
o áudio extraído (`audio.wav`), a miniatura (`thumbnail.jpg`), a transcrição (`transcript.json`), os cortes
(`clips.json`) e a pasta `exports/` com os MP4 gerados. Os modelos de transcrição ficam em `backend/data/models/<modelo>/`.

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
| GET | `/api/health` | versão, pasta de dados, FFmpeg/FFprobe e disponibilidade da transcrição |
| GET | `/api/stats` | totais do painel |
| GET/PUT | `/api/settings` | configurações globais |
| GET | `/api/projects` | lista de projetos |
| POST | `/api/projects/upload?filename=…&title=…&settings=…` | envio do vídeo como corpo bruto |
| POST | `/api/projects/from-link` | importação de link autorizado |
| GET/PATCH/DELETE | `/api/projects/{id}` | consultar, editar título/configurações, excluir |
| POST | `/api/projects/{id}/cancel` | cancelar a tarefa em andamento |
| POST | `/api/projects/{id}/retry` | tentar novamente após erro/cancelamento/interrupção (refaz só a etapa que falhou), ou extrair o áudio de projetos da Etapa 1 |
| POST | `/api/projects/{id}/transcribe` | iniciar ou refazer a transcrição |
| GET | `/api/projects/{id}/transcript` | transcrição completa (trechos e palavras com tempos) |
| GET | `/api/projects/{id}/transcript.srt` · `.vtt` · `.txt` | download da transcrição |
| GET | `/api/transcription/models` | modelos disponíveis e quais já foram baixados |
| POST | `/api/projects/{id}/clips/detect` | gerar ou refazer sugestões (`{"keep_curated": true}` mantém os curados) |
| GET | `/api/projects/{id}/clips` | cortes com pontuação, critérios, motivos e avisos |
| POST | `/api/projects/{id}/clips` | criar corte manual (`start`, `end`, `title`) |
| PATCH/DELETE | `/api/projects/{id}/clips/{clip_id}` | editar título, status, início/fim (recalcula), enquadramento (`framing_override`; `null` = padrão do projeto) ou excluir |
| GET | `/api/clip-scoring/criteria` | critérios da pontuação, descrições e pesos padrão |
| POST | `/api/projects/{id}/clips/render` | gerar MP4 (`{"clip_ids": [...]}`; vazio = todos os aprovados) |
| GET | `/api/projects/{id}/clips/{clip_id}/subtitles` | blocos de legenda do corte (prévia e editor) |
| PUT/DELETE | `/api/projects/{id}/clips/{clip_id}/subtitles` | salvar legendas editadas (`{"cues": [{start, end, text, hidden}]}`) / voltar às automáticas |
| GET | `/api/projects/{id}/clips/{clip_id}/subtitles.srt` | legendas do corte em SRT (com as edições) |
| GET | `/api/projects/{id}/clips/{clip_id}/framing` | enquadramento calculado (central, manual ou por rosto) |
| GET | `/api/projects/{id}/clips/{clip_id}/frame.jpg?t=` | quadro exato do vídeo final em `t` segundos do corte |
| GET | `/api/subtitle-templates` | modelos de legenda |
| GET | `/api/projects/{id}/source` | vídeo original (com suporte a `Range`) |
| GET | `/api/projects/{id}/audio` | áudio extraído (WAV mono 16 kHz, com suporte a `Range`) |
| GET | `/api/projects/{id}/thumbnail` | miniatura JPEG |
| GET | `/api/exports` | vídeos exportados (todos os projetos) |
| GET/DELETE | `/api/projects/{id}/exports` | vídeos exportados do projeto / excluir todos |
| GET/DELETE | `/api/projects/{id}/exports/{arquivo}` | baixar (`?download=false` exibe no navegador) / excluir um vídeo |
| GET | `/api/projects/{id}/storage` · `/api/storage` | espaço em disco por projeto |

Documentação interativa: http://127.0.0.1:8000/docs
