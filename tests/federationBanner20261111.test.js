const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {bannerCoordinate}=require('../src/services/tournamentBanner');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('el encuadre federativo usa posiciones válidas entre 0 y 100',()=>{
  assert.equal(bannerCoordinate(0),0);
  assert.equal(bannerCoordinate(100),100);
  assert.equal(bannerCoordinate(67.65),67.7);
  for(const value of [-0.01,101,'abc',null,'',Infinity])assert.throws(()=>bannerCoordinate(value));
});
test('la migración añade solamente dos posiciones, centradas para federaciones existentes',()=>{
  const migration=read('migrations/202611110002-federation-banner-position.js');
  assert.match(migration,/addColumn\('federations','banner_position_x'/);
  assert.match(migration,/addColumn\('federations','banner_position_y'/);
  assert.equal((migration.match(/defaultValue:50/g)||[]).length,2);
  assert.match(migration,/removeColumn\('federations','banner_position_y'/);
  assert.match(migration,/removeColumn\('federations','banner_position_x'/);
  const models=read('src/models/index.js');
  assert.match(models,/bannerPositionX:.*DECIMAL\(5,1\)/);
  assert.match(models,/bannerPositionY:.*DECIMAL\(5,1\)/);
});
test('sólo el Presidente puede guardar posición y al cambiar el banner se recentra',()=>{
  const routes=read('src/routes/federationRoutes.js');
  const start=routes.indexOf("router.put('/:id/banner-position'");
  assert.ok(start>0);
  const route=routes.slice(start,routes.indexOf("router.post('/:id/reactivate'",start));
  assert.match(route,/requireFederation\(req\.params\.id,req\.user\.id,\{president:true\}\)/);
  assert.match(route,/bannerCoordinate\(req\.body\.positionX\)/);
  assert.match(route,/bannerCoordinate\(req\.body\.positionY\)/);
  assert.match(route,/fed\.update\(\{bannerPositionX,bannerPositionY\}\)/);
  assert.match(routes,/req\.params\.kind==='banner'\?\{bannerPositionX:50,bannerPositionY:50\}/);
});
test('editor de la cabecera ofrece arrastrar, guardar y cancelar; la página pública respeta el encuadre',()=>{
  const js=read('public/js/federations.js');
  assert.match(js,/detail\.role==='president'&&f\.bannerUrl/);
  assert.match(js,/id="fedBannerEdit"/);
  assert.match(js,/id="fedBannerSave"/);
  assert.match(js,/id="fedBannerCancel"/);
  assert.match(js,/banner\.setPointerCapture\?\./);
  assert.match(js,/pointermove/);
  assert.match(js,/bannerPositionY\)}%/);
  assert.match(js,/\/banner-position`,'PUT'/);
  assert.match(read('public/css/federations.css'),/\.fed-banner\.is-repositioning\{cursor:grab;touch-action:none/);
});
