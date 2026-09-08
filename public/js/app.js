const app = document.querySelector('#app');
const modalRoot = document.querySelector('#modalRoot');
const sessionActions = document.querySelector('#sessionActions');
const toastEl = document.querySelector('#toast');

let token = localStorage.getItem('ankara_token');
let me = null;
let currentGame = null;
let currentState = null;
let currentSpectator = false;
let socket = null;
let selectedTournamentUsers = [];
let questionTick = null;
let queuedGameState = null;
let animatingMovement = false;
let chatMessages = [];
let currentSpectatorCount = 0;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove('show'), 2800);
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error de servidor');
  return data;
}

async function apiForm(path, formData, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...options, method: options.method || 'POST', headers, body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error de servidor');
  return data;
}

function setSession(t, user = null) {
  token = t;
  if (t) localStorage.setItem('ankara_token', t); else localStorage.removeItem('ankara_token');
  me = user;
  renderSessionActions();
}

function renderSessionActions() {
  sessionActions.innerHTML = token
    ? `<span class="top-stat">${me?.eloRating ? `ELO ${me.eloRating}` : ''}</span><button class="btn ghost" id="logoutBtn">Salir</button>`
    : '';
  $('#logoutBtn')?.addEventListener('click', () => {
    socket?.disconnect(); socket = null;
    setSession(null, null);
    renderLanding();
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function landingForm(mode = 'login') {
  const isLogin = mode === 'login';
  return `<div class="tabs">
      <button class="btn ${isLogin ? 'primary' : ''} tab" data-auth-tab="login">Entrar</button>
      <button class="btn ${!isLogin ? 'primary' : ''} tab" data-auth-tab="register">Crear cuenta</button>
    </div>
    <form id="authForm">
      ${!isLogin ? `<div class="field"><label>Usuario</label><input name="username" maxlength="40" required></div>
      <div class="field"><label>Nombre de tu equipo</label><input name="teamName" maxlength="60" required></div>
      <div class="policy-box"><b>Convivencia Ankara GOAT</b><small>No se permiten odio/discriminación, amenazas, acoso persistente, contenido sexual explícito, doxxing, suplantación engañosa, spam ni evasión deliberada de los filtros. Las cargadas futboleras son válidas mientras respeten esos límites. Moderadores pueden ocultar mensajes, advertir, silenciar o suspender; admins pueden revisar decisiones.</small></div>
      <label class="check"><input type="checkbox" name="acceptModerationPolicy" required> Acepto la política de convivencia y moderación.</label><input type="hidden" name="policyVersion" value="2026-09-05">` : ''}
      <div class="field"><label>Email</label><input name="email" type="email" required></div>
      <div class="field"><label>Contraseña</label><input name="password" type="password" minlength="8" required></div>
      <button class="btn primary large" style="width:100%;margin-top:10px">${isLogin ? 'Entrar a la cancha' : 'Crear mi club'}</button>
    </form><button type="button" class="btn ghost" id="publicRankingBtn" style="width:100%;margin-top:8px">Ver ranking ELO público</button>`;
}

function renderLanding(mode = 'login') {
  currentGame = null; currentState = null; currentSpectator = false;
  app.innerHTML = `<section class="hero">
      <div><div class="eyebrow">OCA + TRIVIA + FÚTBOL</div><h1>¿Cuánto sabés<br>de <span style="color:var(--lime)">fútbol?</span></h1>
      <p>Ankara GOAT mezcla tablero, azar, estrategia y conocimiento futbolero. El dado te da la oportunidad: <b>solo avanzás si acertás</b>.</p>
      <div class="chips"><span class="chip">2–8 por tablero</span><span class="chip">25–70 casilleros</span><span class="chip">Tiers de conocimiento</span><span class="chip">Torneos</span></div></div>
      <div class="card auth-card" id="authCard">${landingForm(mode)}</div></section>`;
  bindAuth(mode);
}

function bindAuth(mode) {
  $$('[data-auth-tab]').forEach(btn => btn.addEventListener('click', () => renderLanding(btn.dataset.authTab)));
  $('#publicRankingBtn')?.addEventListener('click', renderLeaderboard);
  $('#authForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const data = await api(`/api/auth/${mode}`, { method:'POST', body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))) });
      setSession(data.token, data.user);
      await bootDashboard();
    } catch (err) { toast(err.message); }
  });
}

async function bootDashboard() {
  try {
    me = await api('/api/auth/me');
    renderSessionActions();
    connectSocket();
    await renderDashboard();
  } catch {
    setSession(null, null); renderLanding();
  }
}

function teamCard(team) {
  const c = team || {};
  const crest = c.crestUrl ? `<img src="${escapeHtml(c.crestUrl)}" alt="Escudo">` : escapeHtml(c.crestEmoji || '⚽');
  return `<div class="team-badge"><div class="crest" style="background:${escapeHtml(c.primaryColor || '#7C3AED')};color:${escapeHtml(c.secondaryColor || '#fff')}">${crest}</div>
    <div><div class="kicker">Tu equipo</div><h2 style="margin:4px 0">${escapeHtml(c.name || 'Sin nombre')}</h2><div class="muted">${escapeHtml(me?.username || '')}</div></div></div>`;
}

function tierModeOptions(selected='ankara') {
  return [
    ['casual','Casual · 60/30/10'],['futbolero','Futbolero · 45/40/15'],['enfermo','Enfermo · 25/40/35'],['ankara','Ankara · 35/35/30']
  ].map(([v,l])=>`<option value="${v}" ${selected===v?'selected':''}>${l}</option>`).join('');
}

async function renderDashboard() {
  const data = await api('/api/tournaments').catch(() => ({ tournaments:[], pendingInvites:[] }));
  const tournaments = Array.isArray(data) ? data : data.tournaments || [];
  const invites = data.pendingInvites || [];
  app.innerHTML = `<div class="dashboard-head"><div><div class="eyebrow">VESTUARIO</div><h1>Hola, ${escapeHtml(me.username)}</h1>
      <div class="profile-line">Nivel <b>${me.level || 1}</b> · ELO <b>${me.eloRating || 1000}</b> · ${me.xp || 0} XP</div></div>
      <div class="actions"><button class="btn" id="profileBtn">Mi conocimiento</button><button class="btn" id="leaderboardBtn">Ranking</button>${me.role==='admin'?'<a class="btn" href="/admin.html">Panel preguntas</a>':''}${['moderator','admin'].includes(me.role)?'<a class="btn" href="/moderator.html">Moderación</a>':''}<button class="btn primary" id="editTeamBtn">Editar equipo</button></div></div>
    ${invites.length ? `<section class="card invite-card"><div class="kicker">INVITACIONES PENDIENTES</div><div class="list" style="margin-top:12px">${invites.map(i=>`<div class="list-item"><span><b>${escapeHtml(i.Tournament?.name || 'Torneo')}</b><br><small class="muted">Invita ${escapeHtml(i.inviter?.username || 'organizador')}</small></span><span class="actions"><button class="btn primary" data-invite-accept="${i.id}">Aceptar</button><button class="btn ghost" data-invite-decline="${i.id}">Rechazar</button></span></div>`).join('')}</div></section>` : ''}
    <div class="grid three">
      <section class="card">${teamCard(me.Team)}</section>
      <section class="card"><div class="kicker">Partida rápida</div><h2>Crear sala</h2>
        <div class="field"><label>Nombre</label><input id="quickName" value="Clásico de ${escapeHtml(me.username)}"></div>
        <div class="grid two"><div class="field"><label>Casilleros</label><select id="quickBoard">${[25,30,35,40,45,50,55,60,65,70].map(n=>`<option ${n===40?'selected':''}>${n}</option>`).join('')}</select></div>
        <div class="field"><label>Modo de preguntas</label><select id="quickMode">${tierModeOptions()}</select></div></div>
        <label class="check"><input id="allowSpectators" type="checkbox" checked> Permitir espectadores</label>
        <button class="btn primary" id="createGameBtn" style="width:100%;margin-top:10px">Crear sala</button></section>
      <section class="card"><div class="kicker">Código de sala</div><h2>Entrar</h2>
        <div class="field"><label>Código</label><input id="joinCode" maxlength="6" style="text-transform:uppercase;letter-spacing:.12em"></div>
        <div class="grid two"><button class="btn primary" id="joinGameBtn">Jugar</button><button class="btn" id="watchGameBtn">Mirar</button></div></section>
    </div>
    <div class="section-title"><h2>Torneos</h2><button class="btn" id="newTournamentBtn">+ Nuevo torneo</button></div>
    <div class="grid two"><section class="card"><div class="kicker">Mis competiciones</div><div class="list" style="margin-top:12px">
      ${tournaments.length ? tournaments.map(t=>`<button class="list-item" data-tournament-id="${t.id}" style="color:white;cursor:pointer;width:100%"><span><b>${escapeHtml(t.name)}</b><br><small class="muted">${formatLabel(t.format)} · ${t.boardSize} casilleros</small></span><span class="status">${escapeHtml(t.status)}</span></button>`).join(''):'<div class="empty">Todavía no participás de ningún torneo.</div>'}</div></section>
      <section class="card"><div class="kicker">Regla central</div><h2>El avance se gana</h2><p class="muted">El dado marca el destino potencial. La ficha llega visualmente hasta allí, pero la posición solo se confirma si acertás la trivia. Si fallás, permanecés donde estabas.</p>
      <div class="tier-grid"><span><b>T1</b> Popular</span><span><b>T2</b> Fanático</span><span><b>T3</b> Enfermo</span></div></section></div>`;

  $('#createGameBtn').onclick=createQuickGame; $('#joinGameBtn').onclick=joinByCode; $('#watchGameBtn').onclick=watchByCode;
  $('#editTeamBtn').onclick=openTeamEditor; $('#newTournamentBtn').onclick=openTournamentModal; $('#profileBtn').onclick=renderMyProfile; $('#leaderboardBtn').onclick=renderLeaderboard;
  $$('[data-tournament-id]').forEach(el=>el.onclick=()=>openTournamentDetails(el.dataset.tournamentId));
  $$('[data-invite-accept]').forEach(el=>el.onclick=()=>respondInvite(el.dataset.inviteAccept,'accept'));
  $$('[data-invite-decline]').forEach(el=>el.onclick=()=>respondInvite(el.dataset.inviteDecline,'decline'));
}

function formatLabel(f) { return ({league_1v1:'Liga 1 vs 1',shared_board_league:'Liga en tablero compartido',group_knockout:'Liguilla + eliminación',cup:'Copa'})[f] || f; }

async function respondInvite(id, action) {
  try { await api(`/api/tournaments/invitations/${id}/${action}`,{method:'POST',body:'{}'}); toast(action==='accept'?'Invitación aceptada.':'Invitación rechazada.'); await renderDashboard(); }
  catch(e){ toast(e.message); }
}

async function createQuickGame() {
  try {
    const game = await api('/api/games', { method:'POST', body:JSON.stringify({ name:$('#quickName').value, boardSize:Number($('#quickBoard').value), questionMode:$('#quickMode').value, spectatorsAllowed:$('#allowSpectators').checked }) });
    enterGame(game,false);
  } catch(e){ toast(e.message); }
}

async function joinByCode() {
  const code=$('#joinCode').value.trim().toUpperCase(); if(!code)return toast('Ingresá el código de sala.');
  try { enterGame(await api(`/api/games/join/${encodeURIComponent(code)}`,{method:'POST',body:'{}'}),false); } catch(e){ toast(e.message); }
}

async function watchByCode() {
  const code=$('#joinCode').value.trim().toUpperCase(); if(!code)return toast('Ingresá el código de sala.');
  try { enterGame(await api(`/api/games/room/${encodeURIComponent(code)}`),true); } catch(e){ toast(e.message); }
}

function openTeamEditor() {
  const t=me.Team||{};
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="kicker">IDENTIDAD</div><h2>Editar equipo</h2>
    <form id="teamForm"><div class="field"><label>Nombre</label><input name="name" value="${escapeHtml(t.name)}" required></div>
    <div class="grid two"><div class="field"><label>Emoji del escudo</label><input name="crestEmoji" value="${escapeHtml(t.crestEmoji||'⚽')}" maxlength="8"></div><div class="field"><label>URL de escudo</label><input name="crestUrl" value="${escapeHtml(t.crestUrl||'')}"></div></div>
    <div class="field"><label>Subir escudo (PNG/JPG/WebP · máx. 2 MB)</label><input id="crestFile" type="file" accept="image/png,image/jpeg,image/webp"></div>
    <div class="grid two"><div class="field"><label>Color principal</label><input name="primaryColor" type="color" value="${escapeHtml(t.primaryColor||'#7C3AED')}"></div><div class="field"><label>Color secundario</label><input name="secondaryColor" type="color" value="${escapeHtml(t.secondaryColor||'#FFFFFF')}"></div></div>
    <div class="field"><label>Camiseta</label><select name="shirtPattern">${['solid','stripes','halves','sash','hoops'].map(v=>`<option value="${v}" ${t.shirtPattern===v?'selected':''}>${v}</option>`).join('')}</select></div>
    <div class="actions end"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn primary">Guardar</button></div></form></div></div>`;
  $('[data-close]',modalRoot).onclick=closeModal;
  $('#teamForm').onsubmit=async e=>{e.preventDefault();try{
    me.Team=await api('/api/team/mine',{method:'PUT',body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))});
    const file=$('#crestFile').files?.[0]; if(file){const fd=new FormData();fd.append('crest',file);const up=await apiForm('/api/team/mine/crest',fd);me.Team=up.team;}
    closeModal();await renderDashboard();toast('Equipo actualizado.');
  }catch(err){toast(err.message)}};
}

