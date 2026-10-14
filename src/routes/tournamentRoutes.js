const express = require('express');
const { Op } = require('sequelize');
const { sequelize, Tournament, TournamentParticipant, TournamentInvitation, Match, Game, User, Team, StandingsTiebreak } = require('../models');
const auth = require('../middleware/auth');
const { validateBoardSize, buildSchedule } = require('../services/tournamentService');
const { validateTournamentSettings, trophyTier, trophyAsset, STATUS_LABELS } = require('../services/tournamentRules');
const { roomCode } = require('../utils/random');
const { sortStandings, serializeStanding } = require('../services/standingsService');
const { latestActivity, tournamentManagementPolicy } = require('../services/tournamentManagementService');
const { ensureShareCode } = require('../services/publicShareService');

const router = express.Router();
router.use(auth);

async function uniqueRoomCode() {
  for (let i = 0; i < 10; i++) {
    const code = roomCode();
    if (!(await Game.findOne({ where: { roomCode: code } }))) return code;
  }
  throw new Error('No se pudo generar un código de sala.');
}

async function uniqueAccessCode() {
  for (let i=0;i<12;i++) {
    const code=roomCode();
    if (!(await Tournament.findOne({where:{accessCode:code}}))) return code;
  }
  throw new Error('No se pudo generar una clave de acceso para el torneo.');
}

function tournamentJson(t) {
  const plain=t?.toJSON?t.toJSON():t;
  return { ...plain, statusLabel:STATUS_LABELS[plain.status]||plain.status };
}

async function tournamentManagement(tournament, transaction = null) {
  const query = transaction ? { transaction } : {};
  const [playedMatches, finishedGames, activeGames, latestMatch, latestGame] = await Promise.all([
    Match.count({ where: { tournamentId: tournament.id, status: 'finished' }, ...query }),
    Game.count({ where: { tournamentId: tournament.id, status: 'finished' }, ...query }),
    Game.count({ where: { tournamentId: tournament.id, status: 'running' }, ...query }),
    Match.findOne({ where: { tournamentId: tournament.id }, attributes: ['updatedAt'], order: [['updatedAt','DESC']], ...query }),
    Game.findOne({ where: { tournamentId: tournament.id }, attributes: ['updatedAt'], order: [['updatedAt','DESC']], ...query })
  ]);

  const lastActivityAt = latestActivity(tournament.updatedAt, latestMatch?.updatedAt, latestGame?.updatedAt);
  return tournamentManagementPolicy({
    status: tournament.status,
    hasPlayedMatches: playedMatches > 0 || finishedGames > 0,
    hasActiveGame: activeGames > 0,
    lastActivityAt
  });
}

function normalizeTournamentPayload(body, organizerId) {
  const { name, format, boardSize = 40, settings = {}, participantIds = [] } = body || {};
  validateBoardSize(Number(boardSize));
  if (!name?.trim()) throw new Error('El torneo necesita un nombre.');
  const formats = new Set(['league_1v1','shared_board_league','group_knockout','cup']);
  if (!formats.has(format)) throw new Error('Formato de torneo inválido.');
  const invitedIds = [...new Set((participantIds || []).map(Number).filter(id => id && id !== Number(organizerId)))];
  const maxParticipants = Number(settings.maxParticipants || invitedIds.length + 1);
  const normalizedSettings = validateTournamentSettings(format, maxParticipants, { ...settings, maxParticipants });
  const specialCellPercent = Number(settings.specialCellPercent || 25);
  if (specialCellPercent < 20 || specialCellPercent > 35) throw new Error('Los casilleros especiales deben representar entre 20% y 35% del tablero.');
  normalizedSettings.specialCellPercent = specialCellPercent;
  return { name: name.trim(), format, boardSize: Number(boardSize), settings: normalizedSettings, invitedIds, maxParticipants };
}

async function validateInvitees(invitedIds, transaction = null) {
  if (!invitedIds.length) return;
  const users = await User.count({ where: { id: invitedIds }, ...(transaction ? { transaction } : {}) });
  if (users !== invitedIds.length) throw new Error('Uno o más invitados no existen.');
}

