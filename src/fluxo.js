// Copyright (c) 2026 Talles Oliveira (github.com/talles1x)
// Licença MIT: pode usar e modificar, mantendo este aviso de autoria. Veja o arquivo LICENSE.
// Lógica da conversa. Não sabe nada de WhatsApp: recebe texto e chama enviar().
// Assim o mesmo fluxo roda no WhatsApp (index.js) e no simulador (simulador.js).
const cfg = require('./config');
const sgp = require('./sgp');
const u = require('./util');
const { criarEstado } = require('./estado');
const ent = require('./entender');
const { registrar, resumo } = require('./log');
const { htmlFechamento } = require('./relatorio');

const MSG = {
  saudacao: () => `Olá! 👋 Aqui é o assistente virtual da *${cfg.empresa}*.`,
  pedirDoc: (inicio = 'Certo!') => `${inicio} Me manda o *CPF de quem está no nome do boleto* (só os números). Se for empresa, pode mandar o CNPJ.\n\n_Se quiser voltar, digite *voltar*._`,
  docInvalido: 'Esse CPF não parece certo 🤔 Confere e manda de novo (só os números), ou digite *9* para falar com um atendente.',
  naoEncontrado: 'Não achei nenhum cadastro com esse CPF 🤔 Confere se é o CPF de quem está no nome do boleto e manda de novo, ou digite *9* para falar com um atendente.',
  // completo = identidade confirmada. Sem confirmação, não mostra nome, rua nem referência.
  contratoInfo: (c, completo = true) =>
    [
      `📋 *Contrato ${c.id}*`,
      // LGPD: o cliente vê só o necessário para confirmar que é ele (nome abreviado, endereço sem número)
      completo && c.nome ? `👤 Titular: ${nomeLGPD(c.nome)}` : null,
      completo && c.endereco ? `📍 Endereço: ${enderecoLGPD(c.endereco)}` : null,
      !completo && regiaoLGPD(c.endereco) ? `📍 Região: ${regiaoLGPD(c.endereco)}` : null,
      completo && c.referencia ? `🧭 Referência: ${c.referencia}` : null,
      c.status ? `📌 Situação: ${c.status}` : null,
    ].filter(Boolean).join('\n'),
  pedirVerificacao:
    'Pra sua segurança 🔒, me manda os *4 últimos números do telefone* que está no seu cadastro com a gente.\n\n' +
    '_Ex.: se o número é (83) 99999-1234, mande *1234*. Se não souber, digite *pular*._',
  semBoleto: () => 'Você não tem nenhum boleto em aberto. Está tudo em dia! 🎉',
  erroSistema: 'Não consegui consultar seu cadastro agora. 😕 Vou te passar para um atendente.',
  atendenteDentro: 'Certo! Já avisei nossa equipe e em instantes um atendente vai falar com você por aqui. 😊',
  // Foto ou documento fora do suporte (geralmente comprovante de pagamento)
  comprovanteDentro: 'Recebi seu comprovante 📄✅ Já passei para a equipe conferir e dar baixa. Em instantes alguém confirma por aqui. 😊',
  comprovanteFora: () =>
    'Recebi seu comprovante 📄✅ Já passei para a equipe conferir e dar baixa. ' +
    `Nosso horário de atendimento é de ${cfg.horario.texto}; assim que possível alguém confirma por aqui. 🙏`,
  // Foto que não parece comprovante
  imagemDentro: 'Recebi sua imagem 👍 Já passei para a equipe e em instantes alguém fala com você por aqui. 😊',
  imagemFora: () =>
    `Recebi sua imagem 👍 Já passei para a equipe. Nosso horário de atendimento é de ${cfg.horario.texto}; assim que possível alguém fala com você por aqui. 🙏`,
  atendenteFora: () =>
    `Nosso horário de atendimento é de ${cfg.horario.texto}, mas pode deixar sua mensagem por aqui ` +
    'que alguém da equipe vai te responder assim que possível. Por favor, aguarde. 🙏',
};

// Legenda de imagem: propaganda (ignorada) e pagamento (vira comprovante)
const RE_PROPAGANDA = /\b(black friday|promocao|promo|mega promo|desconto|oferta|ofertas|aproveite|cupom|liquidacao|frete gratis|so hoje|compre)\b|\d+ ?% ?(off|de desconto)/;
const RE_PAGAMENTO = /\b(comprovante|paguei|pago|paga|pagamento|pix|transferencia|transferi|deposito|boleto|fatura|mensalidade)\b/;

// Opções clicáveis (no WhatsApp viram enquete). "valor" é o que o fluxo entende;
// o cliente também pode digitar o número.
// "Finalizar atendimento": aparece nos menus e também vale digitando "finalizar"/"encerrar" em qualquer etapa
const FINALIZAR = { valor: 'f', texto: '✅ Finalizar atendimento', chave: /\b(finaliz|encerr|era so isso|so isso mesmo|nada mais)/ };
const QUER_FINALIZAR = /^(f|finalizar|finaliza|finalizado|encerrar|encerra|encerrado|pode (finalizar|encerrar)|(finalizar|encerrar) (o )?atendimento)$/;

const OP = {
  menu: [
    { valor: '1', texto: '💰 Boleto e liberação da internet' },
    { valor: '2', texto: '🛠️ Problema na internet' },
    { valor: '3', texto: '🚀 Quero ser cliente' },
    { valor: '4', texto: '👤 Falar com um atendente' },
    FINALIZAR,
  ],
  confirmarDoc: [
    { valor: 's', texto: '✅ Sim, é esse', chave: /^(sim|isso|sou eu|e eu|pode|pode sim|pode usar|esse mesmo|esse|mesmo|correto|exato|confirmo|ok)\b/ },
    { valor: 'o', texto: '🔄 Não, usar outro CPF', chave: /\b(outro|outra|diferente|trocar|mudar|nao sou|nao e)\b|^nao\b/, prioridade: -1 },
    { valor: 'v', texto: '⬅️ Voltar' },
  ],
  uso: [
    { valor: '1', texto: '🏠 Casa (redes sociais, vídeos, estudo)', chave: /\b(casa|familia|redes? socia|instagram|whats|youtube|video|estud|escola|basic|normal|simples|celular)/ },
    { valor: '2', texto: '🎮 Jogos e streaming pesado', chave: /\b(jog|game|gamer|stream|netflix|filme|serie|live|twitch|iptv|download)/ },
    { valor: '3', texto: '💼 Trabalho / empresa', chave: /\b(trabalh|empresa|escritorio|home office|loja|comercio|negocio|camera|maquininha)/ },
    { valor: '4', texto: '🤷 Ainda não sei', chave: /\b(nao sei|sei la|tanto faz|qualquer|depende)\b/, prioridade: -1 },
  ],
  problema: [
    { valor: '1', texto: '🚫 Estou sem internet', chave: /\b(sem internet|nao (funciona|pega|conecta|esta funcionando|tem internet)|caiu|parou|sem sinal|nada funciona|apagou|sem conexao)/ },
    { valor: '2', texto: '🐢 Internet lenta', chave: /\b(lent|devagar|travando|trava|ruim|fraca|demora|nao carrega|velocidade)/ },
    { valor: '3', texto: '📶 Internet caindo / oscilando', chave: /\b(caindo|cai toda|cai (direto|muito|toda hora|de vez em quando)|oscil|instavel|desconect|vai e volta|volta e cai|cai e volta|cai mas volta)/, prioridade: -1 },
    { valor: '4', texto: '🔑 Trocar nome ou senha do Wi-Fi', chave: /\b(senha|nome da rede|nome do wifi|trocar (o )?wifi)\b/, prioridade: -2 },
    { valor: '5', texto: '🔧 Outro problema', chave: /\b(outro|outra coisa|diferente|nenhum desses|nenhuma dessas)\b/ },
    { valor: 'v', texto: '⬅️ Voltar' },
    FINALIZAR,
  ],
  luz: [
    { valor: 's', texto: '🔴 Sim, tem luz vermelha', chave: /^(sim|tem|tem sim|esta vermelh|vermelh)|\bvermelh|\blos\b.*\b(acesa|aceso|piscando)/ },
    { valor: 'n', texto: '🟢 Não, está tudo verde', chave: /^(nao|nenhuma|tudo verde|verde|normal|tudo normal|esta normal|nao tem)\b|^(?!.*vermelh).*\bverd(e|es|inho|inha|inhos|inhas)\b|\b(nenhuma|nao tem( nenhuma)?|sem) (luz )?vermelh/, prioridade: -0.5 },
    { valor: 'd', texto: '⚫ O aparelho está desligado', chave: /\b(deslig|apagad|nao liga|nao acende|sem luz(?! vermelh)|nenhuma luz(?! vermelh)|luz nenhuma|tudo apagado|sem energia|faltou energia)/, prioridade: -1 },
    { valor: 'x', texto: '🤷 Não sei ver', chave: /\b(nao sei|sei la|nao entendi|como (eu )?(vejo|sei|olho)|onde (fica|vejo)|nao consigo ver|nao achei)/, prioridade: -2 },
  ],
  reiniciou: [
    { valor: 's', texto: '✅ Já fiz e não resolveu', chave: /^(sim|ja|reiniciei|desliguei|fiz|varias vezes)\b|\bja (reiniciei|desliguei|fiz|tentei|tirei)\b/, prioridade: -1 },
    { valor: 'n', texto: '🔌 Ainda não fiz', chave: /^(nao|ainda nao|nunca)\b|\bcomo (faz|faco|reinicia)\b|\bvou (fazer|reiniciar|tentar|testar|desligar)\b/ },
  ],
  resolveu: [
    { valor: 's', texto: '✅ Voltou', chave: /^(sim|voltou|funcionou|resolveu|resolvido|deu certo|esta funcionando|funcionando|normalizou|ja voltou|ja esta|agora (sim|foi|voltou|funcionou|esta))\b/ },
    { valor: 'n', texto: '❌ Não voltou', chave: /^(nao|ainda nao|continua|nada|nem|mesma coisa|piorou)\b|\bnao (voltou|funcionou|resolveu|deu certo)\b|\bcontinua\b/, prioridade: -1 },
  ],
  bloqueado: [
    { valor: 'p', texto: '🔓 Liberar minha internet (liberação de confiança)', chave: /\b(liber|confianca|promessa|desbloq)/ },
    { valor: 'b', texto: '📄 Receber o boleto', chave: /\b(boleto|fatura|pagar|pix|segunda via)\b/ },
    { valor: 'c', texto: '🛠️ Não é isso, continuar o suporte', chave: /\b(suporte|continuar|tecnico|nao e isso|outro problema)\b/ },
    FINALIZAR,
  ],
  acordo: [
    { valor: 'a', texto: '🤝 Quero negociar', chave: /\b(sim|quero|acordo|negoci|parcel|proposta|desconto|voltar|aceito|pode ser|bora)\b/ },
    { valor: 'b', texto: '📄 Só quero ver meus boletos', chave: /\b(boletos?|faturas?|segunda via|ver|pix|pagar tudo)\b/, prioridade: -0.5 },
    { valor: 'n', texto: '⏭️ Agora não', chave: /^(nao|agora nao|depois|outra hora|nao quero|mais tarde)\b/, prioridade: -1 },
  ],
  financeiro: [
    { valor: '1', texto: '📄 Receber o boleto (2ª via)', chave: /\b(boleto|fatura|segunda via|pix|chave|qr ?code|copia e cola|codigo|linha digitavel|pagar)\b/ },
    { valor: '2', texto: '🔓 Liberar minha internet (liberação de confiança)', chave: /\b(liber|confianca|promessa|desbloq)/ },
    { valor: 'v', texto: '⬅️ Voltar' },
    { valor: '9', texto: '👤 Falar com um atendente' },
    { valor: '0', texto: '↩️ Menu inicial' },
    FINALIZAR,
  ],
  // Menu dos técnicos (números em TECNICO_NUMEROS)
  tecnico: [
    { valor: 'c', texto: '🔎 Consultar cliente', chave: /\b(consult|cliente|cadastro|dados|endereco)/ },
    { valor: 'o', texto: '📶 Ver se está online', chave: /\b(online|offline|conexao|conectad|caiu|acesso|sinal)\b/ },
    { valor: 'r', texto: '🛠️ Criar ocorrência', chave: /\b(ocorrencia|chamado|os|ordem de servico|abrir)\b/ },
    { valor: 'a', texto: '👤 Falar com atendente', chave: /\b(atendente|falar|pessoa|humano|ajuda)\b/ },
  ],
  // Menu da equipe (números em ATENDENTE_NUMEROS)
  equipe: [
    { valor: 'c', texto: '💰 Fechar o caixa', chave: /\b(caixa|fechar|fechamento|relatorio|recebi(dos|mentos)?|pagamentos)\b/ },
    { valor: 'p', texto: '📝 Avisar pré-cadastro', chave: /\b(pre ?-?cadastro|cadastro|cadastrei|cliente novo|novo cliente)\b/ },
    { valor: 'a', texto: '👤 Falar com atendente', chave: /\b(atendente|falar|pessoa|humano|ajuda)\b/ },
  ],
};

