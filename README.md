# Chatbot Telecom (WhatsApp por QR code + SGP)

Bot de autoatendimento para provedor de internet, conectado ao WhatsApp por QR code e integrado à API URA do SGP. O menu tem 4 opções: **Financeiro** (2ª via de boleto e liberação de confiança), **Suporte técnico** (triagem do problema e resumo da ocorrência), **Quero contratar** e **Falar com atendente**. O cliente responde digitando o número da opção, *voltar* para o passo anterior ou *0* para o início. O menu sai em texto numerado, que funciona em qualquer celular; a enquete clicável do WhatsApp pode ser ligada com `USAR_ENQUETE=true`, mas nesta versão do WhatsApp Web o toque na enquete nem sempre chega ao bot.

**Escolha do contrato**: quando o CPF tem mais de um contrato, a lista mostra rua, bairro, cidade e ponto de referência de cada um, com os ativos primeiro e a situação quando não é "Ativo". Cabem 10 na lista; com mais que isso, os cancelados saem da lista e o cliente pode digitar o **número do contrato** (ex.: 4684) ou parte do **endereço/referência** ("rua das flores", "perto da igreja").

**Suporte**: o bot pergunta o tipo do problema, a luz vermelha (LOS), se já reiniciou o roteador (e orienta a reiniciar) e pede uma descrição (texto, áudio ou foto). Antes, consulta no SGP se a conexão do cliente está online: se estiver, orienta para Wi-Fi/aparelho em vez de perguntar da fibra. Se o contrato estiver suspenso, oferece liberação de confiança ou boleto antes. No fim, manda o resumo para o cliente, passa a conversa para o atendente e, se `NUMERO_EQUIPE` estiver preenchido, envia para esse número o resumo com nome, CPF, contrato, endereço, ponto de referência e se a identidade foi confirmada, pronto para abrir a ocorrência no SGP.

**Acordo**: se a fatura mais antiga do contrato tiver 75 dias ou mais de atraso (`ACORDO_MIN_DIAS`), assim que o bot encontra o contrato ele oferece um acordo com condições especiais. Se o cliente aceitar, a conversa vai para o atendente e a equipe recebe o resumo com faturas em aberto, total e dias de atraso. Nesses casos a liberação de confiança não é oferecida.

**Quero contratar**: o bot pega cidade/bairro, nome e tipo de uso, indica um plano e manda a arte dos planos (`midia/planos.jpg`; se a imagem não existir, manda só o texto). Os dados do interessado vão para `NUMERO_COMERCIAL` (ou `NUMERO_EQUIPE`). Os planos e preços indicados ficam em `INDICACAO`, no começo de `src/fluxo.js`.

Se a primeira mensagem do cliente já disser o que ele quer ("preciso do boleto", "vocês instalam em...", "minha internet caiu"), o bot pula o menu e vai direto.

**Áudios**: o bot transcreve o áudio no próprio computador (Whisper local, sem custo e sem mandar nada para fora) e segue como se o cliente tivesse digitado. No suporte, a descrição falada vai transcrita para o técnico. Na primeira vez, ele baixa o modelo (~80 MB no `whisper-base`) para a pasta `modelos`. Se não entender o áudio, pede para o cliente escrever; na segunda vez seguida, passa para o atendente (no suporte, o áudio vale como descrição do problema). Para desligar: `TRANSCREVER_AUDIO=false`.

**Tratamentos do dia a dia**: mensagens seguidas ("oi" / "bom dia" / "tudo bem?") são juntadas e respondidas uma vez só; "obrigado", "ok", 👍 ou figurinha depois de resolver recebem só um "Por nada!"; reclamação séria ou irritação (procon, absurdo, cancelar, palavrão...) vai direto para uma pessoa; CPF mandado logo de cara é aproveitado; "quero o boleto, CPF tal" já recebe o boleto direto; e se o cliente some no meio do fluxo, o bot lembra depois de 10 min e encerra 10 min depois (`LEMBRETE_MIN`).

**Palavras-chave**: tudo que o bot entende de texto livre (intenção da primeira mensagem, irritação, agradecimento, pedido de atendente e respostas escritas/faladas para cada pergunta) fica em `src/entender.js` e nas `chave` das opções em `src/fluxo.js`. Gírias e abreviações comuns (vc, net, tô, obg, vlw, pfv, 2ª via...) são normalizadas antes. Depois de mexer nelas, rode `npm test`, que confere mais de 100 frases reais.

## Segurança e LGPD

- **Identidade do titular**: nome, rua e ponto de referência só aparecem quando o WhatsApp é do titular (o número bate com um telefone do cadastro no SGP) ou quando a pessoa informa os 4 últimos dígitos de um telefone cadastrado. Sem isso, o atendimento continua (boleto, suporte, liberação), mas mostrando só bairro e cidade, e o resumo para a equipe avisa que a identidade **não** foi confirmada.
- O cliente vê só o necessário: nome abreviado (Maria S. S.) e endereço sem número, complemento e CEP. CPF aparece mascarado nas mensagens, na janela e no log.
- Um mesmo WhatsApp só consulta até 3 CPFs/CNPJs diferentes por dia (`LIMITE_CPFS_DIA`); passou disso, vai para o atendente.
- Os dados completos (CPF inteiro, endereço com número) ficam só no resumo interno enviado para a equipe.
- O bot lembra o CPF/contrato de cada número (e se a identidade já foi confirmada) e, na próxima vez, só pede confirmação. Isso, as conversas pausadas e as conversas em andamento ficam em `dados/estado.json`, então nada se perde se o computador reiniciar.
- Não vão para o repositório (estão no `.gitignore`): `.env`, `.sessao`, `.wwebjs_cache`, `dados`, `logs`, `modelos`, `midia` e `qrcode.png`.

