# UNLOCK CLIPS

Ferramenta local para transformar vídeos longos (podcasts, entrevistas, debates, aulas) em cortes curtos
para **TikTok, Instagram Reels e YouTube Shorts**. Tudo roda no seu computador, sem serviços pagos.

**O que ela faz**

1. Recebe o vídeo (arquivo ou link direto de uma fonte que você autorizou) e verifica o arquivo.
2. Extrai o áudio com o FFmpeg e **transcreve** com o faster-whisper (modelos locais), com o tempo de cada palavra.
3. **Sugere os melhores trechos** com uma pontuação heurística explicável (gancho, pergunta e resposta, história,
   opinião, clareza…) — a pontuação compara trechos do mesmo vídeo e **não prevê visualizações**.
4. No **editor** você ajusta título, início e fim, **legendas** (texto, tempos, ocultar) e **enquadramento**
   (central, acompanhando o rosto ou posição fixa com zoom), com prévia no formato final.
5. **Exporta MP4** (H.264 + AAC) em 9:16, 1:1 ou 16:9 com as legendas incorporadas e a palavra falada em destaque.

Tecnologias: React 19 + TypeScript + Tailwind CSS (interface) · Python + FastAPI (servidor e tarefas em segundo
plano) · FFmpeg · faster-whisper · OpenCV/YuNet (rostos) · armazenamento em arquivos locais.

| Etapa | Conteúdo | Situação |
|------:|----------|----------|
| 1 | Estrutura, interface e envio de vídeos | ✅ |
| 2 | Integração com FFmpeg e extração de áudio | ✅ |
| 3 | Transcrição com timestamps (faster-whisper) | ✅ |
| 4 | Identificação e seleção de cortes | ✅ |
| 5 | Legendas e conversão para formatos verticais | ✅ |
| 6 | Editor, exportação MP4 e gerenciamento | ✅ |
| 7 | Testes, documentação e preparação para Windows | ✅ |

Detalhes de cada etapa: [docs/HISTORICO.md](docs/HISTORICO.md) · Arquitetura, pastas e API:
[docs/ARQUITETURA.md](docs/ARQUITETURA.md)

---

## 1. Requisitos

| Item | Mínimo | Recomendado |
|------|--------|-------------|
| Sistema | Windows 10 ou 11, 64 bits | — (também funciona em Linux e macOS) |
| Memória | 8 GB | 16 GB para vídeos longos e modelos maiores |
| Disco | 5 GB livres | 20 GB+ (vídeo original, áudio ≈115 MB/hora, MP4 gerados, modelos) |
| Python | 3.10 a 3.13 | **3.12** |
| Node.js | 20.19 | **22 LTS** |
| FFmpeg | 4.4 com libx264 e libass | versão do `winget install Gyan.FFmpeg` |
| GPU | opcional | NVIDIA com CUDA 12 acelera a transcrição |

Internet só é necessária para instalar e, na primeira transcrição, baixar o modelo Whisper escolhido
(de 75 MB a 3 GB; o padrão *small* tem 484 MB). Depois tudo funciona offline.

## 2. Instalação no Windows

### Jeito mais fácil (dois cliques)

1. Baixe ou clone o projeto (por exemplo em `C:\UNLOCK-CLIPS`).
2. Abra a pasta `unlock-clips` e dê dois cliques em **`Instalar UNLOCK CLIPS.bat`**.
   O instalador verifica Python, Node.js e FFmpeg — e instala pelo **winget** o que estiver faltando —, prepara o
   servidor, compila a interface e cria o atalho **UNLOCK CLIPS** na Área de Trabalho.
3. Se ele instalou Python, Node.js ou FFmpeg agora e depois parou com um aviso, **feche a janela e execute o
   instalador mais uma vez** (alguns programas só são reconhecidos em janelas novas).

### Pelo PowerShell

```powershell
cd C:\UNLOCK-CLIPS\unlock-clips
powershell -ExecutionPolicy Bypass -File .\scripts\instalar.ps1 -InstalarDependencias -CriarAtalho
```

