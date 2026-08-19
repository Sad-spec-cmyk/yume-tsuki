(() => {
  const API = '/.netlify/functions/yume-api';
  const state = { user: null, ready: false, lastVideo: null, lastPosition: 0, lastReportAt: 0 };
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

  function ensureFavicon() {
    if (document.querySelector('link[data-yume-favicon]')) return;
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    link.href = './favicon.svg?v=8';
    link.dataset.yumeFavicon = '1';
    document.head.appendChild(link);
  }

  function applyAccent(user) {
    if (user?.accent && /^#[0-9a-fA-F]{6}$/.test(user.accent)) {
      document.documentElement.style.setProperty('--accent', user.accent);
    } else {
      document.documentElement.style.removeProperty('--accent');
    }
  }

  function ensureNavLinks() {
    const nav = document.querySelector('.topbar .nav');
    if (!nav) return;
    if (!nav.querySelector('a[href*="account.html"]')) {
      const account = document.createElement('a');
      account.href = './account.html';
      account.className = 'nav-link yume-extra-nav yume-account-link';
      account.textContent = 'Аккаунт';
      nav.appendChild(account);
    }
  }

  function initials(user) {
    const text = user?.displayName || user?.username || 'Y';
    return text.trim().slice(0, 1).toUpperCase() || 'Y';
  }

  function renderAccountLink() {
    ensureNavLinks();
    const link = document.querySelector('.yume-account-link');
    if (!link) return;
    if (state.user) {
      const avatar = state.user.avatarUrl
        ? `<img class="mini-avatar-img" src="${esc(state.user.avatarUrl)}" alt="">`
        : `<span class="mini-avatar mini-avatar-letter" style="--user-accent:${esc(state.user.accent || '#ff395f')}">${esc(initials(state.user))}</span>`;
      link.innerHTML = `${avatar}<span>${esc(state.user.displayName || state.user.username)}</span>`;
    } else {
      link.textContent = 'Войти';
    }
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
    try {
      await request('history', { method: 'POST', body: JSON.stringify(payload) });
    } catch {}
  }

  function reportVideoProgress(video, completed = false) {
    if (!state.user || !video || !window.YUME_NOW_PLAYING) return;
    const current = Number(video.currentTime || 0);
    const previous = state.lastVideo === video ? Number(state.lastPosition || 0) : current;
    const delta = Math.max(0, Math.min(90, current - previous));
    state.lastVideo = video;
    state.lastPosition = current;
    state.lastReportAt = Date.now();
    if (delta < 1 && !completed) return;
    recordWatch({
      watchSecondsDelta: delta,
      position: current,
      duration: Number(video.duration || 0),
      completed: completed || (video.duration > 0 && current / video.duration >= 0.92),
    });
  }

  document.addEventListener('play', event => {
    const video = event.target.closest?.('video');
    if (!video) return;
    state.lastVideo = video;
    state.lastPosition = Number(video.currentTime || 0);
    recordWatch({ position: video.currentTime || 0, duration: video.duration || 0 });
  }, true);
  document.addEventListener('pause', event => {
    const video = event.target.closest?.('video');
    if (video) reportVideoProgress(video, false);
  }, true);
  document.addEventListener('ended', event => {
    const video = event.target.closest?.('video');
    if (video) reportVideoProgress(video, true);
  }, true);

  setInterval(() => {
    const video = document.querySelector('#yumeVideo');
    if (video && !video.paused && !video.ended) reportVideoProgress(video, false);
  }, 30000);

  function goToAnime(title, hash = '') {
    const q = String(title || '').trim();
    if (!q) return;
    location.href = `./anime.html?q=${encodeURIComponent(q)}${hash}`;
  }

  document.addEventListener('click', event => {
    if (event.button && event.button !== 0) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;

    const card = event.target.closest('.card');
    if (card) {
      const title = card.querySelector('h3')?.textContent?.trim();
      if (title) {
        event.preventDefault();
        event.stopImmediatePropagation();
        goToAnime(title);
        return;
      }
    }

    const heroMore = event.target.closest('#heroMore');
    if (heroMore) {
      const title = document.querySelector('#heroTitle')?.textContent?.trim();
      if (title) {
        event.preventDefault();
        event.stopImmediatePropagation();
        goToAnime(title);
        return;
      }
    }

    const heroWatch = event.target.closest('#heroWatch');
    if (heroWatch) {
      const title = document.querySelector('#heroTitle')?.textContent?.trim();
      if (title) {
        event.preventDefault();
        event.stopImmediatePropagation();
        goToAnime(title, '#watch');
        return;
      }
    }

    const modalWatch = event.target.closest('#watchBtn');
    if (modalWatch) {
      const title = document.querySelector('#modalTitle')?.textContent?.trim();
      if (title) {
        event.preventDefault();
        event.stopImmediatePropagation();
        goToAnime(title, '#watch');
      }
    }
  }, true);

  window.YUME_ACCOUNT = {
    get user() { return state.user; },
    get ready() { return state.ready; },
    request,
    loadMe,
    recordWatch,
    setUser(user) {
      state.user = user || null;
      applyAccent(state.user);
      renderAccountLink();
      document.dispatchEvent(new CustomEvent('yume:session', { detail: { user: state.user } }));
    },
  };

  ensureFavicon();
  ensureNavLinks();
  loadMe();
})();
