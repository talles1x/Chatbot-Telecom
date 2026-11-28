// Copyright (c) 2026 Talles Oliveira (github.com/talles1x)
// Licença MIT: pode usar e modificar, mantendo este aviso de autoria. Veja o arquivo LICENSE.
// Integração com a API URA do SGP (autenticação por Token + App no corpo da requisição).
// Os nomes dos campos de resposta variam entre versões do SGP, por isso cada leitura
// tenta vários nomes. Rode com DEBUG=true para ver a resposta crua e ajustar se precisar.
const cfg = require('./config');
const u = require('./util');

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
  if (!res.ok) {
    // Junta a mensagem do SGP (ex.: "CPF já cadastrado") para quem usa saber o motivo
    let motivo = '';
    try { motivo = String(primeiro(JSON.parse(texto), ['msg', 'mensagem', 'message', 'erro', 'error', 'detail']) || ''); } catch {}
    const e = new Error(`SGP ${caminho} respondeu HTTP ${res.status}${motivo ? `: ${motivo}` : ''}`);
    e.motivo = motivo;
    throw e;
  }
  try {
    return JSON.parse(texto);
  } catch {
    throw new Error(`SGP ${caminho} não respondeu JSON`);
  }
}

// ---------- Consultar cliente ----------
async function consultarCliente(cpfcnpj) {
  if (cfg.sgp.mock) return mock.consultarCliente(cpfcnpj);
  return lerContratos(await post('/api/ura/consultacliente/', { cpfcnpj }));
}

// Cliente pelo telefone do WhatsApp (usado na ficha do painel quando o cliente ainda não deu o CPF).
// Só aceita contratos que tenham MESMO esse telefone no cadastro: se o SGP ignorar o filtro e
// devolver outros clientes, nada é mostrado.
async function consultarTelefone(numero) {
  const d = String(numero || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length < 10) return [];
  if (cfg.sgp.mock) return [];
  const final = d.slice(-8);
  const ddd = d.slice(0, 2), resto = d.slice(2);
  const variantes = [...new Set([d, `55${d}`, resto.length === 9 ? `${ddd}${resto.slice(1)}` : `${ddd}9${resto}`, resto])];
  for (const telefone of variantes) {
    let lista = [];
    try { lista = lerContratos(await post('/api/ura/consultacliente/', { telefone })); } catch { continue; }
    const certos = lista.filter((c) => (c.telefones || []).some((t) => t.slice(-8) === final));
    if (certos.length && certos.length <= 10) return certos;
  }
  return [];
}

// Mesmo cadastro, buscando pelo número do contrato (usado pelos técnicos)
async function consultarContrato(contrato) {
  if (cfg.sgp.mock) return mock.consultarCliente('22').filter((c) => String(c.id) === String(contrato));
  return lerContratos(await post('/api/ura/consultacliente/', { contrato: Number(contrato) || contrato }));
}

function lerContratos(r) {
  const lista = primeiro(r, ['contratos', 'clientes', 'dados']) || [];
  return (Array.isArray(lista) ? lista : [lista]).map((c) => ({
    id: primeiro(c, ['contratoId', 'contrato', 'id', 'contrato_id']),
    clienteId: primeiro(c, ['clienteId', 'cliente_id', 'idCliente', 'cliente.id']),
    nome: primeiro(c, ['razaoSocial', 'nome', 'cliente.nome', 'clienteNome']) || '',
    status: primeiro(c, ['contratoStatusDisplay', 'status_display', 'statusDisplay', 'status']) || '',
    endereco: extrairEndereco(c),
    referencia: extrairReferencia(c),
    // Só para conferir se o WhatsApp é do titular (nunca é mostrado ao cliente nem vai para o log)
    telefones: extrairTelefones(c),
    ip: extrairIp(c),
    plano: textoPlano(primeiro(c, ['planointernet', 'plano', 'servico_plano', 'servico.plano', 'planoDescricao']) ||
      (c.servicos && c.servicos[0] && (c.servicos[0].plano || c.servicos[0].planointernet))),
  })).filter((c) => c.id !== undefined).map((c, i) => {
    avisarSemEndereco(c, lista[i]);
    return c;
  });
}

