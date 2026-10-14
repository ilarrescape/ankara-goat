function planTiebreak(rows, slotsAvailable, maxBoardSize = 8) {
  const players = [...rows].map(r => ({ userId:Number(r.userId), eloRating:Number(r.eloRating ?? r.User?.eloRating ?? 0) }));
  const slots = Math.max(1, Number(slotsAvailable || 1));
  if (players.length <= maxBoardSize) return { mode:'single', boards:[{ userIds:players.map(p=>p.userId), advanceCount:Math.min(slots,players.length) }], fixedUserIds:[] };

  const sorted=[...players].sort((a,b)=>b.eloRating-a.eloRating||a.userId-b.userId);
  const cutoff=sorted[maxBoardSize-1]?.eloRating;
  const above=sorted.filter(p=>p.eloRating>cutoff);
  const atCut=sorted.filter(p=>p.eloRating===cutoff);

  if (sorted[maxBoardSize] && sorted[maxBoardSize-1].eloRating > sorted[maxBoardSize].eloRating) {
    return { mode:'elo_cut', boards:[{userIds:sorted.slice(0,maxBoardSize).map(p=>p.userId),advanceCount:Math.min(slots,maxBoardSize)}], fixedUserIds:[], excludedUserIds:sorted.slice(maxBoardSize).map(p=>p.userId) };
  }

  // Si los claramente superiores por ELO alcanzan para resolver todas las plazas, compiten entre ellos.
  if (above.length >= slots) {
    return { mode:'elo_boundary_excluded', boards:[{userIds:above.map(p=>p.userId),advanceCount:slots}], fixedUserIds:[], excludedUserIds:sorted.filter(p=>!above.includes(p)).map(p=>p.userId) };
  }

  const needed = slots - above.length;
  // Contingencia: el bloque empatado en el corte disputa las plazas faltantes. Si supera 8,
  // se divide en tableros equilibrados y cada tablero aporta una cantidad proporcional de clasificados.
  if (atCut.length <= maxBoardSize) {
    return { mode:'contingency', boards:[{userIds:atCut.map(p=>p.userId),advanceCount:Math.min(needed,atCut.length)}], fixedUserIds:above.map(p=>p.userId), excludedUserIds:sorted.filter(p=>p.eloRating<cutoff).map(p=>p.userId) };
  }

  const boardCount=Math.ceil(atCut.length/maxBoardSize);
  const boards=Array.from({length:boardCount},()=>[]);
  atCut.forEach((p,i)=>boards[i%boardCount].push(p.userId));
  let remaining=needed;
  const planned=boards.map((userIds,i)=>{
    const boardsLeft=boards.length-i;
    const advanceCount=Math.max(1,Math.min(userIds.length,Math.ceil(remaining/boardsLeft)));
    remaining=Math.max(0,remaining-advanceCount);
    return {userIds,advanceCount};
  });
  return { mode:'multi_board_contingency', boards:planned, fixedUserIds:above.map(p=>p.userId), excludedUserIds:sorted.filter(p=>p.eloRating<cutoff).map(p=>p.userId) };
}

module.exports={planTiebreak};
