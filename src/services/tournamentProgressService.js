const { Op } = require('sequelize');
const { sequelize, Game, Tournament, TournamentParticipant, Match, PlayerGameStat, StandingsTiebreak } = require('../models');
const { rankingOrder } = require('./rankingService');
const { sharedBoardPoints } = require('./tournamentService');
const { coreKey, exactTieGroups, sortStandings } = require('./standingsService');

function matchRef(match) { return match.source?.ref || null; }

async function resolvedOrderMap(tournamentId, groupCode, transaction) {
  const where = { tournamentId, status: 'resolved' };
  if (groupCode !== undefined) where.groupCode = groupCode;
  const rows = await StandingsTiebreak.findAll({ where, transaction });
  return new Map(rows.map(r => [r.signature, (r.resolvedOrder || []).map(Number)]));
}

async function ensureTieRows({ tournament, participants, matches, transaction }) {
  const created = [];
  const createFor = async (rows, scope, groupCode = null) => {
    for (const tie of exactTieGroups(rows)) {
      const userIds = tie.rows.map(r => Number(r.userId)).sort((a,b)=>a-b);
      const [row, wasCreated] = await StandingsTiebreak.findOrCreate({
        where: { tournamentId: tournament.id, scope, groupCode, signature: tie.key },
        defaults: { tournamentId: tournament.id, scope, groupCode, signature: tie.key, userIds, status: 'pending' },
        transaction
      });
      if (wasCreated) created.push(row);
    }
  };

  if (tournament.format === 'group_knockout') {
    const codes = [...new Set(participants.map(p => p.groupCode).filter(Boolean))];
    for (const code of codes) {
      const groupMatches = matches.filter(m => m.stage === 'group' && m.groupCode === code);
      if (groupMatches.length && groupMatches.every(m => ['finished','bye'].includes(m.status))) {
        await createFor(participants.filter(p => p.groupCode === code), 'group', code);
      }
    }
  }

  if (['league_1v1','shared_board_league'].includes(tournament.format)) {
    const relevant = matches.filter(m => ['league','shared_league'].includes(m.stage));
    if (relevant.length && relevant.every(m => ['finished','bye'].includes(m.status))) await createFor(participants, 'final', null);
  }
  return created;
}

async function resolveFutureMatches({ tournament, participants, matches, transaction }) {
  const byRef = new Map(matches.filter(m => matchRef(m)).map(m => [matchRef(m), m]));
  const groupReady = code => matches.filter(m => m.stage === 'group' && m.groupCode === code).every(m => ['finished','bye'].includes(m.status));

  const resolveSource = async source => {
    if (!source) return null;
    if (source.type === 'player') return source.id;
    if (source.type === 'winner') return byRef.get(source.ref)?.result?.winnerUserId || null;
    if (source.type === 'group_position') {
      if (!groupReady(source.groupCode)) return null;
      const rows = participants.filter(p => p.groupCode === source.groupCode);
      const unresolved = await StandingsTiebreak.count({ where: { tournamentId: tournament.id, scope:'group', groupCode: source.groupCode, status: { [Op.in]: ['pending','running'] } }, transaction });
      if (unresolved) return null;
      const orders = await resolvedOrderMap(tournament.id, source.groupCode, transaction);
      const table = sortStandings(rows, orders);
      return table[source.position - 1]?.userId || null;
    }
    return null;
  };

  for (const future of matches) {
    if (future.status === 'finished' || !future.source?.entrants?.length) continue;
    const resolved = [];
    for (const source of future.source.entrants) resolved.push(await resolveSource(source));
    if (resolved.every(Boolean)) {
      future.participants = resolved;
      if (future.status === 'scheduled') future.status = 'ready';
      await future.save({ transaction });
    }
  }
}

async function maybeFinishTournament({ tournament, matches, transaction }) {
  if (['league_1v1','shared_board_league'].includes(tournament.format)) {
    const relevant = matches.filter(m => ['league','shared_league'].includes(m.stage));
    const gamesDone = relevant.length && relevant.every(m => ['finished','bye'].includes(m.status));
    const pending = await StandingsTiebreak.count({ where: { tournamentId: tournament.id, scope:'final', status:{ [Op.in]: ['pending','running'] } }, transaction });
    if (gamesDone && !pending) { tournament.status='finished'; await tournament.save({ transaction }); }
    return;
  }
  const final = matches.find(m => m.stage === 'final');
  if (final?.status === 'finished') { tournament.status='finished'; await tournament.save({ transaction }); }
}

