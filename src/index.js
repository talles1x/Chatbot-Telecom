// Copyright (c) 2026 Talles Oliveira (github.com/talles1x)
// Licença MIT: pode usar e modificar, mantendo este aviso de autoria. Veja o arquivo LICENSE.
// Chatbot Telecom - conexão com o WhatsApp por QR code (whatsapp-web.js)
// Correções na biblioteca do WhatsApp: precisam rodar antes de carregá-la
require('./correcoes').aplicar((m) => require('./log').registrar(m));
const path = require('path');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const { Client, LocalAuth, Poll, MessageMedia } = require('whatsapp-web.js');
const cfg = require('./config');
const u = require('./util');
const { criarFluxo } = require('./fluxo');
const { criarEstado } = require('./estado');
const { registrar, resumo } = require('./log');
const estado = criarEstado();
const audio = cfg.audio.ativo ? require('./audio') : null;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '..', '.sessao') }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  },
});

// Mensagens que o próprio bot está enviando (para não confundir com o atendente)
// (a chave é só o texto: o WhatsApp às vezes troca o ID do chat entre @c.us e @lid)
const enviandoAgora = new Map(); // texto -> quantidade
const chave = (_chatId, texto) => String(texto).trim();

// A partir de quando responder (segundos):
// - ligado por você (iniciar.bat aberto agora): só o que chegar a partir de agora;
// - reinício automático (o bot caiu e o iniciar.bat religou): responde também o que chegou
//   enquanto ele estava fora, desde o último momento em que estava funcionando.
const AGORA = Math.floor(Date.now() / 1000);
const reinicio = process.env.BOT_REINICIO === '1';
const vivoEm = estado.ler('vivoEm', 0);
const LIGADO_EM = reinicio && vivoEm && AGORA - vivoEm < 6 * 3600 ? vivoEm : AGORA;
if (!reinicio) {
  estado.gravar('sessoes', {}); // ligado por você: começa as conversas do zero
  // Modo teste: ao ligar, tira a pausa das conversas de teste (senão o bot fica calado com você)
  if (cfg.testeNumeros.length) {
    const pausados = estado.ler('pausados', {});
    for (const id of Object.keys(pausados)) {
      if (cfg.testeNumeros.includes(String(id).split('@')[0].replace(/\D/g, ''))) {
        estado.tirarPausa(id);
        console.log(`🧪 Pausa removida da conversa de teste ${id}`);
      }
    }
  }
}
// Marca de tempo em tempo que o bot está vivo
estado.gravar('vivoEm', AGORA);
setInterval(() => estado.gravar('vivoEm', Math.floor(Date.now() / 1000)), 30000).unref();

// O WhatsApp Web às vezes falha em ações "de enfeite" (lida, digitando) em conversas @lid.
// Elas nunca podem travar a resposta.
async function pegarChat(chatId) {
  try {
    return await client.getChatById(chatId);
  } catch (e) {
    if (cfg.debug) console.log(`[aviso] getChat ${chatId}: ${e.message}`);
    return null;
  }
}
async function marcarLida(chatId) {
  if (cfg.manterNaoLida) return; // atendente quer ver as conversas do bot como não lidas
  try {
    await client.sendSeen(chatId);
  } catch (e) {
    if (cfg.debug) console.log(`[aviso] sendSeen ${chatId}: ${e.message}`);
  }
}

// Depois que o bot responde, o WhatsApp marca a conversa como lida sozinho.
// Aqui ela volta a ficar NÃO LIDA, para o atendente enxergar no celular o que o bot atendeu.
async function marcarNaoLida(chatId) {
  if (!cfg.manterNaoLida) return;
  try {
    await comLimite(client.markChatUnread(chatId), 5000);
  } catch (e) {
    if (cfg.debug) console.log(`[aviso] marcar não lida ${chatId}: ${e.message}`);
  }
}

