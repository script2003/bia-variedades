@echo off
rem Instala o UNLOCK CLIPS (Python, Node.js e FFmpeg pelo winget, se faltarem) e cria um atalho.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\instalar.ps1" -InstalarDependencias -CriarAtalho
echo.
pause
