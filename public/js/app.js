const app = document.querySelector('#app');
const modalRoot = document.querySelector('#modalRoot');
const sessionActions = document.querySelector('#sessionActions');
const toastEl = document.querySelector('#toast');

const introSplash = document.querySelector('#introSplash');
const introLogo = document.querySelector('#introLogo');
const introConfetti = document.querySelector('#introConfetti');

function buildIntroPaperitos() {
  if (!introConfetti) return;
  const compact = window.matchMedia('(max-width: 768px)').matches;
  const count = compact ? 34 : 78;
  const colors = ['#62efd4', '#a5ff7b', '#f7c651', '#ffb85a', '#fff0c2'];
  const fragment = document.createDocumentFragment();

  for (let i = 0; i < count; i += 1) {
    const paper = document.createElement('span');
    const size = 5 + Math.random() * 8;
    paper.className = 'intro-paperito';
    paper.style.setProperty('--paper-left', `${Math.random() * 100}%`);
    paper.style.setProperty('--paper-w', `${size}px`);
    paper.style.setProperty('--paper-h', `${Math.max(3, size * (.42 + Math.random() * .42))}px`);
    paper.style.setProperty('--paper-color', colors[Math.floor(Math.random() * colors.length)]);
    paper.style.setProperty('--paper-delay', `${Math.random() * .75}s`);
    paper.style.setProperty('--paper-duration', `${1.55 + Math.random() * 1.55}s`);
    paper.style.setProperty('--paper-drift', `${-120 + Math.random() * 240}px`);
    paper.style.setProperty('--paper-rotate', `${240 + Math.random() * 780}deg`);
    fragment.appendChild(paper);
  }

  introConfetti.appendChild(fragment);
}

function finishIntroImmediately() {
  document.body.classList.remove('intro-pending');
  introSplash?.remove();
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureImageDecoded(img) {
  if (!img) return;
  if (!img.complete) {
    await new Promise((resolve, reject) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', reject, { once: true });
    });
  }
  if (typeof img.decode === 'function') {
    try { await img.decode(); } catch {}
  }
}

async function initIntroAnimation() {
  const brandLogo = document.querySelector('.brand img');
  if (!introSplash || !introLogo || !brandLogo) {
    finishIntroImmediately();
    return;
  }

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    finishIntroImmediately();
    return;
  }

  buildIntroPaperitos();

  try {
    // En móviles esperamos a que el PNG esté completamente decodificado antes
    // de mostrarlo. Esto evita que Chrome anime una textura todavía incompleta.
    await Promise.all([
      ensureImageDecoded(introLogo),
      ensureImageDecoded(brandLogo)
    ]);

    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    // Entrada estable: sólo cambia opacidad. No escalamos ni filtramos el PNG,
    // ya que esos efectos podían provocar artefactos de composición en móviles.
    const reveal = introLogo.animate([
      { opacity: 0 },
      { opacity: 1 }
    ], {
      duration: 320,
      easing: 'ease-out',
      fill: 'forwards'
    });

    await reveal.finished;
    introLogo.style.opacity = '1';
    reveal.cancel();

    // El logo queda completamente visible en el centro durante un segundo.
    await wait(1000);

    const start = introLogo.getBoundingClientRect();
    const target = brandLogo.getBoundingClientRect();

    // Pasamos de centrado por transform a coordenadas reales antes del viaje.
    // A partir de acá no usamos transform/scale sobre el bitmap.
    introLogo.style.left = `${start.left}px`;
    introLogo.style.top = `${start.top}px`;
    introLogo.style.width = `${start.width}px`;
    introLogo.style.height = `${start.height}px`;
    introLogo.style.maxWidth = 'none';
    introLogo.style.transform = 'none';
    introLogo.style.opacity = '1';
    introLogo.classList.add('is-travelling');

    introLogo.getBoundingClientRect();

    const compact = window.matchMedia('(max-width: 768px)').matches;
    const travel = introLogo.animate([
      {
        left: `${start.left}px`,
        top: `${start.top}px`,
        width: `${start.width}px`,
        height: `${start.height}px`,
        opacity: 1
      },
      {
        left: `${target.left}px`,
        top: `${target.top}px`,
        width: `${target.width}px`,
        height: `${target.height}px`,
        opacity: 1
      }
    ], {
      duration: compact ? 800 : 920,
      easing: 'cubic-bezier(.22,.82,.22,1)',
      fill: 'forwards'
    });

    await travel.finished;

    document.body.classList.remove('intro-pending');
    brandLogo.classList.add('brand-arrived');
    introLogo.style.opacity = '0';
    introSplash.classList.add('is-leaving');

    setTimeout(() => {
      brandLogo.classList.remove('brand-arrived');
      introSplash.remove();
    }, 360);
  } catch {
    finishIntroImmediately();
  }
}

let token = localStorage.getItem('ankara_token');
let me = null;
let currentGame = null;
let currentState = null;
let currentSpectator = false;
let socket = null;
let selectedTournamentUsers = [];
let questionTick = null;
let resultTick = null;
let queuedGameState = null;
let animatingMovement = false;
let chatMessages = [];
let currentSpectatorCount = 0;
let queuedQuestion = null;
let queuedRouletteReady = null;
let rouletteUiTimer = null;
let clientActionPending = false;
let diceSpinTimer = null;
let rollTick = null;
let rollCountdownToken = null;
let rollCountdownDeadline = 0;
let autoRollTriggeredToken = null;
let lastTurnToken = null;
let audioCtx = null;
let presenceTick = null;
let activeCellVideo = null;
let boardVideoAssignmentsCache = null;
let winnerVideoEl = null;
let rouletteSpinSoundTimers = [];
let rouletteCountdownTimer = null;
let rouletteVisualRotation = 0;
let rouletteAnimationFrame = null;

const ROLL_WINDOW_MS = 10_000;
const CELL_VIDEO_URLS = [
  'https://media.ankaragoat.fun/video/arquero-1.webm',
  'https://media.ankaragoat.fun/video/gambeta.webm',
  'https://media.ankaragoat.fun/video/logo-tv-1.webm',
  'https://media.ankaragoat.fun/video/logo-tv-2.webm',
  'https://media.ankaragoat.fun/video/logo-tv.webm'
];
const SPECIAL_CELL_VIDEO_URL = 'https://media.ankaragoat.fun/video/casillero-especial.webm';
const FINAL_CELL_VIDEO_URL = 'https://media.ankaragoat.fun/video/winner.mp4';
const SPECIAL_LOCKER_AUDIO_URL = 'https://media.ankaragoat.fun/audio/chants/special-locker.mp3';
const WINNER_VIDEO_URL = 'https://media.ankaragoat.fun/video/ganaste.mp4';
const BACKGROUND_VIDEO_URL = 'https://media.ankaragoat.fun/video/fondo.mp4';
const backgroundVideoEl = document.getElementById('backgroundVideo');
const backgroundImageEl = document.getElementById('backgroundImage');
let backgroundMode = localStorage.getItem('ankara_background_mode') === 'fixed' ? 'fixed' : 'video';

const ASSETS = {
  background: '/assets/images/background-ankara-goat.png',
  ball: '/assets/images/ball-ankara-goat.png',
  iso: '/assets/images/iso-ankara-goat.png',
  logo: '/assets/images/logo-ankara-goat.png',
  player: '/assets/images/player-ankara-goat.png'
};


/* =========================================================
   AUDIO DE AMBIENTACIÓN
   ========================================================= */

const INTRO_CHANTS_URL = 'https://media.ankaragoat.fun/audio/chants/intro_chants.mp3';
const STADIUM_CHANTS_URL = 'https://media.ankaragoat.fun/audio/chants/stadium_chants.mp3';
const ANKARA_GOAT_SONG_URL = 'https://media.ankaragoat.fun/audio/chants/ankara-goat-song.mp3';
const STADIUM_START_POINTS = [
  0, 55, 227, 306, 393, 522, 1430, 2018, 2944, 3022,
  3147, 3267, 3309, 3425, 3502, 3847, 3947, 4043, 4127,
  4956, 5093, 5214, 5260, 5362, 5554, 5726, 5867, 6053, 6189
];

const introChantsAudio = new Audio(INTRO_CHANTS_URL);
const stadiumChantsAudio = new Audio(STADIUM_CHANTS_URL);
const championSongAudio = new Audio(ANKARA_GOAT_SONG_URL);
const specialLockerAudio = new Audio(SPECIAL_LOCKER_AUDIO_URL);
specialLockerAudio.preload = 'auto';
introChantsAudio.preload = 'auto';
stadiumChantsAudio.preload = 'metadata';
championSongAudio.preload = 'metadata';

let globalAudioPaused = localStorage.getItem('ankara_audio_paused') === '1';
let globalAudioVolume = Number(localStorage.getItem('ankara_audio_volume'));
if (!Number.isFinite(globalAudioVolume)) globalAudioVolume = .35;
globalAudioVolume = Math.max(0, Math.min(1, globalAudioVolume));
let platformAudioPhase = 'boot_intro';
let stadiumRandomized = false;
let stadiumResumeAt = 0;
let audioPlaybackUnlocked = false;
let stadiumSuppressionReasons = new Set();
let stadiumSuppressionResumeTimer = null;
let stadiumDuckReasons = new Set();

function applyGlobalAudioVolume() {
  introChantsAudio.volume = globalAudioVolume;
  stadiumChantsAudio.volume = globalAudioVolume;
  championSongAudio.volume = globalAudioVolume;
  specialLockerAudio.volume = Math.min(.72, Math.max(.18, globalAudioVolume * .85));
  if(backgroundVideoEl) backgroundVideoEl.volume = Math.min(.08, globalAudioVolume * .14);
  localStorage.setItem('ankara_audio_volume', String(globalAudioVolume));
  updateAudioControls();
}

function backgroundControlsMarkup(){
  return `<div class="background-controls" aria-label="Fondo visual"><button type="button" class="background-mode-btn ${backgroundMode==='fixed'?'active':''}" data-background-mode="fixed" title="Fondo fijo"><i class="fi fi-rr-picture"></i><span>Fijo</span></button><button type="button" class="background-mode-btn ${backgroundMode==='video'?'active':''}" data-background-mode="video" title="Fondo en video"><i class="fi fi-rr-play-alt"></i><span>Video</span></button></div>`;
}
function applyBackgroundMode(mode,{persist=true}={}){
  backgroundMode = mode==='fixed'?'fixed':'video';
  document.body.dataset.backgroundMode=backgroundMode;
  if(persist)localStorage.setItem('ankara_background_mode',backgroundMode);
  if(backgroundVideoEl){
    backgroundVideoEl.muted = backgroundMode!=='video' || !backgroundVideoAudioAllowed();
    if(backgroundMode==='video') backgroundVideoEl.play().catch(()=>{});
  }
  syncBackgroundVideoAudio();
  document.querySelectorAll('[data-background-mode]').forEach(btn=>btn.classList.toggle('active',btn.dataset.backgroundMode===backgroundMode));
}
function bindBackgroundControls(){
  document.querySelectorAll('[data-background-mode]').forEach(btn=>btn.addEventListener('click',()=>applyBackgroundMode(btn.dataset.backgroundMode)));
}

function audioControlsMarkup() {
  const volumePct = Math.round(globalAudioVolume * 100);
  return `<div class="audio-controls" aria-label="Ambientación de cancha">
    <button type="button" class="audio-control-btn" id="audioVolumeDown" aria-label="Bajar volumen" title="Bajar volumen">−</button>
    <button type="button" class="audio-control-btn audio-toggle" id="audioToggle" aria-label="${globalAudioPaused ? 'Reanudar ambientación' : 'Pausar ambientación'}" title="${globalAudioPaused ? 'Reanudar ambientación' : 'Pausar ambientación'}">${globalAudioPaused ? '▶' : '⏸'}</button>
    <button type="button" class="audio-control-btn" id="audioVolumeUp" aria-label="Subir volumen" title="Subir volumen">+</button>
    <span class="audio-volume-value" title="Volumen">${volumePct}%</span>
  </div>`;
}

function updateAudioControls() {
  const toggle = $('#audioToggle');
  const value = $('.audio-volume-value');
  if (toggle) {
    toggle.textContent = globalAudioPaused ? '▶' : '⏸';
    toggle.setAttribute('aria-label', globalAudioPaused ? 'Reanudar ambientación' : 'Pausar ambientación');
    toggle.title = globalAudioPaused ? 'Reanudar ambientación' : 'Pausar ambientación';
  }
  if (value) value.textContent = `${Math.round(globalAudioVolume * 100)}%`;
}

function waitForAudioMetadata(audio) {
  if (audio.readyState >= 1) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => resolve();
    audio.addEventListener('loadedmetadata', done, { once: true });
    audio.addEventListener('error', done, { once: true });
  });
}

async function seekAudio(audio, seconds) {
  await waitForAudioMetadata(audio);
  try {
    const duration = Number(audio.duration);
    const safe = Number.isFinite(duration) && duration > .5
      ? Math.min(Math.max(0, Number(seconds) || 0), Math.max(0, duration - .25))
      : Math.max(0, Number(seconds) || 0);
    audio.currentTime = safe;
  } catch {}
}

async function tryPlayAudio(audio) {
  if (globalAudioPaused) return false;
  try {
    await audio.play();
    audioPlaybackUnlocked = true;
    updateAudioControls();
    return true;
  } catch {
    return false;
  }
}

function backgroundVideoAudioAllowed(){
  return !!backgroundVideoEl && backgroundMode==='video' && !globalAudioPaused && stadiumSuppressionReasons.size===0 && !['finish_intro','winner_video','champion_song','finished_silence'].includes(platformAudioPhase);
}
async function syncBackgroundVideoAudio(){
  if(!backgroundVideoEl)return false;
  backgroundVideoEl.volume=Math.min(.08,globalAudioVolume*.14);
  if(!backgroundVideoAudioAllowed()){
    backgroundVideoEl.muted=true;
    try{await backgroundVideoEl.play()}catch{}
    return false;
  }
  try{
    backgroundVideoEl.muted=false;
    await backgroundVideoEl.play();
    return true;
  }catch{
    backgroundVideoEl.muted=true;
    try{await backgroundVideoEl.play()}catch{}
    return false;
  }
}

function suppressStadium(reason){
  if(!reason)return;
  stadiumSuppressionReasons.add(String(reason));
  clearTimeout(stadiumSuppressionResumeTimer);stadiumSuppressionResumeTimer=null;
  if(platformAudioPhase==='stadium') stadiumChantsAudio.pause();
  if(backgroundVideoEl)backgroundVideoEl.muted=true;
}
function canResumeStadium(){
  return !globalAudioPaused&&stadiumSuppressionReasons.size===0&&platformAudioPhase==='stadium'&&currentGame?.status==='running'&&currentState?.phase!=='finished';
}
function releaseStadium(reason,{delay=0}={}){
  const run=()=>{
    stadiumSuppressionReasons.delete(String(reason));
    if(canResumeStadium())startStadiumAmbience();
    syncBackgroundVideoAudio();
  };
  clearTimeout(stadiumSuppressionResumeTimer);
  if(delay>0)stadiumSuppressionResumeTimer=setTimeout(run,delay);else run();
}
function clearStadiumSuppressions(){stadiumSuppressionReasons.clear();clearTimeout(stadiumSuppressionResumeTimer);stadiumSuppressionResumeTimer=null;syncBackgroundVideoAudio();}
function syncAmbientDuck(){stadiumChantsAudio.volume=(stadiumDuckReasons.size?globalAudioVolume*.32:globalAudioVolume);if(backgroundVideoEl)backgroundVideoEl.volume=Math.min(.08,globalAudioVolume*.14);}
function duckStadium(reason){if(!reason)return;stadiumDuckReasons.add(String(reason));syncAmbientDuck();}
function releaseStadiumDuck(reason,{delay=0}={}){const run=()=>{stadiumDuckReasons.delete(String(reason));syncAmbientDuck();};if(delay>0)setTimeout(run,delay);else run();}
function stopSpecialLockerAudio(){
  try{specialLockerAudio.pause();specialLockerAudio.currentTime=0}catch{}
  releaseStadium('special_cell_audio');
}
async function playSpecialLockerAudio(){
  suppressStadium('special_cell_audio');
  try{specialLockerAudio.pause();specialLockerAudio.currentTime=0}catch{}
  specialLockerAudio.volume=Math.min(.72,Math.max(.18,globalAudioVolume*.85));
  if(!globalAudioPaused){try{await specialLockerAudio.play()}catch{}}
}

async function startStadiumAmbience({ randomStart = false } = {}) {
  platformAudioPhase = 'stadium';
  introChantsAudio.pause();

  if (randomStart || !stadiumRandomized) {
    const point = STADIUM_START_POINTS[Math.floor(Math.random() * STADIUM_START_POINTS.length)] || 0;
    await seekAudio(stadiumChantsAudio, point);
    stadiumRandomized = true;
  }

  if (!globalAudioPaused && stadiumSuppressionReasons.size===0) await tryPlayAudio(stadiumChantsAudio);
  await syncBackgroundVideoAudio();
}

async function resumeCurrentAudio() {
  if (globalAudioPaused) return false;
  if ($('[data-modal-kind="tournament_podium"]',modalRoot) || platformAudioPhase === 'champion_song') return tryPlayAudio(championSongAudio);
  if (platformAudioPhase === 'winner_video') {
    if (winnerVideoEl) winnerVideoEl.muted = false;
    return true;
  }
  if (platformAudioPhase === 'boot_intro' || platformAudioPhase === 'finish_intro') {
    return tryPlayAudio(introChantsAudio);
  }
  if (platformAudioPhase === 'stadium' && stadiumSuppressionReasons.size) return false;
  if (!stadiumRandomized) {
    await startStadiumAmbience({ randomStart: true });
    return !stadiumChantsAudio.paused;
  }
  return tryPlayAudio(stadiumChantsAudio);
}

function setGlobalAudioPaused(paused) {
  globalAudioPaused = !!paused;
  localStorage.setItem('ankara_audio_paused', globalAudioPaused ? '1' : '0');
  if (winnerVideoEl) winnerVideoEl.muted = globalAudioPaused;
  if (globalAudioPaused) {
    introChantsAudio.pause();
    stadiumChantsAudio.pause();
    championSongAudio.pause();
    specialLockerAudio.pause();
    if(backgroundVideoEl)backgroundVideoEl.muted=true;
  } else {
    resumeCurrentAudio();
    syncBackgroundVideoAudio();
  }
  updateAudioControls();
}

