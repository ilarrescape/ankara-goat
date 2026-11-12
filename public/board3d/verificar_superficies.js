/*
 * Comprobación del estadio 3D AnkaraGOAT V6: geometría, tablero y tiradas.
 * Ejecutar con: node verificar_superficies.js
 * No instala dependencias ni inicia un servidor.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class ElementoSimulado {
  constructor(tag='div') {
    this.tagName=tag;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.className = '';
    this.listeners = new Map();
    this.classList = { add() {}, remove() {}, toggle() {} };
    const properties = new Map();
    this.style = {
      setProperty: (key, value) => properties.set(key, String(value)),
      getPropertyValue: key => properties.get(key) || ''
    };
  }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren() { this.children = []; }
  setAttribute(name, value) { this.attributes.set(name,String(value)); }
  getContext(type) {
    if(this.tagName!=='canvas'||type!=='2d') return null;
    return {clearRect(){},fillText(){},strokeText(){},fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}};
  }
  addEventListener(event, callback) { this.listeners.set(event, callback); }
  getBoundingClientRect() { return { width: 1280, height: 900 }; }
  querySelector(selector) {
    const player = selector.match(/^\[data-player="(\d+)"\]$/);
    return player ? this.children.find(c => c.dataset.player === player[1]) : null;
  }
}

const elementos = new Map();
const document = {
  getElementById: id => {
    if (!elementos.has(id)) elementos.set(id, new ElementoSimulado());
    return elementos.get(id);
  },
  createElement: tag => new ElementoSimulado(tag)
};
document.getElementById('playerCount').value = '4';
document.getElementById('cellCount').value = '30';

vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8'), {
  document,
  window: { addEventListener() {} },
  location: { search: '', origin: 'http://localhost' },
  URLSearchParams,
  setTimeout: callback => { queueMicrotask(callback); return 0; },
  Math,
  console
}, { filename: 'app.js' });

const elementosDe = cls => document.getElementById('stands').children.filter(e => e.className.split(' ').includes(cls));
const pisos = elementosDe('wood-deck');
const cantos = elementosDe('seat-edge');
const fondos = elementosDe('seat-recess');
const laterales = elementosDe('concrete-gable');
assert.equal(pisos.length, 20, 'Deben existir 5 superficies en cada una de las 4 tribunas');
assert.equal(cantos.length, 20, 'Cada superficie debe tener un canto de madera');
assert.equal(fondos.length, 20, 'Cada piso debe tener su frente vertical');
assert.equal(laterales.length, 40, 'Cada piso debe tener dos cierres laterales');

const alturas = [];
const recursos = new Set();
const lados = ['norte', 'sur', 'este', 'oeste'];

for (const [indice, piso] of pisos.entries()) {
  const lado = lados[Math.floor(indice / 5)];
  const numero = indice % 5 + 1;
  const base = 22 + numero * 34;
  const esperado = base + 26 + 1;
  const img = `texturas/${lado}/tribuna-${lado}-piso${numero}.webp`;
  const transform = `translateZ(${esperado}px)`;
  assert.equal(piso.style.transform, transform, `${lado} piso ${numero} no tiene el nivel superior correcto`);
  assert.equal(piso.style.getPropertyValue('--z'), `${esperado}px`, `Falta variable CSS de ${lado} piso ${numero}`);
  assert.equal(piso.style.backgroundImage, `url("${img}")`, `Textura incorrecta para ${lado} piso ${numero}`);
  assert.ok(fs.existsSync(path.join(__dirname, img)), `Falta ${img}`);
  assert.equal(cantos[indice].style.height, '26px', `Canto incorrecto en ${lado} piso ${numero}`);
  assert.ok(cantos[indice].style.transform.includes(`,${base}px)`), `El canto de ${lado} piso ${numero} no está debajo de la textura`);
  assert.ok(esperado > base + 26, `La imagen de ${lado} piso ${numero} queda debajo del canto`);
  const gables = laterales.slice(indice*2,indice*2+2);
  assert.ok(gables.every(g => g.style.height === `${base+10}px`), `El hormigón de ${lado} piso ${numero} no se introduce en la madera`);
  assert.equal(fondos[indice].style.height,'38px',`El frente de ${lado} piso ${numero} deja una rendija`);

  const x = lado === 'norte' || lado === 'sur' ? 360 : lado === 'oeste' ? 360 - numero*72 : 870 + (numero-1)*72;
  const y = lado === 'norte' ? 370-numero*72 : lado === 'sur' ? 1126+(numero-1)*72 : 370;
  const width = lado === 'norte' || lado === 'sur' ? 510 : 72;
  const height = lado === 'norte' || lado === 'sur' ? 72 : 756;
  assert.deepEqual([piso.style.left,piso.style.top,piso.style.width,piso.style.height],
    [`${x}px`,`${y}px`,`${width}px`,`${height}px`], `Dimensiones desplazadas de ${lado} piso ${numero}`);
  recursos.add(img);
  alturas.push({ lado, numero, esperado });
}
assert.equal(recursos.size, 20, 'Se repiten imágenes o faltan texturas individuales');

const muros = document.getElementById('walls').children;
assert.equal(muros.length, 8, 'Se requieren 4 paredes rectas y 4 cierres diagonales');
for (const [i, lado] of ['norte', 'sur', 'oeste', 'este'].entries()) {
  const img = `texturas/${lado}/pared-trasera-${lado}.webp`;
  const arte = muros[i].children.find(e => e.className.includes('wall-art'));
  assert.ok(arte, `Falta el material del muro ${lado}`);
  assert.equal(arte.style.backgroundImage, `url("${img}")`);
  assert.ok(fs.existsSync(path.join(__dirname, img)), `Falta ${img}`);
  assert.equal(muros[i].children.length,1,'No deben agregarse tapas grises sobre los muros');
}
const diagonales = [
  {nombre:'noroeste',start:[360,13],end:[3,370],textura:'norte'},
  {nombre:'noreste',start:[870,13],end:[1227,370],textura:'norte'},
  {nombre:'suroeste',start:[3,1126],end:[360,1483],textura:'sur'},
  {nombre:'sureste',start:[1227,1126],end:[870,1483],textura:'sur'}
];
for (const [i, referencia] of diagonales.entries()) {
  const muro=muros[4+i];
  assert.equal(muro.dataset.corner, referencia.nombre);
  assert.equal(muro.style.transformOrigin,'top left');
  const match=muro.style.transform.match(/^translate3d\(([-\d.]+)px,([-\d.]+)px,0\) rotateZ\(([-\d.]+)deg\) rotateX\(90deg\)$/);
  assert.ok(match,`Orientación incorrecta de pared ${referencia.nombre}`);
  const [,sx,sy,angle]=match.map(Number);
  const width=parseFloat(muro.style.width),rad=angle*Math.PI/180;
  const xy=[sx,sy],end=[sx+Math.cos(rad)*width,sy+Math.sin(rad)*width];
  for (let n=0;n<2;n++){
    assert.ok(Math.abs(xy[n]-referencia.start[n])<.01,`El muro ${referencia.nombre} no inicia en la tribuna`);
    assert.ok(Math.abs(end[n]-referencia.end[n])<.01,`El muro ${referencia.nombre} no llega a la pared lateral`);
  }
  const arte=muro.children[0];
  assert.equal(arte.style.backgroundImage,`url("texturas/${referencia.textura}/pared-trasera-${referencia.textura}.webp")`);
}
const css=fs.readFileSync(path.join(__dirname,'styles.css'),'utf8');
assert.match(css,/\.wall\{border:0!important;outline:0!important;background:transparent!important;box-shadow:none!important;filter:none!important\}/,
  'Los marcos grises no fueron eliminados del CSS');
assert.ok(fs.existsSync(path.join(__dirname, 'texturas/cancha/tablero.webp')), 'Falta la imagen WebP del tablero');
const cancha=fs.readFileSync(path.join(__dirname,'texturas/cancha/tablero.webp'));
assert.equal(cancha.toString('ascii',0,4),'RIFF','El terreno no es un archivo WebP válido');
assert.equal(cancha.toString('ascii',8,12),'WEBP','El terreno no es un archivo WebP válido');

const selector=document.getElementById('cellCount');
const tablero=document.getElementById('cells');
const colores=['rojo','verde','azul','amarillo','violeta'];
const coloresNumero=['#f04e48','#8de16c','#55b9ff','#ffdf59','#d19afa'];
const onSelect=selector.listeners.get('input');
assert.equal(typeof onSelect,'function','Falta el selector de casilleros');
for(let n=30;n<=70;n++){
  selector.value=String(n);
  onSelect();
  const rows=Math.ceil(n/5),rowH=Math.min(72,Math.floor(644/rows));
  assert.equal(tablero.children.length,rows,`Cantidad de filas incorrecta con ${n} casilleros`);
  assert.equal(tablero.style.width,'380px','El tablero debe mantener su ancho');
  assert.equal(tablero.style.height,`${rows*rowH}px`,'Altura incorrecta del tablero');
  assert.equal(document.getElementById('cellCountValue').textContent,String(n),'Marcador del selector desactualizado');
  const numeros=[];
  for(const [r,line] of tablero.children.entries()){
    const qty=Math.min(5,n-r*5);
    assert.equal(line.children.length,qty,`Fila ${r+1} mal distribuida para ${n} casilleros`);
    for(const [col,cell] of line.children.entries()){
      const num=Number(cell.dataset.cell);
      const expected=r*5+(r%2===0?col+1:qty-col);
      assert.equal(num,expected,`Recorrido incorrecto para ${n}: fila ${r+1}`);
      assert.ok(cell.className.includes(`cell-${colores[(num-1)%5]}`),`Color equivocado del casillero ${num}`);
      assert.equal(cell.style.backgroundColor,undefined,'El fondo debe ser completamente transparente');
      assert.equal(cell.children.length,1,'Cada casillero debe tener una numeración');
      assert.equal(cell.children[0].textContent,String(num),'Número ilegible para lectores sin canvas');
      assert.equal(cell.children[0].style.color,coloresNumero[(num-1)%5],`Color de número incorrecto en ${num}`);
      numeros.push(num);
    }
  }
  assert.deepEqual(numeros.slice().sort((a,b)=>a-b),Array.from({length:n},(_,i)=>i+1),`Casilleros faltantes o repetidos con ${n}`);
  assert.ok(!document.getElementById('roll').disabled,'Cambiar casilleros antes de jugar debe reiniciar la partida');
}
assert.match(css,/\.board-cells\{position:absolute;top:50%;left:50%;/, 'El tablero debe estar centrado');
assert.match(css,/\.board-cell\{[^}]*border:2px solid #d9ded6;border-radius:0;background:transparent;/, 'Faltan bordes gris claro, rectos y fondo transparente');
assert.ok(!css.includes('.board-cell::after'),'Quedó una capa de desgaste sobre el césped');
console.log('Correcto: 41 configuraciones (30 a 70), cinco casilleros por fila, recorrido, colores y centrado.');

const jugadores = document.getElementById('players').children;
assert.equal(jugadores.length, 4, 'La inicialización de la partida fue alterada');
for (const [i, jugador] of jugadores.entries()) {
  assert.match(jugador.style.getPropertyValue('--color'), /^#[\da-f]{6}$/i, `Falta color del jugador ${i+1}`);
}

for (const lado of lados) {
  const niveles = alturas.filter(h => h.lado === lado).map(h => h.esperado);
  assert.deepEqual(niveles, [83, 117, 151, 185, 219]);
  console.log(`${lado.padEnd(6)}: pisos en Z = ${niveles.join(', ')} px; texturas y cantos correctos`);
}
console.log('Correcto: 20 tablones gruesos, 20 cantos, 20 frentes, 40 laterales, 8 muros sin marcos y recursos originales.');

const angles=()=>{
  const value=document.getElementById('dice').style.transform;
  const match=value.match(/^rotateX\(([-\d.]+)deg\) rotateY\(([-\d.]+)deg\)$/);
  assert.ok(match,`Transformación del dado inválida: ${value}`);
  return [Number(match[1]),Number(match[2])];
};
(async () => {
  const roll=document.getElementById('roll').listeners.get('click');
  const reset=document.getElementById('resetGame').listeners.get('click');
  assert.equal(typeof roll,'function','Falta el evento de tirar el dado');
  assert.equal(typeof reset,'function','Falta el evento de nueva partida');
  let anterior=angles();
  for(let tiro=1;tiro<=5;tiro++){
    await roll();
    const actual=angles();
    assert.ok(actual[0]-anterior[0]>1200,`Tiro ${tiro}: pocas vueltas en X`);
    assert.ok(actual[1]-anterior[1]>1050,`Tiro ${tiro}: pocas vueltas en Y`);
    if(tiro===1){
      const numero=Number(document.getElementById('diceNumber').textContent);
      const row=Math.floor((numero-1)/5);
      const col=row%2===0?(numero-1)%5:4-(numero-1)%5;
      const expectedX=(60+(col+.5)*76-13)/500*100;
      const expectedY=(51+(14-row-.5)*46)/746*100;
      const ficha=document.getElementById('pieces').children[0];
      assert.ok(Math.abs(parseFloat(ficha.style.left)-expectedX)<.01,'La ficha no cae en el centro horizontal del casillero');
      assert.ok(Math.abs(parseFloat(ficha.style.top)-expectedY)<.01,'La ficha no cae en el centro vertical del casillero');
    }
    anterior=actual;
  }
  assert.equal(selector.disabled,true,'Se debe bloquear la cantidad tras empezar la partida');
  assert.equal(document.getElementById('playerCount').disabled,true,'No debe cambiarse el número de jugadores durante una partida');
  reset();
  assert.deepEqual(angles(),[-24,-32],'Nueva partida no restauró la orientación inicial');
  assert.equal(document.getElementById('dice').style.transition,'','La transición quedó bloqueada');
  await roll();
  assert.ok(angles()[0]>1200 && angles()[1]>1050,'El dado no recupera las vueltas después del reinicio');
  assert.match(document.getElementById('players').children[0].children.at(-1).textContent,/\/70$/,'El marcador no refleja los 70 casilleros');
  console.log('Correcto: 5 lanzamientos consecutivos y uno tras el reinicio mantienen múltiples vueltas en X e Y.');
  // Partidas reales simuladas: el ganador debe llegar EXACTAMENTE al último
  // casillero seleccionado, sin usar el límite fijo de 30 de la versión V5.
  for(const objetivo of [70,30]){
    reset();
    selector.value=String(objetivo);
    onSelect();
    let rolls=0;
    while(!document.getElementById('roll').disabled && rolls<400){await roll();rolls++;}
    assert.ok(rolls<400,`No termina la partida de ${objetivo} casilleros`);
    assert.match(document.getElementById('status').textContent,new RegExp(`llegó al casillero ${objetivo} y ganó`),
      `La condición de victoria no usa ${objetivo}`);
    const marcadores=document.getElementById('players').children.map(p=>p.children.at(-1).textContent);
    assert.ok(marcadores.some(m=>m.includes(`${objetivo}/${objetivo}`)),`Ningún jugador terminó en el casillero ${objetivo}`);
    assert.ok(marcadores.every(m=>!m.includes(`${objetivo+1}/${objetivo}`)),`Un jugador se pasó de ${objetivo}`);
  }
  console.log('Correcto: partidas simuladas de 30 y 70 casilleros terminan en su propia meta.');
})().catch(e=>{console.error(e);process.exitCode=1;});
