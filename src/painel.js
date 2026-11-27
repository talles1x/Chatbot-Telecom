// Copyright (c) 2026 Talles Oliveira (github.com/talles1x)
// Licença MIT: pode usar e modificar, mantendo este aviso de autoria. Veja o arquivo LICENSE.
// Painel do bot no navegador (só no próprio computador: http://localhost:3210).
// Usa a MESMA conexão do WhatsApp do bot: conversas, painel do dia, configurações e QR code.
// Sem dependências extras: servidor http do Node e eventos ao vivo (Server-Sent Events).
const http = require('http');
const fs = require('fs');
const u = require('./util');
const { htmlFechamento } = require('./relatorio');
const nomeBonito = (n) => require('./fluxo').nomeBonito(n);
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ARQ_ENV = path.join(RAIZ, '.env');
const PASTA_LOGS = path.join(RAIZ, 'logs');

// Campos do .env que o painel deixa editar (o resto, como o token do SGP, fica só no arquivo)
const CAMPOS = [
  { chave: 'NUMERO_EQUIPE', rotulo: 'Número que recebe os avisos da equipe', ajuda: 'Resumos de suporte, fichas de cadastro e pedidos dos técnicos. Ex.: 5583999999999' },
  { chave: 'NUMERO_COMERCIAL', rotulo: 'Número que recebe os interessados em contratar', ajuda: 'Vazio = vai para o número da equipe' },
  { chave: 'ATENDENTE_NUMEROS', rotulo: 'Números da equipe (menu do caixa)', ajuda: 'Separados por vírgula' },
  { chave: 'TECNICO_NUMEROS', rotulo: 'Técnicos', ajuda: 'numero=Nome@usuario_do_sgp, separados por vírgula', lista: true },
  { chave: 'TECNICO_ADMINS', rotulo: 'Técnicos administradores', ajuda: 'Escolhem para qual técnico vai a O.S. Números separados por vírgula' },
  { chave: 'CAIXAS', rotulo: 'Caixas', ajuda: 'Nome|usuários do SGP|números, separados por ponto e vírgula', lista: true, separador: ';' },
  { chave: 'HORARIO_DIAS', rotulo: 'Dias de atendimento', ajuda: 'Ex.: 1-6 (segunda a sábado)' },
  { chave: 'HORARIO_TURNOS', rotulo: 'Horários de atendimento', ajuda: 'Ex.: 08:00-12:00,14:00-18:00' },
  { chave: 'HORARIO_TEXTO', rotulo: 'Horário (texto para o cliente)', ajuda: 'Ex.: segunda a sábado, das 8h às 18h' },
  { chave: 'PAUSA_HUMANO_HORAS', rotulo: 'Horas que o bot fica pausado quando o atendente assume', ajuda: 'Ex.: 3' },
];

const TIPOS = { image: '📷 Foto', audio: '🎤 Áudio', ptt: '🎤 Áudio', video: '🎬 Vídeo', document: '📄 Documento', sticker: '🙂 Figurinha', location: '📍 Localização', vcard: '👤 Contato', multi_vcard: '👤 Contatos', reaction: '👍 Reação', revoked: '🚫 Mensagem apagada', call_log: '📞 Ligação', poll_creation: '📊 Enquete', ciphertext: '⏳ Aguardando mensagem', gif: '🎬 GIF' };
// Linhas técnicas que só poluem o log do painel (status, grupos, chegada de cada mensagem)
const LOG_RUIDO = /\[ignorada\]|\[chegou\]|status@broadcast/;
const MIDIAS = ['image', 'video', 'sticker', 'ptt', 'audio', 'document', 'gif'];
const pareceBase64 = (t) => t.length > 120 && /^[A-Za-z0-9+/=\s]+$/.test(t.slice(0, 400));
// Texto que pode ser mostrado de uma mensagem (sem base64 de miniatura, sem VCARD cru)
function textoDaMensagem(m) {
  const corpo = String((m && m.body) || '');
  const tipo = m && m.type;
  if (/^BEGIN:VCARD/i.test(corpo)) {
    const nome = (corpo.match(/^FN:(.*)$/im) || [])[1];
    return `👤 Contato${nome ? `: ${nome.trim()}` : ''}`;
  }
  if (MIDIAS.includes(tipo) || pareceBase64(corpo)) {
    const legenda = tipo !== 'document' && !pareceBase64(corpo) && !['ptt', 'audio', 'sticker'].includes(tipo) ? corpo.trim() : '';
    return legenda;
  }
  return corpo;
}
function previa(m) {
  if (!m) return '';
  const texto = textoDaMensagem(m).replace(/\s+/g, ' ').trim();
  const rotulo = TIPOS[m.type] || (pareceBase64(String(m.body || '')) ? TIPOS.image : '');
  if (MIDIAS.includes(m.type) || /^👤/.test(texto)) return texto && !/^👤/.test(texto) ? `${rotulo} ${texto}`.slice(0, 90) : (texto || rotulo);
  return (texto || rotulo || '…').slice(0, 90);
}

