// Copyright (c) 2026 Talles Oliveira (github.com/talles1x)
// Licença MIT: pode usar e modificar, mantendo este aviso de autoria. Veja o arquivo LICENSE.
// Simulador: conversa com o bot pelo terminal, sem WhatsApp.
// npm run simular        -> usa o SGP de verdade (.env)
// npm run simular:mock   -> usa dados falsos
// Comandos: #humano (simula o atendente assumindo), #bot ou #fim (religa), #foto, #audio arquivo.ogg, sair
const readline = require('readline');
const cfg = require('./config');
const u = require('./util');
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
  // PDFs (ex.: fechamento de caixa) ficam salvos na pasta "dados" em vez de ir pelo WhatsApp
  enviarPdf: async (_, html, nome, legenda) => {
    const path = require('path');
    const fs = require('fs');
    const pasta = path.join(__dirname, '..', 'dados');
    fs.mkdirSync(pasta, { recursive: true });
    let arquivo = path.join(pasta, nome);
    try {
      const puppeteer = require('puppeteer');
      const navegador = await puppeteer.launch({ headless: true });
      const page = await navegador.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      await page.pdf({ path: arquivo, format: 'A4', printBackground: true });
      await navegador.close();
    } catch {
      arquivo = arquivo.replace(/\.pdf$/, '.html'); // sem navegador: salva o HTML (abre no navegador e imprime)
      fs.writeFileSync(arquivo, html);
    }
    console.log(`\n🤖 BOT: [PDF salvo em ${arquivo}]\n${legenda}\n`);
  },
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
console.log(`Simulador do bot ${cfg.empresa} ${cfg.sgp.mock ? '(SGP MOCK - dados falsos)' : `(SGP: ${cfg.sgp.url})`}`);
console.log('Digite como se fosse o cliente. Comandos: #humano, #bot, #fim, #foto, #audio arquivo.ogg, sair\n');
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
    if (linha === '#bot' || u.ehEncerramento(linha)) { fluxo.retomar(CHAT); console.log('   (bot religado)\n'); continue; }
    if (fluxo.estaPausado(CHAT)) { console.log('   (bot pausado - mensagem vai só para o atendente)\n'); continue; }
    if (linha === '#foto') { await fluxo.receber(CHAT, '', { naoTexto: true, tipo: 'image' }); continue; }
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
