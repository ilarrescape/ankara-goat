const { randomUUID } = require('crypto');
const { randomInt, shuffle } = require('../utils/random');
const { normalizeMode } = require('./questionTiers');

const ROULETTE_BASE = [
  ...[1,2,3,4,5,6].map((amount,i)=>({ type:'advance', amount, weight:[12,10,8,6,4,2][i] })),
  ...[1,2,3,4,5,6].map((amount,i)=>({ type:'retreat', amount, weight:[10,9,8,6,4,2][i] })),
  ...[1,2,3,4].map((amount,i)=>({ type:'retreat_target', amount, weight:[10,8,5,3][i] })),
  { type:'swap', weight:4 },
  { type:'eliminate_target', weight:1 },
  { type:'eliminate_self', weight:1 }
];

function assertBoardSize(size) {
  if (!Number.isInteger(size) || size < 30 || size > 70) throw new Error('Tablero inválido: se permiten de 30 a 70 casilleros.');
}

function createTurnToken() {
  return randomUUID();
}

function createInitialState({ boardSize, players, settings = {} }) {
  assertBoardSize(boardSize);
  const maxPlayers = 8;
  if (!Array.isArray(players) || players.length < 2 || players.length > maxPlayers) {
    throw new Error(settings?.isStandingsTiebreak ? 'Un tablero de desempate admite entre 2 y 8 jugadores.' : 'Una partida admite entre 2 y 8 jugadores.');
  }
  if (new Set(players.map(p => p.userId)).size !== players.length) throw new Error('Hay jugadores repetidos.');

  const state = {
    boardSize,
    settings: { questionMode: normalizeMode(settings.questionMode), ...settings },
    turnIndex: 0,
    turnNo: 1,
    turnToken: createTurnToken(),
    phase: 'roll',
    players: players.map((p, i) => ({
      ...p,
      position: 0,
      active: true,
      finishOrder: null,
      eliminatedAtTurn: null,
      forfeitedAt: null,
      forfeitReason: null,
      colorIndex: i
    })),
    // Las posiciones y el tipo de cada ítem especial se generan una sola vez.
    // Nunca se vuelven a aleatorizar durante esta partida.
    surprises: {},
    // Cachea la pregunta asociada a cada ítem especial por ciclos de dos jugadas.
    // El questionId no se expone al cliente.
    specialQuestionSlots: {},
    currentRoll: null,
    pendingMove: null,
    pendingVideo: null,
    currentQuestion: null,
    pendingSurprise: null,
    pendingRoulette: null,
    resultPending: null,
    winnerIds: [],
    forfeitedUserIds: [],
    presence: {},
    finishReason: null,
    finishedAt: null,
    archivedByUserIds: [],
    startedAt: Date.now(),
    lastActionAt: Date.now()
  };

  state.surprises = randomizeSurprises(state);
  return state;
}

function activePlayers(state) {
  return state.players.filter(p => p.active && p.finishOrder == null);
}


function pendingAbsences(state) {
  const presence = state.presence || {};
  return state.players.filter(p => p.active && p.finishOrder == null && presence[String(p.userId)]?.connected === false);
}

function hasPendingAbsence(state) {
  return pendingAbsences(state).length > 0;
}

