// Integração com a API URA do SGP (autenticação por Token + App no corpo da requisição).
// Os nomes dos campos de resposta variam entre versões do SGP, por isso cada leitura
// tenta vários nomes. Rode com DEBUG=true para ver a resposta crua e ajustar se precisar.
const cfg = require('./config');

const primeiro = (obj, chaves) => {
  for (const k of chaves) {
    const v = k.split('.').reduce((o, p) => (o == null ? undefined : o[p]), obj);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
};

async function post(caminho, dados) {
  if (!cfg.sgp.url || !cfg.sgp.token || !cfg.sgp.app) {
    throw new Error('SGP_URL, SGP_TOKEN e SGP_APP precisam estar preenchidos no .env');
  }
  const corpo = { token: cfg.sgp.token, app: cfg.sgp.app, ...dados };
  const url = `${cfg.sgp.url}${caminho}`;
  const opcoes = { method: 'POST', signal: AbortSignal.timeout(20000) };

  if (cfg.sgp.formato === 'form') {
    opcoes.body = new URLSearchParams(corpo);
  } else {
    opcoes.headers = { 'Content-Type': 'application/json' };
    opcoes.body = JSON.stringify(corpo);
  }

  const res = await fetch(url, opcoes);
  const texto = await res.text();
  if (cfg.debug) console.log(`[SGP] ${caminho} -> HTTP ${res.status}\n${texto.slice(0, 2000)}\n`);
  if (!res.ok) throw new Error(`SGP ${caminho} respondeu HTTP ${res.status}`);
  try {
    return JSON.parse(texto);
  } catch {
    throw new Error(`SGP ${caminho} não respondeu JSON`);
  }
}

// ---------- Consultar cliente ----------
async function consultarCliente(cpfcnpj) {
  if (cfg.sgp.mock) return mock.consultarCliente(cpfcnpj);
  const r = await post('/api/ura/consultacliente/', { cpfcnpj });
  const lista = primeiro(r, ['contratos', 'clientes', 'dados']) || [];
  return (Array.isArray(lista) ? lista : [lista]).map((c) => ({
    id: primeiro(c, ['contratoId', 'contrato', 'id', 'contrato_id']),
    nome: primeiro(c, ['razaoSocial', 'nome', 'cliente.nome', 'clienteNome']) || '',
    status: primeiro(c, ['contratoStatusDisplay', 'status_display', 'statusDisplay', 'status']) || '',
    endereco: montarEndereco(
      primeiro(c, ['endereco_instalacao', 'enderecoInstalacao', 'servico_endereco', 'servico.endereco', 'endereco']) ||
        (c.servicos && c.servicos[0] && c.servicos[0].endereco)
    ),
    plano: textoPlano(primeiro(c, ['planointernet', 'plano', 'servico_plano', 'servico.plano', 'planoDescricao']) ||
      (c.servicos && c.servicos[0] && (c.servicos[0].plano || c.servicos[0].planointernet))),
  })).filter((c) => c.id !== undefined);
}

// O endereço pode vir como texto ou como objeto ({ logradouro, numero, bairro, cidade, ... })
function montarEndereco(e) {
  if (!e) return '';
  if (typeof e === 'string') return e.trim();
  if (typeof e !== 'object') return String(e);
  const rua = primeiro(e, ['logradouro', 'rua', 'endereco']);
  const numero = primeiro(e, ['numero', 'num']);
  const complemento = primeiro(e, ['complemento']);
  const bairro = primeiro(e, ['bairro']);
  const cidade = primeiro(e, ['cidade', 'municipio', 'cidade.nome']);
  const uf = primeiro(e, ['uf', 'estado']);
  const linha1 = [rua, numero].filter(Boolean).join(', ') + (complemento ? ` (${complemento})` : '');
  const linha2 = [bairro, [cidade, uf].filter(Boolean).join('/')].filter(Boolean).join(' - ');
  return [linha1, linha2].filter(Boolean).join(' - ');
}

function textoPlano(p) {
  if (!p) return '';
  if (typeof p === 'string') return p.trim();
  return String(primeiro(p, ['descricao', 'nome', 'plano']) || '');
}

// ---------- Títulos em aberto ----------
async function titulosAbertos(cpfcnpj, contrato) {
  if (cfg.sgp.mock) return mock.titulosAbertos(contrato);
  const r = await post('/api/ura/titulos/', { cpfcnpj, contrato, status: 'abertos' });
  const lista = primeiro(r, ['titulos', 'faturas', 'boletos', 'dados']) || [];
  return (Array.isArray(lista) ? lista : [lista])
    .map((t) => ({
      id: primeiro(t, ['id', 'titulo', 'tituloId', 'numeroDocumento']),
      vencimento: primeiro(t, ['dataVencimento', 'vencimento', 'data_vencimento', 'vencimentoOriginal']),
      valor: primeiro(t, ['valorCorrigido', 'valor_corrigido', 'valor', 'valorTitulo']),
      linha: primeiro(t, ['linhaDigitavel', 'linha_digitavel', 'codigoBarras', 'codigo_barras']),
      link: primeiro(t, ['link', 'link_boleto', 'linkBoleto', 'url', 'boleto']),
      pix: primeiro(t, ['codigoPix', 'pix_copia_cola', 'pixCopiaECola', 'pix', 'qrcode_pix']),
      status: String(primeiro(t, ['status', 'situacao']) || '').toLowerCase(),
    }))
    .filter((t) => !t.status || /abert|pend|venc/.test(t.status))
    .sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)));
}