// Arte com os planos e a indicação de plano conforme o uso que o cliente escolheu
const PLANOS_IMAGEM = require('path').join(__dirname, '..', 'midia', 'planos.jpg');
const INDICACAO = {
  1: { plano: '300 MB', preco: 'R$ 49,90', texto: 'Para redes sociais, vídeos e estudo, o *300 MB* dá conta de tudo com folga, e é o nosso plano *mais popular*! 💙' },
  2: { plano: '500 MB', preco: 'R$ 69,90', texto: 'Para jogos e streaming, o ideal é o *500 MB*: menos travadas, ping mais baixo e filme em alta qualidade sem carregar. 🎮🍿 Se a casa tiver muita gente conectada ao mesmo tempo, o *600 MB* é ainda melhor.' },
  3: { plano: '600 MB', preco: 'R$ 79,90', texto: 'Para trabalho e empresa, o *600 MB* garante estabilidade em reuniões, envio de arquivos e vários aparelhos ligados ao mesmo tempo. 💼' },
  4: { plano: '300 MB', preco: 'R$ 49,90', texto: 'Sem problema! Para começar, o *300 MB* é o nosso plano *mais popular* e atende muito bem o dia a dia. Nossa equipe te ajuda a escolher o ideal. 😉' },
};

// Sem suporte a enquete (ex.: simulador), vira lista numerada
function perguntarComoTexto(enviar) {
  return (chatId, pergunta, opcoes) =>
    enviar(
      chatId,
      `${pergunta.replace(/Toque (em uma opção|em uma das opções|no contrato desejado|no problema que mais parece com o seu)/, 'Responda com o número')}\n\n` +
        opcoes.map((o, i) => `*${i + 1}* - ${o.texto}`).join('\n')
    );
}

