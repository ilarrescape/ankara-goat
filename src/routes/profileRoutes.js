const express = require('express');
const { User, Team, UserKnowledgeStat, PlayerGameStat, Game } = require('../models');
const auth = require('../middleware/auth');

const router = express.Router();
router.use(auth);

async function profile(userId) {
  const user = await User.findByPk(userId, { attributes: ['id','username','eloRating','xp','level'], include: [Team] });
  if (!user) return null;
  const knowledge = await UserKnowledgeStat.findAll({ where: { userId }, order: [['answered','DESC'],['accuracy','DESC']], limit: 40 });
  const history = await PlayerGameStat.findAll({
    where: { userId },
    include: [{ model: Game, attributes: ['id','name','roomCode','createdAt','tournamentId'] }],
    order: [['createdAt','DESC']],
    limit: 30
  });
  return { user, knowledge, history };
}

router.get('/me', async (req, res, next) => {
  try { res.json(await profile(req.user.id)); } catch (e) { next(e); }
});

router.get('/:userId', async (req, res, next) => {
  try {
    const data = await profile(Number(req.params.userId));
    if (!data) return res.status(404).json({ error: 'Usuario inexistente.' });
    res.json(data);
  } catch (e) { next(e); }
});

router.get('/', (req, res) => res.redirect('/api/profile/me'));

module.exports = router;
