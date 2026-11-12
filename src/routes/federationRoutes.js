const express=require('express');
const multer=require('multer');
const {Op,Sequelize}=require('sequelize');
const {
  sequelize,Federation,FederationMember,FederationKnowledge,FederationRevision,FederationProposal,
  FederationChallenge,FederationEvent,FederationAttendance,FederationAchievement,
  User,Team,Question,Tournament,TournamentParticipant,Match,Game,GameQuestion,PlayerGameStat,UserTrophy
}=require('../models');
const auth=require('../middleware/auth');
const {normalizeQuestion,validateQuestion}=require('../services/questionImportService');
const {validateTournamentSettings}=require('../services/tournamentRules');
const {publicQuestion}=require('../services/questionService');
const {roomCode}=require('../utils/random');
const {withLockedGame}=require('../services/gameStore');
const {friendlyMeta,validateFriendlyConfig}=require('../services/federationFriendlies');
const {uploadCrest,uploadIllustration,normalizeQuestionMedia}=require('../services/storageService');
const {nextFederationSeason}=require('../services/federationSeasonService');
const {bannerCoordinate}=require('../services/tournamentBanner');
const {advanceAdministrativeMatch}=require('../services/tournamentProgressService');
const {rankLaureates}=require('../services/laureates');
const {memberOf,requireFederation,recordFederationEvent}=require('../services/federationService');
const {categoriesOf,publicUrl,normalizePermissions,validateProposal,attendanceResult,promptForQuestions,inviteCode,rankingPoints}=require('../services/federationPolicy');

const router=express.Router();
const imageUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:2*1024*1024}});
const integer=id=>Number.isInteger(Number(id))&&Number(id)>0?Number(id):0;
function validText(value,min,max,label){const s=String(value||'').trim();if(s.length<min||s.length>max)throw new Error(`${label}: ingresá entre ${min} y ${max} caracteres.`);return s;}
function slugify(s){return s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,108);}
function safeQuestion(q){const data=publicQuestion(q);return {...data,reviewStatus:q.reviewStatus,version:q.version,active:q.active};}
function safeFederation(fed){const json=fed.toJSON?.()||fed;const {inviteCode:secret,...rest}=json;return rest;}
const stamp=()=>new Date();

// Páginas y clasificaciones públicas: no exponen preguntas ni claves de invitación.
router.get('/public',async(req,res,next)=>{try{
  const rows=await Federation.findAll({where:{isPublic:true,status:'active'},order:[['lastActivityAt','DESC']],limit:60});
  res.json(rows.map(safeFederation));
}catch(e){next(e)}});
router.get('/public/:slug',async(req,res,next)=>{try{
  const fed=await Federation.findOne({where:{slug:req.params.slug,isPublic:true}});
  if(!fed)return res.status(404).json({error:'Federación privada o inexistente.'});
  const [members,tournaments]=await Promise.all([
    FederationMember.count({where:{federationId:fed.id,status:'active'}}),
    Tournament.findAll({where:{federationId:fed.id},attributes:['id','name','format','status','boardSize','federationCategory','shareCode'],order:[['createdAt','DESC']],limit:30})
  ]);
  res.json({federation:safeFederation(fed),members,tournaments});
}catch(e){next(e)}});

router.use(auth);
router.get('/mine',async(req,res,next)=>{try{
  const rows=await FederationMember.findAll({where:{userId:req.user.id,status:{[Op.in]:['active','pending']}},
    include:[{model:Federation}],order:[['updatedAt','DESC']]});
  res.json(rows.map(row=>({membership:{role:row.role,status:row.status,permissions:row.permissions},federation:safeFederation(row.Federation)})));
}catch(e){next(e)}});

router.post('/',async(req,res,next)=>{try{
  const name=validText(req.body.name,3,100,'Nombre');
  const categories=categoriesOf(req.body.categories);
  const crestUrl=req.body.crestUrl?publicUrl(req.body.crestUrl):null;
  const bannerUrl=req.body.bannerUrl?publicUrl(req.body.bannerUrl):null;
  let slug=slugify(name);if(!slug)slug='federacion';
  slug=`${slug}-${inviteCode().slice(0,6).toLowerCase()}`;
  const fed=await sequelize.transaction(async transaction=>{
    const created=await Federation.create({name,slug,description:String(req.body.description||'').slice(0,3000),
      crestUrl,bannerUrl,categories,isPublic:req.body.isPublic!==false,requiresApproval:req.body.requiresApproval===true,
      inviteCode:inviteCode(),presidentId:req.user.id,manifesto:'',lastActivityAt:stamp()},{transaction});
    await FederationMember.create({federationId:created.id,userId:req.user.id,role:'president',status:'active',joinedAt:stamp(),permissions:{}},{transaction});
    return created;
  });
  await recordFederationEvent(fed.id,'created',`Se creó la Federación ${name}.`,req.user.id);
  res.status(201).json({...safeFederation(fed),inviteCode:fed.inviteCode});
}catch(e){next(e)}});

router.get('/achievements/global',async(req,res,next)=>{try{
  res.json(await FederationAchievement.findAll({where:{scopeKey:'global',userId:req.user.id},order:[['awardedAt','DESC']],limit:80}));
}catch(e){next(e)}});
router.get('/:id',async(req,res,next)=>{try{
  const {fed,membership}=await requireFederation(req.params.id,req.user.id,{publicRead:true});
  const [memberCount,torneos]=await Promise.all([
    FederationMember.count({where:{federationId:fed.id,status:'active'}}),
    Tournament.findAll({where:{federationId:fed.id},order:[['createdAt','DESC']],limit:40,
      attributes:['id','name','format','status','federationCategory','federationScope','boardSize','seasonNumber','trophyImageUrl','shareCode']})
  ]);
  res.json({federation:safeFederation(fed),memberCount,viewerId:req.user.id,role:membership?.role||null,permissions:membership?.permissions||{},
    inviteCode:membership?.role==='president'?fed.inviteCode:undefined,
    tournaments:membership?await Tournament.findAll({where:{federationId:fed.id},order:[['createdAt','DESC']],limit:40,
      attributes:['id','name','format','status','federationCategory','federationScope','boardSize','seasonNumber','trophyImageUrl','shareCode','accessCode'] }):torneos});
}catch(e){next(e)}});

router.patch('/:id',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id,{president:true});
  const changes={};
  for(const key of ['name','description','isPublic','requiresApproval'])if(req.body[key]!==undefined){
    changes[key]=key==='name'?validText(req.body[key],3,100,'Nombre'):
      key==='description'?String(req.body[key]).slice(0,3000):req.body[key]===true;
  }
  if(req.body.categories!==undefined)changes.categories=categoriesOf(req.body.categories);
  for(const key of ['crestUrl','bannerUrl'])if(req.body[key]!==undefined)changes[key]=req.body[key]?publicUrl(req.body[key]):null;
  await fed.update(changes);
  await recordFederationEvent(fed.id,'settings','Se actualizó la identidad de la Federación.',req.user.id);
  res.json(safeFederation(fed));
}catch(e){next(e)}});

