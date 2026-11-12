const app = document.getElementById('shareApp');
const toastEl = document.getElementById('toast');
const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

function toast(message){
  if(!toastEl)return;
  toastEl.textContent=message;toastEl.classList.add('show');
  setTimeout(()=>toastEl.classList.remove('show'),2200);
}

function crest(team){
  if(team?.crestUrl)return `<img src="${esc(team.crestUrl)}" alt="" loading="lazy">`;
  return `<span>${esc(team?.crestEmoji||'⚽')}</span>`;
}

function brandLogo(slug,color){
  return `<img class="social-brand-icon" src="https://cdn.simpleicons.org/${slug}/${color}" width="20" height="20" alt="" loading="lazy" decoding="async">`;
}

function shareButtons(title){
  const url=location.href;
  const u=encodeURIComponent(url),t=encodeURIComponent(title);
  return `<div class="public-share-actions">
    <button class="share-social-btn" data-native-share title="Compartir"><i class="fi fi-rr-share"></i><span>Compartir</span></button>
    <a class="share-social-btn" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${u}">${brandLogo('facebook','1877F2')}<span>Facebook</span></a>
    <a class="share-social-btn" target="_blank" rel="noopener" href="https://www.reddit.com/submit?url=${u}&title=${t}">${brandLogo('reddit','FF4500')}<span>Reddit</span></a>
    <a class="share-social-btn" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?url=${u}&text=${t}">${brandLogo('x','FFFFFF')}<span>X</span></a>
    <a class="share-social-btn" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}">${brandLogo('whatsapp','25D366')}<span>WhatsApp</span></a>
    <button class="share-social-btn" data-copy-link><i class="fi fi-rr-copy-alt"></i><span>Copiar link</span></button>
  </div>`;
}

function bindSharing(title){
  document.querySelector('[data-copy-link]')?.addEventListener('click',async()=>{
    await navigator.clipboard?.writeText(location.href).catch(()=>{});toast('Enlace copiado.');
  });
  document.querySelector('[data-native-share]')?.addEventListener('click',async()=>{
    if(navigator.share){
      try{await navigator.share({title,text:'Mirá este resultado de AnkaraGOAT',url:location.href});return}catch(e){if(e?.name==='AbortError')return}
    }
    await navigator.clipboard?.writeText(location.href).catch(()=>{});toast('Enlace copiado. Podés pegarlo en Instagram u otra app.');
  });
}

function renderMatch(data){
  const winner=data.players?.[0];
  const title=`${winner?.team?.name||'Un equipo'} ganó en AnkaraGOAT`;
  app.innerHTML=`<section class="public-result-hero card">
    <div class="kicker">PARTIDO FINALIZADO</div><h1>${esc(data.name||'Partida AnkaraGOAT')}</h1>
    <p class="muted">Resultado público · ${new Date(data.finishedAt).toLocaleString()}</p>
    <div class="public-podium">${(data.players||[]).slice(0,3).map(p=>`<article class="public-podium-card rank-${p.position}"><div class="public-place">${p.position}°</div><div class="public-crest" style="--team:${esc(p.team.primaryColor)}">${crest(p.team)}</div><h3>${esc(p.team.name)}</h3><div class="public-stat-line"><span>${p.correctAnswers}/${p.totalAnswers} correctas</span><span>${p.accuracy}% precisión</span></div>${p.eloDelta==null?'':`<div class="elo-delta ${p.eloDelta>=0?'positive':'negative'}">ELO ${p.eloDelta>=0?'+':''}${p.eloDelta}</div>`}</article>`).join('')}</div>
    ${shareButtons(title)}
  </section>
  <section class="card share-cta"><img src="/assets/images/logo-ankara-goat.png" alt="Ankara GOAT"><div><div class="kicker">¿CUÁNTO SABÉS DE FÚTBOL?</div><h2>Jugá gratis contra tus amigos</h2><p class="muted">Creá tu equipo, disputá partidas y competí en Copas y Ligas.</p></div><a class="btn primary large" href="/">Crear mi equipo</a></section>`;
  bindSharing(title);
}

