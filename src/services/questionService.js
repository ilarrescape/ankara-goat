const { Op } = require('sequelize');
const { Question, GameQuestion, Game } = require('../models');
const { shuffle, randomInt } = require('../utils/random');
const { chooseTier, normalizeMode } = require('./questionTiers');

function publicQuestion(question) {
  const q = question.toJSON ? question.toJSON() : question;
  return {
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    options: q.type === 'multiple_choice' ? shuffle(q.options || []) : q.options,
    category: q.category,
    competition: q.competition,
    knowledgeArea: q.knowledgeArea,
    tier: q.tier,
    difficulty: q.difficulty
  };
}

async function tierUsage(gameId) {
  const rows = await GameQuestion.findAll({
    where: { gameId },
    include: [{ model: Question, attributes: ['tier'], required: true }],
    attributes: ['id'],
    raw: false
  });
  const counts = { 1: 0, 2: 0, 3: 0 };
  rows.forEach(row => {
    const tier = Number(row.Question?.tier || 2);
    counts[tier] = (counts[tier] || 0) + 1;
  });
  return { counts, total: rows.length };
}

async function randomQuestionFromWhere(where) {
  const count = await Question.count({ where });
  if (!count) return null;
  const offset = randomInt(0, count - 1);
  return Question.findOne({ where, offset, order: [['id', 'ASC']] });
}

async function drawQuestion(gameId) {
  const game = await Game.findByPk(gameId, { attributes: ['id','state'] });
  if (!game) throw new Error('Partida inexistente.');

  const used = await GameQuestion.findAll({ where: { gameId }, attributes: ['questionId'], raw: true });
  const usedIds = used.map(r => r.questionId);
  const usage = await tierUsage(gameId);
  const mode = normalizeMode(game.state?.settings?.questionMode);
  const desiredTier = chooseTier(mode, usage.counts, usage.total);

  const baseWhere = { active: true, reviewStatus: 'published' };
  if (usedIds.length) baseWhere.id = { [Op.notIn]: usedIds };

  let question = await randomQuestionFromWhere({ ...baseWhere, tier: desiredTier });
  if (!question) question = await randomQuestionFromWhere(baseWhere);
  if (!question) throw new Error('No quedan preguntas publicadas sin repetir para esta partida.');

  await GameQuestion.create({
    gameId,
    questionId: question.id,
    tierSnapshot: question.tier,
    difficultySnapshot: question.difficulty,
    knowledgeAreaSnapshot: question.knowledgeArea || question.competition || question.category || 'General'
  });

  return { model: question, public: publicQuestion(question), desiredTier, mode };
}

function normalize(value) {
  if (typeof value === 'string') return value.trim().toLocaleLowerCase('es');
  if (Array.isArray(value)) return value.map(normalize).sort();
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, k) => { acc[k] = normalize(value[k]); return acc; }, {});
  }
  return value;
}

function isCorrect(question, submittedAnswer) {
  return JSON.stringify(normalize(submittedAnswer)) === JSON.stringify(normalize(question.correctAnswer));
}

module.exports = { drawQuestion, publicQuestion, isCorrect, tierUsage };
