const $ = (s) => document.querySelector(s);
const state = {
  items: [],
  selected: null,
  hls: null,
  page: 1,
  loading: false,
  done: false,
  mode: document.body.dataset.page || 'catalog',
  searchTimer: null,
};

const grid = $('#grid');
const statusEl = $('#status');
const empty = $('#empty');
const loadMoreBtn = $('#loadMore');
const sentinel = $('#catalogSentinel');

const esc = (v='') => String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const titleOf = a => a?.name?.main || a?.name?.english || a?.title || 'Без названия';
const englishTitleOf = a => a?.name?.english || '';
const yearOf = a => a?.year || '—';
const typeOf = a => a?.type?.description || a?.type?.value || 'Аниме';
const rawCoverOf = a => a?.poster?.src || a?.poster?.preview || a?.poster?.original || a?.poster || '';
const descriptionOf = a => a?.description || 'Описание отсутствует.';
const genresOf = a => (a?.genres || []).map(g => typeof g === 'string' ? g : g?.name).filter(Boolean);
const episodesCountOf = a => a?.episodes_total ?? a?.episodes?.length ?? null;
const popularityOf = a => a?.added_in_users_favorites ?? a?.added_in_favorites ?? null;

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
  if(candidates.length) next(); else img.classList.add('image-missing');
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
      const r = await fetchWithTimeout(url, {headers:{Accept:'application/json'}}, 12000);
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