// El encuadre pertenece a la Federación y sólo su Presidente puede cambiarlo.
router.put('/:id/banner-position',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id,{president:true});
  if(!fed.bannerUrl)return res.status(400).json({error:'Primero cargá un banner para la Federación.'});
  let bannerPositionX,bannerPositionY;
  try{
    bannerPositionX=bannerCoordinate(req.body.positionX);
    bannerPositionY=bannerCoordinate(req.body.positionY);
  }catch(error){return res.status(400).json({error:error.message});}
  await fed.update({bannerPositionX,bannerPositionY});
  res.json({bannerPositionX:Number(fed.bannerPositionX),bannerPositionY:Number(fed.bannerPositionY)});
}catch(error){next(error)}});

router.post('/:id/reactivate',async(req,res,next)=>{try{
  const {fed,membership}=await requireFederation(req.params.id,req.user.id);
  if(membership?.role!=='president'||fed.status!=='suspended')throw new Error('Sólo el Presidente puede reactivar una Federación suspendida.');
  await fed.update({status:'active',lastActivityAt:stamp()});
  await recordFederationEvent(fed.id,'reactivated','La Federación retomó su actividad.',req.user.id);
  res.json({status:fed.status});
}catch(e){next(e)}});

router.post('/:id/assets/:kind',imageUpload.single('image'),async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id,{president:true});
  if(!['crest','banner'].includes(req.params.kind))throw new Error('Tipo de imagen inválido.');
  if(!req.file)throw new Error('Adjuntá una imagen PNG, JPEG o WebP.');
  const uploaded=await uploadCrest(req.file.buffer,req.file.mimetype,`federation-${fed.id}-${req.params.kind}`);
  const field=req.params.kind==='crest'?'crestUrl':'bannerUrl';
  await fed.update({[field]:uploaded.url,...(req.params.kind==='banner'?{bannerPositionX:50,bannerPositionY:50}:{})});
  await recordFederationEvent(fed.id,'identity',`Se actualizó la imagen de ${req.params.kind}.`,req.user.id);
  res.json({url:uploaded.url});
}catch(e){next(e)}});

router.post('/:id/join',async(req,res,next)=>{try{
  const fed=await Federation.findByPk(integer(req.params.id));
  if(!fed||fed.status!=='active')throw new Error('Federación no disponible.');
  if(!fed.isPublic&&String(req.body.inviteCode||'')!==fed.inviteCode)throw new Error('Se necesita una invitación válida.');
  const status=fed.requiresApproval?'pending':'active';
  const membership=await sequelize.transaction(async transaction=>{
    await Federation.findByPk(fed.id,{transaction,lock:transaction.LOCK.UPDATE});
    const existing=await FederationMember.findOne({where:{federationId:fed.id,userId:req.user.id},transaction});
    if(existing?.status==='active'||existing?.status==='pending')return existing;
    const total=await FederationMember.count({where:{federationId:fed.id,status:'active'},transaction});
    if(total>=2000)throw new Error('La Federación alcanzó el límite de 2.000 federados.');
    if(existing){await existing.update({status,role:'member',permissions:{},joinedAt:status==='active'?stamp():null},{transaction});return existing;}
    return FederationMember.create({federationId:fed.id,userId:req.user.id,status,role:'member',permissions:{},joinedAt:status==='active'?stamp():null},{transaction});
  });
  if(membership.status==='active')await recordFederationEvent(fed.id,'member_joined','Se incorporó un nuevo federado.',req.user.id);
  res.json({status:membership.status,role:membership.role});
}catch(e){next(e)}});

// Amistosos: salas normales de AnkaraGOAT vinculadas a una Federación y su categoría.
// Las invitaciones directas son orientativas; al publicar en el feed cualquier federado activo puede unirse.
router.get('/:id/friendlies',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id);
  const games=await Game.findAll({where:{status:'lobby',
    [Op.and]:Sequelize.literal(`JSON_EXTRACT(\`state\`, '$.settings.federationFriendly.federationId') = ${Number(fed.id)}`)},
    order:[['createdAt','DESC']],limit:60});
  res.json(games.filter(game=>{
    const meta=friendlyMeta(game);
    return meta&&(meta.published||Number(game.state?.organizerId)===Number(req.user.id)||
      (meta.targetUserIds||[]).map(Number).includes(Number(req.user.id)));
  }).map(game=>({
    id:game.id,roomCode:game.roomCode,name:game.name,createdAt:game.createdAt,
    category:game.state.settings.federationFriendly.category,
    published:game.state.settings.federationFriendly.published===true,
    organizerId:game.state.organizerId,maxPlayers:game.state.settings.maxPlayers,
    players:(game.state.players||[]).map(p=>({userId:p.userId,username:p.username})),
    targeted:(game.state.settings.federationFriendly.targetUserIds||[]).map(Number).includes(Number(req.user.id))
  })));
}catch(e){next(e)}});

router.post('/:id/friendlies',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id);
  if(fed.status!=='active')throw new Error('La Federación no está activa.');
  const config=validateFriendlyConfig(req.body,fed.categories,req.user.id);
  const count=await Question.count({where:{federationId:fed.id,category:config.category,
    reviewStatus:'published',active:true,deletedAt:null}});
  if(!count)throw new Error('Esta categoría todavía no tiene preguntas aprobadas para jugar.');
  if(config.targetUserIds.length){
    const members=await FederationMember.count({where:{federationId:fed.id,status:'active',userId:{[Op.in]:config.targetUserIds}}});
    if(members!==config.targetUserIds.length)throw new Error('Todos los invitados deben ser federados activos.');
  }
  const user=await User.findByPk(req.user.id,{attributes:['id','username','eloRating','level'],include:[Team]});
  if(!user)throw new Error('Usuario inexistente.');
  const team=user.Team?{id:user.Team.id,name:user.Team.name,crestEmoji:user.Team.crestEmoji,
    crestUrl:user.Team.crestUrl,primaryColor:user.Team.primaryColor,secondaryColor:user.Team.secondaryColor,
    shirtPattern:user.Team.shirtPattern}:null;
  const player={userId:user.id,username:user.username,eloRating:user.eloRating,level:user.level,team};
  let code=null;
  for(let i=0;i<10;i++){
    const candidate=roomCode();
    if(!await Game.findOne({where:{roomCode:candidate}})){code=candidate;break;}
  }
  if(!code)throw new Error('No se pudo crear un código de sala.');
  const name=req.body.name?validText(req.body.name,3,100,'Nombre'):`Amistoso de ${user.username}`;
  const game=await Game.create({roomCode:code,name,boardSize:config.boardSize,status:'lobby',spectatorsAllowed:false,
    state:{boardSize:config.boardSize,phase:'lobby',players:[player],organizerId:req.user.id,
      settings:{questionMode:config.questionMode,maxPlayers:config.maxPlayers,
        specialCellPercent:config.specialCellPercent,
        federationFriendly:{federationId:fed.id,category:config.category,targetUserIds:config.targetUserIds,published:false}}}});
  res.status(201).json({gameId:game.id,roomCode:game.roomCode,name:game.name,category:config.category,
    maxPlayers:config.maxPlayers});
}catch(e){next(e)}});

