const { DataTypes } = require('sequelize');

const timestamps = () => ({
  created_at: { type: DataTypes.DATE, allowNull: false },
  updated_at: { type: DataTypes.DATE, allowNull: false }
});
const id = () => ({ type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true });
const bigId = () => ({ type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true });
const fk = (table, allowNull = false) => ({
  type: DataTypes.INTEGER.UNSIGNED,
  allowNull,
  references: { model: table, key: 'id' },
  onUpdate: 'CASCADE',
  onDelete: allowNull ? 'SET NULL' : 'CASCADE'
});

module.exports = {
  async up({ context: qi }) {
    await qi.createTable('users', {
      id: id(),
      username: { type: DataTypes.STRING(40), allowNull: false, unique: true },
      email: { type: DataTypes.STRING(120), allowNull: false, unique: true },
      password_hash: { type: DataTypes.STRING(255), allowNull: false },
      role: { type: DataTypes.ENUM('user','admin'), allowNull: false, defaultValue: 'user' },
      elo_rating: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1000 },
      xp: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      level: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
      last_seen_at: { type: DataTypes.DATE, allowNull: true },
      ...timestamps()
    });

    await qi.createTable('teams', {
      id: id(), user_id: fk('users'),
      name: { type: DataTypes.STRING(60), allowNull: false },
      crest_url: { type: DataTypes.STRING(500), allowNull: true },
      crest_storage_key: { type: DataTypes.STRING(500), allowNull: true },
      crest_emoji: { type: DataTypes.STRING(20), defaultValue: '⚽' },
      primary_color: { type: DataTypes.STRING(7), defaultValue: '#7C3AED' },
      secondary_color: { type: DataTypes.STRING(7), defaultValue: '#FFFFFF' },
      shirt_pattern: { type: DataTypes.ENUM('solid','stripes','halves','sash','hoops'), defaultValue: 'solid' },
      ...timestamps()
    });
    await qi.addIndex('teams', ['user_id'], { unique: true });

    await qi.createTable('tournaments', {
      id: id(), organizer_id: fk('users'),
      name: { type: DataTypes.STRING(100), allowNull: false },
      format: { type: DataTypes.ENUM('league_1v1','shared_board_league','group_knockout','cup'), allowNull: false },
      status: { type: DataTypes.ENUM('draft','open','running','finished','cancelled'), defaultValue: 'open' },
      board_size: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 40 },
      settings: { type: DataTypes.JSON, allowNull: false },
      ...timestamps()
    });

    await qi.createTable('tournament_participants', {
      id: id(), tournament_id: fk('tournaments'), user_id: fk('users'),
      seed: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      group_code: { type: DataTypes.STRING(10), allowNull: true },
      points: { type: DataTypes.INTEGER, defaultValue: 0 },
      played: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
      wins: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
      draws: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
      losses: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
      position_points: { type: DataTypes.INTEGER, defaultValue: 0 },
      eliminated: { type: DataTypes.BOOLEAN, defaultValue: false },
      ...timestamps()
    });
    await qi.addIndex('tournament_participants', ['tournament_id','user_id'], { unique: true, name: 'uq_tournament_participant' });

    await qi.createTable('tournament_invitations', {
      id: id(), tournament_id: fk('tournaments'), inviter_id: fk('users'), invitee_id: fk('users'),
      token: { type: DataTypes.UUID, allowNull: false, unique: true },
      status: { type: DataTypes.ENUM('pending','accepted','declined','cancelled','expired'), allowNull: false, defaultValue: 'pending' },
      responded_at: { type: DataTypes.DATE, allowNull: true },
      ...timestamps()
    });
    await qi.addIndex('tournament_invitations', ['tournament_id','invitee_id'], { unique: true, name: 'uq_tournament_invitation' });

    await qi.createTable('matches', {
      id: id(), tournament_id: fk('tournaments'),
      round_no: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      stage: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'league' },
      group_code: { type: DataTypes.STRING(10), allowNull: true },
      slot: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
      status: { type: DataTypes.ENUM('scheduled','ready','running','finished','bye'), defaultValue: 'scheduled' },
      participants: { type: DataTypes.JSON, allowNull: false },
      result: { type: DataTypes.JSON, allowNull: true },
      source: { type: DataTypes.JSON, allowNull: true },
      ...timestamps()
    });

    await qi.createTable('games', {
      id: id(),
      tournament_id: fk('tournaments', true),
      match_id: fk('matches', true),
      room_code: { type: DataTypes.STRING(12), allowNull: false, unique: true },
      name: { type: DataTypes.STRING(100), allowNull: false },
      status: { type: DataTypes.ENUM('lobby','running','finished','cancelled'), defaultValue: 'lobby' },
      board_size: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      state: { type: DataTypes.JSON, allowNull: false },
      version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
      spectators_allowed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      stats_finalized: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      ...timestamps()
    });
    await qi.addIndex('games', ['match_id'], { unique: true, name: 'uq_game_match' });

    await qi.createTable('questions', {
      id: id(),
      type: { type: DataTypes.ENUM('multiple_choice','categorization'), allowNull: false },
      prompt: { type: DataTypes.STRING(500), allowNull: false },
      options: { type: DataTypes.JSON, allowNull: true },
      correct_answer: { type: DataTypes.JSON, allowNull: false },
      category: { type: DataTypes.STRING(80), allowNull: true },
      competition: { type: DataTypes.STRING(80), allowNull: true },
      knowledge_area: { type: DataTypes.STRING(100), allowNull: true },
      tier: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 2 },
      difficulty: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 2 },
      review_status: { type: DataTypes.ENUM('draft','review','published','rejected'), allowNull: false, defaultValue: 'published' },
      version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
      reviewed_by_id: fk('users', true),
      reviewed_at: { type: DataTypes.DATE, allowNull: true },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      ...timestamps()
    });
    await qi.addIndex('questions', ['active','review_status','tier'], { name: 'idx_question_pool' });
    await qi.addIndex('questions', ['knowledge_area'], { name: 'idx_question_knowledge_area' });

    await qi.createTable('game_questions', {
      id: bigId(), game_id: fk('games'), question_id: fk('questions'), answered_by_user_id: fk('users', true),
      answered_correctly: { type: DataTypes.BOOLEAN, allowNull: true },
      answered_at: { type: DataTypes.DATE, allowNull: true },
      response_time_ms: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      tier_snapshot: { type: DataTypes.TINYINT.UNSIGNED, allowNull: true },
      difficulty_snapshot: { type: DataTypes.TINYINT.UNSIGNED, allowNull: true },
      knowledge_area_snapshot: { type: DataTypes.STRING(100), allowNull: true },
      ...timestamps()
    });
    await qi.addIndex('game_questions', ['game_id','question_id'], { unique: true, name: 'uq_game_question' });

    await qi.createTable('question_reports', {
      id: id(), question_id: fk('questions'), reporter_id: fk('users'), resolved_by_id: fk('users', true),
      reason: { type: DataTypes.ENUM('incorrect_answer','outdated','ambiguous','typo','other'), allowNull: false },
      details: { type: DataTypes.STRING(1000), allowNull: true },
      status: { type: DataTypes.ENUM('open','resolved','dismissed'), allowNull: false, defaultValue: 'open' },
      resolution: { type: DataTypes.STRING(1000), allowNull: true },
      resolved_at: { type: DataTypes.DATE, allowNull: true },
      ...timestamps()
    });

    await qi.createTable('user_knowledge_stats', {
      id: bigId(), user_id: fk('users'),
      key: { type: DataTypes.STRING(120), allowNull: false },
      label: { type: DataTypes.STRING(120), allowNull: false },
      answered: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      correct: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      accuracy: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
      last_answered_at: { type: DataTypes.DATE, allowNull: true },
      ...timestamps()
    });
    await qi.addIndex('user_knowledge_stats', ['user_id','key'], { unique: true, name: 'uq_user_knowledge' });

    await qi.createTable('player_game_stats', {
      id: bigId(), game_id: fk('games'), user_id: fk('users'),
      finish_position: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      tournament_points: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      elo_before: { type: DataTypes.INTEGER, allowNull: false },
      elo_after: { type: DataTypes.INTEGER, allowNull: false },
      xp_earned: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      correct_answers: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      total_answers: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      ...timestamps()
    });
    await qi.addIndex('player_game_stats', ['game_id','user_id'], { unique: true, name: 'uq_player_game_stat' });

    await qi.createTable('game_chat_messages', {
      id: bigId(), game_id: fk('games'), user_id: fk('users'),
      type: { type: DataTypes.ENUM('message','reaction'), allowNull: false, defaultValue: 'message' },
      body: { type: DataTypes.STRING(500), allowNull: true },
      reaction: { type: DataTypes.STRING(20), allowNull: true },
      payload: { type: DataTypes.JSON, allowNull: true },
      ...timestamps()
    });
  },

  async down({ context: qi }) {
    for (const table of [
      'game_chat_messages','player_game_stats','user_knowledge_stats','question_reports','game_questions',
      'questions','games','matches','tournament_invitations','tournament_participants','tournaments','teams','users'
    ]) await qi.dropTable(table);
  }
};
