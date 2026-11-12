async function nextFederationSeason(Tournament,federationId,name,transaction){
  const previous=await Tournament.findOne({where:{federationId,name},order:[['seasonNumber','DESC'],['id','DESC']],transaction});
  return Number(previous?.seasonNumber||0)+1;
}
module.exports={nextFederationSeason};