function criarFluxo({
  enviar, enviarImagem, perguntar, aoTransferir = async () => {}, aoOcorrencia = async () => {}, log = console.log, estado = criarEstado(),
  // Número de telefone real da conversa (no WhatsApp, IDs @lid precisam ser convertidos)
  numeroDoChat = async (chatId) => String(chatId).split('@')[0].replace(/\D/g, ''),
  // (opcional) Transforma um HTML em PDF e envia como documento: (chatId, html, nomeArquivo, legenda)
  enviarPdf = null,
}) {
  const perguntarBase = perguntar || perguntarComoTexto(enviar);
  // Guarda as opções da última pergunta, para entender respostas escritas/faladas ("já reiniciei", "sim")
  perguntar = (chatId, pergunta, opcoes) => {
    const ss = sessoes.get(chatId);
    if (ss) { ss.opcoes = opcoes; ss.opcoesEtapa = ss.etapa; }
    return perguntarBase(chatId, pergunta, opcoes);
  };
  const menu = async (chatId, pergunta = 'Como posso te ajudar? Toque em uma opção 👇') => perguntar(chatId, pergunta, OP.menu);
  const menuFin = async (chatId, pergunta = 'O que você precisa? 👇') => perguntar(chatId, pergunta, OP.financeiro);
  // Conversas em andamento: ficam salvas em arquivo para continuar de onde pararam se o bot reiniciar
  const sessoes = new Map(Object.entries(estado.ler('sessoes', {})).map(([id, ss]) => [id, restaurarSessao(ss)]));
  function salvarSessoes() {
    const lista = {};
    for (const [id, ss] of sessoes) lista[id] = { ...ss, opcoes: ss.opcoes && ss.opcoes.map(({ valor, texto }) => ({ valor, texto })) };
    estado.gravar('sessoes', lista);
  }

  // ---- LGPD: controle de consultas por WhatsApp ----
  function podeConsultar(chatId, doc) {
    const hoje = u.agoraLocal().hojeISO;
    const reg = estado.ler('consultas', {});
    const r = reg[chatId] && reg[chatId].dia === hoje ? reg[chatId] : { dia: hoje, docs: [] };
    if (!r.docs.includes(doc)) {
      if (r.docs.length >= cfg.limiteDocsDia) return false;
      r.docs.push(doc);
    }
    // guarda só o dia de hoje (limpa os antigos)
    const novo = {};
    for (const [id, v] of Object.entries(reg)) if (v.dia === hoje) novo[id] = v;
    novo[chatId] = r;
    estado.gravar('consultas', novo);
    return true;
  }

  // ---- pausa (atendente humano) ----
  function pausar(chatId, horas = cfg.pausaHumanoHoras) {
    estado.setPausa(chatId, Date.now() + horas * 3600000);
    sessoes.delete(chatId);
    cancelarLembrete(chatId);
    salvarSessoes();
  }

  // ---- lembrete quando o cliente some no meio do fluxo ----
  const lembretes = new Map(); // chatId -> timer
  const TEXTO_LEMBRETE = {
    doc: 'É só me mandar o *CPF de quem está no nome do boleto* que eu continuo. 😊',
    contrato: 'É só responder com o número do contrato que eu continuo. 😊',
    verificar: 'É só me mandar os *4 últimos números do telefone* do seu cadastro (ou digite *pular*) que eu continuo. 😊',
    confirmar_doc: 'É só responder com o número de uma das opções acima que eu continuo. 😊',
    suporte_desc: 'É só me contar o que está acontecendo (pode ser áudio) que eu registro seu chamado. 😊',
    venda_local: 'É só me dizer sua cidade e bairro que eu continuo seu cadastro. 😊',
    venda_nome: 'É só me dizer seu nome que eu continuo seu cadastro. 😊',
  };
  function cancelarLembrete(chatId) {
    clearTimeout(lembretes.get(chatId));
    lembretes.delete(chatId);
  }
  function agendarLembrete(chatId) {
    cancelarLembrete(chatId);
    const s = sessoes.get(chatId);
    // Só no meio de um fluxo (não no menu nem no "precisa de mais alguma coisa?")
    if (!s || !cfg.lembreteMin || s.etapa === 'menu' || s.etapa === 'financeiro' || s.etapa.startsWith('equipe_') || s.etapa.startsWith('tec_')) return;
    const etapa = s.etapa;
    const timer = setTimeout(async () => {
      const atual = sessoes.get(chatId);
      if (!atual || atual.etapa !== etapa || estaPausado(chatId)) return;
      try {
        if (!atual.lembrado) {
          atual.lembrado = true;
          await enviar(chatId, `Ainda está por aí? ${TEXTO_LEMBRETE[etapa] || 'É só responder com o número de uma das opções acima que eu continuo. 😊'}`);
          agendarLembrete(chatId);
        } else {
          sessoes.delete(chatId);
          lembretes.delete(chatId);
          salvarSessoes();
          await enviar(chatId, 'Como não tive resposta, vou encerrar por aqui. Quando precisar, é só mandar uma mensagem! 👋');
        }
      } catch (e) {
        log(`[lembrete] ${e.message}`);
      }
    }, cfg.lembreteMin * 60000);
    if (timer.unref) timer.unref();
    lembretes.set(chatId, timer);
  }
  function retomar(chatId) {
    estado.tirarPausa(chatId);
    sessoes.delete(chatId);
  }
  function estaPausado(chatId) {
    const ate = estado.pausaAte(chatId);
    if (!ate) return false;
    if (Date.now() > ate) {
      estado.tirarPausa(chatId);
      return false;
    }
    return true;
  }

  async function transferir(chatId, avisar = true) {
    if (avisar) await enviar(chatId, u.dentroDoHorario() ? MSG.atendenteDentro : MSG.atendenteFora());
    pausar(chatId);
    log(`[atendente] conversa ${chatId} transferida para humano`);
    registrar(`[atendente] ${chatId} passou para o atendente`);
    await aoTransferir(chatId);
  }

  function novaSessao(chatId) {
    const s = { etapa: 'menu', tentativas: 0, visto: Date.now() };
    sessoes.set(chatId, s);
    return s;
  }

  // ---- entrada principal ----
  async function receber(chatId, texto, opcoes = {}) {
    if (estaPausado(chatId)) return;
    cancelarLembrete(chatId);
    const antes = sessoes.get(chatId);
    const etapaAntes = antes ? antes.etapa : '(nova conversa)';
    const tipo = opcoes.audio ? 'áudio transcrito' : opcoes.audioFalhou ? 'áudio NÃO entendido' : opcoes.naoTexto ? 'mídia' : 'texto';
    registrar(`[entrada] ${chatId} | etapa: ${etapaAntes} | ${tipo}: "${resumo(texto)}"`);
    if (!opcoes.naoTexto && !opcoes.audioFalhou && texto) {
      registrar(`[entendi] intenção: ${ent.detectarIntencao(texto) || '-'} | pede atendente: ${ent.querAtendente(texto) ? 'sim' : 'não'} | irritado: ${ent.ehIrritado(texto) ? 'sim' : 'não'} | agradecimento: ${ent.ehAgradecimento(texto) ? 'sim' : 'não'}`);
    }
    try {
      await receberInterno(chatId, texto, opcoes);
    } catch (e) {
      log(`[erro] ${chatId}: ${e.message}`);
      await enviar(chatId, MSG.erroSistema);
      await transferir(chatId, false);
    }
    if (!estaPausado(chatId)) agendarLembrete(chatId);
    salvarSessoes();
    const depois = sessoes.get(chatId);
    registrar(`[etapa] ${chatId} | ${etapaAntes} → ${estaPausado(chatId) ? 'COM O ATENDENTE (bot pausado)' : depois ? depois.etapa : '(conversa encerrada)'}`);
  }

  async function receberInterno(chatId, texto, { naoTexto = false, audio = false, audioFalhou = false, tipo = '', encaminhada = false } = {}) {
    let s = sessoes.get(chatId);
    const expirou = s && Date.now() - s.visto > cfg.sessaoMin * 60000;

    // Técnico: menu próprio (consultar cliente, online, ocorrência, atendente)
    if (await ehTecnico(chatId)) return receberTecnico(chatId, s && !expirou ? s : null, texto, { naoTexto, audioFalhou });
    // Número da equipe: menu próprio (fechar caixa, pré-cadastro, atendente), nunca o de cliente
    if (await ehEquipe(chatId)) return receberEquipe(chatId, s && !expirou ? s : null, texto, { naoTexto, audioFalhou });

    // Áudio que o bot não conseguiu ouvir: no chamado de suporte vale como descrição;
    // fora dele, pede para escrever (na 2ª vez seguida, passa para o atendente)
    if (audioFalhou) {
      if (s && !expirou && s.etapa === 'suporte_desc') {
        s.visto = Date.now();
        return finalizarSuporte(chatId, s, '(cliente enviou áudio, ouça na conversa)');
      }
      if (!s || expirou) {
        s = novaSessao(chatId);
        await enviar(chatId, MSG.saudacao());
      }
      s.visto = Date.now();
      s.audiosFalhos = (s.audiosFalhos || 0) + 1;
      if (s.audiosFalhos >= 2) return transferir(chatId);
      await enviar(chatId, 'Não consegui ouvir seu áudio por aqui. 😕 Pode me escrever o que precisa?');
      if (s.etapa === 'menu') await menu(chatId);
      return;
    }
    let t = u.normalizar(texto).replace(/[.!?]+$/, '');
    if (s && !expirou) s.lembrado = false;

    // Cliente irritado ou reclamação séria: direto para uma pessoa
    if (!naoTexto && ent.ehIrritado(texto) && !(s && !expirou && s.etapa === 'suporte_desc')) {
      await enviar(chatId, 'Sinto muito pelo transtorno. 😔 Já estou te passando para uma pessoa da nossa equipe.');
      return transferir(chatId, false);
    }

    // "Obrigado", "ok", "👍" sem nada em andamento: só agradece, sem mandar menu de novo
    const fimDeConversa = !s || expirou || s.etapa === 'financeiro';
    if (!naoTexto && fimDeConversa && ent.ehAgradecimento(texto)) {
      sessoes.delete(chatId);
      return enviar(chatId, 'Por nada! 😊 Quando precisar, é só chamar.');
    }

    // Cliente de suporte avisa que a internet voltou ("já voltou, obrigado"): encerra em qualquer etapa
    if (!naoTexto && s && !expirou && (s.destino === 'suporte' || s.etapa.startsWith('suporte_')) && ent.ehResolvido(texto)) {
      log(`[suporte] ${chatId}: cliente avisou que resolveu`);
      sessoes.delete(chatId);
      return enviar(chatId, 'Que ótimo que voltou! 🎉 Se precisar de algo mais, é só mandar mensagem.');
    }

    // No suporte, áudio/foto valem como descrição do problema
    if (naoTexto && s && !expirou && s.etapa === 'suporte_desc') {
      s.visto = Date.now();
      return finalizarSuporte(chatId, s, '(cliente enviou áudio/foto, veja na conversa)');
    }
    // Foto ou documento
    if (naoTexto && ['image', 'document'].includes(tipo)) {
      const legenda = u.normalizar(texto);
      // Propaganda (de fornecedor, loja...): não responde e não chama o atendente
      if (RE_PROPAGANDA.test(legenda)) {
        registrar(`[ignorada] ${chatId}: imagem de propaganda ("${resumo(texto, 60)}")`);
        return;
      }
      // Tem cara de comprovante: legenda de pagamento, PDF, cliente no meio do boleto ou foto sem legenda que não foi encaminhada
      const noFinanceiro = s && !expirou && (s.destino === 'financeiro' || ['financeiro', 'contrato', 'doc', 'verificar', 'confirmar_doc'].includes(s.etapa));
      const comprovante = RE_PAGAMENTO.test(legenda) || tipo === 'document' || noFinanceiro || (!legenda && !encaminhada);
      if (comprovante) await enviar(chatId, u.dentroDoHorario() ? MSG.comprovanteDentro : MSG.comprovanteFora());
      else await enviar(chatId, u.dentroDoHorario() ? MSG.imagemDentro : MSG.imagemFora());
      return transferir(chatId, false);
    }
    // Outras mídias (vídeo, localização, contato): manda para o atendente
    if (naoTexto) {
      await transferir(chatId);
      return;
    }

    if (!s || expirou) {
      s = novaSessao(chatId);
      await enviar(chatId, MSG.saudacao());
      // CPF/CNPJ já na primeira mensagem: guarda para não pedir de novo
      const doc = ent.extrairDoc(texto);
      if (doc) s.docPendente = doc;
      // Se a primeira mensagem já diz o que quer, pula o menu
      const intencao = ent.querAtendente(texto) ? 'atendente' : ent.detectarIntencao(texto);
      if (intencao) return comecar(chatId, s, intencao, texto);
      // Já começou com o número de uma opção do menu (cliente que já conhece o menu)
      if (/^[1-4]$/.test(t)) return etapaMenu(chatId, s, t);
      await menu(chatId, doc ? 'Recebi seu CPF/CNPJ ✅ Agora me diz: o que você precisa? 👇' : undefined);
      return;
    }
    s.visto = Date.now();

    // Número digitado = posição da opção na enquete ("3" = terceira opção)
    if (s.opcoes && s.opcoesEtapa === s.etapa && /^\d{1,2}$/.test(t) && s.opcoes[Number(t) - 1]) {
      t = s.opcoes[Number(t) - 1].valor;
    }
    // Resposta escrita ou falada em vez de tocar na enquete
    else if (s.opcoes && s.opcoesEtapa === s.etapa && s.etapa !== 'menu' && !s.opcoes.some((o) => o.valor === t)) {
      const casou = ent.casarOpcao(texto, s.opcoes);
      if (casou) t = casou;
    }

    // Atalhos que valem em qualquer etapa
    if (['v', 'voltar', 'anterior', 'errei'].includes(t)) {
      await voltar(chatId, s);
      return;
    }
    if (['0', 'menu', 'inicio', 'comeco'].includes(t)) {
      s = novaSessao(chatId);
      await menu(chatId);
      return;
    }
    if (QUER_FINALIZAR.test(t)) return finalizar(chatId);
    // Pediu uma pessoa, ou algo que só uma pessoa resolve ("já paguei", "mudar de plano")
    const etapaDeTexto = ['suporte_desc', 'venda_local', 'venda_nome'].includes(s.etapa);
    if (t === '9' || ent.querAtendente(texto) || (!etapaDeTexto && ent.detectarIntencao(texto) === 'atendente')) {
      await transferir(chatId);
      return;
    }

    try {
      switch (s.etapa) {
        case 'menu':
          return await etapaMenu(chatId, s, t);
        case 'doc':
          return await etapaDoc(chatId, s, texto);
        case 'confirmar_doc':
          return await etapaConfirmarDoc(chatId, s, t);
        case 'venda_local':
          return await etapaVendaLocal(chatId, s, texto);
        case 'venda_nome':
          return await etapaVendaNome(chatId, s, texto);
        case 'venda_uso':
          return await etapaVendaUso(chatId, s, t);
        case 'verificar':
          return await etapaVerificar(chatId, s, t, texto);
        case 'contrato':
          return await etapaContrato(chatId, s, t, texto);
        case 'financeiro':
          return await etapaFinanceiro(chatId, s, t);
        case 'acordo':
          return await etapaAcordo(chatId, s, t);
        case 'suporte_bloqueado':
          return await etapaSuporteBloqueado(chatId, s, t);
        case 'suporte_tipo':
          return await etapaSuporteTipo(chatId, s, t);
        case 'suporte_luz':
          return await etapaSuporteLuz(chatId, s, t);
        case 'suporte_reiniciou':
          return await etapaSuporteReiniciou(chatId, s, t);
        case 'suporte_resolveu':
          return await etapaSuporteResolveu(chatId, s, t);
        case 'suporte_desc':
          // Resposta curta demais ("2", "ok"): pede para explicar melhor uma vez
          if (!audio && String(texto).trim().length < 6 && !s.pediuMais) {
            s.pediuMais = true;
            return enviar(chatId, 'Pode me contar um pouco mais? Ex.: "sem internet desde ontem à noite em todos os aparelhos". Também pode mandar um áudio. 🎤');
          }
          return await finalizarSuporte(chatId, s, audio ? `🎤 (áudio transcrito) ${texto}` : texto);
        default:
          novaSessao(chatId);
          return await menu(chatId);
      }
    } catch (e) {
      log(`[erro] ${chatId}: ${e.message}`);
      await enviar(chatId, MSG.erroSistema);
      await transferir(chatId, false);
    }
  }

  // ---------- Técnicos (TECNICO_NUMEROS) ----------
  const cacheTecnico = new Map(); // chatId -> { numero, nome } ou null
  async function tecnicoDe(chatId) {
    if (!cfg.tecnicos.length) return null;
    if (!cacheTecnico.has(chatId)) {
      const numero = await Promise.resolve(numeroDoChat(chatId)).catch(() => '');
      cacheTecnico.set(chatId, cfg.tecnicos.find((t) => u.mesmoNumero(t.numero, numero)) || null);
    }
    return cacheTecnico.get(chatId);
  }
  const ehTecnico = async (chatId) => !!(await tecnicoDe(chatId));

  const menuTecnico = async (chatId, pergunta) => {
    if (!pergunta) {
      const tec = await tecnicoDe(chatId);
      pergunta = `Olá${tec && tec.nome ? `, ${tec.nome}` : ''}! 👋 O que você precisa? 👇`;
    }
    return perguntar(chatId, pergunta, OP.tecnico);
  };
  const PEDIR_CLIENTE = 'Me manda o *ID do SGP* do cliente (ou o CPF/CNPJ).\n\n_Para voltar ao menu, digite *0*._';

  async function receberTecnico(chatId, s, texto, { naoTexto, audioFalhou }) {
    const t = u.normalizar(texto);
    if (!s) {
      s = { etapa: 'tec_menu', tentativas: 0, visto: Date.now() };
      sessoes.set(chatId, s);
      const direto = !naoTexto && (/^\d$/.test(t) && OP.tecnico[Number(t) - 1] ? OP.tecnico[Number(t) - 1].valor : ent.casarOpcao(texto, OP.tecnico));
      return direto ? opcaoTecnico(chatId, s, direto) : menuTecnico(chatId);
    }
    s.visto = Date.now();
    if (['0', 'menu', 'cancelar', 'voltar', 'v'].includes(t)) {
      s.etapa = 'tec_menu';
      return menuTecnico(chatId, 'Certo. O que você precisa? 👇');
    }
    if (s.etapa === 'tec_oc_desc') {
      if (naoTexto || audioFalhou) return enviar(chatId, 'Me descreve o problema ou o serviço *por texto*, por favor. 🙂');
      return criarOcorrenciaTecnico(chatId, s, String(texto).trim());
    }
    if (naoTexto || audioFalhou) return menuTecnico(chatId, 'Recebi. 👍 O que você precisa? 👇');
    if (s.etapa === 'tec_consultar') return tecConsultar(chatId, s, texto);
    if (s.etapa === 'tec_online') return tecOnline(chatId, s, texto);
    if (s.etapa === 'tec_oc_contrato') return tecEscolherContratoOcorrencia(chatId, s, texto);
    const op = /^\d$/.test(t) && OP.tecnico[Number(t) - 1] ? OP.tecnico[Number(t) - 1].valor : ent.casarOpcao(texto, OP.tecnico) || t;
    return opcaoTecnico(chatId, s, op);
  }

  async function opcaoTecnico(chatId, s, t) {
    if (t === 'c') { s.etapa = 'tec_consultar'; return enviar(chatId, `🔎 *Consultar cliente*\n${PEDIR_CLIENTE}`); }
    if (t === 'o') { s.etapa = 'tec_online'; return enviar(chatId, `📶 *Ver se está online*\n${PEDIR_CLIENTE}`); }
    if (t === 'r') { s.etapa = 'tec_oc_contrato'; delete s.tecContratos; return enviar(chatId, `🛠️ *Criar ocorrência*\n${PEDIR_CLIENTE}`); }
    if (t === 'a') {
      await enviar(chatId, 'Certo! Já avisei a equipe, em instantes alguém fala com você por aqui. 😊');
      return transferir(chatId, false);
    }
    return menuTecnico(chatId, 'Não entendi 😅 Escolha uma das opções 👇');
  }

  // ID do SGP (número do contrato) ou CPF/CNPJ -> lista de contratos (null = entrada inválida)
  async function buscarContratos(texto) {
    const d = u.soDigitos(texto);
    if ((d.length === 11 && u.cpfValido(d)) || (d.length === 14 && u.cnpjValido(d))) return sgp.consultarCliente(d);
    if (d.length >= 1 && d.length <= 8) return sgp.consultarContrato(d);
    return null;
  }

  // Busca e trata erro/entrada inválida/nada encontrado. Retorna os contratos ou null (já respondeu).
  async function contratosDoTecnico(chatId, texto) {
    let lista;
    try {
      lista = await buscarContratos(texto);
    } catch (e) {
      registrar(`[técnico] erro ao consultar o SGP: ${e.message}`);
      await enviar(chatId, 'Não consegui consultar o SGP agora. 😕 Tente de novo em instantes.');
      return null;
    }
    if (lista === null) {
      await enviar(chatId, `Não reconheci. ${PEDIR_CLIENTE}`);
      return null;
    }
    if (!lista.length) {
      await enviar(chatId, `Não encontrei nenhum cliente com esse ID/CPF. 🤔 ${PEDIR_CLIENTE}`);
      return null;
    }
    return lista;
  }

  const fone = (t) => {
    const d = u.soDigitos(t).replace(/^55(?=\d{10,11}$)/, '');
    return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : t;
  };
  const textoOnline = (o) => (o === true ? '🟢 *Online*' : o === false ? '🔴 *Offline*' : '⚪ Não consegui verificar');

  // Dados completos para o técnico (é da equipe: vê endereço com número, referência e telefones)
  function fichaTecnico(c, online) {
    return [
      `📋 *ID ${c.id}*${c.status ? ` (${c.status})` : ''}`,
      c.nome ? `👤 ${nomeBonito(c.nome)}` : null,
      c.endereco ? `📍 ${c.endereco}` : null,
      c.referencia ? `🧭 Ref: ${c.referencia}` : null,
      c.plano ? `📶 Plano: ${c.plano}` : null,
      c.telefones && c.telefones.length ? `📞 ${c.telefones.map(fone).join(' / ')}` : null,
      online !== undefined ? `Conexão: ${textoOnline(online)}` : null,
    ].filter(Boolean).join('\n');
  }

  const online = (id) => sgp.verificarAcesso(id).catch((e) => { registrar(`[técnico] verificaacesso ${id}: ${e.message}`); return null; });

  async function tecConsultar(chatId, s, texto) {
    const lista = await contratosDoTecnico(chatId, texto);
    if (!lista) return;
    registrar(`[técnico] consulta: ${lista.length} contrato(s)`);
    const mostrar = ordenarContratos(lista).slice(0, 5);
    const status = await Promise.all(mostrar.map((c) => online(c.id)));
    await enviar(chatId, mostrar.map((c, i) => fichaTecnico(c, status[i])).join('\n\n'));
    if (lista.length > mostrar.length) await enviar(chatId, `Esse CPF tem ${lista.length} contratos; mostrei ${mostrar.length}. Para ver outro, mande o ID do SGP dele.`);
    return enviar(chatId, `Pode mandar outro ID/CPF para consultar, ou *0* para o menu.`);
  }

  async function tecOnline(chatId, s, texto) {
    const lista = await contratosDoTecnico(chatId, texto);
    if (!lista) return;
    const mostrar = ordenarContratos(lista).slice(0, 10);
    const status = await Promise.all(mostrar.map((c) => online(c.id)));
    registrar(`[técnico] verificou conexão de ${mostrar.length} contrato(s)`);
    await enviar(chatId, mostrar.map((c, i) => `${textoOnline(status[i])} - ID ${c.id}${c.nome ? ` - ${nomeLGPD(c.nome)}` : ''}${c.endereco ? `\n   ${enderecoLGPD(c.endereco)}` : ''}`).join('\n'));
    return enviar(chatId, 'Pode mandar outro ID/CPF para verificar, ou *0* para o menu.');
  }

  async function tecEscolherContratoOcorrencia(chatId, s, texto) {
    // Já listou os contratos de um CPF: aceita a posição (1, 2...) ou o ID do SGP
    if (s.tecContratos) {
      const t = u.soDigitos(texto);
      const c = s.tecContratos[Number(t) - 1] && t.length <= 2 ? s.tecContratos[Number(t) - 1] : s.tecContratos.find((x) => String(x.id) === t);
      if (c) return pedirDescricaoOcorrencia(chatId, s, c);
      delete s.tecContratos;
    }
    const lista = await contratosDoTecnico(chatId, texto);
    if (!lista) return;
    if (lista.length === 1) return pedirDescricaoOcorrencia(chatId, s, lista[0]);
    s.tecContratos = ordenarContratos(lista).slice(0, 10).map((c) => ({ id: c.id, nome: c.nome, endereco: c.endereco, status: c.status }));
    return enviar(chatId, 'Esse CPF tem mais de um contrato. Qual deles?\n\n' +
      s.tecContratos.map((c, i) => `*${i + 1}* - ID ${c.id}${c.endereco ? ` · ${enderecoLGPD(c.endereco)}` : ''}${c.status && !/^ativo$/i.test(c.status) ? ` · ${c.status}` : ''}`).join('\n'));
  }

  function pedirDescricaoOcorrencia(chatId, s, c) {
    s.tecOcorrencia = { contrato: c.id, nome: c.nome || '' };
    delete s.tecContratos;
    s.etapa = 'tec_oc_desc';
    return enviar(chatId, `ID *${c.id}*${c.nome ? ` - ${nomeBonito(c.nome)}` : ''} ✅\nAgora me descreve a ocorrência (o problema ou o serviço feito), numa mensagem só.`);
  }

  async function criarOcorrenciaTecnico(chatId, s, descricao) {
    if (descricao.length < 5) return enviar(chatId, 'Me descreve um pouco mais a ocorrência, por favor.');
    const oc = s.tecOcorrencia || {};
    s.etapa = 'tec_menu';
    delete s.tecOcorrencia;
    const numero = await Promise.resolve(numeroDoChat(chatId)).catch(() => '');
    const tec = (await tecnicoDe(chatId)) || {};
    const quem = tec.nome ? `técnico ${tec.nome}` : 'técnico';
    const conteudo = `${descricao.slice(0, 1500)}\n\n(Aberta pelo ${quem} via WhatsApp${numero ? ` - ${fone(numero)}` : ''})`;
    let r;
    try {
      r = await sgp.criarChamado(oc.contrato, conteudo, { contatoNome: tec.nome ? `${tec.nome} (técnico)` : 'Técnico (WhatsApp)', contatoTelefone: numero });
    } catch (e) {
      r = { ok: false, mensagem: e.message };
    }
    if (r.ok) {
      registrar(`[técnico] ${tec.nome || ''} abriu ocorrência no contrato ${oc.contrato}, protocolo ${r.protocolo || '-'}`);
      await enviar(chatId, `Ocorrência aberta no SGP! ✅\n📋 ID ${oc.contrato}${r.protocolo ? `\n🔖 Protocolo: *${r.protocolo}*` : ''}`);
      return menuTecnico(chatId, 'Precisa de mais alguma coisa? 👇');
    }
    // Não deu para abrir no SGP: avisa a equipe com o resumo para abrirem manualmente
    registrar(`[técnico] não consegui abrir ocorrência no SGP (contrato ${oc.contrato}): ${r.mensagem || 'sem detalhe'}`);
    const resumo = ['🛠️ *Ocorrência do técnico (abrir no SGP)*', `ID SGP: ${oc.contrato}${oc.nome ? ` - ${oc.nome}` : ''}`, `Descrição: ${descricao.slice(0, 1000)}`, `Técnico: ${[tec.nome, numero ? fone(numero) : ''].filter(Boolean).join(' - ') || chatId}`].join('\n');
    await aoOcorrencia(chatId, resumo, 'tecnico').catch((e) => log(`[erro ao avisar equipe] ${e.message}`));
    await enviar(chatId, `Não consegui abrir a ocorrência direto no SGP agora${r.mensagem ? ` (_${r.mensagem}_)` : ''}. 😕\nDeixei o resumo registrado aqui para a equipe abrir manualmente:\n\n${resumo}`);
    return menuTecnico(chatId, 'Precisa de mais alguma coisa? 👇');
  }

  // ---------- Equipe (ATENDENTE_NUMEROS) ----------
  const cacheEquipe = new Map();
  // Número da equipe: está em ATENDENTE_NUMEROS ou em algum caixa de CAIXAS
  async function ehEquipe(chatId) {
    const numerosCaixas = cfg.caixas.flatMap((c) => c.numeros);
    if (!cfg.atendentesNumeros.length && !numerosCaixas.length) return false;
    if (!cacheEquipe.has(chatId)) {
      const numero = await Promise.resolve(numeroDoChat(chatId)).catch(() => '');
      cacheEquipe.set(chatId, [...cfg.atendentesNumeros, ...numerosCaixas].some((n) => u.mesmoNumero(n, numero)));
    }
    return cacheEquipe.get(chatId);
  }

  // Caixas que este número pode fechar (caixa sem números = qualquer pessoa da equipe)
  async function caixasDe(chatId) {
    const numero = await Promise.resolve(numeroDoChat(chatId)).catch(() => '');
    return cfg.caixas.filter((c) => !c.numeros.length || c.numeros.some((n) => u.mesmoNumero(n, numero)));
  }

  const menuEquipe = (chatId, pergunta = 'Olá! 👋 O que você precisa? 👇') => perguntar(chatId, pergunta, OP.equipe);

  async function receberEquipe(chatId, s, texto, { naoTexto, audioFalhou }) {
    if (!s) {
      s = { etapa: 'equipe_menu', tentativas: 0, visto: Date.now() };
      sessoes.set(chatId, s);
      // Já escreveu o que quer na primeira mensagem ("fechar o caixa")
      const num = u.normalizar(texto);
      const direto = !naoTexto && (/^\d$/.test(num) && OP.equipe[Number(num) - 1] ? OP.equipe[Number(num) - 1].valor : ent.casarOpcao(texto, OP.equipe));
      if (direto) return opcaoEquipe(chatId, s, direto);
      return menuEquipe(chatId);
    }
    s.visto = Date.now();
    if (s.etapa.startsWith('equipe_pc_')) return etapaPreCadastro(chatId, s, texto, naoTexto || audioFalhou);
    if (s.etapa === 'equipe_caixa') return etapaEscolherCaixa(chatId, s, texto);
    if (naoTexto || audioFalhou) return menuEquipe(chatId, 'Recebi. 👍 O que você precisa? 👇');
    let t = u.normalizar(texto);
    if (/^\d{1,2}$/.test(t) && OP.equipe[Number(t) - 1]) t = OP.equipe[Number(t) - 1].valor;
    else t = ent.casarOpcao(texto, OP.equipe) || t;
    return opcaoEquipe(chatId, s, t);
  }

  async function opcaoEquipe(chatId, s, t) {
    if (t === 'c') {
      s.etapa = 'equipe_menu';
      const caixas = await caixasDe(chatId);
      if (caixas.length > 1) {
        // Mais de um caixa: pergunta qual fechar
        s.etapa = 'equipe_caixa';
        s.caixasOpcoes = caixas.map((c) => c.nome);
        return perguntar(chatId, 'Qual caixa você quer fechar? 👇', [
          ...caixas.map((c, i) => ({ valor: String(i + 1), texto: `💰 ${c.nome || `Caixa ${i + 1}`}` })),
          { valor: '0', texto: '↩️ Voltar' },
        ]);
      }
      await fecharCaixa(chatId, caixas[0]);
      return menuEquipe(chatId, 'Precisa de mais alguma coisa? 👇');
    }
    if (t === 'p') {
      s.etapa = 'equipe_pc_nome';
      s.preCadastro = {};
      return enviar(chatId, 'Certo! Qual é o *nome do cliente* do pré-cadastro?\n\n_Para cancelar, digite *0*._');
    }
    if (t === 'a') {
      await enviar(chatId, 'Certo! Já avisei a equipe, em instantes alguém fala com você por aqui. 😊');
      return transferir(chatId, false);
    }
    return menuEquipe(chatId, 'Não entendi 😅 Escolha uma das opções 👇');
  }

  async function etapaEscolherCaixa(chatId, s, texto) {
    const t = u.normalizar(texto);
    const caixas = await caixasDe(chatId);
    // "Voltar" é a última opção da lista (número logo depois dos caixas) ou 0
    if (['0', 'voltar', 'v', 'menu', 'cancelar', String(caixas.length + 1)].includes(t)) {
      s.etapa = 'equipe_menu';
      return menuEquipe(chatId, 'Certo. O que você precisa? 👇');
    }
    let c = /^\d{1,2}$/.test(t) ? caixas[Number(t) - 1] : null;
    if (!c) c = caixas.find((x) => x.nome && (t.includes(u.normalizar(x.nome)) || u.normalizar(x.nome).includes(t)) && t.length >= 3);
    if (!c) return enviar(chatId, `Não entendi 😅 Responda com o número do caixa, ou *${caixas.length + 1}* para voltar.`);
    s.etapa = 'equipe_menu';
    await fecharCaixa(chatId, c);
    return menuEquipe(chatId, 'Precisa de mais alguma coisa? 👇');
  }

  // Ícone de cada forma de pagamento no resumo
  function iconeForma(nome) {
    const n = u.normalizar(nome);
    if (/pix/.test(n)) return '📱';
    if (/cartao|credito|debito/.test(n)) return '💳';
    if (/dinheiro|especie/.test(n)) return '💵';
    if (/boleto|banc|transfer|deposito/.test(n)) return '🏦';
    return '▫️';
  }

  async function fecharCaixa(chatId, caixa) {
    const usuarios = (caixa && caixa.usuarios) || [];
    const nomeCaixa = (caixa && caixa.nome) || '';
    // Sem usuário configurado, não mostra nada (senão sairiam os pagamentos da empresa inteira)
    if (!usuarios.length) {
      log(`[caixa] caixa "${nomeCaixa}" sem usuário do SGP no .env: fechamento não configurado`);
      return enviar(chatId, 'O fechamento de caixa ainda não está configurado (falta informar o usuário do SGP deste caixa). Avise o administrador do bot. 🙏');
    }
    const hoje = u.agoraLocal().hojeISO;
    let pagos;
    try {
      pagos = await sgp.titulosPagos(hoje);
    } catch (e) {
      log(`[caixa] erro ao consultar o SGP: ${e.message}`);
      return enviar(chatId, 'Não consegui puxar os pagamentos do SGP agora. 😕 Tente de novo em alguns minutos ou confira o relatório direto no SGP.');
    }
    const meus = pagos
      .filter((p) => usuarios.includes(p.usuario.toLowerCase()))
      .sort((a, b) => a.data.localeCompare(b.data)); // em ordem de horário
    const total = meus.reduce((soma, p) => soma + p.valor, 0);
    const hora = new Date().toLocaleTimeString('pt-BR', { timeZone: cfg.fuso, hour: '2-digit', minute: '2-digit' });
    const titulo = `💰 *Fechamento de caixa${nomeCaixa ? ` - ${nomeCaixa}` : ''}*`;
    const cab = [titulo, `📅 ${u.dataBR(hoje)} (até ${hora})`, `👤 Usuário SGP: ${usuarios.join(', ')}`].join('\n');
    registrar(`[caixa] ${chatId}: ${meus.length} pagamento(s), ${u.moeda(total)} (usuários: ${usuarios.join(', ')})`);
    if (!meus.length) return enviar(chatId, `${cab}\n\nNenhum pagamento recebido hoje por esse usuário.`);

    // Soma por forma de pagamento (Dinheiro, PIX, Cartão...) e por portador (conta onde caiu), do maior para o menor
    const agrupar = (campo, vazio) => {
      const m = {};
      for (const p of meus) {
        const k = p[campo] || vazio;
        m[k] = m[k] || { n: 0, v: 0 };
        m[k].n++;
        m[k].v += p.valor;
      }
      return Object.entries(m).map(([nome, v]) => ({ nome, n: v.n, v: v.v })).sort((a, b) => b.v - a.v);
    };
    const porForma = agrupar('forma', 'Não informada');
    const porPortador = agrupar('portador', 'Sem portador');
    const linha = (x) => `• ${iconeForma(x.nome)} ${x.nome}: ${x.n} - ${u.moeda(x.v)}`;
    const resumoTxt = [
      cab,
      '',
      `Pagamentos: *${meus.length}*`,
      `Total recebido: *${u.moeda(total)}*`,
      '',
      '*Por forma de pagamento:*',
      ...porForma.map(linha),
      // Portador só aparece quando há mais de um (com um só, não diferencia nada)
      ...(porPortador.length > 1 ? ['', '*Por portador:*', ...porPortador.map((x) => `• ${x.nome}: ${x.n} - ${u.moeda(x.v)}`)] : []),
    ].join('\n');
    const horaDe = (p) => (p.data.match(/(\d{2}:\d{2})/) || [])[1] || '';

    // PDF com o mesmo conteúdo (resumo na legenda). Se não der, manda tudo em texto.
    if (enviarPdf) {
      const html = htmlFechamento({
        empresa: cfg.empresa,
        local: nomeCaixa,
        data: u.dataBR(hoje),
        hora,
        usuarios,
        pagamentos: meus.map((p) => ({ hora: horaDe(p), contrato: p.contrato, cliente: nomeLGPD(p.cliente), forma: p.forma, valor: p.valor })),
        total,
        porForma,
        porPortador: porPortador.length > 1 ? porPortador : [],
        geradoEm: `${u.dataBR(hoje)} às ${hora}`,
      });
      const nome = `fechamento-caixa${nomeCaixa ? `-${u.normalizar(nomeCaixa).replace(/[^a-z0-9]+/g, '-')}` : ''}-${hoje}.pdf`;
      try {
        await enviarPdf(chatId, html, nome, resumoTxt);
        return;
      } catch (e) {
        // Vai para o arquivo de log (o log() comum só aparece na janela)
        registrar(`[caixa] não consegui gerar/enviar o PDF, mandando em texto: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`);
      }
    }
    await enviar(chatId, resumoTxt);

    // Lista para conferência (até 60 por mensagem)
    const linhas = meus.map((p, i) => {
      const h = horaDe(p);
      return `${i + 1}. ${p.contrato ? `Contrato ${p.contrato} - ` : ''}${nomeLGPD(p.cliente) || 'Cliente'} - ${u.moeda(p.valor)}${p.forma ? ` - ${p.forma}` : ''}${h ? ` (${h})` : ''}`;
    });
    for (let i = 0; i < linhas.length; i += 60) {
      await enviar(chatId, `${i === 0 ? '*Lista de pagamentos:*\n' : ''}${linhas.slice(i, i + 60).join('\n')}`);
    }
  }

  // Pré-cadastro: pede nome, dia de vencimento e plano, um de cada vez
  async function etapaPreCadastro(chatId, s, texto, naoTexto) {
    const t = u.normalizar(texto);
    if (['0', 'cancelar', 'cancela', 'menu'].includes(t)) {
      s.etapa = 'equipe_menu';
      delete s.preCadastro;
      return menuEquipe(chatId, 'Certo, cancelei. O que você precisa? 👇');
    }
    if (naoTexto || !String(texto || '').trim()) return enviar(chatId, 'Me responde por texto, por favor. 🙂');
    const pc = (s.preCadastro = s.preCadastro || {});
    const valor = String(texto).trim().slice(0, 200);

    if (s.etapa === 'equipe_pc_nome') {
      if (valor.length < 3) return enviar(chatId, 'Qual é o *nome completo* do cliente?');
      pc.nome = valor;
      s.etapa = 'equipe_pc_vencimento';
      return enviar(chatId, 'Qual a *data de vencimento*? (o dia do mês, ex.: *10*)');
    }
    if (s.etapa === 'equipe_pc_vencimento') {
      // Aceita "10", "dia 10", "10/11"...: guarda o dia; se não tiver número, guarda o texto
      const dia = (t.match(/\b([0-2]?\d|3[01])\b/) || [])[1];
      if (!dia && valor.length < 2) return enviar(chatId, 'Qual o *dia do vencimento*? (ex.: *10*)');
      pc.vencimento = dia && /^(dia\s*)?\d{1,2}$/.test(t) ? `Dia ${Number(dia)}` : valor;
      s.etapa = 'equipe_pc_plano';
      return enviar(chatId, 'E qual o *plano*? (ex.: *300 MB*)');
    }
    if (s.etapa === 'equipe_pc_plano') {
      if (valor.length < 2) return enviar(chatId, 'Qual o *plano* do cliente? (ex.: *300 MB*)');
      pc.plano = valor;
      return finalizarPreCadastro(chatId, s);
    }
  }

  async function finalizarPreCadastro(chatId, s) {
    const pc = s.preCadastro || {};
    s.etapa = 'equipe_menu';
    delete s.preCadastro;
    const numero = await Promise.resolve(numeroDoChat(chatId)).catch(() => '');
    const linhas = [`👤 Nome: ${pc.nome}`, `📅 Vencimento: ${pc.vencimento}`, `📶 Plano: ${pc.plano}`];
    log(`[pré-cadastro] ${chatId}\n${linhas.join('\n')}`);
    registrar(`[pré-cadastro] aviso recebido de ${chatId}`);
    // O resumo fica nesta conversa (não lida, para a equipe ver) e vai também para o NUMERO_EQUIPE, se houver
    await aoOcorrencia(chatId, ['📝 *Pré-cadastro feito (aviso da equipe)*', ...linhas, `Avisado por: ${numero || chatId}`].join('\n'), 'precadastro')
      .catch((e) => log(`[erro ao avisar equipe] ${e.message}`));
    await enviar(chatId, `Pré-cadastro avisado! ✅\n\n${linhas.join('\n')}`);
    return menuEquipe(chatId, 'Precisa de mais alguma coisa? 👇');
  }

  // Volta um passo no fluxo
  async function voltar(chatId, s) {
    s.tentativas = 0;
    if (s.etapa.startsWith('suporte_') && s.etapa !== 'suporte_tipo' && s.etapa !== 'suporte_bloqueado') {
      s.etapa = 'suporte_tipo';
      return perguntar(chatId, 'Sem problema! Qual é o problema? 👇', OP.problema);
    }
    if ((s.etapa === 'financeiro' || s.etapa.startsWith('suporte_')) && s.contratos && (s.contratosTodos || s.contratos).length > 1) {
      if (s.contratosTodos) s.contratos = ordenarContratos(s.contratosTodos);
      s.etapa = 'contrato';
      return perguntarContrato(chatId, s, 'Sem problema! Qual contrato? 👇');
    }
    if (['financeiro', 'contrato', 'acordo', 'verificar'].includes(s.etapa) || s.etapa.startsWith('suporte_')) {
      s.etapa = 'doc';
      s.doc = s.contratos = s.contrato = undefined;
      return enviar(chatId, MSG.pedirDoc('Sem problema!'));
    }
    if (s.etapa === 'venda_nome') {
      s.etapa = 'venda_local';
      return enviar(chatId, 'Sem problema! Me diga de novo sua *cidade e bairro* (ou sítio/comunidade).');
    }
    if (s.etapa === 'venda_uso') {
      s.etapa = 'venda_nome';
      return enviar(chatId, 'Sem problema! Qual é o seu nome?');
    }
    s.etapa = 'menu';
    return menu(chatId, 'Sem problema! Como posso te ajudar? 👇');
  }

  async function comecar(chatId, s, intencao, texto) {
    s.tentativas = 0;
    if (intencao === 'atendente') return transferir(chatId);
    if (intencao === 'contratar') {
      s.etapa = 'venda_local';
      s.venda = { mensagem: String(texto || '').slice(0, 300) };
      return enviar(chatId, 'Que bom que quer ser cliente! 🚀 Para eu ver a cobertura, me diga sua *cidade e bairro* (ou sítio/comunidade).');
    }
    s.destino = intencao;
    // Pediu o boleto com todas as letras: depois de achar o cadastro já manda
    // Quem pede chave PIX, QR code, copia e cola ou "quero pagar" recebe o boleto direto (já vai com o PIX)
    if (intencao === 'financeiro' && /boleto|fatura|segunda via|2a via|\bpix\b|\bchave\b|\bqr ?code\b|copia e cola|\bpagar\b|\bcodigo (de barras|pra pagar|para pagar)\b/.test(u.normalizar(texto))) s.acaoDireta = 'boleto';
    // CPF já veio numa mensagem anterior
    if (s.docPendente) {
      const doc = s.docPendente;
      delete s.docPendente;
      return carregarCadastro(chatId, s, doc);
    }
    // Já conhece esse número: confirma o cadastro em vez de pedir CPF de novo
    const lembrado = estado.cliente(chatId);
    if (lembrado && lembrado.doc) {
      s.etapa = 'confirmar_doc';
      return perguntar(chatId, `É o mesmo CPF de antes (${mascarar(lembrado.doc)})? 👇`, OP.confirmarDoc);
    }
    s.etapa = 'doc';
    return enviar(chatId, MSG.pedirDoc(intencao === 'suporte' ? 'Vamos resolver isso! 🛠️' : 'Certo!'));
  }

  async function etapaConfirmarDoc(chatId, s, t) {
    if (t === 's') {
      const lembrado = estado.cliente(chatId) || {};
      return carregarCadastro(chatId, s, lembrado.doc, lembrado.contrato);
    }
    if (t === 'o') {
      s.etapa = 'doc';
      return enviar(chatId, MSG.pedirDoc('Certo!'));
    }
    return perguntar(chatId, 'Toque em uma das opções 👇', OP.confirmarDoc);
  }

  // ---------- Quero contratar ----------
  async function etapaVendaLocal(chatId, s, texto) {
    if (String(texto).trim().length < 3) return enviar(chatId, 'Me diga sua *cidade e bairro* (ou sítio/comunidade), por favor.');
    s.venda.local = String(texto).trim().slice(0, 300);
    s.etapa = 'venda_nome';
    return enviar(chatId, 'Anotado! 📍 E qual é o seu nome?');
  }

  async function etapaVendaNome(chatId, s, texto) {
    if (String(texto).trim().length < 2) return enviar(chatId, 'Qual é o seu nome?');
    s.venda.nome = String(texto).trim().slice(0, 100);
    s.etapa = 'venda_uso';
    return perguntar(chatId, `Prazer, ${capitalizar(s.venda.nome.split(' ')[0])}! 😊 Me conta: como você mais utiliza a internet no dia a dia? 👇`, OP.uso);
  }

  async function etapaVendaUso(chatId, s, t) {
    const op = OP.uso.find((o) => o.valor === t);
    if (!op) return perguntar(chatId, 'Toque em uma das opções 👇', OP.uso);
    const v = s.venda;
    v.uso = op.texto.replace(/^\S+\s/, '');

    // Indica o plano ideal e manda a arte dos planos
    const ind = INDICACAO[t] || INDICACAO['4'];
    v.planoIndicado = ind.plano;
    const legenda =
      `${ind.texto}\n\n` +
      `👉 Nossa indicação para você: *${ind.plano}* por *${ind.preco}/mês*\n\n` +
      'E o melhor: a *instalação é grátis*! 🚀\n' +
      '_Os valores podem variar de acordo com a localização._';
    const enviarFoto = enviarImagem || ((id, _arq, txt) => enviar(id, txt));
    await enviarFoto(chatId, PLANOS_IMAGEM, legenda);

    await enviar(
      chatId,
      'Já passei seus dados para nossa equipe comercial, que vai confirmar a cobertura no seu endereço e tirar qualquer dúvida sobre os planos. ✅\n\n' +
        (u.dentroDoHorario()
          ? 'Em instantes alguém fala com você por aqui. 😊'
          : `Estamos fora do horário (${cfg.horario.texto}), mas já está registrado e te respondemos assim que possível. 🙏`)
    );
    const resumo = [
      '🚀 *Novo interessado (bot)*',
      `Nome: ${v.nome}`,
      `Local: ${v.local}`,
      `Uso: ${v.uso}`,
      `Plano indicado pelo bot: ${v.planoIndicado}`,
      v.mensagem ? `Primeira mensagem: ${v.mensagem}` : null,
    ].filter(Boolean).join('\n');
    log(`[venda] ${chatId}\n${resumo}`);
    await aoOcorrencia(chatId, resumo, 'venda').catch((e) => log(`[erro ao avisar equipe] ${e.message}`));
    return transferir(chatId, false);
  }

  async function finalizar(chatId) {
    log(`[fim] ${chatId}: cliente finalizou o atendimento`);
    sessoes.delete(chatId);
    salvarSessoes();
    return enviar(chatId, 'Atendimento finalizado ✅ Obrigado por falar com a gente! Se precisar, é só mandar mensagem. 😊');
  }

  async function etapaMenu(chatId, s, t) {
    const docMenu = ent.extrairDoc(t);
    if (docMenu) s.docPendente = docMenu;
    const escolha = { 1: 'financeiro', 2: 'suporte', 3: 'contratar', 4: 'atendente' }[t] || ent.detectarIntencao(t);
    if (!escolha && docMenu) return menu(chatId, 'Recebi seu CPF/CNPJ ✅ Agora me diz: o que você precisa? 👇');
    if (escolha) return comecar(chatId, s, escolha, t.length > 2 ? t : '');
    if (t === '4') return transferir(chatId);

    // Cliente escreveu outra coisa: tenta mais uma vez, depois passa para humano
    s.tentativas++;
    if (s.tentativas >= 2) return transferir(chatId);
    return menu(chatId, 'Não entendi 😅 Toque em uma das opções 👇');
  }

  async function etapaDoc(chatId, s, texto) {
    const doc = ent.extrairDoc(texto) || u.soDigitos(texto);
    const valido = (doc.length === 11 && u.cpfValido(doc)) || (doc.length === 14 && u.cnpjValido(doc));
    if (!valido) {
      s.tentativas++;
      if (s.tentativas >= 3) return transferir(chatId);
      return enviar(chatId, MSG.docInvalido);
    }
    return carregarCadastro(chatId, s, doc);
  }

  // Busca o cadastro no SGP. Se já souber o contrato (cliente lembrado), pula a escolha.
  async function carregarCadastro(chatId, s, doc, contratoPreferido) {
    // LGPD: limita quantos CPFs diferentes um mesmo WhatsApp pode consultar por dia
    if (!podeConsultar(chatId, doc)) {
      log(`[lgpd] ${chatId} passou do limite de ${cfg.limiteDocsDia} CPFs/CNPJs diferentes no dia`);
      await enviar(chatId, 'Por segurança, não consigo consultar mais cadastros por aqui hoje. Vou te passar para um atendente. 🔒');
      return transferir(chatId, false);
    }
    const contratos = await sgp.consultarCliente(doc);
    if (!contratos.length) {
      s.etapa = 'doc';
      s.tentativas++;
      if (s.tentativas >= 3) return transferir(chatId);
      return enviar(chatId, MSG.naoEncontrado);
    }

    s.doc = doc;
    s.contratosTodos = contratos;
    s.contratos = ordenarContratos(contratos);
    s.tentativas = 0;
    estado.lembrar(chatId, { doc });
    s.contratoPreferido = contratoPreferido;

    // Segurança/LGPD: nome, rua e ponto de referência só aparecem se o WhatsApp for do titular.
    // Se o número não bater com o cadastro, pede os 4 últimos dígitos de um telefone cadastrado.
    s.verificado = await identidadeConfirmada(chatId, doc, contratos);
    if (!s.verificado && telefonesDe(contratos).length) {
      s.etapa = 'verificar';
      s.tentativasVerif = 0;
      return enviar(chatId, MSG.pedirVerificacao);
    }
    return mostrarContratos(chatId, s);
  }

  async function identidadeConfirmada(chatId, doc, contratos) {
    const lembrado = estado.cliente(chatId);
    if (lembrado && lembrado.verificadoDoc === doc) return true;
    const numero = await Promise.resolve(numeroDoChat(chatId)).catch(() => '');
    const final = String(numero || '').replace(/\D/g, '').slice(-8);
    if (final.length < 8) return false;
    // Compara os 8 últimos dígitos: funciona com ou sem 55, DDD e o 9 extra do celular
    const ok = telefonesDe(contratos).some((tel) => tel.slice(-8) === final);
    if (ok) estado.lembrar(chatId, { verificadoDoc: doc });
    return ok;
  }

  async function etapaVerificar(chatId, s, t, texto) {
    if (/^(pular|pula|nao sei|nao lembro|nao tenho|nao tem|sei la)\b|^nao$/.test(t)) return seguirSemVerificar(chatId, s, 'Sem problema!');
    const digitos = u.soDigitos(texto);
    if (digitos.length >= 4 && telefonesDe(s.contratosTodos || s.contratos).some((tel) => tel.endsWith(digitos.slice(-4)))) {
      s.verificado = true;
      estado.lembrar(chatId, { verificadoDoc: s.doc });
      await enviar(chatId, 'Confirmado! ✅');
      return mostrarContratos(chatId, s);
    }
    // Texto sem números não conta como tentativa errada: só lembra o que precisa
    if (!digitos.length) return enviar(chatId, 'Pra continuar, me manda só os *4 últimos números do telefone* que está no seu cadastro.\n\n_Se não souber, digite *pular*._');
    s.tentativasVerif = (s.tentativasVerif || 0) + 1;
    if (s.tentativasVerif >= 2) return seguirSemVerificar(chatId, s, 'Esses números não batem com o telefone do seu cadastro.');
    return enviar(chatId, 'Esses números não batem com o telefone do seu cadastro 🤔 Tenta de novo, ou digite *pular*.');
  }

  // Segue o atendimento (boleto, suporte...) sem mostrar nome, rua e referência
  async function seguirSemVerificar(chatId, s, inicio) {
    s.verificado = false;
    log(`[lgpd] ${chatId}: identidade não confirmada, seguindo sem mostrar dados do cadastro`);
    await enviar(chatId, `${inicio} Vou continuar, mas pra sua segurança não vou mostrar nome e endereço. 🔒`);
    return mostrarContratos(chatId, s);
  }

  async function mostrarContratos(chatId, s) {
    const todos = s.contratosTodos || s.contratos;
    const preferido = s.contratoPreferido !== undefined && todos.find((c) => String(c.id) === String(s.contratoPreferido));
    delete s.contratoPreferido;
    if (todos.length === 1 || preferido) {
      s.contrato = preferido || todos[0];
      estado.lembrar(chatId, { contrato: s.contrato.id });
      const nome = s.verificado ? (s.contrato.nome || '').split(' ')[0] : '';
      const saud = nome ? `Encontrei seu cadastro, ${capitalizar(nome)}! ✅\n\n` : 'Encontrei o cadastro! ✅\n\n';
      await enviar(chatId, saud + MSG.contratoInfo(s.contrato, s.verificado));
      return aposContrato(chatId, s);
    }

    s.etapa = 'contrato';
    return perguntarContrato(chatId, s, `Encontrei ${todos.length} contratos no seu nome. Qual deles? 👇`);
  }

  // Aceita a opção da lista, o número do contrato (ex.: 4684) ou parte do endereço/referência
  async function etapaContrato(chatId, s, t, texto) {
    const todos = s.contratosTodos || s.contratos;
    let c = /^\d{1,2}$/.test(t) ? s.contratos.slice(0, MAX_LISTA)[Number(t) - 1] : null;
    if (!c) {
      const numero = u.soDigitos(texto);
      if (numero) c = todos.find((x) => String(x.id) === numero);
    }
    if (!c) {
      // Busca por palavras: "rua das flores" acha "R. Flores, 10"; ignora rua/av/da/de...
      const palavras = u.normalizar(texto).split(/[^a-z0-9]+/).filter((p) => p.length >= 3 && !PALAVRAS_VAZIAS.has(p));
      if (palavras.length) {
        const achados = todos.filter((x) => {
          const onde = u.normalizar(`${x.endereco || ''} ${x.referencia || ''}`);
          return palavras.every((p) => onde.includes(p));
        });
        if (achados.length === 1) c = achados[0];
        else if (achados.length > 1) {
          s.contratos = achados;
          return perguntarContrato(chatId, s, `Achei ${achados.length} contratos com "${String(texto).trim().slice(0, 40)}". Qual deles? 👇`);
        }
      }
    }
    if (!c) return perguntarContrato(chatId, s, 'Não encontrei esse contrato 🤔 Escolha uma das opções 👇');
    s.contrato = c;
    estado.lembrar(chatId, { contrato: s.contrato.id });
    await enviar(chatId, MSG.contratoInfo(s.contrato, s.verificado));
    return aposContrato(chatId, s);
  }

  // Depois de achar o contrato: segue para financeiro ou suporte
  async function aposContrato(chatId, s) {
    // Débito antigo (2,5 meses ou mais): oferece acordo antes de qualquer coisa
    if (!s.acordoVisto && (await oferecerAcordo(chatId, s))) return;
    return seguirFluxo(chatId, s);
  }

  async function seguirFluxo(chatId, s) {
    if (s.destino !== 'suporte') {
      s.etapa = 'financeiro';
      if (s.acaoDireta === 'boleto') {
        delete s.acaoDireta;
        return segundaVia(chatId, s);
      }
      return menuFin(chatId);
    }
    s.ocorrencia = {};
    // Contrato bloqueado por falta de pagamento: oferece o financeiro antes
    if (/suspen|bloq|reduz/i.test(String(s.contrato.status))) {
      s.etapa = 'suporte_bloqueado';
      return perguntar(
        chatId,
        /reduz/i.test(String(s.contrato.status))
          ? 'Vi aqui que sua internet está com a *velocidade reduzida* por boleto em aberto, e esse pode ser o motivo. O que você prefere? 👇'
          : 'Vi aqui que sua internet está *bloqueada* por boleto em aberto, e esse pode ser o motivo. O que você prefere? 👇',
        OP.bloqueado
      );
    }
    s.etapa = 'suporte_tipo';
    return perguntar(chatId, 'Qual é o problema? 👇', OP.problema);
  }

  // ---------- Acordo (débito de 2,5 meses ou mais) ----------
  // Retorna true se ofereceu o acordo
  async function oferecerAcordo(chatId, s, titulosJa) {
    s.acordoVisto = true;
    let titulos = titulosJa;
    if (!titulos) {
      try {
        titulos = await sgp.titulosAbertos(s.doc, s.contrato.id);
      } catch (e) {
        log(`[acordo] não consegui consultar títulos: ${e.message}`);
        return false;
      }
    }
    if (!titulos || !titulos.length) return false;
    const atraso = u.diasDeAtraso(titulos[0].vencimento);
    if (atraso === null || atraso < cfg.acordoMinDias) return false;

    const total = titulos.reduce((soma, t) => soma + (Number(String(t.valor ?? '').replace(',', '.')) || 0), 0);
    s.acordoInfo = { qtd: titulos.length, total, atraso, desde: titulos[0].vencimento };
    s.etapa = 'acordo';
    await enviar(
      chatId,
      `Vi aqui que você tem *${titulos.length} ${titulos.length > 1 ? 'boletos' : 'boleto'} em aberto* desde *${u.dataBR(titulos[0].vencimento)}*.\n\n` +
        `Sentimos sua falta! 💙 Temos *condições especiais* para você colocar tudo em dia e voltar a usar a internet da ${cfg.empresa}.`
    );
    await perguntar(chatId, 'Quer que nossa equipe te mande uma proposta de acordo? 👇', OP.acordo);
    return true;
  }

  async function etapaAcordo(chatId, s, t) {
    if (t === 'a') {
      const a = s.acordoInfo || {};
      await enviar(
        chatId,
        'Ótimo! 🤝 Já passei seus dados para nossa equipe financeira, que vai te apresentar a proposta de acordo por aqui.\n\n' +
          (u.dentroDoHorario()
            ? 'Em instantes alguém fala com você. 😊'
            : `Estamos fora do horário (${cfg.horario.texto}), mas já está registrado e te respondemos assim que possível. 🙏`)
      );
      const resumo = [
        '🤝 *Pedido de acordo (bot)*',
        `Cliente: ${s.contrato.nome || '-'}`,
        `CPF/CNPJ: ${s.doc}`,
        `Identidade: ${s.verificado ? 'confirmada (telefone do cadastro)' : '⚠️ NÃO confirmada'}`,
        `Contrato: ${s.contrato.id}${s.contrato.status ? ` (${s.contrato.status})` : ''}`,
        `Faturas em aberto: ${a.qtd || '-'}`,
        `Total em aberto: ${a.total ? u.moeda(a.total) : '-'} (sem juros/multa)`,
        `Mais antiga: ${u.dataBR(a.desde)} (${a.atraso} dias)`,
      ].join('\n');
      log(`[acordo] ${chatId}\n${resumo}`);
      await aoOcorrencia(chatId, resumo, 'acordo').catch((e) => log(`[erro ao avisar equipe] ${e.message}`));
      return transferir(chatId, false);
    }
    if (t === 'b') {
      s.etapa = 'financeiro';
      return segundaVia(chatId, s);
    }
    if (t === 'n') {
      await enviar(chatId, 'Tudo bem! Quando quiser negociar, é só me chamar e escolher *Boleto e liberação da internet*. 😉');
      return seguirFluxo(chatId, s);
    }
    return perguntar(chatId, 'Responda com o número da opção 👇', OP.acordo);
  }

  // ---------- Suporte técnico ----------
  async function etapaSuporteBloqueado(chatId, s, t) {
    if (t === 'p') { s.etapa = 'financeiro'; return promessa(chatId, s); }
    if (t === 'b') { s.etapa = 'financeiro'; return segundaVia(chatId, s); }
    if (t === 'c') { s.etapa = 'suporte_tipo'; return perguntar(chatId, 'Certo! Qual é o problema? 👇', OP.problema); }
    return perguntar(chatId, 'Toque em uma das opções 👇', OP.bloqueado);
  }

  async function etapaSuporteTipo(chatId, s, t) {
    const op = OP.problema.find((o) => o.valor === t);
    if (!op || op.valor === 'v') return perguntar(chatId, 'Toque no problema que mais parece com o seu 👇', OP.problema);
    s.ocorrencia = { problema: op.texto.replace(/^\S+\s/, '') };

    // Consulta no SGP se a conexão do cliente está online
    let online = null;
    if (['1', '2', '3'].includes(t)) {
      online = await sgp.verificarAcesso(s.contrato.id).catch((e) => { log(`[verificaacesso] ${e.message}`); return null; });
      if (online !== null) s.ocorrencia.conexao = online ? 'Online no SGP' : 'Offline no SGP';
    }
    if (t === '1' && online === true) {
      // Conexão chega até a casa: problema provavelmente no Wi-Fi ou no aparelho
      await enviar(
        chatId,
        'Verifiquei aqui e a internet está *chegando normalmente* na sua casa. ✅ ' +
          'Então o problema deve ser no Wi-Fi ou no aparelho que você está usando.\n\n' +
          'Testa a internet em *outro celular* e confere se ele está conectado no Wi-Fi certo.'
      );
      s.ocorrencia.orientacao = 'Conexão online: orientado a testar Wi-Fi/outro aparelho';
      s.etapa = 'suporte_resolveu';
      return perguntar(chatId, 'Fez o teste? A internet voltou?', OP.resolveu);
    }
    if (t === '1') {
      s.etapa = 'suporte_luz';
      return perguntar(chatId, 'Dá uma olhada no aparelho da internet (o que tem o fio fino da fibra). Tem alguma luz *vermelha*, acesa ou piscando?', OP.luz);
    }
    if (t === '2' || t === '3') {
      s.etapa = 'suporte_reiniciou';
      return perguntar(chatId, 'Você já tirou o aparelho da internet da tomada, esperou *30 segundos* e ligou de novo?', OP.reiniciou);
    }
    return pedirDescricao(chatId, s);
  }

  async function etapaSuporteLuz(chatId, s, t) {
    const op = OP.luz.find((o) => o.valor === t);
    if (!op) return perguntar(chatId, 'Toque em uma das opções 👇', OP.luz);
    s.ocorrencia.luz = op.texto.replace(/^\S+\s/, '');
    if (t === 's') {
      // Luz vermelha = problema na fibra, reiniciar não resolve: direto para o técnico
      await enviar(chatId, 'Obrigado! Luz vermelha geralmente é problema no cabo da fibra, então vou passar para nossa equipe técnica.');
      return pedirDescricao(chatId, s);
    }
    if (t === 'd') {
      await enviar(chatId, 'Confere se o aparelho está bem encaixado na tomada (ou testa outra tomada) e se o botão de ligar está apertado.');
    }
    s.etapa = 'suporte_reiniciou';
    return perguntar(chatId, 'Você já tirou o aparelho da internet da tomada, esperou *30 segundos* e ligou de novo?', OP.reiniciou);
  }

  async function etapaSuporteReiniciou(chatId, s, t) {
    if (t === 's') {
      s.ocorrencia.reiniciou = 'Sim';
      return pedirDescricao(chatId, s);
    }
    if (t === 'n') {
      s.ocorrencia.reiniciou = 'Pedido ao cliente pelo bot';
      s.etapa = 'suporte_resolveu';
      await enviar(chatId, 'Faz assim: tira o aparelho da internet da tomada (e o roteador também, se tiver dois), espera *30 segundos* e liga de novo. Depois espera uns *3 minutos* para a internet voltar. ⏳');
      return perguntar(chatId, 'E aí, a internet voltou?', OP.resolveu);
    }
    return perguntar(chatId, 'Toque em uma das opções 👇', OP.reiniciou);
  }

  async function etapaSuporteResolveu(chatId, s, t) {
    if (t === 's') {
      log(`[suporte] ${chatId}: resolvido reiniciando o roteador`);
      sessoes.delete(chatId);
      return enviar(chatId, 'Que ótimo! 🎉 Se precisar de algo mais, é só mandar mensagem.');
    }
    if (t === 'n') {
      // Continua com problema: pega a descrição e passa para a equipe técnica (encaminhamento manual)
      if (s.ocorrencia.reiniciou) s.ocorrencia.reiniciou = 'Sim, não resolveu';
      else if (s.ocorrencia.orientacao) s.ocorrencia.orientacao += ' (não resolveu)';
      return pedirDescricao(chatId, s);
    }
    return perguntar(chatId, 'Toque em uma das opções 👇', OP.resolveu);
  }

  function pedirDescricao(chatId, s) {
    s.etapa = 'suporte_desc';
    return enviar(
      chatId,
      'Me conta rapidinho o que está acontecendo, pra eu passar para o técnico: desde quando e se é em todos os aparelhos. ' +
        'Pode mandar *texto, áudio ou foto*. 📝'
    );
  }

  async function finalizarSuporte(chatId, s, descricao) {
    const o = s.ocorrencia || {};
    o.descricao = String(descricao || '').trim().slice(0, 1000) || '-';
    const c = s.contrato;
    const linhas = [
      `Problema: ${o.problema || '-'}`,
      o.conexao ? `Conexão: ${o.conexao}` : null,
      o.luz ? `Luz vermelha (LOS): ${o.luz}` : null,
      o.reiniciou ? `Reiniciou o roteador: ${o.reiniciou}` : null,
      o.orientacao ? `Orientação: ${o.orientacao}` : null,
      `Descrição: ${o.descricao}`,
    ].filter(Boolean);

    await enviar(
      chatId,
      `Prontinho! ✅ Registrei seu chamado:\n\n${linhas.filter((l) => !/^(Conexão|Orientação):/.test(l)).map((l) => l.replace('Luz vermelha (LOS):', 'Luz vermelha:').replace('Reiniciou o roteador:', 'Reiniciou o aparelho:')).join('\n')}\n\n` +
        (u.dentroDoHorario()
          ? 'Nossa equipe técnica vai dar continuidade por aqui em instantes. 😊'
          : `Estamos fora do horário (${cfg.horario.texto}), mas sua solicitação já está registrada e a equipe vai te responder assim que possível. 🙏`)
    );

    const resumo = [
      '🛠️ *Nova ocorrência (bot)*',
      `Cliente: ${c.nome || '-'}`,
      `CPF/CNPJ: ${s.doc}`,
      `Identidade: ${s.verificado ? 'confirmada (telefone do cadastro)' : '⚠️ NÃO confirmada'}`,
      `Contrato: ${c.id}${c.status ? ` (${c.status})` : ''}`,
      c.endereco ? `Endereço: ${c.endereco}` : null,
      c.referencia ? `Referência: ${c.referencia}` : null,
      ...linhas,
    ].filter(Boolean).join('\n');
    log(`[ocorrência] ${chatId}\n${resumo}`);
    await aoOcorrencia(chatId, resumo).catch((e) => log(`[erro ao avisar equipe] ${e.message}`));
    return transferir(chatId, false);
  }

  function perguntarContrato(chatId, s, pergunta) {
    const opcoes = s.contratos.slice(0, MAX_LISTA).map((c, i) => ({
      valor: String(i + 1),
      // Endereço + ponto de referência para o cliente reconhecer qual é o contrato dele
      // (sem identidade confirmada: só bairro/cidade)
      texto: [
        `Contrato ${c.id}`,
        s.verificado ? (c.endereco ? enderecoLGPD(c.endereco) : null) : regiaoLGPD(c.endereco),
        s.verificado && c.referencia ? `Ref: ${c.referencia}` : null,
        c.status && !/^ativo$/i.test(String(c.status).trim()) ? String(c.status) : null,
      ].filter(Boolean).join(' · ').slice(0, 100),
    }));
    opcoes.push({ valor: 'v', texto: '⬅️ Trocar o CPF' });
    const total = (s.contratosTodos || s.contratos).length;
    if (total > opcoes.length - 1) {
      pergunta += `\n\n_Mostrando ${opcoes.length - 1} de ${total}. Não achou o seu? Digite o *número do contrato* ou o *nome da rua*._`;
    }
    return perguntar(chatId, pergunta, opcoes);
  }

  async function etapaFinanceiro(chatId, s, t) {
    if (t === '1' || t.includes('boleto') || t.includes('via')) return segundaVia(chatId, s);
    if (t === '2' || t.includes('promessa') || t.includes('desbloq') || t.includes('libera') || t.includes('confianca')) return promessa(chatId, s);
    return menuFin(chatId, 'Não entendi 😅 Toque em uma das opções 👇');
  }

  async function segundaVia(chatId, s) {
    const titulos = await sgp.titulosAbertos(s.doc, s.contrato.id);
    if (!titulos.length) {
      await enviar(chatId, MSG.semBoleto(s.contrato));
      return menuFin(chatId, 'Precisa de mais alguma coisa? 👇');
    }

    // Com fatura vencida: manda as vencidas (até 3). Em dia: manda só a próxima a vencer.
    const vencidas = titulos.filter((t) => (u.diasDeAtraso(t.vencimento) ?? 0) > 0);
    const emDia = !vencidas.length;
    const lista = emDia ? titulos.slice(0, 1) : vencidas.slice(0, cfg.maxBoletos);
    if (emDia) await enviar(chatId, 'Você está em dia! 🎉 Segue o seu próximo boleto:');
    for (const b of lista) {
      let txt = `📄 *Boleto com vencimento em ${u.dataBR(b.vencimento)}*\nValor: *${u.moeda(b.valor)}*`;
      if (b.link) txt += `\n\nBoleto em PDF: ${b.link}`;
      await enviar(chatId, txt);
      // Linha digitável e PIX vão sozinhos para o cliente copiar fácil
      if (b.pix) {
        await enviar(chatId, '💠 *PIX copia e cola* (toque e segure a próxima mensagem para copiar):');
        await enviar(chatId, String(b.pix));
      }
      if (b.linha) {
        await enviar(chatId, '🔢 *Código de barras* (para pagar no app do banco ou na lotérica):');
        await enviar(chatId, String(b.linha));
      }
    }
    if (!emDia && vencidas.length > lista.length) {
      await enviar(chatId, `Você tem mais ${vencidas.length - lista.length} boleto(s) em aberto. Para receber todos, digite *9* e fale com um atendente.`);
    }
    return menuFin(chatId, 'Precisa de mais alguma coisa? 👇');
  }

  async function promessa(chatId, s) {
    const titulos = await sgp.titulosAbertos(s.doc, s.contrato.id);
    if (!titulos.length) {
      await enviar(chatId, 'Você não tem boleto em aberto, então sua internet não precisa de liberação. 🎉');
      return menuFin(chatId, 'Precisa de mais alguma coisa? 👇');
    }

    // Regra: só libera a partir do dia do bloqueio (X dias de atraso)
    const atraso = u.diasDeAtraso(titulos[0].vencimento);
    // Débito muito antigo: liberação não resolve, oferece acordo
    if (atraso !== null && atraso >= cfg.acordoMinDias) {
      if (s.acordoVisto) {
        // Já viu a oferta antes: explica direto por que a liberação não está disponível
        s.etapa = 'acordo';
        return perguntar(
          chatId,
          'Como o boleto está em aberto há mais de 2 meses e meio, a liberação não está disponível. Mas dá para fazer um *acordo*, com condições especiais. 👇',
          OP.acordo
        );
      }
      return oferecerAcordo(chatId, s, titulos);
    }
    if (atraso !== null && atraso < cfg.promessaMinDias) {
      const falta = cfg.promessaMinDias - atraso;
      await enviar(
        chatId,
        `Seu boleto venceu em *${u.dataBR(titulos[0].vencimento)}* e sua internet ainda não foi bloqueada, então a liberação ainda não é necessária. ` +
          `Ela fica disponível a partir de ${cfg.promessaMinDias} dias depois do vencimento${falta > 0 ? ` (daqui a ${falta} ${falta > 1 ? 'dias' : 'dia'})` : ''}.\n\n` +
          'Se quiser pagar agora, digite *1* para receber o boleto.'
      );
      return menuFin(chatId, 'Precisa de mais alguma coisa? 👇');
    }

    const r = await sgp.liberarPromessa(s.contrato.id);
    if (r.ok) {
      let txt = `✅ *Pronto, sua internet foi liberada* por ${cfg.promessaDias} ${cfg.promessaDias > 1 ? 'dias' : 'dia'}`;
      txt += r.ate ? ` (até ${u.dataBR(r.ate)}).` : '.';
      if (r.protocolo) txt += `\nProtocolo: *${r.protocolo}*`;
      txt += '\n\nSe a internet não voltar em alguns minutos, tira o aparelho da tomada por 30 segundos e liga de novo. ' +
        'Lembra de pagar até lá para não bloquear de novo. 😉';
      await enviar(chatId, txt);
      return menuFin(chatId, 'Precisa de mais alguma coisa? 👇');
    }

    // SGP recusou (ex.: promessa já usada no mês)
    await enviar(
      chatId,
      `Não consegui liberar sua internet por aqui${r.mensagem ? ` (_${r.mensagem}_)` : ''}. Vou te passar para um atendente. 🙏`
    );
    return transferir(chatId, false);
  }

  // Depois de reiniciar, volta a agendar os lembretes das conversas que estavam no meio
  for (const id of sessoes.keys()) agendarLembrete(id);

  return { receber, pausar, retomar, estaPausado };
}

