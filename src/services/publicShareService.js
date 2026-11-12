const crypto = require('crypto');
const { Game, Tournament, TournamentParticipant, Match, PlayerGameStat, User, Team, StandingsTiebreak } = require('../models');
const { rankingOrder } = require('./rankingService');
const { sortStandings } = require('./standingsService');
const { STATUS_LABELS, trophyTier, trophyAsset } = require('./tournamentRules');
const { getRedis } = require('../config/redis');


async function readCache(key) {
  const redis = getRedis();
  if (!redis) return null;
  try { const raw = await redis.get(key); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}

async function writeCache(key, value, ttlSeconds) {
  const redis = getRedis();
  if (!redis) return;
  try { await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds); } catch {}
}

function randomShareCode() {
  return crypto.randomBytes(9).toString('base64url');
}

async function ensureShareCode(instance) {
  if (instance.shareCode) return instance.shareCode;
  for (let i = 0; i < 12; i += 1) {
    const code = randomShareCode();
    try {
      instance.shareCode = code;
      await instance.save({ fields: ['shareCode'] });
      return code;
    } catch (error) {
      if (error?.name !== 'SequelizeUniqueConstraintError') throw error;
      instance.shareCode = null;
    }
  }
  throw new Error('No se pudo generar un enlace público único.');
}

function publicTeam(player, fallbackPosition = null) {
  const team = player?.team || player?.Team || player?.User?.Team || null;
  return {
    name: team?.name || (fallbackPosition ? `Equipo ${fallbackPosition}` : 'Equipo AnkaraGOAT'),
    crestUrl: team?.crestUrl || null,
    crestEmoji: team?.crestEmoji || '⚽',
    primaryColor: team?.primaryColor || '#173c31',
    secondaryColor: team?.secondaryColor || '#ffffff'
  };
}

async function getPublicMatchByCode(code) {
  const cacheKey=`share:match:${String(code||'')}`;
  const cached=await readCache(cacheKey);
  if(cached)return cached;
  const game = await Game.findOne({ where: { shareCode: String(code || '') } });
  if (!game || game.status !== 'finished') return null;

  const ordered = rankingOrder(game.state?.players || []);
  const stats = await PlayerGameStat.findAll({ where: { gameId: game.id }, raw: true });
  const byUser = new Map(stats.map(row => [Number(row.userId), row]));
  const players = ordered.map((player, index) => {
    const stat = byUser.get(Number(player.userId));
    const total = Number(stat?.totalAnswers || 0);
    const correct = Number(stat?.correctAnswers || 0);
    return {
      position: Number(player.resolvedPosition || index + 1),
      team: publicTeam(player, index + 1),
      correctAnswers: correct,
      totalAnswers: total,
      accuracy: total ? Math.round((correct / total) * 100) : 0,
      eloBefore: stat?.eloBefore ?? null,
      eloAfter: stat?.eloAfter ?? null,
      eloDelta: stat ? Number(stat.eloAfter || 0) - Number(stat.eloBefore || 0) : null,
      tournamentPoints: Number(stat?.tournamentPoints || 0)
    };
  });

  const payload = {
    type: 'match',
    code: game.shareCode,
    gameId: game.id,
    name: game.name,
    finishedAt: game.state?.finishedAt || game.updatedAt,
    finishReason: game.state?.finishReason || 'completed',
    tournamentId: game.tournamentId || null,
    players
  };
  await writeCache(cacheKey,payload,3600);
  return payload;
}

function standingRow(row, position) {
  return {
    position,
    team: publicTeam(row, position),
    groupCode: row.groupCode || null,
    points: Number(row.points || 0),
    played: Number(row.played || 0),
    wins: Number(row.wins || 0),
    losses: Number(row.losses || 0),
    correctAnswers: Number(row.correctAnswers || 0),
    incorrectAnswers: Number(row.incorrectAnswers || 0),
    questionDifference: Number(row.correctAnswers || 0) - Number(row.incorrectAnswers || 0),
    finalPosition: row.finalPosition || null,
    eliminated: !!row.eliminated
  };
}

async function getPublicTournamentByCode(code) {
  const cacheKey=`share:tournament:${String(code||'')}`;
  // No se sirve un trofeo almacenado en caché después de que el organizador lo edita.
  const tournament = await Tournament.findOne({ where: { shareCode: String(code || '') } });
  if (!tournament || ['draft', 'open', 'cancelled'].includes(tournament.status)) return null;

  const participants = await TournamentParticipant.findAll({
    where: { tournamentId: tournament.id },
    include: [{ model: User, attributes: ['id'], include: [Team] }]
  });
  const ties = await StandingsTiebreak.findAll({ where:{ tournamentId:tournament.id }, order:[['createdAt','ASC']] });
  const matches = await Match.findAll({
    where: { tournamentId: tournament.id },
    order: [['roundNo', 'ASC'], ['slot', 'ASC']]
  });
  const teamByUser = new Map(participants.map(row => [Number(row.userId), publicTeam(row)]));
  const groupCodes = tournament.format === 'group_knockout'
    ? [...new Set(participants.map(row => row.groupCode).filter(Boolean))]
    : [null];
  const groups = {};
  for (const codeValue of groupCodes) {
    const subset = codeValue ? participants.filter(row => row.groupCode === codeValue) : participants;
    const resolved = new Map(
      ties
        .filter(tie => tie.status === 'resolved' && (codeValue ? tie.groupCode === codeValue : tie.scope === 'final'))
        .map(tie => [tie.signature, (tie.resolvedOrder || []).map(Number)])
    );
    groups[codeValue || 'general'] = sortStandings(subset, resolved).map((row, index) => standingRow(row, index + 1));
  }

  const publicMatches = matches.map(match => ({
    id: match.id,
    roundNo: match.roundNo,
    stage: match.stage,
    groupCode: match.groupCode || null,
    status: match.status,
    participants: (match.participants || []).map(userId => ({ userId:Number(userId), team:teamByUser.get(Number(userId)) || publicTeam(null), finishPosition:(match.result?.finishOrder||[]).find(row=>Number(row.userId)===Number(userId))?.position??null })),
    finishOrder: (match.result?.finishOrder || []).map(row => ({
      position: Number(row.position || 0),
      userId: Number(row.userId),
      team: teamByUser.get(Number(row.userId)) || publicTeam(null)
    })),
    winner: match.result?.winnerUserId ? teamByUser.get(Number(match.result.winnerUserId)) || publicTeam(null) : null
  }));

  const maxParticipants = Number(tournament.settings?.maxParticipants || participants.length || 0);
  const tier = trophyTier(tournament.format, maxParticipants);
  const podium = participants
    .filter(row => row.finalPosition)
    .sort((a,b) => Number(a.finalPosition) - Number(b.finalPosition))
    .slice(0, 3)
    .map(row => ({ position:Number(row.finalPosition), team:publicTeam(row, Number(row.finalPosition)) }));

  const payload = {
    type: 'tournament',
    code: tournament.shareCode,
    tournamentId: tournament.id,
    name: tournament.name,
    format: tournament.format,
    status: tournament.status,
    statusLabel: STATUS_LABELS[tournament.status] || tournament.status,
    participantCount: participants.length,
    trophyTier: tier,
    trophyAsset: tournament.trophyImageUrl || (tournament.status === 'finished' ? trophyAsset(tournament.format, tier) : null),
    groups,
    matches: publicMatches,
    podium,
    updatedAt: tournament.updatedAt
  };
  return payload;
}

module.exports = {
  ensureShareCode,
  getPublicMatchByCode,
  getPublicTournamentByCode
};
