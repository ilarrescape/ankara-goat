const { randomInt, shuffle } = require('../utils/random');
const { normalizeMode } = require('./questionTiers');

const SURPRISES = ['advance', 'retreat', 'eliminate', 'swap', 'reset', 'coin_toss'];

function assertBoardSize(size) {
  if (!Number.isInteger(size) || size < 25 || size > 70 || size % 5 !== 0) throw new Error('Tablero inválido.');
}

function createInitialState({ boardSize, players, settings = {} }) {
  assertBoardSize(boardSize);
  const maxPlayers = settings?.isStandingsTiebreak ? 14 : 8;
  if (!Array.isArray(players) || players.length < 2 || players.length > maxPlayers) {
    throw new Error(settings?.isStandingsTiebreak ? 'Un desempate admite entre 2 y 14 jugadores.' : 'Una partida admite entre 2 y 8 jugadores.');
  }
  if (new Set(players.map(p => p.userId)).size !== players.length) throw new Error('Hay jugadores repetidos.');
  const state = {
    boardSize,
    settings: { questionMode: normalizeMode(settings.questionMode), ...settings },
    turnIndex: 0,
    turnNo: 1,
    phase: 'roll',
    players: players.map((p, i) => ({
      ...p,
      position: 0,
      active: true,
      finishOrder: null,
      eliminatedAtTurn: null,
      colorIndex: i
    })),
    surprises: {},
    currentRoll: null,
    pendingMove: null,
    currentQuestion: null,
    pendingSurprise: null,
    winnerIds: [],
    startedAt: Date.now(),
    lastActionAt: Date.now()
  };
  state.surprises = randomizeSurprises(state);
  return state;
}

function activePlayers(state) { return state.players.filter(p => p.active && p.finishOrder == null); }
function occupiedPositions(state) { return new Set(state.players.filter(p => p.active).map(p => p.position)); }

function randomizeSurprises(state) {
  const occupied = occupiedPositions(state);
  const candidates = [];
  for (let i = 1; i < state.boardSize; i++) if (!occupied.has(i)) candidates.push(i);
  const pct = randomInt(10, 20) / 100;
  const count = Math.min(candidates.length, Math.max(1, Math.round(state.boardSize * pct)));
  const positions = shuffle(candidates).slice(0, count);
  const surprises = {};
  positions.forEach(pos => {
    let type = SURPRISES[randomInt(0, SURPRISES.length - 1)];
    if (type === 'eliminate' && activePlayers(state).length < 4) type = randomInt(0, 1) ? 'advance' : 'retreat';
    surprises[pos] = {
      type,
      amount: ['advance', 'retreat'].includes(type) ? randomInt(1, 6) : null
    };
  });
  return surprises;
}

function currentPlayer(state) {
  return state.players[state.turnIndex];
}

function rollDice(state, userId) {
  if (state.phase !== 'roll') throw new Error('Ahora no se puede tirar el dado.');
  const player = currentPlayer(state);
  if (!player || player.userId !== userId) throw new Error('No es tu turno.');
  const roll = randomInt(1, 6);
  state.currentRoll = roll;
  state.phase = 'moving';
  state.lastActionAt = Date.now();
  return roll;
}

function prepareMovement(state) {
  if (state.phase !== 'moving') throw new Error('No hay movimiento pendiente.');
  const player = currentPlayer(state);
  const from = player.position;
  const to = Math.min(state.boardSize, from + state.currentRoll);
  state.pendingMove = { from, to };
  state.phase = 'question_pending';
  const surprise = state.surprises[to] || null;
  if (surprise?.type === 'coin_toss') {
    state.pendingSurprise = { ...surprise, ownerUserId: player.userId, awaitingChoice: true };
    state.phase = 'surprise_choice';
  } else {
    state.pendingSurprise = surprise;
  }
  state.lastActionAt = Date.now();
  return { from, to, surprise: state.pendingSurprise, provisional: true };
}

function chooseCoinToss(state, userId, targetUserId, amount) {
  if (state.phase !== 'surprise_choice' || state.pendingSurprise?.type !== 'coin_toss') throw new Error('No hay Cara o Seca pendiente.');
  if (currentPlayer(state).userId !== userId) throw new Error('No es tu elección.');
  if (!Number.isInteger(amount) || amount < 1 || amount > 10) throw new Error('Elegí entre 1 y 10 casilleros.');
  const target = state.players.find(p => p.userId === targetUserId && p.active && p.userId !== userId);
  if (!target) throw new Error('Rival inválido.');
  state.pendingSurprise = { ...state.pendingSurprise, awaitingChoice: false, targetUserId, amount };
  state.phase = 'question_pending';
}

