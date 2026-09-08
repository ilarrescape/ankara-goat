require('dotenv').config();
const { sequelize, Question } = require('../src/models');
const { runMigrations } = require('../src/config/migrations');

const demoQuestions = [
  {
    type:'multiple_choice', prompt:'¿Qué selección ganó el Mundial de 2014?',
    options:['Alemania','Argentina','Brasil','España'], correctAnswer:'Alemania', category:'Selecciones', competition:'Mundial', knowledgeArea:'Mundiales', tier:1, difficulty:1
  },
  {
    type:'multiple_choice', prompt:'¿Qué club ganó la Libertadores 2018?',
    options:['River Plate','Boca Juniors','Flamengo','Gremio'], correctAnswer:'River Plate', category:'Clubes', competition:'Libertadores', knowledgeArea:'Libertadores', tier:1, difficulty:1
  },
  {
    type:'multiple_choice', prompt:'¿En qué país juega el Shakhtar Donetsk?',
    options:['Ucrania','Polonia','Serbia','Croacia'], correctAnswer:'Ucrania', category:'Europa', competition:'Europa del Este', knowledgeArea:'Europa del Este', tier:2, difficulty:2
  },
  {
    type:'multiple_choice', prompt:'¿De qué país es el club Vojvodina?',
    options:['Serbia','Croacia','Eslovenia','Hungría'], correctAnswer:'Serbia', category:'Clubes', competition:'SuperLiga Serbia', knowledgeArea:'Europa del Este', tier:3, difficulty:3
  },
  {
    type:'categorization', prompt:'Clasificá a cada jugador según haya jugado o no en el FC Barcelona.',
    options:{categories:['Jugó en Barcelona','No jugó en Barcelona'],items:['Lionel Messi','Neymar','Cristiano Ronaldo','Luka Modrić']},
    correctAnswer:{'Lionel Messi':'Jugó en Barcelona','Neymar':'Jugó en Barcelona','Cristiano Ronaldo':'No jugó en Barcelona','Luka Modrić':'No jugó en Barcelona'},
    category:'Jugadores', competition:'LaLiga', knowledgeArea:'LaLiga', tier:1, difficulty:1
  },
  {
    type:'categorization', prompt:'Clasificá estos clubes por confederación.',
    options:{categories:['CONMEBOL','UEFA'],items:['Peñarol','Benfica','Atlético Nacional','Celtic']},
    correctAnswer:{'Peñarol':'CONMEBOL','Benfica':'UEFA','Atlético Nacional':'CONMEBOL','Celtic':'UEFA'},
    category:'Clubes', competition:'Internacional', knowledgeArea:'Fútbol internacional', tier:2, difficulty:2
  }
];

(async()=>{
  try{
    await sequelize.authenticate();
    await runMigrations();
    for(const q of demoQuestions){
      const [row,created]=await Question.findOrCreate({where:{prompt:q.prompt},defaults:{...q,reviewStatus:'published',active:true}});
      console.log(created?'Creada:':'Ya existe:',row.prompt);
    }
    console.log('Seed listo. Para producción importá tu banco de 30.000 preguntas con tier y knowledgeArea.');
  }catch(e){console.error(e);process.exitCode=1}finally{await sequelize.close()}
})();
