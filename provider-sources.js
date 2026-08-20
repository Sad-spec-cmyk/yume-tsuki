(() => {
  if (window.__YUME_PROVIDER_SOURCES) return;
  window.__YUME_PROVIDER_SOURCES = true;

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));

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

  function showExternalProvider(provider) {
    const player = $('#yumePlayer');
    const video = $('#yumeVideo');
    if (!player || !provider?.link) return;
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
    frame.src = normalizeUrl(provider.link);
    frame.classList.remove('hidden');
    video?.classList.add('provider-hidden');
    $('#playerControls')?.classList.add('provider-hidden');
    $('#centerPlay')?.classList.add('provider-hidden');
    player.querySelector('.player-topline')?.classList.add('provider-hidden');
    $$('.provider-choice').forEach(x => x.classList.remove('active'));
    document.querySelector(`[data-kodik-id="${CSS.escape(provider.id)}"]`)?.classList.add('active');
    if ($('#currentQualityBadge')) $('#currentQualityBadge').textContent = provider.source || 'Kodik';
    window.YUME_ACTIVE_PROVIDER = { ...provider, kind: 'external' };
  }

  function restoreNative() {
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
      $('#nowPlayingSubtitle')?.textContent,
      window.YUME_NOW_PLAYING?.title,
      document.title?.replace(/\s*[—-]\s*Yume Tsuki\s*$/i, ''),
    ].map(x => String(x || '').trim()).filter(x => x && x !== 'Загрузка...');
    return [...new Set(values)].slice(0, 8);
  }

  function providerMeta(provider) {
    const bits = [provider.source || 'Kodik'];
    if (provider.quality) bits.push(provider.quality);
    if (provider.lastEpisode) bits.push(`до ${provider.lastEpisode} серии`);
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
    list.innerHTML = '<div class="provider-loading">Ищем озвучки через Kodik, Jikan и Shikimori…</div>';

    try {
      const data = await fetchProviders();
      const providers = Array.isArray(data.providers) ? data.providers : [];
      if (!providers.length) {
        list.innerHTML = `<div class="provider-empty">${esc(data.error || 'Других озвучек для этого тайтла не найдено.')}</div>`;
        const note = card.querySelector('.provider-note');
        if (note) note.innerHTML = '<b>Проверено:</b> AniLiberty · Kodik · Jikan · Shikimori. Если у источника нет этого релиза, дубль не показывается.';
        return;
      }

      list.innerHTML = providers.map(p => `
        <button type="button" class="provider-choice provider-kodik" data-kodik-id="${esc(p.id)}">
          <b>${esc(p.name)}</b>
          <small>${esc(providerMeta(p))}</small>
        </button>`).join('');
      providers.forEach(provider => {
        list.querySelector(`[data-kodik-id="${CSS.escape(provider.id)}"]`)?.addEventListener('click', () => showExternalProvider(provider));
      });
      const note = card.querySelector('.provider-note');
      if (note) note.innerHTML = `<b>${providers.length} озвучек найдено.</b> Тайтл остаётся один — меняется только источник/озвучка.`;
    } catch (error) {
      list.innerHTML = `<div class="provider-empty">${esc(error?.message || 'Не удалось загрузить дополнительные озвучки.')}</div>`;
    }
  }

  boot();
})();