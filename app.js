const state = { current: [], hero: null, selected: null, hls: null };
const $ = (s) => document.querySelector(s);
const grid = $('#grid');
const statusEl = $('#status');
const empty = $('#empty');

const esc = (v='') => String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const titleOf = a => a?.name?.main || a?.name?.english || a?.title || 'Без названия';
const englishTitleOf = a => a?.name?.english || '';
const yearOf = a => a?.year || '—';
const typeOf = a => a?.type?.description || a?.type?.value || 'Аниме';
const rawCoverOf = a => a?.poster?.src || a?.poster?.preview || a?.poster?.original || a?.poster || '';

function imageCandidates(raw){
  const value = String(raw || '').trim();
  if(!value) return [];
  if(/^https?:\/\//i.test(value)) return [value];
  if(value.startsWith('//')) return [`https:${value}`];

  const path = value.startsWith('/') ? value : `/${value}`;
  const bases = window.YUME_CONFIG?.ANILIBERTY_IMAGE_BASES || [
    'https://static.wwnd.space',
    'https://cdn.anilibria.top',
    'https://anilibria.top',
    'https://api.anilibria.app'
  ];
  return [...new Set(bases.map(base => `${String(base).replace(/\/+$/,'')}${path}`))];
}

const coverOf = a => imageCandidates(rawCoverOf(a))[0] || '';

function setImageWithFallback(img, raw){
  if(!img) return;
  const candidates = imageCandidates(raw);
  let index = 0;
  img.referrerPolicy = 'no-referrer';
  img.classList.remove('image-missing');

  const next = () => {
    if(index >= candidates.length){
      img.removeAttribute('src');
      img.classList.add('image-missing');
      return;
    }
    img.src = candidates[index++];
  };

  img.onerror = next;
  if(candidates.length) next();
  else img.classList.add('image-missing');
}

const imageUrlCache = new Map();
async function workingImageUrl(raw){
  const key = String(raw || '');
  if(imageUrlCache.has(key)) return imageUrlCache.get(key);
  const promise = (async()=>{
    for(const url of imageCandidates(raw)){
      const ok = await new Promise(resolve=>{
        const test = new Image();
        test.referrerPolicy = 'no-referrer';
        test.onload = () => resolve(true);
        test.onerror = () => resolve(false);
        test.src = url;
      });
      if(ok) return url;
    }
    return '';
  })();
  imageUrlCache.set(key, promise);
  return promise;
}

async function setBackgroundWithFallback(el, raw, overlay=''){
  if(!el) return;
  const url = await workingImageUrl(raw);
  el.style.backgroundImage = url ? `${overlay}${overlay ? ', ' : ''}url('${url.replaceAll("'","%27")}')` : '';
}
const descriptionOf = a => a?.description || 'Описание отсутствует.';
const genresOf = a => (a?.genres || []).map(g => typeof g === 'string' ? g : g?.name).filter(Boolean);
const episodesCountOf = a => a?.episodes_total ?? a?.episodes?.length ?? null;
const popularityOf = a => a?.added_in_users_favorites ?? a?.added_in_favorites ?? null;

function setLoading(count=12){
  empty.classList.add('hidden');
  grid.innerHTML = Array.from({length:count},()=>'<div><div class="skeleton"></div></div>').join('');
  statusEl.textContent = 'Загрузка...';
}

async function fetchWithTimeout(url, options={}, timeout=12000){
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), timeout);
  try { return await fetch(url, {...options, signal: controller.signal}); }
  finally { clearTimeout(timer); }
}

function useNetlifyProxy(){
  return location.protocol !== 'file:' && !['localhost','127.0.0.1'].includes(location.hostname);
}

async function libria(path, query={}){
  const qs = new URLSearchParams();
  Object.entries(query).forEach(([k,v]) => {
    if(v !== undefined && v !== null && String(v) !== '') qs.set(k, String(v));
  });

  const suffix = qs.toString() ? `${path}?${qs}` : path;
  const directBases = window.YUME_CONFIG?.ANILIBERTY_API_BASES || [
    'https://api.anilibria.app/api/v1',
    'https://aniliberty.top/api/v1'
  ];

  const urls = useNetlifyProxy()
    ? [`/.netlify/functions/aniliberty?path=${encodeURIComponent(suffix)}`]
    : directBases.map(base => `${base.replace(/\/$/,'')}${suffix}`);

  let lastError;
  for(const url of urls){
    try{
      const r = await fetchWithTimeout(url, {headers:{'Accept':'application/json'}}, 12000);
      if(!r.ok) throw new Error(`AniLiberty ${r.status}`);
      return await r.json();
    }catch(e){ lastError = e; }
  }
  throw lastError || new Error('AniLiberty API недоступен');
}

