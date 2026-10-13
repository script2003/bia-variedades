<#
.SYNOPSIS
    Inicia o UNLOCK CLIPS (servidor + interface no mesmo endereço) e abre o navegador.

.EXAMPLE
    .\scripts\iniciar.ps1
    .\scripts\iniciar.ps1 -Porta 8010 -SemNavegador
#>
[CmdletBinding()]
param(
    [int]$Porta = 8000,
    # Endereço de escuta. O padrão (127.0.0.1) só aceita conexões deste computador.
    [string]$Endereco = "127.0.0.1",
    [switch]$SemNavegador,
    # Pasta onde ficam projetos, vídeos e configurações (padrão: backend\data).
    [string]$PastaDeDados
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$Raiz = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Raiz "backend"
$venvPython = Join-Path $Backend ".venv\Scripts\python.exe"

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

if (-not (Test-Path $venvPython)) {
    throw "O UNLOCK CLIPS ainda não foi instalado. Execute primeiro: .\scripts\instalar.ps1 -InstalarDependencias"
}
if (-not (Test-Path (Join-Path $Raiz "frontend\dist\index.html"))) {
    Write-Aviso "A interface não está compilada. Compilando agora (npm run build)..."
    Push-Location (Join-Path $Raiz "frontend")
    try { Invoke-Programa "Compilação da interface" { npm run build } } finally { Pop-Location }
}
if ($PastaDeDados) { $env:UNLOCK_DATA_DIR = $PastaDeDados }

$argumentos = @("-m", "app", "--host", $Endereco, "--port", "$Porta")
if (-not $SemNavegador) { $argumentos += "--abrir" }
Push-Location $Backend
try {
    & $venvPython @argumentos
    $codigo = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $codigo
