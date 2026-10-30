# Chatbot Telecom (WhatsApp por QR code + SGP)

Bot de autoatendimento com menu clicável (enquete do WhatsApp): **Financeiro** (2ª via de boleto e liberação de confiança), **Suporte técnico** (triagem do problema e resumo da ocorrência) e **Falar com atendente**. O cliente também pode digitar o número da opção, *voltar* para o passo anterior ou *0* para o início.

No suporte, o bot pergunta o tipo do problema, a luz vermelha (LOS), se já reiniciou o roteador (e orienta a reiniciar) e pede uma descrição (texto, áudio ou foto). No fim, manda o resumo para o cliente, deixa a conversa para o atendente e, se `NUMERO_EQUIPE` estiver preenchido, envia o resumo com nome, CPF, contrato e endereço para esse número, pronto para abrir a ocorrência no SGP. Se o contrato estiver suspenso, ele oferece liberação de confiança ou boleto antes. O bot também consulta no SGP se a conexão do cliente está online: se estiver, orienta para Wi-Fi/aparelho em vez de perguntar da fibra.

**Acordo**: se a fatura mais antiga do contrato tiver 2,5 meses (75 dias) ou mais de atraso (`ACORDO_MIN_DIAS`), assim que o bot encontra o contrato ele oferece um acordo com condições especiais. Se o cliente aceitar, a conversa vai para o atendente e a equipe (`NUMERO_EQUIPE`) recebe o resumo com faturas em aberto, total e dias de atraso. Nesses casos a liberação de confiança não é oferecida.

Em **Quero contratar**, o bot pega cidade/bairro, nome e tipo de uso e manda para `NUMERO_COMERCIAL` (ou `NUMERO_EQUIPE`). Se a primeira mensagem do cliente já disser o que ele quer ("preciso do boleto", "vocês instalam em...", "minha internet caiu"), o bot pula o menu e vai direto.

**Áudios**: o bot transcreve o áudio no próprio computador (Whisper local, sem custo e sem mandar nada para fora) e segue como se o cliente tivesse digitado. No suporte, a descrição falada vai transcrita para o técnico. Na primeira vez que o bot liga, ele baixa o modelo (~80 MB) para a pasta `modelos`. Se o áudio não for entendido, a conversa vai para o atendente. Para desligar: `TRANSCREVER_AUDIO=false`. No simulador, teste com `#audio C:\caminho\do\audio.ogg`.

**Tratamentos do dia a dia**: mensagens seguidas ("oi" / "bom dia" / "tudo bem?") são juntadas e respondidas uma vez só; "obrigado", "ok", 👍 ou figurinha depois de resolver recebem só um "Por nada!"; reclamação séria ou irritação (procon, absurdo, cancelar, palavrão...) vai direto para uma pessoa; CPF mandado logo de cara é aproveitado; "quero o boleto, CPF tal" já recebe o boleto direto; e se o cliente some no meio do fluxo, o bot lembra depois de 10 min e encerra 10 min depois (`LEMBRETE_MIN`).

**Palavras-chave**: tudo que o bot entende de texto livre (intenção da primeira mensagem, irritação, agradecimento, pedido de atendente e respostas escritas/faladas para cada enquete) fica em `src/entender.js` e nas `chave` das opções em `src/fluxo.js`. Gírias e abreviações comuns (vc, net, tô, obg, vlw, pfv, 2ª via...) são normalizadas antes. Depois de mexer nelas, rode `npm test`, que confere mais de 150 frases reais.

**LGPD**: o cliente vê só o necessário para confirmar o cadastro: nome abreviado (Maria S. S.), endereço sem número/complemento/CEP e a situação do contrato. CPF aparece mascarado nas mensagens e na janela do bot. Um mesmo WhatsApp só pode consultar até 3 CPFs/CNPJs diferentes por dia (`LIMITE_CPFS_DIA`); passou disso, vai para o atendente. Os dados completos ficam só no resumo interno enviado para a equipe.