function closeModal(){clearInterval(questionTick);questionTick=null;modalRoot.innerHTML=''}

function openTournamentModal(){
  selectedTournamentUsers=[];
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="kicker">ORGANIZADOR</div><h2>Crear torneo</h2><form id="tournamentForm">
    <div class="field"><label>Nombre</label><input name="name" required placeholder="Copa de los Enfermos"></div>
    <div class="grid two"><div class="field"><label>Formato</label><select name="format" id="tFormat"><option value="league_1v1">Liga 1 vs 1</option><option value="shared_board_league">Todos juntos</option><option value="group_knockout">Liguilla + eliminación</option><option value="cup">Copa</option></select></div>
    <div class="field"><label>Casilleros</label><select name="boardSize">${[25,30,35,40,45,50,55,60,65,70].map(n=>`<option ${n===40?'selected':''}>${n}</option>`).join('')}</select></div></div>
    <div class="field"><label>Modo de preguntas</label><select name="questionMode">${tierModeOptions()}</select></div><div id="formatSettings"></div>
    <div class="field"><label>Invitar usuarios</label><input id="userSearch" placeholder="Buscar por usuario..."></div><div id="searchResults" class="list"></div><div id="selectedUsers" class="chips" style="margin:12px 0"></div>
    <p class="help">Los invitados deben aceptar. El calendario se genera recién cuando el organizador inicia el torneo.</p>
    <div class="actions end"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn primary">Crear e invitar</button></div></form></div></div>`;
  $('[data-close]',modalRoot).onclick=closeModal; $('#tFormat').onchange=renderFormatSettings;renderFormatSettings();
  let timer;$('#userSearch').oninput=e=>{clearTimeout(timer);timer=setTimeout(()=>searchUsers(e.target.value),250)};$('#tournamentForm').onsubmit=createTournament;
}

