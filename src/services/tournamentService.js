const { shuffle } = require('../utils/random');

const isPowerOfTwo = n => n > 0 && (n & (n - 1)) === 0;

function validateBoardSize(boardSize) {
  if (!Number.isInteger(boardSize) || boardSize < 25 || boardSize > 70 || boardSize % 5 !== 0) {
    throw new Error('El tablero debe tener entre 25 y 70 casilleros, en múltiplos de 5.');
  }
}

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
    const games = [];
    for (let i = 0; i < n / 2; i++) {
      let a = lineup[i];
      let b = lineup[n - 1 - i];
      // Alterna localía para no favorecer al fijo.
      if (round % 2 === 0 && i === 0) [a, b] = [b, a];
      games.push({ roundNo: round, participants: a == null || b == null ? [a ?? b] : [a, b], status: a == null || b == null ? 'bye' : 'scheduled' });
    }
    rounds.push(games);
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, -1)];
  }
  return rounds.flat();
}

function league1v1Schedule(participantIds) {
  if (participantIds.length < 2 || participantIds.length > 14) {
    throw new Error('La liga 1 vs 1 admite entre 2 y 14 jugadores.');
  }
  return roundRobin(participantIds).map((m, i) => ({ ...m, stage: 'league', slot: i + 1 }));
}

function sharedBoardSchedule(participantIds, matchCount) {
  if (participantIds.length < 2 || participantIds.length > 8) {
    throw new Error('El todos-contra-todos en un mismo tablero admite entre 2 y 8 jugadores.');
  }
  if (!Number.isInteger(matchCount) || matchCount < 1 || matchCount > 10) {
    throw new Error('El torneo en tablero compartido debe tener entre 1 y 10 partidas.');
  }
  return Array.from({ length: matchCount }, (_, i) => ({
    roundNo: i + 1,
    stage: 'shared_league',
    slot: 1,
    status: 'scheduled',
    participants: [...participantIds]
  }));
}

function sharedBoardPoints(playerCount, finishPosition) {
  // Escala simple y transparente: 8/5/3/1 para 5-8 jugadores, 3/1 para 3-4 y 3 para 2.
  if (playerCount === 2) return finishPosition === 1 ? 3 : 0;
  if (playerCount <= 4) return [3, 1][finishPosition - 1] ?? 0;
  return [8, 5, 3, 1][finishPosition - 1] ?? 0;
}

function balancedGroups(participantIds, groupCount) {
  if (!Number.isInteger(groupCount) || groupCount < 2 || groupCount > 14) {
    throw new Error('La cantidad de grupos debe estar entre 2 y 14.');
  }
  if (groupCount > participantIds.length / 2) {
    throw new Error('Cada grupo debe tener al menos 2 jugadores.');
  }
  const seeded = shuffle(participantIds);
  const groups = Array.from({ length: groupCount }, () => []);
  seeded.forEach((id, i) => {
    const cycle = Math.floor(i / groupCount);
    const offset = i % groupCount;
    const idx = cycle % 2 === 0 ? offset : groupCount - 1 - offset; // snake seeding
    groups[idx].push(id);
  });
  return groups;
}

