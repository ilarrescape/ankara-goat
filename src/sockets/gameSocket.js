const jwt = require('jsonwebtoken');
const { Game, Question, GameQuestion, GameChatMessage, User } = require('../models');
const { withLockedGame } = require('../services/gameStore');
const engine = require('../services/gameEngine');
const { drawQuestion, isCorrect } = require('../services/questionService');
const { updateKnowledgeForAnswer } = require('../services/knowledgeService');
const { finalizeGameStats } = require('../services/rankingService');
const { recordTournamentGame } = require('../services/tournamentProgressService');
const { startQuestionTimeoutWorker, scheduleQuestionTimeout, cancelQuestionTimeout } = require('../services/timerService');
const { validateChatMessage, assertUserCanChat } = require('../services/contentModeration');

function safeState(state) {
  const copy = JSON.parse(JSON.stringify(state || {}));
  copy.currentQuestion = copy.currentQuestion ? {
    id: copy.currentQuestion.id,
    type: copy.currentQuestion.type,
    deadline: copy.currentQuestion.deadline,
    tier: copy.currentQuestion.tier,
    hidden: true
  } : null;
  copy.surprises = Object.fromEntries(Object.keys(copy.surprises || {}).map(pos => [pos, { mystery: true }]));
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

async function issueQuestion(io, gameId) {
  const drawn = await drawQuestion(gameId);
  const saved = await withLockedGame(gameId, state => engine.setQuestion(state, drawn.public));
  const activeUserId = engine.currentPlayer(saved.state).userId;
  const current = saved.state.currentQuestion;
  io.to(`user:${activeUserId}`).emit('question', {
    ...current,
    tierMode: drawn.mode,
    surpriseAction: ['swap','eliminate'].includes(saved.state.pendingSurprise?.type) ? saved.state.pendingSurprise.type : null
  });
  await loadAndEmitState(io, gameId);
  await scheduleQuestionTimeout({ gameId, userId: activeUserId, questionId: current.id, deadline: current.deadline });
}

async function resolveAnswer(io, gameId, userId, submittedAnswer, targetUserId, timeout = false, expectedQuestionId = null) {
  const game = await Game.findByPk(gameId);
  if (!game || game.status !== 'running') return;
  const state = game.state;
  if (state.phase !== 'answering' || engine.currentPlayer(state)?.userId !== userId) return;
  const questionId = state.currentQuestion?.id;
  if (expectedQuestionId && Number(expectedQuestionId) !== Number(questionId)) return;
  const question = await Question.findByPk(questionId);
  if (!question) throw new Error('Pregunta inexistente.');
  const correct = timeout ? false : isCorrect(question, submittedAnswer);
  const before = JSON.parse(JSON.stringify(state.players));

  const saved = await withLockedGame(gameId, async (lockedState, lockedGame, transaction) => {
    if (lockedState.phase !== 'answering' || engine.currentPlayer(lockedState)?.userId !== userId) return { ignored: true };
    if (expectedQuestionId && Number(lockedState.currentQuestion?.id) !== Number(expectedQuestionId)) return { ignored: true };

    const issuedAt = Number(lockedState.currentQuestion?.issuedAt || Date.now());
    const result = engine.answerQuestion(lockedState, userId, correct, targetUserId ? Number(targetUserId) : null);
    const gq = await GameQuestion.findOne({ where: { gameId, questionId }, transaction, lock: transaction.LOCK.UPDATE });
    if (gq) {
      gq.answeredByUserId = userId;
      gq.answeredCorrectly = result.answeredCorrectly;
      gq.answeredAt = new Date();
      gq.responseTimeMs = Math.max(0, Date.now() - issuedAt);
      await gq.save({ transaction });
    }
    const knowledge = await updateKnowledgeForAnswer({ userId, question, correct: result.answeredCorrectly, transaction });
    engine.nextTurn(lockedState);
    if (lockedState.phase === 'finished') lockedGame.status = 'finished';
    return {
      ...result,
      knowledge: { earnedXp: knowledge.earnedXp, level: knowledge.level, xp: knowledge.xp }
    };
  });

  if (saved.result?.ignored) return;
  await cancelQuestionTimeout(gameId, questionId);
  io.to(`game:${gameId}`).emit('answer_result', {
    questionId,
    userId,
    correct: saved.result.answeredCorrectly,
    movementCommitted: saved.result.movementCommitted,
    attemptedTo: saved.result.attemptedTo,
    finalPosition: saved.result.to,
    correctAnswer: question.correctAnswer,
    tier: question.tier,
    knowledgeArea: question.knowledgeArea || question.competition || question.category || 'General',
    xpEarned: saved.result.knowledge?.earnedXp || 0,
    level: saved.result.knowledge?.level,
    surprise: saved.result.surpriseResult,
    before,
    after: saved.state.players
  });
  await loadAndEmitState(io, gameId);

  if (saved.state.phase === 'finished') {
    const ranking = await finalizeGameStats(gameId).catch(error => {
      console.error('[ranking]', error);
      return null;
    });
    if (ranking) io.to(`game:${gameId}`).emit('ranking_updated', ranking);
    const progress = await recordTournamentGame(gameId).catch(error => { console.error('[tournament progress]', error); return null; });
    if (progress) io.to(`game:${gameId}`).emit('tournament_updated', progress);
  }
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

async function canWatch(gameId, userId) {
  const game = await Game.findByPk(gameId);
  if (!game) throw new Error('Partida inexistente.');
  const isPlayer = game.state?.players?.some(p => p.userId === userId);
  if (!isPlayer && !game.spectatorsAllowed) throw new Error('Esta partida no admite espectadores.');
  return { game, isPlayer };
}

function gameSocket(io) {
  startQuestionTimeoutWorker(({ gameId, userId, questionId }) => resolveAnswer(io, Number(gameId), Number(userId), null, null, true, Number(questionId)));
  recoverPendingQuestionTimeouts().catch(error => console.error('[timer recovery]', error));

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      const dbUser = await User.findByPk(socket.user.id, { attributes: ['id','username','role','accountStatus'] });
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
        if (!game || !game.state.players?.some(p => p.userId === socket.user.id)) throw new Error('No pertenecés a esta partida.');
        socket.join(`game:${game.id}`);
        socket.data.gameId = game.id;
        socket.data.spectator = false;
        ack({ ok: true, recovered: socket.recovered === true });
        await loadAndEmitState(io, game.id);
        if (game.state.phase === 'answering' && engine.currentPlayer(game.state)?.userId === socket.user.id) {
          socket.emit('question', {
            ...game.state.currentQuestion,
            recovered: true,
            surpriseAction: ['swap','eliminate'].includes(game.state.pendingSurprise?.type) ? game.state.pendingSurprise.type : null
          });
        } else if (game.state.phase === 'surprise_choice' && engine.currentPlayer(game.state)?.userId === socket.user.id) {
          socket.emit('coin_toss_choice_required', { gameId: game.id, recovered: true });
        }
      } catch (e) { ack({ ok: false, error: e.message }); }
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
      } catch (e) { ack({ ok: false, error: e.message }); }
    });

    socket.on('roll_dice', async ({ gameId }, ack = () => {}) => {
      try {
        const saved = await withLockedGame(Number(gameId), state => {
          const roll = engine.rollDice(state, socket.user.id);
          const movement = engine.prepareMovement(state);
          return { roll, movement };
        });
        io.to(`game:${gameId}`).emit('dice_result', { userId: socket.user.id, ...saved.result });
        await loadAndEmitState(io, Number(gameId));
        if (saved.state.phase === 'question_pending') await issueQuestion(io, Number(gameId));
        else if (saved.state.phase === 'surprise_choice') socket.emit('coin_toss_choice_required', { gameId: Number(gameId) });
        ack({ ok: true });
      } catch (e) { ack({ ok: false, error: e.message }); }
    });

    socket.on('coin_toss_choice', async ({ gameId, targetUserId, amount }, ack = () => {}) => {
      try {
        await withLockedGame(Number(gameId), state => {
          engine.chooseCoinToss(state, socket.user.id, Number(targetUserId), Number(amount));
        });
        await loadAndEmitState(io, Number(gameId));
        await issueQuestion(io, Number(gameId));
        ack({ ok: true });
      } catch (e) { ack({ ok: false, error: e.message }); }
    });

    socket.on('submit_answer', async ({ gameId, answer, targetUserId }, ack = () => {}) => {
      try {
        await resolveAnswer(io, Number(gameId), socket.user.id, answer, targetUserId, false);
        ack({ ok: true });
      } catch (e) { ack({ ok: false, error: e.message }); }
    });

    socket.on('chat_message', async ({ gameId, body }, ack = () => {}) => {
      try {
        const id = Number(gameId);
        if (!socket.rooms.has(`game:${id}`)) throw new Error('Primero entrá a la partida.');
        await assertUserCanChat(socket.user.id);
        const clean = validateChatMessage(body);
        const message = await GameChatMessage.create({ gameId: id, userId: socket.user.id, type: 'message', body: clean });
        io.to(`game:${id}`).emit('chat_message', { id: message.id, gameId: id, userId: socket.user.id, username: socket.user.username, body: clean, createdAt: message.createdAt });
        ack({ ok: true });
      } catch (e) { ack({ ok: false, error: e.message }); }
    });

    socket.on('reaction', async ({ gameId, reaction }, ack = () => {}) => {
      try {
        const id = Number(gameId);
        if (!socket.rooms.has(`game:${id}`)) throw new Error('Primero entrá a la partida.');
        const allowed = ['⚽','🐐','🔥','😂','👏','😱','🟥','🟨'];
        if (!allowed.includes(reaction)) throw new Error('Reacción inválida.');
        const row = await GameChatMessage.create({ gameId: id, userId: socket.user.id, type: 'reaction', reaction });
        io.to(`game:${id}`).emit('reaction', { id: row.id, userId: socket.user.id, username: socket.user.username, reaction, createdAt: row.createdAt });
        ack({ ok: true });
      } catch (e) { ack({ ok: false, error: e.message }); }
    });

    socket.on('disconnect', () => {
      if (socket.data?.gameId) loadAndEmitState(io, socket.data.gameId).catch(() => {});
    });
  });
}

module.exports = gameSocket;