// ---------- Promessa de pagamento ----------
async function liberarPromessa(contrato) {
  if (cfg.sgp.mock) return mock.liberarPromessa(contrato);
  const r = await post('/api/ura/liberacaopromessa/', { contrato });
  const liberado = primeiro(r, ['liberado', 'status', 'sucesso', 'success']);
  return {
    ok: liberado === true || liberado === 1 || liberado === '1' || liberado === 'true',
    mensagem: primeiro(r, ['msg', 'mensagem', 'message', 'liberado_msg']) || '',
    protocolo: primeiro(r, ['protocolo', 'protocolo_id']),
    ate: primeiro(r, ['data_promessa', 'dataPromessa', 'liberado_ate', 'data']),
  };
}

// ---------- Conexão online/offline ----------
// Retorna true (online), false (offline) ou null (não deu para saber)
async function verificarAcesso(contrato) {
  if (cfg.sgp.mock) return mock.verificarAcesso(contrato);
  const r = await post('/api/ura/verificaacesso/', { contrato });
  const msg = String(primeiro(r, ['msg', 'mensagem', 'status_display']) || '').toLowerCase();
  if (/offline|desconect|sem conex|inativ/.test(msg)) return false;
  if (/online|conectad|ativo/.test(msg)) return true;
  return null;
}

// ---------- Dados falsos para testar o fluxo (SGP_MOCK=true) ----------
const mock = {
  consultarCliente(cpf) {
    if (cpf.endsWith('00')) return [];
    if (cpf.endsWith('33')) return [{ id: 1003, nome: 'CLIENTE EM DIA', status: 'Ativo', endereco: 'Rua B, 20 - Centro' }];
    if (cpf.endsWith('22')) {
      return [
        { id: 1001, nome: 'CLIENTE TESTE DA SILVA', status: 'Ativo', endereco: 'Rua A, 10 - Centro - Cidade Exemplo/UF', plano: 'FIBRA 300 MEGA' },
        { id: 1002, nome: 'CLIENTE TESTE', status: 'Suspenso', endereco: 'Sítio Boa Vista' },
      ];
    }
    return [{ id: 1001, nome: 'CLIENTE TESTE DA SILVA', status: 'Ativo', endereco: { logradouro: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'Cidade Exemplo', uf: 'UF' }, plano: 'FIBRA 300 MEGA' }].map((c) => ({ ...c, endereco: montarEndereco(c.endereco) }));
  },
  titulosAbertos(contrato) {
    if (contrato === 1001) {
      const venc = new Date(Date.now() - 12 * 86400000).toISOString().slice(0, 10);
      return [{
        id: 55, vencimento: venc, valor: 99.9,
        linha: '23793.38128 60000.000003 00000.000400 1 99990000009990',
        link: 'https://exemplo.sgp.net.br/boleto/55', pix: '00020126580014BR.GOV.BCB.PIX0136teste',
      }];
    }
    if (contrato === 1003) {
      // Cliente em dia: duas faturas futuras (o bot deve mandar só a próxima)
      return [10, 40].map((d, i) => ({
        id: 70 + i, vencimento: new Date(Date.now() + d * 86400000).toISOString().slice(0, 10), valor: 99.9,
        linha: '23793.38128 60000.000003 00000.000400 1 99990000009990', link: `https://exemplo.sgp.net.br/boleto/${70 + i}`,
      }));
    }
    if (contrato === 1002) {
      // Débito antigo (3 faturas, a mais antiga com ~90 dias) para testar o acordo
      return [90, 60, 30].map((d, i) => ({
        id: 60 + i, vencimento: new Date(Date.now() - d * 86400000).toISOString().slice(0, 10), valor: 99.9,
        linha: '23793.38128 60000.000003 00000.000400 1 99990000009990', link: `https://exemplo.sgp.net.br/boleto/${60 + i}`,
      }));
    }
    return [];
  },
  verificarAcesso(contrato) {
    return contrato !== 1001; // 1001 = offline, outros online
  },
  liberarPromessa() {
    const ate = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    return { ok: true, mensagem: 'Promessa liberada', protocolo: '2026102600001', ate };
  },
};

module.exports = { consultarCliente, titulosAbertos, liberarPromessa, verificarAcesso };