function groupKnockoutSchedule(participantIds, { groupCount, qualifiersPerGroup }) {
  if (participantIds.length < 4 || participantIds.length % 2 !== 0) {
    throw new Error('Liguilla + eliminación directa requiere una cantidad par de al menos 4 jugadores.');
  }
  if (![1, 2, 4].includes(qualifiersPerGroup)) {
    throw new Error('Por grupo pueden clasificar 1, 2 o 4 jugadores.');
  }
  const totalQualifiers = groupCount * qualifiersPerGroup;
  if (!isPowerOfTwo(totalQualifiers) || totalQualifiers < 2) {
    throw new Error('El total de clasificados (grupos × clasificados) debe ser potencia de 2 para formar una llave sin ambigüedades.');
  }

  const groups = balancedGroups(participantIds, groupCount);
  if (groups.some(g => g.length <= qualifiersPerGroup)) {
    throw new Error('Cada grupo debe tener más jugadores que plazas de clasificación.');
  }

  const matches = [];
  let maxGroupRounds = 0;
  groups.forEach((group, gi) => {
    const code = String.fromCharCode(65 + gi);
    const rr = roundRobin(group);
    maxGroupRounds = Math.max(maxGroupRounds, ...rr.map(m => m.roundNo));
    rr.forEach((m, idx) => matches.push({ ...m, stage: 'group', groupCode: code, slot: idx + 1 }));
  });

  // La primera ronda KO se define por posiciones de grupo, no por IDs todavía.
  let sources = [];
  for (let q = 1; q <= qualifiersPerGroup; q++) {
    for (let g = 0; g < groupCount; g++) {
      sources.push({ type: 'group_position', groupCode: String.fromCharCode(65 + g), position: q });
    }
  }
  // Cruce determinista que separa, en lo posible, clasificados del mismo grupo.
  const firstRoundSources = [];
  while (sources.length) {
    firstRoundSources.push([sources.shift(), sources.pop()]);
  }
  let roundSources = firstRoundSources;
  let knockoutRound = 1;
  let priorMatchRefs = [];
  while (roundSources.length) {
    const stageSize = roundSources.length * 2;
    const stage = stageSize === 2 ? 'final' : stageSize === 4 ? 'semifinal' : stageSize === 8 ? 'quarterfinal' : `round_of_${stageSize}`;
    const thisRefs = [];
    roundSources.forEach((pair, i) => {
      const ref = `KO-${knockoutRound}-${i + 1}`;
      thisRefs.push(ref);
      matches.push({
        roundNo: maxGroupRounds + knockoutRound,
        stage,
        slot: i + 1,
        status: 'scheduled',
        participants: [],
        source: { ref, entrants: pair }
      });
    });
    if (thisRefs.length === 1) break;
    priorMatchRefs = thisRefs;
    roundSources = [];
    for (let i = 0; i < priorMatchRefs.length; i += 2) {
      roundSources.push([
        { type: 'winner', ref: priorMatchRefs[i] },
        { type: 'winner', ref: priorMatchRefs[i + 1] }
      ]);
    }
    knockoutRound++;
  }
  return { groups, matches };
}

function cupSchedule(participantIds) {
  const n = participantIds.length;
  if (n < 4 || n > 32 || n % 4 !== 0) {
    throw new Error('La copa admite entre 4 y 32 jugadores y la cantidad debe ser múltiplo de 4.');
  }
  const seeded = shuffle(participantIds);
  const lowerPower = 2 ** Math.floor(Math.log2(n));
  const prelimMatches = n === lowerPower ? 0 : n - lowerPower;
  const prelimPlayers = prelimMatches * 2;
  const byes = n - prelimPlayers;
  const matches = [];
  let entrants = [];
  let roundNo = 1;

  if (prelimMatches > 0) {
    const byePlayers = seeded.slice(0, byes);
    const playing = seeded.slice(byes);
    entrants = byePlayers.map(id => ({ type: 'player', id }));
    for (let i = 0; i < prelimMatches; i++) {
      const ref = `CUP-P-${i + 1}`;
      matches.push({ roundNo, stage: 'preliminary', slot: i + 1, status: 'scheduled', participants: [playing[i * 2], playing[i * 2 + 1]], source: { ref } });
      entrants.push({ type: 'winner', ref });
    }
    roundNo++;
  } else {
    entrants = seeded.map(id => ({ type: 'player', id }));
  }

  // Mezcla nuevamente los pases directos y ganadores para construir la ronda principal.
  while (entrants.length > 1) {
    const size = entrants.length;
    const stage = size === 2 ? 'final' : size === 4 ? 'semifinal' : size === 8 ? 'quarterfinal' : `round_of_${size}`;
    const next = [];
    for (let i = 0; i < size; i += 2) {
      const ref = `CUP-${roundNo}-${i / 2 + 1}`;
      const pair = [entrants[i], entrants[i + 1]];
      const directIds = pair.every(e => e.type === 'player') ? pair.map(e => e.id) : [];
      matches.push({ roundNo, stage, slot: i / 2 + 1, status: 'scheduled', participants: directIds, source: { ref, entrants: pair } });
      next.push({ type: 'winner', ref });
    }
    entrants = next;
    roundNo++;
  }
  return matches;
}

function buildSchedule(format, participantIds, settings = {}) {
  if (new Set(participantIds).size !== participantIds.length) throw new Error('Hay participantes duplicados.');
  switch (format) {
    case 'league_1v1': return { matches: league1v1Schedule(participantIds) };
    case 'shared_board_league': return { matches: sharedBoardSchedule(participantIds, Number(settings.matchCount || 1)) };
    case 'group_knockout': return groupKnockoutSchedule(participantIds, { groupCount: Number(settings.groupCount), qualifiersPerGroup: Number(settings.qualifiersPerGroup) });
    case 'cup': return { matches: cupSchedule(participantIds) };
    default: throw new Error('Formato de torneo desconocido.');
  }
}

module.exports = {
  validateBoardSize,
  roundRobin,
  league1v1Schedule,
  sharedBoardSchedule,
  sharedBoardPoints,
  balancedGroups,
  groupKnockoutSchedule,
  cupSchedule,
  buildSchedule,
  isPowerOfTwo
};