// IP da conexão do cliente (no serviço; ignora VoIP e IP de equipamento da rede)
function extrairIp(c) {
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  const campos = achatar(c).filter(([k, v]) => ipv4.test(String(v).trim()) && /(^|[._])(ip|ipv4|ip_address|endereco_ip|servico_ip)$/.test(k) && !/voip|gateway|nas|olt|mascara|dns/.test(k));
  const doServico = campos.find(([k]) => /servico/.test(k) && !/onu|cpe/.test(k)) || campos.find(([k]) => !/onu|cpe/.test(k)) || campos[0];
  return doServico ? String(doServico[1]).trim() : '';
}

function ehAcordo(t) {
  const a = t && (t.acordoPagamento || t.acordo_pagamento || t.acordo);
  if (!a) return /acordo/i.test(String((t && (t.demonstrativo || t.descricao)) || ''));
  if (typeof a === 'object') return Object.values(a).some((v) => (Array.isArray(v) ? v.length > 0 : Boolean(v)));
  return Boolean(a);
}

// ---------- Endereço e ponto de referência ----------
// Cada versão do SGP manda o endereço com nomes diferentes (objeto, texto ou campos soltos
// como "endereco_logradouro"). Primeiro tenta os nomes conhecidos; se não achar, procura
// em todos os campos do contrato, dando preferência ao endereço de instalação.
function extrairEndereco(c) {
  const direto = montarEndereco(
    primeiro(c, ['endereco_instalacao', 'enderecoInstalacao', 'servico_endereco', 'servico.endereco', 'endereco']) ||
      (c.servicos && c.servicos[0] && c.servicos[0].endereco)
  );
  if (direto) return direto;
  const campos = achatar(c);
  const rua = buscarCampo(campos, /(logradouro|(^|[._])rua)$/);
  const bairro = buscarCampo(campos, /bairro$/);
  const cidade = buscarCampo(campos, /(cidade|municipio)(_?nome)?$/);
  if (!rua && !bairro && !cidade) return '';
  return montarEndereco({
    logradouro: rua,
    numero: buscarCampo(campos, /(^|[._])(numero|num)$/),
    complemento: buscarCampo(campos, /complemento$/),
    bairro,
    cidade,
    uf: buscarCampo(campos, /(^|[._])uf$/),
  });
}

function extrairReferencia(c) {
  const v = buscarCampo(achatar(c), /(ponto_?de_?referencia|ponto_?referencia|pontoref|referencia)$/);
  return v ? String(v).replace(/\s+/g, ' ').trim() : '';
}

// Todos os telefones do cadastro, só dígitos. Um campo pode ter mais de um ("8399... / 8398...").
function extrairTelefones(c) {
  const tels = new Set();
  for (const [k, v] of achatar(c)) {
    if (!/(telefone|celular|fone|whats|contato)/.test(k) || /(_id|\.id|id)$/.test(k)) continue;
    for (const parte of String(v).split(/[\/,;|]|\se\s/)) {
      const d = parte.replace(/\D/g, '');
      if (d.length >= 8 && d.length <= 13) tels.add(d);
    }
  }
  return [...tels];
}

// { a: { b: 1 }, servicos: [{ c: 2 }] } -> [['a.b', 1], ['servicos.0.c', 2]] (só valores simples)
function achatar(obj, prefixo = '', saida = [], nivel = 0, maximo = 4) {
  if (!obj || typeof obj !== 'object' || nivel > maximo) return saida;
  for (const [k, v] of Object.entries(obj)) {
    const chave = prefixo ? `${prefixo}.${k}` : k;
    if (v && typeof v === 'object') achatar(v, chave, saida, nivel + 1, maximo);
    else if (v !== null && v !== undefined && String(v).trim() !== '') saida.push([chave.toLowerCase(), v]);
  }
  return saida;
}

