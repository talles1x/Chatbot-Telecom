// Copyright (c) 2026 Talles Oliveira (github.com/talles1x)
// Licença MIT: pode usar e modificar, mantendo este aviso de autoria. Veja o arquivo LICENSE.
// Entende o texto livre do cliente (digitado ou transcrito de áudio).
// Todas as regras de palavras-chave ficam aqui, para ajustar num lugar só.
// O teste delas fica em teste/entender.test.js (rode: npm test).
const u = require('./util');

// Deixa o texto "comparável": sem acento, minúsculo, sem letras repetidas
// ("obrigadooo" -> "obrigado", "okkk" -> "ok") e com gírias comuns trocadas.
function limpar(texto) {
  let t = u.normalizar(texto)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, ' ') // emoji
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/([a-z])\1{2,}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  const giria = {
    vc: 'voce', vcs: 'voces', tb: 'tambem', tbm: 'tambem', pq: 'porque', q: 'que', oq: 'o que',
    n: 'nao', naum: 'nao', s: 'sim', ss: 'sim', sim: 'sim', to: 'estou', tou: 'estou', ta: 'esta', tah: 'esta',
    net: 'internet', interneti: 'internet', intenet: 'internet', internt: 'internet', wifi: 'wifi', wify: 'wifi', wi: 'wi',
    blz: 'beleza', vlw: 'valeu', obg: 'obrigado', brigado: 'obrigado', brigada: 'obrigada', pfv: 'por favor', pf: 'por favor',
    msm: 'mesmo', mt: 'muito', mto: 'muito', hj: 'hoje', agr: 'agora', dnv: 'de novo', nd: 'nada', cmg: 'comigo',
    bolet: 'boleto', boletu: 'boleto', fatur: 'fatura',
  };
  t = t.split(' ').map((p) => giria[p] || p).join(' ');
  return t.replace(/\bwi fi\b/g, 'wifi').replace(/\bsegunda via\b|\b2 via\b|\b2a via\b|\b2ª via\b/g, 'segunda via');
}

// ---------- Intenção (primeira mensagem / menu) ----------
const INTENCOES = [
  // Já pagou / mandou comprovante: precisa de gente para dar baixa
  ['atendente', /\b(mudar|trocar|aumentar|diminuir|alterar|upgrade)( de| o| do| meu)? plano\b|\bmudanca de endereco\b|\bmudar (de )?endereco\b|\b(transferir|levar|mudar) (a |minha )?internet\b|\bja paguei\b|\bpaguei\b|\bcomprovante\b|\bpago ja\b|\bja (fiz o |efetuei o )?pagamento\b|\bja (fiz o )?pix\b/],
  ['contratar', /\bcontratar\b|\bcontrato novo\b|\binstalam\b|\binstalar (internet|a internet|fibra)\b|\binstalacao (nova|de internet)\b|\bquero (ter |colocar |botar )?(a |uma )?internet\b|\bcobertura\b|\b(internet|fibra) chega\b|\bchega (a )?(internet|fibra)\b|\bvoces chegam\b|\bquanto (custa|e|ta|esta) (a |o )?(internet|plano|mensalidade)\b|\bvalor (da internet|do plano|dos planos)\b|\bplanos\b|\bser cliente\b|\bassinar\b|\bpacote(s)? de internet\b/],
  ['financeiro', /\bboleto\b|\bfatura\b|\bsegunda via\b|\bpix\b|\b(manda|mande|passa|passe|envia|envie|qual|me da)( ai| pra mim)?( a| o| sua| seu)? chave\b(?! d[oa]s? (wi-?fi|rede|roteador|modem|internet))|\bqr ?code\b|\bcopia e cola\b|\bpagar\b|\bpagamento\b|\bmensalidade\b|\bconta (de|da) internet\b|\bvencimento\b|\bvence\b|\bpromessa\b|\bdesbloque|\bbloquead|\bliberacao\b|\blibera(r)?\b|\bdesbloqueia\b|\bconfianca\b|\bcodigo de barras\b|\blinha digitavel\b|\bfinanceiro\b|\bdebito\b|\bem atraso\b|\batrasad/],
  ['suporte', /\bsem internet\b|\bsem sinal\b|\binternet (caiu|cai|caindo|lenta|ruim|parou|oscilando|nao|travando|fraca|horrivel|pessima|instavel)\b|\b(caiu|cai|parou|travou) (a |minha )?internet\b|\blenta\b|\blentidao\b|\bcaindo\b|\boscilando\b|\binstavel\b|\btravando\b|\bwifi\b|\broteador\b|\bmodem\b|\bonu\b|\bnao (pega|funciona|conecta|esta funcionando|ta funcionando|abre|carrega)\b|\bsuporte\b|\btecnico\b|\bluz vermelha\b|\bvermelh|\bluz (do aparelho )?(piscando|apagada|vermelha)\b|\blos\b|\bsenha (do|da) (wifi|rede|internet)\b|\bsinal\b|\bfibra\b|\bsem conexao\b|\bdesconect/],
];

function detectarIntencao(texto) {
  const t = limpar(texto);
  if (!t) return null;
  for (const [nome, re] of INTENCOES) if (re.test(t)) return nome;
  return null;
}

