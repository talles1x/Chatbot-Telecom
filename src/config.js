// Copyright (c) 2026 Talles Oliveira (github.com/talles1x)
// Licença MIT: pode usar e modificar, mantendo este aviso de autoria. Veja o arquivo LICENSE.
require('dotenv').config();

const num = (v, padrao) => (v === undefined || v === '' ? padrao : Number(v));
const lista = (v) =>
  (v || '')
    .split(',')
    .map((s) => s.replace(/\D/g, ''))
    .filter(Boolean);

function lerTurnos(txt) {
  return txt.split(',').map((t) => {
    const [ini, fim] = t.trim().split('-');
    const min = (h) => {
      const [hh, mm] = h.split(':').map(Number);
      return hh * 60 + (mm || 0);
    };
    return { ini: min(ini), fim: min(fim) };
  });
}

module.exports = {
  sgp: {
    url: (process.env.SGP_URL || '').replace(/\/+$/, ''),
    token: process.env.SGP_TOKEN || '',
    app: process.env.SGP_APP || '',
    formato: (process.env.SGP_FORMATO || 'json').toLowerCase(),
    mock: process.env.SGP_MOCK === 'true' || process.argv.includes('--mock'),
  },
  debug: process.env.DEBUG === 'true',
  empresa: process.env.EMPRESA_NOME || 'Minha Telecom',
  testeNumeros: lista(process.env.TESTE_NUMEROS),
  ignorarNumeros: lista(process.env.IGNORAR_NUMEROS),
  numeroEquipe: lista(process.env.NUMERO_EQUIPE)[0] || '',
  numeroComercial: lista(process.env.NUMERO_COMERCIAL)[0] || '',
  // Números da equipe (ex.: atendente de um ponto de recebimento): recebem o menu da equipe
  // (fechar o caixa, avisar pré-cadastro, falar com atendente) em vez do menu de cliente
  atendentesNumeros: lista(process.env.ATENDENTE_NUMEROS),
  // Números dos técnicos: menu próprio (consultar cliente, ver se está online, criar ocorrência, atendente)
  tecnicosNumeros: lista(process.env.TECNICO_NUMEROS),
  caixa: {
    // Usuários do SGP cujas baixas entram no fechamento (vazio = todos os pagamentos do dia)
    usuarios: (process.env.CAIXA_USUARIOS_SGP || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    // Nome que aparece no título do fechamento (ex.: o local de recebimento)
    nome: process.env.CAIXA_NOME || '',
  },
  horario: {
    dias: (process.env.HORARIO_DIAS || '1,2,3,4,5,6').split(',').map(Number),
    turnos: lerTurnos(process.env.HORARIO_TURNOS || '08:00-12:00,13:00-17:00'),
    texto: process.env.HORARIO_TEXTO || 'segunda a sábado, das 8h às 12h e das 13h às 17h',
  },
  fuso: process.env.FUSO || 'America/Fortaleza',
  promessaMinDias: num(process.env.PROMESSA_MIN_DIAS, 11),
  // Quantos dias a liberação de confiança dura (o mesmo configurado no SGP)
  promessaDias: num(process.env.PROMESSA_DIAS, 2),
  acordoMinDias: num(process.env.ACORDO_MIN_DIAS, 75),
  pausaHumanoHoras: num(process.env.PAUSA_HUMANO_HORAS, 3),
  sessaoMin: num(process.env.SESSAO_MIN, 30),
  lembreteMin: num(process.env.LEMBRETE_MIN, 10),
  agruparMs: num(process.env.AGRUPAR_MS, 2500),
  delay: { min: num(process.env.DELAY_MIN_MS, 800), max: num(process.env.DELAY_MAX_MS, 2500) },
  maxBoletos: 3,
  // Deixa as conversas atendidas pelo bot como NÃO LIDAS no celular (padrão: sim)
  manterNaoLida: process.env.MANTER_NAO_LIDA !== 'false',
  // LGPD: quantos CPFs/CNPJs diferentes um mesmo WhatsApp pode consultar por dia
  limiteDocsDia: num(process.env.LIMITE_CPFS_DIA, 3),
  audio: {
    ativo: process.env.TRANSCREVER_AUDIO !== 'false',
    modelo: process.env.WHISPER_MODELO || 'Xenova/whisper-base',
    maxSegundos: num(process.env.AUDIO_MAX_SEGUNDOS, 90),
  },
};