function renderFormatSettings(){
  const f=$('#tFormat').value,root=$('#formatSettings');
  if(f==='shared_board_league')root.innerHTML=`<div class="field"><label>Cantidad de partidas (1–10)</label><input name="matchCount" type="number" min="1" max="10" value="3"></div>`;
  else if(f==='group_knockout')root.innerHTML=`<div class="grid two"><div class="field"><label>Cantidad de grupos</label><input name="groupCount" type="number" min="2" max="14" value="2"></div><div class="field"><label>Clasifican por grupo</label><select name="qualifiersPerGroup"><option>1</option><option selected>2</option><option>4</option></select></div></div><p class="help">El total de clasificados debe ser potencia de 2.</p>`;
  else root.innerHTML='';
}

async function searchUsers(q){
  if(q.trim().length<2){$('#searchResults').innerHTML='';return}
  try{const rows=await api(`/api/users/search?q=${encodeURIComponent(q.trim())}`);$('#searchResults').innerHTML=rows.map(u=>`<button type="button" class="list-item" data-add-user="${u.id}" style="color:#fff;cursor:pointer"><span>${escapeHtml(u.Team?.crestEmoji||'⚽')} <b>${escapeHtml(u.username)}</b> · ${escapeHtml(u.Team?.name||'Sin equipo')}</span><span>+</span></button>`).join('');
    $$('[data-add-user]',modalRoot).forEach(btn=>btn.onclick=()=>{const u=rows.find(x=>x.id===Number(btn.dataset.addUser));if(!selectedTournamentUsers.some(x=>x.id===u.id))selectedTournamentUsers.push(u);renderSelectedUsers()});
  }catch(e){toast(e.message)}}
