// Copyright (c) 2026 Talles Oliveira (github.com/talles1x)
// Licença MIT: pode usar e modificar, mantendo este aviso de autoria. Veja o arquivo LICENSE.
// Painel do bot no navegador (só no próprio computador: http://localhost:3210).
// Usa a MESMA conexão do WhatsApp do bot: conversas, painel do dia, configurações e QR code.
// Sem dependências extras: servidor http do Node e eventos ao vivo (Server-Sent Events).
const http = require('http');
const fs = require('fs');
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

const TIPOS = { image: '📷 Foto', audio: '🎤 Áudio', ptt: '🎤 Áudio', video: '🎬 Vídeo', document: '📄 Documento', sticker: '🙂 Figurinha', location: '📍 Localização', vcard: '👤 Contato' };

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
  return { metricas: contagem, porHora, log: linhas.filter(Boolean).slice(-200) };
}

function iniciarPainel({ client, fluxo, cfg, registrar, conexao, numeroDeChat, atendimento, sgp, estado, MessageMedia, enviarComoBot }) {
  const nomes = new Map(); // chatId -> nome do contato (para a busca e a fila)
  const porta = Number(process.env.PAINEL_PORTA || 3210);
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
      fluxoArq.on('end', () => { novo.split('\n').filter(Boolean).forEach((l) => emitir('log', l)); });
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
      return {
        id,
        nome: c.name || '',
        ticket: atendimento.ticket(id),
        etiquetas: atendimento.etiquetasDe(id),
        numero: await Promise.resolve(numeroDeChat(id)).catch(() => ''),
        ultima: ultima.body && !['ptt', 'audio', 'sticker'].includes(ultima.type) ? String(ultima.body).slice(0, 90) : (TIPOS[ultima.type] || ''),
        deMim: Boolean(ultima.fromMe),
        hora: c.timestamp || 0,
        naoLidas: c.unreadCount || 0,
        pausado: fluxo.estaPausado(id),
      };
    }));
  }
  async function mensagensDe(id) {
    const chat = await client.getChatById(id);
    const msgs = await chat.fetchMessages({ limit: 50 });
    return {
      id,
      nome: chat.name || '',
      numero: await Promise.resolve(numeroDeChat(id)).catch(() => ''),
      pausado: fluxo.estaPausado(id),
      ticket: atendimento.ticket(id),
      etiquetas: atendimento.etiquetasDe(id),
      notas: atendimento.notasDe(id),
      mensagens: msgs.filter((m) => m.type !== 'e2e_notification' && m.type !== 'notification_template' && m.type !== 'revoked').map((m) => ({
        id: m.id && m.id._serialized,
        midia: Boolean(m.hasMedia),
        arquivo: m._data && (m._data.filename || ''),
        mime: m._data && (m._data.mimetype || ''),
        deMim: m.fromMe,
        corpo: m.body || '',
        tipo: m.type,
        hora: m.timestamp,
        ack: m.ack,
      })),
    };
  }

  // ---------- Ficha do cliente no SGP ----------
  async function ficha(id, docInformado) {
    const lembrado = estado.cliente(id) || {};
    const busca = String(docInformado || '').replace(/\D/g, '');
    let contratos = [];
    if (busca && busca.length <= 7) contratos = await sgp.consultarContrato(busca);
    else if (busca || lembrado.doc) contratos = await sgp.consultarCliente(busca || lembrado.doc);
    if (!contratos.length) return { encontrado: false, doc: busca || lembrado.doc || '' };
    const escolhido = contratos.find((c) => String(c.id) === String(lembrado.contrato)) || contratos[0];
    const [faturas, online] = await Promise.all([
      sgp.titulosAbertos(busca.length > 7 ? busca : (lembrado.doc || ''), escolhido.id).catch(() => []),
      sgp.verificarAcesso(escolhido.id).catch(() => null),
    ]);
    return {
      encontrado: true,
      doc: busca || lembrado.doc || '',
      contrato: escolhido,
      outros: contratos.filter((c) => c !== escolhido).map((c) => ({ id: c.id, status: c.status, endereco: c.endereco })),
      faturas: faturas.slice(0, 6).map((f) => ({ vencimento: f.vencimento, valor: f.valor, link: f.link })),
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
        const { id, texto, arquivo } = await corpo(req);
        if (!id || (!String(texto || '').trim() && !arquivo)) return responder(res, 400, { erro: 'faltou a conversa ou o texto' });
        // Mensagem do atendente: o bot sai de cena nessa conversa (igual responder pelo celular)
        if (arquivo && arquivo.base64) {
          const media = new MessageMedia(arquivo.tipo || 'application/octet-stream', arquivo.base64, arquivo.nome || 'arquivo');
          const ehDoc = !/^image\/|^video\//.test(arquivo.tipo || '');
          await client.sendMessage(id, media, { caption: String(texto || '').trim() || undefined, sendMediaAsDocument: ehDoc });
        } else {
          await client.sendMessage(id, String(texto).trim());
        }
        registrar('[painel] atendente respondeu pelo painel');
        return responder(res, 200, { ok: true });
      }
      if (rota === 'POST /api/pausar' || rota === 'POST /api/assumir') {
        const { id } = await corpo(req);
        fluxo.pausar(id);
        atendimento.assumir(id, { numero: await Promise.resolve(numeroDeChat(id)).catch(() => ''), nome: nomes.get(id) || '' });
        registrar('[painel] atendente assumiu uma conversa pelo painel');
        emitir('mensagem', { chat: id });
        return responder(res, 200, { ok: true });
      }
      if (rota === 'POST /api/religar' || rota === 'POST /api/encerrar') {
        const { id, avisar } = await corpo(req);
        const t = atendimento.ticket(id);
        if (avisar && t) {
          await enviarComoBot(id, atendimento.textoEncerramento().replace(/\{protocolo\}/g, t.protocolo)).catch(() => {});
        }
        fluxo.retomar(id);
        atendimento.encerrar(id, rota.endsWith('encerrar') ? 'encerrado no painel' : 'bot religado no painel');
        registrar(`[painel] atendimento ${t ? t.protocolo : ''} encerrado pelo painel, bot religado`);
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
      if (rota === 'POST /api/etiquetas') {
        const { id, etiquetas } = await corpo(req);
        atendimento.etiquetar(id, etiquetas || []);
        return responder(res, 200, { ok: true });
      }
      if (rota === 'POST /api/nota') {
        const { id, texto, apagar } = await corpo(req);
        if (apagar) atendimento.apagarNota(id, apagar);
        else if (String(texto || '').trim()) atendimento.anotar(id, texto.trim());
        return responder(res, 200, { notas: atendimento.notasDe(id) });
      }
      if (rota === 'GET /api/ficha') {
        return responder(res, 200, await ficha(url.searchParams.get('id'), url.searchParams.get('doc')).catch((e) => ({ encontrado: false, erro: e.message })));
      }
      if (rota === 'GET /api/busca') {
        const achados = atendimento.buscar(url.searchParams.get('q') || '');
        return responder(res, 200, achados.map((a) => ({ ...a, nome: nomes.get(a.chatId) || '' })));
      }
      if (rota === 'GET /api/fila') {
        return responder(res, 200, atendimento.fila().map((t) => ({ ...t, nome: t.nome || nomes.get(t.chatId) || '', etiquetas: atendimento.etiquetasDe(t.chatId) })));
      }
      if (rota === 'GET /api/relatorio') {
        return responder(res, 200, atendimento.relatorio(Math.min(90, Math.max(1, Number(url.searchParams.get('dias')) || 7))));
      }
      if (rota === 'GET /api/agendadas') return responder(res, 200, atendimento.agendadas().map((a) => ({ ...a, nome: a.nome || nomes.get(a.chatId) || '' })));
      if (rota === 'POST /api/agendadas') {
        const { id, texto, quando, cancelar } = await corpo(req);
        if (cancelar) { atendimento.cancelarAgendada(cancelar); return responder(res, 200, { ok: true }); }
        if (!id || !String(texto || '').trim() || !(Number(quando) > Date.now())) return responder(res, 400, { erro: 'escolha a conversa, o texto e uma data no futuro' });
        return responder(res, 200, atendimento.agendar({ chatId: id, nome: nomes.get(id) || '', texto: texto.trim(), quando }));
      }
      if (rota === 'GET /api/atendimento-config') {
        return responder(res, 200, { respostas: atendimento.respostas(), etiquetas: atendimento.etiquetas(), textoEncerramento: atendimento.textoEncerramento() });
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
        // O iniciar.bat liga o bot de novo sozinho
        setTimeout(() => process.exit(0), 800);
        return undefined;
      }
      return responder(res, 404, { erro: 'não encontrado' });
    } catch (e) {
      return responder(res, 500, { erro: e.message });
    }
  });
  servidor.on('error', (e) => console.error(`[painel] não abriu na porta ${porta}: ${e.message}`));
  servidor.listen(porta, '127.0.0.1', () => console.log(`🖥️  Painel do bot: http://localhost:${porta}`));
  return { emitir };
}

module.exports = { iniciarPainel, painelDoDia, CAMPOS };
