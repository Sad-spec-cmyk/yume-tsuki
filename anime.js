(() => {
  const $ = s => document.querySelector(s);
  const state = { release:null, episodes:[], currentIndex:-1, hls:null, sourceUrl:'', hideTimer:null, quality:'', resume:null, lastResumeSave:0, lastRemoteSave:0, favorite:false };
  const esc = v => String(v ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const titleOf = a => a?.name?.main || a?.name?.english || a?.title || 'Без названия';
  const altTitleOf = a => a?.name?.english || a?.name?.alternative || a?.names?.en || '';
  const genresOf = a => (a?.genres || []).map(g=>typeof g==='string'?g:g?.name).filter(Boolean);
  const rawPoster = a => a?.poster?.src || a?.poster?.preview || a?.poster?.original || a?.poster || '';
  const typeOf = a => a?.type?.description || a?.type?.value || 'Аниме';
  const descOf = a => a?.description || a?.desc || 'Описание отсутствует.';
  const epNumber = (ep,i) => ep?.ordinal ?? ep?.episode ?? ep?.serie ?? ep?.number ?? i+1;
  const epTitle = ep => String(ep?.name || ep?.title || ep?.episode_name || '').trim();
  const feature = (...args) => window.YUME_ACCOUNT?.feature?.(...args);

  function imageCandidates(raw){
    const value=String(raw||'').trim(); if(!value)return[];
    if(/^https?:\/\//i.test(value)) return [value];
    if(value.startsWith('//')) return [`https:${value}`];
    const path=value.startsWith('/')?value:`/${value}`;
    const bases=window.YUME_CONFIG?.ANILIBERTY_IMAGE_BASES||['https://static.wwnd.space','https://cdn.anilibria.top','https://aniliberty.top','https://api.anilibria.app'];
    return [...new Set(bases.map(base=>`${String(base).replace(/\/+$/,'')}${path}`))];
  }
  function setImage(img,raw){
    const candidates=imageCandidates(raw);let i=0;
    const next=()=>{if(i>=candidates.length){img.removeAttribute('src');return;}img.src=candidates[i++];};
    img.onerror=next;img.referrerPolicy='no-referrer';next();
  }
  async function goodImage(raw){
    for(const url of imageCandidates(raw)){
      const ok=await new Promise(resolve=>{const i=new Image();i.referrerPolicy='no-referrer';i.onload=()=>resolve(true);i.onerror=()=>resolve(false);i.src=url;});
      if(ok)return url;
    }
    return'';
  }
  async function fetchWithTimeout(url,options={},timeout=12000){
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeout);
    try{return await fetch(url,{...options,signal:controller.signal});}finally{clearTimeout(timer);}
  }
  async function libria(path,query={}){
    const qs=new URLSearchParams();Object.entries(query).forEach(([k,v])=>{if(v!==undefined&&v!==null&&String(v)!=='')qs.set(k,String(v));});
    const suffix=qs.toString()?`${path}?${qs}`:path;
    const direct=window.YUME_CONFIG?.ANILIBERTY_API_BASES||['https://api.anilibria.app/api/v1','https://aniliberty.top/api/v1'];
    const urls=location.protocol!=='file:'&&!['localhost','127.0.0.1'].includes(location.hostname)?[`/.netlify/functions/aniliberty?path=${encodeURIComponent(suffix)}`]:direct.map(b=>`${b.replace(/\/$/,'')}${suffix}`);
    let error;for(const url of urls){try{const r=await fetchWithTimeout(url,{headers:{Accept:'application/json'}});if(!r.ok)throw new Error(`API ${r.status}`);return await r.json();}catch(e){error=e;}}
    throw error||new Error('API недоступен');
  }
  function normalize(raw){
    const poster=raw?.poster;const src=typeof poster==='string'?poster:poster?.src||poster?.preview||poster?.original||'';
    return {...raw,poster:{...(typeof poster==='object'&&poster?poster:{}),src},name:raw?.name||{main:raw?.names?.ru||raw?.title||'',english:raw?.names?.en||''},episodes:raw?.episodes||raw?.playlist||[]};
  }
  async function findRelease(){
    const params=new URL(location.href).searchParams;const key=params.get('id')||params.get('alias');
    if(key){const j=await libria(`/anime/releases/${encodeURIComponent(key)}`);return normalize(j?.data||j);}
    const q=(params.get('q')||'').trim();if(!q)throw new Error('Не указано аниме');
    const j=await libria('/anime/catalog/releases',{limit:12,'f[search]':q,'f[sorting]':'2'});
    const list=(Array.isArray(j)?j:j?.data||j?.items||[]).map(normalize);if(!list.length)throw new Error('Аниме не найдено');
    const norm=s=>String(s||'').toLowerCase().replace(/[ё]/g,'е').replace(/[^a-zа-я0-9]+/gi,' ').trim();
    const candidate=list.find(a=>norm(titleOf(a))===norm(q)||norm(altTitleOf(a))===norm(q))||list[0];
    const id=candidate.alias||candidate.id;if(!id)return candidate;
    const full=await libria(`/anime/releases/${encodeURIComponent(id)}`);return normalize(full?.data||full);
  }
  function qualityOptions(ep){
    const pairs=[['1080p',ep?.hls_1080||ep?.video?.fullHd],['720p',ep?.hls_720||ep?.video?.hd],['480p',ep?.hls_480||ep?.video?.sd]];
    return pairs.filter(([,url])=>url).map(([label,url])=>({label,url}));
  }
  function releaseKey(a=state.release){return String(a?.alias||a?.id||titleOf(a)||'').trim();}
  function localResumeKey(){return `yume-resume:${releaseKey().toLowerCase()}`;}
  function localFavoriteKey(){return `yume-favorite:${releaseKey().toLowerCase()}`;}
  function fmt(s){if(!Number.isFinite(s)||s<0)return'0:00';const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60);return h?`${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`:`${m}:${String(sec).padStart(2,'0')}`;}

  async function waitForSession(timeout=1800){
    if(window.YUME_ACCOUNT?.ready)return window.YUME_ACCOUNT.user;
    return new Promise(resolve=>{
      let done=false;const finish=user=>{if(done)return;done=true;resolve(user||null);};
      document.addEventListener('yume:session',e=>finish(e.detail?.user),{once:true});
      setTimeout(()=>finish(window.YUME_ACCOUNT?.user),timeout);
    });
  }
  function currentResumePayload(){
    const a=state.release,ep=state.episodes[state.currentIndex],video=$('#yumeVideo');if(!a||!ep)return null;
    return {
      key:releaseKey(a),title:titleOf(a),animeId:a.id||'',alias:a.alias||'',poster:imageCandidates(rawPoster(a))[0]||'',
      episodeIndex:state.currentIndex,episodeNumber:epNumber(ep,state.currentIndex),episodeTitle:epTitle(ep),position:Number(video.currentTime||0),duration:Number(video.duration||0),quality:state.quality||$('#qualitySelect')?.selectedOptions?.[0]?.textContent||'',completed:video.duration>0&&video.currentTime/video.duration>=.98,updatedAt:Date.now()
    };
  }
  async function saveResume(force=false){
    const payload=currentResumePayload();if(!payload)return;
    const now=Date.now();if(!force&&now-state.lastResumeSave<4000)return;state.lastResumeSave=now;
    try{localStorage.setItem(localResumeKey(),JSON.stringify(payload));}catch{}
    if(window.YUME_ACCOUNT?.user&&feature&&(force||now-state.lastRemoteSave>=15000)){state.lastRemoteSave=now;try{await feature('resume',{method:'POST',body:JSON.stringify(payload)});}catch{}}
  }
  async function loadResume(){
    let local=null,remote=null;
    try{local=JSON.parse(localStorage.getItem(localResumeKey())||'null');}catch{}
    await waitForSession();
    if(window.YUME_ACCOUNT?.user&&feature){try{remote=(await feature('resume',{method:'GET',headers:{}},{key:releaseKey()})).item||null;}catch{}}
    const newest=[local,remote].filter(Boolean).sort((a,b)=>Number(b.updatedAt||0)-Number(a.updatedAt||0))[0]||null;
    state.resume=newest;return newest;
  }

  function ensureFeatureButtons(){
    const actions=document.querySelector('.anime-actions');if(!actions)return;
    if(!$('#favoriteBtn'))actions.insertAdjacentHTML('beforeend','<button id="favoriteBtn" class="btn ghost favorite-btn" type="button">♡ В избранное</button>');
    if(!$('#resumeHint'))document.querySelector('.player-column')?.insertAdjacentHTML('afterbegin','<button id="resumeHint" class="resume-hint hidden" type="button"></button>');
    $('#favoriteBtn')?.addEventListener('click',toggleFavorite);
    $('#resumeHint')?.addEventListener('click',()=>{$('#watch')?.scrollIntoView({behavior:'smooth'});$('#yumeVideo')?.play().catch(()=>{});});
  }
  function favoritePayload(){const a=state.release;return{key:releaseKey(),animeId:a?.id||'',alias:a?.alias||'',title:titleOf(a),poster:imageCandidates(rawPoster(a))[0]||'',year:a?.year||'',type:typeOf(a)};}
  async function refreshFavorite(){
    let isFav=false;
    if(window.YUME_ACCOUNT?.user&&feature){try{isFav=!!(await feature('favorites',{method:'GET',headers:{}},{key:releaseKey()})).item;}catch{}}
    else{try{isFav=localStorage.getItem(localFavoriteKey())==='1';}catch{}}
    state.favorite=isFav;renderFavorite();
  }
  function renderFavorite(){const b=$('#favoriteBtn');if(!b)return;b.classList.toggle('active',state.favorite);b.textContent=state.favorite?'♥ В избранном':'♡ В избранное';}
  async function toggleFavorite(){
    if(!window.YUME_ACCOUNT?.user){location.href=`/account?next=${encodeURIComponent(location.pathname+location.search)}`;return;}
    const payload=favoritePayload();
    try{
      if(state.favorite)await feature('favorites',{method:'DELETE',body:JSON.stringify(payload)});
      else await feature('favorites',{method:'POST',body:JSON.stringify(payload)});
      state.favorite=!state.favorite;renderFavorite();
    }catch(e){alert(e.message||'Не удалось изменить избранное.');}
  }

  async function renderRelease(a){
    state.release=a;document.title=`${titleOf(a)} — Yume Tsuki`;
    if(a.alias){const u=new URL(location.href);u.pathname='/anime';u.search=`?alias=${encodeURIComponent(a.alias)}`;history.replaceState({},'',`${u.pathname}${u.search}${location.hash}`);}
    $('#animeTitle').textContent=titleOf(a);$('#aboutTitle').textContent=titleOf(a);$('#aboutDescription').textContent=descOf(a);$('#animeDescription').textContent=descOf(a);
    $('#animeAltTitle').textContent=altTitleOf(a);$('#animeType').textContent=typeOf(a).toUpperCase();
    const poster=rawPoster(a);setImage($('#animePoster'),poster);const bg=await goodImage(poster);if(bg)$('#animeHero').style.backgroundImage=`url('${bg.replaceAll("'","%27")}')`;
    $('#animeHero').classList.remove('loading');$('#playerPoster').style.backgroundImage=bg?`url('${bg.replaceAll("'","%27")}')`:'';
    const total=a.episodes_total??a.episodes?.length??0,year=a.year||'—',status=a.is_ongoing?'Выходит':'Завершён';
    $('#animeMeta').innerHTML=[typeOf(a),year,total?`${total} серий`:null,status,a.age_rating?.label||a.age_rating?.value].filter(Boolean).map(x=>`<span>${esc(x)}</span>`).join('');
    $('#animeGenres').innerHTML=genresOf(a).map(g=>`<span class="chip">${esc(g)}</span>`).join('');
    $('#sideEpisodes').textContent=total||0;$('#sideYear').textContent=year;$('#sideStatus').textContent=status;
    const info=[['Тип',typeOf(a)],['Статус',status],['Год',year],['Сезон',a.season?.description||a.season||'—'],['Возраст',a.age_rating?.label||a.age_rating?.value||'—'],['Серий',total||'—'],['Длительность',a.average_duration_of_episode?`${Math.round(Number(a.average_duration_of_episode)/60)} мин`:'—']];
    $('#infoList').innerHTML=info.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
    $('#technicalInfo').innerHTML=[['ID',a.id||'—'],['Alias',a.alias||'—'],['Тип',typeOf(a)],['Год',year],['Онгоинг',a.is_ongoing?'Да':'Нет'],['Эпизодов',total||'—']].map(([k,v])=>`<div class="technical-item"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('');
    state.episodes=(a.episodes||[]).filter(ep=>qualityOptions(ep).length);renderEpisodes();ensureFeatureButtons();await waitForSession();await refreshFavorite();
    const resume=await loadResume();
    let startIndex=0,startPosition=0,savedQuality='';
    if(resume&&state.episodes.length){
      startIndex=Math.min(state.episodes.length-1,Math.max(0,Number(resume.episodeIndex||0)));
      if(resume.completed&&startIndex<state.episodes.length-1){startIndex+=1;startPosition=0;}else startPosition=Math.max(0,Number(resume.position||0));
      savedQuality=String(resume.quality||'');
      const hint=$('#resumeHint');if(hint&&startPosition>10){hint.textContent=`▶ Продолжить: серия ${esc(epNumber(state.episodes[startIndex],startIndex))} с ${fmt(startPosition)}`;hint.classList.remove('hidden');}
    }
    if(state.episodes.length){loadEpisode(startIndex,false,startPosition,savedQuality);if(location.hash==='#watch')setTimeout(()=>$('#watch').scrollIntoView({behavior:'smooth'}),150);}
    else showMessage('Видео недоступно','API не вернул доступных HLS-потоков для этого релиза.');
  }

  function renderEpisodes(){
    const list=$('#episodesList');$('#episodeCount').textContent=`${state.episodes.length} серий`;
    list.innerHTML=state.episodes.map((ep,i)=>{const n=epNumber(ep,i),title=epTitle(ep),duration=ep.duration?`${Math.round(Number(ep.duration)/60)} мин`:'';return `<button class="episode-row" data-index="${i}" type="button"><span class="episode-number">Серия ${esc(n)}</span><span class="episode-copy"><strong>${esc(title||`Эпизод ${n}`)}</strong><span>${esc(duration||'Готово к просмотру')}</span></span><span class="episode-play">▶</span></button>`;}).join('');
    list.querySelectorAll('.episode-row').forEach(btn=>btn.addEventListener('click',()=>{loadEpisode(Number(btn.dataset.index),true,0,'');$('#watch').scrollIntoView({behavior:'smooth'});}));
  }
  function destroyHls(){if(state.hls){try{state.hls.destroy();}catch{}state.hls=null;}}
  function attachSource(url,resume=0,autoplay=true){
    destroyHls();state.sourceUrl=url;const video=$('#yumeVideo'),native=video.canPlayType('application/vnd.apple.mpegurl');
    const after=()=>{if(resume>0&&Number.isFinite(video.duration))video.currentTime=Math.min(resume,Math.max(0,video.duration-1));if(autoplay)video.play().catch(()=>{});syncControls();};
    if(window.Hls&&window.Hls.isSupported()){
      const hls=new Hls({enableWorker:true,lowLatencyMode:false,backBufferLength:90});state.hls=hls;hls.loadSource(url);hls.attachMedia(video);hls.on(Hls.Events.MANIFEST_PARSED,after);hls.on(Hls.Events.ERROR,(_,d)=>{if(d?.fatal)showMessage('Ошибка воспроизведения','Не удалось загрузить этот поток. Попробуйте другое качество.');});
    }else if(native){video.src=url;video.addEventListener('loadedmetadata',after,{once:true});}
    else showMessage('HLS не поддерживается','Откройте сайт в современном браузере.');
  }
  function loadEpisode(index,autoplay=true,resume=0,savedQuality=''){
    const ep=state.episodes[index];if(!ep)return;
    if(state.currentIndex>=0&&state.currentIndex!==index)saveResume(true);
    state.currentIndex=index;hideMessage();const options=qualityOptions(ep);let chosen=options.find(o=>o.label===savedQuality)||options[0];state.quality=chosen?.label||'';
    const n=epNumber(ep,index),title=epTitle(ep),a=state.release;
    $('#currentEpisodeBadge').textContent=`Серия ${n}`;$('#currentQualityBadge').textContent=chosen?.label||'—';$('#nowPlayingTitle').textContent=`Серия ${n}${title?` — ${title}`:''}`;$('#nowPlayingSubtitle').textContent=titleOf(a);
    $('#playerHeading').textContent=`${titleOf(a)} — серия ${n}`;$('#playerStatus').textContent=`Серия ${n} из ${state.episodes.length}`;
    document.querySelectorAll('.episode-row').forEach((b,i)=>b.classList.toggle('active',i===index));
    $('#qualitySelect').innerHTML=options.map((x,i)=>`<option value="${i}" ${x.label===chosen?.label?'selected':''}>${esc(x.label)}</option>`).join('');
    window.YUME_NOW_PLAYING={title:titleOf(a),animeId:a.id||a.alias||titleOf(a),alias:a.alias||'',episode:`Серия ${n}${title?` · ${title}`:''}`,episodeNumber:n,episodeTitle:title,poster:imageCandidates(rawPoster(a))[0]||'',href:`/anime?alias=${encodeURIComponent(a.alias||a.id||'')}`,genres:genresOf(a),totalEpisodes:a.episodes_total||state.episodes.length,year:a.year||'',type:typeOf(a)};
    const video=$('#yumeVideo');video.pause();video.removeAttribute('src');video.load();attachSource(chosen.url,resume,autoplay);saveResume(true);
  }

  function showMessage(title,text){$('#playerMessage').innerHTML=`<div><strong>${esc(title)}</strong><span>${esc(text)}</span></div>`;$('#playerMessage').classList.remove('hidden');}
  function hideMessage(){$('#playerMessage').classList.add('hidden');}
  const video=$('#yumeVideo'),player=$('#yumePlayer');
  function syncControls(){const duration=Number(video.duration||0),current=Number(video.currentTime||0);$('#timeLabel').textContent=`${fmt(current)} / ${fmt(duration)}`;$('#progress').value=duration?Math.round((current/duration)*1000):0;$('#playBtn').textContent=video.paused?'▶':'❚❚';$('#centerPlay').textContent=video.paused?'▶':'❚❚';player.classList.toggle('playing',!video.paused);}
  function togglePlay(){video.paused?video.play().catch(()=>{}):video.pause();}
  $('#playBtn').onclick=togglePlay;$('#centerPlay').onclick=togglePlay;video.addEventListener('click',togglePlay);video.addEventListener('play',()=>{syncControls();saveResume(true);});video.addEventListener('pause',()=>{syncControls();saveResume(true);});video.addEventListener('timeupdate',()=>{syncControls();saveResume(false);});video.addEventListener('loadedmetadata',syncControls);video.addEventListener('ended',()=>{syncControls();saveResume(true);});
  $('#progress').addEventListener('input',e=>{if(video.duration)video.currentTime=(Number(e.target.value)/1000)*video.duration;});
  $('#progress').addEventListener('change',()=>saveResume(true));
  $('#backBtn').onclick=()=>{video.currentTime=Math.max(0,video.currentTime-10);saveResume(true);};$('#forwardBtn').onclick=()=>{video.currentTime=Math.min(video.duration||Infinity,video.currentTime+10);saveResume(true);};
  $('#volume').addEventListener('input',e=>{video.volume=Number(e.target.value);video.muted=false;$('#muteBtn').textContent=video.volume===0?'🔇':'🔊';});
  $('#muteBtn').onclick=()=>{video.muted=!video.muted;$('#muteBtn').textContent=video.muted?'🔇':'🔊';};
  $('#speedSelect').addEventListener('change',e=>video.playbackRate=Number(e.target.value));
  $('#qualitySelect').addEventListener('change',e=>{const ep=state.episodes[state.currentIndex],options=qualityOptions(ep),opt=options[Number(e.target.value)];if(!opt)return;const t=video.currentTime,wasPlaying=!video.paused;state.quality=opt.label;$('#currentQualityBadge').textContent=opt.label;attachSource(opt.url,t,wasPlaying);saveResume(true);});
  $('#fullscreenBtn').onclick=()=>{document.fullscreenElement?document.exitFullscreen():player.requestFullscreen?.();};
  player.addEventListener('mousemove',()=>{player.classList.remove('controls-hidden');clearTimeout(state.hideTimer);state.hideTimer=setTimeout(()=>player.classList.add('controls-hidden'),2400);});
  player.addEventListener('mouseleave',()=>{if(!video.paused)player.classList.add('controls-hidden');});
  player.addEventListener('keydown',e=>{if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;if(e.code==='Space'){e.preventDefault();togglePlay();}else if(e.key==='ArrowLeft'){video.currentTime=Math.max(0,video.currentTime-5);}else if(e.key==='ArrowRight'){video.currentTime=Math.min(video.duration||Infinity,video.currentTime+5);}else if(e.key.toLowerCase()==='f'){$('#fullscreenBtn').click();}else if(e.key.toLowerCase()==='m'){$('#muteBtn').click();}});
  addEventListener('pagehide',()=>{const p=currentResumePayload();if(p){try{localStorage.setItem(localResumeKey(),JSON.stringify(p));}catch{}}});

  (async()=>{try{const release=await findRelease();await renderRelease(release);}catch(e){console.error(e);$('#animeTitle').textContent='Аниме не найдено';$('#animeDescription').textContent='Не удалось загрузить страницу этого релиза.';showMessage('Не удалось загрузить аниме',e.message||'Ошибка API');}})();
})();