// Envia; se o WhatsApp recusar o ID @lid, tenta pelo número normal (@c.us)
async function mandar(chatId, conteudo, opcoes) {
  try {
    return await client.sendMessage(chatId, conteudo, opcoes);
  } catch (e) {
    if (!String(chatId).endsWith('@lid')) throw e;
    const numero = await numeroReal(chatId);
    if (!numero || numero === numeroDe(chatId)) throw e;
    console.log(`[aviso] envio para ${chatId} falhou (${e.message}), tentando ${numero}@c.us`);
    return client.sendMessage(`${numero}@c.us`, conteudo, opcoes);
  }
}

// LGPD: não deixa CPF/CNPJ aparecer inteiro na janela do bot
function ocultarDocs(t) {
  return String(t || '').replace(/\d[\d.\-\/ ]{9,17}\d/g, (m) => (m.replace(/\D/g, '').length >= 11 ? '***.***.***-**' : m));
}

// Baixa áudio/mídia. Em conversas @lid o download normal da biblioteca falha (erro "r") num passo
// interno do WhatsApp Web; nesse caso baixa e descriptografa direto com os dados da própria mensagem.
async function baixarMidia(msg) {
  try {
    const m = await comLimite(msg.downloadMedia(), 30000);
    if (m && m.data) return m;
  } catch (e) {
    registrar(`[áudio] download normal falhou (${e.message}), tentando direto...`);
  }
  const d = msg._data || {};
  if (!d.directPath || !d.mediaKey) {
    registrar('[áudio] mensagem sem dados de mídia para baixar');
    return null;
  }
  const r = await comLimite(
    client.pupPage.evaluate(async (info) => {
      const qpl = { addAnnotations() { return this; }, addPoint() { return this; } };
      const buf = await window.require('WAWebDownloadManager').downloadManager.downloadAndMaybeDecrypt({
        directPath: info.directPath,
        encFilehash: info.encFilehash,
        filehash: info.filehash,
        mediaKey: info.mediaKey,
        mediaKeyTimestamp: info.mediaKeyTimestamp,
        type: info.type,
        signal: new AbortController().signal,
        downloadQpl: qpl,
      });
      return { data: await window.WWebJS.arrayBufferToBase64Async(buf), mimetype: info.mimetype };
    }, {
      directPath: d.directPath, encFilehash: d.encFilehash, filehash: d.filehash, mediaKey: d.mediaKey,
      mediaKeyTimestamp: d.mediaKeyTimestamp, type: d.type, mimetype: d.mimetype,
    }),
    30000
  );
  return r && r.data ? r : null;
}

// Fila por conversa: as respostas de um cliente saem sempre em ordem
const filas = new Map();
function naFila(chatId, tarefa) {
  const anterior = filas.get(chatId) || Promise.resolve();
  const proxima = anterior
    .then(tarefa)
    .catch((e) => console.error(`[erro] ${chatId}:`, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e))
    .then(() => marcarNaoLida(chatId));
  filas.set(chatId, proxima);
  return proxima;
}

async function enviar(chatId, texto) {
  const chat = await pegarChat(chatId);
  // Simula alguém digitando, com tempo proporcional ao tamanho da mensagem
  const tempo = Math.min(cfg.delay.max, cfg.delay.min + texto.length * 15) + u.aleatorio(0, 600);
  if (chat) await chat.sendStateTyping().catch(() => {});
  await u.esperar(tempo);
  const k = chave(chatId, texto);
  enviandoAgora.set(k, (enviandoAgora.get(k) || 0) + 1);
  await mandar(chatId, texto);
  registrar(`[bot →] ${chatId}: "${resumo(texto, 100)}"`);
  if (chat) await chat.clearState().catch(() => {});
}

// Enquete ativa de cada conversa: só a última vale (votos em enquetes antigas são ignorados)
// (salvas em arquivo para os toques continuarem valendo depois de um reinício)
const enquetes = new Map(
  reinicio ? Object.entries(estado.ler('enquetes', {})).map(([id, e]) => [id, { msgId: e.msgId, opcoes: new Map(e.opcoes) }]) : []
); // chatId -> { msgId, opcoes: Map(texto -> valor) }
function salvarEnquetes() {
  const lista = {};
  for (const [id, e] of enquetes) lista[id] = { msgId: e.msgId, opcoes: [...e.opcoes] };
  estado.gravar('enquetes', lista);
}