// Ao carregar do arquivo, devolve as palavras-chave (regex não vai para o JSON) às opções
const TODAS_OPCOES = new Map(Object.values(OP).flat().map((o) => [o.texto, o]));
function restaurarSessao(ss) {
  if (ss && Array.isArray(ss.opcoes)) ss.opcoes = ss.opcoes.map((o) => TODAS_OPCOES.get(o.texto) || o);
  return ss;
}

// Mostra só parte do documento: ***.456.789-**
function mascarar(d) {
  d = String(d || '');
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  if (d.length === 14) return `**.${d.slice(2, 5)}.${d.slice(5, 8)}/****-**`;
  return '***';
}

const PALAVRAS_VAZIAS = new Set(['rua', 'avenida', 'travessa', 'sitio', 'das', 'dos', 'contrato', 'casa', 'meu', 'minha', 'que', 'fica', 'perto', 'numero']);

// Quantos contratos cabem na lista (o resto o cliente acha digitando o número ou a rua)
const MAX_LISTA = 10;

// Ativos primeiro, depois suspensos/bloqueados, por último cancelados.
// Cancelados só saem da lista quando não cabe tudo (continuam valendo pelo número do contrato).
function ordenarContratos(lista) {
  const peso = (c) => (/cancel|inativ|encerr|desativ|rescind/i.test(String(c.status)) ? 2 : /suspen|bloq|reduz/i.test(String(c.status)) ? 1 : 0);
  const ordenados = [...lista].sort((a, b) => peso(a) - peso(b));
  if (ordenados.length <= MAX_LISTA) return ordenados;
  const semCancelados = ordenados.filter((c) => peso(c) < 2);
  return semCancelados.length ? semCancelados : ordenados;
}

