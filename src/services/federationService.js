const {Op}=require('sequelize');
const {
  Federation,FederationMember,FederationEvent,FederationAchievement,
  Game,PlayerGameStat,Tournament
}=require('../models');
const {inactivityStatus}=require('./federationPolicy');

async function memberOf(federationId,userId){
  return FederationMember.findOne({where:{federationId:Number(federationId),userId:Number(userId),status:'active'}});
}

async function requireFederation(federationId,userId,{permission=null,president=false,publicRead=false}={}){
  const fed=await Federation.findByPk(Number(federationId));
  if(!fed)throw new Error('Federación inexistente.');
  const membership=await memberOf(fed.id,userId);
  if(!membership && (!publicRead || !fed.isPublic))throw new Error('No pertenecés a esta Federación.');
  if(president && membership?.role!=='president')throw new Error('Esta acción corresponde al Presidente.');
  if(permission && !['president'].includes(membership?.role) &&
    !(membership?.role==='secretary' && membership.permissions?.[permission]===true)){
    throw new Error('No tenés permisos para esta acción.');
  }
  if((president||permission)&&fed.status!=='active')throw new Error('La Federación no está activa.');
  return {fed,membership};
}

async function recordFederationEvent(federationId,kind,message,actorId=null,payload={}){
  const fed=await Federation.findByPk(federationId);
  if(!fed)return null;
  const event=await FederationEvent.create({federationId,kind,message:String(message).slice(0,500),actorId,payload});
  // El feed es la única fuente de actividad; no se generan notificaciones duplicadas.
  // Una Federación archivada no se reactiva por un evento tardío (p. ej.
  // resultado recibido de una partida iniciada antes de archivarla).
  if(fed.status!=='archived')await fed.update({lastActivityAt:new Date(),status:'active'});
  return event;
}

async function refreshInactivity(){
  const federations=await Federation.findAll({where:{status:{[Op.ne]:'archived'}}});
  for(const fed of federations){
    const next=inactivityStatus(fed.lastActivityAt);
    if(next!==fed.status)await fed.update({status:next});
  }
}

// Se recalcula desde partidas registradas. La clave única por ámbito evita
// otorgar dos veces el mismo hito al reiniciar un proceso o recibir reintentos.
async function refreshAchievementsForGame(gameId){
  const game=await Game.findByPk(gameId);
  if(!game||game.status!=='finished')return;
  const tournament=game.tournamentId?await Tournament.findByPk(game.tournamentId):null;
  const scopes=[null];
  if(tournament?.federationId)scopes.push(tournament.federationId);
  const stats=await PlayerGameStat.findAll({where:{gameId}});
  for(const stat of stats){
    const userId=stat.userId;
    const games=await PlayerGameStat.findAll({where:{userId},include:[{model:Game,attributes:['tournamentId','status']}],order:[['createdAt','ASC']]});
    for(const federationId of scopes){
      const played=games.filter(row=>{
        if(row.Game?.status!=='finished')return false;
        if(federationId==null)return true;
        // La pertenencia a la Federación se comprueba por sus torneos.
        return false;
      });
      const relevant=federationId==null?played:await PlayerGameStat.findAll({
        where:{userId},include:[{model:Game,required:true,include:[{model:Tournament,required:true,where:{federationId}}]}]
      });
      const victories=relevant.filter(s=>Number(s.finishPosition)===1).length;
      const correct=relevant.reduce((n,s)=>n+Number(s.correctAnswers||0),0);
      let streak=0,maxStreak=0;
      for(const s of relevant){streak=Number(s.finishPosition)===1?streak+1:0;maxStreak=Math.max(maxStreak,streak);}
      const achievements=[
        ['victories','victorias_1',victories,1],['victories','victorias_10',victories,10],
        ['correct_answers','correctas_10',correct,10],['correct_answers','correctas_100',correct,100],
        ['streaks','racha_3',maxStreak,3],['streaks','racha_5',maxStreak,5]
      ];
      for(const [family,code,value,threshold] of achievements){
        if(value<threshold)continue;
        const scopeKey=federationId==null?'global':`federation:${federationId}`;
        const [award,created]=await FederationAchievement.findOrCreate({
          where:{scopeKey,userId,code},defaults:{family,value:threshold,awardedAt:new Date(),federationId}
        });
        if(created&&federationId)await recordFederationEvent(federationId,'achievement',`Un federado consiguió el logro ${code.replaceAll('_',' ')}.`,userId,{code});
      }
    }
  }
}

module.exports={memberOf,requireFederation,recordFederationEvent,refreshInactivity,refreshAchievementsForGame};
