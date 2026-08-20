(() => {
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
    for (let i = 0; i < 80; i++) {
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
    if (frame) frame.classList.add('hidden');
    $('#yumeVideo')?.classList.remove('provider-hidden');
    $('#playerControls')?.classList.remove('provider-hidden');
    $('#centerPlay')?.classList.remove('provider-hidden');
    $('#yumePlayer')?.querySelector('.player-topline')?.classList.remove('provider-hidden');
    window.YUME_ACTIVE_PROVIDER = { id: 'aniliberty', name: 'AniLiberty', kind: 'native' };
    const nativeBtn = $('#providerCard [data-provider="aniliberty"]');
    if (nativeBtn && !nativeBtn.classList.contains('active')) nativeBtn.click();
  }

  document.addEventListener('click', event => {
    if (!event.target.closest('#partyBtn')) return;
    if (window.YUME_ACTIVE_PROVIDER?.kind === 'external') restoreNative();
  }, true);

  async function boot() {
    const card = await waitForCard();
    if (!card) return;
    const nativeBtn = card.querySelector('[data-provider="aniliberty"]');
    nativeBtn?.addEventListener('click', () => {
      const frame = $('#yumeExternalPlayer');
      if (frame) frame.classList.add('hidden');
      $('#yumeVideo')?.classList.remove('provider-hidden');
      $('#playerControls')?.classList.remove('provider-hidden');
      $('#centerPlay')?.classList.remove('provider-hidden');
      $('#yumePlayer')?.querySelector('.player-topline')?.classList.remove('provider-hidden');
      window.YUME_ACTIVE_PROVIDER = { id: 'aniliberty', name: 'AniLiberty', kind: 'native' };
    }, true);

    let list = card.querySelector('.provider-kodik-list');
    if (!list) {
      list = document.createElement('div');
      list.className = 'provider-kodik-list';
      const note = card.querySelector('.provider-note');
      note?.insertAdjacentElement('beforebegin', list);
    }
    list.innerHTML = '<div class="provider-loading">Ищем дополнительные озвучки…</div>';

    const title = $('#animeTitle')?.textContent?.trim() || '';
    const year = $('#sideYear')?.textContent?.trim() || '';
    if (!title || title === 'Загрузка...') {
      await sleep(500);
      return boot();
    }

    try {
      const qs = new URLSearchParams({ title, year: /^\d{4}$/.test(year) ? year : '' });
      const response = await fetch(`/.netlify/functions/providers?${qs}`, { headers: { accept: 'application/json' } });
      const data = await response.json().catch(() => ({}));
      const providers = Array.isArray(data.providers) ? data.providers : [];
      if (!providers.length) {
        list.innerHTML = '<div class="provider-empty">Других озвучек для этого тайтла не найдено.</div>';
        return;
      }
      list.innerHTML = providers.map(p => `
        <button type="button" class="provider-choice provider-kodik" data-kodik-id="${esc(p.id)}">
          <b>${esc(p.name)}</b>
          <small>${esc([p.source, p.quality].filter(Boolean).join(' · ') || 'Kodik')}</small>
        </button>`).join('');
      providers.forEach(provider => {
        list.querySelector(`[data-kodik-id="${CSS.escape(provider.id)}"]`)?.addEventListener('click', () => showExternalProvider(provider));
      });
      const note = card.querySelector('.provider-note');
      if (note) note.textContent = `Найдено озвучек: ${providers.length}. Один тайтл — разные источники внутри этой страницы.`;
    } catch {
      list.innerHTML = '<div class="provider-empty">Не удалось загрузить дополнительные озвучки.</div>';
    }
  }

  boot();
})();