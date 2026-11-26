// Copyright (c) 2026 Talles Oliveira (github.com/talles1x)
// Licença MIT: pode usar e modificar, mantendo este aviso de autoria. Veja o arquivo LICENSE.
// Garante que só exista UM bot rodando: ao iniciar, encerra o bot antigo que tenha ficado aberto
// (janela fechada mas processo vivo, segurando a porta do painel e a sessão do WhatsApp).
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ARQUIVO_PID = path.join(__dirname, '..', 'dados', 'bot.pid');
const WINDOWS = process.platform === 'win32';

const rodar = (cmd) => {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 15000 }); } catch { return ''; }
};
const esperar = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function vivo(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
const ps = (script) => rodar(`powershell -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`).trim();
// Só encerra se for mesmo um bot (node rodando src\index.js), nunca outro programa
function ehNode(pid) {
  if (!WINDOWS) return true;
  if (!/node(\.exe)?/i.test(rodar(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`))) return false;
  const linha = ps(`(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`);
  return !linha || /index\.js/i.test(linha);
}
// Encerra o processo e tudo que ele abriu (o Chrome do WhatsApp junto)
function encerrar(pid, motivo, log) {
  if (!pid || pid === process.pid || !vivo(pid) || !ehNode(pid)) return false;
  log(`[início] encerrando o bot antigo que ainda estava aberto (PID ${pid}, ${motivo})`);
  if (WINDOWS) rodar(`taskkill /PID ${pid} /T /F`);
  else { try { process.kill(pid, 'SIGKILL'); } catch {} }
  for (let i = 0; i < 20 && vivo(pid); i++) esperar(250);
  return true;
}
// Quem está escutando nesta porta (Windows)
function pidNaPorta(porta) {
  if (!WINDOWS) return null;
  for (const linha of rodar('netstat -ano -p tcp').split(/\r?\n/)) {
    const m = linha.trim().match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/i);
    if (m && Number(m[1]) === Number(porta)) return Number(m[2]);
  }
  return null;
}
// Chrome do WhatsApp que ficou órfão (bot morreu e o Chrome continuou com a sessão presa)
function encerrarChromeOrfao(pastaSessao, log) {
  if (!WINDOWS) return;
  const alvo = pastaSessao.replace(/'/g, "''");
  const script = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${alvo}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId }`;
  const saida = ps(script);
  if (saida) log(`[início] fechei ${saida.split(/\s+/).length} processo(s) do Chrome que tinham ficado presos na sessão do WhatsApp`);
}

function garantirUnica({ porta, pastaSessao, log = console.log }) {
  let encerrou = false;
  try {
    const antigo = Number(fs.readFileSync(ARQUIVO_PID, 'utf8'));
    encerrou = encerrar(antigo, 'registrado em dados/bot.pid', log) || encerrou;
  } catch {}
  if (porta) encerrou = encerrar(pidNaPorta(porta), `usando a porta ${porta} do painel`, log) || encerrou;
  if (pastaSessao) encerrarChromeOrfao(pastaSessao, log);
  if (encerrou) esperar(1500); // dá tempo do Windows liberar a porta e os arquivos da sessão
  try {
    fs.mkdirSync(path.dirname(ARQUIVO_PID), { recursive: true });
    fs.writeFileSync(ARQUIVO_PID, String(process.pid));
  } catch {}
  process.on('exit', () => {
    try { if (Number(fs.readFileSync(ARQUIVO_PID, 'utf8')) === process.pid) fs.unlinkSync(ARQUIVO_PID); } catch {}
  });
}

// Usado pelo painel se, mesmo assim, a porta estiver ocupada
function liberarPorta(porta, log = console.log) {
  const ok = encerrar(pidNaPorta(porta), `usando a porta ${porta} do painel`, log);
  if (ok) esperar(1000);
  return ok;
}

module.exports = { garantirUnica, liberarPorta };
