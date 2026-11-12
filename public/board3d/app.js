/* AnkaraGOAT · sin bibliotecas, sin fetch, sin servidor. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const embedded = new URLSearchParams(location.search).get('embed') === '1';
  const colors = ['#ff514b','#51afff','#f8cc41','#aa76f6','#f481cd','#52daa0','#fa903a','#f4f1de'];
  const boardRules = Object.freeze({min:30,max:70,columns:5,cellWidth:76,maxCellHeight:72,maxBoardHeight:644,pitchWidth:500,pitchHeight:746});
  const cellPalette = [
    {name:'rojo',ink:'#f04e48'},
    {name:'verde',ink:'#8de16c'},
    {name:'azul',ink:'#55b9ff'},
    {name:'amarillo',ink:'#ffdf59'},
    {name:'violeta',ink:'#d19afa'}
  ];
  let cellCount=30,cellCenters=[],boardBounds=null,remotePlayers=[],remoteSurprises={};
  const positions = Array(8).fill(0);
  let count = 4, turn = 0, busy = false, finished = false, started=false;
  let pitchRotation = 0, tilt = 56, zoom = .57;
  let remotePieceIdentity='',diceAllowed=false,remoteRolling=false;
  const scene = $('arena'), viewport = $('viewport'), dice = $('dice');

  // Cada imagen se asigna a una sola orientación y a su piso numerado.
  const stands = $('stands');
  const walls = $('walls');
  // Z es la altura perpendicular al tablero: todos los pisos comparten
  // la misma geometría, independientemente del lado del estadio.
  const geometry = Object.freeze({
    baseZ: 22,
    stepRise: 34,
    plankEdgeHeight: 26,
    concreteOverlap: 10,
    riserOverlap: 4,
    deckClearance: 1,
    stepDepth: 72,
    wallHeight: 244,
    wallOverlap: 3
  });
  const make = (parent, cls, styles) => {
    const el = document.createElement('div');
    el.className = cls;
    // Object.assign(style, {'--z': valor}) no configura de manera fiable
    // propiedades CSS personalizadas. Deben declararse con setProperty.
    for (const [property, value] of Object.entries(styles)) {
      if (property.startsWith('--')) el.style.setProperty(property, value);
      else el.style[property] = value;
    }
    parent.appendChild(el);
    return el;
  };
  const tex = (side, floor) => `url("texturas/${side}/tribuna-${side}-piso${floor}.webp")`;
  const riser = (side, floor, left, top, width, height, z) => {
    const prev = geometry.baseZ+(floor-1)*geometry.stepRise;
    let x,y,faceWidth,faceRotation;
    if(side==='norte'){x=left;y=top+height;faceWidth=width;faceRotation='rotateX(90deg)';}
    else if(side==='sur'){x=left;y=top;faceWidth=width;faceRotation='rotateX(90deg)';}
    else{x=side==='oeste'?left+width:left;y=top;faceWidth=height;faceRotation='rotateZ(90deg) rotateX(90deg)';}
    // El frente oscuro se introduce dentro del canto de madera: ya no queda
    // la ranura de 4px que antes separaba el hormigón del tablón.
    make(stands,'seat-recess',{width:`${faceWidth}px`,height:`${z-prev+geometry.riserOverlap}px`,transform:`translate3d(${x}px,${y}px,${prev}px) ${faceRotation}`});
    make(stands,'seat-edge',{width:`${faceWidth}px`,height:`${geometry.plankEdgeHeight}px`,transform:`translate3d(${x}px,${y}px,${z}px) ${faceRotation}`});
    // Los laterales penetran 10px en el canto, de forma que lo sostienen sin
    // dejar un resquicio oscuro. Se alinean dentro de la anchura del tablón.
    if(side==='norte'||side==='sur'){
      for(const xx of [left+3,left+width-3])
        make(stands,'concrete-gable',{width:`${height}px`,height:`${z+geometry.concreteOverlap}px`,transform:`translate3d(${xx}px,${top}px,0) rotateZ(90deg) rotateX(90deg)`});
    }else{
      for(const yy of [top+3,top+height-3])
        make(stands,'concrete-gable',{width:`${width}px`,height:`${z+geometry.concreteOverlap}px`,transform:`translate3d(${left}px,${yy}px,0) rotateX(90deg)`});
    }
  };
  for (const side of ['norte','sur','este','oeste']) {
    for (let floor = 1; floor <= 5; floor++) {
      // Piso 1 junto a la cancha, piso 5 al fondo.
      const z = geometry.baseZ + floor * geometry.stepRise;
      let left, top, width, height;
      if (side === 'norte') { left = 360; top = 370 - floor*geometry.stepDepth; width = 510; height = geometry.stepDepth; }
      else if (side === 'sur') { left = 360; top = 1126 + (floor-1)*geometry.stepDepth; width = 510; height = geometry.stepDepth; }
      else if (side === 'oeste') { left = 360 - floor*geometry.stepDepth; top = 370; width = geometry.stepDepth; height = 756; }
      else { left = 870 + (floor-1)*geometry.stepDepth; top = 370; width = geometry.stepDepth; height = 756; }
      riser(side,floor,left,top,width,height,z);
      // Canto de 26px: el hormigón alcanza z+10 y se solapa con la madera.
      // La imagen se apoya por encima del canto, con 1px anticoplanar.
      const deckZ = z + geometry.plankEdgeHeight + geometry.deckClearance;
      // El orden de las cinco imágenes no se altera ni se intercambia de tribuna.
      make(stands,'tier wood-deck',{
        left:`${left}px`, top:`${top}px`, width:`${width}px`, height:`${height}px`,
        backgroundImage:tex(side,floor),
        '--z':`${deckZ}px`,
        transform:`translateZ(${deckZ}px)`
      });
    }
  }
  // Un cierre continuo con 4 tramos rectos y 4 ochavas diagonales une los
  // extremos de los muros en las esquinas (antes quedaban abiertos 360px).
  // Se embuten 3px en el piso 5 para eliminar rendijas al girar la cámara.
  const rear = {
    northY: 10 + geometry.wallOverlap,
    southY: 1486 - geometry.wallOverlap,
    westX: geometry.wallOverlap,
    eastX: 1230 - geometry.wallOverlap
  };
  const wallHalf = geometry.wallHeight / 2;
  const wallDefinitions = {
    norte:{left:360,top:rear.northY-wallHalf,width:510,height:geometry.wallHeight,transform:`translateZ(${wallHalf}px) rotateX(90deg)`},
    sur:{left:360,top:rear.southY-wallHalf,width:510,height:geometry.wallHeight,transform:`translateZ(${wallHalf}px) rotateX(90deg)`},
    oeste:{left:rear.westX-wallHalf,top:370,width:geometry.wallHeight,height:756,transform:`translateZ(${wallHalf}px) rotateY(90deg)`},
    este:{left:rear.eastX-wallHalf,top:370,width:geometry.wallHeight,height:756,transform:`translateZ(${wallHalf}px) rotateY(90deg)`}
  };
  for (const [side, w] of Object.entries(wallDefinitions)) {
    const wall=make(walls,'wall',{left:`${w.left}px`,top:`${w.top}px`,width:`${w.width}px`,height:`${w.height}px`,transform:w.transform});
    make(wall,'wall-art'+(side==='este'?' flipped':''),{backgroundImage:`url("texturas/${side}/pared-trasera-${side}.webp")`});
  }
  const corners = [
    {name:'noroeste',from:[360,rear.northY],to:[rear.westX,370],texture:'norte'},
    {name:'noreste',from:[870,rear.northY],to:[rear.eastX,370],texture:'norte'},
    {name:'suroeste',from:[rear.westX,1126],to:[360,rear.southY],texture:'sur'},
    {name:'sureste',from:[rear.eastX,1126],to:[870,rear.southY],texture:'sur'}
  ];
  for (const corner of corners) {
    const [x1,y1]=corner.from,[x2,y2]=corner.to;
    const dx=x2-x1,dy=y2-y1;
    const length=Math.hypot(dx,dy), angle=Math.atan2(dy,dx)*180/Math.PI;
    const wall=make(walls,'wall corner-wall',{
      left:'0px',top:'0px',width:`${length}px`,height:`${geometry.wallHeight}px`,
      transformOrigin:'top left',
      transform:`translate3d(${x1}px,${y1}px,0) rotateZ(${angle}deg) rotateX(90deg)`
    });
    wall.dataset.corner=corner.name;
    make(wall,'wall-art',{backgroundImage:`url("texturas/${corner.texture}/pared-trasera-${corner.texture}.webp")`});
  }

  function renderView() {
    const rect = viewport.getBoundingClientRect();
    const fit = Math.min(rect.width/1300,rect.height/1030,1.15);
    scene.style.transform = `translate(-50%,-50%) scale(${(fit*zoom/.57).toFixed(3)}) rotateX(${tilt}deg) rotateZ(${pitchRotation}deg)`;
  }
  function maxZoom(){return embedded&&document.body.classList.contains('desktop-view')?1.05:1.5;}
  function resetView() { tilt=56; pitchRotation=0; zoom=.57; renderView(); }
  // Números estilo imprenta gastada: la tipografía se dibuja localmente en
  // canvas y se le quitan pequeños fragmentos, sin fuentes ni CDN externos.
  function weatheredNumber(canvas, number, ink) {
    if (typeof canvas.getContext !== 'function') return;
    const ctx=canvas.getContext('2d');
    if(!ctx) return;
    const w=160,h=96;
    ctx.clearRect(0,0,w,h);
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.font='900 83px Impact, Haettenschweiler, "Arial Black", sans-serif';
    // Contorno marfil muy fino: mantiene legibles los cinco colores sobre
    // césped verde y barro, sin pintar el fondo de los casilleros.
    ctx.strokeStyle='rgba(244,239,223,.9)';
    ctx.lineWidth=4.5;ctx.lineJoin='round';
    ctx.strokeText(String(number),w/2,h/2+3,145);
    ctx.fillStyle=ink;
    ctx.fillText(String(number),w/2,h/2+3,145);
    // Semilla por casillero: el desgaste no cambia al elegir otra cantidad.
    let seed=(number*2654435761)>>>0;
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    ctx.globalCompositeOperation='destination-out';
    for(let n=0;n<65;n++){
      const x=14+random()*132,y=9+random()*78;
      ctx.fillRect(x,y,.7+random()*3,.5+random()*2.5);
    }
    ctx.lineWidth=1.3;
    for(let n=0;n<8;n++){
      const x=16+random()*128,y=10+random()*75;
      ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+3+random()*9,y+(random()-.5)*3);ctx.stroke();
    }
    ctx.globalCompositeOperation='source-over';
  }
  function drawBoard() {
    cellCount=Math.max(boardRules.min,Math.min(boardRules.max,Math.trunc(Number($('cellCount').value)||boardRules.min)));
    $('cellCount').value=String(cellCount);
    $('cellCountValue').textContent=String(cellCount);
    const rows=Math.ceil(cellCount/boardRules.columns);
    const rowHeight=Math.min(boardRules.maxCellHeight,Math.floor(boardRules.maxBoardHeight/rows));
    const width=boardRules.columns*boardRules.cellWidth,height=rows*rowHeight;
    const left=(boardRules.pitchWidth-width)/2,top=(boardRules.pitchHeight-height)/2;
    boardBounds={left,top,width,height};
    cellCenters=Array(cellCount+1);
    const board=$('cells');
    board.replaceChildren();
    board.style.width=`${width}px`;
    board.style.height=`${height}px`;
    board.dataset.rows=String(rows);
    for(let row=0;row<rows;row++){
      const rowCount=Math.min(boardRules.columns,cellCount-row*boardRules.columns);
      const line=make(board,'board-row',{height:`${rowHeight}px`});
      line.setAttribute('role','row');
      for(let visualColumn=0;visualColumn<rowCount;visualColumn++){
        // Cada fila siguiente invierte el sentido: camino continuo en zigzag.
        const number=row*boardRules.columns+(row%2===0?visualColumn+1:rowCount-visualColumn);
        const palette=cellPalette[(number-1)%cellPalette.length];
        const tile=make(line,`board-cell cell-${palette.name}`,{
          width:`${boardRules.cellWidth}px`,height:`${rowHeight}px`
        });
        tile.dataset.cell=String(number);
        tile.classList.toggle('special', Boolean(remoteSurprises[number]));
        tile.classList.toggle('finish', number === cellCount);
        tile.setAttribute('role','gridcell');
        tile.setAttribute('aria-label',`Casillero ${number}, ${palette.name}`);
        const label=document.createElement('canvas');
        label.className='cell-number';
        label.width=160;label.height=96;
        label.textContent=String(number);
        label.setAttribute('aria-hidden','true');
        label.style.height=`${Math.min(58,rowHeight-6)}px`;
        label.style.color=palette.ink;
        weatheredNumber(label,number,palette.ink);
        tile.appendChild(label);
        cellCenters[number]={
          x:left+(boardRules.columns-rowCount)*boardRules.cellWidth/2+(visualColumn+.5)*boardRules.cellWidth,
          y:top+(rows-row-.5)*rowHeight
        };
      }
    }
  }
  function playersUI() {
    $('players').replaceChildren();
    $('pieces').replaceChildren();
    for(let i=0;i<count;i++){
      const el = make($('players'),'player'+(i===turn?' active':''),{'--color':colors[i]});
      const info=remotePlayers[i];
      const swatch=make(el,'swatch',{});
      const name=document.createElement('strong');
      name.textContent=info?.username||`Jugador ${i+1}`;
      el.appendChild(name);
      const progress=document.createElement('span');progress.textContent=`${positions[i]}/${cellCount}`;el.appendChild(progress);
      const color=info?.team?.primaryColor||colors[i];
      el.style.setProperty('--color',color);
      const p=make($('pieces'),'piece',{'--color':color});
      if(info?.team?.crestUrl){
        const badge=document.createElement('img');badge.className='piece-crest';
        badge.src=info.team.crestUrl;badge.alt='';badge.loading='eager';badge.decoding='async';badge.draggable=false;p.appendChild(badge);
      }else if(info?.team?.secondaryColor){
        p.style.setProperty('--secondary',info.team.secondaryColor);
      }
      p.dataset.player=String(i);
      place(i);
    }
    $('turnInfo').textContent=finished?'Partida terminada':`Turno de ${remotePlayers[turn]?.username||`jugador ${turn+1}`}`;
  }
  function place(i){
    const piece=$('pieces').querySelector(`[data-player="${i}"]`);
    if(!piece)return;
    const cell = positions[i];
    // Misma geometría que las filas dibujadas: ficha y número comparten centro.
    const center=cell===0
      ? {x:boardRules.pitchWidth/2,y:Math.min(boardRules.pitchHeight-19,boardBounds.top+boardBounds.height+26)}
      : cellCenters[Math.min(cell,cellCount)];
    const peers=[];
    for(let j=0;j<i;j++) if(positions[j]===cell) peers.push(j);
    const offset=peers.length;
    piece.style.left=`${(center.x+((offset%3)-1)*13)/boardRules.pitchWidth*100}%`;
    piece.style.top=`${(center.y+Math.floor(offset/3)*13)/boardRules.pitchHeight*100}%`;
    piece.classList.toggle('winner',cell===cellCount);
  }
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function refresh(){playersUI();}
  function init(){
    count=Number($('playerCount').value);turn=0;busy=false;finished=false;started=false;
    positions.fill(0);$('roll').disabled=false;$('playerCount').disabled=false;$('cellCount').disabled=false;
    drawBoard();
    $('status').textContent='Nueva partida. Todas las fichas están en la salida.';
    // Restablecer los acumuladores evita cambios bruscos al empezar de nuevo.
    diceSpinX=0;diceSpinY=0;
    dice.style.transition='none';
    $('diceNumber').textContent='—';dice.style.transform='rotateX(-24deg) rotateY(-32deg)';
    void dice.offsetWidth;
    dice.style.transition='';
    refresh();
  }
  const orientations={
    1:[0,0],6:[0,180],3:[0,-90],4:[0,90],2:[-90,0],5:[90,0]
  };
  let diceSpinX=0,diceSpinY=0;
  function spinRemote(value){
    const roll=Number(value);
    if(!Number.isInteger(roll)||roll<1||roll>6)return;
    const [rx,ry]=orientations[roll];
    diceSpinX+=360*5;diceSpinY+=360*6;
    dice.style.transform=`rotateX(${diceSpinX+rx}deg) rotateY(${diceSpinY+ry}deg)`;
    $('diceNumber').textContent=String(roll);
  }
  function refreshRemotePieces(snapshot){
    const incoming=Array.isArray(snapshot.players)?snapshot.players.slice(0,8):[];
    const nextIdentity=JSON.stringify(incoming.map(p=>[p.userId,p.team?.crestUrl,p.team?.primaryColor,p.team?.secondaryColor]));
    const size=Number(snapshot.boardSize);
    const rebuild=cellCount!==size || !boardBounds || remotePieceIdentity!==nextIdentity;
    const previous=[...positions];
    remotePlayers=incoming;remoteSurprises=snapshot.surprises||{};
    count=incoming.length;
    turn=Math.max(0,Math.min(count-1,Number(snapshot.turnIndex)||0));
    finished=snapshot.phase==='finished';started=true;
    if(embedded){
      const label=$('boardTurnLabel'),name=$('boardTurnName'),hud=$('boardTurnHud');
      if(hud && label && name){
        hud.hidden=false;
        label.textContent=finished?'PARTIDA TERMINADA':`TURNO ${Math.max(1, Number(snapshot.turnNo)||1)}`;
        name.textContent=finished?'Resultado registrado':remotePlayers[turn]?.username||`Jugador ${turn+1}`;
        hud.title=finished?'Partida finalizada':`Turno de ${name.textContent}`;
      }
    }
    $('cellCount').value=String(size);
    if(cellCount!==size||!boardBounds)drawBoard();
    else document.querySelectorAll('.board-cell').forEach(cell=>{
      cell.classList.toggle('special',Boolean(remoteSurprises[cell.dataset.cell]));
    });
    for(let i=0;i<8;i++)positions[i]=Math.max(0,Math.min(size,Number(incoming[i]?.position)||0));
    if(rebuild){
      remotePieceIdentity=nextIdentity;
      playersUI();
    }else{
      // No recrear los nodos: se perdería la transición y las fichas se
      // teletransportarían. Conservar DOM/CSS permite interpolar cada paso.
      for(let i=0;i<count;i++){
        const piece=$('pieces').querySelector(`[data-player="${i}"]`);
        const row=$('players').children[i];
        if(row){row.classList.toggle('active',i===turn);const number=row.querySelector('span:last-child');if(number)number.textContent=`${positions[i]}/${cellCount}`;}
        place(i);
        if(previous[i]!==positions[i]&&piece){
          piece.classList.remove('jump');void piece.offsetWidth;piece.classList.add('jump');
        }
      }
      $('turnInfo').textContent=finished?'Partida terminada':`Turno de ${remotePlayers[turn]?.username||`jugador ${turn+1}`}`;
    }
  }
  function setDiceControl(config){
    if(!embedded)return;
    diceAllowed=!!config?.allowed;
    remoteRolling=false;
    const trigger=$('diceTap');
    if(trigger){
      trigger.disabled=!diceAllowed;
      trigger.setAttribute('aria-label',diceAllowed?'Tirar el dado':'Dado bloqueado: no es tu turno');
      trigger.title=diceAllowed?'Tirá el dado':`Esperando a ${config?.owner||'otro jugador'}`;
    }
    document.querySelector('.diceArea')?.classList.toggle('is-allowed',diceAllowed);
    document.querySelector('.diceArea')?.classList.remove('is-rolling');
    const counter=$('diceCountdown');
    if(counter){
      const seconds=Number(config?.remaining);
      const show=config?.phase==='roll'&&config?.remaining!=null&&Number.isFinite(seconds);
      counter.hidden=!show;
      counter.textContent=show?`${Math.max(0,Math.ceil(seconds))} s`:'';
    }
  }
  function requestEmbeddedRoll(){
    if(!embedded||!diceAllowed||remoteRolling)return;
    diceAllowed=false;remoteRolling=true;
    const trigger=$('diceTap');if(trigger)trigger.disabled=true;
    document.querySelector('.diceArea').classList.remove('is-allowed');
    document.querySelector('.diceArea').classList.add('is-rolling');
    window.parent.postMessage({type:'ankara:dice-request'},location.origin);
  }
  function applyRemoteState(snapshot){
    if(!embedded||!snapshot||typeof snapshot!=='object')return;
    const size=Number(snapshot.boardSize);
    if(!Number.isInteger(size)||size<30||size>70)return;
    document.body.classList.toggle('desktop-view',!!snapshot.desktopView);
    zoom=Math.min(maxZoom(),zoom);renderView();
    refreshRemotePieces(snapshot);
    setDiceControl(snapshot.diceControl||{});
  }
  if(embedded){
    document.body.classList.add('embedded');
    const area=document.querySelector('.diceArea');if(area)viewport.appendChild(area);
    // El contador es hermano del dado para que su fuente no herede el
    // transform:scale(.7) del control y conserve nitidez/tamaño.
    if($('diceCountdown'))viewport.appendChild($('diceCountdown'));
    window.addEventListener('message',event=>{
      if(event.origin!==location.origin||event.source!==window.parent)return;
      if(event.data?.type==='ankara:board-state')applyRemoteState(event.data.state);
      if(event.data?.type==='ankara:dice-roll'){
        setDiceControl({allowed:false});
        document.querySelector('.diceArea').classList.add('is-rolling');
        spinRemote(event.data.value);
        setTimeout(()=>document.querySelector('.diceArea')?.classList.remove('is-rolling'),1700);
      }
      if(event.data?.type==='ankara:dice-rolling'){
        remoteRolling=true;diceAllowed=false;
        if($('diceTap'))$('diceTap').disabled=true;
        document.querySelector('.diceArea').classList.add('is-rolling');
      }
      if(event.data?.type==='ankara:dice-tick'){
        const counter=$('diceCountdown');
        if(counter&&!counter.hidden&&Number.isFinite(Number(event.data.remaining)))counter.textContent=`${Math.max(0,Math.ceil(Number(event.data.remaining)))} s`;
      }
    });
    $('diceTap')?.addEventListener('click',requestEmbeddedRoll);
    window.parent.postMessage({type:'ankara:board-ready'},location.origin);
  }
  async function roll(){
    if(embedded||busy||finished)return;
    busy=true;started=true;$('roll').disabled=true;$('playerCount').disabled=true;$('cellCount').disabled=true;
    const value=Math.floor(Math.random()*6)+1;
    const [rx,ry]=orientations[value];
    // Cada tirada agrega varias vueltas completas a AMBOS ejes. Antes se
    // asignaba un ángulo absoluto de 1080/1440°; después del primer tiro la
    // diferencia era de 0-360°, por lo que el dado giraba muy despacio.
    diceSpinX+=360*(4+Math.floor(Math.random()*3));
    diceSpinY+=360*(4+Math.floor(Math.random()*3));
    dice.style.transform=`rotateX(${diceSpinX+rx}deg) rotateY(${diceSpinY+ry}deg)`;
    $('status').textContent=`Jugador ${turn+1}: ¡el dado está rodando!`;
    await delay(1650);
    $('diceNumber').textContent=String(value);
    const who=turn, steps=Math.min(value,cellCount-positions[who]);
    for(let i=0;i<steps;i++){
      positions[who]++;
      place(who);
      const p=$('pieces').querySelector(`[data-player="${who}"]`);
      p.classList.remove('jump');void p.offsetWidth;p.classList.add('jump');
      await delay(300);
    }
    if(positions[who]===cellCount){
      finished=true;
      $('status').textContent=`🏆 ¡El jugador ${who+1} llegó al casillero ${cellCount} y ganó!`;
    }else{
      $('status').textContent=`Jugador ${who+1} sacó ${value} y avanzó ${steps} casillero${steps===1?'':'s'}.`;
      turn=(turn+1)%count;
    }
    busy=false;$('roll').disabled=finished;refresh();
  }
  let drag=null;
  viewport.addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;drag={x:e.clientX,y:e.clientY,rotation:pitchRotation,tilt};viewport.setPointerCapture(e.pointerId)});
  viewport.addEventListener('pointermove',e=>{if(!drag)return;pitchRotation=drag.rotation+(e.clientX-drag.x)*.25;tilt=Math.max(22,Math.min(78,drag.tilt+(e.clientY-drag.y)*.13));renderView()});
  viewport.addEventListener('pointerup',()=>drag=null);
  viewport.addEventListener('pointercancel',()=>drag=null);
  viewport.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(.23,Math.min(maxZoom(),zoom*(e.deltaY>0?.91:1.09)));renderView()},{passive:false});
  viewport.addEventListener('dblclick',resetView);
  $('zoomIn').addEventListener('click',()=>{zoom=Math.min(maxZoom(),zoom*1.17);renderView()});
  $('zoomOut').addEventListener('click',()=>{zoom=Math.max(.23,zoom/1.17);renderView()});
  $('resetView').addEventListener('click',resetView);
  $('resetGame').addEventListener('click',()=>{if(!busy)init()});
  $('playerCount').addEventListener('change',init);
  $('cellCount').addEventListener('input',()=>{if(!started&&!busy)init()});
  $('roll').addEventListener('click',roll);
  window.addEventListener('resize',renderView);
  init();renderView();
})();