router.post('/:id/friendlies/:gameId/publish',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id);
  if(fed.status!=='active')throw new Error('La Federación no está activa.');
  // La publicación y la marca en la sala se confirman en la misma transacción.
  // Si hay un fallo, el organizador puede reintentar sin perder su invitación.
  const saved=await withLockedGame(integer(req.params.gameId),async(state,game,transaction)=>{
    const meta=state.settings?.federationFriendly;
    if(Number(meta?.federationId)!==Number(fed.id))throw new Error('La sala no pertenece a esta Federación.');
    if(Number(state.organizerId)!==Number(req.user.id))throw new Error('Sólo quien creó la sala puede publicar la invitación.');
    if(game.status!=='lobby')throw new Error('El amistoso ya comenzó o terminó.');
    if(meta.published)return false;
    await FederationEvent.create({federationId:fed.id,kind:'friendly_invite',
      message:`Amistoso abierto: ${game.name} · ${meta.category}.`.slice(0,500),actorId:req.user.id,
      payload:{gameId:game.id,roomCode:game.roomCode,category:meta.category,
        maxPlayers:state.settings.maxPlayers}},{transaction});
    meta.published=true;
    return true;
  });
  if(saved.result)await fed.update({lastActivityAt:stamp()});
  res.json({published:true,roomCode:saved.game.roomCode,alreadyPublished:!saved.result});
}catch(e){next(e)}});

router.get('/:id/members',async(req,res,next)=>{try{
  const pending=req.query.pending==='1';
  const {fed}=await requireFederation(req.params.id,req.user.id,pending?{permission:'members'}:{publicRead:true});
  const where={federationId:fed.id,status:pending?'pending':'active'};
  const q=String(req.query.q||'').trim().slice(0,40);
  const page=Math.max(1,Math.floor(Number(req.query.page)||1));
  const {rows,count}=await FederationMember.findAndCountAll({where,
    include:[{model:User,where:q?{username:{[Op.like]:`%${q}%`}}:undefined,attributes:['id','username'],include:[{model:Team,attributes:['crestUrl','crestEmoji','primaryColor']}]}],
    order:[['joinedAt','ASC']],limit:40,offset:(page-1)*40});
  res.json({members:rows.map(row=>({user:row.User,role:row.role,joinedAt:row.joinedAt,permissions:row.permissions})),total:count,page});
}catch(e){next(e)}});

router.patch('/:id/members/:userId',async(req,res,next)=>{try{
  const {fed,membership}=await requireFederation(req.params.id,req.user.id,{permission:'members'});
  const target=await sequelize.transaction(async transaction=>{
    // Serializa las aprobaciones junto con las solicitudes de ingreso.
    await Federation.findByPk(fed.id,{transaction,lock:transaction.LOCK.UPDATE});
    const row=await FederationMember.findOne({where:{federationId:fed.id,userId:integer(req.params.userId)},transaction,lock:transaction.LOCK.UPDATE});
    if(!row||row.role==='president')throw new Error('Integrante inválido o protegido.');
    if(req.body.role!==undefined){
      if(membership.role!=='president')throw new Error('Sólo el Presidente cambia roles.');
      if(!['secretary','member'].includes(req.body.role))throw new Error('Rol inválido.');
      row.role=req.body.role;if(row.role==='member')row.permissions={};
    }
    if(req.body.permissions!==undefined){
      if(membership.role!=='president'||row.role!=='secretary')throw new Error('Permisos reservados al Presidente.');
      row.permissions=normalizePermissions(req.body.permissions);
    }
    if(req.body.status!==undefined){
      if(!['active','rejected'].includes(req.body.status))throw new Error('Estado inválido.');
      if(row.status!=='active'&&req.body.status==='active'){
        const total=await FederationMember.count({where:{federationId:fed.id,status:'active'},transaction});
        if(total>=2000)throw new Error('La Federación está completa.');
      }
      row.status=req.body.status;if(row.status==='active'&&!row.joinedAt)row.joinedAt=stamp();
    }
    await row.save({transaction});return row;
  });
  await recordFederationEvent(fed.id,'member_updated','Se actualizó el equipo de federados.',req.user.id);
  res.json({userId:target.userId,role:target.role,status:target.status,permissions:target.permissions});
}catch(e){next(e)}});

router.get('/:id/knowledge',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id,{publicRead:true});
  const where={federationId:fed.id,active:true};
  if(req.query.tournamentId)where.tournamentId=integer(req.query.tournamentId);
  else if(req.query.general==='1')where.tournamentId=null;
  res.json(await FederationKnowledge.findAll({where,order:[['updatedAt','DESC']],limit:150}));
}catch(e){next(e)}});

router.post('/:id/knowledge',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id,{permission:'knowledge'});
  const title=validText(req.body.title,3,180,'Título');const url=publicUrl(req.body.url);
  const category=req.body.category||null;
  if(category&&!fed.categories.includes(category))throw new Error('Categoría ajena a la Federación.');
  const tournamentId=req.body.tournamentId?integer(req.body.tournamentId):null;
  if(tournamentId&&!await Tournament.findOne({where:{id:tournamentId,federationId:fed.id}}))throw new Error('Torneo inválido.');
  const item=await FederationKnowledge.create({federationId:fed.id,authorId:req.user.id,title,url,category,tournamentId});
  await FederationRevision.create({federationId:fed.id,kind:'knowledge',entityId:item.id,version:1,editorId:req.user.id,snapshot:item.toJSON()});
  await recordFederationEvent(fed.id,'knowledge',`Nuevo material de estudio: ${title}.`,req.user.id,{id:item.id});
  res.status(201).json(item);
}catch(e){next(e)}});

router.patch('/:id/knowledge/:knowledgeId',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id,{permission:'knowledge'});
  const item=await FederationKnowledge.findOne({where:{id:integer(req.params.knowledgeId),federationId:fed.id}});
  if(!item)throw new Error('Enlace inexistente.');
  const change={version:item.version+1};
  if(req.body.title!==undefined)change.title=validText(req.body.title,3,180,'Título');
  if(req.body.url!==undefined)change.url=publicUrl(req.body.url);
  if(req.body.active!==undefined)change.active=req.body.active===true;
  await item.update(change);
  await FederationRevision.create({federationId:fed.id,kind:'knowledge',entityId:item.id,version:item.version,editorId:req.user.id,snapshot:item.toJSON()});
  await recordFederationEvent(fed.id,'knowledge','Se actualizó un material del banco de conocimiento.',req.user.id,{id:item.id});
  res.json(item);
}catch(e){next(e)}});

router.get('/:id/prompt',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id);
  res.json({prompt:promptForQuestions({categories:fed.categories,category:req.query.category||fed.categories[0],count:req.query.count,easy:req.query.easy,medium:req.query.medium,hard:req.query.hard})});
}catch(e){next(e)}});

router.get('/:id/questions',async(req,res,next)=>{try{
  const {fed,membership}=await requireFederation(req.params.id,req.user.id);
  const reviewer=membership.role==='president'||membership.role==='secretary'&&membership.permissions?.questions===true;
  const where={federationId:fed.id,deletedAt:null,...(reviewer?{}:{reviewStatus:'published',active:true})};
  if(req.query.category)where.category=req.query.category;
  const rows=await Question.findAll({where,order:[['updatedAt','DESC']],limit:200});
  res.json(rows.map(q=>reviewer?q:safeQuestion(q)));
}catch(e){next(e)}});

