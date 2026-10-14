require('dotenv').config();

const { sequelize, PlayerGameStat, GameQuestion } = require('../src/models');

function isAnsweredCorrectly(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function xpForAnswers(rows) {
  return rows.reduce((sum, row) => {
    const ok = isAnsweredCorrectly(row.answeredCorrectly);
    const base = ok ? 10 : 2;
    const bonus = ok
      ? Number(row.difficultySnapshot || 1) * 2 + Number(row.tierSnapshot || 1) * 3
      : 0;
    return sum + base + bonus;
  }, 0);
}

(async () => {
  let updated = 0;
  let unchanged = 0;

  try {
    await sequelize.authenticate();

    const stats = await PlayerGameStat.findAll({
      attributes: ['id', 'gameId', 'userId', 'correctAnswers', 'totalAnswers', 'xpEarned'],
      order: [['id', 'ASC']]
    });

    console.log(`[repair] ${stats.length} estadísticas de partidas encontradas.`);

    for (const stat of stats) {
      const answers = await GameQuestion.findAll({
        where: {
          gameId: stat.gameId,
          answeredByUserId: stat.userId
        },
        attributes: ['answeredCorrectly', 'difficultySnapshot', 'tierSnapshot'],
        raw: true
      });

      const correctAnswers = answers.filter(row => isAnsweredCorrectly(row.answeredCorrectly)).length;
      const totalAnswers = answers.length;
      const xpEarned = xpForAnswers(answers);

      const changed =
        Number(stat.correctAnswers || 0) !== correctAnswers ||
        Number(stat.totalAnswers || 0) !== totalAnswers ||
        Number(stat.xpEarned || 0) !== xpEarned;

      if (!changed) {
        unchanged += 1;
        continue;
      }

      await stat.update({ correctAnswers, totalAnswers, xpEarned });
      updated += 1;

      console.log(
        `[repair] game=${stat.gameId} user=${stat.userId} -> ` +
        `${correctAnswers}/${totalAnswers} correctas, xpPartida=${xpEarned}`
      );
    }

    console.log(`[repair] Finalizado. Actualizadas: ${updated}. Sin cambios: ${unchanged}.`);
  } catch (error) {
    console.error('[repair] Error:', error);
    process.exitCode = 1;
  } finally {
    await sequelize.close().catch(() => {});
  }
})();