function renderSelectedUsers(){$('#selectedUsers').innerHTML=selectedTournamentUsers.map(u=>`<button type="button" class="chip" data-remove-user="${u.id}" style="border:0;color:#fff;cursor:pointer">${escapeHtml(u.username)} ×</button>`).join('');$$('[data-remove-user]',modalRoot).forEach(btn=>btn.onclick=()=>{selectedTournamentUsers=selectedTournamentUsers.filter(u=>u.id!==Number(btn.dataset.removeUser));renderSelectedUsers()})}

async function createTournament(e){e.preventDefault();const form=Object.fromEntries(new FormData(e.currentTarget)),settings={questionMode:form.questionMode};if(form.matchCount)settings.matchCount=Number(form.matchCount);if(form.groupCount)settings.groupCount=Number(form.groupCount);if(form.qualifiersPerGroup)settings.qualifiersPerGroup=Number(form.qualifiersPerGroup);
  try{const data=await api('/api/tournaments',{method:'POST',body:JSON.stringify({name:form.name,format:form.format,boardSize:Number(form.boardSize),settings,participantIds:selectedTournamentUsers.map(u=>u.id)})});closeModal();toast('Torneo creado e invitaciones enviadas.');await openTournamentDetails(data.tournament.id)}catch(err){toast(err.message)}}

async function openTournamentDetails(id){
  try{const [t,standingData]=await Promise.all([api(`/api/tournaments/${id}`),api(`/api/tournaments/${id}/standings`)]),isOrg=t.organizerId===me.id;
    const renderTable=(rows,title)=>`<section class="card"><div class="kicker">${escapeHtml(title)}</div><div class="table-wrap"><table class="standings"><thead><tr><th>#</th><th>Equipo</th><th>Pts</th><th>V</th><th>✓</th><th>✗</th><th>Dif.</th></tr></thead><tbody>${rows.map(r=>`<tr class="${r.exactTiePending?'tie-pending':''}"><td>${r.position}</td><td>${escapeHtml(r.team?.crestEmoji||'⚽')} <b>${escapeHtml(r.team?.name||r.username)}</b>${r.exactTiePending?' <small>⚖ desempate</small>':''}</td><td><b>${r.points}</b></td><td>${r.wins}</td><td>${r.correctAnswers}</td><td>${r.incorrectAnswers}</td><td>${r.answerDifference>0?'+':''}${r.answerDifference}</td></tr>`).join('')}</tbody></table></div></section>`;
    const tables=Object.entries(standingData.groups||{}).map(([code,rows])=>renderTable(rows,code==='overall'?'Tabla de posiciones':`Grupo ${code}`)).join('');
    const ties=(standingData.tiebreaks||[]);
    app.innerHTML=`<div class="dashboard-head"><div><div class="eyebrow">${escapeHtml(formatLabel(t.format))}</div><h1>${escapeHtml(t.name)}</h1><div class="muted">${t.boardSize} casilleros · ${t.TournamentParticipants?.length||0} participantes · ${escapeHtml(t.status)}</div></div><div class="actions">${isOrg&&t.status!=='running'&&t.status!=='finished'?'<button class="btn primary" id="startTournament">Generar calendario</button>':''}<button class="btn ghost" id="backDash">← Vestuario</button></div></div>
      <div class="standings-stack">${tables}</div>
      ${ties.length?`<section class="card"><div class="kicker">Desempates</div><div class="list">${ties.map(x=>`<div class="list-item"><span><b>${x.scope==='group'?`Grupo ${escapeHtml(x.groupCode)}`:'Tabla final'}</b><br><small class="muted">${(x.userIds||[]).length} jugadores · ${escapeHtml(x.status)}</small></span>${isOrg&&x.status!=='resolved'?`<button class="btn primary" data-open-tiebreak="${x.id}">Abrir desempate</button>`:''}</div>`).join('')}</div></section>`:''}
      <div class="grid two"><section class="card"><div class="kicker">Participantes aceptados</div><div class="list" style="margin-top:12px">${(t.TournamentParticipants||[]).map(p=>`<div class="list-item"><span>${escapeHtml(p.User?.Team?.crestEmoji||'⚽')} <b>${escapeHtml(p.User?.username||p.userId)}</b>${p.groupCode?` · Grupo ${p.groupCode}`:''}</span><span class="score-strong">${p.points} pts</span></div>`).join('')}</div></section>
      <section class="card"><div class="kicker">Invitaciones</div><div class="list" style="margin-top:12px">${(t.TournamentInvitations||[]).map(i=>`<div class="list-item"><span>${escapeHtml(i.invitee?.username||i.inviteeId)}</span><span class="status">${escapeHtml(i.status)}</span></div>`).join('')||'<div class="empty">Sin invitaciones.</div>'}</div></section></div>
      <div class="section-title"><h2>Calendario</h2></div><section class="card"><div class="list">${(t.Matches||[]).map(m=>`<div class="list-item"><span><b>R${m.roundNo} · ${escapeHtml(m.stage)}</b><br><small class="muted">${m.groupCode?`Grupo ${m.groupCode} · `:''}${m.participants?.length?m.participants.join(' vs '):describeSources(m.source)}</small></span><span class="actions"><span class="status">${m.status}</span>${isOrg&&m.participants?.length>=2&&m.status!=='finished'?`<button class="btn" data-open-match="${m.id}">Abrir sala</button>`:''}</span></div>`).join('')||'<div class="empty">El calendario se crea cuando el organizador inicia el torneo.</div>'}</div></section>`;
    $('#backDash').onclick=()=>token?renderDashboard():renderLanding();$('#startTournament')?.addEventListener('click',async()=>{try{await api(`/api/tournaments/${t.id}/start`,{method:'POST',body:'{}'});toast('Calendario generado.');openTournamentDetails(t.id)}catch(e){toast(e.message)}});
    $$('[data-open-match]').forEach(b=>b.onclick=async()=>{try{const g=await api(`/api/tournaments/${t.id}/matches/${b.dataset.openMatch}/game`,{method:'POST',body:'{}'});enterGame(g,!g.state?.players?.some(p=>p.userId===me.id))}catch(e){toast(e.message)}});
    $$('[data-open-tiebreak]').forEach(b=>b.onclick=async()=>{try{const g=await api(`/api/tournaments/${t.id}/tiebreaks/${b.dataset.openTiebreak}/game`,{method:'POST',body:'{}'});enterGame(g,!g.state?.players?.some(p=>p.userId===me.id))}catch(e){toast(e.message)}});
  }catch(e){toast(e.message)}}

