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

module.exports = {
  agoraLocal, dentroDoHorario, paraISO, dataBR, diasDeAtraso, moeda,
  soDigitos, cpfValido, cnpjValido, esperar, aleatorio, normalizar,
};