function normalizeSeries(raw){
  const poster = raw?.poster;
  const posterSrc = typeof poster === 'string'
    ? poster
    : poster?.src || poster?.preview || poster?.original || poster?.medium || '';

  return {
    ...raw,
    poster: { ...(typeof poster === 'object' && poster ? poster : {}), src: posterSrc },
    name: raw?.name || {
      main: raw?.names?.ru || raw?.title || '',
      english: raw?.names?.en || '',
      alternative: raw?.names?.alternative || ''
    },
    description: raw?.description || raw?.desc || '',
    episodes_total: raw?.episodes_total ?? raw?.episodesTotal ?? null,
    added_in_users_favorites: raw?.added_in_users_favorites ?? raw?.addedInUsersFavorites ?? null,
    is_ongoing: raw?.is_ongoing ?? raw?.isOngoing ?? false,
    is_blocked_by_geo: raw?.is_blocked_by_geo ?? raw?.isBlockedByGeo ?? false,
    is_blocked_by_copyrights: raw?.is_blocked_by_copyrights ?? raw?.isBlockedByCopyrights ?? false,
    episodes: raw?.episodes || raw?.playlist || []
  };
}

async function getCatalog({search='', sorting='FRESH_AT_DESC', limit=24, page=1, ongoing=false}={}){
  const query = { page, limit, 'f[sorting]': sorting };
  if(search) query['f[search]'] = search;
  if(ongoing) query['f[production_statuses]'] = 'IS_IN_PRODUCTION';

  let json;
  try{
    json = await libria('/anime/catalog/releases', query);
  }catch(e){
    if(sorting === 'FRESH_AT_DESC') json = await libria('/anime/catalog/releases', {...query, 'f[sorting]':'2'});
    else if(sorting === 'POPULARITY_DESC') json = await libria('/anime/catalog/releases', {...query, 'f[sorting]':'1'});
    else throw e;
  }

  const list = Array.isArray(json) ? json : (json?.data || json?.items || []);
  return list.map(normalizeSeries);
}

async function getRelease(a){
  const key = a?.alias || a?.id;
  if(!key) throw new Error('У релиза нет идентификатора');
  const json = await libria(`/anime/releases/${encodeURIComponent(key)}`);
  return normalizeSeries(json?.data || json);
}

function renderCards(items){
  state.current = items;
  grid.innerHTML = items.map((a,i)=>{
    const fav = popularityOf(a);
    const badge = fav !== null ? `❤ ${Intl.NumberFormat('ru-RU',{notation:'compact'}).format(fav)}` : (a.is_ongoing ? 'ОНГОИНГ' : typeOf(a));
    return `
      <article class="card" data-index="${i}">
        <div class="poster">
          <img loading="lazy" referrerpolicy="no-referrer" data-cover="${esc(rawCoverOf(a))}" alt="${esc(titleOf(a))}" />
          <span class="score">${esc(badge)}</span>
        </div>
        <h3>${esc(titleOf(a))}</h3>
        <p>${esc(typeOf(a))} · ${esc(yearOf(a))}</p>
      </article>`;
  }).join('');
  grid.querySelectorAll('img[data-cover]').forEach(img => setImageWithFallback(img, img.dataset.cover));
  empty.classList.toggle('hidden', items.length>0);
  statusEl.textContent = `${items.length} тайтлов`;
}

function setHero(a){
  if(!a) return;
  state.hero = a;
  setBackgroundWithFallback(
    $('#hero'),
    rawCoverOf(a),
    'linear-gradient(90deg,rgba(7,8,12,.97) 0%,rgba(7,8,12,.62) 48%,rgba(7,8,12,.25) 100%)'
  );
  $('#heroTitle').textContent = titleOf(a);
  $('#heroText').textContent = descriptionOf(a);
  $('#heroMeta').innerHTML = [
    typeOf(a),
    yearOf(a),
    episodesCountOf(a) ? `${episodesCountOf(a)} эп.` : null,
    a.is_ongoing ? 'Выходит' : null
  ].filter(Boolean).map(x=>`<span class="meta-pill">${esc(x)}</span>`).join('');
}

