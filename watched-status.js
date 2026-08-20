(() => {
  if (window.__YUME_WATCHED_STATUS) return;
  window.__YUME_WATCHED_STATUS = true;

  const API = '/.netlify/functions/watched';
  const $ = selector => document.querySelector(selector);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let button = null;
  let busy = false;
  let watched = false;

  async function waitForSession() {
    if (window.YUME_ACCOUNT?.ready) return window.YUME_ACCOUNT.user || null;
    return new Promise(resolve => {
      let settled = false;
      const finish = user => {
        if (settled) return;
        settled = true;
        resolve(user || null);
      };
      document.addEventListener('yume:session', event => finish(event.detail?.user), { once: true });
      setTimeout(() => finish(window.YUME_ACCOUNT?.user), 2200);
    });
  }

  async function waitForAnime() {
    for (let i = 0; i < 120; i++) {
      if (window.YUME_NOW_PLAYING?.title && $('.anime-actions')) return window.YUME_NOW_PLAYING;
      await sleep(100);
    }
    return null;
  }

  function averageEpisodeSeconds() {
    const rows = [...document.querySelectorAll('#infoList > div')];
    const durationRow = rows.find(row => row.querySelector('dt')?.textContent?.trim() === 'Длительность');
    const text = durationRow?.querySelector('dd')?.textContent || '';
    const hours = Number(text.match(/(\d+(?:[.,]\d+)?)\s*ч/i)?.[1]?.replace(',', '.') || 0);
    const minutes = Number(text.match(/(\d+(?:[.,]\d+)?)\s*мин/i)?.[1]?.replace(',', '.') || 0);
    const seconds = Math.round(hours * 3600 + minutes * 60);
    return seconds >= 60 ? seconds : 24 * 60;
  }

  function animePayload() {
    const now = window.YUME_NOW_PLAYING || {};
    const totalFromSide = Number($('#sideEpisodes')?.textContent || 0);
    const totalFromList = document.querySelectorAll('.episode-row').length;
    const totalEpisodes = Math.max(1, Number(now.totalEpisodes || 0), totalFromSide, totalFromList);
    const url = new URL(location.href);
    const alias = now.alias || url.searchParams.get('alias') || '';
    const animeId = now.animeId || url.searchParams.get('id') || alias || now.title || '';
    return {
      animeId,
      alias,
      key: animeId || alias || now.title || '',
      title: now.title || $('#animeTitle')?.textContent?.trim() || '',
      poster: now.poster || $('#animePoster')?.src || '',
      href: alias ? `/anime?alias=${encodeURIComponent(alias)}` : `${location.pathname}${location.search}`,
      genres: Array.isArray(now.genres) ? now.genres : [...document.querySelectorAll('#animeGenres .chip')].map(x => x.textContent.trim()).filter(Boolean),
      totalEpisodes,
      year: now.year || $('#sideYear')?.textContent?.trim() || '',
      type: now.type || $('#animeType')?.textContent?.trim() || '',
      averageEpisodeSeconds: averageEpisodeSeconds(),
    };
  }

  function setButtonState() {
    if (!button) return;
    button.classList.toggle('active', watched);
    button.setAttribute('aria-pressed', watched ? 'true' : 'false');
    button.innerHTML = watched
      ? '<span class="watched-check">✓</span><span>Просмотрено</span>'
      : '<span class="watched-eye">◉</span><span>Просмотрено</span>';
    button.title = watched ? 'Уже добавлено в статистику просмотра' : 'Отметить всё аниме просмотренным и добавить в статистику';
  }

  function ensureButton() {
    const actions = $('.anime-actions');
    if (!actions) return null;
    button = $('#watchedBtn');
    if (button) return button;
    button = document.createElement('button');
    button.id = 'watchedBtn';
    button.className = 'btn ghost watched-btn';
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    const favorite = $('#favoriteBtn');
    if (favorite) favorite.insertAdjacentElement('afterend', button);
    else actions.appendChild(button);
    button.addEventListener('click', markWatched);
    setButtonState();
    return button;
  }

  function toast(message) {
    let node = $('#watchedToast');
    if (!node) {
      node = document.createElement('div');
      node.id = 'watchedToast';
      node.className = 'watched-toast';
      document.body.appendChild(node);
    }
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(node.__timer);
    node.__timer = setTimeout(() => node.classList.remove('show'), 2800);
  }

  async function request(method, payload = null) {
    const data = payload || animePayload();
    if (method === 'GET') {
      const qs = new URLSearchParams({
        animeId: data.animeId || '',
        alias: data.alias || '',
        key: data.key || '',
        title: data.title || '',
      });
      const response = await fetch(`${API}?${qs}`, { credentials: 'same-origin', cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || `Ошибка ${response.status}`);
      return json;
    }
    const response = await fetch(API, {
      method,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error || `Ошибка ${response.status}`);
    return json;
  }

  async function refreshStatus() {
    ensureButton();
    const user = await waitForSession();
    if (!user || !button) {
      watched = false;
      setButtonState();
      return;
    }
    try {
      const result = await request('GET');
      watched = Boolean(result.watched);
    } catch {
      watched = false;
    }
    setButtonState();
  }

  async function markWatched() {
    if (busy) return;
    const user = await waitForSession();
    if (!user) {
      const next = `${location.pathname}${location.search}${location.hash}`;
      location.href = `/account?next=${encodeURIComponent(next)}`;
      return;
    }
    if (watched) {
      toast('Это аниме уже учтено в статистике');
      return;
    }

    busy = true;
    button?.classList.add('loading');
    const old = button?.innerHTML;
    if (button) button.innerHTML = '<span class="watched-spinner"></span><span>Сохраняем...</span>';
    try {
      const result = await request('POST', animePayload());
      watched = Boolean(result.watched);
      setButtonState();
      toast('Аниме отмечено просмотренным — статистика обновлена');
      document.dispatchEvent(new CustomEvent('yume:watched-changed', { detail: { watched: true, entry: result.entry || null } }));
    } catch (error) {
      if (button && old) button.innerHTML = old;
      toast(error.message || 'Не удалось сохранить статус');
    } finally {
      busy = false;
      button?.classList.remove('loading');
    }
  }

  (async () => {
    const anime = await waitForAnime();
    if (!anime) return;
    ensureButton();
    await refreshStatus();
  })();
})();