function hojeArquivo() {
  const dia = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Fortaleza' });
  return path.join(PASTA_LOGS, `bot-${dia}.txt`);
}

// ---------- .env ----------
function lerEnv() {
  try { return fs.readFileSync(ARQ_ENV, 'utf-8'); } catch { return ''; }
}
function valorEnv(texto, chave) {
  const m = texto.match(new RegExp(`^${chave}=(.*)$`, 'm'));
  return m ? m[1].trim() : '';
}
function gravarEnv(novos) {
  let texto = lerEnv();
  fs.writeFileSync(`${ARQ_ENV}.bak`, texto); // cópia do anterior
  for (const [chave, valor] of Object.entries(novos)) {
    if (!CAMPOS.some((c) => c.chave === chave)) continue;
    const limpo = String(valor ?? '').replace(/[\r\n]+/g, ' ').trim();
    const re = new RegExp(`^${chave}=.*$`, 'm');
    texto = re.test(texto) ? texto.replace(re, `${chave}=${limpo}`) : `${texto.replace(/\s*$/, '')}\n${chave}=${limpo}\n`;
  }
  fs.writeFileSync(ARQ_ENV, texto);
}

// ---------- Painel do dia (contado no log de hoje) ----------
const METRICAS = [
  { chave: 'conversas', rotulo: 'Conversas novas', re: /\[entrada\].*etapa: \(nova conversa\)/ },
  { chave: 'boletos', rotulo: 'Boletos enviados', re: /\[bot →\].*Boleto com vencimento/ },
  { chave: 'liberacoes', rotulo: 'Liberações de confiança', re: /\[bot →\].*sua internet foi liberada/ },
  { chave: 'chamados', rotulo: 'Chamados de clientes', re: /\[bot →\].*Registrei seu chamado/ },
  { chave: 'atendente', rotulo: 'Passadas para atendente', re: /\[atendente\].*passou para o atendente|\[atendente assumiu\]/ },
  { chave: 'ocorrencias', rotulo: 'Ocorrências de técnicos', re: /\[técnico\].*abriu ocorrência/ },
  { chave: 'caixa', rotulo: 'Fechamentos de caixa', re: /\[caixa\].*\d+ pagamento\(s\), R\$/ },
  { chave: 'audios', rotulo: 'Áudios transcritos', re: /\[áudio\] [^:]+: (?!baixando|download|erro|mensagem sem)/ },
];
function painelDoDia() {
  let linhas = [];
  try { linhas = fs.readFileSync(hojeArquivo(), 'utf-8').split('\n'); } catch {}
  const contagem = METRICAS.map((m) => ({ chave: m.chave, rotulo: m.rotulo, valor: linhas.filter((l) => m.re.test(l)).length }));
  // Por hora: conversas novas de cada hora do dia
  const porHora = Array(24).fill(0);
  for (const l of linhas) if (METRICAS[0].re.test(l)) porHora[Number(l.slice(11, 13)) || 0]++;
  return { metricas: contagem, porHora, log: linhas.filter((l) => l && !LOG_RUIDO.test(l)).slice(-200) };
}

// Fotos de perfil dos clientes (guardadas na memória por 6h; sem foto/privada = iniciais no painel)
const FOTO_VALIDADE = 6 * 60 * 60 * 1000;
const fotos = new Map(); // chatId -> { em, foto: {tipo, dados} | null, promessa }
let fotosBuscando = 0;
const filaFotos = [];
function proximaFoto() {
  while (fotosBuscando < 3 && filaFotos.length) {
    const tarefa = filaFotos.shift();
    fotosBuscando++;
    tarefa().finally(() => { fotosBuscando--; proximaFoto(); });
  }
}
function buscarFoto(client, chatId) {
  const salvo = fotos.get(chatId);
  if (salvo && salvo.promessa) return salvo.promessa;
  if (salvo && Date.now() - salvo.em < FOTO_VALIDADE) return Promise.resolve(salvo.foto);
  const promessa = new Promise((resolve) => {
    filaFotos.push(async () => {
      let foto = null;
      try {
        const link = await Promise.race([client.getProfilePicUrl(chatId), new Promise((r) => setTimeout(r, 8000))]);
        if (link) {
          const r = await fetch(link, { signal: AbortSignal.timeout(10000) });
          if (r.ok) foto = { tipo: r.headers.get('content-type') || 'image/jpeg', dados: Buffer.from(await r.arrayBuffer()) };
        }
      } catch {}
      if (fotos.size > 500) fotos.delete(fotos.keys().next().value);
      fotos.set(chatId, { em: Date.now(), foto });
      resolve(foto);
    });
    proximaFoto();
  });
  fotos.set(chatId, { em: Date.now(), foto: salvo ? salvo.foto : null, promessa });
  return promessa;
}