function adjustGlobalAudioVolume(delta) {
  globalAudioVolume = Math.round(Math.max(0, Math.min(1, globalAudioVolume + delta)) * 10) / 10;
  applyGlobalAudioVolume();
  if (winnerVideoEl) winnerVideoEl.volume = globalAudioVolume;
  syncBackgroundVideoAudio();
}

function bindAudioControls() {
  $('#audioToggle')?.addEventListener('click', () => setGlobalAudioPaused(!globalAudioPaused));
  $('#audioVolumeDown')?.addEventListener('click', () => adjustGlobalAudioVolume(-.1));
  $('#audioVolumeUp')?.addEventListener('click', () => adjustGlobalAudioVolume(.1));
  updateAudioControls();
}

async function startPlatformAudio() {
  platformAudioPhase = 'boot_intro';
  stadiumChantsAudio.pause();
  introChantsAudio.pause();
  try { introChantsAudio.currentTime = 0; } catch {}
  if (!globalAudioPaused) await tryPlayAudio(introChantsAudio);
  await syncBackgroundVideoAudio();
}

async function playMatchFinishedChant() {
  clearStadiumSuppressions();
  stadiumResumeAt = Number(stadiumChantsAudio.currentTime || 0);
  stadiumChantsAudio.pause();
  introChantsAudio.pause();
  championSongAudio.pause();
  platformAudioPhase = 'finish_intro';
  if(backgroundVideoEl)backgroundVideoEl.muted=true;
  try { introChantsAudio.currentTime = 0; } catch {}
  if (!globalAudioPaused) await tryPlayAudio(introChantsAudio);
}

async function playChampionSong(){
  clearStadiumSuppressions();
  stadiumResumeAt=Number(stadiumChantsAudio.currentTime||0); stadiumChantsAudio.pause(); introChantsAudio.pause(); championSongAudio.pause(); platformAudioPhase='champion_song'; if(backgroundVideoEl)backgroundVideoEl.muted=true;
  try{championSongAudio.currentTime=0}catch{}; if(!globalAudioPaused)await tryPlayAudio(championSongAudio);
}
function stopChampionSong(){championSongAudio.pause();try{championSongAudio.currentTime=0}catch{};platformAudioPhase='finished_silence'}

function wrapCanvasText(ctx,text,maxWidth){
  const words=String(text??'').trim().split(/\s+/).filter(Boolean);
  const lines=[]; let line='';
  for(const word of words){
    const test=line?`${line} ${word}`:word;
    if(line&&ctx.measureText(test).width>maxWidth){lines.push(line);line=word}else line=test;
  }
  if(line)lines.push(line);
  return lines;
}

async function htmlCardToPng({title,subtitle,lines=[]}){
  // Canvas nativo: evita foreignObject/SVG, que falla o queda bloqueado en
  // algunos navegadores (especialmente Firefox) al exportar el PNG.
  const width=1080,height=1350;
  const canvas=document.createElement('canvas'); canvas.width=width; canvas.height=height;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('Canvas no disponible.');

  const bg=ctx.createLinearGradient(0,0,width,height); bg.addColorStop(0,'#061914'); bg.addColorStop(1,'#123428');
  ctx.fillStyle=bg; ctx.fillRect(0,0,width,height);
  ctx.fillStyle='rgba(98,239,212,.10)'; ctx.beginPath(); ctx.moveTo(620,0); ctx.lineTo(width,0); ctx.lineTo(width,520); ctx.closePath(); ctx.fill();
  ctx.fillStyle='rgba(180,255,0,.10)'; ctx.fillRect(0,height-18,width,18);

  ctx.textBaseline='top';
  ctx.font='800 30px Arial, sans-serif'; ctx.fillStyle='#62efd4'; ctx.fillText('ANKARA GOAT',86,82);
  ctx.font='900 68px Arial, sans-serif'; ctx.fillStyle='#ffffff';
  let y=150; for(const line of wrapCanvasText(ctx,title,900)){ctx.fillText(line,86,y);y+=78}
  ctx.font='400 32px Arial, sans-serif'; ctx.fillStyle='#b8c9c3';
  for(const line of wrapCanvasText(ctx,subtitle,900)){ctx.fillText(line,86,y+12);y+=42}
  y+=52;

  for(const value of lines){
    const rowLines=(()=>{ctx.font='700 36px Arial, sans-serif';return wrapCanvasText(ctx,value,820)})();
    const rowHeight=Math.max(92,42*rowLines.length+42);
    ctx.fillStyle='rgba(255,255,255,.075)';
    ctx.beginPath(); ctx.roundRect(86,y,908,rowHeight,22); ctx.fill();
    ctx.fillStyle='#ffffff'; ctx.font='700 36px Arial, sans-serif';
    rowLines.forEach((line,index)=>ctx.fillText(line,116,y+24+index*42));
    y+=rowHeight+20;
  }

  ctx.font='400 27px Arial, sans-serif'; ctx.fillStyle='#a9b9b4'; ctx.fillText('Trivia futbolera · AnkaraGOAT',86,height-92);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png',.95));
  if(!blob)throw new Error('No se pudo exportar el PNG.');
  return blob;
}
async function shareResultCard(opts){
  try{
    const blob=await htmlCardToPng(opts);
    const file=new File([blob],'ankara-goat-resultado.png',{type:'image/png'});
    if(navigator.share&&navigator.canShare?.({files:[file]})){
      try{await navigator.share({title:opts.title,text:opts.subtitle,files:[file]});return}catch(e){if(e?.name==='AbortError')return}
    }
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=file.name;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
    toast('Imagen del resultado generada.');
  }catch(e){console.error('[share result]',e);toast('No se pudo generar la imagen para compartir.')}
}

introChantsAudio.addEventListener('ended', () => {
  if (platformAudioPhase === 'finish_intro') { startStadiumAmbience(); return; }
  startStadiumAmbience({ randomStart: true });
});

introChantsAudio.addEventListener('error', () => {
  if (platformAudioPhase === 'finish_intro') startStadiumAmbience();
  else if (platformAudioPhase === 'boot_intro') startStadiumAmbience({ randomStart: true });
});

stadiumChantsAudio.addEventListener('ended', async () => {
  if (platformAudioPhase !== 'stadium') return;
  await seekAudio(stadiumChantsAudio, 0);
  if (!globalAudioPaused) await tryPlayAudio(stadiumChantsAudio);
});

championSongAudio.addEventListener('ended', () => {
  if (platformAudioPhase === 'champion_song') startStadiumAmbience();
});

function installAudioUnlock() {
  const unlock = async () => {
    if (globalAudioPaused) return;
    const [mainOk,bgOk] = await Promise.all([resumeCurrentAudio(),syncBackgroundVideoAudio()]);
    if (!mainOk && !bgOk) return;
    audioPlaybackUnlocked = true;
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
}

introChantsAudio.volume = globalAudioVolume;
stadiumChantsAudio.volume = globalAudioVolume;
if(backgroundVideoEl){
  backgroundVideoEl.src=BACKGROUND_VIDEO_URL;
  backgroundVideoEl.loop=true;
  backgroundVideoEl.playsInline=true;
  backgroundVideoEl.muted=true;
  backgroundVideoEl.volume=Math.min(.08,globalAudioVolume*.14);
  backgroundVideoEl.play().catch(()=>{});
}
applyBackgroundMode(backgroundMode,{persist:false});
installAudioUnlock();

function setView(name){
  document.body.dataset.view = name;
}

function icon(name){
  const map = {
    knowledge:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 3 7l9 4 7-3.11V14h2V7L12 3Zm-6 8.18V16l6 3 6-3v-4.82l-6 2.67-6-2.67Z"/></svg>',
    ranking:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h3v16H7V4Zm7 5h3v11h-3V9ZM2 12h3v8H2v-8Zm17-6h3v14h-3V6Z"/></svg>',
    edit:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16.86 3.49 3.65 3.65-11.7 11.7-4.38.73.73-4.38 11.7-11.7ZM15.45 4.9 6.57 13.78l-.35 2.12 2.12-.35 8.88-8.88-1.77-1.77Z"/></svg>',
    play:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7L8 5Z"/></svg>',
    watch:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c5.5 0 9.5 4.3 10.8 7-1.3 2.7-5.3 7-10.8 7S2.5 14.7 1.2 12C2.5 9.3 6.5 5 12 5Zm0 2C8.4 7 5.35 9.5 3.55 12 5.35 14.5 8.4 17 12 17s6.65-2.5 8.45-5C18.65 9.5 15.6 7 12 7Zm0 2.2A2.8 2.8 0 1 1 9.2 12 2.8 2.8 0 0 1 12 9.2Z"/></svg>',
    team:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6c0 5.2 3.4 9.98 8 11 4.6-1.02 8-5.8 8-11V5l-8-3Zm0 2.13 6 2.25V11c0 4.12-2.56 7.9-6 8.92-3.44-1.02-6-4.8-6-8.92V6.38l6-2.25Z"/></svg>',
    tournament:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h10v4h2a1 1 0 0 1 1 1v3a5 5 0 0 1-5 5h-1.1A5 5 0 0 1 13 16.9V20h4v2H7v-2h4v-3.1A5 5 0 0 1 10.1 15H9a5 5 0 0 1-5-5V7a1 1 0 0 1 1-1h2V2Zm0 6H6v2a3 3 0 0 0 3 3h.35A7.95 7.95 0 0 1 7 8Zm10 0a7.95 7.95 0 0 1-2.35 5H15a3 3 0 0 0 3-3V8h-1Z"/></svg>',
    room:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 3 7v10l9 5 9-5V7l-9-5Zm0 2.2 6.5 3.61L12 11.42 5.5 7.81 12 4.2Zm-7 5.31 6 3.33V19.8l-6-3.34V9.51Zm8 10.29v-6.96l6-3.33v6.95l-6 3.34Z"/></svg>',
    logout:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5v-2H5V5h5V3Zm4.59 4.59L16 9l-3 3h8v2h-8l3 3-1.41 1.41L9.17 13l5.42-5.41Z"/></svg>'
  };
  return `<span class="icon icon-${name}">${map[name] || ''}</span>`;
}

function pageBanner({eyebrow='', eyebrowActions='', title='', subtitle='', actions='', player=true, compact=false} = {}){
  return `<section class="page-banner ${compact ? 'compact' : ''}">
    <div class="page-banner-copy">
      ${eyebrow ? `<div class="eyebrow-row"><div class="eyebrow">${eyebrow}</div>${eyebrowActions ? `<div class="eyebrow-actions">${eyebrowActions}</div>` : ''}</div>` : ''}
      <h1>${title}</h1>
      ${subtitle ? `<div class="profile-line">${subtitle}</div>` : ''}
      ${actions ? `<div class="actions banner-actions">${actions}</div>` : ''}
    </div>
    ${player ? `<div class="page-banner-visual"><div class="player-aura"></div><div class="player-particles"></div><img src="${ASSETS.player}" alt="Jugador Ankara GOAT" class="page-banner-player"></div>` : ''}
  </section>`;
}

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove('show'), 2800);
}

function audioContext() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  } catch {
    return null;
  }
}

function tone(frequency, duration = 0.08, gainValue = 0.035, type = 'sine', delay = 0) {
  const ctx = audioContext();
  if (!ctx) return;
  const start = ctx.currentTime + delay;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(Math.max(0.001, gainValue), start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.01);
}

function playTokenStep() {
  tone(430, 0.045, 0.070, 'square');
}

function playCorrectSound() {
  tone(520, 0.10, 0.080, 'sine');
  tone(660, 0.11, 0.085, 'sine', 0.09);
  tone(820, 0.16, 0.095, 'sine', 0.18);
}

function playIncorrectSound() {
  tone(280, 0.14, 0.090, 'sawtooth');
  tone(190, 0.20, 0.080, 'sawtooth', 0.12);
}

function playPositiveSurpriseSound() {
  tone(640, 0.08, 0.04, 'triangle');
  tone(860, 0.12, 0.045, 'triangle', 0.08);
}

function playNegativeSurpriseSound() {
  tone(230, 0.10, 0.045, 'square');
  tone(150, 0.16, 0.04, 'square', 0.09);
}

const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

function startDiceAnimation() {
  const button = $('#diceBtn');
  if (!button) return;
  audioContext();
  button.classList.add('rolling');
  clearInterval(diceSpinTimer);
  diceSpinTimer = setInterval(() => {
    button.textContent = DICE_FACES[Math.floor(Math.random() * DICE_FACES.length)];
    tone(150 + Math.random() * 140, 0.030, 0.090, 'square');
  }, 70);
}

async function finishDiceAnimation(roll) {
  await new Promise(resolve => setTimeout(resolve, 420));
  clearInterval(diceSpinTimer);
  diceSpinTimer = null;
  const button = $('#diceBtn');
  if (button) {
    button.textContent = DICE_FACES[Math.max(0, Math.min(5, Number(roll) - 1))] || '🎲';
    button.classList.remove('rolling');
  }
  tone(360, 0.09, 0.140, 'triangle');
  await new Promise(resolve => setTimeout(resolve, 520));
  if($('[data-modal-kind="dice_roll"]',modalRoot))closeModal();
}

