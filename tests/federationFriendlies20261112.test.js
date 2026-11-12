const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {friendlyMeta,validateFriendlyConfig}=require('../src/services/federationFriendlies');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

const categories=['Algoritmos','Historia del fútbol'];
const params={category:'Algoritmos',maxPlayers:8,boardSize:40,questionMode:'futbolero',specialCellPercent:25,targetUserIds:[2,3]};

test('amistoso válido permite de 2 a 8 y conserva la temática federativa',()=>{
  const config=validateFriendlyConfig(params,categories,1);
  assert.equal(config.category,'Algoritmos');
  assert.equal(config.maxPlayers,8);
  assert.deepEqual(config.targetUserIds,[2,3]);
  assert.equal(config.questionMode,'futbolero');
  assert.equal(validateFriendlyConfig({...params,maxPlayers:2,targetUserIds:[2]},categories,1).maxPlayers,2);
});
test('no permite categoría ajena ni tableros fuera de 30–70',()=>{
  assert.throws(()=>validateFriendlyConfig({...params,category:'Mundiales'},categories,1),/categoría/);
  for(const boardSize of [29,71,45.5,'invalido'])
    assert.throws(()=>validateFriendlyConfig({...params,boardSize},categories,1),/tablero/);
});
test('cupos y porcentajes rechazan valores inválidos',()=>{
  for(const maxPlayers of [0,1,9,3.5])assert.throws(()=>validateFriendlyConfig({...params,maxPlayers},categories,1),/2 y 8/);
  for(const specialCellPercent of [19,36,20.5])assert.throws(()=>validateFriendlyConfig({...params,specialCellPercent},categories,1),/especiales/);
});
test('no invita al creador, no desborda los cupos ni acepta IDs falsos',()=>{
  assert.throws(()=>validateFriendlyConfig({...params,targetUserIds:[1]},categories,1),/invitados/);
  assert.throws(()=>validateFriendlyConfig({...params,targetUserIds:[-2]},categories,1),/invitados/);
  assert.throws(()=>validateFriendlyConfig({...params,maxPlayers:2,targetUserIds:[2,3]},categories,1),/cupo/);
  assert.throws(()=>validateFriendlyConfig({...params,targetUserIds:[2,3,4,5,6,7,8,9]},categories,1),/siete/);
  assert.deepEqual(validateFriendlyConfig({...params,targetUserIds:[2,2]},categories,1).targetUserIds,[2]);
});
test('metadatos de amistoso únicamente en el estado del juego',()=>{
  assert.equal(friendlyMeta({state:{settings:{questionMode:'ankara'}}}),null);
  assert.deepEqual(friendlyMeta({state:{settings:{federationFriendly:{federationId:8,category:'Algoritmos'}}}}),{federationId:8,category:'Algoritmos'});
});
test('rutas y Socket.IO aíslan salas por membresía; la categoría se aplica al banco de preguntas',()=>{
  const games=read('src/routes/gameRoutes.js'), sockets=read('src/sockets/gameSocket.js');
  const fed=read('src/routes/federationRoutes.js'), questions=read('src/services/questionService.js');
  assert.match(games,/ensureFriendlyMembership\(game,req\.user\.id\)/);
  assert.match(sockets,/ensureFriendlyMembership\(game,socket\.user\.id\)/);
  assert.match(fed,/router\.post\('\/:id\/friendlies'/);
  assert.match(fed,/router\.post\('\/:id\/friendlies\/:gameId\/publish'/);
  assert.match(fed,/reviewStatus:'published',active:true,deletedAt:null/);
  assert.match(fed,/targetUserIds:config\.targetUserIds,published:false/);
  assert.match(questions,/friendly\?\.federationId\?\{federationId:Number\(friendly\.federationId\),category:String\(friendly\.category\)\}/);
});
test('amistosos no entregan ELO ni puntos federativos y pueden difundirse por feed',()=>{
  const ranking=read('src/services/rankingService.js'),fed=read('public/js/federations.js');
  const app=read('public/js/app.js'),routes=read('src/routes/federationRoutes.js');
  assert.match(ranking,/isFederationFriendly\?new Map\(ids\.map\(id=>\[id,0\]\)\)/);
  assert.match(ranking,/if\(!isFederationFriendly\)/);
  assert.match(fed,/data-publish-friendly/);
  assert.match(fed,/targetUserIds:new FormData/);
  assert.match(fed,/friendly_invite/);
  assert.match(app,/linkedRoom/);
  assert.match(routes,/event\.kind!=='friendly_invite'/);
});
