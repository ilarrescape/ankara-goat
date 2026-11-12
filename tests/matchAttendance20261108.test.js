const test=require('node:test');
const assert=require('node:assert/strict');
const {quorumRequired,prepareAttendance,INITIAL_GRACE_MS}=require('../src/services/matchAttendancePolicy');
const engine=require('../src/services/gameEngine');
const players=n=>Array.from({length:n},(_,i)=>({userId:i+1,username:`Jugador ${i+1}`}));
test('inicio de cuatro participantes exige tres presentes; 50% no alcanza',()=>{
 const ps=players(4),presence={'1':{connected:true},'2':{connected:true}};
 assert.equal(quorumRequired(4),3);assert.throws(()=>prepareAttendance(ps,presence),/más de la mitad/);
 presence['3']={connected:true};const now=Date.now();const result=prepareAttendance(ps,presence,now);
 assert.deepEqual(result.present,[1,2,3]);assert.deepEqual(result.absent,[4]);assert.equal(result.deadline-now,INITIAL_GRACE_MS);
});
test('quórum en tablero 1v1 requiere ambos, en tablero de ocho requiere cinco',()=>{
 assert.equal(quorumRequired(2),2);assert.equal(quorumRequired(8),5);
 assert.throws(()=>prepareAttendance(players(8),Object.fromEntries([1,2,3,4].map(x=>[String(x),{connected:true}]))),/5 de 8/);
});
test('no se entrega turno a jugadores temporalmente desconectados',()=>{
 const state=engine.createInitialState({boardSize:40,players:players(4)});
 state.presence={'2':{connected:false,graceDeadline:Date.now()+120000}};
 state.phase='turn_end';engine.nextTurn(state);
 assert.equal(state.players[state.turnIndex].userId,3);
 assert.equal(state.phase,'roll');
});
test('si nadie está conectado no finaliza la partida ni inventa ganadores',()=>{
 const state=engine.createInitialState({boardSize:40,players:players(3)});
 state.presence=Object.fromEntries(players(3).map(p=>[String(p.userId),{connected:false}]));
 state.phase='turn_end';engine.nextTurn(state);
 assert.equal(state.phase,'roll');assert.equal(state.winnerIds.length,0);
 delete state.presence['3'];assert.equal(engine.resumeTurnOnReconnect(state,3),true);
 assert.equal(engine.currentPlayer(state).userId,3);
 assert.equal(state.phase,'roll');
});
