// Copyright (c) 2026 Talles Oliveira (github.com/talles1x). Todos os direitos reservados.
// Uso, cópia ou modificação só com autorização do autor. Veja o arquivo LICENSE.
// Log do bot: aparece na janela E fica salvo em logs/bot-AAAA-MM-DD.txt (um arquivo por dia)
const fs = require('fs');
const path = require('path');

const pasta = path.join(__dirname, '..', 'logs');

// LGPD: CPF/CNPJ nunca aparece inteiro no log
function ocultarDocs(t) {
  return String(t ?? '').replace(/\d[\d.\-\/ ]{9,17}\d/g, (m) => (m.replace(/\D/g, '').length >= 11 ? '***.***.***-**' : m));
}

function registrar(...partes) {
  const agora = new Date();
  const hora = agora.toLocaleTimeString('pt-BR', { timeZone: 'America/Fortaleza' });
  const dia = agora.toLocaleDateString('sv-SE', { timeZone: 'America/Fortaleza' });
  const linha = ocultarDocs(partes.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' '));
  console.log(`${hora} ${linha}`);
  try {
    fs.mkdirSync(pasta, { recursive: true });
    fs.appendFileSync(path.join(pasta, `bot-${dia}.txt`), `${dia} ${hora} ${linha}\n`);
  } catch {}
}

// Mostra o texto numa linha só, curto
function resumo(t, max = 120) {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

module.exports = { registrar, resumo, ocultarDocs };
