const { DataTypes } = require('sequelize');

const bigId = () => ({ type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true });
const fk = (table, allowNull = false) => ({
  type: DataTypes.INTEGER.UNSIGNED,
  allowNull,
  references: { model: table, key: 'id' },
  onUpdate: 'CASCADE',
  onDelete: allowNull ? 'SET NULL' : 'CASCADE'
});
const timestamps = () => ({
  created_at: { type: DataTypes.DATE, allowNull: false },
  updated_at: { type: DataTypes.DATE, allowNull: false }
});

module.exports = {
  async up({ context: qi }) {
    await qi.addColumn('users', 'last_ranked_game_at', { type: DataTypes.DATE, allowNull: true });
    await qi.addColumn('users', 'last_elo_decay_at', { type: DataTypes.DATE, allowNull: true });

    await qi.changeColumn('tournaments', 'status', {
      type: DataTypes.ENUM('draft','open','running','finished','suspended','cancelled'),
      allowNull: false,
      defaultValue: 'open'
    });
    await qi.addColumn('tournaments', 'access_code', { type: DataTypes.STRING(12), allowNull: true });
    await qi.addIndex('tournaments', ['access_code'], { unique: true, name: 'uq_tournament_access_code' });

    await qi.addColumn('tournament_participants', 'elimination_reason', { type: DataTypes.STRING(60), allowNull: true });
    await qi.addColumn('tournament_participants', 'final_position', { type: DataTypes.INTEGER.UNSIGNED, allowNull: true });
    await qi.addColumn('standings_tiebreaks', 'plan_key', { type: DataTypes.STRING(240), allowNull: true });
    await qi.addColumn('standings_tiebreaks', 'advance_count', { type: DataTypes.TINYINT.UNSIGNED, allowNull: true });
    await qi.addColumn('standings_tiebreaks', 'slots_available', { type: DataTypes.TINYINT.UNSIGNED, allowNull: true });
    await qi.addColumn('standings_tiebreaks', 'fixed_user_ids', { type: DataTypes.JSON, allowNull: true });
    await qi.addColumn('standings_tiebreaks', 'excluded_user_ids', { type: DataTypes.JSON, allowNull: true });
    await qi.addColumn('standings_tiebreaks', 'plan_mode', { type: DataTypes.STRING(40), allowNull: true });

    await qi.addColumn('questions', 'last_used_at', { type: DataTypes.DATE, allowNull: true });
    await qi.addColumn('questions', 'times_shown', { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 });
    await qi.addColumn('questions', 'answer_count', { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 });
    await qi.addColumn('questions', 'correct_count', { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 });
    await qi.addIndex('questions', ['active','review_status','tier','last_used_at'], { name: 'idx_question_rotation' });

    await qi.createTable('user_trophies', {
      id: bigId(),
      user_id: fk('users'),
      tournament_id: fk('tournaments'),
      trophy_type: { type: DataTypes.ENUM('copa_bronce','copa_plata','copa_oro','liga_bronce','liga_plata','liga_oro'), allowNull: false },
      tournament_name: { type: DataTypes.STRING(100), allowNull: false },
      awarded_at: { type: DataTypes.DATE, allowNull: false },
      ...timestamps()
    });
    await qi.addIndex('user_trophies', ['user_id','tournament_id'], { unique: true, name: 'uq_user_trophy_tournament' });

    await qi.createTable('roulette_events', {
      id: bigId(),
      game_id: fk('games'),
      user_id: fk('users'),
      target_user_id: fk('users', true),
      effect: { type: DataTypes.STRING(40), allowNull: false },
      amount: { type: DataTypes.INTEGER, allowNull: true },
      turn_no: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      metadata: { type: DataTypes.JSON, allowNull: true },
      ...timestamps()
    });
    await qi.addIndex('roulette_events', ['game_id','created_at'], { name: 'idx_roulette_game_time' });
    await qi.addIndex('roulette_events', ['effect'], { name: 'idx_roulette_effect' });
  },

  async down({ context: qi }) {
    await qi.dropTable('roulette_events');
    await qi.dropTable('user_trophies');
    await qi.removeIndex('questions', 'idx_question_rotation').catch(() => {});
    await qi.removeColumn('questions', 'correct_count');
    await qi.removeColumn('questions', 'answer_count');
    await qi.removeColumn('questions', 'times_shown');
    await qi.removeColumn('questions', 'last_used_at');
    await qi.removeColumn('tournament_participants', 'final_position');
    await qi.removeColumn('tournament_participants', 'elimination_reason');
    await qi.removeColumn('standings_tiebreaks', 'plan_mode');
    await qi.removeColumn('standings_tiebreaks', 'excluded_user_ids');
    await qi.removeColumn('standings_tiebreaks', 'fixed_user_ids');
    await qi.removeColumn('standings_tiebreaks', 'slots_available');
    await qi.removeColumn('standings_tiebreaks', 'advance_count');
    await qi.removeColumn('standings_tiebreaks', 'plan_key');
    await qi.removeIndex('tournaments', 'uq_tournament_access_code').catch(() => {});
    await qi.removeColumn('tournaments', 'access_code');
    await qi.changeColumn('tournaments', 'status', {
      type: DataTypes.ENUM('draft','open','running','finished','cancelled'),
      allowNull: false,
      defaultValue: 'open'
    });
    await qi.removeColumn('users', 'last_elo_decay_at');
    await qi.removeColumn('users', 'last_ranked_game_at');
  }
};
