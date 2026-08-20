(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const feature = (...args) => window.YUME_ACCOUNT?.feature?.(...args);
  const DEFAULT_PREFS = { autoSkipOpening: true, autoNextEpisode: true };
  const state = {
    prefs: { ...DEFAULT_PREFS },
    release: null,
    resume: null,
    externalPlayer: '',
    provider: 'aniliberty',
    lastQuality: '',
    party: null,
    partyHost: false,
    partyTimer: 0,
    syncing: false,
    skipLatch: '',
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const fmt = value => {
    const s = Math.max(0, Number(value) || 0);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
    return h ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
  };

  async function waitFor(selector, timeout = 10000) {
    const existing = $(selector);
    if (existing) return existing;
    return new Promise(resolve => {
      const started = Date.now();
      const timer = setInterval(() => {
        const el = $(selector);
        if (el || Date.now() - started > timeout) {
          clearInterval(timer);
          resolve(el || null);
        }
      }, 80);
    });
  }

  function currentAlias() {
    return new URL(location.href).searchParams.get('alias') || window.YUME_NOW_PLAYING?.alias || '';
  }
  function currentAnimeKey() {
    return currentAlias() || window.YUME_NOW_PLAYING?.animeId || window.YUME_NOW_PLAYING?.title || '';
  }
  function currentEpisodeIndex() {
    const active = $('.episode-row.active');
    return active ? Number(active.dataset.index || 0) : 0;
  }
  function currentQuality() {
    const select = $('#qualitySelect');
    return select?.selectedOptions?.[0]?.textContent?.trim() || state.lastQuality || '';
  }
  function localResumeKey() {
    return `yume-resume:${String(currentAnimeKey()).trim().toLowerCase()}`;
  }

  async function loadPreferences() {
    try {
      state.prefs = { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem('yume-preferences') || '{}') || {}) };
    } catch {
      state.prefs = { ...DEFAULT_PREFS };
    }
    const waitStarted = Date.now();
    while (!window.YUME_ACCOUNT?.ready && Date.now() - waitStarted < 1800) await sleep(80);
    if (window.YUME_ACCOUNT?.user && feature) {
      try {
        const data = await feature('preferences', { method: 'GET', headers: {} });
        state.prefs = { ...DEFAULT_PREFS, ...(data.preferences || {}) };
        localStorage.setItem('yume-preferences', JSON.stringify(state.prefs));
      } catch {}
    }
    document.dispatchEvent(new CustomEvent('yume:preferences', { detail: state.prefs }));
  }

  async function fetchRelease() {
    for (let i = 0; i < 40; i++) {
      const alias = currentAlias();
      if (alias) {
        try {
          const path = `/anime/releases/${encodeURIComponent(alias)}`;
          const r = await fetch(`/.netlify/functions/aniliberty?path=${encodeURIComponent(path)}`, { headers: { accept: 'application/json' } });
          if (r.ok) {
            const j = await r.json();
            state.release = j?.data || j;
            state.externalPlayer = String(state.release?.external_player || '').trim();
            return state.release;
          }
        } catch {}
        break;
      }
      await sleep(100);
    }
    return null;
  }

  function episodeMeta(index = currentEpisodeIndex()) {
    const list = state.release?.episodes || state.release?.playlist || [];
    if (!Array.isArray(list)) return null;
    return list[index] || null;
  }

  function makeCustomSelect(select, kind) {
    if (!select || select.dataset.yumeCustom === '1') return;
    select.dataset.yumeCustom = '1';
    select.classList.add('yume-native-select');

    const wrapper = document.createElement('div');
    wrapper.className = `yume-select yume-select-${kind}`;
    wrapper.innerHTML = `<button type="button" class="yume-select-button" aria-haspopup="listbox"><span></span><i>⌄</i></button><div class="yume-select-menu" role="listbox"></div>`;
    select.insertAdjacentElement('afterend', wrapper);

    const button = wrapper.querySelector('.yume-select-button');
    const label = button.querySelector('span');
    const menu = wrapper.querySelector('.yume-select-menu');

    const rebuild = () => {
      const options = [...select.options];
      label.textContent = select.selectedOptions?.[0]?.textContent || options[0]?.textContent || '—';
      menu.innerHTML = options.map(o => `<button type="button" role="option" data-value="${esc(o.value)}" class="${o.selected ? 'active' : ''}">${esc(o.textContent)}</button>`).join('');
      menu.querySelectorAll('button').forEach(item => item.addEventListener('click', () => {
        select.value = item.dataset.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        wrapper.classList.remove('open');
        rebuild();
      }));
    };

    button.addEventListener('click', e => {
      e.stopPropagation();
      document.querySelectorAll('.yume-select.open').forEach(x => { if (x !== wrapper) x.classList.remove('open'); });
      wrapper.classList.toggle('open');
    });
    select.addEventListener('change', () => {
      if (kind === 'quality') state.lastQuality = currentQuality();
      rebuild();
    });
    new MutationObserver(rebuild).observe(select, { childList: true, subtree: true, attributes: true });
    rebuild();
  }

  function initCustomSelects() {
    makeCustomSelect($('#qualitySelect'), 'quality');
    makeCustomSelect($('#speedSelect'), 'speed');
    document.addEventListener('click', () => document.querySelectorAll('.yume-select.open').forEach(x => x.classList.remove('open')));
  }

  async function readResume() {
    let local = null, remote = null;
    try { local = JSON.parse(localStorage.getItem(localResumeKey()) || 'null'); } catch {}
    if (window.YUME_ACCOUNT?.user && feature) {
      try {
        const data = await feature('resume', { method: 'GET', headers: {} }, { key: currentAnimeKey() });
        remote = data.item || null;
      } catch {}
    }
    state.resume = [local, remote].filter(Boolean).sort((a,b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0] || null;
    return state.resume;
  }

  async function applyQuality(label) {
    if (!label) return;
    const select = $('#qualitySelect');
    if (!select) return;
    for (let i = 0; i < 30; i++) {
      const option = [...select.options].find(o => o.textContent.trim() === label);
      if (option) {
        if (select.value !== option.value) {
          select.value = option.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        state.lastQuality = label;
        return;
      }
      await sleep(80);
    }
  }

  async function seekAndPlay(position, autoplay = true) {
    const video = $('#yumeVideo');
    if (!video) return;
    const seek = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Math.min(Math.max(0, Number(position) || 0), Math.max(0, video.duration - .4));
      if (autoplay) video.play().catch(() => {});
    };
    if (video.readyState >= 1) seek();
    else video.addEventListener('loadedmetadata', seek, { once: true });
  }

  async function loadEpisodeForResume(resume, autoplay = true) {
    if (!resume) return false;
    const rows = $$('.episode-row');
    if (!rows.length) return false;
    let index = Math.max(0, Math.min(rows.length - 1, Number(resume.episodeIndex || 0)));
    if (resume.completed && index < rows.length - 1) {
      index += 1;
      resume = { ...resume, position: 0, episodeIndex: index };
    }
    const activeIndex = currentEpisodeIndex();
    if (activeIndex !== index) {
      rows[index].click();
      await sleep(250);
    }
    if (resume.quality) {
      await applyQuality(resume.quality);
      await sleep(160);
    }
    await seekAndPlay(resume.position || 0, autoplay);
    return true;
  }

  async function continueWatching() {
    const resume = await readResume();
    if (!resume) return;
    await loadEpisodeForResume(resume, true);
    $('#watch')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const hint = $('#resumeHint');
    if (hint) hint.classList.add('hidden');
  }

  function initResumeFix() {
    document.addEventListener('click', event => {
      const hint = event.target.closest('#resumeHint');
      if (!hint) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      continueWatching();
    }, true);
  }

  function showToast(text) {
    let toast = $('#yumePlayerToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'yumePlayerToast';
      toast.className = 'yume-player-toast';
      $('#yumePlayer')?.appendChild(toast);
    }
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 1800);
  }

  function initOpeningSkip() {
    const video = $('#yumeVideo');
    if (!video) return;
    video.addEventListener('timeupdate', () => {
      if (!state.prefs.autoSkipOpening || state.provider !== 'aniliberty') return;
      const ep = episodeMeta();
      const opening = ep?.opening;
      const start = Number(opening?.start);
      const stop = Number(opening?.stop);
      if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= start) return;
      const latch = `${currentEpisodeIndex()}:${start}:${stop}`;
      if (video.currentTime >= start && video.currentTime < stop - .15 && state.skipLatch !== latch) {
        state.skipLatch = latch;
        video.currentTime = Math.min(stop + .08, video.duration || stop + .08);
        showToast(`Опенинг пропущен · ${fmt(stop - start)}`);
      }
      if (video.currentTime < start - 3 || video.currentTime > stop + 3) {
        if (state.skipLatch === latch) state.skipLatch = '';
      }
    });
  }

  async function playNextEpisode() {
    if (!state.prefs.autoNextEpisode || state.provider !== 'aniliberty' || state.party && !state.partyHost) return;
    const rows = $$('.episode-row');
    const next = rows[currentEpisodeIndex() + 1];
    if (!next) return;
    const quality = currentQuality();
    showToast('Следующая серия через 2 секунды');
    await sleep(1800);
    next.click();
    await sleep(240);
    if (quality) await applyQuality(quality);
    const video = $('#yumeVideo');
    if (video) {
      if (video.readyState >= 1) video.play().catch(() => {});
      else video.addEventListener('loadedmetadata', () => video.play().catch(() => {}), { once: true });
    }
  }

  function initAutoNext() {
    const video = $('#yumeVideo');
    if (!video) return;
    video.addEventListener('ended', () => playNextEpisode());
  }

  function providerUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.startsWith('//')) return `https:${raw}`;
    if (/^https?:\/\//i.test(raw)) return raw;
    return '';
  }

  function setProvider(name) {
    state.provider = name;
    const player = $('#yumePlayer');
    const video = $('#yumeVideo');
    const frame = $('#yumeExternalPlayer');
    const controls = $('#playerControls');
    const center = $('#centerPlay');
    const top = player?.querySelector('.player-topline');
    if (name === 'external') {
      video?.pause();
      if (frame) frame.classList.remove('hidden');
      video?.classList.add('provider-hidden');
      controls?.classList.add('provider-hidden');
      center?.classList.add('provider-hidden');
      top?.classList.add('provider-hidden');
    } else {
      frame?.classList.add('hidden');
      video?.classList.remove('provider-hidden');
      controls?.classList.remove('provider-hidden');
      center?.classList.remove('provider-hidden');
      top?.classList.remove('provider-hidden');
    }
    $$('.provider-choice').forEach(b => b.classList.toggle('active', b.dataset.provider === name));
  }

  function initProviderSelector() {
    const url = providerUrl(state.externalPlayer);
    const sidebar = $('.anime-sidebar');
    const player = $('#yumePlayer');
    if (!sidebar || !player || $('#providerCard')) return;
    let externalName = 'Внешний плеер';
    if (url) {
      try {
        const host = new URL(url).hostname.toLowerCase();
        if (host.includes('kodik')) externalName = 'Kodik';
        else externalName = host.replace(/^www\./,'');
      } catch {}
    }
    sidebar.insertAdjacentHTML('afterbegin', `
      <section id="providerCard" class="side-card provider-card">
        <div class="provider-tabs"><span class="active">Озвучка</span><span>Плеер</span></div>
        <button type="button" class="provider-choice active" data-provider="aniliberty"><b>AniLiberty</b><small>Русская озвучка · HLS</small></button>
        ${url ? `<button type="button" class="provider-choice" data-provider="external"><b>${esc(externalName)}</b><small>Дополнительный источник / озвучки</small></button>` : ''}
        <p class="provider-note">${url ? 'Тайтл один — источники переключаются внутри страницы без дублей в каталоге.' : 'Для этого релиза API не вернул дополнительный внешний плеер.'}</p>
      </section>`);
    if (url) {
      const iframe = document.createElement('iframe');
      iframe.id = 'yumeExternalPlayer';
      iframe.className = 'yume-external-player hidden';
      iframe.src = url;
      iframe.allow = 'autoplay; fullscreen; picture-in-picture';
      iframe.allowFullscreen = true;
      iframe.referrerPolicy = 'origin';
      player.appendChild(iframe);
    }
    $$('.provider-choice').forEach(btn => btn.addEventListener('click', () => setProvider(btn.dataset.provider)));
  }

  function partyCurrentState() {
    const video = $('#yumeVideo');
    const now = window.YUME_NOW_PLAYING || {};
    return {
      room: state.party?.room || '',
      episodeIndex: currentEpisodeIndex(),
      episodeNumber: now.episodeNumber || '',
      position: Number(video?.currentTime || 0),
      duration: Number(video?.duration || 0),
      quality: currentQuality(),
      playing: Boolean(video && !video.paused && !video.ended),
      provider: state.provider,
    };
  }

  function openPartyModal(content) {
    let modal = $('#yumePartyModal');
    if (!modal) {
      document.body.insertAdjacentHTML('beforeend', `<div id="yumePartyModal" class="yume-party-modal hidden"><div class="yume-party-card"><button class="yume-party-close" type="button">×</button><div id="yumePartyContent"></div></div></div>`);
      modal = $('#yumePartyModal');
      modal.querySelector('.yume-party-close').onclick = () => modal.classList.add('hidden');
      modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });
    }
    $('#yumePartyContent').innerHTML = content;
    modal.classList.remove('hidden');
  }

  function shareUrl(room) {
    const alias = currentAlias() || state.release?.alias || '';
    const u = new URL('/anime', location.origin);
    if (alias) u.searchParams.set('alias', alias);
    else if (window.YUME_NOW_PLAYING?.title) u.searchParams.set('q', window.YUME_NOW_PLAYING.title);
    u.searchParams.set('party', room);
    u.hash = 'watch';
    return u.toString();
  }

  async function createParty() {
    if (state.provider !== 'aniliberty') {
      setProvider('aniliberty');
      showToast('Совместный просмотр работает через Yume Player');
    }
    if (!window.YUME_ACCOUNT?.user) {
      location.href = `/account?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`;
      return;
    }
    const payload = {
      op: 'create',
      alias: currentAlias() || state.release?.alias || '',
      animeId: state.release?.id || window.YUME_NOW_PLAYING?.animeId || '',
      title: state.release?.name?.main || window.YUME_NOW_PLAYING?.title || document.title,
      ...partyCurrentState(),
    };
    try {
      const result = await feature('party', { method: 'POST', body: JSON.stringify(payload) });
      state.party = result;
      state.partyHost = true;
      startPartyHost();
      const url = shareUrl(result.room);
      openPartyModal(`
        <span class="section-kicker">СМОТРЕТЬ ВМЕСТЕ</span>
        <h2>Комната ${esc(result.room)}</h2>
        <p>Отправь эту ссылку другу. У вас будет одна серия, позиция, пауза и качество.</p>
        <div class="party-link-row"><input id="partyShareInput" readonly value="${esc(url)}"><button id="partyCopyBtn" class="btn primary" type="button">Копировать</button></div>
        <div class="party-live"><i></i> Ты управляешь просмотром</div>`);
      $('#partyCopyBtn')?.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(url); $('#partyCopyBtn').textContent = 'Скопировано'; } catch { $('#partyShareInput')?.select(); }
      });
      renderPartyBadge();
    } catch (e) {
      openPartyModal(`<h2>Не удалось создать комнату</h2><p>${esc(e.message || 'Ошибка')}</p>`);
    }
  }

  async function pushPartyState() {
    if (!state.partyHost || !state.party?.room || !feature) return;
    try {
      await feature('party', { method: 'POST', body: JSON.stringify({ op: 'update', ...partyCurrentState() }) });
    } catch {}
  }
  function startPartyHost() {
    clearInterval(state.partyTimer);
    pushPartyState();
    state.partyTimer = setInterval(pushPartyState, 1500);
    const video = $('#yumeVideo');
    ['play','pause','seeked','ended'].forEach(name => video?.addEventListener(name, pushPartyState));
    $('#qualitySelect')?.addEventListener('change', pushPartyState);
  }

  async function syncGuest(remote) {
    if (!remote || state.syncing) return;
    state.syncing = true;
    try {
      if (remote.provider && remote.provider !== state.provider && remote.provider === 'aniliberty') setProvider('aniliberty');
      const rows = $$('.episode-row');
      const targetIndex = Math.max(0, Math.min(rows.length - 1, Number(remote.episodeIndex || 0)));
      if (rows.length && currentEpisodeIndex() !== targetIndex) {
        rows[targetIndex].click();
        await sleep(300);
      }
      if (remote.quality) {
        await applyQuality(remote.quality);
        await sleep(100);
      }
      const video = $('#yumeVideo');
      if (video && state.provider === 'aniliberty') {
        const diff = Math.abs(Number(video.currentTime || 0) - Number(remote.position || 0));
        if (diff > 2.2) await seekAndPlay(remote.position || 0, false);
        if (remote.playing && video.paused) video.play().catch(() => {});
        if (!remote.playing && !video.paused) video.pause();
      }
    } finally {
      state.syncing = false;
    }
  }

  async function pollParty() {
    if (!state.party?.room || state.partyHost) return;
    try {
      const result = await feature('party', { method: 'GET', headers: {} }, { room: state.party.room });
      state.party = { ...state.party, ...result };
      await syncGuest(result.state);
      renderPartyBadge();
    } catch {
      clearInterval(state.partyTimer);
      showToast('Комната совместного просмотра закрыта');
    }
  }

  function startPartyGuest(room) {
    state.party = { room };
    state.partyHost = false;
    clearInterval(state.partyTimer);
    pollParty();
    state.partyTimer = setInterval(pollParty, 1500);
    renderPartyBadge();
  }

  function renderPartyBadge() {
    let badge = $('#yumePartyBadge');
    if (!state.party?.room) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('button');
      badge.id = 'yumePartyBadge';
      badge.className = 'yume-party-badge';
      badge.type = 'button';
      $('.now-playing-bar')?.insertAdjacentElement('afterend', badge);
    }
    badge.innerHTML = `<i></i>${state.partyHost ? 'Комната' : 'Совместный просмотр'} · ${esc(state.party.room)}`;
    badge.onclick = () => {
      const url = shareUrl(state.party.room);
      openPartyModal(`<span class="section-kicker">СМОТРЕТЬ ВМЕСТЕ</span><h2>${state.partyHost ? 'Твоя комната' : 'Ты в комнате'} ${esc(state.party.room)}</h2><div class="party-link-row"><input id="partyShareInput" readonly value="${esc(url)}"><button id="partyCopyBtn" class="btn primary">Копировать</button></div>`);
      $('#partyCopyBtn')?.addEventListener('click', () => navigator.clipboard?.writeText(url));
    };
  }

  function initParty() {
    const actions = $('.anime-actions');
    if (actions && !$('#partyBtn')) {
      actions.insertAdjacentHTML('beforeend', '<button id="partyBtn" class="btn ghost party-btn" type="button">👥 Смотреть вместе</button>');
      $('#partyBtn').onclick = createParty;
    }
    const room = new URL(location.href).searchParams.get('party');
    if (!room) return;
    const code = room.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,12);
    if (!code) return;
    openPartyModal(`
      <span class="section-kicker">СМОТРЕТЬ ВМЕСТЕ</span>
      <h2>Присоединиться к комнате ${esc(code)}?</h2>
      <p>После подключения серия, время, пауза и качество будут синхронизироваться с создателем комнаты.</p>
      <button id="partyJoinBtn" class="btn primary" type="button">Подключиться</button>`);
    $('#partyJoinBtn')?.addEventListener('click', () => {
      $('#yumePartyModal')?.classList.add('hidden');
      startPartyGuest(code);
      $('#watch')?.scrollIntoView({ behavior: 'smooth' });
    });
  }

  async function boot() {
    const player = await waitFor('#yumePlayer');
    if (!player) return;
    await loadPreferences();
    await fetchRelease();
    initCustomSelects();
    initResumeFix();
    initOpeningSkip();
    initAutoNext();
    initProviderSelector();
    initParty();

    const resume = await readResume();
    if (resume && Number(resume.position || 0) > 10) {
      let hint = $('#resumeHint');
      if (!hint) {
        hint = document.createElement('button');
        hint.id = 'resumeHint';
        hint.className = 'resume-hint';
        $('.player-column')?.insertAdjacentElement('afterbegin', hint);
      }
      const n = resume.episodeNumber || Number(resume.episodeIndex || 0) + 1;
      hint.textContent = `▶ Продолжить: серия ${n} с ${fmt(resume.position)}`;
      hint.classList.remove('hidden');
    }
  }

  boot();
})();