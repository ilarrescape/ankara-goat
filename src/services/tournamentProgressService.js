const { Op } = require('sequelize');
const { sequelize, Game, Tournament, TournamentParticipant, Match, PlayerGameStat, StandingsTiebreak, User, UserTrophy } = require('../models');
const { rankingOrder } = require('./rankingService');
const { sharedBoardPoints } = require('./tournamentService');
const { coreKey, sortStandings } = require('./standingsService');
const { planTiebreak } = require('./tiebreakService');
const { trophyTier } = require('./tournamentRules');

function matchRef(match) { return match.source?.ref || null; }

async function resolvedOrderMap(tournamentId, groupCode, transaction) {
  const where = { tournamentId, status: 'resolved' };
  if (groupCode !== undefined) where.groupCode = groupCode;
  const rows = await StandingsTiebreak.findAll({ where, transaction });
  const result = new Map();
  for (const r of rows) {
    if (!String(r.signature).includes('::plan:') && !String(r.signature).includes('::final:')) result.set(r.signature, (r.resolvedOrder || []).map(Number));
  }
  return result;
}

function coreCompare(a,b){
  const ad=Number(a.correctAnswers||0)-Number(a.incorrectAnswers||0);
  const bd=Number(b.correctAnswers||0)-Number(b.incorrectAnswers||0);
  return Number(b.points||0)-Number(a.points||0)||Number(b.wins||0)-Number(a.wins||0)||bd-ad||Number(a.seed||0)-Number(b.seed||0);
}

function relevantTie(rows, cutoff) {
  const sorted=[...rows].sort(coreCompare);
  let start=0;
  while(start<sorted.length){
    let end=start+1; const key=coreKey(sorted[start]);
    while(end<sorted.length&&coreKey(sorted[end])===key)end++;
    const oneBasedStart=start+1, oneBasedEnd=end;
    if(oneBasedStart<=cutoff&&oneBasedEnd>cutoff){
      return { key, rows:sorted.slice(start,end), slotsAvailable:cutoff-start };
    }
    start=end;
  }
  return null;
}

async function createTiebreakPlan({ tournament, rows, scope, groupCode, cutoff, transaction }) {
  const tie=relevantTie(rows,cutoff); if(!tie||tie.rows.length<2)return [];
  const existing=await StandingsTiebreak.count({where:{tournamentId:tournament.id,scope,groupCode,planKey:tie.key},transaction});
  const directExisting=await StandingsTiebreak.count({where:{tournamentId:tournament.id,scope,groupCode,signature:tie.key},transaction});
  if(existing||directExisting)return [];
  const userIds=tie.rows.map(r=>Number(r.userId));
  const users=await User.findAll({where:{id:userIds},attributes:['id','eloRating'],transaction,raw:true});
  const elo=new Map(users.map(u=>[Number(u.id),Number(u.eloRating)]));
  const enriched=tie.rows.map(r=>({userId:Number(r.userId),eloRating:elo.get(Number(r.userId))||0}));
  const plan=planTiebreak(enriched,tie.slotsAvailable,8);
  const created=[];
  if(plan.mode==='single'||plan.mode==='elo_cut'||plan.mode==='elo_boundary_excluded'){
    const board=plan.boards[0];
    if(board.userIds.length===1){
      const [row]=await StandingsTiebreak.findOrCreate({where:{tournamentId:tournament.id,scope,groupCode,signature:tie.key},defaults:{tournamentId:tournament.id,scope,groupCode,signature:tie.key,userIds:board.userIds,resolvedOrder:[...board.userIds,...(plan.excludedUserIds||[])],status:'resolved',advanceCount:board.advanceCount,slotsAvailable:tie.slotsAvailable,planMode:plan.mode,excludedUserIds:plan.excludedUserIds||[]},transaction}); created.push(row);
    }else{
      const [row]=await StandingsTiebreak.findOrCreate({where:{tournamentId:tournament.id,scope,groupCode,signature:tie.key},defaults:{tournamentId:tournament.id,scope,groupCode,signature:tie.key,userIds:board.userIds,status:'pending',advanceCount:board.advanceCount,slotsAvailable:tie.slotsAvailable,planMode:plan.mode,excludedUserIds:plan.excludedUserIds||[]},transaction}); created.push(row);
    }
    return created;
  }
  for(let i=0;i<plan.boards.length;i++){
    const board=plan.boards[i];
    const [row]=await StandingsTiebreak.findOrCreate({where:{tournamentId:tournament.id,scope,groupCode,signature:`${tie.key}::plan:${i+1}`},defaults:{tournamentId:tournament.id,scope,groupCode,signature:`${tie.key}::plan:${i+1}`,planKey:tie.key,userIds:board.userIds,status:'pending',advanceCount:board.advanceCount,slotsAvailable:tie.slotsAvailable,fixedUserIds:plan.fixedUserIds||[],excludedUserIds:plan.excludedUserIds||[],planMode:plan.mode},transaction}); created.push(row);
  }
  return created;
}