// LGPD: "MARIA DA SILVA SOUZA" -> "Maria S. S."
function nomeLGPD(n) {
  const partes = nomeBonito(n).split(' ').filter((p) => p && !['da', 'de', 'do', 'das', 'dos', 'e'].includes(p));
  if (!partes.length) return '';
  return [partes[0], ...partes.slice(1).map((p) => `${p.charAt(0)}.`)].join(' ');
}

// Telefones de todos os contratos do CPF (só dígitos)
function telefonesDe(contratos) {
  return [...new Set((contratos || []).flatMap((c) => c.telefones || []))];
}

// Sem identidade confirmada: só bairro e cidade ("Rua A, 10 - Centro - Ingá/PB" -> "Centro - Ingá/PB")
function regiaoLGPD(e) {
  if (!e) return '';
  const partes = enderecoLGPD(e).split(' - ');
  return partes.length > 1 ? partes.slice(1).join(' - ') : '';
}

// LGPD: mostra rua, bairro e cidade, sem número da casa, complemento nem CEP
// "Rua A, 10 (casa 2) - Centro - Cidade Exemplo/UF" -> "Rua A - Centro - Cidade Exemplo/UF"
function enderecoLGPD(e) {
  const partes = String(e).replace(/\([^)]*\)/g, '').split(/\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  if (!partes.length) return '';
  let rua = partes[0].split(',')[0];
  rua = rua.replace(/\s+(n[º°o]?\.?\s*)?\d+[a-z]?(\s+(apto?\.?|apartamento|casa|bloco|fundos|lote|lt\.?|quadra|qd\.?|km)\b.*)?$/i, '');
  rua = rua.replace(/\s+(km|casa|apto?\.?|lote|quadra|qd\.?)\s*[\w-]*$/i, '').trim();
  const resto = partes.slice(1).filter((p) => !/\bcep\b|^\d{5}-?\d{3}$/i.test(p) && !/^\d+[a-z]?$/i.test(p));
  return [rua, ...resto].filter(Boolean).join(' - ');
}

// "MARIA DA SILVA" -> "Maria da Silva"
function nomeBonito(n) {
  return String(n)
    .toLowerCase()
    .split(/\s+/)
    .map((p) => (['da', 'de', 'do', 'das', 'dos', 'e'].includes(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}

function capitalizar(p) {
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}

module.exports = { criarFluxo, OP };
