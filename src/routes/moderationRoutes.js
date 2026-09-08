const express = require('express');
const { Op } = require('sequelize');
const { User, Team, GameChatMessage, ModerationReport, ModerationAction } = require('../models');
const auth = require('../middleware/auth');
const moderator = require('../middleware/moderator');
const { publicPolicy } = require('../services/moderationPolicy');
const { logModerationAction } = require('../services/contentModeration');

const router = express.Router();

router.get('/policy', (req, res) => res.json(publicPolicy()));

router.post('/reports', auth, async (req, res, next) => {
  try {
    const targetType = String(req.body.targetType || '');
    const targetId = Number(req.body.targetId);
    const allowedTypes = ['team_name','chat_message'];
    const allowedReasons = ['offensive','hate','harassment','sexual','spam','impersonation','personal_data','other'];
    if (!allowedTypes.includes(targetType) || !targetId) return res.status(400).json({ error: 'Objetivo de reporte inválido.' });
    const reason = allowedReasons.includes(req.body.reason) ? req.body.reason : 'other';
    if (targetType === 'team_name' && !(await Team.findByPk(targetId))) return res.status(404).json({ error: 'Equipo inexistente.' });
    if (targetType === 'chat_message' && !(await GameChatMessage.findByPk(targetId))) return res.status(404).json({ error: 'Mensaje inexistente.' });
    const row = await ModerationReport.create({ reporterId: req.user.id, targetType, targetId, reason, details: String(req.body.details || '').slice(0,1000) || null });
    res.status(201).json(row);
  } catch (e) { next(e); }
});

router.use(auth, moderator);

router.get('/queue', async (req, res, next) => {
  try {
    const where = req.query.status ? { status: req.query.status } : { status: 'open' };
    const reports = await ModerationReport.findAll({ where, include: [{ model: User, as: 'reporter', attributes: ['id','username'] }], order: [['createdAt','ASC']], limit: 300 });
    const teamIds = reports.filter(r => r.targetType === 'team_name').map(r => Number(r.targetId));
    const messageIds = reports.filter(r => r.targetType === 'chat_message').map(r => Number(r.targetId));
    const [teams, messages] = await Promise.all([
      teamIds.length ? Team.findAll({ where: { id: { [Op.in]: teamIds } }, include: [{ model: User, attributes:['id','username','accountStatus','chatMutedUntil'] }] }) : [],
      messageIds.length ? GameChatMessage.findAll({ where: { id: { [Op.in]: messageIds } }, include: [{ model: User, attributes:['id','username','accountStatus','chatMutedUntil'] }] }) : []
    ]);
    res.json({ reports, teams, messages });
  } catch (e) { next(e); }
});

router.post('/actions', async (req, res, next) => {
  try {
    const { action, targetType, targetId, reason } = req.body;
    const cleanReason = String(reason || '').trim().slice(0,1000);
    if (!cleanReason) return res.status(400).json({ error: 'La acción necesita un motivo.' });

    const allowedByTarget = {
      chat_message: ['warning','hide_message','mute_chat','suspend_user'],
      team: ['warning','reject_team_name','mute_chat','suspend_user'],
      user: ['warning','mute_chat','unmute_chat','suspend_user','restore_user']
    };
    if (!allowedByTarget[targetType]?.includes(action)) return res.status(400).json({ error: 'Acción de moderación inválida para ese objetivo.' });

    let targetUserId = null;
    let targetRecord = null;
    if (targetType === 'chat_message') {
      targetRecord = await GameChatMessage.findByPk(Number(targetId));
      if (!targetRecord) return res.status(404).json({ error: 'Mensaje inexistente.' });
      targetUserId = targetRecord.userId;
    } else if (targetType === 'team') {
      targetRecord = await Team.findByPk(Number(targetId));
      if (!targetRecord) return res.status(404).json({ error: 'Equipo inexistente.' });
      targetUserId = targetRecord.userId;
    } else if (targetType === 'user') {
      targetUserId = Number(targetId);
    }

    const user = targetUserId ? await User.findByPk(targetUserId) : null;
    if (!user) return res.status(404).json({ error: 'Usuario objetivo inexistente.' });
    if (Number(user.id) === Number(req.user.id)) return res.status(400).json({ error: 'No podés moderar tu propia cuenta.' });
    if (req.user.role === 'moderator' && user.role !== 'user') {
      return res.status(403).json({ error: 'Un moderador no puede sancionar a otro moderador ni a un administrador. Escalá el caso a un admin.' });
    }

    let expiresAt = null;
    if (targetType === 'chat_message' && action === 'hide_message') {
      targetRecord.moderationStatus = 'hidden';
      targetRecord.moderationReason = cleanReason;
      await targetRecord.save();
    }
    if (targetType === 'team' && action === 'reject_team_name') {
      targetRecord.moderationStatus = 'rejected';
      targetRecord.moderationReason = cleanReason;
      await targetRecord.save();
    }
    if (action === 'mute_chat') {
      const minutes = Math.max(1, Math.min(43200, Number(req.body.minutes || 60)));
      expiresAt = new Date(Date.now() + minutes * 60000);
      user.chatMutedUntil = expiresAt;
      await user.save();
    }
    if (action === 'unmute_chat') { user.chatMutedUntil = null; await user.save(); }
    if (action === 'suspend_user') { user.accountStatus = 'suspended'; await user.save(); }
    if (action === 'restore_user') { user.accountStatus = 'active'; await user.save(); }

    const row = await logModerationAction({ moderatorId: req.user.id, targetUserId, targetType, targetId: Number(targetId), action, reason: cleanReason, expiresAt });
    if (req.body.reportId) {
      const report = await ModerationReport.findByPk(Number(req.body.reportId));
      if (report) { report.status = 'resolved'; report.resolvedById = req.user.id; report.resolution = cleanReason; report.resolvedAt = new Date(); await report.save(); }
    }
    res.json(row);
  } catch (e) { next(e); }
});

router.get('/actions', async (req, res, next) => {
  try {
    const rows = await ModerationAction.findAll({ include: [{ model: User, as:'moderator', attributes:['id','username'] }, { model: User, as:'targetUser', attributes:['id','username'] }], order:[['createdAt','DESC']], limit:300 });
    res.json(rows);
  } catch (e) { next(e); }
});

module.exports = router;
