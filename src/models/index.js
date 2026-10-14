const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  username: { type: DataTypes.STRING(40), allowNull: false, unique: true },
  email: { type: DataTypes.STRING(120), allowNull: false, unique: true, validate: { isEmail: true } },
  passwordHash: { type: DataTypes.STRING(255), allowNull: false },
  role: { type: DataTypes.ENUM('user', 'moderator', 'admin'), allowNull: false, defaultValue: 'user' },
  eloRating: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1000 },
  xp: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
  level: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
  lastSeenAt: { type: DataTypes.DATE, allowNull: true },
  lastRankedGameAt: { type: DataTypes.DATE, allowNull: true },
  lastEloDecayAt: { type: DataTypes.DATE, allowNull: true },
  moderationPolicyVersion: { type: DataTypes.STRING(20), allowNull: true },
  moderationPolicyAcceptedAt: { type: DataTypes.DATE, allowNull: true },
  chatMutedUntil: { type: DataTypes.DATE, allowNull: true },
  accountStatus: { type: DataTypes.ENUM('active','suspended'), allowNull: false, defaultValue: 'active' }
});

const Team = sequelize.define('Team', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(60), allowNull: false },
  crestUrl: { type: DataTypes.STRING(500), allowNull: true },
  crestStorageKey: { type: DataTypes.STRING(500), allowNull: true },
  crestEmoji: { type: DataTypes.STRING(20), defaultValue: '⚽' },
  primaryColor: { type: DataTypes.STRING(7), defaultValue: '#7C3AED' },
  secondaryColor: { type: DataTypes.STRING(7), defaultValue: '#FFFFFF' },
  shirtPattern: { type: DataTypes.ENUM('solid','stripes','halves','sash','hoops'), defaultValue: 'solid' },
  moderationStatus: { type: DataTypes.ENUM('approved','pending','rejected'), allowNull: false, defaultValue: 'approved' },
  moderationReason: { type: DataTypes.STRING(500), allowNull: true }
});

const Tournament = sequelize.define('Tournament', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(100), allowNull: false },
  format: { type: DataTypes.ENUM('league_1v1','shared_board_league','group_knockout','cup'), allowNull: false },
  status: { type: DataTypes.ENUM('draft','open','running','finished','suspended','cancelled'), defaultValue: 'open' },
  accessCode: { type: DataTypes.STRING(12), allowNull: true, unique: true },
  shareCode: { type: DataTypes.STRING(24), allowNull: true, unique: true },
  boardSize: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 40 },
  settings: { type: DataTypes.JSON, allowNull: false, defaultValue: {} }
});

const TournamentParticipant = sequelize.define('TournamentParticipant', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  seed: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  groupCode: { type: DataTypes.STRING(10), allowNull: true },
  points: { type: DataTypes.INTEGER, defaultValue: 0 },
  played: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
  wins: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
  draws: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
  losses: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
  positionPoints: { type: DataTypes.INTEGER, defaultValue: 0 },
  correctAnswers: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
  incorrectAnswers: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
  tiebreakRank: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  eliminated: { type: DataTypes.BOOLEAN, defaultValue: false },
  eliminationReason: { type: DataTypes.STRING(60), allowNull: true },
  finalPosition: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true }
}, { indexes: [{ unique: true, fields: ['tournament_id', 'user_id'] }] });

const TournamentInvitation = sequelize.define('TournamentInvitation', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  token: { type: DataTypes.UUID, allowNull: false, defaultValue: DataTypes.UUIDV4, unique: true },
  status: { type: DataTypes.ENUM('pending','accepted','declined','cancelled','expired'), allowNull: false, defaultValue: 'pending' },
  respondedAt: { type: DataTypes.DATE, allowNull: true }
}, { indexes: [{ unique: true, fields: ['tournament_id', 'invitee_id'] }] });

const Match = sequelize.define('Match', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  roundNo: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  stage: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'league' },
  groupCode: { type: DataTypes.STRING(10), allowNull: true },
  slot: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
  status: { type: DataTypes.ENUM('scheduled','ready','running','finished','bye'), defaultValue: 'scheduled' },
  participants: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
  result: { type: DataTypes.JSON, allowNull: true },
  source: { type: DataTypes.JSON, allowNull: true }
});

