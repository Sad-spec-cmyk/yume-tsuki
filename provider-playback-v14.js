(() => {
  if (window.__YUME_PROVIDER_PLAYBACK_V14) return;
  window.__YUME_PROVIDER_PLAYBACK_V14 = true;
  // Disable the old Yummy interception before its legacy script can do anything.
  window.__YUME_DIRECT_YUMMY_V1 = true;

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const nativeFetch = window.fetch.bind(window);
  const providersById = new Map();
  const providersByName = new Map();
  let externalHls = null;
  let activeProvider = null;
  let activeEpisode = '';
  let activeQualities = {};
  let activeQuality = '';
  let resolving = false;

  const norm = value => String(value || '')
    .toLowerCase().replace(/ё/g, 'е')
    .replace(/\b(озвучка|субтитры|озв|dub|sub)\b/gi, ' ')
    .replace(/[^a-zа-я0-9]+/gi, ' ').replace(/\s+/g, ' ').trim();
  const safeUrl = raw => {
    let value = String(raw || '').trim();
    if (!value) return '';
    if (value.startsWith('//')) value = `https:${value}`;
    try { const u = new URL(value, location.href); return /^https?:$/.test(u.protocol) ? u.toString() : ''; }
    catch { return ''; }
  };
  const mediaUrl = url => /\.(?:m3u8|mp4)(?:$|\?)/i.test(String(url || ''));

  function installStyle() {
    if ($('#providerPlaybackV14Style')) return;
    const style = document.createElement('style');
    style.id = 'providerPlaybackV14Style';
    style.textContent = `
      /* One page scrollbar only. */
      #providerCard,.provider-card,.provider-kodik-list,.provider-result-group{max-height:none!important;overflow:visible!important}
      .provider-kodik-list{padding-right:0!important}
      .anime-sidebar{overflow:visible!important}
      #yumeExternalPlayer,.yume-external-player,.hotfix-kodik-group{display:none!important}
      .provider-choice.provider-failed{opacity:.58;border-color:rgba(255,255,255,.06)!important}
      .provider-choice.provider-failed small{color:#ff8a9f!important}
      .provider-choice.is-resolving{pointer-events:none;opacity:.76}
      .provider-choice.is-resolving b:after{content:'  ·  загрузка';font-size:9px;color:#9da5b5;font-weight:600}
      #providerNotice{position:relative!important;z-index:3!important}
      #yumeExternalVideo[data-yume-v14="1"]{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#020307;z-index:6;border-radius:inherit}
      .yume-player.yume-external-active .player-poster-layer{opacity:0!important}
      .yume-player.yume-external-active .player-vignette{z-index:7}
      .yume-player.yume-external-active .player-topline,.yume-player.yume-external-active .player-controls,.yume-player.yume-external-active .center-play{z-index:20!important}
      @media(max-width:1100px){#providerCard,.provider-card{position:static!important}}
    `;
    document.head.appendChild(style);
  }

  function cacheProvider(provider) {
    if (!provider || !provider.id) return;
    providersById.set(String(provider.id), provider);
    const key = norm(provider.name);
    if (!key) return;
    if (!providersByName.has(key)) providersByName.set(key, []);
    const arr = providersByName.get(key);
    if (!arr.some(x => String(x.id) === String(provider.id))) arr.push(provider);
  }

  function cachePayload(data) {
    for (const p of Array.isArray(data?.providers) ? data.providers : []) cacheProvider(p);
  }

  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    try {
      const input = args[0];
      const url = typeof input === 'string' ? input : input?.url || '';
      if (String(url).includes('/.netlify/functions/providers') || String(url).includes('/.netlify/functions/provider-catalogs')) {
        response.clone().json().then(cachePayload).catch(() => {});
      }
    } catch {}
    return response;
  };

  function currentEpisode() {
    const direct = window.YUME_NOW_PLAYING?.episodeNumber;
    if (direct !== undefined && direct !== null && String(direct).trim()) return String(direct).trim();
    return ($('#currentEpisodeBadge')?.textContent || '').match(/\d+(?:\.\d+)?/)?.[0] || '1';
  }

  function linkFor(provider, episode = currentEpisode()) {
    const eps = provider?.episodes && typeof provider.episodes === 'object' ? provider.episodes : {};
    const exact = safeUrl(eps[String(episode)]);
    if (exact) return exact;
    const numeric = Number(episode);
    const same = Object.entries(eps).find(([key]) => Number(key) === numeric)?.[1];
    return safeUrl(same || provider?.link || '');
  }

  function providerFromButton(button) {
    const id = String(button?.dataset?.providerId || '');
    if (id && providersById.has(id)) return providersById.get(id);
    const name = norm(button?.querySelector('b')?.textContent || button?.textContent || '');
    const list = providersByName.get(name) || [];
    return list[0] || null;
  }

  function candidateProviders(provider) {
    const key = norm(provider?.name);
    const same = key ? (providersByName.get(key) || []) : [];
    const out = [provider, ...same];
    const seen = new Set();
    return out.filter(p => {
      const id = `${p?.id || ''}:${linkFor(p)}`;
      if (!p || seen.has(id)) return false;
      seen.add(id); return true;
    });
  }

  function notice(text, timeout = 5200) {
    let box = $('#providerNotice');
    if (!box) {
      box = document.createElement('div');
      box.id = 'providerNotice';
      box.style.cssText = 'margin-top:8px;padding:10px 11px;border:1px solid rgba(255,57,95,.28);border-radius:11px;background:rgba(255,57,95,.08);font-size:11px;line-height:1.45;color:#d1d5df';
      $('#providerCard')?.appendChild(box);
    }
    box.textContent = text;
    box.style.display = 'block';
    clearTimeout(box._timer);
    box._timer = setTimeout(() => { box.style.display = 'none'; }, timeout);
  }

  function killIframe() {
    const frame = $('#yumeExternalPlayer');
    if (!frame) return;
    try { frame.src = 'about:blank'; } catch {}
    frame.removeAttribute('src');
    frame.classList.add('hidden');
    frame.style.display = 'none';
  }

  function destroyExternal() {
    if (externalHls) { try { externalHls.destroy(); } catch {} externalHls = null; }
    const old = $('#yumeExternalVideo');
    if (old) { try { old.pause(); } catch {} old.remove(); }
  }

  function showYumeChrome() {
    $('#playerControls')?.classList.remove('provider-hidden');
    $('#centerPlay')?.classList.remove('provider-hidden');
    $('#yumePlayer')?.querySelector('.player-topline')?.classList.remove('provider-hidden');
  }

  function restoreNative(showMessage = '') {
    activeProvider = null;
    activeEpisode = '';
    activeQualities = {};
    activeQuality = '';
    destroyExternal();
    killIframe();
    const player = $('#yumePlayer');
    player?.classList.remove('yume-external-active');
    const native = $('#yumeVideo');
    native?.classList.remove('provider-hidden');
    showYumeChrome();
    $$('.provider-choice').forEach(x => x.classList.remove('active'));
    $('#providerCard [data-provider="aniliberty"]')?.classList.add('active');
    window.YUME_ACTIVE_PROVIDER = { id:'aniliberty', name:'AniLiberty', kind:'native' };
    if (showMessage) notice(showMessage);
  }

  async function resolveLink(url, provider) {
    const source = safeUrl(url);
    if (!source) throw new Error('нет ссылки на эту серию');
    if (mediaUrl(source)) return { stream:source, qualities:{ Auto:source }, player:'Direct', adFree:true };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 14000);
    try {
      const qs = new URLSearchParams({ url:source, player:String(provider?.player || provider?.source || ''), _:String(Date.now()) });
      const r = await nativeFetch(`/.netlify/functions/resolve-yummy?${qs}`, { headers:{accept:'application/json'}, cache:'no-store', signal:controller.signal });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data?.stream) throw new Error(data?.error || `источник ответил ${r.status}`);
      return data;
    } finally { clearTimeout(timer); }
  }

  function waitPlayable(video, timeout = 8500) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (ok, error) => {
        if (done) return; done = true;
        clearTimeout(timer);
        ['loadedmetadata','canplay','error','stalled','abort'].forEach(type => video.removeEventListener(type, handlers[type]));
        ok ? resolve(true) : reject(error || new Error('поток не запускается'));
      };
      const handlers = {
        loadedmetadata:() => finish(true),
        canplay:() => finish(true),
        error:() => finish(false, new Error('видео отклонено источником')),
        stalled:() => {}, abort:() => {},
      };
      Object.entries(handlers).forEach(([type, fn]) => video.addEventListener(type, fn));
      const timer = setTimeout(() => finish(false, new Error('таймаут загрузки видео')), timeout);
    });
  }

  async function attachStream(stream, resolved, provider, preserve = null) {
    const player = $('#yumePlayer');
    if (!player) throw new Error('Yume Player не найден');
    killIframe();
    destroyExternal();
    $('#yumeVideo')?.pause();
    $('#yumeVideo')?.classList.add('provider-hidden');
    showYumeChrome();
    player.classList.add('yume-external-active');

    const video = document.createElement('video');
    video.id = 'yumeExternalVideo';
    video.dataset.yumeV14 = '1';
    video.controls = false;
    video.autoplay = false;
    video.playsInline = true;
    video.preload = 'metadata';
    player.appendChild(video);

    const src = safeUrl(stream);
    if (!src) throw new Error('пустой видеопоток');
    if (/\.m3u8(?:$|\?)/i.test(src) && window.Hls?.isSupported?.()) {
      externalHls = new window.Hls({ enableWorker:true, lowLatencyMode:false, backBufferLength:75, maxBufferLength:45 });
      externalHls.loadSource(src);
      externalHls.attachMedia(video);
      externalHls.on(window.Hls.Events.ERROR, (_, data) => {
        if (data?.fatal) video.dispatchEvent(new Event('error'));
      });
    } else {
      video.src = src;
    }

    await waitPlayable(video);
    if (preserve?.time > 0) {
      try { video.currentTime = Math.min(preserve.time, Math.max(0, (Number(video.duration) || preserve.time + 2) - .5)); } catch {}
    }
    if (Number.isFinite(preserve?.volume)) video.volume = preserve.volume;
    if (Number(preserve?.rate) > 0) video.playbackRate = preserve.rate;

    bindExternalEvents(video);
    activeQualities = resolved?.qualities && typeof resolved.qualities === 'object' ? resolved.qualities : { Auto:src };
    activeQuality = Object.entries(activeQualities).find(([,v]) => safeUrl(v) === src)?.[0] || Object.keys(activeQualities).at(-1) || 'Auto';
    window.YUME_EXTERNAL_QUALITIES = activeQualities;
    window.dispatchEvent(new CustomEvent('yume:external-qualities', { detail:{ qualities:activeQualities, provider } }));
    syncUi(video);
    await video.play().catch(() => {});
    return video;
  }

  function bindExternalEvents(video) {
    const player = $('#yumePlayer');
    const sync = () => syncUi(video);
    video.addEventListener('timeupdate', sync);
    video.addEventListener('durationchange', sync);
    video.addEventListener('volumechange', sync);
    video.addEventListener('ratechange', sync);
    video.addEventListener('play', () => { player?.classList.add('playing'); sync(); });
    video.addEventListener('pause', () => { player?.classList.remove('playing'); sync(); });
    video.addEventListener('ended', () => { player?.classList.remove('playing'); sync(); });
  }

  function fmt(seconds) {
    const s = Math.max(0, Number(seconds) || 0);
    const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = Math.floor(s%60);
    return h ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
  }

  function syncUi(video = $('#yumeExternalVideo')) {
    if (!video || video.dataset.yumeV14 !== '1') return;
    const duration = Number(video.duration) || 0;
    const current = Number(video.currentTime) || 0;
    const progress = $('#progress');
    if (progress && duration > 0) progress.value = String(Math.round((current/duration)*1000));
    if ($('#timeLabel')) $('#timeLabel').textContent = `${fmt(current)} / ${fmt(duration)}`;
    if ($('#volume')) $('#volume').value = String(video.muted ? 0 : video.volume);
    if ($('#speedSelect')) $('#speedSelect').value = String(video.playbackRate || 1);
    const quality = $('#qualitySelect');
    if (quality && activeQualities && Object.keys(activeQualities).length) {
      const labels = Object.keys(activeQualities);
      if (quality.dataset.externalV14 !== labels.join('|')) {
        quality.dataset.externalV14 = labels.join('|');
        quality.innerHTML = labels.map(label => `<option value="${String(label).replace(/"/g,'&quot;')}">${label}</option>`).join('');
      }
      if (labels.includes(activeQuality)) quality.value = activeQuality;
    }
    if ($('#currentQualityBadge')) $('#currentQualityBadge').textContent = activeProvider?.name || activeQuality || 'Источник';
  }

  async function playProvider(provider, button = null, silent = false) {
    if (!provider || resolving) return;
    resolving = true;
    const episode = currentEpisode();
    const oldSmall = button?.querySelector('small')?.textContent || '';
    button?.classList.add('is-resolving');
    button?.classList.remove('provider-failed');
    if (button?.querySelector('small')) button.querySelector('small').textContent = 'Подключаем к Yume Player · без рекламного iframe…';

    const candidates = candidateProviders(provider)
      .map(p => ({ provider:p, link:linkFor(p, episode) }))
      .filter(x => x.link);
    const seenLinks = new Set();
    let lastError = null;

    try {
      for (const candidate of candidates) {
        if (seenLinks.has(candidate.link)) continue;
        seenLinks.add(candidate.link);
        try {
          const resolved = await resolveLink(candidate.link, candidate.provider);
          const preserveVideo = $('#yumeExternalVideo');
          const preserve = preserveVideo ? { time:Number(preserveVideo.currentTime)||0, volume:preserveVideo.volume, rate:preserveVideo.playbackRate } : null;
          await attachStream(resolved.stream, resolved, provider, preserve);
          activeProvider = provider;
          activeEpisode = episode;
          $$('.provider-choice').forEach(x => x.classList.remove('active'));
          const id = String(provider.id || '');
          if (id) document.querySelector(`[data-provider-id="${CSS.escape(id)}"]`)?.classList.add('active');
          button?.classList.add('active');
          window.YUME_ACTIVE_PROVIDER = { ...provider, kind:'external-direct', adFree:true };
          if (!silent) notice(`${provider.name || 'Озвучка'} подключена к Yume Player. Внешний рекламный плеер отключён.`, 2600);
          return;
        } catch (error) { lastError = error; }
      }
      throw lastError || new Error(`для серии ${episode} нет прямого потока`);
    } catch (error) {
      button?.classList.add('provider-failed');
      if (button?.querySelector('small')) button.querySelector('small').textContent = 'Недоступно без внешнего рекламного плеера';
      restoreNative(`${provider.name || 'Источник'}: ${error?.message || 'поток недоступен'}. Рекламный iframe не открываем — оставил AniLiberty.`);
    } finally {
      resolving = false;
      button?.classList.remove('is-resolving');
      if (button?.querySelector('small') && !button.classList.contains('provider-failed')) button.querySelector('small').textContent = oldSmall;
    }
  }

  function interceptProviderClick(event) {
    const button = event.target.closest?.('.provider-choice');
    if (!button) return;
    if (button.dataset.provider === 'aniliberty') {
      if (activeProvider) restoreNative();
      return;
    }
    // Hide duplicate legacy Kodik/iframe choices. The normal providers list contains Kodik too.
    if (button.classList.contains('hotfix-kodik-choice') || button.dataset.hotfixKodikId) {
      event.preventDefault(); event.stopImmediatePropagation();
      notice('Этот старый Kodik iframe отключён. Используй Kodik из списка озвучек — он запускается через Yume Player.');
      return;
    }
    const provider = providerFromButton(button);
    if (!provider) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    playProvider(provider, button, false);
  }

  document.addEventListener('click', interceptProviderClick, true);

  // Rewire the existing Yume controls to the external direct video.
  document.addEventListener('click', event => {
    const video = $('#yumeExternalVideo');
    if (!video || video.dataset.yumeV14 !== '1') return;
    const target = event.target.closest?.('#playBtn,#centerPlay,#backBtn,#forwardBtn,#muteBtn,#fullscreenBtn');
    if (!target) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (target.id === 'playBtn' || target.id === 'centerPlay') video.paused ? video.play().catch(()=>{}) : video.pause();
    else if (target.id === 'backBtn') video.currentTime = Math.max(0, video.currentTime - 10);
    else if (target.id === 'forwardBtn') video.currentTime = Math.min(Number(video.duration)||Infinity, video.currentTime + 10);
    else if (target.id === 'muteBtn') video.muted = !video.muted;
    else if (target.id === 'fullscreenBtn') $('#yumePlayer')?.requestFullscreen?.().catch?.(()=>{});
    syncUi(video);
  }, true);

  document.addEventListener('input', event => {
    const video = $('#yumeExternalVideo');
    if (!video || video.dataset.yumeV14 !== '1') return;
    if (event.target.id === 'progress') {
      event.stopImmediatePropagation();
      const duration = Number(video.duration) || 0;
      if (duration > 0) video.currentTime = duration * (Number(event.target.value || 0) / 1000);
    } else if (event.target.id === 'volume') {
      event.stopImmediatePropagation();
      video.muted = false; video.volume = Math.max(0, Math.min(1, Number(event.target.value) || 0));
    }
  }, true);

  document.addEventListener('change', event => {
    const video = $('#yumeExternalVideo');
    if (!video || video.dataset.yumeV14 !== '1') return;
    if (event.target.id === 'speedSelect') {
      event.stopImmediatePropagation();
      video.playbackRate = Math.max(.25, Math.min(3, Number(event.target.value) || 1));
    } else if (event.target.id === 'qualitySelect') {
      event.stopImmediatePropagation();
      const label = String(event.target.value || '');
      const stream = safeUrl(activeQualities[label]);
      if (!stream || label === activeQuality) return;
      const preserve = { time:Number(video.currentTime)||0, volume:video.volume, rate:video.playbackRate };
      const wasPlaying = !video.paused;
      activeQuality = label;
      attachStream(stream, { qualities:activeQualities, stream }, activeProvider, preserve).then(v => { if (!wasPlaying) v.pause(); }).catch(error => notice(error.message || 'Не удалось сменить качество.'));
    }
  }, true);

  // If a series is changed while an external dub is selected, keep the same dub.
  setInterval(() => {
    killIframe();
    if (!activeProvider || resolving) return;
    const ep = currentEpisode();
    if (!ep || ep === activeEpisode) return;
    activeEpisode = ep;
    const button = document.querySelector(`[data-provider-id="${CSS.escape(String(activeProvider.id || ''))}"]`);
    playProvider(activeProvider, button, true);
  }, 450);

  installStyle();
  killIframe();
})();