async function loadHome(){
  setLoading(); $('#sectionKicker').textContent='НОВИНКИ'; $('#sectionTitle').textContent='Свежие релизы';
  try{ const list = await getCatalog({sorting:'FRESH_AT_DESC'}); renderCards(list); setHero(list[0]); }
  catch(e){ showError(e); }
}

async function loadTop(){
  setLoading(); $('#sectionKicker').textContent='ПОПУЛЯРНОЕ'; $('#sectionTitle').textContent='Популярные релизы';
  try{
    let list = await getCatalog({sorting:'POPULARITY_DESC', limit:30});
    if(list.length) list = [...list].sort((a,b)=>(popularityOf(b)||0)-(popularityOf(a)||0)).slice(0,24);
    renderCards(list); setHero(list[0]);
  }catch(e){ showError(e); }
}

async function loadSeason(){
  setLoading(); $('#sectionKicker').textContent='ОНГОИНГИ'; $('#sectionTitle').textContent='Сейчас выходят';
  try{
    let list = await getCatalog({sorting:'FRESH_AT_DESC', limit:36});
    const ongoing = list.filter(a=>a.is_ongoing || a.is_in_production);
    if(ongoing.length) list = ongoing;
    renderCards(list.slice(0,24)); setHero(list[0]);
  }catch(e){ showError(e); }
}

async function search(q){
  if(!q.trim()) return loadHome();
  setLoading(); $('#sectionKicker').textContent='ПОИСК'; $('#sectionTitle').textContent=`Результаты: ${q}`;
  try{ const list = await getCatalog({search:q.trim(), sorting:'FRESH_AT_DESC'}); renderCards(list); setHero(list[0]); }
  catch(e){ showError(e); }
}

function showError(e){
  grid.innerHTML=''; empty.classList.remove('hidden');
  empty.innerHTML='Не удалось получить данные AniLiberty API.<br><small>Попробуйте обновить страницу через несколько секунд.</small>';
  statusEl.textContent='Ошибка API'; console.error(e);
}

async function openDetails(anime){
  try{
    statusEl.textContent='Детали...';
    const a = await getRelease(anime).catch(()=>anime);
    state.selected = a;
    setBackgroundWithFallback($('#modalHero'), rawCoverOf(a));
    setImageWithFallback($('#modalPoster'), rawCoverOf(a));
    $('#modalPoster').alt=titleOf(a);
    $('#modalType').textContent=typeOf(a).toUpperCase(); $('#modalTitle').textContent=titleOf(a);
    $('#modalDescription').textContent=descriptionOf(a);
    $('#modalMeta').innerHTML=[
      yearOf(a),
      a.is_ongoing?'Выходит':'Релиз',
      episodesCountOf(a)?`${episodesCountOf(a)} эп.`:null,
      a.average_duration_of_episode?`${Math.round(a.average_duration_of_episode/60)} мин.`:null,
      a.age_rating?.label || a.age_rating?.value || null
    ].filter(Boolean).map(x=>`<span>${esc(x)}</span>`).join('<span>•</span>');
    $('#modalGenres').innerHTML=genresOf(a).map(g=>`<span class="chip">${esc(g)}</span>`).join('');
    $('#trailerBtn').classList.add('hidden');
    $('#streamingLinks').innerHTML = englishTitleOf(a) ? `<span class="stream-note">${esc(englishTitleOf(a))}</span>` : '';
    $('#modal').classList.remove('hidden'); $('#modal').setAttribute('aria-hidden','false'); document.body.style.overflow='hidden';
    statusEl.textContent='AniLiberty API';
  }catch(e){showError(e)}
}

function closeModal(id){
  $(id).classList.add('hidden'); $(id).setAttribute('aria-hidden','true');
  if(id==='#playerModal') destroyPlayer();
  if($('#modal').classList.contains('hidden')&&$('#playerModal').classList.contains('hidden')) document.body.style.overflow='';
}

function destroyPlayer(){
  if(state.hls){ try{state.hls.destroy();}catch(_){} state.hls=null; }
  const video=$('#yumeVideo'); if(video){ try{video.pause(); video.removeAttribute('src'); video.load();}catch(_){} }
}

function bestVideoUrl(ep){
  return ep?.hls_1080 || ep?.hls_720 || ep?.hls_480 || ep?.video?.fullHd || ep?.video?.hd || ep?.video?.sd || '';
}

