const { sequelize, Game } = require('../models');

async function withLockedGame(gameId, mutator) {
  return sequelize.transaction(async transaction => {
    const game = await Game.findByPk(gameId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!game) throw new Error('Partida inexistente.');
    const state = JSON.parse(JSON.stringify(game.state || {}));
    const result = await mutator(state, game, transaction);
    game.state = state;
    game.version += 1;
    await game.save({ transaction });
    return { game: game.toJSON(), state, result };
  });
}

module.exports = { withLockedGame };