function describeSources(source){if(!source?.entrants)return'Cruce pendiente';return source.entrants.map(s=>s.type==='winner'?`Ganador ${s.ref}`:s.type==='group_position'?`${s.position}° Grupo ${s.groupCode}`:`Jugador ${s.id}`).join(' vs ')}

function connectSocket(){
  if(socket)return;
  socket=io({auth:{token},transports:['websocket'],upgrade:false,reconnection:true,reconnectionAttempts:Infinity,reconnectionDelay:500,reconnectionDelayMax:5000});
  socket.on('connect',()=>{if(currentGame){const event=currentSpectator?'watch_game':'join_game';socket.emit(event,{gameId:currentGame.id},ack=>{if(!ack?.ok)toast(ack.error);else if(ack.recovered||currentState)toast('Conexión restaurada.')})}});
  socket.on('connect_error',e=>toast(e.message));
  socket.on('game_state',payload=>{if(!currentGame||Number(payload.gameId)!==Number(currentGame.id))return;currentSpectatorCount=payload.spectatorCount||0;if(animatingMovement){queuedGameState=payload;return}currentGame={...currentGame,...payload,status:payload.status};currentState=payload.state;renderGame()});
  socket.on('dice_result',async data=>{if(!currentGame)return;toast(`${playerName(data.userId)} sacó ${data.roll}`);await animateMovement(data.userId,data.movement.from,data.movement.to)});
  socket.on('question',q=>{if(!currentSpectator)openQuestion(q)});
  socket.on('coin_toss_choice_required',()=>{if(!currentSpectator)openCoinTossChoice()});
  socket.on('answer_result',r=>showAnswerResult(r));
  socket.on('chat_message',m=>{if(currentGame&&Number(m.gameId)===Number(currentGame.id)){chatMessages.push(m);chatMessages=chatMessages.slice(-80);renderChatOnly()}});
  socket.on('reaction',r=>{if(currentGame){toast(`${r.username}: ${r.reaction}`)}});
  socket.on('ranking_updated',()=>toast('Ranking ELO actualizado.'));
}

async function enterGame(game,spectator=false){
  currentGame=game;currentState=game.state;currentSpectator=spectator;connectSocket();
  const event=spectator?'watch_game':'join_game';socket.emit(event,{gameId:game.id},ack=>{if(!ack?.ok)toast(ack?.error||'No se pudo entrar')});
  chatMessages=await api(`/api/games/${game.id}/chat`).catch(()=>[]);renderGame();
}

function visualPositionFor(p){
  const current=currentState?.players?.[currentState.turnIndex];
  if(current?.userId===p.userId && currentState?.pendingMove && ['question_pending','surprise_choice','answering'].includes(currentState.phase)) return currentState.pendingMove.to;
  return p.position;
}

function renderGame(){
  if(!currentGame||!currentState)return;if(currentGame.status==='lobby'||currentState.phase==='lobby')return renderLobby();
  const current=currentState.players?.[currentState.turnIndex],isMyTurn=current?.userId===me.id&&!currentSpectator;
  app.innerHTML=`<div class="dashboard-head"><div><div class="eyebrow">SALA ${escapeHtml(currentGame.roomCode||'')} ${currentSpectator?'· ESPECTADOR':''}</div><h1>${escapeHtml(currentGame.name||'Partida')}</h1><div class="muted">👁 ${currentSpectatorCount} espectadores · Modo ${escapeHtml(currentState.settings?.questionMode||'ankara')}</div></div><button class="btn ghost" id="leaveGame">← Salir de la vista</button></div>
    <div class="game-grid"><div class="board" id="board">${renderBoardCells()}</div><aside class="sidepanel">
      <section class="card turn"><div class="kicker">Turno ${currentState.turnNo||1}</div><h2>${escapeHtml(current?.username||'—')}</h2><button class="dice" id="diceBtn" ${!(isMyTurn&&currentState.phase==='roll')?'disabled':''}>🎲</button><div class="muted">${currentState.phase==='roll'?(isMyTurn?'Tirá el dado':currentSpectator?'Mirando la partida...':'Esperando el dado...'):phaseLabel(currentState.phase)}</div></section>
      <section class="card"><div class="kicker">Tabla de carrera</div><div class="list" style="margin-top:10px">${[...(currentState.players||[])].sort((a,b)=>visualPositionFor(b)-visualPositionFor(a)).map(p=>`<div class="player-row"><span class="dot" style="background:${escapeHtml(p.team?.primaryColor||'#888')}"></span><span style="flex:1">${escapeHtml(p.username)}<small class="muted"> · ${escapeHtml(p.team?.name||'Equipo')}</small></span><b>${p.finishOrder?`#${p.finishOrder}`:`${visualPositionFor(p)}/${currentState.boardSize}`}</b>${p.userId!==me.id&&p.team?.id?`<button type="button" class="mini-report" data-report-team="${p.team.id}" title="Reportar nombre de equipo">⚑</button>`:''}${!p.active?'<span>☠</span>':''}</div>`).join('')}</div></section>
      <section class="card chat-card"><div class="kicker">Chat y reacciones</div><div id="chatList" class="chat-list">${renderChatMessages()}</div><form id="chatForm" class="chat-form"><input id="chatInput" maxlength="500" placeholder="Escribí algo..."><button class="btn">Enviar</button></form><div class="reactions">${['⚽','🐐','🔥','😂','👏','😱','🟥','🟨'].map(r=>`<button data-reaction="${r}">${r}</button>`).join('')}</div></section>
    </aside></div>`;
  $('#diceBtn')?.addEventListener('click',()=>socket.emit('roll_dice',{gameId:currentGame.id},ack=>{if(!ack?.ok)toast(ack.error)}));
  $('#leaveGame').onclick=()=>{currentGame=null;currentState=null;currentSpectator=false;renderDashboard()};
  $('#chatForm').onsubmit=e=>{e.preventDefault();const body=$('#chatInput').value.trim();if(!body)return;socket.emit('chat_message',{gameId:currentGame.id,body},ack=>{if(!ack?.ok)toast(ack.error);else $('#chatInput').value=''})};
  $$('[data-reaction]').forEach(b=>b.onclick=()=>socket.emit('reaction',{gameId:currentGame.id,reaction:b.dataset.reaction}));
  bindModerationReportButtons();
}

