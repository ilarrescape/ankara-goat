const { shuffle } = require('../utils/random');
const { validateTournamentSettings } = require('./tournamentRules');

function validateBoardSize(size) {
  if (!Number.isInteger(size) || size < 30 || size > 70) throw new Error('El tablero debe tener entre 30 y 70 casilleros.');
}

function isPowerOfTwo(n) { return n > 0 && (n & (n - 1)) === 0; }

function roundRobin(ids) {
  const players = [...ids];
  if (players.length < 2) return [];
  if (players.length % 2) players.push(null);
  const n = players.length;
  const fixed = players[0];
  let rotating = players.slice(1);
  const rounds = [];
  for (let round = 1; round < n; round++) {
    const lineup = [fixed, ...rotating];
    for (let i = 0; i < n / 2; i++) {
      let a = lineup[i], b = lineup[n - 1 - i];
      if (round % 2 === 0 && i === 0) [a, b] = [b, a];
      rounds.push({
        roundNo: round,
        participants: a == null || b == null ? [a ?? b] : [a, b],
        status: a == null || b == null ? 'bye' : 'scheduled'
      });
    }
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, -1)];
  }
  return rounds;
}

function league1v1Schedule(participantIds) {
  validateTournamentSettings('league_1v1', participantIds.length, {});
  return roundRobin(participantIds).map((m, i) => ({ ...m, stage: 'league', slot: i + 1 }));
}

function sharedBoardSchedule(participantIds, matchCount) {
  const settings = validateTournamentSettings('shared_board_league', participantIds.length, { matchCount });
  return Array.from({ length: settings.matchCount }, (_, i) => ({
    roundNo: i + 1, stage: 'shared_league', slot: 1, status: 'scheduled', participants: [...participantIds]
  }));
}

function sharedBoardPoints(playerCount, finishPosition) {
  const count = Number(playerCount), pos = Number(finishPosition);
  if (!Number.isInteger(count) || !Number.isInteger(pos) || pos < 1 || pos > count) return 0;
  return Math.max(0, count - pos);
}

function balancedGroups(participantIds, groupCount) {
  if (!Number.isInteger(groupCount) || groupCount < 1) throw new Error('Cantidad de grupos inválida.');
  const seeded = shuffle(participantIds);
  const groups = Array.from({ length: groupCount }, () => []);
  seeded.forEach((id, i) => {
    const cycle = Math.floor(i / groupCount);
    const offset = i % groupCount;
    const idx = cycle % 2 === 0 ? offset : groupCount - 1 - offset;
    groups[idx].push(id);
  });
  if (groups.some(g => g.length < 3)) throw new Error('Cada grupo debe tener al menos 3 participantes.');
  return groups;
}

function sharedGroupMatches(group, groupCode, count) {
  return Array.from({ length: count }, (_, i) => ({
    roundNo: i + 1,
    stage: 'group',
    groupCode,
    slot: 1,
    status: 'scheduled',
    participants: [...group]
  }));
}

function crossGroupFirstRoundSources(groupCount, qualifiersPerGroup) {
  if (groupCount === 1) {
    return [[{ type:'group_position', groupCode:'A', position:1 }, { type:'group_position', groupCode:'A', position:2 }]];
  }
  const byPosition = Array.from({ length: qualifiersPerGroup }, (_, p) =>
    Array.from({ length: groupCount }, (_, g) => ({ type: 'group_position', groupCode: String.fromCharCode(65 + g), position: p + 1 }))
  );
  const pairs = [];
  const low = qualifiersPerGroup - 1;
  const used = new Set();
  const flat = byPosition.flat();
  for (const source of flat) {
    const key = `${source.groupCode}:${source.position}`;
    if (used.has(key)) continue;
    const oppositePosition = qualifiersPerGroup + 1 - source.position;
    const candidates = flat.filter(c => !used.has(`${c.groupCode}:${c.position}`) && c.groupCode !== source.groupCode && c.position === oppositePosition);
    const fallback = flat.filter(c => !used.has(`${c.groupCode}:${c.position}`) && c.groupCode !== source.groupCode && c !== source);
    const pool = candidates.length ? candidates : fallback;
    if (!pool.length) continue;
    const rival = shuffle(pool)[0];
    used.add(key); used.add(`${rival.groupCode}:${rival.position}`);
    pairs.push([source, rival]);
  }
  return pairs;
}