// Endereço de instalação/serviço vem antes do endereço de cobrança do cliente
function buscarCampo(campos, regex) {
  const achados = campos.filter(([k]) => regex.test(k) && !/(_id|\.id|id)$/.test(k));
  const peso = (k) => (/instal/.test(k) ? 0 : /servic/.test(k) ? 1 : /cobranca|fatura/.test(k) ? 3 : 2);
  achados.sort((a, b) => peso(a[0]) - peso(b[0]));
  return achados.length ? String(achados[0][1]).trim() : undefined;
}

// Se o SGP não mandar endereço ou telefone reconhecível, mostra só os NOMES dos campos (nunca os
// valores), uma vez por execução, para dar para ajustar o código sem expor dados de cliente.
let avisouSemEndereco = false;
function avisarSemEndereco(c, bruto) {
  if ((c.endereco && c.telefones.length) || avisouSemEndereco) return;
  avisouSemEndereco = true;
  const falta = [!c.endereco && 'endereço', !c.telefones.length && 'telefone'].filter(Boolean).join(' e ');
  const nomes = [...new Set(achatar(bruto).map(([k]) => k.replace(/\.\d+\./g, '.N.')))].join(', ');
  try { require('./log').registrar(`[SGP] contrato sem ${falta} reconhecido. Campos recebidos: ${nomes}`); } catch {}
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
      // Parcela de acordo de pagamento (o SGP manda acordoPagamento com as faturas acordadas/cobradas)
      acordo: ehAcordo(t),
      status: String(primeiro(t, ['status', 'situacao']) || '').toLowerCase(),
    }))
    .filter((t) => !t.status || /abert|pend|venc/.test(t.status))
    // Ordena pela data de verdade (o SGP pode mandar 2026-10-10 ou 10/10/2026); sem data vai pro fim
    .sort((a, b) => String(u.paraISO(a.vencimento) || '9999').localeCompare(String(u.paraISO(b.vencimento) || '9999')));
}

// ---------- Faturas pagas num dia (fechamento de caixa) ----------
// dataISO: "AAAA-MM-DD". Busca todas as páginas (o SGP devolve até 250 por vez).
async function titulosPagos(dataISO) {
  if (cfg.sgp.mock) return mock.titulosPagos();
  const todos = [];
  for (let offset = 0, pagina = 0; pagina < 20; pagina++) {
    const r = await post('/api/ura/titulos/', {
      status: 'pagos', data_pagamento_inicio: dataISO, data_pagamento_fim: dataISO,
      ordenar: 'data_pagamento', ordenar_ordem: 'asc', limit: 250, offset,
    });
    const lista = primeiro(r, ['titulos', 'faturas', 'dados']) || [];
    todos.push(...lista);
    const total = Number(primeiro(r, ['paginacao.total'])) || 0;
    offset += lista.length;
    if (!lista.length || offset >= total) break;
  }
  return todos.map((t) => ({
    id: primeiro(t, ['id', 'titulo', 'tituloId']),
    cliente: primeiro(t, ['clienteNome', 'cliente', 'nome']) || '',
    cpf: u.soDigitos(primeiro(t, ['clienteCpfcnpj', 'cpfcnpj', 'cpf_cnpj'])),
    contrato: primeiro(t, ['clienteContrato', 'contrato']),
    valor: Number(String(primeiro(t, ['valorPago', 'valor_pago', 'valorCorrigido', 'valor']) ?? 0).replace(',', '.')) || 0,
    data: String(primeiro(t, ['dataPagamento', 'data_pagamento']) || ''),
    usuario: String(primeiro(t, ['usuario_baixa', 'usuarioBaixa']) || ''),
    portador: String(primeiro(t, ['portador']) || ''),
    forma: String(primeiro(t, ['formaPagamento', 'forma_pagamento']) || ''),
  }));
}