function renderLobby(){
  const isOrg=currentState.organizerId===me.id;
  app.innerHTML=`<div class="dashboard-head"><div><div class="eyebrow">VESTUARIO DE PARTIDA ${currentSpectator?'· ESPECTADOR':''}</div><h1>${escapeHtml(currentGame.name)}</h1></div><button class="btn ghost" id="backDash">← Salir de la vista</button></div>
    <div class="grid two"><section class="card"><div class="kicker">Compartí este código</div><div class="room-code">${escapeHtml(currentGame.roomCode)}</div><p class="muted">Los jugadores pueden entrar con el código. Los espectadores usan “Mirar”.</p>${isOrg?'<button class="btn primary large" id="startGame" style="width:100%">Comenzar partida</button>':'<div class="empty">Esperando que el organizador inicie.</div>'}</section>
    <section class="card"><div class="kicker">Jugadores</div><div class="list" style="margin-top:12px">${(currentState.players||[]).map((p,i)=>`<div class="list-item"><span>${escapeHtml(p.team?.crestEmoji||'⚽')} <b>${escapeHtml(p.username)}</b></span><span>${i===0?'👑':''}</span></div>`).join('')}</div><p class="help">Mínimo 2 · Máximo ${currentState.settings?.isStandingsTiebreak?14:8}${currentState.settings?.isStandingsTiebreak?' (desempate)':''} · Modo ${escapeHtml(currentState.settings?.questionMode||'ankara')}</p></section></div>`;
  $('#backDash').onclick=()=>{currentGame=null;currentState=null;currentSpectator=false;renderDashboard()};
  $('#startGame')?.addEventListener('click',async()=>{try{const g=await api(`/api/games/${currentGame.id}/start`,{method:'POST',body:'{}'});currentGame=g;currentState=g.state;const event=currentSpectator?'watch_game':'join_game';socket.emit(event,{gameId:g.id});renderGame()}catch(e){toast(e.message)}});
}

function renderBoardCells(){
  const cells=[];for(let pos=1;pos<=currentState.boardSize;pos++){
    const players=(currentState.players||[]).filter(p=>p.active&&visualPositionFor(p)===pos);const provisional=currentState.pendingMove?.to===pos&&['question_pending','surprise_choice','answering'].includes(currentState.phase);
    cells.push(`<div class="cell ${currentState.surprises?.[pos]?'surprise':''} ${pos===currentState.boardSize?'finish':''}" data-pos="${pos}"><span>${pos}</span><div class="tokens">${players.map(p=>`<span class="token ${provisional&&currentState.players[currentState.turnIndex]?.userId===p.userId?'provisional':''}" title="${escapeHtml(p.username)}" style="background:${escapeHtml(p.team?.primaryColor||'#888')}"></span>`).join('')}</div></div>`)}return cells.join('')
}

function phaseLabel(p){return({moving:'Destino potencial',question_pending:'Preparando pregunta',surprise_choice:'Decisión especial',answering:'Respondiendo trivia',turn_end:'Cerrando turno',finished:'Partida terminada'})[p]||p}
function playerName(id){return currentState?.players?.find(p=>p.userId===id)?.username||'Jugador'}
function beep(){try{const ctx=new(window.AudioContext||window.webkitAudioContext)(),o=ctx.createOscillator(),g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.value=380;g.gain.setValueAtTime(.035,ctx.currentTime);g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.055);o.start();o.stop(ctx.currentTime+.06)}catch{}}
async function animateMovement(userId,from,to){if(!currentState)return;animatingMovement=true;const p=currentState.players.find(x=>x.userId===userId);if(p){const original=p.position;for(let pos=from+1;pos<=to;pos++){p.position=pos;renderGame();beep();await new Promise(r=>setTimeout(r,150))}p.position=original}animatingMovement=false;if(queuedGameState){const q=queuedGameState;queuedGameState=null;currentGame={...currentGame,...q,status:q.status};currentState=q.state;renderGame()}}