function forfeitPlayer(state, userId, reason = 'disconnect_timeout') {
  const index = state.players.findIndex(p => Number(p.userId) === Number(userId));
  if (index === -1) throw new Error('El jugador no pertenece a la partida.');
  const player = state.players[index];
  if (!player.active || player.finishOrder != null || player.forfeitedAt) {
    return { forfeited: false, finished: state.phase === 'finished', cancelledQuestionId: null };
  }

  const wasCurrent = index === state.turnIndex;
  const cancelledQuestionId = wasCurrent ? Number(state.currentQuestion?.id || 0) || null : null;
  player.active = false;
  player.eliminatedAtTurn = state.turnNo;
  player.forfeitedAt = Date.now();
  player.forfeitReason = reason;
  state.forfeitedUserIds = [...new Set([...(state.forfeitedUserIds || []).map(Number), Number(player.userId)])];
  if (state.presence) delete state.presence[String(player.userId)];

  if (wasCurrent) {
    state.currentQuestion = null;
    state.currentRoll = null;
    state.pendingMove = null;
    state.pendingVideo = null;
    state.pendingSurprise = null;
    state.pendingRoulette = null;
    state.resultPending = null;
  }

  const remaining = activePlayers(state);
  if (remaining.length <= 1) {
    if (remaining.length === 1 && remaining[0].finishOrder == null) {
      remaining[0].finishOrder = state.winnerIds.length + 1;
      state.winnerIds.push(remaining[0].userId);
    }
    state.phase = 'finished';
    state.turnToken = null;
    state.finishReason = 'forfeit';
    state.finishedAt = Date.now();
    state.lastActionAt = Date.now();
    return { forfeited: true, finished: true, cancelledQuestionId, winnerUserId: remaining[0]?.userId || null };
  }

  if (wasCurrent) {
    state.phase = 'turn_end';
    state.resultPending = null;
    nextTurn(state);
  }
  state.lastActionAt = Date.now();
  return { forfeited: true, finished: false, cancelledQuestionId, winnerUserId: null };
}

function occupiedPositions(state) {
  return new Set(state.players.filter(p => p.active).map(p => p.position));
}

function randomizeSurprises(state) {
  const occupied = occupiedPositions(state);
  const candidates = [];
  for (let i = 1; i < state.boardSize; i++) if (!occupied.has(i)) candidates.push(i);
  const configured = Number(state.settings?.specialCellPercent);
  const pct = Number.isFinite(configured) ? Math.min(35, Math.max(20, configured)) / 100 : randomInt(20, 35) / 100;
  const count = Math.min(candidates.length, Math.max(1, Math.round(state.boardSize * pct)));
  return Object.fromEntries(shuffle(candidates).slice(0, count).map(pos => [pos, { type: 'roulette' }]));
}

function rouletteOptions(state) {
  const options = ROULETTE_BASE.map(x => ({ ...x }));
  if (state.settings?.isTournament) options.push({ type:'end_board', weight:1 });
  if (state.settings?.competitionPointsEnabled) {
    options.push({ type:'points_take', amount:5, weight:2 });
    options.push({ type:'points_loss', amount:5, weight:2 });
  }
  return options;
}

function weightedChoice(items) {
  const total = items.reduce((sum,x)=>sum+Number(x.weight||0),0);
  let roll = Math.random() * total;
  for (const item of items) { roll -= Number(item.weight||0); if (roll <= 0) return { ...item }; }
  return { ...items[items.length-1] };
}

function beginRoulette(state, userId, turnToken) {
  const player = assertTurnOwner(state, userId, turnToken);
  if (state.phase !== 'roulette_wait' || !state.pendingRoulette) throw new Error('No hay una ruleta lista para girar.');
  const effect = weightedChoice(rouletteOptions(state));
  const now = Date.now();
  state.pendingRoulette = { ...state.pendingRoulette, effect, status:'spinning', startedAt:now, revealAt:now+10000, ownerUserId:player.userId };
  state.phase = 'roulette_spinning';
  state.lastActionAt = now;
  return state.pendingRoulette;
}

function rouletteNeedsTarget(effect) { return ['retreat_target','swap','eliminate_target','points_take'].includes(effect?.type); }

function eligibleRouletteTargets(state, ownerUserId) {
  return state.players.filter(p => p.active && p.finishOrder == null && Number(p.userId)!==Number(ownerUserId));
}