async function resolveTiebreakGame(game, transaction) {
  const tiebreakId = Number(game.state?.settings?.standingsTiebreakId || 0);
  if (!tiebreakId) return null;
  const tie = await StandingsTiebreak.findByPk(tiebreakId, { transaction, lock: transaction.LOCK.UPDATE });
  if (!tie || tie.status === 'resolved') return null;
  const ordered = rankingOrder(game.state?.players || []);
  tie.resolvedOrder = ordered.map(p => Number(p.userId));
  tie.status = 'resolved';
  tie.gameId = game.id;
  await tie.save({ transaction });
  return tie;
}

async function recordTournamentGame(gameId) {
  return sequelize.transaction(async transaction => {
    const game = await Game.findByPk(gameId, { transaction });
    if (!game?.tournamentId || game.status !== 'finished') return null;
    const tournament = await Tournament.findByPk(game.tournamentId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!tournament) return null;

    const resolvedTie = await resolveTiebreakGame(game, transaction);
    if (resolvedTie) {
      const matches = await Match.findAll({ where:{ tournamentId:tournament.id }, transaction, order:[['roundNo','ASC'],['slot','ASC']] });
      const participants = await TournamentParticipant.findAll({ where:{ tournamentId:tournament.id }, transaction });
      await resolveFutureMatches({ tournament, participants, matches, transaction });
      await maybeFinishTournament({ tournament, matches, transaction });
      return { tournamentId:tournament.id, tiebreakId:resolvedTie.id, resolvedOrder:resolvedTie.resolvedOrder };
    }

    if (!game.matchId) return null;
    const match = await Match.findByPk(game.matchId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!match || match.status === 'finished') return null;
    const ordered = rankingOrder(game.state?.players || []);
    match.result = { finishOrder: ordered.map(p => ({ userId:p.userId, position:p.resolvedPosition })), winnerUserId:ordered[0]?.userId || null };
    match.status='finished'; await match.save({ transaction });

    const stats = await PlayerGameStat.findAll({ where:{ gameId }, transaction, raw:true });
    const statsByUser = new Map(stats.map(s => [Number(s.userId), s]));
    const updateAnswers = (tp, userId) => {
      const st=statsByUser.get(Number(userId));
      if (!st) return;
      tp.correctAnswers += Number(st.correctAnswers || 0);
      tp.incorrectAnswers += Math.max(0, Number(st.totalAnswers || 0) - Number(st.correctAnswers || 0));
    };

    if (tournament.format === 'shared_board_league') {
      for (const p of ordered) {
        const tp=await TournamentParticipant.findOne({ where:{ tournamentId:tournament.id,userId:p.userId }, transaction, lock:transaction.LOCK.UPDATE });
        if (!tp) continue;
        const pts=sharedBoardPoints(ordered.length,p.resolvedPosition);
        tp.played += 1; tp.points += pts; tp.positionPoints += pts;
        if (p.resolvedPosition===1) tp.wins += 1; else tp.losses += 1;
        updateAnswers(tp,p.userId); await tp.save({ transaction });
      }
    } else if (['league_1v1','group_knockout'].includes(tournament.format) && ['league','group'].includes(match.stage)) {
      for (const p of ordered.slice(0,2)) {
        const tp=await TournamentParticipant.findOne({ where:{ tournamentId:tournament.id,userId:p.userId }, transaction, lock:transaction.LOCK.UPDATE });
        if (!tp) continue;
        tp.played += 1;
        if (p.resolvedPosition===1) { tp.wins += 1; tp.points += 3; } else tp.losses += 1;
        updateAnswers(tp,p.userId); await tp.save({ transaction });
      }
    } else {
      for (const p of ordered.slice(1)) {
        const tp=await TournamentParticipant.findOne({ where:{ tournamentId:tournament.id,userId:p.userId }, transaction, lock:transaction.LOCK.UPDATE });
        if (tp) { tp.eliminated=true; await tp.save({ transaction }); }
      }
    }

    const matches=await Match.findAll({ where:{ tournamentId:tournament.id }, transaction, order:[['roundNo','ASC'],['slot','ASC']] });
    const participants=await TournamentParticipant.findAll({ where:{ tournamentId:tournament.id }, transaction });
    await ensureTieRows({ tournament, participants, matches, transaction });
    await resolveFutureMatches({ tournament, participants, matches, transaction });
    await maybeFinishTournament({ tournament, matches, transaction });
    return { tournamentId:tournament.id, matchId:match.id, winnerUserId:match.result.winnerUserId };
  });
}

module.exports = { recordTournamentGame, ensureTieRows, resolvedOrderMap };