function openQuestion(q){
  clearInterval(questionTick);let selected=null;const isCat=q.type==='categorization',players=(currentState?.players||[]).filter(p=>p.active&&p.userId!==me.id);
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="question-meta"><span class="tier tier-${q.tier||2}">T${q.tier||2}</span><span>${isCat?'CATEGORIZACIÓN · 40 SEGUNDOS':'MÚLTIPLE CHOICE · 20 SEGUNDOS'}</span>${q.knowledgeArea?`<span>${escapeHtml(q.knowledgeArea)}</span>`:''}</div><h2>${escapeHtml(q.prompt)}</h2><div class="timer"><div id="timerBar"></div></div>
    <div id="answerArea">${isCat?renderCategorization(q):`<div class="options">${(q.options||[]).map((o,i)=>`<button type="button" class="option" data-option="${i}">${escapeHtml(o)}</button>`).join('')}</div>`}</div>
    ${q.surpriseAction?`<div class="field"><label>${q.surpriseAction==='eliminate'?'A quién querés eliminar':'Con quién intercambiás posición'}</label><select id="surpriseTarget"><option value="">Elegí rival</option>${players.map(p=>`<option value="${p.userId}">${escapeHtml(p.username)}</option>`).join('')}</select></div>`:''}
    <button class="btn primary large" id="submitAnswer" style="width:100%;margin-top:16px">Responder y ganar el avance</button></div></div>`;
  if(!isCat)$$('[data-option]',modalRoot).forEach(btn=>btn.onclick=()=>{$$('[data-option]',modalRoot).forEach(b=>b.classList.remove('selected'));btn.classList.add('selected');selected=q.options[Number(btn.dataset.option)]});
  $('#submitAnswer').onclick=()=>{const answer=isCat?collectCategorization(q):selected;if(answer==null||(isCat&&Object.values(answer).some(v=>!v)))return toast('Completá la respuesta.');const targetUserId=$('#surpriseTarget',modalRoot)?.value||null;if(q.surpriseAction&&!targetUserId)return toast('Elegí un rival.');$('#submitAnswer').disabled=true;socket.emit('submit_answer',{gameId:currentGame.id,answer,targetUserId},ack=>{if(!ack?.ok){toast(ack.error);$('#submitAnswer').disabled=false}})};
  const total=isCat?40000:20000,update=()=>{const left=Math.max(0,q.deadline-Date.now()),bar=$('#timerBar');if(bar)bar.style.width=`${left/total*100}%`;if(left<=0){clearInterval(questionTick);$('#submitAnswer')?.setAttribute('disabled','disabled')}};update();questionTick=setInterval(update,200);
}

function renderCategorization(q){const categories=q.options?.categories||[],items=q.options?.items||[];return `<div>${items.map(item=>`<div class="categorize-row"><b>${escapeHtml(item)}</b><select data-cat-item="${escapeHtml(item)}"><option value="">Elegí...</option>${categories.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}</select></div>`).join('')}</div>`}
function collectCategorization(){const out={};$$('[data-cat-item]',modalRoot).forEach(s=>out[s.dataset.catItem]=s.value);return out}

function openCoinTossChoice(){const rivals=(currentState?.players||[]).filter(p=>p.active&&p.userId!==me.id);modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="kicker">SORPRESA</div><h2>🪙 Cara o Seca</h2><p class="muted">Elegí rival y apuesta antes de ver la pregunta. Si acertás, retrocede el rival. Si fallás, retrocedés vos y tampoco ganás el avance del dado.</p><div class="field"><label>Rival</label><select id="coinTarget">${rivals.map(p=>`<option value="${p.userId}">${escapeHtml(p.username)}</option>`).join('')}</select></div><div class="field"><label>Casilleros: <span id="coinAmountLabel">5</span></label><input id="coinAmount" type="range" min="1" max="10" value="5"></div><button class="btn primary large" id="confirmCoin" style="width:100%">Elegir y ver pregunta</button></div></div>`;$('#coinAmount').oninput=e=>$('#coinAmountLabel').textContent=e.target.value;$('#confirmCoin').onclick=()=>socket.emit('coin_toss_choice',{gameId:currentGame.id,targetUserId:Number($('#coinTarget').value),amount:Number($('#coinAmount').value)},ack=>{if(!ack?.ok)toast(ack.error);else closeModal()})}

function showAnswerResult(r){
  if(r.userId!==me.id){toast(`${playerName(r.userId)} ${r.correct?'acertó':'falló'}.`);return}
  clearInterval(questionTick);
  const answer=typeof r.correctAnswer==='string'?r.correctAnswer:JSON.stringify(r.correctAnswer);
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal result-modal"><div class="result-icon">${r.correct?'✅':'❌'}</div><div class="eyebrow">${r.correct?'AVANCE CONFIRMADO':'TE QUEDÁS DONDE ESTABAS'}</div><h2>${r.correct?'¡Correcto!':'Incorrecto'}</h2><p class="muted">Respuesta correcta: <b>${escapeHtml(answer)}</b></p><div class="chips"><span class="chip">T${r.tier}</span><span class="chip">${escapeHtml(r.knowledgeArea||'General')}</span><span class="chip">+${r.xpEarned||0} XP</span>${r.level?`<span class="chip">Nivel ${r.level}</span>`:''}</div><div class="actions end" style="margin-top:20px"><button class="btn ghost" id="reportQuestion">Reportar pregunta</button><button class="btn primary" data-close>Continuar</button></div></div></div>`;
  $('[data-close]',modalRoot).onclick=closeModal;$('#reportQuestion').onclick=()=>openReportQuestion(r.questionId);
}