Opções do `instalar.ps1`: `-InstalarDependencias` (instala o que faltar pelo winget), `-CriarAtalho`
(atalho na Área de Trabalho) e `-Dev` (inclui as ferramentas de teste). Pode ser executado de novo a qualquer
momento — por exemplo, depois de atualizar o código.

### Instalação manual (passo a passo)

```powershell
# Pré-requisitos (uma vez). Feche e reabra o PowerShell depois.
winget install -e --id Python.Python.3.12
winget install -e --id OpenJS.NodeJS.LTS
winget install -e --id Gyan.FFmpeg

# Conferir (em um PowerShell novo)
py -3.12 --version; node --version; ffmpeg -version

# Back-end
cd C:\UNLOCK-CLIPS\unlock-clips\backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

# Interface
cd ..\frontend
npm ci
npm run build
```

> Os comandos chamam `.\.venv\Scripts\python.exe` diretamente para não depender de `Activate.ps1`, que costuma
> ser bloqueado pela política de execução do PowerShell.

Sem permissão para usar o winget? Baixe o FFmpeg em https://www.gyan.dev/ffmpeg/builds/ (versão *full* ou
*essentials*), descompacte (ex.: `C:\ffmpeg`) e informe `C:\ffmpeg\bin` em **Configurações → FFmpeg**.

## 3. Iniciar

- Dê dois cliques no atalho **UNLOCK CLIPS** (ou em `Iniciar UNLOCK CLIPS.bat`). O navegador abre em
  **http://127.0.0.1:8000**. Para encerrar, feche a janela preta (ou pressione Ctrl+C nela).
- Pelo PowerShell:

```powershell
cd C:\UNLOCK-CLIPS\unlock-clips
powershell -ExecutionPolicy Bypass -File .\scripts\iniciar.ps1
# opções: -Porta 8010  -SemNavegador  -PastaDeDados D:\UnlockClips\dados
```

- Diretamente com o Python (o que os scripts fazem por baixo):

```powershell
cd C:\UNLOCK-CLIPS\unlock-clips\backend
.\.venv\Scripts\python.exe -m app --abrir          # outras opções: --port 8010, --host, --reload, --log-requisicoes
```

Se o UNLOCK CLIPS já estiver aberto, um segundo início apenas abre o navegador. Se a porta estiver ocupada por
outro programa, a mensagem sugere outra porta.

### Modo desenvolvimento (interface com recarga automática)

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\desenvolver.ps1
```

Abre o back-end com `--reload` em outra janela e a interface Vite em **http://localhost:5173** (que encaminha
`/api` para a porta 8000). Equivalente manual, em dois terminais:

```powershell
cd unlock-clips\backend;  .\.venv\Scripts\python.exe -m app --reload
cd unlock-clips\frontend; npm run dev
```

## 4. Gerar os primeiros cortes

1. **Painel** (ou **Criar cortes**): arraste o vídeo (MP4, MOV, MKV, WebM, M4V ou AVI) ou clique em
   **Escolher arquivo** e em **Analisar vídeo**. Em **Criar cortes** você já escolhe duração (15–30, 30–60 ou
   60–90 s), formato, estilo e posição da legenda, enquadramento e quantidade de cortes.
2. A página do projeto mostra o processamento real em segundo plano: verificação → leitura da mídia → áudio →
   transcrição → sugestão de cortes, com porcentagem e botão **Cancelar**. Na primeira transcrição o modelo é
   baixado. Pode fechar o navegador: o trabalho continua e o projeto fica salvo.
3. Em **Cortes sugeridos**, veja a pontuação e os motivos de cada trecho ("Por que esta pontuação?"),
   pré-visualize, aprove ou descarte.
4. Clique em **Abrir no editor** para ajustar:
   - **título**, **início e fim** (±0,5 s ou "usar tempo atual");
   - **legendas**: corrija palavras, oculte blocos, ajuste tempos, baixe o `.srt`;
   - **enquadramento**: central, acompanhar o rosto ou posição fixa com zoom — a prévia mostra o resultado na hora;
   - a aba **Quadro final (exato)** mostra a imagem gerada pelo FFmpeg.
5. Clique em **Exportar MP4**. Quando terminar, **Baixar MP4**. Para vários cortes de uma vez, aprove-os e use
   **Gerar vídeos dos aprovados** no projeto.
6. Em **Vídeos exportados** você assiste, baixa, abre no editor ou exclui os arquivos.

**Importar por link:** em **Configurações → Links autorizados**, cadastre os domínios das fontes cujo conteúdo
você tem direito de usar (por exemplo, o armazenamento do seu site). Na aba **Usar link**, informe o link
**direto** do arquivo de vídeo e confirme a autorização. Páginas de sites de vídeo, playlists de streaming
(HLS/DASH) e conteúdo com DRM não são aceitos — a ferramenta não contorna proteções.

## 5. Configurações importantes

- **Transcrição** (Configurações → Transcrição): modelo (*tiny* a *large-v3*; *small* é o melhor equilíbrio em CPU),
  CPU ou **GPU NVIDIA (CUDA)**, precisão, filtro de voz (VAD) e transcrição automática. Sem internet, baixe os
  arquivos `config.json`, `model.bin`, `tokenizer.json`, `vocabulary.*` e `preprocessor_config.json` de
  `https://huggingface.co/Systran/faster-whisper-small` (ou do modelo desejado) e informe a pasta em
  **Pasta de um modelo próprio**. Tempo aproximado em CPU moderna com *small*: 0,3× a 1× a duração do áudio.
