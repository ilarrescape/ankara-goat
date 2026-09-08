const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateBoardSize, roundRobin, league1v1Schedule, sharedBoardSchedule,
  sharedBoardPoints, groupKnockoutSchedule, cupSchedule
} = require('../src/services/tournamentService');

test('tablero acepta solo 25..70 de 5 en 5', () => {
  [25,30,40,70].forEach(validateBoardSize);
  [20,26,71,42.5].forEach(n => assert.throws(() => validateBoardSize(n)));
});

test('round robin par: todos juegan contra todos exactamente una vez', () => {
  const ids=[1,2,3,4,5,6];
  const matches=roundRobin(ids).filter(m=>m.status!=='bye');
  assert.equal(matches.length,15);
  const pairs=new Set(matches.map(m=>[...m.participants].sort((a,b)=>a-b).join('-')));
  assert.equal(pairs.size,15);
  ids.forEach(id=>assert.equal(matches.filter(m=>m.participants.includes(id)).length,5));
});

test('round robin impar: cada jugador tiene exactamente una fecha libre', () => {
  const ids=[1,2,3,4,5];
  const schedule=league1v1Schedule(ids);
  assert.equal(Math.max(...schedule.map(m=>m.roundNo)),5);
  ids.forEach(id=>assert.equal(schedule.filter(m=>m.status==='bye'&&m.participants[0]===id).length,1));
  assert.equal(schedule.filter(m=>m.status!=='bye').length,10);
});

test('tablero compartido respeta 2..8 jugadores y 1..10 partidas', () => {
  assert.equal(sharedBoardSchedule([1,2,3,4],10).length,10);
  assert.throws(()=>sharedBoardSchedule([1],3));
  assert.throws(()=>sharedBoardSchedule([1,2],11));
});

test('puntuación de tablero compartido cambia por cantidad de jugadores', () => {
  assert.deepEqual([1,2].map(p=>sharedBoardPoints(2,p)),[3,0]);
  assert.deepEqual([1,2,3,4].map(p=>sharedBoardPoints(4,p)),[3,1,0,0]);
  assert.deepEqual([1,2,3,4,5].map(p=>sharedBoardPoints(8,p)),[8,5,3,1,0]);
});

test('liguilla crea grupos balanceados y llave válida', () => {
  const ids=Array.from({length:12},(_,i)=>i+1);
  const built=groupKnockoutSchedule(ids,{groupCount:2,qualifiersPerGroup:2});
  assert.equal(built.groups.length,2);
  assert.deepEqual(built.groups.map(g=>g.length).sort(),[6,6]);
  const groupMatches=built.matches.filter(m=>m.stage==='group'&&m.status!=='bye');
  assert.equal(groupMatches.length,30); // 15 por grupo
  assert.equal(built.matches.filter(m=>m.stage==='semifinal').length,2);
  assert.equal(built.matches.filter(m=>m.stage==='final').length,1);
});

test('liguilla rechaza cantidad de clasificados incompatible con KO', () => {
  const ids=Array.from({length:18},(_,i)=>i+1);
  assert.throws(()=>groupKnockoutSchedule(ids,{groupCount:3,qualifiersPerGroup:2}),/potencia de 2/);
});

test('copa soporta 12 participantes con preliminar y luego llave de 8', () => {
  const matches=cupSchedule(Array.from({length:12},(_,i)=>i+1));
  assert.equal(matches.filter(m=>m.stage==='preliminary').length,4);
  assert.equal(matches.filter(m=>m.stage==='quarterfinal').length,4);
  assert.equal(matches.filter(m=>m.stage==='semifinal').length,2);
  assert.equal(matches.filter(m=>m.stage==='final').length,1);
});

test('copa directa de 32 no genera preliminar', () => {
  const matches=cupSchedule(Array.from({length:32},(_,i)=>i+1));
  assert.equal(matches.filter(m=>m.stage==='preliminary').length,0);
  assert.equal(matches.length,31);
});
