const { User, UserKnowledgeStat } = require('../models');

const slug = value => String(value || 'general').trim().toLowerCase().replace(/[^a-z0-9áéíóúñü]+/gi, '_').replace(/^_+|_+$/g, '') || 'general';

function levelFromXp(xp) {
  return Math.max(1, Math.floor(Number(xp || 0) / 500) + 1);
}

function xpForAnswer(question, correct) {
  const base = correct ? 10 : 2;
  const difficulty = Number(question.difficulty || 1);
  const tier = Number(question.tier || 1);
  return base + (correct ? difficulty * 2 + tier * 3 : 0);
}

async function updateKnowledgeForAnswer({ userId, question, correct, transaction }) {
  const label = question.knowledgeArea || question.competition || question.category || 'General';
  const key = slug(label);
  const [stat] = await UserKnowledgeStat.findOrCreate({
    where: { userId, key },
    defaults: { userId, key, label, answered: 0, correct: 0, accuracy: 0 },
    transaction
  });
  stat.label = label;
  stat.answered += 1;
  if (correct) stat.correct += 1;
  stat.accuracy = stat.answered ? Number(((stat.correct / stat.answered) * 100).toFixed(2)) : 0;
  stat.lastAnsweredAt = new Date();
  await stat.save({ transaction });

  const user = await User.findByPk(userId, { transaction, lock: transaction?.LOCK?.UPDATE });
  if (user) {
    const earned = xpForAnswer(question, correct);
    user.xp += earned;
    user.level = levelFromXp(user.xp);
    await user.save({ transaction });
    return { stat, earnedXp: earned, level: user.level, xp: user.xp };
  }
  return { stat, earnedXp: 0 };
}

module.exports = { updateKnowledgeForAnswer, levelFromXp, xpForAnswer };