// ---------- Abrir chamado (ocorrência + ordem de serviço) ----------
// Retorna { ok, protocolo, mensagem }
// responsavel = usuário (username) do técnico no SGP que fica como responsável da O.S. e da ocorrência
async function criarChamado(contrato, conteudo, { contatoNome, contatoTelefone, responsavel, auxiliares = [] } = {}) {
  if (cfg.sgp.mock) return { ok: true, protocolo: '2026110300001', mensagem: '' };
  const dados = { contrato: Number(contrato) || contrato, conteudo, conteudolimpo: 1 };
  if (contatoNome) dados.contato_nome = contatoNome;
  if (contatoTelefone) dados.contato_telefone = contatoTelefone;
  if (responsavel) {
    dados.responsavel = responsavel; // técnico responsável da ordem de serviço
    dados.responsaveloc = responsavel; // responsável da ocorrência
  }
  if (auxiliares.length) dados.tecnicos = auxiliares; // técnicos auxiliares da O.S. (usuários do SGP)
  const r = await post('/api/ura/chamado/', dados);
  const status = primeiro(r, ['status', 'sucesso', 'success']);
  return {
    ok: status === 1 || status === '1' || status === true,
    protocolo: primeiro(r, ['protocolo', 'protocolo_id', 'ocorrencia']),
    mensagem: primeiro(r, ['msg', 'mensagem', 'message']) || '',
  };
}

// Ocorrências ainda abertas de um contrato (para avisar antes de abrir outra igual)
async function ocorrenciasAbertas(contrato) {
  if (cfg.sgp.mock) return [];
  const r = await post('/api/ura/ocorrencia/list/', { contrato: Number(contrato) || contrato, limit: 50 });
  const lista = primeiro(r, ['ocorrencias', 'dados']) || [];
  return (Array.isArray(lista) ? lista : [lista])
    .filter((o) => o && !o.data_finalizacao && !/encerr|finaliz|fechad|cancel|conclu/i.test(String(o.status || '')))
    .map((o) => ({ numero: o.numero, status: o.status || '', data: o.data_cadastro || '', conteudo: String(o.conteudo || '').replace(/\s+/g, ' ').slice(0, 120), tipo: o.tipo || '' }));
}

// ---------- Atualizar cadastro (técnicos) ----------
// Telefone: a API só ADICIONA um contato ao contrato (o antigo continua no cadastro)
async function adicionarContato(contrato, contato, tipo = 'CELULAR_PESSOAL') {
  if (cfg.sgp.mock) return { ok: true, mensagem: '' };
  try {
    const r = await post('/api/ura/contato/add/', { contrato: Number(contrato) || contrato, contato, tipo });
    const status = primeiro(r, ['status', 'sucesso', 'success']);
    const erro = primeiro(r, ['erro', 'error']);
    return { ok: !erro && status !== 0 && status !== '0' && status !== false, mensagem: String(primeiro(r, ['msg', 'mensagem', 'message', 'erro', 'error']) || '') };
  } catch (e) {
    return { ok: false, mensagem: e.motivo || e.message };
  }
}

// Ponto de referência: a API não altera o endereço; registra uma anotação no cliente (aparece no cadastro e no contrato)
async function adicionarAnotacao(clienteId, contratoId, anotacao) {
  if (cfg.sgp.mock) return { ok: true, mensagem: '' };
  if (!clienteId) return { ok: false, mensagem: 'o SGP não informou o ID do cliente' };
  try {
    const r = await post('/api/ura/cliente/anotacao/add', { cliente_id: Number(clienteId) || clienteId, contrato_id: Number(contratoId) || contratoId, anotacao, alerta_modo: 2 });
    const id = primeiro(Array.isArray(r) ? r[0] : r, ['clienteAnotacaoId', 'id']);
    return { ok: Boolean(id), mensagem: String(primeiro(r, ['msg', 'mensagem', 'message', 'erro']) || '') };
  } catch (e) {
    return { ok: false, mensagem: e.motivo || e.message };
  }
}

