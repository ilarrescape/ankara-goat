const { DataTypes } = require('sequelize');

const timestamps = () => ({
  created_at: { type: DataTypes.DATE, allowNull: false },
  updated_at: { type: DataTypes.DATE, allowNull: false }
});
const id = () => ({ type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true });
const bigId = () => ({ type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true });
const fk = (table, allowNull = false) => ({
  type: DataTypes.INTEGER.UNSIGNED, allowNull,
  references: { model: table, key: 'id' }, onUpdate: 'CASCADE', onDelete: allowNull ? 'SET NULL' : 'CASCADE'
});

module.exports = {
  async up({ context: qi }) {
    await qi.changeColumn('users', 'role', { type: DataTypes.ENUM('user','moderator','admin'), allowNull: false, defaultValue: 'user' });
    await qi.addColumn('users', 'moderation_policy_version', { type: DataTypes.STRING(20), allowNull: true });
    await qi.addColumn('users', 'moderation_policy_accepted_at', { type: DataTypes.DATE, allowNull: true });
    await qi.addColumn('users', 'chat_muted_until', { type: DataTypes.DATE, allowNull: true });
    await qi.addColumn('users', 'account_status', { type: DataTypes.ENUM('active','suspended'), allowNull: false, defaultValue: 'active' });

    await qi.addColumn('teams', 'moderation_status', { type: DataTypes.ENUM('approved','pending','rejected'), allowNull: false, defaultValue: 'approved' });
    await qi.addColumn('teams', 'moderation_reason', { type: DataTypes.STRING(500), allowNull: true });

    await qi.addColumn('tournament_participants', 'correct_answers', { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 });
    await qi.addColumn('tournament_participants', 'incorrect_answers', { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 });
    await qi.addColumn('tournament_participants', 'tiebreak_rank', { type: DataTypes.INTEGER.UNSIGNED, allowNull: true });

    await qi.addColumn('game_chat_messages', 'moderation_status', { type: DataTypes.ENUM('visible','hidden'), allowNull: false, defaultValue: 'visible' });
    await qi.addColumn('game_chat_messages', 'moderation_reason', { type: DataTypes.STRING(500), allowNull: true });

    await qi.createTable('standings_tiebreaks', {
      id: id(), tournament_id: fk('tournaments'), group_code: { type: DataTypes.STRING(10), allowNull: true },
      scope: { type: DataTypes.ENUM('group','final'), allowNull: false },
      signature: { type: DataTypes.STRING(200), allowNull: false },
      user_ids: { type: DataTypes.JSON, allowNull: false }, resolved_order: { type: DataTypes.JSON, allowNull: true },
      status: { type: DataTypes.ENUM('pending','running','resolved','cancelled'), allowNull: false, defaultValue: 'pending' },
      game_id: fk('games', true), ...timestamps()
    });
    await qi.addIndex('standings_tiebreaks', ['tournament_id','scope','group_code','signature'], { unique: true, name: 'uq_standings_tiebreak' });

    await qi.createTable('moderation_reports', {
      id: bigId(), reporter_id: fk('users'),
      target_type: { type: DataTypes.ENUM('team_name','chat_message'), allowNull: false },
      target_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      reason: { type: DataTypes.ENUM('offensive','hate','harassment','sexual','spam','impersonation','personal_data','other'), allowNull: false },
      details: { type: DataTypes.STRING(1000), allowNull: true },
      status: { type: DataTypes.ENUM('open','resolved','dismissed'), allowNull: false, defaultValue: 'open' },
      resolved_by_id: fk('users', true), resolution: { type: DataTypes.STRING(1000), allowNull: true }, resolved_at: { type: DataTypes.DATE, allowNull: true },
      ...timestamps()
    });
    await qi.addIndex('moderation_reports', ['status','target_type'], { name: 'idx_moderation_reports_queue' });

    await qi.createTable('moderation_actions', {
      id: bigId(), moderator_id: fk('users'), target_user_id: fk('users', true),
      target_type: { type: DataTypes.ENUM('user','team','chat_message'), allowNull: false },
      target_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      action: { type: DataTypes.ENUM('warning','hide_message','reject_team_name','mute_chat','unmute_chat','suspend_user','restore_user'), allowNull: false },
      reason: { type: DataTypes.STRING(1000), allowNull: false }, expires_at: { type: DataTypes.DATE, allowNull: true },
      ...timestamps()
    });
  },
  async down({ context: qi }) {
    await qi.dropTable('moderation_actions');
    await qi.dropTable('moderation_reports');
    await qi.dropTable('standings_tiebreaks');
    await qi.removeColumn('game_chat_messages','moderation_reason');
    await qi.removeColumn('game_chat_messages','moderation_status');
    await qi.removeColumn('tournament_participants','tiebreak_rank');
    await qi.removeColumn('tournament_participants','incorrect_answers');
    await qi.removeColumn('tournament_participants','correct_answers');
    await qi.removeColumn('teams','moderation_reason');
    await qi.removeColumn('teams','moderation_status');
    await qi.removeColumn('users','account_status');
    await qi.removeColumn('users','chat_muted_until');
    await qi.removeColumn('users','moderation_policy_accepted_at');
    await qi.removeColumn('users','moderation_policy_version');
    await qi.changeColumn('users','role',{ type: DataTypes.ENUM('user','admin'), allowNull:false, defaultValue:'user' });
  }
};