// Carga manual (las importaciones por IA/JSON siguen sin imágenes por defecto).
router.post('/:id/questions',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id,{permission:'questions'});
  const prepared=validateQuestion(normalizeQuestion(req.body||{}));
  if(!fed.categories.includes(prepared.category))throw new Error('Categoría inválida para esta Federación.');
  const media=normalizeQuestionMedia(req.body.questionMedia);
  const q=await sequelize.transaction(async transaction=>{
    const created=await Question.create({...prepared,questionMedia:media,federationId:fed.id,federationAuthorId:req.user.id,
      reviewStatus:'review',active:false,reviewedById:null,reviewedAt:null},{transaction});
    await FederationRevision.create({federationId:fed.id,kind:'question',entityId:created.id,version:created.version,
      editorId:req.user.id,snapshot:created.toJSON()},{transaction});
    return created;
  });
  res.status(201).json(safeQuestion(q));
}catch(e){next(e)}});
router.post('/:id/questions/media',imageUpload.single('image'),async(req,res,next)=>{try{
  await requireFederation(req.params.id,req.user.id,{permission:'questions'});
  if(!req.file)throw new Error('Seleccioná una imagen.');
  res.status(201).json(await uploadIllustration(req.file.buffer,req.file.mimetype,req.user.id,'questions'));
}catch(e){next(e)}});

router.post('/:id/questions/import',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id,{permission:'questions'});
  const rows=req.body.questions;
  if(!Array.isArray(rows)||!rows.length||rows.length>500)throw new Error('Importá de 1 a 500 preguntas en un array JSON.');
  const questions=rows.map((raw,i)=>{
    const q=validateQuestion(normalizeQuestion(raw),i+1);
    if(!fed.categories.includes(q.category))throw new Error(`Fila ${i+1}: categoría inválida para esta Federación.`);
    return {...q,federationId:fed.id,federationAuthorId:req.user.id,reviewStatus:'review',active:false,reviewedById:null,reviewedAt:null};
  });
  const created=await sequelize.transaction(async transaction=>{
    const inserted=await Question.bulkCreate(questions,{validate:true,transaction});
    await FederationRevision.bulkCreate(inserted.map(q=>({federationId:fed.id,kind:'question',entityId:q.id,version:1,editorId:req.user.id,snapshot:q.toJSON()})),{transaction});
    return inserted;
  });
  res.status(201).json({inserted:created.length,reviewStatus:'review'});
}catch(e){next(e)}});

router.patch('/:id/questions/:questionId',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id,{permission:'questions'});
  const q=await Question.findOne({where:{id:integer(req.params.questionId),federationId:fed.id,deletedAt:null}});
  if(!q)throw new Error('Pregunta ajena o inexistente.');
  const merged={...q.toJSON()};
  for(const key of ['type','prompt','options','correctAnswer','category','competition','knowledgeArea','tier','difficulty'])if(req.body[key]!==undefined)merged[key]=req.body[key];
  const media=req.body.questionMedia===undefined?q.questionMedia:normalizeQuestionMedia(req.body.questionMedia);
  const prepared=validateQuestion(normalizeQuestion(merged));
  if(!fed.categories.includes(prepared.category))throw new Error('Categoría inválida.');
  const updates={...prepared,questionMedia:media,active:false,reviewStatus:'review',reviewedById:null,reviewedAt:null,version:q.version+1};
  await q.update(updates);
  await FederationRevision.create({federationId:fed.id,kind:'question',entityId:q.id,version:q.version,editorId:req.user.id,snapshot:q.toJSON()});
  res.json(safeQuestion(q));
}catch(e){next(e)}});

// Borrado lógico: conserva snapshots históricos y relaciones con partidas.
router.delete('/:id/questions/:questionId',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id,{permission:'questions'});
  const q=await Question.findOne({where:{id:integer(req.params.questionId),federationId:fed.id,deletedAt:null}});
  if(!q)return res.status(404).json({error:'Pregunta inexistente.'});
  await sequelize.transaction(async transaction=>{
    await q.update({active:false,deletedAt:stamp(),version:q.version+1},{transaction});
    await FederationRevision.create({federationId:fed.id,kind:'question',entityId:q.id,version:q.version,
      editorId:req.user.id,snapshot:{...q.toJSON(),deleted:true}},{transaction});
  });
  res.json({deleted:true});
}catch(e){next(e)}});

router.post('/:id/questions/:questionId/decision',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id,{president:true});
  const q=await Question.findOne({where:{id:integer(req.params.questionId),federationId:fed.id,deletedAt:null}});
  if(!q)throw new Error('Pregunta ajena o inexistente.');
  const approve=req.body.approve===true;
  await q.update({reviewStatus:approve?'published':'rejected',active:approve,reviewedById:req.user.id,reviewedAt:stamp(),version:q.version+1});
  await FederationRevision.create({federationId:fed.id,kind:'question',entityId:q.id,version:q.version,editorId:req.user.id,snapshot:q.toJSON()});
  res.json(safeQuestion(q));
}catch(e){next(e)}});

router.post('/:id/manifesto',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id,{president:true});
  const manifesto=validText(req.body.manifesto,10,8000,'Manifiesto');
  await fed.update({manifesto,manifestoVersion:fed.manifestoVersion+1});
  await FederationRevision.create({federationId:fed.id,kind:'manifesto',entityId:fed.id,version:fed.manifestoVersion,editorId:req.user.id,snapshot:{manifesto}});
  await recordFederationEvent(fed.id,'rules','Se publicó una nueva versión del manifiesto.',req.user.id,{version:fed.manifestoVersion});
  res.json({manifesto,version:fed.manifestoVersion,globalRules:'/rules.html'});
}catch(e){next(e)}});

router.get('/:id/proposals',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id);
  res.json(await FederationProposal.findAll({where:{federationId:fed.id},order:[['createdAt','DESC']],limit:100}));
}catch(e){next(e)}});

router.post('/:id/proposals',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id);
  const payload=validateProposal(req.body,fed.categories);
  const proposal=await FederationProposal.create({federationId:fed.id,proposerId:req.user.id,payload});
  await recordFederationEvent(fed.id,'tournament_proposal',`Se propuso el torneo ${payload.name}.`,req.user.id,{proposalId:proposal.id});
  res.status(201).json(proposal);
}catch(e){next(e)}});

