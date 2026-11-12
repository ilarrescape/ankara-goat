/* Amistosos federativos: reutilizan Game y su sala existente, sin torneos ni tablas nuevas. */
const {normalizeMode}=require('./questionTiers');

function friendlyMeta(game){
  const settings=game?.state?.settings||{};
  const data=settings.federationFriendly;
  return data&&Number.isInteger(Number(data.federationId))&&Number(data.federationId)>0?data:null;
}

function validateFriendlyConfig(input,categories,creatorId){
  const category=String(input?.category||'').trim();
  if(!Array.isArray(categories)||!categories.includes(category))throw new Error('Elegí una categoría de tu Federación.');
  const maxPlayers=Number(input?.maxPlayers??2);
  if(!Number.isInteger(maxPlayers)||maxPlayers<2||maxPlayers>8)throw new Error('El amistoso debe admitir entre 2 y 8 jugadores.');
  const boardSize=Number(input?.boardSize??40);
  if(!Number.isInteger(boardSize)||boardSize<30||boardSize>70)throw new Error('El tablero debe tener entre 30 y 70 casilleros.');
  const specialCellPercent=Number(input?.specialCellPercent??25);
  if(!Number.isInteger(specialCellPercent)||specialCellPercent<20||specialCellPercent>35)throw new Error('Los casilleros especiales deben ocupar entre el 20% y el 35%.');
  const targets=Array.isArray(input?.targetUserIds)?input.targetUserIds:[];
  if(targets.length>7)throw new Error('Podés invitar directamente hasta siete federados.');
  const targetUserIds=[...new Set(targets.map(Number))];
  if(targetUserIds.some(id=>!Number.isSafeInteger(id)||id<=0||id===Number(creatorId)))throw new Error('La lista de federados invitados no es válida.');
  if(targetUserIds.length>=maxPlayers)throw new Error('El cupo debe incluir al organizador y a los invitados.');
  return {category,maxPlayers,boardSize,specialCellPercent,questionMode:normalizeMode(input?.questionMode),targetUserIds};
}

async function ensureFriendlyMembership(game,userId){
  const meta=friendlyMeta(game);
  if(!meta)return null;
  const {Federation,FederationMember}=require('../models');
  const [fed,membership]=await Promise.all([
    Federation.findByPk(Number(meta.federationId)),
    FederationMember.findOne({where:{federationId:Number(meta.federationId),userId:Number(userId),status:'active'}})
  ]);
  if(!fed||fed.status!=='active'||!membership)throw new Error('Este amistoso es exclusivo de los federados activos.');
  return meta;
}

module.exports={friendlyMeta,validateFriendlyConfig,ensureFriendlyMembership};