async function perguntar(chatId, pergunta, opcoes) {
  const chat = await pegarChat(chatId);
  if (chat) await chat.sendStateTyping().catch(() => {});
  await u.esperar(u.aleatorio(cfg.delay.min, cfg.delay.max));
  // Opções numeradas: o cliente pode tocar OU digitar o número
  const nomes = opcoes.map((o, i) => `${i + 1} - ${o.texto}`.slice(0, 100));
  const enquete = new Poll(`${pergunta}\n_(toque na opção ou digite o número)_`, nomes, { allowMultipleAnswers: false });
  enviandoAgora.set('__enquete__', (enviandoAgora.get('__enquete__') || 0) + 1);
  const msg = await mandar(chatId, enquete);
  if (chat) await chat.clearState().catch(() => {});
  if (cfg.debug) console.log(`[enquete enviada] ${msg && msg.id ? msg.id._serialized : '?'}`);
  enquetes.set(chatId, {
    msgId: msg && msg.id ? msg.id._serialized : null,
    opcoes: new Map(opcoes.map((o, i) => [nomes[i], o.valor])),
  });
  salvarEnquetes();
}

// Envia uma imagem com legenda (ex.: arte dos planos). Se a imagem faltar, manda só o texto.
async function enviarImagem(chatId, arquivo, legenda) {
  let media = null;
  try {
    media = MessageMedia.fromFilePath(arquivo);
  } catch (e) {
    registrar(`[aviso] imagem ${arquivo} não encontrada, mandando só o texto`);
    return enviar(chatId, legenda);
  }
  const chat = await pegarChat(chatId);
  if (chat) await chat.sendStateTyping().catch(() => {});
  await u.esperar(u.aleatorio(cfg.delay.min, cfg.delay.max));
  const k = chave(chatId, legenda);
  enviandoAgora.set(k, (enviandoAgora.get(k) || 0) + 1);
  await mandar(chatId, media, { caption: legenda });
  registrar(`[bot →] ${chatId}: [imagem] "${resumo(legenda, 80)}"`);
  if (chat) await chat.clearState().catch(() => {});
}

