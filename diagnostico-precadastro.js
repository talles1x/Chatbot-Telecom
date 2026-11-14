// Copyright (c) 2026 Talles Oliveira (github.com/talles1x)
// Licença MIT: pode usar e modificar, mantendo este aviso de autoria. Veja o arquivo LICENSE.
// Diagnóstico do cadastro de cliente: lista no SGP os ids de planos, vencimentos, POPs e portadores
// que o pré-cadastro usa (para preencher PRECADASTRO_* no .env). Só LÊ, não cadastra nada.
// O resultado fica em diagnostico-precadastro.txt.
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const URL = (process.env.SGP_URL || '').replace(/\/+$/, '');
const base = { token: process.env.SGP_TOKEN, app: process.env.SGP_APP };
const linhas = [];
const out = (...p) => { const l = p.join(' '); console.log(l); linhas.push(l); };

async function post(caminho) {
  try {
    const r = await fetch(URL + caminho, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(base), signal: AbortSignal.timeout(30000),
    });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch {}
    return { status: r.status, j, t: t.slice(0, 300) };
  } catch (e) { return { status: 'erro', t: e.message }; }
}

const lista = (j) => (Array.isArray(j) ? j : Object.values(j || {}).find(Array.isArray) || []);

(async () => {
  out('Diagnóstico do cadastro de cliente -', new Date().toLocaleString('pt-BR'));
  for (const tipo of ['plano', 'vencimento', 'pop', 'portador']) {
    const r = await post(`/api/precadastro/${tipo}/list`);
    out(`\n${tipo.toUpperCase()} (/api/precadastro/${tipo}/list): HTTP ${r.status}`);
    const itens = lista(r.j);
    if (!itens.length) { out('   ', r.t || '(vazio)'); continue; }
    for (const x of itens) {
      const id = x.id ?? x.codigo ?? x[`${tipo}_id`];
      const nome = x.nome ?? x.descricao ?? x.dia ?? x.ident ?? x.vencimento ?? JSON.stringify(x).slice(0, 80);
      out(`   id ${id} - ${nome}`);
    }
  }
  fs.writeFileSync(path.join(__dirname, 'diagnostico-precadastro.txt'), linhas.join('\n') + '\n');
  console.log('\nPronto. Resultado salvo em diagnostico-precadastro.txt');
})();
