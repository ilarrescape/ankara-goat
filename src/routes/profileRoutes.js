const express = require('express');
const { User, Team, UserKnowledgeStat, PlayerGameStat, Game, TournamentParticipant, Tournament, UserTrophy } = require('../models');
const auth = require('../middleware/auth');
const { STATUS_LABELS, trophyAsset } = require('../services/tournamentRules');

const router = express.Router();
router.use(auth);

function trophyMeta(row) {
  const [kind, es] = String(row.trophyType || '').split('_');
  const tier = { bronce:'bronze', plata:'silver', oro:'gold' }[es] || null;
  const format = kind === 'liga' ? 'league_1v1' : 'cup';
  return { ...row.toJSON(), asset: trophyAsset(format, tier) };
}

async function profile(userId) {
  const user = await User.findByPk(userId, { attributes: ['id','username','eloRating','xp','level'], include: [Team] });
  if (!user) return null;
  const [knowledge, statRows, allStats, trophies, tournamentRows] = await Promise.all([
    UserKnowledgeStat.findAll({ where: { userId }, order: [['answered','DESC'],['accuracy','DESC']], limit: 40 }),
    PlayerGameStat.findAll({ where: { userId }, include: [{ model: Game, attributes: ['id','name','roomCode','createdAt','tournamentId','state'] }], order: [['createdAt','DESC']], limit: 30 }),
    PlayerGameStat.findAll({ where: { userId }, attributes: ['finishPosition','correctAnswers','totalAnswers'], raw: true }),
    UserTrophy.findAll({ where:{ userId }, order:[['awardedAt','DESC']] }),
    TournamentParticipant.findAll({
      where:{ userId },
      include:[{ model:Tournament, attributes:['id','name','format','status','settings','createdAt','updatedAt'] }],
      order:[[Tournament,'createdAt','DESC']], limit:100
    })
  ]);

  const history = statRows.map(row => {
    const plain = row.toJSON();
    const gameState = plain.Game?.state || {};
    const correctAnswers = Number(plain.correctAnswers || 0);
    const totalAnswers = Number(plain.totalAnswers || 0);
    const incorrectAnswers = Math.max(0, totalAnswers - correctAnswers);
    const won = Number(plain.finishPosition) === 1;
    const forfeited = (gameState.forfeitedUserIds || []).map(Number).includes(Number(userId));
    const game = plain.Game ? { id:plain.Game.id,name:plain.Game.name,roomCode:plain.Game.roomCode,createdAt:plain.Game.createdAt,tournamentId:plain.Game.tournamentId } : null;
    return { ...plain, Game:game, correctAnswers, incorrectAnswers, totalAnswers, accuracy:totalAnswers?Math.round((correctAnswers/totalAnswers)*100):0, result:won?'win':'loss', won, lost:!won, resultReason:gameState.finishReason||'completed', forfeited };
  });

  const summary = allStats.reduce((acc,row)=>{
    if(Number(row.finishPosition)===1)acc.wins+=1;else acc.losses+=1;
    const correct=Number(row.correctAnswers||0),total=Number(row.totalAnswers||0);
    acc.correctAnswers+=correct;acc.incorrectAnswers+=Math.max(0,total-correct);return acc;
  },{wins:0,losses:0,correctAnswers:0,incorrectAnswers:0});

  const trophyByTournament=new Map(trophies.map(t=>[Number(t.tournamentId),trophyMeta(t)]));
  const tournamentHistory=tournamentRows.map(row=>{
    const t=row.Tournament;
    return {
      tournamentId:Number(row.tournamentId),
      name:t?.name||'Torneo',
      format:t?.format||null,
      participants:Number(t?.settings?.maxParticipants||0)||null,
      position:t?.status==='finished'?Number(row.finalPosition||0)||null:null,
      trophy:trophyByTournament.get(Number(row.tournamentId))||null,
      date:t?.updatedAt||t?.createdAt||row.updatedAt,
      status:t?.status||'open',
      statusLabel:STATUS_LABELS[t?.status]||t?.status||'Abierto',
      detailUrl:`/api/tournaments/${row.tournamentId}`
    };
  });

  return { user, knowledge, history, summary, trophies:trophies.map(trophyMeta), tournamentHistory };
}

router.get('/me', async (req,res,next)=>{try{res.json(await profile(req.user.id));}catch(e){next(e);}});
router.get('/:userId', async (req,res,next)=>{try{const data=await profile(Number(req.params.userId));if(!data)return res.status(404).json({error:'Usuario inexistente.'});res.json(data);}catch(e){next(e);}});
router.get('/', (req,res)=>res.redirect('/api/profile/me'));
module.exports=router;
