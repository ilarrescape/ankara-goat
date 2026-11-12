// Regla de quórum y plazo de gracia de los encuentros con jugadores convocados.
const INITIAL_GRACE_MS = 120_000;
function quorumRequired(invited) {const n=Number(invited);if(!Number.isInteger(n)||n<2||n>8)throw new Error('Cantidad de convocados inválida.');return Math.floor(n/2)+1;}
function presentPlayerIds(players,presence){return (players||[]).map(p=>Number(p.userId)).filter(id=>presence?.[String(id)]?.connected===true);}
function prepareAttendance(players,presence,now=Date.now()){
 const present=presentPlayerIds(players,presence);
 if(present.length<quorumRequired(players.length))throw new Error(`Se requiere más de la mitad de los convocados: ${quorumRequired(players.length)} de ${players.length} jugadores presentes.`);
 const absent=players.map(p=>Number(p.userId)).filter(id=>!present.includes(id));
 return {present,absent,deadline:now+INITIAL_GRACE_MS};
}
module.exports={INITIAL_GRACE_MS,quorumRequired,presentPlayerIds,prepareAttendance};
