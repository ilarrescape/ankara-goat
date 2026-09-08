const express = require('express');
const { Op } = require('sequelize');
const { sequelize, Tournament, TournamentParticipant, TournamentInvitation, Match, Game, User, Team, StandingsTiebreak } = require('../models');
const auth = require('../middleware/auth');
const { validateBoardSize, buildSchedule } = require('../services/tournamentService');
const { roomCode } = require('../utils/random');
const { sortStandings, serializeStanding } = require('../services/standingsService');

const router = express.Router();
router.use(auth);

async function uniqueRoomCode() {
  for (let i = 0; i < 10; i++) {
    const code = roomCode();
    if (!(await Game.findOne({ where: { roomCode: code } }))) return code;
  }
  throw new Error('No se pudo generar un código de sala.');
}

router.post('/', async (req, res, next) => {
  try {
    const { name, format, boardSize = 40, settings = {}, participantIds = [] } = req.body;
    validateBoardSize(Number(boardSize));
    if (!name?.trim()) return res.status(400).json({ error: 'El torneo necesita un nombre.' });
    const invitedIds = [...new Set(participantIds.map(Number).filter(id => id && id !== req.user.id))];
    const users = invitedIds.length ? await User.count({ where: { id: invitedIds } }) : 0;
    if (users !== invitedIds.length) return res.status(400).json({ error: 'Uno o más invitados no existen.' });

    const result = await sequelize.transaction(async transaction => {
      const tournament = await Tournament.create({ name: name.trim(), format, boardSize: Number(boardSize), settings, organizerId: req.user.id, status: 'open' }, { transaction });
      await TournamentParticipant.create({ tournamentId: tournament.id, userId: req.user.id, seed: 1 }, { transaction });
      const invitations = invitedIds.length ? await TournamentInvitation.bulkCreate(invitedIds.map(inviteeId => ({
        tournamentId: tournament.id,
        inviterId: req.user.id,
        inviteeId,
        status: 'pending'
      })), { transaction }) : [];
      return { tournament, invitations };
    });
    res.status(201).json(result);
  } catch (e) { next(e); }
});

router.get('/', async (req, res, next) => {
  try {
    const participating = await Tournament.findAll({
      include: [{ model: TournamentParticipant, where: { userId: req.user.id }, required: true }],
      order: [['createdAt','DESC']]
    });
    const pendingInvites = await TournamentInvitation.findAll({
      where: { inviteeId: req.user.id, status: 'pending' },
      include: [{ model: Tournament }, { model: User, as: 'inviter', attributes: ['id','username'] }],
      order: [['createdAt','DESC']]
    });
    res.json({ tournaments: participating, pendingInvites });
  } catch (e) { next(e); }
});

router.post('/invitations/:id/accept', async (req, res, next) => {
  try {
    const invitation = await TournamentInvitation.findByPk(Number(req.params.id));
    if (!invitation || invitation.inviteeId !== req.user.id) return res.status(404).json({ error: 'Invitación inexistente.' });
    if (invitation.status !== 'pending') throw new Error('La invitación ya fue respondida.');
    const tournament = await Tournament.findByPk(invitation.tournamentId);
    if (!tournament || tournament.status !== 'open') throw new Error('El torneo ya no acepta participantes.');
    await sequelize.transaction(async transaction => {
      invitation.status = 'accepted';
      invitation.respondedAt = new Date();
      await invitation.save({ transaction });
      const count = await TournamentParticipant.count({ where: { tournamentId: invitation.tournamentId }, transaction });
      await TournamentParticipant.findOrCreate({
        where: { tournamentId: invitation.tournamentId, userId: req.user.id },
        defaults: { seed: count + 1 },
        transaction
      });
    });
    res.json(invitation);
  } catch (e) { next(e); }
});

router.post('/invitations/:id/decline', async (req, res, next) => {
  try {
    const invitation = await TournamentInvitation.findByPk(Number(req.params.id));
    if (!invitation || invitation.inviteeId !== req.user.id) return res.status(404).json({ error: 'Invitación inexistente.' });
    if (invitation.status !== 'pending') throw new Error('La invitación ya fue respondida.');
    invitation.status = 'declined';
    invitation.respondedAt = new Date();
    await invitation.save();
    res.json(invitation);
  } catch (e) { next(e); }
});

