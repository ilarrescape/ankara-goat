const { sequelize, Game, User, GameQuestion, PlayerGameStat, Tournament, Match } = require('../models');
const { sharedBoardPoints } = require('./tournamentService');

function rankingOrder(players) {
  const finishers = players.filter(p => p.finishOrder != null).sort((a,b) => a.finishOrder - b.finishOrder);
  const eliminated = players.filter(p => p.finishOrder == null).sort((a,b) => (b.eliminatedAtTurn || 0) - (a.eliminatedAtTurn || 0));
  return [...finishers, ...eliminated].map((p, i) => ({ ...p, resolvedPosition: i + 1 }));
}

function eloChanges(entries, k = 24) {
  if (entries.length < 2) return new Map(entries.map(e => [e.userId, 0]));
  const changes = new Map();
  for (const me of entries) {
    let expectedTotal = 0;
    let actualTotal = 0;
    for (const other of entries) {
      if (other.userId === me.userId) continue;
      expectedTotal += 1 / (1 + Math.pow(10, (other.rating - me.rating) / 400));
      actualTotal += me.position < other.position ? 1 : me.position === other.position ? 0.5 : 0;
    }
    const opponents = entries.length - 1;
    changes.set(me.userId, Math.round(k * ((actualTotal / opponents) - (expectedTotal / opponents))));
  }
  return changes;
}

async function finalizeGameStats(gameId) {
  return sequelize.transaction(async transaction => {
    const game = await Game.findByPk(gameId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!game || game.status !== 'finished' || game.statsFinalized) return null;

    const ordered = rankingOrder(game.state?.players || []);
    const tournament = game.tournamentId ? await Tournament.findByPk(game.tournamentId, { transaction }) : null;
    const match = game.matchId ? await Match.findByPk(game.matchId, { transaction }) : null;
    const ids = ordered.map(p => p.userId);
    const users = await User.findAll({ where: { id: ids }, transaction, lock: transaction.LOCK.UPDATE });
    const byId = new Map(users.map(u => [u.id, u]));
    const ratingEntries = ordered.map(p => ({ userId: p.userId, position: p.resolvedPosition, rating: byId.get(p.userId)?.eloRating || 1000 }));
    const changes = eloChanges(ratingEntries);

    const answers = await GameQuestion.findAll({ where: { gameId }, transaction, raw: true });
    for (const p of ordered) {
      const user = byId.get(p.userId);
      if (!user) continue;
      const mine = answers.filter(a => a.answeredByUserId === p.userId);
      const correct = mine.filter(a => a.answeredCorrectly === true).length;
      const xpEarned = mine.reduce((sum, a) => {
        const ok = a.answeredCorrectly === true;
        const base = ok ? 10 : 2;
        return sum + base + (ok ? Number(a.difficultySnapshot || 1) * 2 + Number(a.tierSnapshot || 1) * 3 : 0);
      }, 0);
      const eloBefore = user.eloRating;
      const eloAfter = Math.max(100, eloBefore + (changes.get(p.userId) || 0));
      user.eloRating = eloAfter;
      await user.save({ transaction });

      let tournamentPoints = 0;
      if (tournament?.format === 'shared_board_league') tournamentPoints = sharedBoardPoints(ordered.length, p.resolvedPosition);
      else if (tournament && ['league_1v1','group_knockout'].includes(tournament.format) && ['league','group'].includes(match?.stage)) tournamentPoints = p.resolvedPosition === 1 ? 3 : 0;

      await PlayerGameStat.create({
        gameId,
        userId: p.userId,
        finishPosition: p.resolvedPosition,
        tournamentPoints,
        eloBefore,
        eloAfter,
        xpEarned,
        correctAnswers: correct,
        totalAnswers: mine.length
      }, { transaction });
    }

    game.statsFinalized = true;
    await game.save({ transaction });
    return { ordered, changes: Object.fromEntries(changes) };
  });
}

module.exports = { rankingOrder, eloChanges, finalizeGameStats };