function stopDiceAnimation() {
  clearInterval(diceSpinTimer);
  diceSpinTimer = null;
  const button = $('#diceBtn');
  if (button) {
    button.textContent = '🎲';
    button.classList.remove('rolling');
  }
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
  sessionActions.innerHTML = `${audioControlsMarkup()}${token
    ? `<button class="btn ghost" id="logoutBtn">${icon('logout')}<span class="logout-label">Salir</span></button>`
    : ''}`;
  bindBackgroundControls();
  bindAudioControls();
  $('#logoutBtn')?.addEventListener('click', () => {
    if(currentGame?.status==='running'&&!currentSpectator&&currentState?.phase!=='finished'){
      const ok=window.confirm('Si cerrás sesión ahora, tenés 60 segundos para volver a la partida. Si no regresás dentro de ese minuto, perderás por abandono y afectará tu ELO. ¿Querés salir?');
      if(!ok)return;
    }
    socket?.disconnect(); socket = null;
    setSession(null, null);
    currentGame=null;currentState=null;currentSpectator=false;
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
  setView('landing');
  currentGame = null; currentState = null; currentSpectator = false;
  app.innerHTML = `<section class="home-stage">
      <div class="home-stage-grid">
        <div class="home-stage-left">
          <div class="card auth-card stadium-card" id="authCard">${landingForm(mode)}</div>
        </div>
        <div class="hero-visual home-visual" aria-hidden="true">
          <div class="player-aura"></div>
          <img class="hero-player" src="${ASSETS.player}" alt="">
          <img class="hero-ball" src="${ASSETS.ball}" alt="">
        </div>
      </div>
    </section>`;
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
    <div><h2 style="margin:4px 0">${escapeHtml(c.name || 'Sin nombre')}</h2><div class="muted">${escapeHtml(me?.username || '')}</div></div></div>`;
}

function tierModeOptions(selected='ankara') {
  return [
    ['casual','Casual · 60/30/10'],['futbolero','Futbolero · 45/40/15'],['enfermo','Enfermo · 25/40/35'],['ankara','Ankara · 35/35/30']
  ].map(([v,l])=>`<option value="${v}" ${selected===v?'selected':''}>${l}</option>`).join('');
}


function graceText(deadline){
  const ms=Math.max(0,Number(deadline||0)-Date.now());
  const seconds=Math.ceil(ms/1000);
  if(seconds<=0)return'Procesando derrota por abandono...';
  return `${seconds}s para volver`;
}

function startPresenceCountdowns(){
  clearInterval(presenceTick);
  const update=()=>$$('[data-grace-deadline]').forEach(el=>{el.textContent=graceText(el.dataset.graceDeadline)});
  update();
  presenceTick=setInterval(update,500);
}

function clearRollCountdown(){
  clearInterval(rollTick);
  rollTick=null;
  rollCountdownToken=null;
  rollCountdownDeadline=0;
}

function currentTurnPlayer(){
  return currentState?.players?.[currentState?.turnIndex] || null;
}

function hasPendingPlayerAbsence(){
  return (currentState?.players||[]).some(
    p=>p.active&&currentState?.presence?.[String(p.userId)]?.connected===false
  );
}

function diceModalMarkup(){
  const current=currentTurnPlayer();
  const isMyTurn=Number(current?.userId)===Number(me?.id)&&!currentSpectator;
  const seconds=Math.max(0,Math.ceil((rollCountdownDeadline-Date.now())/1000));
  const status=isMyTurn
    ? (clientActionPending?'Procesando tirada…':'Tirá el dado')
    : `${escapeHtml(current?.username||'El jugador del turno')} está por tirar`;
  return `<div class="modal-backdrop dice-roll-backdrop" data-modal-kind="dice_roll"><div class="modal dice-roll-modal">
    <div class="kicker">TURNO ${Number(currentState?.turnNo||1)}</div>
    <h2>${escapeHtml(current?.username||'Jugador')}</h2>
    <p class="muted dice-roll-status">${status}</p>
    <div class="dice-interaction-shell ${isMyTurn?'is-active':'is-locked'}">
      <button type="button" class="dice dice-modal-button" id="diceBtn" ${isMyTurn&&!clientActionPending?'':'disabled'} aria-label="Tirar dado">🎲</button>
      ${isMyTurn?'':`<button type="button" class="dice-lock-guard" id="diceLockGuard" aria-label="No es tu turno todavía"></button><div class="dice-turn-warning" id="diceTurnWarning">No es tu turno todavía</div>`}
    </div>
    <div class="dice-countdown-copy">${isMyTurn?'Tenés':'Tiene'} <b id="rollCountdown">${seconds||10}</b> s para tirar.</div>
    <div class="timer dice-modal-timer"><div id="rollTimerBar"></div></div>
    ${isMyTurn?'<small class="muted">Si no tirás, el dado se ejecutará automáticamente.</small>':'<small class="muted">Todos ven la tirada en tiempo real.</small>'}
  </div></div>`;
}

function ensureDiceModal(){
  if(!currentGame||!currentState||currentGame.status!=='running'||currentState.phase!=='roll'||hasPendingPlayerAbsence())return false;
  const existing=$('[data-modal-kind]',modalRoot)?.dataset?.modalKind;
  if(existing&&existing!=='dice_roll')return false;
  if(existing!=='dice_roll') modalRoot.innerHTML=diceModalMarkup();
  const button=$('#diceBtn',modalRoot);
  if(button&&!button.dataset.bound){button.dataset.bound='1';button.addEventListener('click',()=>requestDiceRoll())}
  const guard=$('#diceLockGuard',modalRoot);
  if(guard&&!guard.dataset.bound){guard.dataset.bound='1';guard.addEventListener('pointerdown',e=>{e.preventDefault();const warning=$('#diceTurnWarning',modalRoot);if(!warning)return;warning.classList.add('show');clearTimeout(warning._t);warning._t=setTimeout(()=>warning.classList.remove('show'),1500)},{passive:false})}
  return true;
}

function requestDiceRoll({automatic=false}={}){
  const current=currentTurnPlayer();
  const isMyTurn=Number(current?.userId)===Number(me?.id)&&!currentSpectator;
  if(
    !currentGame||
    !currentState||
    currentGame.status!=='running'||
    currentState.phase!=='roll'||
    !isMyTurn||
    clientActionPending||
    hasPendingPlayerAbsence()
  ) return false;

  const tokenAtRequest=currentState.turnToken;
  if(automatic&&autoRollTriggeredToken===tokenAtRequest)return false;
  if(automatic)autoRollTriggeredToken=tokenAtRequest;

  clearInterval(rollTick);
  rollTick=null;
  clientActionPending=true;
  const button=$('#diceBtn');
  if(button)button.disabled=true;
  animatingMovement=true;
  startDiceAnimation();

  socket.emit('roll_dice',{gameId:currentGame.id,turnToken:tokenAtRequest},ack=>{
    if(!ack?.ok){
      clientActionPending=false;
      animatingMovement=false;
      stopDiceAnimation();
      flushQueuedGameState();
      if(automatic&&autoRollTriggeredToken===tokenAtRequest)autoRollTriggeredToken=null;
      toast(ack.error);
      renderGame();
    }
  });
  return true;
}

function startRollCountdown({reset=false}={}){
  if(
    !currentGame||
    !currentState||
    currentGame.status!=='running'||
    currentState.phase!=='roll'||
    animatingMovement||
    hasPendingPlayerAbsence()
  ){
    clearRollCountdown();
    return;
  }

  const token=currentState.turnToken;
  if(!token){
    clearRollCountdown();
    return;
  }

  // En el primer turno el reloj empieza cuando se cierra la presentación inicial.
  if($('[data-modal-kind="match_intro"]',modalRoot)) return;
  if(
    Number(currentState.turnNo||1)===1&&
    !presentationWasShown('match_intro',Number(currentGame.id))
  ) return;

  const modalKind=$('[data-modal-kind]',modalRoot)?.dataset?.modalKind;
  if(modalKind&&modalKind!=='dice_roll')return;

  if(reset||rollCountdownToken!==token||!rollCountdownDeadline){
    rollCountdownToken=token;
    rollCountdownDeadline=Date.now()+ROLL_WINDOW_MS;
    autoRollTriggeredToken=null;
  }

  if(!ensureDiceModal())return;

  clearInterval(rollTick);

  const update=()=>{
    if(
      !currentGame||
      !currentState||
      currentGame.status!=='running'||
      currentState.phase!=='roll'||
      currentState.turnToken!==token
    ){
      clearRollCountdown();
      return;
    }

    const left=Math.max(0,rollCountdownDeadline-Date.now());
    const seconds=Math.ceil(left/1000);
    const value=$('#rollCountdown');
    const bar=$('#rollTimerBar');
    if(value)value.textContent=String(seconds);
    if(bar)bar.style.width=`${Math.max(0,Math.min(100,left/ROLL_WINDOW_MS*100))}%`;

    if(left<=0){
      clearInterval(rollTick);
      rollTick=null;
      requestDiceRoll({automatic:true});
    }
  };

  update();
  if(rollCountdownDeadline>Date.now())rollTick=setInterval(update,200);
}

function resetGameViewState(){
  clearRollCountdown();
  autoRollTriggeredToken=null;
  currentGame=null;currentState=null;currentSpectator=false;clientActionPending=false;
  queuedGameState=null;queuedQuestion=null;queuedRouletteReady=null;stopDiceAnimation();
  cleanupCellVideo();
  boardVideoAssignmentsCache=null;
  closeModal();
}

async function refreshMe(){
  try{me=await api('/api/auth/me');renderSessionActions()}catch{}
}

async function leaveCurrentGame(){
  if(!currentGame){await renderDashboard();return}
  const game=currentGame;
  const running=game.status==='running'&&currentState?.phase!=='finished';
  if(running&&!currentSpectator){
    const ok=window.confirm('Si salís de una partida en curso, tenés 60 segundos para volver a entrar. Si no regresás dentro de ese minuto, la partida se te dará por perdida y afectará tu ELO. ¿Querés salir?');
    if(!ok)return;
  }
  if(socket?.connected){
    await new Promise(resolve=>socket.emit('leave_game',{gameId:game.id},ack=>{if(!ack?.ok)toast(ack?.error||'No se pudo salir correctamente.');resolve()}));
  }
  resetGameViewState();
  await renderDashboard();
}

async function archiveCurrentGame(){
  if(!currentGame)return;
  try{
    await api(`/api/games/${currentGame.id}/archive`,{method:'POST',body:'{}'});
    resetGameViewState();
    await refreshMe();
    await renderDashboard();
    toast('Partida archivada. El resultado y el ELO quedan guardados en tu historial.');
  }catch(e){toast(e.message)}
}

async function renderDashboard() {
  setView('dashboard');
  await refreshMe();
  const [data,activeGames] = await Promise.all([
    api('/api/tournaments').catch(() => ({ tournaments:[], pendingInvites:[] })),
    api('/api/games/mine/active').catch(() => [])
  ]);
  const tournaments = Array.isArray(data) ? data : data.tournaments || [];
  const invites = data.pendingInvites || [];
  app.innerHTML = `${pageBanner({
    eyebrow: 'Vestuario',
    eyebrowActions: backgroundControlsMarkup(),
    title: `Hola, ${escapeHtml(me.username)}`,
    subtitle: `Nivel <b>${me.level || 1}</b> · ELO <b>${me.eloRating || 1000}</b> · ${me.xp || 0} XP`,
    actions: `${`<button class="btn" id="profileBtn">${icon('knowledge')}Mi conocimiento</button><button class="btn" id="leaderboardBtn">${icon('ranking')}Ranking</button><a class="btn" href="/rules.html">${icon('room')}Reglas</a>`}${me.role==='admin'?`<a class="btn" href="/admin.html">${icon('tournament')}Panel preguntas</a>`:''}${['moderator','admin'].includes(me.role)?`<a class="btn" href="/moderator.html">${icon('watch')}Moderación</a>`:''}<button class="btn primary" id="editTeamBtn">${icon('edit')}Editar equipo</button>`
  })}
    ${activeGames.length?`<section class="card invite-card"><div class="kicker">Partidas en curso</div><div class="list" style="margin-top:12px">${activeGames.map(g=>{const presence=g.state?.presence?.[String(me.id)];const away=presence?.connected===false;const others=(g.state?.players||[]).filter(p=>Number(p.userId)!==Number(me.id)&&g.state?.presence?.[String(p.userId)]?.connected===false);return `<div class="list-item"><span><b>${escapeHtml(g.name)}</b><br><small class="muted">${away?`⚠ Estás fuera · <span data-grace-deadline="${Number(presence.graceDeadline)}"></span>`:others.length?`⏳ Esperando a ${escapeHtml(others.map(x=>x.username).join(', '))}`:`${escapeHtml(g.status)}`}</small></span><button class="btn primary" data-resume-game="${g.id}">${icon('play')}Volver a entrar</button></div>`}).join('')}</div></section>`:''}
    ${invites.length ? `<section class="card invite-card"><div class="kicker">Invitaciones pendientes</div><div class="list" style="margin-top:12px">${invites.map(i=>`<div class="list-item"><span><b>${escapeHtml(i.Tournament?.name || 'Torneo')}</b><br><small class="muted">Invita ${escapeHtml(i.inviter?.username || 'organizador')}</small></span><span class="actions"><button class="btn primary" data-invite-accept="${i.id}">Aceptar</button><button class="btn ghost" data-invite-decline="${i.id}">Rechazar</button></span></div>`).join('')}</div></section>` : ''}
    <div class="dashboard-launch-grid">
      <div class="dashboard-launch-left">
        <section class="card team-card"><div class="kicker dashboard-kicker">${icon('team')} Tu equipo</div>${teamCard(me.Team)}</section>
        <section class="card panel-join"><div class="kicker dashboard-kicker">${icon('room')} Código de sala</div><h2>Entrar</h2>
          <div class="field"><label>Código</label><input id="joinCode" maxlength="6" style="text-transform:uppercase;letter-spacing:.12em"></div>
          <div class="grid two"><button class="btn primary" id="joinGameBtn">${icon('play')}Jugar</button><button class="btn" id="watchGameBtn">${icon('watch')}Mirar</button></div></section>
      </div>
      <section class="card panel-quick"><div class="kicker dashboard-kicker">${icon('play')} Partida rápida</div><h2>Crear sala</h2>
        <div class="field"><label>Nombre</label><input id="quickName" value="Clásico de ${escapeHtml(me.username)}"></div>
        <div class="grid two"><div class="field"><label>Casilleros</label><select id="quickBoard">${[25,30,35,40,45,50,55,60,65,70].map(n=>`<option ${n===40?'selected':''}>${n}</option>`).join('')}</select></div>
        <div class="field"><label>Modo de preguntas</label><select id="quickMode">${tierModeOptions()}</select></div></div>
        <div class="field"><label>Casilleros especiales: <span id="quickSpecialLabel">25%</span></label><input id="quickSpecial" type="range" min="20" max="35" value="25"></div><label class="check"><input id="allowSpectators" type="checkbox" checked> Permitir espectadores</label>
        <button class="btn primary" id="createGameBtn" style="width:100%;margin-top:10px">${icon('room')}Crear sala</button></section>
    </div>
    <div class="section-title themed tournament-section-title"><h2>${icon('tournament')}Torneos</h2><span class="actions"><button class="btn" id="joinTournamentCodeBtn">Entrar con código</button><button class="btn" id="newTournamentBtn">+ Nuevo torneo</button></span></div>
    <div class="grid two"><section class="card tournament-list-card"><div class="kicker">Mis competiciones</div><div class="list" style="margin-top:12px">
      ${tournaments.length ? tournaments.map(t=>`<button class="list-item" data-tournament-id="${t.id}" style="color:white;cursor:pointer;width:100%"><span><b>${escapeHtml(t.name)}</b><br><small class="muted">${formatLabel(t.format)} · ${t.boardSize} casilleros</small></span><span class="status">${escapeHtml(t.statusLabel||t.status)}</span></button>`).join(''):'<div class="empty">Todavía no participás de ningún torneo.</div>'}</div></section>
      <section class="card central-rule"><div class="kicker">Regla central</div><h2>El avance se gana</h2><p class="muted">El dado marca el destino potencial. La ficha llega visualmente hasta allí, pero la posición solo se confirma si acertás la trivia. Si fallás, permanecés donde estabas.</p>
      <div class="tier-grid"><span><b>T1</b> Popular</span><span><b>T2</b> Fanático</span><span><b>T3</b> Enfermo</span></div></section></div>`;

  bindBackgroundControls();
  $('#quickSpecial').oninput=e=>$('#quickSpecialLabel').textContent=`${e.target.value}%`; $('#createGameBtn').onclick=createQuickGame; $('#joinGameBtn').onclick=joinByCode; $('#watchGameBtn').onclick=watchByCode;
  $('#editTeamBtn').onclick=openTeamEditor; $('#newTournamentBtn').onclick=openTournamentModal; $('#joinTournamentCodeBtn').onclick=openTournamentCodeModal; $('#profileBtn').onclick=renderMyProfile; $('#leaderboardBtn').onclick=renderLeaderboard;
  $$('[data-tournament-id]').forEach(el=>el.onclick=()=>openTournamentDetails(el.dataset.tournamentId));
  $$('[data-invite-accept]').forEach(el=>el.onclick=()=>respondInvite(el.dataset.inviteAccept,'accept'));
  $$('[data-invite-decline]').forEach(el=>el.onclick=()=>respondInvite(el.dataset.inviteDecline,'decline'));
  $$('[data-resume-game]').forEach(el=>el.onclick=()=>{const g=activeGames.find(x=>Number(x.id)===Number(el.dataset.resumeGame));if(g)enterGame(g,false)});
  startPresenceCountdowns();
}


function formatLabel(f) { return ({league_1v1:'Liga 1 vs 1',shared_board_league:'Liga en tablero compartido',group_knockout:'Liguilla + eliminación',cup:'Copa'})[f] || f; }

async function respondInvite(id, action) {
  try { await api(`/api/tournaments/invitations/${id}/${action}`,{method:'POST',body:'{}'}); toast(action==='accept'?'Invitación aceptada.':'Invitación rechazada.'); await renderDashboard(); }
  catch(e){ toast(e.message); }
}

async function createQuickGame() {
  try {
    const game = await api('/api/games', { method:'POST', body:JSON.stringify({ name:$('#quickName').value, boardSize:Number($('#quickBoard').value), questionMode:$('#quickMode').value, spectatorsAllowed:$('#allowSpectators').checked, specialCellPercent:Number($('#quickSpecial').value) }) });
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

function closeModal(){clearInterval(questionTick);questionTick=null;clearInterval(resultTick);resultTick=null;stopRouletteAudioFx();if(rouletteAnimationFrame)cancelAnimationFrame(rouletteAnimationFrame);rouletteAnimationFrame=null;clearInterval(rouletteCountdownTimer);rouletteCountdownTimer=null;modalRoot.innerHTML=''}

function openTournamentCodeModal(){
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="kicker">TORNEOS</div><h2>Entrar con código</h2><div class="field"><label>Código de acceso</label><input id="tournamentAccessCode" maxlength="12" style="text-transform:uppercase"></div><div class="actions end"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="joinTournamentCode">Entrar</button></div></div></div>`;
  $('[data-close]',modalRoot).onclick=closeModal;
  $('#joinTournamentCode').onclick=async()=>{const code=$('#tournamentAccessCode').value.trim().toUpperCase();if(!code)return toast('Ingresá el código.');try{const out=await api(`/api/tournaments/join-code/${encodeURIComponent(code)}`,{method:'POST',body:'{}'});closeModal();toast('Te sumaste al torneo.');openTournamentDetails(out.tournament.id)}catch(e){toast(e.message)}};
}

function openTournamentModal(){
  selectedTournamentUsers=[];
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="kicker">ORGANIZADOR</div><h2>Crear torneo</h2><form id="tournamentForm">
    <div class="field"><label>Nombre</label><input name="name" required placeholder="Copa de los Enfermos"></div>
    <div class="grid two"><div class="field"><label>Formato</label><select name="format" id="tFormat"><option value="league_1v1">Liga 1 vs 1</option><option value="shared_board_league">Liga en tablero compartido</option><option value="group_knockout">Liguilla + eliminación</option><option value="cup">Copa</option></select></div>
    <div class="field"><label>Participantes</label><select name="maxParticipants" id="tCapacity"></select></div></div>
    <div class="grid two"><div class="field"><label>Casilleros</label><select name="boardSize">${[25,30,35,40,45,50,55,60,65,70].map(n=>`<option ${n===40?'selected':''}>${n}</option>`).join('')}</select></div><div class="field"><label>Casilleros especiales</label><select name="specialCellPercent">${[20,25,30,35].map(n=>`<option value="${n}" ${n===25?'selected':''}>${n}%</option>`).join('')}</select></div></div>
    <div class="field"><label>Modo de preguntas</label><select name="questionMode">${tierModeOptions()}</select></div><div id="formatSettings"></div>
    <div class="field"><label>Invitar usuarios (opcional)</label><input id="userSearch" placeholder="Buscar por usuario..."></div><div id="searchResults" class="list"></div><div id="selectedUsers" class="chips" style="margin:12px 0"></div>
    <p class="help">También podrás compartir el código de acceso. El torneo sólo comienza cuando se completa el cupo y el organizador lo inicia.</p>
    <div class="actions end"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn primary">Crear torneo</button></div></form></div></div>`;
  $('[data-close]',modalRoot).onclick=closeModal; $('#tFormat').onchange=renderFormatSettings; $('#tCapacity').onchange=renderFormatSettings; renderFormatSettings();
  let timer;$('#userSearch').oninput=e=>{clearTimeout(timer);timer=setTimeout(()=>searchUsers(e.target.value),250)};$('#tournamentForm').onsubmit=createTournament;
}

function capacityOptions(format){
  if(format==='cup') return [4,8,16,32,64];
  if(format==='shared_board_league') return [4,5,6,7,8];
  if(format==='league_1v1') return Array.from({length:27},(_,i)=>i+4);
  return Array.from({length:15},(_,i)=>4+i*2);
}
const GROUP_CONFIGS={4:[[1,4,[2]]],6:[[2,3,[1,2]]],8:[[2,4,[1,2]]],10:[[2,5,[1,2,4]]],12:[[2,6,[1,2,4]],[4,3,[1,2]]],14:[[2,7,[1,2,4]]],16:[[2,8,[1,2,4]],[4,4,[1,2]]],18:[[2,9,[1,2,4]]],20:[[2,10,[1,2,4,8]],[4,5,[1,2]]],22:[[2,11,[1,2,4,8]]],24:[[2,12,[1,2,4,8]],[4,6,[1,2]]],26:[[2,13,[1,2,4,8]]],28:[[2,14,[1,2,4,8]],[4,7,[1,2,4]]],30:[[2,15,[1,2,4,8]]],32:[[2,16,[1,2,4,8]],[4,8,[1,2,4]],[8,4,[1,2]]]};
function renderFormatSettings(){
  const f=$('#tFormat').value,cap=$('#tCapacity'),prev=Number(cap.value); const opts=capacityOptions(f); cap.innerHTML=opts.map(n=>`<option value="${n}" ${n===prev?'selected':''}>${n}</option>`).join(''); if(!opts.includes(Number(cap.value)))cap.value=String(opts[0]);
  const n=Number(cap.value),root=$('#formatSettings');
  if(f==='shared_board_league')root.innerHTML=`<div class="field"><label>Cantidad de fechas</label><input name="matchCount" type="number" min="3" max="10" value="3"></div>`;
  else if(f==='group_knockout'){const configs=GROUP_CONFIGS[n]||[];root.innerHTML=`<div class="grid two"><div class="field"><label>Distribución</label><select name="groupConfig" id="groupConfig">${configs.map((c,i)=>`<option value="${i}">${c[0]} grupos de ${c[1]}</option>`).join('')}</select></div><div class="field"><label>Clasifican por grupo</label><select name="qualifiersPerGroup" id="qualifiersPerGroup"></select></div></div><div class="field"><label>Enfrentamientos de grupo</label><select name="groupMode"><option value="1v1">1 vs 1</option>${configs.some(c=>c[1]<=8)?'<option value="shared">Todos en el mismo tablero</option>':''}</select></div><div class="field"><label>Fechas si elegís tablero compartido</label><input name="groupMatchCount" type="number" min="3" max="10" value="3"></div>`;const update=()=>{const c=configs[Number($('#groupConfig').value)]||configs[0];$('#qualifiersPerGroup').innerHTML=(c?.[2]||[]).map(x=>`<option>${x}</option>`).join('')};$('#groupConfig').onchange=update;update();}
  else root.innerHTML='';
}

async function searchUsers(q){
  if(q.trim().length<2){$('#searchResults').innerHTML='';return}
  try{const rows=await api(`/api/users/search?q=${encodeURIComponent(q.trim())}`);$('#searchResults').innerHTML=rows.map(u=>`<button type="button" class="list-item" data-add-user="${u.id}" style="color:#fff;cursor:pointer"><span>${escapeHtml(u.Team?.crestEmoji||'⚽')} <b>${escapeHtml(u.username)}</b> · ${escapeHtml(u.Team?.name||'Sin equipo')}</span><span>+</span></button>`).join('');
    $$('[data-add-user]',modalRoot).forEach(btn=>btn.onclick=()=>{const u=rows.find(x=>x.id===Number(btn.dataset.addUser));if(!selectedTournamentUsers.some(x=>x.id===u.id))selectedTournamentUsers.push(u);renderSelectedUsers()});
  }catch(e){toast(e.message)}}
function renderSelectedUsers(){$('#selectedUsers').innerHTML=selectedTournamentUsers.map(u=>`<button type="button" class="chip" data-remove-user="${u.id}" style="border:0;color:#fff;cursor:pointer">${escapeHtml(u.username)} ×</button>`).join('');$$('[data-remove-user]',modalRoot).forEach(btn=>btn.onclick=()=>{selectedTournamentUsers=selectedTournamentUsers.filter(u=>u.id!==Number(btn.dataset.removeUser));renderSelectedUsers()})}

async function createTournament(e){e.preventDefault();const form=Object.fromEntries(new FormData(e.currentTarget)),settings={questionMode:form.questionMode,maxParticipants:Number(form.maxParticipants),specialCellPercent:Number(form.specialCellPercent)};if(form.matchCount)settings.matchCount=Number(form.matchCount);if(form.groupConfig!=null&&form.groupConfig!==''){const c=(GROUP_CONFIGS[Number(form.maxParticipants)]||[])[Number(form.groupConfig)];if(c){settings.groupCount=c[0];settings.groupSize=c[1]}}if(form.qualifiersPerGroup)settings.qualifiersPerGroup=Number(form.qualifiersPerGroup);if(form.groupMode)settings.groupMode=form.groupMode;if(form.groupMatchCount)settings.groupMatchCount=Number(form.groupMatchCount);
  try{const data=await api('/api/tournaments',{method:'POST',body:JSON.stringify({name:form.name,format:form.format,boardSize:Number(form.boardSize),settings,participantIds:selectedTournamentUsers.map(u=>u.id)})});closeModal();toast(`Torneo creado. Código: ${data.tournament.accessCode||'—'}`);await openTournamentDetails(data.tournament.id)}catch(err){toast(err.message)}}

function openTournamentEditModal(t){
  const invites=(t.TournamentInvitations||[]).filter(i=>['pending','accepted'].includes(i.status)).map(i=>Number(i.inviteeId));
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="kicker">ORGANIZADOR</div><h2>Editar torneo</h2><form id="editTournamentForm"><div class="field"><label>Nombre</label><input name="name" value="${escapeHtml(t.name)}" required></div><div class="grid two"><div class="field"><label>Formato</label><select name="format" id="editTFormat">${['league_1v1','shared_board_league','group_knockout','cup'].map(f=>`<option value="${f}" ${f===t.format?'selected':''}>${formatLabel(f)}</option>`).join('')}</select></div><div class="field"><label>Cupo</label><select name="maxParticipants" id="editTCapacity"></select></div></div><div class="grid two"><div class="field"><label>Casilleros</label><select name="boardSize">${[25,30,35,40,45,50,55,60,65,70].map(n=>`<option ${Number(t.boardSize)===n?'selected':''}>${n}</option>`).join('')}</select></div><div class="field"><label>Casilleros especiales</label><input name="specialCellPercent" type="number" min="20" max="35" value="${Number(t.settings?.specialCellPercent||25)}"></div></div><div id="editFormatSettings"></div><div class="actions end"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn primary">Guardar cambios</button></div></form></div></div>`;
  const render=()=>{const f=$('#editTFormat').value,cap=$('#editTCapacity'),old=Number(cap.value)||Number(t.settings?.maxParticipants);const opts=capacityOptions(f);cap.innerHTML=opts.map(n=>`<option value="${n}" ${(n===old||(!opts.includes(old)&&n===opts[0]))?'selected':''}>${n}</option>`).join('');const n=Number(cap.value),root=$('#editFormatSettings');if(f==='shared_board_league')root.innerHTML=`<div class="field"><label>Fechas</label><input name="matchCount" type="number" min="3" max="10" value="${Number(t.settings?.matchCount||3)}"></div>`;else if(f==='group_knockout'){const configs=GROUP_CONFIGS[n]||[];let idx=configs.findIndex(c=>c[0]===Number(t.settings?.groupCount));if(idx<0)idx=0;root.innerHTML=`<div class="grid two"><div class="field"><label>Distribución</label><select name="groupConfig" id="editGroupConfig">${configs.map((c,i)=>`<option value="${i}" ${i===idx?'selected':''}>${c[0]} grupos de ${c[1]}</option>`).join('')}</select></div><div class="field"><label>Clasifican por grupo</label><select name="qualifiersPerGroup" id="editQualifiers"></select></div></div><div class="field"><label>Modalidad del grupo</label><select name="groupMode"><option value="1v1" ${t.settings?.groupMode!=='shared'?'selected':''}>1 vs 1</option><option value="shared" ${t.settings?.groupMode==='shared'?'selected':''}>Tablero compartido</option></select></div><div class="field"><label>Fechas compartidas</label><input name="groupMatchCount" type="number" min="3" max="10" value="${Number(t.settings?.groupMatchCount||3)}"></div>`;const uq=()=>{const c=configs[Number($('#editGroupConfig').value)]||configs[0];$('#editQualifiers').innerHTML=(c?.[2]||[]).map(x=>`<option ${x===Number(t.settings?.qualifiersPerGroup)?'selected':''}>${x}</option>`).join('')};$('#editGroupConfig').onchange=uq;uq()}else root.innerHTML=''};
  $('[data-close]',modalRoot).onclick=closeModal;$('#editTFormat').onchange=render;$('#editTCapacity').onchange=render;render();
  $('#editTournamentForm').onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.currentTarget)),settings={...(t.settings||{}),maxParticipants:Number(f.maxParticipants),specialCellPercent:Number(f.specialCellPercent)};if(f.matchCount)settings.matchCount=Number(f.matchCount);if(f.groupConfig!=null&&f.groupConfig!==''){const c=(GROUP_CONFIGS[Number(f.maxParticipants)]||[])[Number(f.groupConfig)];settings.groupCount=c?.[0];settings.groupSize=c?.[1];settings.qualifiersPerGroup=Number(f.qualifiersPerGroup);settings.groupMode=f.groupMode;settings.groupMatchCount=Number(f.groupMatchCount||3)};try{await api(`/api/tournaments/${t.id}`,{method:'PUT',body:JSON.stringify({name:f.name,format:f.format,boardSize:Number(f.boardSize),settings,participantIds:invites})});closeModal();toast('Torneo actualizado.');openTournamentDetails(t.id)}catch(err){toast(err.message)}};
}