async function ensureTieRows({ tournament, participants, matches, transaction }) {
  const created=[];
  if(tournament.format==='group_knockout'){
    const qualifiers=Number(tournament.settings?.qualifiersPerGroup||1);
    const codes=[...new Set(participants.map(p=>p.groupCode).filter(Boolean))];
    for(const code of codes){
      const groupMatches=matches.filter(m=>m.stage==='group'&&m.groupCode===code);
      if(groupMatches.length&&groupMatches.every(m=>['finished','bye'].includes(m.status))) created.push(...await createTiebreakPlan({tournament,rows:participants.filter(p=>p.groupCode===code),scope:'group',groupCode:code,cutoff:qualifiers,transaction}));
    }
  }
  if(['league_1v1','shared_board_league'].includes(tournament.format)){
    const relevant=matches.filter(m=>['league','shared_league'].includes(m.stage));
    if(relevant.length&&relevant.every(m=>['finished','bye'].includes(m.status))) created.push(...await createTiebreakPlan({tournament,rows:participants,scope:'final',groupCode:null,cutoff:1,transaction}));
  }
  return created;
}

async function resolveFutureMatches({ tournament, participants, matches, transaction }) {
  const byRef=new Map(matches.filter(m=>matchRef(m)).map(m=>[matchRef(m),m]));
  const groupReady=code=>matches.filter(m=>m.stage==='group'&&m.groupCode===code).every(m=>['finished','bye'].includes(m.status));
  const resolveSource=async source=>{
    if(!source)return null;
    if(source.type==='player')return source.id;
    if(source.type==='winner')return byRef.get(source.ref)?.result?.winnerUserId||null;
    if(source.type==='group_position'){
      if(!groupReady(source.groupCode))return null;
      const unresolved=await StandingsTiebreak.count({where:{tournamentId:tournament.id,scope:'group',groupCode:source.groupCode,status:{[Op.in]:['pending','running']}},transaction});
      if(unresolved)return null;
      const orders=await resolvedOrderMap(tournament.id,source.groupCode,transaction);
      return sortStandings(participants.filter(p=>p.groupCode===source.groupCode),orders)[source.position-1]?.userId||null;
    }
    return null;
  };
  for(const future of matches){
    if(future.status==='finished'||!future.source?.entrants?.length)continue;
    const resolved=[]; for(const source of future.source.entrants)resolved.push(await resolveSource(source));
    if(resolved.every(Boolean)){future.participants=resolved;if(future.status==='scheduled')future.status='ready';await future.save({transaction});}
  }
}


