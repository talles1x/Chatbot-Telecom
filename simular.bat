@echo off
cd /d "%~dp0"
title Simulador Chatbot Telecom
call npm install --no-audit --no-fund
node src\simulador.js
pause
