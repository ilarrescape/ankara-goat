// Los ajustes visuales del banner viven en el JSON de settings: no requieren migración.
const BANNER_KEYS=['bannerImageUrl','bannerPositionX','bannerPositionY'];
function bannerCoordinate(value){
  const n=Number(value);
  if(value==null||value===''||!Number.isFinite(n)||n<0||n>100)throw new Error('La posición del banner debe estar entre 0 y 100.');
  return Math.round(n*10)/10;
}
function preserveBannerSettings(previous,next){
  const result={...next};
  for(const key of BANNER_KEYS)if(Object.prototype.hasOwnProperty.call(previous||{},key))result[key]=previous[key];
  return result;
}
function updateBannerSettings(previous,{bannerImageUrl,positionX,positionY}){
  const next={...(previous||{})};
  if(bannerImageUrl!==undefined)next.bannerImageUrl=bannerImageUrl;
  if(positionX!==undefined)next.bannerPositionX=bannerCoordinate(positionX);
  if(positionY!==undefined)next.bannerPositionY=bannerCoordinate(positionY);
  return next;
}
module.exports={bannerCoordinate,preserveBannerSettings,updateBannerSettings};