- **GPU NVIDIA**: drivers atualizados e as bibliotecas cuBLAS e cuDNN para CUDA 12 (veja a documentação do
  faster-whisper). Em caso de erro ao carregar o modelo, volte para CPU.
- **Pesos da pontuação** (Configurações → Detecção de cortes): aumente o peso do que é mais importante para o seu
  conteúdo.
- **Pasta de dados**: por padrão `unlock-clips\backend\data`. Para usar outro disco, inicie com
  `iniciar.ps1 -PastaDeDados D:\UnlockClips\dados` (ou defina a variável `UNLOCK_DATA_DIR`).
  A pasta atual, o espaço livre e o arquivo de log aparecem em **Configurações → Sistema**.

## 6. Solução de problemas

| Problema | Solução |
|----------|---------|
| "a execução de scripts foi desabilitada neste sistema" | Use os arquivos `.bat` ou rode `powershell -ExecutionPolicy Bypass -File .\scripts\...` (não altera a política do Windows). |
| "Python 3.10 a 3.13 não encontrado" | `winget install -e --id Python.Python.3.12` e abra um PowerShell novo. O atalho "python" da Microsoft Store não serve. |
| FFmpeg não encontrado / "sem o codificador libx264" | `winget install -e --id Gyan.FFmpeg` e reinicie o UNLOCK CLIPS, ou informe a pasta `bin` do FFmpeg em Configurações → FFmpeg. |
| "A porta 8000 já está sendo usada" | Feche o outro programa ou use `iniciar.ps1 -Porta 8010`. |
| O vídeo original não toca no navegador | Alguns codecs não tocam em certos navegadores; o processamento funciona normalmente e a aba "Quadro final" mostra o resultado. |
| "o arquivo está aberto em outro programa" ao gerar | Feche o MP4 no player (o Windows impede substituir arquivos abertos) e clique em **Tentar novamente**. |
| "Espaço em disco insuficiente" | Exclua vídeos exportados (Vídeos exportados ou quadro "Espaço em disco" do projeto) ou projetos antigos, ou mova a pasta de dados para outro disco. |
| Download do modelo falha (rede/empresa) | Baixe o modelo manualmente e use **Pasta de um modelo próprio** (seção 5). |
| Erro com GPU/CUDA | Selecione CPU em Configurações → Transcrição. |
| Antivírus bloqueia ou deixa lento | Adicione a pasta `unlock-clips` às exclusões (o FFmpeg lê e grava arquivos grandes). |
| Fechei a aplicação no meio de uma tarefa | O projeto aparece como **Interrompido**: clique em **Tentar novamente** (retoma só a etapa que faltou). |
| Outro problema | Veja o log em `backend\data\logs\unlock-clips.log` (o caminho exato está em Configurações → Sistema). |

## 7. Backup, atualização e desinstalação

