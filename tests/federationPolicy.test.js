const test=require('node:test');
const assert=require('node:assert/strict');
const {
  categoriesOf,publicUrl,normalizePermissions,validateProposal,
  attendanceResult,inactivityStatus,rankingPoints,promptForQuestions
}=require('../src/services/federationPolicy');

test('Federaciones: identidad y permisos respetan los límites',()=>{
  assert.deepEqual(categoriesOf(['Ascenso',' Mundiales ','Ascenso']),['Ascenso','Mundiales']);
  assert.throws(()=>categoriesOf([]),/entre una y cinco/);
  assert.throws(()=>categoriesOf(['1','2','3','4','5','6']),/entre una y cinco/);
  assert.equal(publicUrl('https://example.com/estudio'), 'https://example.com/estudio');
  assert.throws(()=>publicUrl('javascript:alert(1)'),/HTTPS o HTTP/);
  assert.throws(()=>publicUrl('https://usuario:clave@example.com'),/credenciales/);
  assert.deepEqual(normalizePermissions({tournaments:true,feed:false}),{tournaments:true,feed:false});
  assert.throws(()=>normalizePermissions({deleteAll:true}),/inválido/);
});

test('Federaciones: tableros de 30 a 70 por unidad y máximo 8 jugadores',()=>{
  for(let boardSize=30;boardSize<=70;boardSize++){
    const p=validateProposal({name:'Liga prueba',category:'Mundiales',format:'league_1v1',boardSize,maxPlayers:2,maxParticipants:4},['Mundiales']);
    assert.equal(p.boardSize,boardSize);
    assert.equal(p.maxPlayers,2);
  }
  for(const boardSize of [29,70.5,71])assert.throws(()=>validateProposal({name:'Copa',category:'Mundiales',format:'cup',boardSize,maxPlayers:8,maxParticipants:4},['Mundiales']),/30 y 70/);
  assert.throws(()=>validateProposal({name:'Copa',category:'Mundiales',format:'cup',boardSize:40,maxPlayers:9,maxParticipants:4},['Mundiales']),/de 2 a 8/);
  assert.throws(()=>validateProposal({name:'Copa',category:'Mundiales',format:'cup',boardSize:40,maxPlayers:8,maxParticipants:4},['Ascenso']),/temática/);
  assert.throws(()=>validateProposal({name:'Liga',category:'Mundiales',format:'shared_board_league',boardSize:40,maxPlayers:4,maxParticipants:8},['Mundiales']),/máximo/);
});

test('Copa federativa con liguilla: doce participantes y grupos configurables',()=>{
  const base={name:'SQL y Streamlit Cup',category:'Algoritmos',format:'group_knockout',
    boardSize:40,maxPlayers:2,maxParticipants:12};
  for(const [groupCount,groupSize,qualifiersPerGroup] of [[2,6,1],[2,6,2],[2,6,4],[4,3,1],[4,3,2]]){
    const p=validateProposal({...base,settings:{groupCount,qualifiersPerGroup,groupMode:'1v1'}},['Algoritmos']);
    assert.equal(p.settings.groupCount,groupCount);
    assert.equal(p.maxParticipants,12);
    assert.equal(groupCount*groupSize,12);
    assert.equal(p.settings.qualifiersPerGroup,qualifiersPerGroup);
  }
  assert.throws(()=>validateProposal({...base,settings:{groupCount:3,qualifiersPerGroup:2,groupMode:'1v1'}},['Algoritmos']),/configuración de grupos/);
  assert.throws(()=>validateProposal({...base,settings:{groupCount:2,qualifiersPerGroup:2,groupMode:'shared'}},['Algoritmos']),/máximo de jugadores/);
  const shared=validateProposal({...base,maxPlayers:6,settings:{groupCount:2,qualifiersPerGroup:2,groupMode:'shared',groupMatchCount:3}},['Algoritmos']);
  assert.equal(shared.settings.groupMatchCount,3);
});

test('Federaciones: mayoría estricta y espera de cinco minutos',()=>{
  const scheduledAt=new Date('2026-10-27T15:00:00Z');
  const invitedIds=[1,2,3,4,5,6,7,8];
  const base={scheduledAt,invitedIds};
  assert.equal(attendanceResult({...base,presentIds:[1,2,3,4,5],now:scheduledAt.getTime()+4*60000}).status,'waiting');
  assert.equal(attendanceResult({...base,presentIds:[1,2,3,4],now:scheduledAt.getTime()+5*60000}).status,'walkover');
  assert.equal(attendanceResult({...base,presentIds:[1,2,3,4,5],now:scheduledAt.getTime()+5*60000}).status,'ready');
  assert.equal(attendanceResult({...base,presentIds:[],now:scheduledAt.getTime()+6*60000}).status,'walkover');
});

test('Federaciones: inactividad, prestigio y prompts seguros',()=>{
  const now=Date.parse('2026-10-27T18:00:00Z');
  assert.equal(inactivityStatus(new Date(now-29*86400000),now),'active');
  assert.equal(inactivityStatus(new Date(now-30*86400000),now),'suspended');
  assert.equal(inactivityStatus(new Date(now-60*86400000),now),'archived');
  assert.equal(rankingPoints({friendly:true,champion:true,participants:8}),0);
  assert.equal(rankingPoints({champion:true,participants:8}),3);
  assert.equal(rankingPoints({interfederative:true,champion:true,participants:8}),6);
  assert.equal(rankingPoints({interfederative:true,runnerUp:true,participants:8}),4);
  const prompt=promptForQuestions({categories:['Ascenso'],category:'Ascenso',count:500});
  assert.match(prompt,/500 preguntas/);
  assert.match(prompt,/JSON válido/);
  assert.throws(()=>promptForQuestions({categories:['Ascenso'],category:'Mundiales'}),/inválida/);
});