// Registrar la llegada a meta para CUALQUIER movimiento confirmado, no sólo
// para respuestas correctas. La ruleta puede avanzar o intercambiar fichas.
// nextTurn() conserva el comportamiento normal: si quedan otros jugadores,
// siguen compitiendo por las posiciones restantes.
function recordFinishAtGoal(state, player) {
  if (!player?.active || player.finishOrder != null || player.position < state.boardSize) return false;
  player.finishOrder = state.winnerIds.length + 1;
  state.winnerIds.push(player.userId);
  return true;
}

function applyRouletteEffect(state, targetUserId = null) {
  if (!['roulette_spinning','roulette_target'].includes(state.phase) || !state.pendingRoulette?.effect) throw new Error('No hay un resultado de ruleta pendiente.');
  const player = currentPlayer(state);
  const effect = state.pendingRoulette.effect;
  const before = player.position;
  let target = null;
  if (rouletteNeedsTarget(effect)) {
    target = eligibleRouletteTargets(state, player.userId).find(p=>Number(p.userId)===Number(targetUserId));
    if (!target) throw new Error('Seleccioná un rival disponible.');
  }
  switch(effect.type) {
    case 'advance': moveForward(state, player, effect.amount); break;
    case 'retreat': moveBack(player, effect.amount); break;
    case 'retreat_target': moveBack(target, effect.amount); break;
    case 'swap': [player.position,target.position]=[target.position,player.position]; break;
    case 'eliminate_target': target.active=false; target.eliminatedAtTurn=state.turnNo; break;
    case 'eliminate_self': player.active=false; player.eliminatedAtTurn=state.turnNo; break;
    case 'end_board': {
      const ranked=[...state.players].filter(p=>p.active&&p.finishOrder==null).sort((a,b)=>b.position-a.position);
      ranked.forEach(p=>{ if(p.finishOrder==null){ p.finishOrder=state.winnerIds.length+1; state.winnerIds.push(p.userId); } });
      state.phase='finished'; state.finishReason='roulette_end_board'; state.finishedAt=Date.now(); state.turnToken=null;
      break;
    }
    case 'points_take':
    case 'points_loss': break; // La persistencia de puntos del campeonato se resuelve en el socket/servicio.
  }
  // La llegada por ruleta debe premiarse en ESTE turno, antes de avanzar
  // el fixture. Se revisan también los intercambios con un rival.
  if (state.phase !== 'finished') {
    recordFinishAtGoal(state, player);
    if (target) recordFinishAtGoal(state, target);
  }
  const result={ type:effect.type, amount:effect.amount??null, targetUserId:target?.userId??null, ownerUserId:player.userId, from:before, to:player.position };
  state.pendingRoulette={ ...state.pendingRoulette, status:'resolved', result };
  state.lastActionAt=Date.now();
  return result;
}

function currentPlayer(state) {
  return state.players[state.turnIndex];
}

function assertTurnOwner(state, userId, turnToken) {
  const player = currentPlayer(state);
  if (!player || Number(player.userId) !== Number(userId)) throw new Error('No es tu turno.');
  if (!turnToken || state.turnToken !== turnToken) throw new Error('El turno cambió. Actualizá el estado de la partida.');
  return player;
}

function rollDice(state, userId, turnToken) {
  const player = assertTurnOwner(state, userId, turnToken);
  if (state.phase !== 'roll') throw new Error('Ahora no se puede tirar el dado.');
  if (!player.active || player.finishOrder != null) throw new Error('Este jugador ya no puede realizar movimientos.');

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

  const surprise = state.surprises[to] || null;
  state.pendingSurprise = surprise;
  const now = Date.now();
  state.pendingVideo = {
    destination: to,
    special: !!surprise,
    ownerUserId: player.userId,
    turnToken: state.turnToken,
    // El último casillero usa winner.mp4 a 1.3x. Le damos un margen mayor
    // para garantizar que el clip pueda terminar antes de abrir la pregunta.
    deadline: now + (to === state.boardSize ? 30000 : 9500)
  };
  state.phase = 'video_pending';
  state.lastActionAt = now;
  return { from, to, surprise: state.pendingSurprise, provisional: true, video: state.pendingVideo };
}

