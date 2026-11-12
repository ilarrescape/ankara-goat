const test=require('node:test');
const assert=require('node:assert/strict');
const migration=require('../migrations/202610270001-federations-v1');

test('Migración Federaciones V1 crea entidades y columnas sin conectarse a una base real',async()=>{
  const operations=[];
  const qi=Object.fromEntries(['createTable','addColumn','addIndex','removeIndex','removeColumn','dropTable']
    .map(name=>[name,async(...args)=>{operations.push({name,args});}]));
  await migration.up({context:qi});
  const tables=operations.filter(op=>op.name==='createTable').map(op=>op.args[0]);
  assert.deepEqual(tables,[
    'federations','federation_members','federation_knowledges','federation_revisions',
    'federation_proposals','federation_challenges','federation_events',
    'federation_notifications','federation_attendances','federation_achievements'
  ]);
  const columns=operations.filter(op=>op.name==='addColumn').map(op=>`${op.args[0]}.${op.args[1]}`);
  for(const key of ['tournaments.federation_id','tournaments.federation_category',
    'tournaments.federation_scope','questions.federation_id','questions.federation_author_id',
    'game_questions.question_snapshot'])assert.ok(columns.includes(key),`Falta ${key}`);
  assert.equal(operations.filter(op=>op.name==='addIndex').length,9);
  operations.length=0;
  await migration.down({context:qi});
  assert.equal(operations.filter(op=>op.name==='dropTable').length,10);
  assert.equal(operations.filter(op=>op.name==='removeColumn').length,6);
  assert.equal(operations.at(-1).args[0],'federations');
});
