const MODES = {
  casual: { 1: 0.60, 2: 0.30, 3: 0.10 },
  futbolero: { 1: 0.45, 2: 0.40, 3: 0.15 },
  enfermo: { 1: 0.25, 2: 0.40, 3: 0.35 },
  ankara: { 1: 0.35, 2: 0.35, 3: 0.30 }
};

const TIER_LABELS = {
  1: 'Popular',
  2: 'Fanático',
  3: 'Enfermo'
};

function normalizeMode(mode) {
  return MODES[mode] ? mode : 'ankara';
}

function chooseTier(mode, counts = {}, totalAnswered = 0) {
  const distribution = MODES[normalizeMode(mode)];
  const nextTotal = totalAnswered + 1;
  let bestTier = 1;
  let bestDeficit = -Infinity;
  for (const tier of [1, 2, 3]) {
    const desired = distribution[tier] * nextTotal;
    const actual = Number(counts[tier] || 0);
    const deficit = desired - actual;
    if (deficit > bestDeficit) {
      bestDeficit = deficit;
      bestTier = tier;
    }
  }
  return bestTier;
}

function inferTier({ competition = '', category = '' } = {}) {
  const text = `${competition} ${category}`.toLowerCase();
  const popular = ['mundial', 'champions', 'premier', 'laliga', 'la liga', 'serie a', 'argentina', 'brasil', 'libertadores'];
  const niche = ['oceanía', 'oceania', 'afc', 'caf', 'serbia', 'rumania', 'suecia', 'japón', 'japon', 'corea', 'áfrica', 'africa'];
  if (niche.some(v => text.includes(v))) return 3;
  if (popular.some(v => text.includes(v))) return 1;
  return 2;
}

module.exports = { MODES, TIER_LABELS, normalizeMode, chooseTier, inferTier };