function setQuestion(state, questionPublic) {
  if (state.phase !== 'question_pending') throw new Error('La partida no espera una pregunta.');
  const durationMs = questionPublic.type === 'multiple_choice' ? 20_000 : 40_000;
  state.currentQuestion = { ...questionPublic, issuedAt: Date.now(), deadline: Date.now() + durationMs };
  state.phase = 'answering';
  state.lastActionAt = Date.now();
}

function moveBack(player, amount) { player.position = Math.max(0, player.position - amount); }
function moveForward(state, player, amount) { player.position = Math.min(state.boardSize, player.position + amount); }

function resolveSurprise(state, answeredCorrectly, targetUserId = null) {
  const player = currentPlayer(state);
  const surprise = state.pendingSurprise;
  if (!surprise) return { type: null, applied: false };

  // Si no acertó, no ganó el casillero. La única sorpresa que conserva efecto
  // al fallar es Cara o Seca, porque su propia regla castiga al que responde.
  if (!answeredCorrectly && surprise.type !== 'coin_toss') {
    return { type: surprise.type, applied: false };
  }

  let target;
  switch (surprise.type) {
    case 'advance': moveForward(state, player, surprise.amount); break;
    case 'retreat': moveBack(player, surprise.amount); break;
    case 'reset': player.position = 0; break;
    case 'swap':
      target = state.players.find(p => p.userId === targetUserId && p.active && p.userId !== player.userId);
      if (!target) throw new Error('Tenés que elegir un participante válido para intercambiar posición.');
      [player.position, target.position] = [target.position, player.position];
      break;
    case 'eliminate':
      if (activePlayers(state).length < 4) return { type: 'eliminate', applied: false };
      target = state.players.find(p => p.userId === targetUserId && p.active && p.userId !== player.userId);
      if (!target) throw new Error('Tenés que elegir un participante válido para eliminar.');
      target.active = false;
      target.eliminatedAtTurn = state.turnNo;
      break;
    case 'coin_toss':
      target = state.players.find(p => p.userId === surprise.targetUserId && p.active);
      if (!target) break;
      if (answeredCorrectly) moveBack(target, surprise.amount);
      else moveBack(player, surprise.amount);
      break;
  }
  return { type: surprise.type, targetUserId: target?.userId ?? null, applied: true };
}

function answerQuestion(state, userId, answeredCorrectly, surpriseTargetUserId = null) {
  if (state.phase !== 'answering') throw new Error('No hay una pregunta activa.');
  const player = currentPlayer(state);
  if (player.userId !== userId) throw new Error('No es tu pregunta.');
  if (Date.now() > state.currentQuestion.deadline) answeredCorrectly = false;

  const from = state.pendingMove?.from ?? player.position;
  const to = state.pendingMove?.to ?? player.position;

  if (answeredCorrectly) player.position = to;
  else player.position = from;

  const surpriseResult = resolveSurprise(state, !!answeredCorrectly, surpriseTargetUserId);

  if (answeredCorrectly && player.position >= state.boardSize && player.finishOrder == null) {
    player.finishOrder = state.winnerIds.length + 1;
    state.winnerIds.push(player.userId);
  }

  state.currentQuestion = null;
  state.currentRoll = null;
  state.pendingMove = null;
  state.pendingSurprise = null;
  state.phase = 'turn_end';
  state.lastActionAt = Date.now();
  return {
    answeredCorrectly: !!answeredCorrectly,
    movementCommitted: !!answeredCorrectly,
    from,
    to: player.position,
    attemptedTo: to,
    surpriseResult
  };
}

function nextTurn(state) {
  if (state.phase !== 'turn_end') throw new Error('El turno todavía no terminó.');
  const remaining = activePlayers(state);
  if (remaining.length <= 1) {
    if (remaining.length === 1 && remaining[0].finishOrder == null) {
      remaining[0].finishOrder = state.winnerIds.length + 1;
      state.winnerIds.push(remaining[0].userId);
    }
    state.phase = 'finished';
    return null;
  }
  let idx = state.turnIndex;
  for (let tries = 0; tries < state.players.length; tries++) {
    idx = (idx + 1) % state.players.length;
    const candidate = state.players[idx];
    if (candidate.active && candidate.finishOrder == null) {
      state.turnIndex = idx;
      state.turnNo += 1;
      state.phase = 'roll';
      state.surprises = randomizeSurprises(state);
      state.lastActionAt = Date.now();
      return candidate;
    }
  }
  state.phase = 'finished';
  return null;
}

module.exports = {
  SURPRISES,
  createInitialState,
  randomizeSurprises,
  currentPlayer,
  rollDice,
  prepareMovement,
  applyMovement: prepareMovement,
  chooseCoinToss,
  setQuestion,
  answerQuestion,
  nextTurn
};
