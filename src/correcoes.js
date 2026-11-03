// Copyright (c) 2026 Talles Oliveira (github.com/talles1x)
// Licença MIT: pode usar e modificar, mantendo este aviso de autoria. Veja o arquivo LICENSE.
// Correções aplicadas na biblioteca whatsapp-web.js ao ligar o bot, enquanto não sai versão oficial corrigida.
// Rodar ANTES de require('whatsapp-web.js'). Cada correção só é aplicada se o trecho original for encontrado,
// então uma versão nova da biblioteca (já corrigida ou diferente) não é alterada.
const fs = require('fs');
const path = require('path');

const CORRECOES = [
  {
    // Envio de arquivo (PDF, imagem...) falhava com "Data passed to getter must include an id property":
    // os dados da mídia trazem um __x_id interno que sobrescreve o id da mensagem.
    // Ref.: github.com/wwebjs/whatsapp-web.js/issues/201922 e pull/201923
    nome: 'envio de mídia (__x_id)',
    arquivo: 'src/util/Injected/Utils.js',
    marca: 'delete message.__x_id;',
    antes: "        // Bot's won't reply if canonicalUrl is set (linking)",
    inserir: '        // [correção do bot] os dados da mídia trazem um __x_id que sobrescreve o id da mensagem\n        delete message.__x_id;\n\n',
  },
];

function aplicar(log = console.log) {
  let pasta;
  try {
    pasta = path.dirname(require.resolve('whatsapp-web.js/package.json'));
  } catch {
    return; // biblioteca não instalada (ex.: simulador)
  }
  for (const c of CORRECOES) {
    const arquivo = path.join(pasta, c.arquivo);
    try {
      const texto = fs.readFileSync(arquivo, 'utf-8');
      if (texto.includes(c.marca)) continue; // já corrigido
      if (!texto.includes(c.antes)) {
        log(`[correção] ${c.nome}: trecho não encontrado nesta versão da biblioteca, nada alterado`);
        continue;
      }
      fs.writeFileSync(arquivo, texto.replace(c.antes, c.inserir + c.antes));
      log(`[correção] ${c.nome}: aplicada`);
    } catch (e) {
      log(`[correção] ${c.nome}: não consegui aplicar (${e.message})`);
    }
  }
}

module.exports = { aplicar };
