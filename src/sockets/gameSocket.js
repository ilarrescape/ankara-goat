const jwt = require('jsonwebtoken');
const { Game, Question, GameQuestion, GameChatMessage, User, RouletteEvent, TournamentParticipant,Tournament } = require('../models');
const { withLockedGame } = require('../services/gameStore');
const engine = require('../services/gameEngine');
const { drawQuestion, isCorrect } = require('../services/questionService');
const { updateKnowledgeForAnswer } = require('../services/knowledgeService');
const { finalizeGameStats } = require('../services/rankingService');
const {refreshAchievementsForGame,recordFederationEvent}=require('../services/federationService');
const { recordTournamentGame } = require('../services/tournamentProgressService');
const {
  startQuestionTimeoutWorker, scheduleQuestionTimeout, cancelQuestionTimeout,
  startResultRevealTimeoutWorker, scheduleResultRevealTimeout, cancelResultRevealTimeout,
  startPlayerAbsenceTimeoutWorker, schedulePlayerAbsenceTimeout, cancelPlayerAbsenceTimeout,
  startRouletteTimeoutWorker, scheduleRouletteTimeout, cancelRouletteTimeout,
  startCellVideoTimeoutWorker, scheduleCellVideoTimeout, cancelCellVideoTimeout
} = require('../services/timerService');
const { validateChatMessage, assertUserCanChat } = require('../services/contentModeration');
const { ensureFriendlyMembership } = require('../services/federationFriendlies');

const PLAYER_RECONNECT_GRACE_MS = 60_000;
const RESULT_DISPLAY_MS = 7_000;

function safeState(state) {
  const copy = JSON.parse(JSON.stringify(state || {}));

  copy.currentQuestion = copy.currentQuestion ? {
    id: copy.currentQuestion.id,
    type: copy.currentQuestion.type,
    prompt: copy.currentQuestion.prompt,
    options: copy.currentQuestion.options,
    deadline: copy.currentQuestion.deadline,
    tier: copy.currentQuestion.tier,
    difficulty: copy.currentQuestion.difficulty,
    turnToken: copy.currentQuestion.turnToken,
    turnNo: copy.currentQuestion.turnNo
  } : null;

  // El cliente conoce las posiciones de los ítems, pero no su efecto antes de caer.
  copy.surprises = Object.fromEntries(
    Object.keys(copy.surprises || {}).map(pos => [pos, { mystery: true }])
  );

  // Nunca filtrar IDs de preguntas preasignadas al navegador.
  copy.specialQuestionSlots = Object.fromEntries(
    Object.entries(copy.specialQuestionSlots || {}).map(([pos, slot]) => [pos, {
      cycle: slot.cycle,
      assignedAtTurn: slot.assignedAtTurn
    }])
  );

  if (copy.phase === 'result_pending' && copy.resultPending?.beforePlayers) {
    copy.players = copy.resultPending.beforePlayers;
  }
  if (copy.resultPending) {
    copy.resultPending = {
      userId: copy.resultPending.userId,
      turnToken: copy.resultPending.turnToken,
      deadline: copy.resultPending.deadline
    };
  }
  if (copy.pendingRoulette) {
    const pr = copy.pendingRoulette;
    copy.pendingRoulette = {
      ownerUserId: pr.ownerUserId, status: pr.status, spinDeadline: pr.spinDeadline || null,
      startedAt: pr.startedAt || null, revealAt: pr.revealAt || null,
      effect: ['target','resolved'].includes(pr.status) ? pr.effect : undefined
    };
  }

  return copy;
}

async function spectatorCount(io, gameId) {
  const sockets = await io.in(`spectators:${gameId}`).fetchSockets();
  return sockets.length;
}

async function loadAndEmitState(io, gameId) {
  const game = await Game.findByPk(gameId);
  if (!game) return;

  io.to(`game:${gameId}`).emit('game_state', {
    gameId,
    status: game.status,
    state: safeState(game.state),
    roomCode: game.roomCode,
    name: game.name,
    spectatorCount: await spectatorCount(io, gameId)
  });
}

