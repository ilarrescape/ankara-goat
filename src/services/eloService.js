const { Op } = require('sequelize');
const { User } = require('../models');
const { getRedis } = require('../config/redis');

const ELO_MIN = 200;
const FIRST_DECAY_MS = 7 * 24 * 60 * 60 * 1000;
const DECAY_STEP_MS = 48 * 60 * 60 * 1000;
const DECAY_POINTS = 12;

function decaySteps({ lastRankedGameAt, lastEloDecayAt, now = Date.now() }) {
  const ranked = lastRankedGameAt ? new Date(lastRankedGameAt).getTime() : 0;
  if (!ranked || now < ranked + FIRST_DECAY_MS) return 0;
  const firstAt = ranked + FIRST_DECAY_MS;
  const alreadyAt = lastEloDecayAt ? new Date(lastEloDecayAt).getTime() : 0;
  if (!alreadyAt || alreadyAt < firstAt) return 1 + Math.floor((now - firstAt) / DECAY_STEP_MS);
  if (now < alreadyAt + DECAY_STEP_MS) return 0;
  return Math.floor((now - alreadyAt) / DECAY_STEP_MS);
}

async function applyEloDecayForUser(userOrId, { transaction = null, now = Date.now() } = {}) {
  const user = typeof userOrId === 'object' ? userOrId : await User.findByPk(Number(userOrId), { transaction });
  if (!user) return null;
  const steps = decaySteps({ lastRankedGameAt: user.lastRankedGameAt, lastEloDecayAt: user.lastEloDecayAt, now });
  if (!steps || user.eloRating <= ELO_MIN) return { user, steps: 0, deducted: 0 };
  const before = Number(user.eloRating);
  const after = Math.max(ELO_MIN, before - steps * DECAY_POINTS);
  const deducted = before - after;
  if (deducted > 0) {
    user.eloRating = after;
    user.lastEloDecayAt = new Date(now);
    await user.save({ transaction });
  }
  return { user, steps, deducted };
}

async function applyEloDecayBatch({ limit = 250 } = {}) {
  const redis = getRedis();
  const lockKey = 'ankara:elo-decay:batch-lock';
  let locked = true;
  if (redis) locked = await redis.set(lockKey, String(process.pid), 'NX', 'EX', 300);
  if (!locked) return { processed: 0, locked: true };
  try {
    const threshold = new Date(Date.now() - FIRST_DECAY_MS);
    const users = await User.findAll({
      where: { accountStatus: 'active', eloRating: { [Op.gt]: ELO_MIN }, lastRankedGameAt: { [Op.lte]: threshold } },
      order: [['lastEloDecayAt', 'ASC'], ['lastRankedGameAt', 'ASC']],
      limit
    });
    let deducted = 0;
    for (const user of users) deducted += (await applyEloDecayForUser(user))?.deducted || 0;
    return { processed: users.length, deducted };
  } finally {
    if (redis) await redis.del(lockKey).catch(() => {});
  }
}

module.exports = { ELO_MIN, FIRST_DECAY_MS, DECAY_STEP_MS, DECAY_POINTS, decaySteps, applyEloDecayForUser, applyEloDecayBatch };
