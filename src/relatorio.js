// Copyright (c) 2026 Talles Oliveira (github.com/talles1x)
// Licença MIT: pode usar e modificar, mantendo este aviso de autoria. Veja o arquivo LICENSE.
// Modelo em HTML do fechamento de caixa, que vira PDF no navegador do bot (o mesmo do WhatsApp Web).
const u = require('./util');

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// f = { empresa, local, data (dd/mm/aaaa), hora, usuarios[], pagamentos[{hora, contrato, cliente, forma, valor}], total,
//       porForma[{nome, n, v}], porPortador[{nome, n, v}] (vazio = não mostra), geradoEm }
function htmlFechamento(f) {
  const linhasHtml = f.pagamentos.map((p, i) => `
        <tr>
          <td class="n">${i + 1}</td>
          <td>${esc(p.hora || '-')}</td>
          <td>${esc(p.contrato || '-')}</td>
          <td>${esc(p.cliente || 'Cliente')}</td>
          <td>${esc(p.forma || '-')}</td>
          <td class="v">${esc(u.moeda(p.valor))}</td>
        </tr>`);
  // As 3 últimas linhas ficam no mesmo bloco do total, para o total nunca cair sozinho numa página
  const corpo = linhasHtml.slice(0, -3).join('');
  const fim = linhasHtml.slice(-3).join('');
  const tabela = (titulo, lista) => !lista || !lista.length ? '' : `
  <h2>${titulo}</h2>
  <table class="port">
    <thead><tr><th>${titulo.replace('Por ', '').replace(/^./, (c) => c.toUpperCase())}</th><th class="n">Qtd.</th><th class="v">Valor</th></tr></thead>
    <tbody>${lista.map((p) => `
        <tr><td>${esc(p.nome)}</td><td class="n">${p.n}</td><td class="v">${esc(u.moeda(p.v))}</td></tr>`).join('')}
    </tbody>
  </table>`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Fechamento de caixa ${esc(f.data)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1d2433; font-size: 11px; margin: 0; }
  header { border-bottom: 2px solid #1d2433; padding-bottom: 10px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: flex-end; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .sub { color: #5b6475; font-size: 11px; }
  .empresa { font-weight: bold; font-size: 13px; text-align: right; }
  .cards { display: flex; gap: 10px; margin-bottom: 16px; }
  .card { flex: 1; border: 1px solid #d7dbe3; border-radius: 6px; padding: 10px 12px; }
  .card .rot { color: #5b6475; font-size: 10px; text-transform: uppercase; letter-spacing: .4px; }
  .card .num { font-size: 18px; font-weight: bold; margin-top: 4px; }
  h2 { font-size: 12px; margin: 16px 0 6px; text-transform: uppercase; letter-spacing: .4px; color: #3a4252; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; background: #eef0f4; font-size: 10px; text-transform: uppercase; letter-spacing: .3px; padding: 6px 8px; border-bottom: 1px solid #c9ced8; }
  td { padding: 5px 8px; border-bottom: 1px solid #e6e9ef; }
  tr { page-break-inside: avoid; }
  .n { width: 34px; color: #5b6475; }
  .v { text-align: right; white-space: nowrap; }
  th.v { text-align: right; }
  /* tfoot como grupo normal: o total aparece só no fim (não repete em cada página) e fica junto do rodapé */
  tfoot { display: table-row-group; break-inside: avoid; page-break-inside: avoid; }
  tfoot .total td { font-weight: bold; border-top: 2px solid #1d2433; border-bottom: none; padding-top: 8px; }
  tfoot .rodape td { border: none; color: #8a92a3; font-size: 9px; text-align: center; padding-top: 14px; }
  .port { width: 60%; }
</style>
</head>
<body>
  <header>
    <div>
      <h1>Fechamento de caixa${f.local ? ` - ${esc(f.local)}` : ''}</h1>
      <div class="sub">Data: <b>${esc(f.data)}</b> (pagamentos até ${esc(f.hora)}) &nbsp;·&nbsp; Usuário SGP: <b>${esc(f.usuarios.join(', '))}</b></div>
    </div>
    <div class="empresa">${esc(f.empresa || '')}</div>
  </header>

  <div class="cards">
    <div class="card"><div class="rot">Pagamentos</div><div class="num">${f.pagamentos.length}</div></div>
    <div class="card"><div class="rot">Total recebido</div><div class="num">${esc(u.moeda(f.total))}</div></div>
  </div>

${tabela('Por forma de pagamento', f.porForma)}
${tabela('Por portador', f.porPortador)}

  <h2>Lista de pagamentos</h2>
  <table>
    <thead><tr><th class="n">#</th><th>Hora</th><th>Contrato</th><th>Cliente</th><th>Forma</th><th class="v">Valor</th></tr></thead>
    <tbody>${corpo}
    </tbody>
    <tfoot>${fim}
      <tr class="total"><td colspan="5">Total (${f.pagamentos.length} pagamento${f.pagamentos.length === 1 ? '' : 's'})</td><td class="v">${esc(u.moeda(f.total))}</td></tr>
      <tr class="rodape"><td colspan="6">Gerado automaticamente pelo bot em ${esc(f.geradoEm)}. Confira com o relatório do SGP antes de fechar o caixa.</td></tr>
    </tfoot>
  </table>
</body>
</html>`;
}

module.exports = { htmlFechamento };
