(() => {
  const API = '/.netlify/functions/yume-api';
  const FEATURE_API = '/.netlify/functions/resume-favorites';
  const state = { user: null, ready: false, lastVideo: null, lastPosition: 0 };
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

  async function request(action, options = {}) {
    const response = await fetch(`${API}?action=${encodeURIComponent(action)}`, {
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.error || `Ошибка ${response.status}`);
    return data;
  }

  async function feature(action, options = {}, query = {}) {
    const qs = new URLSearchParams({ action, ...query });
    const response = await fetch(`${FEATURE_API}?${qs}`, {
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.error || `Ошибка ${response.status}`);
    return data;
  }

  function ensureStylesheet(href, marker) {
    if (document.querySelector(`link[data-yume-${marker}]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset[`yume${marker[0].toUpperCase()}${marker.slice(1)}`] = '1';
    document.head.appendChild(link);
  }
  function ensureGlobalStyles() {
    ensureStylesheet('/features.css?v=11', 'features');
    ensureStylesheet('/ui-polish.css?v=11', 'polish');
    ensureStylesheet('/mobile.css?v=11', 'mobile');
  }
  function ensureFavicon() {
    if (document.querySelector('link[data-yume-favicon]')) return;
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    link.href = '/favicon.svg?v=11';
    link.dataset.yumeFavicon = '1';
    document.head.appendChild(link);
  }

  function cleanPath(pathname) {
    if (pathname === '/index.html') return '/';
    if (pathname.endsWith('.html')) return pathname.slice(0, -5) || '/';
    return pathname;
  }
  function normalizeLinks() {
    document.querySelectorAll('a[href]').forEach(link => {
      const raw = link.getAttribute('href');
      if (!raw || raw.startsWith('#') || /^(mailto:|tel:|javascript:)/i.test(raw)) return;
      try {
        const url = new URL(raw, location.href);
        if (url.origin !== location.origin) return;
        url.pathname = cleanPath(url.pathname);
        link.setAttribute('href', `${url.pathname}${url.search}${url.hash}`);
      } catch {}
    });
  }
  function cleanCurrentUrl() {
    const path = cleanPath(location.pathname);
    if (path !== location.pathname) history.replaceState(history.state, '', `${path}${location.search}${location.hash}`);
  }

  function applyAccent(user) {
    if (user?.accent && /^#[0-9a-fA-F]{6}$/.test(user.accent)) document.documentElement.style.setProperty('--accent', user.accent);
    else document.documentElement.style.removeProperty('--accent');
  }
  function initials(user) {
    const text = user?.displayName || user?.username || 'Y';
    return text.trim().slice(0, 1).toUpperCase() || 'Y';
  }
  function ensureNavLinks() {
    const nav = document.querySelector('.topbar .nav');
    if (!nav) return;

    let account = nav.querySelector('a[href*="account"]');
    if (!nav.querySelector('a[href*="schedule"]')) {
      const schedule = document.createElement('a');
      schedule.href = '/schedule';
      schedule.className = 'nav-link yume-extra-nav yume-schedule-link';
      schedule.textContent = 'Расписание';
      if (account) nav.insertBefore(schedule, account);
      else nav.appendChild(schedule);
    }

    account = nav.querySelector('a[href*="account"]');
    if (!account) {
      account = document.createElement('a');
      account.href = '/account';
      account.className = 'nav-link yume-extra-nav yume-account-link';
      account.textContent = 'Аккаунт';
      nav.appendChild(account);
    }
    normalizeLinks();
  }
  function renderAccountLink() {
    ensureNavLinks();
    const link = document.querySelector('.yume-account-link');
    if (!link) return;
    link.href = '/account';
    if (state.user) {
      const avatar = state.user.avatarUrl
        ? `<img class="mini-avatar-img" src="${esc(state.user.avatarUrl)}" alt="">`
        : `<span class="mini-avatar mini-avatar-letter" style="--user-accent:${esc(state.user.accent || '#ff395f')}">${esc(initials(state.user))}</span>`;
      link.innerHTML = `${avatar}<span>${esc(state.user.displayName || state.user.username)}</span>`;
    } else link.textContent = 'Войти';
  }
  async function loadMe() {
    try {
      const data = await request('me', { method: 'GET', headers: {} });
      state.user = data.user || null;
      applyAccent(state.user);
    } catch {
      state.user = null;
      applyAccent(null);
    } finally {
      state.ready = true;
      renderAccountLink();
      normalizeLinks();
      document.dispatchEvent(new CustomEvent('yume:session', { detail: { user: state.user } }));
    }
    return state.user;
  }

  async function recordWatch(extra = {}) {
    if (!state.user) return;
    const now = window.YUME_NOW_PLAYING || {};
    const title = extra.title || now.title || document.querySelector('#playerTitle')?.textContent?.trim() || '';
    if (!title) return;
    const payload = {
      title,
      animeId: extra.animeId || now.animeId || now.alias || '',
      alias: extra.alias || now.alias || '',
      episode: extra.episode || now.episode || '',
      episodeNumber: extra.episodeNumber ?? now.episodeNumber ?? '',
      episodeTitle: extra.episodeTitle || now.episodeTitle || '',
      poster: extra.poster || now.poster || '',
      href: extra.href || now.href || location.href,
      genres: extra.genres || now.genres || [],
      totalEpisodes: extra.totalEpisodes ?? now.totalEpisodes ?? 0,
      year: extra.year || now.year || '',
      type: extra.type || now.type || '',
      watchSecondsDelta: Number(extra.watchSecondsDelta || 0),
      position: Number(extra.position || 0),
      duration: Number(extra.duration || 0),
      completed: Boolean(extra.completed),
    };
    try { await request('history', { method: 'POST', body: JSON.stringify(payload) }); } catch {}
  }
  function reportVideoProgress(video, completed = false) {
    if (!state.user || !video || !window.YUME_NOW_PLAYING) return;
    const current = Number(video.currentTime || 0);
    const previous = state.lastVideo === video ? Number(state.lastPosition || 0) : current;
    const delta = Math.max(0, Math.min(90, current - previous));
    state.lastVideo = video;
    state.lastPosition = current;
    if (delta < 1 && !completed) return;
    recordWatch({ watchSecondsDelta: delta, position: current, duration: Number(video.duration || 0), completed: completed || (video.duration > 0 && current / video.duration >= 0.92) });
  }

  document.addEventListener('play', event => {
    const video = event.target.closest?.('video');
    if (!video) return;
    state.lastVideo = video;
    state.lastPosition = Number(video.currentTime || 0);
    recordWatch({ position: video.currentTime || 0, duration: video.duration || 0 });
  }, true);
  document.addEventListener('pause', event => { const video = event.target.closest?.('video'); if (video) reportVideoProgress(video, false); }, true);
  document.addEventListener('ended', event => { const video = event.target.closest?.('video'); if (video) reportVideoProgress(video, true); }, true);
  setInterval(() => {
    const video = document.querySelector('#yumeVideo');
    if (video && !video.paused && !video.ended) reportVideoProgress(video, false);
  }, 30000);

  function goToAnime(title, hash = '') {
    const q = String(title || '').trim();
    if (q) location.href = `/anime?q=${encodeURIComponent(q)}${hash}`;
  }
  document.addEventListener('click', event => {
    if (event.button && event.button !== 0) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const card = event.target.closest('.card');
    if (card) {
      const title = card.querySelector('h3')?.textContent?.trim();
      if (title) { event.preventDefault(); event.stopImmediatePropagation(); goToAnime(title); return; }
    }
    const heroMore = event.target.closest('#heroMore');
    if (heroMore) {
      const title = document.querySelector('#heroTitle')?.textContent?.trim();
      if (title) { event.preventDefault(); event.stopImmediatePropagation(); goToAnime(title); return; }
    }
    const heroWatch = event.target.closest('#heroWatch');
    if (heroWatch) {
      const title = document.querySelector('#heroTitle')?.textContent?.trim();
      if (title) { event.preventDefault(); event.stopImmediatePropagation(); goToAnime(title, '#watch'); return; }
    }
    const modalWatch = event.target.closest('#watchBtn');
    if (modalWatch) {
      const title = document.querySelector('#modalTitle')?.textContent?.trim();
      if (title) { event.preventDefault(); event.stopImmediatePropagation(); goToAnime(title, '#watch'); }
    }
  }, true);

  function loadOptionalScript(src, marker) {
    if (document.querySelector(`script[data-yume-${marker}]`)) return;
    const script = document.createElement('script');
    script.src = src;
    script.defer = true;
    script.dataset[`yume${marker[0].toUpperCase()}${marker.slice(1)}`] = '1';
    document.body.appendChild(script);
  }
  function loadPageEnhancements() {
    const path = cleanPath(location.pathname);
    if (path === '/anime') {
      loadOptionalScript('/watch-enhancements.js?v=11', 'watch');
      loadOptionalScript('/watch-runtime-fixes.js?v=11', 'watchfixes');
      loadOptionalScript('/provider-sources.js?v=11', 'providers');
    }
    if (path === '/account') loadOptionalScript('/account-preferences.js?v=11', 'preferences');
  }

  window.YUME_ACCOUNT = {
    get user() { return state.user; },
    get ready() { return state.ready; },
    request,
    feature,
    loadMe,
    recordWatch,
    profileUrl(username) { return `/profile?u=${encodeURIComponent(username || '')}`; },
    setUser(user) {
      state.user = user || null;
      applyAccent(state.user);
      renderAccountLink();
      document.dispatchEvent(new CustomEvent('yume:session', { detail: { user: state.user } }));
    },
  };

  ensureGlobalStyles();
  ensureFavicon();
  cleanCurrentUrl();
  ensureNavLinks();
  normalizeLinks();
  loadPageEnhancements();
  loadMe();
})();