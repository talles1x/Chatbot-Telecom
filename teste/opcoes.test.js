// Copyright (c) 2026 Talles Oliveira (github.com/talles1x)
// Licença MIT: pode usar e modificar, mantendo este aviso de autoria. Veja o arquivo LICENSE.
// Respostas escritas pelo cliente em vez do número da opção (ex.: "a luz está verde" = "Não, nenhuma vermelha")
const e = require('../src/entender');
const { OP } = require('../src/fluxo');
const casos = {
  luz: { 'A luz está verde':'n','tudo verde':'n','ta tudo verdinho':'n','não tem nenhuma vermelha':'n','nenhuma luz vermelha':'n','não tem vermelha':'n','está normal':'n','as luzes estão verdes':'n','não':'n','nao tem':'n',
    'tem uma vermelha':'s','sim tem':'s','está vermelha':'s','o los está aceso':'s','pisca vermelho':'s','a luz vermelha ta piscando':'s','tem sim uma luz vermelha':'s',
    'está desligado':'d','nao liga':'d','tudo apagado':'d','sem luz nenhuma':'d','nenhuma luz acesa':'d',
    'não sei':'x','não sei ver':'x','como vejo isso':'x','não entendi':'x' },
  reiniciou: { 'já reiniciei':'s','sim já':'s','já tirei da tomada':'s','já desliguei e liguei':'s','reiniciei e nada':'s','já fiz isso':'s','já':'s',
    'não':'n','ainda não':'n','não reiniciei':'n','como faço':'n','vou fazer agora':'n','ainda nao fiz':'n' },
  resolveu: { 'voltou':'s','sim voltou':'s','agora foi':'s','funcionou':'s','já está funcionando':'s','deu certo':'s','resolveu':'s',
    'não':'n','não voltou':'n','continua':'n','continua sem internet':'n','nada':'n','mesma coisa':'n','ainda não':'n','não funcionou':'n' },
  problema: { 'sem internet':'1','to sem net':'1','não funciona nada':'1','caiu':'1','tá lenta':'2','muito lenta':'2','devagar':'2','lentidão':'2',
    'caindo toda hora':'3','oscilando':'3','fica caindo':'3','instável':'3','cai e volta':'3','quero trocar a senha do wifi':'4','mudar a senha':'4','trocar nome da rede':'4','outro':'5','outra coisa':'5' },
  financeiro: { 'boleto':'1','segunda via':'1','quero o boleto':'1','pix':'1','liberação':'2','liberar':'2','desbloquear':'2','promessa de pagamento':'2','liberação de confiança':'2' },
  bloqueado: { 'liberação':'p','quero liberar':'p','boleto':'b','quero pagar':'b','continuar':'c','suporte':'c' },
  acordo: { 'sim':'a','quero':'a','quero negociar':'a','pode ser':'a','só os boletos':'b','quero ver os boletos':'b','não':'n','agora não':'n','depois':'n' },
  confirmarDoc: { 'sim':'s','sou eu':'s','pode':'s','isso':'s','outro cpf':'o','não':'o','não sou eu':'o','é outro':'o' },
  uso: { 'casa':'1','redes sociais':'1','assistir youtube':'1','jogar':'2','jogos':'2','netflix':'2','trabalho':'3','home office':'3','empresa':'3','não sei':'4' },
};
let falhas=0;
for (const [lista, mapa] of Object.entries(casos)) for (const [f, esp] of Object.entries(mapa)) {
  if (esp===undefined) continue;
  const r=e.casarOpcao(f, OP[lista]); if (r!==esp) { falhas++; console.log(`✗ ${lista.padEnd(12)} "${f}" -> ${r} (esperado ${esp})`); }
}
console.log(falhas ? `${falhas} falha(s) nas respostas escritas` : '✅ respostas escritas reconhecidas em todos os menus');
process.exitCode = falhas ? 1 : 0;
