// Uso: node scripts/import-questions-json.js ./preguntas.json
require('dotenv').config();
const fs = require('fs');
const { sequelize, Question } = require('../src/models');
const { runMigrations } = require('../src/config/migrations');
const { inferTier } = require('../src/services/questionTiers');

(async()=>{
  const file=process.argv[2];
  if(!file) throw new Error('Indicá la ruta del JSON.');
  const rows=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!Array.isArray(rows)) throw new Error('El JSON debe contener un array.');
  await sequelize.authenticate();
  await runMigrations();
  const prepared=rows.map(q=>({
    ...q,
    tier:Number(q.tier||inferTier(q)),
    difficulty:Number(q.difficulty||2),
    knowledgeArea:q.knowledgeArea||q.competition||q.category||'General',
    reviewStatus:q.reviewStatus||'published',
    active:q.active!==false
  }));
  const chunk=500;
  for(let i=0;i<prepared.length;i+=chunk){
    await Question.bulkCreate(prepared.slice(i,i+chunk),{validate:true});
    console.log(`${Math.min(i+chunk,prepared.length)}/${prepared.length}`);
  }
  await sequelize.close();
})().catch(e=>{console.error(e);process.exit(1)});
