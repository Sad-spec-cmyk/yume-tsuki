(() => {
  if (window.__YUME_PROVIDER_SOURCES_V2) return;
  window.__YUME_PROVIDER_SOURCES_V2 = true;

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let activeExternal = null;
  let lastEpisode = '';

  function normalizeUrl(raw) {
    const value = String(raw || '').trim();
    if (!value) return '';
    if (value.startsWith('//')) return `https:${value}`;
    if (/^https?:\/\//i.test(value)) return value;
    return '';
  }

  async function waitForCard() {
    for (let i = 0; i < 100; i++) {
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

  function setExternalFrame(provider, silent = false) {
    const player = $('#yumePlayer');
    const video = $('#yumeVideo');
    if (!player || !provider) return false;
    const episode = currentEpisodeNumber();
    const link = providerLink(provider, episode);
    if (!link) {
      if (!silent) alert(`В озвучке «${provider.name || provider.source || 'Источник'}» пока нет серии ${episode}.`);
      return false;
    }

    video?.pause();
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
    video?.classList.add('provider-hidden');
    $('#playerControls')?.classList.add('provider-hidden');
    $('#centerPlay')?.classList.add('provider-hidden');
    player.querySelector('.player-topline')?.classList.add('provider-hidden');
    $$('.provider-choice').forEach(x => x.classList.remove('active'));
    document.querySelector(`[data-provider-id="${CSS.escape(provider.id)}"]`)?.classList.add('active');
    if ($('#currentQualityBadge')) $('#currentQualityBadge').textContent = provider.source || 'Источник';
    activeExternal = provider;
    lastEpisode = String(episode);
    window.YUME_ACTIVE_PROVIDER = { ...provider, kind: 'external' };
    return true;
  }

  function showExternalProvider(provider) {
    setExternalFrame(provider, false);
  }

  function restoreNative() {
    activeExternal = null;
    lastEpisode = '';
    const frame = $('#yumeExternalPlayer');
    if (frame) {
      frame.classList.add('hidden');
      frame.removeAttribute('src');
    }
    $('#yumeVideo')?.classList.remove('provider-hidden');
    $('#playerControls')?.classList.remove('provider-hidden');
    $('#centerPlay')?.classList.remove('provider-hidden');
    $('#yumePlayer')?.querySelector('.player-topline')?.classList.remove('provider-hidden');
    $$('.provider-choice').forEach(x => x.classList.remove('active'));
    $('#providerCard [data-provider="aniliberty"]')?.classList.add('active');
    window.YUME_ACTIVE_PROVIDER = { id: 'aniliberty', name: 'AniLiberty', kind: 'native' };
  }

  function titleCandidates() {
    const values = [
      $('#animeTitle')?.textContent,
      $('#animeAltTitle')?.textContent,
      window.YUME_NOW_PLAYING?.title,
      document.title?.replace(/\s*[—-]\s*Yume Tsuki\s*$/i, ''),
    ].map(x => String(x || '').trim()).filter(x => x && x !== 'Загрузка...');
    return [...new Set(values)].slice(0, 8);
  }

  function episodeRange(provider) {
    const eps = Array.isArray(provider.availableEpisodes) ? provider.availableEpisodes.map(Number).filter(Number.isFinite).sort((a,b)=>a-b) : [];
    if (!eps.length) return provider.lastEpisode ? `до ${provider.lastEpisode} серии` : '';
    if (eps.length === 1) return `серия ${eps[0]}`;
    const continuous = eps.every((v, i) => i === 0 || v === eps[i - 1] + 1);
    return continuous ? `серии ${eps[0]}–${eps[eps.length - 1]}` : `${eps.length} серий`;
  }

  function providerMeta(provider) {
    const bits = [provider.source || 'Источник'];
    if (provider.quality && provider.quality !== 'unknown') bits.push(provider.quality.toUpperCase());
    const range = episodeRange(provider);
    if (range) bits.push(range);
    return bits.join(' · ');
  }

  async function fetchProviders() {
    const titles = titleCandidates();
    const title = titles[0] || '';
    const year = $('#sideYear')?.textContent?.trim() || '';
    if (!title) return { providers: [], error: 'Не удалось определить название.' };
    const qs = new URLSearchParams({
      title,
      year: /^\d{4}$/.test(year) ? year : '',
      titles: titles.slice(1).join('|'),
    });
    const response = await fetch(`/.netlify/functions/providers?${qs}`, { headers: { accept: 'application/json' } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Ошибка ${response.status}`);
    return data;
  }

  function sourceSummary(data) {
    const d = data?.diagnostics || {};
    const parts = [];
    parts.push(`Shikimori: ${Number(d?.shikimori?.found || 0)}`);
    if (d?.kodik?.configured) parts.push(`Kodik: ${Number(d?.kodik?.found || 0)}`);
    return parts.join(' · ');
  }

  async function boot() {
    const card = await waitForCard();
    if (!card) return;
    const nativeBtn = card.querySelector('[data-provider="aniliberty"]');
    nativeBtn?.addEventListener('click', restoreNative, true);

    let list = card.querySelector('.provider-kodik-list');
    if (!list) {
      list = document.createElement('div');
      list.className = 'provider-kodik-list';
      const note = card.querySelector('.provider-note');
      note?.insertAdjacentElement('beforebegin', list);
    }
    list.innerHTML = '<div class="provider-loading">Ищем русские озвучки и видео по тайтлу…</div>';

    try {
      const data = await fetchProviders();
      const providers = Array.isArray(data.providers) ? data.providers : [];
      if (!providers.length) {
        list.innerHTML = `<div class="provider-empty">${esc(data.error || 'Для этого тайтла дополнительные русские источники пока не найдены.')}</div>`;
        const note = card.querySelector('.provider-note');
        if (note) note.innerHTML = `<b>Поиск выполнен по русскому, английскому и японскому названию.</b>${sourceSummary(data) ? ` ${esc(sourceSummary(data))}.` : ''}`;
        return;
      }

      list.innerHTML = providers.map(p => `
        <button type="button" class="provider-choice provider-kodik" data-provider-id="${esc(p.id)}">
          <b>${esc(p.name)}</b>
          <small>${esc(providerMeta(p))}</small>
        </button>`).join('');
      providers.forEach(provider => {
        list.querySelector(`[data-provider-id="${CSS.escape(provider.id)}"]`)?.addEventListener('click', () => showExternalProvider(provider));
      });
      const note = card.querySelector('.provider-note');
      if (note) note.innerHTML = `<b>${providers.length} дополнительных вариантов найдено.</b> Выбирай озвучку здесь — тайтл не дублируется.`;
    } catch (error) {
      list.innerHTML = `<div class="provider-empty">${esc(error?.message || 'Не удалось загрузить дополнительные озвучки.')}</div>`;
    }
  }

  setInterval(() => {
    if (!activeExternal) return;
    const episode = currentEpisodeNumber();
    if (!episode || episode === lastEpisode) return;
    lastEpisode = episode;
    setExternalFrame(activeExternal, true);
  }, 700);

  boot();
})();