// Gera um PDF a partir de HTML no navegador que o bot já usa (WhatsApp Web) e envia como documento
async function enviarPdf(chatId, html, nomeArquivo, legenda) {
  if (!client.pupBrowser) throw new Error('navegador do WhatsApp não está pronto (client.pupBrowser vazio)');
  // Cada etapa diz onde falhou, para o log mostrar a causa exata
  const etapa = async (nome, promessa) => {
    try { return await promessa; } catch (e) { throw new Error(`[${nome}] ${e && e.message ? e.message : e}`); }
  };
  const page = await etapa('abrir aba', client.pupBrowser.newPage());
  let pdf;
  try {
    await etapa('montar página', page.setContent(html, { waitUntil: 'load' }));
    pdf = await etapa('gerar PDF', comLimite(page.pdf({ format: 'A4', printBackground: true, margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' } }), 30000));
  } finally {
    await page.close().catch(() => {});
  }
  registrar(`[caixa] PDF gerado (${Math.round(pdf.length / 1024)} KB), enviando...`);
  const media = new MessageMedia('application/pdf', Buffer.from(pdf).toString('base64'), nomeArquivo);
  const chat = await pegarChat(chatId);
  if (chat) await chat.sendStateTyping().catch(() => {});
  await u.esperar(u.aleatorio(cfg.delay.min, cfg.delay.max));
  // Marca como envio do bot (legenda e nome do arquivo), para não confundir com o atendente
  for (const k of [chave(chatId, legenda), chave(chatId, nomeArquivo)]) enviandoAgora.set(k, (enviandoAgora.get(k) || 0) + 1);
  await etapa('enviar no WhatsApp', mandar(chatId, media, { caption: legenda, sendMediaAsDocument: true }));
  registrar(`[bot →] ${chatId}: [PDF ${nomeArquivo}] "${resumo(legenda, 80)}"`);
  if (chat) await chat.clearState().catch(() => {});
}

const fluxo = criarFluxo({
  enviarImagem,
  enviarPdf,
  estado,
  enviar,
  // Número real do cliente (converte @lid), usado para conferir se o WhatsApp é do titular
  numeroDoChat: (chatId) => numeroReal(chatId),
  // Enquete clicável só se USAR_ENQUETE=true (nesta versão do WhatsApp o toque não chega ao bot).
  // Padrão: menu numerado em texto, que funciona em qualquer celular.
  perguntar: process.env.USAR_ENQUETE === 'true' ? perguntar : undefined,
  // Deixa a conversa como "não lida" para o atendente ver no celular
  // Resumo da ocorrência (suporte) ou do interessado (venda) para a equipe
  aoOcorrencia: async (chatId, resumo, tipo) => {
    const numero = tipo === 'venda' ? cfg.numeroComercial || cfg.numeroEquipe : cfg.numeroEquipe;
    if (!numero) return;
    const destino = `${numero}@c.us`;
    const texto = `${resumo}\nWhatsApp do cliente: ${numeroDe(chatId)}`;
    enviandoAgora.set(chave(destino, texto), (enviandoAgora.get(chave(destino, texto)) || 0) + 1);
    await client.sendMessage(destino, texto);
  },
  aoTransferir: async (chatId) => {
    const chat = await client.getChatById(chatId).catch(() => null);
    if (chat && chat.markUnread) await chat.markUnread().catch(() => {});
  },
});

function numeroDe(chatId) {
  return String(chatId).split('@')[0].replace(/\D/g, '');
}

function deveIgnorar(msg) {
  const id = msg.from || '';
  if (id.endsWith('@g.us') || id.endsWith('@broadcast') || id.endsWith('@newsletter') || id === 'status@broadcast') return true;
  if (msg.isStatus) return true;
  // Só responde o que chegou DEPOIS que o bot foi ligado (nada do que ficou acumulado antes)
  if (msg.timestamp && msg.timestamp < LIGADO_EM) return true;
  return false;
}

async function numeroPermitido(msg) {
  if (!cfg.testeNumeros.length && !cfg.ignorarNumeros.length) return true;
  const numero = await numeroReal(msg.from, msg);
  if (contem(cfg.ignorarNumeros, numero)) return false;
  if (cfg.testeNumeros.length && !contem(cfg.testeNumeros, numero)) {
    registrar(`[ignorada] ${numero} não está em TESTE_NUMEROS (modo teste)`);
    return false;
  }
  return true;
}

// Evita que uma consulta ao WhatsApp Web que nunca responde trave o bot
function comLimite(promessa, ms) {
  return Promise.race([promessa, new Promise((_, rej) => setTimeout(() => rej(new Error(`sem resposta em ${ms / 1000}s`)), ms))]);
}

// Em contas novas o WhatsApp usa IDs "@lid" no lugar do número; aqui descobre o número de verdade
const cacheNumeros = new Map();
async function numeroReal(id, msg) {
  if (!String(id).endsWith('@lid')) return numeroDe(id);
  if (cacheNumeros.has(id)) return cacheNumeros.get(id);
  let numero = '';
  try {
    if (client.getContactLidAndPhone) {
      const [r] = await comLimite(client.getContactLidAndPhone([id]), 5000);
      if (r && r.pn) numero = numeroDe(r.pn);
    }
  } catch (e) { console.log('[aviso] não consegui achar o número do', id, '-', e.message); }
  if (!numero && msg) {
    const contato = await comLimite(msg.getContact(), 5000).catch(() => null);
    if (contato && contato.number) numero = String(contato.number).replace(/\D/g, '');
  }
  if (!numero) console.log(`[aviso] número real de ${id} não encontrado`);
  numero = numero || numeroDe(id);
  if (numero !== numeroDe(id)) console.log(`[número] ${id} = ${numero}`);
  cacheNumeros.set(id, numero);
  return numero;
}

// No Brasil o WhatsApp às vezes guarda o número sem o 9 (5583991234567 vira 558391234567)
function variantes(n) {
  const v = [n];
  if (/^55\d{2}9\d{8}$/.test(n)) v.push(n.slice(0, 4) + n.slice(5));
  if (/^55\d{2}\d{8}$/.test(n)) v.push(n.slice(0, 4) + '9' + n.slice(4));
  return v;
}
function contem(lista, numero) {
  return variantes(numero).some((n) => lista.includes(n));
}

// ---------- Eventos ----------
client.on('qr', async (qr) => {
  console.log('\nEscaneie o QR code abaixo no WhatsApp do celular (Aparelhos conectados > Conectar um aparelho):\n');
  qrcodeTerminal.generate(qr, { small: true });
  const arquivo = path.join(__dirname, '..', 'qrcode.png');
  await QRCode.toFile(arquivo, qr, { width: 400 }).catch(() => {});
  console.log(`\nSe o QR acima sair torto, abra a imagem: ${arquivo}\n`);
});

let pronto = false;
let vigia = null;
client.on('authenticated', () => {
  console.log('✅ Autenticado. A sessão fica salva, não vai pedir QR de novo.');
  console.log('⏳ Sincronizando as conversas do WhatsApp... (em número com muitas conversas pode levar alguns minutos)');
  clearTimeout(vigia);
  vigia = setTimeout(() => {
    if (pronto) return;
    console.log('\n⚠️ Está demorando mais que o normal para sincronizar.');
    console.log('   1) Confira se o celular da empresa está ligado e com internet.');
    console.log('   2) Se continuar parado, feche esta janela, apague a pasta ".wwebjs_cache" e abra o iniciar.bat de novo.\n');
  }, 4 * 60000);
});
client.on('loading_screen', (pct, msg) => console.log(`⏳ Carregando WhatsApp: ${pct}% ${msg || ''}`));
client.on('change_state', (estado) => console.log(`[estado do WhatsApp] ${estado}`));
client.on('auth_failure', (m) => console.error('❌ Falha na autenticação:', m, '\nApague a pasta .sessao e rode de novo.'));

client.on('ready', () => {
  registrar(`[config] áudio: ${cfg.audio.ativo ? 'LIGADO' : 'DESLIGADO (TRANSCREVER_AUDIO=false)'} | modo teste: ${cfg.testeNumeros.length ? cfg.testeNumeros.join(', ') : 'não (responde todos)'} | pausa atendente: ${cfg.pausaHumanoHoras}h | não lida: ${cfg.manterNaoLida ? 'sim' : 'não'}`);
  pronto = true;
  clearTimeout(vigia);
  if (audio) audio.preCarregar();
  console.log(`🤖 Bot ${cfg.empresa} no ar! ${cfg.sgp.mock ? '(SGP em modo MOCK, dados falsos)' : ''}`);
  if (cfg.testeNumeros.length) console.log(`🧪 MODO TESTE: respondendo só ${cfg.testeNumeros.join(', ')}`);
});

client.on('disconnected', (motivo) => {
  console.error('⚠️ Desconectado do WhatsApp:', motivo, '- tentando reconectar em 10s...');
  setTimeout(() => client.initialize().catch((e) => console.error(e.message)), 10000);
});

// ---------- Agrupar mensagens seguidas ----------
const pendentes = new Map(); // chatId -> { textos, timer, msg }
function agrupar(chatId, texto, msg) {
  const p = pendentes.get(chatId) || { textos: [] };
  clearTimeout(p.timer);
  p.textos.push(String(texto || '').trim());
  p.msg = msg;
  p.timer = setTimeout(() => descarregar(chatId), cfg.agruparMs);
  pendentes.set(chatId, p);
}
function descarregar(chatId) {
  const p = pendentes.get(chatId);
  if (!p) return;
  clearTimeout(p.timer);
  pendentes.delete(chatId);
  const textos = p.textos.filter(Boolean);
  if (!textos.length) return;
  // Se uma das mensagens é só um número/opção (ex.: "2"), ela vale como resposta
  const curta = textos.find((t) => /^\d{1,2}$/.test(t));
  const texto = curta && textos.length > 1 && textos.every((t) => t === curta || u.normalizar(t).length < 25) ? curta : textos.join('\n');
  naFila(chatId, async () => {
    await u.esperar(u.aleatorio(300, 900));
    await marcarLida(chatId);
    await fluxo.receber(chatId, texto);
  });
}

// Mensagem recebida de um cliente
client.on('message', async (msg) => {
  try {
    registrar(`[chegou] de ${msg.from} (${msg.type})`);
    if (msg.fromMe) return;
    if (deveIgnorar(msg)) {
      const atraso = msg.timestamp ? Math.round(Date.now() / 1000 - msg.timestamp) : '?';
      registrar(`[ignorada] ${msg.from} (${msg.type}) - grupo/status ou mensagem de antes do bot ligar (${atraso}s atrás)`);
      return;
    }
    // Avisos automáticos do WhatsApp (criptografia, conta comercial, chamada perdida, mensagem apagada...)
    if (!u.ehMensagemDoCliente(msg.type)) {
      registrar(`[ignorada] ${msg.from} (${msg.type}) - aviso do sistema do WhatsApp, não é mensagem do cliente`);
      return;
    }
    if (!(await numeroPermitido(msg))) return;

    const chatId = msg.from;
    if (fluxo.estaPausado(chatId)) {
      registrar(`[pausado] ${numeroDe(chatId)} está com o atendente, bot não responde (mande #bot nessa conversa pelo celular da empresa para religar)`);
      return;
    }

    // Figurinha conta como "👍" (geralmente é agradecimento)
    const ehTexto = msg.type === 'chat' || msg.type === 'sticker';
    const corpo = msg.type === 'sticker' ? '👍' : msg.body;
    const naoTexto = !ehTexto;
    const ehAudio = msg.type === 'ptt' || msg.type === 'audio';
    registrar(`[recebida] ${numeroDe(chatId)}: ${naoTexto ? `<${msg.type}>` : ocultarDocs(corpo)}`);

    // Texto: espera alguns segundos para juntar mensagens seguidas ("oi" / "bom dia" / "tudo bem?")
    if (ehTexto) {
      agrupar(chatId, corpo, msg);
      return;
    }
    descarregar(chatId); // texto pendente sai antes do áudio/foto

    naFila(chatId, async () => {
      // Marca como lida depois de um tempinho, como uma pessoa faria
      await u.esperar(u.aleatorio(800, 2000));
      await marcarLida(chatId);
      const chat = await pegarChat(chatId);

      // Áudio: transcreve no próprio computador e segue como se fosse texto
      if (ehAudio && audio) {
        try {
          if (chat) await chat.sendStateTyping().catch(() => {});
          registrar(`[áudio] ${numeroDe(chatId)}: baixando e transcrevendo...`);
          const midia = await baixarMidia(msg);
          if (!midia) registrar(`[áudio] ${numeroDe(chatId)}: não consegui baixar o áudio do WhatsApp`);
          const texto = midia ? await audio.transcrever(Buffer.from(midia.data, 'base64')) : null;
          if (texto) {
            registrar(`[áudio] ${numeroDe(chatId)}: ${ocultarDocs(texto)}`);
            return fluxo.receber(chatId, texto, { audio: true });
          }
          registrar(`[áudio] ${numeroDe(chatId)}: não entendi o áudio`);
        } catch (e) {
          registrar('[áudio] erro ao transcrever:', e.message, '- rode o instalar.bat e confira TRANSCREVER_AUDIO=true no .env');
        }
      }
      if (ehAudio) {
        if (!audio) registrar(`[áudio] ${numeroDe(chatId)}: transcrição desligada (TRANSCREVER_AUDIO=false no .env)`);
        return fluxo.receber(chatId, '', { audioFalhou: true });
      }
      await fluxo.receber(chatId, msg.body, { naoTexto, tipo: msg.type });
    });
  } catch (e) {
    console.error('[erro ao receber]', e.message);
  }
});

// Cliente tocou numa opção da enquete
client.on('vote_update', async (voto) => {
  try {
    const pai = voto.parentMessage;
    const escolhida = voto.selectedOptions && voto.selectedOptions[0];
    const paiId = pai && pai.id ? pai.id._serialized : '';
    if (cfg.debug) console.log(`[voto] de ${voto.voter} na enquete ${paiId}: ${escolhida ? escolhida.name : '(desmarcou)'}`);
    if (!escolhida) return; // desmarcou

    // Acha a conversa dessa enquete: pelo ID da mensagem (mais seguro) ou por quem votou
    let chatId = null;
    for (const [id, e] of enquetes) if (e.msgId && e.msgId === paiId) chatId = id;
    if (!chatId) {
      const candidatos = [voto.voter, pai && pai.to, pai && pai.id && pai.id.remote].filter(Boolean);
      chatId = candidatos.find((c) => enquetes.has(c));
    }
    if (!chatId) {
      if (cfg.debug) console.log('[voto] enquete antiga ou desconhecida, ignorando');
      return;
    }
    const ativa = enquetes.get(chatId);
    if (fluxo.estaPausado(chatId)) return;
    const valor = ativa.opcoes.get(escolhida.name);
    if (valor === undefined) return;
    enquetes.delete(chatId); // cada enquete vale uma resposta
    salvarEnquetes();
    registrar(`[enquete] ${numeroDe(chatId)}: ${escolhida.name}`);
    naFila(chatId, () => fluxo.receber(chatId, valor));
  } catch (e) {
    console.error('[erro na enquete]', e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e);
  }
});

// Quando o atendente encerrou cada conversa (para não pausar de novo com a despedida)
const encerradoEm = new Map();
const JANELA_DESPEDIDA_MS = 10 * 60000;

// Mensagem enviada pelo número da empresa (bot OU atendente no celular/WhatsApp Web)
client.on('message_create', async (msg) => {
  if (!msg.fromMe) return;
  if (msg.type === 'poll_creation') {
    // Enquete enviada pelo bot
    const q = enviandoAgora.get('__enquete__');
    if (q) {
      if (q > 1) enviandoAgora.set('__enquete__', q - 1);
      else enviandoAgora.delete('__enquete__');
    }
    return;
  }
  const chatId = msg.to;
  if (!chatId || chatId.endsWith('@g.us') || chatId.endsWith('@broadcast')) return;

  const k = chave(chatId, msg.body || '');
  const qtd = enviandoAgora.get(k);
  if (qtd) {
    // Foi o próprio bot
    if (qtd > 1) enviandoAgora.set(k, qtd - 1);
    else enviandoAgora.delete(k);
    return;
  }

  const comando = u.normalizar(msg.body);
  if (comando === '#bot') {
    fluxo.retomar(chatId);
    await msg.delete(true).catch(() => {}); // apaga o comando da conversa do cliente
    console.log(`[bot religado] ${numeroDe(chatId)}`);
    return;
  }
  // Atendente encerrou: o bot volta a atender esse cliente na próxima mensagem dele
  if (u.ehEncerramento(msg.body)) {
    fluxo.retomar(chatId);
    encerradoEm.set(chatId, Date.now());
    if (comando.startsWith('#')) await msg.delete(true).catch(() => {});
    registrar(`[atendimento encerrado] ${numeroDe(chatId)} - bot religado para esse cliente`);
    return;
  }
  if (comando === '#pausa') {
    fluxo.pausar(chatId);
    await msg.delete(true).catch(() => {});
    console.log(`[bot pausado] ${numeroDe(chatId)}`);
    return;
  }

  // Logo depois de encerrar, a despedida do atendente ("tenha um bom dia") não pausa o bot de novo
  if (Date.now() - (encerradoEm.get(chatId) || 0) < JANELA_DESPEDIDA_MS) return;
  encerradoEm.delete(chatId);

  // Atendente respondeu manualmente: o bot sai de cena nessa conversa
  if (!fluxo.estaPausado(chatId)) {
    fluxo.pausar(chatId);
    registrar(`[atendente assumiu] ${numeroDe(chatId)} - bot pausado por ${cfg.pausaHumanoHoras}h`);
  }
});

process.on('unhandledRejection', (e) => console.error('[erro]', e && e.message ? e.message : e));

console.log('Iniciando... (a primeira vez demora um pouco)');
client.initialize();