router.post('/:id/proposals/:proposalId/decision',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id,{president:true});
  const approved=req.body.approve===true;
  const output=await sequelize.transaction(async transaction=>{
    const proposal=await FederationProposal.findOne({where:{id:integer(req.params.proposalId),federationId:fed.id},transaction,lock:transaction.LOCK.UPDATE});
    if(!proposal||proposal.status!=='pending')throw new Error('Propuesta ya resuelta o inexistente.');
    let tournament=null;
    if(approved){
      const p=validateProposal(proposal.payload,fed.categories);
      const approvedQuestions=await Question.count({where:{federationId:fed.id,category:p.category,reviewStatus:'published',active:true},transaction});
      if(!approvedQuestions)throw new Error('Aprobá preguntas de esta temática antes de abrir el torneo.');
      const seasonNumber=await nextFederationSeason(Tournament,fed.id,p.name,transaction);
      tournament=await Tournament.create({name:p.name,format:p.format,boardSize:p.boardSize,seasonNumber,
        settings:{...p.settings,maxPlayersPerBoard:p.maxPlayers},status:'open',organizerId:fed.presidentId,
        federationId:fed.id,federationCategory:p.category,federationScope:'federative',accessCode:roomCode()}, {transaction});
      await TournamentParticipant.findOrCreate({where:{tournamentId:tournament.id,userId:fed.presidentId},defaults:{seed:1},transaction});
    }
    await proposal.update({status:approved?'approved':'rejected',tournamentId:tournament?.id||null},{transaction});
    return {proposal,tournament};
  });
  await recordFederationEvent(fed.id,approved?'tournament':'proposal_rejected',approved?`Se aprobó el torneo ${output.proposal.payload.name}.`:'Una propuesta de torneo fue rechazada.',req.user.id,{tournamentId:output.tournament?.id||null});
  res.json(output);
}catch(e){next(e)}});

router.post('/:id/tournaments/:tournamentId/join',async(req,res,next)=>{try{
  const fed=await Federation.findByPk(integer(req.params.id));
  if(!fed||fed.status!=='active')throw new Error('Federación no disponible.');
  const output=await sequelize.transaction(async transaction=>{
    const tournament=await Tournament.findOne({where:{id:integer(req.params.tournamentId),federationId:fed.id},transaction,lock:transaction.LOCK.UPDATE});
    if(!tournament||tournament.status!=='open')throw new Error('El torneo ya no admite inscripciones.');
    const current=await TournamentParticipant.findOne({where:{tournamentId:tournament.id,userId:req.user.id},transaction});
    if(current)return {joined:true,already:true};
    const opponentId=Number(tournament.settings?.opponentFederationId||0);
    if(!await memberOf(fed.id,req.user.id)&&!(opponentId&&await memberOf(opponentId,req.user.id)))throw new Error('No pertenecés a las Federaciones participantes.');
    const n=await TournamentParticipant.count({where:{tournamentId:tournament.id},transaction});
    if(n>=Number(tournament.settings?.maxParticipants||0))throw new Error('El torneo está completo.');
    await TournamentParticipant.create({tournamentId:tournament.id,userId:req.user.id,seed:n+1},{transaction});
    return {joined:true};
  });
  res.json(output);
}catch(e){next(e)}});

// El banco de estudio de un interfederativo reúne las preguntas aprobadas de
// AMBAS comunidades, sin revelar jamás correctAnswer a los federados.
router.get('/:id/tournaments/:tournamentId/study',async(req,res,next)=>{try{
  const tournament=await Tournament.findOne({where:{id:integer(req.params.tournamentId),federationId:integer(req.params.id)}});
  if(!tournament)throw new Error('Torneo inexistente.');
  const federationIds=[Number(tournament.federationId),Number(tournament.settings?.opponentFederationId||0)].filter(Boolean);
  const access=await FederationMember.findOne({where:{userId:req.user.id,federationId:{[Op.in]:federationIds},status:'active'}});
  if(!access)throw new Error('Sólo los federados participantes pueden consultar este banco de estudio.');
  const category=tournament.federationCategory;
  const [questions,knowledge]=await Promise.all([
    Question.findAll({where:{federationId:{[Op.in]:federationIds},reviewStatus:'published',active:true,category},limit:500,order:[['id','ASC']]}),
    FederationKnowledge.findAll({where:{federationId:{[Op.in]:federationIds},active:true,
      [Op.or]:[{tournamentId:null},{tournamentId:tournament.id}]},limit:150,order:[['updatedAt','DESC']]})
  ]);
  res.json({category,questions:questions.map(publicQuestion),knowledge});
}catch(e){next(e)}});

router.get('/:id/feed',async(req,res,next)=>{try{
  const {fed,membership}=await requireFederation(req.params.id,req.user.id,{publicRead:true});
  const events=await FederationEvent.findAll({where:{federationId:fed.id,kind:{[Op.ne]:'questions'}},order:[['createdAt','DESC']],limit:100});
  res.json(membership?events:events.filter(event=>event.kind!=='friendly_invite'));
}catch(e){next(e)}});

const ANNOUNCEMENT_ICONS=new Set(['megaphone','bullhorn','info','calendar','trophy','star','book','flag','users','heart']);
function announcementIcon(value){const icon=String(value||'megaphone');if(!ANNOUNCEMENT_ICONS.has(icon))throw new Error('Ícono de comunicado inválido.');return icon;}
router.patch('/:id/feed/:eventId',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id,{permission:'feed'});
  const event=await FederationEvent.findOne({where:{id:integer(req.params.eventId),federationId:fed.id,kind:'announcement'}});
  if(!event)return res.status(404).json({error:'Comunicado inexistente.'});
  const message=validText(req.body.message,5,500,'Comunicado');
  const icon=announcementIcon(req.body.icon);
  await event.update({message,payload:{...(event.payload||{}),icon,editedAt:stamp().toISOString()}});
  res.json(event);
}catch(e){next(e)}});
router.post('/:id/feed',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id,{permission:'feed'});
  const message=validText(req.body.message,5,500,'Comunicado');
  const event=await recordFederationEvent(fed.id,'announcement',message,req.user.id,{icon:announcementIcon(req.body.icon)});
  res.status(201).json(event);
}catch(e){next(e)}});

router.get('/:id/attendance',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id);
  const where={federationId:fed.id};
  if(req.query.tournamentId){
    const tournament=await Tournament.findOne({where:{id:integer(req.query.tournamentId),federationId:fed.id}});
    if(!tournament)throw new Error('Torneo ajeno a esta Federación.');
    const matches=await Match.findAll({where:{tournamentId:tournament.id},attributes:['id']});
    where.matchId={[Op.in]:matches.map(m=>m.id)};
  }
  const rows=await FederationAttendance.findAll({where,order:[['scheduledAt','DESC']],limit:100});
  res.json(rows.map(row=>({...row.toJSON(),canCheckIn:(row.invitedIds||[]).map(Number).includes(Number(req.user.id))})));
}catch(e){next(e)}});

