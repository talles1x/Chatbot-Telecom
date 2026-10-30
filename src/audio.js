// Copyright (c) 2026 Talles Oliveira (github.com/talles1x)
// Licença MIT: pode usar e modificar, mantendo este aviso de autoria. Veja o arquivo LICENSE.
// Transcrição de áudio LOCAL (Whisper rodando no próprio computador, nada é enviado para fora).
// Na primeira vez o modelo é baixado (~150 MB no "base") e fica salvo na pasta "modelos".
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const cfg = require('./config');

let pipelinePromessa = null;
let fila = Promise.resolve(); // um áudio por vez (poupa o processador)

async function carregarModelo() {
  if (!pipelinePromessa) {
    pipelinePromessa = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.cacheDir = path.join(__dirname, '..', 'modelos');
      console.log(`[áudio] carregando modelo ${cfg.audio.modelo} (a primeira vez baixa o modelo, pode demorar)...`);
      const p = await pipeline('automatic-speech-recognition', cfg.audio.modelo, { dtype: 'q8' });
      console.log('[áudio] modelo pronto - o bot já entende áudios');
      return p;
    })().catch((e) => {
      pipelinePromessa = null;
      throw e;
    });
  }
  return pipelinePromessa;
}

// Converte qualquer áudio (ogg/opus do WhatsApp, mp3, m4a...) para PCM 16 kHz mono
function decodificar(arquivo) {
  return new Promise((resolve, reject) => {
    execFile(
      ffmpeg,
      ['-hide_banner', '-loglevel', 'error', '-i', arquivo, '-t', String(cfg.audio.maxSegundos), '-ar', '16000', '-ac', '1', '-f', 'f32le', 'pipe:1'],
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
      (erro, saida) => {
        if (erro) return reject(erro);
        resolve(new Float32Array(saida.buffer, saida.byteOffset, Math.floor(saida.byteLength / 4)));
      }
    );
  });
}

// dados: Buffer do áudio. Retorna o texto, ou null se não deu para entender.
function transcrever(dados) {
  const tarefa = fila.then(async () => {
    const tmp = path.join(os.tmpdir(), `bot-audio-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.writeFileSync(tmp, dados);
    try {
      const amostras = await decodificar(tmp);
      if (amostras.length < 16000 * 0.5) return null; // menos de meio segundo
      const asr = await carregarModelo();
      const inicio = Date.now();
      const r = await asr(amostras, { language: 'portuguese', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
      const texto = String((r && r.text) || '').trim();
      if (cfg.debug) console.log(`[áudio] transcrito em ${((Date.now() - inicio) / 1000).toFixed(1)}s`);
      // Whisper às vezes "inventa" frases em silêncio/ruído
      if (!texto || /^(\[.*\]|\(.*\)|legendas? (pela|por)|obrigad[oa]\.?)$/i.test(texto)) return null;
      return texto;
    } finally {
      fs.rm(tmp, { force: true }, () => {});
    }
  });
  fila = tarefa.catch(() => {});
  return tarefa;
}

// Carrega o modelo já na inicialização, para o primeiro áudio não demorar
function preCarregar() {
  carregarModelo().catch((e) => console.error('[áudio] não consegui carregar o modelo:', e.message));
}

module.exports = { transcrever, preCarregar };