const Game = sequelize.define('Game', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  roomCode: { type: DataTypes.STRING(12), allowNull: false, unique: true },
  shareCode: { type: DataTypes.STRING(24), allowNull: true, unique: true },
  name: { type: DataTypes.STRING(100), allowNull: false },
  status: { type: DataTypes.ENUM('lobby','running','finished','cancelled'), defaultValue: 'lobby' },
  boardSize: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  state: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
  version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
  spectatorsAllowed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  statsFinalized: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
});

const Question = sequelize.define('Question', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  type: { type: DataTypes.ENUM('multiple_choice','categorization'), allowNull: false },
  prompt: { type: DataTypes.STRING(500), allowNull: false },
  options: { type: DataTypes.JSON, allowNull: true },
  correctAnswer: { type: DataTypes.JSON, allowNull: false },
  category: { type: DataTypes.STRING(80), allowNull: true },
  competition: { type: DataTypes.STRING(80), allowNull: true },
  knowledgeArea: { type: DataTypes.STRING(100), allowNull: true },
  tier: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 2, validate: { min: 1, max: 3 } },
  difficulty: { type: DataTypes.TINYINT.UNSIGNED, defaultValue: 2, validate: { min: 1, max: 5 } },
  reviewStatus: { type: DataTypes.ENUM('draft','review','published','rejected'), allowNull: false, defaultValue: 'published' },
  version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
  reviewedAt: { type: DataTypes.DATE, allowNull: true },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
  lastUsedAt: { type: DataTypes.DATE, allowNull: true },
  timesShown: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
  answerCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
  correctCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 }
}, { indexes: [{ fields: ['active', 'review_status', 'tier'] }, { fields: ['knowledge_area'] }] });

const GameQuestion = sequelize.define('GameQuestion', {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  answeredCorrectly: { type: DataTypes.BOOLEAN, allowNull: true },
  answeredAt: { type: DataTypes.DATE, allowNull: true },
  responseTimeMs: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  tierSnapshot: { type: DataTypes.TINYINT.UNSIGNED, allowNull: true },
  difficultySnapshot: { type: DataTypes.TINYINT.UNSIGNED, allowNull: true },
  knowledgeAreaSnapshot: { type: DataTypes.STRING(100), allowNull: true }
}, { indexes: [{ unique: true, fields: ['game_id', 'question_id'] }] });

const QuestionReport = sequelize.define('QuestionReport', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  reason: { type: DataTypes.ENUM('incorrect_answer','outdated','ambiguous','typo','other'), allowNull: false },
  details: { type: DataTypes.STRING(1000), allowNull: true },
  status: { type: DataTypes.ENUM('open','resolved','dismissed'), allowNull: false, defaultValue: 'open' },
  resolution: { type: DataTypes.STRING(1000), allowNull: true },
  resolvedAt: { type: DataTypes.DATE, allowNull: true }
});

const UserKnowledgeStat = sequelize.define('UserKnowledgeStat', {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  key: { type: DataTypes.STRING(120), allowNull: false },
  label: { type: DataTypes.STRING(120), allowNull: false },
  answered: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
  correct: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
  accuracy: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
  lastAnsweredAt: { type: DataTypes.DATE, allowNull: true }
}, { indexes: [{ unique: true, fields: ['user_id', 'key'] }] });

const PlayerGameStat = sequelize.define('PlayerGameStat', {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  finishPosition: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  tournamentPoints: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  eloBefore: { type: DataTypes.INTEGER, allowNull: false },
  eloAfter: { type: DataTypes.INTEGER, allowNull: false },
  xpEarned: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
  correctAnswers: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
  totalAnswers: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 }
}, { indexes: [{ unique: true, fields: ['game_id', 'user_id'] }] });

const GameChatMessage = sequelize.define('GameChatMessage', {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  type: { type: DataTypes.ENUM('message','reaction'), allowNull: false, defaultValue: 'message' },
  body: { type: DataTypes.STRING(500), allowNull: true },
  reaction: { type: DataTypes.STRING(20), allowNull: true },
  payload: { type: DataTypes.JSON, allowNull: true },
  moderationStatus: { type: DataTypes.ENUM('visible','hidden'), allowNull: false, defaultValue: 'visible' },
  moderationReason: { type: DataTypes.STRING(500), allowNull: true }
});