async function openTournamentDetails(id){
  setView('tournament');
  try{const [t,standingData]=await Promise.all([api(`/api/tournaments/${id}`),api(`/api/tournaments/${id}/standings`)]),isOrg=t.organizerId===me.id;
    const renderTable=(rows,title)=>`<section class="card"><div class="kicker">${escapeHtml(title)}</div><div class="table-wrap"><table class="standings"><thead><tr><th title="Posición"><i class="fi fi-rr-hashtag"></i></th><th class="standing-team-head"><i class="fi fi-rr-users"></i><span>Equipo</span></th><th title="Puntos"><i class="fi fi-rr-star"></i></th><th title="Victorias"><i class="fi fi-rr-trophy"></i></th><th title="Preguntas correctas"><i class="fi fi-rr-check"></i></th><th title="Preguntas incorrectas"><i class="fi fi-rr-cross-circle"></i></th><th title="Diferencia"><i class="fi fi-rr-chart-histogram"></i></th></tr></thead><tbody>${rows.map(r=>`<tr class="${r.exactTiePending?'tie-pending':''}"><td>${r.position}</td><td>${escapeHtml(r.team?.crestEmoji||'⚽')} <b>${escapeHtml(r.team?.name||r.username)}</b>${r.exactTiePending?' <small>⚖ desempate</small>':''}</td><td><b>${r.points}</b></td><td>${r.wins}</td><td>${r.correctAnswers}</td><td>${r.incorrectAnswers}</td><td>${r.answerDifference>0?'+':''}${r.answerDifference}</td></tr>`).join('')}</tbody></table></div></section>`;
    const tables=Object.entries(standingData.groups||{}).map(([code,rows])=>renderTable(rows,code==='overall'?'Tabla de posiciones':`Grupo ${code}`)).join('');
    const ties=(standingData.tiebreaks||[]);
    app.innerHTML=`${pageBanner({eyebrow: escapeHtml(formatLabel(t.format)), title: escapeHtml(t.name), subtitle: `${t.boardSize} casilleros · ${t.TournamentParticipants?.length||0}/${t.settings?.maxParticipants||'?'} participantes · ${escapeHtml(t.statusLabel||t.status)}${t.accessCode?` · Código <b>${escapeHtml(t.accessCode)}</b>`:''}`, player:false, compact:true, actions:`${isOrg&&t.management?.canEdit?'<button class=\"btn\" id=\"editTournament\">Editar</button>':''}${isOrg&&t.status==='open'?'<button class=\"btn primary\" id=\"startTournament\">Generar calendario</button>':''}${isOrg&&t.management?.canDelete?'<button class=\"btn danger\" id=\"deleteTournament\">Eliminar torneo</button>':''}${isOrg&&t.management?.canSuspend?'<button class=\"btn danger\" id=\"deleteTournament\">Suspender torneo</button>':''}${['running','finished','suspended'].includes(t.status)?'<button class=\"btn\" id=\"shareTournamentStats\"><i class=\"fi fi-rr-share\"></i> Compartir</button>':''}<button class=\"btn ghost\" id=\"backDash\">← Vestuario</button>`})}
      ${(ties.some(x=>(x.excludedUserIds||[]).map(Number).includes(Number(me.id))))?'<section class="card invite-card"><div class="kicker">Desempate extraordinario</div><p>Hubo más participantes empatados que lugares disponibles en el tablero. El ELO se utilizó únicamente para determinar el acceso al desempate y quedaste fuera del bloque habilitado, según el reglamento.</p></section>':''}<div class="standings-stack">${tables}</div>
      ${ties.length?`<section class="card"><div class="kicker">Desempates</div><div class="list">${ties.map(x=>`<div class="list-item"><span><b>${x.scope==='group'?`Grupo ${escapeHtml(x.groupCode)}`:'Tabla final'}</b><br><small class="muted">${(x.userIds||[]).length} jugadores · ${escapeHtml(x.status)}</small></span>${isOrg&&x.status!=='resolved'?`<button class="btn primary" data-open-tiebreak="${x.id}">Abrir desempate</button>`:''}</div>`).join('')}</div></section>`:''}
      <div class="grid two"><section class="card"><div class="kicker">Participantes aceptados</div><div class="list" style="margin-top:12px">${(t.TournamentParticipants||[]).map(p=>`<div class="list-item"><span>${escapeHtml(p.User?.Team?.crestEmoji||'⚽')} <b>${escapeHtml(p.User?.username||p.userId)}</b>${p.groupCode?` · Grupo ${p.groupCode}`:''}</span><span class="actions"><span class="score-strong">${p.points} pts</span>${isOrg&&t.status==='open'&&Number(p.userId)!==Number(me.id)?`<button class="btn danger" data-kick-participant="${p.userId}">Quitar</button>`:''}</span></div>`).join('')}</div></section>
      <section class="card"><div class="kicker">Invitaciones</div><div class="list" style="margin-top:12px">${(t.TournamentInvitations||[]).map(i=>`<div class="list-item"><span>${escapeHtml(i.invitee?.username||i.inviteeId)}</span><span class="status">${escapeHtml(i.status)}</span></div>`).join('')||'<div class="empty">Sin invitaciones.</div>'}</div></section></div>
      <div class="section-title"><h2>Calendario</h2></div><section class="card"><div class="list">${(t.Matches||[]).map(m=>`<div class="list-item"><span><b>R${m.roundNo} · ${escapeHtml(m.stage)}</b><br><small class="muted">${m.groupCode?`Grupo ${m.groupCode} · `:''}${m.participants?.length?m.participants.join(' vs '):describeSources(m.source)}</small></span><span class="actions"><span class="status">${m.status}</span>${isOrg&&m.participants?.length>=2&&m.status!=='finished'?`<button class="btn" data-open-match="${m.id}">Abrir sala</button>`:''}</span></div>`).join('')||'<div class="empty">El calendario se crea cuando el organizador inicia el torneo.</div>'}</div></section>`;
    $('#backDash').onclick=()=>token?renderDashboard():renderLanding();$('#shareTournamentStats')?.addEventListener('click',()=>shareTournamentPublicPage(t.id,t.name));$('#editTournament')?.addEventListener('click',()=>openTournamentEditModal(t));$('#deleteTournament')?.addEventListener('click',async()=>{if(!confirm(t.management?.canSuspend?'¿Suspender el torneo y conservar todas las estadísticas?':'¿Eliminar este torneo?'))return;try{const out=await api(`/api/tournaments/${t.id}`,{method:'DELETE'});toast(out.suspended?'Torneo suspendido.':'Torneo eliminado.');renderDashboard()}catch(e){toast(e.message)}});$('#startTournament')?.addEventListener('click',async()=>{try{await api(`/api/tournaments/${t.id}/start`,{method:'POST',body:'{}'});toast('Calendario generado.');openTournamentDetails(t.id)}catch(e){toast(e.message)}});
    $$('[data-open-match]').forEach(b=>b.onclick=async()=>{try{const g=await api(`/api/tournaments/${t.id}/matches/${b.dataset.openMatch}/game`,{method:'POST',body:'{}'});enterGame(g,!g.state?.players?.some(p=>p.userId===me.id))}catch(e){toast(e.message)}});
    $$('[data-kick-participant]').forEach(b=>b.onclick=async()=>{if(!confirm('¿Quitar este participante del torneo?'))return;try{await api(`/api/tournaments/${t.id}/participants/${b.dataset.kickParticipant}`,{method:'DELETE'});openTournamentDetails(t.id)}catch(e){toast(e.message)}});
    $$('[data-open-tiebreak]').forEach(b=>b.onclick=async()=>{try{const g=await api(`/api/tournaments/${t.id}/tiebreaks/${b.dataset.openTiebreak}/game`,{method:'POST',body:'{}'});enterGame(g,!g.state?.players?.some(p=>p.userId===me.id))}catch(e){toast(e.message)}});
  }catch(e){toast(e.message)}}

function describeSources(source){if(!source?.entrants)return'Cruce pendiente';return source.entrants.map(s=>s.type==='winner'?`Ganador ${s.ref}`:s.type==='group_position'?`${s.position}° Grupo ${s.groupCode}`:`Jugador ${s.id}`).join(' vs ')}

async function createPublicShare(kind,id){
  const endpoint=kind==='match'?`/api/games/${Number(id)}/share`:`/api/tournaments/${Number(id)}/share`;
  const data=await api(endpoint,{method:'POST',body:'{}'});
  return `${location.origin}${data.path}`;
}

function openSocialShareSheet({url,title,text}){
  document.getElementById('socialShareOverlay')?.remove();
  const wrap=document.createElement('div');wrap.id='socialShareOverlay';wrap.className='social-share-overlay';
  const encodedUrl=encodeURIComponent(url),encodedTitle=encodeURIComponent(title),encodedText=encodeURIComponent(`${text||title} ${url}`);
  wrap.innerHTML=`<div class="social-share-sheet"><button type="button" class="presentation-close" data-close-social aria-label="Cerrar">×</button><div class="kicker">COMPARTIR ANKARAGOAT</div><h3>${escapeHtml(title)}</h3><div class="social-share-grid">
    <button type="button" class="social-share-item" data-native-social><i class="fi fi-rr-share"></i><span>Compartir</span></button>
    <a class="social-share-item" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}"><b>f</b><span>Facebook</span></a>
    <a class="social-share-item" target="_blank" rel="noopener" href="https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedTitle}"><b>r/</b><span>Reddit</span></a>
    <a class="social-share-item" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}"><b>𝕏</b><span>X</span></a>
    <a class="social-share-item" target="_blank" rel="noopener" href="https://wa.me/?text=${encodedText}"><b>W</b><span>WhatsApp</span></a>
    <a class="social-share-item" target="_blank" rel="noopener" href="https://t.me/share/url?url=${encodedUrl}&text=${encodedTitle}"><b>T</b><span>Telegram</span></a>
    <button type="button" class="social-share-item" data-instagram-share><i class="fi fi-rr-camera"></i><span>Instagram</span></button>
    <button type="button" class="social-share-item" data-copy-social><i class="fi fi-rr-copy-alt"></i><span>Copiar link</span></button>
  </div><div class="share-url-preview">${escapeHtml(url)}</div></div>`;
  document.body.appendChild(wrap);
  const close=()=>wrap.remove();
  wrap.querySelector('[data-close-social]').onclick=close;
  wrap.addEventListener('click',e=>{if(e.target===wrap)close()});
  const copy=async(message='Enlace copiado.')=>{try{await navigator.clipboard.writeText(url)}catch{}toast(message)};
  wrap.querySelector('[data-copy-social]').onclick=()=>copy();
  const native=async()=>{if(navigator.share){try{await navigator.share({title,text,url});return}catch(e){if(e?.name==='AbortError')return}}await copy('Enlace copiado para compartir.')};
  wrap.querySelector('[data-native-social]').onclick=native;
  wrap.querySelector('[data-instagram-share]').onclick=async()=>{if(navigator.share){await native();return}await copy('Enlace copiado. Pegalo en Instagram para compartirlo.')};
}

async function shareMatchPublicPage(gameId,title='Resultado AnkaraGOAT'){
  try{const url=await createPublicShare('match',gameId);openSocialShareSheet({url,title,text:'Mirá cómo terminó este partido en AnkaraGOAT.'})}catch(e){toast(e.message)}
}
async function shareTournamentPublicPage(tournamentId,title='Torneo AnkaraGOAT'){
  try{const url=await createPublicShare('tournament',tournamentId);openSocialShareSheet({url,title,text:'Mirá las posiciones y estadísticas de este torneo en AnkaraGOAT.'})}catch(e){toast(e.message)}
}

/* =========================================================
   PRESENTACIÓN DE PARTIDOS Y PODIOS
   ========================================================= */

const matchContextCache = new Map();
const matchIntroOpening = new Set();
const matchResultOpening = new Set();
const tournamentPodiumShown = new Set();
let pendingTournamentPodium = null;

function presentationKey(kind, id) {
  return `ankara_${kind}_${Number(id)}`;
}

function presentationWasShown(kind, id) {
  try { return sessionStorage.getItem(presentationKey(kind, id)) === '1'; }
  catch { return false; }
}

function markPresentationShown(kind, id) {
  try { sessionStorage.setItem(presentationKey(kind, id), '1'); } catch {}
}

function teamDisplayName(player) {
  return player?.team?.name || player?.username || 'Equipo';
}

function crestMarkup(player, className = '') {
  const team = player?.team || {};
  if (team.crestUrl) {
    return `<img class="${className}" src="${escapeHtml(team.crestUrl)}" alt="Escudo de ${escapeHtml(teamDisplayName(player))}">`;
  }
  return `<span class="${className} crest-fallback" aria-hidden="true">${escapeHtml(team.crestEmoji || '⚽')}</span>`;
}

function formatTournamentPhase(match, tie = null) {
  if (tie) return tie.groupCode ? `Desempate · Grupo ${tie.groupCode}` : 'Desempate de posiciones';
  if (!match) return 'Partido de campeonato';
  const stage = String(match.stage || '').toLowerCase();
  const round = Number(match.roundNo || 0);
  const labels = {
    preliminary: 'Ronda preliminar',
    quarterfinal: 'Cuartos de final',
    semifinal: 'Semifinal',
    final: 'Final'
  };
  if (stage === 'league' || stage === 'shared_league') return round ? `Fecha ${round}` : 'Liga';
  if (stage === 'group') return `${match.groupCode ? `Grupo ${match.groupCode}` : 'Fase de grupos'}${round ? ` · Fecha ${round}` : ''}`;
  if (labels[stage]) return labels[stage];
  if (stage.startsWith('round_of_')) return `Ronda de ${stage.replace('round_of_', '')}`;
  return stage ? stage.replaceAll('_', ' ') : (round ? `Fecha ${round}` : 'Partido');
}

function loadMatchPresentationContext(game = currentGame) {
  if (!game?.tournamentId) return Promise.resolve({ tournament: null, match: null, tie: null, competition: null, phase: null });
  const key = Number(game.id);
  if (matchContextCache.has(key)) return matchContextCache.get(key);
  const promise = (async () => {
    try {
      const tournament = await api(`/api/tournaments/${game.tournamentId}`);
      const match = (tournament.Matches || []).find(m => Number(m.id) === Number(game.matchId)) || null;
      const tieId = Number(game.state?.settings?.standingsTiebreakId || currentState?.settings?.standingsTiebreakId || 0);
      const tie = tieId ? (tournament.StandingsTiebreaks || []).find(t => Number(t.id) === tieId) || null : null;
      return {
        tournament,
        match,
        tie,
        competition: tournament.name || null,
        phase: formatTournamentPhase(match, tie)
      };
    } catch {
      return { tournament: null, match: null, tie: null, competition: null, phase: null };
    }
  })();
  matchContextCache.set(key, promise);
  return promise;
}

function addCelebrationStreamers() {
  const layer = $('[data-celebration-confetti]', modalRoot);
  if (!layer || layer.childElementCount) return;
  const compact = window.matchMedia('(max-width: 768px)').matches;
  const count = compact ? 30 : 58;
  const colors = ['#62efd4', '#a5ff18', '#f7c651', '#ffb85a', '#fff0c2'];
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i += 1) {
    const piece = document.createElement('span');
    piece.className = `match-confetti-piece${i % 5 === 0 ? ' streamer' : ''}`;
    piece.style.setProperty('--c-left', `${Math.random() * 100}%`);
    piece.style.setProperty('--c-delay', `${Math.random() * .8}s`);
    piece.style.setProperty('--c-duration', `${1.8 + Math.random() * 1.7}s`);
    piece.style.setProperty('--c-drift', `${-90 + Math.random() * 180}px`);
    piece.style.setProperty('--c-rotate', `${220 + Math.random() * 760}deg`);
    piece.style.setProperty('--c-color', colors[Math.floor(Math.random() * colors.length)]);
    frag.appendChild(piece);
  }
  layer.appendChild(frag);
}

function contextCardsMarkup(context) {
  if (!context?.competition) return '';
  return `<div class="match-context-grid">
    <div class="match-context-card">${icon('tournament')}<span><small>Campeonato</small><b>${escapeHtml(context.competition)}</b></span></div>
    <div class="match-context-card">${icon('room')}<span><small>Fase / fecha</small><b>${escapeHtml(context.phase || 'Partido')}</b></span></div>
  </div>`;
}

function teamCardsMarkup(players) {
  return (players || []).map(p => `<div class="match-team-card">
    <div class="match-team-crest" style="--team-color:${escapeHtml(p.team?.primaryColor || '#173c31')}">${crestMarkup(p)}</div>
    <div class="match-team-copy"><small>${escapeHtml(p.username || 'Jugador')}</small><b>${escapeHtml(teamDisplayName(p))}</b></div>
  </div>`).join('');
}

async function showMatchIntroModal() {
  const game = currentGame;
  const state = currentState;
  if (!game || !state || game.status !== 'running' || state.phase !== 'roll' || Number(state.turnNo || 1) !== 1) return;
  const gameId = Number(game.id);
  if (presentationWasShown('match_intro', gameId) || matchIntroOpening.has(gameId)) return;
  if (modalRoot.children.length) return;
  matchIntroOpening.add(gameId);
  markPresentationShown('match_intro', gameId);

  const players = (state.players || []).filter(p => p.active !== false);
  const manyTeams = players.length > 4 ? ' many-teams' : '';
  modalRoot.innerHTML = `<div class="modal-backdrop match-presentation-backdrop" data-modal-kind="match_intro">
    <div class="modal match-presentation-modal match-start-modal${manyTeams}">
      <div class="match-celebration-layer" data-celebration-confetti></div>
      <button type="button" class="presentation-close" data-close-presentation aria-label="Cerrar">×</button>
      <div class="match-presentation-art"><img src="${ASSETS.player}" alt="" aria-hidden="true"></div>
      <div class="match-presentation-shell">
        <img class="match-modal-logo" src="${ASSETS.logo}" alt="Ankara GOAT">
        <div class="eyebrow">SE ENFRENTAN</div>
        <h2 class="match-modal-title">Todo listo para salir a la cancha</h2>
        <div id="matchIntroContext"></div>
        <div class="matchup-teams" data-count="${players.length}">${teamCardsMarkup(players)}</div>
        <div class="match-team-count">${icon('team')} Hasta 8 equipos por enfrentamiento</div>
        <div class="match-modal-actions"><button type="button" class="btn primary large" id="continueMatchIntro">Continuar</button></div>
      </div>
    </div>
  </div>`;
  addCelebrationStreamers();
  const close = () => {
    closeModal();
    startRollCountdown({reset:true});
  };
  $('#continueMatchIntro')?.addEventListener('click', close);
  $('[data-close-presentation]', modalRoot)?.addEventListener('click', close);

  const context = await loadMatchPresentationContext(game);
  if ($('[data-modal-kind="match_intro"]', modalRoot)) {
    const holder = $('#matchIntroContext', modalRoot);
    if (holder) holder.innerHTML = contextCardsMarkup(context);
  }
  matchIntroOpening.delete(gameId);
}

function finalRanking(players) {
  const finishers = (players || []).filter(p => p.finishOrder != null).sort((a,b) => Number(a.finishOrder) - Number(b.finishOrder));
  const others = (players || []).filter(p => p.finishOrder == null).sort((a,b) =>
    Number(b.eliminatedAtTurn || 0) - Number(a.eliminatedAtTurn || 0)
    || Number(b.forfeitedAt || 0) - Number(a.forfeitedAt || 0)
    || Number(b.position || 0) - Number(a.position || 0)
  );
  return [...finishers, ...others].map((p, index) => ({ ...p, resolvedPosition: index + 1 }));
}

function podiumEntriesMarkup(entries, championship = false) {
  return (entries || []).map((entry, index) => {
    // En una partida, `position` es el casillero del tablero. El puesto final
    // calculado está en `resolvedPosition`. En el podio de torneo sí usamos `position`.
    const position = Number(
      championship
        ? (entry.position || entry.resolvedPosition || index + 1)
        : (entry.resolvedPosition || entry.finishOrder || index + 1)
    );
    const player = entry.player || entry;
    const team = entry.team || player.team || {};
    const normalizedPlayer = entry.player ? player : { ...player, team };
    const name = team.name || player.team?.name || player.username || entry.username || `Equipo ${position}`;
    return `<div class="podium-entry rank-${Math.min(position, 3)}${championship && position === 1 ? ' champion' : ''}">
      <div class="podium-place"><span>${position}°</span><small>PUESTO</small></div>
      <div class="podium-crest" style="--team-color:${escapeHtml(team.primaryColor || '#173c31')}">${crestMarkup({ ...normalizedPlayer, team: { ...team, crestUrl: team.crestUrl, crestEmoji: team.crestEmoji } })}</div>
      <b>${escapeHtml(name)}</b>
    </div>`;
  }).join('');
}

async function showMatchResultModal() {
  const game = currentGame;
  const state = currentState;
  if (!game || !state || !(game.status === 'finished' || state.phase === 'finished')) return;
  const gameId = Number(game.id);
  if (presentationWasShown('match_result', gameId) || matchResultOpening.has(gameId)) return;
  if (modalRoot.children.length || animatingMovement) {
    setTimeout(showMatchResultModal, 180);
    return;
  }
  matchResultOpening.add(gameId);
  markPresentationShown('match_result', gameId);

  const ranking = finalRanking(state.players || []);
  const mine = ranking.find(p => Number(p.userId) === Number(me?.id));
  const isWinner = Number(mine?.resolvedPosition || mine?.finishOrder || 0) === 1;
  const context = await loadMatchPresentationContext(game);
  let tournamentFinal = null;
  if (game.tournamentId && isWinner) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      tournamentFinal = await fetchTournamentPodium(game.tournamentId);
      if (tournamentFinal?.finished) break;
      await new Promise(resolve => setTimeout(resolve, 180));
    }
    if (tournamentFinal?.finished) pendingTournamentPodium = tournamentFinal;
  }
  const isChampion = !!(tournamentFinal?.finished && Number(tournamentFinal.podium?.[0]?.userId) === Number(me?.id));
  const playWinnerCelebrationAudio = isWinner && !isChampion;
  if (!isChampion && !playWinnerCelebrationAudio) await playMatchFinishedChant();

  const limit = ranking.length >= 3 ? 3 : Math.min(2, ranking.length);
  const top = ranking.slice(0, limit);
  modalRoot.innerHTML = `<div class="modal-backdrop match-presentation-backdrop" data-modal-kind="match_result">
    <div class="modal match-presentation-modal match-result-modal">
      <div class="match-celebration-layer" data-celebration-confetti></div>
      <button type="button" class="presentation-close" data-close-presentation aria-label="Cerrar">×</button>
      <div class="match-presentation-art"><img src="${ASSETS.player}" alt="" aria-hidden="true"></div>
      <div class="match-presentation-shell">
        <img class="match-modal-logo" src="${ASSETS.logo}" alt="Ankara GOAT">
        <div class="eyebrow">PARTIDO FINALIZADO</div>
        <h2 class="match-modal-title">Posiciones finales</h2>
        <div id="matchResultContext">${contextCardsMarkup(context)}</div>
        <div class="match-podium" data-count="${top.length}">${podiumEntriesMarkup(top)}</div>
        <div class="match-modal-actions compact-actions"><button type="button" class="match-icon-btn" id="shareMatchResult" aria-label="Compartir resultado" title="Compartir resultado"><i class="fi fi-rr-share"></i></button><button type="button" class="match-icon-btn primary" id="continueMatchResult" aria-label="Continuar" title="Continuar"><i class="fi fi-rr-arrow-right"></i></button></div>
      </div>
    </div>
  </div>`;
  addCelebrationStreamers();

  if (playWinnerCelebrationAudio) {
    clearStadiumSuppressions();
    const winnerAudio = document.createElement('video');
    winnerAudio.src = WINNER_VIDEO_URL;
    winnerAudio.preload = 'auto';
    winnerAudio.playsInline = true;
    winnerAudio.volume = globalAudioVolume;
    winnerAudio.muted = globalAudioPaused;
    winnerVideoEl = winnerAudio;
    stadiumResumeAt = Number(stadiumChantsAudio.currentTime || 0);
    stadiumChantsAudio.pause();
    introChantsAudio.pause();
    championSongAudio.pause();
    platformAudioPhase = 'winner_video';
    if(backgroundVideoEl)backgroundVideoEl.muted=true;
    const afterWinnerAudio = () => { if (winnerVideoEl === winnerAudio) winnerVideoEl = null; startStadiumAmbience(); };
    winnerAudio.addEventListener('ended', afterWinnerAudio, { once:true });
    winnerAudio.addEventListener('error', afterWinnerAudio, { once:true });
    winnerAudio.play().catch(afterWinnerAudio);
  }

  const closeAndContinue = () => {
    const interruptedWinnerAudio = !!winnerVideoEl;
    if (winnerVideoEl) {
      try { winnerVideoEl.pause(); } catch {}
      winnerVideoEl = null;
    }
    closeModal();
    if (pendingTournamentPodium) {
      const data = pendingTournamentPodium;
      pendingTournamentPodium = null;
      setTimeout(() => showTournamentPodiumModal(data), 80);
    } else if (interruptedWinnerAudio) {
      startStadiumAmbience();
    }
  };
  $('#shareMatchResult')?.addEventListener('click',()=>shareMatchPublicPage(game.id, game.name||'Partida AnkaraGOAT'));
  $('#continueMatchResult')?.addEventListener('click', closeAndContinue);
  $('[data-close-presentation]', modalRoot)?.addEventListener('click', closeAndContinue);
  matchResultOpening.delete(gameId);
}

async function fetchTournamentPodium(tournamentId) {
  try { return await api(`/api/tournaments/${Number(tournamentId)}/podium`); }
  catch { return null; }
}

function showTournamentPodiumModal(data) {
  if (!data?.finished || !Array.isArray(data.podium) || !data.podium.length) return;
  const tournamentId = Number(data.tournamentId);
  if (tournamentPodiumShown.has(tournamentId) || presentationWasShown('tournament_podium', tournamentId)) return;
  if (modalRoot.children.length) {
    pendingTournamentPodium = data;
    return;
  }
  tournamentPodiumShown.add(tournamentId);
  markPresentationShown('tournament_podium', tournamentId);
  const podium = data.podium.slice(0, data.participantCount >= 3 ? 3 : 2);
  playChampionSong();
  modalRoot.innerHTML = `<div class="modal-backdrop match-presentation-backdrop" data-modal-kind="tournament_podium">
    <div class="modal match-presentation-modal tournament-podium-modal champion-cinematic-modal">
      <video class="champion-modal-video" src="${WINNER_VIDEO_URL}" autoplay muted loop playsinline preload="auto" aria-hidden="true"></video>
      <div class="champion-modal-overlay" aria-hidden="true"></div>
      <div class="match-celebration-layer" data-celebration-confetti></div>
      <button type="button" class="presentation-close" data-close-presentation aria-label="Cerrar">×</button>
      <div class="match-presentation-shell champion-presentation-shell">
        <img class="match-modal-logo" src="${ASSETS.logo}" alt="Ankara GOAT">
        <div class="eyebrow">CAMPEONATO FINALIZADO</div>
        <h2 class="match-modal-title">Campeón del torneo</h2>
        <div class="match-context-grid single-context"><div class="match-context-card">${icon('tournament')}<span><small>Campeonato</small><b>${escapeHtml(data.tournamentName || 'Torneo Ankara GOAT')}</b></span></div></div>
        <div class="champion-trophy">${data.trophyAsset?`<img src="${escapeHtml(data.trophyAsset)}" alt="Trofeo">`:``}</div><div class="match-podium tournament-podium" data-count="${podium.length}">${podiumEntriesMarkup(podium, true)}</div>
        <div class="match-modal-actions"><button type="button" class="btn" id="shareTournamentPodium">Compartir campeón</button><button type="button" class="btn primary large" id="continueTournamentPodium">Continuar</button></div>
      </div>
    </div>
  </div>`;
  addCelebrationStreamers();
  const close = () => {stopChampionSong();closeModal()};
  $('#shareTournamentPodium')?.addEventListener('click',()=>shareTournamentPublicPage(data.tournamentId, data.tournamentName||'Torneo AnkaraGOAT'));
  $('#continueTournamentPodium')?.addEventListener('click', close);
  $('[data-close-presentation]', modalRoot)?.addEventListener('click', close);
}

async function handleTournamentUpdated(data) {
  const tournamentId = Number(data?.tournamentId || 0);
  if (!tournamentId) return;
  const podium = await fetchTournamentPodium(tournamentId);
  if (!podium?.finished) return;
  if ($('[data-modal-kind="match_result"]', modalRoot) || matchResultOpening.has(Number(currentGame?.id))) {
    pendingTournamentPodium = podium;
    return;
  }
  if (currentGame?.status === 'finished' || currentState?.phase === 'finished') showTournamentPodiumModal(podium);
}

function scheduleGamePresentationCheck() {
  Promise.resolve().then(() => {
    if (!currentGame || !currentState) return;
    if (currentGame.status === 'running' && currentState.phase === 'roll' && Number(currentState.turnNo || 1) === 1) {
      showMatchIntroModal();
    }
    if (currentGame.status === 'finished' || currentState.phase === 'finished') {
      showMatchResultModal();
    }
  });
}

function syncTransientModalWithGameState(nextState,nextStatus){
  const kind=$('[data-modal-kind]',modalRoot)?.dataset?.modalKind;
  if(!kind)return;
  const phase=nextState?.phase;
  const finished=nextStatus==='finished'||phase==='finished';
  if(finished&&['question','answer_result','roulette','dice_roll'].includes(kind)){closeModal();return}
  if(kind==='dice_roll'&&phase!=='roll'){closeModal();return}
  // Los rivales pueden seguir viendo la pregunta durante los 7 s del resultado,
  // pero debe desaparecer en cuanto el servidor pasa al movimiento/turno siguiente.
  if(kind==='question'&&!['answering','result_pending'].includes(phase))closeModal();
  if(kind==='answer_result'&&phase!=='result_pending')closeModal();
}

function applyGameState(payload){
  currentGame={...currentGame,...payload,status:payload.status};
  currentState=payload.state;
  currentSpectatorCount=payload.spectatorCount||0;
  syncTransientModalWithGameState(currentState,currentGame.status);
  if(currentState?.turnToken!==lastTurnToken){
    lastTurnToken=currentState?.turnToken||null;
    clientActionPending=false;
  }
  renderGame();
  if(currentState?.phase==='video_pending'&&currentState.pendingVideo) playPendingCellVideo(currentState.pendingVideo);
  startRollCountdown();
  scheduleGamePresentationCheck();
  if(currentState?.phase==='answering'&&currentState.currentQuestion&&!$('[data-modal-kind="question"]',modalRoot)){openQuestion({...currentState.currentQuestion,activeUserId:currentState.players?.[currentState.turnIndex]?.userId})}
}


function flushQueuedGameState(){
  if(!queuedGameState)return;
  const q=queuedGameState;
  queuedGameState=null;
  applyGameState(q);
}

function releaseDeferredTurnUi(){
  if(queuedQuestion){
    const q=queuedQuestion;
    queuedQuestion=null;
    if(!q?.turnToken || q.turnToken===currentState?.turnToken) openQuestion(q);
  }
  if(queuedRouletteReady){
    const p=queuedRouletteReady;
    queuedRouletteReady=null;
    openRouletteReady(p);
  }
}

function connectSocket(){
  if(socket)return;
  socket=io({auth:{token},transports:['websocket'],upgrade:false,reconnection:true,reconnectionAttempts:Infinity,reconnectionDelay:500,reconnectionDelayMax:5000});
  socket.on('connect',()=>{if(currentGame){const event=currentSpectator?'watch_game':'join_game';socket.emit(event,{gameId:currentGame.id},ack=>{if(!ack?.ok){toast(ack.error);if(/abandono|venció/i.test(ack.error||'')){resetGameViewState();renderDashboard()}}else if(ack.recovered||currentState)toast('Conexión restaurada.')})}});
  socket.on('connect_error',e=>toast(e.message));
  socket.on('game_state',payload=>{
    if(!currentGame||Number(payload.gameId)!==Number(currentGame.id))return;
    currentSpectatorCount=payload.spectatorCount||0;
    if(animatingMovement){queuedGameState=payload;return}
    applyGameState(payload);
  });
  socket.on('dice_result',async data=>{
    if(!currentGame)return;
    if(data.turnToken && currentState?.turnToken && data.turnToken!==currentState.turnToken)return;
    animatingMovement=true;
    await finishDiceAnimation(data.roll);
    toast(`${playerName(data.userId)} sacó ${data.roll}`);
    animatingMovement=false;
    flushQueuedGameState();
    releaseDeferredTurnUi();
  });
  socket.on('question',q=>{
    cleanupCellVideo();
    if(animatingMovement){queuedQuestion=q;return}
    if(q.turnToken && currentState?.turnToken && q.turnToken!==currentState.turnToken)return;
    openQuestion(q);
  });
  socket.on('roulette_state',p=>{if(!currentGame||Number(p.gameId)!==Number(currentGame.id))return;const pr=p.pendingRoulette||{};if(p.phase==='roulette_wait')openRouletteReady({gameId:p.gameId,ownerUserId:pr.ownerUserId,spinDeadline:pr.spinDeadline,turnToken:currentState?.turnToken});else if(p.phase==='roulette_spinning')showRouletteSpin({gameId:p.gameId,ownerUserId:pr.ownerUserId,durationMs:Math.max(500,Number(pr.revealAt||Date.now())-Date.now()),effect:pr.effect});});
  socket.on('roulette_ready',p=>{if(!currentGame||Number(p.gameId)!==Number(currentGame.id))return;if(animatingMovement){queuedRouletteReady=p;return}openRouletteReady(p)});
  socket.on('roulette_spin',p=>{if(currentGame&&Number(p.gameId)===Number(currentGame.id))showRouletteSpin(p)});
  socket.on('roulette_result',p=>{if(currentGame&&Number(p.gameId)===Number(currentGame.id))showRouletteResult(p)});
  socket.on('roulette_target_required',p=>{if(currentGame&&Number(p.gameId)===Number(currentGame.id)&&Number(p.ownerUserId||me.id)===Number(me.id))openRouletteTarget(p)});

  socket.on('answer_result',r=>{
    if(!currentGame)return;
    if(r.correct)playCorrectSound();else playIncorrectSound();
    if(r.surprise?.applied&&r.surprise?.polarity==='positive')setTimeout(playPositiveSurpriseSound,220);
    if(r.surprise?.applied&&r.surprise?.polarity==='negative')setTimeout(playNegativeSurpriseSound,220);
    showAnswerResult(r);
  });
  socket.on('movement_reveal',async r=>{
    if(!currentGame)return;
    const turnModal=$('[data-modal-kind]',modalRoot)?.dataset?.modalKind;
    if(['question','answer_result'].includes(turnModal)) closeModal();
    animatingMovement=true;
    await animateAnswerResult(r);
    animatingMovement=false;
    flushQueuedGameState();
    if(r?.surprise?.type==='roulette'&&r?.movementCommitted&&!currentSpectator&&Number(r.userId)===Number(me.id)){
      socket.emit('roulette_movement_complete',{gameId:currentGame.id,turnToken:r.turnToken||currentState?.turnToken},ack=>{if(!ack?.ok&&!/todavía no puede|turno anterior/i.test(ack?.error||''))console.warn('[roulette movement complete]',ack?.error)});
    }
    releaseDeferredTurnUi();
  });
  socket.on('player_disconnected',data=>{
    if(currentGame&&Number(data.gameId)===Number(currentGame.id))toast(`${data.username||'Un jugador'} se desconectó. Tiene 60 segundos para volver.`);
  });
  socket.on('player_reconnected',data=>{
    if(currentGame&&Number(data.gameId)===Number(currentGame.id))toast(`${playerName(data.userId)} volvió a la partida.`);
  });
  socket.on('player_forfeited',data=>{
    if(currentGame&&Number(data.gameId)===Number(currentGame.id))toast(`${playerName(data.userId)} perdió por abandono.`);
  });
  socket.on('forfeit_loss',async data=>{
    closeModal();
    toast(data.message||'Perdiste la partida por no volver dentro del minuto.');
    await refreshMe();
    if(!currentGame)renderDashboard();
  });
  socket.on('forfeit_win',async()=>{
    toast('Tu rival no volvió dentro del minuto. Ganaste la partida por abandono.');
    await refreshMe();
  });
  socket.on('chat_message',m=>{if(currentGame&&Number(m.gameId)===Number(currentGame.id)){chatMessages.push(m);chatMessages=chatMessages.slice(-80);renderChatOnly()}});
  socket.on('reaction',r=>{if(currentGame){toast(`${r.username}: ${r.reaction}`)}});
  socket.on('ranking_updated',async()=>{await refreshMe();toast('Ranking ELO actualizado.');});
  socket.on('tournament_updated',data=>{handleTournamentUpdated(data);});
}

async function enterGame(game,spectator=false){
  currentGame=game;
  currentState=game.state;
  preloadBoardVideos();
  currentSpectator=spectator;
  lastTurnToken=currentState?.turnToken||null;
  clientActionPending=false;
  queuedGameState=null;
  queuedQuestion=null;
  connectSocket();
  const event=spectator?'watch_game':'join_game';
  socket.emit(event,{gameId:game.id},ack=>{if(!ack?.ok){toast(ack?.error||'No se pudo entrar');resetGameViewState();renderDashboard()}else if(ack.rejoined){toast('Volviste a tiempo. La partida continúa.')}});
  chatMessages=await api(`/api/games/${game.id}/chat`).catch(()=>[]);
  renderGame();
  if(currentState?.phase==='video_pending'&&currentState.pendingVideo)playPendingCellVideo(currentState.pendingVideo);
  startRollCountdown();
  scheduleGamePresentationCheck();
}

function visualPositionFor(p){
  return p.position;
}

function renderGame(){
  setView('game');
  if(!currentGame||!currentState)return;if(currentGame.status==='lobby'||currentState.phase==='lobby')return renderLobby();
  const current=currentState.players?.[currentState.turnIndex],isMyTurn=current?.userId===me.id&&!currentSpectator;
  const absentPlayers=(currentState.players||[]).filter(p=>p.active&&currentState.presence?.[String(p.userId)]?.connected===false);
  const hasAbsence=absentPlayers.length>0;
  const mePlayer=(currentState.players||[]).find(p=>Number(p.userId)===Number(me.id));
  const finished=currentGame.status==='finished'||currentState.phase==='finished';
  const canRoll=isMyTurn&&currentState.phase==='roll'&&!clientActionPending&&!hasAbsence;
  const canArchive=finished&&currentState.finishReason==='forfeit'&&!currentSpectator;
  const resultBanner=finished?`<section class="card" style="margin-bottom:14px"><div class="kicker">RESULTADO</div><h2>${mePlayer?.finishOrder===1?'🏆 Ganaste':'Partida terminada'}</h2><p class="muted">${currentState.finishReason==='forfeit'?(mePlayer?.finishOrder===1?'Victoria por abandono. El resultado cuenta para tu ELO.':mePlayer?.forfeitedAt?'Derrota por abandono.':'Partida definida por abandono.'):'Resultado registrado.'}</p>${canArchive?'<button class="btn ghost" id="archiveGame">Eliminar de mis partidas</button>':''}</section>`:'';
  const absenceBanner=hasAbsence?`<section class="card" style="margin-bottom:14px"><div class="kicker">PARTIDA EN PAUSA</div><p style="margin-bottom:0">${absentPlayers.map(p=>`${escapeHtml(p.username)} está desconectado · <b data-grace-deadline="${Number(currentState.presence[String(p.userId)].graceDeadline)}"></b>`).join('<br>')}</p><small class="muted">Si no vuelve dentro del minuto, perderá por abandono.</small></section>`:'';

  app.innerHTML=`<div class="dashboard-head"><div><div class="eyebrow">SALA ${escapeHtml(currentGame.roomCode||'')} ${currentSpectator?'· ESPECTADOR':''}</div><h1>${escapeHtml(currentGame.name||'Partida')}</h1><div class="muted">👁 ${currentSpectatorCount} espectadores · Modo ${escapeHtml(currentState.settings?.questionMode||'ankara')}</div></div><button class="btn ghost" id="leaveGame">${finished?'← Volver al vestuario':'← Salir de la partida'}</button></div>
    ${resultBanner}${absenceBanner}<div class="game-grid"><div class="board" id="board">${renderBoardCells()}</div><aside class="sidepanel">
      <section class="card turn"><div class="kicker">Turno ${currentState.turnNo||1}</div><h2>${escapeHtml(current?.username||'—')}</h2><div class="muted">${hasAbsence?'Esperando reconexión...':currentState.phase==='roll'?'Dado en pantalla':phaseLabel(currentState.phase)}</div></section>
      <section class="card"><div class="kicker">Tabla de carrera</div><div class="list" style="margin-top:10px">${[...(currentState.players||[])].sort((a,b)=>visualPositionFor(b)-visualPositionFor(a)).map(p=>`<div class="player-row"><span class="dot" style="background:${escapeHtml(p.team?.primaryColor||'#888')}"></span><span style="flex:1">${escapeHtml(p.username)}<small class="muted"> · ${escapeHtml(p.team?.name||'Equipo')}</small></span><b>${p.finishOrder?`#${p.finishOrder}`:`${visualPositionFor(p)}/${currentState.boardSize}`}</b>${p.userId!==me.id&&p.team?.id?`<button type="button" class="mini-report" data-report-team="${p.team.id}" title="Reportar nombre de equipo">⚑</button>`:''}${currentState.presence?.[String(p.userId)]?.connected===false?'<span title="Desconectado">⏳</span>':''}${!p.active?'<span>☠</span>':''}</div>`).join('')}</div></section>
      <section class="card chat-card"><div class="kicker">Chat y reacciones</div><div id="chatList" class="chat-list">${renderChatMessages()}</div><form id="chatForm" class="chat-form"><input id="chatInput" maxlength="500" ${currentState.phase==='answering'?'disabled':''} placeholder="${currentState.phase==='answering'?'Chat pausado durante la pregunta':'Escribí algo...'}"><button class="btn" ${currentState.phase==='answering'?'disabled':''}>Enviar</button></form><div class="reactions">${['⚽','🐐','🔥','😂','👏','😱','🟥','🟨'].map(r=>`<button data-reaction="${r}">${r}</button>`).join('')}</div></section>
    </aside></div>`;
  $('#leaveGame').onclick=leaveCurrentGame;
  $('#archiveGame')?.addEventListener('click',archiveCurrentGame);
  startPresenceCountdowns();
  startRollCountdown();
  $('#chatForm').onsubmit=e=>{e.preventDefault();const body=$('#chatInput').value.trim();if(!body)return;socket.emit('chat_message',{gameId:currentGame.id,body},ack=>{if(!ack?.ok)toast(ack.error);else $('#chatInput').value=''})};
  $$('[data-reaction]').forEach(b=>b.onclick=()=>socket.emit('reaction',{gameId:currentGame.id,reaction:b.dataset.reaction}));
  bindModerationReportButtons();
}

function renderLobby(){
  setView('lobby');
  const isOrg=currentState.organizerId===me.id;
  app.innerHTML=`<div class="dashboard-head"><div><div class="eyebrow">VESTUARIO DE PARTIDA ${currentSpectator?'· ESPECTADOR':''}</div><h1>${escapeHtml(currentGame.name)}</h1></div><button class="btn ghost" id="backDash">← Salir de la vista</button></div>
    <div class="grid two"><section class="card"><div class="kicker">Compartí este código</div><div class="room-code">${escapeHtml(currentGame.roomCode)}</div><p class="muted">Los jugadores pueden entrar con el código. Los espectadores usan “Mirar”.</p>${isOrg?'<button class="btn primary large" id="startGame" style="width:100%">Comenzar partida</button>':'<div class="empty">Esperando que el organizador inicie.</div>'}</section>
    <section class="card"><div class="kicker">Jugadores</div><div class="list" style="margin-top:12px">${(currentState.players||[]).map((p,i)=>`<div class="list-item"><span>${escapeHtml(p.team?.crestEmoji||'⚽')} <b>${escapeHtml(p.username)}</b></span><span>${i===0?'👑':''}</span></div>`).join('')}</div><p class="help">Mínimo 2 · Máximo 8 · Modo ${escapeHtml(currentState.settings?.questionMode||'ankara')}</p></section></div>`;
  $('#backDash').onclick=leaveCurrentGame;
  $('#startGame')?.addEventListener('click',async()=>{try{const g=await api(`/api/games/${currentGame.id}/start`,{method:'POST',body:'{}'});currentGame=g;currentState=g.state;const event=currentSpectator?'watch_game':'join_game';socket.emit(event,{gameId:g.id});renderGame();scheduleGamePresentationCheck()}catch(e){toast(e.message)}});
}


function preloadBoardVideos(){
  if(window.__ankaraVideoPreloadStarted)return;
  window.__ankaraVideoPreloadStarted=true;
  window.__ankaraVideoPreloads=[];
  [...CELL_VIDEO_URLS,SPECIAL_CELL_VIDEO_URL,FINAL_CELL_VIDEO_URL].forEach(src=>{
    const video=document.createElement('video');
    video.preload='auto';video.muted=true;video.playsInline=true;video.src=src;
    video.load();window.__ankaraVideoPreloads.push(video);
  });
  const winner=document.createElement('video');winner.preload='metadata';winner.src=WINNER_VIDEO_URL;winner.load();window.__ankaraVideoPreloads.push(winner);
}

function seededNumber(seed){
  let h=2166136261;
  for(let i=0;i<String(seed).length;i++){h^=String(seed).charCodeAt(i);h=Math.imul(h,16777619)}
  return ()=>{h+=0x6D2B79F5;let t=h;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296};
}

function boardVideoAssignments(){
  const gameId=Number(currentGame?.id||0),size=Number(currentState?.boardSize||0);
  const surpriseKey=Object.keys(currentState?.surprises||{}).sort((a,b)=>Number(a)-Number(b)).join(',');
  const cacheKey=`${gameId}:${size}:${surpriseKey}`;
  if(boardVideoAssignmentsCache?.key===cacheKey)return boardVideoAssignmentsCache.map;
  const random=seededNumber(cacheKey),map={};
  for(let pos=1;pos<=size;pos++){
    if(pos===size){map[pos]=FINAL_CELL_VIDEO_URL;continue}
    if(currentState?.surprises?.[pos]){map[pos]=SPECIAL_CELL_VIDEO_URL;continue}
    const forbidden=new Set();
    const left=map[pos-1],above=map[pos-5];
    if(left&&left!==SPECIAL_CELL_VIDEO_URL)forbidden.add(left);
    if(above&&above!==SPECIAL_CELL_VIDEO_URL)forbidden.add(above);
    const choices=CELL_VIDEO_URLS.filter(url=>!forbidden.has(url));
    map[pos]=choices[Math.floor(random()*choices.length)]||CELL_VIDEO_URLS[0];
  }
  boardVideoAssignmentsCache={key:cacheKey,map};
  return map;
}

function cleanupCellVideo(){
  stopSpecialLockerAudio();
  if(!activeCellVideo)return;
  clearTimeout(activeCellVideo.timer);
  try{activeCellVideo.video?.pause()}catch{}
  activeCellVideo.video?.remove();
  activeCellVideo=null;
}

function playPendingCellVideo(pending){
  if(!currentGame||!currentState||currentState.phase!=='video_pending'||!pending?.turnToken)return;
  const key=`${currentGame.id}:${pending.turnToken}`;
  if(activeCellVideo?.key===key&&activeCellVideo.video?.isConnected)return;
  cleanupCellVideo();
  const destination=Number(pending.destination||currentState.pendingMove?.to||0);
  if(!destination)return;
  const cell=document.querySelector(`.cell[data-pos="${destination}"]`);
  if(!cell)return;
  const isFinalCell=destination===Number(currentState.boardSize||0);
  const isSpecialCell=!!pending.special&&!isFinalCell;
  const src=isFinalCell?FINAL_CELL_VIDEO_URL:(isSpecialCell?SPECIAL_CELL_VIDEO_URL:boardVideoAssignments()[destination]);
  if(!src)return;
  const video=document.createElement('video');
  video.className='cell-landing-video';video.src=src;video.muted=true;video.playsInline=true;video.preload='auto';
  if(isFinalCell)video.playbackRate=1.3;
  if(isSpecialCell)playSpecialLockerAudio();
  video.setAttribute('aria-hidden','true');cell.appendChild(video);
  const mine=Number(pending.ownerUserId||currentState.players?.[currentState.turnIndex]?.userId)===Number(me?.id)&&!currentSpectator;
  let done=false;
  const finish=()=>{
    if(done)return;done=true;
    if(isSpecialCell)stopSpecialLockerAudio();
    const record=activeCellVideo;if(record?.key===key)clearTimeout(record.timer);
    try{video.pause()}catch{}video.remove();
    if(mine&&socket?.connected){
      const timer=setTimeout(()=>{
        if(activeCellVideo?.key===key)activeCellVideo=null;
        socket.emit('cell_video_done',{gameId:currentGame.id,turnToken:pending.turnToken},ack=>{if(!ack?.ok&&!/video|turno|fase/i.test(ack?.error||''))toast(ack.error)})
      },1000);
      activeCellVideo={key,video:null,timer};
    }else activeCellVideo=null;
  };
  const maxVideoWait=isFinalCell?30000:9500;
  const remaining=Math.max(300,Math.min(maxVideoWait,Number(pending.deadline||Date.now()+maxVideoWait)-Date.now()+100));
  const timer=setTimeout(finish,remaining);
  activeCellVideo={key,video,timer};
  video.addEventListener('ended',finish,{once:true});video.addEventListener('error',finish,{once:true});
  video.play().catch(finish);
}

function renderBoardCells(){
  const cells=[];
  const showPending=['question_pending','answering'].includes(currentState.phase);
  const pendingDestination=showPending?currentState.pendingMove?.to:null;
  for(let pos=1;pos<=currentState.boardSize;pos++){
    const players=(currentState.players||[]).filter(p=>p.active&&visualPositionFor(p)===pos);
    const tokens=players.map((p,i)=>{
      const team=p.team||{};
      const content=team.crestUrl
        ? `<img src="${escapeHtml(team.crestUrl)}" alt="Escudo de ${escapeHtml(p.username)}">`
        : `<span class="token-emoji">${escapeHtml(team.crestEmoji||'⚽')}</span>`;
      return `<span class="token" title="${escapeHtml(p.username)}" style="background:${escapeHtml(team.primaryColor||'#888')};z-index:${i+1}">${content}</span>`;
    }).join('');
    cells.push(`<div class="cell ${currentState.surprises?.[pos]?'surprise':''} ${pos===currentState.boardSize?'finish':''} ${pendingDestination===pos?'pending-destination':''}" data-pos="${pos}"><span>${pos}</span><div class="tokens">${tokens}</div></div>`);
  }
  return cells.join('');
}

function phaseLabel(p){return({moving:'Calculando destino',video_pending:'Reproduciendo jugada',question_pending:'Preparando pregunta',roulette_reveal:'Moviendo ficha al casillero especial',roulette_wait:'Ruleta lista',roulette_spinning:'La ruleta está girando',roulette_target:'Eligiendo rival',answering:'El jugador del turno está respondiendo',result_pending:'Mostrando resultado',turn_end:'Cerrando turno',finished:'Partida terminada'})[p]||p}
function playerName(id){return currentState?.players?.find(p=>Number(p.userId)===Number(id))?.username||'Jugador'}

async function animatePlayersTo(targetRows){
  if(!currentState||!Array.isArray(targetRows))return;
  const targetMap=new Map(targetRows.map(p=>[Number(p.userId),p]));
  const transitions=[];

  for(const existing of currentState.players||[]){
    const target=targetMap.get(Number(existing.userId));
    if(!target)continue;
    const from=Number(existing.position)||0;
    const to=Number(target.position)||0;
    if(from!==to)transitions.push({userId:Number(existing.userId),from,to,distance:Math.abs(to-from)});
  }

  const maxDistance=Math.max(0,...transitions.map(t=>t.distance));
  const delay=500;

  for(let step=1;step<=maxDistance;step++){
    let moved=false;
    for(const t of transitions){
      if(step>t.distance)continue;
      const player=currentState.players.find(p=>Number(p.userId)===t.userId);
      if(!player)continue;
      const direction=t.to>t.from?1:-1;
      player.position=t.from+direction*Math.min(step,t.distance);
      moved=true;
    }
    if(moved){
      renderGame();
      playTokenStep();
      await new Promise(r=>setTimeout(r,delay));
    }
  }

  currentState.players=currentState.players.map(existing=>{
    const target=targetMap.get(Number(existing.userId));
    return target?{...existing,...target}:existing;
  });
  renderGame();
}

async function animateAnswerResult(result){
  if(!currentState)return;
  try{
  const before=Array.isArray(result.before)?result.before:[];
  const after=Array.isArray(result.after)?result.after:[];
  const beforeMap=new Map(before.map(p=>[Number(p.userId),p]));

  currentState.pendingMove=null;
  currentState.pendingSurprise=null;
  currentState.players=currentState.players.map(existing=>{
    const b=beforeMap.get(Number(existing.userId));
    return b?{...existing,...b}:existing;
  });
  renderGame();

  // Primero se muestra el avance ganado por acertar la pregunta.
  if(result.movementCommitted){
    const stage=before.map(p=>Number(p.userId)===Number(result.userId)?{...p,position:Number(result.attemptedTo)}:{...p});
    await animatePlayersTo(stage);
  }

  // Después se representa el efecto del ítem especial (avance extra, retroceso,
  // intercambio, retrocesos, etc.). Si no hubo ruleta, no habrá otro movimiento.
  await animatePlayersTo(after);
  } finally {}
}

function openQuestion(q){
  cleanupCellVideo();
  clearInterval(questionTick); questionTick=null;
  let selected=null; const isCat=q.type==='categorization'; const activeId=Number(q.activeUserId||currentState?.players?.[currentState?.turnIndex]?.userId); const canAnswer=!currentSpectator&&activeId===Number(me.id);
  const activeName=playerName(activeId); const advance=Math.max(0,Number(q.potentialAdvance??((currentState?.pendingMove?.to||0)-(currentState?.pendingMove?.from||0)))||0);
  const specialInfo=q.specialPosition?`<div class="policy-box"><b>Casillero especial</b><small>${canAnswer?'Si acertás y llegás al casillero, se activará la ruleta.':`${escapeHtml(activeName)} puede activar la ruleta si acierta.`}</small></div>`:`<div class="policy-box"><b>${canAnswer?'Avance en juego':`${escapeHtml(activeName)} está respondiendo`}</b><small>${canAnswer?`Si respondés bien, avanzás <b>${advance} casillero${advance===1?'':'s'}</b>.`:'Podés ver la pregunta y el temporizador, pero sólo quien tiene el turno puede responder.'}</small></div>`;
  modalRoot.innerHTML=`<div class="modal-backdrop" data-modal-kind="question"><div class="modal"><div class="question-meta"><span class="tier tier-${q.tier||2}">T${q.tier||2}</span><span>${isCat?'CATEGORIZACIÓN · 20 SEGUNDOS':'MÚLTIPLE CHOICE · 10 SEGUNDOS'}</span>${q.knowledgeArea?`<span>${escapeHtml(q.knowledgeArea)}</span>`:''}</div>${specialInfo}<h2>${escapeHtml(q.prompt)}</h2><div class="timer"><div id="timerBar"></div></div><div id="answerArea" class="${canAnswer?'':'read-only-question'}">${isCat?renderCategorization(q):`<div class="options">${(q.options||[]).map((o,i)=>`<button type="button" class="option" data-option="${i}" ${canAnswer?'':'disabled'}>${escapeHtml(o)}</button>`).join('')}</div>`}</div>${canAnswer?'<button class="btn primary large" id="submitAnswer" style="width:100%;margin-top:16px">Responder</button>':'<div class="empty" style="margin-top:16px">Esperando la respuesta del jugador del turno…</div>'}</div></div>`;
  if(canAnswer&&!isCat)$$('[data-option]',modalRoot).forEach(btn=>btn.onclick=()=>{$$('[data-option]',modalRoot).forEach(b=>b.classList.remove('selected'));btn.classList.add('selected');selected=q.options[Number(btn.dataset.option)]});
  if(canAnswer&&isCat)$$('[data-cat-item]',modalRoot).forEach(x=>x.disabled=false);
  if(canAnswer)$('#submitAnswer').onclick=()=>{const answer=isCat?collectCategorization(q):selected;if(answer==null||(isCat&&Object.values(answer).some(v=>!v)))return toast('Completá la respuesta.');const button=$('#submitAnswer');button.disabled=true;socket.emit('submit_answer',{gameId:currentGame.id,questionId:q.id,turnToken:q.turnToken||currentState?.turnToken,answer},ack=>{if(!ack?.ok){toast(ack.error);button.disabled=false}})};
  if(!canAnswer&&isCat)$$('[data-cat-item]',modalRoot).forEach(x=>x.disabled=true);
  const total=isCat?20000:10000; const update=()=>{const left=Math.max(0,Number(q.deadline)-Date.now());const bar=$('#timerBar');if(bar)bar.style.width=`${Math.min(100,left/total*100)}%`;if(left<=0){clearInterval(questionTick);questionTick=null;$('#submitAnswer')?.setAttribute('disabled','disabled')}}; update();questionTick=setInterval(update,200);
}

function renderCategorization(q){const categories=q.options?.categories||[],items=q.options?.items||[];return `<div>${items.map(item=>`<div class="categorize-row"><b>${escapeHtml(item)}</b><select data-cat-item="${escapeHtml(item)}"><option value="">Elegí...</option>${categories.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}</select></div>`).join('')}</div>`}
function collectCategorization(){const out={};$$('[data-cat-item]',modalRoot).forEach(s=>out[s.dataset.catItem]=s.value);return out}


function rouletteEffectText(e){const n=Number(e?.amount||0);const map={advance:`Avanzás ${n}`,retreat:`Retrocedés ${n}`,retreat_target:`Un rival retrocede ${n}`,swap:'Intercambiás posición con un rival',eliminate_target:'Eliminás a un rival de este tablero',eliminate_self:'Quedás eliminado de este tablero',points_take:'Le quitás 5 puntos a un rival',points_loss:'Perdés 5 puntos',end_board:'Finaliza este tablero'};return map[e?.type]||'Efecto especial'}
function rouletteEffectKey(e){return `${e?.type||'unknown'}:${Number(e?.amount||0)}`}
function rouletteShortLabel(e){const n=Number(e?.amount||0);const map={advance:`Avanzá ${n}`,retreat:`Retrocedé ${n}`,retreat_target:`Rival -${n}`,swap:'Intercambio',eliminate_target:'Eliminá rival',eliminate_self:'Te eliminás',points_take:'Quitar 5 pts',points_loss:'Perdés 5 pts',end_board:'Fin del tablero'};return map[e?.type]||'Sorpresa'}
function currentRouletteOptions(){
  const options=[
    ...[1,2,3,4,5,6].map(amount=>({type:'advance',amount})),
    ...[1,2,3,4,5,6].map(amount=>({type:'retreat',amount})),
    ...[1,2,3,4].map(amount=>({type:'retreat_target',amount})),
    {type:'swap'},{type:'eliminate_target'},{type:'eliminate_self'}
  ];
  if(currentState?.settings?.isTournament) options.push({type:'end_board'});
  if(currentState?.settings?.competitionPointsEnabled){options.push({type:'points_take',amount:5}); options.push({type:'points_loss',amount:5});}
  return options.map((effect,index)=>({effect,index,key:rouletteEffectKey(effect),label:rouletteShortLabel(effect)}));
}
function roulettePalette(index){const colors=['#0a2722','#114036','#1a5e4f','#6b5d1f','#8d7330','#133631','#21493f','#3d6328'];return colors[index%colors.length]}
function polarPoint(cx,cy,r,deg){const rad=(deg*Math.PI)/180;return{x:cx+Math.cos(rad)*r,y:cy+Math.sin(rad)*r}}
function sectorPath(cx,cy,r,startDeg,endDeg){const start=polarPoint(cx,cy,r,startDeg), end=polarPoint(cx,cy,r,endDeg); const large=(endDeg-startDeg)>180?1:0; return `M ${cx} ${cy} L ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)} Z`;}
function buildRouletteSvg(options, selectedKey=null){
  const size=420,cx=210,cy=210,r=196,seg=360/options.length;
  const sectors=options.map((opt,i)=>{const start=-90+(i*seg), end=start+seg; const mid=start+(seg/2); const pt=polarPoint(cx,cy,126,mid); const normalized=((mid%360)+360)%360; let rotation=mid; if(normalized>90&&normalized<270) rotation+=180; const classes=['roulette-svg-sector']; if(selectedKey&&opt.key===selectedKey) classes.push('selected'); return `<g class="${classes.join(' ')}"><path d="${sectorPath(cx,cy,r,start,end)}" fill="${roulettePalette(i)}"></path><text x="${pt.x.toFixed(2)}" y="${pt.y.toFixed(2)}" text-anchor="middle" dominant-baseline="middle" transform="rotate(${rotation.toFixed(2)} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)})">${escapeHtml(opt.label)}</text></g>`;}).join('');
  return `<svg class="roulette-svg" viewBox="0 0 ${size} ${size}" aria-hidden="true"><defs><filter id="rouletteGlow"><feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="rgba(0,0,0,.45)"/></filter></defs><circle cx="${cx}" cy="${cy}" r="${r+6}" fill="rgba(0,0,0,.42)"></circle><g filter="url(#rouletteGlow)">${sectors}</g><circle cx="${cx}" cy="${cy}" r="76" fill="rgba(3,12,10,.92)" stroke="rgba(247,198,81,.85)" stroke-width="6"></circle><circle cx="${cx}" cy="${cy}" r="52" fill="rgba(12,45,39,.96)" stroke="rgba(98,239,212,.20)" stroke-width="2"></circle></svg>`;
}
function rouletteWheelMarkup({selectedKey=null, ownerName='', spinning=false, mine=false, countdownLabel='', resultText='', footerText='', showPlay=false}={}){
  const options=currentRouletteOptions();
  const ownerText=mine?'Tenés 4 segundos para girar. Si no, comenzará sola.':`${escapeHtml(ownerName)} debe girar la ruleta.`;
  return `<div class="roulette-stage">${showPlay&&mine?`<button type="button" class="roulette-play-corner" id="roulettePlayButton" aria-label="Girar ruleta" title="Girar ruleta">${icon('play')}</button>`:''}<div class="roulette-pointer" aria-hidden="true"></div><div class="roulette-wheel-shell ${spinning?'is-spinning':''}"><div class="roulette-wheel-track" id="rouletteWheelTrack">${buildRouletteSvg(options,selectedKey)}</div><div class="roulette-hub"><img src="${ASSETS.logo}" alt="AnkaraGOAT"></div></div><div class="roulette-copy"><p class="muted roulette-help">${countdownLabel||ownerText}</p>${resultText?`<div class="roulette-result"><b>${escapeHtml(resultText)}</b></div>`:''}${footerText?`<p class="muted">${footerText}</p>`:''}</div></div>`;
}
function rouletteShell(content){modalRoot.innerHTML=`<div class="modal-backdrop roulette-backdrop" data-modal-kind="roulette"><div class="modal roulette-modal"><div class="kicker">CASILLERO ESPECIAL</div><h2>Ruleta AnkaraGOAT</h2>${content}</div></div>`}
function stopRouletteAudioFx(){rouletteSpinSoundTimers.forEach(t=>clearTimeout(t)); rouletteSpinSoundTimers=[];}
function playRouletteTick(progress=0){if(globalAudioPaused)return; const ctx=audioContext(); if(!ctx)return; tone(310-(progress*115),0.040,0.120,'square'); tone(145-(progress*35),0.050,0.070,'triangle',0.004)}
function startRouletteAudioFx(durationMs=10000){stopRouletteAudioFx(); audioContext(); const started=performance.now(); const tick=()=>{const elapsed=performance.now()-started; const progress=Math.min(1,elapsed/durationMs); playRouletteTick(progress); if(progress>=1)return; const interval=52+(progress*185); const id=setTimeout(tick, interval); rouletteSpinSoundTimers.push(id)}; tick()}
function landingRotationForKey(key){const options=currentRouletteOptions(); const index=Math.max(0,options.findIndex(opt=>opt.key===key)); const seg=360/options.length; return (360*7)-((index+.5)*seg)}
function applyRouletteRotation(rotation,{animate=false,durationMs=10000}={}){const track=$('#rouletteWheelTrack',modalRoot); if(!track)return;if(rouletteAnimationFrame)cancelAnimationFrame(rouletteAnimationFrame);rouletteAnimationFrame=null;track.style.transition='none';if(!animate){track.style.transform=`rotate(${rotation}deg)`;return}const startRotation=0;const started=performance.now();const total=Math.max(250,Number(durationMs)||10000);const animateFrame=now=>{const elapsed=Math.min(total,now-started);const t=Math.min(1,elapsed/total);const eased=1-Math.pow(1-t,2);const current=startRotation+((rotation-startRotation)*eased);track.style.transform=`rotate(${current}deg)`;if(t<1){rouletteAnimationFrame=requestAnimationFrame(animateFrame)}else{track.style.transform=`rotate(${rotation}deg)`;rouletteAnimationFrame=null}};rouletteAnimationFrame=requestAnimationFrame(animateFrame)}
function bindRouletteSpinButton(turnToken){const btn=$('#roulettePlayButton',modalRoot); if(!btn)return;let sent=false;const spinNow=e=>{e?.preventDefault?.();if(sent||btn.disabled)return;sent=true;btn.disabled=true;audioContext();playRouletteTick(0);socket.emit('spin_roulette',{gameId:currentGame.id,turnToken:turnToken||currentState?.turnToken},ack=>{if(!ack?.ok){sent=false;toast(ack.error);btn.disabled=false}})};btn.addEventListener('pointerdown',spinNow,{passive:false});btn.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){spinNow(e)}})}
function openRouletteReady(p){
  clearInterval(rouletteCountdownTimer); rouletteCountdownTimer=null; stopRouletteAudioFx(); rouletteVisualRotation=0;
  const mine=Number(p.ownerUserId)===Number(me.id)&&!currentSpectator; const deadline=Number(p.spinDeadline||0);
  rouletteShell(rouletteWheelMarkup({ownerName:playerName(p.ownerUserId),mine,showPlay:mine,countdownLabel:mine?'Tenés 4 segundos para girar. Si no, comenzará sola.':`${escapeHtml(playerName(p.ownerUserId))} debe girar la ruleta.`}));
  applyRouletteRotation(rouletteVisualRotation,{animate:false});
  if(mine) bindRouletteSpinButton(p.turnToken||currentState?.turnToken);
  const help=$('.roulette-help',modalRoot);
  const renderCountdown=()=>{ if(!mine||!help)return; const left=Math.max(0,deadline-Date.now()); const secs=Math.ceil(left/1000); help.textContent=left>0?`Tenés ${secs} segundo${secs===1?'':'s'} para girar. Si no, comenzará sola.`:'Comenzando ruleta…'; if(left<=0){clearInterval(rouletteCountdownTimer); rouletteCountdownTimer=null; const btn=$('#roulettePlayButton',modalRoot); if(btn) btn.disabled=true; }};
  if(mine&&deadline){renderCountdown(); rouletteCountdownTimer=setInterval(renderCountdown,200)}
}
function showRouletteSpin(p){
  clearInterval(rouletteCountdownTimer); rouletteCountdownTimer=null;
  const effectKey=rouletteEffectKey(p.effect||{});
  rouletteShell(rouletteWheelMarkup({ownerName:playerName(p.ownerUserId),spinning:true,footerText:'La ruleta está girando…'}));
  const targetRotation=landingRotationForKey(effectKey);
  rouletteVisualRotation=targetRotation;
  applyRouletteRotation(targetRotation,{animate:true,durationMs:Number(p.durationMs)||10000});
  startRouletteAudioFx(Number(p.durationMs)||10000);
  clearTimeout(rouletteUiTimer); rouletteUiTimer=setTimeout(()=>{},Number(p.durationMs)||10000)
}
function showRouletteResult(p){
  stopRouletteAudioFx();
  const e=p.effect||{}; const key=rouletteEffectKey(e);
  rouletteShell(rouletteWheelMarkup({selectedKey:key,resultText:rouletteEffectText(e),footerText:p.requiresTarget?'Esperando que el jugador elija un rival…':'El efecto se aplicó para todos en tiempo real.'}));
  applyRouletteRotation(landingRotationForKey(key),{animate:false});
  if(!p.requiresTarget)setTimeout(()=>{
    if($('[data-modal-kind="roulette"]',modalRoot))closeModal();
    if(currentGame?.status==='running'&&currentState?.phase==='roll')startRollCountdown({reset:true});
  },2200)
}
function openRouletteTarget(p){
  const key=rouletteEffectKey(p.effect||{});
  rouletteShell(`${rouletteWheelMarkup({selectedKey:key,resultText:rouletteEffectText(p.effect),footerText:'Elegí el rival que va a recibir el efecto.'})}<div class="roulette-targets">${(p.targets||[]).map(t=>`<button class="btn" data-roulette-target="${t.userId}">${escapeHtml(t.username||playerName(t.userId))}</button>`).join('')}</div>`);
  applyRouletteRotation(landingRotationForKey(key),{animate:false});
  $$('[data-roulette-target]',modalRoot).forEach(b=>b.onclick=()=>{b.disabled=true;socket.emit('roulette_target',{gameId:currentGame.id,targetUserId:Number(b.dataset.rouletteTarget),turnToken:p.turnToken||currentState?.turnToken},ack=>{if(!ack?.ok){toast(ack.error);b.disabled=false}})})
}


function casillerosText(value){
  const n=Math.max(0,Number(value)||0);
  return `${n} casillero${n===1?'':'s'}`;
}

function describeSurpriseResult(r){
  const s=r?.surprise;
  if(!s?.type)return null;
  const from=Number(r.from)||0;
  const attempted=Number(r.attemptedTo)||from;
  const finalPosition=Number(r.finalPosition);
  const baseAdvance=Math.max(0,attempted-from);
  const target=s.targetUserId?playerName(s.targetUserId):'un contrincante';

  if(s.type==='roulette'&&r.correct){
    return {label:'CASILLERO ESPECIAL',text:'Respuesta correcta: llegaste al casillero especial. La ruleta se activará al continuar.'};
  }

  if(!s.applied){
    return {label:'CASILLERO ESPECIAL',text:'El casillero especial no se activó porque no llegaste efectivamente a esa posición.'};
  }

  switch(s.type){
    case 'advance': {
      const extra=Math.max(0,finalPosition-attempted);
      return {
        label:'EFECTO POSITIVO',
        text:extra>0
          ? `Avanzaste ${casillerosText(baseAdvance)} por tu respuesta y además avanzás ${casillerosText(extra)} porque te tocó un casillero especial.`
          : 'El casillero especial de avance se activó, pero ya no podía llevarte más allá de la meta.'
      };
    }
    case 'retreat': {
      const retreat=Math.max(0,attempted-finalPosition);
      return {
        label:'EFECTO NEGATIVO',
        text:finalPosition===from&&baseAdvance>0
          ? `Avanzaste ${casillerosText(baseAdvance)}, pero te tocó un casillero especial que hizo que volvieras a tu posición anterior.`
          : `Avanzaste ${casillerosText(baseAdvance)}, pero el casillero especial te hace retroceder ${casillerosText(retreat)}. Quedás en el casillero ${finalPosition}.`
      };
    }
    case 'reset':
      return {label:'EFECTO NEGATIVO',text:`Avanzaste ${casillerosText(baseAdvance)}, pero el casillero especial te devuelve al inicio del tablero.`};
    case 'swap':
      return {label:s.polarity==='positive'?'EFECTO POSITIVO':s.polarity==='negative'?'EFECTO NEGATIVO':'CASILLERO ESPECIAL',text:`Te tocó un casillero especial e intercambiás posición con ${escapeHtml(target)}.`};
    case 'eliminate':
      return {label:'EFECTO POSITIVO',text:`Te tocó un casillero especial y ${escapeHtml(target)} queda eliminado de la partida.`};
    default:
      return {label:'CASILLERO ESPECIAL',text:'El casillero especial se activó.'};
  }
}

function showAnswerResult(r){
  if(Number(r.userId)!==Number(me.id)){toast(`${playerName(r.userId)} ${r.correct?'acertó':'falló'}.`);return}
  clearInterval(questionTick);questionTick=null;
  clearInterval(resultTick);resultTick=null;
  const answer=typeof r.correctAnswer==='string'?r.correctAnswer:JSON.stringify(r.correctAnswer);
  const surprise=describeSurpriseResult(r);
  const surpriseHtml=surprise?`<div class="policy-box"><b>${escapeHtml(surprise.label)}</b><small>${surprise.text}</small></div>`:'';
  modalRoot.innerHTML=`<div class="modal-backdrop" data-modal-kind="answer_result"><div class="modal result-modal"><div class="result-icon">${r.correct?'✅':'❌'}</div><div class="eyebrow">${r.correct?'AVANCE CONFIRMADO':'TE QUEDÁS DONDE ESTABAS'}</div><h2>${r.correct?'¡Correcto!':'Incorrecto'}</h2><p class="muted">Respuesta correcta: <b>${escapeHtml(answer)}</b></p>${surpriseHtml}<div class="chips"><span class="chip">T${r.tier}</span><span class="chip">${escapeHtml(r.knowledgeArea||'General')}</span><span class="chip">+${r.xpEarned||0} XP</span>${r.level?`<span class="chip">Nivel ${r.level}</span>`:''}</div><p class="muted small" style="margin-top:16px">La ficha se moverá en <b id="resultCountdown">7</b> s.</p><div class="timer"><div id="resultTimerBar"></div></div><div class="actions end" style="margin-top:20px"><button class="btn ghost" id="reportQuestion">Reportar pregunta</button><button class="btn primary" id="continueAfterAnswer">Siguiente</button></div></div></div>`;

  const deadline=Number(r.resultDeadline)||Date.now()+7000;
  const updateResultCountdown=()=>{
    const left=Math.max(0,deadline-Date.now());
    const label=$('#resultCountdown',modalRoot);
    const bar=$('#resultTimerBar',modalRoot);
    if(label)label.textContent=String(Math.ceil(left/1000));
    if(bar)bar.style.width=`${Math.min(100,left/7000*100)}%`;
    if(left<=0){clearInterval(resultTick);resultTick=null}
  };
  updateResultCountdown();
  resultTick=setInterval(updateResultCountdown,100);

  $('#continueAfterAnswer').onclick=()=>{
    const button=$('#continueAfterAnswer');
    button.disabled=true;
    socket.emit('continue_after_answer',{gameId:currentGame.id,turnToken:r.turnToken},ack=>{
      if(!ack?.ok){
        if($('[data-modal-kind="answer_result"]',modalRoot))button.disabled=false;
        if(!/No hay un resultado pendiente/i.test(ack?.error||''))toast(ack?.error||'No se pudo continuar.');
      }
    });
  };
  $('#reportQuestion').onclick=()=>openReportQuestion(r.questionId);
}

function openReportQuestion(questionId){clearInterval(resultTick);resultTick=null;modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="kicker">REVISIÓN COMUNITARIA</div><h2>Reportar pregunta</h2><div class="field"><label>Motivo</label><select id="reportReason"><option value="incorrect_answer">Respuesta incorrecta</option><option value="outdated">Desactualizada</option><option value="ambiguous">Ambigua</option><option value="typo">Error de redacción</option><option value="other">Otro</option></select></div><div class="field"><label>Detalle</label><textarea id="reportDetails" maxlength="1000" placeholder="Contanos qué habría que revisar"></textarea></div><div class="actions end"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="sendReport">Enviar</button></div></div></div>`;$('[data-close]',modalRoot).onclick=closeModal;$('#sendReport').onclick=async()=>{try{await api(`/api/questions/${questionId}/report`,{method:'POST',body:JSON.stringify({reason:$('#reportReason').value,details:$('#reportDetails').value})});closeModal();toast('Reporte enviado. Gracias.')}catch(e){toast(e.message)}}}

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
  setView('profile');
  try{
    const data=await api('/api/profile/me'),u=data.user,summary=data.summary||{};
    const historyHtml=(data.history||[]).map(h=>{
      const delta=Number(h.eloAfter||0)-Number(h.eloBefore||0);
      const reason=h.resultReason==='forfeit'?(h.won?'Victoria por abandono':h.forfeited?'Derrota por abandono':'Partida con abandono'):(h.won?'Victoria':'Derrota');
      return `<div class="list-item" style="align-items:flex-start"><span style="flex:1"><b>${escapeHtml(h.Game?.name||'Partida')}</b><br><small class="muted">${new Date(h.createdAt).toLocaleDateString()} · ${reason}</small><br><small>✓ ${h.correctAnswers} correctas · ✗ ${h.incorrectAnswers} incorrectas · ${h.accuracy}% precisión</small></span><span style="text-align:right"><b class="result-pill ${h.won?'won':'lost'}">${h.won?'GANADA':'PERDIDA'}</b><br><small class="muted">ELO ${h.eloBefore}→${h.eloAfter} (${delta>=0?'+':''}${delta})</small></span></div>`;
    }).join('');
    app.innerHTML=`${pageBanner({eyebrow:'Perfil de conocimiento', title: escapeHtml(u.Team?.name||u.username), subtitle:`Nivel <b>${u.level}</b> · ELO <b>${u.eloRating}</b> · ${u.xp} XP`, player:false, compact:true, actions:'<button class=\"btn ghost\" id=\"backDash\">← Vestuario</button>'})}
      <div class="profile-stats-strip"><div class="chips profile-stats-chips"><span class="chip stat-win">🏆 ${summary.wins||0} ganadas</span><span class="chip stat-loss">✗ ${summary.losses||0} perdidas</span><span class="chip stat-correct">✓ ${summary.correctAnswers||0} correctas</span><span class="chip stat-incorrect">✗ ${summary.incorrectAnswers||0} incorrectas</span></div></div>
      <div class="grid two profile-grid"><section class="card profile-panel"><div class="kicker">Mapa de conocimiento</div><h2>¿Dónde sos fuerte?</h2><div class="knowledge-list">${(data.knowledge||[]).map(s=>`<div class="knowledge-row"><div><span>${escapeHtml(s.label)}</span><small>${s.correct}/${s.answered}</small></div><div class="knowledge-bar"><i style="width:${Math.min(100,s.accuracy)}%"></i></div><b>${Math.round(s.accuracy)}%</b></div>`).join('')||'<div class="empty">Respondé preguntas para construir tu perfil.</div>'}</div></section>
      <section class="card profile-panel history-panel"><div class="kicker">Historial</div><h2>Últimas partidas</h2><div class="list history-scroll">${historyHtml||'<div class="empty">Todavía no terminaste partidas.</div>'}</div></section></div><div class="grid two profile-grid" style="margin-top:16px"><section class="card profile-panel"><div class="kicker">Vitrina</div><h2>Trofeos</h2><div class="trophy-grid">${(data.trophies||[]).map(t=>`<div class="trophy-card"><img src="${escapeHtml(t.asset||'')}" alt="${escapeHtml(t.trophyType)}"><b>${escapeHtml(t.tournamentName||t.trophyType)}</b><small>${new Date(t.awardedAt).toLocaleDateString()}</small></div>`).join('')||'<div class="empty">Todavía no ganaste trofeos.</div>'}</div></section><section class="card profile-panel"><div class="kicker">Campeonatos</div><h2>Historial de torneos</h2><div class="list history-scroll">${(data.tournamentHistory||[]).map(t=>`<a class="list-item" href="#" data-profile-tournament="${t.tournamentId}"><span><b>${escapeHtml(t.name)}</b><br><small class="muted">${escapeHtml(t.formatLabel||formatLabel(t.format))} · ${t.participants} participantes · ${escapeHtml(t.statusLabel||t.status)}</small></span><span><b>${t.position?`${t.position}°`:'—'}</b><br><small>${escapeHtml(t.trophy?.trophyType?String(t.trophy.trophyType).replaceAll('_',' '):'')}</small></span></a>`).join('')||'<div class="empty">Sin torneos todavía.</div>'}</div></section></div>`;
    $$('[data-profile-tournament]').forEach(a=>a.onclick=e=>{e.preventDefault();openTournamentDetails(a.dataset.profileTournament)});
    $('#backDash').onclick=()=>token?renderDashboard():renderLanding();
  }catch(e){toast(e.message)}
}