async function getCatalog({search='', sorting='FRESH_AT_DESC', limit=36, page=1}={}){
  const query = { page, limit, 'f[sorting]': sorting };
  if(search) query['f[search]'] = search;
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

function cardHtml(a, index){
  const fav = popularityOf(a);
  const badge = fav !== null
    ? `❤ ${Intl.NumberFormat('ru-RU',{notation:'compact'}).format(fav)}`
    : (a.is_ongoing ? 'ОНГОИНГ' : typeOf(a));
  return `<article class="card" data-index="${index}">
    <div class="poster">
      <img loading="lazy" referrerpolicy="no-referrer" data-cover="${esc(rawCoverOf(a))}" alt="${esc(titleOf(a))}" />
      <span class="score">${esc(badge)}</span>
    </div>
    <h3>${esc(titleOf(a))}</h3>
    <p>${esc(typeOf(a))} · ${esc(yearOf(a))}</p>
  </article>`;
}

function paintImages(scope=grid){
  scope.querySelectorAll('img[data-cover]:not([data-ready])').forEach(img => {
    img.dataset.ready = '1';
    setImageWithFallback(img, img.dataset.cover);
  });
}

function renderReplace(items){
  state.items = items;
  grid.innerHTML = items.map(cardHtml).join('');
  paintImages();
  empty.classList.toggle('hidden', items.length > 0);
  statusEl.textContent = `${items.length} тайтлов`;
}

function renderAppend(items){
  const start = state.items.length;
  state.items.push(...items);
  grid.insertAdjacentHTML('beforeend', items.map((a,i)=>cardHtml(a,start+i)).join(''));
  paintImages();
  empty.classList.toggle('hidden', state.items.length > 0);
  statusEl.textContent = `${state.items.length} загружено`;
}

function setLoadingCards(count=12){
  empty.classList.add('hidden');
  grid.innerHTML = Array.from({length:count},()=>'<div><div class="skeleton"></div></div>').join('');
  statusEl.textContent = 'Загрузка...';
}

function showError(e){
  console.error(e);
  if(!state.items.length) grid.innerHTML='';
  empty.classList.remove('hidden');
  empty.innerHTML='Не удалось получить данные AniLiberty API.<br><small>Попробуйте ещё раз через несколько секунд.</small>';
  statusEl.textContent='Ошибка API';
}

async function runSearch(query, pushUrl=true){
  const q = String(query || '').trim();
  const input = $('#pageSearchInput');
  if(input && input.value !== q) input.value = q;
  if(pushUrl){
    const url = new URL(location.href);
    if(q) url.searchParams.set('q', q); else url.searchParams.delete('q');
    history.replaceState({}, '', url);
  }
  if(!q){
    state.items=[];
    grid.innerHTML='';
    empty.classList.remove('hidden');
    empty.innerHTML='<strong>Введите название аниме</strong><br><small>Можно искать на русском или английском.</small>';
    statusEl.textContent='Поиск';
    $('#searchHeading').textContent='Найди своё аниме';
    return;
  }
  setLoadingCards(12);
  $('#searchHeading').textContent=`Результаты: ${q}`;
  try{
    const items = await getCatalog({search:q, sorting:'FRESH_AT_DESC', limit:36});
    renderReplace(items);
    if(!items.length){
      empty.classList.remove('hidden');
      empty.innerHTML=`По запросу «${esc(q)}» ничего не найдено.`;
    }
  }catch(e){ showError(e); }
}

async function loadCatalogPage(reset=false){
  if(state.loading || state.done) return;
  if(reset){
    state.page=1; state.done=false; state.items=[];
    setLoadingCards(18);
  }
  state.loading=true;
  if(loadMoreBtn){ loadMoreBtn.disabled=true; loadMoreBtn.textContent='Загрузка...'; }
  const sort = $('#catalogSort')?.value || 'FRESH_AT_DESC';
  try{
    const items = await getCatalog({sorting:sort, limit:36, page:state.page});
    if(reset) renderReplace(items); else renderAppend(items);
    if(items.length < 36) state.done=true;
    else state.page += 1;
    if(loadMoreBtn){
      loadMoreBtn.classList.toggle('hidden', state.done);
      loadMoreBtn.disabled=false;
      loadMoreBtn.textContent=state.done?'Каталог загружен':'Загрузить ещё';
    }
    if(state.done && sentinel) sentinel.textContent='Вы дошли до конца каталога';
  }catch(e){ showError(e); if(loadMoreBtn){loadMoreBtn.disabled=false;loadMoreBtn.textContent='Повторить';} }
  finally{ state.loading=false; }
}

async function openDetails(anime){
  try{
    statusEl.textContent='Детали...';
    const a = await getRelease(anime).catch(()=>anime);
    state.selected=a;
    setImageWithFallback($('#modalPoster'), rawCoverOf(a));
    $('#modalPoster').alt=titleOf(a);
    const hero=$('#modalHero');
    const heroUrl=imageCandidates(rawCoverOf(a))[0] || '';
    hero.style.backgroundImage=heroUrl ? `url('${heroUrl.replaceAll("'","%27")}')` : '';
    $('#modalType').textContent=typeOf(a).toUpperCase();
    $('#modalTitle').textContent=titleOf(a);
    $('#modalDescription').textContent=descriptionOf(a);
    $('#modalMeta').innerHTML=[yearOf(a),a.is_ongoing?'Выходит':'Релиз',episodesCountOf(a)?`${episodesCountOf(a)} эп.`:null,a.age_rating?.label||a.age_rating?.value||null]
      .filter(Boolean).map(x=>`<span>${esc(x)}</span>`).join('<span>•</span>');
    $('#modalGenres').innerHTML=genresOf(a).map(g=>`<span class="chip">${esc(g)}</span>`).join('');
    $('#streamingLinks').innerHTML=englishTitleOf(a)?`<span class="stream-note">${esc(englishTitleOf(a))}</span>`:'';
    $('#modal').classList.remove('hidden'); $('#modal').setAttribute('aria-hidden','false');
    document.body.style.overflow='hidden';
    statusEl.textContent='AniLiberty API';
  }catch(e){ showError(e); }
}

function closeModal(id){
  $(id)?.classList.add('hidden'); $(id)?.setAttribute('aria-hidden','true');
  if(id==='#playerModal') destroyPlayer();
  if($('#modal')?.classList.contains('hidden') && $('#playerModal')?.classList.contains('hidden')) document.body.style.overflow='';
}

function destroyPlayer(){
  if(state.hls){ try{state.hls.destroy();}catch(_){} state.hls=null; }
  const video=$('#yumeVideo'); if(video){ try{video.pause(); video.removeAttribute('src'); video.load();}catch(_){} }
}

function bestVideoUrl(ep){
  return ep?.hls_1080 || ep?.hls_720 || ep?.hls_480 || ep?.video?.fullHd || ep?.video?.hd || ep?.video?.sd || '';
}
function epNumber(ep,index){ return ep?.ordinal ?? ep?.episode ?? ep?.serie ?? index+1; }

function playEpisode(ep,index){
  destroyPlayer();
  const box=$('#playerBox');
  const url=bestVideoUrl(ep);
  if(!url){ box.innerHTML='<div class="player-placeholder"><h3>Видео недоступно</h3></div>'; return; }
  box.innerHTML='<video id="yumeVideo" controls autoplay playsinline preload="metadata"></video>';
  const video=$('#yumeVideo');
  const canNative=video.canPlayType('application/vnd.apple.mpegurl');
  if(window.Hls && window.Hls.isSupported()){
    const hls=new window.Hls({enableWorker:true,lowLatencyMode:false,backBufferLength:60});
    state.hls=hls; hls.loadSource(url); hls.attachMedia(video);
    hls.on(window.Hls.Events.MANIFEST_PARSED,()=>video.play().catch(()=>{}));
  }else if(canNative){ video.src=url; video.play().catch(()=>{}); }
  else{ box.innerHTML='<div class="player-placeholder"><h3>Браузер не поддерживает HLS</h3></div>'; }
  [...$('#episodes').children].forEach(b=>b.classList.toggle('active',Number(b.dataset.index)===index));
}

async function openPlayer(a){
  closeModal('#modal');
  $('#playerModal').classList.remove('hidden'); $('#playerModal').setAttribute('aria-hidden','false');
  $('#playerTitle').textContent=titleOf(a); document.body.style.overflow='hidden';
  const box=$('#playerBox'), episodes=$('#episodes'); episodes.innerHTML='';
  box.innerHTML='<div class="player-placeholder"><div class="loading-ring"></div><h3>Получаем серии...</h3></div>';
  try{
    const release=await getRelease(a); state.selected=release;
    if(release.is_blocked_by_geo || release.is_blocked_by_copyrights) throw new Error('blocked');
    const list=(release.episodes || release.playlist || []).filter(ep=>bestVideoUrl(ep));
    if(!list.length) throw new Error('empty');
    episodes.innerHTML=list.map((ep,i)=>`<button class="episode-btn" data-index="${i}">${esc(ep?.name||ep?.title||`Серия ${epNumber(ep,i)}`)}</button>`).join('');
    episodes.querySelectorAll('button').forEach((b,i)=>b.onclick=()=>playEpisode(list[i],i));
    playEpisode(list[0],0);
  }catch(e){
    box.innerHTML='<div class="player-placeholder"><div class="play-icon">▶</div><h3>Серии недоступны</h3><p>Источник не вернул доступное видео для этого релиза.</p></div>';
  }
}

grid.addEventListener('click',e=>{
  const card=e.target.closest('.card');
  if(card) openDetails(state.items[Number(card.dataset.index)]);
});
$('#watchBtn').onclick=()=>state.selected&&openPlayer(state.selected);
document.addEventListener('click',e=>{
  if(e.target.matches('[data-close="modal"]')) closeModal('#modal');
  if(e.target.matches('[data-close="player"]')) closeModal('#playerModal');
});
document.addEventListener('keydown',e=>{ if(e.key==='Escape'){ closeModal('#modal'); closeModal('#playerModal'); } });

if(state.mode==='search'){
  const form=$('#pageSearchForm');
  const input=$('#pageSearchInput');
  const clear=$('#clearSearch');
  form?.addEventListener('submit',e=>{ e.preventDefault(); runSearch(input.value); });
  input?.addEventListener('input',()=>{
    clear?.classList.toggle('hidden',!input.value);
    clearTimeout(state.searchTimer);
    state.searchTimer=setTimeout(()=>{ if(input.value.trim().length>=2) runSearch(input.value); },450);
  });
  clear?.addEventListener('click',()=>{ input.value=''; clear.classList.add('hidden'); runSearch(''); input.focus(); });
  const initial=new URL(location.href).searchParams.get('q') || '';
  runSearch(initial,false);
}else{
  $('#catalogSort')?.addEventListener('change',()=>loadCatalogPage(true));
  loadMoreBtn?.addEventListener('click',()=>loadCatalogPage(false));
  if('IntersectionObserver' in window && sentinel){
    const observer=new IntersectionObserver(entries=>{
      if(entries.some(x=>x.isIntersecting) && state.items.length && !state.done) loadCatalogPage(false);
    },{rootMargin:'500px 0px'});
    observer.observe(sentinel);
  }
  loadCatalogPage(true);
}