const StandingsTiebreak = sequelize.define('StandingsTiebreak', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  groupCode: { type: DataTypes.STRING(10), allowNull: true },
  scope: { type: DataTypes.ENUM('group','final'), allowNull: false },
  signature: { type: DataTypes.STRING(200), allowNull: false },
  userIds: { type: DataTypes.JSON, allowNull: false },
  resolvedOrder: { type: DataTypes.JSON, allowNull: true },
  status: { type: DataTypes.ENUM('pending','running','resolved','cancelled'), allowNull: false, defaultValue: 'pending' },
  planKey: { type: DataTypes.STRING(240), allowNull: true },
  advanceCount: { type: DataTypes.TINYINT.UNSIGNED, allowNull: true },
  slotsAvailable: { type: DataTypes.TINYINT.UNSIGNED, allowNull: true },
  fixedUserIds: { type: DataTypes.JSON, allowNull: true },
  excludedUserIds: { type: DataTypes.JSON, allowNull: true },
  planMode: { type: DataTypes.STRING(40), allowNull: true }
}, { indexes: [{ unique: true, fields: ['tournament_id','scope','group_code','signature'] }] });


const UserTrophy = sequelize.define('UserTrophy', {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  trophyType: { type: DataTypes.ENUM('copa_bronce','copa_plata','copa_oro','liga_bronce','liga_plata','liga_oro'), allowNull: false },
  tournamentName: { type: DataTypes.STRING(100), allowNull: false },
  awardedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, { indexes: [{ unique: true, fields: ['user_id','tournament_id'] }] });

const RouletteEvent = sequelize.define('RouletteEvent', {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  effect: { type: DataTypes.STRING(40), allowNull: false },
  amount: { type: DataTypes.INTEGER, allowNull: true },
  turnNo: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  metadata: { type: DataTypes.JSON, allowNull: true }
}, { indexes: [{ fields: ['game_id','created_at'] }, { fields: ['effect'] }] });

const ModerationReport = sequelize.define('ModerationReport', {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  targetType: { type: DataTypes.ENUM('team_name','chat_message'), allowNull: false },
  targetId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  reason: { type: DataTypes.ENUM('offensive','hate','harassment','sexual','spam','impersonation','personal_data','other'), allowNull: false },
  details: { type: DataTypes.STRING(1000), allowNull: true },
  status: { type: DataTypes.ENUM('open','resolved','dismissed'), allowNull: false, defaultValue: 'open' },
  resolution: { type: DataTypes.STRING(1000), allowNull: true },
  resolvedAt: { type: DataTypes.DATE, allowNull: true }
});

const ModerationAction = sequelize.define('ModerationAction', {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  targetType: { type: DataTypes.ENUM('user','team','chat_message'), allowNull: false },
  targetId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  action: { type: DataTypes.ENUM('warning','hide_message','reject_team_name','mute_chat','unmute_chat','suspend_user','restore_user'), allowNull: false },
  reason: { type: DataTypes.STRING(1000), allowNull: false },
  expiresAt: { type: DataTypes.DATE, allowNull: true }
});

User.hasOne(Team, { foreignKey: { name: 'userId', allowNull: false }, onDelete: 'CASCADE' });
Team.belongsTo(User, { foreignKey: 'userId' });

User.hasMany(Tournament, { foreignKey: { name: 'organizerId', allowNull: false } });
Tournament.belongsTo(User, { as: 'organizer', foreignKey: 'organizerId' });
Tournament.belongsToMany(User, { through: TournamentParticipant, foreignKey: 'tournamentId', otherKey: 'userId' });
User.belongsToMany(Tournament, { through: TournamentParticipant, foreignKey: 'userId', otherKey: 'tournamentId' });
Tournament.hasMany(TournamentParticipant, { foreignKey: 'tournamentId', onDelete: 'CASCADE' });
TournamentParticipant.belongsTo(Tournament, { foreignKey: 'tournamentId' });
TournamentParticipant.belongsTo(User, { foreignKey: 'userId' });

Tournament.hasMany(TournamentInvitation, { foreignKey: 'tournamentId', onDelete: 'CASCADE' });
TournamentInvitation.belongsTo(Tournament, { foreignKey: 'tournamentId' });
TournamentInvitation.belongsTo(User, { as: 'inviter', foreignKey: 'inviterId' });
TournamentInvitation.belongsTo(User, { as: 'invitee', foreignKey: 'inviteeId' });

Tournament.hasMany(Match, { foreignKey: 'tournamentId', onDelete: 'CASCADE' });
Match.belongsTo(Tournament, { foreignKey: 'tournamentId' });
Tournament.hasMany(Game, { foreignKey: 'tournamentId' });
Game.belongsTo(Tournament, { foreignKey: 'tournamentId' });
Match.hasOne(Game, { foreignKey: 'matchId' });
Game.belongsTo(Match, { foreignKey: 'matchId' });

Game.belongsToMany(Question, { through: GameQuestion, foreignKey: 'gameId', otherKey: 'questionId' });
Question.belongsToMany(Game, { through: GameQuestion, foreignKey: 'questionId', otherKey: 'gameId' });
GameQuestion.belongsTo(Game, { foreignKey: 'gameId' });
GameQuestion.belongsTo(Question, { foreignKey: 'questionId' });
GameQuestion.belongsTo(User, { as: 'answeredBy', foreignKey: 'answeredByUserId' });

Question.hasMany(QuestionReport, { foreignKey: 'questionId', onDelete: 'CASCADE' });
QuestionReport.belongsTo(Question, { foreignKey: 'questionId' });
QuestionReport.belongsTo(User, { as: 'reporter', foreignKey: 'reporterId' });
QuestionReport.belongsTo(User, { as: 'resolver', foreignKey: 'resolvedById' });
Question.belongsTo(User, { as: 'reviewer', foreignKey: 'reviewedById' });

User.hasMany(UserKnowledgeStat, { foreignKey: 'userId', onDelete: 'CASCADE' });
UserKnowledgeStat.belongsTo(User, { foreignKey: 'userId' });

Game.hasMany(PlayerGameStat, { foreignKey: 'gameId', onDelete: 'CASCADE' });
PlayerGameStat.belongsTo(Game, { foreignKey: 'gameId' });
User.hasMany(PlayerGameStat, { foreignKey: 'userId', onDelete: 'CASCADE' });
PlayerGameStat.belongsTo(User, { foreignKey: 'userId' });

Game.hasMany(GameChatMessage, { foreignKey: 'gameId', onDelete: 'CASCADE' });
GameChatMessage.belongsTo(Game, { foreignKey: 'gameId' });
User.hasMany(GameChatMessage, { foreignKey: 'userId', onDelete: 'CASCADE' });
GameChatMessage.belongsTo(User, { foreignKey: 'userId' });

Tournament.hasMany(StandingsTiebreak, { foreignKey: 'tournamentId', onDelete: 'CASCADE' });
StandingsTiebreak.belongsTo(Tournament, { foreignKey: 'tournamentId' });
StandingsTiebreak.belongsTo(Game, { foreignKey: 'gameId' });


User.hasMany(UserTrophy, { foreignKey: 'userId', onDelete: 'CASCADE' });
UserTrophy.belongsTo(User, { foreignKey: 'userId' });
Tournament.hasMany(UserTrophy, { foreignKey: 'tournamentId', onDelete: 'CASCADE' });
UserTrophy.belongsTo(Tournament, { foreignKey: 'tournamentId' });

Game.hasMany(RouletteEvent, { foreignKey: 'gameId', onDelete: 'CASCADE' });
RouletteEvent.belongsTo(Game, { foreignKey: 'gameId' });
User.hasMany(RouletteEvent, { as: 'rouletteEvents', foreignKey: 'userId', onDelete: 'CASCADE' });
RouletteEvent.belongsTo(User, { as: 'player', foreignKey: 'userId' });
User.hasMany(RouletteEvent, { as: 'rouletteTargetEvents', foreignKey: 'targetUserId', onDelete: 'SET NULL' });
RouletteEvent.belongsTo(User, { as: 'target', foreignKey: 'targetUserId' });

ModerationReport.belongsTo(User, { as: 'reporter', foreignKey: 'reporterId' });
ModerationReport.belongsTo(User, { as: 'resolver', foreignKey: 'resolvedById' });
ModerationAction.belongsTo(User, { as: 'moderator', foreignKey: 'moderatorId' });
ModerationAction.belongsTo(User, { as: 'targetUser', foreignKey: 'targetUserId' });

module.exports = {
  sequelize, User, Team, Tournament, TournamentParticipant, TournamentInvitation,
  Match, Game, Question, GameQuestion, QuestionReport, UserKnowledgeStat,
  PlayerGameStat, GameChatMessage, StandingsTiebreak, UserTrophy, RouletteEvent, ModerationReport, ModerationAction
};
