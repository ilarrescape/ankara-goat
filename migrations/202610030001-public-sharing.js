const { DataTypes } = require('sequelize');

module.exports = {
  async up({ context: qi }) {
    await qi.addColumn('games', 'share_code', { type: DataTypes.STRING(24), allowNull: true });
    await qi.addIndex('games', ['share_code'], { unique: true, name: 'uq_games_share_code' });
    await qi.addColumn('tournaments', 'share_code', { type: DataTypes.STRING(24), allowNull: true });
    await qi.addIndex('tournaments', ['share_code'], { unique: true, name: 'uq_tournaments_share_code' });
  },

  async down({ context: qi }) {
    await qi.removeIndex('tournaments', 'uq_tournaments_share_code').catch(() => {});
    await qi.removeColumn('tournaments', 'share_code');
    await qi.removeIndex('games', 'uq_games_share_code').catch(() => {});
    await qi.removeColumn('games', 'share_code');
  }
};
