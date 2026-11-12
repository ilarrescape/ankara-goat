const express = require('express');
const { Op } = require('sequelize');
const { sequelize, Game, Team, User, GameChatMessage, Match } = require('../models');
const auth = require('../middleware/auth');
const { roomCode } = require('../utils/random');
const { createInitialState } = require('../services/gameEngine');
const { validateBoardSize } = require('../services/tournamentService');
const { normalizeMode } = require('../services/questionTiers');
const { withLockedGame } = require('../services/gameStore');
const { ensureShareCode } = require('../services/publicShareService');
const {prepareAttendance} = require('../services/matchAttendancePolicy');
const {schedulePlayerAbsenceTimeout} = require('../services/timerService');
const {ensureFriendlyMembership}=require('../services/federationFriendlies');

const router = express.Router();
router.use(auth);

async function uniqueRoomCode() {
  for (let i = 0; i < 10; i++) {
    const code = roomCode();
    if (!(await Game.findOne({ where: { roomCode: code } }))) return code;
  }
  throw new Error('No se pudo generar un código de sala.');
}

async function playerFor(userId) {
  const user = await User.findByPk(userId, { attributes: ['id','username','eloRating','level'], include: [Team] });
  if (!user) throw new Error('Usuario inexistente.');
  return { userId: user.id, username: user.username, eloRating: user.eloRating, level: user.level, team: user.Team ? {
    id: user.Team.id, name: user.Team.name, crestEmoji: user.Team.crestEmoji, crestUrl: user.Team.crestUrl,
    primaryColor: user.Team.primaryColor, secondaryColor: user.Team.secondaryColor, shirtPattern: user.Team.shirtPattern
  } : null };
}

router.post('/', async (req, res, next) => {
  try {
    const boardSize = Number(req.body.boardSize || 40);
    validateBoardSize(boardSize);
    const maxPlayers = Number(req.body.maxPlayers ?? 8);
    if(!Number.isInteger(maxPlayers)||maxPlayers<2||maxPlayers>8)throw new Error('La sala admite de 2 a 8 jugadores.');
    const player = await playerFor(req.user.id);
    const code = await uniqueRoomCode();
    const state = {
      boardSize,
      phase: 'lobby',
      players: [player],
      organizerId: req.user.id,
      settings: { questionMode: normalizeMode(req.body.questionMode), maxPlayers, specialCellPercent: Math.max(20, Math.min(35, Number(req.body.specialCellPercent || 25))) }
    };
    const game = await Game.create({
      roomCode: code,
      name: req.body.name || `Partida de ${player.username}`,
      boardSize,
      state,
      status: 'lobby',
      spectatorsAllowed: req.body.spectatorsAllowed !== false,
      tournamentId: req.body.tournamentId || null,
      matchId: req.body.matchId || null
    });
    res.status(201).json(game);
  } catch (e) { next(e); }
});

router.post('/join/:code', async (req, res, next) => {
  try {
    const game = await Game.findOne({ where: { roomCode: req.params.code.toUpperCase() } });
    if (!game) return res.status(404).json({ error: 'Sala inexistente.' });
    await ensureFriendlyMembership(game,req.user.id);
    const player = await playerFor(req.user.id);
    const saved = await withLockedGame(game.id, state => {
      if (game.status !== 'lobby' || state.phase !== 'lobby') throw new Error('La partida ya comenzó.');
      if (state.players.some(p => p.userId === req.user.id)) return;
      if (state.players.length >= Number(state.settings?.maxPlayers||8)) throw new Error('La sala está completa.');
      state.players.push(player);
    });
    res.json(saved.game);
  } catch (e) { next(e); }
});

