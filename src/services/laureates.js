// Prioridad deportiva para el palmarés federativo: títulos, finales y victorias.
function rankLaureates(rows){
  return [...rows].sort((a,b)=>
    Number(b.titles||0)-Number(a.titles||0) ||
    Number(b.finals||0)-Number(a.finals||0) ||
    Number(b.victories||0)-Number(a.victories||0) ||
    String(a.name||'').localeCompare(String(b.name||''),'es'));
}
module.exports={rankLaureates};
