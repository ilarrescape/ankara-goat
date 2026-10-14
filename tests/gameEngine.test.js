const test=require('node:test');
const assert=require('node:assert/strict');
const engine=require('../src/services/gameEngine');
const players=n=>Array.from({length:n},(_,i)=>({userId:i+1,username:`P${i+1}`,team:{primaryColor:'#fff'}}));
const q=(id=1)=>({id,type:'multiple_choice',prompt:'Demo',options:['A','B'],tier:1,difficulty:1});

test('estado inicial limita a 8 jugadores y crea 20-35% de casilleros especiales',()=>{
 const s=engine.createInitialState({boardSize:40,players:players(4),settings:{specialCellPercent:25}});
 assert.equal(s.players.length,4); assert.equal(Object.keys(s.surprises).length,10); assert.ok(Object.values(s.surprises).every(x=>x.type==='roulette'));
 assert.throws(()=>engine.createInitialState({boardSize:40,players:players(9)}),/2 y 8/);
});
test('solo el jugador del turno puede tirar y el movimiento queda pendiente',()=>{
 const s=engine.createInitialState({boardSize:25,players:players(2)}); assert.throws(()=>engine.rollDice(s,2,s.turnToken),/No es tu turno/);
 s.players[0].position=20;s.currentRoll=6;s.phase='moving';s.surprises={};const m=engine.prepareMovement(s);assert.equal(m.to,25);assert.equal(s.players[0].position,20);
});
test('el video de casillero antecede a la pregunta y conserva el turno',()=>{
 const s=engine.createInitialState({boardSize:40,players:players(2)});s.players[0].position=5;s.currentRoll=3;s.phase='moving';s.surprises={8:{type:'roulette'}};engine.prepareMovement(s);
 assert.equal(s.phase,'video_pending');assert.equal(s.pendingVideo.destination,8);assert.equal(s.pendingVideo.special,true);const token=s.turnToken;engine.completeCellVideo(s,token);assert.equal(s.phase,'question_pending');assert.equal(s.turnToken,token);assert.equal(s.pendingVideo,null);
});
test('el último casillero reserva margen extendido para winner.mp4',()=>{
 const s=engine.createInitialState({boardSize:25,players:players(2)});s.players[0].position=20;s.currentRoll=6;s.phase='moving';s.surprises={};const before=Date.now();engine.prepareMovement(s);const wait=s.pendingVideo.deadline-before;assert.equal(s.pendingVideo.destination,25);assert.ok(wait>=29900&&wait<=30100,`margen final: ${wait}ms`);
 const normal=engine.createInitialState({boardSize:25,players:players(2)});normal.players[0].position=10;normal.currentRoll=2;normal.phase='moving';normal.surprises={};const beforeNormal=Date.now();engine.prepareMovement(normal);const normalWait=normal.pendingVideo.deadline-beforeNormal;assert.ok(normalWait>=9400&&normalWait<=9600,`margen normal: ${normalWait}ms`);
});
test('respuesta correcta confirma avance; incorrecta conserva posición',()=>{
 for(const correct of [true,false]){const s=engine.createInitialState({boardSize:40,players:players(2)});s.players[0].position=7;s.currentRoll=4;s.phase='moving';s.surprises={};engine.prepareMovement(s);engine.completeCellVideo(s,s.turnToken);engine.setQuestion(s,q());const r=engine.answerQuestion(s,1,correct,null,s.turnToken);assert.equal(r.movementCommitted,correct);assert.equal(s.players[0].position,correct?11:7)}
});
test('la ruleta sólo queda pendiente si acierta y llega al casillero especial',()=>{
 const s=engine.createInitialState({boardSize:40,players:players(2)});s.players[0].position=7;s.currentRoll=4;s.phase='moving';s.surprises={11:{type:'roulette'}};engine.prepareMovement(s);engine.completeCellVideo(s,s.turnToken);engine.setQuestion(s,q());engine.answerQuestion(s,1,true,null,s.turnToken);engine.completeResultPhase(s,s.turnToken);assert.equal(s.phase,'roulette_reveal');assert.ok(s.pendingRoulette);assert.equal(s.pendingRoulette.spinDeadline,null);engine.armRoulette(s,s.turnToken);assert.equal(s.phase,'roulette_wait');
 const f=engine.createInitialState({boardSize:40,players:players(2)});f.players[0].position=7;f.currentRoll=4;f.phase='moving';f.surprises={11:{type:'roulette'}};engine.prepareMovement(f);engine.completeCellVideo(f,f.turnToken);engine.setQuestion(f,q());engine.answerQuestion(f,1,false,null,f.turnToken);engine.completeResultPhase(f,f.turnToken);assert.equal(f.phase,'roll');assert.equal(f.pendingRoulette,null);
});
test('ruleta autoarranca cerca de 4 s y gira exactamente 10 s',()=>{
 const s=engine.createInitialState({boardSize:40,players:players(2)});s.players[0].position=7;s.currentRoll=4;s.phase='moving';s.surprises={11:{type:'roulette'}};engine.prepareMovement(s);engine.completeCellVideo(s,s.turnToken);engine.setQuestion(s,q());engine.answerQuestion(s,1,true,null,s.turnToken);engine.completeResultPhase(s,s.turnToken);assert.equal(s.pendingRoulette.spinDeadline,null);const before=Date.now();engine.armRoulette(s,s.turnToken);const waitMs=s.pendingRoulette.spinDeadline-before;assert.ok(waitMs>=3900&&waitMs<=4100,`espera real: ${waitMs}ms`);const pending=engine.beginRoulette(s,1,s.turnToken);assert.equal(pending.revealAt-pending.startedAt,10000);
});
test('opciones de ruleta ponderadas dependen de la modalidad',()=>{
 const friendly=engine.createInitialState({boardSize:40,players:players(3)}); const types=engine.rouletteOptions(friendly).map(x=>x.type); assert.ok(!types.includes('points_take'));assert.ok(!types.includes('end_board'));
 const comp=engine.createInitialState({boardSize:40,players:players(3),settings:{isTournament:true,competitionPointsEnabled:true}});const ct=engine.rouletteOptions(comp).map(x=>x.type);assert.ok(ct.includes('points_take'));assert.ok(ct.includes('points_loss'));assert.ok(ct.includes('end_board'));
});
test('aplicar efecto dirigido excluye a uno mismo, eliminados y finalizados',()=>{
 const s=engine.createInitialState({boardSize:40,players:players(4)});s.players[1].active=false;s.players[2].finishOrder=1;const targets=engine.eligibleRouletteTargets(s,1);assert.deepEqual(targets.map(x=>x.userId),[4]);
});
test('cada turno recibe token nuevo y un token viejo no puede actuar',()=>{const s=engine.createInitialState({boardSize:40,players:players(2)});const old=s.turnToken;s.phase='turn_end';engine.nextTurn(s);assert.notEqual(s.turnToken,old);assert.throws(()=>engine.rollDice(s,2,old),/turno cambió/i)});
test('abandono en 1v1 da victoria al presente',()=>{const s=engine.createInitialState({boardSize:40,players:players(2)});const r=engine.forfeitPlayer(s,2);assert.equal(r.finished,true);assert.equal(s.phase,'finished');assert.equal(s.players[0].finishOrder,1)});
