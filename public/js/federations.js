/* Federaciones V1: interfaz liviana, sin framework ni motor de juego duplicado. */
(() => {
  'use strict';
  function bannerPercent(value){const n=Number(value);return Number.isFinite(n)&&n>=0&&n<=100?n:50;}
  const root=document.querySelector('#fedMain');
  const toastEl=document.querySelector('#fedToast');
  const token=localStorage.getItem('ankara_token');
  if(!token){
    const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&quot;'}[c]));
    document.querySelector('.fed-nav').style.display='none';
    document.querySelector('.fed-shell').style.gridTemplateColumns='1fr';
    const slug=new URLSearchParams(location.search).get('slug');
    const url=slug?`/api/federations/public/${encodeURIComponent(slug)}`:'/api/federations/public';
    fetch(url).then(async response=>{if(!response.ok)throw new Error('Comunidad inexistente o privada.');return response.json();}).then(data=>{
      if(Array.isArray(data))root.innerHTML=`<section class="fed-hero"><div class="fed-eyebrow">Comunidades públicas</div><h1>Federaciones AnkaraGOAT</h1><p>Conocé nuestras comunidades. Iniciá sesión para estudiar y competir.</p></section><div class="fed-grid">${data.map(f=>`<div class="fed-card"><h3>${safe(f.name)}</h3><p>${safe(f.description)}</p><p>${safe(f.categories.join(' · '))}</p><a class="fed-button" href="?slug=${encodeURIComponent(f.slug)}">Visitar página</a></div>`).join('')}</div>`;
      else root.innerHTML=`<section class="fed-hero"><div class="fed-eyebrow">Federación pública</div><h1>${safe(data.federation.name)}</h1><p>${safe(data.federation.description)}</p></section><div class="fed-kpis"><div class="fed-kpi"><span class="fed-kpi-icon"><i class="fi fi-rr-users"></i></span><span class="fed-kpi-label">Federados</span><b class="fed-kpi-value">${data.members}</b></div><div class="fed-kpi"><span class="fed-kpi-icon"><i class="fi fi-rr-trophy"></i></span><span class="fed-kpi-label">Torneos</span><b class="fed-kpi-value">${data.tournaments.length}</b></div></div><h2>Temáticas</h2><p>${safe(data.federation.categories.join(' · '))}</p><div class="fed-list">${data.tournaments.map(t=>`<div class="fed-item"><span>${safe(t.name)} · ${safe(t.status)}</span>${t.shareCode?`<a href="/share/tournament/${encodeURIComponent(t.shareCode)}">Ver torneo</a>`:''}</div>`).join('')}</div><p><a class="fed-button primary" href="/">Ingresar a AnkaraGOAT</a></p>`;
      if(!Array.isArray(data)){
        const banner=document.createElement('div');banner.className='fed-banner';
        if(data.federation.bannerUrl){
          banner.style.backgroundImage=`linear-gradient(#09201677,#09201699),url(${JSON.stringify(data.federation.bannerUrl)})`;
          banner.style.backgroundPosition=`center, ${bannerPercent(data.federation.bannerPositionX)}% ${bannerPercent(data.federation.bannerPositionY)}%`;
        }
        if(data.federation.crestUrl){const crest=document.createElement('img');crest.className='fed-crest';crest.alt='Escudo';crest.src=data.federation.crestUrl;banner.appendChild(crest);}
        root.prepend(banner);
      }
    }).catch(e=>root.textContent=e.message);
    return;
  }
  let detail=null,activeId=null,activeTab='home';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=value=>Number(value)||0;
  const fmt=n=>new Intl.NumberFormat('es-AR').format(Number(n)||0);
  const date=s=>s?new Date(s).toLocaleDateString('es-AR'):'—';
  const icon=(name)=>`<i class="fi fi-rr-${name}" aria-hidden="true"></i>`;
  const button=(label,id,kind='ghost')=>`<button class="fed-button ${kind}" id="${id}">${label}</button>`;
  const empty=(message)=>`<div class="fed-empty">${esc(message)}</div>`;
  const img=(url,css='fed-inline-image')=>url?`<img class="${css}" src="${esc(url)}" alt="">`:`<span class="fed-icon">${icon('shield-check')}</span>`;
  const card=(body)=>`<div class="fed-card">${body}</div>`;
  const title=(s)=>`<div class="fed-section"><h2>${esc(s)}</h2></div>`;
  const formData=form=>Object.fromEntries(new FormData(form).entries());
  function toast(message){toastEl.textContent=message;toastEl.classList.add('show');clearTimeout(toast._timer);toast._timer=setTimeout(()=>toastEl.classList.remove('show'),4500);}
  async function api(path,method='GET',body){
    const opts={method,headers:{Authorization:`Bearer ${token}`}};
    if(body!==undefined){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(body);}
    const response=await fetch(`/api/federations${path}`,opts);
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(payload.error||`Error HTTP ${response.status}`);
    return payload;
  }
  let tournamentRulesPromise=null;
  function tournamentRules(){
    if(!tournamentRulesPromise)tournamentRulesPromise=fetch('/api/rules').then(async response=>{
      if(!response.ok)throw new Error('No se pudo consultar la configuración de los campeonatos.');
      return response.json();
    }).catch(error=>{tournamentRulesPromise=null;throw error;});
    return tournamentRulesPromise;
  }
  function invoke(fn){return async event=>{event?.preventDefault();try{await fn(event);}catch(error){toast(error.message)}};}
  function bind(selector,callback,event='click'){
    root.querySelectorAll(selector).forEach(node=>node.addEventListener(event,invoke(callback)));
  }
  function menu(name){document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===name));}
  function wireSubtabs(attr){
    mount().querySelectorAll(`[${attr}]`).forEach(btn=>btn.addEventListener('click',()=>{
      const value=btn.getAttribute(attr);
      mount().querySelectorAll(`[${attr}]`).forEach(tab=>{tab.classList.toggle('active',tab===btn);tab.setAttribute('aria-selected',String(tab===btn));});
      mount().querySelectorAll(`[data-panel-for="${attr}"]`).forEach(panel=>{panel.hidden=panel.dataset.panel!==value;});
    }));
  }
  const subtab=(attr,keys)=>`<nav class="fed-subtabs" role="tablist">${keys.map(([key,label,ico],i)=>`<button type="button" role="tab" ${attr}="${key}" aria-selected="${i===0}" class="${i===0?'active':''}">${icon(ico)} ${esc(label)}</button>`).join('')}</nav>`;
  const subpanel=(attr,key,content,visible=false)=>`<section class="fed-subpanel" data-panel-for="${attr}" data-panel="${key}" ${visible?'':'hidden'}>${content}</section>`;

  function hero(label,heading,description){return `<section class="fed-hero"><div class="fed-eyebrow">${esc(label)}</div><h1>${esc(heading)}</h1><p>${esc(description)}</p></section>`;}
  function fedCard(row){const f=row.federation||row;
    return card(`<div class="fed-row">${img(f.crestUrl)}<div><h3>${esc(f.name)}</h3><small>${esc((f.categories||[]).join(' · '))}</small></div></div>
      <p>${esc((f.description||'Comunidad futbolera de AnkaraGOAT').slice(0,190))}</p>
      <div class="fed-row fed-between"><span class="fed-badge">${icon('users')} ${esc(row.membership?.role||'Federación')}</span>${button('Ver comunidad',`fed-open-${f.id}`,'primary')}</div>`);
  }
  function attachOpenButtons(){bind('[id^="fed-open-"]',event=>openFederation(Number(event.currentTarget.id.split('-').pop())));}
  async function mine(){menu('mine');activeId=null;
    const rows=await api('/mine');root.innerHTML=hero('Tu comunidad','Mis Federaciones','Tus comunidades, tus torneos y tu progreso dentro de AnkaraGOAT.')+
      `<div class="fed-row fed-between">${title('Federaciones a las que pertenecés')}${button('+ Crear Federación','mine-create','primary')}</div>`+
      (rows.length?`<div class="fed-grid">${rows.map(fedCard).join('')}</div>`:empty('Todavía no pertenecés a ninguna Federación. Explorá las comunidades o creá una.'));
    attachOpenButtons();bind('#mine-create',createForm);
  }
  async function explore(){menu('explore');activeId=null;
    const rows=await api('/public');root.innerHTML=hero('Descubrí','Explorar Federaciones','Encontrá comunidades públicas, conocé sus temáticas y solicitá tu ingreso.')+
      (rows.length?`<div class="fed-grid">${rows.map(fedCard).join('')}</div>`:empty('Todavía no hay Federaciones públicas.'));
    attachOpenButtons();
  }
  function createForm(){menu('create');activeId=null;
    root.innerHTML=hero('Nueva comunidad','Fundar una Federación','Elegí una identidad, las reglas de acceso y hasta cinco categorías de conocimiento.')+
      card(`<form id="createFederation" class="fed-form fed-compact">
        <label>Nombre<input name="name" required minlength="3" maxlength="100" placeholder="Ej.: Historia del ascenso argentino"></label>
        <label>Descripción<textarea name="description" maxlength="3000" placeholder="¿Qué reúne a esta comunidad?"></textarea></label>
        <label>Categorías (separadas por coma, máximo cinco)<input name="categories" required placeholder="Ascenso argentino, Mundiales, Primera División"></label>
        <div class="fed-cols"><label>URL del escudo (opcional)<input name="crestUrl" type="url" placeholder="https://..."></label><label>URL del banner (opcional)<input name="bannerUrl" type="url" placeholder="https://..."></label></div>
        <label class="fed-check"><input type="checkbox" name="isPublic" checked> Federación pública</label>
        <label class="fed-check"><input type="checkbox" name="requiresApproval"> Exigir aprobación para ingresar</label>
        <p class="fed-help">Después de crearla, el Presidente podrá cargar escudo y banner como archivos. Capacidad máxima: 2.000 miembros.</p>
        <button class="fed-button primary">${icon('shield-check')} Crear Federación</button></form>`);
    bind('#createFederation',async event=>{
      const f=formData(event.currentTarget);const created=await api('/','POST',{name:f.name,description:f.description,
        categories:f.categories.split(',').map(s=>s.trim()).filter(Boolean),isPublic:!!f.isPublic,
        requiresApproval:!!f.requiresApproval,crestUrl:f.crestUrl||null,bannerUrl:f.bannerUrl||null});
      toast('¡Federación creada! Ya sos El Presi.');await openFederation(created.id);
    },'submit');
  }
  const tabs=[['home','Inicio','home'],['members','Federados','users'],['knowledge','Conocimiento','book'],['questions','Preguntas + IA','question'],
    ['tournaments','Torneos','trophy'],['ranking','Ranking','chart-histogram'],
    ['achievements','Palmarés y récords','medal'],['statistics','Estadísticas','chart-pie'],['challenges','Desafíos','flag'],['settings','Manifiesto / ajustes','settings']];
  async function openFederation(id,tab='home'){
    detail=await api(`/${id}`);activeId=id;activeTab=tab;menu('');
    const f=detail.federation;
    root.innerHTML=`<div class="fed-banner">
      ${img(f.crestUrl,'fed-crest')}<div><div class="fed-eyebrow">${detail.role?esc(detail.role):'Federación pública'}</div><div class="fed-title">${esc(f.name)}</div></div>
      ${detail.role==='president'&&f.bannerUrl?`<div class="fed-banner-controls">
        <button type="button" class="fed-button fed-banner-edit" id="fedBannerEdit">↕ Reubicar banner</button>
        <div class="fed-banner-editor" id="fedBannerEditor" hidden>
          <span class="fed-banner-hint">Arrastrá la imagen para ajustar el encuadre</span>
          <button type="button" class="fed-button primary" id="fedBannerSave">Guardar</button>
          <button type="button" class="fed-button" id="fedBannerCancel">Cancelar</button>
        </div></div>`:''}</div>
      <div class="fed-row fed-between"><p class="fed-muted">${esc(f.description||'Bienvenido a esta Federación.')}</p><span class="fed-badge">${fmt(detail.memberCount)} / 2.000 federados</span><a href="/federaciones.html?slug=${encodeURIComponent(f.slug)}" title="Enlace público de la Federación">Compartir</a></div>
      ${f.status!=='active'?`<div class="fed-card"><strong>Federación ${esc(f.status)}</strong><p>Las acciones competitivas están pausadas por inactividad.${f.status==='suspended'&&detail.role==='president'?' Podés reactivarla para volver a competir.':''}</p>${f.status==='suspended'&&detail.role==='president'?button('Reactivar Federación','reactivateFederation','primary'):''}</div>`:''}
      <nav class="fed-tabs" role="tablist" aria-label="Secciones de la Federación">${tabs.map(([key,label,ico])=>`<button type="button" role="tab" data-tab="${key}" title="${esc(label)}" aria-label="${esc(label)}" aria-selected="${tab===key}" class="${tab===key?'active':''}">${icon(ico)}<span class="fed-tab-name">${esc(label)}</span></button>`).join('')}</nav>
      <div id="fedTabContent"></div>`;
    setupFederationBanner(f);
    bind('#reactivateFederation',async()=>{await api(`/${id}/reactivate`,'POST',{});toast('Federación reactivada.');await openFederation(id,tab);});
    bind('[data-tab]',event=>openFederation(id,event.currentTarget.dataset.tab));
    await renderTab(tab);
  }
  function setupFederationBanner(f){
    const banner=root.querySelector('.fed-banner');
    if(!banner||!f.bannerUrl)return;
    banner.style.backgroundImage=`linear-gradient(#09201677,#09201699),url(${JSON.stringify(f.bannerUrl)})`;
    const stored={x:bannerPercent(f.bannerPositionX),y:bannerPercent(f.bannerPositionY)};
    let x=stored.x,y=stored.y,editing=false,drag=null;
    const paint=()=>{banner.style.backgroundPosition=`center, ${x}% ${y}%`;};
    paint();
    const edit=banner.querySelector('#fedBannerEdit');
    const panel=banner.querySelector('#fedBannerEditor');
    if(!edit||!panel)return;
    const image=new Image();
    image.src=f.bannerUrl;
    const setEditing=value=>{
      editing=value;drag=null;banner.classList.toggle('is-repositioning',value);
      edit.hidden=value;panel.hidden=!value;
    };
    edit.addEventListener('click',()=>setEditing(true));
    banner.querySelector('#fedBannerCancel').addEventListener('click',()=>{
      x=stored.x;y=stored.y;paint();setEditing(false);
    });
    banner.querySelector('#fedBannerSave').addEventListener('click',invoke(async event=>{
      const save=event.currentTarget;save.disabled=true;
      try{
        const result=await api(`/${activeId}/banner-position`,'PUT',{positionX:x,positionY:y});
        stored.x=bannerPercent(result.bannerPositionX);stored.y=bannerPercent(result.bannerPositionY);
        x=stored.x;y=stored.y;paint();
        f.bannerPositionX=x;f.bannerPositionY=y;
        setEditing(false);toast('Posición del banner guardada.');
      }finally{save.disabled=false;}
    }));
    banner.addEventListener('pointerdown',event=>{
      if(!editing||event.target.closest('.fed-banner-controls')||event.button!==0)return;
      const rect=banner.getBoundingClientRect();
      const ratio=image.naturalWidth>0&&image.naturalHeight>0?
        Math.max(rect.width/image.naturalWidth,rect.height/image.naturalHeight):0;
      // El porcentaje CSS se mueve en dirección opuesta a la imagen recortada.
      const overX=ratio?Math.max(0,image.naturalWidth*ratio-rect.width):rect.width;
      const overY=ratio?Math.max(0,image.naturalHeight*ratio-rect.height):rect.height;
      drag={id:event.pointerId,clientX:event.clientX,clientY:event.clientY,x,y,overX,overY};
      banner.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    banner.addEventListener('pointermove',event=>{
      if(!drag||event.pointerId!==drag.id||!editing)return;
      const clamp=value=>Math.max(0,Math.min(100,Math.round(value*10)/10));
      x=drag.overX>1?clamp(drag.x-(event.clientX-drag.clientX)*100/drag.overX):drag.x;
      y=drag.overY>1?clamp(drag.y-(event.clientY-drag.clientY)*100/drag.overY):drag.y;
      paint();
      event.preventDefault();
    });
    for(const name of ['pointerup','pointercancel','lostpointercapture'])banner.addEventListener(name,event=>{
      if(drag&&event.pointerId===drag.id)drag=null;
    });
  }
  const mount=()=>document.querySelector('#fedTabContent')||root;
  const isPresi=()=>detail?.role==='president';
  const can=permission=>isPresi()||detail?.role==='secretary'&&detail.permissions?.[permission]===true;
  function sections(...values){mount().innerHTML=values.join('');}
  function fedMatchStage(stage){const x=String(stage||'').toLowerCase();return ['group','league','shared_league'].includes(x)?'stage-group':x.includes('16')?'stage-round16':x.includes('quarter')?'stage-quarter':x.includes('semi')?'stage-semi':x==='final'?'stage-final':'stage-other';}
  function shortRow(title,subtitle,controls='',extraClass=''){return `<div class="fed-item ${extraClass}"><div><strong>${esc(title)}</strong><small>${esc(subtitle)}</small></div>${controls}</div>`;}
  // Agrupar todos los controles del federado al extremo derecho de su tarjeta.
  function memberAction(label,iconName,id,tone){
    return `<button type="button" class="fed-button fed-member-action fed-member-action-${tone}" id="${id}">${icon(iconName)}<span>${esc(label)}</span></button>`;
  }
  function memberControls(member){
    const userId=Number(member.user.id);
    const isSelf=userId===Number(detail.viewerId);
    return `<div class="fed-member-actions" role="group" aria-label="Acciones de ${esc(member.user.username||'federado')}">`+
      memberAction('Logros','medal','member-achievements-'+userId,'achievements')+
      (detail.role&&!isSelf?memberAction('Retar','swords','member-challenge-'+userId,'challenge'):'')+
      (isPresi()&&member.role!=='president'?memberAction('Alternar Secretario','users','member-role-'+userId,'role')+
        (member.role==='secretary'?memberAction('Permisos','settings','member-perms-'+userId,'permissions'):''):'')+
      '</div>';
  }
  async function renderTab(tab){
    const fed=detail.federation;
    if(tab==='home'){
      sections(hero('Bienvenidos',fed.name,'Estudiá con el banco de conocimiento, participá en las competiciones y construí el prestigio de esta comunidad.'),
        `<div class="fed-kpis fed-home-kpis"><div class="fed-kpi fed-kpi-members"><span class="fed-kpi-icon">${icon('users')}</span><span class="fed-kpi-label">Federados</span><b class="fed-kpi-value">${fmt(detail.memberCount)}</b></div><div class="fed-kpi fed-kpi-tournaments"><span class="fed-kpi-icon">${icon('trophy')}</span><span class="fed-kpi-label">Torneos</span><b class="fed-kpi-value">${detail.tournaments.length}</b></div><div class="fed-kpi fed-kpi-categories"><span class="fed-kpi-icon">${icon('book')}</span><span class="fed-kpi-label">Temáticas</span><b class="fed-kpi-value">${fed.categories.length}</b></div></div>`,
        title('Categorías temáticas'),`<div class="fed-row">${fed.categories.map(c=>`<span class="fed-badge">${esc(c)}</span>`).join('')}</div>`,
        title('Próximos torneos'),detail.tournaments.length?`<div class="fed-list">${detail.tournaments.slice(0,6).map(t=>shortRow(t.name,`Temporada ${Number(t.seasonNumber||1)} · ${t.format} · ${t.boardSize} casilleros · ${t.status}`,button('Ver','go-tournament-'+t.id))).join('')}</div>`:empty('Todavía no se organizaron torneos.'),
        !detail.role?`<div class="fed-section">${button('Solicitar ingreso','join-fed','primary')}</div>`:'');
      bind('#join-fed',async()=>{const code=detail.federation.isPublic?'':(prompt('Ingresá el código de invitación de la Federación privada:')||'');const result=await api(`/${activeId}/join`,'POST',{inviteCode:code});toast(result.status==='pending'?'Solicitud enviada al Presidente.':'¡Ya sos federado!');await openFederation(activeId);});
      bind('[id^="go-tournament-"]',event=>location.href=`/?tournament=${Number(event.currentTarget.id.split('-').pop())}`);
      await renderFeed(true);
    }
    else if(tab==='members')await renderMembers();
    else if(tab==='knowledge')await renderKnowledge();
    else if(tab==='questions')await renderQuestions();
    else if(tab==='tournaments')await renderTournaments();
    else if(tab==='ranking')await renderIndividualRanking();
    else if(tab==='achievements')await renderAchievements();
    else if(tab==='statistics')await renderStatistics();
    else if(tab==='challenges')await renderChallenges();
    else if(tab==='settings')await renderSettings();
  }
  async function renderMembers(q=''){
    const data=await api(`/${activeId}/members?q=${encodeURIComponent(q)}`);
    sections(`${title('Federados')}<nav class="fed-subtabs" aria-label="Federados y logros individuales"><button type="button" id="fedMemberList" class="active">${icon('users')} Federados</button>${detail.role?`<button type="button" id="fedMyAchievements">${icon('medal')} Mis logros</button><button type="button" id="fedFriendlies">${icon('swords')} Amistosos</button>`:''}</nav><div class="fed-row fed-member-search"><input class="fed-filter" id="memberSearch" placeholder="Buscar por nombre" value="${esc(q)}"></div>`,
      `<div class="fed-list">${data.members.map(m=>shortRow(m.user?.username||'Federado',`${m.role} · desde ${date(m.joinedAt)}`,memberControls(m),'fed-member-item')).join('')}</div>`,
      `<p class="fed-help">${fmt(data.total)} miembros activos. Los Secretarios pueden recibir permisos específicos.</p>`,
      can('members')?`${title('Solicitudes pendientes')}<div id="memberPending" class="fed-list">Consultando solicitudes…</div>`:'');
    bind('#memberSearch',event=>renderMembers(event.currentTarget.value),'change');
    bind('#fedMyAchievements',()=>renderMemberAchievements(null,'Mis logros'));
    bind('#fedFriendlies',()=>renderFriendlies());
    bind('[id^="member-challenge-"]',event=>renderFriendlies(Number(event.currentTarget.id.split('-').pop())));
    bind('[id^="member-achievements-"]',event=>{const id=Number(event.currentTarget.id.split('-').pop());const member=data.members.find(m=>Number(m.user.id)===id);return renderMemberAchievements(id,member?.user?.username||'Federado');});
    bind('[id^="member-role-"]',async event=>{
      const userId=Number(event.currentTarget.id.split('-').pop());const m=data.members.find(row=>Number(row.user.id)===userId);
      await api(`/${activeId}/members/${userId}`,'PATCH',{role:m.role==='secretary'?'member':'secretary',
        ...(m.role!=='secretary'?{permissions:{knowledge:true,questions:true,tournaments:true,feed:true}}:{})});
      toast('Rol actualizado.');await renderMembers(q);
    });
    bind('[id^="member-perms-"]',async event=>{
      const userId=Number(event.currentTarget.id.split('-').pop()),member=data.members.find(m=>Number(m.user.id)===userId);
      const fields=['members','knowledge','questions','tournaments','feed'];
      const box=document.createElement('div');box.className='fed-card';
      box.innerHTML=`<h3>Permisos de ${esc(member.user.username)}</h3><form id="secretaryPermissions" class="fed-form">${fields.map(key=>`<label class="fed-check"><input type="checkbox" name="${key}" ${member.permissions?.[key]?'checked':''}> ${esc(key)}</label>`).join('')}<button class="fed-button primary">Guardar permisos</button></form>`;
      mount().appendChild(box);
      box.querySelector('form').addEventListener('submit',invoke(async ev=>{
        const selected=formData(ev.currentTarget),permissions=Object.fromEntries(fields.map(key=>[key,Boolean(selected[key])]));
        await api(`/${activeId}/members/${userId}`,'PATCH',{permissions});toast('Permisos actualizados.');await renderMembers(q);
      }));
      box.scrollIntoView({behavior:'smooth',block:'nearest'});
    });
    if(can('members')){
      const pending=await api(`/${activeId}/members?pending=1`);
      const target=document.querySelector('#memberPending');
      if(target)target.innerHTML=(pending.members||[]).length?pending.members.map(m=>shortRow(m.user.username,'Ingreso pendiente',button('Aprobar','approve-'+m.user.id,'primary'))).join(''):empty('No hay solicitudes pendientes.');
      bind('[id^="approve-"]',async event=>{await api(`/${activeId}/members/${event.currentTarget.id.split('-').pop()}`,'PATCH',{status:'active'});toast('Ingreso aprobado.');await renderMembers(q);});
    }
  }
  async function renderFriendlies(preselectUserId=0){
    const [rooms,membersResponse]=await Promise.all([
      api(`/${activeId}/friendlies`),api(`/${activeId}/members`)
    ]);
    const members=(membersResponse.members||[]).filter(m=>Number(m.user?.id)!==Number(detail.viewerId));
    const selected=Number(preselectUserId)||0;
    const categories=detail.federation.categories||[];
    const available=rooms.filter(room=>!room.published&&room.targeted);
    const roomCard=room=>`<article class="fed-item fed-friendly-room">
      <div class="fed-friendly-info"><strong>${esc(room.name)}</strong><small>${esc(room.category)} · ${room.players.length}/${room.maxPlayers} jugadores</small>
        <span class="fed-friendly-code">Código: <b>${esc(room.roomCode)}</b> ${room.targeted?'<span class="fed-badge">Te retaron</span>':''}</span></div>
      <div class="fed-actions"><a class="fed-button primary" href="/?room=${encodeURIComponent(room.roomCode)}">${icon('play')} Entrar</a>
        <button class="fed-button ghost" type="button" data-copy-friendly="${esc(room.roomCode)}">${icon('copy')} Copiar código</button>
        ${Number(room.organizerId)===Number(detail.viewerId)&&!room.published?`<button class="fed-button ghost" type="button" data-publish-friendly="${room.id}">${icon('megaphone')} Publicar en feed</button>`:''}
        ${room.published?'<span class="fed-badge">Publicado en el feed</span>':''}</div>
    </article>`;
    sections(`${title('Partidos amistosos')}<nav class="fed-subtabs" aria-label="Federados y amistosos"><button id="backFromFriendlies" type="button">${icon('users')} Federados</button><button class="active" type="button" aria-current="page">${icon('swords')} Amistosos</button></nav>`,
      card(`<h3>${selected?'Retar a un federado':'Crear un amistoso'}</h3>
        <p class="fed-help">Elegí una categoría de la Federación. La sala admite de 2 a 8 federados, con las reglas normales de AnkaraGOAT.</p>
        <form class="fed-form" id="fedFriendlyForm">
          <label>Nombre del amistoso<input name="name" required minlength="3" maxlength="100" value="${esc(`Amistoso de ${detail.federation.name}`.slice(0,100))}"></label>
          <label>Categoría temática<select name="category" required>${categories.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></label>
          <label>Retar directamente a otros federados (opcional, hasta 7)</label>
          <div class="fed-friendly-invites" role="group" aria-label="Invitar federados">${members.length?members.map(m=>`<label class="fed-friendly-invite"><input type="checkbox" name="targetUserIds" value="${Number(m.user.id)}" ${selected===Number(m.user.id)?'checked':''}><span>${esc(m.user.username)}</span></label>`).join(''):'<p class="fed-help">Podés compartir el código o publicar la invitación en el feed.</p>'}</div>
          <div class="fed-cols"><label>Casilleros (30–70)<select name="boardSize">${Array.from({length:41},(_,i)=>i+30).map(n=>`<option value="${n}" ${n===40?'selected':''}>${n}</option>`).join('')}</select></label>
          <label>Cupo total (2–8)<select name="maxPlayers">${Array.from({length:7},(_,i)=>i+2).map(n=>`<option value="${n}" ${n===8?'selected':''}>${n}</option>`).join('')}</select></label></div>
          <div class="fed-cols"><label>Dificultad de preguntas<select name="questionMode"><option value="ankara">Ankara (equilibrado)</option><option value="casual">Casual</option><option value="futbolero">Futbolero</option><option value="enfermo">Enfermo</option></select></label>
          <label>Casilleros especiales<select name="specialCellPercent">${[20,25,30,35].map(n=>`<option value="${n}" ${n===25?'selected':''}>${n}%</option>`).join('')}</select></label></div>
          <button class="fed-button primary" type="submit">${icon('swords')} Crear sala amistosa</button>
        </form>`),
      available.length?`${title('Desafíos para vos')}<div class="fed-list">${available.map(roomCard).join('')}</div>`:'',
      title('Salas amistosas disponibles'),`<div class="fed-list">${rooms.length?rooms.filter(r=>!available.includes(r)).map(roomCard).join(''):empty('Todavía no hay amistosos esperando jugadores. Creá uno y publicá la invitación en el feed.')}</div>`);
    bind('#backFromFriendlies',()=>renderMembers());
    bind('#fedFriendlyForm',async event=>{
      const form=formData(event.currentTarget);
      const payload={name:form.name,category:form.category,boardSize:Number(form.boardSize),
        maxPlayers:Number(form.maxPlayers),specialCellPercent:Number(form.specialCellPercent),questionMode:form.questionMode,
        targetUserIds:new FormData(event.currentTarget).getAll('targetUserIds').map(Number)};
      const created=await api(`/${activeId}/friendlies`,'POST',payload);
      toast(`Sala ${created.roomCode} creada. Podés invitar con el código o publicarla en el feed.`);
      await renderFriendlies();
    },'submit');
    bind('[data-copy-friendly]',async event=>{
      const code=event.currentTarget.dataset.copyFriendly;
      try{await navigator.clipboard.writeText(code);toast('Código copiado: '+code);}
      catch{prompt('Copiá el código de la sala:',code);}
    });
    bind('[data-publish-friendly]',async event=>{
      await api(`/${activeId}/friendlies/${Number(event.currentTarget.dataset.publishFriendly)}/publish`,'POST',{});
      toast('Invitación publicada en el feed de la Federación.');await renderFriendlies();
    });
  }

  async function renderMemberAchievements(userId,username){
    // Los logros se consultan por usuario, sin mezclar los de toda la Federación.
    const rows=await api(`/${activeId}/achievements${userId?`?userId=${encodeURIComponent(userId)}`:'/mine'}`);
    const icons={victories:'trophy',correct_answers:'target',streaks:'flame'};
    sections(title(userId?`Logros de ${username}`:'Mis logros federativos'),`<nav class="fed-subtabs" aria-label="Secciones de federados"><button type="button" id="backToFederates">${icon('arrow-left')} Volver a Federados</button><button type="button" class="active" aria-current="page">${icon('medal')} Logros individuales</button></nav>`,
      `<div class="fed-grid">${rows.length?rows.map(a=>card(`<div class="fed-achievement fed-achievement-${esc(a.family||'victories')}"><span class="fed-icon">${icon(icons[a.family]||'trophy')}</span><div><h3>${esc(String(a.code||'').replaceAll('_',' '))}</h3><small>${date(a.awardedAt)}</small></div></div>`)).join(''):empty('Este federado todavía no consiguió logros en esta comunidad.')}</div>`);
    bind('#backToFederates',()=>renderMembers());
  }
  async function renderKnowledge(){
    const rows=await api(`/${activeId}/knowledge`);
    sections(title('Banco de conocimiento'),`<div class="fed-list">${rows.length?rows.map(row=>shortRow(row.title,`${row.category||'General'} · v${row.version}${row.tournamentId?' · Torneo '+row.tournamentId:''}`,
      `<a class="fed-button ghost" href="${esc(row.url)}" target="_blank" rel="noopener noreferrer">Abrir material</a>`)).join(''):empty('Aún no se compartieron enlaces de estudio.')}</div>`,
      can('knowledge')?`${title('Agregar un enlace')}${card(`<form id="knowledgeForm" class="fed-form">
        <label>Título<input name="title" required maxlength="180"></label><label>URL<input name="url" type="url" required placeholder="https://..."></label>
        <label>Categoría<select name="category"><option value="">General</option>${detail.federation.categories.map(c=>`<option>${esc(c)}</option>`).join('')}</select></label>
        <label>Torneo asociado (opcional)<select name="tournamentId"><option value="">Banco general</option>${detail.tournaments.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>
        <button class="fed-button primary">Publicar recurso</button></form>`)}`:'');
    bind('#knowledgeForm',async event=>{const f=formData(event.currentTarget);await api(`/${activeId}/knowledge`,'POST',f);toast('Material agregado.');await renderKnowledge();},'submit');
  }
  // Formulario explícito: nunca se pide al usuario que modifique la estructura JSON.
  function questionFields(q={}){
    const media=q.questionMedia||{},options=Array.isArray(q.options)?q.options:[];
    const categoryValues=q.options?.categories||[];
    const items=q.options?.items||[];
    const pairs=items.map(item=>`${item} | ${q.correctAnswer?.[item]||''}`).join('\n');
    const type=q.type||'multiple_choice';
    const correctIndex=Math.max(0,options.findIndex(o=>String(o)===String(q.correctAnswer)));
    const imageView=url=>url?`<img src="${esc(url)}" alt="Imagen actual" loading="lazy" class="fed-question-image-preview">`:'';
    return `<div class="fed-form fed-question-fields">
      <div class="fed-cols"><label>Tipo de pregunta<select name="type"><option value="multiple_choice" ${type==='multiple_choice'?'selected':''}>Opción múltiple</option><option value="categorization" ${type==='categorization'?'selected':''}>Categorización</option></select></label>
      <label>Temática<select name="category">${detail.federation.categories.map(c=>`<option value="${esc(c)}" ${q.category===c?'selected':''}>${esc(c)}</option>`).join('')}</select></label></div>
      <label>Enunciado de la pregunta<textarea name="prompt" maxlength="500" minlength="4" rows="3" required>${esc(q.prompt||'')}</textarea></label>
      <label>Imagen del enunciado (opcional, JPG/PNG/WebP, máximo 2 MB)<input type="file" name="promptImage" accept="image/png,image/jpeg,image/webp">${imageView(media.promptImageUrl)}</label>
      ${media.promptImageUrl?`<label class="fed-check"><input type="checkbox" name="removePromptImage"> Quitar imagen del enunciado</label>`:''}
      <div class="fed-multiple-fields" ${type==='categorization'?'hidden':''}>
        <p class="fed-help">Escribí las respuestas o agregá una imagen por opción; elegí cuál es correcta. El texto es opcional si hay imagen.</p>
        ${Array.from({length:4},(_,i)=>`<div class="fed-answer-row"><label>Opción ${i+1}<input name="option${i}" value="${esc(options[i]||'')}" maxlength="300"></label><label>Imagen (opcional)<input type="file" accept="image/png,image/jpeg,image/webp" name="optionImage${i}">${imageView(media.optionImageUrls?.[i])}</label>${media.optionImageUrls?.[i]?`<label class="fed-check"><input type="checkbox" name="removeOption${i}"> Quitar imagen</label>`:''}</div>`).join('')}
        <label>Respuesta correcta<select name="correctIndex">${Array.from({length:4},(_,i)=>`<option value="${i}" ${correctIndex===i?'selected':''}>Opción ${i+1}</option>`).join('')}</select></label>
      </div>
      <div class="fed-category-fields" ${type!=='categorization'?'hidden':''}>
        <label>Categorías posibles (una por línea)<textarea name="categories" rows="4" placeholder="Arquero&#10;Defensor">${esc(categoryValues.join('\n'))}</textarea></label>
        <label>Elementos y categoría correcta (una línea por elemento: elemento | categoría)<textarea name="itemPairs" rows="6" placeholder="Jugador A | Arquero&#10;Jugador B | Defensor">${esc(pairs)}</textarea></label>
        <button class="fed-button ghost" type="button" data-build-item-images>Configurar imágenes de los elementos</button>
        <div class="fed-item-image-fields"></div>
        <p class="fed-help">Cada elemento puede mostrar una imagen junto a su nombre.</p>
      </div>
      <div class="fed-cols"><label>Competición<input name="competition" value="${esc(q.competition||'')}" maxlength="80"></label><label>Área de conocimiento<input name="knowledgeArea" value="${esc(q.knowledgeArea||'')}" maxlength="100"></label></div>
      <div class="fed-cols"><label>Nivel de preguntas<select name="tier">${[1,2,3].map(t=>`<option value="${t}" ${Number(q.tier||2)===t?'selected':''}>Tier ${t}</option>`).join('')}</select></label><label>Dificultad<select name="difficulty">${[1,2,3,4,5].map(n=>`<option value="${n}" ${Number(q.difficulty||2)===n?'selected':''}>${n}</option>`).join('')}</select></label></div>
      </div>`;
  }
  function questionPairs(text){
    const pairs=String(text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(line=>{
      const pos=line.lastIndexOf('|');
      if(pos<1)throw new Error('En categorización usá "Elemento | Categoría" en cada línea.');
      return [line.slice(0,pos).trim(),line.slice(pos+1).trim()];
    });
    return pairs;
  }
  function wireQuestionFields(form,q={}){
    const update=()=>{
      const cat=form.elements.namedItem('type').value==='categorization';
      form.querySelector('.fed-multiple-fields').hidden=cat;
      form.querySelector('.fed-category-fields').hidden=!cat;
    };
    form.elements.namedItem('type').addEventListener('change',update);update();
    const itemsRoot=form.querySelector('.fed-item-image-fields');
    const media=q.questionMedia||{};
    const buildItems=()=>{
      const items=questionPairs(form.elements.namedItem('itemPairs').value);
      itemsRoot.innerHTML=items.map(([item],i)=>`<label>${esc(item)} · Imagen opcional<input type="file" accept="image/png,image/jpeg,image/webp" data-item-index="${i}">${media.itemImageUrls?.[item]?`<img class="fed-question-image-preview" src="${esc(media.itemImageUrls[item])}" alt="">`:''}</label>`).join('');
    };
    form.querySelector('[data-build-item-images]').addEventListener('click',()=>{try{buildItems()}catch(e){toast(e.message)}});
    if(q.type==='categorization')buildItems();
  }
  async function uploadQuestionImage(file){
    if(file.size>2*1024*1024)throw new Error('Las imágenes deben pesar hasta 2 MB.');
    const data=new FormData();data.append('image',file);
    const res=await fetch(`/api/federations/${activeId}/questions/media`,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:data});
    const result=await res.json().catch(()=>({}));if(!res.ok)throw new Error(result.error||'No se pudo subir la imagen.');
    return result.url;
  }
  async function questionPayload(form,q={}){
    const f=formData(form),type=f.type;
    const media={promptImageUrl:q.questionMedia?.promptImageUrl||null,
      optionImageUrls:[...(q.questionMedia?.optionImageUrls||[null,null,null,null])],itemImageUrls:{...(q.questionMedia?.itemImageUrls||{})}};
    if(f.removePromptImage)media.promptImageUrl=null;
    const promptFile=form.elements.namedItem('promptImage').files?.[0];
    if(promptFile)media.promptImageUrl=await uploadQuestionImage(promptFile);
    let options,correctAnswer;
    if(type==='multiple_choice'){
      options=Array.from({length:4},(_,i)=>String(f[`option${i}`]||'').trim());
      const index=Number(f.correctIndex);
      for(let i=0;i<4;i++){
        const image=form.elements.namedItem(`optionImage${i}`).files?.[0];
        if(!options[i]&&(image||(media.optionImageUrls[i]&&!f[`removeOption${i}`])))options[i]=`Imagen ${i+1}`;
      }
      if(options.some(o=>!o)||new Set(options.map(o=>o.toLowerCase())).size!==4)throw new Error('Cada opción necesita texto o una imagen; las respuestas deben ser diferentes.');
      correctAnswer=options[index];
      for(let i=0;i<4;i++){
        if(f[`removeOption${i}`])media.optionImageUrls[i]=null;
        const image=form.elements.namedItem(`optionImage${i}`).files?.[0];
        if(image)media.optionImageUrls[i]=await uploadQuestionImage(image);
      }
      media.itemImageUrls={};
    }else{
      const categories=String(f.categories||'').split(/\r?\n/).map(c=>c.trim()).filter(Boolean);
      const pairs=questionPairs(f.itemPairs);
      if(!categories.length||!pairs.length)throw new Error('La categorización requiere categorías y elementos.');
      for(const [item,category] of pairs){if(!categories.includes(category))throw new Error(`La categoría de "${item}" no coincide con las categorías definidas.`);}
      options={categories,items:pairs.map(row=>row[0])};correctAnswer=Object.fromEntries(pairs);
      media.optionImageUrls=[null,null,null,null];
      const itemImages={};
      for(const [index,[item]] of pairs.entries()){
        const input=form.querySelector(`[data-item-index="${index}"]`);
        const file=input?.files?.[0];
        itemImages[item]=file?await uploadQuestionImage(file):media.itemImageUrls[item]||null;
      }
      media.itemImageUrls=itemImages;
    }
    return {type,prompt:f.prompt,options,correctAnswer,category:f.category,competition:f.competition,
      knowledgeArea:f.knowledgeArea,tier:Number(f.tier),difficulty:Number(f.difficulty),questionMedia:media};
  }
  async function renderQuestions(){
    if(!detail.role){sections(empty('Ingresá a la Federación para estudiar su banco de preguntas.'));return;}
    const rows=await api(`/${activeId}/questions`);
    const managed=can('questions'),approved=rows.filter(q=>q.reviewStatus==='published'&&q.active);
    const pending=rows.filter(q=>q.reviewStatus!=='published'||!q.active);
    const viewQuestion=(q)=>shortRow(q.prompt,`${q.category||'General'} · Tier ${q.tier} · ${q.reviewStatus}`,
      managed?`<span class="fed-actions">${isPresi()&&q.reviewStatus==='review'?button(`${icon('check')} Aprobar`,'question-approve-'+q.id,'primary'):''}${button(`${icon('pencil')} Editar`,'question-edit-'+q.id)}${button(`${icon('trash')} Eliminar`,'question-delete-'+q.id,'danger')}</span>`:'');
    const optionCounts=Array.from({length:501},(_,i)=>`<option value="${i}">${i}</option>`).join('');
    const createContent=managed?`${card(`<h3>Crear pregunta con imágenes (opcional)</h3><form id="manualQuestionForm" class="fed-form">${questionFields()}<button class="fed-button primary">${icon('plus')} Enviar pregunta a revisión</button></form>`)}${card(`<h3>Generador de prompt para IA</h3><form id="promptForm" class="fed-form">
      <label>Temática<select name="category">${detail.federation.categories.map(c=>`<option>${esc(c)}</option>`).join('')}</select></label>
      <div class="fed-cols fed-cols-three">
        <label>Fáciles · Tier 1<select name="easy">${optionCounts}</select></label>
        <label>Medias · Tier 2<select name="medium">${optionCounts}</select></label>
        <label>Difíciles · Tier 3<select name="hard">${optionCounts}</select></label>
      </div><p class="fed-help" id="tierTotal">Total: 100 preguntas (máximo 500).</p><button class="fed-button">${icon('magic-wand')} Generar prompt compatible</button>
      </form><label class="fed-prompt-label" for="promptOutput">Prompt editable</label><textarea id="promptOutput" class="fed-prompt-editor" rows="8" placeholder="Generá el prompt y editá el texto directamente acá."></textarea><button id="copyPrompt" class="fed-button ghost">${icon('copy')} Copiar prompt</button>`) }
      ${title('Importar JSON con validación')}${card(`<form id="importQuestions" class="fed-form"><label>Pegá el array JSON<textarea name="json" rows="9" placeholder='[{"type":"multiple_choice", "prompt":"..."}]' required></textarea></label><button class="fed-button primary">Validar e importar para revisión</button></form><p class="fed-help">Hasta 500 preguntas por lote. El Presidente debe aprobarlas antes de que se usen en partidas.</p>`)}`:empty('Los miembros pueden estudiar las preguntas aprobadas, pero no generar ni revisar preguntas.');
    sections(title('Preguntas + IA'),subtab('data-qtab',[['approved','Aprobadas','check-circle'],['pending','Pendientes','time-past'],['create','Crear / IA','magic-wand']]),
      subpanel('data-qtab','approved',`<div class="fed-list">${approved.length?approved.map(viewQuestion).join(''):empty('Todavía no hay preguntas aprobadas.')}</div>`,true),
      subpanel('data-qtab','pending',`<div class="fed-list">${pending.length?pending.map(viewQuestion).join(''):empty('No hay preguntas pendientes.')}</div>`),
      subpanel('data-qtab','create',createContent));
    wireSubtabs('data-qtab');
    if(managed){
      const manual=root.querySelector('#manualQuestionForm');
      if(manual){wireQuestionFields(manual);manual.addEventListener('submit',invoke(async e=>{
        const payload=await questionPayload(e.currentTarget);await api(`/${activeId}/questions`,'POST',payload);
        toast('Pregunta creada y enviada a revisión.');await renderQuestions();
      }));}
      const promptForm=root.querySelector('#promptForm');
      if(promptForm){
        for(const [name,value] of [['easy','35'],['medium','35'],['hard','30']])promptForm.elements.namedItem(name).value=value;
        const updateTotal=()=>{const f=formData(promptForm);const count=['easy','medium','hard'].reduce((n,k)=>n+Number(f[k]||0),0);root.querySelector('#tierTotal').textContent=`Total: ${count} preguntas (máximo 500).`;};
        promptForm.querySelectorAll('select').forEach(el=>el.addEventListener('change',updateTotal));
        bind('#promptForm',async event=>{const f=formData(event.currentTarget);const total=Number(f.easy)+Number(f.medium)+Number(f.hard);
          if(total<1||total>500)throw new Error('La suma debe estar entre 1 y 500 preguntas.');
          const query=new URLSearchParams({category:f.category,easy:f.easy,medium:f.medium,hard:f.hard});
          const result=await api(`/${activeId}/prompt?${query}`);root.querySelector('#promptOutput').value=result.prompt;
        },'submit');
      }
      bind('#copyPrompt',async()=>{const text=root.querySelector('#promptOutput').value;if(!text.trim())throw new Error('Primero generá o escribí un prompt.');await navigator.clipboard.writeText(text);toast('Prompt copiado.');});
      bind('#importQuestions',async event=>{const f=formData(event.currentTarget);const result=await api(`/${activeId}/questions/import`,'POST',{questions:JSON.parse(f.json)});
        toast(`${result.inserted} preguntas enviadas a revisión.`);await renderQuestions();},'submit');
      bind('[id^="question-edit-"]',event=>{
        const id=Number(event.currentTarget.id.split('-').pop());const q=rows.find(row=>Number(row.id)===id);
        root.querySelector('.fed-question-editor')?.remove();
        const editor=document.createElement('div');editor.className='fed-card fed-question-editor';
        editor.innerHTML=`<h3>Editar pregunta #${id}</h3><p class="fed-help">Editá cada campo por separado. Se conservará el historial y la pregunta volverá a revisión.</p><form class="fed-form">${questionFields(q)}<div class="fed-row"><button class="fed-button primary">Guardar versión</button><button type="button" class="fed-button ghost" id="cancelQuestionEdit">Cancelar</button></div></form>`;
        event.currentTarget.closest('.fed-item').after(editor);editor.querySelector('#cancelQuestionEdit').addEventListener('click',()=>editor.remove());
        const form=editor.querySelector('form');wireQuestionFields(form,q);
        form.addEventListener('submit',invoke(async ev=>{
          const changes=await questionPayload(ev.currentTarget,q);await api(`/${activeId}/questions/${id}`,'PATCH',changes);
          toast('Versión guardada; pendiente de nueva aprobación.');await renderQuestions();
        }));
      });
      bind('[id^="question-delete-"]',async event=>{const id=Number(event.currentTarget.id.split('-').pop());
        if(!confirm('¿Retirar esta pregunta del banco federativo? Se conservará su historial.'))return;
        await api(`/${activeId}/questions/${id}`,'DELETE');toast('Pregunta retirada del banco.');await renderQuestions();
      });
      bind('[id^="question-approve-"]',async event=>{await api(`/${activeId}/questions/${Number(event.currentTarget.id.split('-').pop())}/decision`,'POST',{approve:true});toast('Pregunta aprobada.');await renderQuestions();});
    }
  }
  async function renderTournaments(){
    const [proposals,attendances,history,rules]=detail.role?await Promise.all([
      api(`/${activeId}/proposals`),api(`/${activeId}/attendance`),api(`/${activeId}/history`),tournamentRules()
    ]):[[],[],[],null];
    const availableMatches=history.flatMap(t=>(t.Matches||[]).filter(m=>['scheduled','ready'].includes(m.status)&&(m.participants||[]).length>=2)
      .map(m=>({id:m.id,title:`${t.name} · Fecha ${m.roundNo} · ${m.stage}`,participants:m.participants})));
    sections(title('Torneos federativos'),subtab('data-ttab',[['join','Inscripción','users'],['propose','Proponer torneo','pencil'],['history','Historial','history']]),
      `<section data-panel-for="data-ttab" data-panel="join" class="fed-subpanel"><div class="fed-list">${detail.tournaments.length?detail.tournaments.map(t=>shortRow(t.name,
      `${t.federationCategory} · Temporada ${Number(t.seasonNumber||1)} · ${t.format} · ${t.status} · ${t.boardSize} casilleros`,
      detail.role?`<span class="fed-actions fed-tourney-actions">${button(`${icon('user-add')} Inscribirme`,'tourney-join-'+t.id,'join')}${button(`${icon('book-open')} Estudiar`,'tourney-study-'+t.id,'study')}${button(`${icon('arrow-up-right-from-square')} Abrir`,'tourney-open-'+t.id,'open')}</span>`:'' )).join(''):empty('Todavía no existen torneos.')}</div>`,
      `</section><section data-panel-for="data-ttab" data-panel="propose" class="fed-subpanel" hidden>`,
      detail.role?`${title('Proponer torneo')}${card(`<form id="tournamentProposal" class="fed-form">
        <label>Nombre<input name="name" required maxlength="100"></label><div class="fed-cols">
        <label>Formato<select name="format"><option value="league_1v1">Liga 1v1</option><option value="shared_board_league">Liga con tablero compartido</option><option value="cup">Copa eliminación directa</option><option value="group_knockout">Copa con liguilla</option></select></label>
        <label>Temática<select name="category">${detail.federation.categories.map(c=>`<option>${esc(c)}</option>`).join('')}</select></label>
        <label>Casilleros (30–70)<input type="number" name="boardSize" min="30" max="70" step="1" value="40"></label>
        <label>Jugadores por tablero (2–8)<input type="number" name="maxPlayers" min="2" max="8" value="8"></label>
        <label>Cupo total del torneo<input type="number" name="maxParticipants" min="4" max="64" value="4"></label></div>
        <div id="federationGroupSettings" hidden>
          <h3>Configuración de la fase de grupos</h3>
          <div class="fed-cols">
            <label>Cantidad de grupos<select name="groupCount" id="fedGroupCount"></select></label>
            <label>Participantes por grupo<select name="groupSize" id="fedGroupSize"></select></label>
            <label>Clasifican por grupo<select name="qualifiersPerGroup" id="fedQualifiers"></select></label>
            <label>Modalidad de los grupos<select name="groupMode" id="fedGroupMode"><option value="1v1">Partidas 1 contra 1</option><option value="shared">Tablero compartido</option></select></label>
          </div>
          <label id="fedGroupMatchCountField" hidden>Fechas de grupos (tablero compartido)<input name="groupMatchCount" type="number" min="3" max="10" value="3"></label>
          <p id="fedGroupSummary" class="fed-help" role="status" aria-live="polite"></p>
        </div>
        <button class="fed-button primary">Enviar propuesta</button></form>`)}`:'',
      title('Propuestas'),`<div class="fed-list">${proposals.length?proposals.map(p=>shortRow(p.payload.name,
        `${p.payload.format} · ${p.status} · ${p.payload.maxParticipants||'?'} participantes${p.payload.format==='group_knockout'?` · ${p.payload.settings?.groupCount||'?'} grupos de ${Number(p.payload.maxParticipants)/(Number(p.payload.settings?.groupCount)||1)} · clasifican ${p.payload.settings?.qualifiersPerGroup||'?'} por grupo`:''}`,
        isPresi()&&p.status==='pending'?`${button('Aprobar','proposal-approve-'+p.id,'primary')} ${button('Rechazar','proposal-reject-'+p.id)}`:'' )).join(''):empty('No hay propuestas registradas.')}</div>`,
      detail.role?title('Convocatorias, asistencia y W.O.'):'' ,
      can('tournaments')&&availableMatches.length?card(`<form id="scheduleAttendance" class="fed-form"><label>Encuentro<select name="matchId" required>${availableMatches.map(m=>`<option value="${m.id}">${esc(m.title)} · ${m.participants.length} jugadores</option>`).join('')}</select></label><label>Fecha y hora<input type="datetime-local" name="scheduledAt" required></label><button class="fed-button primary">Crear convocatoria para los jugadores del encuentro</button></form>`):'',
      detail.role?`<div class="fed-list">${attendances.length?attendances.map(a=>shortRow(`Convocatoria #${a.id} · Encuentro ${a.matchId}`,
        `${new Date(a.scheduledAt).toLocaleString('es-AR')} · ${a.presentIds.length}/${a.invitedIds.length} presentes · ${a.reprogramCount}/3 reprogramaciones · ${a.resolution?'Resuelta':'Pendiente'}`,
        a.resolution?'<span class="fed-badge">W.O. cerrado</span>':[
          a.canCheckIn?button('Estoy presente','attendance-checkin-'+a.id,'primary'):'',
          can('tournaments')?button('Reprogramar','attendance-reschedule-'+a.id):'',
          can('tournaments')?button('Resolver W.O.','attendance-resolve-'+a.id):''
        ].join(' '))).join(''):empty('No hay convocatorias programadas.')}</div>`:'',
      `</section><section data-panel-for="data-ttab" data-panel="history" class="fed-subpanel" hidden>${history.length?history.map(t=>card(`<div class="fed-row fed-between"><h3>${esc(t.name)}</h3><span class="fed-status">${esc(t.status)}</span></div><p>${esc(t.format)} · ${date(t.createdAt)}</p><div class="fed-list">${(t.Matches||[]).slice(0,20).map(m=>`<div class="fed-item fed-match-row ${fedMatchStage(m.stage)}"><div><strong>Fecha ${m.roundNo} · ${esc(m.stage)}</strong><small>${(m.participantNames||[]).map((name,i)=>`${esc(name)}${m.result?.finishOrder?.find(x=>Number(x.userId)===Number(m.participants?.[i]))?` (${m.result.finishOrder.find(x=>Number(x.userId)===Number(m.participants?.[i])).position}º)`:''}`).join(' vs ')||'Enfrentamiento pendiente'} · ${esc(m.status)}</small></div></div>`).join('')}</div>${t.shareCode?`<a class="fed-button ghost" href="/share/tournament/${encodeURIComponent(t.shareCode)}">${icon('share')} Ver página pública</a>`:''}`)).join(''):empty('Aún no hay historial competitivo.')}</section>`);
    wireSubtabs('data-ttab');
    const proposalForm=root.querySelector('#tournamentProposal');
    if(proposalForm){
      const format=proposalForm.elements.namedItem('format');
      const capacity=proposalForm.elements.namedItem('maxParticipants');
      const boardPlayers=proposalForm.elements.namedItem('maxPlayers');
      const settings=proposalForm.querySelector('#federationGroupSettings');
      const groups=proposalForm.querySelector('#fedGroupCount');
      const groupSize=proposalForm.querySelector('#fedGroupSize');
      const qualifiers=proposalForm.querySelector('#fedQualifiers');
      const groupMode=proposalForm.querySelector('#fedGroupMode');
      const groupDates=proposalForm.querySelector('#fedGroupMatchCountField');
      const summary=proposalForm.querySelector('#fedGroupSummary');
      const submit=proposalForm.querySelector('button[type="submit"],button.fed-button.primary');
      const options=(node,entries,selected)=>{
        node.innerHTML=entries.map(([value,label])=>`<option value="${value}" ${Number(value)===Number(selected)?'selected':''}>${esc(label)}</option>`).join('');
      };
      const refreshShared=()=>{
        const enabled=Number(groupSize.value)<=Number(boardPlayers.value)&&Number(groupSize.value)<=8;
        const shared=groupMode.querySelector('[value="shared"]');
        shared.disabled=!enabled;
        if(!enabled)groupMode.value='1v1';
        groupDates.hidden=groupMode.value!=='shared';
        const participants=Number(capacity.value),selectedGroupCount=Number(groups.value),selectedGroupSize=Number(groupSize.value),classified=Number(qualifiers.value);
        summary.textContent=`${selectedGroupCount} grupo${selectedGroupCount===1?'':'s'} de ${selectedGroupSize} participantes (${participants} en total). Clasifican ${classified} por grupo: ${selectedGroupCount*classified} pasan a eliminación directa.${!enabled?' El tablero compartido requiere que el límite de jugadores alcance para todo el grupo.':''}`;
      };
      const refreshGroupConfig=(preferred='groupCount')=>{
        settings.hidden=format.value!=='group_knockout';
        if(settings.hidden){submit.disabled=false;return;}
        const variants=rules.groupKnockout?.[String(Number(capacity.value))]||[];
        if(!variants.length){
          groups.innerHTML=groupSize.innerHTML=qualifiers.innerHTML='';
          summary.textContent='La Copa con liguilla admite 4 participantes o cantidades pares de 6 a 32. Ajustá el cupo total.';
          submit.disabled=true;
          return;
        }
        submit.disabled=false;
        const currentCount=Number(groups.value),currentSize=Number(groupSize.value);
        const variant=(preferred==='groupSize'?variants.find(v=>v.groupSize===currentSize):variants.find(v=>v.groupCount===currentCount))||variants[0];
        options(groups,variants.map(v=>[v.groupCount,`${v.groupCount} grupo${v.groupCount===1?'':'s'}`]),variant.groupCount);
        options(groupSize,variants.map(v=>[v.groupSize,`${v.groupSize} participantes`]),variant.groupSize);
        const available=variant.qualifiersPerGroup.filter(q=>[2,4,8,16].includes(q*variant.groupCount));
        options(qualifiers,available.map(q=>[q,`${q} por grupo`]),available.includes(Number(qualifiers.value))?Number(qualifiers.value):available[0]);
        refreshShared();
      };
      format.addEventListener('change',()=>refreshGroupConfig());
      capacity.addEventListener('input',()=>refreshGroupConfig());
      groups.addEventListener('change',()=>refreshGroupConfig('groupCount'));
      groupSize.addEventListener('change',()=>refreshGroupConfig('groupSize'));
      qualifiers.addEventListener('change',refreshShared);
      boardPlayers.addEventListener('input',refreshShared);
      groupMode.addEventListener('change',refreshShared);
      refreshGroupConfig();
    }
    bind('#tournamentProposal',async event=>{const f=formData(event.currentTarget);const payload={name:f.name,format:f.format,category:f.category,boardSize:Number(f.boardSize),maxPlayers:Number(f.maxPlayers),maxParticipants:Number(f.maxParticipants)};
      if(f.format==='group_knockout')payload.settings={groupCount:Number(f.groupCount),qualifiersPerGroup:Number(f.qualifiersPerGroup),groupMode:f.groupMode,
        ...(f.groupMode==='shared'?{groupMatchCount:Number(f.groupMatchCount)}:{})};
      await api(`/${activeId}/proposals`,'POST',payload);toast('Propuesta enviada.');await openFederation(activeId,'tournaments');},'submit');
    bind('[id^="proposal-approve-"]',async event=>{await api(`/${activeId}/proposals/${event.currentTarget.id.split('-').pop()}/decision`,'POST',{approve:true});toast('Torneo aprobado y creado.');await openFederation(activeId,'tournaments');});
    bind('[id^="proposal-reject-"]',async event=>{await api(`/${activeId}/proposals/${event.currentTarget.id.split('-').pop()}/decision`,'POST',{approve:false});toast('Propuesta rechazada.');await openFederation(activeId,'tournaments');});
    bind('[id^="tourney-join-"]',async event=>{await api(`/${activeId}/tournaments/${event.currentTarget.id.split('-').pop()}/join`,'POST',{});toast('Inscripción realizada.');});
    bind('[id^="tourney-open-"]',event=>location.href=`/?tournament=${Number(event.currentTarget.id.split('-').pop())}`);
    bind('[id^="tourney-study-"]',async event=>{
      const tournamentId=Number(event.currentTarget.id.split('-').pop());
      const data=await api(`/${activeId}/tournaments/${tournamentId}/study`);
      const panel=document.createElement('section');panel.className='fed-card fed-study-panel';
      panel.innerHTML=`<div class="fed-row fed-between"><h2>Estudiar · ${esc(data.category)}</h2><button class="fed-button" id="closeStudy">Cerrar</button></div>
        <h3>Material de conocimiento</h3><div class="fed-list">${data.knowledge.map(k=>shortRow(k.title,k.category||'General',`<a href="${esc(k.url)}" target="_blank" rel="noopener noreferrer">Abrir</a>`)).join('')||empty('Todavía no hay material complementario.')}</div>
        <h3>Preguntas aprobadas (${data.questions.length})</h3><p class="fed-help">Las respuestas correctas permanecen ocultas: preparate para descubrirlas jugando.</p>
        <div class="fed-list">${data.questions.map(q=>`<div class="fed-item"><div><strong>${esc(q.prompt)}</strong><small>${esc(Array.isArray(q.options)?q.options.join(' · '):[...(q.options?.categories||[]),...(q.options?.items||[])].join(' · '))}</small></div></div>`).join('')||empty('Aún no hay preguntas aprobadas para esta temática.')}</div>`;
      mount().appendChild(panel);panel.querySelector('#closeStudy').addEventListener('click',()=>panel.remove());
      panel.scrollIntoView({behavior:'smooth',block:'start'});
    });
    bind('#scheduleAttendance',async event=>{
      const f=formData(event.currentTarget),match=availableMatches.find(m=>Number(m.id)===Number(f.matchId));
      if(!match)throw new Error('Seleccioná un encuentro válido.');
      await api(`/${activeId}/attendance`,'POST',{matchId:match.id,invitedIds:match.participants,scheduledAt:new Date(f.scheduledAt).toISOString()});
      toast('Convocatoria creada y notificada.');await renderTournaments();
    },'submit');
    bind('[id^="attendance-checkin-"]',async event=>{
      await api(`/${activeId}/attendance/${Number(event.currentTarget.id.split('-').pop())}/checkin`,'POST',{});
      toast('Asistencia registrada.');await renderTournaments();
    });
    bind('[id^="attendance-reschedule-"]',async event=>{
      const value=prompt('Nueva fecha y hora (AAAA-MM-DD HH:MM):');if(!value)return;
      const when=new Date(value.replace(' ','T'));if(!Number.isFinite(when.getTime()))throw new Error('Fecha inválida.');
      await api(`/${activeId}/attendance/${Number(event.currentTarget.id.split('-').pop())}/reschedule`,'POST',{scheduledAt:when.toISOString()});
      toast('Partido reprogramado.');await renderTournaments();
    });
    bind('[id^="attendance-resolve-"]',async event=>{
      const id=Number(event.currentTarget.id.split('-').pop()),a=attendances.find(r=>Number(r.id)===id);
      const defaultScores=a.invitedIds.map(userId=>`${userId}:${a.presentIds.map(Number).includes(Number(userId))?2:0}`).join(', ');
      const value=prompt(`Puntos por convocado: userId:puntos (0, 1 o 2), separados por coma.\nEn eliminatorias debe haber un único ganador presente.\nAusentes: 0.`,defaultScores);
      if(value===null)return;
      const awards=value.split(',').map(pair=>{const [userId,points]=pair.trim().split(':').map(Number);return {userId,points};});
      const result=await api(`/${activeId}/attendance/${id}/resolve`,'POST',{awards});
      toast(result.status==='ready'?'Hay mayoría: el partido se debe jugar.':'W.O. registrado y fixture actualizado.');await renderTournaments();
    });
  }
  const eventAppearance={
    tournament:['trophy','Torneo'],tournament_proposal:['calendar','Propuesta'],proposal_rejected:['cross-circle','Propuesta'],
    member_joined:['users','Federado'],knowledge:['book-open','Conocimiento'],achievement:['medal','Logro'],
    schedule:['calendar','Convocatoria'],reschedule:['refresh','Reprogramación'],walkover:['flag','W.O.'],
    challenge:['flag','Desafío'],challenge_sent:['flag','Desafío'],challenge_result:['trophy','Resultado'],
    interfederative_result:['trophy','Interfederativo'],created:['shield-check','Federación'],
    announcement:['megaphone','Comunicado'],friendly_invite:['swords','Partido amistoso'],rules:['file-edit','Reglas'],identity:['picture','Identidad']
  };
  const messageIcons=['megaphone','bullhorn','info','calendar','trophy','star','book','flag','users','heart'];
  const feedIcon=kind=>eventAppearance[kind]?.[0]||'bell';
  async function renderFeed(append=false){
    const events=await api(`/${activeId}/feed`);
    const options=messageIcons.map(value=>`<option value="${value}">${esc(value.replaceAll('-',' '))}</option>`).join('');
    const content=title('Actividad y comunicados de la Federación')+
      (can('feed')?card(`<form id="feedForm" class="fed-form"><label>Comunicado<textarea name="message" required maxlength="500" placeholder="Una novedad para todos los federados…"></textarea></label><label>Ícono representativo (Flaticon)<select name="icon">${options}</select></label><button class="fed-button primary">${icon('megaphone')} Publicar</button></form>`):'')+
      `<div class="fed-list fed-feed-list">${events.length?events.filter(e=>e.kind!=='questions').map(e=>{
        const kind=e.kind||'announcement';const ico=kind==='announcement'&&messageIcons.includes(e.payload?.icon)?e.payload.icon:feedIcon(kind);
        const target=kind==='tournament'&&e.payload?.tournamentId?`<a class="fed-button ghost" href="/?tournament=${Number(e.payload.tournamentId)}">${icon('trophy')} Abrir torneo</a>`:
          kind==='friendly_invite'&&detail.role&&/^[A-Z2-9]{6}$/.test(String(e.payload?.roomCode||''))?`<a class="fed-button primary" href="/?room=${encodeURIComponent(e.payload.roomCode)}">${icon('play')} Unirme · ${esc(e.payload.roomCode)}</a>`:'';
        return `<article class="fed-item fed-feed-event" data-event-kind="${esc(kind)}"><span class="fed-event-icon">${icon(ico==='book'?'book-open':ico)}</span><div class="fed-event-body"><strong>${esc(e.message)}</strong><small>${esc(eventAppearance[kind]?.[1]||kind)} · ${date(e.createdAt)}${e.payload?.editedAt?' · Editado':''}</small></div><div class="fed-actions">${target}${kind==='announcement'&&can('feed')?button(`${icon('pencil')} Editar`,'feed-edit-'+e.id):''}</div></article>`;
      }).join(''):empty('El historial de actividad aparecerá aquí.')}</div>`;
    if(append)mount().insertAdjacentHTML('beforeend',`<div class="fed-home-feed">${content}</div>`);
    else sections(content);
    bind('#feedForm',async event=>{await api(`/${activeId}/feed`,'POST',formData(event.currentTarget));toast('Comunicado publicado y notificado.');await openFederation(activeId,'home');},'submit');
    bind('[id^="feed-edit-"]',event=>{
      const id=Number(event.currentTarget.id.split('-').pop()),item=events.find(e=>Number(e.id)===id);
      const editor=document.createElement('div');editor.className='fed-card fed-feed-editor';
      editor.innerHTML=`<form class="fed-form"><label>Editar comunicado<textarea name="message" maxlength="500" required>${esc(item.message)}</textarea></label><label>Ícono<select name="icon">${options}</select></label><div class="fed-row"><button class="fed-button primary">Guardar comunicado</button><button type="button" class="fed-button ghost" id="cancelFeedEdit">Cancelar</button></div></form>`;
      event.currentTarget.closest('.fed-feed-event').after(editor);editor.querySelector('select').value=messageIcons.includes(item.payload?.icon)?item.payload.icon:'megaphone';
      editor.querySelector('#cancelFeedEdit').addEventListener('click',()=>editor.remove());
      editor.querySelector('form').addEventListener('submit',invoke(async ev=>{
        await api(`/${activeId}/feed/${id}`,'PATCH',formData(ev.currentTarget));toast('Comunicado actualizado.');await openFederation(activeId,'home');
      }));
    });
  }
  async function renderIndividualRanking(){
    const rows=await api(`/${activeId}/standings`);
    sections(title('Ranking federativo individual'),
      `<div class="fed-card"><table class="fed-table"><thead><tr><th>#</th><th>Federado</th><th>Puntos</th><th>Victorias</th><th>Títulos</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.rank}</td><td>${esc(r.username)}</td><td>${fmt(r.points)}</td><td>${fmt(r.wins)}</td><td>${fmt(r.titles)}</td></tr>`).join('')}</tbody></table></div>`,
      !rows.length?empty('Las posiciones aparecerán después de los primeros torneos.'):'');
  }
  async function renderHistory(){const rows=await api(`/${activeId}/history`);
    sections(title('Historial de torneos'),`<div class="fed-list">${rows.length?rows.map(t=>card(`<div class="fed-row fed-between"><h3>${esc(t.name)}</h3><span class="fed-status">${esc(t.status)}</span></div><p>${esc(t.format)} · ${date(t.createdAt)}</p><div class="fed-list">${(t.Matches||[]).slice(0,20).map(m=>`<div class="fed-item fed-match-row ${fedMatchStage(m.stage)}"><div><strong>Fecha ${m.roundNo} · ${esc(m.stage)}</strong><small>${(m.participantNames||[]).map((name,i)=>`${esc(name)}${m.result?.finishOrder?.find(x=>Number(x.userId)===Number(m.participants?.[i]))?` (${m.result.finishOrder.find(x=>Number(x.userId)===Number(m.participants?.[i])).position}º)`:''}`).join(' vs ')||'Enfrentamiento pendiente'} · ${esc(m.status)}</small></div></div>`).join('')}</div>${t.shareCode?`<p><a href="/share/tournament/${encodeURIComponent(t.shareCode)}">Compartir historial público</a></p>`:''}`)).join(''):empty('Aún no hay historial competitivo.')}</div>`);
  }
  async function renderAchievements(){
    const [palmares,records]=await Promise.all([api(`/${activeId}/palmares`),api(`/${activeId}/records`)]);
    const recordIcons=['chart-histogram','target','trophy','flag'];
    sections(title('Palmarés'),`<div class="fed-list">${palmares.length?palmares.map(t=>shortRow(`${t.User?.username||'Campeón'} · ${t.trophyType}`,`${t.Tournament?.name||t.tournamentName} · ${date(t.awardedAt)}`,icon('trophy'))).join(''):empty('Los títulos aparecerán cuando se consigan.')}</div>`,
      title('Récords básicos'),`<div class="fed-kpis fed-record-kpis">${records.records.map((r,i)=>`<div class="fed-kpi fed-record fed-record-${i}"><span class="fed-kpi-icon">${icon(recordIcons[i]||'trophy')}</span><span class="fed-kpi-label">${esc(r.name)}</span><span class="fed-kpi-holder">${esc(r.holders.join(', ')||'Sin recordista')}</span><b class="fed-kpi-value">${fmt(r.value)}</b></div>`).join('')}</div>`,
      title('Top 10 jugadores más laureados'),`<div class="fed-list fed-laureates">${records.topLaureates.length?records.topLaureates.map((row,i)=>`<div class="fed-item fed-laureate ${i<3?`fed-laureate-${i+1}`:''}"><span class="fed-laureate-title">${i<3?icon('medal'):''}<strong>${i+1}. ${esc(row.name)}</strong></span><small>${fmt(row.titles)} títulos · ${fmt(row.finals||0)} finales · ${fmt(row.victories)} victorias</small></div>`).join(''):empty('Todavía no hay jugadores clasificados.')}</div>`);
  }
  async function renderStatistics(){
    const data=await api(`/${activeId}/statistics`);
    const metrics=[['Miembros',data.members,'users'],['Torneos',data.tournaments,'trophy'],['Partidas',data.games,'dice'],
      ['Campeones',data.champions,'medal'],['Preguntas respondidas',data.questionsAnswered,'question'],
      ['Respuestas correctas',data.correctAnswers,'check-circle'],['Precisión',`${data.accuracy}%`,'target']];
    const statMarkup=(rows,offset)=>rows.map(([name,value,ico],i)=>`<div class="fed-kpi fed-stat-kpi-${offset+i+1}"><span class="fed-kpi-icon">${icon(ico)}</span><span class="fed-kpi-label">${esc(name)}</span><b class="fed-kpi-value">${esc(value)}</b></div>`).join('');
    const bars=Object.entries(data.monthlyActivity||{});const max=Math.max(1,...bars.map(b=>b[1]));
    sections(title('Estadísticas de la comunidad'),`<div class="fed-kpis fed-stat-kpis"><div class="fed-stat-kpi-row">${statMarkup(metrics.slice(0,4),0)}</div><div class="fed-stat-kpi-row fed-stat-kpi-row-secondary">${statMarkup(metrics.slice(4),4)}</div></div>`,
      title('Actividad mensual'),card(`<div class="fed-chart">${bars.length?bars.map(([label,count])=>`<div class="fed-bar-line"><span>${esc(label)}</span><div class="fed-bar"><span style="width:${count/max*100}%"></span></div><b>${count}</b></div>`).join(''):empty('Todavía no hay actividad registrada.')}</div>`),
      title('Categorías más jugadas'),card(`<div class="fed-list">${Object.entries(data.mostPlayedCategories||{}).map(([name,n])=>shortRow(name,`${n} torneos`)).join('')||empty('Sin estadísticas temáticas.')}</div>`));
  }
  async function renderChallenges(){
    if(!detail.role){sections(empty('Ingresá a una Federación para consultar sus desafíos.'));return;}
    const [challenges,feds]=await Promise.all([api('/challenges/mine'),api('/public')]);
    const available=feds.filter(f=>Number(f.id)!==Number(activeId)&&f.categories.some(c=>detail.federation.categories.includes(c)));
    sections(title('Desafíos interfederativos y clásicos'),
      isPresi()?card(`<form class="fed-form" id="newChallenge"><label>Federación rival<select name="challengedId" required>${available.map(f=>`<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select></label>
        <label>Tipo<select name="kind"><option value="interfederative">Interfederativo</option><option value="classic">Clásico 1v1</option></select></label>
        <label>Nombre del desafío<input name="name" maxlength="100" required></label>
        <label>Temática común<select name="category">${detail.federation.categories.map(c=>`<option>${esc(c)}</option>`).join('')}</select></label>
        <button class="fed-button primary">Enviar desafío</button></form>`):'',
      `<div class="fed-list">${challenges.filter(c=>Number(c.challengerId)===Number(activeId)||Number(c.challengedId)===Number(activeId)).map(c=>shortRow(`Desafío #${c.id} · ${c.terms?.name||''}`,
        `${c.kind} · ${c.status}`,isPresi()&&c.status==='pending'&&Number(c.challengedId)===Number(activeId)?
        `${button('Aceptar','challenge-accept-'+c.id,'primary')} ${button('Rechazar','challenge-reject-'+c.id)}`:
        isPresi()&&c.status==='accepted'&&Number(c.challengerId)===Number(activeId)?button('Liquidar resultado','challenge-settle-'+c.id):'' )).join('')||empty('Sin desafíos registrados.')}</div>`);
    mount().querySelector('#newChallenge')?.closest('.fed-card')?.classList.add('fed-challenge-form');
    bind('#newChallenge',async event=>{const f=formData(event.currentTarget);const rival=available.find(r=>Number(r.id)===Number(f.challengedId));
      if(!rival.categories.includes(f.category))throw new Error('La categoría no es común a ambas Federaciones.');
      await api('/challenges','POST',{challengerId:activeId,challengedId:Number(f.challengedId),kind:f.kind,
        terms:{name:f.name,category:f.category,format:'cup',maxParticipants:4,maxPlayers:f.kind==='classic'?2:8,boardSize:40}});
      toast('Desafío enviado.');await renderChallenges();},'submit');
    bind('[id^="challenge-accept-"]',async event=>{await api(`/challenges/${event.currentTarget.id.split('-').pop()}/respond`,'POST',{accept:true});toast('Desafío aceptado.');await renderChallenges();});
    bind('[id^="challenge-reject-"]',async event=>{await api(`/challenges/${event.currentTarget.id.split('-').pop()}/respond`,'POST',{accept:false});toast('Desafío rechazado.');await renderChallenges();});
    bind('[id^="challenge-settle-"]',async event=>{await api(`/challenges/${event.currentTarget.id.split('-').pop()}/settle`,'POST',{});toast('Resultado incorporado al coeficiente.');await renderChallenges();});
  }
  async function renderSettings(){
    const f=detail.federation;
    sections(title('Manifiesto y reglas'),card(`<p>${esc(f.manifesto||'El Presidente todavía no publicó un manifiesto.')}</p><a href="/rules.html">Consultar reglas globales de AnkaraGOAT</a>`),
      isPresi()?`${title('Editar manifiesto')}${card(`<form id="manifestoForm" class="fed-form"><label>Reglas propias<textarea name="manifesto" rows="7" maxlength="8000" required>${esc(f.manifesto||'')}</textarea></label><button class="fed-button primary">Publicar nueva versión</button></form>`)}`:'',
      isPresi()?`${title('Identidad visual')}${card(`<form id="assetsForm" class="fed-form"><label>Escudo (PNG, JPG o WebP; hasta 2 MB)<input type="file" accept="image/png,image/jpeg,image/webp" name="crest"></label><label>Banner (PNG, JPG o WebP; hasta 2 MB)<input type="file" accept="image/png,image/jpeg,image/webp" name="banner"></label><button class="fed-button">Subir imágenes seleccionadas</button></form>`)}`:'',
      isPresi()?`${title('Configuración de acceso')}${card(`<form id="settingsForm" class="fed-form">
        <label class="fed-check"><input type="checkbox" name="isPublic" ${f.isPublic?'checked':''}> Federación pública</label>
        <label class="fed-check"><input type="checkbox" name="requiresApproval" ${f.requiresApproval?'checked':''}> Ingreso con aprobación</label>
        <p class="fed-help">Código de invitación: <code>${esc(detail.inviteCode||'')}</code></p><button class="fed-button">Guardar acceso</button></form>`)}`:'');
    bind('#manifestoForm',async event=>{await api(`/${activeId}/manifesto`,'POST',formData(event.currentTarget));toast('Manifiesto actualizado.');await openFederation(activeId,'settings');},'submit');
    bind('#settingsForm',async event=>{const f=formData(event.currentTarget);await api(`/${activeId}`,'PATCH',{isPublic:!!f.isPublic,requiresApproval:!!f.requiresApproval});toast('Acceso actualizado.');await openFederation(activeId,'settings');},'submit');
    bind('#assetsForm',async event=>{
      const data=new FormData(event.currentTarget);
      for(const kind of ['crest','banner']){const file=data.get(kind);if(!file?.size)continue;
        const fd=new FormData();fd.append('image',file);
        const result=await fetch(`/api/federations/${activeId}/assets/${kind}`,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:fd});
        const json=await result.json();if(!result.ok)throw new Error(json.error||'No se pudo subir la imagen.');}
      toast('Identidad visual actualizada.');await openFederation(activeId,'settings');
    },'submit');
  }
  async function ranking(){menu('ranking');activeId=null;
    const category=new URLSearchParams(location.search).get('categoria')||'';
    const rows=await api(`/rankings/federations${category?'?category='+encodeURIComponent(category):''}`);
    root.innerHTML=hero('Prestigio','Ranking de Federaciones','Puntos y coeficiente interfederativo, generales y por categoría.')+
      `<form class="fed-row" id="rankingCategory"><input class="fed-filter" name="category" placeholder="Filtrar por categoría" value="${esc(category)}">${button('Filtrar','filterRanking')}</form>`+
      `<div class="fed-list">${rows.length?rows.map((r,i)=>shortRow(`${i+1}. ${r.federation.name}`,`${r.federation.categories.join(', ')} · ${r.wins} victorias · ${r.finals} finales`,
        `<span class="fed-badge">${fmt(r.points)} pts</span>`)).join(''):empty('El ranking se actualizará después de los primeros interfederativos.')}</div>`;
    bind('#rankingCategory',event=>{const val=formData(event.currentTarget).category;history.replaceState(null,'',val?`/federaciones.html?categoria=${encodeURIComponent(val)}`:'/federaciones.html');ranking();},'submit');
  }
  document.querySelectorAll('[data-nav]').forEach(btn=>btn.addEventListener('click',invoke(async()=>{
    const actions={mine,explore,ranking,create:createForm};await actions[btn.dataset.nav]?.();
  })));
  const params=new URLSearchParams(location.search);
  invoke(async()=>{
    if(params.has('id'))return openFederation(Number(params.get('id')),params.get('tab')||'home');
    if(params.has('slug')){const publicData=await api(`/public/${encodeURIComponent(params.get('slug'))}`);return openFederation(publicData.federation.id);}
    return mine();
  })();
})();
