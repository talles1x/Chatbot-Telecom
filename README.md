# Chatbot Telecom (WhatsApp por QR code + SGP)

> Desenvolvido por **Talles Oliveira** ([github.com/talles1x](https://github.com/talles1x)). Licença MIT, veja [Autor e licença](#autor-e-licença).

## Objetivo

Automatizar o atendimento de um provedor de internet pelo WhatsApp: o cliente resolve sozinho, a qualquer hora, o que é mais comum no dia a dia (2ª via de boleto, liberação de confiança, triagem de suporte e interesse em contratar), e a equipe recebe só o que precisa de uma pessoa, já com o resumo pronto. O bot é integrado à API URA do SGP, então consulta contratos, faturas e conexão em tempo real, e também atende a equipe interna (caixa e técnicos) com menus próprios.

## Atendimento ao cliente

O menu tem as opções **Boleto e liberação da internet** (2ª via e liberação de confiança), **Problema na internet** (triagem e resumo da ocorrência), **Quero ser cliente**, **Falar com um atendente** e **Finalizar atendimento**, com linguagem simples e sem termos técnicos. Se a primeira mensagem já disser o que o cliente quer ("preciso do boleto", "vocês instalam em...", "minha internet caiu"), o bot vai direto ao assunto.

**Financeiro**: a 2ª via sai com link do boleto, PIX copia e cola e linha digitável. Pedidos como "me manda a chave pix", "qr code" ou "quero pagar" já levam direto ao boleto. Contratos com fatura em atraso podem receber a liberação de confiança pelo próprio bot.

**Escolha do contrato**: quando o CPF tem mais de um contrato, a lista mostra rua, bairro, cidade e ponto de referência de cada um, com os ativos primeiro. O cliente também pode escolher digitando o **número do contrato** (ex.: 4684) ou parte do **endereço/referência** ("rua das flores", "perto da igreja").

**Suporte**: o bot consulta no SGP se a conexão do cliente está online e conduz a triagem: tipo do problema, luz vermelha (LOS), reinício do roteador e uma descrição (texto, áudio ou foto). No fim, manda o resumo para o cliente, passa a conversa para o atendente e envia para a equipe (`NUMERO_EQUIPE`) o resumo com nome, CPF, contrato, endereço e ponto de referência, pronto para abrir a ocorrência. Se o cliente avisa que a internet voltou, o bot encerra o atendimento.

**Acordo**: quando a fatura mais antiga do contrato tem 75 dias ou mais de atraso (`ACORDO_MIN_DIAS`), o bot oferece um acordo com condições especiais e, se o cliente aceitar, a equipe recebe o resumo com faturas em aberto, total e dias de atraso.

**Quero contratar**: o bot pega cidade/bairro, nome e tipo de uso, indica o plano mais adequado e manda a arte dos planos (`midia/planos.jpg`). Os dados do interessado vão para `NUMERO_COMERCIAL` (ou `NUMERO_EQUIPE`). Os planos indicados ficam em `INDICACAO`, no começo de `src/fluxo.js`.

**Áudios**: o bot transcreve o áudio no próprio computador (Whisper local, sem custo e sem enviar nada para fora) e segue como se o cliente tivesse digitado. No suporte, a descrição falada vai transcrita para o técnico. O modelo (~80 MB no `whisper-base`) é baixado na primeira vez para a pasta `modelos`.

**Conversa natural**: mensagens seguidas ("oi" / "bom dia" / "tudo bem?") são respondidas uma vez só; "obrigado", "ok", 👍 ou figurinha recebem um "Por nada!"; reclamações sérias vão direto para uma pessoa; CPF mandado logo de cara é aproveitado; e, se o cliente para no meio do fluxo, o bot manda um lembrete (`LEMBRETE_MIN`).

**Palavras-chave**: o que o bot entende de texto livre (intenção, agradecimento, pedido de atendente e respostas para cada pergunta) fica em `src/entender.js` e nas `chave` das opções em `src/fluxo.js`. Gírias e abreviações comuns (vc, net, tô, obg, vlw, pfv, 2ª via...) são normalizadas. O `npm test` confere mais de 100 frases reais.

## Menu da equipe

Os números em `ATENDENTE_NUMEROS` (por exemplo, o atendente de um ponto de recebimento) recebem um menu próprio:

- **Fechar o caixa**: puxa do SGP os pagamentos do dia baixados pelos usuários em `CAIXA_USUARIOS_SGP` e manda um **PDF** com o total, a quantidade, o total por portador e a lista para conferência (hora, contrato, nome abreviado, portador e valor), com o resumo na legenda.
- **Avisar pré-cadastro**: pede o nome do cliente, o dia de vencimento e o plano, e registra o aviso para a equipe.
- **Falar com atendente**: passa a conversa para uma pessoa.

## Menu dos técnicos

Os números em `TECNICO_NUMEROS` recebem outro menu, com o técnico cumprimentado pelo nome (`5583999999999=Fulano`):

- **Consultar cliente**: pelo ID do SGP (número do contrato) ou CPF/CNPJ, mostra nome completo, endereço com número, ponto de referência, plano, telefones e se a conexão está online.
- **Ver se está online**: mostra 🟢 online / 🔴 offline de cada contrato do cliente.
- **Criar ocorrência**: pede o ID do SGP ou o CPF e a descrição, abre o chamado direto no SGP e responde com o protocolo.
- **Falar com atendente**: passa a conversa para uma pessoa.

Em qualquer passo, *0* volta ao menu.

## Como o atendente usa

- Quando o cliente pede atendente (ou manda foto ou comprovante), o bot avisa o cliente, deixa a conversa como **não lida** e fica em silêncio nessa conversa por 3h (`PAUSA_HUMANO_HORAS`).
- Quando o atendente responde uma conversa pelo celular, o bot sai dela automaticamente.
- `#bot` enviado pelo atendente na conversa religa o bot para aquele cliente; `#pausa` desliga. Os comandos são apagados da conversa sozinhos.
- Fora do horário de atendimento (`HORARIO_DIAS`, `HORARIO_TURNOS` e `HORARIO_TEXTO`), quem pede atendente recebe a mensagem com o horário.

## Segurança e LGPD

- **Identidade do titular**: nome, rua e ponto de referência só aparecem quando o WhatsApp é do titular (o número bate com um telefone do cadastro no SGP) ou quando a pessoa informa os 4 últimos dígitos de um telefone cadastrado. Sem isso, o atendimento segue mostrando só bairro e cidade.
- O cliente vê só o necessário: nome abreviado (Maria S. S.) e endereço sem número, complemento e CEP. O CPF aparece mascarado nas mensagens, na janela e no log.
- Um mesmo WhatsApp consulta até 3 CPFs/CNPJs diferentes por dia (`LIMITE_CPFS_DIA`).
- Os dados completos ficam só no resumo interno enviado para a equipe.
- O bot lembra o CPF/contrato de cada número e, na próxima vez, só pede confirmação. Esses dados e as conversas em andamento ficam em `dados/estado.json`, no próprio computador do bot.
- Não vão para o repositório (estão no `.gitignore`): `.env`, `.sessao`, `.wwebjs_cache`, `dados`, `logs`, `modelos`, `midia` e `qrcode.png`.

## Boas práticas de envio

O bot mostra "digitando…" com tempo variável antes de cada resposta, responde apenas a quem mandou mensagem, ignora grupos, status e avisos automáticos do WhatsApp, e não faz disparos em massa.

## Tecnologias

Node.js, [whatsapp-web.js](https://github.com/wwebjs/whatsapp-web.js) (conexão por QR code), API URA do SGP, Whisper local via `@huggingface/transformers` (transcrição de áudio), `ffmpeg-static` (conversão de áudio) e o navegador do próprio WhatsApp Web para gerar os PDFs.

## Instalar

1. Instale o **Node.js 20 ou mais novo** (nodejs.org, versão LTS).
2. Clone este repositório (ou baixe o ZIP) no computador do bot.
3. Copie `.env.example` para `.env` e preencha `SGP_URL`, `SGP_TOKEN` e `SGP_APP` (gerados no SGP em Administração > Integrações > Tokens). As outras opções estão explicadas no próprio arquivo.
4. Dê dois cliques em `instalar.bat` (ou rode `npm install`).
5. Coloque a arte dos planos em `midia/planos.jpg`.

## Testar sem WhatsApp (simulador)

- `npm run simular:mock` testa o fluxo com dados de exemplo. CPF de teste: `100.000.098-22` (2 contratos, um com fatura atrasada). Quando o bot pedir os 4 últimos dígitos do telefone, responda `0000`, ou defina `SIMULADOR_NUMERO=5583999990000` para simular o WhatsApp do titular.
- `npm run simular` (ou `simular.bat`) usa o SGP de verdade. Com `DEBUG=true` no `.env`, a janela mostra as respostas do SGP.
- Para testar os menus da equipe e dos técnicos, use o mesmo número em `SIMULADOR_NUMERO` e em `ATENDENTE_NUMEROS` ou `TECNICO_NUMEROS` (usuário de caixa de teste: `caixa.teste`). O PDF do fechamento fica salvo na pasta `dados`.

Comandos no simulador: `#humano` (atendente assume), `#bot` (religa), `#foto` (cliente manda imagem), `#audio C:\caminho\do\audio.ogg` (cliente manda áudio), `sair`.

## Rodar no WhatsApp

1. No `.env`, coloque seu número em `TESTE_NUMEROS` (ex.: `5583999999999`) para o bot responder só você enquanto testa.
2. Dê dois cliques em `iniciar.bat` (ou rode `npm start`).
3. No celular: WhatsApp > Aparelhos conectados > Conectar um aparelho > leia o QR (ele também fica salvo em `qrcode.png`).
4. A sessão fica salva na pasta `.sessao`, então o QR só é pedido uma vez.
5. Para atender todos os clientes, deixe `TESTE_NUMEROS` vazio.

## Deixar rodando direto

O `iniciar.bat` mantém o bot sempre ligado: se ele reiniciar, volta sozinho e responde o que chegou nesse intervalo. Para ele abrir junto com o computador:

1. Clique com o botão direito em `iniciar.bat` > **Criar atalho**.
2. Aperte `Windows + R`, digite `shell:startup` e dê Enter.
3. Mova o atalho criado para essa pasta.

## Log

Cada mensagem aparece na janela e fica salva em `logs/bot-AAAA-MM-DD.txt`: `[entrada]` (o que chegou e em que etapa), `[áudio]` (texto transcrito), `[entendi]` (intenção detectada), `[bot →]` (o que respondeu) e `[etapa]` (para onde a conversa foi). CPF e números longos aparecem mascarados, e os logs ficam só no computador do bot.

## Autor e licença

Projeto desenvolvido por **Talles Oliveira** ([github.com/talles1x](https://github.com/talles1x)).

© 2026 Talles Oliveira. Distribuído sob a **licença MIT**: você pode usar, copiar, modificar e distribuir este código, inclusive em projetos comerciais, desde que mantenha o aviso de copyright e a licença em todas as cópias ou partes substanciais. Os termos completos estão no arquivo [LICENSE](LICENSE).
