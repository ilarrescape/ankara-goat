const { Op, Sequelize } = require('sequelize');
const { Question, GameQuestion, Game, Tournament, Match } = require('../models');
const { shuffle } = require('../utils/random');
const { chooseTier, normalizeMode } = require('./questionTiers');
const { allowedQuestionTiers } = require('./tournamentRules');
const { getRedis } = require('../config/redis');

const CANDIDATE_POOL_SIZE = 160;

function publicQuestion(question) {
  const q = question.toJSON ? question.toJSON() : question;
  return {
    id: q.id, type: q.type, prompt: q.prompt,
    options: q.type === 'multiple_choice' ? shuffle(q.options || []) : q.options,
    category: q.category, competition: q.competition, knowledgeArea: q.knowledgeArea,
    tier: q.tier, difficulty: q.difficulty
  };
}

async function tierUsage(gameId) {
  const rows = await GameQuestion.findAll({
    where: { gameId }, attributes: ['tierSnapshot'], raw: true
  });
  const counts = { 1: 0, 2: 0, 3: 0 };
  rows.forEach(row => { const tier = Number(row.tierSnapshot || 2); counts[tier] = (counts[tier] || 0) + 1; });
  return { counts, total: rows.length };
}

async function usedQuestionIds(gameId) {
  const redis = getRedis();
  const key = `ankara:game:${gameId}:questions`;
  if (redis) {
    const cached = await redis.smembers(key).catch(() => []);
    if (cached.length) return cached.map(Number);
  }
  const rows = await GameQuestion.findAll({ where: { gameId }, attributes: ['questionId'], raw: true });
  const ids = rows.map(r => Number(r.questionId));
  if (redis && ids.length) await redis.sadd(key, ...ids.map(String)).then(() => redis.expire(key, 24 * 3600)).catch(() => {});
  return ids;
}

async function candidateQuestions(where, limit = CANDIDATE_POOL_SIZE) {
  return Question.findAll({
    where,
    order: [
      [Sequelize.literal('last_used_at IS NULL'), 'DESC'],
      ['lastUsedAt', 'ASC'],
      ['timesShown', 'ASC'],
      ['id', 'ASC']
    ],
    limit
  });
}

async function registerQuestionUse(gameId, question) {
  const redis = getRedis();
  await GameQuestion.create({
    gameId, questionId: question.id, tierSnapshot: question.tier,
    difficultySnapshot: question.difficulty,
    knowledgeAreaSnapshot: question.knowledgeArea || question.competition || question.category || 'General'
  });
  await Question.update({ lastUsedAt: new Date(), timesShown: Sequelize.literal('times_shown + 1') }, { where: { id: question.id } });
  if (redis) {
    const key = `ankara:game:${gameId}:questions`;
    await redis.multi().sadd(key, String(question.id)).expire(key, 24 * 3600).exec().catch(() => {});
  }
}

async function competitiveTierContext(game) {
  if (!game.tournamentId || !game.matchId) return null;
  const settings = game.state?.settings || {};
  if (settings.tournamentFormat && settings.tournamentStage) {
    return { format: settings.tournamentFormat, participantCount: Number(settings.tournamentParticipantCount || 0), stage: settings.tournamentStage };
  }
  const [tournament, match] = await Promise.all([
    Tournament.findByPk(game.tournamentId, { attributes: ['id','format'] }),
    Match.findByPk(game.matchId, { attributes: ['id','stage'] })
  ]);
  if (!tournament || !match) return null;
  return { format: tournament.format, participantCount: Number(settings.tournamentParticipantCount || 0), stage: match.stage };
}

async function drawQuestion(gameId, { preferredQuestionId = null } = {}) {
  const game = await Game.findByPk(gameId, { attributes: ['id','state','tournamentId','matchId'] });
  if (!game) throw new Error('Partida inexistente.');
  const usedIds = await usedQuestionIds(gameId);
  const usedSet = new Set(usedIds);
  const usage = await tierUsage(gameId);
  const mode = normalizeMode(game.state?.settings?.questionMode);
  const desiredTier = chooseTier(mode, usage.counts, usage.total);
  const comp = await competitiveTierContext(game);
  const restrictedTiers = comp && comp.participantCount ? allowedQuestionTiers(comp) : [1,2,3];
  const preferredTiers = restrictedTiers.includes(desiredTier) ? [desiredTier] : restrictedTiers;

  const baseWhere = { active: true, reviewStatus: 'published' };
  if (usedIds.length) baseWhere.id = { [Op.notIn]: usedIds };
  let question = null;

  if (preferredQuestionId && !usedSet.has(Number(preferredQuestionId))) {
    question = await Question.findOne({ where: { id: Number(preferredQuestionId), active: true, reviewStatus: 'published', tier: { [Op.in]: restrictedTiers } } });
  }

  for (const tiers of [preferredTiers, restrictedTiers]) {
    if (question) break;
    const candidates = await candidateQuestions({ ...baseWhere, tier: { [Op.in]: tiers } });
    if (candidates.length) question = candidates[Math.floor(Math.random() * candidates.length)];
  }

  // En fases con restricción competitiva no degradamos el tier: si el pool sin repetir se agotó,
  // repetimos una pregunta válida de esa dificultad antes que introducir una pregunta más fácil.
  if (!question && comp && restrictedTiers.length < 3) {
    const candidates = await candidateQuestions({ active: true, reviewStatus: 'published', tier: { [Op.in]: restrictedTiers } });
    if (candidates.length) question = candidates[Math.floor(Math.random() * candidates.length)];
  }

  if (!question) {
    const candidates = await candidateQuestions(baseWhere);
    if (candidates.length) question = candidates[Math.floor(Math.random() * candidates.length)];
  }
  if (!question) throw new Error('No quedan preguntas publicadas disponibles para esta partida.');

  // La constraint game_id + question_id sigue evitando una repetición accidental dentro de partida.
  // La excepción competitiva anterior sólo se alcanza si el pool permitido se agotó; en ese caso se
  // intenta reutilizar la pregunta menos reciente en otra partida, nunca la misma dentro de ésta.
  if (usedSet.has(Number(question.id))) throw new Error('El pool de preguntas permitido para esta fase se agotó dentro de la partida.');

  await registerQuestionUse(gameId, question);
  return { model: question, public: publicQuestion(question), desiredTier, allowedTiers: restrictedTiers, mode, reusedPreferredSlot: Number(question.id) === Number(preferredQuestionId) };
}

function normalize(value) {
  if (typeof value === 'string') return value.trim().toLocaleLowerCase('es');
  if (Array.isArray(value)) return value.map(normalize).sort();
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((acc, k) => { acc[k] = normalize(value[k]); return acc; }, {});
  return value;
}

function isCorrect(question, submittedAnswer) {
  return JSON.stringify(normalize(submittedAnswer)) === JSON.stringify(normalize(question.correctAnswer));
}

module.exports = { drawQuestion, publicQuestion, isCorrect, tierUsage, usedQuestionIds };