function epNumber(ep, index){ return ep?.ordinal ?? ep?.episode ?? ep?.serie ?? (index+1); }

function playEpisode(ep, index){
  destroyPlayer();
  const box=$('#playerBox');
  const url=bestVideoUrl(ep);
  if(!url){
    box.innerHTML='<div class="player-placeholder"><h3>Видео этой серии недоступно</h3><p>API не вернул HLS-поток для выбранного эпизода.</p></div>';
    return;
  }

  box.innerHTML='<video id="yumeVideo" controls autoplay playsinline preload="metadata"></video>';
  const video=$('#yumeVideo');
  const canNative = video.canPlayType('application/vnd.apple.mpegurl');

  if(window.Hls && window.Hls.isSupported()){
    const hls=new window.Hls({enableWorker:true, lowLatencyMode:false, backBufferLength:60});
    state.hls=hls;
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(window.Hls.Events.MANIFEST_PARSED,()=>video.play().catch(()=>{}));
    hls.on(window.Hls.Events.ERROR,(_,data)=>{
      if(data?.fatal){
        console.error('HLS fatal error', data);
        if(canNative){ video.src=url; video.play().catch(()=>{}); }
      }
    });
  }else if(canNative){
    video.src=url; video.play().catch(()=>{});
  }else{
    box.innerHTML='<div class="player-placeholder"><h3>Браузер не поддерживает HLS</h3><p>Обновите страницу или откройте сайт в современном Chrome, Edge, Firefox или Safari.</p></div>';
    return;
  }

  [...$('#episodes').children].forEach(b=>b.classList.toggle('active',Number(b.dataset.index)===index));
}

async function openPlayer(a){
  closeModal('#modal');
  $('#playerModal').classList.remove('hidden'); $('#playerModal').setAttribute('aria-hidden','false');
  $('#playerTitle').textContent=titleOf(a); document.body.style.overflow='hidden';
  const box=$('#playerBox'), episodes=$('#episodes'); episodes.innerHTML='';
  box.innerHTML='<div class="player-placeholder"><div class="loading-ring"></div><h3>Получаем серии...</h3><p>Видео загружается через API.</p></div>';

  try{
    const release = await getRelease(a);
    state.selected=release;
    if(release.is_blocked_by_geo || release.is_blocked_by_copyrights){
      throw new Error('blocked');
    }
    const list=(release.episodes || release.playlist || []).filter(ep=>bestVideoUrl(ep));
    if(!list.length) throw new Error('empty');

    episodes.innerHTML=list.map((ep,i)=>`<button class="episode-btn" data-index="${i}">${esc(ep?.name || ep?.title || `Серия ${epNumber(ep,i)}`)}</button>`).join('');
    episodes.querySelectorAll('button').forEach((b,i)=>b.onclick=()=>playEpisode(list[i],i));
    playEpisode(list[0],0);
  }catch(e){
    const message = e?.message==='blocked'
      ? 'Этот релиз недоступен для просмотра из-за ограничений источника.'
      : 'API не вернул доступные серии для этого релиза.';
    box.innerHTML=`<div class="player-placeholder"><div class="play-icon">▶</div><h3>Серии недоступны</h3><p>${esc(message)}</p></div>`;
  }
}

$('#searchForm').addEventListener('submit',e=>{e.preventDefault(); search($('#searchInput').value)});
grid.addEventListener('click',e=>{const card=e.target.closest('.card'); if(card) openDetails(state.current[Number(card.dataset.index)])});
$('#heroMore').onclick=()=>state.hero&&openDetails(state.hero);
$('#heroWatch').onclick=()=>state.hero&&openPlayer(state.hero);
$('#watchBtn').onclick=()=>state.selected&&openPlayer(state.selected);
document.addEventListener('click',e=>{if(e.target.matches('[data-close="modal"]'))closeModal('#modal');if(e.target.matches('[data-close="player"]'))closeModal('#playerModal')});
document.querySelectorAll('.nav-link').forEach(b=>b.onclick=()=>{document.querySelectorAll('.nav-link').forEach(x=>x.classList.remove('active'));b.classList.add('active');const v=b.dataset.view;if(v==='home')loadHome();if(v==='top')loadTop();if(v==='season')loadSeason();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal('#modal');closeModal('#playerModal')}});
loadHome();
