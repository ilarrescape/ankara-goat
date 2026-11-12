const crypto=require('crypto');
const {validateTournamentSettings}=require('./tournamentRules');

const VALID_PERMISSIONS=new Set(['members','knowledge','questions','tournaments','feed']);
const TYPES=new Set(['league_1v1','shared_board_league','group_knockout','cup']);
const ACHIEVEMENT_FAMILIES=['victories','correct_answers','streaks'];

function categoriesOf(value){
  if(!Array.isArray(value))throw new Error('Las categorías deben ser una lista.');
  const categories=[...new Set(value.map(s=>String(s||'').trim()).filter(Boolean))];
  if(!categories.length||categories.length>5||categories.some(s=>s.length>80))throw new Error('Elegí entre una y cinco categorías válidas.');
  return categories;
}

function publicUrl(value){
  const raw=String(value||'').trim();
  if(raw.length>1000)throw new Error('Enlace demasiado largo.');
  try{const u=new URL(raw);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error();return u.href;}
  catch{throw new Error('El enlace debe usar HTTPS o HTTP y no contener credenciales.');}
}

function normalizePermissions(value){
  const result={};
  for(const [key,val] of Object.entries(value||{})){
    if(!VALID_PERMISSIONS.has(key)||typeof val!=='boolean')throw new Error('Permiso de Secretario inválido.');
    result[key]=val;
  }
  return result;
}

function validateProposal(payload,categories){
  const p=payload||{};
  if(!String(p.name||'').trim()||String(p.name).length>100)throw new Error('Ingresá un nombre de torneo válido.');
  if(!TYPES.has(p.format))throw new Error('Formato de torneo inválido.');
  if(!categories.includes(p.category))throw new Error('La temática no pertenece a esta Federación.');
  const boardSize=Number(p.boardSize??40);
  if(!Number.isInteger(boardSize)||boardSize<30||boardSize>70)throw new Error('Casilleros: entre 30 y 70.');
  const maxPlayers=Number(p.maxPlayers??8);
  if(!Number.isInteger(maxPlayers)||maxPlayers<2||maxPlayers>8)throw new Error('Jugadores por tablero: de 2 a 8.');
  const maxParticipants=Number(p.maxParticipants??4);
  const settings=validateTournamentSettings(p.format,maxParticipants,{...p.settings,maxPlayersPerBoard:maxPlayers});
  if(p.format==='shared_board_league'&&maxParticipants>maxPlayers)throw new Error('La liga compartida supera los jugadores permitidos por tablero.');
  if(p.format==='group_knockout'&&settings.groupMode==='shared'&&maxParticipants/settings.groupCount>maxPlayers)throw new Error('El grupo compartido supera los jugadores permitidos por tablero.');
  return {name:String(p.name).trim(),format:p.format,category:p.category,boardSize,maxPlayers,maxParticipants,settings};
}

function attendanceResult({invitedIds,presentIds,now=Date.now(),scheduledAt,reprogramCount=0}){
  const invited=[...new Set((invitedIds||[]).map(Number))];
  const present=[...new Set((presentIds||[]).map(Number))].filter(id=>invited.includes(id));
  if(!invited.length)throw new Error('La convocatoria no tiene integrantes.');
  const deadline=new Date(scheduledAt).getTime()+5*60*1000;
  if(!Number.isFinite(deadline))throw new Error('Fecha de convocatoria inválida.');
  if(now<deadline)return {status:'waiting',deadline,present:present.length,required:Math.floor(invited.length/2)+1};
  if(present.length<=invited.length/2){
    return {status:'walkover',deadline,present:present.length,absent:invited.filter(id=>!present.includes(id)),reprogramCount};
  }
  return {status:'ready',deadline,present:present.length,absent:invited.filter(id=>!present.includes(id))};
}

function inactivityStatus(lastActivityAt,now=Date.now()){
  const age=now-new Date(lastActivityAt).getTime();
  if(!Number.isFinite(age))return 'active';
  if(age>=60*86400000)return 'archived';
  if(age>=30*86400000)return 'suspended';
  return 'active';
}

function rankingPoints({friendly=false,interfederative=false,champion=false,runnerUp=false,participants=0}={}){
  const size=Math.max(0,Number(participants)||0);
  if(friendly)return 0;
  const base=interfederative?2:1;
  return base+(champion?size*(interfederative ? 0.5 : 0.25):runnerUp?size*(interfederative ? 0.25 : 0.10):0);
}

function promptForQuestions({categories,category,count=100,easy,medium,hard}){
  if(!categories.includes(category))throw new Error('Categoría inválida.');
  const hasDistribution=[easy,medium,hard].some(v=>v!==undefined);
  const sizes=hasDistribution?[easy,medium,hard].map(Number):null;
  if(sizes && (sizes.some(n=>!Number.isInteger(n)||n<0||n>500)||sizes.reduce((a,b)=>a+b,0)<1||sizes.reduce((a,b)=>a+b,0)>500))throw new Error('Las cantidades por dificultad deben sumar entre 1 y 500.');
  const quantity=sizes?sizes.reduce((a,b)=>a+b,0):Math.max(1,Math.min(500,Math.trunc(Number(count)||100)));
  const distribution=sizes?` Distribución OBLIGATORIA: ${sizes[0]} fáciles (tier 1), ${sizes[1]} medias (tier 2) y ${sizes[2]} difíciles (tier 3).`:'';
  return `Generá ${quantity} preguntas originales, verificables y sin duplicados de trivia futbolera sobre ${category}.${distribution} Devolvé EXCLUSIVAMENTE un array JSON válido, sin markdown. Cada objeto debe tener estas claves exactas: type (multiple_choice), prompt (4 a 500 caracteres), options (array de exactamente cuatro strings distintos), correctAnswer (string idéntico a una opción), category ("${category}"), competition (string), knowledgeArea (string), tier (1, 2 o 3), difficulty (1 a 5), reviewStatus ("review"), active (true). Respetá la distribución indicada cuando exista; de lo contrario equilibrá los tiers. Evitá respuestas ambiguas, no inventes datos y no incluyas campos adicionales. El Presidente revisará y aprobará antes de publicar.`;
}

function inviteCode(){return crypto.randomBytes(9).toString('base64url');}

module.exports={VALID_PERMISSIONS,ACHIEVEMENT_FAMILIES,categoriesOf,publicUrl,normalizePermissions,
  validateProposal,attendanceResult,inactivityStatus,rankingPoints,promptForQuestions,inviteCode};
