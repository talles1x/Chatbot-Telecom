@echo off
cd /d "%~dp0"
title Instalando/atualizando dependencias do bot
call npm install --no-audit --no-fund
echo.
echo Pronto. Pode fechar esta janela.
pause