function openReportQuestion(questionId){modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="kicker">REVISIÓN COMUNITARIA</div><h2>Reportar pregunta</h2><div class="field"><label>Motivo</label><select id="reportReason"><option value="incorrect_answer">Respuesta incorrecta</option><option value="outdated">Desactualizada</option><option value="ambiguous">Ambigua</option><option value="typo">Error de redacción</option><option value="other">Otro</option></select></div><div class="field"><label>Detalle</label><textarea id="reportDetails" maxlength="1000" placeholder="Contanos qué habría que revisar"></textarea></div><div class="actions end"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="sendReport">Enviar</button></div></div></div>`;$('[data-close]',modalRoot).onclick=closeModal;$('#sendReport').onclick=async()=>{try{await api(`/api/questions/${questionId}/report`,{method:'POST',body:JSON.stringify({reason:$('#reportReason').value,details:$('#reportDetails').value})});closeModal();toast('Reporte enviado. Gracias.')}catch(e){toast(e.message)}}}

function renderChatMessages(){return chatMessages.map(m=>m.type==='reaction'?`<div class="chat-line"><b>${escapeHtml(m.User?.username||m.username||'Jugador')}</b> ${escapeHtml(m.reaction||'')}</div>`:`<div class="chat-line"><b>${escapeHtml(m.User?.username||m.username||'Jugador')}</b><span>${escapeHtml(m.body||'')}</span>${m.id&&Number(m.userId)!==Number(me?.id)?`<button type="button" class="mini-report" data-report-chat="${m.id}" title="Reportar mensaje">⚑</button>`:''}</div>`).join('')||'<div class="muted small">Sin mensajes todavía.</div>'}
function renderChatOnly(){const el=$('#chatList');if(el){el.innerHTML=renderChatMessages();el.scrollTop=el.scrollHeight;bindModerationReportButtons()}}
function bindModerationReportButtons(){
  $$('[data-report-chat]').forEach(b=>b.onclick=()=>openModerationReport('chat_message',Number(b.dataset.reportChat)));
  $$('[data-report-team]').forEach(b=>b.onclick=()=>openModerationReport('team_name',Number(b.dataset.reportTeam)));
}
function openModerationReport(targetType,targetId){
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="kicker">MODERACIÓN</div><h2>Reportar ${targetType==='chat_message'?'mensaje':'nombre de equipo'}</h2><div class="field"><label>Motivo</label><select id="modReportReason"><option value="offensive">Ofensivo</option><option value="hate">Odio/discriminación</option><option value="harassment">Acoso</option><option value="sexual">Contenido sexual</option><option value="spam">Spam/estafa</option><option value="impersonation">Suplantación</option><option value="personal_data">Datos personales</option><option value="other">Otro</option></select></div><div class="field"><label>Detalle</label><textarea id="modReportDetails" maxlength="1000"></textarea></div><div class="actions end"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="sendModReport">Enviar reporte</button></div></div></div>`;
  $('[data-close]',modalRoot).onclick=closeModal;
  $('#sendModReport').onclick=async()=>{try{await api('/api/moderation/reports',{method:'POST',body:JSON.stringify({targetType,targetId,reason:$('#modReportReason').value,details:$('#modReportDetails').value})});closeModal();toast('Reporte enviado a moderación.')}catch(e){toast(e.message)}};
}

async function renderMyProfile(){
  try{const data=await api('/api/profile/me'),u=data.user;app.innerHTML=`<div class="dashboard-head"><div><div class="eyebrow">PERFIL DE CONOCIMIENTO</div><h1>${escapeHtml(u.Team?.name||u.username)}</h1><div class="profile-line">Nivel <b>${u.level}</b> · ELO <b>${u.eloRating}</b> · ${u.xp} XP</div></div><button class="btn ghost" id="backDash">← Vestuario</button></div>
    <div class="grid two"><section class="card"><div class="kicker">Mapa de conocimiento</div><h2>¿Dónde sos fuerte?</h2><div class="knowledge-list">${(data.knowledge||[]).map(s=>`<div class="knowledge-row"><div><span>${escapeHtml(s.label)}</span><small>${s.correct}/${s.answered}</small></div><div class="knowledge-bar"><i style="width:${Math.min(100,s.accuracy)}%"></i></div><b>${Math.round(s.accuracy)}%</b></div>`).join('')||'<div class="empty">Respondé preguntas para construir tu perfil.</div>'}</div></section>
    <section class="card"><div class="kicker">Historial</div><h2>Últimas partidas</h2><div class="list">${(data.history||[]).map(h=>`<div class="list-item"><span><b>${escapeHtml(h.Game?.name||'Partida')}</b><br><small class="muted">${new Date(h.createdAt).toLocaleDateString()}</small></span><span><b>#${h.finishPosition||'—'}</b><br><small class="muted">ELO ${h.eloBefore}→${h.eloAfter}</small></span></div>`).join('')||'<div class="empty">Todavía no terminaste partidas.</div>'}</div></section></div>`;$('#backDash').onclick=()=>token?renderDashboard():renderLanding();
  }catch(e){toast(e.message)}}

async function renderLeaderboard(){
  try{const rows=await api('/api/leaderboard');app.innerHTML=`<div class="dashboard-head"><div><div class="eyebrow">RANKING GLOBAL</div><h1>GOAT Ladder</h1></div><button class="btn ghost" id="backDash">← Vestuario</button></div><section class="card"><div class="list leaderboard">${rows.map((u,i)=>`<div class="list-item"><span class="rank">#${i+1}</span><span class="crest mini" style="background:${escapeHtml(u.Team?.primaryColor||'#333')}">${escapeHtml(u.Team?.crestEmoji||'⚽')}</span><span style="flex:1"><b>${escapeHtml(u.Team?.name||u.username)}</b><br><small class="muted">${escapeHtml(u.username)} · Nivel ${u.level}</small></span><b>${u.eloRating} ELO</b></div>`).join('')}</div></section>`;$('#backDash').onclick=()=>token?renderDashboard():renderLanding();
  }catch(e){toast(e.message)}}

document.querySelector('[data-go-home]').addEventListener('click',()=>token?renderDashboard():renderLanding());
renderSessionActions();if(token)bootDashboard();else renderLanding();