router.post('/:id/start', async (req, res, next) => {
  try {
    const tournament = await Tournament.findByPk(Number(req.params.id));
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado.' });
    if (tournament.organizerId !== req.user.id) return res.status(403).json({ error: 'Solo el organizador puede generar el calendario.' });
    if (tournament.status !== 'open') throw new Error('El torneo ya no puede generar un calendario nuevo.');

    const participants = await TournamentParticipant.findAll({ where: { tournamentId: tournament.id }, order: [['seed','ASC']] });
    const ids = participants.map(p => p.userId);
    const built = buildSchedule(tournament.format, ids, tournament.settings || {});

    await sequelize.transaction(async transaction => {
      await Match.destroy({ where: { tournamentId: tournament.id }, transaction });
      await TournamentParticipant.update({ groupCode: null, points: 0, played: 0, wins: 0, draws: 0, losses: 0, positionPoints: 0, correctAnswers: 0, incorrectAnswers: 0, tiebreakRank: null, eliminated: false }, { where: { tournamentId: tournament.id }, transaction });
      if (built.groups) {
        for (let gi = 0; gi < built.groups.length; gi++) {
          const code = String.fromCharCode(65 + gi);
          await TournamentParticipant.update({ groupCode: code }, { where: { tournamentId: tournament.id, userId: built.groups[gi] }, transaction });
        }
      }
      await Match.bulkCreate(built.matches.map(m => ({ ...m, tournamentId: tournament.id })), { transaction });
      tournament.status = 'running';
      await tournament.save({ transaction });
    });
    res.json({ tournament, schedule: built });
  } catch (e) { next(e); }
});

router.post('/:id/matches/:matchId/game', async (req, res, next) => {
  try {
    const tournament = await Tournament.findByPk(Number(req.params.id));
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado.' });
    if (tournament.organizerId !== req.user.id) return res.status(403).json({ error: 'Solo el organizador puede abrir partidos.' });
    const match = await Match.findOne({ where: { id: Number(req.params.matchId), tournamentId: tournament.id } });
    if (!match) return res.status(404).json({ error: 'Partido inexistente.' });
    if (!Array.isArray(match.participants) || match.participants.length < 2) throw new Error('Este cruce todavía no tiene participantes resueltos.');
    const existing = await Game.findOne({ where: { matchId: match.id } });
    if (existing) return res.json(existing);

    const users = await User.findAll({ where: { id: match.participants }, attributes: ['id','username','eloRating','level'], include: [Team] });
    const players = match.participants.map(id => {
      const u = users.find(x => x.id === id);
      return {
        userId: u.id, username: u.username, eloRating: u.eloRating, level: u.level,
        team: u.Team ? { id: u.Team.id, name: u.Team.name, crestEmoji: u.Team.crestEmoji, crestUrl: u.Team.crestUrl, primaryColor: u.Team.primaryColor, secondaryColor: u.Team.secondaryColor, shirtPattern: u.Team.shirtPattern } : null
      };
    });
    const code = await uniqueRoomCode();
    const game = await Game.create({
      roomCode: code,
      name: `${tournament.name} · R${match.roundNo}`,
      boardSize: tournament.boardSize,
      tournamentId: tournament.id,
      matchId: match.id,
      state: { boardSize: tournament.boardSize, phase: 'lobby', players, organizerId: req.user.id, settings: { questionMode: tournament.settings?.questionMode || 'ankara' } },
      status: 'lobby'
    });
    match.status = 'ready';
    await match.save();
    res.status(201).json(game);
  } catch (e) { next(e); }
});


