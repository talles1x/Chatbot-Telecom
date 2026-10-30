// Copyright (c) 2026 Talles Oliveira (github.com/talles1x). Todos os direitos reservados.
// Uso, cópia ou modificação só com autorização do autor. Veja o arquivo LICENSE.
// Guarda em arquivo o que não pode se perder quando o bot reinicia:
// conversas pausadas (com atendente) e o CPF/contrato lembrado de cada número.
const fs = require('fs');
const path = require('path');

function criarEstado(nomeArquivo = 'estado.json') {
  const pasta = path.join(__dirname, '..', 'dados');
  const arquivo = path.join(pasta, nomeArquivo);
  let dados = { pausados: {}, clientes: {} };

  try {
    if (fs.existsSync(arquivo)) dados = { ...dados, ...JSON.parse(fs.readFileSync(arquivo, 'utf-8')) };
  } catch (e) {
    console.error(`[estado] não consegui ler ${arquivo}: ${e.message} (começando do zero)`);
  }

  // Arquivo pequeno e pouca escrita: salva na hora (não perde nada se o PC desligar)
  function salvar() {
    try {
      fs.mkdirSync(pasta, { recursive: true });
      const tmp = arquivo + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(dados, null, 2));
      fs.renameSync(tmp, arquivo);
    } catch (e) {
      console.error(`[estado] erro ao salvar: ${e.message}`);
    }
  }

  return {
    // pausa (atendente humano)
    pausaAte: (id) => dados.pausados[id],
    setPausa: (id, ate) => { dados.pausados[id] = ate; salvar(); },
    tirarPausa: (id) => { if (id in dados.pausados) { delete dados.pausados[id]; salvar(); } },
    // cliente lembrado pelo número
    cliente: (id) => dados.clientes[id],
    lembrar: (id, info) => { dados.clientes[id] = { ...dados.clientes[id], ...info, em: Date.now() }; salvar(); },
    esquecer: (id) => { delete dados.clientes[id]; salvar(); },
    // qualquer outro dado que precisa sobreviver a um reinício (conversas em andamento, enquetes...)
    ler: (chave, padrao) => (dados[chave] === undefined ? padrao : dados[chave]),
    gravar: (chave, valor) => { dados[chave] = valor; salvar(); },
  };
}

module.exports = { criarEstado };