router.post('/', async (req, res, next) => {
  try {
    const payload=normalizeTournamentPayload(req.body,req.user.id);
    await validateInvitees(payload.invitedIds);
    if (payload.invitedIds.length + 1 > payload.maxParticipants) throw new Error('Hay más invitados que cupos disponibles.');
    const accessCode=await uniqueAccessCode();
    const result=await sequelize.transaction(async transaction=>{
      const tournament=await Tournament.create({ name:payload.name, format:payload.format, boardSize:payload.boardSize, settings:payload.settings, organizerId:req.user.id, status:'open', accessCode },{transaction});
      await TournamentParticipant.create({tournamentId:tournament.id,userId:req.user.id,seed:1},{transaction});
      const invitations=payload.invitedIds.length?await TournamentInvitation.bulkCreate(payload.invitedIds.map(inviteeId=>({tournamentId:tournament.id,inviterId:req.user.id,inviteeId,status:'pending'})),{transaction}):[];
      return {tournament:tournamentJson(tournament),invitations};
    });
    res.status(201).json(result);
  } catch(e){next(e);}
});

router.get('/', async (req, res, next) => {
  try {
    const participating = await Tournament.findAll({
      where: { status: { [Op.ne]: 'cancelled' } },
      include: [{ model: TournamentParticipant, where: { userId: req.user.id }, required: true }],
      order: [['createdAt','DESC']]
    });
    const pendingInvites = await TournamentInvitation.findAll({
      where: { inviteeId: req.user.id, status: 'pending' },
      include: [{ model: Tournament, where: { status: { [Op.ne]: 'cancelled' } } }, { model: User, as: 'inviter', attributes: ['id','username'] }],
      order: [['createdAt','DESC']]
    });
    res.json({ tournaments: participating.map(tournamentJson), pendingInvites });
  } catch (e) { next(e); }
});