router.post('/:id/tiebreaks/:tiebreakId/game', async (req, res, next) => {
  try {
    const tournament = await Tournament.findByPk(Number(req.params.id));
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado.' });
    if (tournament.organizerId !== req.user.id) return res.status(403).json({ error: 'Solo el organizador puede abrir desempates.' });
    const tie = await StandingsTiebreak.findOne({ where: { id:Number(req.params.tiebreakId), tournamentId:tournament.id } });
    if (!tie) return res.status(404).json({ error: 'Desempate inexistente.' });
    if (tie.status === 'resolved') return res.status(409).json({ error: 'Este desempate ya fue resuelto.' });
    const ids = (tie.userIds || []).map(Number);
    if (ids.length < 2) throw new Error('El desempate no tiene suficientes participantes.');
    if (ids.length > 14) throw new Error('Un desempate no puede superar los 14 participantes de una liga.');
    if (tie.gameId) {
      const existing = await Game.findByPk(tie.gameId);
      if (existing) return res.json(existing);
    }
    const users = await User.findAll({ where:{ id:ids }, attributes:['id','username','eloRating','level'], include:[Team] });
    const players = ids.map(id => {
      const u=users.find(x=>x.id===id);
      return { userId:u.id, username:u.username, eloRating:u.eloRating, level:u.level, team:u.Team ? { id:u.Team.id, name:u.Team.name, crestEmoji:u.Team.crestEmoji, crestUrl:u.Team.crestUrl, primaryColor:u.Team.primaryColor, secondaryColor:u.Team.secondaryColor, shirtPattern:u.Team.shirtPattern } : null };
    });
    const code=await uniqueRoomCode();
    const game=await Game.create({ roomCode:code, name:`${tournament.name} · Desempate${tie.groupCode?` Grupo ${tie.groupCode}`:''}`, boardSize:tournament.boardSize, tournamentId:tournament.id, state:{ boardSize:tournament.boardSize, phase:'lobby', players, organizerId:req.user.id, settings:{ questionMode:tournament.settings?.questionMode||'ankara', standingsTiebreakId:tie.id, isStandingsTiebreak:true } }, status:'lobby' });
    tie.gameId=game.id; tie.status='running'; await tie.save();
    res.status(201).json(game);
  } catch(e){ next(e); }
});

router.get('/:id/standings', async (req, res, next) => {
  try {
    const tournament=await Tournament.findByPk(Number(req.params.id));
    if(!tournament) return res.status(404).json({error:'Torneo no encontrado.'});
    const rows=await TournamentParticipant.findAll({ where:{tournamentId:tournament.id}, include:[{model:User,attributes:['id','username','eloRating','level'],include:[Team]}] });
    const ties=await StandingsTiebreak.findAll({ where:{tournamentId:tournament.id}, order:[['groupCode','ASC'],['createdAt','ASC']] });
    const groups={};
    const codes=tournament.format==='group_knockout'?[...new Set(rows.map(r=>r.groupCode).filter(Boolean))]:[null];
    for(const code of codes){
      const subset=code?rows.filter(r=>r.groupCode===code):rows;
      const resolved=new Map(ties.filter(t=>t.status==='resolved'&&(code?t.groupCode===code:t.scope==='final')).map(t=>[t.signature,(t.resolvedOrder||[]).map(Number)]));
      const sorted=sortStandings(subset,resolved);
      groups[code||'overall']=sorted.map((r,i)=>({ ...serializeStanding(r,i+1), username:r.User?.username, team:r.User?.Team||null, eloRating:r.User?.eloRating, exactTiePending:ties.some(t=>t.status!=='resolved'&&(t.userIds||[]).map(Number).includes(Number(r.userId))) }));
    }
    res.json({format:tournament.format,groups,tiebreaks:ties});
  }catch(e){next(e)}
});

router.get('/:id', async (req, res, next) => {
  try {
    const t = await Tournament.findByPk(req.params.id, {
      include: [
        { model: TournamentParticipant, include: [{ model: User, attributes: ['id','username','eloRating','level'], include: [Team] }] },
        { model: TournamentInvitation, include: [{ model: User, as: 'invitee', attributes: ['id','username'] }] },
        { model: Match },
        { model: StandingsTiebreak }
      ],
      order: [[Match, 'roundNo', 'ASC'], [Match, 'slot', 'ASC']]
    });
    if (!t) return res.status(404).json({ error: 'Torneo no encontrado.' });
    const isParticipant = t.TournamentParticipants?.some(p => p.userId === req.user.id);
    const isInvitee = t.TournamentInvitations?.some(i => i.inviteeId === req.user.id);
    if (!isParticipant && !isInvitee && t.organizerId !== req.user.id) return res.status(403).json({ error: 'No tenés acceso a este torneo.' });
    res.json(t);
  } catch (e) { next(e); }
});

module.exports = router;
