/* Mismo reproductor (controles, volumen y fuente) que el vestuario. */
(()=>{const audio=new Audio('https://media.ankaragoat.fun/audio/chants/stadium_chants.mp3');
audio.loop=true;audio.preload='none';let volume=Number(localStorage.getItem('ankara_audio_volume'));
if(!Number.isFinite(volume))volume=.35;volume=Math.max(0,Math.min(1,volume));
let paused=localStorage.getItem('ankara_audio_paused')==='1';
const button=document.querySelector('#audioToggle');const value=document.querySelector('#fedAudioVolume');
const refresh=()=>{audio.volume=volume;if(value)value.textContent=`${Math.round(volume*100)}%`;
if(button){button.textContent=paused?'▶':'⏸';button.title=paused?'Reanudar ambientación':'Pausar ambientación';button.setAttribute('aria-label',button.title);}localStorage.setItem('ankara_audio_volume',String(volume));localStorage.setItem('ankara_audio_paused',paused?'1':'0');};
const toggle=()=>{paused=!paused;refresh();if(paused)audio.pause();else audio.play().catch(()=>{paused=true;refresh();});};
button?.addEventListener('click',toggle);document.querySelector('#audioVolumeDown')?.addEventListener('click',()=>{volume=Math.round(Math.max(0,volume-.1)*10)/10;refresh();});
document.querySelector('#audioVolumeUp')?.addEventListener('click',()=>{volume=Math.round(Math.min(1,volume+.1)*10)/10;refresh();});
refresh();document.addEventListener('visibilitychange',()=>{if(document.hidden)audio.pause();else if(!paused)audio.play().catch(()=>{});});
if(!paused)document.addEventListener('pointerdown',()=>audio.play().catch(()=>{}),{once:true});
})();