- **Backup / mudar de computador**: copie a pasta de dados (`backend\data`). Ela contém projetos, vídeos,
  transcrições, cortes, exportados, modelos e configurações. Com o UNLOCK CLIPS fechado, basta colocá-la no mesmo
  lugar (ou apontar `-PastaDeDados`) no outro computador.
- **Atualizar**: com a aplicação fechada, atualize o código (`git pull` ou nova cópia, preservando
  `backend\data`) e execute `Instalar UNLOCK CLIPS.bat` de novo. Projetos de versões anteriores continuam
  funcionando.
- **Desinstalar**: apague a pasta `unlock-clips` (isso inclui os dados, se estiverem em `backend\data`) e o atalho
  da Área de Trabalho. Python, Node.js e FFmpeg podem ser removidos em "Adicionar ou remover programas".

## 8. Testes

```powershell
cd C:\UNLOCK-CLIPS\unlock-clips
powershell -ExecutionPolicy Bypass -File .\scripts\instalar.ps1 -Dev      # uma vez: instala o pytest
powershell -ExecutionPolicy Bypass -File .\scripts\testar.ps1             # back-end + interface + compilação
```

Ou separadamente:

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest                  # testes do back-end
.\.venv\Scripts\python.exe -m pytest --cov=app        # com cobertura
cd ..\frontend
npm test                                              # testes da interface (Vitest)
npm run test:coverage                                 # cobertura da interface
npm run build                                         # verificação de tipos + compilação
```

- Os testes do back-end geram pequenos vídeos reais com o FFmpeg e exercitam leitura da mídia, extração de áudio,
  transcrição (com um modelo Whisper minúsculo de pesos aleatórios, montado por `tests/tiny_whisper.py`), detecção
  de cortes, legendas no libass, enquadramento por rosto (foto de domínio público), geração do MP4, edição,
  exportados e o **fluxo completo** do envio ao MP4. Sem FFmpeg no PATH, os testes que dependem dele são pulados.
- **Teste de ponta a ponta com o servidor rodando** (usa um modelo Whisper real, baixado na primeira vez):

```powershell
.\backend\.venv\Scripts\python.exe .\scripts\teste_completo.py --video C:\videos\entrevista.mp4 --modelo tiny
```

  Ele envia o vídeo, espera transcrição e sugestões, edita um corte (título, enquadramento, legenda), gera o MP4,
  confere o arquivo com o FFprobe e exclui o projeto de teste (`--manter` para mantê-lo).
- **Integração contínua** (`.github/workflows/unlock-clips.yml`): a cada envio ao GitHub, os testes rodam no
  **Windows** (Python 3.12 e 3.13) e no Linux, e um job no Windows executa `instalar.ps1`, inicia o servidor com
  `iniciar.ps1` e roda o teste de ponta a ponta com fala sintetizada e o modelo Whisper *tiny*.

## 9. Limitações conhecidas

- A qualidade das sugestões depende da transcrição: modelos pequenos erram mais em áudio ruidoso ou com sotaque
  forte. A pontuação é heurística (regras explicáveis), não uma previsão de desempenho nas redes.
- O acompanhamento de rosto segue o rosto principal (maior/mais estável), não necessariamente quem está falando.
- Expressões da pontuação existem para português, inglês e espanhol; outros idiomas usam a lista em português.
- A prévia ao vivo depende de o navegador reproduzir o vídeo original; o MP4 final é sempre H.264 compatível.
- Não há refinamento por IA generativa: para manter tudo gratuito e local, as sugestões usam regras. A arquitetura
  permite acrescentar um modelo local ou uma API (que seria paga e claramente identificada) como etapa opcional.

## 10. Uso responsável e licenças

Use apenas conteúdos que você produziu ou que tem autorização para editar e publicar. A importação por link aceita
somente domínios que você cadastrou e arquivos de vídeo diretos; não há nenhum mecanismo para contornar DRM,
login, pagamento ou outras restrições de acesso.

Componentes de terceiros: FFmpeg (LGPL/GPL, instalado à parte), faster-whisper e CTranslate2 (MIT), modelos
Whisper (MIT), OpenCV (Apache 2.0), modelo YuNet de detecção de rostos (MIT,
`backend/app/assets/face_detection_yunet_LICENSE.txt`), React, Vite, Tailwind CSS e lucide (MIT/ISC).
