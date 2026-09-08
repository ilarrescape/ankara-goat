const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../src/services/gameEngine');

function players(n=4){return Array.from({length:n},(_,i)=>({userId:i+1,username:`P${i+1}`,team:{primaryColor:'#ffffff'}}))}

function fakeQuestion(id=1){return {id,type:'multiple_choice',prompt:'Demo',options:['A','B','C','D'],tier:1,difficulty:1}}

test('estado inicial crea jugadores en cero y sorpresas fuera de sus posiciones',()=>{
  const s=engine.createInitialState({boardSize:40,players:players(4)});
  assert.equal(s.players.length,4);
  assert.ok(s.players.every(p=>p.position===0&&p.active));
  assert.equal(s.phase,'roll');
  assert.equal(s.settings.questionMode,'ankara');
  assert.ok(!Object.keys(s.surprises).includes('0'));
  const c=Object.keys(s.surprises).length;
  assert.ok(c>=4&&c<=8);
});

test('solo el jugador del turno puede tirar',()=>{
  const s=engine.createInitialState({boardSize:40,players:players(2)});
  assert.throws(()=>engine.rollDice(s,2),/No es tu turno/);
  const roll=engine.rollDice(s,1);
  assert.ok(roll>=1&&roll<=6);
  assert.equal(s.phase,'moving');
});

test('el dado prepara un destino pero no mueve la posición real antes de responder',()=>{
  const s=engine.createInitialState({boardSize:25,players:players(2)});
  s.players[0].position=20;s.currentRoll=6;s.phase='moving';s.surprises={};
  const m=engine.prepareMovement(s);
  assert.equal(m.to,25);
  assert.equal(s.players[0].position,20);
  assert.deepEqual(s.pendingMove,{from:20,to:25});
});

test('respuesta correcta confirma el avance',()=>{
  const s=engine.createInitialState({boardSize:40,players:players(2)});
  s.players[0].position=7;s.currentRoll=4;s.phase='moving';s.surprises={};
  engine.prepareMovement(s);engine.setQuestion(s,fakeQuestion());
  const result=engine.answerQuestion(s,1,true);
  assert.equal(result.movementCommitted,true);
  assert.equal(s.players[0].position,11);
});

test('respuesta incorrecta deja al jugador en el casillero anterior',()=>{
  const s=engine.createInitialState({boardSize:40,players:players(2)});
  s.players[0].position=7;s.currentRoll=4;s.phase='moving';s.surprises={};
  engine.prepareMovement(s);engine.setQuestion(s,fakeQuestion());
  const result=engine.answerQuestion(s,1,false);
  assert.equal(result.movementCommitted,false);
  assert.equal(result.attemptedTo,11);
  assert.equal(s.players[0].position,7);
});

test('cara o seca valida cantidad 1..10 y rival',()=>{
  const s=engine.createInitialState({boardSize:40,players:players(3)});
  s.phase='surprise_choice';s.pendingSurprise={type:'coin_toss',ownerUserId:1,awaitingChoice:true};
  assert.throws(()=>engine.chooseCoinToss(s,1,2,11));
  engine.chooseCoinToss(s,1,2,7);
  assert.equal(s.pendingSurprise.amount,7);assert.equal(s.phase,'question_pending');
});

test('cara o seca castiga al jugador aunque falle y no gane el avance',()=>{
  const s=engine.createInitialState({boardSize:40,players:players(3)});
  s.players[0].position=10;s.currentRoll=3;s.phase='moving';
  s.surprises={13:{type:'coin_toss',amount:null}};
  engine.prepareMovement(s);
  engine.chooseCoinToss(s,1,2,4);
  engine.setQuestion(s,fakeQuestion());
  engine.answerQuestion(s,1,false);
  assert.equal(s.players[0].position,6);
  assert.equal(s.players[1].position,0);
});

test('otras sorpresas no se aplican si la pregunta se responde mal',()=>{
  const s=engine.createInitialState({boardSize:40,players:players(3)});
  s.players[0].position=10;s.currentRoll=3;s.phase='moving';
  s.surprises={13:{type:'advance',amount:5}};
  engine.prepareMovement(s);engine.setQuestion(s,fakeQuestion());engine.answerQuestion(s,1,false);
  assert.equal(s.players[0].position,10);
});

test('sorpresas regeneradas no pisan jugadores',()=>{
  const s=engine.createInitialState({boardSize:40,players:players(4)});
  s.players[0].position=5;s.players[1].position=10;s.players[2].position=15;s.players[3].position=20;
  for(let i=0;i<20;i++){
    const surprises=engine.randomizeSurprises(s);
    [5,10,15,20].forEach(pos=>assert.equal(surprises[pos],undefined));
  }
});


test('desempate excepcional admite hasta 14 jugadores, pero una partida normal no', () => {
  const players14 = Array.from({ length: 14 }, (_, i) => ({ userId: i + 1, username: `P${i+1}` }));
  assert.throws(() => engine.createInitialState({ boardSize: 40, players: players14 }), /2 y 8/);
  const state = engine.createInitialState({ boardSize: 40, players: players14, settings: { isStandingsTiebreak: true } });
  assert.equal(state.players.length, 14);
});