function groupKnockoutSchedule(participantIds, rawSettings) {
  const settings = validateTournamentSettings('group_knockout', participantIds.length, rawSettings);
  const { groupCount, qualifiersPerGroup, groupMode, groupMatchCount } = settings;
  const groups = balancedGroups(participantIds, groupCount);
  const matches = [];
  let maxGroupRounds = 0;

  groups.forEach((group, gi) => {
    const code = String.fromCharCode(65 + gi);
    const scheduled = groupMode === 'shared'
      ? sharedGroupMatches(group, code, groupMatchCount)
      : roundRobin(group).map((m, idx) => ({ ...m, stage: 'group', groupCode: code, slot: idx + 1 }));
    if (scheduled.length) maxGroupRounds = Math.max(maxGroupRounds, ...scheduled.map(m => m.roundNo));
    matches.push(...scheduled);
  });

  let roundSources = crossGroupFirstRoundSources(groupCount, qualifiersPerGroup);
  let knockoutRound = 1;
  while (roundSources.length) {
    const stageSize = roundSources.length * 2;
    const stage = stageSize === 2 ? 'final' : stageSize === 4 ? 'semifinal' : stageSize === 8 ? 'quarterfinal' : `round_of_${stageSize}`;
    const refs = [];
    roundSources.forEach((pair, i) => {
      const ref = `KO-${knockoutRound}-${i + 1}`;
      refs.push(ref);
      matches.push({ roundNo: maxGroupRounds + knockoutRound, stage, slot: i + 1, status: 'scheduled', participants: [], source: { ref, entrants: pair } });
    });
    if (refs.length === 1) break;
    roundSources = [];
    for (let i = 0; i < refs.length; i += 2) roundSources.push([{ type: 'winner', ref: refs[i] }, { type: 'winner', ref: refs[i + 1] }]);
    knockoutRound++;
  }
  return { groups, matches, settings };
}

function cupSchedule(participantIds) {
  validateTournamentSettings('cup', participantIds.length, {});
  let entrants = shuffle(participantIds).map(id => ({ type: 'player', id }));
  const matches = [];
  let roundNo = 1;
  while (entrants.length > 1) {
    const size = entrants.length;
    const stage = size === 2 ? 'final' : size === 4 ? 'semifinal' : size === 8 ? 'quarterfinal' : `round_of_${size}`;
    const next = [];
    for (let i = 0; i < size; i += 2) {
      const ref = `CUP-${roundNo}-${i / 2 + 1}`;
      const pair = [entrants[i], entrants[i + 1]];
      matches.push({
        roundNo, stage, slot: i / 2 + 1, status: 'scheduled',
        participants: pair.every(e => e.type === 'player') ? pair.map(e => e.id) : [],
        source: { ref, entrants: pair }
      });
      next.push({ type: 'winner', ref });
    }
    entrants = next; roundNo++;
  }
  return matches;
}

function buildSchedule(format, participantIds, settings = {}) {
  if (new Set(participantIds).size !== participantIds.length) throw new Error('Hay participantes duplicados.');
  validateTournamentSettings(format, participantIds.length, settings);
  switch (format) {
    case 'league_1v1': return { matches: league1v1Schedule(participantIds), settings: validateTournamentSettings(format, participantIds.length, settings) };
    case 'shared_board_league': return { matches: sharedBoardSchedule(participantIds, Number(settings.matchCount || 3)), settings: validateTournamentSettings(format, participantIds.length, settings) };
    case 'group_knockout': return groupKnockoutSchedule(participantIds, settings);
    case 'cup': return { matches: cupSchedule(participantIds), settings: validateTournamentSettings(format, participantIds.length, settings) };
    default: throw new Error('Formato de torneo desconocido.');
  }
}

module.exports = { validateBoardSize, roundRobin, league1v1Schedule, sharedBoardSchedule, sharedBoardPoints, balancedGroups, groupKnockoutSchedule, cupSchedule, buildSchedule, isPowerOfTwo };