function completeCellVideo(state, expectedTurnToken = null) {
  if (state.phase !== 'video_pending' || !state.pendingVideo) throw new Error('No hay un video de casillero pendiente.');
  if (expectedTurnToken && state.pendingVideo.turnToken !== expectedTurnToken) throw new Error('El video pertenece a un turno anterior.');
  state.pendingVideo = null;
  state.phase = 'question_pending';
  state.lastActionAt = Date.now();
  return state.pendingMove;
}


function specialQuestionCycle(turnNo) {
  return Math.floor((Math.max(1, Number(turnNo) || 1) - 1) / 2);
}

function getSpecialQuestionContext(state) {
  const position = state.pendingMove?.to;
  if (!position || !state.pendingSurprise || !state.surprises?.[position]) return null;

  const cycle = specialQuestionCycle(state.turnNo);
  const slot = state.specialQuestionSlots?.[position];
  return {
    position,
    cycle,
    preferredQuestionId: slot?.cycle === cycle ? slot.questionId || null : null
  };
}

function rememberSpecialQuestion(state, position, cycle, questionId) {
  if (!state.specialQuestionSlots) state.specialQuestionSlots = {};
  state.specialQuestionSlots[position] = {
    cycle,
    questionId: Number(questionId),
    assignedAtTurn: state.turnNo
  };
}

function setQuestion(state, questionPublic) {
  if (state.phase !== 'question_pending') throw new Error('La partida no espera una pregunta.');
  const durationMs = questionPublic.type === 'multiple_choice' ? 10_000 : 20_000;
  const now = Date.now();
  const fromPosition = Number(state.pendingMove?.from ?? currentPlayer(state)?.position ?? 0);
  const provisionalDestination = Number(state.pendingMove?.to ?? fromPosition);
  state.currentQuestion = {
    ...questionPublic,
    issuedAt: now,
    deadline: now + durationMs,
    turnToken: state.turnToken,
    turnNo: state.turnNo,
    roll: Number(state.currentRoll || 0),
    fromPosition,
    provisionalDestination,
    potentialAdvance: Math.max(0, provisionalDestination - fromPosition)
  };
  state.phase = 'answering';
  state.lastActionAt = now;
}

function moveBack(player, amount) {
  player.position = Math.max(0, player.position - amount);
}

function moveForward(state, player, amount) {
  player.position = Math.min(state.boardSize, player.position + amount);
}


