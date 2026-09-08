const test = require('node:test');
const assert = require('node:assert/strict');
const { MODES, chooseTier, inferTier, normalizeMode } = require('../src/services/questionTiers');

test('modo Ankara conserva la distribución 35/35/30',()=>{
  assert.deepEqual(MODES.ankara,{1:0.35,2:0.35,3:0.30});
});

test('selector por déficit aproxima cuotas a lo largo de una secuencia',()=>{
  const counts={1:0,2:0,3:0};
  for(let total=0;total<100;total++) counts[chooseTier('ankara',counts,total)]++;
  assert.ok(Math.abs(counts[1]-35)<=1);
  assert.ok(Math.abs(counts[2]-35)<=1);
  assert.ok(Math.abs(counts[3]-30)<=1);
});

test('modos inválidos vuelven a Ankara',()=>assert.equal(normalizeMode('inventado'),'ankara'));
test('inferTier detecta competiciones populares y nicho',()=>{
  assert.equal(inferTier({competition:'Champions League'}),1);
  assert.equal(inferTier({competition:'SuperLiga Serbia'}),3);
  assert.equal(inferTier({competition:'Liga Portugal'}),2);
});
