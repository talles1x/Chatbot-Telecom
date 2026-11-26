// Copyright (c) 2026 Talles Oliveira (github.com/talles1x)
// Licença MIT: pode usar e modificar, mantendo este aviso de autoria. Veja o arquivo LICENSE.
// Atendimento humano no painel: fila com protocolo, etiquetas, notas internas, respostas rápidas,
// mensagens agendadas e histórico de mensagens (para a busca). Tudo fica na pasta "dados" do bot.
const fs = require('fs');
const path = require('path');

const PASTA = path.join(__dirname, '..', 'dados');
const ARQ = path.join(PASTA, 'atendimento.json');
const ARQ_MSGS = path.join(PASTA, 'mensagens.jsonl');

const PADRAO = {
  seq: { dia: '', n: 0 },
  tickets: {}, // chatId -> atendimento aberto
  encerrados: [], // histórico para os relatórios
  etiquetasContato: {}, // chatId -> ['Instalação', ...]
  notas: {}, // chatId -> [{ texto, em }]
  etiquetas: [
    { nome: 'Financeiro', cor: 'green' },
    { nome: 'Suporte', cor: 'blue' },
    { nome: 'Instalação', cor: 'purple' },
    { nome: 'Comercial', cor: 'teal' },
    { nome: 'Urgente', cor: 'red' },
  ],
  respostas: [
    { atalho: 'aguarde', texto: 'Só um momento, por favor, que já verifico para você. 🙏' },
    { atalho: 'pix', texto: 'Pode pagar pelo PIX copia e cola do boleto. Assim que pagar, me manda o comprovante por aqui. 😊' },
    { atalho: 'tecnico', texto: 'Vou encaminhar um técnico para verificar. Assim que tiver o horário da visita, te aviso por aqui.' },
    { atalho: 'obrigado', texto: 'Obrigado pelo contato! Qualquer coisa, é só chamar. 😊' },
  ],
  textoEncerramento: '✅ Atendimento finalizado. Protocolo: {protocolo}. Se precisar de algo mais, é só chamar! 😊',
  agendadas: [],
  // Quem atende no painel (nomes cadastrados no próprio painel; ficam só em dados/, nunca no GitHub)
  atendentes: [],
  assinar: false,
};