router.post('/invitations/:id/accept', async (req, res, next) => {
  try {
    const invitation = await TournamentInvitation.findByPk(Number(req.params.id));
    if (!invitation || invitation.inviteeId !== req.user.id) return res.status(404).json({ error: 'Invitación inexistente.' });
    if (invitation.status !== 'pending') throw new Error('La invitación ya fue respondida.');
    const tournament = await Tournament.findByPk(invitation.tournamentId);
    if (!tournament || tournament.status !== 'open') throw new Error('El torneo ya no acepta participantes.');
    const maxParticipants=Number(tournament.settings?.maxParticipants||0);
    const currentCount=await TournamentParticipant.count({where:{tournamentId:tournament.id}});
    if(maxParticipants&&currentCount>=maxParticipants) throw new Error('El torneo ya completó todos sus cupos.');
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


router.put('/:id', async (req, res, next) => {
  try {
    const payload = normalizeTournamentPayload(req.body, req.user.id);
    await validateInvitees(payload.invitedIds);

    const result = await sequelize.transaction(async transaction => {
      const tournament = await Tournament.findByPk(Number(req.params.id), { transaction, lock: transaction.LOCK.UPDATE });
      if (!tournament || tournament.status === 'cancelled') throw new Error('Torneo no encontrado.');
      if (Number(tournament.organizerId) !== Number(req.user.id)) throw new Error('Solo el creador puede editar el torneo.');

      const management = await tournamentManagement(tournament, transaction);
      if (!management.canEdit) {
        if (management.hasPlayedMatches) throw new Error('El torneo ya tiene partidos jugados y ya no se puede editar.');
        if (management.hasActiveGame) throw new Error('Hay una partida en curso. No se puede editar el torneo mientras se está jugando.');
        throw new Error('Este torneo ya no se puede editar.');
      }

      // Si ya se había generado un calendario pero todavía no se jugó ningún partido,
      // editar el torneo lo devuelve a "open" y reconstruye el calendario más adelante.
      await Game.destroy({ where: { tournamentId: tournament.id, status: { [Op.in]: ['lobby','cancelled'] } }, transaction });
      await StandingsTiebreak.destroy({ where: { tournamentId: tournament.id }, transaction });
      await Match.destroy({ where: { tournamentId: tournament.id }, transaction });

      const invitations = await TournamentInvitation.findAll({ where: { tournamentId: tournament.id }, transaction, lock: transaction.LOCK.UPDATE });
      const desired = new Set(payload.invitedIds.map(Number));
      const byUser = new Map(invitations.map(i => [Number(i.inviteeId), i]));

      for (const invitation of invitations) {
        const inviteeId = Number(invitation.inviteeId);
        if (!desired.has(inviteeId)) {
          invitation.status = 'cancelled';
          invitation.respondedAt = new Date();
          await invitation.save({ transaction });
          continue;
        }
        if (!['pending','accepted'].includes(invitation.status)) {
          invitation.status = 'pending';
          invitation.respondedAt = null;
          await invitation.save({ transaction });
        }
      }

      for (const inviteeId of payload.invitedIds) {
        if (!byUser.has(Number(inviteeId))) {
          const invitation = await TournamentInvitation.create({
            tournamentId: tournament.id,
            inviterId: req.user.id,
            inviteeId,
            status: 'pending'
          }, { transaction });
          invitations.push(invitation);
          byUser.set(Number(inviteeId), invitation);
        }
      }

      // Editar la configuración no expulsa a quienes entraron mediante código.
      // La expulsión es una acción explícita del organizador.
      const participantCount = await TournamentParticipant.count({ where:{ tournamentId:tournament.id }, transaction });
      if (participantCount > payload.maxParticipants) throw new Error(`El nuevo cupo (${payload.maxParticipants}) es menor que los ${participantCount} participantes actuales.`);
      await TournamentParticipant.update({
        groupCode: null, points: 0, played: 0, wins: 0, draws: 0, losses: 0,
        positionPoints: 0, correctAnswers: 0, incorrectAnswers: 0, tiebreakRank: null, eliminated: false, eliminationReason:null, finalPosition:null
      }, { where: { tournamentId: tournament.id }, transaction });

      let seed = participantCount + 1;
      for (const inviteeId of payload.invitedIds) {
        const invitation = byUser.get(Number(inviteeId));
        if (invitation?.status === 'accepted') {
          await TournamentParticipant.findOrCreate({ where:{ tournamentId:tournament.id,userId:inviteeId }, defaults:{ seed:seed++ }, transaction });
        }
      }

      tournament.name = payload.name;
      tournament.format = payload.format;
      tournament.boardSize = payload.boardSize;
      tournament.settings = payload.settings;
      tournament.status = 'open';
      await tournament.save({ transaction });
      return tournament;
    });

    res.json({ tournament: result });
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const result = await sequelize.transaction(async transaction => {
      const tournament = await Tournament.findByPk(Number(req.params.id), { transaction, lock: transaction.LOCK.UPDATE });
      if (!tournament || tournament.status === 'cancelled') throw new Error('Torneo no encontrado.');
      if (Number(tournament.organizerId) !== Number(req.user.id)) throw new Error('Solo el creador puede eliminar el torneo.');

      const management = await tournamentManagement(tournament, transaction);
      if (management.hasActiveGame) throw new Error('Hay una partida en curso. Terminála antes de cancelar o suspender el torneo.');
      await TournamentInvitation.update({ status:'cancelled', respondedAt:new Date() },{where:{tournamentId:tournament.id,status:'pending'},transaction});
      if (management.hasPlayedMatches) {
        tournament.status='suspended';
        await tournament.save({transaction});
        return {id:tournament.id,suspended:true,statusLabel:'Suspendido'};
      }
      await Game.update({status:'cancelled'},{where:{tournamentId:tournament.id,status:{[Op.in]:['lobby','running']}},transaction});
      tournament.status='cancelled'; await tournament.save({transaction});
      return {id:tournament.id,archived:true,statusLabel:'Cancelado'};
    });

    res.json({ ok: true, ...result });
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
    const maxParticipants=Number(tournament.settings?.maxParticipants||ids.length);
    if(ids.length!==maxParticipants) throw new Error(`El torneo necesita completar sus ${maxParticipants} cupos antes de iniciar. Actualmente hay ${ids.length}.`);
    const normalizedSettings=validateTournamentSettings(tournament.format,ids.length,tournament.settings||{});
    const built = buildSchedule(tournament.format, ids, normalizedSettings);

    await sequelize.transaction(async transaction => {
      await Match.destroy({ where: { tournamentId: tournament.id }, transaction });
      await TournamentParticipant.update({ groupCode: null, points: 0, played: 0, wins: 0, draws: 0, losses: 0, positionPoints: 0, correctAnswers: 0, incorrectAnswers: 0, tiebreakRank: null, eliminated: false, eliminationReason: null, finalPosition: null }, { where: { tournamentId: tournament.id }, transaction });
      if (built.groups) {
        for (let gi = 0; gi < built.groups.length; gi++) {
          const code = String.fromCharCode(65 + gi);
          await TournamentParticipant.update({ groupCode: code }, { where: { tournamentId: tournament.id, userId: built.groups[gi] }, transaction });
        }
      }
      await Match.bulkCreate(built.matches.map(m => ({ ...m, tournamentId: tournament.id })), { transaction });
      tournament.settings = { ...(tournament.settings||{}), ...(built.settings||{}) };
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
      state: { boardSize: tournament.boardSize, phase: 'lobby', players, organizerId: req.user.id, settings: { questionMode: tournament.settings?.questionMode || 'ankara', specialCellPercent:Number(tournament.settings?.specialCellPercent||25), isTournament:true, competitionPointsEnabled:['league','group','shared_league'].includes(match.stage), tournamentParticipantCount:Number(tournament.settings?.maxParticipants||match.participants.length), tournamentFormat:tournament.format, tournamentStage:match.stage } },
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
    if (ids.length > 8) throw new Error('Un tablero de desempate admite hasta 8 participantes. La contingencia debe dividir los mega-desempates en instancias previas.');
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
    const game=await Game.create({ roomCode:code, name:`${tournament.name} · Desempate${tie.groupCode?` Grupo ${tie.groupCode}`:''}`, boardSize:tournament.boardSize, tournamentId:tournament.id, state:{ boardSize:tournament.boardSize, phase:'lobby', players, organizerId:req.user.id, settings:{ questionMode:tournament.settings?.questionMode||'ankara', standingsTiebreakId:tie.id, isStandingsTiebreak:true, specialCellPercent:Number(tournament.settings?.specialCellPercent||25), isTournament:true, tournamentParticipantCount:Number(tournament.settings?.maxParticipants||ids.length), tournamentFormat:tournament.format } }, status:'lobby' });
    tie.gameId=game.id; tie.status='running'; await tie.save();
    res.status(201).json(game);
  } catch(e){ next(e); }
});

router.post('/join-code/:code', async (req,res,next)=>{
  try{
    const code=String(req.params.code||'').trim().toUpperCase();
    const tournament=await Tournament.findOne({where:{accessCode:code,status:'open'}});
    if(!tournament)return res.status(404).json({error:'Clave de torneo inválida o torneo cerrado.'});
    const existing=await TournamentParticipant.findOne({where:{tournamentId:tournament.id,userId:req.user.id}});
    if(existing)return res.json({tournament:tournamentJson(tournament),participant:existing,created:false});
    const max=Number(tournament.settings?.maxParticipants||0);
    const count=await TournamentParticipant.count({where:{tournamentId:tournament.id}});
    if(max&&count>=max)throw new Error('El torneo ya completó sus cupos.');
    const [participant,created]=await TournamentParticipant.findOrCreate({where:{tournamentId:tournament.id,userId:req.user.id},defaults:{seed:count+1}});
    res.status(created?201:200).json({tournament:tournamentJson(tournament),participant,created});
  }catch(e){next(e);}
});

router.delete('/:id/participants/:userId',async(req,res,next)=>{
  try{
    const tournament=await Tournament.findByPk(Number(req.params.id));
    if(!tournament)return res.status(404).json({error:'Torneo no encontrado.'});
    if(Number(tournament.organizerId)!==Number(req.user.id))return res.status(403).json({error:'Solo el organizador puede quitar participantes.'});
    const management=await tournamentManagement(tournament);
    if(!management.canEdit)throw new Error('Sólo se pueden quitar participantes antes de que se juegue el torneo.');
    const uid=Number(req.params.userId); if(uid===Number(tournament.organizerId))throw new Error('El organizador no puede expulsarse a sí mismo.');
    await TournamentParticipant.destroy({where:{tournamentId:tournament.id,userId:uid}});
    await TournamentInvitation.update({status:'cancelled',respondedAt:new Date()},{where:{tournamentId:tournament.id,inviteeId:uid}});
    res.json({ok:true,userId:uid});
  }catch(e){next(e);}
});

router.post('/:id/share', async (req, res, next) => {
  try {
    const tournament = await Tournament.findByPk(Number(req.params.id), { include:[TournamentParticipant] });
    if (!tournament || ['draft','open','cancelled'].includes(tournament.status)) return res.status(404).json({ error:'El torneo todavía no puede compartirse públicamente.' });
    const canShare = Number(tournament.organizerId) === Number(req.user.id)
      || tournament.TournamentParticipants?.some(row => Number(row.userId) === Number(req.user.id));
    if (!canShare) return res.status(403).json({ error:'No pertenecés a este torneo.' });
    const shareCode = await ensureShareCode(tournament);
    res.json({ shareCode, path:`/share/tournament/${shareCode}` });
  } catch (e) { next(e); }
});

router.get('/:id/podium', async (req, res, next) => {
  try {
    const tournament = await Tournament.findByPk(Number(req.params.id));
    if (!tournament || tournament.status === 'cancelled') return res.status(404).json({ error: 'Torneo no encontrado.' });
    if (tournament.status !== 'finished') {
      return res.json({ finished:false, tournamentId:tournament.id, tournamentName:tournament.name, participantCount:0, podium:[] });
    }

    const participants = await TournamentParticipant.findAll({
      where:{ tournamentId:tournament.id },
      include:[{ model:User, attributes:['id','username','eloRating','level'], include:[Team] }],
      order:[['seed','ASC']]
    });
    const matches = await Match.findAll({ where:{ tournamentId:tournament.id }, order:[['roundNo','ASC'],['slot','ASC']] });
    const ties = await StandingsTiebreak.findAll({ where:{ tournamentId:tournament.id, status:'resolved' } });
    const byUser = new Map(participants.map(p => [Number(p.userId), p]));
    let ordered = [];

    if (['league_1v1','shared_board_league'].includes(tournament.format)) {
      const resolved = new Map(ties.filter(t => t.scope === 'final').map(t => [t.signature, (t.resolvedOrder || []).map(Number)]));
      ordered = sortStandings(participants, resolved);
    } else {
      const finalMatch = matches.find(m => m.stage === 'final' && m.status === 'finished');
      const finalOrder = (finalMatch?.result?.finishOrder || []).slice().sort((a,b) => Number(a.position) - Number(b.position));
      const firstTwoIds = finalOrder.slice(0, 2).map(x => Number(x.userId)).filter(Boolean);
      ordered = firstTwoIds.map(id => byUser.get(id)).filter(Boolean);

      if (participants.length >= 3) {
        const semifinalLosers = [];
        for (const semi of matches.filter(m => m.stage === 'semifinal' && m.status === 'finished')) {
          const winnerId = Number(semi.result?.winnerUserId || 0);
          for (const row of semi.result?.finishOrder || []) {
            const uid = Number(row.userId);
            if (uid && uid !== winnerId && !firstTwoIds.includes(uid)) semifinalLosers.push(uid);
          }
        }
        const candidates = [...new Set(semifinalLosers)].map(id => byUser.get(id)).filter(Boolean);
        const remaining = candidates.length
          ? candidates
          : participants.filter(p => !firstTwoIds.includes(Number(p.userId)));
        const third = sortStandings(remaining)[0];
        if (third) ordered.push(third);
      }
    }

    const wanted = participants.length >= 3 ? 3 : Math.min(2, participants.length);
    const podium = ordered.slice(0, wanted).map((row, index) => ({
      position:index + 1,
      userId:Number(row.userId),
      username:row.User?.username || `Jugador ${row.userId}`,
      team:row.User?.Team ? {
        id:row.User.Team.id,
        name:row.User.Team.name,
        crestEmoji:row.User.Team.crestEmoji,
        crestUrl:row.User.Team.crestUrl,
        primaryColor:row.User.Team.primaryColor,
        secondaryColor:row.User.Team.secondaryColor
      } : null
    }));

    res.json({
      finished:true,
      tournamentId:tournament.id,
      tournamentName:tournament.name,
      format:tournament.format,
      participantCount:participants.length,
      trophyTier:trophyTier(tournament.format,Number(tournament.settings?.maxParticipants||participants.length)),
      trophyAsset:trophyAsset(tournament.format,trophyTier(tournament.format,Number(tournament.settings?.maxParticipants||participants.length))),
      podium
    });
  } catch(e) { next(e); }
});

router.get('/:id/standings', async (req, res, next) => {
  try {
    const tournament=await Tournament.findByPk(Number(req.params.id));
    if(!tournament || tournament.status==='cancelled') return res.status(404).json({error:'Torneo no encontrado.'});
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
    if (!t || t.status === 'cancelled') return res.status(404).json({ error: 'Torneo no encontrado.' });
    const isParticipant = t.TournamentParticipants?.some(p => p.userId === req.user.id);
    const isInvitee = t.TournamentInvitations?.some(i => i.inviteeId === req.user.id);
    if (!isParticipant && !isInvitee && t.organizerId !== req.user.id) return res.status(403).json({ error: 'No tenés acceso a este torneo.' });
    const management = Number(t.organizerId) === Number(req.user.id)
      ? await tournamentManagement(t)
      : { canEdit:false, canDelete:false, canSuspend:false, hasPlayedMatches:false, hasActiveGame:false, lastActivityAt:null, deleteAvailableAt:null, deleteReason:null };
    res.json({ ...tournamentJson(t), management, trophyTier:trophyTier(t.format,Number(t.settings?.maxParticipants||t.TournamentParticipants?.length||0)), trophyAsset:trophyAsset(t.format,trophyTier(t.format,Number(t.settings?.maxParticipants||t.TournamentParticipants?.length||0))) });
  } catch (e) { next(e); }
});

module.exports = router;
