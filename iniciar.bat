@echo off
cd /d "%~dp0"
title Chatbot Telecom
if not exist node_modules\whatsapp-web.js (
  echo Instalando dependencias, aguarde...
  call npm install --no-audit --no-fund
)
rem Primeira vez: so responde mensagens novas. Nos reinicios automaticos: continua de onde parou.
set BOT_REINICIO=0
:loop
title Chatbot Telecom
node src\index.js
echo Bot parou. Reiniciando em 10 segundos... (feche esta janela para desligar)
timeout /t 10
set BOT_REINICIO=1
goto loop
