<#
.SYNOPSIS
    Instala o UNLOCK CLIPS no Windows: ambiente Python do back-end, dependências e interface compilada.

.DESCRIPTION
    Verifica Python (3.10 a 3.13), Node.js (20.19+) e FFmpeg. Com -InstalarDependencias, instala pelo
    winget o que estiver faltando. Depois cria backend\.venv, instala os pacotes Python e compila a interface.
    Pode ser executado de novo a qualquer momento (por exemplo, após atualizar o código).

.EXAMPLE
    .\scripts\instalar.ps1 -InstalarDependencias -CriarAtalho
#>
[CmdletBinding()]
param(
    # Instala Python, Node.js e FFmpeg pelo winget quando não forem encontrados.
    [switch]$InstalarDependencias,
    # Instala também as ferramentas de teste (pytest).
    [switch]$Dev,
    # Cria um atalho "UNLOCK CLIPS" na Área de Trabalho.
    [switch]$CriarAtalho
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$Raiz = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Raiz "backend"
$Frontend = Join-Path $Raiz "frontend"

function Write-Etapa([string]$Texto) { Write-Host "`n==> $Texto" -ForegroundColor Cyan }
function Write-Ok([string]$Texto) { Write-Host "    OK  $Texto" -ForegroundColor Green }
function Write-Aviso([string]$Texto) { Write-Host "    !   $Texto" -ForegroundColor Yellow }

# Executa um programa externo e interrompe o script se ele falhar (o PowerShell não faz isso sozinho).
function Invoke-Programa {
    param([string]$Descricao, [scriptblock]$Comando)
    & $Comando
    if ($LASTEXITCODE -ne 0) { throw "$Descricao falhou (código $LASTEXITCODE)." }
}

function Update-CaminhoDoSistema {
    $maquina = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $usuario = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$maquina;$usuario"
}

function Test-Comando([string]$Nome) { return [bool](Get-Command $Nome -ErrorAction SilentlyContinue) }

function Install-ComWinget([string]$Id, [string]$Nome) {
    if (-not (Test-Comando "winget")) {
        throw "O winget não está disponível. Instale $Nome manualmente (veja o README) e execute este script de novo."
    }
    Write-Host "    Instalando $Nome pelo winget ($Id)..."
    winget install -e --id $Id --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "O winget não conseguiu instalar $Nome (código $LASTEXITCODE)." }
    Update-CaminhoDoSistema
}

# Procura um Python 3.10–3.13 (o lançador "py" é preferido; o "python" da Microsoft Store é ignorado se for só o atalho).
function Find-Python {
    $candidatos = @(
        @("py", "-3.12"), @("py", "-3.13"), @("py", "-3.11"), @("py", "-3.10"), @("py", "-3"), @("python"), @("python3")
    )
    foreach ($c in $candidatos) {
        if (-not (Test-Comando $c[0])) { continue }
        $argumentos = @($c | Select-Object -Skip 1) + @("-c", "import sys; print('%d.%d' % sys.version_info[:2])")
        # O "python" falso da Microsoft Store escreve no erro padrão: ignora-o sem interromper o script.
        # (Sem "Select-Object -First": no PowerShell 5.1 ele interrompe o programa e altera o $LASTEXITCODE.)
        $anterior = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        $saida = @()
        $codigo = 1
        try { $saida = @(& $c[0] @argumentos 2>$null); $codigo = $LASTEXITCODE } catch { $codigo = 1 } finally { $ErrorActionPreference = $anterior }
        if ($codigo -ne 0 -or $saida.Count -eq 0) { continue }
        $versao = "$($saida[0])".Trim()
        if ($versao -notmatch '^\d+\.\d+$') { continue }
        $partes = $versao.Split(".")
        if ([int]$partes[0] -eq 3 -and [int]$partes[1] -ge 10 -and [int]$partes[1] -le 13) {
            return [pscustomobject]@{ Comando = $c[0]; Argumentos = @($c | Select-Object -Skip 1); Versao = $versao.Trim() }
        }
    }
    return $null
}

function Get-VersaoNode {
    if (-not (Test-Comando "node")) { return $null }
    $texto = (node --version) -replace "^v", ""
    return [version]$texto
}

