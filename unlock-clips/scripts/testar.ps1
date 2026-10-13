<#
.SYNOPSIS
    Executa os testes automatizados do back-end (pytest) e da interface (Vitest, tipos e compilação).
#>
[CmdletBinding()]
param([switch]$SoBackend, [switch]$SoFrontend)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$Raiz = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $Raiz "backend\.venv\Scripts\python.exe"

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

$falhas = @()
if (-not $SoFrontend) {
    Write-Etapa "Back-end (pytest)"
    if (-not (Test-Path $venvPython)) { throw "Execute antes: .\scripts\instalar.ps1 -Dev" }
    # Sem redirecionar o erro: no Windows PowerShell 5.1, "2>$null" com ErrorActionPreference=Stop interrompe o script.
    & $venvPython -c "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('pytest') else 1)"
    if ($LASTEXITCODE -ne 0) { Invoke-Programa "Instalação do pytest" { & $venvPython -m pip install -r (Join-Path $Raiz "backend\requirements-dev.txt") } }
    Push-Location (Join-Path $Raiz "backend")
    try { & $venvPython -m pytest -o addopts="" ; if ($LASTEXITCODE -ne 0) { $falhas += "back-end" } } finally { Pop-Location }
}
if (-not $SoBackend) {
    Push-Location (Join-Path $Raiz "frontend")
    try {
        Write-Etapa "Interface (Vitest)"
        npm test; if ($LASTEXITCODE -ne 0) { $falhas += "testes da interface" }
        Write-Etapa "Interface (tipos e compilação)"
        npm run build; if ($LASTEXITCODE -ne 0) { $falhas += "compilação da interface" }
    } finally { Pop-Location }
}
if ($falhas.Count -gt 0) {
    Write-Host "`nFalhas: $($falhas -join ', ')" -ForegroundColor Red
    exit 1
}
Write-Host "`nTodos os testes passaram." -ForegroundColor Green