async function persistFinalPositions(tournament,matches,participants,transaction){
  let order=[];
  if(['league_1v1','shared_board_league'].includes(tournament.format)){
    const orders=await resolvedOrderMap(tournament.id,null,transaction); order=sortStandings(participants,orders);
  }else{
    const stageWeight=stage=>stage==='final'?100:stage==='semifinal'?80:stage==='quarterfinal'?60:String(stage||'').startsWith('round_of_')?40:20;
    const score=new Map(participants.map(p=>[Number(p.userId),{row:p,weight:0,position:999}]));
    for(const m of matches.filter(m=>m.status==='finished')){
      for(const r of m.result?.finishOrder||[]){
        const e=score.get(Number(r.userId)); if(!e)continue; const w=stageWeight(m.stage); if(w>e.weight){e.weight=w;e.position=Number(r.position||999);}
      }
    }
    order=[...score.values()].sort((a,b)=>b.weight-a.weight||a.position-b.position||coreCompare(a.row,b.row)).map(x=>x.row);
  }
  for(let i=0;i<order.length;i++){order[i].finalPosition=i+1;await order[i].save({transaction});}
  return order;
}
async function awardChampionTrophy(tournament, matches, participants, transaction){
  if(await UserTrophy.count({where:{tournamentId:tournament.id},transaction}))return;
  let championId=null;
  if(['league_1v1','shared_board_league'].includes(tournament.format)){
    const orders=await resolvedOrderMap(tournament.id,null,transaction); championId=sortStandings(participants,orders)[0]?.userId||null;
  }else championId=matches.find(m=>m.stage==='final'&&m.status==='finished')?.result?.winnerUserId||null;
  if(!championId)return;
  const tier=trophyTier(tournament.format,Number(tournament.settings?.maxParticipants||participants.length));
  const prefix=['league_1v1','shared_board_league'].includes(tournament.format)?'liga':'copa';
  const es={bronze:'bronce',silver:'plata',gold:'oro'}[tier]; if(!es)return;
  await UserTrophy.create({userId:championId,tournamentId:tournament.id,trophyType:`${prefix}_${es}`,tournamentName:tournament.name,awardedAt:new Date()},{transaction});
}

async function maybeFinishTournament({ tournament, participants, matches, transaction }) {
  let finished=false;
  if(['league_1v1','shared_board_league'].includes(tournament.format)){
    const relevant=matches.filter(m=>['league','shared_league'].includes(m.stage));
    const gamesDone=relevant.length&&relevant.every(m=>['finished','bye'].includes(m.status));
    const pending=await StandingsTiebreak.count({where:{tournamentId:tournament.id,scope:'final',status:{[Op.in]:['pending','running']}},transaction});
    finished=gamesDone&&!pending;
  }else finished=matches.find(m=>m.stage==='final')?.status==='finished';
  if(finished){tournament.status='finished';await tournament.save({transaction});await persistFinalPositions(tournament,matches,participants,transaction);await awardChampionTrophy(tournament,matches,participants,transaction);}
}

async function finalizeTiebreakPlan(tie, transaction){
  if(!tie.planKey)return;
  const siblings=await StandingsTiebreak.findAll({where:{tournamentId:tie.tournamentId,scope:tie.scope,groupCode:tie.groupCode,planKey:tie.planKey},transaction});
  if(siblings.some(r=>r.status!=='resolved'))return;
  const fixed=[...new Set((siblings[0]?.fixedUserIds||[]).map(Number))];
  const candidates=[];
  for(const row of siblings)candidates.push(...(row.resolvedOrder||[]).slice(0,Number(row.advanceCount||1)).map(Number));
  const finalists=[...new Set([...fixed,...candidates])];
  const slots=Number(siblings[0]?.slotsAvailable||1);
  if(finalists.length<=slots){
    await StandingsTiebreak.create({tournamentId:tie.tournamentId,scope:tie.scope,groupCode:tie.groupCode,signature:tie.planKey,userIds:finalists,resolvedOrder:finalists,status:'resolved',advanceCount:slots,slotsAvailable:slots,planMode:'contingency_resolved'} ,{transaction});
    return;
  }
  if(finalists.length<=8){
    await StandingsTiebreak.findOrCreate({where:{tournamentId:tie.tournamentId,scope:tie.scope,groupCode:tie.groupCode,signature:tie.planKey},defaults:{tournamentId:tie.tournamentId,scope:tie.scope,groupCode:tie.groupCode,signature:tie.planKey,userIds:finalists,status:'pending',advanceCount:slots,slotsAvailable:slots,planMode:'contingency_final'},transaction});
  }
}

async function resolveTiebreakGame(game, transaction) {
  const id=Number(game.state?.settings?.standingsTiebreakId||0); if(!id)return null;
  const tie=await StandingsTiebreak.findByPk(id,{transaction,lock:transaction.LOCK.UPDATE}); if(!tie||tie.status==='resolved')return null;
  tie.resolvedOrder=rankingOrder(game.state?.players||[]).map(p=>Number(p.userId)); tie.status='resolved'; tie.gameId=game.id; await tie.save({transaction});
  await finalizeTiebreakPlan(tie,transaction); return tie;
}

