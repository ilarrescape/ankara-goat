const { Team, User, ModerationAction } = require('../models');

function normalizeText(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9@._\- ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function configuredBlocklist() {
  return String(process.env.MODERATION_BLOCKLIST || '')
    .split(',').map(normalizeText).filter(Boolean);
}

function findBlockedTerm(value) {
  const normalized = normalizeText(value);
  return configuredBlocklist().find(term => normalized.includes(term)) || null;
}

function validateTeamName(name) {
  const value = String(name || '').trim();
  if (value.length < 2 || value.length > 60) throw new Error('El nombre del equipo debe tener entre 2 y 60 caracteres.');
  if (/https?:\/\//i.test(value)) throw new Error('El nombre del equipo no puede contener enlaces.');
  if (/\b\d{7,}\b/.test(value)) throw new Error('El nombre del equipo no puede contener números que parezcan datos personales.');
  const blocked = findBlockedTerm(value);
  if (blocked) throw new Error('Ese nombre contiene un término bloqueado por moderación.');
  return value;
}

function validateChatMessage(body) {
  const value = String(body || '').trim().slice(0, 500);
  if (!value) throw new Error('El mensaje está vacío.');
  if (/(?:https?:\/\/\S+){3,}/i.test(value)) throw new Error('Demasiados enlaces en un mismo mensaje.');
  const blocked = findBlockedTerm(value);
  if (blocked) throw new Error('El mensaje contiene un término bloqueado por moderación.');
  return value;
}

async function assertUserCanChat(userId) {
  const user = await User.findByPk(userId, { attributes: ['id','accountStatus','chatMutedUntil'] });
  if (!user || user.accountStatus === 'suspended') throw new Error('La cuenta está suspendida.');
  if (user.chatMutedUntil && new Date(user.chatMutedUntil).getTime() > Date.now()) {
    throw new Error(`Tenés el chat silenciado hasta ${new Date(user.chatMutedUntil).toISOString()}.`);
  }
  return user;
}

async function markTeamPending(userId, reason = null) {
  const team = await Team.findOne({ where: { userId } });
  if (!team) return null;
  team.moderationStatus = 'pending';
  team.moderationReason = reason;
  await team.save();
  return team;
}

async function logModerationAction({ moderatorId, targetUserId = null, targetType, targetId, action, reason, expiresAt = null, transaction = undefined }) {
  return ModerationAction.create({ moderatorId, targetUserId, targetType, targetId, action, reason, expiresAt }, { transaction });
}

module.exports = { normalizeText, validateTeamName, validateChatMessage, assertUserCanChat, markTeamPending, logModerationAction };