function answerQuestion(state, userId, answeredCorrectly, surpriseTargetUserId = null, turnToken) {
  const player = assertTurnOwner(state, userId, turnToken);
  if (state.phase !== 'answering') throw new Error('No hay una pregunta activa.');
  if (state.currentQuestion?.turnToken && state.currentQuestion.turnToken !== turnToken) throw new Error('Esta pregunta pertenece a un turno anterior.');

  if (Date.now() > state.currentQuestion.deadline) answeredCorrectly = false;

  const from = state.pendingMove?.from ?? player.position;
  const to = state.pendingMove?.to ?? player.position;

  if (answeredCorrectly) player.position = to;
  else player.position = from;

  const landedOnSpecial = !!(answeredCorrectly && state.pendingSurprise && state.surprises?.[to]);
  const surpriseResult = { type: landedOnSpecial ? 'roulette' : null, applied: false, polarity: null };

  if (answeredCorrectly) recordFinishAtGoal(state, player);

  state.currentQuestion = null;
  state.pendingVideo = null;
  state.currentRoll = null;
  state.pendingMove = null;
  state.pendingSurprise = null;
  state.pendingRoulette = landedOnSpecial ? { ownerUserId: player.userId, status:'awaiting_move', spinDeadline:null, turnToken:state.turnToken } : null;
  state.phase = 'result_pending';
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

function completeResultPhase(state, expectedTurnToken = null) {
  if (state.phase !== 'result_pending') throw new Error('No hay un resultado pendiente de mostrar.');
  if (expectedTurnToken && state.turnToken !== expectedTurnToken) throw new Error('El resultado pertenece a un turno anterior.');
  state.resultPending = null;
  if (state.pendingRoulette) {
    state.phase = 'roulette_reveal';
    state.pendingRoulette.status = 'awaiting_move';
    state.pendingRoulette.spinDeadline = null;
    state.lastActionAt = Date.now();
    return null;
  }
  state.phase = 'turn_end';
  return nextTurn(state);
}

function armRoulette(state, expectedTurnToken = null) {
  if (state.phase !== 'roulette_reveal' || !state.pendingRoulette) throw new Error('La ruleta todavía no puede activarse.');
  if (expectedTurnToken && state.pendingRoulette.turnToken !== expectedTurnToken) throw new Error('La ruleta pertenece a un turno anterior.');
  const now = Date.now();
  state.pendingRoulette.status = 'waiting';
  state.pendingRoulette.spinDeadline = now + 4000;
  state.phase = 'roulette_wait';
  state.lastActionAt = now;
  return state.pendingRoulette;
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
    state.turnToken = null;
    state.finishReason = state.finishReason || 'completed';
    state.finishedAt = state.finishedAt || Date.now();
    return null;
  }

  let idx = state.turnIndex;
  for (let tries = 0; tries < state.players.length; tries++) {
    idx = (idx + 1) % state.players.length;
    const candidate = state.players[idx];
    if (candidate.active && candidate.finishOrder == null && state.presence?.[String(candidate.userId)]?.connected !== false) {
      state.turnIndex = idx;
      state.turnNo += 1;
      state.turnToken = createTurnToken();
      state.phase = 'roll';
      // IMPORTANTE: no se regeneran las sorpresas. Sus posiciones permanecen
      // exactamente iguales durante toda la partida.
      state.lastActionAt = Date.now();
      return candidate;
    }
  }

  // Todos pueden estar temporalmente desconectados: no se declara campeón
  // hasta que venza su plazo. El primer usuario que regrese reanuda el turno.
  state.phase='roll';state.turnToken=createTurnToken();state.lastActionAt=Date.now();
  return null;
}

function resumeTurnOnReconnect(state,userId){
  if(state.phase!=='roll')return false;
  const current=state.players[state.turnIndex];
  if(current?.active && current.finishOrder==null && state.presence?.[String(current.userId)]?.connected!==false)return false;
  const index=state.players.findIndex(p=>Number(p.userId)===Number(userId)&&p.active&&p.finishOrder==null);
  if(index<0)return false;
  state.turnIndex=index;state.turnNo+=1;state.turnToken=createTurnToken();state.lastActionAt=Date.now();
  return true;
}

function finishRouletteTurn(state) {
  if (state.phase === 'finished') return;
  if (!state.pendingRoulette || state.pendingRoulette.status !== 'resolved') throw new Error('La ruleta todavía no fue resuelta.');
  state.pendingRoulette = null;
  state.phase = 'turn_end';
  nextTurn(state);
}

module.exports = {
  createInitialState,
  randomizeSurprises,
  currentPlayer,
  assertTurnOwner,
  rollDice,
  prepareMovement,
  completeCellVideo,
  applyMovement: prepareMovement,
  specialQuestionCycle,
  rouletteOptions, beginRoulette, rouletteNeedsTarget, eligibleRouletteTargets, applyRouletteEffect, finishRouletteTurn,
  getSpecialQuestionContext,
  rememberSpecialQuestion,
  setQuestion,
  answerQuestion,
  completeResultPhase, armRoulette,
  nextTurn, resumeTurnOnReconnect,
  pendingAbsences,
  hasPendingAbsence,
  forfeitPlayer
};