// ---------- Técnicos cadastrados no SGP ({ id, username, nome }), guardados por 1 hora ----------
let cacheTecnicos = { em: 0, lista: [] };
async function listarTecnicos() {
  if (cfg.sgp.mock) return [{ id: 1, username: 'tecnico.teste', nome: 'Tecnico Teste' }];
  if (Date.now() - cacheTecnicos.em < 3600000 && cacheTecnicos.lista.length) return cacheTecnicos.lista;
  const r = await post('/api/ura/tecnicos/', {});
  const lista = (Array.isArray(r) ? r : Object.values(r || {}).find(Array.isArray) || [])
    .map((t) => ({ id: t.id, username: String(t.username || t.usuario || ''), nome: String(t.nome || t.name || '') }))
    .filter((t) => t.username);
  cacheTecnicos = { em: Date.now(), lista };
  return lista;
}

// ---------- Pré-cadastro de cliente novo ----------
// d = { nome, cpfcnpj (só dígitos), celular, endereco, referencia, vencimentoId, planoId, popId, portadorId, cidade, uf, observacao }
// Retorna { ok, id, mensagem }
// Listas do pré-cadastro (planos, vencimentos) direto do SGP, guardadas por 1h
const cacheListas = {};
async function listaPreCadastro(tipo) {
  if (cfg.sgp.mock) {
    return tipo === 'plano' ? [{ id: '12', descricao: 'Fibra - Plano 300 Megas CIDADE' }, { id: '9', descricao: 'Fibra - PLANO 300 MEGAS JUAREZ' }, { id: '26', descricao: 'Fibra - PLANO 400 MEGAS' }]
      : [{ id: '3', descricao: '5' }, { id: '1', descricao: '10' }, { id: '4', descricao: '15' }];
  }
  const c = cacheListas[tipo];
  if (c && Date.now() - c.em < 3600000) return c.lista;
  const r = await post(`/api/precadastro/${tipo}/list`, {});
  const bruto = Array.isArray(r) ? r : Object.values(r || {}).find(Array.isArray) || [];
  const lista = bruto.map((x) => ({
    id: String(primeiro(x, ['id', 'plano_id', 'vencimento_id']) ?? ''),
    descricao: String(primeiro(x, ['descricao', 'nome', 'dia', 'vencimento', 'plano']) ?? '').replace(/\s+/g, ' ').trim(),
    tipo: String(primeiro(x, ['tipo', 'tecnologia']) || ''),
  })).filter((x) => x.id);
  cacheListas[tipo] = { em: Date.now(), lista };
  return lista;
}

