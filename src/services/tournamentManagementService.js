function toMs(value) {
  if (!value) return 0;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function latestActivity(...values) {
  const ms = Math.max(0, ...values.flat().map(toMs));
  return ms ? new Date(ms) : null;
}

function tournamentManagementPolicy({ status, hasPlayedMatches = false, hasActiveGame = false, lastActivityAt = null }) {
  const terminal = ['cancelled','finished','suspended'].includes(status);
  const canEdit = !terminal && !hasPlayedMatches && !hasActiveGame;
  const canDelete = status !== 'cancelled' && !hasPlayedMatches && !hasActiveGame;
  const canSuspend = !terminal && hasPlayedMatches && !hasActiveGame;
  let deleteReason = null;
  if (status === 'cancelled') deleteReason = 'El torneo ya fue eliminado.';
  else if (hasActiveGame) deleteReason = 'Hay una partida en curso.';
  else if (hasPlayedMatches) deleteReason = 'El torneo ya tiene actividad: debe suspenderse para conservar ELO, resultados y estadísticas.';
  return {
    canEdit, canDelete, canSuspend,
    hasPlayedMatches: !!hasPlayedMatches,
    hasActiveGame: !!hasActiveGame,
    lastActivityAt: lastActivityAt ? new Date(lastActivityAt) : null,
    deleteAvailableAt: null,
    deleteReason
  };
}

module.exports = { latestActivity, tournamentManagementPolicy };