router.post('/:id/attendance',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id,{permission:'tournaments'});
  const match=await Match.findByPk(integer(req.body.matchId),{include:[{model:Tournament,where:{federationId:fed.id}}]});
  if(!match||!['scheduled','ready'].includes(match.status))throw new Error('Partido no disponible para convocatoria.');
  const invitedIds=[...new Set((req.body.invitedIds||[]).map(integer).filter(Boolean))];
  if(invitedIds.length<2||invitedIds.length>8)throw new Error('La convocatoria necesita entre 2 y 8 jugadores.');
  const allowedIds=(await TournamentParticipant.findAll({where:{tournamentId:match.tournamentId},attributes:['userId'],raw:true})).map(row=>Number(row.userId));
  if(invitedIds.some(id=>!allowedIds.includes(id)))throw new Error('Los convocados deben pertenecer al torneo.');
  const assigned=(match.participants||[]).map(Number);
  if(assigned.length&&(assigned.length!==invitedIds.length||assigned.some(id=>!invitedIds.includes(id))))throw new Error('La convocatoria debe incluir exactamente los jugadores de este encuentro.');
  const date=new Date(req.body.scheduledAt);
  if(!Number.isFinite(date.getTime())||date.getTime()<Date.now()-5*60*1000)throw new Error('Fecha de convocatoria inválida.');
  const [record,created]=await FederationAttendance.findOrCreate({where:{matchId:match.id},
    defaults:{federationId:fed.id,scheduledAt:date,invitedIds,presentIds:[],reprogramCount:0}});
  if(!created)throw new Error('El partido ya tiene convocatoria.');
  await recordFederationEvent(fed.id,'schedule','Se convocó una nueva fecha de torneo.',req.user.id,{matchId:match.id});
  res.status(201).json(record);
}catch(e){next(e)}});

router.post('/:id/attendance/:attendanceId/checkin',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id);
  const record=await sequelize.transaction(async transaction=>{
    const attendance=await FederationAttendance.findOne({where:{id:integer(req.params.attendanceId),federationId:fed.id},transaction,lock:transaction.LOCK.UPDATE});
    if(!attendance||attendance.resolution)throw new Error('Convocatoria inexistente o resuelta.');
    if(!attendance.invitedIds.map(Number).includes(Number(req.user.id)))throw new Error('No estás convocado.');
    const ts=attendance.scheduledAt.getTime();
    if(Date.now()<ts-5*60*1000||Date.now()>ts+5*60*1000)throw new Error('Registro disponible desde cinco minutos antes hasta cinco minutos después del horario.');
    attendance.presentIds=[...new Set([...(attendance.presentIds||[]).map(Number),Number(req.user.id)])];
    await attendance.save({transaction});return attendance;
  });
  res.json({presentIds:record.presentIds});
}catch(e){next(e)}});

router.post('/:id/attendance/:attendanceId/reschedule',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id,{permission:'tournaments'});
  const date=new Date(req.body.scheduledAt);
  if(!Number.isFinite(date.getTime())||date.getTime()<=Date.now())throw new Error('La nueva fecha debe ser futura.');
  const record=await sequelize.transaction(async transaction=>{
    const item=await FederationAttendance.findOne({where:{id:integer(req.params.attendanceId),federationId:fed.id},transaction,lock:transaction.LOCK.UPDATE});
    if(!item||item.resolution||item.reprogramCount>=3)throw new Error('No se puede reprogramar más veces.');
    await item.update({scheduledAt:date,reprogramCount:item.reprogramCount+1,presentIds:[]},{transaction});return item;
  });
  await recordFederationEvent(fed.id,'reschedule','Se reprogramó un encuentro.',req.user.id,{attendanceId:record.id});
  res.json(record);
}catch(e){next(e)}});

router.post('/:id/attendance/:attendanceId/resolve',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id,{permission:'tournaments'});
  const result=await sequelize.transaction(async transaction=>{
    const item=await FederationAttendance.findOne({where:{id:integer(req.params.attendanceId),federationId:fed.id},transaction,lock:transaction.LOCK.UPDATE});
    if(!item||item.resolution)throw new Error('Convocatoria resuelta o inexistente.');
    const base=attendanceResult(item.toJSON());
    if(base.status==='waiting')throw new Error('Todavía no transcurrieron los cinco minutos.');
    if(base.status==='ready')return {status:'ready',presentIds:item.presentIds,matchId:item.matchId};
    const awards=req.body.awards||[];
    if(!Array.isArray(awards)||awards.some(a=>!item.invitedIds.map(Number).includes(integer(a.userId))||![0,1,2].includes(Number(a.points))))throw new Error('Distribución administrativa inválida.');
    const ids=new Set();for(const a of awards){if(ids.has(Number(a.userId)))throw new Error('Puntuación duplicada.');ids.add(Number(a.userId));}
    if(ids.size!==item.invitedIds.length)throw new Error('La resolución debe asignar puntos a todos los convocados, incluidos los ausentes.');
    const match=await Match.findByPk(item.matchId,{transaction,lock:transaction.LOCK.UPDATE});
    if(!match||match.status==='finished')throw new Error('El partido ya fue resuelto.');
    const present=new Set((item.presentIds||[]).map(Number));
    const top=Math.max(...awards.map(a=>Number(a.points)));
    const leaders=awards.filter(a=>Number(a.points)===top);
    const winnerUserId=top>0&&leaders.length===1&&present.has(Number(leaders[0].userId))?Number(leaders[0].userId):null;
    if(!['league','shared_league','group'].includes(match.stage)&&!winnerUserId)
      throw new Error('Para cerrar una llave eliminatoria debe existir un único ganador presente con puntuación mayor que cero. Reprogramá o resolvé la excepción antes de avanzar.');
    for(const award of awards){
      if(!present.has(Number(award.userId))&&Number(award.points)!==0)throw new Error('Un ausente no recibe puntos.');
      await TournamentParticipant.increment({points:Number(award.points)},{where:{tournamentId:match.tournamentId,userId:Number(award.userId)},transaction});
    }
    const resolution={...base,awards,winnerUserId,administrative:true,resolvedAt:stamp()};
    await item.update({resolution},{transaction});
    await match.update({status:'finished',result:{walkover:true,winnerUserId,resolution}},{transaction});
    await advanceAdministrativeMatch(match.tournamentId,transaction);
    return resolution;
  });
  if(result.status==='walkover')await recordFederationEvent(fed.id,'walkover','Encuentro resuelto administrativamente por inasistencia.',req.user.id,{attendanceId:integer(req.params.attendanceId)});
  res.json(result);
}catch(e){next(e)}});

router.post('/challenges',async(req,res,next)=>{try{
  const {fed:challenger}=await requireFederation(req.body.challengerId,req.user.id,{president:true});
  const challenged=await Federation.findByPk(integer(req.body.challengedId));
  if(!challenged||challenged.id===challenger.id||challenged.status!=='active')throw new Error('Federación rival inválida.');
  const common=challenger.categories.filter(c=>challenged.categories.includes(c));
  const terms=validateProposal({...req.body.terms,format:req.body.terms?.format||'cup',
    maxParticipants:req.body.terms?.maxParticipants||4},common);
  const kind=req.body.kind==='classic'?'classic':'interfederative';
  if(kind==='classic'&&terms.maxPlayers!==2)throw new Error('Un clásico 1v1 requiere dos jugadores por tablero.');
  const challenge=await FederationChallenge.create({challengerId:challenger.id,challengedId:challenged.id,
    createdById:req.user.id,kind,terms,status:'pending'});
  await recordFederationEvent(challenged.id,'challenge',`La Federación ${challenger.name} envió un desafío.`,req.user.id,{challengeId:challenge.id});
  await recordFederationEvent(challenger.id,'challenge_sent',`Desafiaste a ${challenged.name}.`,req.user.id,{challengeId:challenge.id});
  res.status(201).json(challenge);
}catch(e){next(e)}});

