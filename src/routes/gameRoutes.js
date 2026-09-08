const express = require('express');
const { Game, Team, User, GameChatMessage, Match } = require('../models');
const auth = require('../middleware/auth');
const { roomCode } = require('../utils/random');
const { createInitialState } = require('../services/gameEngine');
const { validateBoardSize } = require('../services/tournamentService');
const { normalizeMode } = require('../services/questionTiers');
const { withLockedGame } = require('../services/gameStore');

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
    const player = await playerFor(req.user.id);
    const code = await uniqueRoomCode();
    const state = {
      boardSize,
      phase: 'lobby',
      players: [player],
      organizerId: req.user.id,
      settings: { questionMode: normalizeMode(req.body.questionMode) }
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
    const player = await playerFor(req.user.id);
    const saved = await withLockedGame(game.id, state => {
      if (game.status !== 'lobby' || state.phase !== 'lobby') throw new Error('La partida ya comenzó.');
      if (state.players.some(p => p.userId === req.user.id)) return;
      if (state.players.length >= 8) throw new Error('La sala está completa.');
      state.players.push(player);
    });
    res.json(saved.game);
  } catch (e) { next(e); }
});

router.post('/:id/start', async (req, res, next) => {
  try {
    const saved = await withLockedGame(Number(req.params.id), (state, game) => {
      if (state.organizerId !== req.user.id) throw new Error('Solo el organizador puede iniciar la partida.');
      if (game.status !== 'lobby') throw new Error('La partida ya fue iniciada.');
      if (state.players.length < 2) throw new Error('Se necesitan al menos 2 jugadores.');
      const initialized = createInitialState({ boardSize: game.boardSize, players: state.players, settings: state.settings || {} });
      Object.keys(state).forEach(k => delete state[k]);
      Object.assign(state, initialized, { organizerId: req.user.id });
      game.status = 'running';
    });
    if (saved.game.matchId) await Match.update({ status: 'running' }, { where: { id: saved.game.matchId } });
    res.json(saved.game);
  } catch (e) { next(e); }
});

router.get('/room/:code', async (req, res, next) => {
  try {
    const game = await Game.findOne({ where: { roomCode: req.params.code.toUpperCase() } });
    if (!game) return res.status(404).json({ error: 'Sala inexistente.' });
    res.json(game);
  } catch (e) { next(e); }
});

router.get('/:id/chat', async (req, res, next) => {
  try {
    const game = await Game.findByPk(Number(req.params.id));
    if (!game) return res.status(404).json({ error: 'Partida inexistente.' });
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
