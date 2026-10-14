const test=require('node:test');const assert=require('node:assert/strict');const {decaySteps,FIRST_DECAY_MS,DECAY_STEP_MS,ELO_MIN}=require('../src/services/eloService');
test('ELO mínimo configurado en 200',()=>assert.equal(ELO_MIN,200));
test('no decae antes de 7 días y descuenta al séptimo',()=>{const t=Date.UTC(2026,0,1);assert.equal(decaySteps({lastRankedGameAt:t,now:t+FIRST_DECAY_MS-1}),0);assert.equal(decaySteps({lastRankedGameAt:t,now:t+FIRST_DECAY_MS}),1)});
test('agrega un paso cada 48 horas y respeta lastEloDecayAt',()=>{const t=Date.UTC(2026,0,1),first=t+FIRST_DECAY_MS;assert.equal(decaySteps({lastRankedGameAt:t,now:first+2*DECAY_STEP_MS}),3);assert.equal(decaySteps({lastRankedGameAt:t,lastEloDecayAt:first,now:first+DECAY_STEP_MS}),1)});
