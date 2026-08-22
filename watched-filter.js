(() => {
  if (window.__YUME_HIDE_WATCHED) return;
  window.__YUME_HIDE_WATCHED = true;

  const normalize = value => String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let watchedKeys = new Set();
  let ready = false;
  let refreshPromise = null;
  let lastRefresh = 0;
  let applyQueued = false;

  function fullyWatched(item) {
    if (!item) return false;
    if (item.manuallyWatched === true || item.markedWatched === true || item.watched === true || item.status === 'watched') return true;
    const total = Math.max(0, Number(item.totalEpisodes || 0));
    const completed = new Set((Array.isArray(item.completedEpisodes) ? item.completedEpisodes : []).map(String).filter(Boolean));
    return total > 0 && completed.size >= total;
  }

  function addKey(set, value) {
    const raw = String(value ?? '').trim();
    if (!raw) return;
    set.add(`raw:${raw.toLowerCase()}`);
    const n = normalize(raw);
    if (n) set.add(`name:${n}`);
  }

  function historyKeys(item) {
    const set = new Set();
    addKey(set, item?.animeId);
    addKey(set, item?.alias);
    addKey(set, item?.title);
    return set;
  }

  function animeKeys(anime, fallbackTitle = '') {
    const set = new Set();
    addKey(set, anime?.id);
    addKey(set, anime?.alias);
    addKey(set, anime?.title);
    addKey(set, anime?.name?.main);
    addKey(set, anime?.name?.english);
    addKey(set, anime?.name?.alternative);
    addKey(set, fallbackTitle);
    return set;
  }

  function isWatchedAnime(anime, fallbackTitle = '') {
    if (!ready || !watchedKeys.size) return false;
    for (const key of animeKeys(anime, fallbackTitle)) if (watchedKeys.has(key)) return true;
    return false;
  }

  function listForCards() {
    try {
      if (typeof state !== 'undefined') {
        if (Array.isArray(state.current)) return state.current;
        if (Array.isArray(state.items)) return state.items;
      }
    } catch {}
    return [];
  }

  function applyFilter() {
    applyQueued = false;
    if (!ready) return;
    const grid = document.querySelector('#grid');
    if (!grid) return;

    const list = listForCards();
    const cards = [...grid.querySelectorAll('.card')];
    let removed = 0;

    for (const card of cards) {
      const index = Number(card.dataset.index);
      const anime = Number.isFinite(index) ? list[index] : null;
      const title = card.querySelector('h3')?.textContent || card.querySelector('img')?.alt || '';
      if (isWatchedAnime(anime, title)) {
        card.remove();
        removed++;
      }
    }

    const visible = grid.querySelectorAll('.card').length;
    const status = document.querySelector('#status');
    if (status && !/загруз|ошиб|api/i.test(status.textContent || '')) {
      status.textContent = document.body.dataset.page === 'catalog' ? `${visible} показано` : `${visible} тайтлов`;
    }

    const empty = document.querySelector('#empty');
    if (empty && cards.length > 0 && visible === 0 && removed > 0) {
      empty.classList.remove('hidden');
      empty.innerHTML = '<strong>Здесь всё уже просмотрено</strong><br><small>Просмотренные тайтлы больше не показываются.</small>';
    } else if (empty && visible > 0 && /всё уже просмотрено/i.test(empty.textContent || '')) {
      empty.classList.add('hidden');
    }

    const heroTitle = document.querySelector('#heroTitle');
    if (heroTitle && isWatchedAnime(null, heroTitle.textContent || '')) {
      try {
        const next = list.find(item => !isWatchedAnime(item));
        if (next && typeof setHero === 'function') setHero(next);
      } catch {}
    }
  }

  function queueApply() {
    if (applyQueued) return;
    applyQueued = true;
    requestAnimationFrame(applyFilter);
  }

  async function refreshHistory(force = false) {
    const now = Date.now();
    if (!force && now - lastRefresh < 2500) return refreshPromise;
    if (refreshPromise) return refreshPromise;
    lastRefresh = now;

    refreshPromise = (async () => {
      try {
        const response = await fetch('/.netlify/functions/yume-api?action=history', {
          headers: { accept: 'application/json' },
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (!response.ok) {
          watchedKeys = new Set();
          ready = true;
          queueApply();
          return;
        }
        const data = await response.json().catch(() => ({}));
        const next = new Set();
        for (const item of Array.isArray(data?.items) ? data.items : []) {
          if (!fullyWatched(item)) continue;
          for (const key of historyKeys(item)) next.add(key);
        }
        watchedKeys = next;
        ready = true;
        queueApply();
      } catch {
        ready = true;
      }
    })().finally(() => { refreshPromise = null; });

    return refreshPromise;
  }

  const grid = document.querySelector('#grid');
  if (grid) new MutationObserver(queueApply).observe(grid, { childList: true });

  window.addEventListener('pageshow', () => refreshHistory(true));
  window.addEventListener('focus', () => refreshHistory());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshHistory();
  });

  refreshHistory(true);
})();