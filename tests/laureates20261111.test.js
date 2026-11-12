const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {rankLaureates}=require('../src/services/laureates');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('palmarés: orden por títulos, luego finales, luego victorias',()=>{
  const data=[{name:'ilarrescape',titles:0,finals:0,victories:1},{name:'Hutti',titles:0,finals:1,victories:1},
    {name:'Vaffe',titles:1,finals:0,victories:0},{name:'Tercero',titles:0,finals:1,victories:0}];
  assert.deepEqual(rankLaureates(data).map(v=>v.name),['Vaffe','Hutti','Tercero','ilarrescape']);
  assert.equal(data[0].name,'ilarrescape');
});
test('sin avisos duplicados; logros individuales mantienen filtro federativo',()=>{
  const routes=read('src/routes/federationRoutes.js'),ui=read('public/js/federations.js'),markup=read('public/federaciones.html');
  assert.match(routes,/router\.get\('\/:id\/achievements\/mine'/);
  assert.match(routes,/federationId:fed\.id,userId:req\.user\.id/);
  assert.doesNotMatch(markup,/data-nav="notifications"/);
  assert.doesNotMatch(ui,/refreshNoticeBadge|async function notifications/);
  assert.match(ui,/function renderMemberAchievements/);
  assert.match(ui,/records\.topLaureates/);
});
test('layout: chat debajo y formato KPI y tabs negros',()=>{
  const css=read('public/css/styles.css'),fed=read('public/css/federations.css');
  assert.match(css,/body\[data-view='game'\] \.game-grid\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css,/body\[data-view='game'\] \.sidepanel\{grid-column:1/);
  assert.match(fed,/\.fed-member-search\{margin-bottom:18px/);
  assert.match(fed,/\.fed-kpi-icon/);
  assert.match(fed,/\.fed-tabs button\.active\{border-color:var\(--tab-color\)/);
});
