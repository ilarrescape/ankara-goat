function difference(row) {
  return Number(row.correctAnswers || 0) - Number(row.incorrectAnswers || 0);
}

function coreKey(row) {
  return `${Number(row.points || 0)}|${Number(row.wins || 0)}|${difference(row)}`;
}

function sortStandings(rows, resolvedOrders = new Map()) {
  return [...rows].sort((a, b) => {
    const basic = Number(b.points || 0) - Number(a.points || 0)
      || Number(b.wins || 0) - Number(a.wins || 0)
      || difference(b) - difference(a);
    if (basic) return basic;
    const key = coreKey(a);
    const order = resolvedOrders.get(key);
    if (order) {
      const ai = order.indexOf(Number(a.userId));
      const bi = order.indexOf(Number(b.userId));
      if (ai !== -1 && bi !== -1 && ai !== bi) return ai - bi;
    }
    return Number(a.seed || Number.MAX_SAFE_INTEGER) - Number(b.seed || Number.MAX_SAFE_INTEGER) || Number(a.userId) - Number(b.userId);
  });
}

function exactTieGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = coreKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].filter(([, group]) => group.length > 1).map(([key, group]) => ({ key, rows: group }));
}

function serializeStanding(row, position = null) {
  return {
    position,
    userId: Number(row.userId),
    groupCode: row.groupCode || null,
    points: Number(row.points || 0),
    wins: Number(row.wins || 0),
    correctAnswers: Number(row.correctAnswers || 0),
    incorrectAnswers: Number(row.incorrectAnswers || 0),
    answerDifference: difference(row),
    played: Number(row.played || 0)
  };
}

module.exports = { difference, coreKey, sortStandings, exactTieGroups, serializeStanding };