router.get('/challenges/mine',async(req,res,next)=>{try{
  const memberships=await FederationMember.findAll({where:{userId:req.user.id,status:'active'},attributes:['federationId']});
  const ids=memberships.map(m=>m.federationId);
  if(!ids.length)return res.json([]);
  res.json(await FederationChallenge.findAll({where:{[Op.or]:[{challengerId:{[Op.in]:ids}},{challengedId:{[Op.in]:ids}}]},
    order:[['createdAt','DESC']],limit:100}));
}catch(e){next(e)}});

router.post('/challenges/:challengeId/respond',async(req,res,next)=>{try{
  const challenge=await FederationChallenge.findByPk(integer(req.params.challengeId));
  if(!challenge||challenge.status!=='pending')throw new Error('Desafío inexistente o ya respondido.');
  const {fed:challenged}=await requireFederation(challenge.challengedId,req.user.id,{president:true});
  const accept=req.body.accept===true;
  const updated=await sequelize.transaction(async transaction=>{
    const locked=await FederationChallenge.findByPk(challenge.id,{transaction,lock:transaction.LOCK.UPDATE});
    if(locked.status!=='pending')throw new Error('El desafío ya fue respondido.');
    let tournament=null;
    if(accept){
      const challenger=await Federation.findByPk(locked.challengerId,{transaction});
      const common=challenger.categories.filter(c=>challenged.categories.includes(c));
      const terms=validateProposal(locked.terms,common);
      const available=await Question.count({where:{federationId:{[Op.in]:[challenger.id,challenged.id]},category:terms.category,
        reviewStatus:'published',active:true},transaction});
      if(!available)throw new Error('Ambas Federaciones necesitan al menos una pregunta aprobada de la temática antes de disputar el desafío.');
      tournament=await Tournament.create({organizerId:challenger.presidentId,name:`${challenger.name} vs ${challenged.name} · ${terms.name}`.slice(0,100),
        format:terms.format,boardSize:terms.boardSize,settings:{...terms.settings,maxPlayersPerBoard:terms.maxPlayers,opponentFederationId:challenged.id},
        federationId:challenger.id,federationCategory:terms.category,federationScope:locked.kind==='classic'?'classic':'interfederative',status:'open',accessCode:roomCode()}, {transaction});
      await TournamentParticipant.findOrCreate({where:{tournamentId:tournament.id,userId:challenger.presidentId},defaults:{seed:1},transaction});
    }
    await locked.update({status:accept?'accepted':'rejected',tournamentId:tournament?.id||null},{transaction});
    return locked;
  });
  for(const id of [challenge.challengerId,challenge.challengedId])await recordFederationEvent(id,'challenge_result',
    accept?'Se aceptó un desafío interfederativo.':'Se rechazó un desafío interfederativo.',req.user.id,{challengeId:challenge.id,tournamentId:updated.tournamentId});
  res.json(updated);
}catch(e){next(e)}});

router.post('/challenges/:challengeId/settle',async(req,res,next)=>{try{
  const challenge=await FederationChallenge.findByPk(integer(req.params.challengeId));
  if(!challenge||challenge.status!=='accepted'||!challenge.tournamentId)throw new Error('Desafío no disponible para liquidación.');
  await requireFederation(challenge.challengerId,req.user.id,{president:true});
  const tournament=await Tournament.findByPk(challenge.tournamentId);
  if(tournament?.status!=='finished')throw new Error('El torneo todavía no terminó.');
  const winner=await TournamentParticipant.findOne({where:{tournamentId:tournament.id,finalPosition:1}});
  if(!winner)throw new Error('Falta registrar el campeón.');
  const winningMemberships=await FederationMember.findAll({where:{userId:winner.userId,
    federationId:{[Op.in]:[challenge.challengerId,challenge.challengedId]},status:'active'}});
  if(winningMemberships.length!==1)throw new Error('La pertenencia del campeón es ambigua; se requiere resolverla antes de puntuar.');
  const participants=await TournamentParticipant.count({where:{tournamentId:tournament.id}});
  const result={winnerFederationId:winningMemberships[0].federationId,winnerUserId:winner.userId,
    participants,category:tournament.federationCategory,settledAt:stamp()};
  const [changed]=await FederationChallenge.update({status:'finished',result},{where:{id:challenge.id,status:'accepted'}});
  if(!changed)throw new Error('Desafío liquidado simultáneamente.');
  for(const id of [challenge.challengerId,challenge.challengedId])await recordFederationEvent(id,'interfederative_result','Finalizó una competencia interfederativa.',req.user.id,{challengeId:challenge.id,...result});
  res.json(result);
}catch(e){next(e)}});

router.get('/rankings/federations',async(req,res,next)=>{try{
  const category=req.query.category?String(req.query.category).slice(0,80):null;
  const federations=await Federation.findAll({where:{isPublic:true},attributes:['id','name','slug','crestUrl','categories']});
  const scores=new Map(federations.map(f=>[f.id,{federation:f,points:0,wins:0,finals:0}]));
  const challenges=await FederationChallenge.findAll({where:{status:'finished'}});
  for(const challenge of challenges){
    if(category&&challenge.result?.category!==category)continue;
    for(const id of [challenge.challengerId,challenge.challengedId]){
      const row=scores.get(id);if(!row)continue;
      const champion=Number(challenge.result?.winnerFederationId)===Number(id);
      row.points+=rankingPoints({interfederative:true,champion,runnerUp:!champion,participants:challenge.result?.participants||0});
      row.finals++;if(champion)row.wins++;
    }
  }
  res.json([...scores.values()].filter(row=>!category||row.federation.categories.includes(category)).sort((a,b)=>b.points-a.points||b.wins-a.wins||a.federation.name.localeCompare(b.federation.name)).slice(0,100));
}catch(e){next(e)}});

router.get('/:id/history',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id,{publicRead:true});
  const tournaments=await Tournament.findAll({where:{federationId:fed.id},order:[['createdAt','DESC']],limit:50,
    include:[{model:Match,attributes:['id','roundNo','stage','status','participants','result']} ]});
  const participantIds=[...new Set(tournaments.flatMap(t=>(t.Matches||[]).flatMap(m=>(m.participants||[]).map(Number))))];
  const users=participantIds.length?await User.findAll({where:{id:{[Op.in]:participantIds}},attributes:['id','username'],include:[Team]}):[];
  const byId=new Map(users.map(u=>[Number(u.id),u.Team?.name||u.username]));
  res.json(tournaments.map(t=>({...t.toJSON(),Matches:(t.Matches||[]).map(m=>({...m.toJSON(),participantNames:(m.participants||[]).map(id=>byId.get(Number(id))||`Jugador ${id}`)}))})));
}catch(e){next(e)}});