Write-Host "UNLOCK CLIPS - instalação" -ForegroundColor White
Write-Host "Pasta: $Raiz"

# 1) Python
Write-Etapa "Python"
$python = Find-Python
if (-not $python -and $InstalarDependencias) {
    Install-ComWinget "Python.Python.3.12" "Python 3.12"
    $python = Find-Python
}
if (-not $python) {
    throw "Python 3.10 a 3.13 não encontrado. Instale com: winget install -e --id Python.Python.3.12 (ou execute este script com -InstalarDependencias) e abra um novo PowerShell."
}
Write-Ok "Python $($python.Versao) ($($python.Comando) $($python.Argumentos -join ' '))"

# 2) Node.js
Write-Etapa "Node.js"
$node = Get-VersaoNode
if ((-not $node -or $node -lt [version]"20.19.0") -and $InstalarDependencias) {
    Install-ComWinget "OpenJS.NodeJS.LTS" "Node.js LTS"
    $node = Get-VersaoNode
}
if (-not $node -or $node -lt [version]"20.19.0") {
    throw "Node.js 20.19 ou mais recente não encontrado. Instale com: winget install -e --id OpenJS.NodeJS.LTS (ou use -InstalarDependencias) e abra um novo PowerShell."
}
Write-Ok "Node.js $node"

# 3) FFmpeg (necessário para processar vídeos; a aplicação abre mesmo sem ele e mostra o problema em Configurações)
Write-Etapa "FFmpeg"
if (-not (Test-Comando "ffmpeg") -and $InstalarDependencias) {
    Install-ComWinget "Gyan.FFmpeg" "FFmpeg"
}
if (Test-Comando "ffmpeg") {
    $linha = @(ffmpeg -hide_banner -version)[0]
    Write-Ok $linha
} else {
    Write-Aviso "FFmpeg não encontrado no PATH. Instale com: winget install -e --id Gyan.FFmpeg"
    Write-Aviso "ou informe a pasta do ffmpeg.exe em Configurações > FFmpeg depois de abrir o UNLOCK CLIPS."
}

# 4) Ambiente Python do back-end
Write-Etapa "Back-end (ambiente Python e pacotes)"
$venvPython = Join-Path $Backend ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    Invoke-Programa "Criação do ambiente virtual" { & $python.Comando @($python.Argumentos) -m venv (Join-Path $Backend ".venv") }
}
$requisitos = if ($Dev) { "requirements-dev.txt" } else { "requirements.txt" }
Invoke-Programa "Atualização do pip" { & $venvPython -m pip install --disable-pip-version-check --upgrade pip }
Invoke-Programa "Instalação dos pacotes Python" { & $venvPython -m pip install --disable-pip-version-check -r (Join-Path $Backend $requisitos) }
Invoke-Programa "Verificação dos pacotes" { & $venvPython -c "import fastapi, uvicorn, faster_whisper, cv2; print('pacotes importados')" }
Write-Ok "backend\.venv pronto ($requisitos)"

# 5) Interface
Write-Etapa "Interface (dependências e compilação)"
Push-Location $Frontend
try {
    Invoke-Programa "npm ci" { npm ci --no-audit --no-fund }
    Invoke-Programa "Compilação da interface" { npm run build }
} finally {
    Pop-Location
}
Write-Ok "frontend\dist pronto"

# 6) Atalho
if ($CriarAtalho) {
    Write-Etapa "Atalho na Área de Trabalho"
    $destino = Join-Path ([Environment]::GetFolderPath("Desktop")) "UNLOCK CLIPS.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $atalho = $shell.CreateShortcut($destino)
    $atalho.TargetPath = Join-Path $Raiz "Iniciar UNLOCK CLIPS.bat"
    $atalho.WorkingDirectory = $Raiz
    $atalho.Description = "Iniciar o UNLOCK CLIPS"
    $atalho.Save()
    Write-Ok $destino
}

Write-Host "`nInstalação concluída." -ForegroundColor Green
Write-Host "Para abrir o UNLOCK CLIPS:  .\scripts\iniciar.ps1   (ou dê dois cliques em 'Iniciar UNLOCK CLIPS.bat')"
