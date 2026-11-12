const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {promptForQuestions} = require('../src/services/federationPolicy');
const base=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(base,p),'utf8');

test('prompt respeta 3 cantidades explícitas sin perder formato JSON',()=>{
  const prompt=promptForQuestions({categories:['Algoritmos'],category:'Algoritmos',easy:40,medium:35,hard:25});
  assert.match(prompt,/100 preguntas/);
  assert.match(prompt,/40 fáciles \(tier 1\)/);
  assert.match(prompt,/35 medias \(tier 2\)/);
  assert.match(prompt,/25 difíciles \(tier 3\)/);
  assert.match(prompt,/array JSON válido/);
});
test('prompt rechaza sumas de cero y mayores de 500',()=>{
  const args={categories:['Algoritmos'],category:'Algoritmos'};
  assert.throws(()=>promptForQuestions({...args,easy:0,medium:0,hard:0}),/sumar/);
  assert.throws(()=>promptForQuestions({...args,easy:500,medium:1,hard:0}),/sumar/);
  assert.throws(()=>promptForQuestions({...args,easy:-1,medium:1,hard:0}),/sumar/);
});
test('migración de borrado lógico mantiene historial y es reversible',()=>{
  const migration=read('migrations/202611010001-federation-question-deletion.js');
  assert.match(migration,/addColumn\('questions','deleted_at'/);
  assert.match(migration,/removeColumn\('questions','deleted_at'/);
  const routes=read('src/routes/federationRoutes.js');
  assert.match(routes,/router\.delete\('\/:id\/questions\/:questionId'/);
  assert.match(routes,/FederationRevision\.create\(/);
  assert.match(routes,/deletedAt:stamp\(\)/);
});
test('feed de preguntas no genera eventos por importación o aprobación',()=>{
  const routes=read('src/routes/federationRoutes.js');
  assert.doesNotMatch(routes,/recordFederationEvent\(fed\.id,'questions'/);
  assert.match(routes,/kind:\{\[Op\.ne\]:'questions'\}/);
});
test('comunicados protegidos y notificaciones duplicadas eliminadas',()=>{
  const routes=read('src/routes/federationRoutes.js');
  assert.match(routes,/router\.patch\('\/:id\/feed\/:eventId'/);
  assert.doesNotMatch(routes,/router\.(get|post)\('\/notifications/);
  assert.match(routes,/where:\{id:integer\(req\.params\.eventId\),federationId:fed\.id,kind:'announcement'\}/);
  const events=read('src/services/federationService.js');
  assert.doesNotMatch(events,/FederationNotification\.bulkCreate/);
  assert.match(events,/FederationEvent\.create/);
});