function assertActionSocket(socket, gameId) {
  const id = Number(gameId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Partida inválida.');
  if (socket.data?.spectator) throw new Error('Los espectadores no pueden realizar movimientos.');
  if (Number(socket.data?.gameId) !== id || !socket.rooms.has(`game:${id}`)) {
    throw new Error('Primero entrá a la partida antes de realizar una acción.');
  }
  return id;
}


function publicSurpriseForQuestion(state) { return state?.pendingSurprise ? { hidden:true, type:'roulette' } : null; }

async function hasLiveGameSocket(io, gameId, userId) {
  const sockets = await io.in(`user:${userId}`).fetchSockets();
  return sockets.some(s => Number(s.data?.gameId) === Number(gameId) && s.data?.spectator !== true);
}

async function finalizeFinishedGame(io, gameId) {
  const ranking = await finalizeGameStats(gameId).catch(error => {
    console.error('[ranking]', error);
    return null;
  });
  if (ranking) io.to(`game:${gameId}`).emit('ranking_updated', ranking);

  const progress = await recordTournamentGame(gameId).catch(error => {
    console.error('[tournament progress]', error);
    return null;
  });
  if (progress) io.to(`game:${gameId}`).emit('tournament_updated', progress);
  if(progress?.tournamentId){
    const tournament=await Tournament.findByPk(progress.tournamentId).catch(()=>null);
    if(tournament?.federationId){
      const finished=tournament.status==='finished';
      await recordFederationEvent(tournament.federationId,finished?'champion':'result',
        finished?`Terminó el torneo ${tournament.name}. ¡Tenemos campeón!`:`Se registró un resultado de ${tournament.name}.`,
        null,{tournamentId:tournament.id,gameId}).catch(error=>console.error('[federation feed]',error));
    }
  }
  await refreshAchievementsForGame(gameId).catch(error=>console.error('[achievements]',error));
  return { ranking, progress };
}

async function markPlayerConnected(io, gameId, userId) {
  let rejoined = false;
  const saved = await withLockedGame(gameId, (state, game) => {
    const player = state.players?.find(p => Number(p.userId) === Number(userId));
    if (!player) throw new Error('No pertenecés a esta partida.');
    state.presence = state.presence || {};
    const presence = state.presence[String(userId)];
    if (game.status === 'running' && (!player.active || player.forfeitedAt)) {
      throw new Error('Ya perdiste esta partida por abandono.');
    }
    if(game.status === 'lobby'){
      state.presence[String(userId)]={connected:true,joinedAt:Date.now()};
      return;
    }
    if (game.status === 'running' && player.active && presence?.connected === false) {
      if (Number(presence.graceDeadline) <= Date.now()) throw new Error('El minuto para volver a entrar ya venció.');
      delete state.presence[String(userId)];
      engine.resumeTurnOnReconnect(state,userId);
      rejoined = true;
    }
  });
  await cancelPlayerAbsenceTimeout(gameId, userId).catch(() => {});
  if (rejoined) {
    io.to(`game:${gameId}`).emit('player_reconnected', { gameId: Number(gameId), userId: Number(userId) });
  }
  return { ...saved, rejoined };
}

async function markPlayerAway(io, gameId, userId, reason = 'disconnect') {
  let absence = null;
  let cancelledQuestionId=null;
  const saved = await withLockedGame(gameId, (state, game) => {
    if(game.status==='lobby'){
      state.presence=state.presence||{};
      state.presence[String(userId)]={connected:false,disconnectedAt:Date.now()};
      return;
    }
    if (game.status !== 'running') return;
    const player = state.players?.find(p => Number(p.userId) === Number(userId));
    if (!player || !player.active || player.finishOrder != null || player.forfeitedAt) return;
    state.presence = state.presence || {};
    const key = String(userId);
    const existing = state.presence[key];
    if (existing?.connected === false) {
      absence = existing;
      return;
    }
    const now = Date.now();
    absence = {
      connected: false,
      disconnectedAt: now,
      graceDeadline: now + PLAYER_RECONNECT_GRACE_MS,
      reason
    };
    state.presence[key] = absence;
    // En tableros multijugador se continúa sin esperar al ausente:
    // la pregunta/ruleta de su turno no debe bloquear a los presentes.
    const current=state.players?.[state.turnIndex];
    if(state.players?.length>2 && Number(current?.userId)===Number(userId) && state.phase!=='finished'){
      cancelledQuestionId=Number(state.currentQuestion?.id||0)||null;
      state.currentQuestion=null;state.currentRoll=null;state.pendingMove=null;
      state.pendingVideo=null;state.pendingSurprise=null;state.pendingRoulette=null;
      state.resultPending=null;state.phase='turn_end';engine.nextTurn(state);
    }
  });
  if (!absence){if(saved.game.status==='lobby')await loadAndEmitState(io,gameId);return null;}
  if(cancelledQuestionId)await cancelQuestionTimeout(gameId,cancelledQuestionId).catch(()=>{});
  await schedulePlayerAbsenceTimeout({ gameId, userId, deadline: absence.graceDeadline });
  const player = saved.state.players?.find(p => Number(p.userId) === Number(userId));
  io.to(`game:${gameId}`).emit('player_disconnected', {
    gameId: Number(gameId), userId: Number(userId), username: player?.username || 'Jugador', deadline: absence.graceDeadline
  });
  await loadAndEmitState(io, gameId);
  return absence;
}

async function handlePlayerAbsenceTimeout(io, { gameId, userId, deadline }) {
  const id = Number(gameId);
  const uid = Number(userId);
  if (await hasLiveGameSocket(io, id, uid)) {
    await markPlayerConnected(io, id, uid).catch(() => {});
    await loadAndEmitState(io, id).catch(() => {});
    return;
  }

  const saved = await withLockedGame(id, (state, game) => {
    if (game.status !== 'running') return { ignored: true };
    const presence = state.presence?.[String(uid)];
    if (!presence || presence.connected !== false) return { ignored: true };
    if (Number(deadline) && Number(presence.graceDeadline) !== Number(deadline)) return { ignored: true };
    if (Number(presence.graceDeadline) > Date.now()) return { rescheduleAt: Number(presence.graceDeadline) };
    const result = engine.forfeitPlayer(state, uid, 'disconnect_timeout');
    if (result.finished) game.status = 'finished';
    return result;
  });

  if (saved.result?.rescheduleAt) {
    await schedulePlayerAbsenceTimeout({ gameId: id, userId: uid, deadline: saved.result.rescheduleAt });
    return;
  }
  if (!saved.result?.forfeited) return;

  if (saved.result.cancelledQuestionId) {
    await cancelQuestionTimeout(id, saved.result.cancelledQuestionId).catch(() => {});
  }

  io.to(`game:${id}`).emit('player_forfeited', {
    gameId: id,
    userId: uid,
    winnerUserId: saved.result.winnerUserId || null,
    finished: !!saved.result.finished
  });
  io.to(`user:${uid}`).emit('forfeit_loss', { gameId: id, message: 'No volviste a la partida dentro de 60 segundos. La partida se dio por perdida.' });
  if (saved.result.winnerUserId) {
    io.to(`user:${saved.result.winnerUserId}`).emit('forfeit_win', { gameId: id, loserUserId: uid });
  }

  await loadAndEmitState(io, id);
  if (saved.result.finished) await finalizeFinishedGame(io, id);
}

async function recoverPendingAbsenceTimeouts() {
  const games = await Game.findAll({ where: { status: 'running' } });
  let recovered = 0;
  for (const game of games) {
    for (const [userId, presence] of Object.entries(game.state?.presence || {})) {
      if (presence?.connected !== false || !presence?.graceDeadline) continue;
      await schedulePlayerAbsenceTimeout({ gameId: game.id, userId: Number(userId), deadline: Number(presence.graceDeadline) });
      recovered += 1;
    }
  }
  if (recovered) console.log(`[presence] ${recovered} plazo(s) de reconexión recuperado(s).`);
}


async function finishCellVideoPrelude(io, gameId, turnToken, userId = null) {
  const saved = await withLockedGame(Number(gameId), state => {
    if (state.phase !== 'video_pending' || !state.pendingVideo) return { ignored:true };
    if (turnToken && state.pendingVideo.turnToken !== turnToken) return { ignored:true };
    const owner = Number(state.pendingVideo.ownerUserId || engine.currentPlayer(state)?.userId || 0);
    if (userId && owner !== Number(userId)) throw new Error('Sólo el jugador del turno puede confirmar el video.');
    const token = state.pendingVideo.turnToken;
    engine.completeCellVideo(state, token);
    return { ignored:false, turnToken:token };
  });
  if (saved.result?.ignored) return saved.result;
  await cancelCellVideoTimeout(Number(gameId), saved.result.turnToken).catch(() => {});
  await loadAndEmitState(io, Number(gameId));
  await issueQuestion(io, Number(gameId));
  return saved.result;
}

async function recoverPendingCellVideos() {
  const games = await Game.findAll({ where:{ status:'running' } });
  let recovered = 0;
  for (const game of games) {
    const pending = game.state?.pendingVideo;
    if (game.state?.phase !== 'video_pending' || !pending?.turnToken || !pending?.deadline) continue;
    await scheduleCellVideoTimeout({ gameId:game.id, turnToken:pending.turnToken, deadline:pending.deadline });
    recovered += 1;
  }
  if (recovered) console.log(`[cell video] ${recovered} espera(s) recuperada(s).`);
}

async function issueQuestion(io, gameId) {
  const snapshot = await Game.findByPk(gameId);
  if (!snapshot || snapshot.status !== 'running') throw new Error('La partida no está activa.');

  const snapshotState = snapshot.state || {};
  if (snapshotState.phase !== 'question_pending') throw new Error('La partida no está esperando una pregunta.');

  const expectedTurnToken = snapshotState.turnToken;
  const context = engine.getSpecialQuestionContext(snapshotState);
  const drawn = await drawQuestion(gameId, {
    preferredQuestionId: context?.preferredQuestionId || null
  });

  const saved = await withLockedGame(gameId, state => {
    if (state.phase !== 'question_pending') throw new Error('La fase cambió antes de cargar la pregunta.');
    if (state.turnToken !== expectedTurnToken) throw new Error('El turno cambió antes de cargar la pregunta.');

    const liveContext = engine.getSpecialQuestionContext(state);
    if (context && (!liveContext || liveContext.position !== context.position || liveContext.cycle !== context.cycle)) {
      throw new Error('El ítem especial cambió de contexto antes de cargar la pregunta.');
    }

    if (liveContext) {
      engine.rememberSpecialQuestion(state, liveContext.position, liveContext.cycle, drawn.model.id);
    }

    engine.setQuestion(state, drawn.public);
  });

  const activeUserId = engine.currentPlayer(saved.state).userId;
  const current = saved.state.currentQuestion;

  io.to(`game:${gameId}`).emit('question', {
    ...current,
    activeUserId,
    turnToken: saved.state.turnToken,
    tierMode: drawn.mode,
    specialPosition: context?.position || null,
    specialQuestionCycle: context?.cycle ?? null,
    surprise: publicSurpriseForQuestion(saved.state)
  });

  await loadAndEmitState(io, gameId);
  await scheduleQuestionTimeout({
    gameId,
    userId: activeUserId,
    questionId: current.id,
    deadline: current.deadline
  });
}

async function resolveAnswer(
  io,
  gameId,
  userId,
  submittedAnswer,
  targetUserId,
  timeout = false,
  expectedQuestionId = null,
  turnToken = null
) {
  const game = await Game.findByPk(gameId);
  if (!game) throw new Error('Partida inexistente.');
  if (game.status !== 'running') throw new Error('La partida no está activa.');

  const state = game.state || {};
  if (state.phase !== 'answering') throw new Error('No hay una pregunta activa.');
  if (Number(engine.currentPlayer(state)?.userId) !== Number(userId)) throw new Error('No es tu pregunta.');

  const questionId = Number(state.currentQuestion?.id);
  if (!questionId) throw new Error('La pregunta activa es inválida.');
  if (expectedQuestionId && Number(expectedQuestionId) !== questionId) throw new Error('La pregunta ya cambió.');
  if (!timeout && (!turnToken || state.turnToken !== turnToken)) throw new Error('El turno cambió. La respuesta fue descartada.');

  const drawnSnapshot=await GameQuestion.findOne({where:{gameId,questionId},attributes:['questionSnapshot']});
  const question = drawnSnapshot?.questionSnapshot || await Question.findByPk(questionId);
  if (!question) throw new Error('Pregunta inexistente.');
  const correct = timeout ? false : isCorrect(question, submittedAnswer);

  const saved = await withLockedGame(gameId, async (lockedState, lockedGame, transaction) => {
    if (lockedGame.status !== 'running') throw new Error('La partida ya no está activa.');
    if (lockedState.phase !== 'answering') throw new Error('La pregunta ya fue resuelta.');
    if (Number(engine.currentPlayer(lockedState)?.userId) !== Number(userId)) throw new Error('El turno ya cambió.');
    if (Number(lockedState.currentQuestion?.id) !== questionId) throw new Error('La pregunta ya cambió.');

    const effectiveTurnToken = timeout ? lockedState.turnToken : turnToken;
    if (!effectiveTurnToken || lockedState.turnToken !== effectiveTurnToken) throw new Error('El turno ya cambió.');

    const resolvedTurnToken = lockedState.turnToken;
    const resolvedTurnNo = lockedState.turnNo;
    const issuedAt = Number(lockedState.currentQuestion?.issuedAt || Date.now());
    const beforePlayers = JSON.parse(JSON.stringify(lockedState.players));

    const result = engine.answerQuestion(
      lockedState,
      userId,
      correct,
      targetUserId ? Number(targetUserId) : null,
      effectiveTurnToken
    );
    const afterPlayers = JSON.parse(JSON.stringify(lockedState.players));

    const gq = await GameQuestion.findOne({
      where: { gameId, questionId }, transaction, lock: transaction.LOCK.UPDATE
    });
    if (gq) {
      gq.answeredByUserId = userId;
      gq.answeredCorrectly = result.answeredCorrectly;
      gq.answeredAt = new Date();
      gq.responseTimeMs = Math.max(0, Date.now() - issuedAt);
      await gq.save({ transaction });
    }
    await Question.increment(
      result.answeredCorrectly ? { answerCount: 1, correctCount: 1 } : { answerCount: 1 },
      { where: { id: questionId }, transaction }
    );

    const knowledge = await updateKnowledgeForAnswer({
      userId, question, correct: result.answeredCorrectly, transaction
    });

    const deadline = Date.now() + RESULT_DISPLAY_MS;
    const notice = {
      questionId,
      userId,
      turnToken: resolvedTurnToken,
      turnNo: resolvedTurnNo,
      correct: result.answeredCorrectly,
      movementCommitted: result.movementCommitted,
      from: result.from,
      attemptedTo: result.attemptedTo,
      finalPosition: result.to,
      correctAnswer: question.correctAnswer,
      tier: question.tier,
      knowledgeArea: question.knowledgeArea || question.competition || question.category || 'General',
      xpEarned: knowledge.earnedXp || 0,
      level: knowledge.level,
      surprise: result.surpriseResult,
      resultDeadline: deadline
    };

    lockedState.resultPending = {
      userId: Number(userId),
      turnToken: resolvedTurnToken,
      deadline,
      beforePlayers,
      notice,
      reveal: { ...notice, before: beforePlayers, after: afterPlayers }
    };

    return { ...result, resolvedTurnToken, resolvedTurnNo, notice, deadline };
  });

  await cancelQuestionTimeout(gameId, questionId);
  io.to(`game:${gameId}`).emit('answer_result', saved.result.notice);
  await loadAndEmitState(io, gameId);
  await scheduleResultRevealTimeout({ gameId, turnToken: saved.result.resolvedTurnToken, deadline: saved.result.deadline });
  return { resolved: true, result: saved.result };
}

async function finalizeResultReveal(io, gameId, turnToken) {
  const saved = await withLockedGame(Number(gameId), (state, game) => {
    if (game.status !== 'running') return { ignored: true };
    if (state.phase !== 'result_pending' || !state.resultPending) return { ignored: true };
    if (turnToken && state.resultPending.turnToken !== turnToken) return { ignored: true };
    const reveal = state.resultPending.reveal;
    const resolvedToken = state.resultPending.turnToken;
    engine.completeResultPhase(state, resolvedToken);
    if (state.phase === 'finished') game.status = 'finished';
    return { reveal, resolvedToken, finished: state.phase === 'finished' };
  });
  if (saved.result?.ignored) return { ignored: true };
  await cancelResultRevealTimeout(Number(gameId), saved.result.resolvedToken).catch(() => {});
  io.to(`game:${gameId}`).emit('movement_reveal', saved.result.reveal);
  await loadAndEmitState(io, Number(gameId));
  if (saved.state?.phase === 'roulette_reveal' && saved.state.pendingRoulette) {
    const pending=saved.state.pendingRoulette;
    await scheduleRouletteTimeout({ gameId:Number(gameId), turnToken:pending.turnToken, action:'arm', deadline:Date.now()+6000 });
  }
  if (saved.result.finished) await finalizeFinishedGame(io, Number(gameId));
  return saved.result;
}

async function persistRouletteSideEffects({ game, state, result, transaction }) {
  const effect = result?.type;
  if (!effect) return;
  if (game.tournamentId && ['points_take','points_loss'].includes(effect)) {
    const affectedUserId = effect === 'points_take' ? result.targetUserId : result.ownerUserId;
    const row = await TournamentParticipant.findOne({ where:{ tournamentId:game.tournamentId, userId:affectedUserId }, transaction, lock:transaction.LOCK.UPDATE });
    if (row) { row.points = Number(row.points || 0) - 5; await row.save({ transaction }); }
  }
  await RouletteEvent.create({
    gameId:game.id, userId:result.ownerUserId, targetUserId:result.targetUserId || null,
    effect, amount:result.amount ?? null, turnNo:Number(state.turnNo || 1),
    metadata:{ tournamentId:game.tournamentId || null, matchId:game.matchId || null }
  }, { transaction });
}

async function armRouletteAfterMovement(io, gameId, requestedByUserId = null, turnToken = null) {
  const saved = await withLockedGame(Number(gameId), (state, game) => {
    if (game.status !== 'running' || state.phase !== 'roulette_reveal' || !state.pendingRoulette) return { ignored:true };
    const owner=Number(state.pendingRoulette.ownerUserId||0);
    if (requestedByUserId && owner !== Number(requestedByUserId)) throw new Error('Sólo el jugador del turno puede habilitar la ruleta.');
    if (turnToken && state.pendingRoulette.turnToken !== turnToken) throw new Error('La ruleta pertenece a un turno anterior.');
    const pending=engine.armRoulette(state,state.pendingRoulette.turnToken);
    return {ignored:false,pending};
  });
  if(saved.result?.ignored)return saved.result;
  const p=saved.result.pending;
  await cancelRouletteTimeout(gameId,p.turnToken,'arm').catch(()=>{});
  io.to(`game:${gameId}`).emit('roulette_ready',{gameId:Number(gameId),ownerUserId:p.ownerUserId,spinDeadline:p.spinDeadline,turnToken:p.turnToken});
  await scheduleRouletteTimeout({gameId:Number(gameId),turnToken:p.turnToken,action:'auto_spin',deadline:p.spinDeadline});
  await loadAndEmitState(io,Number(gameId));
  return p;
}

async function startRouletteSpin(io, gameId, requestedByUserId = null, turnToken = null) {
  const saved = await withLockedGame(Number(gameId), (state, game) => {
    if (game.status !== 'running' || state.phase !== 'roulette_wait') return { ignored:true };
    const owner=Number(state.pendingRoulette?.ownerUserId || 0);
    if (requestedByUserId && owner !== Number(requestedByUserId)) throw new Error('Sólo el jugador del turno puede girar la ruleta.');
    if (turnToken && state.pendingRoulette?.turnToken !== turnToken) throw new Error('La ruleta pertenece a un turno anterior.');
    const pending=engine.beginRoulette(state, owner, state.pendingRoulette.turnToken);
    return { ignored:false, pending };
  });
  if (saved.result?.ignored) return saved.result;
  const p=saved.result.pending;
  await cancelRouletteTimeout(gameId, p.turnToken, 'auto_spin').catch(()=>{});
  io.to(`game:${gameId}`).emit('roulette_spin', { gameId:Number(gameId), ownerUserId:p.ownerUserId, durationMs:10000, revealAt:p.revealAt, effect:p.effect });
  await scheduleRouletteTimeout({ gameId:Number(gameId), turnToken:p.turnToken, action:'resolve', deadline:p.revealAt });
  await loadAndEmitState(io, Number(gameId));
  return p;
}

async function resolveRouletteSpin(io, gameId, turnToken) {
  const snapshot=await Game.findByPk(Number(gameId));
  if (!snapshot || snapshot.status!=='running' || snapshot.state?.phase!=='roulette_spinning') return {ignored:true};
  if (turnToken && snapshot.state?.pendingRoulette?.turnToken!==turnToken) return {ignored:true};
  const effect=snapshot.state?.pendingRoulette?.effect;
  if (engine.rouletteNeedsTarget(effect)) {
    const saved=await withLockedGame(Number(gameId), state=>{
      if(state.phase!=='roulette_spinning') return {ignored:true};
      state.phase='roulette_target'; state.pendingRoulette.status='target'; state.lastActionAt=Date.now();
      return {ignored:false, effect:state.pendingRoulette.effect, ownerUserId:state.pendingRoulette.ownerUserId, targets:engine.eligibleRouletteTargets(state,state.pendingRoulette.ownerUserId).map(p=>({userId:p.userId,username:p.username,team:p.team}))};
    });
    if(saved.result?.ignored)return saved.result;
    io.to(`game:${gameId}`).emit('roulette_result',{gameId:Number(gameId),effect:saved.result.effect,requiresTarget:true,ownerUserId:saved.result.ownerUserId});
    io.to(`user:${saved.result.ownerUserId}`).emit('roulette_target_required',{gameId:Number(gameId),effect:saved.result.effect,targets:saved.result.targets,turnToken});
    await loadAndEmitState(io,Number(gameId));
    return saved.result;
  }
  const saved=await withLockedGame(Number(gameId),async(state,game,transaction)=>{
    if(state.phase!=='roulette_spinning')return {ignored:true};
    const result=engine.applyRouletteEffect(state);
    await persistRouletteSideEffects({game,state,result,transaction});
    if(state.phase!=='finished')engine.finishRouletteTurn(state); else game.status='finished';
    if(state.phase==='finished')game.status='finished';
    return {ignored:false,result,finished:state.phase==='finished'};
  });
  if(saved.result?.ignored)return saved.result;
  io.to(`game:${gameId}`).emit('roulette_result',{gameId:Number(gameId),effect:saved.result.result,requiresTarget:false});
  await loadAndEmitState(io,Number(gameId));
  if(saved.result.finished)await finalizeFinishedGame(io,Number(gameId));
  return saved.result;
}

async function applyRouletteTarget(io, gameId, userId, targetUserId, turnToken) {
  const saved=await withLockedGame(Number(gameId),async(state,game,transaction)=>{
    if(game.status!=='running'||state.phase!=='roulette_target')throw new Error('La ruleta no espera una selección.');
    if(Number(state.pendingRoulette?.ownerUserId)!==Number(userId))throw new Error('Sólo el jugador del turno puede elegir rival.');
    if(turnToken&&state.pendingRoulette?.turnToken!==turnToken)throw new Error('La ruleta pertenece a un turno anterior.');
    const result=engine.applyRouletteEffect(state,Number(targetUserId));
    await persistRouletteSideEffects({game,state,result,transaction});
    if(state.phase!=='finished')engine.finishRouletteTurn(state); else game.status='finished';
    if(state.phase==='finished')game.status='finished';
    return {result,finished:state.phase==='finished'};
  });
  io.to(`game:${gameId}`).emit('roulette_result',{gameId:Number(gameId),effect:saved.result.result,requiresTarget:false});
  await loadAndEmitState(io,Number(gameId));
  if(saved.result.finished)await finalizeFinishedGame(io,Number(gameId));
  return saved.result;
}

async function handleRouletteTimeout(io,data){
  if(data.action==='arm')return armRouletteAfterMovement(io,Number(data.gameId),null,data.turnToken);
  if(data.action==='auto_spin')return startRouletteSpin(io,Number(data.gameId),null,data.turnToken);
  if(data.action==='resolve')return resolveRouletteSpin(io,Number(data.gameId),data.turnToken);
}

async function recoverPendingRouletteTimeouts(){
  const games=await Game.findAll({where:{status:'running'}}); let recovered=0;
  for(const game of games){const s=game.state||{},p=s.pendingRoulette;if(!p?.turnToken)continue;
    if(s.phase==='roulette_reveal'){await scheduleRouletteTimeout({gameId:game.id,turnToken:p.turnToken,action:'arm',deadline:Date.now()+2000});recovered++;}
    if(s.phase==='roulette_wait'&&p.spinDeadline){await scheduleRouletteTimeout({gameId:game.id,turnToken:p.turnToken,action:'auto_spin',deadline:p.spinDeadline});recovered++;}
    if(s.phase==='roulette_spinning'&&p.revealAt){await scheduleRouletteTimeout({gameId:game.id,turnToken:p.turnToken,action:'resolve',deadline:p.revealAt});recovered++;}
  }
  if(recovered)console.log(`[roulette] ${recovered} temporizador(es) recuperado(s).`);
}

async function recoverPendingQuestionTimeouts() {
  const games = await Game.findAll({ where: { status: 'running' } });
  let recovered = 0;

  for (const game of games) {
    const state = game.state || {};
    if (state.phase !== 'answering' || !state.currentQuestion?.id || !state.currentQuestion?.deadline) continue;

    const active = engine.currentPlayer(state);
    if (!active?.userId) continue;

    await scheduleQuestionTimeout({
      gameId: game.id,
      userId: active.userId,
      questionId: state.currentQuestion.id,
      deadline: state.currentQuestion.deadline
    });
    recovered += 1;
  }

  if (recovered) console.log(`[timers] ${recovered} pregunta(s) pendiente(s) recuperada(s).`);
}

async function recoverPendingResultReveals() {
  const games = await Game.findAll({ where: { status: 'running' } });
  let recovered = 0;
  for (const game of games) {
    const pending = game.state?.resultPending;
    if (game.state?.phase !== 'result_pending' || !pending?.turnToken || !pending?.deadline) continue;
    await scheduleResultRevealTimeout({ gameId: game.id, turnToken: pending.turnToken, deadline: pending.deadline });
    recovered += 1;
  }
  if (recovered) console.log(`[results] ${recovered} resultado(s) pendiente(s) recuperado(s).`);
}

async function canWatch(gameId, userId) {
  const game = await Game.findByPk(gameId);
  if (!game) throw new Error('Partida inexistente.');
  await ensureFriendlyMembership(game,userId);
  const participant = game.state?.players?.find(p => Number(p.userId) === Number(userId));
  const isPlayer = !!participant && game.status !== 'running' ? true : !!participant && participant.active !== false && !participant.forfeitedAt;
  if (!isPlayer && !game.spectatorsAllowed) throw new Error('Esta partida no admite espectadores.');
  return { game, isPlayer };
}

function gameSocket(io) {
  startQuestionTimeoutWorker(({ gameId, userId, questionId }) =>
    resolveAnswer(io, Number(gameId), Number(userId), null, null, true, Number(questionId), null)
      .catch(error => {
        // Una respuesta manual puede ganar la carrera contra el timeout.
        // En ese caso el job viejo se ignora sin afectar al turno siguiente.
        if (!/ya fue resuelta|turno ya cambió|pregunta ya cambió|no está activa/i.test(error.message)) {
          console.error('[question timeout]', error);
        }
      })
  );

  startResultRevealTimeoutWorker(data =>
    finalizeResultReveal(io, Number(data.gameId), data.turnToken).catch(error => console.error('[result reveal timeout]', error))
  );

  startPlayerAbsenceTimeoutWorker(data =>
    handlePlayerAbsenceTimeout(io, data).catch(error => console.error('[player absence timeout]', error))
  );
  startRouletteTimeoutWorker(data =>
    handleRouletteTimeout(io, data).catch(error => console.error('[roulette timeout]', error))
  );
  startCellVideoTimeoutWorker(data =>
    finishCellVideoPrelude(io, Number(data.gameId), data.turnToken, null).catch(error => console.error('[cell video timeout]', error))
  );

  recoverPendingQuestionTimeouts().catch(error => console.error('[timer recovery]', error));
  recoverPendingResultReveals().catch(error => console.error('[result recovery]', error));
  recoverPendingAbsenceTimeouts().catch(error => console.error('[presence recovery]', error));
  recoverPendingRouletteTimeouts().catch(error => console.error('[roulette recovery]', error));
  recoverPendingCellVideos().catch(error => console.error('[cell video recovery]', error));

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      const dbUser = await User.findByPk(socket.user.id, {
        attributes: ['id', 'username', 'role', 'accountStatus']
      });
      if (!dbUser || dbUser.accountStatus === 'suspended') return next(new Error('Cuenta suspendida o inexistente'));
      socket.user = { id: dbUser.id, username: dbUser.username, role: dbUser.role };
      next();
    } catch {
      next(new Error('No autorizado'));
    }
  });

  io.on('connection', socket => {
    socket.join(`user:${socket.user.id}`);
    User.update({ lastSeenAt: new Date() }, { where: { id: socket.user.id } }).catch(() => {});

    socket.on('join_game', async ({ gameId }, ack = () => {}) => {
      try {
        const game = await Game.findByPk(Number(gameId));
        if (!game || !game.state.players?.some(p => Number(p.userId) === Number(socket.user.id))) {
          throw new Error('No pertenecés a esta partida.');
        }

        await ensureFriendlyMembership(game,socket.user.id);
        const connected = await markPlayerConnected(io, game.id, socket.user.id);
        socket.join(`game:${game.id}`);
        socket.data.gameId = game.id;
        socket.data.spectator = false;
        const freshGame = connected.game;
        const freshState = connected.state;
        ack({ ok: true, recovered: socket.recovered === true || connected.rejoined, rejoined: connected.rejoined });
        await loadAndEmitState(io, game.id);

        if (freshGame.status === 'running' && freshState.phase === 'answering') {
          socket.emit('question', {
            ...freshState.currentQuestion,
            activeUserId: engine.currentPlayer(freshState)?.userId,
            turnToken: freshState.turnToken,
            recovered: true,
            surprise: publicSurpriseForQuestion(freshState)
          });
        } else if (freshGame.status === 'running' && ['roulette_wait','roulette_spinning','roulette_target'].includes(freshState.phase)) {
          socket.emit('roulette_state', { gameId:game.id, phase:freshState.phase, pendingRoulette:freshState.pendingRoulette });
          if (freshState.phase === 'roulette_target' && Number(freshState.pendingRoulette?.ownerUserId) === Number(socket.user.id)) {
            socket.emit('roulette_target_required', { gameId:game.id, effect:freshState.pendingRoulette.effect, targets:engine.eligibleRouletteTargets(freshState, socket.user.id).map(p=>({userId:p.userId,username:p.username})), turnToken:freshState.turnToken, ownerUserId:socket.user.id });
          }
        } else if (freshGame.status === 'running' && freshState.phase === 'result_pending' && freshState.resultPending?.notice) {
          socket.emit('answer_result', freshState.resultPending.notice);
        }
      } catch (e) {
        ack({ ok: false, error: e.message });
      }
    });

    socket.on('watch_game', async ({ gameId }, ack = () => {}) => {
      try {
        const { game, isPlayer } = await canWatch(Number(gameId), socket.user.id);
        socket.join(`game:${game.id}`);
        if (!isPlayer) socket.join(`spectators:${game.id}`);
        socket.data.gameId = game.id;
        socket.data.spectator = !isPlayer;
        ack({ ok: true, spectator: !isPlayer });
        await loadAndEmitState(io, game.id);
      } catch (e) {
        ack({ ok: false, error: e.message });
      }
    });

    socket.on('leave_game', async ({ gameId }, ack = () => {}) => {
      try {
        const id = Number(gameId);
        if (!Number.isInteger(id) || id <= 0) throw new Error('Partida inválida.');
        const wasSpectator = socket.data?.spectator === true;
        socket.leave(`game:${id}`);
        socket.leave(`spectators:${id}`);
        socket.data.gameId = null;
        socket.data.spectator = false;

        let absence = null;
        if (!wasSpectator && !(await hasLiveGameSocket(io, id, socket.user.id))) {
          absence = await markPlayerAway(io, id, socket.user.id, 'voluntary_leave');
        }
        ack({ ok: true, graceDeadline: absence?.graceDeadline || null });
      } catch (e) {
        ack({ ok: false, error: e.message });
      }
    });

    socket.on('roll_dice', async ({ gameId, turnToken }, ack = () => {}) => {
      try {
        const id = assertActionSocket(socket, gameId);
        const saved = await withLockedGame(id, (state, game) => {
          if (game.status !== 'running') throw new Error('La partida no está activa.');
          if (state.players?.length===2 && engine.hasPendingAbsence(state)) throw new Error('El rival tiene un minuto para reconectarse.');
          const roll = engine.rollDice(state, socket.user.id, turnToken);
          const movement = engine.prepareMovement(state);
          return { roll, movement, turnToken: state.turnToken, turnNo: state.turnNo };
        });

        io.to(`game:${id}`).emit('dice_result', {
          userId: socket.user.id,
          ...saved.result
        });

        await loadAndEmitState(io, id);

        if (saved.state.phase === 'video_pending' && saved.state.pendingVideo) {
          await scheduleCellVideoTimeout({
            gameId:id,
            turnToken:saved.state.pendingVideo.turnToken,
            deadline:saved.state.pendingVideo.deadline
          });
        }

        ack({ ok: true, roll: saved.result.roll, turnToken: saved.result.turnToken });
      } catch (e) {
        ack({ ok: false, error: e.message });
      }
    });


    socket.on('cell_video_done', async ({ gameId, turnToken }, ack=()=>{}) => {
      try {
        const id = assertActionSocket(socket, gameId);
        await finishCellVideoPrelude(io, id, turnToken, socket.user.id);
        ack({ok:true});
      } catch (e) { ack({ok:false,error:e.message}); }
    });

    socket.on('roulette_movement_complete', async ({ gameId, turnToken }, ack=()=>{}) => {
      try {
        const id=assertActionSocket(socket,gameId);
        await armRouletteAfterMovement(io,id,socket.user.id,turnToken);
        ack({ok:true});
      } catch(e) { ack({ok:false,error:e.message}); }
    });

    socket.on('spin_roulette', async ({ gameId, turnToken }, ack=()=>{}) => {
      try { const id=assertActionSocket(socket,gameId); await startRouletteSpin(io,id,socket.user.id,turnToken); ack({ok:true}); }
      catch(e){ack({ok:false,error:e.message});}
    });

    socket.on('roulette_target', async ({ gameId, targetUserId, turnToken }, ack=()=>{}) => {
      try { const id=assertActionSocket(socket,gameId); await applyRouletteTarget(io,id,socket.user.id,targetUserId,turnToken); ack({ok:true}); }
      catch(e){ack({ok:false,error:e.message});}
    });

    socket.on('submit_answer', async ({ gameId, questionId, answer, targetUserId, turnToken }, ack = () => {}) => {
      try {
        const id = assertActionSocket(socket, gameId);
        const outcome = await resolveAnswer(
          io,
          id,
          socket.user.id,
          answer,
          targetUserId,
          false,
          Number(questionId),
          turnToken
        );
        ack({ ok: true, resolved: outcome.resolved });
      } catch (e) {
        ack({ ok: false, error: e.message });
      }
    });

    socket.on('continue_after_answer', async ({ gameId, turnToken }, ack = () => {}) => {
      try {
        const id = assertActionSocket(socket, gameId);
        const game = await Game.findByPk(id);
        const pending = game?.state?.resultPending;
        if (!game || game.status !== 'running' || game.state?.phase !== 'result_pending' || !pending) throw new Error('No hay un resultado pendiente.');
        if (Number(pending.userId) !== Number(socket.user.id)) throw new Error('Sólo el jugador que respondió puede continuar antes de tiempo.');
        if (!turnToken || pending.turnToken !== turnToken) throw new Error('El resultado pertenece a un turno anterior.');
        await finalizeResultReveal(io, id, turnToken);
        ack({ ok: true });
      } catch (e) { ack({ ok:false, error:e.message }); }
    });

    socket.on('chat_message', async ({ gameId, body }, ack = () => {}) => {
      try {
        const id = Number(gameId);
        if (!socket.rooms.has(`game:${id}`)) throw new Error('Primero entrá a la partida.');
        const liveGame = await Game.findByPk(id, { attributes:['id','status','state'] });
        if (liveGame?.status === 'running' && liveGame.state?.phase === 'answering') throw new Error('El chat está bloqueado mientras hay una pregunta activa.');
        await assertUserCanChat(socket.user.id);
        const clean = validateChatMessage(body);
        const message = await GameChatMessage.create({
          gameId: id,
          userId: socket.user.id,
          type: 'message',
          body: clean
        });
        io.to(`game:${id}`).emit('chat_message', {
          id: message.id,
          gameId: id,
          userId: socket.user.id,
          username: socket.user.username,
          body: clean,
          createdAt: message.createdAt
        });
        ack({ ok: true });
      } catch (e) {
        ack({ ok: false, error: e.message });
      }
    });

    socket.on('reaction', async ({ gameId, reaction }, ack = () => {}) => {
      try {
        const id = Number(gameId);
        if (!socket.rooms.has(`game:${id}`)) throw new Error('Primero entrá a la partida.');
        const allowed = ['⚽', '🐐', '🔥', '😂', '👏', '😱', '🟥', '🟨'];
        if (!allowed.includes(reaction)) throw new Error('Reacción inválida.');

        const row = await GameChatMessage.create({
          gameId: id,
          userId: socket.user.id,
          type: 'reaction',
          reaction
        });

        io.to(`game:${id}`).emit('reaction', {
          id: row.id,
          userId: socket.user.id,
          username: socket.user.username,
          reaction,
          createdAt: row.createdAt
        });
        ack({ ok: true });
      } catch (e) {
        ack({ ok: false, error: e.message });
      }
    });

    socket.on('disconnect', () => {
      const gameId = Number(socket.data?.gameId || 0);
      const userId = Number(socket.user?.id || 0);
      const spectator = socket.data?.spectator === true;
      if (!gameId || !userId || spectator) return;
      setTimeout(async () => {
        try {
          if (await hasLiveGameSocket(io, gameId, userId)) return;
          await markPlayerAway(io, gameId, userId, 'disconnect');
        } catch (error) {
          console.error('[disconnect presence]', error);
        }
      }, 200);
    });
  });
}

module.exports = gameSocket;