function criarAtendimento({ aoMudar = () => {} } = {}) {
  let dados = JSON.parse(JSON.stringify(PADRAO));
  try {
    if (fs.existsSync(ARQ)) dados = { ...dados, ...JSON.parse(fs.readFileSync(ARQ, 'utf-8')) };
  } catch (e) {
    console.error(`[atendimento] não consegui ler ${ARQ}: ${e.message}`);
  }
  let timerSalvar = null;
  function salvar(evento) {
    clearTimeout(timerSalvar);
    timerSalvar = setTimeout(() => {
      try {
        fs.mkdirSync(PASTA, { recursive: true });
        fs.writeFileSync(`${ARQ}.tmp`, JSON.stringify(dados));
        fs.renameSync(`${ARQ}.tmp`, ARQ);
      } catch (e) { console.error(`[atendimento] erro ao salvar: ${e.message}`); }
    }, 300);
    if (evento) aoMudar(evento);
  }

  function protocolo() {
    const dia = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Fortaleza' }).replace(/-/g, '');
    if (dados.seq.dia !== dia) dados.seq = { dia, n: 0 };
    dados.seq.n++;
    return `${dia}${String(dados.seq.n).padStart(4, '0')}`;
  }

  // ---------- Fila ----------
  // Cliente passou para o atendente (pelo bot ou porque o atendente assumiu)
  function abrir(chatId, { motivo = '', nome = '', numero = '' } = {}) {
    if (dados.tickets[chatId]) return dados.tickets[chatId];
    const t = { protocolo: protocolo(), chatId, nome, numero, status: 'aguardando', motivo, abertoEm: Date.now(), primeiraRespostaEm: null, ultimaClienteEm: Date.now() };
    dados.tickets[chatId] = t;
    salvar({ tipo: 'fila', chat: chatId, novo: true });
    return t;
  }
  // O atendente respondeu (celular, WhatsApp Web ou painel)
  const nomeAtendente = (n) => String(n || '').trim().slice(0, 40);
  function respondeu(chatId, info = {}) {
    const { atendente, ...resto } = info;
    const t = dados.tickets[chatId] || abrir(chatId, { motivo: 'atendente iniciou', ...resto });
    if (!t.primeiraRespostaEm) t.primeiraRespostaEm = Date.now();
    if (nomeAtendente(atendente) && !t.atendente) t.atendente = nomeAtendente(atendente);
    if (t.status !== 'atendimento') t.status = 'atendimento';
    salvar({ tipo: 'fila', chat: chatId });
    return t;
  }
  function assumir(chatId, info = {}) {
    const { atendente, ...resto } = info;
    const t = dados.tickets[chatId] || abrir(chatId, { motivo: 'assumido no painel', ...resto });
    t.status = 'atendimento';
    if (nomeAtendente(atendente)) t.atendente = nomeAtendente(atendente); // quem clicou em Assumir fica com o atendimento
    salvar({ tipo: 'fila', chat: chatId });
    return t;
  }
  function clienteFalou(chatId) {
    const t = dados.tickets[chatId];
    if (t) { t.ultimaClienteEm = Date.now(); salvar({ tipo: 'fila', chat: chatId, cliente: true }); }
  }
  function encerrar(chatId, como = 'painel', atendente = '') {
    const t = dados.tickets[chatId];
    if (!t) return null;
    delete dados.tickets[chatId];
    const fim = { ...t, encerradoEm: Date.now(), como, atendente: t.atendente || nomeAtendente(atendente) || undefined, encerradoPor: nomeAtendente(atendente) || undefined, etiquetas: [...(dados.etiquetasContato[chatId] || [])] };
    dados.encerrados.push(fim);
    if (dados.encerrados.length > 20000) dados.encerrados = dados.encerrados.slice(-20000);
    salvar({ tipo: 'fila', chat: chatId });
    return fim;
  }
  const ticket = (chatId) => dados.tickets[chatId] || null;
  const fila = () => Object.values(dados.tickets).sort((a, b) => a.abertoEm - b.abertoEm);

  // ---------- Etiquetas e notas ----------
  function etiquetar(chatId, nomes) {
    dados.etiquetasContato[chatId] = [...new Set(nomes)].filter((n) => dados.etiquetas.some((e) => e.nome === n));
    if (!dados.etiquetasContato[chatId].length) delete dados.etiquetasContato[chatId];
    salvar({ tipo: 'contato', chat: chatId });
  }
  function anotar(chatId, texto, autor = '') {
    const nota = { texto: String(texto).slice(0, 2000), em: Date.now(), ...(nomeAtendente(autor) ? { autor: nomeAtendente(autor) } : {}) };
    (dados.notas[chatId] = dados.notas[chatId] || []).push(nota);
    salvar({ tipo: 'contato', chat: chatId });
    return nota;
  }
  function apagarNota(chatId, em) {
    dados.notas[chatId] = (dados.notas[chatId] || []).filter((n) => n.em !== Number(em));
    salvar({ tipo: 'contato', chat: chatId });
  }

  // ---------- Configuração (respostas rápidas, etiquetas, texto de encerramento) ----------
  function configurar({ respostas, etiquetas, textoEncerramento, atendentes, assinar }) {
    if (Array.isArray(atendentes)) dados.atendentes = [...new Set(atendentes.map(nomeAtendente).filter(Boolean))].slice(0, 30);
    if (typeof assinar === 'boolean') dados.assinar = assinar;
    if (Array.isArray(respostas)) {
      dados.respostas = respostas
        .map((r) => ({ atalho: String(r.atalho || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30), texto: String(r.texto || '').slice(0, 2000) }))
        .filter((r) => r.atalho && r.texto);
    }
    if (Array.isArray(etiquetas)) {
      dados.etiquetas = etiquetas.map((e) => ({ nome: String(e.nome || '').trim().slice(0, 30), cor: String(e.cor || 'gray') })).filter((e) => e.nome);
    }
    if (typeof textoEncerramento === 'string') dados.textoEncerramento = textoEncerramento.slice(0, 1000);
    salvar({ tipo: 'config' });
  }

  // ---------- Mensagens agendadas ----------
  function agendar({ chatId, nome, texto, quando }) {
    const item = { id: `ag${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, chatId, nome: nome || '', texto: String(texto).slice(0, 4000), quando: Number(quando), status: 'pendente', criadoEm: Date.now() };
    dados.agendadas.push(item);
    salvar({ tipo: 'agendadas' });
    return item;
  }
  function cancelarAgendada(id) {
    dados.agendadas = dados.agendadas.filter((a) => !(a.id === id && a.status === 'pendente'));
    salvar({ tipo: 'agendadas' });
  }
  // Chamado a cada 30s: envia as que já passaram da hora
  async function processarAgendadas(enviar) {
    const agora = Date.now();
    for (const a of dados.agendadas.filter((x) => x.status === 'pendente' && x.quando <= agora)) {
      a.status = 'enviando';
      try {
        await enviar(a.chatId, a.texto);
        a.status = 'enviada';
        a.enviadaEm = Date.now();
      } catch (e) {
        a.status = 'erro';
        a.erro = e.message;
      }
      salvar({ tipo: 'agendadas', chat: a.chatId });
    }
    // Guarda só as dos últimos 30 dias
    const limite = agora - 30 * 86400000;
    dados.agendadas = dados.agendadas.filter((a) => a.status === 'pendente' || a.quando > limite);
  }

  // ---------- Histórico de mensagens (busca) ----------
  function registrarMensagem(chatId, { deMim, texto, tipo, hora, id }) {
    if (!chatId || chatId.endsWith('@g.us') || chatId.includes('broadcast')) return;
    const linha = JSON.stringify({ c: chatId, m: deMim ? 1 : 0, t: String(texto || '').slice(0, 2000), y: tipo || 'chat', h: hora || Math.floor(Date.now() / 1000), i: id || '' });
    fs.mkdirSync(PASTA, { recursive: true });
    fs.appendFile(ARQ_MSGS, `${linha}\n`, () => {});
  }
  function buscar(termo, limite = 80) {
    const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const q = norm(termo).trim();
    if (q.length < 2) return [];
    let texto = '';
    try { texto = fs.readFileSync(ARQ_MSGS, 'utf-8'); } catch { return []; }
    const achados = [];
    const linhas = texto.split('\n');
    for (let i = linhas.length - 1; i >= 0 && achados.length < limite; i--) {
      if (!linhas[i]) continue;
      if (!norm(linhas[i]).includes(q)) continue;
      try {
        const m = JSON.parse(linhas[i]);
        if (norm(m.t).includes(q)) achados.push({ chatId: m.c, deMim: !!m.m, texto: m.t, hora: m.h });
      } catch {}
    }
    return achados;
  }

  // ---------- Relatórios ----------
  function relatorio(dias = 7) {
    const fuso = { timeZone: 'America/Fortaleza' };
    const diaDe = (ms) => new Date(ms).toLocaleDateString('sv-SE', fuso);
    const desde = Date.now() - dias * 86400000;
    const lista = dados.encerrados.filter((t) => t.encerradoEm >= desde);
    const media = (vals) => (vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length / 60000) : null);
    const porDia = {};
    for (let i = dias - 1; i >= 0; i--) porDia[diaDe(Date.now() - i * 86400000)] = { atendimentos: 0, primeira: [], total: [] };
    for (const t of lista) {
      const d = porDia[diaDe(t.abertoEm)] || porDia[diaDe(t.encerradoEm)];
      if (!d) continue;
      d.atendimentos++;
      if (t.primeiraRespostaEm) d.primeira.push(t.primeiraRespostaEm - t.abertoEm);
      d.total.push(t.encerradoEm - t.abertoEm);
    }
    const porEtiqueta = {};
    for (const t of lista) for (const e of t.etiquetas || []) porEtiqueta[e] = (porEtiqueta[e] || 0) + 1;
    const porAtendente = {};
    for (const t of lista) { const a = t.atendente || 'Sem atendente definido'; porAtendente[a] = (porAtendente[a] || 0) + 1; }
    const porMotivo = {};
    for (const t of lista) { const m = t.motivo || 'outro'; porMotivo[m] = (porMotivo[m] || 0) + 1; }
    const primeiras = lista.filter((t) => t.primeiraRespostaEm).map((t) => t.primeiraRespostaEm - t.abertoEm);
    return {
      dias,
      total: lista.length,
      semResposta: lista.filter((t) => !t.primeiraRespostaEm).length,
      mediaPrimeiraMin: media(primeiras),
      mediaTotalMin: media(lista.map((t) => t.encerradoEm - t.abertoEm)),
      porDia: Object.entries(porDia).map(([dia, d]) => ({ dia, atendimentos: d.atendimentos, primeiraMin: media(d.primeira), totalMin: media(d.total) })),
      porEtiqueta: Object.entries(porEtiqueta).sort((a, b) => b[1] - a[1]).map(([nome, n]) => ({ nome, n })),
      porAtendente: Object.entries(porAtendente).sort((a, b) => b[1] - a[1]).map(([nome, n]) => ({ nome, n })),
      porMotivo: Object.entries(porMotivo).sort((a, b) => b[1] - a[1]).map(([nome, n]) => ({ nome, n })),
      abertosAgora: Object.keys(dados.tickets).length,
    };
  }

  return {
    abrir, respondeu, assumir, clienteFalou, encerrar, ticket, fila,
    etiquetar, anotar, apagarNota, configurar, agendar, cancelarAgendada, processarAgendadas,
    registrarMensagem, buscar, relatorio,
    etiquetasDe: (chatId) => dados.etiquetasContato[chatId] || [],
    notasDe: (chatId) => dados.notas[chatId] || [],
    etiquetas: () => dados.etiquetas,
    respostas: () => dados.respostas,
    textoEncerramento: () => dados.textoEncerramento,
    atendentes: () => dados.atendentes || [],
    assinar: () => !!dados.assinar,
    agendadas: () => [...dados.agendadas].sort((a, b) => a.quando - b.quando),
    todasEtiquetasContato: () => dados.etiquetasContato,
  };
}

module.exports = { criarAtendimento };