function shareStageClass(stage){const s=String(stage||'').toLowerCase();return ['group','league','shared_league'].includes(s)?'stage-group':s.includes('16')||s.includes('eighth')?'stage-round16':s.includes('quarter')?'stage-quarter':s.includes('semi')?'stage-semi':s==='final'?'stage-final':'stage-other';}
function shareStageLabel(stage){return ({group:'Liguilla',league:'Liga',shared_league:'Liga compartida',round_of_16:'Octavos',quarterfinal:'Cuartos',semifinal:'Semifinal',final:'Final'})[stage]||stage;}
function matchLabel(match){
  return (match.participants||[]).map(x=>`${esc(x.team?.name||'Equipo')}${x.finishPosition!=null?` <b class="share-placement">${Number(x.finishPosition)}º</b>`:''}`).join(' <span class="share-versus">vs</span> ');
}

function renderTournament(data){
  const champion=data.podium?.[0]?.team?.name;
  const title=champion?`${champion} campeón de ${data.name}`:`Estadísticas de ${data.name}`;
  const groupHtml=Object.entries(data.groups||{}).map(([code,rows])=>`<section class="share-standings"><h3>${code==='general'?'Tabla general':`Grupo ${esc(code)}`}</h3><div class="share-table"><div class="share-table-row header"><span>#</span><span>Equipo</span><span>PTS</span><span>G</span><span>DG</span></div>${rows.map(r=>`<div class="share-table-row"><b>${r.position}</b><span class="share-team-cell"><span class="share-mini-crest">${crest(r.team)}</span>${esc(r.team.name)}</span><b>${r.points}</b><span>${r.wins}</span><span>${r.questionDifference>=0?'+':''}${r.questionDifference}</span></div>`).join('')}</div></section>`).join('');
  const matches=(data.matches||[]).filter(m=>['finished','running','ready'].includes(m.status)).slice(-30);
  app.innerHTML=`<section class="public-result-hero card"><div class="kicker">CAMPEONATO · ${esc(data.statusLabel)}</div><h1>${esc(data.name)}</h1><p class="muted">${data.participantCount} participantes · Estadísticas públicas</p>${data.podium?.length?`<div class="public-podium tournament">${data.podium.map(p=>`<article class="public-podium-card rank-${p.position}"><div class="public-place">${p.position}°</div><div class="public-crest">${crest(p.team)}</div><h3>${esc(p.team.name)}</h3></article>`).join('')}</div>`:''}${data.trophyAsset?`<img class="public-trophy" src="${esc(data.trophyAsset)}" alt="Trofeo">`:''}${shareButtons(title)}</section>
  <div class="share-tournament-grid">${groupHtml}</div>
  <section class="card"><div class="kicker">ENFRENTAMIENTOS</div><h2>Partidos del torneo</h2><div class="share-match-list">${matches.map(m=>`<div class="share-match-row ${shareStageClass(m.stage)}"><span><b>${matchLabel(m)}</b><small>Fecha ${Number(m.roundNo)} · ${esc(shareStageLabel(m.stage))}${m.groupCode?` · Grupo ${esc(m.groupCode)}`:''}</small></span><span>${m.status==='finished'?'Finalizado':m.status==='running'?'En juego':'Listo'}</span></div>`).join('')||'<div class="empty">Todavía no hay resultados.</div>'}</div></section>
  <section class="card share-cta"><img src="/assets/images/logo-ankara-goat.png" alt="Ankara GOAT"><div><div class="kicker">SUMATE A LA COMPETENCIA</div><h2>¿Te animás a jugar?</h2><p class="muted">AnkaraGOAT es una trivia futbolera multijugador con Copas, Ligas y ranking ELO.</p></div><a class="btn primary large" href="/">Jugar ahora</a></section>`;
  bindSharing(title);
}

async function boot(){
  const parts=location.pathname.split('/').filter(Boolean);
  const kind=parts[1],code=parts[2];
  if(!['match','tournament'].includes(kind)||!code){app.innerHTML='<section class="card"><div class="empty">Enlace inválido.</div></section>';return}
  try{
    const res=await fetch(kind==='match'?`/api/public/matches/${encodeURIComponent(code)}`:`/api/public/tournaments/${encodeURIComponent(code)}`);
    const data=await res.json();
    if(!res.ok)throw new Error(data.error||'No se pudo abrir el resultado.');
    kind==='match'?renderMatch(data):renderTournament(data);
  }catch(error){app.innerHTML=`<section class="card"><div class="empty">${esc(error.message)}</div><div class="actions center"><a class="btn primary" href="/">Ir a AnkaraGOAT</a></div></section>`}
}
boot();