async function recordTournamentGame(gameId) {
  return sequelize.transaction(async transaction=>{
    const game=await Game.findByPk(gameId,{transaction}); if(!game?.tournamentId||game.status!=='finished')return null;
    const tournament=await Tournament.findByPk(game.tournamentId,{transaction,lock:transaction.LOCK.UPDATE}); if(!tournament)return null;
    const resolvedTie=await resolveTiebreakGame(game,transaction);
    if(resolvedTie){const matches=await Match.findAll({where:{tournamentId:tournament.id},transaction,order:[['roundNo','ASC'],['slot','ASC']]});const participants=await TournamentParticipant.findAll({where:{tournamentId:tournament.id},transaction});await resolveFutureMatches({tournament,participants,matches,transaction});await maybeFinishTournament({tournament,participants,matches,transaction});return {tournamentId:tournament.id,tiebreakId:resolvedTie.id,resolvedOrder:resolvedTie.resolvedOrder};}
    if(!game.matchId)return null;
    const match=await Match.findByPk(game.matchId,{transaction,lock:transaction.LOCK.UPDATE}); if(!match||match.status==='finished')return null;
    const ordered=rankingOrder(game.state?.players||[]); match.result={finishOrder:ordered.map(p=>({userId:p.userId,position:p.resolvedPosition})),winnerUserId:ordered[0]?.userId||null}; match.status='finished'; await match.save({transaction});
    const stats=await PlayerGameStat.findAll({where:{gameId},transaction,raw:true}); const statsByUser=new Map(stats.map(s=>[Number(s.userId),s]));
    const updateAnswers=(tp,userId)=>{const st=statsByUser.get(Number(userId));if(!st)return;tp.correctAnswers+=Number(st.correctAnswers||0);tp.incorrectAnswers+=Math.max(0,Number(st.totalAnswers||0)-Number(st.correctAnswers||0));};
    const isShared=ordered.length>2&&['shared_league','group'].includes(match.stage);
    if((tournament.format==='shared_board_league'||tournament.format==='group_knockout')&&isShared){
      for(const p of ordered){const tp=await TournamentParticipant.findOne({where:{tournamentId:tournament.id,userId:p.userId},transaction,lock:transaction.LOCK.UPDATE});if(!tp)continue;const pts=sharedBoardPoints(ordered.length,p.resolvedPosition);tp.played+=1;tp.points+=pts;tp.positionPoints+=pts;if(p.resolvedPosition===1)tp.wins+=1;else tp.losses+=1;updateAnswers(tp,p.userId);await tp.save({transaction});}
    }else if(['league_1v1','group_knockout'].includes(tournament.format)&&['league','group'].includes(match.stage)){
      for(const p of ordered.slice(0,2)){const tp=await TournamentParticipant.findOne({where:{tournamentId:tournament.id,userId:p.userId},transaction,lock:transaction.LOCK.UPDATE});if(!tp)continue;tp.played+=1;if(p.resolvedPosition===1){tp.wins+=1;tp.points+=2;}else tp.losses+=1;updateAnswers(tp,p.userId);await tp.save({transaction});}
    }else{
      for(const p of ordered.slice(1)){const tp=await TournamentParticipant.findOne({where:{tournamentId:tournament.id,userId:p.userId},transaction,lock:transaction.LOCK.UPDATE});if(tp){tp.eliminated=true;tp.eliminationReason='knockout_loss';await tp.save({transaction});}}
    }
    const matches=await Match.findAll({where:{tournamentId:tournament.id},transaction,order:[['roundNo','ASC'],['slot','ASC']]});const participants=await TournamentParticipant.findAll({where:{tournamentId:tournament.id},transaction});await ensureTieRows({tournament,participants,matches,transaction});await resolveFutureMatches({tournament,participants,matches,transaction});await maybeFinishTournament({tournament,participants,matches,transaction});return {tournamentId:tournament.id,matchId:match.id,winnerUserId:match.result.winnerUserId};
  });
}

module.exports={recordTournamentGame,ensureTieRows,resolvedOrderMap,relevantTie};
