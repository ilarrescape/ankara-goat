const CUP_SIZES = Object.freeze([4, 8, 16, 32, 64]);
const GROUP_KNOCKOUT = Object.freeze({
  4: [{ groupCount: 1, groupSize: 4, qualifiersPerGroup: [2] }],
  6: [{ groupCount: 2, groupSize: 3, qualifiersPerGroup: [1, 2] }],
  8: [{ groupCount: 2, groupSize: 4, qualifiersPerGroup: [1, 2] }],
  10: [{ groupCount: 2, groupSize: 5, qualifiersPerGroup: [1, 2, 4] }],
  12: [
    { groupCount: 2, groupSize: 6, qualifiersPerGroup: [1, 2, 4] },
    { groupCount: 4, groupSize: 3, qualifiersPerGroup: [1, 2] }
  ],
  14: [{ groupCount: 2, groupSize: 7, qualifiersPerGroup: [1, 2, 4] }],
  16: [
    { groupCount: 2, groupSize: 8, qualifiersPerGroup: [1, 2, 4] },
    { groupCount: 4, groupSize: 4, qualifiersPerGroup: [1, 2] }
  ],
  18: [{ groupCount: 2, groupSize: 9, qualifiersPerGroup: [1, 2, 4] }],
  20: [
    { groupCount: 2, groupSize: 10, qualifiersPerGroup: [1, 2, 4, 8] },
    { groupCount: 4, groupSize: 5, qualifiersPerGroup: [1, 2] }
  ],
  22: [{ groupCount: 2, groupSize: 11, qualifiersPerGroup: [1, 2, 4, 8] }],
  24: [
    { groupCount: 2, groupSize: 12, qualifiersPerGroup: [1, 2, 4, 8] },
    { groupCount: 4, groupSize: 6, qualifiersPerGroup: [1, 2] }
  ],
  26: [{ groupCount: 2, groupSize: 13, qualifiersPerGroup: [1, 2, 4, 8] }],
  28: [
    { groupCount: 2, groupSize: 14, qualifiersPerGroup: [1, 2, 4, 8] },
    { groupCount: 4, groupSize: 7, qualifiersPerGroup: [1, 2, 4] }
  ],
  30: [{ groupCount: 2, groupSize: 15, qualifiersPerGroup: [1, 2, 4, 8] }],
  32: [
    { groupCount: 2, groupSize: 16, qualifiersPerGroup: [1, 2, 4, 8] },
    { groupCount: 4, groupSize: 8, qualifiersPerGroup: [1, 2, 4] },
    { groupCount: 8, groupSize: 4, qualifiersPerGroup: [1, 2] }
  ]
});

const STATUS_LABELS = Object.freeze({
  draft: 'Borrador',
  open: 'Abierto',
  running: 'En juego',
  finished: 'Finalizado',
  suspended: 'Suspendido',
  cancelled: 'Cancelado'
});

function cupTier(size) {
  if ([4, 8].includes(Number(size))) return 'bronze';
  if ([16, 32].includes(Number(size))) return 'silver';
  if (Number(size) === 64) return 'gold';
  return null;
}

function groupKnockoutTier(size) {
  size = Number(size);
  if (size >= 4 && size <= 12) return 'bronze';
  if (size >= 14 && size <= 22) return 'silver';
  if (size >= 24 && size <= 32) return 'gold';
  return null;
}

function leagueTier(size) {
  size = Number(size);
  if (size >= 4 && size <= 8) return 'bronze';
  if (size >= 9 && size <= 16) return 'silver';
  if (size >= 17 && size <= 30) return 'gold';
  return null;
}

function trophyTier(format, size) {
  if (format === 'cup') return cupTier(size);
  if (format === 'group_knockout') return groupKnockoutTier(size);
  if (['league_1v1', 'shared_board_league'].includes(format)) return leagueTier(size);
  return null;
}

function trophyAsset(format, tier) {
  if (!tier) return null;
  const prefix = ['league_1v1', 'shared_board_league'].includes(format) ? 'liga' : 'copa';
  const es = { bronze: 'bronce', silver: 'plata', gold: 'oro' }[tier];
  return `/assets/images/trophies/${prefix}-${es}.png`;
}

