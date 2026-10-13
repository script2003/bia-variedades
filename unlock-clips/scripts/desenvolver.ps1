<#
.SYNOPSIS
    Modo desenvolvimento: back-end com recarga automática (nova janela) e interface Vite em http://localhost:5173.
#>
[CmdletBinding()]
param([int]$PortaBackend = 8000)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$Raiz = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Raiz "backend"
$venvPython = Join-Path $Backend ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) { throw "Execute antes: .\scripts\instalar.ps1 -Dev" }
if ($PortaBackend -ne 8000) { Write-Host "Atenção: o proxy do Vite (vite.config.ts) aponta para a porta 8000." -ForegroundColor Yellow }

$comando = "Set-Location '$Backend'; & '$venvPython' -m app --reload --port $PortaBackend"
Start-Process powershell -ArgumentList @("-NoExit", "-NoProfile", "-Command", $comando) | Out-Null
Write-Host "Back-end iniciado em outra janela (http://127.0.0.1:$PortaBackend)."
Write-Host "Interface: http://localhost:5173  (Ctrl+C para encerrar)"
Push-Location (Join-Path $Raiz "frontend")
try { npm run dev -- --open } finally { Pop-Location }
