@echo off
rem Inicia o UNLOCK CLIPS e abre o navegador. Feche esta janela para encerrar.
title UNLOCK CLIPS
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\iniciar.ps1" %*
if errorlevel 1 pause
