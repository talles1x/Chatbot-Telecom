// Copyright (c) 2026 Talles Oliveira (github.com/talles1x)
// Licença MIT: pode usar e modificar, mantendo este aviso de autoria. Veja o arquivo LICENSE.
// Simulador: conversa com o bot pelo terminal, sem WhatsApp.
// npm run simular        -> usa o SGP de verdade (.env)
// npm run simular:mock   -> usa dados falsos
// Comandos: #humano (simula o atendente assumindo), #bot (religa), #foto, #audio arquivo.ogg, sair
const readline = require('readline');
const cfg = require('./config');
const { criarFluxo } = require('./fluxo');
const { criarEstado } = require('./estado');

const CHAT = 'simulador@c.us';
const fila = [];
let rodando = false;

const fluxo = criarFluxo({
  enviar: async (_, texto) => console.log(`\n🤖 BOT:\n${texto}\n`),
  enviarImagem: async (_, arquivo, legenda) => console.log(`\n🤖 BOT: [imagem: ${require('path').basename(arquivo)}]\n${legenda}\n`),
  aoTransferir: async () => console.log('   (conversa transferida para o atendente - bot pausado. Digite #bot para religar)\n'),
  log: (m) => console.log(`   ${m}`),
  estado: criarEstado('estado-simulador.json'),
  // "WhatsApp" do simulador. No modo mock, 5583999990000 é o telefone dos contratos do CPF de teste.
  numeroDoChat: async () => process.env.SIMULADOR_NUMERO || '',
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
console.log(`Simulador do bot ${cfg.empresa} ${cfg.sgp.mock ? '(SGP MOCK - dados falsos)' : `(SGP: ${cfg.sgp.url})`}`);
console.log('Digite como se fosse o cliente. Comandos: #humano, #bot, #foto, #audio arquivo.ogg, sair\n');
if (process.stdin.isTTY) rl.setPrompt('👤 Você: '), rl.prompt();

async function processar() {
  if (rodando) return;
  rodando = true;
  while (fila.length) {
    const linha = fila.shift().trim();
    if (!linha) continue;
    if (!process.stdin.isTTY) console.log(`👤 Você: ${linha}`);
    if (linha === 'sair') process.exit(0);
    if (linha === '#humano') { fluxo.pausar(CHAT); console.log('   (atendente assumiu - bot pausado)\n'); continue; }
    if (linha === '#bot') { fluxo.retomar(CHAT); console.log('   (bot religado)\n'); continue; }
    if (fluxo.estaPausado(CHAT)) { console.log('   (bot pausado - mensagem vai só para o atendente)\n'); continue; }
    if (linha === '#foto') { await fluxo.receber(CHAT, '', { naoTexto: true }); continue; }
    // #audio caminho\do\arquivo.ogg -> transcreve e manda como se o cliente tivesse falado
    if (linha.startsWith('#audio ')) {
      const texto = await require('./audio').transcrever(require('fs').readFileSync(linha.slice(7).trim().replace(/^"|"$/g, ''))).catch((e) => console.log('   erro:', e.message));
      console.log(`   🎤 transcrição: ${texto || '(não entendi)'}`);
      await fluxo.receber(CHAT, texto || '', texto ? { audio: true } : { naoTexto: true });
      continue;
    }
    await fluxo.receber(CHAT, linha);
  }
  rodando = false;
  if (process.stdin.isTTY) rl.prompt();
}

rl.on('line', (l) => { fila.push(l); processar(); });
rl.on('close', async () => { while (rodando || fila.length) await new Promise((r) => setTimeout(r, 50)); process.exit(0); });
