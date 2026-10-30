// Copyright (c) 2026 Talles Oliveira (github.com/talles1x)
// Licença MIT: pode usar e modificar, mantendo este aviso de autoria. Veja o arquivo LICENSE.
// Teste das palavras-chave: node teste/entender.test.js
const e = require('../src/entender');
let falhas = 0;
const conf = (nome, obtido, esperado, frase) => {
  if (obtido !== esperado) { falhas++; console.log(`❌ ${nome}: "${frase}" -> ${obtido} (esperado ${esperado})`); }
};
const INT = {
  'oi': null, 'bom dia': null, 'boa tarde, tudo bem?': null, 'olá': null,
  'preciso do boleto': 'financeiro', 'manda meu bolet pfv': 'financeiro', 'quero a 2 via': 'financeiro', 'segunda via da fatura': 'financeiro',
  'qual o pix?': 'financeiro', 'quando vence minha conta de internet': 'financeiro', 'minha internet foi bloqueada': 'financeiro',
  'quero fazer a promessa': 'financeiro', 'libera minha internet por favor': 'financeiro', 'preciso de uma liberação de confiança': 'financeiro',
  'to sem internet': 'suporte', 'sem net desde ontem': 'suporte', 'minha net caiu': 'suporte', 'a internet ta lenta': 'suporte',
  'internet caindo toda hora': 'suporte', 'a luz do aparelho ta vermelha': 'suporte', 'o wifi nao pega no quarto': 'suporte',
  'quero trocar a senha do wi-fi': 'suporte', 'nao ta funcionando nada': 'suporte', 'caiu a internet aqui': 'suporte', 'roteador apagado': 'suporte',
  'vcs instalam no meu bairro?': 'contratar', 'quanto custa a internet?': 'contratar', 'quais os planos?': 'contratar',
  'quero colocar internet na minha casa': 'contratar', 'a fibra chega no sitio boa vista?': 'contratar', 'quero ser cliente': 'contratar',
  'ja paguei e continua bloqueado': 'atendente', 'segue o comprovante': 'atendente', 'quero mudar de plano': 'atendente',
  'vou mudar de endereço, como faço?': 'atendente', 'ja fiz o pix': 'atendente',
  'o tecnico chega aqui que horas?': 'suporte',
};
for (const [f, esp] of Object.entries(INT)) conf('intenção', e.detectarIntencao(f), esp, f);

const IRR = { 'isso é um absurdo': true, 'vou no procon': true, 'quero cancelar minha internet': true, 'que porra é essa': true,
  'ninguem responde nessa merda': true, 'vou trocar de provedor': true, 'pessimo atendimento': true,
  'a internet ta lenta': false, 'bom dia': false, 'preciso do boleto': false, 'a luz ta vermelha': false, 'obrigado': false };
for (const [f, esp] of Object.entries(IRR)) conf('irritado', e.ehIrritado(f), esp, f);

const OBR = { 'obrigado': true, 'obrigadooo!!': true, 'obg': true, 'vlw': true, 'valeu demais': true, 'ok': true, 'okkk': true,
  'ok obrigado': true, 'muito obrigada pela ajuda': true, 'tá bom': true, 'blz, obrigado': true, 'deus te abençoe': false, 'show de bola': true,
  '👍': true, '🙏🙏': true, 'tmj': true, 'obrigado, mas ainda ta sem internet': false, 'ok mas e o boleto?': false, 'bom dia': false,
  'sim': false, 'oi': false, 'boa noite': false, 'obrigado boa noite': true };
for (const [f, esp] of Object.entries(OBR)) conf('agradecimento', e.ehAgradecimento(f), esp, f);

const ATD = { 'quero falar com um atendente': true, 'falar com alguem': true, 'atendimento humano': true, 'é um robo?': true,
  'nao quero falar com robo': true, 'me liga por favor': true, 'quero o boleto': false, 'a internet caiu': false };
for (const [f, esp] of Object.entries(ATD)) conf('atendente', e.querAtendente(f), esp, f);

const DOC = { 'meu cpf é 529.982.247-25': '52998224725', '52998224725': '52998224725', 'cpf 529 982 247 25': '52998224725',
  'cnpj 11.222.333/0001-81': '11222333000181', 'meu telefone 83991234567': null, 'oi': null };
for (const [f, esp] of Object.entries(DOC)) conf('documento', e.extrairDoc(f), esp, f);


module.exports = { falhas: () => falhas, conf };

// ---------- Respostas livres para as enquetes ----------
const { OP } = require('../src/fluxo');
const OPC = {
  confirmarDoc: { 'sim': 's', 'isso mesmo': 's', 'sou eu sim': 's', 'pode usar': 's', 'nao, é outro': 'o', 'quero usar outro cpf': 'o', 'não sou eu': 'o' },
  uso: { 'pra casa mesmo': '1', 'só whats e youtube': '1', 'jogar e netflix': '2', 'pro meu trabalho': '3', 'home office': '3', 'sei la': '4', 'nao sei ainda': '4' },
  problema: { 'to sem internet': '1', 'caiu tudo': '1', 'nao funciona nada': '1', 'ta muito lenta': '2', 'travando demais': '2',
    'fica caindo toda hora': '3', 'vai e volta': '3', 'cai direto': '3', 'quero mudar a senha': '4', 'trocar senha do wifi': '4', 'é outra coisa': '5',
    'internet lenta e caindo': '3' },
  luz: { 'sim': 's', 'tem sim': 's', 'tá vermelha': 's', 'a luz los ta piscando': 's', 'nao': 'n', 'não, nenhuma vermelha': 'n', 'tudo verde': 'n',
    'não sei': 'x', 'como eu vejo isso?': 'x', 'ta desligado': 'd', 'não tem luz nenhuma': 'd', 'nao acende': 'd', 'faltou energia': 'd', 'nao tem luz vermelha': 'n', 'tem uma luz vermelha piscando': 's' },
  reiniciou: { 'sim': 's', 'já': 's', 'ja reiniciei': 's', 'já tirei da tomada': 's', 'nao, ja reiniciei': 's', 'varias vezes': 's',
    'não': 'n', 'ainda não': 'n', 'como faz isso?': 'n', 'ainda nao reiniciei': 'n' },
  resolveu: { 'sim': 's', 'voltou': 's', 'sim voltou': 's', 'agora foi': 's', 'funcionou obrigado': 's', 'deu certo': 's',
    'não': 'n', 'nao voltou': 'n', 'continua a mesma coisa': 'n', 'nada': 'n', 'ainda não': 'n', 'não funcionou': 'n', 'piorou': 'n' },
  bloqueado: { 'quero a liberação': 'p', 'libera ai': 'p', 'manda o boleto': 'b', 'vou pagar no pix': 'b', 'continuar com o suporte': 'c' },
  financeiro: { 'boleto': '1', 'quero a 2ª via': '1', 'manda o pix': '1', 'a liberação de confiança': '2', 'desbloqueia': '2' },
};
for (const [lista, casos] of Object.entries(OPC)) {
  for (const [f, esp] of Object.entries(casos)) conf(`opção ${lista}`, e.casarOpcao(f, OP[lista]), esp, f);
}
console.log(module.exports.falhas() ? `\n${module.exports.falhas()} falha(s) no total` : '✅ todos os casos passaram (intenção, irritação, agradecimento, atendente, CPF e enquetes)');
