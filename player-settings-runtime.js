(() => {
  if (window.__YUME_PLAYER_SETTINGS_RUNTIME_V1) return;
  window.__YUME_PLAYER_SETTINGS_RUNTIME_V1 = true;

  const $ = s => document.querySelector(s);
  const EXTRA_KEY = 'yume-player-settings-v2';
  const STATE_KEY = 'yume-player-state-v2';
  const DEFAULTS = { autoHideControls:true, hideDelay:2600, rememberQuality:true, rememberSpeed:true, rememberVolume:true, pauseWhenHidden:false };
  let prefs = readPrefs();
  let saved = readState();
  let hideTimer = 0;
  let currentVideo = null;

  function readPrefs(){ try{return{...DEFAULTS,...(JSON.parse(localStorage.getItem(EXTRA_KEY)||'{}')||{})};}catch{return{...DEFAULTS};} }
  function readState(){ try{return JSON.parse(localStorage.getItem(STATE_KEY)||'{}')||{};}catch{return{};} }
  function writeState(){ try{localStorage.setItem(STATE_KEY,JSON.stringify(saved));}catch{} }

  function installStyle(){
    if ($('#yumeRuntimeHideStyle')) return;
    const st=document.createElement('style');st.id='yumeRuntimeHideStyle';st.textContent=`
      .yume-player.v9-controls-hidden{cursor:none!important}
      .yume-player.v9-controls-hidden .player-controls,
      .yume-player.v9-controls-hidden .player-topline,
      .yume-player.v9-controls-hidden #yumeXLayer{opacity:0!important;pointer-events:none!important}
      .yume-player .player-controls,.yume-player .player-topline,.yume-player #yumeXLayer{transition:opacity .22s ease!important}
    `;document.head.appendChild(st);
  }

  function activeVideo(){ return $('#yumeExternalVideo') || $('#yumeVideo'); }
  function showControls(){ const p=$('#yumePlayer'); if(!p)return; p.classList.remove('v9-controls-hidden'); clearTimeout(hideTimer); }
  function scheduleHide(){
    clearTimeout(hideTimer);
    const p=$('#yumePlayer'), v=activeVideo();
    if(!p||!v||prefs.autoHideControls===false||v.paused||v.ended){showControls();return;}
    hideTimer=setTimeout(()=>{ if(!v.paused&&!v.ended&&prefs.autoHideControls!==false)p.classList.add('v9-controls-hidden'); }, Math.max(900,Number(prefs.hideDelay)||2600));
  }
  function revealThenSchedule(){showControls();scheduleHide();}

  function applyToVideo(video){
    if(!video||video.dataset.yumePrefsBound==='1')return;
    video.dataset.yumePrefsBound='1';
    currentVideo=video;
    if(prefs.rememberVolume!==false && Number.isFinite(Number(saved.volume))) video.volume=Math.max(0,Math.min(1,Number(saved.volume)));
    if(prefs.rememberSpeed!==false && Number.isFinite(Number(saved.speed)) && Number(saved.speed)>0) video.playbackRate=Number(saved.speed);
    video.addEventListener('play',scheduleHide);
    video.addEventListener('pause',showControls);
    video.addEventListener('ended',showControls);
    video.addEventListener('volumechange',()=>{if(prefs.rememberVolume!==false){saved.volume=video.volume;saved.muted=video.muted;writeState();}});
    video.addEventListener('ratechange',()=>{if(prefs.rememberSpeed!==false){saved.speed=video.playbackRate;writeState();}});
    if(prefs.rememberVolume!==false && saved.muted===true) video.muted=true;
  }

  function bindPlayer(){
    const player=$('#yumePlayer');if(!player)return;
    if(player.dataset.yumeAutoHideBound!=='1'){
      player.dataset.yumeAutoHideBound='1';
      ['mousemove','mousedown','touchstart','pointermove'].forEach(ev=>player.addEventListener(ev,revealThenSchedule,{passive:true}));
      player.addEventListener('mouseleave',scheduleHide);
    }
    applyToVideo(activeVideo());
    scheduleHide();
  }

  function applySavedQuality(){
    if(prefs.rememberQuality===false||!saved.quality)return;
    const select=$('#qualitySelect');if(!select)return;
    const option=[...select.options].find(o=>o.textContent.trim()===saved.quality);
    if(option&&select.value!==option.value){select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));}
  }
  function bindQuality(){
    const select=$('#qualitySelect');if(!select||select.dataset.yumePrefsBound==='1')return;
    select.dataset.yumePrefsBound='1';
    select.addEventListener('change',()=>{if(prefs.rememberQuality!==false){saved.quality=select.selectedOptions?.[0]?.textContent?.trim()||'';writeState();}});
    new MutationObserver(()=>setTimeout(applySavedQuality,80)).observe(select,{childList:true,subtree:true});
    setTimeout(applySavedQuality,350);
  }

  document.addEventListener('visibilitychange',()=>{
    if(document.hidden&&prefs.pauseWhenHidden===true){const v=activeVideo();if(v&&!v.paused)v.pause();}
  });
  document.addEventListener('yume:player-settings',e=>{prefs={...DEFAULTS,...(e.detail||{}),...readPrefs()};if(prefs.autoHideControls===false)showControls();else scheduleHide();});

  installStyle();
  const observer=new MutationObserver(()=>{bindPlayer();bindQuality();});
  observer.observe(document.documentElement,{childList:true,subtree:true});
  let tries=0;const timer=setInterval(()=>{bindPlayer();bindQuality();if(++tries>80)clearInterval(timer);},120);
})();