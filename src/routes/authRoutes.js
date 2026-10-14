const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Team } = require('../models');
const auth = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimits');
const { POLICY_VERSION, publicPolicy } = require('../services/moderationPolicy');
const { validateTeamName } = require('../services/contentModeration');
const { applyEloDecayForUser } = require('../services/eloService');

const router = express.Router();

function tokenFor(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function roleFor(email) {
  const normalized = String(email || '').trim().toLowerCase();
  const admins = String(process.env.ADMIN_EMAILS || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  const moderators = String(process.env.MODERATOR_EMAILS || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  if (admins.includes(normalized)) return 'admin';
  if (moderators.includes(normalized)) return 'moderator';
  return 'user';
}

router.get('/moderation-policy', (req, res) => res.json(publicPolicy()));

router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const { username, email, password, teamName, acceptModerationPolicy, policyVersion } = req.body;
    if (!username || !email || !password || !teamName) return res.status(400).json({ error: 'Completá usuario, email, contraseña y nombre de equipo.' });
    if (![true, 'true', 'on', '1', 1].includes(acceptModerationPolicy)) return res.status(400).json({ error: 'Debés aceptar la política de convivencia y moderación para registrarte.' });
    if (policyVersion && policyVersion !== POLICY_VERSION) return res.status(409).json({ error: 'La política fue actualizada. Recargá la página y volvé a aceptarla.' });
    if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
    const normalizedEmail = email.trim().toLowerCase();
    const exists = await User.findOne({ where: { email: normalizedEmail } }) || await User.findOne({ where: { username: username.trim() } });
    if (exists) return res.status(409).json({ error: 'El email o nombre de usuario ya existe.' });
    const safeTeamName = validateTeamName(teamName);
    const user = await User.create({ username: username.trim(), email: normalizedEmail, passwordHash: await bcrypt.hash(password, 12), role: roleFor(normalizedEmail), moderationPolicyVersion: POLICY_VERSION, moderationPolicyAcceptedAt: new Date() });
    const team = await Team.create({ userId: user.id, name: safeTeamName, moderationStatus: 'approved' });
    res.status(201).json({ token: tokenFor(user), user: { id: user.id, username: user.username, email: user.email, role: user.role, eloRating: user.eloRating, level: user.level }, team });
  } catch (e) { next(e); }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ where: { email: String(email || '').trim().toLowerCase() }, include: Team });
    if (!user || !(await bcrypt.compare(password || '', user.passwordHash))) return res.status(401).json({ error: 'Credenciales incorrectas.' });
    if (user.accountStatus === 'suspended') return res.status(403).json({ error: 'La cuenta está suspendida por moderación.' });
    await applyEloDecayForUser(user);
    user.lastSeenAt = new Date();
    await user.save();
    res.json({ token: tokenFor(user), user: { id: user.id, username: user.username, email: user.email, role: user.role, eloRating: user.eloRating, xp: user.xp, level: user.level }, team: user.Team });
  } catch (e) { next(e); }
});

router.get('/me', auth, async (req, res, next) => {
  try {
    let user = await User.findByPk(req.user.id, { attributes: ['id','username','email','role','eloRating','xp','level','moderationPolicyVersion','moderationPolicyAcceptedAt','chatMutedUntil','accountStatus','lastRankedGameAt','lastEloDecayAt'], include: Team });
    if(user){await applyEloDecayForUser(user);}
    res.json(user);
  } catch (e) { next(e); }
});

module.exports = router;