router.get('/:id/standings',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id,{publicRead:true});
  const tournaments=await Tournament.findAll({where:{federationId:fed.id},attributes:['id']});
  const ids=tournaments.map(t=>t.id);
  if(!ids.length)return res.json([]);
  const members=await FederationMember.findAll({where:{federationId:fed.id,status:'active'},include:[{model:User,attributes:['id','username']} ]});
  const rows=await TournamentParticipant.findAll({where:{tournamentId:{[Op.in]:ids}},attributes:['userId','points','wins','played','correctAnswers','finalPosition']});
  const trophies=await UserTrophy.findAll({where:{tournamentId:{[Op.in]:ids}},attributes:['userId','tournamentId']});
  const byUser=new Map(members.map(m=>[Number(m.userId),{userId:m.userId,username:m.User?.username,
    points:0,wins:0,played:0,correctAnswers:0,titles:0,finals:0}]));
  for(const r of rows){const line=byUser.get(Number(r.userId));if(!line)continue;
    line.points+=Number(r.points||0);line.wins+=Number(r.wins||0);line.played+=Number(r.played||0);
    line.correctAnswers+=Number(r.correctAnswers||0);if(Number(r.finalPosition)<=2&&r.finalPosition!=null)line.finals++;}
  for(const trophy of trophies){const line=byUser.get(Number(trophy.userId));if(line)line.titles++;}
  res.json([...byUser.values()].sort((a,b)=>b.points-a.points||b.titles-a.titles||b.wins-a.wins).map((row,i)=>({...row,rank:i+1})));
}catch(e){next(e)}});

router.get('/:id/palmares',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id,{publicRead:true});
  const tournaments=await Tournament.findAll({where:{federationId:fed.id},attributes:['id']});
  const ids=tournaments.map(t=>t.id);
  const trophies=ids.length?await UserTrophy.findAll({where:{tournamentId:{[Op.in]:ids}},
    include:[{model:User,attributes:['id','username']},{model:Tournament,attributes:['id','name','format']}],order:[['awardedAt','DESC']],limit:200}):[];
  res.json(trophies);
}catch(e){next(e)}});

router.get('/:id/achievements/mine',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id);
  res.json(await FederationAchievement.findAll({where:{federationId:fed.id,userId:req.user.id},
    order:[['awardedAt','DESC']],limit:200}));
}catch(e){next(e)}});

router.get('/:id/achievements',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id,{publicRead:true});
  const where={federationId:fed.id};if(req.query.userId)where.userId=integer(req.query.userId);
  res.json(await FederationAchievement.findAll({where,include:[{model:User,attributes:['id','username']}],order:[['awardedAt','DESC']],limit:200}));
}catch(e){next(e)}});

router.get('/:id/statistics',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id,{publicRead:true});
  const tournaments=await Tournament.findAll({where:{federationId:fed.id},attributes:['id','status','federationCategory','createdAt']});
  const ids=tournaments.map(t=>t.id);
  const games=ids.length?await Game.findAll({where:{tournamentId:{[Op.in]:ids}},attributes:['id','status','createdAt']}):[];
  const gameIds=games.map(g=>g.id);
  const stats=gameIds.length?await PlayerGameStat.findAll({where:{gameId:{[Op.in]:gameIds}},attributes:['correctAnswers','totalAnswers','finishPosition']}):[];
  const correct=stats.reduce((n,s)=>n+Number(s.correctAnswers||0),0),answers=stats.reduce((n,s)=>n+Number(s.totalAnswers||0),0);
  const members=await FederationMember.count({where:{federationId:fed.id,status:'active'}});
  const trophies=ids.length?await UserTrophy.count({where:{tournamentId:{[Op.in]:ids}}}):0;
  const categories={};for(const t of tournaments)if(t.federationCategory)categories[t.federationCategory]=(categories[t.federationCategory]||0)+1;
  const monthly={};for(const g of games){const key=new Date(g.createdAt).toISOString().slice(0,7);monthly[key]=(monthly[key]||0)+1;}
  res.json({members,tournaments:tournaments.length,games:games.length,questionsAnswered:answers,correctAnswers:correct,
    accuracy:answers?Math.round(correct*10000/answers)/100:0,champions:trophies,monthlyActivity:monthly,mostPlayedCategories:categories});
}catch(e){next(e)}});

router.get('/:id/records',async(req,res,next)=>{try{
  const {fed}=await requireFederation(req.params.id,req.user.id,{publicRead:true});
  const tournaments=await Tournament.findAll({where:{federationId:fed.id},attributes:['id']});
  const ids=tournaments.map(t=>t.id);
  if(!ids.length)return res.json({records:[],topLaureates:[]});
  const games=await Game.findAll({where:{tournamentId:{[Op.in]:ids},status:'finished'},attributes:['id','createdAt']});
  const gameIds=games.map(g=>g.id);
  const rows=gameIds.length?await PlayerGameStat.findAll({where:{gameId:{[Op.in]:gameIds}},order:[['createdAt','ASC']]}):[];
  const answered=gameIds.length?await GameQuestion.findAll({where:{gameId:{[Op.in]:gameIds},answeredByUserId:{[Op.ne]:null}},
    attributes:['answeredByUserId','answeredCorrectly','answeredAt'],order:[['answeredAt','ASC']]}):[];
  const finalists=await TournamentParticipant.findAll({where:{tournamentId:{[Op.in]:ids},finalPosition:2},attributes:['userId']});
  const trophies=await UserTrophy.findAll({where:{tournamentId:{[Op.in]:ids}}});
  const members=await FederationMember.findAll({where:{federationId:fed.id,status:'active'},include:[{model:User,attributes:['username']} ]});
  const byUser=new Map(members.map(m=>[Number(m.userId),{userId:m.userId,name:m.User?.username,titles:0,victories:0,winStreak:0,bestWinStreak:0,correctStreak:0,bestCorrectStreak:0,finals:0}]));
  for(const row of rows){const s=byUser.get(Number(row.userId));if(!s)continue;
    const won=Number(row.finishPosition)===1;s.victories+=Number(won);s.winStreak=won?s.winStreak+1:0;s.bestWinStreak=Math.max(s.bestWinStreak,s.winStreak);
    // Racha de respuestas por partida: se usa el contador que ya persiste el motor.
  }
  for(const trophy of trophies){const s=byUser.get(Number(trophy.userId));if(s)s.titles++;}
  for(const finalist of finalists){const s=byUser.get(Number(finalist.userId));if(s)s.finals++;}
  for(const answer of answered){const s=byUser.get(Number(answer.answeredByUserId));if(!s)continue;
    s.correctStreak=answer.answeredCorrectly?s.correctStreak+1:0;
    s.bestCorrectStreak=Math.max(s.bestCorrectStreak,s.correctStreak);
  }
  const all=[...byUser.values()];
  const records=[['Mayor racha de victorias','bestWinStreak'],['Mayor racha de respuestas correctas','bestCorrectStreak'],
    ['Mayor cantidad de títulos','titles'],['Mayor cantidad de victorias','victories']].map(([name,key])=>({name,value:Math.max(0,...all.map(r=>r[key])),holders:all.filter(r=>r[key]>0&&r[key]===Math.max(0,...all.map(r=>r[key]))).map(r=>r.name)}));
  res.json({records,topLaureates:rankLaureates(all).slice(0,10)});
}catch(e){next(e)}});

module.exports=router;
