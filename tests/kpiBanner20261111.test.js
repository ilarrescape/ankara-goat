const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {bannerCoordinate,preserveBannerSettings,updateBannerSettings}=require('../src/services/tournamentBanner');
const read=relative=>fs.readFileSync(path.join(__dirname,'..',relative),'utf8');

test('reencuadre de banner: admite coordenadas válidas y rechaza las inválidas',()=>{
  assert.equal(bannerCoordinate(0),0);
  assert.equal(bannerCoordinate(100),100);
  assert.equal(bannerCoordinate(63.57),63.6);
  for(const value of [-1,100.1,'abc',null,'',Infinity,NaN])assert.throws(()=>bannerCoordinate(value),/posición/);
});
test('guardar posición no destruye la configuración competitiva ni la imagen',()=>{
  const old={groupCount:2,maxParticipants:12,bannerImageUrl:'/uploads/tournament-banners-1-test.webp',bannerPositionX:50,bannerPositionY:30};
  const next=updateBannerSettings(old,{positionX:20,positionY:70});
  assert.equal(next.groupCount,2);
  assert.equal(next.maxParticipants,12);
  assert.equal(next.bannerImageUrl,old.bannerImageUrl);
  assert.equal(next.bannerPositionX,20);
  assert.equal(next.bannerPositionY,70);
  assert.equal(old.bannerPositionX,50);
});
test('al cambiar cupos se preserva la identidad del banner existente',()=>{
  const previous={maxParticipants:12,bannerImageUrl:'/uploads/banner-1.png',bannerPositionX:10,bannerPositionY:80};
  const result=preserveBannerSettings(previous,{maxParticipants:4,bannerPositionX:70});
  assert.deepEqual(result,{maxParticipants:4,bannerPositionX:10,bannerImageUrl:'/uploads/banner-1.png',bannerPositionY:80});
});
test('subida de banner inicia con posición centrada y sólo modifica datos visuales',()=>{
  const next=updateBannerSettings({matchCount:3,bannerPositionX:21},
    {bannerImageUrl:'/uploads/banner-nuevo.webp',positionX:50,positionY:50});
  assert.equal(next.matchCount,3);assert.equal(next.bannerPositionX,50);assert.equal(next.bannerPositionY,50);
});
test('API: sólo organizador puede guardar posición y subir imágenes',()=>{
  const routes=read('src/routes/tournamentRoutes.js');
  assert.match(routes,/router\.put\('\/:id\/banner\/position'/);
  assert.match(routes,/router\.post\('\/:id\/banner\/upload'/);
  assert.equal((routes.match(/Sólo el organizador puede (mover|cambiar) el banner/g)||[]).length,2);
  assert.match(routes,/preserveBannerSettings\(tournament\.settings, payload\.settings\)/);
  assert.match(read('src/services/storageService.js'),/'tournament-banners'/);
});
test('Estadísticas: primera fila de cuatro, segunda de tres, en el orden acordado',()=>{
  const js=read('public/js/federations.js');
  const start=js.indexOf('async function renderStatistics()'),end=js.indexOf('async function renderChallenges()',start);
  const section=js.slice(start,end);
  const labels=['Miembros','Torneos','Partidas','Campeones','Preguntas respondidas','Respuestas correctas','Precisión'];
  let from=0;for(const label of labels){const at=section.indexOf(`['${label}'`,from);assert.ok(at>from,`métrica fuera de orden: ${label}`);from=at;}
  assert.match(section,/statMarkup\(metrics\.slice\(0,4\),0\)/);
  assert.match(section,/statMarkup\(metrics\.slice\(4\),4\)/);
});
test('KPIs: esquina inferior derecha, valor +5px y columna completa en celular',()=>{
  const css=read('public/css/federations.css');
  assert.match(css,/align-self:flex-end;margin-left:auto;text-align:right/);
  assert.match(css,/font-size:clamp\(29px,calc\(2\.4vw \+ 5px\),39px\)/);
  assert.match(css,/\.fed-stat-kpi-row-secondary\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css,/@media\(max-width:700px\)/);
  assert.match(css,/\.fed-main \.fed-kpis,\.fed-stat-kpi-row,\.fed-stat-kpi-row-secondary/);
});