router.post('/:id/start', async (req, res, next) => {
  try {
    const pendingGame=await Game.findByPk(Number(req.params.id));
    if(pendingGame)await ensureFriendlyMembership(pendingGame,req.user.id);
    const saved = await withLockedGame(Number(req.params.id), (state, game) => {
      if (Number(state.organizerId) !== Number(req.user.id)) throw new Error('Solo el organizador puede iniciar la partida.');
      if (game.status !== 'lobby') throw new Error('La partida ya fue iniciada.');
      if (state.players.length < 2) throw new Error('Se necesitan al menos 2 jugadores.');
      // Los partidos de calendario usan asistencia REAL de la sala, no sólo inscripciones.
      const attendance = game.matchId ? prepareAttendance(state.players,state.presence||{}) : null;
      const initialized = createInitialState({ boardSize: game.boardSize, players: state.players, settings: state.settings || {} });
      Object.keys(state).forEach(k => delete state[k]);
      Object.assign(state, initialized, { organizerId: req.user.id });
      if (attendance) {
        const attending=new Set(attendance.present);
        state.startGraceDeadline=attendance.deadline;
        state.presence=Object.fromEntries(attendance.absent.map(id=>[String(id),{
          connected:false, disconnectedAt:Date.now(),graceDeadline:attendance.deadline,reason:'absent_at_start'
        }]));
        state.turnIndex=state.players.findIndex(p=>attending.has(Number(p.userId)));
      }
      game.status = 'running';
      return {absentUserIds:attendance?.absent||[],deadline:attendance?.deadline||null};
    });
    if (saved.game.matchId) await Match.update({ status: 'running' }, { where: { id: saved.game.matchId } });
    // El plazo se persiste en el estado. El worker también recupera plazos tras reiniciar.
    for(const userId of saved.result.absentUserIds){
      await schedulePlayerAbsenceTimeout({gameId:saved.game.id,userId,deadline:saved.result.deadline})
        .catch(error=>console.error('[initial absence timer]',error));
    }
    res.json(saved.game);
  } catch (e) { next(e); }
});

router.get('/room/:code', async (req, res, next) => {
  try {
    const game = await Game.findOne({ where: { roomCode: req.params.code.toUpperCase() } });
    if (!game) return res.status(404).json({ error: 'Sala inexistente.' });
    await ensureFriendlyMembership(game,req.user.id);
    res.json(game);
  } catch (e) { next(e); }
});


router.get('/mine/active', async (req, res, next) => {
  try {
    const userId = Number(req.user.id);
    const participation = sequelize.literal(`JSON_CONTAINS(\`state\`, '{\"userId\":${userId}}', '$.players') = 1`);
    const rows = await Game.findAll({
      where: { status: { [Op.in]: ['lobby','running'] }, [Op.and]: participation },
      order: [['updatedAt','DESC']],
      limit: 20
    });
    res.json(rows.filter(game => {
      if ((game.state?.archivedByUserIds || []).map(Number).includes(userId)) return false;
      const player = game.state?.players?.find(p => Number(p.userId) === userId);
      if (!player) return false;
      if (game.status === 'running' && (player.active === false || player.forfeitedAt)) return false;
      return true;
    }));
  } catch (e) { next(e); }
});

router.post('/:id/share', async (req, res, next) => {
  try {
    const game = await Game.findByPk(Number(req.params.id));
    if (!game || game.status !== 'finished') return res.status(404).json({ error:'La partida todavía no tiene un resultado público.' });
    const belongs = game.state?.players?.some(player => Number(player.userId) === Number(req.user.id));
    if (!belongs) return res.status(403).json({ error:'No pertenecés a esta partida.' });
    const shareCode = await ensureShareCode(game);
    res.json({ shareCode, path:`/share/match/${shareCode}` });
  } catch (e) { next(e); }
});

router.post('/:id/archive', async (req, res, next) => {
  try {
    const userId = Number(req.user.id);
    const saved = await withLockedGame(Number(req.params.id), (state, game) => {
      if (!state.players?.some(p => Number(p.userId) === userId)) throw new Error('No pertenecés a esta partida.');
      if (!['finished','cancelled'].includes(game.status)) throw new Error('Sólo se puede archivar una partida terminada.');
      state.archivedByUserIds = [...new Set([...(state.archivedByUserIds || []).map(Number), userId])];
    });
    res.json({ ok: true, gameId: saved.game.id });
  } catch (e) { next(e); }
});

router.get('/:id/chat', async (req, res, next) => {
  try {
    const game = await Game.findByPk(Number(req.params.id));
    if (!game) return res.status(404).json({ error: 'Partida inexistente.' });
    await ensureFriendlyMembership(game,req.user.id);
    const rows = await GameChatMessage.findAll({
      where: { gameId: game.id, moderationStatus: 'visible' },
      include: [{ model: User, attributes: ['id','username'] }],
      order: [['createdAt','DESC']],
      limit: 80
    });
    res.json(rows.reverse());
  } catch (e) { next(e); }
});

module.exports = router;
