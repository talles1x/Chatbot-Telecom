// Copyright (c) 2026 Talles Oliveira (github.com/talles1x)
// Licença MIT: pode usar e modificar, mantendo este aviso de autoria. Veja o arquivo LICENSE.
const cfg = require('./config');

// Data/hora "de agora" no fuso da empresa
function agoraLocal(data = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: cfg.fuso,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
    })
      .formatToParts(data)
      .map((x) => [x.type, x.value])
  );
  const dias = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    diaSemana: dias[p.weekday],
    minutos: (Number(p.hour) % 24) * 60 + Number(p.minute),
    hojeISO: `${p.year}-${p.month}-${p.day}`,
  };
}

function dentroDoHorario(data = new Date()) {
  const { diaSemana, minutos } = agoraLocal(data);
  if (!cfg.horario.dias.includes(diaSemana)) return false;
  return cfg.horario.turnos.some((t) => minutos >= t.ini && minutos < t.fim);
}

// Aceita "2026-10-10", "2026-10-10 00:00:00", "10/10/2026"
function paraISO(d) {
  if (!d) return null;
  const s = String(d).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

function dataBR(d) {
  const iso = paraISO(d);
  if (!iso) return d ? String(d) : '-';
  const [a, m, dia] = iso.split('-');
  return `${dia}/${m}/${a}`;
}

function diasDeAtraso(vencimento) {
  const iso = paraISO(vencimento);
  if (!iso) return null;
  const hoje = new Date(agoraLocal().hojeISO + 'T00:00:00Z');
  const venc = new Date(iso + 'T00:00:00Z');
  return Math.round((hoje - venc) / 86400000);
}

function moeda(v) {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'));
  if (Number.isNaN(n)) return v ? String(v) : '-';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function soDigitos(t) {
  return String(t || '').replace(/\D/g, '');
}

function cpfValido(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1+$/.test(cpf)) return false;
  const calc = (n) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(cpf[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

function cnpjValido(c) {
  if (!/^\d{14}$/.test(c) || /^(\d)\1+$/.test(c)) return false;
  const calc = (n) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = pesos.reduce((acc, p, i) => acc + Number(c[i]) * p, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const aleatorio = (min, max) => Math.floor(min + Math.random() * (max - min));

// Remove acentos e deixa minúsculo, para comparar respostas
function normalizar(t) {
  return String(t || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

// Tipos de mensagem que o próprio cliente manda. O resto (e2e_notification, notification_template,
// call_log, revoked, reaction, protocol...) são avisos do WhatsApp e não podem disparar o atendimento.
const TIPOS_DO_CLIENTE = new Set(['chat', 'sticker', 'ptt', 'audio', 'image', 'video', 'document', 'location', 'vcard', 'multi_vcard', 'list_response', 'buttons_response']);
const ehMensagemDoCliente = (tipo) => TIPOS_DO_CLIENTE.has(tipo);

// Mesmo telefone? Compara os 8 últimos dígitos (funciona com ou sem 55, DDD e o 9 extra)
function mesmoNumero(a, b) {
  const x = soDigitos(a).slice(-8);
  const y = soDigitos(b).slice(-8);
  return x.length === 8 && x === y;
}

// Mensagem do atendente que encerra o atendimento ("atendimento finalizado", "vou encerrar seu atendimento",
// "agradecemos o contato", #fim...). Depois dela o bot volta a responder esse cliente.
const RE_FIM = new RegExp([
  '^#(fim|finalizar|encerrar)$',
  '\\batendimento (foi |esta |sera )?(finalizado|encerrado|concluido)',
  '\\b(finaliz|encerr|conclu)\\w* (o |a )?(seu |este |esse |nosso )?atendimento',
  '\\b(agradece|obrigad)\\w* (o |pelo |a |seu |pelo seu )*contato',
].join('|'));
// Sinais de que a conversa continua: pergunta, pedido de espera, próximo passo
const RE_CONTINUA = /\?|\b(vou|vamos|irei|iremos|poderia|qual|quando|prazo)\b|\b(aguard|verific|precis)|\bpode me\b|\bme (envia|manda|passa)\b/;
function ehEncerramento(t) {
  const n = normalizar(t);
  if (/^#(fim|finalizar|encerrar)$/.test(n)) return true;
  if (!RE_FIM.test(n)) return false;
  // "Obrigado pelo contato, vou verificar e já te retorno?" não encerra
  if (RE_CONTINUA.test(n.replace(/\b(vou|vamos) (finalizar|encerrar|concluir)\w*/g, ''))) return false;
  return true;
}

// Despedida curta do atendente logo depois de encerrar ("tenha um ótimo dia!", "🙏")
function ehDespedida(t) {
  const n = normalizar(t);
  if (!/[a-z0-9]/.test(n)) return true; // só emoji/figurinha
  return n.length <= 70 && !/\?/.test(n)
    && /\b(bom dia|boa tarde|boa noite|tenha|otimo|excelente|obrigad|valeu|disponha|ate mais|ate logo|abraco|deus|fique com|por nada|tchau)\b/.test(n);
}

module.exports = {
  ehEncerramento, ehDespedida,
  agoraLocal, dentroDoHorario, paraISO, dataBR, diasDeAtraso, moeda,
  soDigitos, cpfValido, cnpjValido, esperar, aleatorio, normalizar, mesmoNumero, ehMensagemDoCliente,
};