function iniciarPainel({ client, fluxo, cfg, registrar, conexao, numeroDeChat, atendimento, sgp, estado, MessageMedia, enviarComoBot }) {
  const nomes = new Map(); // chatId -> nome do contato (para a busca e a fila)
  // Números da equipe (técnicos, caixas, atendentes, avisos): ficam no filtro "Equipe", fora dos clientes
  const numerosEquipe = new Set([
    ...cfg.tecnicos.map((t) => t.numero), ...(cfg.tecnicoAdmins || []), ...(cfg.atendentesNumeros || []),
    ...(cfg.caixas || []).flatMap((c) => c.numeros || []), cfg.numeroEquipe, cfg.numeroComercial,
  ].map((n) => String(n || '').replace(/\D/g, '').slice(-8)).filter((n) => n.length === 8));
  const numeroDaEquipe = new Map(); // chatId -> bool (o número real do @lid é resolvido uma vez)
  function ehEquipe(id) {
    if (numeroDaEquipe.has(id)) return numeroDaEquipe.get(id);
    const direto = String(id).endsWith('@c.us') ? String(id).split('@')[0] : '';
    if (direto) { const r = numerosEquipe.has(direto.slice(-8)); numeroDaEquipe.set(id, r); return r; }
    Promise.resolve(numeroDeChat(id)).then((n) => numeroDaEquipe.set(id, numerosEquipe.has(String(n || '').replace(/\D/g, '').slice(-8)))).catch(() => {});
    return false;
  }
  const porta = Number(process.env.PAINEL_PORTA || 3210);
  const fotoDe = (id) => (id && /@(c\.us|lid)$/.test(id) ? buscarFoto(client, id) : Promise.resolve(null));
  if (/^(0|false|nao|não)$/i.test(process.env.PAINEL || '')) return null;
  const html = () => fs.readFileSync(path.join(__dirname, 'painel.html'));

  // ---------- Eventos ao vivo ----------
  const clientes = new Set();
  function emitir(tipo, dados) {
    const linha = `event: ${tipo}\ndata: ${JSON.stringify(dados)}\n\n`;
    for (const res of clientes) res.write(linha);
  }
  // Novas linhas do log de hoje
  let tamanho = 0;
  let arquivoAtual = '';
  setInterval(() => {
    if (!clientes.size) return;
    const arq = hojeArquivo();
    if (arq !== arquivoAtual) { arquivoAtual = arq; tamanho = 0; }
    fs.stat(arq, (e, st) => {
      if (e || st.size <= tamanho) return;
      if (!tamanho) { tamanho = st.size; return; }
      const fluxoArq = fs.createReadStream(arq, { start: tamanho, end: st.size - 1, encoding: 'utf-8' });
      let novo = '';
      fluxoArq.on('data', (c) => { novo += c; });
      fluxoArq.on('end', () => { novo.split('\n').filter((l) => l && !LOG_RUIDO.test(l)).forEach((l) => emitir('log', l)); });
      tamanho = st.size;
    });
  }, 1000);
  client.on('message_create', (m) => { if (!m.isStatus && !String(m.from || '').endsWith('@g.us')) emitir('mensagem', { chat: m.fromMe ? m.to : m.from }); });
  client.on('message', (m) => { if (!m.isStatus && !String(m.from || '').endsWith('@g.us')) emitir('mensagem', { chat: m.from, cliente: true, naFila: Boolean(atendimento.ticket(m.from)) }); });

  // ---------- Conversas ----------
  async function listarConversas() {
    const chats = await client.getChats();
    const lista = chats
      .filter((c) => !c.isGroup && !String(c.id._serialized).includes('status') && !String(c.id._serialized).endsWith('@newsletter'))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, 80);
    // Quem está na fila aparece mesmo se a conversa for antiga
    for (const t of atendimento.fila()) {
      if (!lista.some((c) => c.id._serialized === t.chatId)) {
        const c = chats.find((x) => x.id._serialized === t.chatId);
        if (c) lista.push(c);
      }
    }
    return Promise.all(lista.map(async (c) => {
      const id = c.id._serialized;
      const ultima = c.lastMessage || {};
      if (c.name) nomes.set(id, c.name);
      const numero = await Promise.resolve(numeroDeChat(id)).catch(() => '');
      if (numero) numeroDaEquipe.set(id, numerosEquipe.has(String(numero).replace(/\D/g, '').slice(-8)));
      return {
        id,
        nome: c.name || '',
        ticket: atendimento.ticket(id),
        etiquetas: atendimento.etiquetasDe(id),
        numero,
        ultima: previa(ultima),
        deMim: Boolean(ultima.fromMe),
        hora: c.timestamp || 0,
        naoLidas: Math.max(0, c.unreadCount || 0), // o WhatsApp usa -1 para "marcada como não lida"
        marcadaNaoLida: (c.unreadCount || 0) < 0,
        equipe: ehEquipe(id),
        nomeSgp: atendimento.nomeSgp(id),
        pausado: fluxo.estaPausado(id),
      };
    }));
  }
  // Mensagem respondida (citada): texto curto e de quem é
  function citadaDe(m) {
    const q = m.hasQuotedMsg && m._data && m._data.quotedMsg;
    if (!q) return undefined;
    const eu = client.info && client.info.wid && client.info.wid._serialized;
    const autor = m._data.quotedParticipant && (m._data.quotedParticipant._serialized || m._data.quotedParticipant);
    return { id: m._data.quotedStanzaID || '', corpo: previa(q) || TIPOS[q.type] || 'Mensagem', deMim: Boolean(eu && autor && String(autor).split('@')[0] === String(eu).split('@')[0]) };
  }
  async function mensagensDe(id) {
    const chat = await client.getChatById(id);
    const msgs = await chat.fetchMessages({ limit: 50 });
    return {
      id,
      nome: chat.name || '',
      numero: await Promise.resolve(numeroDeChat(id)).catch(() => ''),
      pausado: fluxo.estaPausado(id),
      pausaAte: fluxo.estaPausado(id) ? estado.pausaAte(id) : null,
      equipe: ehEquipe(id),
      nomeSgp: atendimento.nomeSgp(id),
      ticket: atendimento.ticket(id),
      etiquetas: atendimento.etiquetasDe(id),
      notas: atendimento.notasDe(id),
      mensagens: msgs.filter((m) => m.type !== 'e2e_notification' && m.type !== 'notification_template').map((m) => ({
        id: m.id && m.id._serialized,
        apagada: m.type === 'revoked',
        editada: Boolean(m.latestEditMsgKey || (m._data && (m._data.latestEditMsgKey || m._data.latestEditSenderTimestampMs))),
        citada: citadaDe(m),
        midia: Boolean(m.hasMedia),
        arquivo: m._data && (m._data.filename || ''),
        mime: m._data && (m._data.mimetype || ''),
        deMim: m.fromMe,
        corpo: textoDaMensagem(m),
        tipo: m.type,
        transcricao: ['ptt', 'audio'].includes(m.type) && m.id ? atendimento.transcricao(m.id._serialized) : undefined,
        hora: m.timestamp,
        ack: m.ack,
      })),
    };
  }

  // ---------- Ficha do cliente no SGP ----------
  const ipAvisado = new Set();
  async function ficha(id, docInformado) {
    const lembrado = estado.cliente(id) || {};
    const busca = String(docInformado || '').replace(/\D/g, '');
    let contratos = [];
    let peloTelefone = false;
    if (busca && busca.length <= 7) contratos = await sgp.consultarContrato(busca);
    else if (busca || lembrado.doc) contratos = await sgp.consultarCliente(busca || lembrado.doc);
    // Sem CPF: tenta achar pelo número do WhatsApp (só aceita se o telefone estiver no cadastro)
    if (!contratos.length && !busca) {
      const numero = await Promise.resolve(numeroDeChat(id)).catch(() => '');
      contratos = await sgp.consultarTelefone(numero).catch(() => []);
      peloTelefone = contratos.length > 0;
    }
    if (!contratos.length) return { encontrado: false, doc: busca || lembrado.doc || '', tentouTelefone: !busca };
    const escolhido = contratos.find((c) => String(c.id) === String(lembrado.contrato)) || contratos[0];
    const [faturas, online, ip] = await Promise.all([
      sgp.titulosAbertos(busca.length > 7 ? busca : (lembrado.doc || ''), escolhido.id).catch(() => []),
      sgp.verificarAcesso(escolhido.id).catch(() => null),
      escolhido.ip ? escolhido.ip : Promise.race([sgp.ipDoContrato(escolhido.id), new Promise((r) => setTimeout(() => r(''), 8000))]).catch((e) => { registrar(`[painel] não consegui buscar o IP do contrato ${escolhido.id} no SGP: ${e.message}`); return ''; }),
    ]);
    if (ip) escolhido.ip = ip;
    else if (!ipAvisado.has(escolhido.id)) { ipAvisado.add(escolhido.id); registrar(`[painel] o SGP não devolveu IP para o contrato ${escolhido.id}`); }
    atendimento.lembrarNomeSgp(id, escolhido.nome);
    return {
      encontrado: true,
      peloTelefone,
      doc: busca || lembrado.doc || '',
      contrato: escolhido,
      outros: contratos.filter((c) => c !== escolhido).map((c) => ({ id: c.id, status: c.status, endereco: c.endereco })),
      faturas: faturas.slice(0, 100).map((f) => ({ vencimento: f.vencimento, valor: f.valor, link: f.link, pix: f.pix, linha: f.linha, acordo: Boolean(f.acordo) })),
      hoje: u.agoraLocal().hojeISO,
      online,
    };
  }

  // ---------- Servidor ----------
  const responder = (res, codigo, dados, tipo = 'application/json; charset=utf-8') => {
    res.writeHead(codigo, { 'Content-Type': tipo, 'Cache-Control': 'no-store' });
    res.end(tipo.startsWith('application/json') ? JSON.stringify(dados) : dados);
  };
  const corpo = (req) => new Promise((ok, falha) => {
    let t = '';
    req.on('data', (c) => { t += c; if (t.length > 25e6) req.destroy(); }); // arquivos até ~16 MB
    req.on('end', () => { try { ok(t ? JSON.parse(t) : {}); } catch (e) { falha(e); } });
  });

  const servidor = http.createServer(async (req, res) => {
    try {
      // Só aceita quem abriu pelo próprio computador (evita sites de fora mandarem comandos)
      const host = String(req.headers.host || '').split(':')[0];
      if (!['localhost', '127.0.0.1'].includes(host)) return responder(res, 403, { erro: 'acesso só pelo computador do bot' });
      const url = new URL(req.url, 'http://localhost');
      const rota = `${req.method} ${url.pathname}`;
      if (req.method === 'POST' && req.headers['x-painel'] !== '1') return responder(res, 403, { erro: 'pedido sem a marca do painel' });

      if (rota === 'GET /') return responder(res, 200, html(), 'text/html; charset=utf-8');
      if (rota === 'GET /api/status') {
        return responder(res, 200, {
          estado: conexao.estado, qr: conexao.qr, desde: conexao.desde, empresa: cfg.empresa,
          numero: (client.info && client.info.wid && client.info.wid.user) || '',
          mock: cfg.sgp.mock,
        });
      }
      if (rota === 'GET /api/eventos') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write('retry: 3000\n\n');
        clientes.add(res);
        const pulso = setInterval(() => res.write(': ok\n\n'), 25000);
        req.on('close', () => { clearInterval(pulso); clientes.delete(res); });
        return undefined;
      }
      if (rota === 'GET /api/dia') return responder(res, 200, painelDoDia());
      if (rota === 'GET /api/conversas') {
        if (conexao.estado !== 'conectado') return responder(res, 200, []);
        return responder(res, 200, await listarConversas());
      }
      if (rota === 'GET /api/conversa') return responder(res, 200, await mensagensDe(url.searchParams.get('id')));
      if (rota === 'POST /api/enviar') {
        const pedido = await corpo(req);
        const { id, arquivo, atendente, responder: citar } = pedido;
        let { texto } = pedido;
        if (!id || (!String(texto || '').trim() && !arquivo)) return responder(res, 400, { erro: 'faltou a conversa ou o texto' });
        // Assinatura com o nome de quem está atendendo (opção em Configurações › Atendentes)
        if (atendente && atendimento.assinar() && String(texto || '').trim()) texto = `*${String(atendente).trim()}:*\n${String(texto).trim()}`;
        // Mensagem do atendente: o bot sai de cena nessa conversa (igual responder pelo celular)
        if (arquivo && arquivo.base64) {
          const media = new MessageMedia(arquivo.tipo || 'application/octet-stream', arquivo.base64, arquivo.nome || 'arquivo');
          const ehDoc = !/^image\/|^video\//.test(arquivo.tipo || '');
          await client.sendMessage(id, media, { caption: String(texto || '').trim() || undefined, sendMediaAsDocument: ehDoc, ...(citar ? { quotedMessageId: citar } : {}) });
        } else {
          await client.sendMessage(id, String(texto).trim(), citar ? { quotedMessageId: citar } : {});
        }
        if (atendente && atendimento.ticket(id)) atendimento.respondeu(id, { atendente });
        registrar(`[painel] ${atendente ? String(atendente).trim() : 'atendente'} respondeu pelo painel`);
        return responder(res, 200, { ok: true });
      }
      if (rota === 'POST /api/pausar' || rota === 'POST /api/assumir') {
        const { id, atendente } = await corpo(req);
        fluxo.pausar(id);
        atendimento.assumir(id, { numero: await Promise.resolve(numeroDeChat(id)).catch(() => ''), nome: nomes.get(id) || '', atendente });
        registrar(`[painel] ${atendente ? String(atendente).trim() : 'atendente'} assumiu uma conversa pelo painel`);
        emitir('mensagem', { chat: id });
        return responder(res, 200, { ok: true });
      }
      if (rota === 'POST /api/religar' || rota === 'POST /api/encerrar') {
        const { id, avisar, atendente } = await corpo(req);
        const t = atendimento.ticket(id);
        if (avisar && t) {
          await enviarComoBot(id, atendimento.textoEncerramento().replace(/\{protocolo\}/g, t.protocolo)).catch(() => {});
        }
        fluxo.retomar(id);
        atendimento.encerrar(id, rota.endsWith('encerrar') ? 'encerrado no painel' : 'bot religado no painel', atendente);
        registrar(`[painel] atendimento ${t ? t.protocolo : ''} encerrado pelo painel${atendente ? ` por ${String(atendente).trim()}` : ''}, bot religado`);
        emitir('mensagem', { chat: id });
        return responder(res, 200, { ok: true });
      }
      if (rota === 'GET /api/midia') {
        const m = await client.getMessageById(url.searchParams.get('id'));
        const media = m && (await m.downloadMedia().catch(() => null));
        if (!media || !media.data) return responder(res, 404, { erro: 'mídia não disponível' });
        res.writeHead(200, { 'Content-Type': media.mimetype || 'application/octet-stream', 'Cache-Control': 'private, max-age=86400' });
        return res.end(Buffer.from(media.data, 'base64'));
      }
      if (rota === 'GET /api/foto') {
        const foto = await fotoDe(url.searchParams.get('id'));
        if (!foto) { res.writeHead(404, { 'Cache-Control': 'private, max-age=3600' }); return res.end(); }
        res.writeHead(200, { 'Content-Type': foto.tipo, 'Cache-Control': 'private, max-age=21600' });
        return res.end(foto.dados);
      }
      if (rota === 'POST /api/etiquetas') {
        const { id, etiquetas } = await corpo(req);
        atendimento.etiquetar(id, etiquetas || []);
        return responder(res, 200, { ok: true });
      }
      if (rota === 'POST /api/nota') {
        const { id, texto, apagar, atendente } = await corpo(req);
        if (apagar) atendimento.apagarNota(id, apagar);
        else if (String(texto || '').trim()) atendimento.anotar(id, texto.trim(), atendente);
        return responder(res, 200, { notas: atendimento.notasDe(id) });
      }
      if (rota === 'GET /api/ficha') {
        return responder(res, 200, await ficha(url.searchParams.get('id'), url.searchParams.get('doc')).catch((e) => ({ encontrado: false, erro: e.message })));
      }
      // Ações do atendente na ficha (cliente já identificado)
      // Boleto do cliente: igual o bot manda (texto + PIX copia e cola + código de barras, cada um sozinho para copiar)
      // ---------- Ações nas mensagens (iguais às do WhatsApp) ----------
      if (rota === 'POST /api/mensagem') {
        const { msgId, acao, texto, para, atendente } = await corpo(req);
        const msg = msgId ? await client.getMessageById(msgId).catch(() => null) : null;
        if (!msg) return responder(res, 404, { erro: 'mensagem não encontrada (pode ser antiga demais)' });
        const quem = atendente ? ` por ${String(atendente).trim()}` : '';
        if (acao === 'editar') {
          if (!msg.fromMe) return responder(res, 400, { erro: 'só dá para editar mensagens enviadas por nós' });
          if (!String(texto || '').trim()) return responder(res, 400, { erro: 'o texto ficou vazio' });
          if (Date.now() / 1000 - msg.timestamp > 15 * 60) return responder(res, 400, { erro: 'o WhatsApp só deixa editar até 15 minutos depois de enviar' });
          const r = await msg.edit(String(texto).trim());
          if (!r) return responder(res, 400, { erro: 'o WhatsApp não aceitou a edição' });
          registrar(`[painel] mensagem editada${quem}`);
          return responder(res, 200, { ok: true });
        }
        if (acao === 'apagar') {
          if (!msg.fromMe) return responder(res, 400, { erro: 'só dá para apagar para todos as mensagens enviadas por nós' });
          await msg.delete(true);
          registrar(`[painel] mensagem apagada para todos${quem}`);
          return responder(res, 200, { ok: true });
        }
        if (acao === 'encaminhar') {
          if (!para) return responder(res, 400, { erro: 'escolha para quem encaminhar' });
          await msg.forward(para);
          registrar(`[painel] mensagem encaminhada${quem}`);
          return responder(res, 200, { ok: true });
        }
        return responder(res, 400, { erro: 'ação desconhecida' });
      }
      if (rota === 'POST /api/enviar-boleto') {
        const { id, fatura, atendente } = await corpo(req);
        if (!id || !fatura) return responder(res, 400, { erro: 'faltou a conversa ou o boleto' });
        const moeda = (v) => Number(String(v ?? 0).replace(',', '.')).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        const data = (d) => { const m = String(d || '').match(/(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(d || ''); };
        const msgs = [`📄 *Boleto com vencimento em ${data(fatura.vencimento)}*\nValor: *${moeda(fatura.valor)}*${fatura.link ? `\n\nBoleto em PDF: ${fatura.link}` : ''}`];
        if (fatura.pix) msgs.push('💠 *PIX copia e cola* (toque e segure a próxima mensagem para copiar):', String(fatura.pix));
        if (fatura.linha) msgs.push('🔢 *Código de barras* (para pagar no app do banco ou na lotérica):', String(fatura.linha));
        for (const m of msgs) {
          await client.sendMessage(id, m);
          await new Promise((r) => setTimeout(r, 700));
        }
        if (atendimento.ticket(id)) atendimento.respondeu(id, { atendente });
        registrar(`[painel] boleto (venc. ${data(fatura.vencimento)}${fatura.pix ? ' + PIX' : ''}${fatura.linha ? ' + código de barras' : ''}) enviado${atendente ? ` por ${String(atendente).trim()}` : ''}`);
        return responder(res, 200, { ok: true, enviadas: msgs.length });
      }
      // ---------- Fechamento de caixa pelo painel ----------
      if (rota === 'GET /api/caixas') {
        return responder(res, 200, { hoje: u.agoraLocal().hojeISO, caixas: cfg.caixas.map((c, i) => ({ i, nome: c.nome || `Caixa ${i + 1}`, usuarios: c.usuarios || [] })) });
      }
      if (rota === 'GET /api/caixa/pagamentos') {
        const caixa = cfg.caixas[Number(url.searchParams.get('caixa'))];
        const data = String(url.searchParams.get('data') || '').slice(0, 10);
        if (!caixa) return responder(res, 400, { erro: 'escolha o caixa' });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return responder(res, 400, { erro: 'data inválida' });
        if (!(caixa.usuarios || []).length) return responder(res, 400, { erro: `o caixa "${caixa.nome}" está sem usuário do SGP no .env (CAIXAS)` });
        const pagos = await sgp.titulosPagos(data);
        const usuarios = caixa.usuarios.map((x) => x.toLowerCase());
        const lista = pagos.filter((p) => usuarios.includes(String(p.usuario).toLowerCase()))
          .sort((a, b) => a.data.localeCompare(b.data) || String(a.id).localeCompare(String(b.id)))
          .map((p) => ({ id: p.id, hora: (p.data.match(/(\d{2}:\d{2})/) || [])[1] || '', contrato: p.contrato, cliente: nomeBonito(p.cliente || ''), cpf: p.cpf ? u.formatarDoc(p.cpf) : '', forma: p.forma, portador: p.portador, usuario: p.usuario, valor: p.valor }));
        const compartilhado = cfg.caixas.some((c) => c !== caixa && (c.usuarios || []).some((x) => usuarios.includes(String(x).toLowerCase())));
        return responder(res, 200, { caixa: caixa.nome, usuarios: caixa.usuarios, data, compartilhado, pagamentos: lista });
      }
      if (rota === 'POST /api/caixa/fechamento') {
        const { caixa: ci, data, pagamentos, atendente } = await corpo(req);
        const caixa = cfg.caixas[Number(ci)];
        if (!caixa || !Array.isArray(pagamentos)) return responder(res, 400, { erro: 'faltou o caixa ou os pagamentos' });
        const agrupar = (campo, vazio) => {
          const m = {};
          for (const p of pagamentos) { const k = p[campo] || vazio; m[k] = m[k] || { nome: k, n: 0, v: 0 }; m[k].n++; m[k].v += Number(p.valor) || 0; }
          return Object.values(m).sort((a, b) => b.v - a.v);
        };
        const porPortador = agrupar('portador', 'Sem portador');
        const hojeISO = u.agoraLocal().hojeISO;
        const hora = new Date().toLocaleTimeString('pt-BR', { timeZone: cfg.fuso, hour: '2-digit', minute: '2-digit' });
        const html = htmlFechamento({
          empresa: cfg.empresa, local: caixa.nome, data: u.dataBR(data), hora: data === hojeISO ? hora : 'dia inteiro', usuarios: caixa.usuarios,
          pagamentos, total: pagamentos.reduce((s2, p) => s2 + (Number(p.valor) || 0), 0),
          porForma: agrupar('forma', 'Não informada'), porPortador: porPortador.length > 1 ? porPortador : [],
          geradoEm: `${u.dataBR(hojeISO)} às ${hora}${atendente ? ` por ${String(atendente).trim()}` : ''} (painel)`,
        });
        registrar(`[caixa] fechamento pelo painel: ${caixa.nome} ${u.dataBR(data)} - ${pagamentos.length} pagamento(s)${atendente ? ` por ${String(atendente).trim()}` : ''}`);
        return responder(res, 200, { html });
      }
      if (rota === 'POST /api/liberar') {
        const { contrato, atendente } = await corpo(req);
        if (!contrato) return responder(res, 400, { erro: 'faltou o contrato' });
        const r = await sgp.liberarPromessa(contrato);
        registrar(`[painel] liberação de confiança do contrato ${contrato} pedida${atendente ? ` por ${String(atendente).trim()}` : ''}: ${r.ok ? 'liberada' : `negada ${r.mensagem || ''}`}`);
        return responder(res, 200, r);
      }
      if (rota === 'POST /api/chamado') {
        const { id, contrato, texto, atendente } = await corpo(req);
        if (!contrato || !String(texto || '').trim()) return responder(res, 400, { erro: 'faltou o contrato ou a descrição' });
        const numero = await Promise.resolve(numeroDeChat(id)).catch(() => '');
        const conteudo = `${String(texto).trim()}\n\nAberto pelo painel${atendente ? ` por ${String(atendente).trim()}` : ''}.`;
        const r = await sgp.criarChamado(contrato, conteudo, { contatoNome: atendimento.nomeSgp(id) || nomes.get(id) || '', contatoTelefone: numero });
        registrar(`[painel] ocorrência no contrato ${contrato}${atendente ? ` por ${String(atendente).trim()}` : ''}: ${r.ok ? `aberta ${r.protocolo || ''}` : `não abriu ${r.mensagem || ''}`}`);
        if (r.ok) atendimento.anotar(id, `Ocorrência aberta no SGP${r.protocolo ? ` (protocolo ${r.protocolo})` : ''}: ${String(texto).trim()}`, atendente);
        return responder(res, 200, r);
      }
      if (rota === 'GET /api/busca') {
        const achados = atendimento.buscar(url.searchParams.get('q') || '');
        return responder(res, 200, achados.map((a) => ({ ...a, nome: nomes.get(a.chatId) || '' })));
      }
      if (rota === 'GET /api/fila') {
        return responder(res, 200, atendimento.fila().map((t) => ({ ...t, nome: t.nome || nomes.get(t.chatId) || atendimento.nomeSgp(t.chatId) || '', etiquetas: atendimento.etiquetasDe(t.chatId) })));
      }
      if (rota === 'GET /api/relatorio') {
        return responder(res, 200, atendimento.relatorio(Math.min(365, Math.max(1, Number(url.searchParams.get('dias')) || 7)), url.searchParams.get('atendente') || ''));
      }
      if (rota === 'GET /api/agendadas') return responder(res, 200, atendimento.agendadas().map((a) => ({ ...a, nome: a.nome || nomes.get(a.chatId) || '' })));
      if (rota === 'POST /api/agendadas') {
        const { id, texto, quando, cancelar } = await corpo(req);
        if (cancelar) { atendimento.cancelarAgendada(cancelar); return responder(res, 200, { ok: true }); }
        if (!id || !String(texto || '').trim() || !(Number(quando) > Date.now())) return responder(res, 400, { erro: 'escolha a conversa, o texto e uma data no futuro' });
        return responder(res, 200, atendimento.agendar({ chatId: id, nome: nomes.get(id) || '', texto: texto.trim(), quando }));
      }
      if (rota === 'GET /api/atendimento-config') {
        return responder(res, 200, { respostas: atendimento.respostas(), etiquetas: atendimento.etiquetas(), textoEncerramento: atendimento.textoEncerramento(), atendentes: atendimento.atendentes(), assinar: atendimento.assinar() });
      }
      if (rota === 'POST /api/atendimento-config') {
        atendimento.configurar(await corpo(req));
        return responder(res, 200, { ok: true });
      }
      if (rota === 'GET /api/textos') return responder(res, 200, require('./fluxo').listarTextos());
      if (rota === 'POST /api/textos') {
        require('./fluxo').salvarTextos(await corpo(req));
        registrar('[painel] textos do bot alterados pelo painel');
        return responder(res, 200, { ok: true });
      }
      if (rota === 'GET /api/config') {
        const texto = lerEnv();
        return responder(res, 200, CAMPOS.map((c) => ({ ...c, valor: valorEnv(texto, c.chave) })));
      }
      if (rota === 'POST /api/config') {
        gravarEnv(await corpo(req));
        registrar('[painel] configurações alteradas pelo painel (valem depois de reiniciar)');
        return responder(res, 200, { ok: true });
      }
      if (rota === 'POST /api/reiniciar') {
        registrar('[painel] reiniciando o bot pelo painel');
        responder(res, 200, { ok: true });
        // Fecha o Chrome do WhatsApp direitinho e sai; o iniciar.bat liga o bot de novo sozinho
        setTimeout(() => {
          Promise.race([Promise.resolve().then(() => client.destroy()), new Promise((r) => setTimeout(r, 6000))])
            .catch(() => {})
            .finally(() => process.exit(0));
        }, 500);
        return undefined;
      }
      return responder(res, 404, { erro: 'não encontrado' });
    } catch (e) {
      return responder(res, 500, { erro: e.message });
    }
  });
  let tentouLiberar = false;
  servidor.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && !tentouLiberar) {
      tentouLiberar = true;
      if (require('./instancia').liberarPorta(porta, registrar)) { servidor.listen(porta, '127.0.0.1'); return; }
    }
    if (e.code === 'EADDRINUSE') {
      registrar(`[painel] a porta ${porta} já está em uso: provavelmente OUTRO BOT já está aberto`);
      console.error(`\n⚠️  Parece que já tem outro bot aberto (o painel dele está usando a porta ${porta}).`);
      console.error('   Dois bots no mesmo WhatsApp respondem o cliente em dobro. Feche TODAS as janelas "Chatbot Telecom"');
      console.error('   (ou finalize o "Node.js" no Gerenciador de Tarefas) e abra o iniciar.bat uma vez só.\n');
    } else {
      console.error(`[painel] não abriu na porta ${porta}: ${e.message}`);
    }
  });
  servidor.listen(porta, '127.0.0.1', () => console.log(`🖥️  Painel do bot: http://localhost:${porta}`));
  return { emitir };
}

module.exports = { iniciarPainel, painelDoDia, CAMPOS };
