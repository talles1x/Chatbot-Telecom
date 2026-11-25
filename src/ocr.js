// Copyright (c) 2026 Talles Oliveira (github.com/talles1x)
// Licença MIT: pode usar e modificar, mantendo este aviso de autoria. Veja o arquivo LICENSE.
// Leitura de texto em imagens (OCR) no próprio computador, com tesseract.js e o modelo em português.
// Usado para o técnico mandar o print da ficha do cliente e o bot achar o contrato no SGP.
const path = require('path');
const fs = require('fs');

let worker = null;
let carregando = null;

async function iniciar() {
  const { createWorker } = require('tesseract.js');
  const pasta = path.dirname(require.resolve('@tesseract.js-data/por/package.json'));
  const langPath = path.join(pasta, '4.0.0_best_int');
  const cachePath = path.join(__dirname, '..', 'modelos', 'ocr');
  fs.mkdirSync(cachePath, { recursive: true });
  return createWorker('por', 1, { langPath, cachePath, gzip: true });
}

// Texto da imagem (Buffer) ou null se o OCR não estiver instalado / falhar
async function lerTexto(buffer, log = console.log) {
  try {
    if (!worker) {
      carregando = carregando || iniciar();
      worker = await carregando;
    }
    const r = await worker.recognize(buffer);
    return (r && r.data && r.data.text) || '';
  } catch (e) {
    carregando = null;
    worker = null;
    log(`[imagem] não consegui ler a imagem (${e.message}) - rode o instalar.bat`);
    return null;
  }
}

// Do texto lido: nome do cliente e números que podem ser o ID/contrato no SGP
function dadosDaFicha(texto) {
  const linhas = String(texto || '').split('\n').map((l) => l.trim()).filter(Boolean);
  // Nome: a linha depois de "Nome", ou a primeira linha só de letras maiúsculas com 2+ palavras
  let nome = '';
  const iNome = linhas.findIndex((l) => /^nome\b/i.test(l));
  if (iNome >= 0) nome = linhas[iNome].replace(/^nome\s*:?\s*/i, '') || linhas[iNome + 1] || '';
  if (!/[a-zà-ú]{2,}\s+[a-zà-ú]{2,}/i.test(nome)) {
    nome = linhas.find((l) => /^[A-ZÀ-Ú][A-ZÀ-Ú .']+$/.test(l) && l.split(/\s+/).length >= 2 && !/\b(ZONA|RURAL|RUA|SITIO|SÍTIO|AVENIDA|ATIVO|SUSPENSO|CANCELADO)\b/.test(l)) || '';
  }
  // CPF/CNPJ, se aparecer na imagem
  const doc = (String(texto || '').match(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/) || [''])[0].replace(/\D/g, '');
  // Números: tira CPF/CNPJ, datas, horas, telefones, coordenadas e CEP; sobram os IDs (1 a 7 dígitos)
  const limpo = String(texto || '')
    .replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g, ' ')
    .replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, ' ')
    .replace(/\d{1,2}:\d{2}(:\d{2})?/g, ' ')
    .replace(/\(?\d{2}\)?\s*9?\s?\d{4}[-\s]?\d{3,4}/g, ' ')
    .replace(/-?\d+[.,]\s?\d{3,}/g, ' ')
    .replace(/\d{5}-\d{3}/g, ' ');
  const numeros = [...new Set((limpo.match(/\b\d{2,7}\b/g) || []))].slice(0, 6);
  return { nome: nome.trim(), numeros, doc };
}

// O texto parece o print da ficha do cliente no app do SGP? (documento, foto de casa etc. não)
function ehFichaSgp(texto) {
  const t = String(texto || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const marcas = [/latitude/, /longitude/, /contrato\s*status/, /data do status/, /copiar/, /observac/, /endere/, /contato/];
  return marcas.filter((m) => m.test(t)).length >= 3;
}

module.exports = { lerTexto, dadosDaFicha, ehFichaSgp };
