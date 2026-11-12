const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {normalizeQuestionMedia,safeImageUrl,uploadIllustration}=require('../src/services/storageService');
const {publicQuestion}=require('../src/services/questionService');
const {nextFederationSeason}=require('../src/services/federationSeasonService');
const root=path.join(__dirname,'..');
test('un banco de preguntas sin imágenes sigue funcionando',()=>{
  const q=publicQuestion({id:1,type:'multiple_choice',prompt:'Una pregunta',options:['A','B','C','D']});
  assert.equal(q.questionMedia,null);assert.equal(q.options.length,4);
});
test('las ilustraciones siguen a su opción tras mezclar respuestas',()=>{
  const q={id:4,type:'multiple_choice',prompt:'Ejemplo',options:['A','B','C','D'],questionMedia:{promptImageUrl:'/uploads/prompt-1.png',optionImageUrls:['/uploads/a.png','/uploads/b.png','/uploads/c.png','/uploads/d.png']}};
  for(let j=0;j<20;j++){
    const copy=publicQuestion(q);
    copy.options.forEach((value,i)=>assert.equal(copy.questionMedia.optionImageUrls[i],q.questionMedia.optionImageUrls[q.options.indexOf(value)]));
  }
});
test('se rechazan URLs peligrosas en imágenes y se limitan a 4 respuestas',()=>{
  assert.throws(()=>safeImageUrl('javascript:alert(1)'),/URL HTTPS/);
  assert.throws(()=>normalizeQuestionMedia({optionImageUrls:[1,2,3,4,5]}),/cuatro/);
  assert.equal(normalizeQuestionMedia({promptImageUrl:'https://example.com/img.png'}).promptImageUrl,'https://example.com/img.png');
});
test('subidas de imágenes rechazan contenido de tipo falso',async()=>{
  await assert.rejects(uploadIllustration(Buffer.from('malware'),'image/png',2,'questions'),/válido/);
  await assert.rejects(uploadIllustration(Buffer.from('fake'),'image/svg+xml',2,'questions'),/válido/);
});
test('cada edición repetida de un torneo federativo aumenta su temporada',async()=>{
  const fakeModel={findOne:async({where})=>{assert.equal(where.federationId,12);assert.equal(where.name,'Copa Algorítmica');return {seasonNumber:3}}};
  assert.equal(await nextFederationSeason(fakeModel,12,'Copa Algorítmica',null),4);
  fakeModel.findOne=async()=>null;
  assert.equal(await nextFederationSeason(fakeModel,12,'Copa Algorítmica',null),1);
});
test('la migración agrega medios y metadatos sin reconstruir otras tablas',()=>{
  const mig=fs.readFileSync(path.join(root,'migrations/202611060001-question-media-trophy-seasons.js'),'utf8');
  for(const term of ['question_media','trophy_image_url','season_number'])assert.match(mig,new RegExp(term));
  assert.doesNotMatch(mig,/dropTable|removeTable/);
});