function validateTournamentSettings(format, participantCount, settings = {}) {
  const count = Number(participantCount);
  if (!Number.isInteger(count)) throw new Error('La cantidad de participantes es inválida.');

  if (format === 'cup') {
    if (!CUP_SIZES.includes(count)) throw new Error('La copa de eliminación directa admite únicamente 4, 8, 16, 32 o 64 participantes.');
    return { ...settings, maxParticipants: count };
  }

  if (format === 'league_1v1') {
    if (count < 4 || count > 30) throw new Error('La liga 1 vs 1 admite entre 4 y 30 participantes.');
    return { ...settings, maxParticipants: count };
  }

  if (format === 'shared_board_league') {
    if (count < 4 || count > 8) throw new Error('La liga en tablero compartido admite entre 4 y 8 participantes.');
    const matchCount = Number(settings.matchCount || 3);
    if (!Number.isInteger(matchCount) || matchCount < 3 || matchCount > 10) throw new Error('Cada participante debe tener al menos 3 partidas puntuables; configurá entre 3 y 10 fechas.');
    return { ...settings, matchCount, maxParticipants: count };
  }

  if (format === 'group_knockout') {
    const variants = GROUP_KNOCKOUT[count];
    if (!variants) throw new Error('Liguilla + eliminación admite 4 participantes o cantidades pares entre 6 y 32.');
    const groupCount = Number(settings.groupCount);
    const qualifiersPerGroup = Number(settings.qualifiersPerGroup);
    const variant = variants.find(v => v.groupCount === groupCount);
    if (!variant || !variant.qualifiersPerGroup.includes(qualifiersPerGroup)) {
      throw new Error('La configuración de grupos y clasificados no está permitida para esta cantidad de participantes.');
    }
    const totalQualifiers = groupCount * qualifiersPerGroup;
    if (![2, 4, 8, 16].includes(totalQualifiers)) throw new Error('La fase eliminatoria debe recibir 2, 4, 8 o 16 clasificados.');
    const groupMode = variant.groupSize <= 8 ? String(settings.groupMode || '1v1') : '1v1';
    if (!['1v1', 'shared'].includes(groupMode)) throw new Error('Modalidad de grupo inválida.');
    let groupMatchCount = null;
    if (groupMode === 'shared') {
      groupMatchCount = Number(settings.groupMatchCount || 3);
      if (!Number.isInteger(groupMatchCount) || groupMatchCount < 3 || groupMatchCount > 10) throw new Error('La modalidad compartida de grupos requiere entre 3 y 10 fechas.');
    }
    return { ...settings, groupCount, qualifiersPerGroup, groupMode, groupMatchCount, maxParticipants: count };
  }

  throw new Error('Formato de torneo inválido.');
}

function allowedQuestionTiers({ format, participantCount, stage }) {
  const tier = trophyTier(format, participantCount);
  const decisive = ['quarterfinal', 'semifinal', 'final'].includes(stage);
  if (!decisive) return [1, 2, 3];
  if (tier === 'gold' && ['cup', 'group_knockout'].includes(format)) return [3];
  if (tier === 'silver' && ['cup', 'group_knockout'].includes(format)) return [2, 3];
  return [1, 2, 3];
}

function publicRulesConfig() {
  return {
    cupSizes: CUP_SIZES,
    groupKnockout: GROUP_KNOCKOUT,
    leagues: { bronze: [4, 8], silver: [9, 16], gold: [17, 30] },
    elo: { inactivityDays: 7, decayEveryHours: 48, decayPoints: 12, minimum: 200 },
    specialCells: { minPercent: 20, maxPercent: 35 },
    statusLabels: STATUS_LABELS
  };
}

module.exports = {
  CUP_SIZES,
  GROUP_KNOCKOUT,
  STATUS_LABELS,
  cupTier,
  groupKnockoutTier,
  leagueTier,
  trophyTier,
  trophyAsset,
  validateTournamentSettings,
  allowedQuestionTiers,
  publicRulesConfig
};