async function renderLeaderboard(){
  setView('leaderboard');
  try{
    const rows=await api('/api/leaderboard');
    app.innerHTML=`${pageBanner({eyebrow:'Ranking global', title:'GOAT Ladder', subtitle:'Los auténticos cracks del conocimiento futbolero.', player:false, compact:true, actions:'<button class=\"btn ghost\" id=\"backDash\">← Vestuario</button>'})}<section class="card"><div class="list leaderboard">${rows.map((u,i)=>`<div class="list-item"><span class="rank">#${i+1}</span><span class="crest mini" style="background:${escapeHtml(u.Team?.primaryColor||'#333')}">${escapeHtml(u.Team?.crestEmoji||'⚽')}</span><span style="flex:1"><b>${escapeHtml(u.Team?.name||u.username)}</b><br><small class="muted">${escapeHtml(u.username)} · Nivel ${u.level}</small></span><b>${u.eloRating} ELO</b></div>`).join('')}</div></section>`;
    $('#backDash').onclick=()=>token?renderDashboard():renderLanding();
  }catch(e){toast(e.message)}
}


document.querySelector('[data-go-home]').addEventListener('click',async()=>{
  if(token&&currentGame){await leaveCurrentGame();return}
  token?renderDashboard():renderLanding();
});
window.addEventListener('beforeunload',e=>{
  if(currentGame?.status==='running'&&!currentSpectator&&currentState?.phase!=='finished'){
    e.preventDefault();
    e.returnValue='';
  }
});
applyGlobalAudioVolume();
startPlatformAudio();
initIntroAnimation();
renderSessionActions();if(token)bootDashboard();else renderLanding();
