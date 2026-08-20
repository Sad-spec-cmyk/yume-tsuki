(() => {
  if (window.__YUME_PROVIDER_SOURCES_V5) return;
  window.__YUME_PROVIDER_SOURCES_V5 = true;
  window.__YUME_PROVIDER_SOURCES_V2 = true;
  window.__YUME_PROVIDER_SOURCES_V3 = true;
  window.__YUME_PROVIDER_SOURCES_V4 = true;

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const norm = v => String(v || '').toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/gi,' ').trim();
  let activeExternal = null;
  let lastEpisode = '';
  let externalHls = null;

  function normalizeUrl(raw) {
    const value = String(raw || '').trim();
    if (!value) return '';
    if (value.startsWith('//')) return `https:${value}`;
    return /^https?:\/\//i.test(value) ? value : '';
  }

  async function waitForCard() {
    for (let i = 0; i < 120; i++) {
      const card = $('#providerCard');
      if (card) return card;
      await sleep(100);
    }
    return null;
  }

  function currentEpisodeNumber() {
    const direct = window.YUME_NOW_PLAYING?.episodeNumber;
    if (direct !== undefined && direct !== null && String(direct).trim()) return String(direct).trim();
    const badge = $('#currentEpisodeBadge')?.textContent || '';
    return badge.match(/(\d+(?:\.\d+)?)/)?.[1] || '1';
  }

  function providerLink(provider, episode = currentEpisodeNumber()) {
    if (provider?.episodes && typeof provider.episodes === 'object') {
      const exact = normalizeUrl(provider.episodes[String(episode)]);
      if (exact) return exact;
      const numeric = Number(episode);
      if (Number.isFinite(numeric)) {
        const same = Object.keys(provider.episodes).find(k => Number(k) === numeric);
        if (same) return normalizeUrl(provider.episodes[same]);
      }
      return '';
    }
    return normalizeUrl(provider?.link);
  }

  function clearExternalVideo() {
    if (externalHls) { try { externalHls.destroy(); } catch {} externalHls = null; }
    const video = $('#yumeExternalVideo');
    if (video) { try { video.pause(); } catch {} video.remove(); }
  }

  function hideExternalFrame() {
    const frame = $('#yumeExternalPlayer');
    if (frame) { frame.classList.add('hidden'); frame.removeAttribute('src'); }
  }

  function hideNative() {
    $('#yumeVideo')?.pause();
    $('#yumeVideo')?.classList.add('provider-hidden');
    $('#playerControls')?.classList.add('provider-hidden');
    $('#centerPlay')?.classList.add('provider-hidden');
    $('#yumePlayer')?.querySelector('.player-topline')?.classList.add('provider-hidden');
  }

  function showNative() {
    $('#yumeVideo')?.classList.remove('provider-hidden');
    $('#playerControls')?.classList.remove('provider-hidden');
    $('#centerPlay')?.classList.remove('provider-hidden');
    $('#yumePlayer')?.querySelector('.player-topline')?.classList.remove('provider-hidden');
  }

  function markActive(provider) {
    $$('.provider-choice').forEach(x => x.classList.remove('active'));
    document.querySelector(`[data-provider-id="${CSS.escape(provider.id)}"]`)?.classList.add('active');
    if ($('#currentQualityBadge')) $('#currentQualityBadge').textContent = provider.name || provider.source || 'Источник';
    activeExternal = provider;
    lastEpisode = String(currentEpisodeNumber());
    window.YUME_ACTIVE_PROVIDER = { ...provider, kind:'external' };
  }

  function showNotice(text) {
    let notice = $('#providerNotice');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'providerNotice';
      notice.style.cssText = 'margin-top:8px;padding:9px 10px;border:1px solid rgba(255,57,95,.28);border-radius:10px;background:rgba(255,57,95,.08);font-size:11px;line-height:1.45;color:#cbd0dc;display:none';
      $('#providerCard')?.appendChild(notice);
    }
    notice.textContent = text;
    notice.style.display = 'block';
    clearTimeout(notice._timer);
    notice._timer = setTimeout(() => { notice.style.display = 'none'; }, 4000);
  }

  function playDirectVideo(provider, link) {
    const player = $('#yumePlayer');
    if (!player) return false;
    hideExternalFrame();
    clearExternalVideo();
    hideNative();
    const video = document.createElement('video');
    video.id = 'yumeExternalVideo';
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#05060a;z-index:6;border-radius:inherit';
    player.appendChild(video);
    if (/\.m3u8(?:$|\?)/i.test(link) && window.Hls?.isSupported?.()) {
      externalHls = new window.Hls({ enableWorker:true, lowLatencyMode:false, backBufferLength:60 });
      externalHls.loadSource(link);
      externalHls.attachMedia(video);
      externalHls.on(window.Hls.Events.MANIFEST_PARSED, () => video.play().catch(()=>{}));
    } else {
      video.src = link;
      video.play().catch(()=>{});
    }
    markActive(provider);
    return true;
  }

  function setExternal(provider, silent = false) {
    const player = $('#yumePlayer');
    if (!player || !provider) return false;
    const episode = currentEpisodeNumber();
    const link = providerLink(provider, episode);

    if (!link) {
      const page = normalizeUrl(provider.externalPage);
      if (page && !silent) {
        showNotice(`«${provider.name}» найдено в ${provider.source || 'каталоге'}. Открываю страницу источника.`);
        window.open(page, '_blank', 'noopener,noreferrer');
        return true;
      }
      if (!silent) showNotice(`Для «${provider.name || 'этой озвучки'}» нет прямой ссылки на серию ${episode}.`);
      return false;
    }

    if (provider.playback === 'video') return playDirectVideo(provider, link);

    clearExternalVideo();
    hideNative();
    let frame = $('#yumeExternalPlayer');
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = 'yumeExternalPlayer';
      frame.className = 'yume-external-player';
      frame.allow = 'autoplay; fullscreen; picture-in-picture';
      frame.allowFullscreen = true;
      frame.referrerPolicy = 'origin';
      player.appendChild(frame);
    }
    if (frame.src !== link) frame.src = link;
    frame.classList.remove('hidden');
    markActive(provider);
    return true;
  }

  function restoreNative() {
    activeExternal = null;
    lastEpisode = '';
    clearExternalVideo();
    hideExternalFrame();
    showNative();
    $$('.provider-choice').forEach(x => x.classList.remove('active'));
    $('#providerCard [data-provider="aniliberty"]')?.classList.add('active');
    window.YUME_ACTIVE_PROVIDER = { id:'aniliberty', name:'AniLiberty', kind:'native' };
  }

  function titleCandidates() {
    return [...new Set([
      $('#animeTitle')?.textContent,
      $('#animeAltTitle')?.textContent,
      window.YUME_NOW_PLAYING?.title,
      document.title?.replace(/\s*[—-]\s*Yume Tsuki\s*$/i, ''),
    ].map(x=>String(x||'').trim()).filter(x=>x&&x!=='Загрузка...'))].slice(0,10);
  }

  function queryString() {
    const titles = titleCandidates();
    const title = titles[0] || '';
    const year = $('#sideYear')?.textContent?.trim() || '';
    if (!title) return '';
    return new URLSearchParams({ title, year:/^\d{4}$/.test(year)?year:'', titles:titles.slice(1).join('|'), _:String(Date.now()) }).toString();
  }

  async function requestJson(path, qs) {
    const r = await fetch(`${path}?${qs}`, { headers:{accept:'application/json'}, cache:'no-store' });
    const data = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(data.error || `Ошибка ${r.status}`);
    return data;
  }

  function mergeResults(direct, catalogs) {
    const map = new Map();
    const all = [...(direct?.providers || []), ...(catalogs?.providers || [])];
    for (const p of all) {
      if (!p?.name) continue;
      const kind = p.translationType === 'subtitles' ? 'subtitles' : 'voice';
      const key = `${kind}:${norm(p.name).replace(/\b(озвучка|ozvuchka)\b/g,'').trim()}`;
      if (!map.has(key)) {
        map.set(key, { ...p, sources:[...(p.sources || p.via || []), p.source].filter(Boolean) });
        continue;
      }
      const x = map.get(key);
      x.sources = [...new Set([...(x.sources || []), ...(p.sources || p.via || []), p.source].filter(Boolean))];
      const xDirect = !!providerLink(x) || (x.episodes && Object.keys(x.episodes).length);
      const pDirect = !!providerLink(p) || (p.episodes && Object.keys(p.episodes).length);
      if (!xDirect && pDirect) Object.assign(x, { ...p, sources:x.sources, externalPage:x.externalPage || p.externalPage });
      else {
        if (!x.externalPage && p.externalPage) x.externalPage = p.externalPage;
        if (!x.link && p.link) x.link = p.link;
      }
    }
    return [...map.values()];
  }

  function episodeRange(provider) {
    const eps = Array.isArray(provider.availableEpisodes) ? provider.availableEpisodes.map(Number).filter(Number.isFinite).sort((a,b)=>a-b) : [];
    if (!eps.length) return provider.lastEpisode ? `до ${provider.lastEpisode} серии` : '';
    if (eps.length === 1) return `серия ${eps[0]}`;
    const continuous = eps.every((v,i)=>i===0 || v===eps[i-1]+1);
    return continuous ? `серии ${eps[0]}–${eps.at(-1)}` : `${eps.length} серий`;
  }

  function providerMeta(provider) {
    const src = provider.sources?.length ? provider.sources.join(' + ') : (provider.via?.length ? provider.via.join(' + ') : provider.source || 'Источник');
    const bits=[src];
    if (provider.quality && provider.quality !== 'unknown') bits.push(String(provider.quality).toUpperCase());
    const range=episodeRange(provider); if(range)bits.push(range);
    if(!providerLink(provider)&&provider.externalPage)bits.push('внешняя страница');
    return bits.join(' · ');
  }

  function buttonHtml(p) {
    const direct = !!providerLink(p) || (p.episodes && Object.keys(p.episodes).length);
    return `<button type="button" class="provider-choice provider-extra ${direct?'provider-direct':'provider-catalog'}" data-provider-id="${esc(p.id)}"><b>${esc(p.name)} <span style="float:right;opacity:.7">${direct?'▶':'↗'}</span></b><small>${esc(providerMeta(p))}</small></button>`;
  }

  function groupHtml(title,items) {
    if(!items.length)return'';
    return `<div class="provider-result-group"><div style="display:flex;justify-content:space-between;align-items:center;padding:10px 2px 6px;font-size:12px;font-weight:800;color:#eef0f6"><span>${esc(title)}</span><span style="color:#ff4d78">${items.length}</span></div>${items.map(buttonHtml).join('')}</div>`;
  }

  function diagnosticsText(direct,catalogs) {
    const a=direct?.diagnostics||{}, b=catalogs?.diagnostics||{};
    return [
      `AnimeVost ${Number(a?.animevost?.found||0)}`,
      `Shikimori ${Number(a?.shikimori?.found||0)}`,
      a?.yummy?.configured?`YummyAnime ${Number(a?.yummy?.found||0)}`:'YummyAnime: нужен токен',
      a?.kodik?.configured?`Kodik ${Number(a?.kodik?.found||0)}`:'Kodik: нужен токен',
      `AnimeOn ${Number(b?.animeon?.found||0)}`,
      `AniLibria.media ${Number(b?.anilibriamedia?.found||0)}`,
    ].join(' · ');
  }

  async function boot() {
    const card = await waitForCard();
    if (!card) return;
    card.querySelector('[data-provider="aniliberty"]')?.addEventListener('click', restoreNative, true);
    let list=card.querySelector('.provider-kodik-list');
    if(!list){list=document.createElement('div');list.className='provider-kodik-list';card.querySelector('.provider-note')?.insertAdjacentElement('beforebegin',list);}
    list.style.maxHeight='430px'; list.style.overflowY='auto'; list.style.paddingRight='3px';
    list.innerHTML='<div class="provider-loading"><b>Ищем все доступные озвучки…</b><br><small>AnimeVost · Shikimori · YummyAnime · Kodik · AnimeOn · AniLibria.media</small></div>';

    const qs=queryString();
    if(!qs){list.innerHTML='<div class="provider-empty">Не удалось определить название аниме.</div>';return;}
    try{
      const [direct,catalogs]=await Promise.all([
        requestJson('/.netlify/functions/providers',qs).catch(e=>({providers:[],diagnostics:{},error:e.message})),
        requestJson('/.netlify/functions/provider-catalogs',qs).catch(e=>({providers:[],diagnostics:{},error:e.message})),
      ]);
      const providers=mergeResults(direct,catalogs);
      const voices=providers.filter(p=>p.translationType!=='subtitles');
      const subtitles=providers.filter(p=>p.translationType==='subtitles');
      if(!providers.length){
        list.innerHTML=`<div class="provider-empty"><b>Дополнительные варианты не найдены.</b><br><small>${esc(diagnosticsText(direct,catalogs))}</small></div>`;
      } else {
        list.innerHTML=groupHtml('Озвучки',voices)+groupHtml('Субтитры',subtitles);
        providers.forEach(p=>list.querySelector(`[data-provider-id="${CSS.escape(p.id)}"]`)?.addEventListener('click',()=>setExternal(p,false)));
      }
      const note=card.querySelector('.provider-note');
      if(note)note.innerHTML=`<b>Найдено ${voices.length} озвучек${subtitles.length?` и ${subtitles.length} субтитров`:''}.</b><br><small>${esc(diagnosticsText(direct,catalogs))}</small>`;
    }catch(error){
      list.innerHTML=`<div class="provider-empty"><b>Ошибка поиска.</b><br><small>${esc(error?.message||'Не удалось загрузить озвучки.')}</small></div>`;
    }
  }

  setInterval(()=>{
    if(!activeExternal)return;
    const episode=currentEpisodeNumber();
    if(!episode||episode===lastEpisode)return;
    lastEpisode=episode;
    setExternal(activeExternal,true);
  },650);

  boot();
})();