O bot lembra o CPF/contrato de cada número e, na próxima vez, só pede confirmação. As conversas pausadas (com atendente) e os cadastros lembrados ficam salvos na pasta `dados`, então nada se perde se o computador reiniciar.

## Instalar (uma vez)

1. Instale o **Node.js 20 ou mais novo** (nodejs.org, versão LTS).
2. Descompacte esta pasta no computador do bot.
3. Copie `.env.example` para `.env` e preencha `SGP_URL`, `SGP_TOKEN` e `SGP_APP` (o token da aplicação "bot financeiro").
4. Abra o cmd na pasta e rode `npm install`.

## Testar sem WhatsApp (simulador)

- `npm run simular:mock` testa o fluxo com dados falsos. CPF de teste: `100.000.098-22` (2 contratos, um com fatura atrasada) e `100.000.037-00` (não encontrado).
- `npm run simular` usa o **SGP de verdade**. Coloque `DEBUG=true` no `.env` para ver as respostas cruas do SGP e conferir se os campos (vencimento, valor, linha digitável, PIX) estão vindo certos.

Comandos no simulador: `#humano` (atendente assume), `#bot` (religa), `#foto` (cliente manda imagem), `sair`.

## Rodar no WhatsApp

1. No `.env`, coloque seu número em `TESTE_NUMEROS` (ex.: `5583999999999`). Assim o bot **só responde você** enquanto testa.
2. Rode `npm start` (ou dê dois cliques em `iniciar.bat`).
3. No celular: WhatsApp > Aparelhos conectados > Conectar um aparelho > leia o QR. Se o QR sair torto no cmd, abra o arquivo `qrcode.png` que aparece na pasta.
4. A sessão fica salva na pasta `.sessao`, então não pede QR de novo. Para trocar de número, apague essa pasta.
5. Quando estiver tudo certo, apague o número de `TESTE_NUMEROS` para o bot responder todos os clientes.

## Como o atendente usa

- Quando o cliente pede atendente (ou manda áudio, foto ou comprovante), o bot avisa o cliente, deixa a conversa como **não lida** e **fica calado nessa conversa por 12h** (`PAUSA_HUMANO_HORAS`).
- Se o atendente responder qualquer conversa pelo celular, o bot também sai dessa conversa automaticamente.
- `#bot` enviado pelo atendente na conversa religa o bot para aquele cliente. `#pausa` desliga. Os comandos são apagados da conversa sozinhos.
- Fora do horário (seg a sáb, 8h–12h e 13h–17h), quem pede atendente recebe a mensagem para aguardar.

## Cuidados contra banimento

O bot já mostra "digitando…" com tempo variável antes de cada resposta, só responde a quem mandou mensagem, ignora grupos e mensagens antigas e não faz disparo em massa. Mesmo assim, conexão por QR code não é oficial do WhatsApp e sempre existe algum risco. Não use o bot para mandar mensagens em massa ou de cobrança ativa.

## Deixar rodando direto

Para religar sozinho se fechar ou o PC reiniciar: `npm install -g pm2 pm2-windows-startup`, depois `pm2 start src/index.js --name chatbot-telecom`, `pm2 save` e `pm2-startup install`.

## Log (o que o bot entendeu)

Cada mensagem aparece na janela e fica salva em `logs/bot-AAAA-MM-DD.txt`: `[entrada]` (o que chegou e em que etapa), `[áudio]` (texto transcrito), `[entendi]` (intenção detectada), `[bot →]` (o que respondeu) e `[etapa]` (para onde a conversa foi). CPF aparece mascarado.

## Se algo não funcionar

- **Cliente não encontrado com CPF certo** ou **boleto sem linha/PIX**: rode `npm run simular` com `DEBUG=true` e veja a resposta do SGP. Os nomes dos campos ficam em `src/sgp.js`.
- **Erro HTTP 4xx do SGP**: confira token/app e teste `SGP_FORMATO=form`.
- **Bot parou de conectar depois de um tempo**: rode `npm update whatsapp-web.js` (o WhatsApp Web muda e a biblioteca é atualizada).