## Instalar (uma vez)

1. Instale o **Node.js 20 ou mais novo** (nodejs.org, versão LTS).
2. Clone este repositório (ou baixe o ZIP) no computador do bot.
3. Copie `.env.example` para `.env` e preencha `SGP_URL`, `SGP_TOKEN` e `SGP_APP` (gerados no SGP em Administração > Integrações > Tokens). As outras opções estão explicadas no próprio arquivo.
4. Dê dois cliques em `instalar.bat` (ou rode `npm install`).
5. (Opcional) Coloque a arte dos planos em `midia/planos.jpg`.

## Testar sem WhatsApp (simulador)

- `npm run simular:mock` testa o fluxo com dados falsos. CPF de teste: `100.000.098-22` (2 contratos, um com fatura atrasada) e `100.000.037-00` (não encontrado). O bot vai pedir os 4 últimos dígitos do telefone do cadastro: responda `0000`. Para simular o WhatsApp do próprio titular (sem a pergunta), defina `SIMULADOR_NUMERO=5583999990000` antes de rodar.
- `npm run simular` (ou `simular.bat`) usa o **SGP de verdade**. Coloque `DEBUG=true` no `.env` para ver as respostas cruas do SGP e conferir se os campos estão vindo certos.

Comandos no simulador: `#humano` (atendente assume), `#bot` (religa), `#foto` (cliente manda imagem), `#audio C:\caminho\do\audio.ogg` (cliente manda áudio), `sair`.

## Rodar no WhatsApp

1. No `.env`, coloque seu número em `TESTE_NUMEROS` (ex.: `5583999999999`). Assim o bot **só responde você** enquanto testa.
2. Dê dois cliques em `iniciar.bat` (ou rode `npm start`).
3. No celular: WhatsApp > Aparelhos conectados > Conectar um aparelho > leia o QR. Se o QR sair torto na janela, abra o arquivo `qrcode.png` que aparece na pasta.
4. A sessão fica salva na pasta `.sessao`, então não pede QR de novo. Para trocar de número, apague essa pasta.
5. Quando estiver tudo certo, apague o número de `TESTE_NUMEROS` para o bot responder todos os clientes.

## Deixar rodando direto

O `iniciar.bat` já religa o bot sozinho se ele cair (e, nesses reinícios, responde o que chegou enquanto estava fora). Para ele abrir quando o computador ligar:

1. Clique com o botão direito em `iniciar.bat` > **Criar atalho**.
2. Aperte `Windows + R`, digite `shell:startup` e dê Enter.
3. Mova o atalho criado para essa pasta.

Use o atalho do `iniciar.bat`, e não um atalho direto para o `node` ou para o `src\index.js`: fora da pasta do bot, o Node não acha os arquivos (erro `Cannot find module ...\Startup\src\index.js`).

## Como o atendente usa

- Quando o cliente pede atendente (ou manda foto ou comprovante), o bot avisa o cliente, deixa a conversa como **não lida** e **fica calado nessa conversa por 3h** (`PAUSA_HUMANO_HORAS`).
- Se o atendente responder qualquer conversa pelo celular, o bot também sai dessa conversa automaticamente.
- `#bot` enviado pelo atendente na conversa religa o bot para aquele cliente. `#pausa` desliga. Os comandos são apagados da conversa sozinhos.
- Fora do horário de atendimento (`HORARIO_DIAS`, `HORARIO_TURNOS` e o texto `HORARIO_TEXTO`; padrão: seg a sáb, 8h–12h e 13h–17h), quem pede atendente recebe a mensagem para aguardar.

## Cuidados contra banimento

O bot já mostra "digitando…" com tempo variável antes de cada resposta, só responde a quem mandou mensagem, ignora grupos e mensagens antigas e não faz disparo em massa. Mesmo assim, conexão por QR code não é oficial do WhatsApp e sempre existe algum risco. Não use o bot para mandar mensagens em massa ou de cobrança ativa.

## Log (o que o bot entendeu)

Cada mensagem aparece na janela e fica salva em `logs/bot-AAAA-MM-DD.txt`: `[entrada]` (o que chegou e em que etapa), `[áudio]` (texto transcrito), `[entendi]` (intenção detectada), `[bot →]` (o que respondeu) e `[etapa]` (para onde a conversa foi). CPF e números longos aparecem mascarados. Os logs guardam trechos das conversas: não compartilhe a pasta `logs`.

## Se algo não funcionar

- **Cliente não encontrado com CPF certo** ou **boleto sem linha/PIX**: rode `npm run simular` com `DEBUG=true` e veja a resposta do SGP. Os nomes dos campos ficam em `src/sgp.js`.
- **Endereço/referência não aparecem** ou **o bot pede os 4 dígitos até para o titular**: procure no log a linha `[SGP] contrato sem endereço/telefone reconhecido. Campos recebidos: ...`. Ela lista só os nomes dos campos que o SGP mandou (nunca os valores); ajuste a leitura em `src/sgp.js`.
- **Erro HTTP 4xx do SGP**: confira token/app e teste `SGP_FORMATO=form`.
- **Bot parou de conectar depois de um tempo**: rode `npm update whatsapp-web.js` (o WhatsApp Web muda e a biblioteca é atualizada).
- **Fica parado em "Sincronizando"**: confira se o celular está ligado e com internet; se continuar, feche a janela, apague a pasta `.wwebjs_cache` e abra o `iniciar.bat` de novo.