async function criarPreCadastro(d) {
  if (cfg.sgp.mock) return { ok: true, id: '9001', mensagem: '' };
  const tipo = d.cpfcnpj.length === 14 ? 'J' : 'F';
  const corpo = {
    nome: d.nome,
    cpfcnpj: u.formatarDoc(d.cpfcnpj),
    celular: d.celular,
    logradouro: d.endereco,
    pontoreferencia: d.referencia,
    cidade: d.cidade,
    uf: d.uf,
    pais: 'BR',
    plano_id: d.planoId,
    vencimento_id: d.vencimentoId,
    pop_id: d.popId,
    portador_id: d.portadorId,
    observacao: d.observacao,
  };
  for (const k of Object.keys(corpo)) if (corpo[k] === undefined || corpo[k] === null || corpo[k] === '') delete corpo[k];
  let r;
  try {
    r = await post(`/api/precadastro/${tipo}`, corpo);
  } catch (e) {
    return { ok: false, id: null, mensagem: e.motivo || e.message };
  }
  const status = primeiro(r, ['status', 'sucesso', 'success']);
  const id = primeiro(r, ['precadastro_id', 'precadastroId', 'cliente_id', 'id']);
  const mensagem = String(primeiro(r, ['msg', 'mensagem', 'message', 'erro']) || '');
  const recusou = status === 0 || status === '0' || status === false || /erro|invalid|obrigat/i.test(String(status));
  return { ok: !recusou && (Boolean(id) || status === 1 || status === '1' || status === true), id: id ? String(id) : null, mensagem };
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
// IP do cliente: vem na listagem de clientes do SGP (servicos[].ip e, com exibir_conexao, o IP da conexão online)
async function ipDoContrato(contrato) {
  if (cfg.sgp.mock) return '';
  const r = await post('/api/ura/clientes/', { contrato, exibir_conexao: 1, omitir_titulos: 1, omitir_contatos: 1, limit: 5 });
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  const campos = achatar(r, '', [], 0, 10).filter(([k, v]) => ipv4.test(String(v).trim()) && String(v).trim() !== '0.0.0.0' && /(^|[._])(ip|ipv4|framedipaddress|ip_address|endereco_ip|servico_ip|online_ip|servico_online_ip)$/i.test(k) && !/voip|nas|olt|gateway|mascara|dns|cto/i.test(k));
  // Preferência: IP da conexão online > IP do serviço > qualquer outro
  const achado = campos.find(([k]) => /conex|online|framed|radacct/i.test(k)) || campos.find(([k]) => /servico/i.test(k)) || campos[0];
  return achado ? String(achado[1]).trim() : '';
}

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
    if (cpf.endsWith('33')) return [{ id: 1003, nome: 'CLIENTE EM DIA', status: 'Ativo', endereco: 'Rua B, 20 - Centro', telefones: ['83988887777'] }];
    if (cpf.endsWith('22')) {
      return [
        { id: 1001, nome: 'CLIENTE TESTE DA SILVA', status: 'Ativo', endereco: 'Rua A, 10 - Centro - Cidade Exemplo/UF', referencia: 'Ao lado da igreja matriz', plano: 'FIBRA 300 MEGA', telefones: ['83999990000'] },
        { id: 1002, nome: 'CLIENTE TESTE', status: 'Suspenso', endereco: 'Sítio Boa Vista', referencia: 'Depois do açude, porteira azul', telefones: ['83999990000'] },
      ];
    }
    return [{ id: 1001, nome: 'CLIENTE TESTE DA SILVA', status: 'Ativo', endereco: { logradouro: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'Cidade Exemplo', uf: 'UF' }, plano: 'FIBRA 300 MEGA' }].map((c) => ({ ...c, endereco: montarEndereco(c.endereco), telefones: [] }));
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
  titulosPagos() {
    const hoje = new Date().toISOString().slice(0, 10);
    return [
      { id: 80, cliente: 'CLIENTE TESTE DA SILVA', contrato: 1001, valor: 99.9, data: `${hoje} 09:15:00`, usuario: 'caixa.teste', portador: 'Caixa Local', forma: 'Dinheiro' },
      { id: 81, cliente: 'MARIA DE TESTE', contrato: 1004, valor: 79.9, data: `${hoje} 10:40:00`, usuario: 'caixa.teste', portador: 'Caixa Local', forma: 'PIX' },
      { id: 82, cliente: 'JOSE EXEMPLO', contrato: 1005, valor: 49.9, data: `${hoje} 11:05:00`, usuario: 'outro.usuario', portador: 'Banco', forma: 'Cartão de Débito' },
    ];
  },
  liberarPromessa() {
    const ate = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    return { ok: true, mensagem: 'Promessa liberada', protocolo: '2026102600001', ate };
  },
};

module.exports = { consultarCliente, consultarContrato, consultarTelefone, ocorrenciasAbertas, titulosAbertos, titulosPagos, ipDoContrato, listaPreCadastro, criarChamado, listarTecnicos, adicionarContato, adicionarAnotacao, criarPreCadastro, liberarPromessa, verificarAcesso };