// ---------- Pedido para falar com uma pessoa ----------
const QUER_ATENDENTE = /\batendente\b|\bhumano\b|\batendimento humano\b|\buma pessoa\b|\bfalar com (alguem|algum|uma pessoa|voces|o tecnico|um tecnico|o dono|a moca|o moco|gente)\b|\bquero falar com\b|\bme liga\b|\bliga pra mim\b|\bnao quero (falar com )?(robo|bot|maquina)\b|\b(e |eh )?(um )?robo\b/;
function querAtendente(texto) {
  return QUER_ATENDENTE.test(limpar(texto));
}

// ---------- Reclamação séria / irritação: direto para uma pessoa ----------
const IRRITADO = /\bprocon\b|\banatel\b|\babsurd|\bpalhacada\b|\bvergonha\b|\bpessim|\bhorrivel\b|\bridicul|\bdescaso\b|\blixo\b|\bporra\b|\bcaralho\b|\bmerda\b|\bpqp\b|\bvsf\b|\bfdp\b|\bdesgraca|\binferno\b|\bsafad|\bladr(ao|oes|a)\b|\bcancelar\b|\bcancela\b|\bcancelem\b|\bcancelamento\b|\bdistrato\b|\badvogad|\bjustica\b|\bprocessar\b|\breclame aqui\b|\bnao aguento mais\b|\bestou cansad|\bfalta de respeito\b|\bdesrespeito\b|\bninguem (responde|atende|resolve)|\btoda (hora|semana|vez) (a mesma coisa|isso)\b|\bvou trocar de (provedor|internet|empresa)\b/;
function ehIrritado(texto) {
  return IRRITADO.test(limpar(texto));
}

// ---------- "obrigado", "ok", "valeu", só emoji... ----------
const PALAVRAS_AGRADECIMENTO = new Set(
  ('obrigado obrigada muito muitissimo valeu ok okay beleza certo esta bom show top perfeito otimo massa entendi combinado tudo ' +
    'deu viu mesmo demais pela por ajuda moca moco ai tmj de bola deus abencoe te ate mais logo tchau flw falou e joia ' +
    'agradeco grato grata gratidao sucesso boa noite dia tarde bjs beijo abraco abracos amem show resolvido resolveu certinho isso')
    .split(' ')
);
const NUCLEO_AGRADECIMENTO = /\besta bom\b|\b(obrigad[oa]|valeu|ok|okay|beleza|certo|show|top|perfeito|otimo|massa|entendi|combinado|tmj|joia|agradeco|grat[oa]|gratidao|tchau|flw|falou|amem|resolvido|resolveu|certinho)\b/;
// ---------- "Já voltou", "resolveu", "tá funcionando": problema resolvido ----------
const RESOLVIDO = /\b(ja )?voltou\b|\b(ja )?(esta|ta) funcionando\b|\bfuncionou\b|\bresolveu\b|\bresolvido\b|\bnormalizou\b|\b(ja )?(esta|ta) normal\b|\bvoltou ao normal\b|\bdeu certo\b/;
const NAO_RESOLVIDO = /\bnao (voltou|funcionou|resolveu|normalizou|deu certo|(esta|ta) (funcionando|normal))\b|\bvoltou a (cair|ficar|parar|travar)\b|\bvolta e cai\b|\bvai e volta\b|\bainda nao\b|\bcontinua\b|\b(caiu|parou) de novo\b|\bmas\b.*\b(lent|cai|cain|trav|ruim|fraca|oscil|para|parando)/;
function ehResolvido(texto) {
  const t = limpar(texto);
  return !!t && RESOLVIDO.test(t) && !NAO_RESOLVIDO.test(t);
}

function ehAgradecimento(texto) {
  const bruto = u.normalizar(texto);
  if (bruto && !/[a-z0-9]/.test(bruto)) return true; // só emoji/pontuação ("👍", "🙏")
  const t = limpar(texto);
  if (!t) return false;
  const palavras = t.split(' ');
  if (palavras.length > 8) return false;
  return NUCLEO_AGRADECIMENTO.test(t) && palavras.every((p) => PALAVRAS_AGRADECIMENTO.has(p));
}

// ---------- CPF/CNPJ no meio do texto ----------
function extrairDoc(texto) {
  const candidatos = String(texto || '').match(/\d[\d.\-\/ ]{9,20}\d/g) || [];
  for (const c of candidatos) {
    const d = u.soDigitos(c);
    if ((d.length === 11 && u.cpfValido(d)) || (d.length === 14 && u.cnpjValido(d))) return d;
  }
  return null;
}

// ---------- Resposta livre para uma enquete ----------
// Cada opção pode ter "chave": regex que reconhece a resposta escrita/falada.
// A ordem das opções importa: a primeira que casar vence.
function casarOpcao(texto, opcoes) {
  const t = limpar(texto);
  if (!t) return null;
  const validas = opcoes.filter((o) => !['v', '0', '9'].includes(o.valor));
  // 1) palavras-chave da opção
  const porPrioridade = opcoes.map((o, i) => ({ o, i })).sort((a, b) => (a.o.prioridade || 0) - (b.o.prioridade || 0) || a.i - b.i);
  for (const { o } of porPrioridade) if (o.chave && o.chave.test(t)) return o.valor;
  if (t.length < 3) return null;
  // 2) o texto da opção está na resposta, ou o contrário ("2a via do boleto")
  const achou = validas.filter((o) => {
    const ot = limpar(o.texto);
    return ot.length > 3 && (ot.includes(t) || t.includes(ot));
  });
  if (achou.length === 1) return achou[0].valor;
  return null;
}

module.exports = { limpar, detectarIntencao, querAtendente, ehIrritado, ehAgradecimento, ehResolvido, extrairDoc, casarOpcao };
